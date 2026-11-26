// The JS build of example/ must give the same site as the Python build (tests/golden/example).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { folderMap, repoAssets, REPO } from './project.mjs';
import { fakeImages } from './fake-images.mjs';

const require = createRequire(import.meta.url);
const B = require('../../engine/build.js');
const { fromUtf8 } = require('../../engine/text.js');

const TEXT = ['.html', '.json', '.md', '.txt', '.xml'];
const norm = (s) => s.replace(/\.[0-9a-f]{8}\./g, '.HASH.').replace(/-[0-9a-f]{8}\.webp/g, '-HASH.webp');
const ext = (p) => p.slice(p.lastIndexOf('.'));

function comparable(path, content) {
  const s = norm(content);
  if (path.endsWith('manifest.json')) {
    const m = JSON.parse(s);
    return JSON.stringify({ files: Object.keys(m.files).sort(), check: m.check });
  }
  if (path.endsWith('.json')) return JSON.stringify(JSON.parse(s), (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));
  if (path.endsWith('.html') || path.endsWith('.xml')) return s.replace(/\s+/g, ' ');
  return s;
}

test('example_matches_python', async () => {
  const files = folderMap(join(REPO, 'example'));
  const result = await B.build({ files, configPath: 'site.json', assets: repoAssets(), today: new Date(2026, 10, 23), images: fakeImages() });
  assert.ok(result.ok, result.findings.join('\n'));
  const golden = folderMap(join(REPO, 'tests/golden/example'));
  const mine = new Map([...result.files].filter(([k]) => TEXT.includes(ext(k))).map(([k, v]) => [norm(k), fromUtf8(v)]));
  const theirs = new Map([...golden].map(([k, v]) => [norm(k), fromUtf8(v)]));
  const report = [];
  for (const k of theirs.keys()) if (!mine.has(k)) report.push(`missing: ${k}`);
  for (const k of mine.keys()) if (!theirs.has(k)) report.push(`extra: ${k}`);
  for (const [k, v] of theirs) {
    if (!mine.has(k)) continue;
    const a = comparable(k, mine.get(k)), b = comparable(k, v);
    if (a !== b) {
      let i = 0;
      while (i < a.length && a[i] === b[i]) i++;
      report.push(`differs: ${k} at ${i}\n  js: ${a.slice(Math.max(0, i - 60), i + 80)}\n  py: ${b.slice(Math.max(0, i - 60), i + 80)}`);
    }
  }
  assert.deepEqual(report.slice(0, 20), []);
});
