// Document whitelist and export to WebP (without metadata). A document is published only when
// none of its linked people is living, excluded or out of scope. A foreign work is published only
// as a crop; `crop_only` does the same for your own sheet that also mentions a living person.
// Paths are keys of the project's file map (relative to the folder of site.json) and must stay in
// it. Port of familychronicle/documents.py; pixels go through an ImageAdapter:
//   { async toWebp(bytes, mime, crop | null, maxSize, quality) -> {data: Uint8Array, width, height} }
// which must drop all metadata (canvas.toBlob does).
(function (g) {
  'use strict';

  const req = typeof require !== 'undefined';
  const sha = req ? require('./sha256.js') : g.FCEngine.sha256;
  const text = req ? require('./text.js') : g.FCEngine.text;

  const DEFAULT_CUTOFF_YEAR = 1950;
  const CROP_DIR = 'crops';
  const COLORS_FILE = 'colors.json';
  const CROP_MAX = 1400, CROP_QUALITY = 80;
  const SHEET_MAX = 2600, SHEET_QUALITY = 75;
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

  class UnsupportedSource extends Error {
    constructor(message) { super(message); this.name = 'UnsupportedSource'; }
  }

  const has = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

  // Key of a file without the `#rotation` suffix; it must lie inside the project folder.
  function resolve(source) {
    const path = source.split('#')[0].split('\\').join('/');
    if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) throw new Error(`Path outside the base directory: ${source}`);
    const parts = [];
    for (const p of path.split('/')) {
      if (p === '' || p === '.') continue;
      if (p === '..') { if (!parts.length) throw new Error(`Path outside the base directory: ${source}`); parts.pop(); } else parts.push(p);
    }
    return parts.join('/');
  }

  // Validate documents.json (already parsed); paths are keys of `files`.
  function loadDocuments(data, files) {
    const ids = new Set();
    for (const d of data) {
      // the id becomes a file name in documents/
      if (typeof d.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(d.id) || d.id.includes('..')) {
        throw new Error(`Document id must be a plain name (letters, digits, . _ -): ${JSON.stringify(d.id)}`);
      }
      if (ids.has(d.id)) throw new Error(`Duplicate document id: ${d.id}`);
      ids.add(d.id);
      for (const field of ['source', 'marked']) {
        if (d[field] && !files.has(resolve(d[field]))) throw new Error(`Document ${d.id}: ${field} does not exist: ${d[field]}`);
      }
      const people = new Set(d.people || []);
      const extra = (d.main || []).filter((x) => !people.has(x));
      if (extra.length) throw new Error(`Document ${d.id}: main people are not in \`people\`: ${[...new Set(extra)].sort().join(', ')}`);
    }
    return data;
  }

  // People the record is about; without `main` all linked people.
  const mainPeople = (d) => (has(d, 'main') ? [...d.main] : [...(d.people || [])]);

  // Colour of a crop from colors.json next to the source (key = first 2 digits of the file name).
  function color(d, files) {
    const p = resolve(d.source);
    const slash = p.lastIndexOf('/');
    const name = p.slice(slash + 1), dir = slash < 0 ? '' : p.slice(0, slash + 1);
    const m = /^(\d{2})/.exec(name);
    const f = dir + COLORS_FILE;
    if (!m || !files.has(f)) return null;
    const colors = JSON.parse(text.fromUtf8(files.get(f)));
    return has(colors, m[1]) ? colors[m[1]] : null;
  }

  // A crop is an entry with `crop`, or a file in a `crops/` folder.
  function isCrop(d) {
    if (d.crop && d.crop.length) return true;
    return d.source.split('#')[0].split('/').slice(0, -1).includes(CROP_DIR);
  }

  function isVerified(d, files) {
    if (d.verified !== null && d.verified !== undefined) return Boolean(d.verified);
    return color(d, files) !== 'blue';
  }

  // Label of an unverified document: a foreign work is an "unverified source".
  const unverifiedLabel = (d, strings) => (d.foreign_work ? strings.unverified_source : null) || strings.unverified || '';

  // [published, withheld with the reason]
  function decide(documents, scope, files, cutoffYear = DEFAULT_CUTOFF_YEAR) {
    const published = [], withheld = [];
    for (const d of documents) {
      let reason = null;
      const people = d.people || [];
      const living = people.filter((p) => scope.living.has(p));
      const outside = people.filter((p) => !scope.people.has(p));
      if (living.length) reason = 'linked living person: ' + living.join(', ');
      else if (outside.length) reason = 'linked person out of scope or excluded: ' + outside.join(', ');
      else if (!people.length && !(d.year !== null && d.year !== undefined && d.year < cutoffYear)) reason = `no linked person and the year is not before ${cutoffYear}`;
      else if (d.foreign_work && !isCrop(d)) reason = 'foreign work without a crop (whole page)';
      else if (color(d, files) === 'gray') reason = `excluded (gray in ${COLORS_FILE})`;
      if (reason) withheld.push([d, reason]); else published.push(d);
    }
    return [published, withheld];
  }

  // Pillow's Image.thumbnail((max, max)) size: fit inside, keep the aspect ratio, never enlarge.
  function fitSize(width, height, max) {
    if (max >= width && max >= height) return [width, height];
    const aspect = width / height;
    const round = (n, key) => Math.max([Math.floor(n), Math.ceil(n)].reduce((a, b) => (key(b) < key(a) ? b : a)), 1);
    if (max / max >= aspect) return [round(max * aspect, (n) => Math.abs(aspect - n / max)), max];
    return [max, round(max / aspect, (n) => (n === 0 ? 0 : Math.abs(aspect - max / n)))];
  }

  function mimeOf(source) {
    const path = source.split('#')[0];
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    if (source.includes('#') || ext === 'pdf' || !has(MIME, ext)) {
      throw new UnsupportedSource(`${source}: this kind of file is not supported; save the page as an image (JPG or PNG)`);
    }
    return MIME[ext];
  }

  async function encode(images, files, source, crop, max, quality) {
    const key = resolve(source);
    if (!files.has(key)) throw new Error(`file does not exist: ${source}`);
    return images.toWebp(files.get(key), mimeOf(source), crop, max, quality);
  }

  // The crop (and the whole sheet unless it is a foreign work or `crop_only`) as WebP files.
  // Returns {crop, sheet, width, height, files}; paths are relative to the site folder.
  async function exportDocument(document, files, images) {
    if (document.foreign_work && !isCrop(document)) {
      throw new Error(`Document ${document.id}: a foreign work without a crop cannot be exported`);
    }
    for (const field of ['source', 'marked']) if (document[field]) resolve(document[field]);
    const out = new Map();
    const save = (data, name) => {
      const rel = `documents/${name.replace('{h}', sha.hash8(data))}.webp`;
      out.set(rel, data);
      return rel;
    };
    const crop = document.crop && document.crop.length ? [...document.crop] : null;
    const cropped = await encode(images, files, document.source, crop, CROP_MAX, CROP_QUALITY);
    const result = { crop: save(cropped.data, `${document.id}-{h}`), sheet: null, width: cropped.width, height: cropped.height, files: out };
    if (!document.foreign_work && !document.crop_only) {
      const sheet = await encode(images, files, document.marked || document.source, null, SHEET_MAX, SHEET_QUALITY);
      result.sheet = save(sheet.data, `${document.id}-sheet-{h}`);
    }
    return result;
  }

  const sameCrop = (a, b) => (a && a.length ? JSON.stringify([...a]) : null) === (b && b.length ? JSON.stringify([...b]) : null);

  // Match a book image (same source and crop) to a document.
  const documentForImage = (documents, source, crop) => documents.find((d) => d.source === source && sameCrop(d.crop, crop)) || null;

  // The published document that lets the book typeset `source` (with `crop`), or null.
  function imageDocument(published, source, crop) {
    return documentForImage(published, source, crop)
      || published.find((d) => d.source === source && !d.foreign_work && !d.crop_only) || null;
  }

  const api = {
    DEFAULT_CUTOFF_YEAR, CROP_MAX, CROP_QUALITY, SHEET_MAX, SHEET_QUALITY, UnsupportedSource, resolve, loadDocuments,
    mainPeople, isCrop, isVerified, unverifiedLabel, decide, fitSize, exportDocument, export: exportDocument,
    documentForImage, imageDocument,
  };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).documents = api;
})(typeof window !== 'undefined' ? window : globalThis);
