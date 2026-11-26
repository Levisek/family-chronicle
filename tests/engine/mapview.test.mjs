import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const M = createRequire(import.meta.url)('../../engine/mapview.js');

test('bounds_cover_the_places_with_a_margin', () => {
  assert.deepEqual(M.bounds({ A: { coords: [10.0, 20.0] }, B: { coords: [14.0, 30.0] } }), [9.0, 17.5, 15.0, 32.5]);
});

test('single_place_gets_the_minimum_margin', () => {
  assert.deepEqual(M.bounds({ A: { coords: [10.0, 20.0] } }), [9.0, 19.0, 11.0, 21.0]);
});

test('southern_hemisphere_and_no_places', () => {
  assert.deepEqual(M.bounds({ A: { coords: [-34.0, 151.0] } }), [-35.0, 150.0, -33.0, 152.0]);
  assert.equal(M.bounds({}), null);
});

test('poles_and_date_line_are_clamped', () => {
  const b = M.bounds({ A: { coords: [89.5, 179.9] } });
  assert.deepEqual([b[2], b[3]], [80.0, 180.0]);
});

const GOOD = { text: { en: 'X' }, lat: 1, lon: 2, kind: 'town' };

test('valid_labels_pass_through', () => {
  assert.deepEqual(M.labels({ map_labels: [GOOD] }), [GOOD]);
  assert.deepEqual(M.labels({}), []);
});

test('invalid_labels_are_errors', () => {
  for (const bad of [{ ...GOOD, kind: 'lake' }, { ...GOOD, lat: '1' }, { ...GOOD, lat: 91 },
    { ...GOOD, text: 'X' }, { ...GOOD, text: {} }, 'x', { ...GOOD, lat: true }]) {
    assert.throws(() => M.labels({ map_labels: [bad] }), Error, JSON.stringify(bad));
  }
  assert.throws(() => M.labels({ map_labels: {} }));
});

test('map_data', () => {
  assert.deepEqual(M.mapData({ A: { coords: [10.0, 20.0] } }, {}), { bounds: [9.0, 19.0, 11.0, 21.0], labels: [] });
});
