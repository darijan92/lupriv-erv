const express = require('express');
const pool = require('../db/pool');
const { authRequired } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { z } = require('zod');
const { authenticate, signUser, publicUser } = require('../services/authService');
const { startWork } = require('../services/hoursService');
const { clientIp, todayDate } = require('../utils/time');
const { nullsLastOrder } = require('../utils/sqlSort');

const router = express.Router();

const loginSchema = z.object({
  username: z.string().min(1, 'Unesite korisničko ime'),
  password: z.string().min(1, 'Unesite lozinku'),
  branch_id: z.coerce.number().int().positive().optional().nullable(),
  start_work: z.boolean().optional(),
});

router.post('/login', validate({ body: loginSchema }), async (req, res) => {
  try {
    const { username, password, branch_id, start_work } = req.body;
    const auth = await authenticate(username, password);
    if (auth.error) return res.status(auth.status).json({ error: auth.error });
    const { user } = auth;

    // Admin logins never start radno vrijeme, regardless of the checkbox.
    // Keep this guard before the start_work branch so the server remains authoritative.
    const isAdmin = Number(user.role_id) >= 3;
    if (isAdmin) {
      return res.json({
        token: signUser(user),
        user: publicUser(user),
        redirect: '/admin',
      });
    }

    if (start_work && branch_id) {
      const [branches] = await pool.query('SELECT * FROM branches WHERE id=?', [branch_id]);
      const branch = branches[0];
      if (!branch) return res.status(400).json({ error: 'Poslovnica nije pronađena' });

      const ip = clientIp(req);
      if (branch.ip && branch.ip !== ip) {
        await pool.query(
          `INSERT INTO logs (datum, user_id, branch_id, hour_id, content) VALUES (NOW(), ?, ?, NULL, ?)`,
          [user.id, branch.id, `Korisnik <b>${user.ime} ${user.prezime}</b> je promijenio IP adresu OJ <b>${branch.naziv_oj}</b>.`]
        );
      }
      await pool.query('UPDATE branches SET ip=? WHERE id=?', [ip, branch.id]);

      const [active] = await pool.query('SELECT id FROM hours WHERE user_id=? AND temp IS NOT NULL', [user.id]);
      if (active.length) {
        return res.json({
          token: signUser(user),
          user: publicUser(user),
          warning: 'Korisnik je već prijavljen',
          redirect: user.role_id === 2 ? '/moderator' : `/employee/${user.id}`,
        });
      }

      await startWork(user.id, branch.id, todayDate());
      return res.json({
        token: signUser(user),
        user: publicUser(user),
        success: 'Uspješno započeto radno vrijeme',
        redirect: user.role_id === 2 ? '/moderator' : `/employee/${user.id}`,
      });
    }

    return res.json({
      token: signUser(user),
      user: publicUser(user),
      redirect: user.role_id === 2 ? '/moderator' : `/employee/${user.id}`,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Greška na serveru' });
  }
});

router.get('/me', authRequired, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, username, ime, prezime, branch_id, role_id, sifra, datum_rodjenja, datum_zaposlenja, datum_odlaska
     FROM users WHERE id=?`,
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Korisnik nije pronađen' });
  res.json({ user: rows[0] });
});

router.get('/branches-public', async (_req, res) => {
  const [rows] = await pool.query(`SELECT id, sifra, naziv_oj, grad FROM branches ORDER BY ${nullsLastOrder('naziv_oj')}`);
  res.json({ branches: rows });
});

module.exports = router;
