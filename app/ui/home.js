// The home of a family: what is in it, where it is kept, build / open the website, settings
// (any step of the wizard), and in Firefox/Safari the backup download.
(function (g) {
  'use strict';

  const FCApp = g.FCApp;
  const { h } = FCApp.dom;
  const t = FCApp.t;
  const E = () => g.FCEngine;
  const dec = new TextDecoder();

  function readJson(p, path) {
    try { return path && p.files.has(path) ? JSON.parse(dec.decode(p.files.get(path))) : null; } catch (e) { return null; }
  }

  FCApp.ui = FCApp.ui || {};
  FCApp.ui.home = (el) => {
    const p = FCApp.project;
    const cfg = readJson(p, 'site.json') || {};
    const places = readJson(p, cfg.places || 'places.json') || {};
    let people = 0;
    try { people = E().gedcom.load(p.files.get(cfg.gedcom || 'family.ged')).people.size; } catch (e) { /* shown by the wizard */ }
    const where = p.mode === 'folder' ? t('home_saved_in', { name: p.name }) : p.example ? t('home_example') : t('home_browser');
    const info = h('p', { class: 'note', id: 'open-info', role: 'status' });
    const nPlaces = Object.values(places).filter((x) => x && x.coords).length;
    el.appendChild(h('section', { class: 'page home' },
      h('h1', {}, p.name),
      h('p', { class: 'lead', id: 'home-counts' }, `${t('home_counts', { people, branches: (cfg.branches || []).length, places: nPlaces })} · ${where}`),
      h('div', { class: 'home-actions' },
        h('button', { type: 'button', class: 'primary-button', id: 'home-build', onclick: () => FCApp.wizard.open(p, 6) }, t('home_build')),
        h('button', { type: 'button', class: 'button', id: 'home-open', onclick: () => {
          info.textContent = p.mode === 'folder' ? t('home_open_where', { folder: p.name, site: cfg.site_dir || 'family' }) : t('home_open_zip');
        } }, t('home_open')),
        h('button', { type: 'button', class: 'button', id: 'home-settings', onclick: () => FCApp.wizard.open(p, 1) }, t('home_settings')),
        p.mode === 'browser' ? h('button', { type: 'button', class: 'button', id: 'home-backup', onclick: () => { p.downloadBackup(); FCApp.refreshBanners(); } }, t('home_backup')) : null),
      info,
      h('p', {}, h('button', { type: 'button', class: 'link', onclick: () => { FCApp.project = null; FCApp.show('start'); } }, t('home_start')))));
  };
})(window);
