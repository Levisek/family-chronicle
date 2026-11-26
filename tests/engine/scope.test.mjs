import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const G = require('../../engine/gedcom.js');
const S = require('../../engine/scope.js');
const { relationship } = require('../../engine/relationship.js');

const MINI = G.load(new Uint8Array(readFileSync(new URL('../data/mini.ged', import.meta.url))));
const EX_DIR = new URL('../../example/', import.meta.url);
const TODAY = new Date(2026, 10, 8);
const CONFIG = { root: 'I1', branches: [{ key: 'a', roots: ['I9'] }], living_extra: [], deceased_extra: [], exclude: [] };

const gd = (year) => G.parseDate(String(year));
function person({ year = null, died = false, noDate = false } = {}) {
  const p = new G.Person('X');
  p.events.push({ type: 'BIRT', date: noDate ? null : gd(year), place: null, value: '', cause: '', age: '' });
  if (died) p.events.push({ type: 'DEAT', date: null, place: null, value: '', cause: '', age: '' });
  return p;
}
const scope = S.determineScope(MINI, CONFIG, TODAY);

test('living', () => {
  const t = MINI;
  assert.ok(S.isLiving(t.people.get('I1'), TODAY));
  assert.ok(!S.isLiving(t.people.get('I4'), TODAY));
  assert.ok(S.isLiving(new G.Person('N'), TODAY));
  assert.ok(S.isLiving(person({ noDate: true }), TODAY));
  assert.ok(!S.isLiving(person({ year: 1925 }), TODAY));
  assert.ok(!S.isLiving(person({ year: 1990, died: true }), TODAY));
});

test('living_years_parameter', () => {
  assert.ok(S.isLiving(person({ year: 1925 }), TODAY, 120));
});

test('living_years_below_100_rejected', () => {
  for (const bad of [10, 99, 0, -5, 99.5, '100', true, null]) {
    assert.throws(() => S.determineScope(MINI, { ...CONFIG, living_years: bad }, TODAY), /living_years/, String(bad));
  }
  assert.throws(() => S.isLiving(person({ year: 1990 }), TODAY, 10));
  S.determineScope(MINI, { ...CONFIG, living_years: 100 }, TODAY);
});

test('living_years_refused', () => {
  for (const bad of [99, true, '100', 99.5]) assert.throws(() => S.checkLivingYears(bad), RangeError, String(bad));
  assert.equal(S.checkLivingYears(100), 100);
  assert.equal(S.checkLivingYears(120), 120);
});

test('scope_ends_at_root', () => {
  const s = scope;
  assert.ok(s.people.has('I7'));
  assert.ok(!s.mapPeople.has('I7'));
  assert.ok(!s.people.has('I8'));
  assert.equal(s.ahnentafel.get('I1'), 1);
  assert.equal(s.ahnentafel.get('I2'), 2);
  assert.equal(s.ahnentafel.get('I9'), 8);
  assert.ok(s.siblings.has('I6'));
  assert.ok(!s.ahnentafel.has('I6'));
});

test('branch_inherited_by_sibling', () => {
  const b = scope.branchOf;
  assert.equal(S.BRANCH_BOUNDARY, 8);
  assert.equal(b.get('I1'), S.COMMON);
  assert.equal(b.get('I4'), S.COMMON);
  assert.equal(b.get('I6'), S.COMMON);
  assert.equal(b.get('I9'), 'a');
  assert.equal(b.get('I11'), 'a');
  assert.equal(b.get('I13'), 'a');
});

test('other_branch_for_unassigned_ancestor', () => {
  const s = S.determineScope(MINI, { ...CONFIG, branches: [] }, TODAY);
  assert.equal(s.branchOf.get('I9'), S.OTHER);
  assert.equal(s.branchOf.get('I4'), S.COMMON);
});

test('exceptions', () => {
  const s = S.determineScope(MINI, { ...CONFIG, living_extra: ['I4'], deceased_extra: ['I1'], exclude: ['I6'] }, TODAY);
  assert.ok(s.living.has('I4'));
  assert.ok(!s.living.has('I1'));
  assert.ok(!s.people.has('I6'));
  assert.ok(s.excluded.has('I6'));
});

test('living_in_scope', () => {
  assert.ok(scope.living.has('I1'));
  assert.ok(scope.living.has('I2'));
  assert.ok(!scope.living.has('I4'));
});

test('living_years_from_config', () => {
  const s = S.determineScope(MINI, { ...CONFIG, living_years: 200 }, TODAY);
  assert.ok(s.people.has('I9'));
  assert.deepEqual(s.living, new Set([...s.people].filter((i) => !MINI.people.get(i).hasDeath)));
});

test('relationship_mini', () => {
  const r = (i, l) => relationship(scope, i, l);
  assert.equal(r('I2', 'cs'), 'otec');
  assert.equal(r('I3', 'cs'), 'matka');
  assert.equal(r('I2', 'en'), 'father');
  assert.equal(r('I4', 'cs'), 'dědeček');
  assert.equal(r('I6', 'cs'), 'bratr dědečka');
  assert.equal(r('I13', 'cs'), 'bratr pradědečka');
  assert.equal(r('I13', 'en'), 'brother of great-grandfather');
  assert.equal(r('I11', 'cs'), 'prapradědeček');
  assert.equal(r('I12', 'cs'), 'praprababička');
  assert.equal(r('I1', 'cs'), 'sám autor');
  assert.equal(r('I1', 'en'), 'the author');
});

// --- the example family -------------------------------------------------------------
const exConfig = JSON.parse(readFileSync(new URL('site.json', EX_DIR), 'utf8'));
const exTree = G.load(new Uint8Array(readFileSync(new URL(exConfig.gedcom, EX_DIR))));
const ex = S.determineScope(exTree, exConfig, TODAY);

test('example', () => {
  assert.equal(ex.ahnentafel.size, 29);
  assert.ok(ex.living.has('I1'));
  assert.equal(ex.branchOf.get('I14'), 'huber');
  assert.equal(ex.branchOf.get('I19'), 'cerny');
  assert.equal(ex.branchOf.get('I24'), 'kowalski');
  assert.equal(ex.branchOf.get('I1'), S.COMMON);
  assert.equal(ex.ahnentafel.get('I2'), 2);
});

test('root_has_siblings_but_not_children', () => {
  for (const i of exTree.children(ex.root)) assert.ok(!ex.people.has(i));
  for (const i of exTree.siblings(ex.root)) { assert.ok(ex.people.has(i)); assert.ok(ex.living.has(i)); }
  assert.equal(relationship(ex, 'I4', 'cs'), 'sestra');
  assert.equal(relationship(ex, 'I4', 'en'), 'sister');
});

test('spouses_and_descendants_of_siblings', () => {
  const r = (i, l) => relationship(ex, i, l);
  assert.equal(r('I9', 'cs'), 'manželka bratra otce');
  assert.equal(r('I9', 'en'), 'wife of brother of father');
  assert.equal(r('I17', 'cs'), 'bývalý manžel sestry dědečka');
  assert.equal(r('I17', 'en'), 'former husband of sister of grandfather');
  assert.equal(r('I8', 'cs'), 'sestřenice');
  assert.equal(r('I8', 'en'), 'first cousin');
  assert.equal(r('I18', 'cs'), 'bratranec otce');
  assert.equal(r('I33', 'cs'), 'bratranec pradědečka');
  for (const i of ['I9', 'I17', 'I8', 'I18']) assert.ok(ex.people.has(i));
  assert.ok(!ex.mapPeople.has('I9'));
  assert.deepEqual(ex.spouseFamilies.get('I17'), { divorce: true, marriage: true });
});

test('person_without_dates_is_deceased_by_exception', () => {
  assert.ok(S.isLiving(exTree.people.get('I34'), TODAY));
  assert.ok(!ex.living.has('I34'));
});

test('no_unassigned_ancestor', () => {
  assert.deepEqual([...ex.branchOf].filter(([, v]) => v === S.OTHER), []);
});

test('relationships_for_everyone', () => {
  assert.equal(relationship(ex, 'I2', 'cs'), 'otec');
  for (const i of ex.people) for (const l of ['cs', 'en']) assert.ok(relationship(ex, i, l), i);
});

test('living_have_no_death', () => {
  for (const i of ex.living) assert.ok(!exTree.people.get(i).hasDeath);
});

// --- a synthetic tree -------------------------------------------------------------------
function build(people, families) {
  const t = new G.Tree(new Map(), new Map());
  for (const [pid, sex, year, famc, fams] of people) {
    const p = new G.Person(pid);
    Object.assign(p, { given: pid, sex, parentsFamily: famc, families: [...fams] });
    if (year) p.events.push({ type: 'BIRT', date: gd(year), place: null, value: '', cause: '', age: '' });
    if (year && year < 1960) p.events.push({ type: 'DEAT', date: null, place: null, value: '', cause: '', age: '' });
    t.people.set(pid, p);
  }
  for (const [fid, h, w, children, events] of families) {
    const f = new G.Family(fid);
    Object.assign(f, { husband: h, wife: w, children: [...children], events: events.map((e) => ({ type: e, date: null, place: null, value: '', cause: '', age: '' })) });
    t.families.set(fid, f);
  }
  return t;
}

const SYN = build([
  ['R', 'M', 1990, 'F1', []],
  ['FA', 'M', 1960, 'F2', ['F1', 'F9']], ['MO', 'F', 1962, null, ['F1']],
  ['G1', 'M', 1930, 'F3', ['F2', 'F8']], ['G2', 'F', 1932, null, ['F2']],
  ['U0', 'F', 1958, 'F2', ['F5']], ['C0', 'M', 1985, 'F5', ['F6']],
  ['GC0', 'M', 2015, 'F6', []],
  ['U', 'M', 1928, 'F3', ['F4']], ['C', 'F', 1955, 'F4', ['F7']],
  ['GC', 'F', 1980, 'F7', []], ['GGC', 'M', 2010, 'F7', []],
  ['H', 'M', 1958, 'F8', []], ['HW', 'F', 1936, null, ['F8']],
  ['H2', 'F', 1996, 'F9', []], ['W2', 'F', 1970, 'F10', ['F9']],
  ['WP1', 'M', 1940, null, ['F10']], ['WP2', 'F', 1942, null, ['F10']],
  ['X', 'M', 1980, null, ['F5']], ['Y', 'F', 1990, null, ['F6']],
], [
  ['F1', 'FA', 'MO', ['R'], ['MARR']], ['F2', 'G1', 'G2', ['FA', 'U0'], []],
  ['F3', null, null, ['G1', 'U'], []], ['F4', 'U', null, ['C'], []],
  ['F5', 'X', 'U0', ['C0'], []], ['F6', 'C0', 'Y', ['GC0'], []],
  ['F7', null, 'C', ['GC', 'GGC'], []], ['F8', 'G1', 'HW', ['H'], []],
  ['F9', 'FA', 'W2', ['H2'], ['MARR', 'DIV']], ['F10', 'WP1', 'WP2', ['W2'], []],
]);
const syn = S.determineScope(SYN, { root: 'R' }, TODAY);
const rel = (i, l = 'cs') => relationship(syn, i, l);

test('cousins_and_their_descendants', () => {
  assert.equal(rel('C0'), 'bratranec');
  assert.equal(rel('C'), 'sestřenice otce');
  assert.equal(rel('GC'), 'druhá sestřenice');
  assert.equal(rel('GGC'), 'druhý bratranec');
  assert.equal(rel('GC0'), 'syn bratrance');
  assert.equal(rel('GC0', 'en'), 'son of first cousin');
  assert.equal(rel('GC', 'en'), 'second cousin');
});

test('half_siblings', () => {
  assert.deepEqual(syn.halfSiblings, new Set(['H', 'H2']));
  assert.equal(rel('H'), 'nevlastní bratr otce');
  assert.equal(rel('H', 'en'), 'half-brother of father');
  assert.equal(rel('H2'), 'nevlastní sestra');
  assert.equal(rel('H2', 'en'), 'half-sister');
  assert.ok(!syn.mapPeople.has('H'));
});

test('partners_and_co_parent_ancestors', () => {
  assert.equal(rel('W2'), 'bývalá manželka otce');
  assert.equal(rel('X'), 'přítel sestry otce');
  assert.equal(rel('X', 'en'), 'partner of sister of father');
  assert.equal(rel('WP1'), 'otec bývalé manželky otce');
  assert.equal(rel('WP1', 'en'), 'father of the former wife of father');
  assert.deepEqual(syn.partnerAncestor.get('WP1'), ['W2', 2]);
});

test('root_sibling_descendants_cs', () => {
  const t = build([['R', 'M', 1990, 'F1', []], ['FA', 'M', 1960, null, ['F1']],
    ['MO', 'F', 1962, null, ['F1']], ['S', 'F', 1992, 'F1', ['F2']],
    ['D1', 'M', 2015, 'F2', ['F3']], ['D2', 'F', 2040, 'F3', ['F4']],
    ['D3', 'M', 2060, 'F4', ['F5']], ['D4', 'F', 2080, 'F5', []]],
  [['F1', 'FA', 'MO', ['R', 'S'], []], ['F2', null, 'S', ['D1'], []],
    ['F3', 'D1', null, ['D2'], []], ['F4', null, 'D2', ['D3'], []],
    ['F5', 'D3', null, ['D4'], []]]);
  const s = S.determineScope(t, { root: 'R' }, new Date(2090, 0, 1));
  assert.equal(relationship(s, 'D1', 'cs'), 'synovec');
  assert.equal(relationship(s, 'D2', 'cs'), 'praneteř');
  assert.equal(relationship(s, 'D3', 'cs'), 'praprasynovec');
  assert.equal(relationship(s, 'D4', 'cs'), '3× praneteř');
  assert.equal(relationship(s, 'D2', 'en'), 'grandniece');
  assert.equal(relationship(s, 'D3', 'en'), 'great-grandnephew');
});

test('person_without_dates_is_living', () => {
  const t = new G.Tree(new Map([['X', new G.Person('X')]]), new Map());
  assert.ok(S.isLiving(t.people.get('X'), TODAY));
  const s = S.determineScope(t, { root: 'X' }, TODAY);
  assert.ok(s.people.has('X'));
  assert.ok(s.living.has('X'));
});

test('root_without_parents', () => {
  const p = new G.Person('X'); p.given = 'Solo';
  const t = new G.Tree(new Map([['X', p]]), new Map());
  const s = S.determineScope(t, { root: 'X' }, TODAY);
  assert.equal(s.root, 'X');
  assert.deepEqual(s.ahnentafel, new Map([['X', 1]]));
  assert.ok(s.people.has('X'));
  assert.ok(s.living.has('X'));
  assert.equal(s.branchOf.get('X'), S.COMMON);
  assert.equal(relationship(s, 'X', 'en'), 'the author');
  assert.equal(relationship(s, 'X', 'cs'), 'sám autor');
});
