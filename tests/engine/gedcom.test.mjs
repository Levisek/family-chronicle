import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const G = require('../../engine/gedcom.js');
const { utf8 } = require('../../engine/text.js');

const DATA = new URL('../data/', import.meta.url);
const bytes = (name) => new Uint8Array(readFileSync(new URL(name, DATA)));
const MINI = bytes('mini.ged');
const EXAMPLE = new Uint8Array(readFileSync(new URL('../../example/family.ged', import.meta.url)));
const d = G.parseDate;
const plain = (x) => ({ year: x.year, month: x.month, day: x.day, approximate: x.approximate, text: x.text });

test('date_forms', () => {
  assert.deepEqual(plain(d('5 JAN 1995')), { year: 1995, month: 1, day: 5, approximate: false, text: '5 JAN 1995' });
  const s = d('SEP 1921');
  assert.deepEqual([s.year, s.month, s.day], [1921, 9, null]);
  assert.ok(d('ABT 1890').approximate);
  assert.equal(d('FROM 1900 TO 1910').year, 1900);
  assert.equal(d('unknown').year, null);
  assert.equal(d('1972').year, 1972);
  assert.ok(Object.isFrozen(d('1972')));
});

test('load', () => {
  const t = G.load(MINI);
  assert.deepEqual(t.parents('I1'), ['I2', 'I3']);
  assert.ok(t.siblings('I4').includes('I6'));
  assert.ok(t.people.get('I4').hasDeath);
  assert.ok(!t.people.get('I2').hasDeath);
  assert.equal(t.people.get('I1').given, 'John');
  assert.equal(t.people.get('I1').surname, 'Smith');
  assert.equal(t.people.get('I2').given, 'Peter');
  assert.deepEqual(t.children('I1'), ['I8']);
  assert.equal(t.people.get('I1').birth.date.year, 1995);
});

test('spouses', () => {
  const t = G.load(MINI);
  assert.deepEqual(t.spouses('I1'), ['I7']);
  assert.deepEqual(t.spouses('I2'), ['I3']);
  assert.deepEqual(t.spouses('I8'), []);
});

test('occupations', () => {
  const t = G.load(MINI);
  const o = t.people.get('I4').occupations;
  assert.deepEqual(o.map((x) => x.value), ['weaver, Mill Lane 5', 'sexton']);
  assert.equal(o[0].date.year, 1921);
  assert.equal(o[1].date, null);
  assert.deepEqual(t.people.get('I2').occupations, []);
});

test('cause_of_death', () => {
  const t = G.load(MINI);
  assert.equal(t.people.get('I4').events.find((x) => x.type === 'DEAT').cause, 'tuberculosis');
});

test('age_at_death', () => {
  const a = G.ageAtDeath;
  assert.deepEqual(a(d('12 AUG 1875'), d('3 FEB 1929')), [53, false]);
  assert.deepEqual(a(d('12 AUG 1875'), d('12 AUG 1929')), [54, false]);
  assert.deepEqual(a(d('MAR 1850'), d('SEP 1889')), [39, false]);
  assert.deepEqual(a(d('1850'), d('1889')), [39, true]);
  assert.deepEqual(a(d('ABT 1824'), d('3 FEB 1877'), '53'), [53, false]);
  assert.deepEqual(a(null, d('1913'), '87-88'), [87, true]);
  assert.deepEqual(a(null, null, 'About 21-22'), [21, true]);
  assert.deepEqual(a(d('5 JAN 1900'), d('1 MAR 1900')), [0, false]);
  assert.equal(a(d('ABT 1890'), null), null);
  assert.equal(a(d('1950'), d('1890')), null);
});

test('marriage_place', () => {
  assert.equal(G.load(MINI).families.get('F1').events[0].place, 'Springfield, 12 Main Street');
});

test('source_is_only_a_flag', () => {
  const t = G.load(MINI);
  assert.ok(t.people.get('I1').hasSource);
  assert.ok(!t.people.get('I2').hasSource);
  assert.ok(!JSON.stringify([...t.people.values()]).includes('@S1@'));
});

test('email_is_not_read', () => {
  const t = G.load(MINI);
  const r = JSON.stringify([...t.people.values(), ...t.families.values()]);
  assert.ok(!r.includes('x@y.example'));
  assert.ok(!r.includes('x@@y.example'));
  assert.ok(!r.includes('secret'));
});

test('example_family', () => {
  const t = G.load(EXAMPLE);
  assert.equal(t.people.size, 45);
  assert.deepEqual(t.parents('I1'), ['I2', 'I3']);
  assert.equal(t.people.get('I1').given, 'Daniel');
  assert.equal(t.people.get('I1').birth.date.year, 1990);
  assert.ok(!t.people.get('I1').hasDeath);
  assert.deepEqual(t.children('I2'), ['I1', 'I4']);
  assert.deepEqual(t.siblings('I5'), ['I16']);
  assert.ok(t.families.get('F17').events.some((e) => e.type === 'DIV'));
  assert.equal(t.people.get('I34').birth, null);
});

test('foreign_exports', () => {
  const lines = [
    '0 HEAD', '1 CHAR UTF-8', '1 _TOOL SomeProgram',
    '0 @P7@ INDI', '1 _UID ABC123', '1 NAME John Smith', '1 SEX M',
    '1 NOTE A long note that is split',
    '2 CONC  over two lines', '2 CONT and continues here',
    '1 BIRT', '2 DATE 1 JAN 1980', '2 PLAC Spring',
    '3 CONC field', '2 _CUSTOM whatever',
    '1 FAMC @P1@',
    '0 @P8@ INDI', '1 NAME Ann /Smith/', '1 FAMS @P1@',
    '0 @P9@ INDI', '1 NAME Bob /Smith/', '1 FAMS @P1@',
    '0 @P1@ FAM', '1 HUSB @P9@', '1 WIFE @P8@', '1 CHIL @P7@',
    '0 TRLR',
  ];
  const raw = utf8('﻿' + lines.join('\r\n') + '\r\n');
  const t = G.load(raw);
  const p = t.people.get('P7');
  assert.equal(p.given, 'John Smith');
  assert.deepEqual(t.parents('P7'), ['P9', 'P8']);
  assert.equal(p.birth.date.year, 1980);
  assert.equal(p.birth.place, 'Springfield');
  assert.ok(!JSON.stringify([...t.people.values()]).includes('long note'));
});

test('crlf_bom', () => {
  const t = G.load(bytes('crlf-bom.ged'));
  const m = G.load(MINI);
  for (const id of ['I1', 'I2', 'I3']) {
    const a = t.people.get(id), b = m.people.get(id);
    assert.equal(a.given, b.given, id);
    assert.equal(a.surname, b.surname, id);
    assert.equal(a.sex, b.sex, id);
    assert.equal(a.birth && a.birth.date.text, b.birth && b.birth.date.text, id);
  }
  assert.equal(t.people.get('I1').birth.place, 'Springfield');
  assert.deepEqual(t.parents('I1'), ['I2', 'I3']);
  assert.equal(t.families.get('F1').events[0].place, 'Springfield, 12 Main Street');
});

// The same body in several encodings (ported from TestEncodings)
const BODY = (head) => `0 HEAD\n${head}0 @I1@ INDI\n1 NAME Zoë /Müller/\n0 TRLR\n`;
const utf16 = (s, le) => {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[2 * i + (le ? 0 : 1)] = c & 0xff; out[2 * i + (le ? 1 : 0)] = c >> 8;
  }
  return out;
};
const cp1252 = (s) => Uint8Array.from([...s].map((c) => ({ 'ë': 0xeb, 'ü': 0xfc }[c] ?? c.charCodeAt(0))));
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

test('utf8_bom', () => {
  assert.equal(G.load(cat(new Uint8Array([0xef, 0xbb, 0xbf]), utf8(BODY('')))).people.get('I1').surname, 'Müller');
});

test('utf16_bom', () => {
  assert.equal(G.load(cat(new Uint8Array([0xff, 0xfe]), utf16(BODY(''), true))).people.get('I1').given, 'Zoë');
  assert.equal(G.load(cat(new Uint8Array([0xfe, 0xff]), utf16(BODY(''), false))).people.get('I1').given, 'Zoë');
});

test('header_ansi_is_windows_1252', () => {
  assert.equal(G.load(cp1252(BODY('1 CHAR ANSI\n'))).people.get('I1').surname, 'Müller');
});

test('utf8_labelled_ansi_is_read_as_utf8', () => {
  assert.equal(G.load(utf8(BODY('1 CHAR ANSI\n'))).people.get('I1').surname, 'Müller');
});

test('utf16_without_bom', () => {
  for (const le of [true, false]) {
    assert.equal(G.load(utf16(BODY('1 CHAR UNICODE\n'), le)).people.get('I1').given, 'Zoë', String(le));
  }
});

test('header_unicode_is_utf8', () => {
  assert.equal(G.load(utf8(BODY('1 CHAR UNICODE\n'))).people.get('I1').surname, 'Müller');
});

test('undecodable_utf8_is_a_clean_error', () => {
  assert.throws(() => G.load(cp1252(BODY('1 CHAR UTF-8\n'))), (e) => e instanceof G.GedcomEncodingError && /convert it to UTF-8/.test(e.message));
});

test('ansel_diacritics', () => {
  const t = G.load(bytes('ansel.ged'));
  assert.equal(t.people.get('I1').given, 'René');
  assert.equal(t.people.get('I1').surname, 'Černý');
  assert.equal(t.people.get('I2').given, 'Ælfred');
  assert.equal(t.people.get('I2').surname, 'Müller');
});

test('cp1250_header', () => {
  const t = G.load(bytes('cp1250.ged'));
  assert.equal(t.people.get('I1').given, 'Šárka');
  assert.equal(t.people.get('I1').surname, 'Čížková');
  const raw = new Uint8Array([...utf8('0 HEAD\n1 CHAR CP1250\n0 @I1@ INDI\n1 NAME '), 0x8a, 0xe8, ...utf8(' /X/\n0 TRLR\n')]);
  assert.equal(G.load(raw).people.get('I1').given, 'Šč');
});

test('odd_ids', () => {
  const t = G.parse([
    '0 @I-12_a@ INDI', '1 NAME A /B/', '1 FAMC @F1.2@',
    '0 @__proto__@ INDI', '1 NAME C /B/', '1 FAMS @F1.2@',
    '0 @F1.2@ FAM', '1 HUSB @__proto__@', '1 CHIL @I-12_a@', '0 TRLR',
  ].join('\n'));
  assert.ok(t.people.has('__proto__'));
  assert.deepEqual(t.parents('I-12_a'), ['__proto__']);
  assert.deepEqual(t.children('__proto__'), ['I-12_a']);
});

test('ansi_fallback_is_reported', () => {
  // "CHAR ANSI" with bytes that are not UTF-8: read as Windows-1252, and the tree says so
  const raw = new Uint8Array([...utf8('0 HEAD\n1 CHAR ANSI\n0 @I1@ INDI\n1 NAME '), 0xf8, ...utf8(' /X/\n0 TRLR\n')]);
  const t = G.load(raw);
  assert.equal(t.people.get('I1').given, 'ø');
  assert.equal(t.encoding, 'windows-1252 (fallback)');
  assert.equal(G.load(utf8('0 HEAD\n0 TRLR\n')).encoding, 'utf-8');
});
