// Coordinates for the places of a GEDCOM: the coordinates in the GEDCOM itself, then the bundled
// gazetteer (GeoNames, app/data/gazetteer.js, made by tools/gazetteer.mjs), then (on request) an
// online lookup on Nominatim. Several equally good matches are never picked automatically.
//   gaz = {names: [[name, lat, lon, cc, admin1], ...], index: {normalized alternate name: [i, ...]},
//          admin1: {"CC.code": [display name, normalized names...]}, countries: {normalized: cc},
//          countryNames: {cc: {lang: name}}}
(function (g) {
  'use strict';

  const req = typeof require !== 'undefined';
  const placesMod = req ? require('./places.js') : g.FCEngine.places;

  const MAX_CANDIDATES = 8;
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

  // lower case, no diacritics, no brackets, no house numbers ("č. 12", "čp. 7", "Lhota 15")
  function normalize(s) {
    let t = String(s).replace(/\([^)]*\)/g, ' ');
    t = t.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    t = t.replace(/(^|\s)(?:c\.\s*p\.|cp\.|c\.|no\.)\s*\d+\S*/g, ' ');
    t = t.replace(/\s+\d+\S*$/, '');
    return t.replace(/\s+/g, ' ').trim();
  }

  // normalized name -> indices into gaz.names (primary names and the alternate-name index)
  const prepared = new WeakMap();
  function prepare(gaz) {
    let p = prepared.get(gaz);
    if (p) return p;
    const byName = new Map();
    const add = (k, i) => { if (!k) return; const a = byName.get(k); if (a) { if (!a.includes(i)) a.push(i); } else byName.set(k, [i]); };
    gaz.names.forEach((row, i) => add(normalize(row[0]), i));
    for (const k of Object.keys(gaz.index || {})) for (const i of gaz.index[k]) add(k, i);
    const admin1 = new Map(Object.entries(gaz.admin1 || {}).map(([code, names]) => [code, new Set(names.slice(1).concat(normalize(names[0])))]));
    p = { byName, admin1 };
    prepared.set(gaz, p);
    return p;
  }

  const has = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

  function candidate(gaz, i) {
    const [name, lat, lon, cc, a1] = gaz.names[i];
    const code = `${cc}.${a1}`;
    return { name, lat, lon, cc, admin1: has(gaz.admin1, code) ? gaz.admin1[code][0] : '' };
  }

  // Parts after the comma, left to right: the first part found in the gazetteer is the town; the
  // later parts (country, region, two-letter country code) narrow the matches. A narrowing that
  // would leave nothing is ignored.
  function lookup(place, gaz) {
    const { byName, admin1 } = prepare(gaz);
    const parts = String(place).split(',').map((x) => x.trim()).filter(Boolean);
    let found = null, rest = [];
    for (let i = 0; i < parts.length && !found; i++) {
      const k = normalize(parts[i]);
      found = byName.get(k) || (k.includes('-') ? byName.get(k.split('-')[0].trim()) : null) || null;
      rest = parts.slice(i + 1);
    }
    if (!found) return { status: 'none', candidates: [] };
    let cand = found.slice();
    for (const part of rest) {
      const n = normalize(part);
      let keep = null;
      if (has(gaz.countries, n)) keep = (i) => gaz.names[i][3] === gaz.countries[n];
      else if (/^[a-z]{2}$/.test(n)) keep = (i) => gaz.names[i][3].toLowerCase() === n;
      else keep = (i) => { const s = admin1.get(`${gaz.names[i][3]}.${gaz.names[i][4]}`); return !!s && s.has(n); };
      const narrowed = cand.filter(keep);
      if (narrowed.length) cand = narrowed;
    }
    return { status: cand.length === 1 ? 'unique' : 'ambiguous', candidates: cand.slice(0, MAX_CANDIDATES).map((i) => candidate(gaz, i)) };
  }

  // {place string: entry}. An entry with coordinates: {town, coords, source, country[, name, existing]};
  // otherwise {town, status: 'ambiguous' | 'none', candidates}. `town` is the places.json key.
  // Places already in places.json (`existing`) are returned as they are and never changed.
  function resolveAll(placeStrings, tree, gaz, existing) {
    const known = new placesMod.Places(existing || {});
    const coordsOf = (tree && tree.placeCoords) || new Map();
    const out = {};
    for (const p of placeStrings) {
      if (!p || has(out, p)) continue;
      const set = (v) => Object.defineProperty(out, p, { value: v, enumerable: true, writable: true, configurable: true });
      const town = known.town(p);
      if (town) {
        const e = existing[town];
        set({ town, coords: [...e.coords], source: e.source || 'manual', country: e.country || {}, existing: true });
        continue;
      }
      const name = placesMod.toTown(p) || p.split(',')[0].trim();
      if (coordsOf.has(p)) { set({ town: name, coords: [...coordsOf.get(p)], source: 'gedcom', country: {} }); continue; }
      const r = lookup(p, gaz);
      if (r.status === 'unique') {
        const c = r.candidates[0];
        set({ town: name, coords: [c.lat, c.lon], source: 'gazetteer', country: (gaz.countryNames && gaz.countryNames[c.cc]) || {}, name: c.name });
      } else set({ town: name, status: r.status, candidates: r.candidates });
    }
    return out;
  }

  // Only the place string goes out, nothing about people.
  const nominatimUrl = (place) => `${NOMINATIM}?format=jsonv2&limit=5&q=${encodeURIComponent(place)}`;

  function parseNominatim(json) {
    if (!Array.isArray(json)) return [];
    const out = [];
    for (const r of json) {
      const lat = parseFloat(r && r.lat), lon = parseFloat(r && r.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const display = String(r.display_name || '');
      const cc = r.address && r.address.country_code ? String(r.address.country_code).toUpperCase() : '';
      out.push({ name: String(r.name || display), lat, lon, cc, admin1: display });
    }
    return out;
  }

  const api = { normalize, lookup, resolveAll, nominatimUrl, parseNominatim, MAX_CANDIDATES };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).gazetteer = api;
})(typeof window !== 'undefined' ? window : globalThis);
