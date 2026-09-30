const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

let jwtSecret = null;

/** Resolved on first use (after dotenv has loaded) and cached, so the fallback warning logs once. */
function getJwtSecret() {
  if (jwtSecret) return jwtSecret;
  jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.warn('JWT_SECRET missing — using insecure dev fallback');
    jwtSecret = 'lupriv_dev_secret_change_me';
  }
  return jwtSecret;
}

function signUser(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role_id: user.role_id,
      branch_id: user.branch_id,
      ime: user.ime,
      prezime: user.prezime,
    },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

async function findUserByUsername(username) {
  const [rows] = await pool.query(
    `SELECT id, username, password, ime, prezime, branch_id, role_id, datum_odlaska
     FROM users WHERE username = ? LIMIT 1`,
    [username]
  );
  return rows[0] || null;
}

async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  // Reject accidental plain-text legacy hashes (no bcrypt prefix)
  if (!String(hash).startsWith('$2')) return false;
  return bcrypt.compare(plain, hash);
}

/**
 * Username/password check shared by login and kiosk.
 * @returns {Promise<{ user: object } | { status: number, error: string }>}
 */
async function authenticate(username, password) {
  const user = await findUserByUsername(username);
  if (!user) return { status: 401, error: 'Ne postoji korisnik sa unesenim korisničkim imenom' };
  if (user.datum_odlaska) return { status: 403, error: 'Korisnik nije više u radnom odnosu' };
  const ok = await verifyPassword(password, user.password);
  if (!ok) return { status: 401, error: 'Pogrešna lozinka' };
  return { user };
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    ime: user.ime,
    prezime: user.prezime,
    role_id: user.role_id,
    branch_id: user.branch_id,
  };
}

module.exports = {
  getJwtSecret,
  signUser,
  verifyToken,
  findUserByUsername,
  verifyPassword,
  authenticate,
  hashPassword,
  publicUser,
};
