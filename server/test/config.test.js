const test = require('node:test');
const assert = require('node:assert');
const { assertSafeConfig, kioskAllowsExplicitBranch, trustProxyHops } = require('../src/config');

const strong = 'x'.repeat(40);

test('production refuses default or missing JWT secrets', () => {
  assert.throws(() => assertSafeConfig({ NODE_ENV: 'production' }), /JWT_SECRET/);
  assert.throws(
    () => assertSafeConfig({ NODE_ENV: 'production', JWT_SECRET: 'change_me_to_a_long_random_string' }),
    /zadana/
  );
  assert.throws(() => assertSafeConfig({ NODE_ENV: 'production', JWT_SECRET: 'short' }), /32/);
  assert.throws(
    () =>
      assertSafeConfig({
        NODE_ENV: 'production',
        JWT_SECRET: strong,
        AUTO_LOGOUT_SECRET: 'change_me_auto_logout_secret',
      }),
    /AUTO_LOGOUT_SECRET/
  );
  assert.doesNotThrow(() => assertSafeConfig({ NODE_ENV: 'production', JWT_SECRET: strong }));
});

test('dev and explicit override do not throw', () => {
  assert.doesNotThrow(() => assertSafeConfig({}));
  assert.doesNotThrow(() => assertSafeConfig({ NODE_ENV: 'production', ALLOW_INSECURE_DEFAULTS: '1' }));
});

test('kiosk explicit branch: on in dev, off in production unless set', () => {
  assert.strictEqual(kioskAllowsExplicitBranch({}), true);
  assert.strictEqual(kioskAllowsExplicitBranch({ NODE_ENV: 'production' }), false);
  assert.strictEqual(kioskAllowsExplicitBranch({ NODE_ENV: 'production', KIOSK_ALLOW_BRANCH_QUERY: '1' }), true);
  assert.strictEqual(kioskAllowsExplicitBranch({ KIOSK_ALLOW_BRANCH_QUERY: '0' }), false);
});

test('trust proxy hops default to 1', () => {
  assert.strictEqual(trustProxyHops({}), 1);
  assert.strictEqual(trustProxyHops({ TRUST_PROXY_HOPS: '2' }), 2);
  assert.strictEqual(trustProxyHops({ TRUST_PROXY_HOPS: 'x' }), 1);
});
