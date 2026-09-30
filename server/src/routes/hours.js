const express = require('express');
const { z } = require('zod');
const pool = require('../db/pool');
const { authRequired, requireAdmin, requireModeratorOrAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { buildMonthView } = require('../services/hoursCalc');
const hoursService = require('../services/hoursService');
const { verifyPassword } = require('../services/authService');
const {
  buildHoursWorkbook,
  buildBranchWorkbook,
  sendWorkbook,
} = require('../utils/excelExport');
const { sendCsv } = require('../utils/csv');
const { canViewUser } = require('../utils/access');

const router = express.Router();

/** month/year from validated query, defaulting to the current month. */
function resolveMonthYear(query) {
  const now = new Date();
  return {
    month: query.month || now.getMonth() + 1,
    year: query.year || now.getFullYear(),
  };
}

const monthQuery = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  format: z.enum(['xlsx', 'csv']).optional(),
});

router.get(
  '/month/:userId',
  authRequired,
  validate({
    params: z.object({ userId: z.coerce.number().int().positive() }),
    query: monthQuery,
  }),
  async (req, res) => {
    try {
      const userId = req.params.userId;
      const { month, year } = resolveMonthYear(req.query);

      if (!canViewUser(req.user, userId)) {
        return res.status(403).json({ error: 'Nemate ovlasti' });
      }

      const data = await hoursService.monthOverview(userId, month, year);
      if (!data) return res.status(404).json({ error: 'Korisnik nije pronađen' });
      res.json(data);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Greška' });
    }
  }
);

router.get('/active', authRequired, requireAdmin, async (_req, res) => {
  res.json({ hours: await hoursService.listActive() });
});

router.post('/admin-stop', authRequired, requireAdmin, async (req, res) => {
  try {
    const result = await hoursService.adminStop(req.body.hour_id, req.user.id, req.body.password, verifyPassword);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Greška' });
  }
});

router.post('/', authRequired, requireModeratorOrAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    if (b.mode === 'odsustvo') {
      return res.json(await hoursService.createAbsenceRange(b));
    }
    if (b.mode === 'nocni_rad' || b.nocni_rad === true) {
      return res.status(201).json(
        await hoursService.createNightShift({
          user_id: b.user_id,
          datum: b.datum || b.pocetak,
          branch_id: b.branch_id,
          start: b.start || b.intervals?.[0]?.start,
          end: b.end || b.intervals?.[0]?.end,
          napomena: b.napomena,
        })
      );
    }
    const result = await hoursService.createDayHours(b);
    res.status(201).json(result);
  } catch (e) {
    console.error(e);
    res.status(e.status || 500).json({ error: e.message || 'Greška' });
  }
});

router.put('/:id', authRequired, requireModeratorOrAdmin, async (req, res) => {
  try {
    res.json(await hoursService.updateHours(req.params.id, req.body || {}));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Greška' });
  }
});

router.delete('/:id', authRequired, requireAdmin, async (req, res) => {
  res.json(await hoursService.deleteHours(req.params.id));
});

router.get(
  '/export/:userId',
  authRequired,
  validate({
    params: z.object({ userId: z.coerce.number().int().positive() }),
    query: monthQuery,
  }),
  async (req, res) => {
    try {
      const userId = req.params.userId;
      const { month, year } = resolveMonthYear(req.query);
      const format = req.query.format || 'xlsx';

      if (!canViewUser(req.user, userId)) {
        return res.status(403).json({ error: 'Nemate ovlasti' });
      }

      const [user, hours] = await Promise.all([
        hoursService.getUserPublic(userId),
        hoursService.getHoursForUserMonth(userId, month, year),
      ]);
      if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen' });
      const uname = user.username || userId;

      if (format === 'csv') {
        const view = buildMonthView(hours, year, month);
        const header = 'Dan;Datum;Poslovnica;Radni sati;Odsustvo;Ukupno;Regularno;Dodatno;Noćna;Napomena\n';
        const lines = view.days
          .filter((r) => r.id)
          .map((r) =>
            [
              r.dan, r.datum, r.naziv_oj, (r.radni_sati || []).join(' '),
              r.odsustvo || '', r.ukupno, r.total, r.dodatno,
              r.isNightShift ? 'da' : '', (r.napomena || '').replace(/;/g, ','),
            ].join(';')
          );
        lines.push(`;;;;;Zbroj;${view.zbroj.ukupno};${view.zbroj.total};${view.zbroj.dodatno};;`);
        return sendCsv(res, `sati_${uname}_${month}_${year}.csv`, header, lines);
      }

      const wb = await buildHoursWorkbook({ user, month, year, hours });
      return sendWorkbook(res, wb, `sati_${uname}_${month}_${year}.xlsx`);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Greška' });
    }
  }
);

router.get(
  '/export-branch/:branchId',
  authRequired,
  requireModeratorOrAdmin,
  validate({
    params: z.object({ branchId: z.coerce.number().int().positive() }),
    query: monthQuery,
  }),
  async (req, res) => {
    try {
      const branchId = req.params.branchId;
      const { month, year } = resolveMonthYear(req.query);

      if (req.user.role_id === 2) {
        const [[led], [me]] = await Promise.all([
          pool.query('SELECT id FROM branches WHERE voditelj_oj=?', [req.user.id]),
          pool.query('SELECT branch_id FROM users WHERE id=?', [req.user.id]),
        ]);
        const allowed =
          (led[0] && Number(led[0].id) === branchId) ||
          (me[0] && Number(me[0].branch_id) === branchId);
        if (!allowed) return res.status(403).json({ error: 'Nemate ovlasti za ovu poslovnicu' });
      }

      const [[branches], hours] = await Promise.all([
        pool.query('SELECT * FROM branches WHERE id=?', [branchId]),
        hoursService.getHoursForBranchMonth(branchId, month, year),
      ]);
      if (!branches[0]) return res.status(404).json({ error: 'Poslovnica nije pronađena' });
      const wb = await buildBranchWorkbook({ branch: branches[0], month, year, hours });
      return sendWorkbook(res, wb, `poslovnica_${branchId}_${month}_${year}.xlsx`);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Greška' });
    }
  }
);

module.exports = router;
