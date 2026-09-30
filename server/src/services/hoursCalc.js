/**
 * Single source of truth for month totals and export row fields.
 */
const {
  parseRadniSati,
  timeDifference,
  hasDodatno,
  toMinutes,
  toHours,
  splitIntervals,
} = require('../utils/time');
const { computePrekid, earliestStart } = require('../utils/prekid');

// Legacy placenaOdsustva — do NOT include Neplaćeno / Odsustvo na zahtjev radnika / Službeni put
// (those only count when odsustvo_time is set).
const PAID_ABSENCES = [
  'Godišnji odmor',
  'Praznici',
  'Bolovanje',
  'Porodiljni dopust',
  'Plaćeno odsustvo',
];

const NIGHT_LABEL = 'Noćni rad';

function formatDatumDm(dateStr) {
  if (!dateStr) return '-';
  const s = String(dateStr).slice(0, 10);
  const [, m, d] = s.split('-');
  if (!d) return s;
  return `${d}-${m}`;
}

/**
 * Compute ukupno / total / dodatno / pocetak / zavrsetak for one hour row.
 * (Prekid comes from buildDayPrekidMap, not from gaps between intervals.)
 */
function computeHourTotals(hour) {
  const radni = parseRadniSati(hour.radni_sati);
  let total = '-';
  let dodatno = '-';
  let ukupno = '-';
  let pocetak = '-';
  let zavrsetak = '-';
  let overnight = false;

  // Flat night work (legacy): odsustvo = Noćni rad without times → 08:00
  if (hour.odsustvo === NIGHT_LABEL && !radni.length && !hour.odsustvo_time) {
    return {
      radni,
      total: '08:00',
      dodatno: '00:00',
      ukupno: '08:00',
      pocetak: '-',
      zavrsetak: '-',
      overnight: true,
      isNightShift: true,
    };
  }

  if (hour.odsustvo_time) {
    ukupno = hour.odsustvo_time;
    const hd = hasDodatno(ukupno);
    total = hd.total;
    dodatno = hd.dodatno;
  } else if (hour.odsustvo && PAID_ABSENCES.includes(hour.odsustvo) && !radni.length) {
    total = '08:00';
    dodatno = '00:00';
    ukupno = '08:00';
  }

  if (radni.length) {
    ukupno = timeDifference(radni);
    const hd = hasDodatno(ukupno);
    total = hd.total;
    dodatno = hd.dodatno;
    const split = splitIntervals(radni);
    pocetak = split.pocetak;
    zavrsetak = split.zavrsetak;
    overnight = split.overnight;
  }

  const isNightShift = hour.odsustvo === NIGHT_LABEL || overnight;

  return {
    radni,
    total,
    dodatno,
    ukupno,
    pocetak,
    zavrsetak,
    overnight,
    isNightShift,
  };
}

function userKeyOf(h) {
  return h.user_id != null ? String(h.user_id) : '_';
}

/** Days of the month (1-based) that fall on Sunday. */
function sundaysOf(year, month, daysInMonth) {
  const sundays = new Set();
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(year, month - 1, d).getDay() === 0) sundays.add(d);
  }
  return sundays;
}

/** Hours grouped by day-of-month (from datum YYYY-MM-DD). */
function groupByDay(hours) {
  const byDay = {};
  for (const h of hours) {
    const day = Number(String(h.datum).slice(8, 10));
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(h);
  }
  return byDay;
}

/** Prekid range for the first work row of an employee+day, '-' for every other row. */
function prekidForRow(h, day, prekidMap) {
  const info = prekidMap.get(`${userKeyOf(h)}|${day}`);
  const isFirstWorkRow =
    info &&
    info.prekid &&
    info.firstWorkHourId != null &&
    (h.id != null ? h.id === info.firstWorkHourId : h === info.firstWorkHourId);
  return isFirstWorkRow ? info.prekid : '-';
}

function addToTotals(totals, ukupno, total, dodatno) {
  if (ukupno === '-' || !ukupno) return;
  const [uh, um] = ukupno.split(':');
  const [th, tm] = total.split(':');
  const [dh, dm] = dodatno.split(':');
  totals.ukupno += toMinutes(uh, um);
  totals.total += toMinutes(th, tm);
  totals.dodatno += toMinutes(dh, dm);
}

/**
 * Month grid for UI (all days).
 * Prekid uses the same automatic rule as Excel export (not splitIntervals gap duration):
 * 30 min starting 2.5h after first check-in of the employee+day, on first work row only.
 */
function buildMonthView(hours, year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const sundays = sundaysOf(year, month, daysInMonth);
  const byDay = groupByDay(hours);
  const prekidMap = buildDayPrekidMap(byDay);
  const rows = [];
  const totals = { ukupno: 0, total: 0, dodatno: 0 };

  for (let d = 1; d <= daysInMonth; d++) {
    const list = byDay[d] || [];
    if (!list.length) {
      rows.push({
        dan: d,
        nedjelja: sundays.has(d),
        id: null,
        datum: null,
        radni_sati: [],
        odsustvo: null,
        odsustvo_time: null,
        napomena: null,
        naziv_oj: '-',
        total: '-',
        dodatno: '-',
        ukupno: '-',
        temp: null,
        branch_id: null,
        user_id: null,
        overnight: false,
        isNightShift: false,
        pocetak: '-',
        zavrsetak: '-',
        prekid: '-',
      });
      continue;
    }
    list.forEach((h, idx) => {
      const calc = computeHourTotals(h);
      addToTotals(totals, calc.ukupno, calc.total, calc.dodatno);
      const prekid = prekidForRow(h, d, prekidMap);
      rows.push({
        dan: idx === 0 ? d : '…',
        nedjelja: sundays.has(d),
        id: h.id,
        datum: h.datum,
        radni_sati: calc.radni,
        odsustvo: h.odsustvo,
        odsustvo_time: h.odsustvo_time,
        napomena: h.napomena || '',
        naziv_oj: h.naziv_oj || '-',
        branch_id: h.branch_id,
        user_id: h.user_id,
        temp: h.temp,
        total: calc.total,
        dodatno: calc.dodatno,
        ukupno: calc.ukupno,
        overnight: calc.overnight,
        isNightShift: calc.isNightShift,
        pocetak: calc.pocetak,
        zavrsetak: calc.zavrsetak,
        prekid,
      });
    });
  }

  return {
    days: rows,
    zbroj: {
      ukupno: toHours(totals.ukupno),
      total: toHours(totals.total),
      dodatno: toHours(totals.dodatno),
    },
  };
}

/**
 * Collect interval start times from a work-hour record (ignore absence-only).
 * @param {object} hour
 * @returns {string[]}
 */
function collectStartsFromHour(hour) {
  const radni = parseRadniSati(hour.radni_sati);
  const starts = [];
  for (let i = 0; i + 1 < radni.length; i += 2) {
    if (radni[i]) starts.push(radni[i]);
  }
  return starts;
}

/**
 * Per employee+day: earliest first check-in, and which hour id gets Prekid
 * (first work row that has a usable start). Key = `${userKey}|${day}`.
 */
function buildDayPrekidMap(byDay) {
  const map = new Map();
  for (const [day, list] of Object.entries(byDay)) {
    const byUser = new Map();
    for (const h of list) {
      const userKey = userKeyOf(h);
      if (!byUser.has(userKey)) byUser.set(userKey, []);
      byUser.get(userKey).push(h);
    }
    for (const [userKey, userHours] of byUser) {
      const starts = [];
      let firstWorkHourId = null;
      for (const h of userHours) {
        const hStarts = collectStartsFromHour(h);
        if (hStarts.length) {
          if (firstWorkHourId == null) firstWorkHourId = h.id != null ? h.id : h;
          starts.push(...hStarts);
        }
      }
      const first = earliestStart(starts);
      const prekid = first ? computePrekid(first) : '';
      map.set(`${userKey}|${day}`, { prekid, firstWorkHourId });
    }
  }
  return map;
}

/**
 * Rows for Excel (includes empty days).
 * Prekid is filled automatically: 30 min break starting 2.5h after first
 * check-in of that employee+day (rounded to nearest 15 min). Not from DB.
 */
function buildExportRows(hours, year, month, { nameFn } = {}) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const sundays = sundaysOf(year, month, daysInMonth);
  const byDay = groupByDay(hours);
  const prekidMap = buildDayPrekidMap(byDay);
  const rows = [];
  const totals = { ukupno: 0, total: 0, dodatno: 0 };

  for (let d = 1; d <= daysInMonth; d++) {
    const list = byDay[d] || [];
    if (!list.length) {
      const dd = String(d).padStart(2, '0');
      const mm = String(month).padStart(2, '0');
      rows.push({
        datum: `${dd}-${mm}`,
        naziv_oj: '-',
        imePrezime: '-',
        pocetak: '-',
        zavrsetak: '-',
        prekid: '-',
        total: '-',
        dodatno: '-',
        odsustvo: '-',
        ukupno: '-',
        napomenaFlag: '-',
        nedjelja: sundays.has(d),
        overnight: false,
        isNightShift: false,
      });
      continue;
    }
    for (const h of list) {
      const calc = computeHourTotals(h);
      addToTotals(totals, calc.ukupno, calc.total, calc.dodatno);
      let odsustvoDisplay = h.odsustvo || '-';
      if (calc.isNightShift && calc.overnight && calc.pocetak !== '-') {
        odsustvoDisplay = `${odsustvoDisplay === '-' ? 'Noćna smjena' : odsustvoDisplay} ${calc.pocetak}–${calc.zavrsetak}`;
      } else if (calc.isNightShift && odsustvoDisplay === '-') {
        odsustvoDisplay = NIGHT_LABEL;
      }

      const prekid = prekidForRow(h, d, prekidMap);

      rows.push({
        datum: formatDatumDm(h.datum),
        naziv_oj: h.naziv_oj || '-',
        imePrezime:
          (nameFn && nameFn(h)) ||
          h.imePrezime ||
          `${h.ime || ''} ${h.prezime || ''}`.trim() ||
          '-',
        pocetak: calc.pocetak,
        zavrsetak: calc.zavrsetak,
        prekid,
        total: calc.total,
        dodatno: calc.dodatno,
        odsustvo: odsustvoDisplay,
        ukupno: calc.ukupno,
        napomenaFlag: h.napomena ? 'X' : '-',
        nedjelja: sundays.has(d),
        overnight: calc.overnight,
        isNightShift: calc.isNightShift,
      });
    }
  }

  return {
    rows,
    zbroj: {
      ukupno: toHours(totals.ukupno),
      total: toHours(totals.total),
      dodatno: toHours(totals.dodatno),
    },
  };
}

module.exports = {
  PAID_ABSENCES,
  NIGHT_LABEL,
  computeHourTotals,
  buildMonthView,
  buildExportRows,
  formatDatumDm,
};
