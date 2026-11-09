const test = require('node:test');
const assert = require('node:assert');
const { earliestEditableDate, isDateEditable } = require('../src/utils/access');

const mod = { id: 2, role_id: 2 };
const admin = { id: 1, role_id: 3 };

test('until the lock day the previous month is still editable', () => {
  assert.strictEqual(earliestEditableDate(new Date(2026, 10, 5), 5), '2026-10-01');
  assert.strictEqual(earliestEditableDate(new Date(2026, 0, 3), 5), '2025-12-01');
});

test('after the lock day only the current month is editable', () => {
  assert.strictEqual(earliestEditableDate(new Date(2026, 10, 6), 5), '2026-11-01');
});

test('voditelj is locked out of closed months, admin never is', () => {
  const now = new Date(2026, 10, 9);
  assert.strictEqual(isDateEditable(mod, '2026-10-31', now, 5), false);
  assert.strictEqual(isDateEditable(mod, '2026-11-01', now, 5), true);
  assert.strictEqual(isDateEditable(mod, '2026-12-15', now, 5), true);
  assert.strictEqual(isDateEditable(admin, '2020-01-01', now, 5), true);
  assert.strictEqual(isDateEditable(mod, '2020-01-01', now, 0), true);
});
