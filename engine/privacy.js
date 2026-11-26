// Privacy: forms of living people's dates, text redaction and a check of the finished output.
// The output check is the last safety net: it looks for what must not reach the site (dates of
// living people, a birth year next to their name, e-mails, phone numbers, documents that are not
// allowed). Exceptions are configured only in site.json (`check_exceptions`), never by editing
// the output. Port of familychronicle/privacy.py. Python's Unicode-aware \w, \d, \s, \b and the
// end anchor `$` (which also matches before a final newline) are spelled out explicitly below.
(function (g) {
  'use strict';

  const req = typeof require !== 'undefined';
  const dates = req ? require('./dates.js') : g.FCEngine.dates;
  const ENTITIES = req ? require('./entities.js') : g.FCEngine.entities;

  // --- Python regex vocabulary ------------------------------------------------------------------
  const WORD = '\\p{L}\\p{N}_';                     // inside a class: Python \w
  const W = `[${WORD}]`;
  const DIGIT = '\\p{Nd}';                          // Python \d
  const SPACES = '\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
  const S = `[${SPACES}]`;                          // Python \s (str.isspace)
  const NS = `[^${SPACES}]`;                        // Python \S
  const END = '(?=\\n?$)';                          // Python `$` without MULTILINE
  const escapeRe = (s) => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
  const has = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const pad2 = (n) => String(n).padStart(2, '0');
  const pyFalsy = (x) => x === null || x === undefined || x === '' || x === 0 || x === false
    || (Array.isArray(x) && !x.length) || (isObject(x) && !Object.keys(x).length);

  // --- locale extensions --------------------------------------------------------------------------

  // Merge the `privacy` objects of the configured languages into {months: [12 lists], birth_prefixes}.
  function extensions(blocks) {
    const months = Array.from({ length: 12 }, () => []);
    const prefixes = [];
    for (const block of blocks) {
      if (pyFalsy(block)) continue;
      if (!isObject(block)) throw new Error('privacy must be an object');
      const given = has(block, 'months') ? block.months : null;
      if (given !== null && given !== undefined) {
        if (!Array.isArray(given) || given.length !== 12
          || !given.every((m) => Array.isArray(m) && m.every((x) => typeof x === 'string' && x))) {
          throw new Error('privacy.months must be 12 lists of month spellings');
        }
        given.forEach((forms, i) => { for (const x of forms) if (!months[i].includes(x)) months[i].push(x); });
      }
      const words = has(block, 'birth_prefixes') ? block.birth_prefixes : [];
      if (!Array.isArray(words) || !words.every((x) => typeof x === 'string' && x)) {
        throw new Error('privacy.birth_prefixes must be a list of words');
      }
      for (const x of words) if (!prefixes.includes(x)) prefixes.push(x);
    }
    return { months, birth_prefixes: prefixes };
  }

  // `extensions` for the configured languages from the locale objects ({lang: locale JSON});
  // config `strings.<lang>.privacy` (overrides) is merged in as well.
  function localeExtensions(languages, locales, overrides) {
    const blocks = [];
    for (const lang of languages) {
      if (!has(locales, lang)) throw new Error(`no locale file for language ${lang}`);
      const data = locales[lang];
      const over = (overrides && has(overrides, lang) && overrides[lang]) || {};
      blocks.push(has(data, 'privacy') ? data.privacy : null, has(over, 'privacy') ? over.privacy : null);
    }
    return extensions(blocks);
  }

  // --- date forms ---------------------------------------------------------------------------------

  // Text forms of a date (for documentation and tests; the check uses `patterns`).
  function dateForms(d) {
    if (d.year === null || d.year === undefined) return [];
    const y = d.year, out = [];
    if (d.month && d.day) {
      const n = d.day, m = d.month;
      out.push(`${n}. ${m}. ${y}`, `${n}.${m}.${y}`, `${pad2(n)}.${pad2(m)}.${y}`, `${pad2(n)}. ${pad2(m)}. ${y}`, `${y}-${pad2(m)}-${pad2(n)}`);
      for (const name of dates.monthNames(m)) out.push(`${n}. ${name} ${y}`, `${n} ${name} ${y}`, `${name} ${n}, ${y}`);
      out.push(`${n}/${m}/${y}`, `${m}/${n}/${y}`);
    }
    if (d.month) {
      const m = d.month;
      out.push(`${m}/${y}`, `${pad2(m)}/${y}`, `${y}-${pad2(m)}`);
      for (const name of dates.monthNames(m)) out.push(`${name} ${y}`);
    }
    return [...new Set(out)];
  }

  const BSP = '[ \\t\\xa0\\u2009\\u202f]';             // space without a newline
  const HSP = `(?:${BSP}|&nbsp;|&#160;)`;             // + HTML entity (redaction reads the source)
  const SP_CHECK = `${S}*`;                           // check: any whitespace incl. \n
  const SP_REDACT = `${HSP}*(?:\\r?\\n${HSP}*)?`;     // redaction: at most one line break
  const DASH = '[\\-\\u2010\\u2011\\u2012\\u2013]';
  const SEP = '[./\\-\\u2010\\u2011\\u2012\\u2013]';

  // Tolerant regex sources for a full date and for month+year (a bare year is not searched here).
  // [source, kind] for a date; kind says what a text must contain for the pattern to match:
  // "dmy" day.month.year (the first full-date pattern), "name" the year and a month name,
  // "day<year" / "month<year" that number right before the year, "year>month" the month right after it
  function patternSpecs(d, sp = SP_CHECK, ext = null) {
    if (d.year === null || d.year === undefined || !d.month) return [];
    const y = d.year, m = d.month;
    const month = '(?:' + dates.monthNames(m, ext ? ext.months : null).map(escapeRe).join('|') + ')';
    const m0 = `0?${m}`;
    const nd = `(?<!${DIGIT})`, od = `(?!${DIGIT})`;
    const yearWord = `(?:(?:roku|r\\.)${sp})?`;
    const yy = pad2(y % 100);
    const wb = `(?<!${W})`;   // Python \b in front of a month name (which starts with a letter)
    const out = [];
    if (d.day) {
      const n0 = `0?${d.day}`;
      out.push(
        [`${nd}${n0}${sp}${SEP}${sp}${m0}${sp}${SEP}${sp}(?:${y}${od}|${yy}${od})`, 'dmy'],
        [`${nd}${m0}${sp}[/]${sp}${n0}${sp}[/]${sp}${y}${od}`, 'day<year'],
        [`${nd}${y}${sp}${SEP}${sp}${m0}${sp}${SEP}${sp}${n0}${od}`, 'year>month'],
        [`${nd}${n0}${sp}(?:\\.${sp})?${month}\\.?${sp}(?:,${sp})?${yearWord}${y}${od}`, 'name'],
        [`${wb}${month}\\.?${sp}${n0}(?:st|nd|rd|th)?${sp}(?:,${sp})?${yearWord}${y}${od}`, 'name'],
      );
    }
    out.push(
      [`${wb}${month}\\.?${sp}(?:,${sp})?${yearWord}${y}${od}`, 'name'],
      [`${nd}${m0}${sp}[/.]${sp}${y}${od}`, 'month<year'],
      [`${nd}${y}${sp}${DASH}${sp}${pad2(m)}${od}`, 'year>month'],
    );
    return out;
  }

  // Tolerant regex sources for a full date and for month+year (a bare year is not searched here).
  const patternSources = (d, sp = SP_CHECK, ext = null) => patternSpecs(d, sp, ext).map(([src]) => src);

  // --- sensitive dates ------------------------------------------------------------------------------

  const dateKey = (d) => JSON.stringify([d.year, d.month, d.day, d.approximate, d.text]);

  function personDates(tree, id) {
    const p = tree.people.get(id);
    const out = [];
    const birth = p.birth;
    if (birth && birth.date && birth.date.year !== null && birth.date.year !== undefined) out.push(birth.date);
    for (const fid of p.families) {
      const f = tree.families.get(fid);
      for (const e of f ? f.events : []) {
        if (e.type === 'MARR' && e.date && e.date.year !== null && e.date.year !== undefined) out.push(e.date);
      }
    }
    const seen = new Set();
    return out.filter((d) => { const k = dateKey(d); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // For every living person (key = id): the birth date and the marriage dates of their families.
  function sensitiveDates(tree, scope) {
    return new Map([...scope.living].sort(cmp).filter((i) => tree.people.has(i)).map((i) => [i, personDates(tree, i)]));
  }

  // Input for `checkOutput`: [[given, surname], [dates]] of every living person.
  function livingForCheck(tree, scope) {
    return [...sensitiveDates(tree, scope)].map(([i, ds]) => {
      const p = tree.people.get(i);
      return [[p.given, p.surname].filter((x) => x.trim()), ds];
    });
  }

  // --- redaction --------------------------------------------------------------------------------------

  const HIDE = new RegExp(`<!--${S}*web:hide${S}*-->[\\s\\S]*?<!--${S}*/web:hide${S}*-->`, 'gu');
  const HIDE_OPEN = new RegExp(`<!--${S}*web:hide${S}*-->[\\s\\S]*`, 'u');

  // "nar."/"narozen" = Czech "born"; "*" = genealogical birth sign
  function extraWords(ext) {
    const words = [...((ext && ext.birth_prefixes) || [])].sort((a, b) => b.length - a.length);
    return words.map((w) => `|${escapeRe(w)}`).join('');
  }
  const prefix = (ext) => `(?:(?:nar\\.|narozen[aoy]?|born(?:${HSP}+on)?|b\\.|(?<!\\*)\\*(?!\\*)${extraWords(ext)})${HSP}*)`;
  const dangling = (ext) => `(?:nar\\.|narozen[aoy]?|born(?:${HSP}+on)?${extraWords(ext)})`
    + `(?=${HSP}*(?:[,;:)]|\\.(?:${S}|${END})|${END}))`;

  // Delete the date with its leading "b."/"*"; keep the comma after it only when no prefix vanished.
  function del(md, pattern, onlyWithPrefix = false, ext = null) {
    const pat = new RegExp(`(?<p>${prefix(ext)})${onlyWithPrefix ? '' : '?'}(?:${pattern})(?<c>[ \\t]*,(?=${S}))?`, 'giu');
    return md.replace(pat, (...args) => {
      const groups = args[args.length - 1];
      return groups.p ? '' : (groups.c || '');
    });
  }

  // Remove hidden blocks and all sensitive dates, then tidy up the leftovers.
  function redact(md, sensitive, ext = null) {
    md = md.replace(HIDE, '');
    md = md.replace(HIDE_OPEN, '');   // unclosed block: better to lose the rest
    for (const d of sensitive) {
      // every pattern of a date contains its year (the first full-date one may have two digits only)
      if (d.year === null || d.year === undefined) continue;
      if (!md.includes(String(d.year)) && !(d.day && md.includes(pad2(d.year % 100)))) continue;
      for (const p of patternSources(d, SP_REDACT, ext)) md = del(md, p, false, ext);
      if (d.year !== null && d.year !== undefined) md = del(md, `(?<!${DIGIT})${d.year}(?!${DIGIT})`, true, ext);
    }
    md = md.replace(new RegExp(dangling(ext), 'giu'), '');
    md = md.replace(/(?<!\*)\*(?!\*)[ \t]*(?=[,;)])/gu, '');
    md = md.replace(/\*\*[ \t]*\*\*/gu, '');
    md = md.replace(new RegExp(`(?<=${NS})[ \\t]+(\\*\\*)(?=[${SPACES},.;:)]|${END})`, 'gu'), '$1');
    md = md.replace(/[ \t]*\([ \t]*[,;]?[ \t]*\)/gu, '');
    md = md.replace(/\([ \t]*[,;][ \t]*/gu, '(');
    md = md.replace(new RegExp(`\\([ \\t]+(?=${NS})`, 'gu'), '(');
    md = md.replace(/,[ \t]*(?:,[ \t]*)+/gu, ', ');
    md = md.replace(new RegExp(`(?<=${NS})[ \\t]+(?=[,;)])`, 'gu'), '');
    md = md.replace(new RegExp(`(?<=${NS})[ \\t]+\\.(?=${S}|${END})`, 'gu'), '.');
    return md.replace(new RegExp(`(?<=${NS})[ \\t]{2,}(?=${NS})`, 'gu'), ' ');
  }

  // --- html.unescape ------------------------------------------------------------------------------------

  const INVALID_CHARREFS = {
    0x00: '\ufffd', 0x0d: '\r', 0x80: '\u20ac', 0x81: '\x81', 0x82: '\u201a', 0x83: '\u0192', 0x84: '\u201e',
    0x85: '\u2026', 0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02c6', 0x89: '\u2030', 0x8a: '\u0160', 0x8b: '\u2039',
    0x8c: '\u0152', 0x8d: '\x8d', 0x8e: '\u017d', 0x8f: '\x8f', 0x90: '\x90', 0x91: '\u2018', 0x92: '\u2019',
    0x93: '\u201c', 0x94: '\u201d', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014', 0x98: '\u02dc', 0x99: '\u2122',
    0x9a: '\u0161', 0x9b: '\u203a', 0x9c: '\u0153', 0x9d: '\x9d', 0x9e: '\u017e', 0x9f: '\u0178',
  };
  function invalidCodepoint(n) {
    return (n >= 0x1 && n <= 0x8) || (n >= 0xe && n <= 0x1f) || (n >= 0x7f && n <= 0x9f)
      || (n >= 0xfdd0 && n <= 0xfdef) || n === 0xb || (n & 0xfffe) === 0xfffe;
  }
  const CHARREF = /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/g;

  // Python html.unescape: HTML5 named and numeric references, including the invalid ones.
  function unescape(s) {
    if (!s.includes('&')) return s;
    return s.replace(CHARREF, (whole, ref) => {
      if (ref[0] === '#') {
        const num = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2).replace(/;$/, ''), 16) : parseInt(ref.slice(1).replace(/;$/, ''), 10);
        if (has(INVALID_CHARREFS, num)) return INVALID_CHARREFS[num];
        if ((num >= 0xd800 && num <= 0xdfff) || num > 0x10ffff) return '\ufffd';
        if (invalidCodepoint(num)) return '';
        return String.fromCodePoint(num);
      }
      if (has(ENTITIES, ref)) return ENTITIES[ref];
      for (let x = ref.length - 1; x > 1; x--) if (has(ENTITIES, ref.slice(0, x))) return ENTITIES[ref.slice(0, x)] + ref.slice(x);
      return '&' + ref;
    });
  }

  // --- output check ---------------------------------------------------------------------------------------

  const DATA_TWIN = /^\(self\.FC_DATA=self\.FC_DATA\|\|\{\}\)\["[^"\\]*"\]=/;
  const EXTENSIONS = new Set(['.html', '.json', '.xml', '.txt', '.js', '.css']);
  const EMAIL = new RegExp(`(?<![${WORD}.%+\\-])[${WORD}.%+\\-]+@[${WORD}\\-]+(?:\\.[${WORD}\\-]+)*\\.([A-Za-z]{2,})(?![${WORD}\\-])`, 'gu');
  const EMAIL_FILE_SUFFIXES = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'css', 'js', 'json', 'woff', 'woff2', 'avif', 'ico', 'map', 'html']);
  const PHONE = new RegExp(`(?<![${WORD}.,/+\\-])(?:\\+?${DIGIT}{3}[ \\-]?)?${DIGIT}{3}[ \\-]?${DIGIT}{3}[ \\-]?${DIGIT}{3}(?!${W}|[.,]${DIGIT})`, 'gu');
  const DISTANCE = 80;
  // every "day sep month sep year" in a text, as "d.m.yyyy" / "d.m.yy" (overlapping, a superset of
  // what the first date pattern can match)
  const DMY = new RegExp(`(?=([0-9]{1,2})${S}*${SEP}${S}*([0-9]{1,2})${S}*${SEP}${S}*([0-9]{2,4})(?![0-9]))`, 'gu');
  // a number right before a year ("5/1995", "1.1995") and right after it ("1995-01")
  const NUM_YEAR = new RegExp(`(?=([0-9]{1,3})${S}*${SEP}${S}*([0-9]{3,4})(?![0-9]))`, 'gu');
  const YEAR_NUM = new RegExp(`(?<![0-9])(?=([0-9]{3,4})${S}*${SEP}${S}*([0-9]{1,3}))`, 'gu');
  function dmyOf(t) {
    const out = new Set();
    for (const m of t.matchAll(DMY)) out.add(`${+m[1]}.${+m[2]}.${m[3]}`);
    for (const m of t.matchAll(NUM_YEAR)) out.add(`${+m[1]}<${m[2]}`);
    for (const m of t.matchAll(YEAR_NUM)) out.add(`${m[1]}>${+m[2]}`);
    return out;
  }
  // a phone number has nine digits, at most one separator between any two of them
  const NINE_DIGITS = /\p{Nd}(?:[ \-]?\p{Nd}){8}/u;
  const WORD_RE = /[\p{L}\p{N}_]+/gu;
  const INVISIBLE = /[\u00ad\u200b\u200c\u200d\u2060\ufeff]/gu;

  // Python str.casefold() where it differs from toLowerCase(): sharp s, final sigma, ligatures, long s
  const FOLD = { 'ß': 'ss', 'ẞ': 'ss', 'ς': 'σ', 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st', 'ſ': 's', 'ŉ': 'ʼn' };
  const casefold = (s) => s.toLowerCase().replace(/[ßẞςﬀ-ﬆſŉ]/g, (c) => FOLD[c] || c);
  const stripAccents = (s) => casefold(s.normalize('NFD').replace(/\p{Mn}/gu, ''));
  const chars = (s) => Array.from(s);

  // [stem, longest suffix | null]. The suffix rules model Czech declension.
  function stems(names) {
    const out = new Map();
    const add = (k) => { if (chars(k).length >= 2 && !out.has(k)) out.set(k, chars(k).length <= 3 ? 3 : null); };
    for (const name of names) {
      for (const orig of casefold(name).split(new RegExp(`[${SPACES}\\-]+`, 'u'))) {
        const t = stripAccents(orig), c = chars(t), n = c.length;
        if (n < 3) continue;
        add(c.slice(0, Math.max(4, n - 2)).join(''));
        if (n >= 5 && (t.endsWith('el') || t.endsWith('ek') || t.endsWith('ec'))) add(c.slice(0, -2).join('') + c[n - 1]);
        if (n <= 4 && 'aeiouy'.includes(c[n - 1])) add(c.slice(0, -1).join(''));
        if (t.endsWith('ova') && n > 5) add(c.slice(0, -3).join(''));
        if ((orig.endsWith('ý') || orig.endsWith('á')) && n >= 4) add(c.slice(0, -1).join(''));
      }
    }
    return [...out].sort((a, b) => cmp(a[0], b[0]));
  }

  const STEM_CACHE = new Map();
  function stemPatterns(names) {
    const key = names.join('\u0000');
    if (!STEM_CACHE.has(key)) {
      if (STEM_CACHE.size > 10000) STEM_CACHE.clear();
      STEM_CACHE.set(key, stems(names).map(([stem, suffix]) => {
        const tail = suffix === null ? `${W}*` : `${W}{0,${suffix}}(?!${W})`;
        return [stem, new RegExp(`(?<!${W})${escapeRe(stem)}${tail}`, 'gu')];
      }));
    }
    return STEM_CACHE.get(key);
  }

  // A sample when a year from `years` is within 80 characters of a name, else null.
  function yearNearName(text, names, years, stripped) {
    // cheap test first: without one of the years in the text there is nothing to find
    if (!years.some((y) => text.includes(String(y)))) return null;
    const t = stripped !== undefined ? stripped : stripAccents(text);
    const spans = [];
    for (const [stem, re] of stemPatterns(names)) {
      if (!t.includes(stem)) continue;
      for (const m of t.matchAll(re)) spans.push([m.index, m.index + m[0].length]);
    }
    if (!spans.length) return null;
    for (const year of years) {
      for (const r of t.matchAll(new RegExp(`(?<!${DIGIT})${year}(?!${DIGIT})`, 'gu'))) {
        const rs = r.index, re_ = r.index + r[0].length;
        for (const [a, b] of spans) {
          if (a - re_ <= DISTANCE && rs - b <= DISTANCE && (a >= re_ || rs >= b)) {
            const lo = Math.max(0, Math.min(a, rs) - 20);
            return t.slice(lo, Math.max(b, re_) + 20).split('\n').join(' ');
          }
        }
      }
    }
    return null;
  }

  const pyStr = (v) => (v === null ? 'None' : v === true ? 'True' : v === false ? 'False' : String(v));

  function jsonStrings(obj, lines, strings) {
    const flat = [];
    const value = (v) => {
      if (v !== null && typeof v === 'object') jsonStrings(v, lines, strings);
      else { flat.push(pyStr(v)); if (typeof v === 'string') strings.push(v); }
    };
    if (Array.isArray(obj)) obj.forEach(value);
    else if (obj !== null && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) { strings.push(String(k)); flat.push(String(k)); value(v); }
    }
    if (flat.length) lines.push(flat.join(' | '));
  }

  const suffixOf = (rel) => {
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    const i = name.lastIndexOf('.');
    return i > 0 && i < name.length - 1 ? name.slice(i).toLowerCase() : '';
  };

  // [texts for rules a-d, texts for the year-near-name rule]
  function fileTexts(rel, bytes) {
    // as Python's read_text: universal newlines
    let raw = new TextDecoder('utf-8').decode(bytes).replace(/\r\n?/g, '\n');
    let suffix = suffixOf(rel);
    const twin = suffix === '.js' ? DATA_TWIN.exec(raw) : null;
    if (twin) {
      raw = raw.slice(twin[0].length).replace(new RegExp(`${S}+$`, 'u'), '');
      if (raw.endsWith(';')) raw = raw.slice(0, -1);
      suffix = '.json';
    }
    if (suffix === '.json') {
      let parsed, ok = true;
      try { parsed = JSON.parse(raw); } catch (e) { ok = false; }
      if (ok) {
        const lines = [], strings = [];
        jsonStrings(parsed, lines, strings);
        return [[...strings, ...lines], [...lines, ...strings]];
      }
    }
    if (suffix === '.html' || suffix === '.xml') {
      const plain = unescape(raw.replace(/<[^>]*>/g, ' '));
      const attributes = [...raw.matchAll(new RegExp(`=${S}*["']([^"']*)["']`, 'gu'))].map((m) => unescape(m[1])).join(' ');
      return [[unescape(raw), plain, attributes], [plain, attributes]];
    }
    const t = suffix === '.txt' ? unescape(raw) : raw;
    return [[t], [t]];
  }

  // An exception is a string or {text, reason}; the reason is required.
  function exceptionTexts(exceptions) {
    return exceptions.map((v) => {
      if (typeof v === 'string') return v;
      if (isObject(v) && typeof v.text === 'string') {
        if (typeof v.reason !== 'string' || !v.reason.trim()) throw new TypeError(`check exception "${v.text}" needs a reason`);
        return v.text;
      }
      throw new TypeError('a check exception must be a string or {text, reason}');
    });
  }

  const removeExceptions = (text, exceptions) => { for (const v of exceptions) if (v) text = text.split(v).join(' '); return text; };

  // Python sorts paths by their parts, not as strings ("a/b" before "a.txt").
  const byParts = (a, b) => {
    const x = a.split('/'), y = b.split('/');
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return cmp(x[i], y[i]);
    return x.length - y.length;
  };

  // Walk the files (keys relative to the checked folder) and return descriptions of problems.
  // Rules: (a) a form of a birth/marriage date, (b) a year of `living` within 80 characters of the
  // name, (c) an e-mail, (d) a phone number, (e) a file in documents/ that is not allowed.
  function checkOutput(files, living, exceptions, allowedDocuments = new Set(), ext = null) {
    const excepted = exceptionTexts(exceptions || []);
    const problems = [];
    // each pattern needs its year (or the two-digit year of a full date) in the text: test that first
    const patterns = [];
    const sourceSeen = new Set();
    for (const [, ds] of living) {
      for (const d of ds) {
        // the first pattern of a full date ("5.1.95", "05-01-1995") is looked up by day.month.year,
        // the others need the four-digit year; identical patterns run once
        for (const [src, kind] of patternSpecs(d, SP_CHECK, ext)) {
          if (sourceSeen.has(src)) continue;
          sourceSeen.add(src);
          const keys = {
            dmy: [`${d.day}.${d.month}.${d.year}`, `${d.day}.${d.month}.${pad2(d.year % 100)}`],
            'day<year': [`${d.day}<${d.year}`], 'month<year': [`${d.month}<${d.year}`], 'year>month': [`${d.year}>${d.month}`],
          }[kind] || [];
          patterns.push([new RegExp(src, 'iu'), kind === 'name' ? [String(d.year)] : [], keys, kind === 'name' ? d.month : null]);
        }
      }
    }
    // one regex for all month names (with the locale extensions): which months a text names
    const monthForms = [];
    for (let mo = 1; mo <= 12; mo++) for (const f of dates.monthNames(mo, ext ? ext.months : null)) monthForms.push([f, mo]);
    const monthOfForm = new Map();   // a form may belong to more months (locale extensions)
    for (const [f, mo] of monthForms) { const k = f.toLowerCase(); if (!monthOfForm.has(k)) monthOfForm.set(k, new Set()); monthOfForm.get(k).add(mo); }
    const MONTH_RE = new RegExp(`(?<!${W})(?:${monthForms.map(([f]) => escapeRe(f)).sort((x, y) => y.length - x.length).join('|')})`, 'giu');
    const monthsOf = (t) => {
      const out = new Set();
      for (const [f] of t.matchAll(MONTH_RE)) {
        const mos = monthOfForm.get(f.toLowerCase());
        if (mos) for (const mo of mos) out.add(mo); else out.add(-1);
      }
      if (out.has(-1)) for (let mo = 1; mo <= 12; mo++) out.add(mo);   // a case form we cannot map: try all
      return out;
    };
    const byNeedle = new Map(), byDmy = new Map();
    patterns.forEach(([, needles, dmys], i) => {
      for (const x of new Set(needles)) { if (!byNeedle.has(x)) byNeedle.set(x, []); byNeedle.get(x).push(i); }
      for (const x of new Set(dmys)) { if (!byDmy.has(x)) byDmy.set(x, []); byDmy.get(x).push(i); }
    });
    // [names, years] of every living person, and year -> indexes of the people with that year
    const livingYears = living.map(([names, ds]) => [names, [...new Set(ds.filter((d) => d.year !== null && d.year !== undefined).map((d) => d.year))]]);
    const livingByYear = new Map();
    livingYears.forEach(([names, years], i) => {
      if (!names.length) return;
      for (const y of years) { const k = String(y); if (!livingByYear.has(k)) livingByYear.set(k, []); livingByYear.get(k).push(i); }
    });
    const allowed = new Set([...allowedDocuments].map((p) => { const q = p.split('\\').join('/'); return q.startsWith('documents/') ? q.slice(10) : q; }));
    for (const rel of [...files.keys()].sort(byParts)) {
      if (rel.startsWith('documents/')) {
        if (!allowed.has(rel.slice(10))) problems.push(`${rel}: document not allowed`);
        continue;
      }
      if (!EXTENSIONS.has(suffixOf(rel))) continue;
      let [texts, lines] = fileTexts(rel, files.get(rel));
      texts = texts.map((t) => removeExceptions(t, excepted).replace(INVISIBLE, ''));
      lines = lines.map((t) => removeExceptions(t, excepted).replace(INVISIBLE, ''));
      const seen = new Set();
      const report = (message) => { if (!seen.has(message)) { seen.add(message); problems.push(`${rel}: ${message}`); } };
      // which 2- and 4-digit strings each text contains: a pattern or a year is tried only where it can match
      const digitsOf = (t) => {
        const out = new Set();
        for (const [run] of t.matchAll(/[0-9]{2,}/g)) {
          for (let len = 2; len <= 4; len++) for (let k = 0; k + len <= run.length; k++) out.add(run.slice(k, k + len));
        }
        return out;
      };
      for (const t of texts) {
        const tried = new Set();
        for (const x of digitsOf(t)) for (const i of byNeedle.get(x) || []) tried.add(i);
        if (byDmy.size && /[0-9]/.test(t)) for (const x of dmyOf(t)) for (const i of byDmy.get(x) || []) tried.add(i);
        let months = null;   // month numbers whose names occur in the text, computed when needed
        for (const i of [...tried].sort((a, b) => a - b)) {
          const month = patterns[i][3];
          if (month !== null) {
            if (months === null) months = monthsOf(t);
            if (!months.has(month)) continue;
          }
          const m = patterns[i][0].exec(t);
          if (m) report(`date of a living person "${m[0]}"`);
        }
        // cheap preconditions before the slow patterns: an "@", three digits in a row
        if (t.includes('@')) for (const m of t.matchAll(EMAIL)) if (!EMAIL_FILE_SUFFIXES.has(m[1].toLowerCase())) report(`e-mail "${m[0]}"`);
        if (NINE_DIGITS.test(t)) for (const m of t.matchAll(PHONE)) report(`phone number "${m[0]}"`);
      }
      const byYear = new Map();
      lines.forEach((t, li) => {
        for (const x of digitsOf(t)) if (x.length >= 3) { if (!byYear.has(x)) byYear.set(x, []); byYear.get(x).push(li); }
      });
      // words of the lines (without accents, case-folded) -> lines; sorted for prefix search
      let words = null, wordLines = null, strippedLines = null;
      const buildWords = () => {
        strippedLines = lines.map(stripAccents);
        wordLines = new Map();
        strippedLines.forEach((t, li) => {
          for (const [w] of t.matchAll(WORD_RE)) { if (!wordLines.has(w)) wordLines.set(w, new Set()); wordLines.get(w).add(li); }
        });
        words = [...wordLines.keys()].sort(cmp);
      };
      const linesWithPrefix = (full, into) => {
        // a stem may contain a non-word character ("o'br"): look up its leading word part, the
        // regex decides; a stem starting with a non-word character could be anywhere
        const stem = (/^[\p{L}\p{N}_]*/u.exec(full) || [''])[0];
        if (!stem) { for (let li = 0; li < lines.length; li++) into.add(li); return; }
        let lo = 0, hi = words.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (words[mid] < stem) lo = mid + 1; else hi = mid; }
        for (let i = lo; i < words.length && words[i].startsWith(stem); i++) for (const li of wordLines.get(words[i])) into.add(li);
      };
      // only the living people one of whose years occurs in the file, in their original order
      const who = new Set();
      for (const y of byYear.keys()) for (const i of livingByYear.get(y) || []) who.add(i);
      for (const pi of [...who].sort((a, b) => a - b)) {
        const [names, years] = livingYears[pi];
        if (words === null) buildWords();
        const withName = new Set();
        for (const [stem] of stemPatterns(names)) linesWithPrefix(stem, withName);
        const yearTexts = years.map(String);
        const candidates = [...withName].filter((li) => yearTexts.some((y) => lines[li].includes(y))).sort((x, y) => x - y);
        for (const li of candidates) {
          const sample = yearNearName(lines[li], names, years, strippedLines[li]);
          if (sample) { report(`year of a living person next to the name "${sample}"`); break; }
        }
      }
    }
    return problems;
  }

  const api = {
    extensions, localeExtensions, dateForms, patternSources, sensitiveDates, livingForCheck, redact,
    unescape, checkOutput, EXTENSIONS, DATA_TWIN,
  };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).privacy = api;
})(typeof window !== 'undefined' ? window : globalThis);
