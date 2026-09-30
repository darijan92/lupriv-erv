const pool = require('../db/pool');
const { buildMonthView, NIGHT_LABEL } = require('./hoursCalc');
const { isValidHm, nowTime, appendPeriod } = require('../utils/time');
const { nullsLastOrder } = require('../utils/sqlSort');

function badRequest(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function eventExistsError(dateStr) {
  return badRequest(`Greška, na datum ${dateStr} postoji događaj.`);
}

/** [first day of month, first day of next month) as YYYY-MM-DD — index-friendly datum range. */
function monthRange(month, year) {
  const m = Number(month);
  const y = Number(year);
  const pad = (n) => String(n).padStart(2, '0');
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  return [`${y}-${pad(m)}-01`, next];
}

async function getUserPublic(userId) {
  const [users] = await pool.query(
    `SELECT u.id, u.ime, u.prezime, u.username, u.branch_id, b.naziv_oj
     FROM users u LEFT JOIN branches b ON b.id=u.branch_id WHERE u.id=?`,
    [userId]
  );
  return users[0] || null;
}

async function getHoursForUserMonth(userId, month, year) {
  const [hours] = await pool.query(
    `SELECT h.*, b.naziv_oj FROM hours h
     LEFT JOIN branches b ON b.id=h.branch_id
     WHERE h.user_id=? AND h.datum >= ? AND h.datum < ?
     ORDER BY ${nullsLastOrder('h.datum')}, ${nullsLastOrder('h.id')}`,
    [userId, ...monthRange(month, year)]
  );
  return hours;
}

async function getHoursForBranchMonth(branchId, month, year) {
  const [hours] = await pool.query(
    `SELECT h.*, b.naziv_oj, u.ime, u.prezime, u.username,
            CONCAT(u.ime, ' ', u.prezime) AS imePrezime
     FROM hours h
     LEFT JOIN branches b ON b.id=h.branch_id
     JOIN users u ON u.id=h.user_id
     WHERE h.branch_id=? AND h.datum >= ? AND h.datum < ?
     ORDER BY ${nullsLastOrder('h.datum')}, ${nullsLastOrder('u.prezime')}, ${nullsLastOrder('u.ime')}, ${nullsLastOrder('h.id')}`,
    [branchId, ...monthRange(month, year)]
  );
  return hours;
}

async function monthOverview(userId, month, year) {
  const [user, hours] = await Promise.all([
    getUserPublic(userId),
    getHoursForUserMonth(userId, month, year),
  ]);
  if (!user) return null;
  const view = buildMonthView(hours, year, month);
  return { user, month, year, ...view };
}

async function assertNoEventOnDate(userId, dateStr) {
  const [ex] = await pool.query('SELECT id FROM hours WHERE user_id=? AND datum=?', [userId, dateStr]);
  return ex.length === 0;
}

/**
 * Create night shift / overnight work.
 * - With start+end (may cross midnight): stores radni_sati + odsustvo "Noćni rad"
 * - Without times: legacy flat 08:00 night work
 */
async function createNightShift({
  user_id,
  datum,
  branch_id,
  start,
  end,
  napomena,
}) {
  const dateStr = String(datum).slice(0, 10);
  if (!(await assertNoEventOnDate(user_id, dateStr))) throw eventExistsError(dateStr);

  let radni_sati = null;
  if (start || end) {
    if (!isValidHm(start) || !isValidHm(end)) {
      throw badRequest('Vrijeme smjene mora biti u formatu HH:mm (dozvoljen prelazak preko ponoći)');
    }
    radni_sati = `${start} ${end}`;
  }

  const [r] = await pool.query(
    `INSERT INTO hours (datum, radni_sati, user_id, branch_id, odsustvo, odsustvo_time, napomena)
     VALUES (?,?,?,?,?,?,?)`,
    [dateStr, radni_sati, user_id, branch_id || null, NIGHT_LABEL, null, napomena || null]
  );
  const overnight = !!(start && end && end < start);
  return { id: r.insertId, success: 'Noćna smjena spremljena', overnight, flat: !radni_sati };
}

async function createAbsenceRange({
  user_id,
  pocetak,
  kraj,
  odsustvo,
  odsustvo_time,
  napomena,
  branch_id,
  skip_saturday,
  skip_sunday,
}) {
  const parseYmd = (s) => {
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) throw badRequest('Nepravilno uneseni datumi');
    return new Date(y, m - 1, d);
  };
  const toYmd = (dt) => {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const start = parseYmd(pocetak);
  const end = parseYmd(kraj);
  if (start > end) throw badRequest('Nepravilno uneseni datumi');

  const dates = [];
  for (let d = new Date(start.getTime()); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (skip_saturday && dow === 6) continue;
    if (skip_sunday && dow === 0) continue;
    dates.push(toYmd(d));
  }
  if (dates.length) {
    // One range query instead of one lookup per day.
    const [existing] = await pool.query(
      'SELECT datum FROM hours WHERE user_id=? AND datum BETWEEN ? AND ?',
      [user_id, dates[0], dates[dates.length - 1]]
    );
    const taken = new Set(existing.map((r) => String(r.datum).slice(0, 10)));
    const conflict = dates.find((dateStr) => taken.has(dateStr));
    if (conflict) throw eventExistsError(conflict);
  }
  const rows = dates.map((dateStr) => [
    dateStr,
    user_id,
    branch_id || null,
    odsustvo,
    odsustvo_time || null,
    napomena || null,
  ]);
  if (rows.length) {
    await pool.query(
      `INSERT INTO hours (datum, user_id, branch_id, odsustvo, odsustvo_time, napomena) VALUES ?`,
      [rows]
    );
  }
  return { success: 'Uspješno dodano odsustvo.', count: rows.length };
}

/**
 * Create normal day hours. Intervals may be overnight (end < start OK).
 */
async function createDayHours({
  user_id,
  datum,
  branch_id,
  intervals,
  odsustvo,
  odsustvo_time,
  napomena,
  nocni_rad,
}) {
  const dateStr = String(datum).slice(0, 10);
  if (!(await assertNoEventOnDate(user_id, dateStr))) throw eventExistsError(dateStr);

  let radni_sati = null;
  let odsustvoVal = odsustvo || null;
  if (nocni_rad) odsustvoVal = NIGHT_LABEL;

  if (Array.isArray(intervals) && intervals.length) {
    const parts = [];
    for (const iv of intervals) {
      if (!isValidHm(iv.start) || !isValidHm(iv.end)) {
        throw badRequest('Vrijeme nepravilno uneseno (HH:mm); noćna smjena smije imati kraj < početak');
      }
      parts.push(iv.start, iv.end);
    }
    radni_sati = parts.join(' ');
  }

  const [r] = await pool.query(
    `INSERT INTO hours (datum, radni_sati, user_id, branch_id, odsustvo, odsustvo_time, napomena)
     VALUES (?,?,?,?,?,?,?)`,
    [dateStr, radni_sati, user_id, branch_id || null, odsustvoVal, odsustvo_time || null, napomena || null]
  );
  return { id: r.insertId, success: 'Uspješno dodani radni sati' };
}

async function updateHours(id, body) {
  let radni_sati = body.radni_sati;
  if (Array.isArray(body.intervals)) {
    const parts = [];
    for (const iv of body.intervals) {
      if (!iv.start || !iv.end) continue;
      if (!isValidHm(iv.start) || !isValidHm(iv.end)) {
        throw badRequest('Vrijeme nepravilno uneseno (HH:mm)');
      }
      parts.push(iv.start, iv.end);
    }
    radni_sati = parts.length ? parts.join(' ') : null;
  } else if (typeof radni_sati === 'string') {
    radni_sati = radni_sati.trim() || null;
  }

  let odsustvo = body.odsustvo ?? null;
  if (body.nocni_rad) odsustvo = NIGHT_LABEL;

  await pool.query(
    `UPDATE hours SET radni_sati=?, branch_id=?, odsustvo=?, odsustvo_time=?, napomena=?, temp=? WHERE id=?`,
    [
      radni_sati ?? null,
      body.branch_id ?? null,
      odsustvo,
      body.odsustvo_time ?? null,
      body.napomena ?? null,
      body.temp === undefined ? null : body.temp,
      id,
    ]
  );
  return { success: 'Sati ažurirani' };
}

/** Start radno vrijeme: reopen today's row for this branch, or insert a new one. */
async function startWork(userId, branchId, today) {
  const [existing] = await pool.query(
    'SELECT * FROM hours WHERE datum=? AND user_id=? AND branch_id=?',
    [today, userId, branchId]
  );
  if (existing[0]) {
    await pool.query('UPDATE hours SET temp=? WHERE id=?', [nowTime(), existing[0].id]);
  } else {
    await pool.query(
      'INSERT INTO hours (datum, temp, user_id, branch_id) VALUES (?,?,?,?)',
      [today, nowTime(), userId, branchId]
    );
  }
}

async function deleteHours(id) {
  await pool.query('DELETE FROM hours WHERE id=?', [id]);
  return { success: 'Obrisano' };
}

async function listActive() {
  const [hours] = await pool.query(
    `SELECT h.*, u.ime, u.prezime, u.username, b.naziv_oj
     FROM hours h
     JOIN users u ON u.id=h.user_id
     LEFT JOIN branches b ON b.id=h.branch_id
     WHERE h.temp IS NOT NULL
     ORDER BY ${nullsLastOrder('h.branch_id')}, ${nullsLastOrder('h.temp')}`
  );
  return hours;
}

async function adminStop(hourId, adminUserId, password, verifyPasswordFn) {
  const [admins] = await pool.query('SELECT * FROM users WHERE id=?', [adminUserId]);
  const admin = admins[0];
  if (!admin || !(await verifyPasswordFn(password || '', admin.password))) {
    throw badRequest('Pogrešna administratorska lozinka', 401);
  }
  const [rows] = await pool.query('SELECT * FROM hours WHERE id=?', [hourId]);
  const hour = rows[0];
  if (!hour || !hour.temp) throw badRequest('Nema aktivnog RV');
  const radni = appendPeriod(hour.radni_sati, hour.temp, nowTime());
  const nap = `Odjava od administratora! ${hour.napomena || ''}`.trim();
  await pool.query('UPDATE hours SET radni_sati=?, temp=NULL, napomena=? WHERE id=?', [radni, nap, hour.id]);
  return { success: 'Uspješno odjavljen korisnik' };
}

module.exports = {
  getUserPublic,
  getHoursForUserMonth,
  getHoursForBranchMonth,
  monthOverview,
  createNightShift,
  createAbsenceRange,
  createDayHours,
  updateHours,
  deleteHours,
  startWork,
  listActive,
  adminStop,
};
