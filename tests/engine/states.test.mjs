import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ST = require('../../engine/states.js');
const G = require('../../engine/gedcom.js');
const P = require('../../engine/places.js');

const LANGS = ['en', 'cs'];
const DATA = {
  flags: {
    stripes: { stripes: ['#111111', '#eeeeee'] },
    vertical: { stripes: ['#002b7f', '#fcd116', '#ce1126'], direction: 'vertical', color: '#aa5500' },
    triangle: { stripes: ['#ffffff', '#d7141a'], hoist_triangle: '#11457e' },
  },
  states: {
    old: { name: { en: 'Old Realm', cs: 'Stará říše' }, flag: 'stripes' },
    union: { name: { en: 'Union', cs: 'Unie' }, flag: 'stripes' },
    republic: { name: { en: 'Republic', cs: 'Republika' }, flag: 'triangle' },
    annexed: { name: { en: 'Annexed', cs: 'Zabrané' }, flag: 'vertical' },
  },
  regions: {
    Northland: [[0, 'old'], [1867.45, 'union'], [1918.82, 'republic']],
    'Northland (border)': [[0, 'old'], [1918.82, 'republic'], [1938.76, 'annexed'], [1945.35, 'republic']],
  },
};
const PLACES = {
  Alpha: { coords: [1, 1], country: { en: 'Northland', cs: 'Sever' } },
  Beta: { coords: [2, 2], country: { en: 'Northland', cs: 'Sever' }, region: 'Northland (border)' },
  Gamma: { coords: [3, 3], country: { en: 'Elsewhere', cs: 'Jinde' } },
};
const make = (changes = {}) => ST.load({ ...JSON.parse(JSON.stringify(DATA)), ...changes }, LANGS);
const fails = (fragment, changes) => assert.throws(() => make(changes), (e) => e instanceof ST.StatesError && e.message.includes(fragment), fragment);

test('valid', () => {
  assert.deepEqual(new Set(Object.keys(make().states)), new Set(['old', 'union', 'republic', 'annexed']));
});

test('flag_needs_colours', () => {
  const F = DATA.flags;
  fails('stripes', { flags: { f: { stripes: ['red'] }, ...F } });
  fails('stripes', { flags: { f: { stripes: [] }, ...F } });
  fails('stripes', { flags: { f: { stripes: Array(7).fill('#111111') }, ...F } });
  fails('direction', { flags: { f: { stripes: ['#111111'], direction: 'diagonal' }, ...F } });
  fails('hoist_triangle', { flags: { f: { stripes: ['#111111'], hoist_triangle: 'blue' }, ...F } });
  fails('color', { flags: { f: { stripes: ['#111111'], color: 5 }, ...F } });
});

test('state_needs_a_name_in_every_language_and_a_known_flag', () => {
  fails('missing for cs', { states: { x: { name: { en: 'X' }, flag: 'stripes' } } });
  fails('missing for en', { states: { x: { name: { en: ' ', cs: 'X' }, flag: 'stripes' } } });
  fails('name must map', { states: { x: { name: 'X', flag: 'stripes' } } });
  fails("flag 'nope'", { states: { x: { name: { en: 'X', cs: 'X' }, flag: 'nope' } } });
});

test('region_rules', () => {
  fails('unknown state', { regions: { R: [[0, 'nowhere']] } });
  fails('non-empty', { regions: { R: [] } });
  fails('strictly increasing', { regions: { R: [[1900, 'old'], [1800, 'union']] } });
  fails('strictly increasing', { regions: { R: [[1900, 'old'], [1900, 'union']] } });
  fails('[from_year, state]', { regions: { R: [['1900', 'old']] } });
  fails('[from_year, state]', { regions: { R: [[true, 'old']] } });
  fails('[from_year, state]', { regions: { R: [[1900]] } });
});

test('wrong_shape', () => {
  assert.throws(() => ST.load([], LANGS), ST.StatesError);
  assert.throws(() => ST.load({ flags: [] }, LANGS), ST.StatesError);
  assert.throws(() => ST.load(null, LANGS), ST.StatesError);
});

test('svg_stripes_and_triangle', () => {
  const s = make();
  const h = s.flagSvg('stripes');
  assert.equal(h.split('<rect').length - 1, 3);
  assert.ok(h.includes('fill="#111111"'));
  assert.ok(h.includes('y="10.000"'));
  const v = s.flagSvg('vertical');
  assert.ok(v.includes('x="10.000"'));
  assert.ok(!v.includes('<path'));
  assert.ok(s.flagSvg('triangle').includes('<path d="M0 0L15 10L0 20Z" fill="#11457e"/>'));
});

test('uri_is_a_self_contained_image', () => {
  const uri = make().flagUri('stripes');
  assert.ok(uri.startsWith('data:image/svg+xml,'));
  assert.ok(!uri.includes('<') && !uri.includes('"'));
});

test('uri_matches_python_quote', () => {
  // urllib.parse.quote('<svg a="b#c">ž</svg>', safe=" =:/.-")
  assert.equal(ST.quote('<svg a="b#c">ž_~</svg>'), '%3Csvg a=%22b%23c%22%3E%C5%BE_~%3C/svg%3E');
});

test('colour_given_or_a_distinct_default', () => {
  const s = make();
  assert.equal(s.flags.vertical.color, '#aa5500');
  const a = s.flags.stripes.color, b = s.flags.triangle.color;
  assert.ok(a.startsWith('hsl(') && b.startsWith('hsl('));
  assert.notEqual(a, b);
  assert.equal(a, 'hsl(0, 42%, 58%)');   // sorted keys: stripes is 1st of 3
  assert.equal(b, 'hsl(120, 42%, 58%)');
});

test('page_data', () => {
  const d = make().pageData();
  assert.deepEqual(new Set(Object.keys(d)), new Set(['states', 'flags']));
  assert.deepEqual(d.states.old, { name: { en: 'Old Realm', cs: 'Stará říše' }, flag: 'stripes' });
  assert.ok(d.flags.vertical.src.startsWith('data:image/svg+xml,'));
  assert.equal(d.flags.vertical.color, '#aa5500');
  JSON.stringify(d);
});

test('state_at', () => {
  const s = make();
  assert.equal(s.stateAt('Northland', 1850), 'old');
  assert.equal(s.stateAt('Northland', 1900), 'union');
  assert.equal(s.stateAt('Northland (border)', 1941), 'annexed');
  assert.equal(s.stateAt('Atlantis', 1900), null);
});

test('one_place', () => {
  const z = make().lifetime([[1900.5, 'Northland'], [1980.5, 'Northland']]);
  assert.deepEqual(z.map((x) => x[0]), ['union', 'republic']);
  assert.deepEqual([z[0][1], z[z.length - 1][2]], [1900, 1980]);
});

test('moves_and_a_point_without_a_place', () => {
  const z = make().lifetime([[1890.5, 'Northland (border)'], [1912.5, 'Northland'], [1930.5, null]]);
  assert.deepEqual(z.map((x) => x[0]), ['old', 'union', 'republic']);
});

test('a_region_change_in_the_middle', () => {
  const z = make().lifetime([[1930.5, 'Northland (border)'], [1946.5, 'Northland (border)']]);
  assert.deepEqual(z.map((x) => x[0]), ['republic', 'annexed', 'republic']);
});

test('single_point_and_nothing_known', () => {
  const s = make();
  assert.deepEqual(s.lifetime([[1850.0, 'Northland']]), [['old', 1850, 1850]]);
  assert.deepEqual(s.lifetime([[1850.0, null]]), []);
  assert.deepEqual(s.lifetime([]), []);
});

test('unknown_region_is_skipped', () => {
  assert.deepEqual(make().lifetime([[1850.0, 'Atlantis'], [1900.0, 'Atlantis']]), []);
});

test('moment', () => {
  assert.equal(ST.moment(G.parseDate('1900')), 1900.5);
  assert.ok(Math.abs(ST.moment(G.parseDate('MAR 1900')) - (1900 + 2 / 12)) < 1e-9);
  assert.ok(Math.abs(ST.moment(G.parseDate('1 JAN 1900')) - 1900.0) < 1e-9);
  assert.equal(ST.moment(null), null);
  assert.equal(ST.moment(G.parseDate('unknown')), null);
});

const GED = `0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Ann /Test/
1 BIRT
2 DATE 1900
2 PLAC Alpha
1 DEAT
2 DATE 1960
2 PLAC Alpha
1 FAMS @F1@
0 @I2@ INDI
1 NAME Bob /Test/
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I1@
1 MARR
2 DATE 1938
2 PLAC Beta
`;
const tree = G.parse(GED);
const places = new P.Places(PLACES, []);

test('region_of_prefers_the_place_region_then_the_country', () => {
  const s = make();
  assert.equal(s.regionOf(places, 'Alpha', 'en'), 'Northland');
  assert.equal(s.regionOf(places, 'Beta', 'en'), 'Northland (border)');
  assert.equal(s.regionOf(places, 'Gamma', 'en'), null);
  assert.equal(s.regionOf(places, 'Nowhere', 'en'), null);
  assert.equal(s.regionOf(places, null, 'en'), null);
  assert.equal(s.regionOf(places, 'Alpha', 'cs'), null);
});

test('marriage_with_a_deceased_partner_counts', () => {
  const z = make().personStates(tree, places, 'I1', 'en', new Set());
  assert.deepEqual(z.map((x) => x[0]), ['union', 'republic', 'annexed', 'republic']);
  assert.deepEqual(z[z.length - 1].slice(1), [1945, 1960]);
});

test('marriage_with_a_living_partner_is_left_out', () => {
  const z = make().personStates(tree, places, 'I1', 'en', new Set(['I2']));
  assert.deepEqual(z.map((x) => x[0]), ['union', 'republic']);
  assert.equal(z[z.length - 1][2], 1960);
  assert.ok(!z.flatMap((x) => x.slice(1)).includes(1938));
});

test('svg_matches_python', () => {
  assert.equal(make().flagSvg('vertical'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><rect x="0.000" width="10.050" height="20" fill="#002b7f"/><rect x="10.000" width="10.050" height="20" fill="#fcd116"/><rect x="20.000" width="10.050" height="20" fill="#ce1126"/><rect x=".25" y=".25" width="29.5" height="19.5" fill="none" stroke="#000" stroke-opacity=".25" stroke-width=".5"/></svg>');
});
