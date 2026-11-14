const test = require('node:test');
const assert = require('node:assert');
const { csvField } = require('../src/utils/csv');

test('csv fields are quoted and cannot start a spreadsheet formula', () => {
  assert.strictEqual(csvField('Ljekarna Centar'), 'Ljekarna Centar');
  assert.strictEqual(csvField('A; B'), '"A; B"');
  assert.strictEqual(csvField('rekao "da"'), '"rekao ""da"""');
  assert.strictEqual(csvField('=HYPERLINK("http://x")'), '"\'=HYPERLINK(""http://x"")"');
  assert.strictEqual(csvField('+385 1 234'), "'+385 1 234");
  assert.strictEqual(csvField(12), '12');
  assert.strictEqual(csvField(null), '');
});
