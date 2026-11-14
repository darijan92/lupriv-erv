const express = require('express');
const pool = require('../db/pool');
const crypto = require('crypto');
const rules = require('../services/sessionRules');
const { autoCloseSession } = require('../services/hoursService');

const { planClose, isWithinDayCloseGrace } = rules;

const router = express.Router();

/** In-memory last successful daily pass (YYYY-MM-DD, server local TZ). Lost on restart. */
let lastAutoLogoutDate = null;

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Shared-secret guard for cron/external POST /api/auto-logout/run.
 * Accepts header X-Auto-Logout-Secret or JSON body { secret } (not the query string,
 * which ends up in access logs).
 * Internal callers (startup / setInterval) use runAutoLogout() directly — no HTTP.
 */
function requireAutoLogoutSecret(req, res, next) {
  const expected = process.env.AUTO_LOGOUT_SECRET;
  if (!expected || String(expected).trim() === '') {
    return res.status(503).json({
      error: 'AUTO_LOGOUT_SECRET nije konfiguriran — HTTP endpoint onemogućen',
    });
  }
  const provided =
    req.get('x-auto-logout-secret') || // case-insensitive
    (req.body && req.body.secret);
  if (!provided || !safeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Neautorizirano' });
  }
  return next();
}

function skippedResult(reason) {
  return {
    closed: 0,
    closedDay: 0,
    closedNight: 0,
    skippedNight: 0,
    deferred: 0,
    fallbackPocetak: 0,
    fallbackKraj: 0,
    skipped: true,
    reason,
  };
}

/**
 * Run auto-logout.
 * - Scheduled (force=false): only when local time >= 23:00 and not already run today.
 * - Forced (HTTP/cron): always attempt; same classification rules.
 *
 * Rules (open temp):
 *   A) Day (start < 20:00): close end = branch kraj_rv (+ AUTO_LOGOUT_EXTRA_MINUTES, max 23:59);
 *      fallback 23:00 if missing/invalid. Napomena Automatska odjava!
 *      If the session started at/after that end, it is closed with zero time and flagged.
 *      A session of today whose branch closed less than 30 min ago is deferred to the next
 *      pass (staff of a branch closing at 23:00 are still checking out).
 *   B) Night started today (start >= 20:00, datum === today): skip.
 *   C) Night started previous day (start >= 20:00, datum < today): close end = branch
 *      pocetak_rv on morning after start (stored as overnight HH:mm pair); fallback 08:00.
 *
 * @param {{ force?: boolean, now?: Date }} opts  (`now` is for tests)
 * @returns {Promise<{
 *   closed: number,
 *   closedDay: number,
 *   closedNight: number,
 *   skippedNight: number,
 *   deferred: number,
 *   fallbackPocetak: number,
 *   fallbackKraj: number,
 *   skipped: boolean,
 *   reason?: string
 * }>}
 */
async function runAutoLogout(opts = {}) {
  const force = Boolean(opts.force);
  const now = opts.now instanceof Date ? opts.now : new Date();
  const today = rules.localDateStr(now);
  const nowMins = now.getHours() * 60 + now.getMinutes();

  if (!force) {
    if (nowMins < 23 * 60) return skippedResult('before_23');
    if (lastAutoLogoutDate === today) return skippedResult('already_ran');
  }

  const [hours] = await pool.query(
    `SELECT h.*, b.pocetak_rv AS branch_pocetak_rv, b.kraj_rv AS branch_kraj_rv
     FROM hours h
     LEFT JOIN branches b ON b.id = h.branch_id
     WHERE h.temp IS NOT NULL`
  );

  let closedDay = 0;
  let closedNight = 0;
  let skippedNight = 0;
  let deferred = 0;
  let fallbackPocetak = 0;
  let fallbackKraj = 0;

  for (const hour of hours) {
    const plan = planClose(hour, today);

    if (plan.kind === 'night_today') {
      skippedNight += 1;
      continue;
    }

    if (isWithinDayCloseGrace(hour, plan, today, nowMins)) {
      deferred += 1;
      continue;
    }

    const closed = await autoCloseSession(hour, plan);
    if (!closed) continue; // the employee checked out in the meantime
    if (plan.kind === 'night_previous') {
      if (plan.usedFallback) fallbackPocetak += 1;
      closedNight += 1;
    } else {
      if (plan.usedFallback) fallbackKraj += 1;
      closedDay += 1;
    }
  }

  // Mark the daily pass done only when nothing was deferred, so the next timer tick retries.
  if (deferred === 0 && (!force || nowMins >= 23 * 60)) {
    lastAutoLogoutDate = today;
  }

  return {
    closed: closedDay + closedNight,
    closedDay,
    closedNight,
    skippedNight,
    deferred,
    fallbackPocetak,
    fallbackKraj,
    skipped: false,
  };
}

router.post('/run', requireAutoLogoutSecret, async (_req, res) => {
  try {
    const result = await runAutoLogout({ force: true });
    res.json({
      success: true,
      closed: result.closed,
      closedDay: result.closedDay,
      closedNight: result.closedNight,
      skippedNight: result.skippedNight,
      deferred: result.deferred,
      fallbackPocetak: result.fallbackPocetak,
      fallbackKraj: result.fallbackKraj,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Greška' });
  }
});

module.exports = {
  router,
  runAutoLogout,
  requireAutoLogoutSecret,
  // Rules live in services/sessionRules; re-exported for scripts and tests.
  classifyOpenSession: rules.classifyOpenSession,
  planClose: rules.planClose,
  resolveNightEndHm: rules.resolveNightEndHm,
  resolveDayEndHm: rules.resolveDayEndHm,
  toDateStr: rules.toDateStr,
  isNightStart: rules.isNightStart,
  NIGHT_START_MINS: rules.NIGHT_START_MINS,
  FALLBACK_POCETAK_RV: rules.FALLBACK_POCETAK_RV,
  FALLBACK_KRAJ_RV: rules.FALLBACK_KRAJ_RV,
  AUTO_LOGOUT_NOTE: rules.AUTO_LOGOUT_NOTE,
  AUTO_LOGOUT_NOTE_NIGHT: rules.AUTO_LOGOUT_NOTE_NIGHT,
  AUTO_LOGOUT_NOTE_AFTER_CLOSE: rules.AUTO_LOGOUT_NOTE_AFTER_CLOSE,
  _resetLastAutoLogoutDateForTests() {
    lastAutoLogoutDate = null;
  },
};
