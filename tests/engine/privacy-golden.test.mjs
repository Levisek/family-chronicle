// Python's privacy.redact and check_output on random inputs (tests/golden/privacy, written by the
// Python version before it was removed): the JS must give exactly the same results. The speed
// indexes in checkOutput must never hide a finding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const PV = require('../../engine/privacy.js');
const { utf8 } = require('../../engine/text.js');
const load = (n) => JSON.parse(readFileSync(new URL(`../golden/privacy/${n}.json`, import.meta.url), 'utf8'));
const gd = (year, month, day) => ({ year, month, day, approximate: false, text: '' });

test('redact_like_python', () => {
  const { cases, out } = load('redact');
  const bad = cases.filter((s, i) => PV.redact(s, [gd(1995, 1, 5), gd(1972, null, null), gd(2020, 6, 12)]) !== out[i]);
  assert.deepEqual(bad.slice(0, 5), []);
});

test('check_mixed_files_like_python', () => {
  const { cases, out } = load('check');
  const living = [[['Eva', 'Dvořáková'], [gd(1995, 1, 5), gd(2020, 6, 12)]], [['Jan', 'Nový'], [gd(1972, null, null)]]];
  const bad = cases.filter(([n, s], i) => JSON.stringify(PV.checkOutput(new Map([[n, utf8(s)]]), living, ['Jan Nový 1972'])) !== JSON.stringify(out[i]));
  assert.deepEqual(bad.slice(0, 5), []);
});

for (const name of ['dmy', 'months', 'numeric']) {
  test(`check_date_forms_${name}_like_python`, () => {
    const { cases, out, dates } = load(name);
    const living = dates.map(([y, m, d], i) => [[`N${i}`], [gd(y, m, d)]]);
    const bad = cases.filter((c, i) => JSON.stringify(PV.checkOutput(new Map([['a.txt', utf8(c)]]), living, [])) !== JSON.stringify(out[i]));
    assert.deepEqual(bad.slice(0, 5), []);
  });
}
