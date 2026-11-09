const test = require('node:test');
const assert = require('node:assert');
const {
  timeDifference,
  intervalMinutes,
  hasDodatno,
  splitIntervals,
  normalizeRadniSati,
  clientIp,
} = require('../src/utils/time');

test('timeDifference sums pairs', () => {
  assert.strictEqual(timeDifference('07:00 15:00'), '08:00');
  assert.strictEqual(timeDifference('07:16 11:00 11:30 15:45'), '07:59');
});

test('overnight pairs count across midnight', () => {
  assert.strictEqual(intervalMinutes('22:00', '06:00'), 8 * 60);
  assert.strictEqual(timeDifference('22:00 06:00'), '08:00');
});

test('hasDodatno splits regular and overtime at 8h', () => {
  assert.deepStrictEqual(hasDodatno('07:30'), { total: '07:30', dodatno: '00:00' });
  assert.deepStrictEqual(hasDodatno('09:15'), { total: '08:00', dodatno: '01:15' });
});

test('splitIntervals reports first start, last end and break', () => {
  const r = splitIntervals('07:00 11:00 11:30 15:30');
  assert.strictEqual(r.pocetak, '07:00');
  assert.strictEqual(r.zavrsetak, '15:30');
  assert.strictEqual(r.prekid, '00:30');
  assert.strictEqual(r.overnight, false);
});

test('normalizeRadniSati accepts pairs and rejects garbage', () => {
  assert.strictEqual(normalizeRadniSati(' 07:00  15:00 '), '07:00 15:00');
  assert.strictEqual(normalizeRadniSati(''), null);
  assert.strictEqual(normalizeRadniSati(null), null);
  assert.throws(() => normalizeRadniSati('07:00'));
  assert.throws(() => normalizeRadniSati('07:00 25:00'));
  assert.throws(() => normalizeRadniSati('abc def'));
});

test('clientIp uses req.ip (trust proxy decides XFF) and normalises IPv4-mapped', () => {
  assert.strictEqual(clientIp({ ip: '::ffff:10.0.0.5', headers: { 'x-forwarded-for': '1.2.3.4' } }), '10.0.0.5');
  assert.strictEqual(clientIp({ ip: '::1', headers: {} }), '127.0.0.1');
});
