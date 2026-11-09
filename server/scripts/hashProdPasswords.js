/**
 * One-shot / idempotent migration: hash plaintext (legacy prod) passwords with bcrypt.
 *
 * Usage (from repo root or server/):
 *   npm run hash-passwords
 *   node server/scripts/hashProdPasswords.js
 *
 * Uses the same DB config as the app (root .env then server/.env via pool).
 * Prints counts only — never plaintext passwords or usernames.
 */
const path = require('path');
const bcrypt = require('bcryptjs');

// Load env the same way as pool.js (root then server)
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const pool = require('../src/db/pool');

const BCRYPT_ROUNDS = 10;

function looksLikeBcrypt(value) {
  if (value == null) return false;
  const s = String(value);
  return s.startsWith('$2');
}

async function main() {
  let hashed = 0;
  let skipped = 0;
  let errors = 0;
  let emptySkipped = 0;

  const conn = await pool.getConnection();
  try {
    // A dump imported after the API's start-up migration lacks this column.
    const [[col]] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'must_change_password'`
    );
    if (Number(col.n) === 0) {
      await conn.query('ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0');
    }

    const [rows] = await conn.query(
      'SELECT id, password FROM users ORDER BY id ASC'
    );

    for (const row of rows) {
      const { id, password } = row;

      if (password == null || String(password).trim() === '') {
        // Do not invent a password for empty/null — skip and count
        emptySkipped += 1;
        skipped += 1;
        continue;
      }

      if (looksLikeBcrypt(password)) {
        skipped += 1;
        continue;
      }

      try {
        const plain = String(password);
        const hash = await bcrypt.hash(plain, BCRYPT_ROUNDS);
        const [result] = await conn.query(
          // Legacy plaintext passwords (often shared defaults) must be changed at next login.
          'UPDATE users SET password = ?, must_change_password = 1 WHERE id = ? AND (password NOT LIKE ? OR password IS NULL)',
          [hash, id, '$2%']
        );
        if (result.affectedRows === 1) {
          hashed += 1;
        } else {
          // Race / already updated
          skipped += 1;
        }
      } catch (e) {
        errors += 1;
        console.error(`Error hashing user id=${id}: ${e.message}`);
      }
    }

    console.log('hashProdPasswords results:');
    console.log(`  hashed:         ${hashed}`);
    console.log(`  skipped:        ${skipped} (already bcrypt or empty)`);
    console.log(`  empty/null:     ${emptySkipped}`);
    console.log(`  errors:         ${errors}`);
    console.log(`  total scanned:  ${rows.length}`);

    if (errors > 0) {
      process.exitCode = 1;
    }
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Fatal:', e.message || e);
  process.exit(1);
});
