// Step 2: the starting person. Search by name (no ids in the UI); the card shows the parents so
// that two people of the same name can be told apart. Suggested: the most ancestors, no children.
(function (g) {
  'use strict';

  const FCApp = g.FCApp;
  const { h, clear } = FCApp.dom;
  const t = FCApp.t;
  const P = () => g.FCEngine.project;

  const initials = (label) => label.split(/\s+/).filter(Boolean).map((x) => x[0]).slice(0, 2).join('').toUpperCase() || '?';

  function card(info, chosen, onpick) {
    return h('li', {}, h('button', { type: 'button', class: 'person', 'aria-pressed': chosen ? 'true' : 'false', onclick: onpick },
      h('span', { class: 'monogram', 'aria-hidden': 'true' }, initials(info.label)),
      h('span', {},
        h('span', { class: 'person-name' }, info.label || '–'), info.years ? ` · ${info.years}` : '',
        info.parents ? h('span', { class: 'person-sub' }, info.parents) : null)));
  }

  FCApp.steps[2] = {
    render(el, w) {
      const s = w.state;
      const suggested = P().suggestRoot(s.tree);
      if (!s.cfg.root || !s.tree.people.has(s.cfg.root)) { s.cfg.root = suggested; w.changed(); }
      const list = h('ul', { class: 'people', id: 'people' });
      const pick = (id) => { s.cfg.root = id; w.changed(); show(search.value); };
      const show = (q) => {
        clear(list);
        const locale = w.locale();
        const found = q.trim() ? P().searchPeople(s.tree, q, 8, locale) : [P().personInfo(s.tree, s.cfg.root, locale)];
        if (!found.length) list.appendChild(h('li', { class: 'note' }, t('root_none')));
        for (const info of found) list.appendChild(card(info, info.id === s.cfg.root, () => pick(info.id)));
        if (!q.trim() && s.cfg.root === suggested) list.appendChild(h('li', { class: 'note' }, t('root_suggested')));
      };
      const search = h('input', { type: 'search', class: 'search', id: 'root-search', placeholder: t('root_search'), 'aria-label': t('root_search'), oninput: (e) => show(e.target.value) });
      el.append(h('h1', {}, t('root_title')), h('p', { class: 'lead' }, t('root_lead')), search, list);
      show('');
    },
    check: (w) => (w.state.cfg.root ? null : t('root_none')),
  };
})(window);
