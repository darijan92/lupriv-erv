const express = require('express');
const pool = require('../db/pool');
const { authRequired, requireAdmin } = require('../middleware/auth');
const { buildOrderBy, likePattern, parseOrder } = require('../utils/sqlSort');
const { validate } = require('../middleware/validate');
const { isAdmin } = require('../utils/access');
const { z } = require('zod');

const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Vrijeme mora biti HH:mm');
const branchSchema = z.object({
  sifra: z.coerce.string().trim().min(1, 'Šifra je obavezna').max(191),
  naziv_oj: z.string().trim().min(1, 'Naziv je obavezan').max(25),
  adresa: z.string().max(50).optional().nullable(),
  grad: z.string().trim().min(1, 'Grad je obavezan').max(30),
  zupanija: z.string().trim().min(1, 'Županija je obavezna').max(50),
  pocetak_rv: hm,
  kraj_rv: hm,
  rad_nedjeljom: z.union([z.boolean(), z.coerce.number()]).optional(),
  voditelj_oj: z.union([z.coerce.number().int().positive(), z.literal(''), z.null()]).optional(),
  ip: z.string().max(30).optional().nullable(),
});
const idParams = z.object({ id: z.coerce.number().int().positive() });

/** Branch IPs are only for admins. */
function forViewer(req, branch) {
  if (isAdmin(req.user)) return branch;
  const { ip: _ip, ...rest } = branch;
  return rest;
}

const router = express.Router();

const SORT_FIELDS = {
  // Numeric sifra values first (as numbers), then strings; empty values last.
  sifra: [{ numericThenString: 'b.sifra' }],
  // Branches display the full OJ name, so sort name columns by that full value.
  ime: [{ expression: 'b.naziv_oj' }],
  oj: [{ expression: 'b.naziv_oj' }],
  naziv: [{ expression: 'b.naziv_oj' }],
  grad: [{ expression: 'b.grad' }],
};

router.get('/', authRequired, async (req, res) => {
  const sortKey = SORT_FIELDS[req.query.sort] ? req.query.sort : 'sifra';
  const orderBy = buildOrderBy(SORT_FIELDS[sortKey], parseOrder(req.query.order));

  const conditions = [];
  const params = [];

  const q = String(req.query.q || '').trim();
  if (q) {
    const p = likePattern(q);
    conditions.push('(b.sifra LIKE ? OR b.naziv_oj LIKE ? OR b.grad LIKE ?)');
    params.push(p, p, p);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT b.*, u.ime AS voditelj_ime, u.prezime AS voditelj_prezime
     FROM branches b
     LEFT JOIN users u ON u.id=b.voditelj_oj
     ${where}
     ORDER BY ${orderBy}`,
    params
  );
  res.json({ branches: rows.map((b) => forViewer(req, b)) });
});

router.get('/:id', authRequired, validate({ params: idParams }), async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM branches WHERE id=?', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Nije pronađena' });
  res.json({ branch: forViewer(req, rows[0]) });
});

router.post('/', authRequired, requireAdmin, validate({ body: branchSchema }), async (req, res) => {
  try {
    const b = req.body;
    const [r] = await pool.query(
      `INSERT INTO branches (sifra, naziv_oj, adresa, grad, zupanija, pocetak_rv, kraj_rv, rad_nedjeljom, voditelj_oj, ip)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        b.sifra,
        b.naziv_oj,
        b.adresa || null,
        b.grad,
        b.zupanija,
        b.pocetak_rv,
        b.kraj_rv,
        b.rad_nedjeljom ? 1 : 0,
        b.voditelj_oj || null,
        b.ip || null,
      ]
    );
    res.status(201).json({ id: r.insertId, success: 'Poslovnica kreirana' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(400).json({ error: 'Šifra ili voditelj već postoji' });
    console.error(e);
    res.status(500).json({ error: 'Greška' });
  }
});

router.put('/:id', authRequired, requireAdmin, validate({ params: idParams, body: branchSchema }), async (req, res) => {
  try {
    const b = req.body;
    await pool.query(
      `UPDATE branches SET sifra=?, naziv_oj=?, adresa=?, grad=?, zupanija=?, pocetak_rv=?, kraj_rv=?,
       rad_nedjeljom=?, voditelj_oj=?, ip=? WHERE id=?`,
      [
        b.sifra,
        b.naziv_oj,
        b.adresa || null,
        b.grad,
        b.zupanija,
        b.pocetak_rv,
        b.kraj_rv,
        b.rad_nedjeljom ? 1 : 0,
        b.voditelj_oj || null,
        b.ip || null,
        req.params.id,
      ]
    );
    res.json({ success: 'Poslovnica ažurirana' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Duplikat' });
    console.error(e);
    res.status(500).json({ error: 'Greška' });
  }
});

router.delete('/:id', authRequired, requireAdmin, validate({ params: idParams }), async (req, res) => {
  // Attendance history must survive: refuse while hours reference the branch.
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM hours WHERE branch_id=?', [req.params.id]);
  if (Number(n) > 0) {
    return res.status(409).json({
      error: 'Poslovnica ima evidenciju sati i ne može se obrisati.',
    });
  }
  await pool.query('DELETE FROM branches WHERE id=?', [req.params.id]);
  res.json({ success: 'Poslovnica obrisana' });
});

module.exports = router;
