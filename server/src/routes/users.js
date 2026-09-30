const express = require('express');
const pool = require('../db/pool');
const { authRequired, requireAdmin } = require('../middleware/auth');
const { hashPassword } = require('../services/authService');
const { buildOrderBy, nullsLastOrder, likePattern, parseOrder } = require('../utils/sqlSort');
const { canViewUser } = require('../utils/access');

const router = express.Router();

router.use(authRequired);

const SORT_FIELDS = {
  // Keep empty values last while retaining numeric sorting for sifra.
  sifra: [{ nullCheck: 'u.sifra', expression: 'CAST(u.sifra AS UNSIGNED)' }],
  ime: [{ expression: 'u.ime' }, { expression: 'u.prezime' }],
  // Short OJ: last token; numerics as numbers first, then non-numeric strings; empties last.
  oj: [{ shortOj: 'b.naziv_oj' }],
  sifra_oj: [{ nullCheck: 'b.sifra', expression: 'CAST(b.sifra AS UNSIGNED)' }],
};

router.get('/', requireAdmin, async (req, res) => {
  const includeInactive =
    req.query.includeInactive === '1' ||
    req.query.includeInactive === 'true';

  const sortKey = SORT_FIELDS[req.query.sort] ? req.query.sort : 'oj';
  const orderBy = buildOrderBy(SORT_FIELDS[sortKey], parseOrder(req.query.order));

  const conditions = [];
  const params = [];

  if (!includeInactive) {
    conditions.push('u.datum_odlaska IS NULL');
  }

  const q = String(req.query.q || '').trim();
  if (q) {
    const p = likePattern(q);
    conditions.push(
      '(u.sifra LIKE ? OR u.ime LIKE ? OR u.prezime LIKE ? OR u.username LIKE ?)'
    );
    params.push(p, p, p, p);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT u.id, u.sifra, u.username, u.ime, u.prezime, u.branch_id, u.role_id,
            u.datum_rodjenja, u.datum_zaposlenja, u.datum_odlaska,
            b.naziv_oj, b.sifra AS sifra_oj, r.naziv AS role_name
     FROM users u
     LEFT JOIN branches b ON b.id=u.branch_id
     LEFT JOIN roles r ON r.id=u.role_id
     ${where}
     ORDER BY ${orderBy}`,
    params
  );
  res.json({ users: rows });
});

router.get('/roles', requireAdmin, async (_req, res) => {
  const [roles] = await pool.query(`SELECT * FROM roles ORDER BY ${nullsLastOrder('id')}`);
  res.json({ roles });
});

// authRequired already applied via router.use above.
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!canViewUser(req.user, id)) {
    return res.status(403).json({ error: 'Nemate ovlasti' });
  }
  const [rows] = await pool.query(
    `SELECT u.id, u.sifra, u.username, u.ime, u.prezime, u.branch_id, u.role_id,
            u.datum_rodjenja, u.datum_zaposlenja, u.datum_odlaska, b.naziv_oj
     FROM users u LEFT JOIN branches b ON b.id=u.branch_id WHERE u.id=?`,
    [id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Nije pronađen' });
  res.json({ user: rows[0] });
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.username || !b.password || !b.ime || !b.prezime || !b.sifra) {
      return res.status(400).json({ error: 'Obavezna polja: sifra, username, password, ime, prezime' });
    }
    const hash = await hashPassword(b.password);
    const [r] = await pool.query(
      `INSERT INTO users (sifra, username, password, ime, prezime, branch_id, datum_rodjenja, datum_zaposlenja, datum_odlaska, role_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        b.sifra, b.username, hash, b.ime, b.prezime,
        b.branch_id || null, b.datum_rodjenja || null, b.datum_zaposlenja || null,
        b.datum_odlaska || null, b.role_id || 1,
      ]
    );
    res.status(201).json({ id: r.insertId, success: 'Korisnik kreiran' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Korisničko ime ili šifra već postoji' });
    console.error(e);
    res.status(500).json({ error: 'Greška' });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    const fields = [];
    const vals = [];
    for (const key of ['sifra', 'username', 'ime', 'prezime', 'branch_id', 'datum_rodjenja', 'datum_zaposlenja', 'datum_odlaska', 'role_id']) {
      if (b[key] !== undefined) {
        fields.push(`${key}=?`);
        vals.push(b[key] === '' ? null : b[key]);
      }
    }
    if (b.password) {
      fields.push('password=?');
      vals.push(await hashPassword(b.password));
    }
    if (!fields.length) return res.status(400).json({ error: 'Nema podataka' });
    vals.push(id);
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id=?`, vals);
    res.json({ success: 'Korisnik ažuriran' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Duplikat šifre/korisničkog imena' });
    console.error(e);
    res.status(500).json({ error: 'Greška' });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM users WHERE id=?', [req.params.id]);
  res.json({ success: 'Korisnik obrisan' });
});

module.exports = router;
