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

  function findings(w, list) {
    const s = w.state;
    return h('ul', { class: 'findings', id: 'findings' }, list.map((f) => {
      const x = parseFinding(f);
      const li = h('li', { class: 'finding' }, h('code', {}, x.text ? `${x.what}: "${x.text}"` : x.what), ' ',
        x.file ? h('span', { class: 'note' }, t('finding_in', { file: x.file })) : null);
      if (x.text) {
        const reason = h('textarea', { 'aria-label': t('finding_reason'), placeholder: t('finding_reason') });
        const ok = h('button', { type: 'button', class: 'primary-button', disabled: true, onclick: () => {
          if (!reason.value.trim()) return;
          s.cfg.check_exceptions = [...(s.cfg.check_exceptions || []), { text: x.text, reason: reason.value.trim() }];
          w.changed();
          run(w);
        } }, t('finding_save'));
        reason.addEventListener('input', () => { ok.disabled = !reason.value.trim(); });
        const form = h('div', { class: 'hidden' }, reason, ok);
        li.append(h('div', {}, h('button', { type: 'button', class: 'link', onclick: () => form.classList.remove('hidden') }, t('finding_add'))), form);
      }
      return li;
    }));
  }

  FCApp.steps[6] = {
    render(el, w) {
      const s = w.state, cfg = s.cfg, b = s.build || { phase: 'idle' };
      const project = s.project;
      const isExample = !!project.example;
      el.append(h('h1', {}, t('build_title')),
        h('label', {}, t('build_base_url'),
          h('input', { type: 'url', id: 'base-url', value: cfg.base_url || '', placeholder: 'https://', onchange: (e) => { cfg.base_url = e.target.value.trim(); w.changed(); } })),
        h('p', { class: 'note' }, t('build_base_url_note')));
      if (project.mode === 'memory' && !isExample && !FCApp.store.canFolder()) {
        if (s.familyName === undefined) {
          const r = s.tree && cfg.root && s.tree.people.get(cfg.root);
          s.familyName = (r && r.surname) || '';
        }
        el.appendChild(h('label', {}, t('build_family_name'), h('input', { type: 'text', id: 'family-name', value: s.familyName, oninput: (e) => { s.familyName = e.target.value; } })));
      }
      el.appendChild(h('p', {}, h('button', { type: 'button', class: 'primary-button', id: 'build', disabled: b.phase === 'running', onclick: () => run(w) }, t('build_start'))));
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
      if (b.phase === 'saved' && project.mode === 'folder') el.appendChild(h('p', { class: 'ok', id: 'saved' }, t('build_saved', { name: project.name })));
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
