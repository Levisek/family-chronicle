import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';

const T = createRequire(import.meta.url)('../../engine/templates.js');
const DIR = new URL('../../templates/', import.meta.url);

test('generated_from_the_html_files', () => {
  const names = readdirSync(DIR).filter((f) => f.endsWith('.html')).sort().map((n) => n.replace(/\.html$/, ''));
  assert.deepEqual(Object.keys(T.TEMPLATES).sort(), names);
  for (const n of names) assert.equal(T.TEMPLATES[n], readFileSync(new URL(`${n}.html`, DIR), 'utf8'), `${n}: run node tools/make-templates.mjs`);
});

test('substitute_like_string_template', () => {
  assert.equal(T.substitute('a $x ${y}z $$ $x', { x: 1, y: 'Y' }), 'a 1 Yz $ 1');
  assert.throws(() => T.substitute('$missing', {}), /missing/);
  assert.throws(() => T.substitute('cost $ 5', {}), /invalid/);
  assert.equal(T.person({ branch: 'b', name: 'N', relationship_heading: 'R', relationship: 'r', details: '', parents: '',
    chronicle: '', documents: '', tree_only: '', root: '../', map_url: 'map.html', tree_url: 'tree.html', id: 'I1', on_map: 'm', back: 'b' })
    .startsWith('<article class="person branch-b">'), true);
});
