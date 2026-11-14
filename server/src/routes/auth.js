const express = require('express');
const pool = require('../db/pool');
const { authRequired } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { z } = require('zod');
const {
  authenticateLimited,
  signUser,
  publicUser,
  verifyPassword,
  hashPassword,
} = require('../services/authService');
const { startWork, withUserLock, closeStaleSessions } = require('../services/hoursService');
const { writeLog, b } = require('../services/auditLog');
const { clientIp, todayDate } = require('../utils/time');
const { nullsLastOrder } = require('../utils/sqlSort');

const router = express.Router();

const loginSchema = z.object({
  username: z.string().min(1, 'Unesite korisničko ime').max(50),
  password: z.string().min(1, 'Unesite lozinku').max(200),
  branch_id: z.coerce.number().int().positive().optional().nullable(),
  start_work: z.boolean().optional(),
});

function homeFor(user) {
  return Number(user.role_id) === 2 ? '/moderator' : `/employee/${user.id}`;
}

function sessionPayload(user, extra = {}) {
  return {
    token: signUser(user),
    user: publicUser(user),
    mustChangePassword: Boolean(user.must_change_password),
    ...extra,
  };
}

router.post('/login', validate({ body: loginSchema }), async (req, res) => {
  try {
    const { username, password, branch_id, start_work } = req.body;
    const ip = clientIp(req);
    const auth = await authenticateLimited(ip, username, password);
    if (auth.error) {
      if (auth.retryAfter) res.set('Retry-After', String(auth.retryAfter));
      return res.status(auth.status).json({ error: auth.error });
    }
    const { user } = auth;

    // Admin logins never start radno vrijeme, regardless of the checkbox.
    // Keep this guard before the start_work branch so the server remains authoritative.
    const isAdmin = Number(user.role_id) >= 3;
    if (isAdmin) {
      return res.json(sessionPayload(user, { redirect: '/admin' }));
    }

    if (start_work && branch_id) {
      const [branches] = await pool.query('SELECT * FROM branches WHERE id=?', [branch_id]);
      const branch = branches[0];
      if (!branch) return res.status(400).json({ error: 'Poslovnica nije pronađena' });

      // Logging in with a branch registers this device's IP as the branch kiosk IP (legacy behaviour).
      if (branch.ip !== ip) {
        await writeLog({
          userId: user.id,
          branchId: branch.id,
          content: `Korisnik ${b(`${user.ime} ${user.prezime}`)} je promijenio IP adresu OJ ${b(branch.naziv_oj)} (${b(branch.ip || '-')} → ${b(ip)}).`,
        });
        await pool.query('UPDATE branches SET ip=? WHERE id=?', [ip, branch.id]);
      }

      const started = await withUserLock(user.id, async (conn) => {
        const { open } = await closeStaleSessions(user.id, conn);
        if (open) return false;
        await startWork(user.id, branch.id, todayDate(), conn);
        return true;
      });
      return res.json(
        sessionPayload(user, {
          redirect: homeFor(user),
          ...(started
            ? { success: 'Uspješno započeto radno vrijeme' }
            : { warning: 'Korisnik je već prijavljen' }),
        })
      );
    }

    return res.json(sessionPayload(user, { redirect: homeFor(user) }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Greška na serveru' });
  }
});

router.get('/me', authRequired, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, username, ime, prezime, branch_id, role_id, sifra, datum_rodjenja, datum_zaposlenja, datum_odlaska,
            must_change_password
     FROM users WHERE id=?`,
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Korisnik nije pronađen' });
  res.json({ user: { ...rows[0], must_change_password: Boolean(rows[0].must_change_password) } });
});

const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, 'Unesite trenutnu lozinku'),
    new_password: z
      .string()
      .min(8, 'Nova lozinka mora imati barem 8 znakova')
      .max(200, 'Nova lozinka je predugačka'),
  })
  .refine((v) => v.current_password !== v.new_password, {
    message: 'Nova lozinka mora biti različita od trenutne',
    path: ['new_password'],
  });

router.post(
  '/change-password',
  authRequired,
  validate({ body: changePasswordSchema }),
  async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM users WHERE id=?', [req.user.id]);
    const user = rows[0];
    if (!user || !(await verifyPassword(req.body.current_password, user.password))) {
      return res.status(400).json({ error: 'Trenutna lozinka nije ispravna' });
    }
    const hash = await hashPassword(req.body.new_password);
    await pool.query('UPDATE users SET password=?, must_change_password=0 WHERE id=?', [hash, user.id]);
    const updated = { ...user, must_change_password: 0 };
    res.json({ success: 'Lozinka promijenjena', ...sessionPayload(updated) });
  }
);

router.get('/branches-public', async (_req, res) => {
  const [rows] = await pool.query(`SELECT id, sifra, naziv_oj, grad FROM branches ORDER BY ${nullsLastOrder('naziv_oj')}`);
  res.json({ branches: rows });
});

module.exports = router;
