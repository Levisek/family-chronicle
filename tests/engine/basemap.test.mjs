// Ported from tests/test_basemap.py; the command line (main) becomes basemap.build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { REPO } from './project.mjs';

const require = createRequire(import.meta.url);
const B = require('../../engine/basemap.js');

const SQUARE = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { name: 'x' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]] } }] };
const LINE = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-5, 5], [15, 5]] } }] };
const BOX = [5, 15, 5, 15];
const WORLD_MINI = {
  land: [SQUARE.features[0].geometry], lakes: [SQUARE.features[0].geometry],
  borders: [LINE.features[0].geometry], rivers: [LINE.features[0].geometry],
};

test('bbox_from_places', () => {
  assert.deepEqual(B.bboxFromPlaces({ A: { coords: [48, 10] }, B: { coords: [50, 14] }, C: { coords: [45.5, 12] } }, 3), [7, 17, 42.5, 53]);
});

test('bbox_clamped_to_globe', () => {
  assert.deepEqual(B.bboxFromPlaces({ A: { coords: [89, 179] } }, 5), [174, 180, 84, 90]);
});

test('bbox_needs_places', () => {
  assert.throws(() => B.bboxFromPlaces({}, 3), /no places with coords/);
  assert.throws(() => B.bboxFromPlaces({ A: { aliases: [] } }, 3), /no places with coords/);
});

test('parse_bbox', () => {
  assert.deepEqual(B.parseBbox('5,36,38,55'), [5, 36, 38, 55]);
  for (const bad of ['1,2,3', 'a,b,c,d', '10,5,1,2', '1,2,9,3']) assert.throws(() => B.parseBbox(bad), /bbox/);
});

test('ring_is_clipped', () => {
  const ring = B.clipRing([[0, 0], [20, 0], [20, 20], [0, 20]], BOX);
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [5, 15, 5, 15]);
});

test('ring_outside_vanishes', () => {
  assert.deepEqual(B.clipRing([[30, 30], [40, 30], [40, 40]], BOX), []);
});

test('line_is_clipped', () => {
  assert.deepEqual(B.clipLine([[-5, 10], [25, 10]], BOX), [[[5, 10], [15, 10]]]);
});

test('process_drops_properties_and_rounds', () => {
  let feats = B.processLayer('land', true, SQUARE, BOX);
  assert.deepEqual(feats[0].properties, { layer: 'land' });
  assert.equal(feats[0].geometry.type, 'MultiPolygon');
  feats = B.processLayer('rivers', false, LINE, BOX);
  assert.deepEqual(feats[0].geometry.coordinates, [[[5, 5], [15, 5]]]);
});

test('build_all_layers', () => {
  const g = B.build(WORLD_MINI, { A: { coords: [10, 10] } }, 5);
  assert.equal(g.type, 'FeatureCollection');
  assert.deepEqual(new Set(g.features.map((f) => f.properties.layer)), new Set(['land', 'lakes', 'borders', 'rivers']));
});

test('build_needs_places', () => {
  assert.throws(() => B.build(WORLD_MINI, {}, 3), /no places with coords/);
});

test('same_as_python', () => {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(REPO, 'app/data/world.js'), 'utf8'), ctx);
  const places = JSON.parse(readFileSync(join(REPO, 'example/places.json'), 'utf8'));
  const g = B.build(ctx.window.FC_WORLD, places, 3);
  const count = {};
  for (const f of g.features) count[f.properties.layer] = (count[f.properties.layer] || 0) + 1;
  const golden = JSON.parse(readFileSync(join(REPO, 'tests/golden/basemap-example.json'), 'utf8'));
  assert.deepEqual(count, golden.features);
  assert.deepEqual(B.bboxFromPlaces(places, 3), golden.bbox);
  assert.ok(statSync(join(REPO, 'app/data/world.js')).size <= 10e6);
});
