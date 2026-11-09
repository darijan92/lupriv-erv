const express = require('express');
const pool = require('../db/pool');
const crypto = require('crypto');
const { appendPeriod, parseHm, todayDate, isValidHm } = require('../utils/time');
const { autoLogoutExtraMinutes } = require('../config');
const { formatHm } = require('../utils/prekid');

const router = express.Router();

/** In-memory last successful daily pass (YYYY-MM-DD, server local TZ). Lost on restart. */
let lastAutoLogoutDate = null;

const NIGHT_START_MINS = 20 * 60; // 20:00 — night-shift threshold
const FALLBACK_KRAJ_RV = '23:00';
const FALLBACK_POCETAK_RV = '08:00';
const AUTO_LOGOUT_NOTE = 'Automatska odjava!';
const AUTO_LOGOUT_NOTE_NIGHT = 'Automatska odjava (noćna smjena)!';
const AUTO_LOGOUT_NOTE_AFTER_CLOSE = 'Automatska odjava (prijava nakon kraja RV, provjeriti)!';
const LATEST_DAY_END_MINS = 23 * 60 + 59;

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

function isNightStart(tempHm) {
  if (!tempHm) return false;
  try {
    return parseHm(tempHm) >= NIGHT_START_MINS;
  } catch {
    return false;
  }
}

/** Normalize hours.datum (DATE string or Date) to YYYY-MM-DD. */
function toDateStr(datum) {
  if (datum == null || datum === '') return null;
  if (datum instanceof Date && !Number.isNaN(datum.getTime())) {
    return `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, '0')}-${String(datum.getDate()).padStart(2, '0')}`;
  }
  const s = String(datum).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

/**
 * Classify an open hours row for the daily auto-logout pass.
 * @returns {'day'|'night_today'|'night_previous'}
 */
function classifyOpenSession(hour, today) {
  if (!isNightStart(hour.temp)) return 'day';
  const d = toDateStr(hour.datum);
  if (d && d < today) return 'night_previous';
  // Same calendar day as run, or unknown datum → leave open (tonight's shift).
  return 'night_today';
}

/** Trimmed HH:mm value, or `fallback` when missing/invalid. */
function resolveHmOrFallback(value, fallback) {
  const raw = value == null ? '' : String(value).trim();
  if (isValidHm(raw)) return { end: raw, usedFallback: false };
  return { end: fallback, usedFallback: true };
}

/**
 * Branch regular work start for deferred night checkout (morning after start).
 * Missing/invalid pocetak_rv → 08:00 fallback.
 */
function resolveNightEndHm(pocetakRv) {
  return resolveHmOrFallback(pocetakRv, FALLBACK_POCETAK_RV);
}

/**
 * Branch regular work end for day-shift auto-logout (same calendar day as hours.datum).
 * Missing/invalid kraj_rv → 23:00 fallback.
 * Stored as HH:mm via appendPeriod; day shifts normally have end > start (same day).
 */
function resolveDayEndHm(krajRv, extraMinutes = autoLogoutExtraMinutes()) {
  const base = resolveHmOrFallback(krajRv, FALLBACK_KRAJ_RV);
  if (!extraMinutes) return base;
  // Old app: kraj_rv + 1h, capped at 23:59.
  const mins = Math.min(parseHm(base.end) + extraMinutes, LATEST_DAY_END_MINS);
  return { end: formatHm(mins), usedFallback: base.usedFallback };
}

/**
 * Decide how to close one open session (pure, for tests).
 * @returns {{ kind: 'day'|'night_today'|'night_previous', endStr?: string, note?: string,
 *             usedFallback?: boolean, afterClose?: boolean }}
 */
function planClose(hour, today, extraMinutes = autoLogoutExtraMinutes()) {
  const kind = classifyOpenSession(hour, today);
  if (kind === 'night_today') return { kind };
  if (kind === 'night_previous') {
    const { end, usedFallback } = resolveNightEndHm(hour.branch_pocetak_rv);
    return { kind, endStr: end, note: AUTO_LOGOUT_NOTE_NIGHT, usedFallback };
  }
  const { end, usedFallback } = resolveDayEndHm(hour.branch_kraj_rv, extraMinutes);
  // Checked in at or after the branch's closing time: closing at kraj_rv would read as an
  // overnight pair (e.g. 15:10–14:00 = 22:50 h). Record zero time and flag it for review.
  if (isValidHm(hour.temp) && parseHm(end) <= parseHm(hour.temp)) {
    return { kind, endStr: hour.temp, note: AUTO_LOGOUT_NOTE_AFTER_CLOSE, usedFallback, afterClose: true };
  }
  return { kind, endStr: end, note: AUTO_LOGOUT_NOTE, usedFallback };
}

async function closeHour({ hour, endStr, note, logContent }) {
  const radni = appendPeriod(hour.radni_sati, hour.temp, endStr);
  const nap = `${note}${hour.napomena ? ` ${hour.napomena}` : ''}`.trim();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // temp IS NOT NULL guard: skip if the employee checked out meanwhile.
    const [r] = await conn.query(
      'UPDATE hours SET radni_sati=?, temp=NULL, napomena=? WHERE id=? AND temp IS NOT NULL',
      [radni, nap, hour.id]
    );
    if (r.affectedRows) {
      await conn.query(
        `INSERT INTO logs (datum, user_id, branch_id, hour_id, content) VALUES (NOW(),?,?,?,?)`,
        [hour.user_id, hour.branch_id ?? 0, hour.id, logContent]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

function skippedResult(reason) {
  return {
    closed: 0,
    closedDay: 0,
    closedNight: 0,
    skippedNight: 0,
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
 *   B) Night started today (start >= 20:00, datum === today): skip.
 *   C) Night started previous day (start >= 20:00, datum < today): close end = branch
 *      pocetak_rv on morning after start (stored as overnight HH:mm pair); fallback 08:00.
 *
 * @param {{ force?: boolean }} opts
 * @returns {Promise<{
 *   closed: number,
 *   closedDay: number,
 *   closedNight: number,
 *   skippedNight: number,
 *   fallbackPocetak: number,
 *   fallbackKraj: number,
 *   skipped: boolean,
 *   reason?: string
 * }>}
 */
async function runAutoLogout(opts = {}) {
  const force = Boolean(opts.force);
  const now = new Date();
  const today = todayDate();
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
  let fallbackPocetak = 0;
  let fallbackKraj = 0;

  for (const hour of hours) {
    const plan = planClose(hour, today);

    if (plan.kind === 'night_today') {
      skippedNight += 1;
      continue;
    }

    if (plan.kind === 'night_previous') {
      if (plan.usedFallback) fallbackPocetak += 1;
      closedNight += 1;
    } else {
      if (plan.usedFallback) fallbackKraj += 1;
      closedDay += 1;
    }
    await closeHour({ hour, endStr: plan.endStr, note: plan.note, logContent: plan.note });
  }

  // Mark daily pass done (scheduled always; force only if already past 23:00)
  if (!force || nowMins >= 23 * 60) {
    lastAutoLogoutDate = today;
  }

  return {
    closed: closedDay + closedNight,
    closedDay,
    closedNight,
    skippedNight,
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
  classifyOpenSession,
  planClose,
  resolveNightEndHm,
  resolveDayEndHm,
  toDateStr,
  isNightStart,
  NIGHT_START_MINS,
  FALLBACK_POCETAK_RV,
  FALLBACK_KRAJ_RV,
  AUTO_LOGOUT_NOTE,
  AUTO_LOGOUT_NOTE_NIGHT,
  AUTO_LOGOUT_NOTE_AFTER_CLOSE,
  _resetLastAutoLogoutDateForTests() {
    lastAutoLogoutDate = null;
  },
};
