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

test('forget_missing_ids', () => {
  // a new GEDCOM without @I5@: its ids go out of the settings, nothing else changes
  const cfg = {
    root: '@I1@', branches: [{ key: 'a', roots: ['@I2@', '@I5@'] }, { key: 'b', roots: ['@I5@'] }],
    living_extra: ['@I5@', '@I3@'], deceased_extra: ['@I5@'], living_town: { '@I5@': 'Linz', '@I3@': 'Wels' },
    exclude: ['@I5@'], other: 1,
  };
  const has = new Set(['@I1@', '@I2@', '@I3@']);
  const tree = { people: { has: (id) => has.has(id) } };
  const out = P.forgetMissing(cfg, tree);
  assert.deepEqual(out.branches, [{ key: 'a', roots: ['@I2@'] }]);
  assert.deepEqual(out.living_extra, ['@I3@']);
  assert.deepEqual(out.deceased_extra, []);
  assert.deepEqual(out.living_town, { '@I3@': 'Wels' });
  assert.deepEqual(out.exclude, []);
  assert.equal(out.root, '@I1@');
  assert.equal(out.other, 1);
  assert.deepEqual(cfg.branches[0].roots, ['@I2@', '@I5@'], 'the input is not changed');
});

// --- deceased by their relatives ----------------------------------------------------------------
const FAMILY = (rows) => ['0 HEAD', ...rows, '0 TRLR', ''].join('\n');

test('infer_deceased_from_relatives', () => {
  const tree = G.parse(FAMILY([
    // Josef: no dates, a son born 1900 -> born by 1888 -> deceased
    '0 @J@ INDI', '1 NAME Josef /Bauer/', '1 FAMS @F1@',
    '0 @S@ INDI', '1 NAME Karel /Bauer/', '1 BIRT', '2 DATE 1900', '1 DEAT', '2 DATE 1970', '1 FAMC @F1@',
    // Jan's father born 1850 -> Jan born by 1920 -> deceased; Jan's son Petr: no dates, his
    // father is born by 1920 -> Petr by 1990: living (unknown)
    '0 @O@ INDI', '1 NAME Otec /Novák/', '1 BIRT', '2 DATE 1850', '1 DEAT', '2 DATE 1920', '1 FAMS @F2@',
    '0 @N@ INDI', '1 NAME Jan /Novák/', '1 FAMC @F2@', '1 FAMS @F3@',
    '0 @P@ INDI', '1 NAME Petr /Novák/', '1 FAMC @F3@',
    // Marie married 1905 -> born by 1893 -> deceased
    '0 @M@ INDI', '1 NAME Marie /Malá/', '1 FAMS @F4@',
    // Eva: a child born 1950: born by 1938, could be living
    '0 @E@ INDI', '1 NAME Eva /Nová/', '1 FAMS @F5@',
    '0 @K@ INDI', '1 NAME Kid /Nový/', '1 BIRT', '2 DATE 1950', '1 FAMC @F5@',
    // Ida: deceased by her son, but the person said she lives (living_extra)
    '0 @I@ INDI', '1 NAME Ida /Stará/', '1 FAMS @F6@',
    '0 @IS@ INDI', '1 NAME Syn /Starý/', '1 BIRT', '2 DATE 1890', '1 DEAT', '2 DATE 1960', '1 FAMC @F6@',
    '0 @F1@ FAM', '1 HUSB @J@', '1 CHIL @S@', '0 @F2@ FAM', '1 HUSB @O@', '1 CHIL @N@', '0 @F3@ FAM', '1 HUSB @N@', '1 CHIL @P@',
    '0 @F4@ FAM', '1 WIFE @M@', '1 MARR', '2 DATE 1905', '0 @F5@ FAM', '1 WIFE @E@', '1 CHIL @K@', '0 @F6@ FAM', '1 WIFE @I@', '1 CHIL @IS@',
  ]));
  const out = P.inferDeceased(tree, { living_extra: ['I'] }, new Date(2026, 10, 26));
  assert.deepEqual([...out.keys()].sort(), ['J', 'M', 'N']);
  assert.deepEqual(out.get('J'), { via: 'child', of: 'S', year: 1888 });
  assert.deepEqual(out.get('N'), { via: 'parent', of: 'O', year: 1920 });
  assert.deepEqual(out.get('M'), { via: 'event', of: 'M', year: 1893 });
});

test('infer_deceased_approximate_dates', () => {
  const tree = G.parse(FAMILY([
    // a wedding AFT 1920 says nothing about the latest birth
    '0 @A@ INDI', '1 NAME Anna /After/', '1 FAMS @F1@', '0 @F1@ FAM', '1 WIFE @A@', '1 MARR', '2 DATE AFT 1920',
    // a child BET 1900 AND 1990: nothing either
    '0 @B@ INDI', '1 NAME Bert /Between/', '1 FAMS @F2@', '0 @BC@ INDI', '1 NAME Kid /Between/', '1 BIRT', '2 DATE BET 1900 AND 1990', '1 FAMC @F2@',
    '0 @F2@ FAM', '1 HUSB @B@', '1 CHIL @BC@',
    // a child ABT 1905: the parent born by 1905 + 5 - 12
    '0 @C@ INDI', '1 NAME Carl /About/', '1 FAMS @F3@', '0 @CC@ INDI', '1 NAME Kid /About/', '1 BIRT', '2 DATE ABT 1905', '1 DEAT', '2 DATE 1980', '1 FAMC @F3@',
    '0 @F3@ FAM', '1 HUSB @C@', '1 CHIL @CC@',
    // a wedding BEF 1915: born by 1903
    '0 @D@ INDI', '1 NAME Dora /Before/', '1 FAMS @F4@', '0 @F4@ FAM', '1 WIFE @D@', '1 MARR', '2 DATE BEF 1915',
    // a father born 1860, a son without dates: up to 70 at the son's birth -> son by 1930: unknown
    '0 @E@ INDI', '1 NAME Emil /Old/', '1 BIRT', '2 DATE 1860', '1 DEAT', '2 DATE 1940', '1 FAMS @F5@', '0 @ES@ INDI', '1 NAME Son /Old/', '1 FAMC @F5@',
    '0 @F5@ FAM', '1 HUSB @E@', '1 CHIL @ES@',
  ]));
  const out = P.inferDeceased(tree, {}, new Date(2026, 10, 26));
  assert.deepEqual([...out.keys()].sort(), ['C', 'D']);
  assert.equal(out.get('C').year, 1898);
});

test('inferred_deceased_follow_the_data', () => {
  // the build decides it every time: nothing is stored that could go stale
  const S = require('../../engine/scope.js');
  const ged = (kidYear) => FAMILY(['0 @R@ INDI', '1 NAME Root /X/', '1 BIRT', '2 DATE 1990', '1 FAMC @F1@',
    '0 @P@ INDI', '1 NAME Parent /X/', '1 FAMS @F1@', '1 FAMS @F2@', '0 @K@ INDI', '1 NAME Kid /X/', '1 BIRT', '2 DATE ' + kidYear, '1 DEAT', '2 DATE 1999', '1 FAMC @F2@',
    '0 @F1@ FAM', '1 HUSB @P@', '1 CHIL @R@', '0 @F2@ FAM', '1 HUSB @P@', '1 CHIL @K@']);
  const today = new Date(2026, 10, 26);
  assert.ok(!S.determineScope(G.parse(ged(1900)), { root: 'R' }, today).living.has('P'), 'P is not deceased by the kid of 1900');
  assert.ok(S.determineScope(G.parse(ged(1960)), { root: 'R' }, today).living.has('P'), 'P stays deceased after the date is corrected');
  assert.ok(S.determineScope(G.parse(ged(1900)), { root: 'R', living_extra: ['P'] }, today).living.has('P'), 'living_extra does not win');
});
