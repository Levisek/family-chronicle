// "Let an AI write it": 1 copy the request, 2 paste it into your own chat, 3 paste the answer,
// which is saved as a new version of the chronicle. The app itself sends nothing anywhere.
(function (g) {
  'use strict';

  const FCApp = g.FCApp;
  const { h } = FCApp.dom;
  const t = FCApp.t;
  const E = () => g.FCEngine;

  // A chat often wraps the answer in ```markdown … ```.
  const unwrap = (s) => {
    const m = /^\s*```[a-z]*[ \t]*\n([\s\S]*?)\n```\s*$/i.exec(s);
    return (m ? m[1] : s).trim() + '\n';
  };

  FCApp.chronicleAi = (page, { project, key, lang, ctx, ed }) => {
    const old = page.querySelector('#ai-panel');
    if (old) { old.remove(); return; }
    const texts = { intro: t('ai_prompt_intro'), rules: t('ai_prompt_rules'), facts_title: t('ai_prompt_facts'), chronicle_title: t('ai_prompt_current') };
    const prompt = E().aiprompt.build({
      tree: ctx.tree, scope: ctx.scope, cfg: ctx.cfg, branchKey: key, lang,
      languageName: (ctx.locales[lang] && ctx.locales[lang].language_name) || lang,
      current: ed.text, places: ctx.places, texts, locales: ctx.locales,
    });
    const status = h('p', { class: 'note', role: 'status', id: 'ai-status' });
    const request = h('textarea', { id: 'ai-prompt', readonly: true, rows: 8, 'aria-label': t('ai_step1') });
    request.value = prompt;
    const answer = h('textarea', { id: 'ai-answer', rows: 8, 'aria-label': t('ai_step3'), placeholder: t('ai_answer_placeholder') });
    const save = h('button', { type: 'button', class: 'primary-button', id: 'ai-save', disabled: true, onclick: async () => {
      const text = unwrap(answer.value);
      try {
        await FCApp.chronicle.save(project, key, lang, text);
        ed.text = ed.saved = text;
        ed.exists = true;
        FCApp.refreshBanners();
        FCApp.show('chronicle', key, lang);
      } catch (e) { status.textContent = t('chron_save_failed', { error: e.message }); }
    } }, t('ai_save'));
    answer.addEventListener('input', () => { save.disabled = !answer.value.trim(); });
    const copy = h('button', { type: 'button', class: 'button', id: 'ai-copy', onclick: async () => {
      try {
        await g.navigator.clipboard.writeText(prompt);
        status.textContent = t('ai_copied');
      } catch (e) {
        request.focus();
        request.select();
        status.textContent = t('ai_copy_manual');
      }
    } }, t('ai_copy'));
    page.insertBefore(h('section', { class: 'panel ai-panel', id: 'ai-panel' },
      h('h2', {}, t('ai_title')),
      h('p', { class: 'warning' }, t('ai_warning')),
      h('h3', {}, t('ai_step1')), request, h('p', {}, copy), status,
      h('h3', {}, t('ai_step2')), h('p', { class: 'note' }, t('ai_step2_note')),
      h('h3', {}, t('ai_step3')), answer, h('p', {}, save)), page.querySelector('#chron-marks').nextSibling);
    request.scrollIntoView({ block: 'center' });
  };
})(window);
