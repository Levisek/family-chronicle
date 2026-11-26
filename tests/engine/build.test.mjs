// Ported from tests/test_build.py and tests/test_states_build.py. Not ported: the tests of the
// output folder on disk (_safe_output, the marker file, deleting only the site folder, a failed
// build removing the stale manifest, a config path run from another folder); writing the result
// belongs to the file adapter of phase 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { folderMap, repoAssets, REPO } from './project.mjs';
import { fakeImages } from './fake-images.mjs';

const require = createRequire(import.meta.url);
const B = require('../../engine/build.js');
const { utf8, fromUtf8 } = require('../../engine/text.js');
const { sha256Hex } = require('../../engine/sha256.js');

const DATA = join(REPO, 'tests/data');
const TODAY = new Date(2026, 10, 23);
const ASSETS = repoAssets();
const CONFIG = {
  root: 'I1', gedcom: 'tree.ged', base_url: 'https://example.org/tree/', languages: ['en', 'cs'], default_language: 'en', site_dir: 'site',
  branches: [{ key: 'smith', name: { en: 'Smith', cs: 'Smithovi' }, color: '#123456', roots: ['I9'], chronicle: 'chronicles/overview.md' }],
  places: 'places.json', events: 'events.json', documents: 'documents.json', ignore_places: ['Czechia'],
  living_town: { I1: 'Springfield' }, check_exceptions: [],
  open_questions_headings: { en: ["What we don't know"], cs: ['Co nevíme'] },
};
const CHRONICLE = `# Overview

## Beginnings

<!-- place: Millbrook -->
<!-- person: I4 -->
Joseph Smith came from Millbrook[^1].

Charles Smith was born as the first of the family.

[^1]: Note.
`;
const clone = (x) => JSON.parse(JSON.stringify(x));

// A small project in `folder/`; returns {files, configPath}.
function miniProject({ chronicle = CHRONICLE, documents = [], config = CONFIG, events = [], folder = 'project', ged } = {}) {
  let g = readFileSync(join(DATA, 'mini.ged'), 'utf8').replace('2 DATE ABT 1890\n', '2 DATE ABT 1890\n2 PLAC Millbrook, Slovakia\n');
  if (ged) g = ged(g);
  const f = new Map([
    [`${folder}/tree.ged`, utf8(g)],
    [`${folder}/chronicles/overview.md`, utf8(chronicle)],
    [`${folder}/places.json`, new Uint8Array(readFileSync(join(DATA, 'places.json')))],
    [`${folder}/events.json`, utf8(JSON.stringify(events))],
    [`${folder}/documents.json`, utf8(JSON.stringify(documents))],
    [`${folder}/site.json`, utf8(JSON.stringify(config))],
  ]);
  return { files: f, configPath: `${folder}/site.json` };
}
const edit = (changes, opts = {}) => miniProject({ ...opts, config: { ...clone(CONFIG), ...changes } });

class Site {
  constructor(result) { this.r = result; }
  get ok() { return this.r.ok; }
  read(rel) { return fromUtf8(this.r.files.get(`site/${rel}`)); }
  exists(rel) { return this.r.files.has(`site/${rel}`); }
  keys(prefix = '') { return [...this.r.files.keys()].filter((k) => k.startsWith(`site/${prefix}`)).map((k) => k.slice(5)); }
  dataFile(prefix) { return JSON.parse(this.read(this.keys('data/').find((k) => k.startsWith(`data/${prefix}.`) && k.endsWith('.json')))); }
  people(lang = 'en') { return this.dataFile(`people-${lang}`); }
  events(lang = 'en') { return this.dataFile(`events-${lang}`); }
  pageData(rel) { return JSON.parse(/id="data">([\s\S]*?)<\/script>/.exec(this.read(rel))[1]); }
  get approval() { return this.r.approval; }
  get manifest() { return this.r.manifest; }
  get warnings() { return this.r.warnings.join('\n'); }
}
async function build(project = miniProject(), extra = {}) {
  return new Site(await B.build({ ...project, assets: ASSETS, today: TODAY, images: fakeImages(), ...extra }));
}
async function fails(project, fragment, extra = {}) {
  await assert.rejects(B.build({ ...project, assets: ASSETS, today: TODAY, images: fakeImages(), ...extra }),
    (err) => err instanceof B.BuildError && err.message.includes(fragment), fragment);
}

// --- TestBuild -------------------------------------------------------------------------------------
test('output_passes_check', async () => {
  const s = await build();
  assert.equal(s.manifest.check, 'ok');
  assert.ok(s.approval);
  for (const p of ['index.html', 'tree.html', 'fan.html', 'map.html', 'story/overview.html', 'sitemap.xml', 'cs/index.html', 'cs/tree.html',
    'cs/fan.html', 'cs/map.html', 'cs/story/overview.html', 'person/I4.html', 'cs/person/I4.html', 'static/fonts/OFL.txt']) assert.ok(s.exists(p), p);
});

test('living_have_no_page_or_data', async () => {
  const s = await build();
  for (const i of ['I1', 'I2', 'I3']) { assert.ok(!s.exists(`person/${i}.html`)); assert.ok(!s.exists(`cs/person/${i}.html`)); }
  const p = s.people();
  assert.deepEqual(new Set(Object.keys(p.I1)), new Set(['name', 'relationship', 'branch', 'living', 'ahnentafel', 'parents', 'sex', 'partners', 'town']));
  assert.equal(p.I1.town, 'Springfield');
  assert.ok(p.I2.living);
  assert.equal(p.I2.town, null);
  assert.equal(p.I4.birth.place, 'Millbrook');
  assert.equal(p.I4.page, 'person/I4.html');
  assert.ok(!('I8' in p));
  assert.ok(s.approval.includes('John Smith') && !s.approval.includes('1995'));
  assert.match(s.approval, /John Smith \(I1\)[^\n]*Springfield/);
  assert.match(s.approval, /\(I2\)[^\n]*not given/);
});

test('data_files_are_per_language', async () => {
  const s = await build();
  assert.equal(s.people('en').I4.relationship, 'grandfather');
  assert.equal(s.people('cs').I4.relationship, 'dědeček');
  const data = s.pageData('cs/map.html');
  assert.equal(data.language, 'cs');
  assert.ok(data.data.people.includes('people-cs.'));
  assert.ok(s.exists(data.data.people));
  assert.equal(data.root, 'I1');
  assert.equal(data.final_town, 'Springfield');
  assert.equal(data.root_name, 'John Smith');
});

test('living_town_must_be_canonical', async () => {
  await fails(edit({ living_town: { I1: 'Atlantis' } }), 'living_town');
});

test('manifest_matches', async () => {
  const s = await build();
  const actual = Object.fromEntries([...s.r.files].filter(([k]) => k.startsWith('site/')).map(([k, v]) => [k, sha256Hex(v)]));
  assert.deepEqual(s.manifest.files, actual);
  assert.ok(!Object.keys(s.manifest.files).some((k) => k.startsWith('manifest') || k.startsWith('approval')));
  assert.deepEqual(JSON.parse(fromUtf8(s.r.files.get('manifest.json'))).files, actual);
});

test('reproducible', async () => {
  assert.deepEqual((await build()).manifest.files, (await build()).manifest.files);
});

test('no_inline_code', async () => {
  const s = await build();
  const csp = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'";
  const pages = s.keys().filter((k) => k.endsWith('.html'));
  assert.ok(pages.length > 10);
  for (const p of pages) {
    const h = s.read(p);
    assert.ok(h.includes(`<meta http-equiv="Content-Security-Policy" content="${csp}">`), p);
    assert.match(h, /<html lang="(cs|en)">/);
    assert.ok(h.includes('hreflang="cs"') && h.includes('hreflang="en"'));
    assert.ok(!h.includes(' style='), p);
    for (const m of h.matchAll(/<script([^>]*)>/g)) assert.ok(m[1].includes('src=') || m[1].includes('type="application/json"'), p);
    assert.equal(h.split('id="data"').length - 1, 1);
    JSON.parse(/id="data">([\s\S]*?)<\/script>/.exec(h)[1]);
  }
});

test('no_leaflet', async () => {
  const s = await build();
  assert.ok(!s.keys().some((k) => k.toLowerCase().includes('leaflet')));
  for (const p of s.keys().filter((k) => k.endsWith('.html'))) assert.ok(!s.read(p).toLowerCase().includes('leaflet'), p);
});

test('scripts_and_css_per_page', async () => {
  const s = await build();
  for (const [rel, js, css] of [['map.html', ['common', 'film', 'map-draw', 'map-film'], 'map'], ['tree.html', ['coloring', 'common', 'view', 'tree'], 'tree'],
    ['fan.html', ['coloring', 'common', 'view', 'fan'], 'fan'], ['story/overview.html', ['common', 'film', 'map-draw', 'story'], 'map']]) {
    const h = s.read(rel);
    assert.deepEqual([...h.matchAll(/static\/([a-z-]+)\.[0-9a-f]{8}\.js/g)].map((m) => m[1]), ['theme', ...js, 'settings'], rel);
    assert.match(h, new RegExp(`static/${css}\\.[0-9a-f]{8}\\.css`), rel);
  }
  for (const rel of ['map.html', 'tree.html', 'cs/map.html', 'cs/tree.html']) {
    const h = s.read(rel);
    assert.ok(/<body class="([^"]*)"/.exec(h)[1].includes('full'), rel);
    assert.ok(!h.includes('<footer'), rel);
  }
  assert.ok(s.read('index.html').includes('<footer'));
});

test('map_hooks_for_the_film', async () => {
  const s = await build();
  for (const rel of ['map.html', 'cs/map.html']) {
    const h = s.read(rel);
    for (const i of ['canvas', 'card', 'timeline', 'b-play', 'b-prev', 'b-next', 'b-end', 'film-intro']) assert.ok(h.includes(`id="${i}"`), `${rel}: #${i}`);
    assert.match(h, /id="timeline" role="slider"/);
    assert.ok(h.includes('class="modes"'));
    assert.match(h, /href="[^"]*map\.html#full-map"/);
    assert.doesNotMatch(h, /<[a-z]+[^>]*\sstyle=/);
  }
});

test('data_files_have_script_twins_for_file_urls', async () => {
  const s = await build();
  const data = s.pageData('map.html');
  assert.ok(Object.keys(data.data).length);
  for (const rel of Object.values(data.data)) {
    const twin = s.read(rel.slice(0, -'.json'.length) + '.js');
    const prefix = `(self.FC_DATA=self.FC_DATA||{})["${rel}"]=`;
    assert.ok(twin.startsWith(prefix), rel);
    assert.deepEqual(JSON.parse(twin.slice(prefix.length).trimEnd().replace(/;$/, '')), JSON.parse(s.read(rel)));
  }
});

test('hashed_names', async () => {
  const s = await build();
  for (const k of s.keys().filter((x) => /^(data|static)\/[^/]+$/.test(x))) assert.match(k.split('/').pop(), /\.[0-9a-f]{8}\.(json|css|js)$/, k);
});

test('links_are_relative', async () => {
  const s = await build();
  const all = new Set(s.keys());
  for (const p of s.keys().filter((k) => k.endsWith('.html'))) {
    const h = s.read(p);
    assert.doesNotMatch(h, /(?:href|src)="\//, p);
    for (const [, u] of h.matchAll(/(?:href|src)="([^"#]+)"/g)) {
      if (u.startsWith('http') || u.startsWith('mailto') || u.startsWith('data:')) continue;
      const parts = p.split('/').slice(0, -1);
      for (const seg of u.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
      assert.ok(all.has(parts.join('/')), `${p} -> ${u}`);
    }
  }
});

test('other_language_mirrors_default', async () => {
  const s = await build();
  const html = s.keys().filter((k) => k.endsWith('.html'));
  assert.deepEqual(new Set(html.filter((k) => !k.startsWith('cs/'))), new Set(html.filter((k) => k.startsWith('cs/')).map((k) => k.slice(3))));
});

test('branch_colors_and_cards', async () => {
  const s = await build();
  assert.ok(s.read(s.keys('static/').find((k) => /static\/branches\.[0-9a-f]{8}\.css$/.test(k))).includes('.branch-smith { --branch: #123456; }'));
  for (const p of ['index.html', 'cs/index.html']) {
    const h = s.read(p);
    assert.ok(h.includes('<li class="branch-smith"><a href="story/overview.html">'));
    assert.match(h, /<link rel="stylesheet" href="(\.\.\/)?static\/branches\.[0-9a-f]{8}\.css">/);
  }
  assert.ok(s.read('person/I4.html').includes('class="person branch-'));
  assert.ok(s.read('cs/index.html').includes('Smithovi'));
});

test('single_language', async () => {
  const s = await build(edit({ languages: ['cs'], default_language: 'cs' }));
  assert.ok(!s.keys().some((k) => k.startsWith('en/')));
  assert.ok(s.read('person/I4.html').includes('Vztah k autorovi'));
  assert.ok(!s.read('index.html').includes('class="language"'));
});

test('table_has_wrapper', () => {
  const h = B.cleanHtml('<p>x</p><table><tr><td>1</td></tr></table>', 'Table');
  assert.ok(h.includes('<div class="table-wrap" role="region" tabindex="0" aria-label="Table"><table>'));
  assert.ok(h.endsWith('</table></div>'));
});

// --- TestPeople ------------------------------------------------------------------------------------
test('occupations_only_for_deceased', async () => {
  const s = await build();
  const p = s.people();
  assert.deepEqual(p.I4.occupations, ['weaver, Mill Lane 5 (1921)', 'sexton']);
  assert.ok(!('occupations' in p.I1));
  assert.ok(s.read('person/I4.html').includes('<dt>Occupation</dt><dd>weaver, Mill Lane 5 (1921); sexton</dd>'));
  assert.ok(s.read('cs/person/I4.html').includes('<dt>Povolání</dt>'));
  for (const k of s.keys().filter((x) => x.endsWith('.html') || x.endsWith('.json'))) assert.ok(!s.read(k).includes('agent'), k);
});

test('cause_of_death_only_for_deceased', async () => {
  const s = await build();
  assert.equal(s.people().I4.death_cause, 'tuberculosis');
  assert.ok(!('death_cause' in s.people().I1));
  assert.ok(s.read('person/I4.html').includes('<dt>Cause of death</dt><dd>tuberculosis</dd>'));
  assert.ok(s.read('cs/person/I4.html').includes('<dt>Příčina smrti</dt>'));
});

test('age_at_death', async () => {
  const s = await build(miniProject({ ged: (g) => g.replace('2 CAUS tuberculosis\n', '2 CAUS tuberculosis\n2 AGE 32\n') }));
  assert.equal(s.people().I4.death_age, '32 years');
  assert.equal(s.people('cs').I4.death_age, '32 let');
  assert.ok(!('death_age' in s.people().I1));
  assert.ok(s.read('person/I4.html').includes('<dt>Age at death</dt><dd>32 years</dd>'));
  assert.ok(s.read('cs/person/I4.html').includes('<dt>Věk při úmrtí</dt><dd>32 let</dd>'));
});

test('marriage_of_deceased', async () => {
  const s = await build(miniProject({ ged: (g) => g.replace('1 CHIL @I2@\n', '1 CHIL @I2@\n1 MARR\n2 DATE 12 FEB 1920\n2 PLAC Millbrook, Slovakia\n') }));
  const p = s.people();
  assert.deepEqual(p.I4.marriages, [{ spouse: 'I5', date: '12 Feb 1920', place: 'Millbrook' }]);
  assert.deepEqual(s.people('cs').I5.marriages, [{ spouse: 'I4', date: '12. 2. 1920', place: 'Millbrook' }]);
  for (const i of ['I1', 'I2', 'I3']) assert.ok(!('marriages' in p[i]));
  assert.ok(s.read('person/I4.html').includes('<dt>Marriage</dt><dd><a href="I5.html">Mary Smithson</a>, 12 Feb 1920, Millbrook</dd>'));
  assert.ok(s.read('cs/person/I4.html').includes('<dt>Sňatek</dt>'));
});

test('event_and_chronicle_paragraph', async () => {
  const s = await build();
  assert.ok(s.events().some((x) => x.id === 'birth-I4'));
  assert.ok(s.read('person/I4.html').includes('came from Millbrook'));
});

test('person_without_any_data', async () => {
  const s = await build();
  assert.deepEqual(new Set(Object.keys(s.people().I3)), new Set(Object.keys(s.people().I1)));
});

// --- TestStrings -----------------------------------------------------------------------------------
test('root_name_is_filled_in', async () => {
  const s = await build();
  const h = s.read('tree.html');
  assert.ok(!h.includes('{root') && h.includes('ancestors and relatives of John Smith'));
  const data = s.pageData('cs/map.html');
  assert.ok(!JSON.stringify(data.strings).includes('{root'));
  assert.equal(data.strings.generations_up[0], 'John');
});

test('chapter_names_fall_back_to_the_branch', async () => {
  const s = await build();
  let data;
  for (const [rel, short] of [['story/overview.html', 'Smith'], ['cs/story/overview.html', 'Smithovi']]) {
    data = s.pageData(rel);
    assert.equal(data.strings.chapters.overview.short, short);
  }
  assert.ok(!('huber' in data.strings.chapters));
  assert.ok('epilogue' in data.strings.chapters);
});

test('config_overrides_strings', async () => {
  const s = await build(edit({ strings: { en: { intro: ['Our own family.'] } } }));
  assert.ok(s.read('index.html').includes('<p>Our own family.</p>'));
  assert.ok(!s.read('cs/index.html').includes('Our own family.'));
});

test('example_texts_come_from_the_config_and_merge_over_the_locale', async () => {
  const s = await build(edit({ strings: { en: { branch_descriptions: { smith: 'A family from Springfield.' },
    chapters: { overview: { title: 'Our overview', short: 'Ours', subtitle: 'Sub' } } } } }));
  assert.ok(s.read('index.html').includes('A family from Springfield.'));
  const chapters = s.pageData('story/overview.html').strings.chapters;
  assert.equal(chapters.overview.title, 'Our overview');
  assert.ok('epilogue' in chapters);
  assert.ok(!JSON.stringify(s.pageData('cs/story/overview.html')).includes('A family from Springfield.'));
});

test('german_locale_redacts_and_checks_german_dates', async () => {
  const en = ASSETS.locales.en;
  const de = { ...en, language_name: 'Deutsch', privacy: { months: [['Januar'], ['Februar'], ['März'], ['April'], ['Mai'], ['Juni'], ['Juli'],
    ['August'], ['September'], ['Oktober'], ['November'], ['Dezember']], birth_prefixes: ['geb.'] } };
  const config = clone(CONFIG);
  config.languages = ['en', 'de'];
  config.branches[0].name = { en: 'Smith', de: 'Schmid' };
  const project = miniProject({ config, chronicle: CHRONICLE.replace('Charles Smith was born', 'John Smith (geb. 5. Januar 1995) lives here. Charles Smith was born') });
  const s = await build(project, { assets: { ...ASSETS, locales: { en, de } } });
  assert.ok(!s.read('story/overview.html').includes('1995'));
  assert.ok(!JSON.stringify(s.pageData('de/map.html').strings).includes('privacy'));
});

// --- TestPrivacy -----------------------------------------------------------------------------------
test('forged_date_inside_hide_passes', async () => {
  assert.ok((await build(miniProject({ chronicle: CHRONICLE + '\n<!-- web:hide -->John was born on 5 January 1995.<!-- /web:hide -->\n' }))).ok);
});

test('redaction_removes_date_without_hide', async () => {
  const s = await build(miniProject({ chronicle: CHRONICLE + '\nJohn Smith (born 5 January 1995) studied.\n' }));
  assert.ok(!s.read('story/overview.html').includes('1995'));
});

test('date_in_strings_fails_the_check', async () => {
  const s = await build(edit({ strings: { en: { intro: ['John was born on 5 January 1995.'] } } }));
  assert.equal(s.ok, false);
  assert.equal(s.manifest.check, 'failed');
  assert.ok(s.r.findings.some((x) => x.includes('date of a living person')));
});

test('unknown_manual_place_is_an_error', async () => {
  await fails(miniProject({ events: [{ type: 'move', year: 1930, date: '1930', place: 'Atlantis', branch: 'smith', people: ['I4'], documents: [],
    certainty: 'tree', id: 'r1', description: { cs: 'a', en: 'a' } }] }), 'unknown place Atlantis');
});

test('check_exception_needs_a_reason', async () => {
  await fails(edit({ check_exceptions: [{ text: 'x' }] }), 'needs a reason');
  assert.ok((await build(edit({ check_exceptions: [{ text: 'x', reason: 'harmless' }] }))).ok);
});

// --- TestConfig ------------------------------------------------------------------------------------
test('missing_key', async () => {
  const config = clone(CONFIG); delete config.site_dir;
  await fails(miniProject({ config }), 'site_dir');
});

test('bad_site_dir_and_language', async () => {
  await fails(edit({ site_dir: '..' }), 'site_dir');
  await fails(edit({ languages: ['en', 'xx'] }), 'locales/xx.json');
  await fails(edit({ default_language: 'fr' }), 'default_language');
});

test('living_years_in_config', async () => {
  await fails(edit({ living_years: 99 }), 'living_years');
  await fails(edit({ living_years: '100' }), 'living_years');
  assert.ok((await build(edit({ living_years: 120 }))).ok);
});

test('unreadable_config', async () => {
  await fails({ files: new Map(), configPath: 'nope.json' }, 'nope.json');
  const p = miniProject();
  p.files.set(p.configPath, utf8('{'));
  await fails(p, 'cannot read the config');
});

test('missing_chronicle_file_is_an_error', async () => {
  const p = edit({});
  p.files.delete('project/chronicles/overview.md');
  await fails(p, 'chronicle file not found');
});

test('path_outside_the_project_is_refused', async () => {
  await fails(edit({ gedcom: '../../etc/passwd' }), 'outside the project folder');
});

// --- TestIdsAndEncoding ----------------------------------------------------------------------------
test('ids_written_with_at_signs', async () => {
  const s = await build(edit({ root: '@I1@', living_town: { '@I1@': 'Springfield' }, living_extra: ['@I2@'], deceased_extra: [], exclude: [],
    branches: [{ ...CONFIG.branches[0], roots: ['@I9@'] }] }));
  const p = s.people();
  assert.equal(p.I1.town, 'Springfield');
  assert.ok(p.I2.living);
  assert.equal(p.I9.branch, 'smith');
});

test('undecodable_gedcom_is_a_clean_error', async () => {
  const p = miniProject();
  p.files.set('project/tree.ged', Uint8Array.from([...'0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Zo'].map((c) => c.charCodeAt(0)).concat([0xeb], [...' /M/\n'].map((c) => c.charCodeAt(0)))));
  await fails(p, 'convert it to UTF-8');
});

test('ansel_gedcom_is_read', async () => {
  const p = miniProject();
  p.files.set('project/tree.ged', utf8('0 HEAD\n1 CHAR ANSEL\n0 TRLR\n'));
  await fails(p, 'root I1 is not in the GEDCOM');
  p.files.set('project/tree.ged', Uint8Array.from([...'0 HEAD\n1 CHAR ANSEL\n0 @I1@ INDI\n1 NAME A'].map((c) => c.charCodeAt(0)).concat([0xff])));
  await fails(p, 'ANSEL');
});

// --- TestLanguages ---------------------------------------------------------------------------------
const ev = (kw) => ({ type: 'move', year: 1930, date: '1930', place: 'Millbrook', branch: 'smith', people: ['I4'], documents: [], certainty: 'tree', ...kw });

test('english_only_config_needs_no_czech_texts', async () => {
  const config = clone(CONFIG);
  config.languages = ['en'];
  config.branches[0].name = { en: 'Smith' };
  const s = await build(miniProject({ config, events: [ev({ id: 'r1', description: { en: 'Moved' } })] }));
  for (const x of s.events()) assert.deepEqual(Object.keys(x.description), ['en']);
  assert.ok(!s.keys().some((k) => k.startsWith('cs/')));
});

test('event_without_a_configured_language_is_an_error', async () => {
  await fails(miniProject({ events: [ev({ id: 'r1', description: { en: 'Moved' } })] }), 'description needs en, cs');
});

// --- TestFocus -------------------------------------------------------------------------------------
test('branch_without_chronicle', async () => {
  const config = clone(CONFIG);
  delete config.branches[0].chronicle;
  config.branches.push({ key: 'other', name: { en: 'Other', cs: 'Jiní' }, roots: ['I11'] });
  const s = await build(miniProject({ config }));
  assert.ok(!s.keys().some((k) => k.startsWith('story/') || k.startsWith('cs/story/')));
  assert.ok(!s.read('index.html').includes('story/'));
  assert.ok(s.read('index.html').includes('href="tree.html"'));
  assert.ok(!/<nav class="modes"[^>]*>([\s\S]*?)<\/nav>/.exec(s.read('map.html'))[1].includes('story/'));
  assert.equal(s.manifest.check, 'ok');
});

test('example_without_chronicle_branch', async () => {
  const s = new Site(await B.build({ files: folderMap(join(REPO, 'example')), configPath: 'site.json', assets: ASSETS, today: TODAY, images: fakeImages() }));
  const read = (rel) => fromUtf8(s.r.files.get(`family/${rel}`));
  assert.ok(s.r.files.has('family/story/huber.html') && s.r.files.has('family/story/cerny.html'));
  assert.ok(!s.r.files.has('family/story/kowalski.html'));
  assert.ok(s.warnings.includes('Salzburg'));
  assert.equal(s.manifest.check, 'ok');
  const evKey = [...s.r.files.keys()].find((k) => /family\/data\/events-en\.[0-9a-f]{8}\.json$/.test(k));
  assert.ok(!fromUtf8(s.r.files.get(evKey)).includes('Salzburg'));
  const page = read('person/I14.html');
  assert.ok(page.includes('Died</dt><dd>1971, Vienna'));
  assert.ok(page.includes('Death record of Franz Huber, Vienna'));
});

test('config_in_a_folder_with_spaces_and_diacritics', async () => {
  const p = miniProject({ folder: 'x y/síte' });
  const s = await build(p);
  assert.ok(s.exists('story/overview.html'));
});

// --- TestEvents ------------------------------------------------------------------------------------
test('manual_event_without_document_is_per_chronicle', async () => {
  const s = await build(miniProject({ events: [ev({ id: 'r1', description: { cs: 'a', en: 'a' }, certainty: 'tree' }),
    ev({ id: 'r2', description: { cs: 'b', en: 'b' }, certainty: 'document', documents: ['nothing'] }),
    ev({ id: 'r3', description: { cs: 'c', en: 'c' }, certainty: 'uncertain' })] }));
  const evs = Object.fromEntries(s.events().map((x) => [x.id, x]));
  assert.deepEqual(['r1', 'r2', 'r3'].map((i) => evs[i].certainty), ['chronicle', 'chronicle', 'uncertain']);
  assert.equal(evs['birth-I4'].certainty, 'tree');
});

test('approval_lists_events_that_lost_a_living_person', async () => {
  const base = ev({ certainty: 'chronicle' });
  const s = await build(miniProject({ events: [
    { ...base, id: 'r-mixed', people: ['I4', 'I2'], description: { cs: 'Mixed', en: 'Mixed event' } },
    { ...base, id: 'r-clean', people: ['I4'], description: { cs: 'Clean', en: 'Clean event' } },
    { ...base, id: 'r-living', people: ['I2'], description: { cs: 'Living', en: 'Living only' } }] }));
  const section = s.approval.split('## Manual events from which a living person was removed')[1].split('\n## ')[0];
  assert.ok(section.includes('r-mixed') && section.includes('1930') && section.includes('Mixed event'));
  assert.ok(!section.includes('r-clean'));
  assert.ok(section.includes('r-living'));
  assert.ok(!JSON.stringify(s.events()).includes('r-living'));
});

test('approval_without_such_events_says_none', async () => {
  const s = await build();
  assert.ok(s.approval.split('## Manual events from which a living person was removed')[1].split('\n## ')[0].includes('none'));
});

test('missing_place_is_a_warning', async () => {
  const p = miniProject();
  p.files.set('project/places.json', utf8(JSON.stringify({ Springfield: JSON.parse(readFileSync(join(DATA, 'places.json'), 'utf8')).Springfield })));
  const s = await build(p);
  assert.ok(s.warnings.includes('Millbrook'));
  assert.ok(!s.events().some((x) => x.id === 'birth-I4'));
});

// --- TestDocuments ---------------------------------------------------------------------------------
function png(w, h) {
  const b = new Uint8Array(33); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h);
  return b;
}
const docOf = (kw) => ({ source: 'scan.png', crop: null, marked: null, citation: '', notes: [], foreign_work: false, verified: true, ...kw });
function docProject(docs) {
  const p = miniProject({ documents: docs });
  p.files.set('project/scan.png', png(200, 100));
  return p;
}

test('document_exported_and_linked', async () => {
  const s = await build(docProject([docOf({ id: 'd1', people: ['I4'], year: 1890, description: { cs: 'Křestní list', en: 'Baptism record' } }),
    docOf({ id: 'd2', people: ['I1'], year: 1995, description: { cs: 'Žijící', en: 'Living' } })]));
  const p = s.people();
  assert.deepEqual(p.I4.documents, ['d1']);
  assert.ok(!('documents' in p.I1));
  assert.equal(s.keys('documents/').filter((k) => k.endsWith('.webp')).length, 2);
  const e = s.events().find((x) => x.id === 'birth-I4');
  assert.deepEqual(e.documents, ['d1']);
  assert.equal(e.certainty, 'document');
  assert.ok(s.read('person/I4.html').includes('Baptism record'));
  assert.ok(s.read('cs/person/I4.html').includes('Křestní list'));
  assert.ok(s.approval.split('## Withheld documents')[1].includes('d2'));
});

test('main_person_has_the_document_others_a_mention', async () => {
  const s = await build(docProject([docOf({ id: 'd1', people: ['I4', 'I9'], main: ['I4'], year: 1890, description: { cs: 'Křest', en: 'Baptism of Joseph' } })]));
  const p = s.people();
  assert.deepEqual(p.I4.documents, ['d1']);
  assert.deepEqual(new Set(Object.keys(s.dataFile('documents').d1)), new Set(['description', 'crop', 'sheet', 'verified']));
  assert.deepEqual(p.I4.mentions, []);
  assert.deepEqual(p.I9.documents, []);
  assert.deepEqual(p.I9.mentions, ['d1']);
  const h9 = s.read('person/I9.html');
  assert.ok(h9.includes('class="mentions"') && h9.includes('Baptism of Joseph') && !h9.includes('class="tree-only"'));
  assert.ok(!s.read('person/I4.html').includes('class="mentions"'));
});

test('documents_file_in_a_subfolder_uses_the_config_folder', async () => {
  const p = docProject([docOf({ id: 'd1', people: ['I4'], year: 1890, description: { en: 'Baptism' } })]);
  p.files.set('project/meta/documents.json', p.files.get('project/documents.json'));
  p.files.delete('project/documents.json');
  p.files.set(p.configPath, utf8(JSON.stringify({ ...CONFIG, documents: 'meta/documents.json' })));
  assert.deepEqual((await build(p)).people().I4.documents, ['d1']);
});

test('without_main_everyone_gets_the_document', async () => {
  const s = await build(docProject([docOf({ id: 'd1', people: ['I4', 'I9'], year: 1890, description: { cs: 'Sčítání', en: 'Census' } })]));
  assert.deepEqual(s.people().I4.documents, ['d1']);
  assert.deepEqual(s.people().I9.documents, ['d1']);
});

// --- test_states_build ---------------------------------------------------------------------------------
const STATES = {
  flags: { red: { stripes: ['#aa0000', '#ffffff'], color: '#aa5555' }, blue: { stripes: ['#0000aa'], direction: 'vertical' } },
  states: { kingdom: { name: { en: 'Kingdom of Mill', cs: 'Království Mill' }, flag: 'red' }, republic: { name: { en: 'Mill Republic', cs: 'Republika Mill' }, flag: 'blue' } },
  regions: { Slovakia: [[0, 'kingdom'], [1918.9, 'republic']] },
};
function withStates(states = STATES, value = 'states.json') {
  const config = clone(CONFIG);
  if (value !== null) config.states = value;
  const p = miniProject({ config });
  if (states !== null) p.files.set('project/states.json', utf8(JSON.stringify(states)));
  return p;
}

test('deceased_get_states_and_the_living_never', async () => {
  const people = (await build(withStates())).people();
  assert.deepEqual(people.I4.states, [['kingdom', 1890, 1890]]);
  for (const x of ['I1', 'I2', 'I3']) assert.ok(!('states' in people[x]));
  assert.ok(!('states' in people.I5));
});

test('without_a_states_file_nothing_changes', async () => {
  const s = await build();
  assert.ok(!('states' in s.people().I4));
  const data = s.pageData('tree.html');
  assert.ok(!('states' in data) && !('flags' in data));
  assert.deepEqual(data.color_modes, ['branch', 'era', 'documented']);
});

test('the_page_data_carries_states_flags_and_modes', async () => {
  const s = await build(withStates());
  for (const rel of ['tree.html', 'fan.html', 'cs/tree.html', 'index.html']) {
    const data = s.pageData(rel);
    assert.deepEqual(data.color_modes, ['branch', 'state', 'era', 'documented']);
    assert.deepEqual(new Set(Object.keys(data.states)), new Set(['kingdom', 'republic']));
    assert.equal(data.states.kingdom.flag, 'red');
    assert.ok(data.flags.red.src.startsWith('data:image/svg+xml,'));
    assert.equal(data.flags.red.color, '#aa5555');
    assert.ok(data.flags.blue.color.startsWith('hsl('));
  }
  assert.equal(s.pageData('cs/tree.html').states.kingdom.name.cs, 'Království Mill');
});

test('person_page_shows_the_states_without_years', async () => {
  const s = await build(withStates());
  const row = /<dt>Historical states<\/dt><dd>([\s\S]*?)<\/dd>/.exec(s.read('person/I4.html'))[1];
  assert.ok(row.includes('Kingdom of Mill') && row.includes('src="data:image/svg+xml,'));
  assert.doesNotMatch(row.replace(/<[^>]+>/g, ''), /\d{4}/);
  const cs = s.read('cs/person/I4.html');
  assert.ok(cs.includes('<dt>Dobové státy</dt>') && cs.includes('Království Mill'));
  assert.ok(!s.read('person/I5.html').includes('<dt>Historical states</dt>'));
  assert.equal(s.manifest.check, 'ok');
});

test('states_config_errors', async () => {
  await fails(withStates(null), 'states file');
  await fails(withStates(STATES, 5), 'states must be');
  await fails(withStates({ ...STATES, states: { x: { name: { en: 'X', cs: 'X' }, flag: 'nope' } }, regions: {} }), "flag 'nope'");
  await fails(withStates({ ...STATES, states: { x: { name: { en: 'X' }, flag: 'red' } }, regions: {} }), 'missing for cs');
  await fails(withStates({ ...STATES, regions: { Slovakia: [[0, 'ghost']] } }), 'unknown state');
});

const PAGES = ['index.html', 'tree.html', 'fan.html', 'map.html', 'story/overview.html', 'person/I4.html', 'cs/index.html', 'cs/tree.html'];

test('theme_in_head_and_settings_last', async () => {
  const s = await build();
  for (const rel of PAGES) {
    const h = s.read(rel);
    const head = h.split('</head>')[0];
    assert.match(head, /<script src="[^"]*static\/theme\.[0-9a-f]{8}\.js"><\/script>\n$/, rel);
    const sheets = [...head.matchAll(/<link rel="stylesheet" href="[^"]*static\/([a-z-]+)\.[0-9a-f]{8}\.css">/g)].map((m) => m[1]);
    assert.equal(sheets[sheets.length - 1], 'themes');
    assert.deepEqual(sheets.slice(0, 2), ['branches', 'style']);
    const scripts = [...h.matchAll(/<script src="[^"]*static\/([a-z-]+)\.[0-9a-f]{8}\.js"( defer)?><\/script>/g)].map((m) => [m[1], m[2] || '']);
    assert.deepEqual(scripts[0], ['theme', '']);
    assert.deepEqual(scripts[scripts.length - 1], ['settings', ' defer']);
    assert.doesNotMatch(h, /<style/);
    assert.equal([...h.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/json)/g)].length, 0, rel);
  }
});

test('map_chapter', async () => {
  const branch = (key, more) => ({ key, name: { en: key, cs: key }, color: '#445566', roots: ['I9'], ...more });
  const withBranches = (...extra) => { const config = clone(CONFIG); config.branches.push(...extra); return miniProject({ config }); };
  const s = await build(withBranches(branch('kin', { map_chapter: 'smith' })));
  const branches = Object.fromEntries(s.pageData('map.html').branches.map((b) => [b.key, b]));
  assert.equal(branches.kin.map_chapter, 'smith');
  assert.equal(branches.smith.map_chapter, null);
  await fails(withBranches(branch('kin', { map_chapter: 'ghost' })), 'map_chapter must be the key of another branch');
  await fails(withBranches(branch('kin', { map_chapter: 'kin' })), 'map_chapter must be the key of another branch');
  await fails(withBranches(branch('kin', { map_chapter: 'smith' }), branch('far', { map_chapter: 'kin' })), 'no chains');
});

// --- a large tree --------------------------------------------------------------------------------------
test('large_tree_timing', async () => {
  // 5 000 people: a root, 12 generations of ancestors and their descendants by two children per family.
  // Worst case for the output check: full birth dates and most people living (born after 1880).
  const lines = ['0 HEAD', '1 CHAR UTF-8'];
  let n = 0, f = 0;
  const person = (year, famc, fams) => {
    n += 1; const id = `I${n}`;
    lines.push(`0 @${id}@ INDI`, `1 NAME P${n} /S${n % 50}/`, '1 BIRT', `2 DATE ${1 + (n % 28)} ${['JAN', 'MAR', 'JUN', 'OCT'][n % 4]} ${year}`, '2 PLAC Springfield');
    if (year < 1880) lines.push('1 DEAT');
    if (famc) lines.push(`1 FAMC @${famc}@`);
    for (const x of fams) lines.push(`1 FAMS @${x}@`);
    return id;
  };
  const fams = [];
  // breadth-first: each family has two children, each child (but the leaves) a family of their own
  const queue = [[null, 1700, 0]];
  while (n < 5000 && queue.length) {
    const [famc, year, depth] = queue.shift();
    const own = depth < 11 ? `F${++f}` : null;
    const id = person(year, famc, own ? [own] : []);
    if (own) {
      const spouse = person(year + 1, null, [own]);
      fams.push([own, id, spouse]);
      queue.push([own, year + 25, depth + 1], [own, year + 27, depth + 1]);
    }
  }
  const children = new Map();
  for (let i = 1; i < lines.length; i++) {
    const m = /^1 FAMC @(F\d+)@$/.exec(lines[i]);
    if (m) {
      let j = i; while (!lines[j].startsWith('0 ')) j--;
      const id = /@(I\d+)@/.exec(lines[j])[1];
      if (!children.has(m[1])) children.set(m[1], []);
      children.get(m[1]).push(id);
    }
  }
  for (const [fid, h, w] of fams) {
    lines.push(`0 @${fid}@ FAM`, `1 HUSB @${h}@`, `1 WIFE @${w}@`);
    for (const c of children.get(fid) || []) lines.push(`1 CHIL @${c}@`);
  }
  lines.push('0 TRLR');
  const leaf = [...children.values()].flat().pop();
  const config = { ...clone(CONFIG), root: leaf, living_town: {}, branches: [{ ...CONFIG.branches[0], roots: [] }] };
  const p = miniProject({ config });
  p.files.set('project/tree.ged', utf8(lines.join('\n') + '\n'));
  p.files.set('project/places.json', utf8(JSON.stringify({ Springfield: { coords: [39.78, -89.65], country: { en: 'US', cs: 'USA' }, aliases: [] } })));
  const t0 = Date.now();
  const s = await build(p);
  const ms = Date.now() - t0;
  assert.ok(n >= 4000, `people: ${n}`);
  assert.ok(Object.keys(s.people()).length > 20);
  assert.ok(ms < 10000, `build took ${ms} ms`);
});

test('ansi_fallback_warns', async () => {
  const p = miniProject({ ged: (g) => g.replace('1 CHAR UTF-8', '1 CHAR ANSI').replace('Eve /Newman/', 'Eve /Novák/') });
  const bytes = p.files.get('project/tree.ged');
  const latin = Uint8Array.from([...fromUtf8(bytes)].map((c) => c.charCodeAt(0) & 0xff));
  p.files.set('project/tree.ged', latin);
  const s = await build(p);
  assert.ok(s.warnings.includes('read as Windows-1252'));
});

test('proto_ids_and_keys', async () => {
  // a spouse with the GEDCOM id __proto__ and a branch keyed __proto__ must not vanish
  const s = await build(miniProject({ ged: (g) => g.split('@I7@').join('@__proto__@'),
    config: { ...clone(CONFIG), branches: [{ ...CONFIG.branches[0], key: '__proto__' }] } }));
  assert.equal(Object.getOwnPropertyDescriptor(s.people().I1.partners, '__proto__').value, 'partner');
  assert.ok(s.read('index.html').includes('<li class="branch-__proto__"><a href="story/overview.html">'));
});
