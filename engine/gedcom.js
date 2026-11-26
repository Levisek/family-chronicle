// GEDCOM parser -> Tree. Only what the site needs enters the model (names, sex, links,
// BIRT/DEAT/BURI/MARR/DIV events with date and place, cause of death CAUS, age AGE, occupation
// OCCU). Addresses, e-mails, notes, sources and objects are deliberately not read; for sources
// only the fact that a person has one is kept. Port of familychronicle/gedcom.py; on top of it
// the JS reads ANSEL and Windows-1250 and accepts a tab between level, tag and value.
(function (g) {
  'use strict';

  const MONTHS = new Map('JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ').map((m, i) => [m, i + 1]));
  const APPROXIMATE = new Set(['ABT', 'EST', 'CAL', 'BEF', 'AFT', 'BET', 'FROM', 'TO']);
  const EVENT_TAGS = new Set(['BIRT', 'DEAT', 'BURI', 'MARR', 'DIV']);

  class GedcomEncodingError extends Error {
    constructor(message) { super(message); this.name = 'GedcomEncodingError'; }
  }

  const gdate = (year, month, day, approximate, text) => Object.freeze({ year, month, day, approximate, text });

  function parseDate(s) {
    const text = s.trim();
    const words = text.toUpperCase().split(/\s+/).filter(Boolean);
    const approximate = words.length > 0 && APPROXIMATE.has(words[0]);
    // first sensible [day] [month] year combination; for ranges (FROM..TO) the first wins
    const m = /(?:(\d{1,2})\s+)?(?:([A-Za-z]{3})\s+)?(\d{3,4})\b/.exec(text);
    if (!m) return gdate(null, null, null, approximate, text);
    const month = MONTHS.get((m[2] || '').toUpperCase()) || null;
    const day = m[1] && month ? parseInt(m[1], 10) : null;
    return gdate(parseInt(m[3], 10), month, day, approximate, text);
  }

  // Age at death as [years, approximate]. Precedence: calculation from exact dates, then the
  // age recorded with the death (AGE), finally the difference of years (+-1 year, approximate).
  function ageAtDeath(birth, death, age = '') {
    let estimate = null;
    if (birth && death && birth.year && death.year && !birth.approximate && !death.approximate) {
      let n = death.year - birth.year;
      if (birth.month && death.month && (birth.month !== death.month || (birth.day && death.day))) {
        const dm = death.month, dd = death.day || 0, bm = birth.month, bd = birth.day || 0;
        if (dm < bm || (dm === bm && dd < bd)) n -= 1;
        if (n >= 0 && n <= 120) return [n, false];
      } else if (n >= 0 && n <= 120) {
        estimate = [n, true];
      }
    }
    const a = age || '';
    const m = /(\d+)(\s*-\s*\d+)?/.exec(a);
    if (m && parseInt(m[1], 10) <= 120) {
      const up = a.toUpperCase();
      return [parseInt(m[1], 10), Boolean(m[2]) || up.includes('ABT') || up.includes('ABOUT')];
    }
    return estimate;
  }

  const event = (type, extra) => Object.assign({ type, date: null, place: null, value: '', cause: '', age: '' }, extra);

  class Person {
    constructor(id) {
      this.id = id; this.given = ''; this.surname = ''; this.sex = '';
      this.events = []; this.occupations = []; this.parentsFamily = null; this.families = [];
      this.hasSource = false;
    }
    get birth() { return this.events.find((e) => e.type === 'BIRT') || null; }
    get hasDeath() { return this.events.some((e) => e.type === 'DEAT' || e.type === 'BURI'); }
  }

  class Family {
    constructor(id) { this.id = id; this.husband = null; this.wife = null; this.children = []; this.events = []; }
  }

  class Tree {
    constructor(people, families) { this.people = people; this.families = families; }
    _parentsFamily(id) {
      const pf = this.people.get(id).parentsFamily;
      return pf ? this.families.get(pf) || null : null;
    }
    parents(id) {
      const f = this._parentsFamily(id);
      return f ? [f.husband, f.wife].filter((x) => x && this.people.has(x)) : [];
    }
    siblings(id) {
      const f = this._parentsFamily(id);
      return f ? f.children.filter((c) => c !== id && this.people.has(c)) : [];
    }
    children(id) {
      const out = [];
      for (const fid of this.people.get(id).families) {
        const f = this.families.get(fid);
        if (f) for (const c of f.children) if (this.people.has(c) && !out.includes(c)) out.push(c);
      }
      return out;
    }
    spouses(id) {
      const out = [];
      for (const fid of this.people.get(id).families) {
        const f = this.families.get(fid);
        if (f) for (const x of [f.husband, f.wife]) if (x && x !== id && this.people.has(x) && !out.includes(x)) out.push(x);
      }
      return out;
    }
  }

  const ref = (h) => h.trim().replace(/^@+|@+$/g, '');

  // Python str.splitlines() boundaries
  const LINES = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

  // [level, tag, value] triples; CONC/CONT lines are merged into the previous line.
  function logicalLines(text) {
    const out = [];
    for (const raw of text.split(LINES)) {
      const s = raw.replace(/^\s+/, '');
      const i = s.search(/[ \t]/);
      if (i < 0) continue;
      const lv = s.slice(0, i), rest = s.slice(i + 1);
      if (!/^\d+$/.test(lv)) continue;
      const j = rest.search(/[ \t]/);
      const tag = j < 0 ? rest : rest.slice(0, j);
      const value = j < 0 ? '' : rest.slice(j + 1);
      if ((tag === 'CONC' || tag === 'CONT') && out.length) {
        out[out.length - 1][2] += (tag === 'CONT' ? '\n' : '') + value;
      } else {
        out.push([parseInt(lv, 10), tag, value]);
      }
    }
    return out.map(([lv, tg, val]) => [lv, tg, val.trim()]);
  }

  // ANSEL (Z39.47 / MARC-8 Latin): spacing characters and combining marks. A combining mark
  // stands before its letter in ANSEL and after it in Unicode.
  const ANSEL_SPACING = {
    0xa1: 'Ł', 0xa2: 'Ø', 0xa3: 'Đ', 0xa4: 'Þ', 0xa5: 'Æ', 0xa6: 'Œ', 0xa7: 'ʹ', 0xa8: '·',
    0xa9: '♭', 0xaa: '®', 0xab: '±', 0xac: 'Ơ', 0xad: 'Ư', 0xae: 'ʼ', 0xb0: 'ʻ', 0xb1: 'ł',
    0xb2: 'ø', 0xb3: 'đ', 0xb4: 'þ', 0xb5: 'æ', 0xb6: 'œ', 0xb7: 'ʺ', 0xb8: 'ı', 0xb9: '£',
    0xba: 'ð', 0xbc: 'ơ', 0xbd: 'ư', 0xc0: '°', 0xc1: 'ℓ', 0xc2: '℗', 0xc3: '©', 0xc4: '♯',
    0xc5: '¿', 0xc6: '¡', 0xc7: 'ß', 0xc8: '€',
  };
  const ANSEL_COMBINING = {
    0xe0: 0x309, 0xe1: 0x300, 0xe2: 0x301, 0xe3: 0x302, 0xe4: 0x303, 0xe5: 0x304, 0xe6: 0x306,
    0xe7: 0x307, 0xe8: 0x308, 0xe9: 0x30c, 0xea: 0x30a, 0xeb: 0xfe20, 0xec: 0xfe21, 0xed: 0x315,
    0xee: 0x30b, 0xef: 0x310, 0xf0: 0x327, 0xf1: 0x328, 0xf2: 0x323, 0xf3: 0x324, 0xf4: 0x325,
    0xf5: 0x333, 0xf6: 0x332, 0xf7: 0x326, 0xf8: 0x31c, 0xf9: 0x32e, 0xfa: 0xfe22, 0xfb: 0xfe23,
    0xfe: 0x313,
  };

  function decodeAnsel(raw) {
    lastEncoding = 'ansel';
    let out = '', marks = '';
    for (let i = 0; i < raw.length; i++) {
      const b = raw[i];
      if (b < 0x80) { out += String.fromCharCode(b) + marks; marks = ''; continue; }
      if (ANSEL_COMBINING[b]) { marks += String.fromCharCode(ANSEL_COMBINING[b]); continue; }
      const c = ANSEL_SPACING[b];
      if (!c) {
        throw new GedcomEncodingError(`cannot decode the file as ANSEL (byte 0x${b.toString(16)} at ${i}); convert it to UTF-8 first`);
      }
      out += c + marks; marks = '';
    }
    return (out + marks).normalize('NFC');
  }

  // Bytes that Python's codecs leave undefined (the WHATWG decoders map them to C1 controls).
  const UNDEFINED = {
    'windows-1252': new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d]),
    'windows-1250': new Set([0x81, 0x83, 0x88, 0x90, 0x98]),
  };

  function decodeAs(raw, codec) {
    if (lastEncoding !== 'windows-1252 (fallback)') lastEncoding = codec;
    const bad = UNDEFINED[codec];
    if (bad) {
      const i = raw.findIndex((b) => bad.has(b));
      if (i >= 0) throw new GedcomEncodingError(`cannot decode the file as ${codec} (byte 0x${raw[i].toString(16)} at ${i}); convert it to UTF-8 first`);
    }
    try {
      return new TextDecoder(codec, { fatal: true }).decode(raw);
    } catch (error) {
      throw new GedcomEncodingError(`cannot decode the file as ${codec} (${error.message}); convert it to UTF-8 first`);
    }
  }

  // Decode a GEDCOM file: a BOM wins (UTF-8, UTF-16), else the `1 CHAR` header (UTF-8/UNICODE,
  // ASCII/ANSI as UTF-8 when valid, else Windows-1252; ANSEL; Windows-1250), UTF-16 without a
  // BOM is recognised by its NUL bytes.
  let lastEncoding = 'utf-8';

  function decode(raw) {
    lastEncoding = 'utf-8';
    if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) return decodeAs(raw, 'utf-8');
    if (raw[0] === 0xff && raw[1] === 0xfe) return decodeAs(raw, 'utf-16le');
    if (raw[0] === 0xfe && raw[1] === 0xff) return decodeAs(raw, 'utf-16be');
    if (raw.subarray(0, 64).includes(0)) return decodeAs(raw, raw[1] === 0 ? 'utf-16le' : 'utf-16be');
    const head = Array.from(raw.subarray(0, 4096), (b) => String.fromCharCode(b)).join('');
    const m = /^[ \t]*1[ \t]+CHAR[ \t]+([^\r\n]*)/mi.exec(head);
    const charset = m ? m[1].trim().toUpperCase() : 'UTF-8';
    if (charset === 'ANSEL') return decodeAnsel(raw);
    if (charset === 'WINDOWS-1250' || charset === 'CP1250') return decodeAs(raw, 'windows-1250');
    if (['ASCII', 'ANSI', 'WINDOWS-1252', 'CP1252'].includes(charset)) {
      // many programs label UTF-8 files as ANSI; valid UTF-8 is almost never real cp1252
      try { return new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch (e) { lastEncoding = 'windows-1252 (fallback)'; return decodeAs(raw, 'windows-1252'); }
    }
    return decodeAs(raw, 'utf-8');
  }

  function parse(text) {
    const people = new Map(), families = new Map();
    let record = null, ev = null, nameDone = false, readingName = false;
    for (const [level, tag, value] of logicalLines(text)) {
      if (level === 0) {
        record = null; ev = null; nameDone = false; readingName = false;
        // "0 @I1@ INDI": the tag column holds the ID, the value column the type
        if (value === 'INDI') {
          const id = ref(tag);
          if (!people.has(id)) people.set(id, new Person(id));
          record = people.get(id);
        } else if (value === 'FAM') {
          const id = ref(tag);
          if (!families.has(id)) families.set(id, new Family(id));
          record = families.get(id);
        }
        continue;
      }
      if (record === null) continue;
      const isPerson = record instanceof Person;
      if (tag === 'SOUR' && isPerson) record.hasSource = true;
      if (level === 1) {
        ev = null;
        if (EVENT_TAGS.has(tag)) {
          ev = event(tag);
          record.events.push(ev);
        } else if (tag === 'OCCU' && isPerson) {
          if (value) { ev = event(tag, { value }); record.occupations.push(ev); }
        } else if (isPerson) {
          readingName = false;
          if (tag === 'NAME' && !nameDone) {
            nameDone = readingName = true;
            const m = /^\s*(.*?)\s*\/([^/]*)\/?/.exec(value);
            if (m) { record.given = m[1]; record.surname = m[2].trim(); } else { record.given = value; record.surname = ''; }
          } else if (tag === 'SEX') {
            record.sex = value;
          } else if (tag === 'FAMC' && record.parentsFamily === null) {
            record.parentsFamily = ref(value);
          } else if (tag === 'FAMS') {
            record.families.push(ref(value));
          }
        } else {
          if (tag === 'HUSB') record.husband = ref(value);
          else if (tag === 'WIFE') record.wife = ref(value);
          else if (tag === 'CHIL') record.children.push(ref(value));
        }
      } else if (level === 2) {
        if (ev !== null) {
          if (tag === 'DATE') ev.date = parseDate(value);
          else if (tag === 'PLAC') ev.place = value || null;
          else if (tag === 'CAUS') ev.cause = value;
          else if (tag === 'AGE') ev.age = value;
        } else if (isPerson && readingName && (tag === 'GIVN' || tag === 'SURN')) {
          // GIVN/SURN override the slash split, for the first NAME only
          if (tag === 'GIVN') record.given = value; else record.surname = value;
        }
      }
    }
    return new Tree(people, families);
  }

  // `tree.encoding` says how the file was read; "windows-1252 (fallback)" means the header said
  // ANSI/ASCII but the bytes were not UTF-8 (a Czech program may have meant Windows-1250)
  function load(bytes) {
    const text = decode(bytes);
    const tree = parse(text);
    tree.encoding = lastEncoding;
    return tree;
  }

  const api = { GedcomEncodingError, parseDate, ageAtDeath, decode, parse, load, Person, Family, Tree, MONTHS };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).gedcom = api;
})(typeof window !== 'undefined' ? window : globalThis);
