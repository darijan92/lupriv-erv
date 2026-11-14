const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const rateLimit = require('../middleware/rateLimit');

let jwtSecret = null;

/** Resolved on first use (after dotenv has loaded) and cached, so the fallback warning logs once. */
function getJwtSecret() {
  if (jwtSecret) return jwtSecret;
  jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET nije postavljen');
    }
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
    `SELECT id, username, password, ime, prezime, branch_id, role_id, datum_odlaska, must_change_password
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
const INVALID_CREDENTIALS = 'Pogrešno korisničko ime ili lozinka';
// Compared against when the username does not exist, so response time does not reveal it.
const DUMMY_HASH = bcrypt.hashSync('lupriv-timing-guard', 10);

/**
 * Username/password check shared by login and kiosk.
 * One generic message for unknown user / wrong password (no username enumeration);
 * the "no longer employed" message is only shown after a correct password.
 */
async function authenticate(username, password) {
  const user = await findUserByUsername(username);
  if (!user) {
    await bcrypt.compare(String(password || ''), DUMMY_HASH);
    return { status: 401, error: INVALID_CREDENTIALS };
  }
  const ok = await verifyPassword(password, user.password);
  if (!ok) return { status: 401, error: INVALID_CREDENTIALS };
  if (user.datum_odlaska) return { status: 403, error: 'Korisnik nije više u radnom odnosu' };
  return { user };
}

/**
 * authenticate() wrapped in the brute-force limiter.
 * @returns same shape as authenticate(), plus status 429 when limited
 */
async function authenticateLimited(ip, username, password) {
  const wait = rateLimit.retryAfter(ip, username);
  if (wait > 0) {
    return {
      status: 429,
      error: `Previše neuspjelih pokušaja. Pokušajte ponovno za ${Math.ceil(wait / 60)} min.`,
      retryAfter: wait,
    };
  }
  const result = await authenticate(username, password);
  if (result.status === 401) rateLimit.recordFailure(ip, username);
  else if (result.user) rateLimit.recordSuccess(ip, username);
  return result;
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
    must_change_password: Boolean(user.must_change_password),
  };
}

module.exports = {
  getJwtSecret,
  signUser,
  verifyToken,
  findUserByUsername,
  verifyPassword,
  authenticate,
  authenticateLimited,
  INVALID_CREDENTIALS,
  hashPassword,
  publicUser,
};
