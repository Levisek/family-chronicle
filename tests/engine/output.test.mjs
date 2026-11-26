import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const O = require('../../engine/output.js');
const { utf8 } = require('../../engine/text.js');

const result = (ok = true) => ({
  ok,
  files: new Map([['family/index.html', utf8('a')], ['family/data/people.json', utf8('b')], ['manifest.json', utf8('{}')], ['approval.md', utf8('c')]]),
});

test('plan_writes_only_web', () => {
  const p = O.plan(new Set(['site.json', 'family.ged']), result(), 'family');
  assert.equal(p.refused, undefined);
  assert.deepEqual([...p.writes.keys()].sort(), ['web/.family-chronicle-output', 'web/approval.md', 'web/family/data/people.json', 'web/family/index.html', 'web/manifest.json']);
  for (const k of p.writes.keys()) assert.ok(k.startsWith('web/'));
  assert.deepEqual(p.deletes, []);
});

test('plan_deletes_stale', () => {
  const existing = new Set(['site.json', 'web/.family-chronicle-output', 'web/manifest.json', 'web/family/index.html', 'web/family/old.html', 'web/family/img/x.webp', 'web/other/keep.html', 'web/familyX/keep.html']);
  const p = O.plan(existing, result(), 'family');
  assert.deepEqual(p.deletes, ['web/family/img/x.webp', 'web/family/old.html']);
});

test('foreign_web_refused', () => {
  const p = O.plan(new Set(['site.json', 'web/family/index.html', 'web/family/photo.jpg']), result(), 'family');
  assert.match(p.refused, /web\/family/);
  assert.equal(p.writes, undefined);
  assert.equal(p.deletes, undefined);
});

test('marker_allows_replace', () => {
  const p = O.plan(new Set(['web/.family-chronicle-output', 'web/family/index.html']), result(), 'family');
  assert.equal(p.refused, undefined);
  assert.ok(p.writes.has('web/family/index.html'));
});

test('foreign_manifest_is_not_a_marker', () => {
  // web/manifest.json is a common file name (web app manifests); only our marker counts
  const p = O.plan(new Set(['web/manifest.json', 'web/family/index.html']), result(), 'family');
  assert.match(p.refused || '', /web\/family/);
});

test('failed_check_writes_nothing', () => {
  const p = O.plan(new Set(['web/.family-chronicle-output', 'web/family/index.html']), result(false), 'family');
  assert.deepEqual(p, { refused: 'check failed' });
});

test('backup_paths', () => {
  const files = new Map([['site.json', utf8('1')], ['places.json', utf8('2')], ['chronicles/a.md', utf8('3')]]);
  const b = O.backup(files, ['site.json', 'chronicles/a.md', 'missing.json'], '2026-11-26-143010');
  assert.deepEqual([...b.keys()], ['history/2026-11-26-143010/site.json', 'history/2026-11-26-143010/chronicles/a.md']);
  assert.deepEqual(b.get('history/2026-11-26-143010/site.json'), utf8('1'));
  assert.equal(O.stamp(new Date(2026, 10, 26, 14, 30, 10)), '2026-11-26-143010');
});
