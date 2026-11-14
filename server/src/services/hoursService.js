const pool = require('../db/pool');
const { buildMonthView, NIGHT_LABEL } = require('./hoursCalc');
const { isValidHm, nowTime, appendPeriod, normalizeRadniSati } = require('../utils/time');
const { nullsLastOrder } = require('../utils/sqlSort');
const { isStaleSession, planStaleClose } = require('./sessionRules');

function badRequest(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Longest absence range accepted in one request (guards against typos like 2026 → 2062). */
const MAX_ABSENCE_DAYS = 366;

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
  const spanDays = Math.round((end - start) / 86400000) + 1;
  if (spanDays > MAX_ABSENCE_DAYS) {
    throw badRequest(`Odsustvo može obuhvatiti najviše ${MAX_ABSENCE_DAYS} dana`);
  }

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

async function getHour(id) {
  const [rows] = await pool.query('SELECT * FROM hours WHERE id=?', [id]);
  return rows[0] || null;
}

/**
 * Partial update: only fields present in `body` are changed, so an omitted `temp`
 * can no longer silently close (and lose) an active session.
 */
async function updateHours(id, body) {
  const sets = [];
  const vals = [];
  const set = (col, val) => {
    sets.push(`${col}=?`);
    vals.push(val);
  };

  if (Array.isArray(body.intervals)) {
    const parts = [];
    for (const iv of body.intervals) {
      if (!iv.start || !iv.end) continue;
      if (!isValidHm(iv.start) || !isValidHm(iv.end)) {
        throw badRequest('Vrijeme nepravilno uneseno (HH:mm)');
      }
      parts.push(iv.start, iv.end);
    }
    set('radni_sati', parts.length ? parts.join(' ') : null);
  } else if (body.radni_sati !== undefined) {
    try {
      set('radni_sati', normalizeRadniSati(body.radni_sati));
    } catch (e) {
      throw badRequest(e.message);
    }
  }

  if (body.temp !== undefined) {
    const temp = body.temp === '' ? null : body.temp;
    if (temp !== null && !isValidHm(temp)) throw badRequest('Aktivno vrijeme mora biti HH:mm');
    set('temp', temp);
  }
  if (body.nocni_rad) set('odsustvo', NIGHT_LABEL);
  else if (body.odsustvo !== undefined) set('odsustvo', body.odsustvo || null);
  if (body.odsustvo_time !== undefined) {
    const t = body.odsustvo_time || null;
    if (t !== null && !/^\d{1,2}:[0-5]\d$/.test(t)) throw badRequest('Trajanje odsustva mora biti HH:mm');
    set('odsustvo_time', t);
  }
  if (body.napomena !== undefined) set('napomena', body.napomena || null);
  if (body.branch_id !== undefined) set('branch_id', body.branch_id || null);

  if (!sets.length) throw badRequest('Nema podataka za spremanje');
  vals.push(id);
  await pool.query(`UPDATE hours SET ${sets.join(', ')} WHERE id=?`, vals);
  return { success: 'Sati ažurirani' };
}

/**
 * Run `fn(conn)` in a transaction holding a row lock on the user, so two quick
 * check-ins/outs for the same person cannot interleave (no duplicate open sessions).
 */
async function withUserLock(userId, fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * Most recent open session (any date), so overnight shifts can be checked out next morning.
 * Carries the branch's working hours for the auto-close rules.
 */
async function findOpenSession(userId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT h.*, b.pocetak_rv AS branch_pocetak_rv, b.kraj_rv AS branch_kraj_rv
     FROM hours h LEFT JOIN branches b ON b.id = h.branch_id
     WHERE h.user_id=? AND h.temp IS NOT NULL
     ORDER BY h.datum DESC, h.id DESC LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

/**
 * Close an open session by rule (auto-logout / forgotten check-out) and log it.
 * Uses the caller's transaction when `conn` is given, otherwise its own.
 * @returns {Promise<boolean>} false when the session was already closed meanwhile
 */
async function autoCloseSession(hour, plan, conn = null, notePrefix = '') {
  const radni = appendPeriod(hour.radni_sati, hour.temp, plan.endStr);
  const note = `${notePrefix}${plan.note}`;
  const nap = `${note}${hour.napomena ? ` ${hour.napomena}` : ''}`.trim();
  const run = async (c) => {
    // temp IS NOT NULL guard: skip if the employee checked out meanwhile.
    const [r] = await c.query(
      'UPDATE hours SET radni_sati=?, temp=NULL, napomena=? WHERE id=? AND temp IS NOT NULL',
      [radni, nap, hour.id]
    );
    if (!r.affectedRows) return false;
    await c.query(
      'INSERT INTO logs (datum, user_id, branch_id, hour_id, content) VALUES (NOW(),?,?,?,?)',
      [hour.user_id, hour.branch_id ?? 0, hour.id, note]
    );
    return true;
  };
  if (conn) return run(conn);
  const own = await pool.getConnection();
  try {
    await own.beginTransaction();
    const done = await run(own);
    await own.commit();
    return done;
  } catch (e) {
    await own.rollback().catch(() => {});
    throw e;
  } finally {
    own.release();
  }
}

/**
 * Close this user's stale sessions (forgotten check-outs from earlier days) by the
 * auto-logout rules. Call inside withUserLock.
 * @returns {Promise<{ open: object|null, closed: Array<{ datum: string, endStr: string }> }>}
 *          `open` is the remaining genuinely open session, if any.
 */
async function closeStaleSessions(userId, conn) {
  const closed = [];
  for (let i = 0; i < 10; i++) {
    const open = await findOpenSession(userId, conn);
    if (!open || !isStaleSession(open)) return { open, closed };
    const plan = planStaleClose(open);
    await autoCloseSession(open, plan, conn);
    closed.push({ datum: String(open.datum).slice(0, 10), endStr: plan.endStr });
  }
  return { open: await findOpenSession(userId, conn), closed };
}

/** Start radno vrijeme: reopen today's row for this branch, or insert a new one. */
async function startWork(userId, branchId, today, conn = pool) {
  const [existing] = await conn.query(
    'SELECT * FROM hours WHERE datum=? AND user_id=? AND branch_id=?',
    [today, userId, branchId]
  );
  if (existing[0]) {
    await conn.query('UPDATE hours SET temp=? WHERE id=?', [nowTime(), existing[0].id]);
  } else {
    await conn.query(
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
  // 403, not 401: the client treats 401 as an expired session and would log the admin out.
  if (!admin || !(await verifyPasswordFn(password || '', admin.password))) {
    throw badRequest('Pogrešna administratorska lozinka', 403);
  }
  const [rows] = await pool.query(
    `SELECT h.*, b.pocetak_rv AS branch_pocetak_rv, b.kraj_rv AS branch_kraj_rv
     FROM hours h LEFT JOIN branches b ON b.id = h.branch_id WHERE h.id=?`,
    [hourId]
  );
  const hour = rows[0];
  if (!hour || !hour.temp) throw badRequest('Nema aktivnog RV');
  const prefix = 'Odjava od administratora! ';
  if (isStaleSession(hour)) {
    // A forgotten check-out from an earlier day: "now" would be a bogus end time.
    await autoCloseSession(hour, planStaleClose(hour), null, prefix);
  } else {
    const radni = appendPeriod(hour.radni_sati, hour.temp, nowTime());
    const nap = `${prefix}${hour.napomena || ''}`.trim();
    await pool.query(
      'UPDATE hours SET radni_sati=?, temp=NULL, napomena=? WHERE id=? AND temp IS NOT NULL',
      [radni, nap, hour.id]
    );
  }
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
  getHour,
  withUserLock,
  findOpenSession,
  autoCloseSession,
  closeStaleSessions,
  MAX_ABSENCE_DAYS,
  deleteHours,
  startWork,
  listActive,
  adminStop,
};
