/**
 * Pure rules for closing an open ("temp") work session without the employee:
 * the nightly auto-logout, and stale sessions met at check-in/check-out.
 * No DB access here, so everything is unit-testable.
 */
const { parseHm, isValidHm } = require('../utils/time');
const { formatHm } = require('../utils/prekid');
const { autoLogoutExtraMinutes, maxOpenSessionHours } = require('../config');

const NIGHT_START_MINS = 20 * 60; // 20:00 — night-shift threshold
const FALLBACK_KRAJ_RV = '23:00';
const FALLBACK_POCETAK_RV = '08:00';
const AUTO_LOGOUT_NOTE = 'Automatska odjava!';
const AUTO_LOGOUT_NOTE_NIGHT = 'Automatska odjava (noćna smjena)!';
const AUTO_LOGOUT_NOTE_AFTER_CLOSE = 'Automatska odjava (prijava nakon kraja RV, provjeriti)!';
const LATEST_DAY_END_MINS = 23 * 60 + 59;
/** Today's day sessions are only auto-closed this long after the branch's closing time. */
const DAY_CLOSE_GRACE_MINS = 30;
const LAST_PASS_MINS = 23 * 60 + 50;

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

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
 * Decide how to close one open session.
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

/**
 * True when a day session of *today* should not be auto-closed yet: the branch closed less
 * than DAY_CLOSE_GRACE_MINS ago (e.g. kraj_rv 23:00 and staff still checking out at 23:05).
 */
function isWithinDayCloseGrace(hour, plan, today, nowMins) {
  if (plan.kind !== 'day' || plan.afterClose) return false;
  if (toDateStr(hour.datum) !== today) return false;
  // Capped before midnight so the session is still closed by tonight's pass.
  return nowMins < Math.min(parseHm(plan.endStr) + DAY_CLOSE_GRACE_MINS, LAST_PASS_MINS);
}

/** Minutes between the session start (datum + temp, server local time) and `now`. */
function elapsedMinutes(hour, now = new Date()) {
  const d = toDateStr(hour.datum);
  if (!d || !isValidHm(hour.temp)) return null;
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = hour.temp.split(':').map(Number);
  return Math.round((now.getTime() - new Date(y, m - 1, day, hh, mm).getTime()) / 60000);
}

/**
 * A stale session: opened on an earlier date and open for longer than any real shift
 * (MAX_OPEN_SESSION_HOURS, default 16). Happens when someone forgot to check out and the
 * nightly auto-logout has not closed it yet (night shifts are closed a day later; a pass
 * can also be missed while the server is down). Checking it out "now" would record a bogus
 * interval, so it is closed by the auto-logout rules instead.
 */
function isStaleSession(hour, now = new Date(), maxHours = maxOpenSessionHours()) {
  const d = toDateStr(hour.datum);
  if (!d || d >= localDateStr(now)) return false;
  const mins = elapsedMinutes(hour, now);
  if (mins == null) return true; // unreadable start on an old date
  return mins > maxHours * 60;
}

/** Close plan for a stale session (never 'night_today', because its date is in the past). */
function planStaleClose(hour, now = new Date(), extraMinutes = autoLogoutExtraMinutes()) {
  const plan = planClose(hour, localDateStr(now), extraMinutes);
  if (plan.kind === 'night_today') {
    const { end, usedFallback } = resolveNightEndHm(hour.branch_pocetak_rv);
    return { kind: 'night_previous', endStr: end, note: AUTO_LOGOUT_NOTE_NIGHT, usedFallback };
  }
  return plan;
}

module.exports = {
  NIGHT_START_MINS,
  FALLBACK_KRAJ_RV,
  FALLBACK_POCETAK_RV,
  AUTO_LOGOUT_NOTE,
  AUTO_LOGOUT_NOTE_NIGHT,
  AUTO_LOGOUT_NOTE_AFTER_CLOSE,
  DAY_CLOSE_GRACE_MINS,
  isNightStart,
  toDateStr,
  localDateStr,
  classifyOpenSession,
  resolveNightEndHm,
  resolveDayEndHm,
  planClose,
  isWithinDayCloseGrace,
  elapsedMinutes,
  isStaleSession,
  planStaleClose,
};
