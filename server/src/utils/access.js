/**
 * Own record, or privileged (voditelj role 2 / admin role >= 3). Prevents employee IDOR.
 * Note: role_id >= 3 is admin by design (4 = SarajevoAdmin).
 */
function canViewUser(reqUser, userId) {
  const isOwn = Number(reqUser.id) === Number(userId);
  const role = Number(reqUser.role_id);
  return isOwn || role === 2 || role >= 3;
}

module.exports = { canViewUser };
