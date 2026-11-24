import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const load = (rel) => JSON.parse(readFileSync(new URL(rel, root), 'utf8'));
const LOCALES = { en: load('locales/en.json'), cs: load('locales/cs.json') };
const scripts = readdirSync(new URL('static/', root)).filter((f) => f.endsWith('.js'));
const read = (f) => readFileSync(new URL('static/' + f, root), 'utf8');
// comments out, so that a key mentioned in a comment does not count as used
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

test('every T.<key> the scripts read exists in every locale', () => {
  const used = new Map();
  for (const f of scripts) {
    for (const m of code(read(f)).matchAll(/\bT\.([A-Za-z_]\w*)/g)) {
      if (!used.has(m[1])) used.set(m[1], f);
    }
  }
  assert.ok(used.size > 50, 'the scan found the keys (' + used.size + ')');
  for (const [lang, strings] of Object.entries(LOCALES)) {
    for (const [key, file] of used) assert.ok(key in strings, `${lang}: "${key}" (used in ${file}) is missing`);
  }
});

test('keys built at run time: certainty_<certainty>, roles, roles_of, event types', () => {
  for (const [lang, strings] of Object.entries(LOCALES)) {
    for (const c of ['document', 'tree', 'chronicle', 'uncertain']) assert.ok(strings['certainty_' + c], `${lang}: certainty_${c}`);
    const roles = Object.keys(strings.roles).sort();
    assert.deepEqual(Object.keys(strings.roles_of).sort(), roles, `${lang}: roles and roles_of have the same keys`);
    assert.deepEqual(roles, ['brother', 'daughter', 'father', 'former_husband', 'former_wife', 'husband', 'mother', 'partner', 'partner_f', 'sister', 'son', 'wife']);
    for (const t of ['birth', 'death', 'burial', 'marriage', 'move', 'transport', 'war', 'other']) assert.ok(strings.event_types[t], `${lang}: event_types.${t}`);
  }
});

test('the roles the scripts ask for exist', () => {
  const asked = new Set();
  for (const f of scripts) {
    const src = code(read(f));
    if (f === 'tree.js') for (const m of src.matchAll(/\bR\.([a-z_]+)/g)) asked.add(m[1]);      // R = T.roles
    for (const m of src.matchAll(/bySex\(\w+, '([a-z_]+)', '([a-z_]+)'\)/g)) { asked.add(m[1]); asked.add(m[2]); }
  }
  assert.ok(asked.size >= 10, 'found the roles (' + asked.size + ')');
  for (const [lang, strings] of Object.entries(LOCALES)) {
    for (const k of asked) assert.ok(k in strings.roles && k in strings.roles_of, `${lang}: role ${k}`);
  }
});

test('the list tree uses for generation labels: generations_up has the root and the first generations', () => {
  for (const [lang, strings] of Object.entries(LOCALES)) {
    assert.ok(Array.isArray(strings.generations_up) && strings.generations_up.length >= 3, `${lang}: generations_up`);
    assert.ok(Array.isArray(strings.generations_down) && strings.generations_down.length >= 1, `${lang}: generations_down`);
  }
});

test('placeholders in the strings the scripts fill exist in every locale', () => {
  const placeholders = { card_more_n: ['n'], children_n: ['n'], siblings_n: ['n'], documents_n: ['n'], mentions: [], chapter_n: ['n'],
    person_journey: ['name'], next_up: ['what'], card_no_year: ['list'], end_stops: ['n'], view_subtitle: ['name'], fan_subtitle_from: ['name'] };
  for (const [lang, strings] of Object.entries(LOCALES)) {
    for (const [key, names] of Object.entries(placeholders)) {
      if (!(key in strings)) continue;
      for (const n of names) assert.ok(strings[key].includes('{' + n + '}'), `${lang}: ${key} has {${n}}`);
    }
  }
});
