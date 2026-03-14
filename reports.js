// src/routes/reports.js
const express = require('express');
const pool    = require('../../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/reports/kpis ───────────────────────────────────────────
router.get('/kpis', authMiddleware, async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const startOfWeek  = new Date(now - 7*24*60*60*1000).toISOString();

    const [total, monthly, weekly, byStatus, bySource, bySector, closingCA] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM prospects'),
      pool.query('SELECT COUNT(*) FROM prospects WHERE created_at >= $1', [startOfMonth]),
      pool.query('SELECT COUNT(*) FROM prospects WHERE updated_at >= $1', [startOfWeek]),
      pool.query('SELECT status, COUNT(*) FROM prospects GROUP BY status'),
      pool.query('SELECT source, COUNT(*) FROM prospects WHERE source IS NOT NULL GROUP BY source ORDER BY COUNT DESC LIMIT 8'),
      pool.query('SELECT sector, COUNT(*) FROM prospects GROUP BY sector ORDER BY COUNT DESC LIMIT 10'),
      pool.query("SELECT SUM(ca_potentiel) AS total_ca FROM prospects WHERE status = 'Closing'"),
    ]);

    res.json({
      total:        parseInt(total.rows[0].count),
      monthly:      parseInt(monthly.rows[0].count),
      weekly:       parseInt(weekly.rows[0].count),
      byStatus:     byStatus.rows,
      bySource:     bySource.rows,
      bySector:     bySector.rows,
      closingCA:    parseFloat(closingCA.rows[0].total_ca) || 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur rapport KPIs.' });
  }
});

// ── GET /api/reports/hebdo ──────────────────────────────────────────
router.get('/hebdo', authMiddleware, async (req, res) => {
  try {
    const since = new Date(Date.now() - 7*24*60*60*1000).toISOString();
    const { rows: prospects } = await pool.query(`
      SELECT p.*, u.nom AS created_by_name
      FROM prospects p LEFT JOIN users u ON p.created_by = u.id
      WHERE p.updated_at >= $1 ORDER BY p.updated_at DESC
    `, [since]);

    const { rows: history } = await pool.query(`
      SELECT ph.*, u.nom AS changed_by_name, p.company, p.track_id
      FROM prospect_history ph
      LEFT JOIN users u ON ph.changed_by = u.id
      LEFT JOIN prospects p ON ph.prospect_id = p.id
      WHERE ph.changed_at >= $1 ORDER BY ph.changed_at DESC
    `, [since]);

    res.json({ prospects, history, period: '7 derniers jours' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur rapport hebdo.' });
  }
});

// ── GET /api/reports/mensuel ────────────────────────────────────────
router.get('/mensuel', authMiddleware, async (req, res) => {
  try {
    const now   = new Date();
    const mois  = parseInt(req.query.mois)  || now.getMonth() + 1;
    const annee = parseInt(req.query.annee) || now.getFullYear();
    const start = new Date(annee, mois-1, 1).toISOString();
    const end   = new Date(annee, mois, 1).toISOString();

    const { rows: prospects } = await pool.query(`
      SELECT p.*, u.nom AS created_by_name
      FROM prospects p LEFT JOIN users u ON p.created_by = u.id
      WHERE p.updated_at >= $1 AND p.updated_at < $2
      ORDER BY p.updated_at DESC
    `, [start, end]);

    const { rows: history } = await pool.query(`
      SELECT ph.*, u.nom AS changed_by_name, p.company, p.track_id
      FROM prospect_history ph
      LEFT JOIN users u ON ph.changed_by = u.id
      LEFT JOIN prospects p ON ph.prospect_id = p.id
      WHERE ph.changed_at >= $1 AND ph.changed_at < $2
      ORDER BY ph.changed_at DESC
    `, [start, end]);

    res.json({ prospects, history, period: `${mois}/${annee}` });
  } catch (err) {
    res.status(500).json({ error: 'Erreur rapport mensuel.' });
  }
});

// ── GET /api/objectifs ──────────────────────────────────────────────
router.get('/objectifs', authMiddleware, async (req, res) => {
  const now   = new Date();
  const mois  = parseInt(req.query.mois)  || now.getMonth() + 1;
  const annee = parseInt(req.query.annee) || now.getFullYear();
  const { rows } = await pool.query(
    'SELECT * FROM objectifs WHERE user_id = $1 AND mois = $2 AND annee = $3',
    [req.user.id, mois, annee]
  );
  res.json(rows[0] || { obj_prospection: 30, obj_closing: 5, obj_ca: 5000000 });
});

// ── PUT /api/objectifs ──────────────────────────────────────────────
router.put('/objectifs', authMiddleware, async (req, res) => {
  const now = new Date();
  const { obj_prospection, obj_closing, obj_ca, mois, annee } = req.body;
  const m = mois  || now.getMonth() + 1;
  const a = annee || now.getFullYear();

  const { rows } = await pool.query(`
    INSERT INTO objectifs (user_id, mois, annee, obj_prospection, obj_closing, obj_ca)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (user_id, mois, annee) DO UPDATE SET
      obj_prospection=$4, obj_closing=$5, obj_ca=$6
    RETURNING *
  `, [req.user.id, m, a, obj_prospection||30, obj_closing||5, obj_ca||5000000]);

  req.app.get('io').emit('objectifs:updated', rows[0]);
  res.json(rows[0]);
});

module.exports = router;
