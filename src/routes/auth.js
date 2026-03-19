// src/routes/auth.js
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const pool    = require('../../config/database');
const { authMiddleware, adminOnly } = require('../middleware/auth');

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
      { id: user.id, nom: user.nom, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({
      token,
      user: { id: user.id, nom: user.nom, email: user.email, role: user.role }
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

// ── GET /api/auth/users (admin) ─────────────────────────────────────
router.get('/users', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, nom, email, role, actif, created_at, last_login FROM users ORDER BY created_at'
  );
  res.json(rows);
});

// ── POST /api/auth/users (admin crée un utilisateur) ────────────────
router.post('/users', authMiddleware, adminOnly, async (req, res) => {
  const { nom, email, password, role } = req.body;
  if (!nom || !email || !password)
    return res.status(400).json({ error: 'Nom, email et mot de passe requis.' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (nom, email, password, role) VALUES ($1,$2,$3,$4) RETURNING id, nom, email, role',
      [nom, email, hash, role || 'commercial']
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

// ── PUT /api/auth/users/:id (admin modifie un utilisateur) ──────────
router.put('/users/:id', authMiddleware, adminOnly, async (req, res) => {
  const { id } = req.params;
  const { nom, email, role, actif, password } = req.body;
  try {
    // Construire la requête dynamiquement selon les champs fournis
    const updates = [];
    const params  = [];
    let i = 1;
    if (nom      !== undefined) { updates.push(`nom=$${i++}`);    params.push(nom); }
    if (email    !== undefined) { updates.push(`email=$${i++}`);  params.push(email); }
    if (role     !== undefined) { updates.push(`role=$${i++}`);   params.push(role); }
    if (actif    !== undefined) { updates.push(`actif=$${i++}`);  params.push(actif); }
    if (password !== undefined && password !== '') {
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash(password, 10);
      updates.push(`password=$${i++}`);
      params.push(hash);
    }
    if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE users SET ${updates.join(',')} WHERE id=$${i} RETURNING id, nom, email, role, actif, created_at, last_login`,
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

module.exports = router;
