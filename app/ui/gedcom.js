// Step 1: load the GEDCOM (drag or choose), say what is in it, pick the languages of the website.
(function (g) {
  'use strict';

  const FCApp = g.FCApp;
  const { h } = FCApp.dom;
  const t = FCApp.t;
  const E = () => g.FCEngine;
  const PROBLEM = { 'no-sex': 'problem_no_sex', 'bad-date': 'problem_bad_date', 'no-name': 'problem_no_name' };

  const dec = new TextDecoder(), enc = new TextEncoder();
  const CHRONICLE = /^chronicles\/[^/]+\.md$/;

  // The current text of a project file: what the wizard is about to write, else the saved file.
  function current(s, path) {
    if (s.remapped && s.remapped.has(path)) return s.remapped.get(path);
    return s.project.files.get(path) || null;
  }

  async function load(file, w) {
    const s = w.state;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let tree;
    try {
      tree = E().gedcom.load(bytes);
    } catch (e) {
      s.error = e instanceof E().gedcom.GedcomEncodingError ? `${e.message} ${t('gedcom_encoding_fix')}` : t('gedcom_bad', { error: e.message });
      return w.rerender();
    }
    Object.assign(s, { error: null, build: null, placeState: null, changes: null, update: null });
    if (s.tree) startUpdate(s, tree, bytes, file.name);
    else {
      Object.assign(s, { tree, ged: bytes, gedName: file.name });
      const cfg = E().project.forgetMissing(s.cfg, tree);
      replaceCfg(s, cfg);
    }
    w.changed();
    w.rerender();
  }

  function replaceCfg(s, cfg) {
    for (const k of Object.keys(s.cfg)) delete s.cfg[k];
    Object.assign(s.cfg, cfg);
    s.cfg.gedcom = 'family.ged';
    s.branchesFor = s.cfg.root && (s.cfg.branches || []).length ? s.cfg.root : null;   // else step 3 suggests them again
  }

  // A newer file of the same family: pair the people, ask about the unclear ones, then move the
  // settings, documents and chronicles over to the new ids.
  function startUpdate(s, tree, bytes, name) {
    const paths = [...new Set([...s.project.files.keys(), ...(s.remapped ? s.remapped.keys() : [])])];
    const chronicles = new Map(paths.filter((p) => CHRONICLE.test(p)).map((p) => [p, dec.decode(current(s, p))]));
    let documents = [];
    const docBytes = s.cfg.documents ? current(s, s.cfg.documents) : null;
    try { documents = docBytes ? JSON.parse(dec.decode(docBytes)) : []; } catch (e) { documents = []; }
    const r = E().match.pair(s.tree, tree, E().match.usedIds(s.cfg, documents, chronicles));
    s.update = { oldTree: s.tree, tree, bytes, name, r, answers: new Map(), documents, chronicles };
    if (!r.questions.length) finishUpdate(s);
  }

  function finishUpdate(s) {
    const u = s.update;
    const pairs = new Map(u.r.pairs);
    for (const [id, to] of u.answers) if (to) pairs.set(id, to);
    const out = E().match.remap({ cfg: s.cfg, documents: u.documents, chronicles: u.chronicles }, pairs);
    const remapped = new Map(s.remapped || []);
    if (s.cfg.documents && JSON.stringify(out.documents) !== JSON.stringify(u.documents)) remapped.set(s.cfg.documents, E().project.serialize(out.documents));
    for (const [p, text] of out.chronicles) if (text !== u.chronicles.get(p)) remapped.set(p, enc.encode(text));
    s.changes = { ...E().match.changes(u.oldTree, u.tree, pairs, out.cfg, new Date()), oldTree: u.oldTree };
    Object.assign(s, { tree: u.tree, ged: u.bytes, gedName: u.name, remapped, update: null });
    replaceCfg(s, out.cfg);
  }

  function questions(w) {
    const s = w.state, u = s.update;
    const locale = w.locale();
    const card = (tree, id) => { const x = E().project.personInfo(tree, id, locale); return x ? `${x.label} ${x.years}${x.parents ? ` · ${x.parents}` : ''}` : id; };
    const answer = (id, to) => {
      u.answers.set(id, to || null);
      if (u.r.questions.every((q) => u.answers.has(q.id))) finishUpdate(s);
      w.changed();
      w.rerender();
    };
    return h('section', { class: 'panel', id: 'questions' },
      h('h2', {}, t('update_title')), h('p', { class: 'note' }, t('update_lead')),
      u.r.questions.map((q) => {
        const old = E().project.personInfo(u.oldTree, q.id, locale) || { label: q.id, years: '' };
        const group = `q-${q.id}`;
        const radio = (value, label) => h('label', { class: 'answer' },
          h('input', { type: 'radio', name: group, value, checked: u.answers.has(q.id) && (u.answers.get(q.id) || '') === value, onchange: () => answer(q.id, value) }), ' ', label);
        const found = h('div', { class: 'candidates' });
        const search = h('input', { type: 'search', placeholder: t('update_search'), 'aria-label': t('update_search'), oninput: (e) => {
          FCApp.dom.clear(found);
          for (const x of E().project.searchPeople(u.tree, e.target.value, 8, locale)) found.appendChild(radio(x.id, card(u.tree, x.id)));
        } });
        return h('fieldset', { class: 'question' }, h('legend', {}, t('update_question', { name: old.label, years: old.years })),
          q.candidates.map((c) => radio(c, card(u.tree, c))), radio('', t('update_none')),
          q.candidates.length ? null : h('div', {}, search, found));
      }));
  }

  function changes(s) {
    const c = s.changes;
    const MAX = 20;
    const name = (tree, id) => { const p = tree.people.get(id); return p ? [p.given, p.surname].filter(Boolean).join(' ') || id : id; };
    const group = (key, ids, tree) => (ids.length ? h('li', {}, t(key, { n: ids.length }),
      h('span', { class: 'note' }, ` ${ids.slice(0, MAX).map((id) => name(tree, id)).join(', ')}${ids.length > MAX ? ` ${t('changes_more', { n: ids.length - MAX })}` : ''}`)) : null);
    const items = [group('changes_added', c.added, s.tree), group('changes_removed', c.removed, c.oldTree),
      group('changes_dates', [...new Set(c.dates.map((d) => d.id))], s.tree),
      c.places.length ? h('li', {}, t('changes_places', { n: c.places.length }), h('span', { class: 'note' }, ` ${c.places.slice(0, MAX).join(', ')}`)) : null,
      group('changes_now_deceased', c.nowDeceased, s.tree), group('changes_now_living', c.nowLiving, s.tree)].filter(Boolean);
    return h('section', { class: 'panel', id: 'changes' }, h('h2', {}, t('changes_title')),
      items.length ? h('ul', {}, items) : h('p', { class: 'note' }, t('changes_none')));
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
      if (s.update) el.appendChild(questions(w));
      else if (s.tree) {
        el.append(summary(s));
        if (s.changes) el.appendChild(changes(s));
        el.appendChild(languages(w));
      }
      el.appendChild(h('p', { class: 'note' }, t('gedcom_local')));
    },
    check: (w) => (w.state.update ? t('update_need') : w.state.tree ? null : t('gedcom_need')),
  };
})(window);
