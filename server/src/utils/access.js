/**
 * Access rules.
 *  - Employee (role 1): only their own records.
 *  - Voditelj (role 2): employees of the branch they lead or belong to; may not change their own hours.
 *  - Admin (role >= 3, 4 = SarajevoAdmin): everything.
 */
const pool = require('../db/pool');
const { hoursEditLockDay } = require('../config');

const isAdmin = (reqUser) => Number(reqUser?.role_id) >= 3;
const isModerator = (reqUser) => Number(reqUser?.role_id) === 2;

/** Branch ids a voditelj is responsible for: branches they lead + their own branch. */
async function moderatorBranchIds(userId) {
  const [[led], [own]] = await Promise.all([
    pool.query('SELECT id FROM branches WHERE voditelj_oj=?', [userId]),
    pool.query('SELECT branch_id FROM users WHERE id=?', [userId]),
  ]);
  const ids = new Set(led.map((b) => Number(b.id)));
  if (own[0]?.branch_id != null) ids.add(Number(own[0].branch_id));
  return ids;
}

async function userBranchId(userId) {
  const [rows] = await pool.query('SELECT branch_id FROM users WHERE id=?', [userId]);
  if (!rows[0]) return undefined;
  return rows[0].branch_id == null ? null : Number(rows[0].branch_id);
}

async function isInModeratorScope(reqUser, userId) {
  const [branchIds, targetBranch] = await Promise.all([
    moderatorBranchIds(reqUser.id),
    userBranchId(userId),
  ]);
  return targetBranch != null && branchIds.has(targetBranch);
}

/** Own record, admin, or voditelj of the employee's branch. */
async function canViewUser(reqUser, userId) {
  if (Number(reqUser.id) === Number(userId)) return true;
  if (isAdmin(reqUser)) return true;
  if (isModerator(reqUser)) return isInModeratorScope(reqUser, userId);
  return false;
}

/** Create/edit hours: admin, or voditelj for another employee of their branch. */
async function canManageUserHours(reqUser, userId) {
  if (isAdmin(reqUser)) return true;
  if (!isModerator(reqUser)) return false;
  if (Number(reqUser.id) === Number(userId)) return false;
  return isInModeratorScope(reqUser, userId);
}

/**
 * First date (YYYY-MM-DD) a voditelj may still change, mirroring the old app:
 * until the lock day of the month the previous month is open, afterwards only the current month.
 */
function earliestEditableDate(now = new Date(), lockDay = hoursEditLockDay()) {
  const pad = (n) => String(n).padStart(2, '0');
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  if (lockDay > 0 && now.getDate() <= lockDay) {
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return `${y}-${pad(m)}-01`;
}

/** True when reqUser may change hours dated `dateStr`. Admins are never locked. */
function isDateEditable(reqUser, dateStr, now = new Date(), lockDay = hoursEditLockDay()) {
  if (isAdmin(reqUser) || lockDay === 0) return true;
  return String(dateStr).slice(0, 10) >= earliestEditableDate(now, lockDay);
}

module.exports = {
  isAdmin,
  isModerator,
  moderatorBranchIds,
  canViewUser,
  canManageUserHours,
  earliestEditableDate,
  isDateEditable,
};
