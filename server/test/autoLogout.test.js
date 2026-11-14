const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Replace the DB pool with an in-memory mock before loading the module under test.
const updates = [];
const inserts = [];
let openRows = [];
let affected = 1;
function query(sql, params) {
  const s = String(sql);
  if (s.includes('FROM hours h') && s.includes('temp IS NOT NULL')) return [openRows];
  if (s.startsWith('UPDATE hours SET')) {
    updates.push({ sql: s, params });
    return [{ affectedRows: affected }];
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
const { timeDifference } = require('../src/utils/time');
const rules = require('../src/services/sessionRules');

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
  const now = new Date(2026, 8, 24, 23, 40);
  const today = TODAY;
  const yday = YDAY;
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
  const result = await runAutoLogout({ force: true, now });
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

test('branch closing at 23:00: sessions are deferred during the grace period, then closed', async () => {
  const row = { id: 7, datum: TODAY, temp: '15:00', radni_sati: null, user_id: 20, branch_id: 6, napomena: null, branch_pocetak_rv: '15:00', branch_kraj_rv: '23:00' };
  openRows = [row];
  updates.length = 0;
  inserts.length = 0;
  _resetLastAutoLogoutDateForTests();

  const early = await runAutoLogout({ now: new Date(2026, 8, 24, 23, 5) });
  assert.deepStrictEqual([early.closed, early.deferred, early.skipped], [0, 1, false]);
  assert.strictEqual(updates.length, 0);

  // Not marked as done, so the next timer tick retries and closes it.
  const later = await runAutoLogout({ now: new Date(2026, 8, 24, 23, 31) });
  assert.deepStrictEqual([later.closedDay, later.deferred], [1, 0]);
  assert.strictEqual(updates[0].params[0], '15:00 23:00');

  const again = await runAutoLogout({ now: new Date(2026, 8, 24, 23, 45) });
  assert.strictEqual(again.reason, 'already_ran');
});

test('a row the employee closed in the meantime is not counted or logged', async () => {
  openRows = [{ id: 8, datum: TODAY, temp: '09:00', radni_sati: null, user_id: 21, branch_id: 1, napomena: null, branch_kraj_rv: '16:00' }];
  updates.length = 0;
  inserts.length = 0;
  affected = 0;
  const r = await runAutoLogout({ force: true, now: new Date(2026, 8, 24, 23, 40) });
  affected = 1;
  assert.strictEqual(r.closed, 0);
  assert.strictEqual(inserts.length, 0);
});

test('stale sessions: old date and open longer than the limit', () => {
  const now = new Date(2026, 8, 24, 21, 0);
  // Night shift from last night, still open at 21:00 the next day (23 h).
  assert.strictEqual(rules.isStaleSession({ datum: YDAY, temp: '22:00' }, now, 16), true);
  // Night shift from last night checked out at 06:00: a real shift, not stale.
  assert.strictEqual(rules.isStaleSession({ datum: YDAY, temp: '22:00' }, new Date(2026, 8, 24, 6, 0), 16), false);
  // Today's session is never stale.
  assert.strictEqual(rules.isStaleSession({ datum: TODAY, temp: '00:10' }, now, 16), false);
  // Day session the missed pass left open.
  assert.strictEqual(rules.isStaleSession({ datum: YDAY, temp: '08:00' }, new Date(2026, 8, 24, 7, 55), 16), true);

  const night = rules.planStaleClose({ datum: YDAY, temp: '22:00', branch_pocetak_rv: '07:00' }, now, 0);
  assert.deepStrictEqual([night.kind, night.endStr], ['night_previous', '07:00']);
  const day = rules.planStaleClose({ datum: YDAY, temp: '08:00', branch_kraj_rv: '16:00' }, now, 0);
  assert.deepStrictEqual([day.kind, day.endStr], ['day', '16:00']);
});

test('grace only applies to today\'s day sessions and ends before midnight', () => {
  const plan = { kind: 'day', endStr: '23:45' };
  assert.strictEqual(rules.isWithinDayCloseGrace({ datum: TODAY }, plan, TODAY, 23 * 60 + 46), true);
  assert.strictEqual(rules.isWithinDayCloseGrace({ datum: TODAY }, plan, TODAY, 23 * 60 + 50), false);
  assert.strictEqual(rules.isWithinDayCloseGrace({ datum: YDAY }, plan, TODAY, 23 * 60 + 5), false);
  assert.strictEqual(rules.isWithinDayCloseGrace({ datum: TODAY }, { kind: 'day', endStr: '15:10', afterClose: true }, TODAY, 15 * 60 + 11), false);
});
