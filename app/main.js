// The app: a header with the language switch, banners, and one screen at a time
// (start, wizard, home). Screens are functions FCApp.ui.<name>(element, ...args).
(function (g) {
  'use strict';

  const FCApp = g.FCApp;
  const { h, clear } = FCApp.dom;
  const t = FCApp.t;
  const current = { screen: 'start', args: [] };

  FCApp.project = null;
  FCApp.pending = null;     // () => Map of files the wizard has not saved yet (for the backup)

  function banners() {
    const el = clear(document.getElementById('banners'));
    const p = FCApp.project;
    if (current.screen === 'start' && !FCApp.store.canFolder()) el.appendChild(h('p', { class: 'banner', role: 'note' }, t('no_folder_banner')));
    if (p && p.mode !== 'folder' && p.dirty) {
      el.appendChild(h('p', { class: 'banner warn', role: 'status' }, t('dirty_warning'), ' ',
        h('button', { class: 'link', type: 'button', onclick: () => { p.downloadBackup(FCApp.pending ? FCApp.pending() : null); banners(); } }, t('dirty_download'))));
    }
  }

  function render() {
    document.documentElement.lang = FCApp.lang;
    document.title = t('app_title');
    const head = clear(document.getElementById('top'));
    head.appendChild(h('span', { class: 'brand' }, t('app_title')));
    head.appendChild(h('button', { class: 'lang', type: 'button', lang: t('lang_other_code'), onclick: () => { FCApp.setLang(t('lang_other_code')); render(); } }, t('lang_other')));
    banners();
    const screen = clear(document.getElementById('screen'));
    FCApp.ui[current.screen](screen, ...current.args);
  }

  FCApp.show = (screen, ...args) => {
    current.screen = screen;
    current.args = args;
    FCApp.pending = null;
    render();
    g.scrollTo(0, 0);
  };
  FCApp.refreshBanners = banners;
  // something changed that is not saved in a folder yet
  FCApp.changed = () => {
    const p = FCApp.project;
    if (p && p.mode !== 'folder') { p.dirty = true; banners(); }
  };
  FCApp.error = (el, message) => el.appendChild(h('p', { class: 'error', role: 'alert' }, message));

  g.addEventListener('DOMContentLoaded', render);
})(window);
