const test = require('node:test');
const assert = require('node:assert/strict');
const {
  dayAfterYmd,
  prorateAnnualByMonthRange,
  buildMonthKeysFromRange,
} = require('../peReadScope');

test('dayAfterYmd returns next calendar day', () => {
  assert.equal(dayAfterYmd('2026-03-31'), '2026-04-01');
  assert.equal(dayAfterYmd('invalid'), null);
});

test('prorateAnnualByMonthRange uses whole months in range', () => {
  assert.equal(
    prorateAnnualByMonthRange(1200, '2026-01-15', '2026-03-10'),
    300,
  );
  assert.equal(buildMonthKeysFromRange('2026-01-15', '2026-03-10').length, 3);
});
