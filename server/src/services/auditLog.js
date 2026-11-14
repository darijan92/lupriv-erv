const pool = require('../db/pool');
const { escapeHtml } = require('../utils/html');

/**
 * Write an entry to `logs` (shown on the admin Logovi page as HTML).
 * All user-supplied values must go through `escapeHtml` / the `b()` helper.
 */
async function writeLog({ userId, branchId, hourId = null, content }, conn = pool) {
  await conn.query(
    'INSERT INTO logs (datum, user_id, branch_id, hour_id, content) VALUES (NOW(), ?, ?, ?, ?)',
    [userId, branchId ?? 0, hourId, content]
  );
}

const b = (v) => `<b>${escapeHtml(v)}</b>`;

function fullName(u) {
  return u ? `${u.ime || ''} ${u.prezime || ''}`.trim() : '?';
}

function formatDmy(dateStr) {
  const [y, m, d] = String(dateStr || '').slice(0, 10).split('-');
  return d ? `${d}.${m}.${y}` : String(dateStr || '');
}

function describeHour(h) {
  if (!h) return '-';
  const parts = [];
  if (h.radni_sati) parts.push(h.radni_sati);
  if (h.temp) parts.push(`aktivno od ${h.temp}`);
  if (h.odsustvo) parts.push(h.odsustvo + (h.odsustvo_time ? ` ${h.odsustvo_time}` : ''));
  return parts.join(', ') || '-';
}

async function getUserBrief(userId) {
  const [rows] = await pool.query('SELECT id, ime, prezime, branch_id FROM users WHERE id=?', [userId]);
  return rows[0] || null;
}

/**
 * Audit a change to hours made by an admin or voditelj.
 * @param {'create'|'update'|'delete'|'stop'|'absence'} action
 */
async function logHoursChange({ actor, targetUserId, before = null, after = null, action, datum, hourId = null, extra = '' }) {
  const [actorRow, target] = await Promise.all([getUserBrief(actor.id), getUserBrief(targetUserId)]);
  const verbs = {
    create: 'je dodao sate',
    update: 'je uredio sate',
    delete: 'je obrisao sate',
    stop: 'je zaustavio aktivno radno vrijeme',
    absence: 'je dodao odsustvo',
  };
  let content = `${b(fullName(actorRow))} ${verbs[action] || action} za korisnika ${b(fullName(target))} za datum ${b(formatDmy(datum))}`;
  if (action === 'update') content += `: ${b(describeHour(before))} → ${b(describeHour(after))}`;
  else if (action === 'delete') content += `: ${b(describeHour(before))}`;
  else if (after) content += `: ${b(describeHour(after))}`;
  if (extra) content += ` ${escapeHtml(extra)}`;
  const branchId = after?.branch_id ?? before?.branch_id ?? target?.branch_id ?? actorRow?.branch_id ?? 0;
  await writeLog({ userId: actor.id, branchId, hourId, content });
}

module.exports = { writeLog, logHoursChange, describeHour, formatDmy, b };
