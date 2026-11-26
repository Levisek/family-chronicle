import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const G = require('../../engine/gedcom.js');
const S = require('../../engine/scope.js');
const P = require('../../engine/places.js');
const E = require('../../engine/events.js');

const PLACES = JSON.parse(readFileSync(new URL('../data/places.json', import.meta.url), 'utf8'));
const MINI = new Uint8Array(readFileSync(new URL('../data/mini.ged', import.meta.url)));
const CONFIG = { root: 'I1', branches: [{ key: 'a', roots: ['I9'] }], living_extra: [], deceased_extra: [], exclude: [] };
const SPRINGFIELD = [39.7817, -89.6501];
const d = (year, approximate = false) => Object.freeze({ year, month: null, day: null, approximate, text: String(year) });
const ev = (type, date, place) => ({ type, date, place, value: '', cause: '', age: '' });

function base() {
  const places = new P.Places(PLACES, ['Elsewhere']);
  const tree = G.load(MINI);
  const p = tree.people;
  p.get('I4').events[0].place = 'Millbrook č. p. 45';
  p.get('I4').events[1].place = 'Oldtown, Banat';
  p.get('I4').events[1].date = d(1950);
  p.get('I2').events[0].place = 'Springfield-North, Elm Road 12';
  p.get('I1').events[0].place = 'Springfield';
  p.get('I5').events[0].place = 'Elsewhere';
  tree.families.get('F2').events.push(ev('MARR', d(1920), 'Oldtown'));
  const scope = S.determineScope(tree, CONFIG, new Date(2026, 10, 8));
  const events = E.fromGedcom(tree, scope, places);
  return { places, tree, scope, events };
}

test('address_to_town', () => {
  const { places } = base();
  const t = (x) => places.town(x);
  assert.equal(t('Springfield-North, Elm Road 12'), 'Springfield');
  assert.equal(t('Millbrook č. p. 45'), 'Millbrook');
  assert.equal(t('Millbrook No. 21 (?)'), 'Millbrook');
  assert.equal(t('Oldtown, Serbia'), 'Oldtown');
  assert.equal(t('Nowhere'), null);
  assert.equal(t(''), null);
});

test('house_numbers', () => {
  for (const place of ['Upper Willow č. p. 9', 'Upper Willow č.p. 57', 'Upper Willow čp. 61', 'Upper Willow čp.9',
    'Upper Willow č. 61.', 'Upper Willow č.5', 'Upper Willow 137', 'Upper Willow No. 12',
    'Upper Willow no.5', 'Upper Willow No 7']) {
    assert.equal(P.toTown(place), 'Upper Willow', place);
  }
  assert.equal(P.toTown('Lhota'), 'Lhota');
});

test('czech_and_english_addresses', () => {
  const { places } = base();
  assert.equal(P.toTown('Brno, č. p. 12'), 'Brno');
  assert.equal(P.toTown('12 High Street, York'), 'York');
  assert.equal(P.toTown('221b Baker Street, London, England'), 'London');
  assert.equal(places.town('12 High Street, York'), 'York');
  assert.equal(places.town('Brno, č. p. 12'), 'Brno');
});

test('coords', () => {
  const { places } = base();
  assert.deepEqual(places.coords('Springfield'), SPRINGFIELD);
  assert.equal(places.coords('Nowhere'), null);
});

test('missing_place_is_reported_not_fatal', () => {
  const { tree, scope } = base();
  const places = new P.Places(PLACES, []);
  tree.people.get('I4').events[0].place = 'Atlantis, Harbour Road 3';
  const events = E.fromGedcom(tree, scope, places);
  assert.ok(!events.some((e) => e.id === 'birth-I4'));
  assert.ok(places.missing.has('Atlantis'));
  assert.ok(places.missing.has('Elsewhere'));
  assert.ok(!places.missing.has('Harbour Road 3'));
});

test('all_missing_with_empty_table', () => {
  const { tree, scope } = base();
  const places = new P.Places({}, []);
  assert.deepEqual(E.fromGedcom(tree, scope, places), []);
  assert.ok(places.missing.has('Millbrook') && places.missing.has('Oldtown'));
  assert.ok(!places.missing.has('Elm Road 12'));
});

test('ignored_is_not_missing', () => {
  const { places, events } = base();
  assert.ok(!events.some((e) => e.people.includes('I5') && e.type === 'birth'));
  assert.ok(!places.missing.has('Elsewhere'));
});

test('casefold_keys', () => {
  const places = new P.Places({ Straße: { coords: [1, 2], aliases: [] } }, []);
  assert.equal(places.town('STRASSE'), 'Straße');
});

test('living_have_no_events', () => {
  const { events } = base();
  assert.ok(!events.some((e) => e.people.includes('I1') || e.people.includes('I2')));
});

test('shape_and_date', () => {
  const { events } = base();
  const e = events.find((x) => x.id === 'birth-I4');
  assert.equal(e.date, 'about 1890');
  assert.equal(e.certainty, 'tree');
  assert.deepEqual(e.documents, []);
  assert.equal(e.place, 'Millbrook');
  assert.equal(e.year, 1890);
  assert.deepEqual(Object.keys(e).sort(), ['branch', 'certainty', 'date', 'description', 'documents', 'id', 'people', 'place', 'type', 'year']);
  assert.ok('cs' in e.description && 'en' in e.description);
});

test('marriage', () => {
  const { events } = base();
  assert.ok(events.some((e) => e.id === 'marriage-F2'));
  assert.ok(!events.some((e) => e.id === 'marriage-F1'));
});

test('format_date', () => {
  const gd = (year, month, day, approximate, text) => ({ year, month, day, approximate, text });
  assert.equal(E.formatDate(gd(1890, 3, 5, false, ''), 'en'), '5 Mar 1890');
  assert.equal(E.formatDate(gd(1890, 3, null, false, ''), 'en'), 'March 1890');
  assert.equal(E.formatDate(gd(1890, null, null, true, ''), 'cs'), 'kolem 1890');
  assert.equal(E.formatDate(gd(1890, 3, null, false, ''), 'cs'), 'březen 1890');
  assert.equal(E.formatDate(gd(1890, 3, 5, false, ''), 'cs'), '5. 3. 1890');
  assert.equal(E.formatDate(gd(null, null, null, false, 'before Easter'), 'en'), 'before Easter');
  assert.equal(E.formatDate(null), '');
});

test('manual', () => {
  const { places } = base();
  const b = { id: 'x', type: 'war', year: 1942, date: '1942', place: 'Oldtown, Serbia', branch: 'a', people: ['I4'],
    description: { cs: 'a', en: 'b' }, documents: [], certainty: 'uncertain' };
  assert.equal(E.manual([b], places)[0].place, 'Oldtown');
  const c = { ...b }; delete c.certainty;
  assert.throws(() => E.manual([c], places));
});

test('manual_rejects_bad_type_and_certainty', () => {
  const { places } = base();
  const b = { id: 'x', type: 'party', year: 1, date: '1', place: 'Oldtown', branch: 'a', people: [],
    description: { cs: 'a', en: 'b' }, documents: [], certainty: 'maybe' };
  assert.throws(() => E.manual([b], places), (e) => /party/.test(e.message) && /maybe/.test(e.message));
});

test('line_to_living_child_without_year', () => {
  const { tree, scope, events, places } = base();
  const line = E.migrationLines(tree, scope, events, places, { I2: 'Springfield' }).filter((l) => l.to === 'I2')[0];
  const last = line.points[line.points.length - 1];
  assert.equal(last[2], null);
  assert.deepEqual(last.slice(0, 2), SPRINGFIELD);
});

test('line_to_living_child_without_town_ends_at_parent', () => {
  const { tree, scope, events, places } = base();
  const line = E.migrationLines(tree, scope, events, places).filter((l) => l.to === 'I2')[0];
  assert.deepEqual(line.points.map((p) => p[2]), [1890, 1920]);
  assert.ok(!line.points.some((p) => p[0] === SPRINGFIELD[0] && p[1] === SPRINGFIELD[1]));
});

test('point_has_certainty', () => {
  const { tree, scope, events, places } = base();
  for (const line of E.migrationLines(tree, scope, events, places)) {
    for (const p of line.points) assert.ok(['document', 'tree', 'chronicle', 'uncertain'].includes(p[3]));
  }
});

test('point_order', () => {
  const { tree, scope, events, places } = base();
  const line = E.migrationLines(tree, scope, events, places, { I2: 'Springfield' }).filter((l) => l.to === 'I2')[0];
  assert.deepEqual(line.points.map((p) => p[2]), [1890, 1920, null]);
  assert.equal(line.from, 'I4');
});

test('output_has_no_street_addresses', () => {
  const { tree, scope, events, places } = base();
  assert.ok(!JSON.stringify([...events, ...E.migrationLines(tree, scope, events, places)]).includes('Elm Road'));
});
