import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const C = createRequire(import.meta.url)('../static/coloring.js');

const DATA = {
  states: {
    old: { name: { en: 'Old Realm', cs: 'Stará říše' }, flag: 'stripes' },
    union: { name: { en: 'Union', cs: 'Unie' }, flag: 'stripes' },
    republic: { name: { en: 'Republic', cs: 'Republika' }, flag: 'blue' },
  },
  flags: { stripes: { src: 'data:stripes', color: '#aa5500' }, blue: { src: 'data:blue', color: '#0055aa' } },
};
const ctx = (extra) => ({ ...DATA, language: 'en', range: [1800, 2000], ...extra });
const dead = (year, extra) => ({ living: false, birth: { date: String(year) }, ...extra });

test('parseMode accepts only the modes the page offers', () => {
  assert.deepEqual(C.MODES, ['branch', 'state', 'era', 'documented']);
  assert.equal(C.parseMode('era', ['branch', 'era']), 'era');
  assert.equal(C.parseMode('state', ['branch', 'era']), 'branch');   // a site without states
  assert.equal(C.parseMode('nonsense'), 'branch');
  assert.equal(C.parseMode(null), 'branch');
  assert.equal(C.parseMode('state'), 'state');
});

test('eraRange ignores the living and falls back to a default', () => {
  const people = { a: dead(1850), b: dead('about 1910'), c: { living: true }, d: { living: false } };
  assert.deepEqual(C.eraRange(people), [1850, 1910]);
  assert.deepEqual(C.eraRange({ c: { living: true } }), [1700, 2000]);
  assert.deepEqual(C.eraRange({}), [1700, 2000]);
});

test('eraColor: older is darker, the ends are clamped, a one-year range does not divide by zero', () => {
  const lightness = (c) => +/(\d+(?:\.\d+)?)%\)$/.exec(c)[1];
  assert.match(C.eraColor(1900, [1800, 2000]), /^hsl\(/);
  assert.ok(lightness(C.eraColor(1800, [1800, 2000])) < lightness(C.eraColor(2000, [1800, 2000])));
  assert.equal(C.eraColor(1000, [1800, 2000]), C.eraColor(1800, [1800, 2000]));
  assert.equal(C.eraColor(3000, [1800, 2000]), C.eraColor(2000, [1800, 2000]));
  assert.match(C.eraColor(1900, [1900, 1900]), /^hsl\(/);
});

test('flagsOf: one entry per flag, in the order of the life, names with years in the page language', () => {
  const p = { states: [['old', 1850, 1867], ['union', 1867, 1918], ['republic', 1918, 1918]] };
  const flags = C.flagsOf(p, DATA, 'en');
  assert.deepEqual(flags.map((f) => f.flag), ['stripes', 'blue']);
  assert.deepEqual(flags[0].names, ['Old Realm 1850–1867', 'Union 1867–1918']);
  assert.deepEqual(flags[1].names, ['Republic 1918']);          // from = to: a single year
  assert.equal(flags[0].src, 'data:stripes');
  assert.equal(C.flagsOf(p, DATA, 'cs')[0].names[0], 'Stará říše 1850–1867');
  assert.equal(C.flagsOf(p, DATA, 'de')[0].names[0], 'Old Realm 1850–1867');   // any language when the page language is missing
});

test('flagsOf survives missing data', () => {
  assert.deepEqual(C.flagsOf({}, DATA, 'en'), []);
  assert.deepEqual(C.flagsOf(null, DATA, 'en'), []);
  assert.deepEqual(C.flagsOf({ states: [['old', 1, 2]] }, {}, 'en'), []);                       // a site without states
  assert.deepEqual(C.flagsOf({ states: [['ghost', 1, 2]] }, DATA, 'en'), []);                   // unknown state
  assert.deepEqual(C.flagsOf({ states: [['old', 1, 2]] }, { states: DATA.states, flags: {} }, 'en'), []);
});

test('colorFor: branch leaves the colour to the branch; the living get one neutral colour in the other modes', () => {
  assert.equal(C.colorFor(dead(1900), 'branch', ctx()), null);
  assert.equal(C.colorFor({ living: true }, 'branch', ctx()), null);
  for (const mode of ['state', 'era', 'documented']) assert.equal(C.colorFor({ living: true }, mode, ctx()), C.LIVING, mode);
});

test('colorFor: state takes the colour of the first flag, era the birth year, documented the documents', () => {
  assert.equal(C.colorFor(dead(1850, { states: [['union', 1850, 1900]] }), 'state', ctx()), '#aa5500');
  assert.equal(C.colorFor(dead(1850), 'state', ctx()), C.UNKNOWN);
  assert.equal(C.colorFor(dead(1850, { states: [['ghost', 1, 2]] }), 'state', ctx()), C.UNKNOWN);
  assert.equal(C.colorFor(dead(1900), 'era', ctx()), C.eraColor(1900, [1800, 2000]));
  assert.equal(C.colorFor({ living: false }, 'era', ctx()), C.UNKNOWN);
  assert.equal(C.colorFor(dead(1900, { documents: ['d1'] }), 'documented', ctx()), C.DOCUMENTED);
  assert.equal(C.colorFor(dead(1900, { documents: [] }), 'documented', ctx()), C.UNDOCUMENTED);
  assert.equal(C.colorFor(dead(1900), 'documented', ctx()), C.UNDOCUMENTED);
});

const LABELS = { state_unknown: 'unknown country', era_unknown: 'unknown year', documented_yes: 'yes', documented_no: 'no', living: 'living' };

test('legendItems: branches limited to those in view', () => {
  const branches = [{ key: 'a', name: { en: 'Alpha' } }, { key: 'b', name: { cs: 'Beta' } }, { key: 'c' }];
  const all = C.legendItems('branch', ctx({ branches }), [], LABELS);
  assert.deepEqual(all.map((i) => [i.branch, i.label]), [['a', 'Alpha'], ['b', 'Beta'], ['c', 'c']]);
  const some = C.legendItems('branch', ctx({ branches, visibleBranches: new Set(['b']) }), [], LABELS);
  assert.deepEqual(some.map((i) => i.branch), ['b']);
});

test('legendItems: state lists the flags of those in view, at most two names, and the unknown', () => {
  const people = [
    dead(1850, { states: [['old', 1850, 1860]] }), dead(1870, { states: [['union', 1870, 1900]] }),
    dead(1920, { states: [['republic', 1920, 1950]] }), { living: true },
  ];
  const items = C.legendItems('state', ctx(), people, LABELS);
  assert.deepEqual(items.map((i) => i.kind), ['flag', 'flag', 'swatch', 'swatch']);
  assert.equal(items[0].label, 'Old Realm / Union');
  assert.equal(items[0].flag, 'data:stripes');
  assert.equal(items[0].color, '#aa5500');
  assert.equal(items[1].label, 'Republic');
  assert.equal(items[2].label, 'unknown country');
  assert.equal(items[3].label, 'living');
  const many = { ...DATA, states: { ...DATA.states, third: { name: { en: 'Third' }, flag: 'stripes' } } };
  const three = [dead(1, { states: [['old', 1, 2]] }), dead(2, { states: [['union', 1, 2]] }), dead(3, { states: [['third', 1, 2]] })];
  assert.equal(C.legendItems('state', { ...many, language: 'en' }, three, LABELS)[0].label, 'Old Realm / Third');
});

test('legendItems: the living appear only when someone living is in view', () => {
  for (const mode of ['state', 'era', 'documented']) {
    const without = C.legendItems(mode, ctx(), [dead(1900)], LABELS);
    const withLiving = C.legendItems(mode, ctx(), [dead(1900), { living: true }], LABELS);
    assert.ok(!without.some((i) => i.label === 'living'), mode);
    assert.equal(withLiving[withLiving.length - 1].label, 'living', mode);
  }
});

test('legendItems: era is a gradient over the range, documented has two swatches', () => {
  const [scale, unknown] = C.legendItems('era', ctx(), [], LABELS);
  assert.equal(scale.kind, 'gradient');
  assert.deepEqual([scale.from, scale.to], [1800, 2000]);
  assert.equal(scale.stops.length, 5);
  assert.equal(scale.stops[0], C.eraColor(1800, [1800, 2000]));
  assert.equal(unknown.label, 'unknown year');
  const doc = C.legendItems('documented', ctx(), [], LABELS);
  assert.deepEqual(doc.map((i) => [i.color, i.label]), [[C.DOCUMENTED, 'yes'], [C.UNDOCUMENTED, 'no']]);
});
