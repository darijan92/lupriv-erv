const test = require('node:test');
const assert = require('node:assert');
const { computeHourTotals, buildMonthView, NIGHT_LABEL } = require('../src/services/hoursCalc');

test('work day with overtime', () => {
  const r = computeHourTotals({ radni_sati: '07:00 12:00 12:30 17:00' });
  assert.strictEqual(r.ukupno, '09:30');
  assert.strictEqual(r.total, '08:00');
  assert.strictEqual(r.dodatno, '01:30');
  assert.strictEqual(r.isNightShift, false);
});

test('paid absence without hours counts 8h', () => {
  const r = computeHourTotals({ odsustvo: 'Godišnji odmor' });
  assert.strictEqual(r.ukupno, '08:00');
});

test('unpaid absence counts nothing unless odsustvo_time is set', () => {
  assert.strictEqual(computeHourTotals({ odsustvo: 'Neplaćeno' }).ukupno, '-');
  assert.strictEqual(computeHourTotals({ odsustvo: 'Neplaćeno', odsustvo_time: '04:00' }).ukupno, '04:00');
});

test('flat legacy night work is 8h', () => {
  const r = computeHourTotals({ odsustvo: NIGHT_LABEL });
  assert.strictEqual(r.ukupno, '08:00');
  assert.strictEqual(r.isNightShift, true);
});

test('overnight interval is a night shift', () => {
  const r = computeHourTotals({ radni_sati: '22:00 06:00' });
  assert.strictEqual(r.ukupno, '08:00');
  assert.strictEqual(r.isNightShift, true);
});

test('month view sums the month and fills empty days', () => {
  const view = buildMonthView(
    [
      { id: 1, datum: '2026-02-02', radni_sati: '07:00 15:00', user_id: 1 },
      { id: 2, datum: '2026-02-03', radni_sati: '07:00 17:00', user_id: 1 },
    ],
    2026,
    2
  );
  assert.strictEqual(view.days.length, 28);
  assert.deepStrictEqual(view.zbroj, { ukupno: '18:00', total: '16:00', dodatno: '02:00' });
  assert.strictEqual(view.days.find((d) => d.id === 1).prekid, '09:30-10:00');
});
