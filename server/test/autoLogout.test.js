const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Replace the DB pool with an in-memory mock before loading the module under test.
const updates = [];
const inserts = [];
let openRows = [];
function query(sql, params) {
  const s = String(sql);
  if (s.includes('FROM hours h') && s.includes('temp IS NOT NULL')) return [openRows];
  if (s.startsWith('UPDATE hours SET')) {
    updates.push({ sql: s, params });
    return [{ affectedRows: 1 }];
  }
  if (s.includes('INSERT INTO logs')) {
    inserts.push({ sql: s, params });
    return [{ insertId: 1 }];
  }
  throw new Error('Unexpected SQL in mock: ' + s.slice(0, 80));
}
const mockPool = {
  query: async (sql, params) => query(sql, params),
  getConnection: async () => ({
    query: async (sql, params) => query(sql, params),
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  }),
};
const poolPath = path.resolve(__dirname, '../src/db/pool.js');
require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: mockPool };

const {
  runAutoLogout,
  planClose,
  resolveDayEndHm,
  _resetLastAutoLogoutDateForTests,
  AUTO_LOGOUT_NOTE,
  AUTO_LOGOUT_NOTE_NIGHT,
  AUTO_LOGOUT_NOTE_AFTER_CLOSE,
} = require('../src/routes/autoLogout');
const { todayDate, timeDifference } = require('../src/utils/time');

const TODAY = '2026-09-24';
const YDAY = '2026-09-23';

test('day session closes at branch kraj_rv', () => {
  const p = planClose({ datum: TODAY, temp: '09:00', branch_kraj_rv: '16:00' }, TODAY, 0);
  assert.deepStrictEqual([p.kind, p.endStr, p.note], ['day', '16:00', AUTO_LOGOUT_NOTE]);
});

test('check-in after kraj_rv is closed with zero time, not ~23 hours', () => {
  const hour = { datum: TODAY, temp: '15:10', radni_sati: null, branch_kraj_rv: '14:00' };
  const p = planClose(hour, TODAY, 0);
  assert.strictEqual(p.endStr, '15:10');
  assert.strictEqual(p.note, AUTO_LOGOUT_NOTE_AFTER_CLOSE);
  assert.strictEqual(timeDifference(`${hour.temp} ${p.endStr}`), '00:00');
  // still matched by the auto-logout report filter
  assert.ok(p.note.includes('Automatska odjava'));
});

test('optional extra minutes reproduce the old kraj_rv + 1h rule, capped at 23:59', () => {
  assert.strictEqual(resolveDayEndHm('16:00', 60).end, '17:00');
  assert.strictEqual(resolveDayEndHm('23:00', 60).end, '23:59');
  assert.strictEqual(resolveDayEndHm('16:00', 0).end, '16:00');
});

test('night sessions: tonight skipped, yesterday closed at pocetak_rv (fallback 08:00)', () => {
  assert.strictEqual(planClose({ datum: TODAY, temp: '22:00' }, TODAY, 0).kind, 'night_today');
  const p = planClose({ datum: YDAY, temp: '22:00', branch_pocetak_rv: '07:00' }, TODAY, 0);
  assert.deepStrictEqual([p.kind, p.endStr, p.note], ['night_previous', '07:00', AUTO_LOGOUT_NOTE_NIGHT]);
  const fb = planClose({ datum: YDAY, temp: '21:30', branch_pocetak_rv: null }, TODAY, 0);
  assert.strictEqual(fb.endStr, '08:00');
  assert.strictEqual(fb.usedFallback, true);
});

test('runAutoLogout closes rows and logs each one', async () => {
  const today = todayDate();
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const yday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  openRows = [
    { id: 1, datum: today, temp: '09:00', radni_sati: null, user_id: 10, branch_id: 1, napomena: null, branch_pocetak_rv: '08:00', branch_kraj_rv: '16:00' },
    { id: 2, datum: today, temp: '22:00', radni_sati: null, user_id: 11, branch_id: 1, napomena: null, branch_pocetak_rv: '08:00', branch_kraj_rv: '16:00' },
    { id: 3, datum: yday, temp: '22:00', radni_sati: null, user_id: 12, branch_id: 2, napomena: null, branch_pocetak_rv: '07:00', branch_kraj_rv: '20:00' },
    { id: 4, datum: yday, temp: '21:30', radni_sati: '14:00 18:00', user_id: 13, branch_id: 3, napomena: 'x', branch_pocetak_rv: null, branch_kraj_rv: '19:00' },
    { id: 5, datum: today, temp: '10:00', radni_sati: null, user_id: 14, branch_id: 4, napomena: null, branch_pocetak_rv: '08:00', branch_kraj_rv: null },
    { id: 6, datum: today, temp: '15:10', radni_sati: null, user_id: 15, branch_id: 5, napomena: null, branch_pocetak_rv: '08:00', branch_kraj_rv: '14:00' },
  ];
  _resetLastAutoLogoutDateForTests();
  const prev = process.env.AUTO_LOGOUT_EXTRA_MINUTES;
  delete process.env.AUTO_LOGOUT_EXTRA_MINUTES;
  const result = await runAutoLogout({ force: true });
  if (prev !== undefined) process.env.AUTO_LOGOUT_EXTRA_MINUTES = prev;

  assert.strictEqual(result.closedDay, 3);
  assert.strictEqual(result.closedNight, 2);
  assert.strictEqual(result.skippedNight, 1);
  assert.strictEqual(result.fallbackPocetak, 1);
  assert.strictEqual(result.fallbackKraj, 1);
  assert.strictEqual(updates.length, 5);
  assert.strictEqual(inserts.length, 5);

  const byId = (id) => updates.find((u) => u.params[2] === id).params;
  assert.strictEqual(byId(1)[0], '09:00 16:00');
  assert.strictEqual(byId(5)[0], '10:00 23:00');
  assert.strictEqual(byId(3)[0], '22:00 07:00');
  assert.strictEqual(byId(4)[0], '14:00 18:00 21:30 08:00');
  assert.ok(byId(4)[1].includes('x'));
  assert.strictEqual(byId(6)[0], '15:10 15:10');
  assert.ok(!updates.some((u) => u.params[2] === 2));
});
