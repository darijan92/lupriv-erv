/**
 * Smoke cases for night-shift deferred auto-logout (no DB writes).
 * Run: node scripts/smokeAutoLogoutNight.js
 */
const assert = require('assert');
const path = require('path');

// Load helpers without hitting DB for classify/resolve
const {
  classifyOpenSession,
  resolveNightEndHm,
  resolveDayEndHm,
  toDateStr,
  isNightStart,
  FALLBACK_POCETAK_RV,
  FALLBACK_KRAJ_RV,
  AUTO_LOGOUT_NOTE,
  AUTO_LOGOUT_NOTE_NIGHT,
} = require('../src/routes/autoLogout');
const { appendPeriod, intervalMinutes, isOvernightPair, timeDifference } = require('../src/utils/time');

const today = '2026-09-24';
const yesterday = '2026-09-23';

function case_(name, fn) {
  try {
    fn();
    console.log(`  OK  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}: ${e.message}`);
    throw e;
  }
}

console.log('=== classifyOpenSession ===');
case_('A day today 09:00 → day', () => {
  assert.strictEqual(classifyOpenSession({ temp: '09:00', datum: today }, today), 'day');
});
case_('A day today 19:59 → day', () => {
  assert.strictEqual(classifyOpenSession({ temp: '19:59', datum: today }, today), 'day');
});
case_('B night today 20:00 → night_today', () => {
  assert.strictEqual(classifyOpenSession({ temp: '20:00', datum: today }, today), 'night_today');
});
case_('B night today 22:00 → night_today', () => {
  assert.strictEqual(classifyOpenSession({ temp: '22:00', datum: today }, today), 'night_today');
});
case_('C night yesterday 22:00 → night_previous', () => {
  assert.strictEqual(classifyOpenSession({ temp: '22:00', datum: yesterday }, today), 'night_previous');
});
case_('C night older 22:00 → night_previous', () => {
  assert.strictEqual(classifyOpenSession({ temp: '22:15', datum: '2026-09-20' }, today), 'night_previous');
});
case_('day previous date still day (not night)', () => {
  assert.strictEqual(classifyOpenSession({ temp: '08:00', datum: yesterday }, today), 'day');
});
case_('boundary 20:00 is night', () => {
  assert.strictEqual(isNightStart('20:00'), true);
  assert.strictEqual(isNightStart('19:59'), false);
});

console.log('=== resolveNightEndHm / pocetak_rv ===');
case_('valid pocetak_rv 07:30', () => {
  assert.deepStrictEqual(resolveNightEndHm('07:30'), { end: '07:30', usedFallback: false });
});
case_('null → fallback 08:00', () => {
  assert.deepStrictEqual(resolveNightEndHm(null), { end: FALLBACK_POCETAK_RV, usedFallback: true });
});
case_('invalid → fallback', () => {
  assert.deepStrictEqual(resolveNightEndHm('25:99'), { end: '08:00', usedFallback: true });
});
case_('empty → fallback', () => {
  assert.deepStrictEqual(resolveNightEndHm('  '), { end: '08:00', usedFallback: true });
});

console.log('=== overnight pair Mon 22:00 → Tue pocetak_rv 08:00 ===');
case_('append + overnight minutes', () => {
  const radni = appendPeriod(null, '22:00', '08:00');
  assert.strictEqual(radni, '22:00 08:00');
  assert.strictEqual(isOvernightPair('22:00', '08:00'), true);
  assert.strictEqual(intervalMinutes('22:00', '08:00'), 10 * 60);
  assert.strictEqual(timeDifference(radni), '10:00');
});
case_('example branch pocetak_rv 06:00 → 8h', () => {
  const { end } = resolveNightEndHm('06:00');
  assert.strictEqual(intervalMinutes('22:00', end), 8 * 60);
});


console.log('=== resolveDayEndHm / kraj_rv ===');
case_('valid kraj_rv 16:00', () => {
  assert.deepStrictEqual(resolveDayEndHm('16:00'), { end: '16:00', usedFallback: false });
});
case_('valid kraj_rv 20:00', () => {
  assert.deepStrictEqual(resolveDayEndHm('20:00'), { end: '20:00', usedFallback: false });
});
case_('null → fallback 23:00', () => {
  assert.deepStrictEqual(resolveDayEndHm(null), { end: FALLBACK_KRAJ_RV, usedFallback: true });
});
case_('invalid → fallback', () => {
  assert.deepStrictEqual(resolveDayEndHm('25:99'), { end: '23:00', usedFallback: true });
});
case_('empty → fallback', () => {
  assert.deepStrictEqual(resolveDayEndHm('  '), { end: '23:00', usedFallback: true });
});
case_('day same-calendar append 09:00–16:00', () => {
  const { end } = resolveDayEndHm('16:00');
  const radni = appendPeriod(null, '09:00', end);
  assert.strictEqual(radni, '09:00 16:00');
  assert.strictEqual(isOvernightPair('09:00', end), false);
  assert.strictEqual(intervalMinutes('09:00', end), 7 * 60);
});

console.log('=== toDateStr ===');
case_('string YYYY-MM-DD', () => {
  assert.strictEqual(toDateStr('2026-09-23'), '2026-09-23');
});
case_('datetime string trimmed', () => {
  assert.strictEqual(toDateStr('2026-09-23 00:00:00'), '2026-09-23');
});

console.log('=== note constant ===');
case_('day note Automatska odjava!', () => {
  assert.strictEqual(AUTO_LOGOUT_NOTE, 'Automatska odjava!');
});
case_('night note is Croatian and matches LIKE filter', () => {
  assert.ok(AUTO_LOGOUT_NOTE_NIGHT.includes('Automatska odjava'));
  assert.ok(AUTO_LOGOUT_NOTE_NIGHT.includes('noćna'));
});

console.log('\nAll smoke cases passed.');
