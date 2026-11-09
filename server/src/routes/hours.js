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
const { canViewUser, canManageUserHours, isDateEditable, earliestEditableDate, isAdmin, moderatorBranchIds } = require('../utils/access');
const { logHoursChange } = require('../services/auditLog');

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

      if (!(await canViewUser(req.user, userId))) {
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
    const before = await hoursService.getHour(req.body.hour_id);
    const result = await hoursService.adminStop(req.body.hour_id, req.user.id, req.body.password, verifyPassword);
    if (before) {
      await logHoursChange({
        actor: req.user,
        targetUserId: before.user_id,
        before,
        after: await hoursService.getHour(before.id),
        action: 'stop',
        datum: before.datum,
        hourId: before.id,
      });
    }
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Greška' });
  }
});

const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Vrijeme mora biti HH:mm');
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Datum mora biti YYYY-MM-DD');
const optText = (max) => z.string().max(max).optional().nullable();
const optId = z.union([z.coerce.number().int().positive(), z.literal(''), z.null()]).optional();
const optHm = z.union([hm, z.literal(''), z.null()]).optional();

const createHoursSchema = z
  .object({
    mode: z.enum(['odsustvo', 'nocni_rad', 'dan']).optional(),
    user_id: z.coerce.number().int().positive(),
    datum: ymd.optional(),
    pocetak: ymd.optional(),
    kraj: ymd.optional(),
    branch_id: optId,
    odsustvo: optText(50),
    odsustvo_time: z.union([z.string().regex(/^\d{1,2}:[0-5]\d$/, 'Trajanje mora biti HH:mm'), z.literal(''), z.null()]).optional(),
    napomena: optText(2000),
    nocni_rad: z.boolean().optional(),
    start: optHm,
    end: optHm,
    intervals: z.array(z.object({ start: hm, end: hm })).max(20).optional(),
    skip_saturday: z.boolean().optional(),
    skip_sunday: z.boolean().optional(),
  })
  .passthrough();

const updateHoursSchema = z.object({
  radni_sati: z.string().max(255).optional().nullable(),
  intervals: z.array(z.object({ start: z.string(), end: z.string() })).max(20).optional(),
  temp: optHm,
  odsustvo: optText(50),
  odsustvo_time: z.string().max(5).optional().nullable(),
  napomena: optText(2000),
  branch_id: optId,
  nocni_rad: z.boolean().optional(),
});

const idParams = z.object({ id: z.coerce.number().int().positive() });

function lockedError(res) {
  return res.status(403).json({
    error: `Nemate ovlasti za mijenjanje podataka prije ${earliestEditableDate()}`,
  });
}

router.post(
  '/',
  authRequired,
  requireModeratorOrAdmin,
  validate({ body: createHoursSchema }),
  async (req, res) => {
    try {
      const b = req.body;
      if (!(await canManageUserHours(req.user, b.user_id))) {
        return res.status(403).json({ error: 'Nemate ovlasti za ovog korisnika' });
      }
      const firstDate = b.mode === 'odsustvo' ? b.pocetak : b.datum || b.pocetak;
      if (!firstDate) return res.status(400).json({ error: 'Datum je obavezan' });
      if (!isDateEditable(req.user, firstDate)) return lockedError(res);

      let result;
      let action = 'create';
      if (b.mode === 'odsustvo') {
        if (!b.kraj || !b.odsustvo) return res.status(400).json({ error: 'Kraj i vrsta odsustva su obavezni' });
        result = await hoursService.createAbsenceRange(b);
        action = 'absence';
      } else if (b.mode === 'nocni_rad' || b.nocni_rad === true) {
        result = await hoursService.createNightShift({
          user_id: b.user_id,
          datum: firstDate,
          branch_id: b.branch_id,
          start: b.start || b.intervals?.[0]?.start,
          end: b.end || b.intervals?.[0]?.end,
          napomena: b.napomena,
        });
      } else {
        result = await hoursService.createDayHours({ ...b, datum: firstDate });
      }

      await logHoursChange({
        actor: req.user,
        targetUserId: b.user_id,
        after: result.id ? await hoursService.getHour(result.id) : null,
        action,
        datum: firstDate,
        hourId: result.id || null,
        extra:
          action === 'absence'
            ? `(${b.odsustvo}, ${b.pocetak} – ${b.kraj}, ${result.count} dana)`
            : '',
      });
      res.status(action === 'absence' ? 200 : 201).json(result);
    } catch (e) {
      if (!e.status) console.error(e);
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Greška' });
    }
  }
);

router.put(
  '/:id',
  authRequired,
  requireModeratorOrAdmin,
  validate({ params: idParams, body: updateHoursSchema }),
  async (req, res) => {
    try {
      const before = await hoursService.getHour(req.params.id);
      if (!before) return res.status(404).json({ error: 'Zapis nije pronađen' });
      if (!(await canManageUserHours(req.user, before.user_id))) {
        return res.status(403).json({ error: 'Nemate ovlasti za ovog korisnika' });
      }
      if (!isDateEditable(req.user, before.datum)) return lockedError(res);

      const result = await hoursService.updateHours(before.id, req.body);
      await logHoursChange({
        actor: req.user,
        targetUserId: before.user_id,
        before,
        after: await hoursService.getHour(before.id),
        action: 'update',
        datum: before.datum,
        hourId: before.id,
      });
      res.json(result);
    } catch (e) {
      if (!e.status) console.error(e);
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Greška' });
    }
  }
);

router.delete('/:id', authRequired, requireAdmin, validate({ params: idParams }), async (req, res) => {
  const before = await hoursService.getHour(req.params.id);
  if (!before) return res.status(404).json({ error: 'Zapis nije pronađen' });
  const result = await hoursService.deleteHours(before.id);
  await logHoursChange({
    actor: req.user,
    targetUserId: before.user_id,
    before,
    action: 'delete',
    datum: before.datum,
    hourId: before.id,
  });
  res.json(result);
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

      if (!(await canViewUser(req.user, userId))) {
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

      if (!isAdmin(req.user)) {
        const allowed = (await moderatorBranchIds(req.user.id)).has(Number(branchId));
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
