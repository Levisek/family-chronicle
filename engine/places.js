// Place table: GEDCOM PLAC -> canonical town and coordinates. Street addresses are dropped.
// `places.json` maps a town name to {coords: [lat, lon], country: {lang: name}, aliases: [...]}.
// A place that is neither mapped nor ignored is left off the map and collected in `missing`.
// Port of familychronicle/places.py; the constructor takes the parsed JSON, not a path.
(function (g) {
  'use strict';

  // Python str.casefold() for the letters that differ from toLowerCase()
  // Python str.casefold() where it differs from toLowerCase(): sharp s, final sigma, ligatures, long s
  const FOLD = { 'ß': 'ss', 'ẞ': 'ss', 'ς': 'σ', 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st', 'ſ': 's', 'ŉ': 'ʼn' };
  const casefold = (s) => s.toLowerCase().replace(/[ßẞςﬀ-ﬆſŉ]/g, (c) => FOLD[c] || c);
  const key = (s) => casefold(s.replace(/\s+/g, ' ').trim());

  // Python's \b with Unicode word characters (JS \b only knows ASCII)
  const W = '[\\p{L}\\p{N}_]';
  // Czech "č. p." / "čp." / "č." and English "No." followed by a house number
  const HOUSE_NUMBER = new RegExp(`(?<!${W})(?=${W})(?:č\\.\\s*p\\.|čp\\.|č\\.|no\\.?)\\s*\\d+\\S*`, 'giu');
  const STREET = new RegExp(`(?<!${W})ul\\.\\s.*$`, 'iu');
  const STREET_ADDRESS = /^\d+[\p{L}\p{N}_]*\s+\S/u;   // "12 High Street": a street, not a town

  function cleanSegment(segment) {
    let s = segment.split('(?)').join(' ');      // uncertain reading of a house number
    s = s.replace(HOUSE_NUMBER, '');
    s = s.replace(STREET, '');                     // Czech "ul." (street)
    s = s.replace(/\s+\d+\S*$/u, '');              // trailing house number
    return s.trim();
  }

  // The town part of a place: no house numbers, streets or later segments.
  function toTown(place) {
    const segments = place.split(',').map(cleanSegment);
    for (let i = 0; i < segments.length; i++) {
      if (STREET_ADDRESS.test(segments[i]) && i + 1 < segments.length) continue;
      return segments[i];
    }
    return segments[segments.length - 1];
  }

  class Places {
    constructor(data, ignore = []) {
      this.data = data;
      this._index = new Map();
      for (const [name, entry] of Object.entries(data)) {
        this._index.set(key(name), name);
        for (const alias of entry.aliases || []) this._index.set(key(alias), name);
      }
      this._ignore = new Set([...ignore].map(key));
      this.missing = new Set();
    }

    // Canonical town for a PLAC value, or null when it is not in the table.
    town(place) {
      if (!place) return null;
      const k = key(place);
      if (this._index.has(k)) return this._index.get(k);
      const t = toTown(place);
      return t ? (this._index.get(key(t)) ?? null) : null;
    }

    coords(town) {
      const entry = Object.prototype.hasOwnProperty.call(this.data, town) ? this.data[town] : null;
      if (!entry) return null;
      const [lat, lon] = entry.coords;
      return [lat, lon];
    }

    isIgnored(place) {
      return this._ignore.has(key(place)) || this._ignore.has(key(toTown(place)));
    }

    // Unmapped, non-ignored places (town only, no address), without duplicates.
    unknown(places) {
      const out = [];
      for (const p of places) {
        if (!p || this.town(p) || this.isIgnored(p)) continue;
        const t = toTown(p) || p.split(',')[0].trim();
        if (!out.includes(t)) out.push(t);
      }
      return out;
    }
  }

  const api = { Places, toTown, key };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).places = api;
})(typeof window !== 'undefined' ? window : globalThis);
