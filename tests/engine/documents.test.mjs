import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { fakeImages } from './fake-images.mjs';

const require = createRequire(import.meta.url);
const D = require('../../engine/documents.js');
const G = require('../../engine/gedcom.js');
const S = require('../../engine/scope.js');
const { utf8, fromUtf8 } = require('../../engine/text.js');
const { hash8 } = require('../../engine/sha256.js');

const MINI = G.load(new Uint8Array(readFileSync(new URL('../data/mini.ged', import.meta.url))));
const CONFIG = { root: 'I1', branches: [{ key: 'a', roots: ['I9'] }], living_extra: [], deceased_extra: [], exclude: ['I13'] };
const scope = S.determineScope(MINI, CONFIG, new Date(2026, 10, 8));
const doc = (kw = {}) => ({ id: 't', source: 'x.jpg', crop: null, marked: null, people: ['I4'], year: 1900,
  description: { cs: 'a', en: 'b' }, citation: 'c', notes: [], foreign_work: false, verified: null, ...kw });
const NONE = new Map();
const decide = (docs, files = NONE, cutoff) => D.decide(docs, scope, files, cutoff);
// a 3000 x 2000 PNG header is enough for the fake adapter
function png(w, h) {
  const b = new Uint8Array(33); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h);
  return b;
}

test('deceased_person_is_published', () => {
  assert.ok(scope.people.has('I4') && !scope.living.has('I4'));
  assert.equal(decide([doc({ people: ['I4'] })])[0].length, 1);
});

test('withheld_when_one_person_is_living', () => {
  const [pub, held] = decide([doc({ people: ['I4', 'I2'], year: 1947 })]);
  assert.deepEqual(pub, []);
  assert.ok(held[0][1].includes('I2'));
});

test('excluded_and_unknown_person', () => {
  for (const p of ['I13', 'I999']) {
    const [pub, held] = decide([doc({ people: ['I4', p] })]);
    assert.deepEqual(pub, []);
    assert.ok(held[0][1].includes(p));
  }
});

test('no_people_only_before_cutoff_year', () => {
  assert.equal(decide([doc({ people: [], year: 1930 })])[0].length, 1);
  assert.equal(decide([doc({ people: [], year: 1960 })])[0].length, 0);
  assert.equal(decide([doc({ people: [], year: null })])[0].length, 0);
});

test('cutoff_year_is_a_parameter', () => {
  const d = [doc({ people: [], year: 1960 })];
  assert.equal(decide(d, NONE, 1970)[0].length, 1);
  assert.equal(decide(d, NONE, 1950)[0].length, 0);
});

test('foreign_work_only_as_crop', () => {
  assert.deepEqual(decide([doc({ foreign_work: true, crop: null })])[0], []);
  assert.equal(decide([doc({ foreign_work: true, crop: [0, 0, 5, 5] })])[0].length, 1);
});

test('foreign_work_crop_in_crops_folder', () => {
  assert.equal(decide([doc({ foreign_work: true, source: 'V/crops/01 a.png' })])[0].length, 1);
  assert.deepEqual(decide([doc({ foreign_work: true, source: 'V/crops.png' })])[0], []);
  assert.deepEqual(decide([doc({ foreign_work: true, source: 'V/a.pdf#0' })])[0], []);
});

test('gray_colour_excludes', () => {
  const files = new Map([['09 a.png', png(10, 10)], ['colors.json', utf8('{"09": "gray"}')]]);
  const [pub, held] = decide([doc({ source: '09 a.png' })], files);
  assert.deepEqual(pub, []);
  assert.ok(held[0][1].includes('excluded'));
});

test('withheld_reasons_are_english', () => {
  const [, held] = decide([doc({ people: ['I2'] }), doc({ people: [], year: 2000 })]);
  for (const [, reason] of held) assert.ok(/^[\x00-\x7f]*$/.test(reason), reason);
});

const SRC = new Map([['source.png', png(3000, 2000)], ['marked.png', png(500, 300)]]);

test('export_sizes_names_and_hashes', async () => {
  const log = [];
  const v = await D.exportDocument(doc({ id: 'a', source: 'source.png' }), SRC, fakeImages(log));
  assert.deepEqual([v.width, v.height], [1400, 933]);
  assert.ok(v.crop.startsWith('documents/a-') && v.sheet.startsWith('documents/a-sheet-'));
  for (const k of ['crop', 'sheet']) {
    const data = v.files.get(v[k]);
    assert.ok(data);
    assert.ok(v[k].endsWith(`-${hash8(data)}.webp`));
  }
  assert.deepEqual(log, [{ mime: 'image/png', crop: null, maxSize: 1400, quality: 80 }, { mime: 'image/png', crop: null, maxSize: 2600, quality: 75 }]);
});

test('crop_and_marked_copy', async () => {
  const log = [];
  const v = await D.exportDocument(doc({ id: 'b', source: 'source.png', crop: [0, 0, 600, 400], marked: 'marked.png' }), SRC, fakeImages(log));
  assert.deepEqual([v.width, v.height], [600, 400]);
  assert.deepEqual(log[0].crop, [0, 0, 600, 400]);
  assert.equal(log[1].crop, null);
  assert.ok(fromUtf8(v.files.get(v.sheet)).includes(require('../../engine/sha256.js').sha256Hex(png(500, 300))));
});

test('foreign_work_and_crop_only_have_no_sheet', async () => {
  for (const extra of [{ foreign_work: true }, { crop_only: true }]) {
    const v = await D.exportDocument(doc({ source: 'source.png', crop: [0, 0, 600, 400], ...extra }), SRC, fakeImages());
    assert.equal(v.sheet, null);
    assert.equal(v.files.size, 1);
  }
});

test('foreign_work_without_crop_raises', async () => {
  await assert.rejects(D.exportDocument(doc({ source: 'source.png', crop: null, foreign_work: true }), SRC, fakeImages()), /foreign work without a crop/);
});

test('path_outside_base_dir', async () => {
  for (const s of ['/abs/source.png', '../source.png', 'a/../../source.png']) {
    await assert.rejects(D.exportDocument(doc({ source: s }), SRC, fakeImages()), /outside the base directory/);
  }
});

test('pdf_refused', async () => {
  const files = new Map([['a.pdf', utf8('%PDF-1.4')]]);
  for (const s of ['a.pdf#90', 'a.pdf']) {
    await assert.rejects(D.exportDocument(doc({ source: s }), files, fakeImages()),
      (e) => e instanceof D.UnsupportedSource && /save the page as an image \(JPG or PNG\)/.test(e.message));
  }
});

test('fit_size_like_pillow_thumbnail', () => {
  assert.deepEqual(D.fitSize(3000, 2000, 1400), [1400, 933]);
  assert.deepEqual(D.fitSize(2000, 3000, 1400), [933, 1400]);
  assert.deepEqual(D.fitSize(1000, 640, 1400), [1000, 640]);
  assert.deepEqual(D.fitSize(5000, 1, 1400), [1400, 1]);
});

test('load_validation', () => {
  const f = new Map([['p.png', png(10, 10)]]);
  assert.equal(D.loadDocuments([doc({ source: 'p.png' })], f).length, 1);
  assert.throws(() => D.loadDocuments([doc({ source: 'p.png' }), doc({ source: 'p.png' })], f), /Duplicate document id/);
  assert.throws(() => D.loadDocuments([doc({ source: 'missing.png' })], f), /does not exist/);
  assert.throws(() => D.loadDocuments([doc({ source: 'p.png', marked: 'missing.png' })], f), /does not exist/);
  assert.throws(() => D.loadDocuments([doc({ source: 'p.png', people: ['I4'], main: ['I9'] })], f), /main people/);
  assert.deepEqual(D.loadDocuments([doc({ source: 'p.png', people: ['I4', 'I9'], main: ['I9'] })], f)[0].main, ['I9']);
});

test('verified_from_colours', () => {
  const f = new Map([['01 a.png', png(10, 10)], ['colors.json', utf8('{"01": "blue"}')]]);
  assert.equal(D.isVerified(doc({ source: '01 a.png' }), f), false);
  assert.equal(D.isVerified(doc({ source: '02 a.png' }), f), true);
  assert.equal(D.isVerified(doc({ source: '01 a.png', verified: true }), f), true);
});

test('pairing', () => {
  const a = doc({ id: 'a', source: 's.jpg', crop: [1, 2, 3, 4] }), b = doc({ id: 'b', source: 's.jpg', crop: null });
  assert.equal(D.documentForImage([a, b], 's.jpg', [1, 2, 3, 4]), a);
  assert.equal(D.documentForImage([a, b], 's.jpg', null), b);
  assert.equal(D.documentForImage([a, b], 'other.jpg', null), null);
});

test('example_documents_load_and_decide', () => {
  const dir = new URL('../../example/', import.meta.url);
  const files = new Map(readdirSync(new URL('documents/', dir)).map((n) => [`documents/${n}`, new Uint8Array(readFileSync(new URL(`documents/${n}`, dir)))]));
  const cfg = JSON.parse(readFileSync(new URL('site.json', dir), 'utf8'));
  const docs = D.loadDocuments(JSON.parse(readFileSync(new URL('documents.json', dir), 'utf8')), files);
  assert.ok(docs.length >= 3);
  const tree = G.load(new Uint8Array(readFileSync(new URL(cfg.gedcom, dir))));
  const sc = S.determineScope(tree, cfg, new Date(2026, 10, 8));
  const [pub] = D.decide(docs, sc, files, cfg.documents_cutoff_year);
  assert.ok(pub.length);
  const cropOnly = pub.filter((d) => d.crop_only);
  assert.ok(cropOnly.length);
  for (const d of cropOnly) { assert.ok(d.crop); assert.ok(!d.people.some((p) => sc.living.has(p))); }
});
