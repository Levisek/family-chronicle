import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const C = require('../../engine/chronicles.js');
const G = require('../../engine/gedcom.js');
const { utf8 } = require('../../engine/text.js');

const STRINGS = { crop: 'crop', full_sheet: 'full sheet', untranslated: 'English only.', unverified: 'unverified', unverified_source: 'unverified source' };
const MD = `# Title

## Vienna

<!-- place: Vienna; Linz -->
Intro[^1] probably so.

  <!--  person: I14  -->
Person card[^2].

<!-- place: -->
<!-- just an author note -->
<!-- web:hide -->Secret<!-- /web:hide -->

## Vienna

Second.

[^1]: Note one.
[^2]: Note two.
`;
const IMAGES = [['sample', 'First paragraph.', 'documents/a.png', null, 'Fallback caption']];
const EX = { d1: { crop: 'documents/d1-abcd.webp', sheet: 'documents/d1-sheet-ef.webp', width: 100, height: 50 } };
const DOC = { id: 'd1', source: 'documents/a.png', crop: null, people: [], year: 1930,
  description: { en: 'Caption en', cs: 'Popis cs' }, verified: true, notes: ['sample#1'] };

function render(text = MD, { lang = 'en', sensitive = [], published = [], exports = {}, extra = {}, ...options } = {}) {
  const files = new Map([['chronicles/sample.md', utf8(text)], ...Object.entries(extra).map(([k, v]) => [k, utf8(v)])]);
  return C.render('chronicles/sample.md', lang, sensitive, published, exports, files, { strings: STRINGS, ...options });
}

test('anchors', () => {
  const ch = render();
  assert.ok(ch.html.includes('data-places="Vienna;Linz"'));
  assert.ok(ch.html.includes('data-people="I14"'));
  assert.deepEqual(ch.sections[0].places, ['Vienna', 'Linz']);
  assert.deepEqual(ch.sections[0].people, ['I14']);
  assert.deepEqual(ch.sections.map((s) => s.id), ['vienna', 'vienna-2']);
  assert.ok(ch.html.includes('<h2 id="vienna">'));
});

test('person_marker_with_at_signs', () => {
  const ch = render('# T\n\n## A\n\n<!-- person: @I12@; @I3@ -->\nText.\n');
  assert.deepEqual(ch.sections[0].people, ['I12', 'I3']);
  assert.ok(ch.html.includes('data-people="I12;I3"'));
  assert.ok(ch.personParagraphs.get('I12').includes('Text.'));
});

test('comments_and_hidden_blocks', () => {
  const ch = render();
  assert.ok(!ch.html.includes('<!--'));
  assert.ok(!ch.html.includes('Secret'));
});

test('web_text_replaces_hidden', () => {
  const md = '# N\n\n## A\n\nText[^1] and (from <!-- web:hide -->1949<!-- /web:hide --><!-- web:text: 1945 -->).\n\n'
    + '[^1]: <!-- web:hide -->Secret scan.jpg<!-- /web:hide --><!-- web:text: Document of a living person, not published. -->\n';
  const ch = render(md);
  assert.ok(ch.html.includes('Document of a living person, not published.'));
  assert.ok(ch.html.includes('(from 1945)'));
  assert.ok(!ch.html.includes('Secret') && !ch.html.includes('1949') && !ch.html.includes('<!--'));
});

test('web_text_is_escaped_and_keeps_one_space', () => {
  const ch = render('# N\n\n## A\n\nsee<!-- web:text:  <b onclick=x>a</b> & b -->.\n');
  assert.ok(!ch.html.includes('<b onclick'));
  assert.ok(ch.html.includes('see &lt;b onclick=x&gt;a&lt;/b&gt; &amp; b.'));
});

test('uncertain_paragraphs', () => {
  for (const t of ['He was probably born', 'Most likely a cousin', 'It is likely so', 'Byl to nejspíš bratr']) {
    assert.ok(render(`# N\n\n${t}.\n`).html.includes('<p class="uncertain">'), t);
  }
  assert.ok(!render('# N\n\nUnlikelyhood and likelyhood.\n').html.includes('uncertain'));
});

test('uncertain_and_person_paragraph', () => {
  const ch = render();
  assert.ok(ch.html.includes('<p class="uncertain">Intro'));
  assert.ok(ch.personParagraphs.get('I14').includes('Person card'));
  assert.ok(!ch.personParagraphs.get('I14').includes('footnote-ref'));
});

test('redaction', () => {
  const ch = render('# N\n\nBorn 5 Jan 1995 in Linz.\n', { sensitive: [G.parseDate('5 JAN 1995')] });
  assert.ok(!ch.html.includes('1995'));
});

test('withheld_image_is_missing', () => {
  assert.ok(!render('# N\n\nFirst paragraph.\n', { images: IMAGES }).html.includes('<figure'));
});

test('published_image_and_note_links', () => {
  const ch = render('# N\n\nFirst paragraph.[^1]\n\nSecond.\n\n[^1]: Note.\n', { published: [DOC], exports: EX, images: IMAGES });
  assert.equal(ch.html.split('<figure').length - 1, 1);
  assert.ok(ch.html.includes('src="../documents/d1-abcd.webp"'));
  assert.ok(ch.html.includes('<figcaption>Caption en'));
  assert.ok(!ch.html.includes('unverified'));
  assert.ok(ch.html.includes('href="../documents/d1-abcd.webp">crop</a>'));
  assert.ok(ch.html.includes('full sheet'));
  assert.match(ch.html, /<\/p>\s*<figure/);
});

test('image_caption_language', () => {
  const ch = render('# T\n\nFirst paragraph.\n', { lang: 'cs', published: [DOC], exports: EX, images: IMAGES,
    extra: { 'chronicles/sample.cs.md': '# T\n\nFirst paragraph.\n' } });
  assert.ok(ch.html.includes('Popis cs'));
});

test('image_via_comment_in_translation', () => {
  const extra = { 'chronicles/sample.cs.md': '# Titulek\n\nFirst paragraph.<!-- img: First paragraph. -->\n\nSecond.\n' };
  let ch = render('# T\n\nFirst paragraph.\n', { lang: 'cs', published: [DOC], exports: EX, extra, images: [['sample', 'Ahoj', 'documents/a.png', null, 'x']] });
  assert.equal(ch.html.split('<figure').length - 1, 0);
  ch = render('# T\n\nFirst paragraph.\n', { lang: 'cs', published: [DOC], exports: EX, extra, images: [['sample', 'First paragraph.', 'documents/a.png', null, 'x']] });
  assert.match(ch.html, /First paragraph\.<\/p>\s*<figure/);
});

test('unverified_and_foreign_work', () => {
  let ch = render('# N\n\nFirst paragraph.\n', { published: [{ ...DOC, verified: false }], exports: EX, images: IMAGES });
  assert.ok(ch.html.includes('class="document unverified"'));
  assert.ok(ch.html.includes('unverified<'));
  ch = render('# N\n\nFirst paragraph.\n', { published: [{ ...DOC, verified: false, foreign_work: true }], exports: EX, images: IMAGES });
  assert.ok(ch.html.includes('unverified source'));
  assert.ok(!ch.html.includes('unverified<'));
});

test('translation_missing_falls_back', () => {
  const ch = render('# Title\n\nText.\n', { lang: 'cs' });
  assert.equal(ch.contentLanguage, 'en');
  assert.ok(ch.html.includes('English only.'));
});

test('translation_used', () => {
  const ch = render('# Overview\n\nText.\n', { lang: 'cs', extra: { 'chronicles/sample.cs.md': '# Přehled\n\nText.\n' } });
  assert.equal(ch.contentLanguage, 'cs');
  assert.equal(ch.title, 'Přehled');
  assert.ok(!ch.html.includes('English only.'));
});

test('default_language_never_looks_for_translation', () => {
  assert.equal(render('# Right\n', { extra: { 'chronicles/sample.en.md': '# Wrong\n' } }).title, 'Right');
});

test('crlf_source', () => {
  const ch = render('# T\r\n\r\n## A\r\n\r\n<!-- person: I1 -->\r\nText.\r\n');
  assert.deepEqual(ch.sections[0].people, ['I1']);
});

test('chapter_slug', () => {
  assert.equal(C.chapterSlug('chronicles/huber.md'), 'huber');
  assert.equal(C.chapterSlug('/x y/chronicles/huber.cs.md'), 'huber');
  assert.equal(C.chapterSlug('My Branch.md'), 'my-branch');
  assert.equal(C.chapterSlug('.md'), 'chapter');
});

test('missing_file', () => {
  assert.throws(() => C.render('chronicles/nope.md', 'en', [], [], {}, new Map(), { strings: STRINGS }), /nope\.md/);
});

test('open_sections_cut', () => {
  const text = "# K\n\n## Intro\n\nText.\n\n## What we don't know\n\n<!-- person: I1 -->\n"
    + '- Who was the father.[^1]\n\n## Where to look next\n\n<!-- web:hide -->Internal.<!-- /web:hide -->\n\n[^1]: Note.\n';
  const ch = render(text);
  const ix = C.openSectionIndexes(ch, ["What we don't know", 'Where to look next']);
  assert.deepEqual(ix, [1, 2]);
  const picked = C.cutSections(ch, ix);
  assert.deepEqual(picked.map(([n]) => n), ["What we don't know"]);
  const h = picked[0][1];
  assert.ok(h.includes('Who was the father.') && !h.includes('anchor') && !h.includes('Note.') && !h.includes('id="fnref'));
  assert.ok(h.includes(`href="${ch.slug}.html#fn`));
});

test('cut_sections_ignores_out_of_range', () => {
  assert.deepEqual(C.cutSections(render(), [99]), []);
});

test('example_chronicles_match_python', () => {
  // the Python build's chapter pages contain these chapters; spot-check the rendered body
  const dir = new URL('../../example/', import.meta.url);
  const files = new Map(readdirSync(new URL('chronicles/', dir)).map((n) => [`chronicles/${n}`, new Uint8Array(readFileSync(new URL(`chronicles/${n}`, dir)))]));
  const cfg = JSON.parse(readFileSync(new URL('site.json', dir), 'utf8'));
  for (const b of cfg.branches.filter((x) => x.chronicle)) {
    for (const lang of cfg.languages) {
      const ch = C.render(b.chronicle, lang, [], [], {}, files, { strings: STRINGS, defaultLanguage: cfg.default_language });
      assert.ok(!ch.html.includes('<!--'));
      assert.equal(C.openSectionIndexes(ch, cfg.open_questions_headings[ch.contentLanguage]).length, 2, `${b.key} ${lang}`);
    }
  }
});

test('fill_in_hidden_on_web', () => {
  const pattern = C.fillPattern({ en: { skeleton: { fill_in: 'Fill in' } }, cs: { skeleton: { fill_in: 'Doplňte' } } });
  const ch = render('# T\n\n## A\n\nFirst. Katharina was born in [Fill in: birthplace]. Last [Doplňte: rok] here!\n\nKept.\n', { fillPattern: pattern });
  assert.ok(ch.html.includes('<p>First. </p>') || ch.html.includes('<p>First.</p>'), ch.html);
  assert.ok(!/Fill in|Doplňte|Katharina|Last/.test(ch.html), ch.html);
  assert.ok(ch.html.includes('<p>Kept.</p>'));
  // without a pattern nothing is removed (the Python build and old callers)
  assert.ok(render('# T\n\nA [Fill in: x].\n').html.includes('[Fill in: x]'));
});
