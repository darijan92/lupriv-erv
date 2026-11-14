const express = require('express');
const pool = require('../db/pool');
const { authRequired, requireAdmin } = require('../middleware/auth');
const { nullsLastOrder } = require('../utils/sqlSort');
const { validate } = require('../middleware/validate');
const { z } = require('zod');

const postSchema = z.object({
  naslov: z.string().trim().min(1, 'Naslov i sadržaj su obavezni').max(100),
  sadrzaj: z.string().trim().min(1, 'Naslov i sadržaj su obavezni').max(60000),
});
const idParams = z.object({ id: z.coerce.number().int().positive() });

const router = express.Router();

router.get('/', authRequired, async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT p.*, u.ime, u.prezime FROM posts p
     LEFT JOIN users u ON u.id=p.user_id ORDER BY ${nullsLastOrder('p.created_at', 'p.created_at', 'DESC')}`
  );
  res.json({ posts: rows });
});

router.post('/', authRequired, requireAdmin, validate({ body: postSchema }), async (req, res) => {
  const { naslov, sadrzaj } = req.body;
  const [r] = await pool.query(
    'INSERT INTO posts (naslov, sadrzaj, user_id) VALUES (?,?,?)',
    [naslov, sadrzaj, req.user.id]
  );
  res.status(201).json({ id: r.insertId, success: 'Objava kreirana' });
});

router.put('/:id', authRequired, requireAdmin, validate({ params: idParams, body: postSchema }), async (req, res) => {
  const { naslov, sadrzaj } = req.body;
  await pool.query('UPDATE posts SET naslov=?, sadrzaj=? WHERE id=?', [naslov, sadrzaj, req.params.id]);
  res.json({ success: 'Objava ažurirana' });
});

router.delete('/:id', authRequired, requireAdmin, validate({ params: idParams }), async (req, res) => {
  await pool.query('DELETE FROM posts WHERE id=?', [req.params.id]);
  res.json({ success: 'Objava obrisana' });
});

module.exports = router;
