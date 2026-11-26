// A newer GEDCOM of the same family: which old person is which new one, and the settings,
// documents and chronicles moved over to the new ids. Pure functions over parsed trees.
//   same id + same name + same birth year = the same person; otherwise the name (no diacritics),
//   the birth year within 2 years and, among several, the names of the parents. One candidate is
//   taken, several or none is a question for a person (only for the ids the project uses).
(function (g) {
  'use strict';

  const req = typeof require !== 'undefined';
  const M = (name) => (req ? require(`./${name}.js`) : g.FCEngine[name]);
  const scope = M('scope');
  const events = M('events');

  const MAX_CANDIDATES = 8;
  const YEARS = 2;
  const ANCHOR = /^([ \t]*<!--[ \t]*person[ \t]*:)([\s\S]*?)(-->[ \t]*)$/gm;

  const plain = (s) => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const nameOf = (p) => plain([p.given, p.surname].filter(Boolean).join(' '));
  const yearOf = (p) => (p.birth && p.birth.date && p.birth.date.year != null ? p.birth.date.year : null);
  const anchorIds = (s) => s.split(';').map((x) => x.trim().replace(/^@+|@+$/g, '').trim()).filter(Boolean);
  const parentNames = (tree, id) => tree.parents(id).map((x) => nameOf(tree.people.get(x))).sort().join('|');

  function usedIds(cfg, documents, chronicles) {
    const out = new Set();
    const add = (x) => { if (typeof x === 'string' && x) out.add(x); };
    add(cfg.root);
    for (const b of cfg.branches || []) (b.roots || []).forEach(add);
    for (const k of ['living_extra', 'deceased_extra', 'exclude']) (cfg[k] || []).forEach(add);
    Object.keys(cfg.living_town || {}).forEach(add);
    for (const d of documents || []) { (d.people || []).forEach(add); (d.main || []).forEach(add); }
    for (const text of (chronicles || new Map()).values()) {
      for (const m of String(text).matchAll(ANCHOR)) anchorIds(m[2]).forEach(add);
    }
    return out;
  }

  const idCmp = (a, b) => a.localeCompare(b, 'en', { numeric: true });

  function pair(oldTree, newTree, used) {
    const pairs = new Map(), auto = [], questions = [], removed = [];
    const taken = new Set();
    const byName = new Map();
    for (const p of newTree.people.values()) {
      const k = nameOf(p);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(p);
    }
    const oldIds = [...oldTree.people.keys()].sort(idCmp);
    // first the sure ones: same id, same name, same birth year
    const rest = [];
    for (const id of oldIds) {
      const o = oldTree.people.get(id), n = newTree.people.get(id);
      if (n && nameOf(n) === nameOf(o) && yearOf(n) === yearOf(o)) { pairs.set(id, id); taken.add(id); } else rest.push(id);
    }
    for (const id of rest) {
      const o = oldTree.people.get(id);
      const y = yearOf(o);
      let cands = (byName.get(nameOf(o)) || []).filter((n) => !taken.has(n.id) &&
        (y === null || yearOf(n) === null || Math.abs(yearOf(n) - y) <= YEARS));
      if (cands.length > 1) {
        const pn = parentNames(oldTree, id);
        const same = cands.filter((n) => parentNames(newTree, n.id) === pn);
        if (same.length) cands = same;
      }
      if (cands.length === 1 && nameOf(o)) {
        pairs.set(id, cands[0].id);
        taken.add(cands[0].id);
        auto.push({ old: id, new: cands[0].id });
      } else if (used.has(id)) {
        questions.push({ id, candidates: cands.map((n) => n.id).sort(idCmp).slice(0, MAX_CANDIDATES) });
      } else removed.push(id);
    }
    return { pairs, auto, questions, removed };
  }

  function remap({ cfg, documents, chronicles }, pairs) {
    const to = (id) => (pairs.has(id) ? pairs.get(id) : null);
    const list = (a) => (Array.isArray(a) ? a.map(to).filter(Boolean) : a);
    const c = JSON.parse(JSON.stringify(cfg));
    if ('root' in c) c.root = c.root ? to(c.root) : null;
    if (Array.isArray(c.branches)) c.branches = c.branches.map((b) => ({ ...b, roots: list(b.roots || []) })).filter((b) => b.roots.length);
    for (const k of ['living_extra', 'deceased_extra', 'exclude']) if (Array.isArray(c[k])) c[k] = list(c[k]);
    if (c.living_town && typeof c.living_town === 'object') {
      c.living_town = Object.fromEntries(Object.entries(c.living_town).map(([id, town]) => [to(id), town]).filter(([id]) => id));
    }
    const docs = (documents || []).map((d) => {
      const x = JSON.parse(JSON.stringify(d));
      if (Array.isArray(x.people)) x.people = list(x.people);
      if (Array.isArray(x.main)) x.main = list(x.main);
      return x;
    });
    const chron = new Map();
    for (const [path, text] of chronicles || new Map()) {
      chron.set(path, String(text).replace(new RegExp(ANCHOR.source + '\\n?', 'gm'), (all, a, ids, b) => {
        const kept = anchorIds(ids).map(to).filter(Boolean);
        return kept.length ? `${a} ${kept.join('; ')} ${b}${all.endsWith('\n') ? '\n' : ''}` : '';
      }));
    }
    return { cfg: c, documents: docs, chronicles: chron };
  }

  function placeStrings(tree) {
    const out = new Set();
    for (const p of tree.people.values()) for (const ev of p.events) if (ev.place) out.add(ev.place);
    for (const f of tree.families.values()) for (const ev of f.events) if (ev.place) out.add(ev.place);
    return out;
  }

  const deathOf = (p) => p.events.find((e) => e.type === 'DEAT') || p.events.find((e) => e.type === 'BURI') || null;
  const dateText = (ev) => (ev ? events.formatDate(ev.date, 'en') : '');

  // What the new file changes: people added and gone, birth and death dates, new places, and the
  // paired people who now count as living or deceased (`cfg` with the new ids).
  function changes(oldTree, newTree, pairs, cfg, today) {
    const paired = new Set(pairs.values());
    const added = [...newTree.people.keys()].filter((id) => !paired.has(id)).sort(idCmp);
    const removed = [...oldTree.people.keys()].filter((id) => !pairs.has(id)).sort(idCmp);
    const dates = [], nowLiving = [], nowDeceased = [];
    const years = 'living_years' in cfg ? cfg.living_years : scope.LIVING_YEARS;
    const extraLiving = new Set(cfg.living_extra || []), extraDead = new Set(cfg.deceased_extra || []);
    const alive = (p, id) => (extraDead.has(id) ? false : extraLiving.has(id) ? true : scope.isLiving(p, today, years));
    const order = [...pairs].sort((a, b) => idCmp(a[1], b[1]));
    for (const [o, n] of order) {
      const a = oldTree.people.get(o), b = newTree.people.get(n);
      for (const [kind, get] of [['birth', (p) => p.birth], ['death', deathOf]]) {
        const before = dateText(get(a)), after = dateText(get(b));
        if (before !== after) dates.push({ id: n, kind, before, after });
      }
      const was = alive(a, n), is = alive(b, n);
      if (was && !is) nowDeceased.push(n);
      if (!was && is) nowLiving.push(n);
    }
    const oldPlaces = placeStrings(oldTree);
    const places = [...placeStrings(newTree)].filter((x) => !oldPlaces.has(x)).sort();
    return { added, removed, dates, places, nowLiving, nowDeceased };
  }

  const api = { usedIds, pair, remap, changes, MAX_CANDIDATES };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).match = api;
})(typeof window !== 'undefined' ? window : globalThis);
