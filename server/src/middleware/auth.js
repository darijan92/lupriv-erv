const { verifyToken } = require('../services/authService');

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Niste prijavljeni' });
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Sesija istekla ili nevažeća' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role_id < 3) {
    return res.status(403).json({ error: 'Samo administrator' });
  }
  next();
}

function requireModeratorOrAdmin(req, res, next) {
  if (!req.user || (req.user.role_id !== 2 && req.user.role_id < 3)) {
    return res.status(403).json({ error: 'Samo voditelj ili administrator' });
  }
  next();
}

module.exports = { authRequired, requireAdmin, requireModeratorOrAdmin };
