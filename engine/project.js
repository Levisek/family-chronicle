// The suggestions of the wizard (root person, branches, living people) and a new site.json.
// Pure functions over a parsed tree (gedcom.load); the app keeps the result in memory until saved.
(function (g) {
  'use strict';

  const req = typeof require !== 'undefined';
  const M = (name) => (req ? require(`./${name}.js`) : g.FCEngine[name]);
  const scope = M('scope');
  const config = M('config');

  const PALETTE = ['#8a3b12', '#2c6e49', '#35558a', '#7a5c86', '#6b4f2a', '#3d6b73', '#9a4f6e', '#5b7f2e', '#7d7350'];

  const plain = (s) => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const idCmp = (a, b) => a.localeCompare(b, 'en', { numeric: true });
  const yearOf = (ev) => (ev && ev.date && ev.date.year != null ? ev.date.year : null);
  const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (all, k) => (k in vars ? vars[k] : all));
  const fullName = (p) => [p.given, p.surname].filter(Boolean).join(' ').trim();

  function summary(tree) {
    let yearMin = null, yearMax = null;
    const problems = { 'no-sex': [], 'bad-date': [], 'no-name': [] };
    for (const p of tree.people.values()) {
      if (p.sex !== 'M' && p.sex !== 'F') problems['no-sex'].push(p.id);
      if (!fullName(p)) problems['no-name'].push(p.id);
      let bad = false;
      for (const ev of p.events) {
        const y = yearOf(ev);
        if (y !== null) { yearMin = yearMin === null ? y : Math.min(yearMin, y); yearMax = yearMax === null ? y : Math.max(yearMax, y); }
        else if (ev.date && ev.date.text) bad = true;
      }
      if (bad) problems['bad-date'].push(p.id);
    }
    for (const f of tree.families.values()) for (const ev of f.events) {
      const y = yearOf(ev);
      if (y !== null) { yearMin = yearMin === null ? y : Math.min(yearMin, y); yearMax = yearMax === null ? y : Math.max(yearMax, y); }
    }
    return {
      people: tree.people.size, families: tree.families.size, yearMin, yearMax,
      problems: Object.entries(problems).filter(([, ids]) => ids.length).map(([kind, ids]) => ({ kind, ids })),
    };
  }

  function ancestorCount(tree, id) {
    const seen = new Set();
    const queue = [id];
    while (queue.length) for (const p of tree.parents(queue.pop())) if (!seen.has(p)) { seen.add(p); queue.push(p); }
    return seen.size;
  }

  // Among the people without children: the one with the most ancestors; on a tie the younger, then
  // the smaller id.
  function suggestRoot(tree) {
    let best = null;
    for (const p of tree.people.values()) {
      if (tree.children(p.id).length) continue;
      const c = { id: p.id, n: ancestorCount(tree, p.id), born: yearOf(p.birth) };
      if (!best || c.n > best.n || (c.n === best.n && ((c.born ?? -Infinity) > (best.born ?? -Infinity) ||
        ((c.born ?? -Infinity) === (best.born ?? -Infinity) && idCmp(c.id, best.id) < 0)))) best = c;
    }
    return best ? best.id : (tree.people.size ? [...tree.people.keys()].sort(idCmp)[0] : null);
  }

  function lifeYears(p) {
    const b = yearOf(p.birth);
    const d = yearOf(p.events.find((e) => e.type === 'DEAT') || p.events.find((e) => e.type === 'BURI'));
    if (b === null && d === null) return '';
    return `${b ?? '?'}–${d ?? ''}`.replace(/–$/, b === null ? '' : '–').replace(/^\?–$/, '');
  }

  // People whose given names and surname start with the words of the query (no diacritics).
  // `locale` is a site locale object (roles_of, join_and) for the line about the parents.
  function searchPeople(tree, query, limit = 8, locale = {}) {
    const words = plain(query).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const out = [];
    for (const p of tree.people.values()) {
      const parts = plain(fullName(p)).split(/[\s-]+/).filter(Boolean);
      if (!words.every((w) => parts.some((x) => x.startsWith(w)))) continue;
      out.push(p);
    }
    out.sort((a, b) => fullName(a).localeCompare(fullName(b)) || idCmp(a.id, b.id));
    return out.slice(0, limit).map((p) => {
      const names = tree.parents(p.id).map((x) => fullName(tree.people.get(x))).filter(Boolean);
      let parents = '';
      if (names.length) {
        const x = names.length === 2 ? fill(locale.join_and || '{a} & {b}', { a: names[0], b: names[1] }) : names[0];
        const role = p.sex === 'F' ? 'daughter' : 'son';
        const roles = locale.roles_of || {};
        parents = roles[role] ? fill(roles[role], { x }) : x;
      }
      return { id: p.id, label: fullName(p) || p.id, years: lifeYears(p), parents };
    });
  }

  const branchKey = (s) => plain(s).replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'branch';

  // One branch for each grandparent: father's father, father's mother, mother's father, mother's mother.
  function suggestBranches(tree, root, languages) {
    const pf = (id) => { const p = tree.people.get(id); const f = p && p.parentsFamily ? tree.families.get(p.parentsFamily) : null; return f || null; };
    const exists = (id) => (id && tree.people.has(id) ? id : null);
    const f0 = pf(root);
    const grand = [];
    for (const parent of [f0 && exists(f0.husband), f0 && exists(f0.wife)]) {
      const f = parent ? pf(parent) : null;
      grand.push(f && exists(f.husband), f && exists(f.wife));
    }
    const used = new Set();
    const out = [];
    for (const id of grand) {
      if (!id) continue;
      const surname = tree.people.get(id).surname || fullName(tree.people.get(id)) || id;
      let key = branchKey(surname);
      for (let i = 2; used.has(key); i++) key = `${branchKey(surname)}-${i}`;
      used.add(key);
      out.push({ key, name: Object.fromEntries(languages.map((l) => [l, surname])), color: PALETTE[out.length % PALETTE.length], roots: [id] });
    }
    return out;
  }

  const copy = (branches) => branches.map((b) => ({ ...b, name: { ...b.name }, roots: [...b.roots] }));

  // B joins A: the roots of both, the name "A and B" in every language of A.
  function mergeBranches(branches, keyA, keyB, locales = {}) {
    const out = copy(branches);
    const a = out.find((b) => b.key === keyA), b = out.find((x) => x.key === keyB);
    if (!a || !b || a === b) return out;
    for (const r of b.roots) if (!a.roots.includes(r)) a.roots.push(r);
    for (const lang of Object.keys(a.name)) {
      const tpl = (locales[lang] && locales[lang].join_and) || '{a} & {b}';
      a.name[lang] = fill(tpl, { a: a.name[lang], b: b.name[lang] ?? '' });
    }
    return out.filter((x) => x !== b);
  }

  function renameBranch(branches, key, lang, name) {
    return copy(branches).map((b) => (b.key === key ? { ...b, name: { ...b.name, [lang]: name } } : b));
  }

  function recolorBranch(branches, key, color) {
    return copy(branches).map((b) => (b.key === key ? { ...b, color } : b));
  }

  // Who counts as living by the rules of the build (100 years, living_extra, deceased_extra).
  function livingSummary(tree, cfg, today) {
    const years = 'living_years' in cfg ? cfg.living_years : scope.LIVING_YEARS;
    const extraLiving = new Set(cfg.living_extra || []), extraDead = new Set(cfg.deceased_extra || []);
    const living = [], deceased = [], noBirthDate = [];
    for (const p of tree.people.values()) {
      let alive = scope.isLiving(p, today, years);
      if (extraLiving.has(p.id)) alive = true;
      if (extraDead.has(p.id)) alive = false;
      (alive ? living : deceased).push(p.id);
      if (alive && !p.hasDeath && yearOf(p.birth) === null) noBirthDate.push(p.id);
    }
    return { living, deceased, noBirthDate };
  }

  function newConfig({ root, branches, languages, defaultLanguage, livingExtra = [], deceasedExtra = [], livingTown = {}, siteDir = 'family', baseUrl = '', livingYears = scope.LIVING_YEARS, checkExceptions = [], basemap = true }) {
    return {
      root, gedcom: 'family.ged', base_url: baseUrl, languages: [...languages], default_language: defaultLanguage || languages[0],
      site_dir: siteDir, branches: copy(branches), places: 'places.json', ...(basemap ? { basemap: 'basemap.geojson' } : {}),
      living_years: Math.max(Number(livingYears) || 0, scope.LIVING_YEARS),
      living_extra: [...livingExtra], deceased_extra: [...deceasedExtra], living_town: { ...livingTown },
      check_exceptions: checkExceptions.map((x) => ({ ...x })),
    };
  }

  const serialize = (obj) => new TextEncoder().encode(JSON.stringify(obj, null, 2) + '\n');

  const api = { PALETTE, summary, suggestRoot, searchPeople, suggestBranches, mergeBranches, renameBranch, recolorBranch, livingSummary, newConfig, serialize, parseConfig: config.parse };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).project = api;
})(typeof window !== 'undefined' ? window : globalThis);
