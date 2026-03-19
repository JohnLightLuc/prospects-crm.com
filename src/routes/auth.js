// src/routes/auth.js
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const pool    = require('../../config/database');
const { authMiddleware, adminOnly, superadminOnly } = require('../middleware/auth');

const router = express.Router();

// ── POST /api/auth/login ────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email et mot de passe requis.' });

  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND actif = true', [email]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Identifiants invalides.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Identifiants invalides.' });

    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const token = jwt.sign(
      { id: user.id, nom: user.nom, email: user.email, role: user.role, company_id: user.company_id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({
      token,
      user: { id: user.id, nom: user.nom, email: user.email, role: user.role, company_id: user.company_id }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── GET /api/auth/me ────────────────────────────────────────────────
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// ── GET /api/auth/users ─────────────────────────────────────────────
router.get('/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    let query, params;
    if (req.user.role === 'superadmin') {
      query  = 'SELECT id, nom, email, role, actif, company_id, created_at, last_login FROM users ORDER BY created_at';
      params = [];
    } else {
      query  = 'SELECT id, nom, email, role, actif, company_id, created_at, last_login FROM users WHERE company_id = $1 ORDER BY created_at';
      params = [req.user.company_id];
    }
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── POST /api/auth/users ────────────────────────────────────────────
router.post('/users', authMiddleware, adminOnly, async (req, res) => {
  const { nom, email, password, role, company_id } = req.body;
  if (!nom || !email || !password)
    return res.status(400).json({ error: 'Nom, email et mot de passe requis.' });

  let finalRole      = role || 'commercial';
  let finalCompanyId;

  if (req.user.role === 'admin') {
    if (finalRole === 'superadmin')
      return res.status(403).json({ error: 'Vous ne pouvez pas créer un super administrateur.' });
    finalCompanyId = req.user.company_id;
  } else {
    // superadmin
    if (finalRole !== 'superadmin' && !company_id)
      return res.status(400).json({ error: 'company_id requis pour les non-superadmin.' });
    finalCompanyId = finalRole === 'superadmin' ? null : parseInt(company_id);
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (nom, email, password, role, company_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, nom, email, role, company_id',
      [nom, email, hash, finalRole, finalCompanyId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── PUT /api/auth/password ──────────────────────────────────────────
router.put('/password', authMiddleware, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword)
    return res.status(400).json({ error: 'Ancien et nouveau mot de passe requis.' });

  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];
  const match = await bcrypt.compare(oldPassword, user.password);
  if (!match) return res.status(401).json({ error: 'Ancien mot de passe incorrect.' });

  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hash, req.user.id]);
  res.json({ message: 'Mot de passe mis à jour.' });
});

// ── PUT /api/auth/users/:id ─────────────────────────────────────────
router.put('/users/:id', authMiddleware, adminOnly, async (req, res) => {
  const { id } = req.params;
  const { nom, email, role, actif, password } = req.body;
  try {
    // Admin peut seulement modifier les users de sa société
    if (req.user.role === 'admin') {
      const check = await pool.query(
        'SELECT id FROM users WHERE id = $1 AND company_id = $2', [id, req.user.company_id]
      );
      if (!check.rows.length) return res.status(403).json({ error: 'Accès refusé.' });
    }

    const updates = [];
    const params  = [];
    let i = 1;
    if (nom      !== undefined) { updates.push(`nom=$${i++}`);    params.push(nom); }
    if (email    !== undefined) { updates.push(`email=$${i++}`);  params.push(email); }
    if (role     !== undefined) { updates.push(`role=$${i++}`);   params.push(role); }
    if (actif    !== undefined) { updates.push(`actif=$${i++}`);  params.push(actif); }
    if (password !== undefined && password !== '') {
      const hash = await bcrypt.hash(password, 10);
      updates.push(`password=$${i++}`);
      params.push(hash);
    }
    if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE users SET ${updates.join(',')} WHERE id=$${i} RETURNING id, nom, email, role, actif, company_id, created_at, last_login`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ══ ENDPOINTS ENTREPRISES (superadminOnly) ══════════════════════════

// ── GET /api/auth/companies ─────────────────────────────────────────
router.get('/companies', authMiddleware, superadminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*, COUNT(u.id) AS user_count
      FROM companies c
      LEFT JOIN users u ON u.company_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── POST /api/auth/companies ────────────────────────────────────────
router.post('/companies', authMiddleware, superadminOnly, async (req, res) => {
  const { name, slug } = req.body;
  if (!name || !slug)
    return res.status(400).json({ error: 'Nom et slug requis.' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO companies (name, slug) VALUES ($1,$2) RETURNING *',
      [name, slug.toLowerCase().replace(/\s+/g, '-')]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ce slug est déjà utilisé.' });
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── PUT /api/auth/companies/:id ─────────────────────────────────────
router.put('/companies/:id', authMiddleware, superadminOnly, async (req, res) => {
  const { id } = req.params;
  const { name, actif } = req.body;
  try {
    const updates = [], params = [];
    let i = 1;
    if (name  !== undefined) { updates.push(`name=$${i++}`);  params.push(name); }
    if (actif !== undefined) { updates.push(`actif=$${i++}`); params.push(actif); }
    if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE companies SET ${updates.join(',')} WHERE id=$${i} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Entreprise introuvable.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── POST /api/auth/companies/:id/admin ─────────────────────────────
router.post('/companies/:id/admin', authMiddleware, superadminOnly, async (req, res) => {
  const { id } = req.params;
  const { nom, email, password } = req.body;
  if (!nom || !email || !password)
    return res.status(400).json({ error: 'Nom, email et mot de passe requis.' });

  const comp = await pool.query('SELECT id FROM companies WHERE id = $1', [id]);
  if (!comp.rows.length) return res.status(404).json({ error: 'Entreprise introuvable.' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (nom, email, password, role, company_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, nom, email, role, company_id',
      [nom, email, hash, 'admin', id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
