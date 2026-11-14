/**
 * Small in-memory limiter for password attempts (login + kiosk).
 * Counts failed attempts per IP+username and per IP. A shared kiosk serves many
 * employees from one IP, so the per-IP ceiling is deliberately generous.
 * Single-process only (one API container); state resets on restart.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_USER = 10;
const MAX_PER_IP = 100;

const store = new Map();

/** Current entry, or null when absent/expired. Never creates one (reads must not grow the map). */
function peek(key, now) {
  const e = store.get(key);
  return e && now - e.first <= WINDOW_MS ? e : null;
}

function entry(key, now) {
  const e = peek(key, now);
  if (e) return e;
  const fresh = { count: 0, first: now };
  store.set(key, fresh);
  return fresh;
}

/**
 * MySQL compares usernames case- and accent-insensitively ("Ána" = "ana"), so fold the same
 * way; otherwise spelling variants would each get their own attempt budget.
 */
function normalizeUsername(username) {
  return String(username || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .slice(0, 64);
}

function keys(ip, username) {
  return {
    user: `u|${ip}|${normalizeUsername(username)}`,
    ip: `i|${ip}`,
  };
}

/** @returns {number} seconds to wait, or 0 when allowed */
function retryAfter(ip, username, now = Date.now()) {
  const k = keys(ip, username);
  const u = peek(k.user, now);
  const i = peek(k.ip, now);
  if (u && u.count >= MAX_PER_USER) return Math.ceil((u.first + WINDOW_MS - now) / 1000);
  if (i && i.count >= MAX_PER_IP) return Math.ceil((i.first + WINDOW_MS - now) / 1000);
  return 0;
}

function recordFailure(ip, username, now = Date.now()) {
  const k = keys(ip, username);
  entry(k.user, now).count += 1;
  entry(k.ip, now).count += 1;
}

function recordSuccess(ip, username) {
  store.delete(keys(ip, username).user);
}

function _reset() {
  store.clear();
}

function _size() {
  return store.size;
}

// Drop stale entries so the map cannot grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of store) if (now - e.first > WINDOW_MS) store.delete(k);
}, WINDOW_MS).unref();

module.exports = {
  WINDOW_MS,
  MAX_PER_USER,
  MAX_PER_IP,
  retryAfter,
  recordFailure,
  recordSuccess,
  normalizeUsername,
  _reset,
  _size,
};
