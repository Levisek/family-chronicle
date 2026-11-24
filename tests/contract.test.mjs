import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// The build writes documents as {description, crop, sheet, verified} (docs/data-format.md);
// the scripts must read exactly those keys.
const root = new URL('../', import.meta.url);
const read = (f) => readFileSync(new URL('static/' + f, root), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

test('the scripts that show documents read `verified` and `sheet`', () => {
  for (const f of ['tree.js', 'map-film.js']) {
    const src = code(read(f));
    assert.match(src, /\.sheet\b/, `${f} reads .sheet`);
    assert.match(src, /\.crop\b/, `${f} reads .crop`);
  }
  assert.match(code(read('tree.js')), /\.verified\b/, 'tree.js reads .verified');
});

test('no leftover keys or identifiers from the old data format', () => {
  const banned = [/\.overeny\b/, /\.list\b/, /Lupy/, /Barva/, /panelObsah/, /\.vetev\b/, /\.zijici\b/];
  for (const f of readdirSync(new URL('static/', root)).filter((x) => x.endsWith('.js'))) {
    const src = code(read(f));
    for (const re of banned) assert.ok(!re.test(src), `${f}: ${re}`);
  }
});
