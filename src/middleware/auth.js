// src/middleware/auth.js
const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'Token manquant. Veuillez vous connecter.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token invalide ou expiré. Reconnectez-vous.' });
  }
}

function adminOnly(req, res, next) {
  if (!['admin', 'superadmin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  }
  next();
}

function superadminOnly(req, res, next) {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Accès réservé au super administrateur.' });
  }
  next();
}

/**
 * Retourne un fragment WHERE/AND pour scoper par company.
 * - superadmin → clause vide, aucun param
 * - autres      → clause `alias.company_id = $N`
 *
 * @param {object} user      req.user
 * @param {string} alias     alias de table (ex: 'p', 'prospects', '')
 * @param {number} startIdx  prochain indice de paramètre ($N)
 * @returns {{ clause: string, params: any[], nextIndex: number }}
 */
function companyScope(user, alias, startIdx) {
  if (user.role === 'superadmin') {
    return { clause: '', params: [], nextIndex: startIdx };
  }
  const col = alias ? `${alias}.company_id` : 'company_id';
  return {
    clause:    `${col} = $${startIdx}`,
    params:    [user.company_id],
    nextIndex: startIdx + 1,
  };
}

module.exports = { authMiddleware, adminOnly, superadminOnly, companyScope };
