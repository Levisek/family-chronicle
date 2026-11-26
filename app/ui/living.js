// Step 5: who counts as living. The rule (100 years, never fewer) and the counts; people without a
// birth date whom their relatives show to be long dead count as deceased (scope.inferDeceased, at
// every build; listed here, "alive" goes to living_extra); the rest are asked about in a table;
// an optional town for the living, one per household, picked from the places of the family
// (living_town). The check of the output cannot be switched off.
(function (g) {
  'use strict';

  const FCApp = g.FCApp;
  const { h } = FCApp.dom;
  const t = FCApp.t;
  const E = () => g.FCEngine;
  const P = () => g.FCEngine.project;
  const FREQUENT = 12;

  // Living people who live together: a couple and their children without a family of their own.
  function households(tree, living) {
    const parent = new Map([...living].map((id) => [id, id]));
    const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
    const join = (a, b) => { if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b)); };
    for (const f of tree.families.values()) {
      const adults = [f.husband, f.wife].filter((x) => x && living.has(x));
      if (adults.length === 2) join(adults[0], adults[1]);
      for (const c of f.children) {
        const own = (tree.people.get(c) || { families: [] }).families.length;
        if (!own && adults.length) join(c, adults[0]);
      }
    }
    const out = new Map();
    for (const id of living) { const r = find(id); if (!out.has(r)) out.set(r, []); out.get(r).push(id); }
    return [...out.values()];
  }

  // The towns of the places file, the most frequent in the last generations (the living and their
  // parents) first.
  function townChoices(s, living) {
    const known = new (E().places.Places)(s.places || {}, s.cfg.ignore_places || []);
    const count = new Map();
    const people = new Set(living);
    for (const id of living) for (const p of s.tree.parents(id)) people.add(p);
    for (const id of people) {
      const p = s.tree.people.get(id);
      for (const e of (p && p.events) || []) {
        const town = e.place && known.town(e.place);
        if (town) count.set(town, (count.get(town) || 0) + 1);
      }
    }
    const all = Object.keys(s.places || {}).filter((k) => s.places[k] && s.places[k].coords).sort((a, b) => a.localeCompare(b, FCApp.lang));
    const frequent = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], FCApp.lang)).slice(0, FREQUENT).map(([k]) => k);
    return { frequent, rest: all.filter((k) => !frequent.includes(k)) };
  }

  FCApp.steps[5] = {
    render(el, w) {
      const s = w.state, cfg = s.cfg;
      const today = new Date();
      const years = Math.max(cfg.living_years || 100, 100);
      const locale = w.locale();
      const info = (id) => P().personInfo(s.tree, id, locale);
      const nameOf = (id) => { const i = info(id); return (i && i.label) || '–'; };
      let scope = null;
      try { scope = E().scope.determineScope(s.tree, cfg, today); } catch (e) { /* no root yet */ }
      const relation = (id) => {
        try { if (scope && scope.people.has(id)) return E().relationship.relationship(scope, id, FCApp.lang === 'cs' ? 'cs' : 'en'); } catch (e) { /* not related */ }
        const i = info(id);
        return (i && i.parents) || '';
      };

      // long dead by their relatives: decided by the build every time (nothing stored that could go
      // stale), listed here; "alive" is remembered in living_extra
      const inferred = P().inferDeceased(s.tree, cfg, today);
      const wouldInfer = P().inferDeceased(s.tree, { ...cfg, living_extra: [] }, today);
      const dead = new Set(cfg.deceased_extra || []);
      const setDead = (id, on) => {
        if (on) dead.add(id); else dead.delete(id);
        if (dead.size) cfg.deceased_extra = [...dead]; else delete cfg.deceased_extra;
        const alive = new Set(cfg.living_extra || []);
        if (!on && wouldInfer.has(id)) alive.add(id); else alive.delete(id);
        if (alive.size) cfg.living_extra = [...alive]; else delete cfg.living_extra;
        w.changed();
        w.rerender();
      };

      const sum = P().livingSummary(s.tree, cfg, today);
      const noBirth = new Set(sum.noBirthDate);
      el.append(h('h1', {}, t('living_title')),
        h('p', { class: 'lead' }, t('living_lead', { years })),
        h('table', { class: 'living-table' }, h('tbody', {},
          h('tr', {}, h('td', {}, t('living_count')), h('td', { id: 'living-count' }, sum.living.length)),
          h('tr', {}, h('td', {}, t('deceased_count')), h('td', {}, sum.deceased.length)))));

      const why = (b) => (b.via === 'child' ? t('living_why_child', { name: nameOf(b.of), year: b.year })
        : b.via === 'parent' ? t('living_why_parent', { name: nameOf(b.of), year: b.year }) : t('living_why_event', { year: b.year }));
      const marked = [...inferred].filter(([id]) => !dead.has(id));
      if (marked.length) {
        el.appendChild(h('details', { class: 'living-group', id: 'living-inferred' },
          h('summary', {}, t('living_inferred_title', { n: marked.length })),
          h('p', { class: 'note' }, t('living_inferred_note', { years })),
          h('table', { class: 'people-table' }, h('tbody', {}, marked.map(([id, b]) => h('tr', {},
            h('td', {}, nameOf(id)), h('td', { class: 'note' }, relation(id)), h('td', { class: 'note' }, why(b)),
            h('td', {}, h('button', { type: 'button', class: 'link', 'data-alive': id, onclick: () => setDead(id, false) }, t('living_alive')))))))));
      }

      // the rest: nobody knows; living until marked (people marked by hand stay, to be taken back)
      const unknown = [...new Set([...sum.noBirthDate, ...[...dead].filter((id) => !inferred.has(id) && s.tree.people.has(id) && !s.tree.people.get(id).hasDeath)])];
      if (unknown.length) {
        el.append(h('h2', {}, t('living_unknown_title', { n: unknown.length })),
          h('p', { class: 'note' }, t('living_unknown_note')),
          h('table', { class: 'people-table', id: 'living-unknown' }, h('tbody', {}, unknown.map((id) => h('tr', {},
            h('td', {}, nameOf(id)), h('td', { class: 'note' }, relation(id)),
            h('td', {}, h('label', {}, h('input', { type: 'checkbox', 'data-dead': id, checked: dead.has(id), onchange: (e) => setDead(id, e.target.checked) }), ' ', t('living_mark_dead'))))))));
      }

      // towns: one per household, from the places of the family
      const living = new Set(sum.living.filter((id) => !noBirth.has(id)));
      if (living.size) {
        const { frequent, rest } = townChoices(s, living);
        const towns = cfg.living_town || {};
        const setTown = (ids, town) => {
          cfg.living_town = { ...(cfg.living_town || {}) };
          for (const id of ids) { if (town) cfg.living_town[id] = town; else delete cfg.living_town[id]; }
          if (!Object.keys(cfg.living_town).length) delete cfg.living_town;
          w.changed();
        };
        const rows = households(s.tree, living).map((ids) => {
          const now = new Set(ids.map((id) => towns[id] || ''));
          const value = now.size === 1 ? [...now][0] : '';
          const option = (k) => h('option', { value: k, selected: k === value }, k);
          const other = value && !frequent.includes(value) && !rest.includes(value) ? [option(value)] : [];   // typed by hand earlier
          const select = h('select', { 'aria-label': `${t('living_town')}: ${ids.map(nameOf).join(', ')}`, onchange: (e) => setTown(ids, e.target.value) },
            h('option', { value: '' }, t('living_town_none')), ...other,
            frequent.length ? h('optgroup', { label: t('living_town_frequent') }, frequent.map(option)) : null,
            rest.length ? h('optgroup', { label: t('living_town_all') }, rest.map(option)) : null);
          return h('tr', {}, h('td', {}, ids.map((id) => { const i = info(id); return [i ? i.label : id, i && i.years ? h('span', { class: 'note' }, ` ${i.years}`) : null]; })
            .reduce((a, x, i) => (i ? [...a, h('br'), ...x] : x), [])), h('td', {}, select));
        });
        el.appendChild(h('details', { class: 'living-group', id: 'living-towns', open: !!Object.keys(towns).length },
          h('summary', {}, t('living_towns_title', { n: living.size })),
          h('p', { class: 'note' }, t('living_towns_note')),
          h('table', { class: 'people-table' }, h('tbody', {}, rows))));
      }
      el.appendChild(h('p', { class: 'note' }, t('living_check')));
    },
  };
})(window);
