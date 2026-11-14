/**
 * Time helpers for work-hour intervals.
 * Overnight pairs (end < start, e.g. 22:00–06:00) count across midnight (+24h).
 */

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function todayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function appendPeriod(radni_sati, start, end) {
  if (!radni_sati) return `${start} ${end}`;
  return `${radni_sati} ${start} ${end}`;
}

function toMinutes(hh, mm) {
  return Number(hh) * 60 + Number(mm);
}

function parseHm(hm) {
  const [h, m] = String(hm).split(':');
  return toMinutes(h, m);
}

function toHours(mins) {
  // for totals we allow > 24h across multiple intervals
  const total = Math.max(0, mins);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** True when end is before start (overnight / smjena). */
function isOvernightPair(start, end) {
  if (!start || !end) return false;
  return parseHm(end) < parseHm(start);
}

/**
 * Minutes between two HH:mm times. If end < start, treats as overnight (+24h).
 * @param {string} start
 * @param {string} end
 */
function intervalMinutes(start, end) {
  let diff = parseHm(end) - parseHm(start);
  if (diff < 0) diff += 24 * 60;
  return diff;
}

/**
 * Parse "07:16 14:37 22:00 06:00" (space-separated start/end pairs).
 * @returns {string[]}
 */
function parseRadniSati(radniSatiStrOrArr) {
  if (!radniSatiStrOrArr) return [];
  if (Array.isArray(radniSatiStrOrArr)) return radniSatiStrOrArr.filter(Boolean);
  return String(radniSatiStrOrArr).trim().split(/\s+/).filter(Boolean);
}

/**
 * Sum working time from start/end pairs. Overnight pairs supported.
 * @returns {string} HH:mm total
 */
function timeDifference(radniSatiStrOrArr) {
  const parts = parseRadniSati(radniSatiStrOrArr);
  let total = 0;
  for (let i = 0; i + 1 < parts.length; i += 2) {
    total += intervalMinutes(parts[i], parts[i + 1]);
  }
  return toHours(total);
}

/**
 * Split regular (<=8h) vs overtime.
 * @param {string} ukupno HH:mm
 */
function hasDodatno(ukupno) {
  const [h, m] = String(ukupno).split(':');
  const mins = toMinutes(h, m);
  if (mins <= 8 * 60) return { total: ukupno, dodatno: '00:00' };
  return { total: '08:00', dodatno: toHours(mins - 8 * 60) };
}

/**
 * First start, last end, and break duration between middle pairs (like old app).
 * Breaks between overnight segments also use overnight-aware diffs.
 */
function splitIntervals(radniSatiStrOrArr) {
  const parts = parseRadniSati(radniSatiStrOrArr);
  if (!parts.length) {
    return { pocetak: '-', zavrsetak: '-', prekid: '-', overnight: false, pairs: [] };
  }
  const pairs = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    pairs.push({
      start: parts[i],
      end: parts[i + 1],
      overnight: isOvernightPair(parts[i], parts[i + 1]),
    });
  }
  const pocetak = parts[0];
  const zavrsetak = parts[parts.length - 1];
  let prekid = '-';
  if (parts.length > 2) {
    const pauze = parts.slice(1, -1);
    prekid = timeDifference(pauze);
  }
  return {
    pocetak,
    zavrsetak,
    prekid,
    overnight: pairs.some((p) => p.overnight),
    pairs,
  };
}

/**
 * Client IP as seen by Express. Relies on `app.set('trust proxy', N)` (TRUST_PROXY_HOPS)
 * so X-Forwarded-For is only honoured for the configured number of proxy hops and
 * cannot be spoofed by the client.
 */
function clientIp(req) {
  let ip = req.ip || req.socket?.remoteAddress || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidHm(value) {
  return typeof value === 'string' && HHMM_RE.test(value);
}

/**
 * Validate a stored radni_sati string: space-separated HH:mm values in start/end pairs.
 * @returns {string|null} normalised string, or null when empty
 * @throws {Error} when malformed
 */
function normalizeRadniSati(value) {
  if (value == null) return null;
  const parts = parseRadniSati(value);
  if (!parts.length) return null;
  if (parts.length % 2 !== 0 || !parts.every(isValidHm)) {
    throw new Error('Radni sati moraju biti parovi HH:mm (npr. "07:00 15:00")');
  }
  return parts.join(' ');
}

module.exports = {
  nowTime,
  todayDate,
  appendPeriod,
  toMinutes,
  toHours,
  parseHm,
  parseRadniSati,
  timeDifference,
  intervalMinutes,
  isOvernightPair,
  hasDodatno,
  splitIntervals,
  clientIp,
  isValidHm,
  normalizeRadniSati,
};
