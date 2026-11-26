// Chronicles (Markdown) -> HTML for the website. Web markers are HTML comments on a line of
// their own before a paragraph: `<!-- place: A; B -->`, `<!-- person: I12 -->` (anchors),
// `<!-- web:hide -->...<!-- /web:hide -->` (removed), `<!-- web:text: Replacement -->` (plain text
// on the web), `<!-- img: snippet -->` (lets a translation anchor a book image). A chapter is
// `chronicles/<key>.md` in the default language; its translation is `chronicles/<key>.<lang>.md`.
// Port of familychronicle/chronicles.py; files come from the project's file map.
(function (g) {
  'use strict';

  const req = typeof require !== 'undefined';
  const md = req ? require('./markdown.js') : g.FCEngine.markdown;
  const privacy = req ? require('./privacy.js') : g.FCEngine.privacy;
  const docs = req ? require('./documents.js') : g.FCEngine.documents;
  const text = req ? require('./text.js') : g.FCEngine.text;

  const W = '[\\p{L}\\p{N}_]';
  const MARKER = /^[ \t]*<!--[ \t]*(place|person)[ \t]*:([\s\S]*?)-->[ \t]*$/gm;
  const TEXT = /<!--[ \t]*web:text[ \t]*: ?([\s\S]*?) ?-->/g;
  const COMMENT = /<!--[\s\S]*?-->/g;
  const REST = /<!--[^\n]*/g;
  const TOKEN = /<h2>([\s\S]*?)<\/h2>|<div class="anchor" data-(places|people)="([^"]*)"><\/div>/g;
  const PERSON_ANCHOR = /<div class="anchor" data-people="([^"]*)"><\/div>\s*(<p[^>]*>[\s\S]*?<\/p>)/g;
  const NOTE = /(<li id="fn:[^"-]*-([^"]+)">[\s\S]*?)(<a class="footnote-backref")/g;
  const UNCERTAIN = new RegExp(`<p>((?:(?!</p>)[\\s\\S])*?(?:nejspíš|(?<!${W})(?=${W})(?:probably|most likely|likely)(?:(?<=${W})(?!${W})))(?:(?!</p>)[\\s\\S])*)</p>`, 'giu');

  const basename = (p) => p.split(/[\\/]/).pop();
  const dirname = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i + 1); };

  function slug(s) {
    const ascii = s.normalize('NFKD').replace(/[^\x00-\x7f]/g, '');
    return ascii.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // `chronicles/huber.md` and `chronicles/huber.cs.md` -> `huber`.
  function chapterSlug(mdFile) {
    const name = basename(mdFile);
    return slug(name.split('.')[0]) || 'chapter';
  }

  const plain = (h) => privacy.unescape(h.replace(/<[^>]+>/g, '')).trim();

  // `I12; @I3@` -> ['I12', 'I3']
  const values = (s) => s.split(';').map((x) => x.trim().replace(/^@+|@+$/g, '').trim()).filter(Boolean);

  function markers(src) {
    return src.replace(MARKER, (all, kind, value) => {
      const v = kind === 'person' ? values(value) : value.split(';').map((x) => x.trim()).filter(Boolean);
      if (!v.length) return '';
      return `\n<div class="anchor" data-${kind === 'place' ? 'places' : 'people'}="${text.escapeHtml(v.join(';'))}"></div>\n`;
    });
  }

  function insertImages(src, slugName, lang, published, exports, strings, rootUrl, images, files) {
    const pub = new Set(published.map((d) => d.id));
    for (const [chapter, snippet, source, crop, caption] of images) {
      if (chapter !== slugName) continue;
      const d = docs.documentForImage(published, source, crop);
      if (!d || !pub.has(d.id) || !Object.prototype.hasOwnProperty.call(exports, d.id)) continue;
      const pos = src.indexOf(snippet);
      if (pos < 0) continue;
      let end = src.indexOf('\n\n', pos);
      if (end < 0) end = src.length;
      const ex = exports[d.id];
      const cap = (d.description || {})[lang] || caption;
      let img = `<img src="${rootUrl}${ex.crop}" width="${ex.width}" height="${ex.height}" alt="${text.escapeHtml(cap)}" loading="lazy">`;
      if (ex.sheet) img = `<a href="${rootUrl}${ex.sheet}">${img}</a>`;
      const verified = docs.isVerified(d, files);
      const note = verified ? '' : ` <span class="unverified-caption">${text.escapeHtml(docs.unverifiedLabel(d, strings))}</span>`;
      const cls = 'document' + (verified ? '' : ' unverified');
      const fig = `\n\n<figure class="${cls}">${img}<figcaption>${text.escapeHtml(cap)}${note}</figcaption></figure>`;
      src = src.slice(0, end) + fig + src.slice(end);
    }
    return src;
  }

  function noteLinks(h, slugName, published, exports, strings, rootUrl) {
    return h.replace(NOTE, (all, head, n, tail) => {
      const key = `${slugName}#${n}`;
      const links = [];
      for (const d of published) {
        const ex = exports[d.id];
        if (ex && (d.notes || []).includes(key)) {
          links.push(`<a href="${rootUrl}${ex.crop}">${text.escapeHtml(strings.crop || 'crop')}</a>`);
          if (ex.sheet) links.push(`<a href="${rootUrl}${ex.sheet}">${text.escapeHtml(strings.full_sheet || 'full sheet')}</a>`);
        }
      }
      if (!links.length) return all;
      return `${head}<span class="note-documents">[${links.join(' | ')}]</span> ${tail}`;
    });
  }

  function sections(h) {
    const out = [], used = new Set();
    const html = h.replace(TOKEN, (all, heading, kind, value) => {
      if (heading !== undefined) {
        const base = slug(plain(heading)) || 'section';
        let sid = base, i = 2;
        while (used.has(sid)) { sid = `${base}-${i}`; i += 1; }
        used.add(sid);
        out.push({ id: sid, title: plain(heading), places: [], people: [] });
        return `<h2 id="${sid}">${heading}</h2>`;
      }
      if (out.length) {
        const target = out[out.length - 1][kind === 'places' ? 'places' : 'people'];
        for (const v of values(privacy.unescape(value))) if (!target.includes(v)) target.push(v);
      }
      return all;
    });
    return [html, out];
  }

  function personParagraphs(h) {
    const out = new Map();
    for (const m of h.matchAll(PERSON_ANCHOR)) {
      const p = m[2].replace(/<sup id="fnref[^"]*">[\s\S]*?<\/sup>/g, '');
      for (const person of values(privacy.unescape(m[1]))) out.set(person, out.has(person) ? `${out.get(person)}\n${p}` : p);
    }
    return out;
  }

  // Text of a file as Python's read_text gives it (UTF-8, universal newlines).
  const readText = (files, key) => text.fromUtf8(files.get(key)).replace(/\r\n?/g, '\n');

  // Render one chapter. `mdFile` is the key of the default-language file; for another `lang` its
  // `<key>.<lang>.md` translation is used when present. options: strings, rootUrl ('../'),
  // defaultLanguage ('en'), images ([chapter slug, snippet, source, crop, caption]), ext.
  function render(mdFile, lang, sensitive, published, exports, files, options = {}) {
    // docFiles: the files that document paths (colors.json) resolve against, when not `files`
    const { strings = {}, rootUrl = '../', defaultLanguage = 'en', images = [], ext = null, docFiles = files } = options;
    const slugName = chapterSlug(mdFile);
    let path = mdFile, contentLanguage = defaultLanguage;
    if (lang !== defaultLanguage) {
      const translation = `${dirname(mdFile)}${slugName}.${lang}.md`;
      if (files.has(translation)) { path = translation; contentLanguage = lang; }
    }
    if (!files.has(path)) throw new Error(`chronicle not found: ${path}`);
    let src = readText(files, path);
    src = src.replace(TEXT, (all, t) => text.escapeText(t.replace(/^\n+|\n+$/g, '')));
    src = privacy.redact(src, sensitive, ext);
    src = markers(src);
    src = insertImages(src, slugName, lang, published, exports, strings, rootUrl, images, docFiles);
    src = src.replace(COMMENT, '').replace(REST, '');
    let h = md.render(src);
    h = noteLinks(h, slugName, published, exports, strings, rootUrl);
    h = h.replace(UNCERTAIN, '<p class="uncertain">$1</p>');
    let secs;
    [h, secs] = sections(h);
    const paragraphs = personParagraphs(h);
    if (lang !== contentLanguage) h = `<p class="untranslated">${text.escapeHtml(strings.untranslated || '')}</p>` + h;
    const m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(h);
    const title = m ? plain(m[1]) : slugName;
    return { slug: slugName, title, html: h, contentLanguage, sections: secs, personParagraphs: paragraphs };
  }

  // Positions of the open-question sections (headings from `open_questions_headings`).
  function openSectionIndexes(ch, headings) {
    const wanted = new Set(headings);
    return ch.sections.map((s, i) => (wanted.has(s.title) ? i : -1)).filter((i) => i >= 0);
  }

  const escapeRe = (s) => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');

  // [title, html] of the chosen sections, for another page.
  function cutSections(ch, idx) {
    const out = [];
    for (const i of idx) {
      if (i >= ch.sections.length) continue;
      const s = ch.sections[i];
      const m = new RegExp(`<h2 id="${escapeRe(s.id)}">[\\s\\S]*?</h2>`).exec(ch.html);
      if (!m) continue;
      const after = m.index + m[0].length;
      const endRe = /<h2[ >]|<div class="footnote"/g;
      endRe.lastIndex = after;
      const e = endRe.exec(ch.html);
      let body = ch.html.slice(after, e ? e.index : ch.html.length);
      body = body.replace(/<div class="anchor"[^>]*><\/div>/g, '');
      body = body.replace(/<sup id="fnref[^"]*">/g, '<sup>');
      body = body.split('href="#').join(`href="${ch.slug}.html#`);
      if (body.replace(/<[^>]+>|\s/g, '')) out.push([s.title, body.trim()]);
    }
    return out;
  }

  const api = { chapterSlug, render, openSectionIndexes, cutSections, slug };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).chronicles = api;
})(typeof window !== 'undefined' ? window : globalThis);
