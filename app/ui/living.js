// Step 5: who counts as living. The rule (100 years, never fewer), the counts, people without a
// birth date (treated as living, can be marked deceased: deceased_extra), an optional town for the
// living (living_town). The check of the output cannot be switched off.
(function (g) {
  'use strict';

  const FCApp = g.FCApp;
  const { h } = FCApp.dom;
  const t = FCApp.t;
  const P = () => g.FCEngine.project;

  FCApp.steps[5] = {
    render(el, w) {
      const s = w.state, cfg = s.cfg;
      const years = Math.max(cfg.living_years || 100, 100);
      const sum = P().livingSummary(s.tree, cfg, new Date());
      const noBirth = new Set(sum.noBirthDate);
      const locale = w.locale();
      const label = (id) => { const i = P().personInfo(s.tree, id, locale); return i ? [i.label || '–', i.years].filter(Boolean).join(' · ') : '–'; };
      const dead = new Set(cfg.deceased_extra || []);
      const toggleDead = (id, on) => {
        if (on) dead.add(id); else dead.delete(id);
        cfg.deceased_extra = [...dead];
        w.changed();
        w.rerender();
      };
      const setTown = (id, town) => {
        cfg.living_town = { ...(cfg.living_town || {}) };
        if (town.trim()) cfg.living_town[id] = town.trim(); else delete cfg.living_town[id];
        w.changed();
      };
      // people marked deceased stay in the list so the mark can be taken back
      const undecided = [...new Set([...sum.noBirthDate, ...[...dead].filter((id) => s.tree.people.has(id) && !s.tree.people.get(id).hasDeath)])];
      el.append(h('h1', {}, t('living_title')),
        h('p', { class: 'lead' }, t('living_lead', { years })),
        h('table', { class: 'living-table' }, h('tbody', {},
          h('tr', {}, h('td', {}, t('living_count')), h('td', { id: 'living-count' }, sum.living.length)),
          h('tr', {}, h('td', {}, t('deceased_count')), h('td', {}, sum.deceased.length)),
          h('tr', {}, h('td', {}, t('living_no_birth')), h('td', {}, sum.noBirthDate.length)))));
      if (undecided.length) {
        el.append(h('h2', {}, t('living_no_birth')), h('ul', { class: 'living-people' }, undecided.map((id) => h('li', {},
          h('span', {}, label(id)),
          h('label', {}, h('input', { type: 'checkbox', checked: dead.has(id), onchange: (e) => toggleDead(id, e.target.checked) }), ' ', t('living_mark_dead'))))));
      }
      const living = sum.living.filter((id) => !noBirth.has(id));
      if (living.length) {
        el.append(h('h2', {}, t('living_list')), h('ul', { class: 'living-people' }, living.map((id) => h('li', {},
          h('span', {}, label(id)),
          h('input', { type: 'text', placeholder: t('living_town'), 'aria-label': `${t('living_town')}: ${label(id)}`, value: (cfg.living_town || {})[id] || '', onchange: (e) => setTown(id, e.target.value) })))));
      }
      el.appendChild(h('p', { class: 'note' }, t('living_check')));
    },
  };
})(window);
