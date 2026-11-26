import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './project.mjs';

const require = createRequire(import.meta.url);
const M = require('../../engine/match.js');
const G = require('../../engine/gedcom.js');

const GED = readFileSync(join(REPO, 'example/family.ged'), 'utf8');
const TREE = G.parse(GED);
const CFG = JSON.parse(readFileSync(join(REPO, 'example/site.json'), 'utf8'));
const DOCS = JSON.parse(readFileSync(join(REPO, 'example/documents.json'), 'utf8'));

// a tiny GEDCOM: [id, given, surname, birth year | null, famc | null]; families: [id, husb, wife]
function ged(people, families = []) {
  const out = ['0 HEAD'];
  for (const [id, given, surname, year, famc] of people) {
    out.push(`0 @${id}@ INDI`, `1 NAME ${given} /${surname}/`);
    if (year) out.push('1 BIRT', `2 DATE ${year}`);
    if (famc) out.push(`1 FAMC @${famc}@`);
  }
  for (const [id, husb, wife] of families) {
    out.push(`0 @${id}@ FAM`);
    if (husb) out.push(`1 HUSB @${husb}@`);
    if (wife) out.push(`1 WIFE @${wife}@`);
    for (const p of people) if (p[4] === id) out.push(`1 CHIL @${p[0]}@`);
  }
  out.push('0 TRLR', '');
  return G.parse(out.join('\n'));
}

test('same_id_same_person', () => {
  const r = M.pair(TREE, TREE, new Set(TREE.people.keys()));
  assert.equal(r.pairs.size, TREE.people.size);
  for (const [a, b] of r.pairs) assert.equal(a, b);
  assert.deepEqual(r.auto, []);
  assert.deepEqual(r.questions, []);
  assert.deepEqual(r.removed, []);
});

test('renumbered_ids', () => {
  const renumbered = G.parse(GED.replace(/@I(\d+)@/g, '@P$1@'));
  const r = M.pair(TREE, renumbered, new Set(['I1', 'I5']));
  assert.equal(r.pairs.size, TREE.people.size);
  for (const [a, b] of r.pairs) assert.equal(b, a.replace('I', 'P'));
  assert.equal(r.auto.length, TREE.people.size);
  assert.deepEqual(r.questions, []);
});

test('reused_id_other_person', () => {
  const old = ged([['I5', 'Karl', 'Huber', 1934]]);
  const now = ged([['I5', 'Anna', 'Berger', 1950], ['I9', 'Karl', 'Huber', 1934]]);
  const r = M.pair(old, now, new Set(['I5']));
  assert.equal(r.pairs.get('I5'), 'I9');
  assert.deepEqual(r.auto, [{ old: 'I5', new: 'I9' }]);
});

test('namesakes_ask', () => {
  const old = ged([['I1', 'Josef', 'Huber', 1878]]);
  const people = [['A1', 'Johann', 'Huber', 1850], ['A2', 'Karl', 'Huber', 1850],
    ['N1', 'Josef', 'Huber', 1878, 'F1'], ['N2', 'Josef', 'Huber', 1879, 'F2']];
  const now = ged(people, [['F1', 'A1', null], ['F2', 'A2', null]]);
  const r = M.pair(old, now, new Set(['I1']));
  assert.equal(r.pairs.has('I1'), false);
  assert.deepEqual(r.questions, [{ id: 'I1', candidates: ['N1', 'N2'] }]);

  // the same parents in both files decide
  const old2 = ged([['O1', 'Johann', 'Huber', 1850], ['I1', 'Josef', 'Huber', 1878, 'G1']], [['G1', 'O1', null]]);
  const r2 = M.pair(old2, now, new Set(['I1']));
  assert.equal(r2.pairs.get('I1'), 'N1');
  assert.deepEqual(r2.questions, []);
});

test('two_old_on_one_new_asks_the_second', () => {
  const old = ged([['I1', 'Josef', 'Huber', 1878], ['I2', 'Josef', 'Huber', 1878]]);
  const now = ged([['N1', 'Josef', 'Huber', 1878]]);
  const r = M.pair(old, now, new Set(['I1', 'I2']));
  assert.equal(r.pairs.size, 1);
  assert.equal(r.questions.length, 1);
});

test('missing_used_is_question_unused_is_removed', () => {
  const old = ged([['I1', 'Josef', 'Huber', 1878], ['I2', 'Rosa', 'Maier', 1880]]);
  const now = ged([['N1', 'Karl', 'Berger', 1900]]);
  const r = M.pair(old, now, new Set(['I1']));
  assert.deepEqual(r.questions, [{ id: 'I1', candidates: [] }]);
  assert.deepEqual(r.removed, ['I2']);
});

test('diacritics_and_year_within_two', () => {
  const old = ged([['I1', 'Helena', 'Černá', 1934]]);
  const now = ged([['N1', 'Helena', 'Cerna', 1936]]);
  assert.equal(M.pair(old, now, new Set(['I1'])).pairs.get('I1'), 'N1');
  const far = ged([['N1', 'Helena', 'Cerna', 1937]]);
  assert.deepEqual(M.pair(old, far, new Set(['I1'])).questions, [{ id: 'I1', candidates: [] }]);
});

test('used_ids_all_places', () => {
  const chronicles = new Map([['chronicles/x.md', 'a\n<!-- person: I43; @I44@ -->\ntext\n']]);
  const used = M.usedIds(CFG, DOCS, chronicles);
  for (const id of ['I1', 'I5', 'I6', 'I10', 'I11', 'I34', 'I14', 'I15', 'I43', 'I44']) assert.ok(used.has(id), id);
});

test('remap_everywhere', () => {
  const chronicles = new Map([['chronicles/x.md', 'a\n<!-- person: I43; @I44@ -->\ntext\n<!-- person: I44 -->\nmore\n']]);
  const map = new Map();
  for (const id of TREE.people.keys()) if (id !== 'I44' && id !== 'I10' && id !== 'I11') map.set(id, id.replace('I', 'P'));
  const r = M.remap({ cfg: CFG, documents: DOCS, chronicles }, map);
  assert.equal(r.cfg.root, 'P1');
  assert.deepEqual(r.cfg.living_town, { P1: 'Linz' });
  assert.deepEqual(r.cfg.deceased_extra, ['P34']);
  assert.deepEqual(r.cfg.branches.map((b) => b.key), ['huber', 'cerny']);
  assert.deepEqual(r.cfg.branches[0].roots, ['P5']);
  assert.deepEqual(r.documents[0].people, ['P5', 'P14', 'P15']);
  assert.deepEqual(r.documents[0].main, ['P5']);
  assert.equal(r.chronicles.get('chronicles/x.md'), 'a\n<!-- person: P43 -->\ntext\nmore\n');
  assert.equal(CFG.root, 'I1');   // the input is not changed
  const dropped = M.remap({ cfg: CFG, documents: DOCS, chronicles }, new Map());
  assert.equal(dropped.cfg.root, null);
  assert.deepEqual(dropped.cfg.branches, []);
});

test('changes_overview', () => {
  const old = ged([['I1', 'Josef', 'Huber', 1878], ['I2', 'Rosa', 'Maier', 1880], ['I3', 'Anna', 'Huber', 1960], ['I4', 'Karl', 'Berger', 1900]]);
  const text = ['0 HEAD',
    '0 @I1@ INDI', '1 NAME Josef /Huber/', '1 BIRT', '2 DATE 12 MAR 1878', '2 PLAC Wels',
    '0 @I2@ INDI', '1 NAME Rosa /Maier/', '1 BIRT', '2 DATE 1880',
    '0 @I3@ INDI', '1 NAME Anna /Huber/', '1 BIRT', '2 DATE 1960', '1 DEAT', '2 DATE 2020',
    '0 @I9@ INDI', '1 NAME Paul /Huber/', '1 BIRT', '2 DATE 1990',
    '0 TRLR', ''].join('\n');
  const now = G.parse(text);
  const r = M.pair(old, now, new Set(['I1']));
  const c = M.changes(old, now, r.pairs, { living_years: 100 }, new Date(2026, 10, 26));
  assert.deepEqual(c.added, ['I9']);
  assert.deepEqual(c.removed, ['I4']);
  assert.deepEqual(c.dates, [
    { id: 'I1', kind: 'birth', before: '1878', after: '12 Mar 1878' },
    { id: 'I3', kind: 'death', before: '', after: '2020' },
  ]);
  assert.deepEqual(c.places, ['Wels']);
  assert.deepEqual(c.nowDeceased, ['I3']);
  assert.deepEqual(c.nowLiving, []);   // only paired people change status; I9 is new
});
