const express = require('express');
const { z } = require('zod');
const { authenticateLimited } = require('../services/authService');
const { startWork, withUserLock, closeStaleSessions } = require('../services/hoursService');
const { formatDmy } = require('../services/auditLog');
const pool = require('../db/pool');
const { validate } = require('../middleware/validate');
const { clientIp, nowTime, todayDate, appendPeriod } = require('../utils/time');
const { nullsLastOrder } = require('../utils/sqlSort');

const router = express.Router();

class KioskError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/**
 * Resolve the kiosk branch from the id the device stored (browser localStorage, chosen on the
 * kiosk page or at Prijava). Branch IP addresses are no longer used.
 */
async function resolveBranch(req, explicitId) {
  const raw = explicitId || req.query.branchId || req.body?.branch_id || req.body?.branchId;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [rows] = await pool.query('SELECT * FROM branches WHERE id=?', [id]);
  return rows[0] || null;
}

/** Sentence appended to the kiosk message when forgotten check-outs were closed by rule. */
function staleNotice(closed) {
  if (!closed.length) return '';
  const list = closed.map((c) => `${formatDmy(c.datum)} u ${c.endStr}`).join(', ');
  return ` Zaboravljena odjava automatski je zatvorena (${list}). Javite se voditelju radi ispravka.`;
}

function sendError(res, e) {
  if (e.status) {
    if (e.retryAfter) res.set('Retry-After', String(e.retryAfter));
    return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
  }
  console.error(e);
  return res.status(500).json({ error: 'Greška na serveru' });
}

router.get('/', async (req, res) => {
  try {
    const branch = await resolveBranch(req);
    if (!branch) {
      return res.status(404).json({
        error: 'Poslovnica nije odabrana. Odaberite poslovnicu ispod.',
        needsBranch: true,
      });
    }
    const [[posts], [active]] = await Promise.all([
      pool.query(
        `SELECT p.id, p.naslov, p.sadrzaj, p.created_at, u.ime, u.prezime
         FROM posts p LEFT JOIN users u ON u.id=p.user_id
         ORDER BY ${nullsLastOrder('p.created_at', 'p.created_at', 'DESC')} LIMIT 5`
      ),
      // Open sessions at this branch, including overnight ones started yesterday.
      pool.query(
        `SELECT h.id, h.temp, h.datum, h.user_id, u.ime, u.prezime, u.username
         FROM hours h JOIN users u ON u.id=h.user_id
         WHERE h.branch_id=? AND h.temp IS NOT NULL AND h.datum >= DATE_SUB(?, INTERVAL 1 DAY)
         ORDER BY ${nullsLastOrder('h.datum')}, ${nullsLastOrder('h.temp')}`,
        [branch.id, todayDate()]
      ),
    ]);
    res.json({
      branch: { id: branch.id, naziv_oj: branch.naziv_oj, sifra: branch.sifra },
      posts,
      activeHours: active.map((h) => ({
        ...h,
        imePrezime: `${h.ime} ${h.prezime}`,
      })),
    });
  } catch (e) {
    sendError(res, e);
  }
});

const credentials = z.object({
  username: z.string().min(1, 'Unesite korisničko ime i lozinku').max(50),
  password: z.string().min(1, 'Unesite korisničko ime i lozinku').max(200),
  branch_id: z.coerce.number().int().positive().optional().nullable(),
  branchId: z.coerce.number().int().positive().optional().nullable(),
});

async function authOrThrow(req) {
  const { username, password } = req.body;
  const auth = await authenticateLimited(clientIp(req), username, password);
  if (auth.error) {
    const err = new KioskError(auth.status, auth.error);
    err.retryAfter = auth.retryAfter;
    throw err;
  }
  return auth.user;
}

router.post('/check-in', validate({ body: credentials }), async (req, res) => {
  try {
    const user = await authOrThrow(req);
    if (user.role_id >= 3) {
      return res.json({ isAdmin: true, message: 'Administrator — prijavite se u admin panel' });
    }

    const branch = await resolveBranch(req, req.body.branch_id);
    if (!branch) return res.status(400).json({ error: 'Poslovnica nije odabrana' });

    const today = todayDate();
    const staleClosed = await withUserLock(user.id, async (conn) => {
      // A forgotten check-out from an earlier day is closed by the auto-logout rules first,
      // so it neither blocks today's check-in nor gets a made-up end time.
      const { open, closed } = await closeStaleSessions(user.id, conn);
      if (open) {
        const since = String(open.datum).slice(0, 10) === today ? open.temp : `${open.datum} ${open.temp}`;
        throw new KioskError(400, `Greška: radno vrijeme je već aktivno (od ${since})`);
      }

      const [ods] = await conn.query(
        'SELECT * FROM hours WHERE datum=? AND user_id=? AND odsustvo IS NOT NULL LIMIT 1',
        [today, user.id]
      );
      if (ods[0]) {
        await conn.query(
          `UPDATE hours SET odsustvo=NULL, napomena=CONCAT('Uklonjeno odsustvo! ', IFNULL(napomena,'')), branch_id=?, temp=? WHERE id=?`,
          [branch.id, nowTime(), ods[0].id]
        );
      } else {
        await startWork(user.id, branch.id, today, conn);
      }
      return closed;
    });
    res.json({
      success: 'Uspješno započeto radno vrijeme' + (staleClosed.length ? '.' : '') + staleNotice(staleClosed),
      autoClosed: staleClosed.length > 0,
      branch: branch.naziv_oj,
    });
  } catch (e) {
    sendError(res, e);
  }
});

router.post('/check-out', validate({ body: credentials }), async (req, res) => {
  try {
    const user = await authOrThrow(req);
    const staleClosed = await withUserLock(user.id, async (conn) => {
      // Any open session, not only today's: a 22:00–06:00 shift is checked out the next morning.
      // A stale one (forgotten check-out) is closed by rule instead of "until now".
      const { open: hour, closed } = await closeStaleSessions(user.id, conn);
      if (hour) {
        const radni = appendPeriod(hour.radni_sati, hour.temp, nowTime());
        await conn.query('UPDATE hours SET radni_sati=?, temp=NULL WHERE id=?', [radni, hour.id]);
        return closed;
      }
      if (!closed.length) throw new KioskError(400, 'Greška: radno vrijeme nije aktivno');
      return closed;
    });
    res.json({
      success: staleClosed.length
        ? staleNotice(staleClosed).trim()
        : 'Uspješno završeno radno vrijeme',
      autoClosed: staleClosed.length > 0,
    });
  } catch (e) {
    sendError(res, e);
  }
});

module.exports = router;
