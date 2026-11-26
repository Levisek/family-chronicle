import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const Z = require('../../engine/gazetteer.js');
const G = require('../../engine/gedcom.js');

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../data/gazetteer-mini.js', import.meta.url), 'utf8'), ctx);
const GAZ = JSON.parse(JSON.stringify(ctx.window.FC_GAZ));
const EMPTY = G.parse('0 HEAD\n0 TRLR\n');

test('normalize_strips', () => {
  assert.equal(Z.normalize('  Brünn '), 'brunn');
  assert.equal(Z.normalize('Horní Lhota č. 12'), 'horni lhota');
  assert.equal(Z.normalize('Lhota čp. 7'), 'lhota');
  assert.equal(Z.normalize('Kraków (Krakau)'), 'krakow');
  assert.equal(Z.normalize('Lhota 15'), 'lhota');
});

test('alias_found', () => {
  const r = Z.lookup('Wien', GAZ);
  assert.equal(r.status, 'unique');
  assert.equal(r.candidates[0].name, 'Vienna');
  assert.deepEqual([r.candidates[0].lat, r.candidates[0].lon, r.candidates[0].cc], [48.2085, 16.3721, 'AT']);
  assert.equal(Z.lookup('Brünn, Mähren', GAZ).candidates[0].name, 'Brno');
  assert.equal(Z.lookup('Neverland', GAZ).status, 'none');
  assert.deepEqual(Z.lookup('Neverland', GAZ).candidates, []);
});

test('first_found_part_wins', () => {
  // a street or a farm name before the town: the first part that is found wins
  assert.equal(Z.lookup('Hofgasse 3, Linz, Austria', GAZ).candidates[0].name, 'Linz');
});

test('narrowing_by_country', () => {
  const a = Z.lookup('Lhota, Czech Republic', GAZ);
  assert.equal(a.status, 'ambiguous');
  assert.equal(a.candidates.length, 2);
  assert.equal(a.candidates[0].admin1, 'Central Bohemia');
  const b = Z.lookup('Lhota, Olomoucký kraj, Česko', GAZ);
  assert.equal(b.status, 'unique');
  assert.equal(b.candidates[0].lat, 49.7111);
  assert.equal(Z.lookup('Lhota, Austria', GAZ).status, 'ambiguous');   // narrowing to nothing keeps the candidates
  assert.equal(Z.lookup('Lhota, CZ', GAZ).status, 'ambiguous');
});

test('at_most_eight_candidates', () => {
  const gaz = { ...GAZ, names: Array.from({ length: 20 }, (_, i) => ['Ves', 49 + i / 100, 15, 'CZ', '88']), index: {} };
  const r = Z.lookup('Ves', gaz);
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.candidates.length, 8);
});

test('ambiguous_never_picked', () => {
  const r = Z.resolveAll(['Lhota', 'Lhota, Czech Republic'], EMPTY, GAZ, {});
  for (const p of ['Lhota', 'Lhota, Czech Republic']) {
    assert.equal(r[p].status, 'ambiguous');
    assert.equal(r[p].coords, undefined);
    assert.equal(r[p].candidates.length, 2);
  }
});

test('resolved_entry', () => {
  const r = Z.resolveAll(['Wien, Austria'], EMPTY, GAZ, {});
  assert.deepEqual(r['Wien, Austria'], { town: 'Wien', coords: [48.2085, 16.3721], source: 'gazetteer', country: { en: 'Austria', cs: 'Rakousko' }, name: 'Vienna' });
  assert.deepEqual(Z.resolveAll(['Atlantis'], EMPTY, GAZ, {}).Atlantis, { town: 'Atlantis', status: 'none', candidates: [] });
});

test('existing_kept', () => {
  const existing = { Linz: { coords: [1, 2], country: { en: 'X' }, aliases: ['Lentia'], source: 'manual' } };
  const r = Z.resolveAll(['Linz', 'Lentia, Austria'], EMPTY, GAZ, existing);
  assert.deepEqual(r.Linz, { town: 'Linz', coords: [1, 2], source: 'manual', country: { en: 'X' }, existing: true });
  assert.equal(r['Lentia, Austria'].town, 'Linz');
  assert.deepEqual(r['Lentia, Austria'].coords, [1, 2]);
  assert.deepEqual(existing.Linz.coords, [1, 2]);
});

test('gedcom_coords_first', () => {
  const tree = G.parse('0 @I1@ INDI\n1 BIRT\n2 PLAC Linz\n3 MAP\n4 LATI N48.3\n4 LONG E14.2\n0 TRLR\n');
  const r = Z.resolveAll(['Linz'], tree, GAZ, {});
  assert.deepEqual(r.Linz, { town: 'Linz', coords: [48.3, 14.2], source: 'gedcom', country: {} });
});

test('nominatim_query_only_place', () => {
  const u = new URL(Z.nominatimUrl('Lhota u Kolína, Čechy'));
  assert.equal(u.origin + u.pathname, 'https://nominatim.openstreetmap.org/search');
  assert.deepEqual([...u.searchParams.keys()].sort(), ['format', 'limit', 'q']);
  assert.equal(u.searchParams.get('q'), 'Lhota u Kolína, Čechy');
  assert.equal(u.searchParams.get('format'), 'jsonv2');
  assert.equal(u.searchParams.get('limit'), '5');
});

test('parse_nominatim', () => {
  const json = [
    { lat: '50.0', lon: '15.1', display_name: 'Lhota, Kolín, Central Bohemia, Czechia', address: { country_code: 'cz' }, name: 'Lhota' },
    { lat: 'x', lon: '1' },
    { lat: '49.5', lon: '17.0', display_name: 'Lhota, Olomouc, Czechia' },
  ];
  assert.deepEqual(Z.parseNominatim(json), [
    { name: 'Lhota', lat: 50, lon: 15.1, cc: 'CZ', admin1: 'Lhota, Kolín, Central Bohemia, Czechia' },
    { name: 'Lhota, Olomouc, Czechia', lat: 49.5, lon: 17, cc: '', admin1: 'Lhota, Olomouc, Czechia' },
  ]);
  assert.deepEqual(Z.parseNominatim({ error: 'x' }), []);
});

test('same_town_different_places_not_merged', () => {
  // "Lhota, Středočeský kraj" and "Lhota, Olomoucký kraj" are two villages: never one silent pick
  const strings = ['Lhota, Central Bohemia', 'Lhota, Olomoucký kraj'];
  const towns = Z.groupTowns(strings, Z.resolveAll(strings, EMPTY, GAZ, {}));
  assert.equal(towns.length, 1);
  assert.equal(towns[0].status, 'pending');
  assert.equal(towns[0].coords, undefined);
  assert.equal(towns[0].candidates.length, 2);
});

test('same_town_consistent_kept', () => {
  // a bare ambiguous "Lhota" and a unique "Lhota, Olomoucký kraj" that is one of its candidates agree
  const strings = ['Lhota', 'Lhota, Olomoucký kraj', 'Wien', 'Wien, Austria'];
  const towns = Object.fromEntries(Z.groupTowns(strings, Z.resolveAll(strings, EMPTY, GAZ, {})).map((x) => [x.town, x]));
  assert.equal(towns.Lhota.status, 'found');
  assert.deepEqual(towns.Lhota.coords, [49.7111, 17.6011]);
  assert.deepEqual(towns.Lhota.strings, ['Lhota', 'Lhota, Olomoucký kraj']);
  assert.equal(towns.Wien.status, 'found');
  // a unique match that is not among the candidates of another string of the same town: ask
  const g2 = { ...GAZ, names: [...GAZ.names, ['Wien', 40.0, -80.0, 'US', 'PA']] };
  const s2 = ['Wien, Austria', 'Wien'];
  assert.equal(Z.groupTowns(s2, Z.resolveAll(s2, EMPTY, g2, {}))[0].status, 'found');
  const s3 = ['Wien, Austria', 'Wien, US'];
  assert.equal(Z.groupTowns(s3, Z.resolveAll(s3, EMPTY, g2, {}))[0].status, 'pending');
});

test('online_query_no_house_numbers', () => {
  assert.equal(Z.onlineQuery('Hlavní 12, Malá Ves, Czechia'), 'Hlavní, Malá Ves, Czechia');
  assert.equal(Z.onlineQuery('Malá Ves č. p. 34'), 'Malá Ves');
  assert.equal(Z.onlineQuery('12 High Street, Leeds'), 'Leeds');
  assert.equal(Z.onlineQuery('ul. Długa 5, Kraków'), 'Kraków');
  assert.equal(Z.onlineQuery('Xyzzy Hamlet, Neverland'), 'Xyzzy Hamlet, Neverland');
});
