const pool = require('../db/pool');
const { verifyToken } = require('../services/authService');

/** Routes a user with must_change_password may still call. */
const PASSWORD_CHANGE_ALLOWED = new Set(['/api/auth/me', '/api/auth/change-password']);

/**
 * Verify the JWT, then re-read the user so that leaving the company (datum_odlaska)
 * or a role/branch change takes effect immediately instead of when the token expires.
 */
async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Niste prijavljeni' });
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'Sesija istekla ili nevažeća' });
  }
  const [rows] = await pool.query(
    'SELECT id, username, ime, prezime, role_id, branch_id, datum_odlaska, must_change_password FROM users WHERE id=?',
    [payload.id]
  );
  const user = rows[0];
  if (!user || user.datum_odlaska) {
    return res.status(401).json({ error: 'Sesija istekla ili nevažeća' });
  }
  req.user = {
    id: user.id,
    username: user.username,
    ime: user.ime,
    prezime: user.prezime,
    role_id: Number(user.role_id),
    branch_id: user.branch_id,
    must_change_password: Boolean(user.must_change_password),
  };
  if (req.user.must_change_password && !PASSWORD_CHANGE_ALLOWED.has(req.baseUrl + req.path)) {
    return res.status(403).json({ error: 'Morate promijeniti lozinku', code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  next();
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
