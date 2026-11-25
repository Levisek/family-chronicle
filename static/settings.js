// Settings in the corner of the header: look of the site (theme) and colours of the family tree.
// On every page, independent of common.js. The choices are kept in localStorage; the tree and the fan chart
// listen to the event `chronicle:colors` and tell this panel about a change from elsewhere (`chronicle:colors-changed`).
(function () {
  'use strict';
  var THEMES = ['chronicle', 'night', 'atlas'];
  var ALL_MODES = ['branch', 'state', 'era', 'documented'];
  var THEME_KEY = 'chronicle.theme', COLORS_KEY = 'chronicle.colors';
  var data = {};
  try { data = JSON.parse(document.getElementById('data').textContent); } catch (e) { /* no data: the fallbacks below */ }
  var T = data.strings || {};
  var modes = (data.color_modes && data.color_modes.length ? data.color_modes : ALL_MODES);
  var read = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var write = function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } };
  var header = document.querySelector('header');
  if (!header) return;

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { e.append(c); });
    return e;
  }

  var label = T.settings_label || 'Settings';
  var toggle = el('button', { type: 'button', class: 'settings-toggle', 'aria-expanded': 'false', 'aria-controls': 'settings-panel',
    title: label, 'aria-label': label });
  toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>';

  var current = document.documentElement.getAttribute('data-theme') || 'chronicle';
  var themes = el('div', { class: 'settings-themes', role: 'radiogroup', 'aria-label': T.settings_appearance || 'Appearance' });
  THEMES.forEach(function (t) {
    var b = el('button', { type: 'button', role: 'radio', class: 'settings-theme theme-' + t, 'data-theme': t,
      'aria-checked': String(t === current) }, [el('span', { class: 'sample', 'aria-hidden': 'true' }), el('span', { text: T['theme_' + t] || t })]);
    b.addEventListener('click', function () {
      if (t === 'chronicle') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', t);
      write(THEME_KEY, t);
      themes.querySelectorAll('.settings-theme').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
      window.dispatchEvent(new CustomEvent('chronicle:theme', { detail: t }));
    });
    themes.append(b);
  });

  var select = el('select', { id: 'settings-colors' });
  var chosen = new URLSearchParams(location.hash.slice(1)).get('colors') || read(COLORS_KEY);
  if (modes.indexOf(chosen) < 0) chosen = 'branch';
  modes.forEach(function (m) {
    var o = el('option', { value: m, text: T['color_mode_' + m] || m });
    if (m === chosen) o.selected = true;
    select.append(o);
  });
  select.addEventListener('change', function () {
    write(COLORS_KEY, select.value);
    window.dispatchEvent(new CustomEvent('chronicle:colors', { detail: select.value }));
  });
  window.addEventListener('chronicle:colors-changed', function (e) { select.value = e.detail; });

  var panel = el('div', { class: 'settings-panel', id: 'settings-panel', role: 'dialog', 'aria-label': label, hidden: '' }, [
    el('h2', { text: label }),
    el('p', { class: 'settings-heading', text: T.settings_appearance || 'Appearance' }), themes,
    el('label', { class: 'settings-heading', for: 'settings-colors', text: T.settings_colors || 'Family tree colours' }), select,
    el('p', { class: 'settings-note', text: T.settings_note || '' })
  ]);

  function close() { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
  toggle.addEventListener('click', function (e) {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) { var on = themes.querySelector('[aria-checked="true"]'); if (on) on.focus(); }
  });
  document.addEventListener('click', function (e) { if (!panel.hidden && !panel.contains(e.target)) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) { close(); toggle.focus(); } });

  header.append(toggle, panel);
})();
