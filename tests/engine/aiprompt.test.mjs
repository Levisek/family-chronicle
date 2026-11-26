import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, repoAssets } from './project.mjs';

const require = createRequire(import.meta.url);
const A = require('../../engine/aiprompt.js');
const G = require('../../engine/gedcom.js');
const S = require('../../engine/scope.js');
const E = require('../../engine/events.js');

const GED = readFileSync(join(REPO, 'example/family.ged'), 'utf8');
const CFG = JSON.parse(readFileSync(join(REPO, 'example/site.json'), 'utf8'));
const PLACES = JSON.parse(readFileSync(join(REPO, 'example/places.json'), 'utf8'));
const TODAY = new Date(2026, 10, 26);
const TEXTS = { intro: 'Write the chronicle of {branch} in {language}.', rules: 'Use only these facts.', facts_title: 'Facts', chronicle_title: 'Current text' };

// Franz Huber (I14) made living: born 1952 in Wels, no death
const LIVING_GED = GED.replace(/0 @I14@ INDI[\s\S]*?(?=\n0 )/, (rec) => rec.replace(/\n1 BIRT\n2 DATE 1905\n2 PLAC Vienna/, '\n1 BIRT\n2 DATE 3 MAR 1952\n2 PLAC Wels').replace(/\n1 DEAT(\n2 [^\n]*)*/, ''));

function prompt(ged = GED, current = '# Huber\n', branchKey = 'huber') {
  const tree = G.parse(ged);
  const scope = S.determineScope(tree, CFG, TODAY);
  return { text: A.build({ tree, scope, cfg: CFG, branchKey, lang: 'en', languageName: 'English', current, places: PLACES, texts: TEXTS, locales: repoAssets().locales }), tree, scope };
}

test('prompt_deceased_facts', () => {
  const { text } = prompt();
  assert.ok(text.startsWith('Write the chronicle of Huber in English.'));
  assert.ok(text.includes('Use only these facts.'));
  const line = text.split('\n').find((l) => l.includes('Johann Huber [I43]'));
  assert.ok(line, text);
  assert.match(line, /born 1848, Vienna/);
  assert.match(line, /died 1915, Vienna/);
  // people of the other branches are not in it
  assert.ok(!text.includes('Václav Černý'));
});

test('prompt_no_living_data', () => {
  const { text, tree, scope } = prompt(LIVING_GED, '# Huber\n\nFranz was born on 3 March 1952 in Wels.\n');
  assert.ok(scope.living.has('I14'));
  const line = text.split('\n').find((l) => l.includes('[I14]'));
  assert.match(line, /^- Franz Huber \[I14\]: living, great-grandfather$/);
  assert.ok(!text.includes('3 March 1952') && !text.includes('1952'), text.slice(-400));
  // nobody's facts give a date of a living person: their children lines, marriages
  for (const id of scope.living) {
    const p = tree.people.get(id);
    const d = p.birth && p.birth.date ? E.formatDate(p.birth.date, 'en') : null;
    if (d && /\d/.test(d)) assert.ok(!text.includes(`${p.given} ${p.surname} (${p.birth.date.year}`), `${id} with a year`);
  }
});

test('prompt_contains_current', () => {
  const { text } = prompt(GED, '# Huber\n\n<!-- person: I43; I44 -->\nA paragraph [Fill in: trade].\n');
  assert.ok(text.trimEnd().endsWith('<!-- person: I43; I44 -->\nA paragraph [Fill in: trade].'));
  assert.ok(text.indexOf('Facts') < text.indexOf('Current text'));
});

test('prompt_html_name_is_text', () => {
  const ged = GED.replace('1 NAME Johann /Huber/\n2 GIVN Johann', '1 NAME <b>Johann</b> /Huber/\n2 GIVN <b>Johann</b>');
  assert.ok(prompt(ged).text.includes('<b>Johann</b> Huber [I43]'));   // plain text for a chat, not HTML
});
