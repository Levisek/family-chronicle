import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { folderMap, repoAssets, REPO } from './project.mjs';
import { fakeImages } from './fake-images.mjs';

const require = createRequire(import.meta.url);
const P = require('../../engine/project.js');
const G = require('../../engine/gedcom.js');
const C = require('../../engine/config.js');
const B = require('../../engine/build.js');
const { fromUtf8 } = require('../../engine/text.js');

const GED = new Uint8Array(readFileSync(join(REPO, 'example/family.ged')));
const TREE = G.load(GED);
const ASSETS = repoAssets();
const LOCALES = ASSETS.locales;
const TODAY = new Date(2026, 10, 26);

function ancestors(tree, id) {
  const seen = new Set(), queue = [id];
  while (queue.length) for (const p of tree.parents(queue.shift())) if (!seen.has(p)) { seen.add(p); queue.push(p); }
  return seen.size;
}

test('summary_example', () => {
  const s = P.summary(TREE);
  assert.equal(s.people, TREE.people.size);
  assert.equal(s.families, TREE.families.size);
  const years = [...TREE.people.values()].flatMap((p) => p.events).map((e) => e.date && e.date.year).filter((y) => y != null);
  assert.deepEqual([s.yearMin, s.yearMax], [Math.min(...years), Math.max(...years)]);
  assert.ok(Array.isArray(s.problems));
  const t = G.parse('0 @I1@ INDI\n1 NAME /X/\n0 @I2@ INDI\n1 SEX M\n1 BIRT\n2 DATE sometime\n0 TRLR\n');
  const kinds = Object.fromEntries(P.summary(t).problems.map((p) => [p.kind, p.ids]));
  assert.deepEqual(kinds, { 'no-sex': ['I1'], 'bad-date': ['I2'], 'no-name': ['I2'] });
});

test('suggest_root_example', () => {
  const root = P.suggestRoot(TREE);
  assert.equal(TREE.children(root).length, 0);
  const best = Math.max(...[...TREE.people.keys()].filter((i) => !TREE.children(i).length).map((i) => ancestors(TREE, i)));
  assert.equal(ancestors(TREE, root), best);
  assert.equal(root, 'I4');   // Lena, the younger sister of Daniel (I1): same ancestors, born later
});

test('suggest_root_ties', () => {
  // two childless siblings with the same ancestors: the younger wins, then the smaller id
  const t = G.parse(['0 @I1@ INDI', '1 BIRT', '2 DATE 1950', '1 FAMC @F1@', '0 @I2@ INDI', '1 BIRT', '2 DATE 1960', '1 FAMC @F1@',
    '0 @I3@ INDI', '1 FAMS @F1@', '0 @F1@ FAM', '1 HUSB @I3@', '1 CHIL @I1@', '1 CHIL @I2@', '0 TRLR', ''].join('\n'));
  assert.equal(P.suggestRoot(t), 'I2');
  const u = G.parse(['0 @I10@ INDI', '1 FAMC @F1@', '0 @I9@ INDI', '1 FAMC @F1@', '0 @I3@ INDI', '0 @F1@ FAM', '1 HUSB @I3@', '1 CHIL @I10@', '1 CHIL @I9@', '0 TRLR', ''].join('\n'));
  assert.equal(P.suggestRoot(u), 'I9');
});

test('branches_by_grandparents', () => {
  const b = P.suggestBranches(TREE, 'I1', ['en', 'cs']);
  const [father, mother] = [TREE.families.get(TREE.people.get('I1').parentsFamily).husband, TREE.families.get(TREE.people.get('I1').parentsFamily).wife];
  const pf = (id) => TREE.families.get(TREE.people.get(id).parentsFamily);
  const want = [pf(father).husband, pf(father).wife, pf(mother).husband, pf(mother).wife];
  assert.deepEqual(b.map((x) => x.roots), want.map((x) => [x]));
  assert.deepEqual(b.map((x) => x.color), P.PALETTE.slice(0, 4));
  assert.deepEqual(b[0].name, { en: 'Huber', cs: 'Huber' });
  for (const x of b) assert.match(x.key, /^[a-z0-9_-]+$/);
  assert.equal(new Set(b.map((x) => x.key)).size, b.length);
  assert.ok(b.some((x) => x.key === 'cerna'));
});

test('branches_missing_and_colliding', () => {
  // only the father's parents, both called Novák: one key gets "-2"
  const t = G.parse(['0 @I1@ INDI', '1 FAMC @F1@', '0 @I2@ INDI', '1 FAMC @F2@', '0 @I3@ INDI', '1 NAME A /Novák/', '0 @I4@ INDI', '1 NAME B /Novák/',
    '0 @F1@ FAM', '1 HUSB @I2@', '1 CHIL @I1@', '0 @F2@ FAM', '1 HUSB @I3@', '1 WIFE @I4@', '1 CHIL @I2@', '0 TRLR', ''].join('\n'));
  const b = P.suggestBranches(t, 'I1', ['cs']);
  assert.deepEqual(b.map((x) => [x.key, x.roots[0]]), [['novak', 'I3'], ['novak-2', 'I4']]);
  assert.deepEqual(P.suggestBranches(t, 'I3', ['cs']), []);
});

test('merge_branches', () => {
  const b = P.suggestBranches(TREE, 'I1', ['en', 'cs']);
  const m = P.mergeBranches(b, b[2].key, b[3].key, LOCALES);
  assert.equal(m.length, 3);
  assert.deepEqual(m[2].roots, [...b[2].roots, ...b[3].roots]);
  assert.equal(m[2].name.en, `${b[2].name.en} and ${b[3].name.en}`);
  assert.equal(m[2].name.cs, `${b[2].name.cs} a ${b[3].name.cs}`);
  assert.equal(b.length, 4, 'the input is not changed');
  const r = P.renameBranch(m, m[0].key, 'cs', 'Huberovi');
  assert.equal(r[0].name.cs, 'Huberovi');
  assert.equal(m[0].name.cs, 'Huber');
  assert.equal(P.recolorBranch(r, r[1].key, '#000000')[1].color, '#000000');
});

test('search_without_accents', () => {
  const r = P.searchPeople(TREE, 'cerna', 8, LOCALES.cs);
  assert.ok(r.length >= 1);
  assert.ok(r.every((x) => /Čern/.test(x.label)));
  const helena = r.find((x) => x.id === 'I6');
  assert.equal(helena.label, 'Helena Černá');
  assert.match(helena.years, /^\d{4}/);
  assert.ok(P.searchPeople(TREE, 'dan hub', 8, LOCALES.en).some((x) => x.id === 'I1'));
  assert.equal(P.searchPeople(TREE, 'Daniel', 8, LOCALES.en)[0].parents, 'son of Thomas Huber and Eva Kowalska');
  assert.equal(P.searchPeople(TREE, 'Daniel', 8, LOCALES.cs)[0].parents, 'syn Thomas Huber a Eva Kowalska');
  assert.ok(P.searchPeople(TREE, 'e', 3, LOCALES.en).length <= 3);
  assert.deepEqual(P.searchPeople(TREE, '   ', 8, LOCALES.en), []);
});

function newCfg(extra = {}) {
  return P.newConfig({ root: 'I1', branches: P.suggestBranches(TREE, 'I1', ['en', 'cs']), languages: ['en', 'cs'], defaultLanguage: 'en',
    livingExtra: [], deceasedExtra: [], livingTown: {}, siteDir: 'family', ...extra });
}

test('new_config_parses', async () => {
  const cfg = newCfg();
  assert.equal(cfg.gedcom, 'family.ged');
  assert.equal(cfg.places, 'places.json');
  assert.equal(cfg.living_years, 100);
  C.parse(cfg, LOCALES);
  const files = folderMap(join(REPO, 'example'));
  files.set('site.json', P.serialize(cfg));
  const r = await B.build({ files, configPath: 'site.json', assets: ASSETS, today: TODAY, images: fakeImages() });
  assert.ok(r.ok, JSON.stringify(r.findings));
});

test('empty_base_url', async () => {
  const cfg = newCfg();
  assert.equal(cfg.base_url, '');
  const files = folderMap(join(REPO, 'example'));
  files.set('site.json', P.serialize(cfg));
  const r = await B.build({ files, configPath: 'site.json', assets: ASSETS, today: TODAY, images: fakeImages() });
  assert.ok(r.ok);
  const sitemap = fromUtf8(r.files.get('family/sitemap.xml'));
  for (const m of sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)) assert.match(m[1], /^\//);
  assert.equal(newCfg({ baseUrl: 'https://x.org/f/' }).base_url, 'https://x.org/f/');
});

test('living_years_fixed', () => {
  assert.equal(newCfg({ livingYears: 50 }).living_years, 100);
  assert.equal(newCfg({ livingYears: 120 }).living_years, 120);
});

test('living_summary', () => {
  const cfg = C.parse(newCfg(), LOCALES);
  const s = P.livingSummary(TREE, cfg, TODAY);
  assert.equal(s.living.length + s.deceased.length, TREE.people.size);
  for (const id of s.noBirthDate) assert.ok(s.living.includes(id));
  const moved = s.living[0];
  const s2 = P.livingSummary(TREE, { ...cfg, deceased_extra: [moved] }, TODAY);
  assert.ok(s2.deceased.includes(moved));
});

test('serialize', () => {
  assert.equal(fromUtf8(P.serialize({ a: [1] })), '{\n  "a": [\n    1\n  ]\n}\n');
});

test('suggest_large_tree', () => {
  // 5 000 people: twelve generations of ancestors above one person, plus their other children
  const people = [], fams = [];
  let f = 0;
  const add = (year, famc) => { const p = { id: `I${people.length + 1}`, year, famc }; people.push(p); return p; };
  const up = (p, depth) => {
    if (depth === 12 || people.length >= 4990) return;
    p.famc = `F${++f}`;
    const father = add(p.year - 30, null), mother = add(p.year - 28, null);
    fams.push([p.famc, father.id, mother.id, [p.id]]);
    up(father, depth + 1);
    up(mother, depth + 1);
  };
  up(add(1990, null), 0);
  while (people.length < 5000) { const fam = fams[people.length % fams.length]; fam[3].push(add(1900, fam[0]).id); }
  const lines = ['0 HEAD'];
  for (const p of people) lines.push(`0 @${p.id}@ INDI`, `1 NAME P /S${p.id.slice(1) % 40}/`, '1 BIRT', `2 DATE ${p.year}`, ...(p.famc ? [`1 FAMC @${p.famc}@`] : []));
  for (const [fid, h, w, kids] of fams) lines.push(`0 @${fid}@ FAM`, `1 HUSB @${h}@`, `1 WIFE @${w}@`, ...kids.map((k) => `1 CHIL @${k}@`));
  lines.push('0 TRLR', '');
  const tree = G.parse(lines.join('\n'));
  assert.ok(tree.people.size >= 5000);
  const t0 = Date.now();
  const r = P.suggestRoot(tree);
  const b = P.suggestBranches(tree, r, ['en']);
  const ms = Date.now() - t0;
  assert.equal(b.length, 4);
  assert.ok(ms < 1000, `${ms} ms`);
});

test('person_info', () => {
  assert.deepEqual(P.personInfo(TREE, 'I1', LOCALES.en), P.searchPeople(TREE, 'Daniel Huber', 1, LOCALES.en)[0]);
  assert.equal(P.personInfo(TREE, 'nobody', LOCALES.en), null);
});
