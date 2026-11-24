// View from a chosen person: recomputes from the published people (counted from the root) the
// ahnentafel numbers, siblings, descendants, partners and relationships to the chosen person. It adds nothing new,
// only rearranges what is already on the site. The choice is remembered only in this browser (localStorage).
// The scope rules and relationship words follow familychronicle/relationship.py; descendants of the root are added here.
(function (g) {
  'use strict';
  const { D, T, el, monogram } = g.Chronicle;
  const STORAGE_KEY = 'chronicle.from';

  // ---------- choice ----------
  const saved = () => { try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; } };
  function persist(id) { try { localStorage.setItem(STORAGE_KEY, id); } catch (e) { /* private window: only for this page */ } }
  const root = (all) => Object.keys(all).find((id) => all[id].ahnentafel === 1);

  // chosen person: ?from= / #from= in the address, then the saved choice, otherwise the root
  function from(all) {
    const p = new URLSearchParams(location.search.slice(1) + '&' + location.hash.slice(1));
    for (const id of [p.get('from'), saved()]) if (id && Object.hasOwn(all, id)) return id;
    return root(all);
  }
  const firstVisit = () => saved() == null && !/(^|[?&#])from=/.test(location.search + location.hash);

  function setFrom(id) {
    persist(id);
    const u = new URL(location.href);
    u.searchParams.delete('from');
    u.hash = '';
    location.assign(u.toString());
  }

  // ---------- recomputation ----------
  // scope from the chosen person: ahnentafel numbers, siblings, descendants, partners (context for the relationship words)
  function context(all, R) {
    const ids = Object.keys(all);
    const children = {};
    for (const id of ids) for (const r of all[id].parents || []) if (all[r]) (children[r] = children[r] || []).push(id);
    const sex = (id) => all[id].sex || (all[id].ahnentafel != null ? (all[id].ahnentafel % 2 ? 'F' : 'M') : '');
    const parents = (id) => (all[id].parents || []).filter((r) => all[r]);

    // ahnentafel numbers (when the tree collapses the lowest wins)
    const anc = { [R]: 1 }, queue = [R];
    while (queue.length) {
      const x = queue.shift(), n = anc[x];
      let pars = parents(x);
      if (pars.length === 2 && (sex(pars[0]) === 'F' || sex(pars[1]) === 'M')) pars = [pars[1], pars[0]];
      pars.forEach((r, i) => {
        const k = pars.length === 2 ? 2 * n + i : 2 * n + (sex(r) === 'F' ? 1 : 0);
        if (!(r in anc) || k < anc[r]) { anc[r] = k; queue.push(r); }
      });
    }
    const byNumber = {};
    for (const [id, n] of Object.entries(anc)) byNumber[n] = id;
    const ancestors = Object.keys(anc).sort((a, b) => anc[a] - anc[b]);

    // siblings of ancestors: same parents, or (without parents in the data) siblings by the original data
    const parentsKey = (id) => parents(id).slice().sort().join('|');
    const siblingOf = {}, halfSet = new Set();
    for (const p of ancestors) {
      const pkey = parentsKey(p), group = new Set();
      if (pkey) for (const s of ids) if (s !== p && parentsKey(s) === pkey) group.add(s);
      const q = all[p].sibling_of;
      for (const s of ids) {
        const o = all[s];
        if (o.half_sibling) continue;
        if (o.sibling_of === p || (q && !all[p].half_sibling && (s === q || (o.sibling_of === q && s !== p)))) group.add(s);
      }
      for (const s of group) if (!(s in anc) && !(s in siblingOf)) siblingOf[s] = p;
    }
    // half-siblings: children of the ancestor from a different union than the one their line child comes from
    for (const p of ancestors) {
      const n = anc[p], child = byNumber[n >> 1];
      if (n < 2 || !child) continue;
      const childKey = parentsKey(child);
      for (const s of children[p] || []) {
        if (s in anc || s in siblingOf || parentsKey(s) === childKey) continue;
        siblingOf[s] = child; halfSet.add(s);
      }
    }

    // descendants of siblings (all generations) and descendants of the chosen person
    const descS = {}, parentOfDesc = {}, descR = {};
    const inScope = (x) => x in anc || x in siblingOf || x in descS || x in descR;
    const f1 = Object.keys(siblingOf).sort().flatMap((s) => (children[s] || []).map((d) => [d, s, 1, s]));
    while (f1.length) {
      const [x, s, h, pars] = f1.shift();
      if (inScope(x)) continue;
      descS[x] = [s, h]; parentOfDesc[x] = pars;
      for (const d of children[x] || []) f1.push([d, s, h + 1, x]);
    }
    const f2 = (children[R] || []).map((d) => [d, 1, R]);
    while (f2.length) {
      const [x, h, pars] = f2.shift();
      if (inScope(x)) continue;
      descR[x] = h; parentOfDesc[x] = pars;
      for (const d of children[x] || []) f2.push([d, h + 1, x]);
    }

    // partners of blood relatives (spouses, the other parents of their children)
    const blood = new Set([...Object.keys(anc), ...Object.keys(siblingOf), ...Object.keys(descS), ...Object.keys(descR)]);
    const spouseOf = {}, union = {};
    const order = [...blood].sort((a, b) => (anc[a] || 1e9) - (anc[b] || 1e9) || (a < b ? -1 : 1));
    for (const a of order) {
      const candidates = new Set(Object.keys(all[a].partners || {}));
      for (const d of children[a] || []) for (const r of parents(d)) if (r !== a) candidates.add(r);
      for (const m of candidates) {
        if (!all[m] || blood.has(m) || m in spouseOf) continue;
        spouseOf[m] = a;
        union[m] = (all[a].partners || {})[m] || (all[m].partners || {})[a] || 'spouse';
      }
    }

    return { R, all, sex, anc, siblingOf, halfSet, descS, descR, parentOfDesc, spouseOf, union, blood, isRoot: all[R].ahnentafel === 1 };
  }

  // people rearranged from the chosen person (fan: ancestors and descendants of the chosen person)
  function recompute(all, R) {
    const ctx = context(all, R);
    const { anc, siblingOf, halfSet, spouseOf, union, blood } = ctx;
    const parents = (id) => (all[id].parents || []).filter((r) => all[r]);
    const out = {};
    for (const id of [...blood, ...Object.keys(spouseOf)]) {
      const o = { ...all[id] };
      for (const k of ['ahnentafel', 'sibling_of', 'half_sibling', 'spouse_of', 'divorced', 'partnership']) delete o[k];
      o.ahnentafel = anc[id] != null ? anc[id] : null;
      o.parents = parents(id).filter((r) => blood.has(r) || r in spouseOf);
      if (id in siblingOf) { o.sibling_of = siblingOf[id]; if (halfSet.has(id)) o.half_sibling = true; }
      if (id in spouseOf) {
        o.spouse_of = spouseOf[id];
        o.divorced = union[id] === 'divorced';
        if (union[id] === 'partner') o.partnership = true;
      }
      o.relationship = ctx.isRoot ? all[id].relationship : relationship(ctx, id, D.language);
      out[id] = o;
    }
    return out;
  }

  // the whole tree with the layout unchanged, only the relationships to the chosen person (everybody sees everything);
  // who is not a relative of the chosen person but of their partner gets "father of the husband" and the like.
  function relabel(all, R) {
    if (all[R].ahnentafel === 1) return all;
    const ctx = context(all, R);
    const partners = Object.keys(ctx.spouseOf).filter((m) => ctx.spouseOf[m] === R);
    const ctxP = partners.map((m) => context(all, m));
    const out = {};
    for (const [id, o] of Object.entries(all)) {
      let v = '';
      if (ctx.blood.has(id) || id in ctx.spouseOf) v = relationship(ctx, id, D.language);
      else {
        const c = ctxP.find((k) => k.blood.has(id));
        if (c) {
          const f = ctx.sex(c.R) === 'F';
          const base = bloodRelation(c, id, D.language, false);
          v = D.language === 'cs' ? `${base} ${f ? 'man\u017eelky' : 'man\u017eela'}` : `${f ? 'wife' : 'husband'}'s ${base}`;
        }
      }
      out[id] = { ...o, relationship: v };
    }
    return out;
  }

  // ---------- relationship words (as in relationship.py: English, and Czech for the cs locale) ----------
  // Czech words are written with \u escapes by the converter, so this source stays ASCII.
  const CS = { M: ['otec', 'dědeček', 'pradědeček', 'prapradědeček'], F: ['matka', 'babička', 'prababička', 'praprababička'] };
  const CS_GEN = { M: ['otce', 'dědečka', 'pradědečka', 'prapradědečka'], F: ['matky', 'babičky', 'prababičky', 'praprababičky'] };
  const EN = { M: ['father', 'grandfather', 'great-grandfather'], F: ['mother', 'grandmother', 'great-grandmother'] };
  const generation = (n) => Math.floor(Math.log2(n));

  // ancestor of generation g (1 = parent); genitive = "of ..." form (Czech only)
  function ancestorWord(g, male, cs, genitive) {
    const k = male ? 'M' : 'F';
    if (cs) {
      if (g <= 4) return (genitive ? CS_GEN : CS)[k][g - 1];
      const base = genitive ? (male ? 'pradědečka' : 'prababičky') : (male ? 'pradědeček' : 'prababička');
      return `${g - 2}× ${base}`;
    }
    return g <= 3 ? EN[k][g - 1] : `${g - 2}× ${EN[k][2]}`;
  }

  function descendantWord(d, pick, cs, genitive) {
    if (cs) {
      const t = genitive
        ? [['syna', 'dcery', 'd\u00edt\u011bte'], ['vnuka', 'vnu\u010dky', 'vnou\u010dete'], ['pravnuka', 'pravnu\u010dky', 'pravnou\u010dete'], ['prapravnuka', 'prapravnu\u010dky', 'prapravnou\u010dete']]
        : [['syn', 'dcera', 'd\u00edt\u011b'], ['vnuk', 'vnu\u010dka', 'vnou\u010de'], ['pravnuk', 'pravnu\u010dka', 'pravnou\u010de'], ['prapravnuk', 'prapravnu\u010dka', 'prapravnou\u010de']];
      if (d <= 4) return pick(...t[d - 1]);
      return `${d - 2}× ${pick(...t[2])}`;
    }
    const t = [['son', 'daughter', 'child'], ['grandson', 'granddaughter', 'grandchild'], ['great-grandson', 'great-granddaughter', 'great-grandchild']];
    return d <= 3 ? pick(...t[d - 1]) : `${d - 2}× ${pick(...t[2])}`;
  }

  // blood relationship of person `id` to the starting person c.R
  function bloodRelation(c, id, language, genitive) {
    const cs = language === 'cs', p = c.sex(id);
    const pick = (m, f, n) => (p === 'M' ? m : p === 'F' ? f : n);
    const sibling = () => (cs ? (genitive ? pick('bratra', 'sestry', 'sourozence') : pick('bratr', 'sestra', 'sourozenec')) : pick('brother', 'sister', 'sibling'));
    if (id === c.R) return cs ? (genitive ? 'v\u00fdchoz\u00ed osoby' : 'v\u00fdchoz\u00ed osoba') : 'starting person';
    if (id in c.anc) { const n = c.anc[id]; return ancestorWord(generation(n), n % 2 === 0, cs, genitive); }
    if (id in c.descR) return descendantWord(c.descR[id], pick, cs, genitive);
    if (id in c.siblingOf) {
      const a = c.siblingOf[id], half = c.halfSet.has(id);
      if (a === c.R) return (half ? (cs ? 'nevlastn\u00ed ' : 'half-') : '') + sibling();
      const n = c.anc[a];
      if (cs) {
        const prefix = half ? (genitive && p !== 'F' ? 'nevlastn\u00edho ' : 'nevlastn\u00ed ') : '';
        return `${prefix}${sibling()} ${ancestorWord(generation(n), n % 2 === 0, true, true)}`;
      }
      return `${half ? 'half-' : ''}${sibling()} of ${ancestorWord(generation(n), n % 2 === 0, false)}`;
    }
    if (!(id in c.descS)) return '';
    const [s, d] = c.descS[id];
    const a = c.siblingOf[s], n = c.anc[a], gg = generation(n);
    if (gg === 0) {   // descendants of a sibling of the chosen person
      if (cs) {
        const z = genitive ? pick('synovce', 'nete\u0159e', 'potomka sourozence') : pick('synovec', 'nete\u0159', 'potomek sourozence');
        if (d === 1) return z;
        const great = d <= 3 ? 'pra'.repeat(d - 1) : `${d - 1}× pra`;
        return p ? great + z : z;
      }
      const z = pick('nephew', 'niece', "sibling's descendant");
      return d === 1 ? z : (p ? 'great-'.repeat(d - 2) + 'grand' + z : z);
    }
    const k = Math.min(gg, d), r = gg - d;
    const parentAfter = (x, steps) => { for (let i = 0; i < steps; i++) x = c.parentOfDesc[x] || x; return x; };
    if (cs) {
      const ordinal = ['', '', 'druh', 't\u0159et', '\u010dtvrt'];
      let cm, cf;
      if (k === 1) [cm, cf] = genitive ? ['bratrance', 'sest\u0159enice'] : ['bratranec', 'sest\u0159enice'];
      else if (k < ordinal.length) [cm, cf] = genitive ? [`${ordinal[k]}\u00e9ho bratrance`, `${ordinal[k]}\u00e9 sest\u0159enice`] : [`${ordinal[k]}\u00fd bratranec`, `${ordinal[k]}\u00e1 sest\u0159enice`];
      else [cm, cf] = genitive ? [`${k}. bratrance`, `${k}. sest\u0159enice`] : [`${k}. bratranec`, `${k}. sest\u0159enice`];
      if (r >= 0) {
        const z = pick(cm, cf, cm);
        return r === 0 ? z : `${z} ${ancestorWord(r, (n >> (gg - r)) % 2 === 0, true, true)}`;
      }
      const rm = c.sex(parentAfter(id, -r)) === 'F';
      const triple = { 1: genitive ? ['syna', 'dcery', 'd\u00edt\u011bte'] : ['syn', 'dcera', 'd\u00edt\u011b'], 2: genitive ? ['vnuka', 'vnu\u010dky', 'vnou\u010dete'] : ['vnuk', 'vnu\u010dka', 'vnou\u010de'] }[-r]
        || (genitive ? ['potomka', 'potomka', 'potomka'] : ['potomek', 'potomek', 'potomek']);
      const cousin = k === 1 ? (rm ? 'sest\u0159enice' : 'bratrance')
        : k < ordinal.length ? (rm ? `${ordinal[k]}\u00e9 sest\u0159enice` : `${ordinal[k]}\u00e9ho bratrance`) : (rm ? `${k}. sest\u0159enice` : `${k}. bratrance`);
      return `${pick(...triple)} ${cousin}`;
    }
    const z = `${({ 1: 'first', 2: 'second', 3: 'third' })[k] || k + 'th'} cousin`;
    if (r === 0) return z;
    if (r > 0) return `${z} of ${ancestorWord(r, (n >> (gg - r)) % 2 === 0, false)}`;
    const who = { 1: ['son', 'daughter', 'child'], 2: ['grandson', 'granddaughter', 'grandchild'] }[-r] || ['descendant', 'descendant', 'descendant'];
    return `${pick(...who)} of ${z}`;
  }

  function relationship(c, id, language) {
    if (!(id in c.spouseOf)) return bloodRelation(c, id, language, false);
    const a = c.spouseOf[id], f = c.sex(id) === 'F', kind = c.union[id];
    let word;
    if (language === 'cs') {
      word = kind === 'partner' ? (f ? 'p\u0159\u00edtelkyn\u011b' : 'p\u0159\u00edtel') : (f ? 'man\u017eelka' : 'man\u017eel');
      if (kind === 'divorced') word = (f ? 'b\u00fdval\u00e1 ' : 'b\u00fdval\u00fd ') + word;
      return a === c.R ? word : `${word} ${bloodRelation(c, a, 'cs', true)}`;
    }
    word = kind === 'partner' ? 'partner' : (f ? 'wife' : 'husband');
    if (kind === 'divorced') word = 'former ' + word;
    return a === c.R ? word : `${word} of ${bloodRelation(c, a, 'en', false)}`;
  }

  // ---------- person picker (dialog) ----------
  const stripDiacritics = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const relationshipText = (o) => o.relationship || '';
  const year = (o) => { const m = /(\d{4})/.exec((o.birth && o.birth.date) || ''); return m ? +m[1] : null; };

  // all = the original people (relationships from the root so that the list is understandable); first = the initial "Who are you?"
  function dialog(all, first) {
    const current = from(all), rootId = root(all);
    const d = el('dialog', { class: 'view-dialog', 'aria-labelledby': 'view-heading' });
    const inp = el('input', { type: 'search', placeholder: T.view_search, 'aria-label': T.view_search, autocomplete: 'off' });
    const ul = el('ul', { class: 'view-list', 'aria-label': T.view_list });
    const sortedIds = Object.keys(all).sort((a, b) => {
      const A = all[a], B = all[b];
      return (A.ahnentafel == null) - (B.ahnentafel == null) || (A.ahnentafel || 0) - (B.ahnentafel || 0) || A.name.localeCompare(B.name, D.language);
    });
    const closeDialog = () => { d.close(); d.remove(); };
    const choose = (id) => { if (first || id !== current) setFrom(id); else closeDialog(); };
    function renderList() {
      const q = stripDiacritics(inp.value.trim());
      ul.replaceChildren(...sortedIds.filter((id) => !q || stripDiacritics(all[id].name).includes(q)).map((id) => {
        const o = all[id];
        const b = el('button', { type: 'button', 'aria-current': id === current ? 'true' : null, onclick: () => choose(id) },
          el('span', { class: 'badge mini', 'aria-hidden': 'true', text: monogram(o.name) }),
          el('span', null, o.name, el('small', { text: [relationshipText(o), o.living ? '' : year(o)].filter(Boolean).join(' · ') })));
        if (id === current) b.classList.add('current');
        return el('li', null, b);
      }));
    }
    inp.addEventListener('input', renderList);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const b = ul.querySelector('button'); if (b) b.click(); }
    });
    d.append(
      el('h2', { id: 'view-heading', text: first ? T.view_who : T.view_choose }),
      el('p', { class: 'view-help', text: T.view_help }),
      inp, ul,
      el('div', { class: 'view-actions' },
        el('button', { type: 'button', class: 'main', onclick: () => (first || current !== rootId ? setFrom(rootId) : closeDialog()) }, first ? T.view_just_looking : T.view_back_to_root),
        first ? null : el('button', { type: 'button', onclick: closeDialog }, T.view_close)));
    d.addEventListener('cancel', (e) => { if (first) { e.preventDefault(); setFrom(rootId); } else { e.preventDefault(); closeDialog(); } });
    document.body.append(d);
    renderList();
    d.showModal();
    inp.focus();
  }

  // the "From whom: ..." button in the page bar
  function viewButton(all, bar) {
    const id = from(all);
    const b = el('button', { type: 'button', class: 'view-btn', title: T.view_title, onclick: () => dialog(all, false) },
      el('small', { text: T.view_from }), el('span', { text: all[id].name }), el('span', { 'aria-hidden': 'true', class: 'arrow', text: '▾' }));
    bar.append(b);
    return b;
  }

  // shared beginning of the tree/fan pages: returns the people recomputed from the chosen person
  // whole = tree: layout from the root, only the relationships to the chosen person; otherwise (fan) rearranged from them
  function prepare(all, bar, whole) {
    const R = from(all);
    if (bar) viewButton(all, bar);
    if (firstVisit()) setTimeout(() => dialog(all, true), 0);
    return { people: whole ? relabel(all, R) : recompute(all, R), from: R, root: whole ? root(all) : R, isRoot: all[R].ahnentafel === 1 };
  }

  g.Chronicle.view = { from, setFrom, recompute, relabel, dialog, prepare };
})(window);
