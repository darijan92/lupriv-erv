/**
 * Mocked DB pass for A/B/C auto-logout rules (no real MySQL).
 */
const assert = require('assert');
const Module = require('module');
const path = require('path');

const updates = [];
const inserts = [];
const openRows = [
  // A day today — close at branch kraj_rv 16:00
  { id: 1, datum: '2026-09-24', temp: '09:00', radni_sati: null, user_id: 10, branch_id: 1, napomena: null, branch_pocetak_rv: '08:00', branch_kraj_rv: '16:00' },
  // B night today — skip
  { id: 2, datum: '2026-09-24', temp: '22:00', radni_sati: null, user_id: 11, branch_id: 1, napomena: null, branch_pocetak_rv: '08:00', branch_kraj_rv: '16:00' },
  // C night yesterday — close at pocetak_rv
  { id: 3, datum: '2026-09-23', temp: '22:00', radni_sati: null, user_id: 12, branch_id: 2, napomena: null, branch_pocetak_rv: '07:00', branch_kraj_rv: '20:00' },
  // C night yesterday, missing pocetak_rv — fallback 08:00
  { id: 4, datum: '2026-09-23', temp: '21:30', radni_sati: '14:00 18:00', user_id: 13, branch_id: 3, napomena: 'x', branch_pocetak_rv: null, branch_kraj_rv: '19:00' },
  // A day today, missing kraj_rv — fallback 23:00
  { id: 5, datum: '2026-09-24', temp: '10:00', radni_sati: null, user_id: 14, branch_id: 4, napomena: null, branch_pocetak_rv: '08:00', branch_kraj_rv: null },
];

const mockPool = {
  async query(sql, params) {
    const s = String(sql);
    if (s.includes('FROM hours h') && s.includes('temp IS NOT NULL')) {
      return [openRows];
    }
    if (s.startsWith('UPDATE hours SET')) {
      updates.push({ sql: s, params });
      return [{ affectedRows: 1 }];
    }
    if (s.includes('INSERT INTO logs')) {
      inserts.push({ sql: s, params });
      return [{ insertId: 1 }];
    }
    throw new Error('Unexpected SQL in mock: ' + s.slice(0, 80));
  },
};

// Force-load pool module as mock before autoLogout
const poolPath = path.resolve(__dirname, '../src/db/pool.js');
require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: mockPool };

// Freeze "today" / clock: patch Date for gate — force path skips gate
const { runAutoLogout, _resetLastAutoLogoutDateForTests, AUTO_LOGOUT_NOTE, AUTO_LOGOUT_NOTE_NIGHT } = require('../src/routes/autoLogout');
_resetLastAutoLogoutDateForTests();

// Stub todayDate via forcing classification with real todayDate — instead override hours.datum relative to real today
const { todayDate } = require('../src/utils/time');
const today = todayDate();
function yday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
openRows[0].datum = today;
openRows[1].datum = today;
openRows[2].datum = yday();
openRows[3].datum = yday();
openRows[4].datum = today;

(async () => {
  const result = await runAutoLogout({ force: true });
  console.log('result', result);

  assert.strictEqual(result.skipped, false);
  assert.strictEqual(result.closedDay, 2);
  assert.strictEqual(result.closedNight, 2);
  assert.strictEqual(result.closed, 4);
  assert.strictEqual(result.skippedNight, 1);
  assert.strictEqual(result.fallbackPocetak, 1);
  assert.strictEqual(result.fallbackKraj, 1);
  assert.strictEqual(updates.length, 4);
  assert.strictEqual(inserts.length, 4);

  // Day close: end = branch kraj_rv 16:00 (not fixed 23:00)
  const dayUpd = updates.find((u) => u.params[2] === 1);
  assert.ok(dayUpd);
  assert.strictEqual(dayUpd.params[0], '09:00 16:00');
  assert.ok(String(dayUpd.params[1]).startsWith(AUTO_LOGOUT_NOTE));
  assert.strictEqual(dayUpd.params[1].includes('noćna'), false);

  // Day missing kraj_rv → fallback 23:00
  const dayFb = updates.find((u) => u.params[2] === 5);
  assert.strictEqual(dayFb.params[0], '10:00 23:00');
  assert.ok(String(dayFb.params[1]).startsWith(AUTO_LOGOUT_NOTE));

  // Night with pocetak_rv 07:00
  const nightUpd = updates.find((u) => u.params[2] === 3);
  assert.strictEqual(nightUpd.params[0], '22:00 07:00');
  assert.ok(String(nightUpd.params[1]).startsWith(AUTO_LOGOUT_NOTE_NIGHT));

  // Night fallback 08:00 + prior radni_sati preserved
  const fbUpd = updates.find((u) => u.params[2] === 4);
  assert.strictEqual(fbUpd.params[0], '14:00 18:00 21:30 08:00');
  assert.ok(String(fbUpd.params[1]).includes(AUTO_LOGOUT_NOTE_NIGHT));
  assert.ok(String(fbUpd.params[1]).includes('x'));

  // Night today id=2 never updated
  assert.ok(!updates.some((u) => u.params[2] === 2));

  console.log('Mocked A/B/C pass OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
