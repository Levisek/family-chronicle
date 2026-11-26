// The chronicle of a branch: a text field with a preview next to it, the draft from the data when
// there is no chronicle yet, "Rebuild from the data" (keeps what was written), and the earlier
// versions (chronicles/.versions/). Saving keeps the previous text as a version first.
(function (g) {
  'use strict';

  const FCApp = g.FCApp;
  const { h, clear } = FCApp.dom;
  const t = FCApp.t;
  const E = () => g.FCEngine;
  const dec = new TextDecoder(), enc = new TextEncoder();

  let ed = null;   // {project, key, lang, path, text, saved, exists, showVersions}

  function readJson(p, path) {
    try { return path && p.files.has(path) ? JSON.parse(dec.decode(p.files.get(path))) : null; } catch (e) { return null; }
  }

  // Everything the draft needs, read from the saved family.
  function context(project) {
    const cfg = readJson(project, 'site.json');
    if (!cfg) throw new Error('site.json');
    const tree = E().gedcom.load(project.files.get(cfg.gedcom || 'family.ged'));
    const scope = E().scope.determineScope(tree, cfg, new Date());
    const places = readJson(project, cfg.places || 'places.json') || {};
    const locales = FCApp.data.assets().locales;
    return { cfg, tree, scope, places, locales };
  }

  const branchOf = (cfg, key) => (cfg.branches || []).find((b) => b.key === key) || null;
  const baseOf = (cfg, key) => { const b = branchOf(cfg, key); return (b && b.chronicle) || `chronicles/${key}.md`; };
  const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1);

  function pathOf(cfg, key, lang) {
    const base = baseOf(cfg, key);
    return lang === cfg.default_language ? base : `${dirOf(base)}${E().chronicles.chapterSlug(base)}.${lang}.md`;
  }
  const stem = (path) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
  const versionsDir = (path) => `${dirOf(path)}.versions/`;

  function versions(project, path) {
    const prefix = `${versionsDir(path)}${stem(path)}-`;
    return [...project.files.keys()].filter((k) => k.startsWith(prefix) && /-\d{4}-\d\d-\d\d-\d{6}\.md$/.test(k)).sort().reverse();
  }

  function draft(ctx, key, lang) {
    return E().skeleton.build({ tree: ctx.tree, scope: ctx.scope, cfg: ctx.cfg, branchKey: key, lang, locale: ctx.locales[lang] || ctx.locales.en, places: ctx.places });
  }

  // Writes the text; the previous one goes to .versions/ first. A new chronicle of the default
  // language is put into site.json (the old site.json to history/) and into the wizard's settings.
  async function save(project, key, lang, text) {
    const ctx = context(project);
    const path = pathOf(ctx.cfg, key, lang);
    const old = project.files.get(path);
    if (old && dec.decode(old) === text) return path;
    if (old) await project.write(`${versionsDir(path)}${stem(path)}-${E().output.stamp(new Date())}.md`, old);
    await project.write(path, enc.encode(text));
    const b = branchOf(ctx.cfg, key);
    if (lang === ctx.cfg.default_language && b && !b.chronicle) {
      b.chronicle = path;
      for (const [k, v] of E().output.backup(project.files, ['site.json'], E().output.stamp(new Date()))) await project.write(k, v);
      await project.write('site.json', E().project.serialize(ctx.cfg));
      const ws = FCApp.wizard.state();
      if (ws && ws.project === project) { const wb = branchOf(ws.cfg, key); if (wb) wb.chronicle = path; }
    }
    FCApp.changed();
    return path;
  }

  // The preview: no comments, no HTML of its own (shown as text), the marks yellow.
  function preview(text, pattern) {
    const src = text.replace(/<!--[\s\S]*?-->/g, '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return E().markdown.render(src).replace(new RegExp(pattern.source, 'g'), (m) => `<mark class="fill-in">${m}</mark>`);
  }

  function leave(go) {
    if (ed && ed.text !== ed.saved && !g.confirm(t('chron_unsaved'))) return;
    ed = null;
    go();
  }

  FCApp.chronicle = { save, versions, context, pathOf, draft };
  FCApp.ui = FCApp.ui || {};
  FCApp.ui.chronicle = (el, key, lang) => {
    const project = FCApp.project;
    let ctx;
    try { ctx = context(project); } catch (e) { FCApp.error(el, t('chron_cannot', { error: e.message })); return; }
    const cfg = ctx.cfg;
    lang = cfg.languages.includes(lang) ? lang : cfg.default_language;
    const path = pathOf(cfg, key, lang);
    if (!ed || ed.project !== project || ed.key !== key || ed.lang !== lang) {
      const exists = project.files.has(path);
      const text = exists ? dec.decode(project.files.get(path)) : draft(ctx, key, lang);
      ed = { project, key, lang, path, text, saved: exists ? text : null, exists, showVersions: false };
    }
    const pattern = E().chronicles.fillPattern(ctx.locales);
    const b = branchOf(cfg, key);
    const name = b ? (b.name[FCApp.lang] || b.name[cfg.default_language] || Object.values(b.name)[0] || key) : key;
    const page = h('section', { class: 'page wide chronicle-page' });
    el.appendChild(page);
    const rerender = () => { clear(el); FCApp.ui.chronicle(el, key, lang); };

    const marks = h('p', { class: 'note', id: 'chron-marks' });
    const view = h('div', { class: 'chronicle-preview', id: 'chron-preview' });
    const saveBtn = h('button', { type: 'button', class: 'primary-button', id: 'chron-save', onclick: async () => {
      try {
        await save(project, key, lang, ed.text);
        ed.saved = ed.text;
        ed.exists = true;
        FCApp.refreshBanners();
        rerender();
      } catch (e) { FCApp.error(page, t('chron_save_failed', { error: e.message })); }
    } }, t('chron_save'));
    const update = () => {
      const n = (ed.text.match(pattern) || []).length;
      marks.textContent = n ? t('chron_marks', { n }) : t('chron_no_marks');
      view.innerHTML = preview(ed.text, pattern);
      saveBtn.disabled = ed.text === ed.saved;
    };
    const area = h('textarea', { id: 'chron-text', spellcheck: 'true', lang, 'aria-label': t('chron_text'), oninput: (e) => { ed.text = e.target.value; update(); } });
    area.value = ed.text;

    page.append(h('h1', {}, t('chron_title', { name })),
      ed.exists ? null : h('p', { class: 'lead', id: 'chron-draft-note' }, t('chron_draft_note')),
      cfg.languages.length > 1 ? h('div', { class: 'chron-langs' }, cfg.languages.map((l) => h('button', {
        type: 'button', class: l === lang ? 'primary-button' : 'button', 'data-lang': l,
        onclick: () => leave(() => FCApp.show('chronicle', key, l)),
      }, (ctx.locales[l] && ctx.locales[l].language_name) || l))) : null,
      h('div', { class: 'chronicle-editor' }, area, view),
      marks,
      h('div', { class: 'home-actions' },
        saveBtn,
        h('button', { type: 'button', class: 'button', id: 'chron-rebuild', onclick: () => {
          const sk = (ctx.locales[lang] || ctx.locales.en).skeleton || ctx.locales.en.skeleton;
          ed.text = E().skeleton.refresh(ed.text, draft(ctx, key, lang), pattern, sk.new_from_data);
          area.value = ed.text;
          update();
        } }, t('chron_rebuild')),
        FCApp.chronicleAi ? h('button', { type: 'button', class: 'button', id: 'chron-ai', onclick: () => FCApp.chronicleAi(page, { project, key, lang, ctx, ed, area, update }) }, t('chron_ai')) : null,
        h('button', { type: 'button', class: 'button', id: 'chron-versions-btn', onclick: () => { ed.showVersions = !ed.showVersions; rerender(); } }, t('chron_versions'))),
      h('p', { class: 'note' }, t('chron_help')));
    if (ed.showVersions) {
      const list = versions(project, path);
      page.appendChild(list.length ? h('ul', { class: 'versions', id: 'chron-versions' }, list.map((v) => {
        const m = /-(\d{4})-(\d\d)-(\d\d)-(\d\d)(\d\d)(\d\d)\.md$/.exec(v);
        return h('li', {}, m ? `${m[3]}. ${m[2]}. ${m[1]} ${m[4]}:${m[5]}` : v, ' ',
          h('button', { type: 'button', class: 'link', onclick: () => { ed.text = dec.decode(project.files.get(v)); area.value = ed.text; update(); } }, t('chron_version_show')));
      })) : h('p', { class: 'note', id: 'chron-versions' }, t('chron_no_versions')));
    }
    page.appendChild(h('p', {}, h('button', { type: 'button', class: 'link', id: 'chron-home', onclick: () => leave(() => FCApp.show('home')) }, t('to_home'))));
    update();
  };
})(window);
