/**
 * Automatic "Prekid" (break) for Excel šihta lista export.
 * Not stored in DB — computed only when building export rows.
 *
 * Rule: 30-minute break starting 2.5 hours after the employee's
 * first check-in that calendar day; break start rounded to nearest 15 min.
 */

const BREAK_AFTER_MINUTES = 2.5 * 60; // 150
const BREAK_DURATION_MINUTES = 30;
const ROUND_TO_MINUTES = 15;

/**
 * @param {number} totalMinutes — minutes from midnight (may be any non-neg int)
 * @returns {number} minutes from midnight, rounded to nearest 15 (0..24*60 wrap not applied)
 */
function roundToNearest15(totalMinutes) {
  const n = Number(totalMinutes);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n / ROUND_TO_MINUTES) * ROUND_TO_MINUTES;
}

/**
 * Format minutes-from-midnight as HH:mm (zero-padded), matching Početak/Završetak.
 * Values >= 24h wrap modulo for display of local clock time.
 * @param {number} totalMinutes
 * @returns {string}
 */
function formatHm(totalMinutes) {
  const safe = ((Math.trunc(totalMinutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Parse "HH:mm" or "H:mm" to minutes from midnight, or null if unusable.
 * @param {string} hm
 * @returns {number|null}
 */
function parseStartMinutes(hm) {
  if (hm == null || hm === '' || hm === '-') return null;
  const m = String(hm).trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23) return null;
  return h * 60 + min;
}

/**
 * Compute Prekid range string from first check-in of the day.
 * @param {string} firstStartHm — e.g. "07:30" or "7:37"
 * @returns {string} e.g. "10:00-10:30", or "" if no usable start
 *
 * Examples (2.5h + round nearest 15 + 30min):
 *   07:30 → 10:00-10:30
 *   07:37 → 10:00-10:30
 *   07:38 → 10:15-10:45
 */
function computePrekid(firstStartHm) {
  const startMins = parseStartMinutes(firstStartHm);
  if (startMins == null) return '';
  const breakStart = roundToNearest15(startMins + BREAK_AFTER_MINUTES);
  const breakEnd = breakStart + BREAK_DURATION_MINUTES;
  return `${formatHm(breakStart)}-${formatHm(breakEnd)}`;
}

/**
 * Earliest start among interval pairs in a list of radni_sati parts
 * (["07:30","15:00", ...]) or hour records with .radni_sati / pre-parsed starts.
 * @param {string[]} starts — candidate HH:mm starts
 * @returns {string|null} earliest as HH:mm (zero-padded) or null
 */
function earliestStart(starts) {
  let best = null;
  let bestMins = null;
  for (const s of starts || []) {
    const mins = parseStartMinutes(s);
    if (mins == null) continue;
    if (bestMins == null || mins < bestMins) {
      bestMins = mins;
      best = formatHm(mins);
    }
  }
  return best;
}

module.exports = {
  BREAK_AFTER_MINUTES,
  BREAK_DURATION_MINUTES,
  ROUND_TO_MINUTES,
  roundToNearest15,
  formatHm,
  parseStartMinutes,
  computePrekid,
  earliestStart,
};
