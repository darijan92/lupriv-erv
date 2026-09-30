const express = require('express');
const pool = require('../db/pool');
const { authRequired, requireModeratorOrAdmin } = require('../middleware/auth');
const { nullsLastOrder } = require('../utils/sqlSort');

const router = express.Router();

router.get('/users', authRequired, requireModeratorOrAdmin, async (req, res) => {
  try {
    let branch;
    if (req.user.role_id >= 3 && req.query.branch_id) {
      const [b] = await pool.query('SELECT * FROM branches WHERE id=?', [req.query.branch_id]);
      branch = b[0];
    } else {
      // Branch the user leads, else their own branch — both looked up in parallel.
      const [[led], [own]] = await Promise.all([
        pool.query('SELECT * FROM branches WHERE voditelj_oj=?', [req.user.id]),
        pool.query(
          'SELECT b.* FROM users u JOIN branches b ON b.id=u.branch_id WHERE u.id=?',
          [req.user.id]
        ),
      ]);
      branch = led[0] || own[0];
    }
    if (!branch) return res.status(404).json({ error: 'Poslovnica voditelja nije pronađena' });
    const [users] = await pool.query(
      `SELECT id, sifra, username, ime, prezime, role_id, datum_odlaska, branch_id
       FROM users WHERE branch_id=? ORDER BY ${nullsLastOrder('prezime')}, ${nullsLastOrder('ime')}`,
      [branch.id]
    );
    res.json({ branch, users });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Greška' });
  }
});

module.exports = router;
