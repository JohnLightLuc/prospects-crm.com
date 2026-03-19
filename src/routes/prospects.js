// src/routes/prospects.js
const express = require('express');
const pool    = require('../../config/database');
const { authMiddleware, companyScope } = require('../middleware/auth');
const { notifyNewProspect, notifyStatusChange } = require('../services/emailService');

const router = express.Router();

// Génère le track_id automatique : PRO-XXXX
async function generateTrackId(client) {
  const { rows } = await client.query("SELECT nextval('track_id_seq') AS val");
  return 'PRO-' + String(rows[0].val).padStart(4, '0');
}

// Récupère les emails actifs de la société pour notifications
async function getCompanyEmails(pool, companyId) {
  const { rows } = await pool.query(
    'SELECT email FROM users WHERE actif = true AND company_id = $1', [companyId]
  );
  return rows.map(r => r.email);
}

// ── GET /api/prospects ──────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { status, sector, source, priority, q } = req.query;
    let where = [], params = [];
    let i = 1;

    const scope = companyScope(req.user, 'p', i);
    if (scope.clause) { where.push(scope.clause); params.push(...scope.params); }
    i = scope.nextIndex;

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
  if (req.user.role === 'superadmin')
    return res.status(403).json({ error: 'Le super administrateur ne peut pas créer de prospects.' });

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

    const trackId   = await generateTrackId(client);
    const companyId = req.user.company_id;

    const { rows } = await client.query(`
      INSERT INTO prospects
        (track_id, company, sector, keyperson, poste, tel, email, location, size,
         status, source, priority, ca_potentiel, next_action, next_date,
         expected, obtained, comment, need, company_id, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      RETURNING *
    `, [trackId, company, sector, keyperson, poste||null, tel||null, email||null,
        location, size||null, status||'Prospection', source||null, priority||'medium',
        ca_potentiel||0, next_action||null, next_date||null,
        expected||null, obtained||null, comment||null, need||null,
        companyId, req.user.id]);

    const prospect = rows[0];

    await client.query(`
      INSERT INTO prospect_history (prospect_id, status, comment, changed_by)
      VALUES ($1,$2,$3,$4)
    `, [prospect.id, prospect.status, comment || 'Prospect créé', req.user.id]);

    await client.query('COMMIT');

    // Notification email asynchrone (société uniquement)
    getCompanyEmails(pool, companyId).then(emails => {
      notifyNewProspect(prospect, req.user.nom, emails).catch(console.error);
    });

    // Socket.io — room de la société
    const io   = req.app.get('io');
    const room = `company:${companyId}`;
    io.to(room).emit('prospect:created', prospect);

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

    // Vérifier existence + appartenance société
    let old;
    if (req.user.role === 'superadmin') {
      old = await client.query('SELECT * FROM prospects WHERE id = $1', [id]);
    } else {
      old = await client.query(
        'SELECT * FROM prospects WHERE id = $1 AND company_id = $2',
        [id, req.user.company_id]
      );
    }
    if (!old.rows.length) return res.status(404).json({ error: 'Prospect introuvable.' });
    const oldStatus = old.rows[0].status;
    const companyId = old.rows[0].company_id;

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

    if (oldStatus !== status) {
      await client.query(`
        INSERT INTO prospect_history (prospect_id, status, comment, changed_by)
        VALUES ($1,$2,$3,$4)
      `, [id, status, comment || `Statut changé : ${oldStatus} → ${status}`, req.user.id]);

      getCompanyEmails(pool, companyId).then(emails => {
        notifyStatusChange(prospect, oldStatus, status, req.user.nom, comment, emails)
          .catch(console.error);
      });
    }

    await client.query('COMMIT');

    const io   = req.app.get('io');
    const room = `company:${companyId}`;
    io.to(room).emit('prospect:updated', prospect);
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
    let result;
    if (req.user.role === 'superadmin') {
      result = await pool.query(
        'DELETE FROM prospects WHERE id=$1 RETURNING id, track_id, company, company_id', [id]
      );
    } else {
      result = await pool.query(
        'DELETE FROM prospects WHERE id=$1 AND company_id=$2 RETURNING id, track_id, company, company_id',
        [id, req.user.company_id]
      );
    }
    if (!result.rows.length) return res.status(404).json({ error: 'Prospect introuvable.' });
    const companyId = result.rows[0].company_id;
    const io   = req.app.get('io');
    const room = `company:${companyId}`;
    io.to(room).emit('prospect:deleted', { id: parseInt(id) });
    res.json({ message: `${result.rows[0].company} supprimé.` });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

// ── GET /api/prospects/:id/history ─────────────────────────────────
router.get('/:id/history', authMiddleware, async (req, res) => {
  try {
    let query, params;
    if (req.user.role === 'superadmin') {
      query = `
        SELECT ph.*, u.nom AS changed_by_name
        FROM prospect_history ph
        LEFT JOIN users u ON ph.changed_by = u.id
        WHERE ph.prospect_id = $1
        ORDER BY ph.changed_at DESC
      `;
      params = [req.params.id];
    } else {
      query = `
        SELECT ph.*, u.nom AS changed_by_name
        FROM prospect_history ph
        LEFT JOIN users u ON ph.changed_by = u.id
        JOIN prospects p ON ph.prospect_id = p.id
        WHERE ph.prospect_id = $1 AND p.company_id = $2
        ORDER BY ph.changed_at DESC
      `;
      params = [req.params.id, req.user.company_id];
    }
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur historique.' });
  }
});

module.exports = router;
