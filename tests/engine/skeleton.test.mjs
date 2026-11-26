import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, repoAssets } from './project.mjs';

const require = createRequire(import.meta.url);
const K = require('../../engine/skeleton.js');
const G = require('../../engine/gedcom.js');
const S = require('../../engine/scope.js');

const GED = readFileSync(join(REPO, 'example/family.ged'), 'utf8');
const CFG = JSON.parse(readFileSync(join(REPO, 'example/site.json'), 'utf8'));
const PLACES = JSON.parse(readFileSync(join(REPO, 'example/places.json'), 'utf8'));
const LOCALES = repoAssets().locales;
const TODAY = new Date(2026, 10, 26);

function draft(ged, lang = 'en', branchKey = 'huber', locale = LOCALES[lang], cfg = CFG) {
  const tree = G.parse(ged);
  const scope = S.determineScope(tree, cfg, TODAY);
  return K.build({ tree, scope, cfg, branchKey, lang, locale, places: PLACES });
}

const blocks = (md) => md.split(/\n\s*\n/);
const blockOf = (md, id) => blocks(md).find((b) => new RegExp(`<!-- person: (?:[^>]*\\b)?${id}\\b`).test(b));

test('skeleton_example_huber', () => {
  const md = draft(GED);
  assert.ok(md.startsWith('# Huber\n'), md.slice(0, 40));
  // the oldest generation first: Johann and Barbara, then their son's generation
  const first = md.indexOf('<!-- person: I43; I44 -->');
  assert.ok(first > 0 && first < md.indexOf('<!-- person: I30; I31 -->') && md.indexOf('<!-- person: I30; I31 -->') < md.indexOf('<!-- person: I14; I15 -->'));
  assert.match(md, /## Generation 1\n/);
  assert.match(blockOf(md, 'I43'), /Johann Huber was born 1848 in Vienna\./);
  assert.match(blockOf(md, 'I43'), /<!-- place: Vienna -->/);
  // Katharina Lang: no birthplace, a death without a date
  const kat = blockOf(md, 'I36');
  assert.match(kat, /\[Fill in: birthplace\]/);
  assert.match(kat, /\[Fill in: date of death\]/);
  // the people of the other branches are not in it
  assert.ok(!md.includes('I19') && !md.includes('Černý'));
});

test('skeleton_cs_gender', () => {
  const md = draft(GED, 'cs');
  assert.ok(md.startsWith('# Huberovi\n'));
  assert.match(md, /## 1\. generace\n/);
  assert.match(blockOf(md, 'I43'), /Johann Huber se narodil 1848 v obci Vienna\./);
  assert.match(blockOf(md, 'I44'), /Barbara Maier se narodila 1850 v obci Vienna\./);
  assert.match(blockOf(md, 'I44'), /zemřela/);
});

test('skeleton_living_ancestor', () => {
  // Franz Huber (I14) without a death and born 1952 in Wels: living, so only his name and relation
  const ged = GED.replace(/0 @I14@ INDI[\s\S]*?(?=\n0 )/, (rec) => rec.replace(/\n1 BIRT\n2 DATE 1905\n2 PLAC Vienna/, '\n1 BIRT\n2 DATE 1952\n2 PLAC Wels').replace(/\n1 DEAT(\n2 [^\n]*)*/, ''));
  assert.ok(ged.includes('2 PLAC Wels'));
  const md = draft(ged);
  const b = blockOf(md, 'I14');
  assert.match(b, /Franz Huber \(great-grandfather\)/);
  assert.ok(!md.includes('1952') && !md.includes('Wels'), b);
});

test('skeleton_no_data', () => {
  const ged = GED.replace(/0 @I43@ INDI[\s\S]*?(?=\n0 )/, (rec) => rec.split('\n').filter((l) => /^0 |^1 NAME|^1 SEX|^1 FAMS|^1 FAMC|^1 DEAT|^2 [GS][IU]/.test(l)).join('\n'));
  const md = draft(ged);
  const b = blockOf(md, 'I43');
  // (a bare DEAT: without any death he would count as living, birth unknown)
  assert.match(b, /Johann Huber was born \[Fill in: birth date\] in \[Fill in: birthplace\]\./);
  assert.match(b, /Johann Huber died \[Fill in: date of death\] in \[Fill in: place of death\]\./);
});

test('skeleton_html_name', () => {
  const ged = GED.replace('1 NAME Johann /Huber/\n2 GIVN Johann', '1 NAME <img src=x onerror=alert(1)> /Huber/\n2 GIVN <img src=x onerror=alert(1)>');
  const md = draft(ged);
  assert.ok(md.includes('&lt;img src=x onerror=alert(1)&gt; Huber'));
  assert.ok(!md.includes('<img'));
});

test('skeleton_other_language', () => {
  const de = { ...LOCALES.en };
  delete de.skeleton;
  const cfg = { ...CFG, branches: CFG.branches.map((b) => ({ ...b, name: { ...b.name, de: 'Huber (de)' } })) };
  const md = draft(GED, 'de', 'huber', de, cfg);
  assert.ok(md.startsWith('# Huber (de)\n'));
  assert.match(blockOf(md, 'I43'), /^- Johann Huber: born 1848, Vienna; died 1915, Vienna$/m);
  assert.ok(!md.includes('was born'));
});

test('fill_pattern_all_languages', () => {
  const re = K.fillPattern(LOCALES);
  assert.deepEqual('a [Fill in: x] b [Doplňte: y] [^1] [link](u)'.match(re), ['[Fill in: x]', '[Doplňte: y]']);
});

test('refresh_keeps_written', () => {
  const pattern = K.fillPattern(LOCALES);
  const before = draft(GED);
  // Johann's block written by hand, Katharina's left as drafted
  const written = blockOf(before, 'I43').replace(/\n[^<][^\n]*$/, '\nJohann was a cartwright by the Danube canal.');
  const current = before.replace(blockOf(before, 'I43'), written);
  // newer data: Katharina's birthplace is known now, and a person who was not in the chronicle
  const ged = GED.replace(/(0 @I36@ INDI[\s\S]*?\n1 BIRT\n2 DATE [^\n]*1880)/, '$1\n2 PLAC Steyr');
  const fresh = draft(ged) + '\n\n<!-- person: I99 -->\nSomeone new.\n';
  const out = K.refresh(current, fresh, pattern, 'New from the data');
  assert.ok(out.includes('Johann was a cartwright by the Danube canal.'));
  assert.match(blockOf(out, 'I36'), /in Steyr/);
  assert.match(out, /## New from the data\n\n<!-- person: I99 -->\nSomeone new\.\n$/);
  assert.equal(K.refresh(current, current, pattern, 'New from the data'), current);
});
