import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const PV = require('../../engine/privacy.js');
const G = require('../../engine/gedcom.js');
const S = require('../../engine/scope.js');
const { utf8 } = require('../../engine/text.js');

const gd = (year, month, day, text = '') => Object.freeze({ year, month, day, approximate: false, text });
const D = gd(1995, 1, 5, '5 JAN 1995');
const DM = gd(1995, 1, null, 'JAN 1995');
const LIVING = [[['John', 'Smith'], [D]]];
const { redact } = PV;

function runCheck(files, living = LIVING, exceptions = [], allowed = new Set(), ext) {
  const m = new Map();
  for (const [k, v] of Object.entries(files)) m.set(k, typeof v === 'string' ? utf8(v) : v);
  return PV.checkOutput(m, living, exceptions, allowed, ext);
}

test('full_date', () => {
  const f = PV.dateForms(D);
  for (const x of ['5. 1. 1995', '5.1.1995', '05.01.1995', '5. ledna 1995', '5. leden 1995', '1995-01-05',
    '5 JAN 1995', '5 January 1995', 'January 5, 1995', 'Jan 5, 1995']) assert.ok(f.includes(x), x);
});

test('month_year', () => {
  const f = PV.dateForms(DM);
  for (const x of ['ledna 1995', 'leden 1995', 'January 1995', '1/1995']) assert.ok(f.includes(x), x);
});

test('bold_survives', () => {
  const d = gd(1995, 1, 5);
  assert.equal(redact('**text**, dál', [d]), '**text**, dál');
  assert.equal(redact('Koncem roku **1955** si', [d]), 'Koncem roku **1955** si');
  const r = redact('Dne **5. 1. 1995** se narodil.', [d]);
  assert.ok(!r.includes('1995'));
  assert.equal(r.split('*').length - 1, 0);
  assert.equal(redact('z Hillside **27. listopadu 1949** a', [gd(1949, 11, null)]), 'z Hillside **27.** a');
  assert.ok(!redact('Jonas * 1995, žije.', [d]).includes('*'));
  assert.equal(redact('Jonas * 1995, žije.', [d]), 'Jonas žije.');
});

test('redaction', () => {
  const d = gd(1995, 1, 5);
  assert.equal(redact('John (nar. 5. 1. 1995) žije v Springfieldu.', [d]), 'John žije v Springfieldu.');
  assert.equal(redact('Narodil se 5. ledna 1995 v Springfieldu.', [d]), 'Narodil se v Springfieldu.');
  assert.equal(redact('A<!-- web:hide -->, Main Street 12<!-- /web:hide --> B', []), 'A B');
  assert.ok(!redact('He was born on January 5, 1995.', [d]).includes('1995'));
});

test('multiline_and_unclosed_hide', () => {
  assert.equal(redact('A\n<!-- web:hide -->\nx\ny\n<!-- /web:hide -->\nB', []), 'A\n\nB');
  assert.ok(!redact('A <!-- web:hide --> secret', []).includes('secret'));
});

test('cleanup', () => {
  const d = gd(1995, 1, 5);
  assert.equal(redact('Jonas (nar. 5. 1. 1995, Springfield) a Eva.', [d]), 'Jonas (Springfield) a Eva.');
  assert.equal(redact('Jonas, nar. 05.01.1995, žije.', [d]), 'Jonas, žije.');
  assert.equal(redact('Jonas *5.1.1995, žije.', [d]), 'Jonas žije.');
  assert.equal(redact('X 5 JAN 1995 a 5.1.1995 y', [d]), 'X a y');
});

test('czech_and_english_forms', () => {
  const d = gd(1990, 1, 5), yearOnly = gd(1990, null, null);
  for (const t of ['John (5. ledna 1990) lives.', 'John (born 5 January 1990) lives.',
    'John (born on January 5, 1990) lives.', 'John (nar. 5. 1. 1990) lives.']) assert.ok(!redact(t, [d]).includes('1990'), t);
  for (const t of ['John (nar. 1990) lives.', 'John (b. 1990) lives.', 'John (born 1990) lives.', 'John * 1990, lives.']) {
    assert.ok(!redact(t, [yearOnly]).includes('1990'), t);
  }
  assert.equal(redact('John (b. 1990) lives.', [yearOnly]), 'John lives.');
  assert.equal(redact('John (born 5 January 1990) lives.', [d]), 'John lives.');
});

test('month_and_year', () => {
  assert.ok(!redact('V ledna 1995 a v January 1995 a 1/1995.', [gd(1995, 1, null)]).includes('1995'));
  const dr = gd(1995, null, null);
  assert.equal(redact('John (nar. 1995) žije.', [dr]), 'John žije.');
  assert.equal(redact('Peter (nar. 1972) žije.', [gd(1972, 1, 29)]), 'Peter žije.');
  assert.ok(redact('Chronicle 1945–1995', [dr]).includes('1995'));
});

test('dollar_means_end_or_before_final_newline', () => {
  // Python's `$` without MULTILINE also matches before a final "\n"
  assert.equal(redact('John nar.\n', [gd(1995, null, null)]), 'John \n');
});

test('check_catches', () => {
  const cases = { 'a.html': '<p>John Smith, 1995</p>', 'b.json': '{"x":"5.1.1995"}', 'c.txt': 'kontakt john@example.org',
    'd.txt': 'tel 603 123 456', 'e.html': '<p>born January 1995</p>', 'documents/neznamy.webp': new Uint8Array([120]) };
  for (const [name, content] of Object.entries(cases)) assert.ok(runCheck({ [name]: content }).length >= 1, name);
});

test('more_ways', () => {
  for (const [name, content] of Object.entries({
    'a.html': '<b>John</b> <i>Smith</i> <span>(nar.</span> <em>1995</em>)',
    'b.html': '<p>John&nbsp;Smith &#40;1995&#41;</p>',
    'c.html': '<p>5.&nbsp;ledna 1995</p>',
    'd.json': '{"name":"Johanna Smithová","year":1995}',
    'e.json': '{"a":["Johnovi", 1995]}',
    'f.txt': 'Narozen 05. 01. 1995 v Springfieldu',
    'g.html': '<img alt="John Smith 1995" src="x.png">',
    'h.txt': '+420 603 123 456',
    'i.txt': 'narozen 5/1/1995',
  })) assert.ok(runCheck({ [name]: content }).length >= 1, name);
});

test('data_script_twin_checked_as_json', () => {
  const pre = '(self.FC_DATA=self.FC_DATA||{})["data/people-en.0123abcd.json"]=';
  assert.ok(runCheck({ 'data/people-en.0123abcd.js': pre + '{"a":["Johnovi", 1995]};\n' }).length >= 1);
  const body = '{"a":"John Smith","b":"' + 'x'.repeat(200) + '","c":1995}';
  assert.deepEqual(runCheck({ 'data/people-en.0123abcd.js': pre + body + ';\n' }).map((x) => x.split(': ').slice(1).join(': ')),
    runCheck({ 'data/people-en.0123abcd.json': body }).map((x) => x.split(': ').slice(1).join(': ')));
});

test('check_clean', () => {
  assert.deepEqual(runCheck({ 'a.html': '<p>Chronicle 1945–1995</p>' }), []);
  assert.deepEqual(runCheck({ 'a.html': '<p>John Smith</p><p>' + 'x'.repeat(200) + ' 1995</p>' }), []);
  assert.deepEqual(runCheck({ 'a.html': '<p>John Smith 1994</p>' }), []);
  assert.deepEqual(runCheck({ 'a.txt': '1945–1995 a 5. 1. 1996 a 12.5.2001' }), []);
  assert.deepEqual(runCheck({ 'a.css': 'img@2x.png{margin:0}', 'a.js': 'x=1234567890123;' }), []);
  const v = 'John Smith 1995';
  assert.deepEqual(runCheck({ 'a.txt': v }, LIVING, [v]), []);
  assert.deepEqual(runCheck({ 'documents/ok.webp': new Uint8Array([120]) }, LIVING, [], new Set(['ok.webp'])), []);
});

test('exception_only_removes_itself', () => {
  assert.ok(runCheck({ 'a.txt': 'John Smith 1995 ... John Smith 1995' }, LIVING, ['John Smith 1995 ...']).length >= 1);
});

test('exception_needs_reason', () => {
  const v = 'John Smith 1995';
  assert.throws(() => runCheck({ 'a.txt': v }, LIVING, [{ text: v }]), TypeError);
  assert.throws(() => runCheck({ 'a.txt': v }, LIVING, [{ text: v, reason: '  ' }]), TypeError);
  assert.deepEqual(runCheck({ 'a.txt': v }, LIVING, [{ text: v, reason: 'deceased namesake' }]), []);
});

test('living_years_not_parameter', () => {
  // the parameters are files, living, exceptions, allowed documents and locale extensions; no flag
  // or extra argument switches the check off
  const params = PV.checkOutput.toString().match(/^function checkOutput\((.*?)\) \{/)[1];
  assert.deepEqual(params.split(',').map((x) => x.trim().split(/\s*=/)[0]), ['files', 'living', 'exceptions', 'allowedDocuments', 'ext']);
  const files = new Map([['a.txt', utf8('5. 1. 1995')]]);
  assert.ok(PV.checkOutput(files, LIVING, [], new Set(), null, { check: false, living_years: 0 }).length >= 1);
});

test('month_year_of_living', () => {
  assert.ok(runCheck({ 'a.txt': 'leden 1995' }, [[['X'], [DM]]]).length >= 1);
});

test('marriage', () => {
  assert.ok(runCheck({ 'a.txt': '12. června 2020' }, [[['John', 'Smith'], [D, gd(2020, 6, 12)]]]).length >= 1);
});

test('wrapped_date', () => {
  assert.equal(redact('Narodil se 5. ledna\n1995 v', [D]), 'Narodil se v');
  assert.equal(redact('Narodil se 5.\r\n1. 1995 v', [D]), 'Narodil se v');
  assert.ok(redact('5. ledna\n\n1995', [D]).includes('1995'));
  for (const t of ['5. ledna\n1995', '5.\n1.\n1995', '5. 1. 1995', '1995-01-\n05', '5.&nbsp;ledna 1995']) {
    assert.ok(runCheck({ 'a.txt': t }).length >= 1, JSON.stringify(t));
  }
});

test('nbsp_in_redaction', () => {
  assert.equal(redact('Narodil se 5.&nbsp;ledna&nbsp;1995 v', [D]), 'Narodil se v');
  assert.equal(redact('John (nar.&nbsp;5.&nbsp;1.&nbsp;1995) žije', [D]), 'John žije');
});

test('more_date_forms', () => {
  for (const t of ['1995/01/05', '1995.01.05', '5.1.95', '5-1-1995', '5–1–1995', '5. lednu 1995', '5. ledna roku 1995',
    '5. ledna r. 1995', 'v lednu 1995', 's lednem 1995', '5.1.1995', '5/1/1995']) assert.ok(runCheck({ 'a.txt': t }).length >= 1, t);
  for (const t of ['5.1.96', '1996/01/05', '5. února 1995']) assert.deepEqual(runCheck({ 'a.txt': t }), [], t);
});

test('month_cases', () => {
  ['lednu', 'únoru', 'březnu', 'dubnu', 'květnu', 'červnu', 'červenci', 'srpnu', 'září', 'říjnu', 'listopadu', 'prosinci']
    .forEach((nm, i) => assert.ok(runCheck({ 'a.txt': `5. ${nm} 1995` }, [[['X'], [gd(1995, i + 1, 5)]]]).length >= 1, nm));
});

test('short_names', () => {
  const z = [[['Eva', 'Dvořáková'], [gd(1995, null, null)]]];
  for (const t of ['Evy 1995', 'Evě 1995', 'Evou 1995', 'Eva 1995', '1995 Evo', 'Dvořák 1995', 'Dvořáková 1995', 'Dvořákovi 1995']) {
    assert.ok(runCheck({ 'a.txt': t }, z).length >= 1, t);
  }
  for (const t of ['Evropa 1995', 'Evidence 1995', 'Eva 1996']) assert.deepEqual(runCheck({ 'a.txt': t }, z), [], t);
  assert.ok(runCheck({ 'a.txt': 'Nová 1995' }, [[['Nový'], [gd(1995, null, null)]]]).length >= 1);
});

test('invisible_characters', () => {
  for (const t of ['Jo­hn Smith 19­95', 'John Smith 19​95', 'John Smith 1⁠995', 'John Sm﻿ith 1995', '5. led­na 1995']) {
    assert.ok(runCheck({ 'a.txt': t }).length >= 1, JSON.stringify(t));
  }
});

test('report_texts_like_python', () => {
  assert.deepEqual(runCheck({ 'b.txt': 'tel 603 123 456', 'a.html': '<p>John Smith, 1995</p>', 'documents/x.webp': new Uint8Array([1]) }), [
    'a.html: year of a living person next to the name " john smith, 1995 "',
    'b.txt: phone number "603 123 456"',
    'documents/x.webp: document not allowed',
  ]);
});

test('unescape_like_python', () => {
  assert.equal(PV.unescape('&amp;&lt;&gt&nbsp;&#40;&#x41;&#128;&#0;&notit;&bogus;&ndash;'), '&<> (A€�¬it;&bogus;–');
});

test('mini', () => {
  const tree = G.load(new Uint8Array(readFileSync(new URL('../data/mini.ged', import.meta.url))));
  const scope = S.determineScope(tree, { root: 'I1' }, new Date(2026, 10, 8));
  const c = PV.sensitiveDates(tree, scope);
  assert.deepEqual(new Set(c.keys()), scope.living);
  assert.ok(c.get('I1').some((d) => d.year === 1995));
  const z = PV.livingForCheck(tree, scope);
  assert.ok(z.some(([names, dates]) => JSON.stringify(names) === '["John","Smith"]' && dates === c.get('I1') || JSON.stringify(dates) === JSON.stringify(c.get('I1'))));
});

const GERMAN = { privacy: {
  months: [['Januar', 'Jänner'], ['Februar'], ['März', 'Maerz'], ['April'], ['Mai'], ['Juni'], ['Juli'],
    ['August'], ['September'], ['Oktober'], ['November'], ['Dezember']],
  birth_prefixes: ['geb.'] } };
const MARCH = gd(1990, 3, 5, '5 MAR 1990');

test('german_birth_date_is_redacted_with_a_locale_file', () => {
  const ext = PV.localeExtensions(['de'], { de: GERMAN });
  assert.equal(redact('Hans (geb. 5. März 1990) lebt.', [MARCH], ext), 'Hans lebt.');
  assert.equal(redact('Hans, geb. 1990, lebt.', [MARCH], ext), 'Hans, lebt.');
  assert.ok(!redact('Am 5. Maerz 1990 kam er.', [MARCH], ext).includes('1990'));
});

test('without_the_extension_the_german_date_is_not_recognised', () => {
  assert.ok(redact('Hans (geb. 5. März 1990) lebt.', [MARCH]).includes('1990'));
});

test('check_output_uses_the_extension', () => {
  const ext = PV.localeExtensions(['de'], { de: GERMAN });
  const living = [[['Hans', 'Weber'], [MARCH]]];
  assert.deepEqual(runCheck({ 'a.html': '<p>Am 5. März 1990 war es.</p>' }, living, [], new Set(), null), []);
  assert.ok(runCheck({ 'a.html': '<p>Am 5. März 1990 war es.</p>' }, living, [], new Set(), ext).length);
});

test('languages_are_merged_and_none_is_fine', () => {
  const ext = PV.localeExtensions(['en', 'de'], { de: GERMAN, en: { site_title: 'x' } });
  assert.deepEqual(ext.birth_prefixes, ['geb.']);
  assert.deepEqual(ext.months[2], ['März', 'Maerz']);
  assert.deepEqual(PV.extensions([null, {}]).birth_prefixes, []);
});

test('malformed_blocks_are_errors', () => {
  for (const bad of [{ months: [['a']] }, { months: 'x' }, { birth_prefixes: 'geb.' }, { birth_prefixes: [1] }, 'x']) {
    assert.throws(() => PV.extensions([bad]), Error, JSON.stringify(bad));
  }
});

test('old_and_short_years_are_still_checked', () => {
  // the digit index must not hide three-digit years or two-digit years of a full date
  assert.ok(runCheck({ 'a.txt': '5. 1. 995' }, [[['X'], [gd(995, 1, 5)]]]).length >= 1);
  assert.ok(runCheck({ 'a.txt': 'John Smith 995' }, [[['John', 'Smith'], [gd(995, null, null)]]]).length >= 1);
  assert.ok(runCheck({ 'a.txt': '5.1.95' }).length >= 1);
});
