/**
 * Runtime configuration checks.
 * In production the API refuses to start with missing or publicly known secrets,
 * because the defaults in this (public) repo would let anyone forge an admin token.
 */

const KNOWN_DEFAULT_SECRETS = new Set([
  'lupriv_dev_secret_change_me',
  'change_me_to_a_long_random_string',
  'change_me_to_a_long_random_string_at_least_32_chars',
  'change_me_auto_logout_secret',
  'change_me_long_random_auto_logout_secret',
]);

const MIN_SECRET_LENGTH = 32;

function isProduction(env = process.env) {
  return env.NODE_ENV === 'production';
}

/** @returns {string[]} human-readable problems; empty when OK */
function productionSecretProblems(env = process.env) {
  const problems = [];
  const jwt = env.JWT_SECRET || '';
  if (!jwt) problems.push('JWT_SECRET nije postavljen');
  else if (KNOWN_DEFAULT_SECRETS.has(jwt)) problems.push('JWT_SECRET je zadana (javna) vrijednost');
  else if (jwt.length < MIN_SECRET_LENGTH) problems.push(`JWT_SECRET mora imati barem ${MIN_SECRET_LENGTH} znakova`);

  const auto = env.AUTO_LOGOUT_SECRET || '';
  if (auto && KNOWN_DEFAULT_SECRETS.has(auto)) {
    problems.push('AUTO_LOGOUT_SECRET je zadana (javna) vrijednost');
  }
  return problems;
}

/**
 * Throws in production when secrets are unsafe, unless ALLOW_INSECURE_DEFAULTS=1
 * (local prod-like Docker testing only).
 */
function assertSafeConfig(env = process.env) {
  if (!isProduction(env)) return;
  const problems = productionSecretProblems(env);
  if (!problems.length) return;
  if (env.ALLOW_INSECURE_DEFAULTS === '1') {
    console.warn(`UPOZORENJE (ALLOW_INSECURE_DEFAULTS=1): ${problems.join('; ')}`);
    return;
  }
  throw new Error(
    `Nesigurna konfiguracija: ${problems.join('; ')}. ` +
      'Postavite jake tajne u .env (vidi .env.docker.example).'
  );
}

/** Kiosk may trust a client-chosen branch id only when explicitly allowed (dev default). */
function kioskAllowsExplicitBranch(env = process.env) {
  const v = env.KIOSK_ALLOW_BRANCH_QUERY;
  if (v == null || v === '') return !isProduction(env);
  return v === '1' || v === 'true';
}

/** Number of reverse-proxy hops in front of the API (nginx = 1, Caddy + nginx = 2). */
function trustProxyHops(env = process.env) {
  const n = Number(env.TRUST_PROXY_HOPS ?? 1);
  return Number.isInteger(n) && n >= 0 ? n : 1;
}

/** Day of month until which voditelji may still edit the previous month (0 = no lock). */
function hoursEditLockDay(env = process.env) {
  const n = Number(env.HOURS_EDIT_LOCK_DAY ?? 5);
  return Number.isInteger(n) && n >= 0 && n <= 28 ? n : 5;
}

/** Minutes added to branch kraj_rv when auto-logout closes a forgotten day session. */
function autoLogoutExtraMinutes(env = process.env) {
  const n = Number(env.AUTO_LOGOUT_EXTRA_MINUTES ?? 0);
  return Number.isInteger(n) && n >= 0 && n <= 6 * 60 ? n : 0;
}

/** An open session older than this (and from an earlier date) is treated as a forgotten check-out. */
function maxOpenSessionHours(env = process.env) {
  const n = Number(env.MAX_OPEN_SESSION_HOURS ?? 16);
  return Number.isFinite(n) && n >= 8 && n <= 48 ? n : 16;
}

module.exports = {
  KNOWN_DEFAULT_SECRETS,
  MIN_SECRET_LENGTH,
  isProduction,
  productionSecretProblems,
  assertSafeConfig,
  kioskAllowsExplicitBranch,
  trustProxyHops,
  hoursEditLockDay,
  autoLogoutExtraMinutes,
  maxOpenSessionHours,
};
