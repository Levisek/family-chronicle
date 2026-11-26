// The offline app cannot fetch its own files from file:// URLs, so the site assets, the fonts,
// the locales and the example project are bundled into app/data/*.js by tools/make-app-data.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { folderMap, repoAssets, REPO } from './project.mjs';

function load(...files) {
  const ctx = { window: {}, atob: globalThis.atob, Uint8Array, Map, Object, JSON };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(readFileSync(join(REPO, f), 'utf8'), ctx, { filename: f });
  return ctx.window;
}

test('app_data_fresh', () => {
  execFileSync(process.execPath, [join(REPO, 'tools/make-app-data.mjs'), '--check'], { stdio: 'pipe' });
});

test('assets_roundtrip', () => {
  const w = load('app/data/assets.js', 'app/data.js');
  const got = w.FCApp.data.assets();
  const want = repoAssets();
  for (const kind of ['static', 'fonts']) {
    assert.deepEqual([...got[kind].keys()].sort(), [...want[kind].keys()].sort(), kind);
    for (const [k, v] of want[kind]) assert.deepEqual(Buffer.from(got[kind].get(k)), Buffer.from(v), `${kind}/${k}`);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(got.locales)), want.locales);
});

test('example_roundtrip', () => {
  const w = load('app/data/example.js', 'app/data.js');
  const got = w.FCApp.data.example();
  const want = folderMap(join(REPO, 'example'));
  assert.deepEqual([...got.keys()].sort(), [...want.keys()].sort());
  for (const [k, v] of want) assert.deepEqual(Buffer.from(got.get(k)), Buffer.from(v), k);
});
