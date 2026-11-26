// Screen 1: start with a GEDCOM, open a saved family, or try the example.
(function (g) {
  'use strict';

  const FCApp = g.FCApp;
  const { h } = FCApp.dom;
  const t = FCApp.t;

  async function openProject(p, msg) {
    if (!p) return;
    if (!p.files.has('site.json')) { FCApp.error(msg, t('not_a_family')); return; }
    FCApp.project = p;
    FCApp.show('home');
  }

  function choice(label, note, onclick, primary) {
    return h('button', { type: 'button', class: ['choice', primary && 'primary'], onclick }, h('span', { class: 'choice-label' }, label), h('span', { class: 'choice-note' }, note));
  }

  FCApp.ui = FCApp.ui || {};
  FCApp.ui.start = (el) => {
    const msg = h('div', { class: 'messages' });
    const saved = h('div', { class: 'saved' });
    el.appendChild(h('section', { class: 'page start' },
      h('h1', {}, t('start_title')),
      h('p', { class: 'lead' }, t('start_lead')),
      h('div', { class: 'choices' },
        choice(t('start_new'), t('start_new_note'), () => { FCApp.project = FCApp.store.blank(); FCApp.show('wizard', 1); }, true),
        choice(t('start_open'), t('start_open_note'), async () => {
          try { await openProject(await FCApp.store.openFolder(), msg); } catch (e) { if (e.name !== 'AbortError') FCApp.error(msg, t('open_failed', { error: e.message })); }
        }),
        choice(t('start_example'), t('start_example_note'), () => { FCApp.project = FCApp.store.example(); FCApp.show('wizard', 1); })),
      saved, msg));
    FCApp.store.saved().then((list) => {
      for (const entry of list) {
        saved.appendChild(h('button', { type: 'button', class: 'link', onclick: async () => {
          try { await openProject(await FCApp.store.reopen(entry), msg); } catch (e) { FCApp.error(msg, t('open_failed', { error: e.message })); }
        } }, t('start_reopen', { name: entry.name })));
      }
    });
  };
})(window);
