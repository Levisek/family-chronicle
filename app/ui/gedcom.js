// Step 1: load the GEDCOM (drag or choose), say what is in it, pick the languages of the website.
(function (g) {
  'use strict';

  const FCApp = g.FCApp;
  const { h } = FCApp.dom;
  const t = FCApp.t;
  const E = () => g.FCEngine;
  const PROBLEM = { 'no-sex': 'problem_no_sex', 'bad-date': 'problem_bad_date', 'no-name': 'problem_no_name' };

  async function load(file, w) {
    const s = w.state;
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const tree = E().gedcom.load(bytes);
      Object.assign(s, { tree, ged: bytes, gedName: file.name, error: null });
      if (s.cfg.root && !tree.people.has(s.cfg.root)) { s.cfg.root = null; s.branchesFor = null; }
      s.placeState = null;
      s.cfg.gedcom = 'family.ged';
      w.changed();
    } catch (e) {
      s.error = e instanceof E().gedcom.GedcomEncodingError ? `${e.message} ${t('gedcom_encoding_fix')}` : t('gedcom_bad', { error: e.message });
    }
    w.rerender();
  }

  function summary(s) {
    const x = E().project.summary(s.tree);
    const years = x.yearMin === null ? t('gedcom_no_years') : (x.yearMin === x.yearMax ? String(x.yearMin) : `${x.yearMin}–${x.yearMax}`);
    return h('div', { class: 'summary' },
      s.gedName ? h('p', { class: 'note' }, t('gedcom_file', { name: s.gedName })) : null,
      h('p', { class: 'ok', id: 'gedcom-summary' }, t('gedcom_loaded', { people: x.people, families: x.families, years })),
      x.problems.length ? h('ul', { class: 'problems' }, x.problems.map((p) => h('li', {}, t(PROBLEM[p.kind], { n: p.ids.length })))) : null);
  }

  function languages(w) {
    const s = w.state;
    const locales = FCApp.data.assets().locales;
    const codes = Object.keys(locales).sort((a, b) => (a === FCApp.lang ? -1 : b === FCApp.lang ? 1 : a.localeCompare(b)));
    const ordered = [...s.cfg.languages.filter((l) => codes.includes(l)), ...codes.filter((l) => !s.cfg.languages.includes(l))];
    const set = (lang, on) => {
      const now = new Set(s.cfg.languages);
      if (on) now.add(lang); else now.delete(lang);
      if (!now.size) return w.rerender();
      s.cfg.languages = ordered.filter((l) => now.has(l));
      s.cfg.default_language = s.cfg.languages[0];
      for (const b of s.cfg.branches) for (const l of s.cfg.languages) if (!(l in b.name)) b.name[l] = Object.values(b.name)[0] || b.key;
      w.changed();
      w.rerender();
    };
    return h('fieldset', { class: 'languages-box' }, h('legend', {}, t('gedcom_languages')),
      h('div', { class: 'languages' }, ordered.map((lang) => h('label', {},
        h('input', { type: 'checkbox', checked: s.cfg.languages.includes(lang), onchange: (e) => set(lang, e.target.checked) }), ' ',
        locales[lang].language_name || lang))),
      h('p', { class: 'note' }, t('gedcom_languages_note')));
  }

  FCApp.steps[1] = {
    render(el, w) {
      const s = w.state;
      const input = h('input', { type: 'file', accept: '.ged,.GED', class: 'hidden', id: 'ged-input', onchange: (e) => e.target.files[0] && load(e.target.files[0], w) });
      const drop = h('div', { class: 'drop' },
        h('p', { class: 'drop-title' }, t('gedcom_drop')),
        h('p', { class: 'note' }, t('gedcom_or')),
        h('button', { type: 'button', class: 'button', onclick: () => input.click() }, t('gedcom_choose')), input);
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) load(f, w); });
      el.append(h('h1', {}, t('gedcom_title')), h('p', { class: 'lead' }, t('gedcom_lead')), drop);
      if (s.error) FCApp.error(el, s.error);
      if (s.tree) el.append(summary(s), languages(w));
      el.appendChild(h('p', { class: 'note' }, t('gedcom_local')));
    },
    check: (w) => (w.state.tree ? null : t('gedcom_need')),
  };
})(window);
