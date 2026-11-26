// The wizard: 1 GEDCOM, 2 starting person, 3 branches, 4 places, 5 living people, 6 build and save.
// Its state is a site.json in memory (`w.cfg`), the places (`w.places`) and the basemap; nothing is
// written into the family folder before step 6 ("Done"). Steps are FCApp.steps[n] =
// {title, render(el, w), check(w) -> error text | null, wide?}.
(function (g) {
  'use strict';

  const FCApp = g.FCApp;
  const { h, clear } = FCApp.dom;
  const t = FCApp.t;
  const E = () => g.FCEngine;
  const dec = new TextDecoder();
  FCApp.steps = FCApp.steps || {};

  // The state survives a language switch and going back and forth; a new project starts afresh.
  let w = null;

  function readJson(project, path) {
    if (!path || !project.files.has(path)) return null;
    try { return JSON.parse(dec.decode(project.files.get(path))); } catch (e) { return null; }
  }

  function start(project) {
    const lang = FCApp.lang in FCApp.data.assets().locales ? FCApp.lang : 'en';
    const cfg = readJson(project, 'site.json') ||
      E().project.newConfig({ root: null, branches: [], languages: [lang], defaultLanguage: lang });
    const state = {
      project, cfg, step: 1, ged: null, gedName: null, tree: null, error: null,
      places: readJson(project, cfg.places || 'places.json') || {},
      basemap: null, branchesFor: cfg.root || null, placeState: null,
    };
    const gedPath = cfg.gedcom || 'family.ged';
    if (project.files.has(gedPath)) {
      state.gedName = gedPath;
      try { state.tree = E().gedcom.load(project.files.get(gedPath)); } catch (e) { state.error = e.message; }
    }
    if (state.tree && cfg.root && !state.tree.people.has(cfg.root)) cfg.root = null;
    return state;
  }

  // Files the wizard would write now (for the backup of a family that is not in a folder).
  function pending() {
    const out = new Map();
    if (!w) return out;
    if (w.ged) out.set('family.ged', w.ged);
    out.set('site.json', E().project.serialize(w.cfg));
    out.set(w.cfg.places || 'places.json', E().project.serialize(w.places));
    if (w.basemap) out.set(w.cfg.basemap || 'basemap.geojson', new TextEncoder().encode(JSON.stringify(w.basemap)));
    return out;
  }

  const STEP_KEYS = ['step_gedcom', 'step_root', 'step_branches', 'step_places', 'step_living', 'step_done'];

  // Can the person go to step n? Only with a tree (2+) and a starting person (3+).
  const reachable = (n) => n === 1 || (w.tree && (n === 2 || w.cfg.root));

  function render(el) {
    clear(el);
    FCApp.pending = pending;
    const step = FCApp.steps[w.step];
    const nav = h('ol', { class: 'steps', 'aria-label': t('app_title') },
      STEP_KEYS.map((k, i) => h('li', {}, h('button', {
        type: 'button', disabled: !reachable(i + 1), 'aria-current': w.step === i + 1 ? 'step' : null,
        onclick: () => go(i + 1),
      }, `${i + 1} · ${t(k)}`))));
    const body = h('section', { class: ['page', step.wide && 'wide'] });
    const msg = h('div', { class: 'messages' });
    el.append(nav, body, msg);
    step.render(body, api);
    const foot = h('div', { class: 'wizard-foot' },
      w.step > 1 ? h('button', { type: 'button', class: 'button', onclick: () => go(w.step - 1) }, t('back')) : h('span', {}),
      h('span', { class: 'spacer' }),
      step.skip ? h('button', { type: 'button', class: 'button', onclick: () => go(w.step + 1, true) }, t('skip')) : null,
      w.step < 6 ? h('button', { type: 'button', class: 'primary-button', id: 'next', onclick: () => go(w.step + 1) }, t('next')) : null);
    el.appendChild(foot);
    api.message = (text) => { clear(msg); if (text) FCApp.error(msg, text); };
  }

  function go(n, skipping) {
    if (n > w.step && !skipping) {
      const problem = FCApp.steps[w.step].check ? FCApp.steps[w.step].check(api) : null;
      if (problem) { api.message(problem); return; }
    }
    if (n < 1 || n > 6 || !reachable(n)) return;
    if (FCApp.steps[w.step].leave) FCApp.steps[w.step].leave(api);
    w.step = n;
    FCApp.replaceArgs(n);
    render(root);
    g.scrollTo(0, 0);
  }

  let root = null;
  const api = {
    get state() { return w; },
    changed() { FCApp.changed(); },
    rerender() { render(root); },
    go,
    pending,
    message() {},
    // the site locale for texts built from the tree (roles, "and"): the UI language, else English
    locale() { const l = FCApp.data.assets().locales; return l[FCApp.lang] || l.en; },
  };

  FCApp.wizard = { open(project, step) { FCApp.project = project; FCApp.show('wizard', step || 1); }, pending, state: () => w };
  FCApp.ui = FCApp.ui || {};
  FCApp.ui.wizard = (el, step) => {
    if (!w || w.project !== FCApp.project) w = start(FCApp.project);
    if (step && step !== w.step && reachable(step)) w.step = step;
    root = el;
    render(el);
  };
})(window);
