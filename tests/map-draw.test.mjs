import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const M = require('../static/map-draw.js');
const load = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

test('proj/inv: round trip', () => {
  const [x, y] = M.proj(49.83, 18.28);
  const [lat, lon] = M.inv(x, y);
  assert.ok(Math.abs(lat - 49.83) < 1e-9, `lat ${lat}`);
  assert.ok(Math.abs(lon - 18.28) < 1e-9, `lon ${lon}`);
});

const BOX = [46.5, 12.9, 51.1, 21.4];                 // [south, west, north, east] as the build writes it
const BOUNDS = M.worldBounds(BOX);

test('worldBounds: no box means the whole Mercator world', () => {
  const [x0, y0, x1, y1] = M.worldBounds(null);
  assert.ok(x0 < -3 && x1 > 3 && y0 < -1.3 && y1 > 1.3);
  assert.deepEqual(M.worldBounds([1, 2, 3]), M.worldBounds(undefined));
});

test('clampView: the visible rectangle stays inside the given bounds, or covers them and is centred', () => {
  const [mx0, my0, mx1, my1] = BOUNDS;
  const W = 1280, H = 800, eps = 1e-12;
  const zooms = [1, 50, 200, 800, 3000, 20000];
  const centres = [[0, 0], [M.proj(49.8, 18.3)[0], M.proj(49.8, 18.3)[1]], [mx1, my1], [mx0, my0], [10, -10], [-5, 5]];
  for (const z of zooms) for (const [x, y] of centres) {
    const o = M.clampView({ x, y, z }, W, H, BOUNDS);
    assert.ok(o.z >= z - 1e-9, 'the zoom never shrinks');
    const hw = W / 2 / o.z, hh = H / 2 / o.z;
    const ok = (v, half, lo, hi) => (v - half >= lo - eps && v + half <= hi + eps) || (2 * half >= hi - lo && Math.abs(v - (lo + hi) / 2) < eps);
    assert.ok(ok(o.x, hw, mx0, mx1), `x z=${z}`);
    assert.ok(ok(o.y, hh, my0, my1), `y z=${z}`);
  }
});

test('clampView: bounds of another region limit the camera there, not in Central Europe', () => {
  const south = M.worldBounds([-40, 140, -30, 155]);
  const o = M.clampView({ x: 0, y: 0, z: 10 }, 1280, 800, south);
  assert.ok(o.x > south[0] - 1e-9 && o.x < south[2] + 1e-9, 'centre is inside the southern-hemisphere box');
  assert.ok(o.y > south[1] - 1e-9 && o.y < south[3] + 1e-9);
  assert.ok(o.x > 2, 'east of Greenwich');
});

test('clampView: when the bounds do not fit, the zoom grows', () => {
  const o = M.clampView({ x: 0.4, y: -0.9, z: 10 }, 1280, 800, BOUNDS);
  assert.ok(o.z > 10);
});

test('clampView: a tall narrow panel shows the whole width of the bounds', () => {
  const o = M.clampView({ x: 0, y: 0, z: 1 }, 450, 900, BOUNDS);
  assert.ok(Math.abs(450 / o.z - (BOUNDS[2] - BOUNDS[0])) < 1e-9, 'the bounds fit the panel width');
  assert.ok(Math.abs(o.x - (BOUNDS[0] + BOUNDS[2]) / 2) < 1e-12);
});

test('clampView: a valid view stays unchanged', () => {
  const [x, y] = M.proj(48.8, 17.1);
  assert.deepEqual(M.clampView({ x, y, z: 20000 }, 1280, 800, BOUNDS), { x, y, z: 20000 });
});

test('collides: a label touching a marker (+4 px) is not drawn', () => {
  const marks = [[100, 100, 112, 112]];
  assert.equal(M.collides([90, 90, 105, 105], marks), true);       // direct overlap
  assert.equal(M.collides([60, 100, 97, 112], marks), true);       // within 4 px of the marker
  assert.equal(M.collides([60, 100, 90, 112], marks), false);      // farther than 4 px
  assert.equal(M.collides([200, 200, 260, 215], marks), false);
  assert.equal(M.collides([90, 90, 105, 105], []), false);
});

test('createFlight: starts and ends at the given views', () => {
  const a = { x: 0.3, y: -0.9, z: 400 }, b = { x: 0.33, y: -0.88, z: 5000 };
  const l = M.createFlight(a, b, 1280);
  const p = l.i(0), k = l.i(1);
  for (const [u, v] of [[p, a], [k, b]]) {
    assert.ok(Math.abs(u.x - v.x) < 1e-9 && Math.abs(u.y - v.y) < 1e-9 && Math.abs(u.z / v.z - 1) < 1e-9);
  }
  assert.ok(l.duration >= 0.9 && l.duration <= 4.2);
});

test('bezierArc: starts and ends at the world coordinates of the places, deterministic', () => {
  const a = M.proj(49.83, 18.28), b = M.proj(48.15, 17.11);
  const o1 = M.bezierArc(a, b, 0.16, 'T1');
  const o2 = M.bezierArc(a, b, 0.16, 'T1');
  assert.deepEqual(o1.points, o2.points);
  assert.deepEqual(o1.points[0], a);
  assert.ok(Math.hypot(o1.points.at(-1)[0] - b[0], o1.points.at(-1)[1] - b[1]) < 1e-12);
});

test('no hand-placed geography in the engine or in the locales', () => {
  const src = readFileSync(new URL('../static/map-draw.js', import.meta.url), 'utf8');
  for (const word of ['LABELS', 'TOWNS', 'RIDGES', 'CITIES', 'CURVES', 'labelKeys']) assert.ok(!src.includes(word), word);
  for (const lang of ['en', 'cs']) {
    const t = load(`../locales/${lang}.json`);
    assert.ok(!('map_labels' in t), `${lang}: map_labels`);
    assert.ok(t.degrees_east.includes('{n}') && t.unit_km, lang);
  }
});

test('hexA: 6-digit and 3-digit #rgb', () => {
  assert.equal(M.hexA('#6a5640', 0.5), 'rgba(106, 86, 64, 0.5)');
  assert.equal(M.hexA('#abc', 1), 'rgba(170, 187, 204, 1)');
  assert.equal(M.hexA('#ABC', 1), M.hexA('#aabbcc', 1));
});
