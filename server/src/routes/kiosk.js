const express = require('express');
const { authenticate } = require('../services/authService');
const { startWork } = require('../services/hoursService');
const pool = require('../db/pool');
const { clientIp, nowTime, todayDate, appendPeriod } = require('../utils/time');
const { nullsLastOrder } = require('../utils/sqlSort');

const router = express.Router();

/**
 * Resolve kiosk branch:
 * 1) Explicit branchId from query/body (localStorage / client selection) — always allowed
 * 2) IP match on branches.ip (legacy fallback)
 * KIOSK_ALLOW_BRANCH_QUERY is kept for docs/compat; explicit id is preferred regardless.
 */
async function resolveBranch(req, explicitId) {
  const id = explicitId || req.query.branchId || req.body?.branch_id || req.body?.branchId;
  if (id) {
    const [rows] = await pool.query('SELECT * FROM branches WHERE id=?', [id]);
    if (rows[0]) return rows[0];
  }
  const ip = clientIp(req);
  const [rows] = await pool.query(
    `SELECT * FROM branches WHERE ip=? ORDER BY ${nullsLastOrder('updated_at', 'updated_at', 'DESC')} LIMIT 1`,
    [ip]
  );
  return rows[0] || null;
}

router.get('/', async (req, res) => {
  try {
    const branch = await resolveBranch(req);
    if (!branch) {
      return res.status(404).json({
        error: 'Poslovnica nije odabrana. Odaberite poslovnicu ispod.',
        needsLogin: true,
        needsBranch: true,
        clientIp: clientIp(req),
      });
    }
    const [[posts], [active]] = await Promise.all([
      pool.query(
        `SELECT p.id, p.naslov, p.sadrzaj, p.created_at, u.ime, u.prezime
         FROM posts p LEFT JOIN users u ON u.id=p.user_id
         ORDER BY ${nullsLastOrder('p.created_at', 'p.created_at', 'DESC')} LIMIT 5`
      ),
      pool.query(
        `SELECT h.id, h.temp, h.user_id, u.ime, u.prezime, u.username
         FROM hours h JOIN users u ON u.id=h.user_id
         WHERE h.datum=? AND h.branch_id=? AND h.temp IS NOT NULL
         ORDER BY ${nullsLastOrder('h.temp')}`,
        [todayDate(), branch.id]
      ),
    ]);
    res.json({
      branch: { id: branch.id, naziv_oj: branch.naziv_oj, sifra: branch.sifra },
      posts,
      activeHours: active.map((h) => ({
        ...h,
        imePrezime: `${h.ime} ${h.prezime}`,
      })),
      clientIp: clientIp(req),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Greška na serveru' });
  }
});

router.post('/check-in', async (req, res) => {
  try {
    const { username, password, branch_id } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Unesite korisničko ime i lozinku' });

    const auth = await authenticate(username, password);
    if (auth.error) return res.status(auth.status).json({ error: auth.error });
    const { user } = auth;
    if (user.role_id >= 3) {
      return res.json({ isAdmin: true, message: 'Administrator — prijavite se u admin panel' });
    }

    const branch = await resolveBranch(req, branch_id);
    if (!branch) return res.status(400).json({ error: 'Poslovnica nije odabrana' });

    const today = todayDate();
    const [already] = await pool.query(
      'SELECT id FROM hours WHERE datum=? AND user_id=? AND temp IS NOT NULL',
      [today, user.id]
    );
    if (already.length) return res.status(400).json({ error: 'Greška: radno vrijeme je već aktivno' });

    const [ods] = await pool.query(
      'SELECT * FROM hours WHERE datum=? AND user_id=? AND odsustvo IS NOT NULL LIMIT 1',
      [today, user.id]
    );
    if (ods[0]) {
      await pool.query(
        `UPDATE hours SET odsustvo=NULL, napomena=CONCAT('Uklonjeno odsustvo! ', IFNULL(napomena,'')), branch_id=?, temp=? WHERE id=?`,
        [branch.id, nowTime(), ods[0].id]
      );
    } else {
      await startWork(user.id, branch.id, today);
    }
    res.json({ success: 'Uspješno započeto radno vrijeme', branch: branch.naziv_oj });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Greška na serveru' });
  }
});

router.post('/check-out', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Unesite korisničko ime i lozinku' });

    const auth = await authenticate(username, password);
    if (auth.error) return res.status(auth.status).json({ error: auth.error });
    const { user } = auth;

    const today = todayDate();
    const [hours] = await pool.query(
      'SELECT * FROM hours WHERE datum=? AND user_id=? AND temp IS NOT NULL LIMIT 1',
      [today, user.id]
    );
    const hour = hours[0];
    if (!hour) return res.status(400).json({ error: 'Greška: radno vrijeme nije aktivno' });

    const end = nowTime();
    const radni = appendPeriod(hour.radni_sati, hour.temp, end);
    await pool.query('UPDATE hours SET radni_sati=?, temp=NULL WHERE id=?', [radni, hour.id]);
    res.json({ success: 'Uspješno završeno radno vrijeme' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Greška na serveru' });
  }
});

module.exports = router;
