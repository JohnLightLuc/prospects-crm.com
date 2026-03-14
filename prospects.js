// src/routes/prospects.js
const express = require('express');
const pool    = require('../../config/database');
const { authMiddleware } = require('../middleware/auth');
const { notifyNewProspect, notifyStatusChange } = require('../services/emailService');

const router = express.Router();

// Génère le track_id automatique : PRO-XXXX
async function generateTrackId(client) {
  const { rows } = await client.query("SELECT nextval('track_id_seq') AS val");
  return 'PRO-' + String(rows[0].val).padStart(4, '0');
}

// Récupère tous les emails actifs pour notifications
async function getAllEmails(client) {
  const { rows } = await client.query("SELECT email FROM users WHERE actif = true");
  return rows.map(r => r.email);
}

// ── GET /api/prospects ──────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { status, sector, source, priority, q } = req.query;
    let where = [], params = [];
    let i = 1;

    if (status)   { where.push(`p.status = $${i++}`);   params.push(status); }
    if (sector)   { where.push(`p.sector = $${i++}`);   params.push(sector); }
    if (source)   { where.push(`p.source = $${i++}`);   params.push(source); }
    if (priority) { where.push(`p.priority = $${i++}`); params.push(priority); }
    if (q) {
      where.push(`(p.company ILIKE $${i} OR p.keyperson ILIKE $${i} OR p.location ILIKE $${i})`);
      params.push(`%${q}%`); i++;
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const sql = `
      SELECT p.*, u.nom AS created_by_name
      FROM prospects p
      LEFT JOIN users u ON p.created_by = u.id
      ${whereClause}
      ORDER BY p.updated_at DESC
    `;
    const { rows } = await pool.query(sql, params);

    // Historique par prospect
    const ids = rows.map(r => r.id);
    let history = [];
    if (ids.length) {
      const hRes = await pool.query(`
        SELECT ph.*, u.nom AS changed_by_name
        FROM prospect_history ph
        LEFT JOIN users u ON ph.changed_by = u.id
        WHERE ph.prospect_id = ANY($1)
        ORDER BY ph.changed_at ASC
      `, [ids]);
      history = hRes.rows;
    }

    const result = rows.map(p => ({
      ...p,
      history: history.filter(h => h.prospect_id === p.id)
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des prospects.' });
  }
});

// ── POST /api/prospects ─────────────────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {
      company, sector, keyperson, poste, tel, email, location, size,
      status, source, priority, ca_potentiel, next_action, next_date,
      expected, obtained, comment, need
    } = req.body;

    if (!company || !sector || !keyperson || !location)
      return res.status(400).json({ error: 'Champs obligatoires manquants.' });

    const trackId = await generateTrackId(client);

    const { rows } = await client.query(`
      INSERT INTO prospects
        (track_id, company, sector, keyperson, poste, tel, email, location, size,
         status, source, priority, ca_potentiel, next_action, next_date,
         expected, obtained, comment, need, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      RETURNING *
    `, [trackId, company, sector, keyperson, poste||null, tel||null, email||null,
        location, size||null, status||'Prospection', source||null, priority||'medium',
        ca_potentiel||0, next_action||null,
        next_date||null, expected||null, obtained||null, comment||null, need||null,
        req.user.id]);

    const prospect = rows[0];

    // Historique initial
    await client.query(`
      INSERT INTO prospect_history (prospect_id, status, comment, changed_by)
      VALUES ($1,$2,$3,$4)
    `, [prospect.id, prospect.status, comment || 'Prospect créé', req.user.id]);

    await client.query('COMMIT');

    // Notification email asynchrone
    getAllEmails(pool).then(emails => {
      notifyNewProspect(prospect, req.user.nom, emails).catch(console.error);
    });

    // Émettre via Socket.io (attaché sur req.app)
    req.app.get('io').emit('prospect:created', prospect);

    res.status(201).json(prospect);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création.' });
  } finally {
    client.release();
  }
});

// ── PUT /api/prospects/:id ──────────────────────────────────────────
router.put('/:id', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;

    // Récupérer l'ancien statut
    const old = await client.query('SELECT * FROM prospects WHERE id = $1', [id]);
    if (!old.rows.length) return res.status(404).json({ error: 'Prospect introuvable.' });
    const oldStatus = old.rows[0].status;

    const {
      company, sector, keyperson, poste, tel, email, location, size,
      status, source, priority, ca_potentiel, next_action, next_date,
      expected, obtained, comment, need
    } = req.body;

    const { rows } = await client.query(`
      UPDATE prospects SET
        company=$1, sector=$2, keyperson=$3, poste=$4, tel=$5, email=$6,
        location=$7, size=$8, status=$9, source=$10, priority=$11,
        ca_potentiel=$12, next_action=$13, next_date=$14,
        expected=$15, obtained=$16, comment=$17, need=$18
      WHERE id = $19
      RETURNING *
    `, [company, sector, keyperson, poste||null, tel||null, email||null,
        location, size||null, status||'Prospection', source||null, priority||'medium',
        ca_potentiel||0, next_action||null, next_date||null,
        expected||null, obtained||null, comment||null, need||null, id]);

    const prospect = rows[0];

    // Enregistrer changement de statut dans l'historique
    if (oldStatus !== status) {
      await client.query(`
        INSERT INTO prospect_history (prospect_id, status, comment, changed_by)
        VALUES ($1,$2,$3,$4)
      `, [id, status, comment || `Statut changé : ${oldStatus} → ${status}`, req.user.id]);

      // Notification email changement de statut
      getAllEmails(pool).then(emails => {
        notifyStatusChange(prospect, oldStatus, status, req.user.nom, comment, emails)
          .catch(console.error);
      });
    }

    await client.query('COMMIT');

    req.app.get('io').emit('prospect:updated', prospect);
    res.json(prospect);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  } finally {
    client.release();
  }
});

// ── DELETE /api/prospects/:id ───────────────────────────────────────
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query('DELETE FROM prospects WHERE id=$1 RETURNING id, track_id, company', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Prospect introuvable.' });
    req.app.get('io').emit('prospect:deleted', { id: parseInt(id) });
    res.json({ message: `${rows[0].company} supprimé.` });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

// ── GET /api/prospects/:id/history ─────────────────────────────────
router.get('/:id/history', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT ph.*, u.nom AS changed_by_name
    FROM prospect_history ph
    LEFT JOIN users u ON ph.changed_by = u.id
    WHERE ph.prospect_id = $1
    ORDER BY ph.changed_at DESC
  `, [req.params.id]);
  res.json(rows);
});

module.exports = router;
