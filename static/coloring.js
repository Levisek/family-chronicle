// Colouring of people in the tree and the fan chart: by branch, country of birth, birth period or evidence.
// Pure functions without DOM. In the browser `window.Coloring` (common.js and the pages use it),
// in Node `module.exports` (tests). Everything that depends on the family (states, flags, colours of
// flags) comes from the page data; the colours below are only the neutral fallbacks.
(function (g) {
  'use strict';

  const MODES = ['branch', 'state', 'era', 'documented'];
  const LIVING = '#cbc3b3', UNKNOWN = '#e2d8c3', DOCUMENTED = '#4e8a4c', UNDOCUMENTED = '#c4ab7c';
  const MAX_STATE_NAMES = 2;      // the legend lists at most the oldest and the newest name of a flag

  const yearOf = (s) => { const m = /(\d{4})/.exec(s || ''); return m ? +m[1] : null; };
  const birthYear = (p) => yearOf(p && p.birth && p.birth.date);
  const round1 = (x) => Math.round(x * 10) / 10;

  // the mode must be one the page offers (a site without `states` has no "state"), otherwise "branch"
  const parseMode = (value, allowed) => ((allowed || MODES).includes(value) && MODES.includes(value) ? value : 'branch');

  // the birth years of the deceased people in the data -> [min, max]; a default when there are none
  function eraRange(people) {
    const years = Object.values(people).filter((p) => !p.living).map(birthYear).filter(Boolean);
    return years.length ? [Math.min(...years), Math.max(...years)] : [1700, 2000];
  }

  // older is darker and warmer, younger lighter and cooler
  function eraColor(year, range) {
    const t = Math.min(1, Math.max(0, (year - range[0]) / Math.max(1, range[1] - range[0])));
    return `hsl(${round1(18 + t * 190)}, ${round1(42 - t * 6)}%, ${round1(34 + t * 26)}%)`;
  }

  // the states of a deceased person ([[state, from, to]] in the people file) -> flags without repeats, in
  // the order of the life: [{flag, src, color, names: ["Name 1900-1918", ...]}]
  function flagsOf(person, data, language) {
    const states = data.states || {}, flags = data.flags || {}, out = [], byFlag = new Map();
    for (const [key, from, to] of (person && person.states) || []) {
      const state = states[key];
      if (!state || !flags[state.flag]) continue;
      const name = (state.name[language] || Object.values(state.name)[0]) + ' ' + (to > from ? from + '–' + to : from);
      if (byFlag.has(state.flag)) { byFlag.get(state.flag).names.push(name); continue; }
      const f = { flag: state.flag, src: flags[state.flag].src, color: flags[state.flag].color, names: [name] };
      byFlag.set(state.flag, f); out.push(f);
    }
    return out;
  }

  // colour of a person in a mode; null in "branch" (the branch colour applies). The living have no dates and no
  // states, so they get one neutral colour in every other mode.
  function colorFor(person, mode, ctx) {
    if (mode === 'branch') return null;
    if (person.living) return LIVING;
    if (mode === 'state') { const f = flagsOf(person, ctx, ctx.language)[0]; return f ? f.color || UNKNOWN : UNKNOWN; }
    if (mode === 'era') { const y = birthYear(person); return y ? eraColor(y, ctx.range) : UNKNOWN; }
    return (person.documents || []).length ? DOCUMENTED : UNDOCUMENTED;
  }

  // what the legend of a mode lists: [{kind, label?, color?, flag?, branch?}] for the people that are visible.
  // `branches`: Set of the branch keys in view (null = all). Kinds: branch, swatch, flag, gradient.
  function legendItems(mode, ctx, visible, labels) {
    const items = [];
    if (mode === 'branch') {
      for (const b of ctx.branches || []) {
        if (!ctx.visibleBranches || ctx.visibleBranches.has(b.key)) {
          items.push({ kind: 'branch', branch: b.key, label: (b.name && (b.name[ctx.language] || Object.values(b.name)[0])) || b.key });
        }
      }
      return items;
    }
    if (mode === 'state') {
      const groups = new Map();
      for (const p of visible) {
        if (p.living) continue;
        const f = flagsOf(p, ctx, ctx.language)[0];
        if (!f) continue;
        if (!groups.has(f.flag)) groups.set(f.flag, { f, names: new Set() });
        groups.get(f.flag).names.add(f.names[0].replace(/\s[\d–]+$/, ''));
      }
      for (const { f, names } of groups.values()) {
        const n = [...names];
        items.push({ kind: 'flag', flag: f.src, color: f.color || UNKNOWN, label: (n.length > MAX_STATE_NAMES ? [n[0], n[n.length - 1]] : n).join(' / ') });
      }
      items.push({ kind: 'swatch', color: UNKNOWN, label: labels.state_unknown });
    } else if (mode === 'era') {
      const stops = [0, .25, .5, .75, 1].map((t) => eraColor(ctx.range[0] + t * (ctx.range[1] - ctx.range[0]), ctx.range));
      items.push({ kind: 'gradient', from: ctx.range[0], to: ctx.range[1], stops });
      items.push({ kind: 'swatch', color: UNKNOWN, label: labels.era_unknown });
    } else {
      items.push({ kind: 'swatch', color: DOCUMENTED, label: labels.documented_yes });
      items.push({ kind: 'swatch', color: UNDOCUMENTED, label: labels.documented_no });
    }
    if (visible.some((p) => p.living)) items.push({ kind: 'swatch', color: LIVING, label: labels.living });
    return items;
  }

  const api = { MODES, LIVING, UNKNOWN, DOCUMENTED, UNDOCUMENTED, parseMode, eraRange, eraColor, flagsOf, colorFor, legendItems };
  if (typeof module !== 'undefined') module.exports = api; else g.Coloring = api;
})(typeof window !== 'undefined' ? window : globalThis);
