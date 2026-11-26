// Step 6: build the website, check it, save it. A finding of the privacy check means nothing is
// saved; every finding with a text can get an exception, which needs a reason. A new family is
// put into a folder only here (Chrome/Edge: the folder picker; Firefox/Safari: this browser).
// Files a person wrote (site.json, places.json, family.ged, the basemap) are copied to history/<stamp>/ before
// they are overwritten.
(function (g) {
  'use strict';

  const FCApp = g.FCApp;
  const { h } = FCApp.dom;
  const t = FCApp.t;
  const E = () => g.FCEngine;

  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  // "family/index.html: date of a living person "5. 1. 1995"" -> {file, what, text}
  function parseFinding(f) {
    const m = /^(.*?): (.*?)(?: "(.*)")?$/s.exec(f);
    return m ? { file: m[1], what: m[2], text: m[3] || null } : { file: '', what: f, text: null };
  }

  async function run(w) {
    const s = w.state;
    s.build = { phase: 'running' };
    w.rerender();
    const files = new Map(s.project.files);
    for (const [k, v] of w.pending()) files.set(k, v);
    const t0 = performance.now();
    try {
      const result = await E().build.build({ files, configPath: 'site.json', assets: FCApp.data.assets(), today: new Date(), images: FCApp.images.adapter });
      const ms = performance.now() - t0;
      s.build = result.ok ? { phase: 'ok', result, ms } : { phase: 'failed', findings: result.findings, ms };
    } catch (e) {
      s.build = { phase: 'error', message: e.message };
    }
    if (s.build.phase === 'ok' && (s.project.mode === 'folder' || s.project.mode === 'browser')) await save(w, s.project);
    FCApp.refreshBanners();   // saving into this browser makes the backup warning due
    w.rerender();
  }

  async function save(w, project) {
    const s = w.state;
    const result = s.build.result;
    const plan = E().output.plan(project.paths, result, s.cfg.site_dir);
    if (plan.refused) { s.build = { ...s.build, phase: 'refused', reason: plan.refused }; return; }
    const pend = w.pending();
    // also the basemap: it may have been made by hand
    const changed = [...pend.keys()].filter((k) => project.files.has(k) && !same(project.files.get(k), pend.get(k)));
    const backups = E().output.backup(project.files, changed, E().output.stamp(new Date()));
    try {
      for (const [k, v] of backups) await project.write(k, v);
      for (const [k, v] of pend) await project.write(k, v);
      if (project.mode === 'folder') {
        for (const [k, v] of plan.writes) await project.write(k, v);
        for (const k of plan.deletes) await project.remove(k);
      }
      s.ged = null;
      s.remapped = null;
      s.build = { ...s.build, phase: 'saved' };
    } catch (e) {
      s.build = { ...s.build, phase: 'error', message: e.message };
    }
  }

  // A new family (or the example in Chrome) gets its folder now.
  async function chooseFolder(w) {
    const s = w.state;
    let p;
    try {
      p = await FCApp.store.persist(s.project, (s.familyName || '').trim() || 'Family');
    } catch (e) {
      if (e.name !== 'AbortError') w.message(e.message);
      return;
    }
    if (p.mode === 'folder' && p.paths.size) {
      const question = p.files.has('site.json') ? t('build_other_family', { name: p.name }) : t('build_foreign_folder', { name: p.name });
      if (!g.confirm(question)) return;
    }
    // the example's chronicles and documents come along into the new folder
    for (const [k, v] of s.project.files) if (!p.files.has(k)) await p.write(k, v);
    s.project = p;
    FCApp.project = p;
    await save(w, p);
    FCApp.refreshBanners();
    w.rerender();
  }

  // The findings in words: whose date or name it looks like, on which page; the same thing from
  // several files (both languages, the page and the data) is one item. "It is someone else" saves
  // the quoted texts as exceptions (with the reason said in words) and builds again.
  const KINDS = { 'date of a living person': 'date', 'year of a living person next to the name': 'name', 'e-mail': 'email', 'phone number': 'phone', 'document not allowed': 'document' };

  function where(s, file) {
    const m = /(?:^|\/)person\/([^/]+)\.html$/.exec(file);
    if (m) {
      const i = E().project.personInfo(s.tree, m[1], {});
      return i ? `${i.label || m[1]}${i.years ? ` (${i.years})` : ''}` : m[1];
    }
    if (/(?:^|\/)index\.html$/.test(file)) return t('finding_page_home');
    if (/(?:^|\/)story\//.test(file)) return t('finding_page_story');
    const page = /(?:^|\/)(fan|map|tree)\.html$/.exec(file);
    if (page) return t(`finding_page_${page[1]}`);
    if (/^data\//.test(file)) return null;
    return file;
  }

  function groupFindings(s, list) {
    const scope = E().scope.determineScope(s.tree, s.cfg, new Date());
    const groups = new Map();
    for (const f of list) {
      const x = parseFinding(f);
      const kind = KINDS[x.what] || 'other';
      const who = x.text && (kind === 'date' || kind === 'name') ? E().privacy.whoseFinding(x.text, s.tree, scope) : [];
      const page = where(s, x.file);
      // one item per living person (their date and their name with a year, on all pages)
      const key = who.length ? `living|${who.join(',')}` : `${kind}|${x.text || x.file}`;
      if (!groups.has(key)) groups.set(key, { kind, who, pages: new Set(), texts: new Set(), dates: new Set(), raw: [], file: x.file });
      const g_ = groups.get(key);
      if (kind === 'date') g_.kind = 'date';
      if (page) g_.pages.add(page);
      if (x.text) g_.texts.add(x.text);
      if (x.text && kind === 'date') g_.dates.add(x.text);
      g_.raw.push(f);
    }
    return [...groups.values()];
  }

  function findings(w, list) {
    const s = w.state;
    const nameOf = (id) => { const i = E().project.personInfo(s.tree, id, {}); return (i && i.label) || id; };
    return h('ul', { class: 'findings', id: 'findings' }, groupFindings(s, list).map((x) => {
      const living = x.who.length ? x.who.map(nameOf).join(', ') : t('finding_someone');
      const all = [...x.pages];
      const pages = all.length > 3 ? `${all.slice(0, 3).join(', ')} ${t('finding_more', { n: all.length - 3 })}` : all.join(', ') || t('finding_page_data');
      const quoted = [...(x.kind === 'date' ? x.dates : x.texts)].map((q) => `„${q}“`).join(' / ');
      const text = x.kind === 'date' ? t('finding_date', { pages, texts: quoted, living })
        : x.kind === 'name' ? t('finding_name', { pages, living })
        : x.kind === 'email' ? t('finding_email', { texts: quoted, pages })
        : x.kind === 'phone' ? t('finding_phone', { texts: quoted, pages })
        : x.kind === 'document' ? t('finding_document', { file: x.file })
        : x.raw.join('; ');
      const li = h('li', { class: 'finding' }, h('p', {}, text));
      if (x.texts.size) {
        const reason = x.kind === 'date' || x.kind === 'name' ? t('finding_reason_other', { pages, living }) : t('finding_reason_ok', { pages });
        li.appendChild(h('p', {}, h('button', { type: 'button', class: 'button finding-ok', onclick: () => {
          s.cfg.check_exceptions = [...(s.cfg.check_exceptions || []), ...[...x.texts].map((q) => ({ text: q, reason }))];
          w.changed();
          run(w);
        } }, x.kind === 'date' || x.kind === 'name' ? t('finding_ok_other') : t('finding_ok_plain'))));
      }
      li.appendChild(h('details', { class: 'note' }, h('summary', {}, t('finding_details')), h('ul', {}, x.raw.map((r) => h('li', {}, h('code', {}, r))))));
      return li;
    }));
  }

  FCApp.steps[6] = {
    render(el, w) {
      const s = w.state, cfg = s.cfg, b = s.build || { phase: 'idle' };
      const project = s.project;
      const isExample = !!project.example;
      el.append(h('h1', {}, t('build_title')), h('p', { class: 'lead' }, t('build_lead')));
      if (project.mode === 'memory' && !isExample && !FCApp.store.canFolder()) {
        if (s.familyName === undefined) {
          const r = s.tree && cfg.root && s.tree.people.get(cfg.root);
          s.familyName = (r && r.surname) || '';
        }
        el.appendChild(h('label', {}, t('build_family_name'), h('input', { type: 'text', id: 'family-name', value: s.familyName, oninput: (e) => { s.familyName = e.target.value; } })));
      }
      el.appendChild(h('p', {}, h('button', { type: 'button', class: 'primary-button', id: 'build', disabled: b.phase === 'running', onclick: () => run(w) }, t('build_start'))));
      el.appendChild(h('details', { class: 'later', open: !!cfg.base_url }, h('summary', {}, t('build_later')),
        h('label', {}, t('build_base_url'),
          h('input', { type: 'url', id: 'base-url', value: cfg.base_url || '', placeholder: 'https://', onchange: (e) => { cfg.base_url = e.target.value.trim(); w.changed(); } })),
        h('p', { class: 'note' }, t('build_base_url_note'))));
      if (b.phase === 'running') el.appendChild(h('p', { class: 'progress', role: 'status' }, t('build_running')));
      if (b.phase === 'error') FCApp.error(el, t('build_error', { error: b.message }));
      if (b.phase === 'failed') {
        FCApp.error(el, t('build_failed'));
        el.appendChild(findings(w, b.findings));
      }
      if (b.phase === 'refused') FCApp.error(el, t('build_refused', { reason: b.reason }));
      if (['ok', 'saved', 'refused'].includes(b.phase)) {
        el.appendChild(h('p', { class: 'ok', id: 'build-ok', role: 'status' }, t('build_ok', { files: b.result.files.size }), ' ', t('build_time', { seconds: (b.ms / 1000).toLocaleString(FCApp.lang, { maximumFractionDigits: 1 }) })));
      }
      if (['ok', 'saved', 'refused'].includes(b.phase) && (b.result.fillIns || []).length) {
        el.appendChild(h('ul', { class: 'note', id: 'fill-ins' }, b.result.fillIns.map((x) => h('li', {}, t('build_fill_ins', { file: x.file, n: x.count })))));
      }
      if (b.phase === 'saved' && project.mode === 'folder') el.appendChild(h('p', { class: 'ok', id: 'saved' }, t('build_saved', { name: project.name }), ' ', t('home_open_where', { folder: project.name, site: cfg.site_dir || 'family' })));
      if (b.phase === 'ok' && project.mode === 'memory' && !isExample) {
        el.append(h('p', {}, h('button', { type: 'button', class: 'primary-button', id: 'choose-folder', onclick: () => chooseFolder(w) }, FCApp.store.canFolder() ? t('build_choose_folder') : t('build_save_browser'))),
          FCApp.store.canFolder() ? h('p', { class: 'note' }, t('build_folder_note')) : null);
      }
      if ((b.phase === 'ok' && isExample) || (b.phase === 'saved' && project.mode === 'browser')) {
        el.appendChild(h('p', {}, h('button', { type: 'button', class: 'button', id: 'download-web', onclick: () => project.downloadWeb(b.result.files) }, t('build_download_web'))));
      }
      if (b.phase === 'saved' || (b.phase === 'ok' && isExample)) {
        el.appendChild(h('p', {}, h('button', { type: 'button', class: 'button', id: 'home', onclick: () => FCApp.show('home') }, t('to_home'))));
      }
    },
  };
})(window);
