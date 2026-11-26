// Step 3: branches, suggested by the four grandparents; rename per website language, colour from
// the palette, join two. The pedigree on the right shows the colours at once.
(function (g) {
  'use strict';

  const FCApp = g.FCApp;
  const { h } = FCApp.dom;
  const t = FCApp.t;
  const P = () => g.FCEngine.project;

  const personName = (tree, id) => { const p = tree.people.get(id); return p ? [p.given, p.surname].filter(Boolean).join(' ') : ''; };

  FCApp.steps[3] = {
    wide: true,
    render(el, w) {
      const s = w.state, cfg = s.cfg;
      if (s.branchesFor !== cfg.root) {
        cfg.branches = P().suggestBranches(s.tree, cfg.root, cfg.languages);
        s.branchesFor = cfg.root;
      }
      const locales = FCApp.data.assets().locales;
      const update = (branches) => { cfg.branches = branches; w.changed(); w.rerender(); };
      const rootName = personName(s.tree, cfg.root);
      const list = h('ul', { class: 'branch-list', id: 'branches' }, cfg.branches.map((b) => h('li', { class: 'branch' },
        h('div', { class: 'branch-head' }, h('span', { class: 'swatch', style: { background: b.color } }),
          h('span', { class: 'person-sub' }, t('branch_roots', { names: b.roots.map((r) => personName(s.tree, r)).join(', ') }))),
        cfg.languages.map((lang) => h('label', { class: 'field' }, t('branch_name', { lang: (locales[lang] && locales[lang].language_name) || lang }),
          h('input', { type: 'text', value: b.name[lang] ?? '', onchange: (e) => update(P().renameBranch(cfg.branches, b.key, lang, e.target.value)) }))),
        h('div', { class: 'field' }, t('branch_color'), ' ', h('span', { class: 'palette' }, P().PALETTE.map((c) => h('button', {
          type: 'button', 'aria-label': c, 'aria-pressed': c === b.color ? 'true' : 'false', style: { background: c },
          onclick: () => update(P().recolorBranch(cfg.branches, b.key, c)),
        })))),
        cfg.branches.length > 1 ? h('label', { class: 'field' }, t('branch_merge'), ' ', h('select', {
          onchange: (e) => e.target.value && update(P().mergeBranches(cfg.branches, b.key, e.target.value, locales)),
        }, h('option', { value: '' }, '–'), cfg.branches.filter((x) => x !== b).map((x) => h('option', { value: x.key }, x.name[cfg.default_language] || x.key)))) : null)));
      el.append(h('h1', {}, t('branches_title')),
        h('p', { class: 'lead' }, cfg.branches.length ? t('branches_lead', { name: rootName }) : t('branches_none', { name: rootName })),
        h('div', { class: 'branch-layout' }, list,
          h('figure', {}, FCApp.pedigree(s.tree, cfg.root, cfg.branches), h('figcaption', { class: 'note' }, t('pedigree_label')))));
    },
  };
})(window);
