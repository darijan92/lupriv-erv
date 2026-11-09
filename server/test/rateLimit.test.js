const test = require('node:test');
const assert = require('node:assert');
const rl = require('../src/middleware/rateLimit');

test('blocks a username after repeated failures and resets on success', () => {
  rl._reset();
  const now = 1_000_000;
  for (let i = 0; i < rl.MAX_PER_USER; i++) rl.recordFailure('1.1.1.1', 'Ana', now);
  assert.ok(rl.retryAfter('1.1.1.1', 'ana', now) > 0);
  // Other employees on the same kiosk are not blocked.
  assert.strictEqual(rl.retryAfter('1.1.1.1', 'ivan', now), 0);
  // Window expiry lifts the block.
  assert.strictEqual(rl.retryAfter('1.1.1.1', 'ana', now + rl.WINDOW_MS + 1), 0);
  rl.recordSuccess('1.1.1.1', 'ana');
  assert.strictEqual(rl.retryAfter('1.1.1.1', 'ana', now), 0);
});

test('blocks an IP after many failures across usernames', () => {
  rl._reset();
  const now = 2_000_000;
  for (let i = 0; i < rl.MAX_PER_IP; i++) rl.recordFailure('2.2.2.2', `user${i}`, now);
  assert.ok(rl.retryAfter('2.2.2.2', 'someone', now) > 0);
});
