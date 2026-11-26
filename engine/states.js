// Historical states: which country a person lived in, by the places and years of their events.
// The data (flags, states, regions) belong to the family (`states` in site.json); see
// familychronicle/states.py for the format. States are computed for deceased people only.
// Port of familychronicle/states.py; `load` takes the parsed JSON.
(function (g) {
  'use strict';

  const text = typeof require !== 'undefined' ? require('./text.js') : g.FCEngine.text;

  const COLOR = /^#[0-9a-fA-F]{3,8}$/;
  const DIRECTIONS = ['horizontal', 'vertical'];
  const MAX_STRIPES = 6;
  const OUTLINE = '<rect x=".25" y=".25" width="29.5" height="19.5" fill="none" stroke="#000" stroke-opacity=".25" stroke-width=".5"/>';

  class StatesError extends Error {
    constructor(message) { super(message); this.name = 'StatesError'; }
  }

  const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const isColor = (c) => typeof c === 'string' && COLOR.test(c);

  // urllib.parse.quote(s, safe=" =:/.-"): UTF-8 bytes, uppercase %XX, unreserved A-Za-z0-9_.-~ kept
  function quote(s) {
    let out = '';
    for (const b of new TextEncoder().encode(s)) {
      const c = String.fromCharCode(b);
      out += /[A-Za-z0-9_.\-~ =:/]/.test(c) ? c : '%' + b.toString(16).toUpperCase().padStart(2, '0');
    }
    return out;
  }

  class States {
    constructor(data, languages) {
      if (!isObject(data)) throw new StatesError('states file: must be an object');
      const part = (k) => (has(data, k) ? data[k] : {});
      const [flags, states, regions] = ['flags', 'states', 'regions'].map(part);
      for (const [name, value] of [['flags', flags], ['states', states], ['regions', regions]]) {
        if (!isObject(value)) throw new StatesError(`states file: ${name} must be an object`);
      }
      this.flags = {};
      for (const [k, v] of Object.entries(flags)) this.flags[k] = this._flag(k, v);
      this.states = {};
      for (const [k, v] of Object.entries(states)) this.states[k] = this._state(k, v, languages);
      this.regions = {};
      for (const [k, v] of Object.entries(regions)) this.regions[k] = this._region(k, v);
      this._palette();
    }

    _flag(key, v) {
      if (!isObject(v)) throw new StatesError(`flag ${key}: must be an object`);
      const stripes = v.stripes;
      if (!Array.isArray(stripes) || stripes.length < 1 || stripes.length > MAX_STRIPES || !stripes.every(isColor)) {
        throw new StatesError(`flag ${key}: stripes must be 1-${MAX_STRIPES} colours such as #aabbcc`);
      }
      const direction = has(v, 'direction') ? v.direction : 'horizontal';
      if (!DIRECTIONS.includes(direction)) throw new StatesError(`flag ${key}: direction must be one of ${DIRECTIONS.join(', ')}`);
      for (const field of ['hoist_triangle', 'color']) {
        if (has(v, field) && !isColor(v[field])) throw new StatesError(`flag ${key}: ${field} must be a colour such as #aabbcc`);
      }
      return { stripes, direction, hoist_triangle: has(v, 'hoist_triangle') ? v.hoist_triangle : null, color: has(v, 'color') ? v.color : null };
    }

    _state(key, v, languages) {
      if (!isObject(v) || !isObject(v.name)) throw new StatesError(`state ${key}: name must map language -> text`);
      const missing = languages.filter((x) => typeof v.name[x] !== 'string' || !v.name[x].trim());
      if (missing.length) throw new StatesError(`state ${key}: name is missing for ${missing.join(', ')}`);
      if (!has(this.flags, v.flag)) throw new StatesError(`state ${key}: flag ${text.pyRepr(v.flag)} is not in flags`);
      const name = {};
      for (const x of languages) name[x] = v.name[x];
      return { name, flag: v.flag };
    }

    _region(key, v) {
      if (!Array.isArray(v) || !v.length) throw new StatesError(`region ${key}: must be a non-empty list of [from_year, state]`);
      const out = v.map((item) => {
        if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'number') {
          throw new StatesError(`region ${key}: every entry must be [from_year, state]`);
        }
        if (!has(this.states, item[1])) throw new StatesError(`region ${key}: unknown state ${text.pyRepr(item[1])}`);
        return [item[0], item[1]];
      });
      for (let i = 1; i < out.length; i++) {
        if (!(out[i][0] > out[i - 1][0])) throw new StatesError(`region ${key}: years must be strictly increasing`);
      }
      return out;
    }

    // A flag without its own `color` gets an evenly spread hue (used by the colour mode "state").
    _palette() {
      const keys = Object.keys(this.flags).sort(cmp);
      const n = Math.max(1, keys.length);
      keys.forEach((key, i) => {
        if (!this.flags[key].color) this.flags[key].color = `hsl(${text.pyRound(360 * i / n, 0)}, 42%, 58%)`;
      });
    }

    flagSvg(key) {
      const f = this.flags[key];
      const n = f.stripes.length;
      let body = '';
      f.stripes.forEach((c, i) => {
        if (f.direction === 'horizontal') {
          body += `<rect y="${text.pyFixed(20 * i / n, 3)}" width="30" height="${text.pyFixed(20 / n + 0.05, 3)}" fill="${c}"/>`;
        } else {
          body += `<rect x="${text.pyFixed(30 * i / n, 3)}" width="${text.pyFixed(30 / n + 0.05, 3)}" height="20" fill="${c}"/>`;
        }
      });
      if (f.hoist_triangle) body += `<path d="M0 0L15 10L0 20Z" fill="${f.hoist_triangle}"/>`;
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20">${body}${OUTLINE}</svg>`;
    }

    // The flag as a data URI (works from disk, no extra file).
    flagUri(key) { return 'data:image/svg+xml,' + quote(this.flagSvg(key)); }

    // What the scripts need: names, flag images and colours (page data keys `states`, `flags`).
    pageData() {
      const states = {}, flags = {};
      for (const [k, v] of Object.entries(this.states)) states[k] = { name: v.name, flag: v.flag };
      for (const [k, f] of Object.entries(this.flags)) flags[k] = { src: this.flagUri(k), color: f.color };
      return { states, flags };
    }

    // Region of a canonical town: its `region`, else its country in the default language.
    regionOf(places, town, defaultLanguage) {
      const entry = town && has(places.data, town) ? places.data[town] : null;
      if (!entry) return null;
      const region = entry.region || (entry.country || {})[defaultLanguage];
      return region && has(this.regions, region) ? region : null;
    }

    stateAt(region, year) {
      let found = null;
      for (const [start, state] of has(this.regions, region) ? this.regions[region] : []) if (year >= start) found = state;
      return found;
    }

    // The states of a region valid within [start, end], with the years clipped to it.
    statesBetween(region, start, end) {
      const line = has(this.regions, region) ? this.regions[region] : null;
      if (!line) return [];
      const out = [];
      line.forEach(([since, state], i) => {
        const until = i + 1 < line.length ? line[i + 1][0] : 9999.0;
        const a = Math.max(since, start), b = Math.min(until, end);
        if (a < b || (a === b && b === start && since <= start && start < until)) out.push([state, a, b]);
      });
      return out;
    }

    // points = [[time, region or null]] -> [[state, year_from, year_to]] with equal neighbours merged.
    lifetime(points) {
      points = [...points].sort((p, q) => p[0] - q[0]);
      const first = points.find(([, r]) => r);
      if (!first) return [];
      let current = first[1];
      const filled = points.map(([t, r]) => { current = r || current; return [t, current]; });
      const stretches = [];
      filled.forEach(([t, r], i) => {
        const end = i + 1 < filled.length ? filled[i + 1][0] : t;
        stretches.push(...this.statesBetween(r, t, end));
      });
      const out = [];
      for (const [state, a, b] of stretches) {
        if (out.length && out[out.length - 1][0] === state) out[out.length - 1][2] = Math.max(out[out.length - 1][2], Math.trunc(b));
        else out.push([state, Math.trunc(a), Math.trunc(b)]);
      }
      return out;
    }

    // States in which a deceased person lived, from their dated events and marriages. A marriage
    // with a living partner is left out (its date is sensitive).
    personStates(tree, places, pid, defaultLanguage, living) {
      const person = tree.people.get(pid);
      const events = [...person.events];
      for (const fid of person.families) {
        const family = tree.families.get(fid);
        if (!family) continue;
        const other = family.husband === pid ? family.wife : family.husband;
        if (!living.has(other)) events.push(...family.events.filter((e) => e.type === 'MARR'));
      }
      const points = [];
      for (const e of events) {
        const t = moment(e.date);
        if (t === null) continue;
        const town = e.place ? places.town(e.place) : null;
        points.push([t, this.regionOf(places, town, defaultLanguage)]);
      }
      return this.lifetime(points);
    }
  }

  // A GEDCOM date -> year with a fraction (a missing month counts as mid-year); null without a year.
  function moment(date) {
    if (!date || !date.year) return null;
    if (!date.month) return date.year + 0.5;
    return date.year + (date.month - 1) / 12 + ((date.day || 1) - 1) / 365;
  }

  const load = (data, languages) => new States(data, languages);

  const api = { StatesError, States, load, moment, quote };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).states = api;
})(typeof window !== 'undefined' ? window : globalThis);
