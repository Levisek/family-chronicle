// Shared helpers of all pages with JavaScript: site data, strings, branches, small DOM functions.
// Data only from <script id="data"> (D); no hardcoded hashes or branch colours.
(function (g) {
  'use strict';
  const D = JSON.parse(document.getElementById('data').textContent);
  const T = D.strings;
  const NEUTRAL = '#6a5640';
  // branches are a list in the page data (config order); the scripts also look them up by key
  D.branchMap = Object.fromEntries((D.branches || []).map((b) => [b.key, b]));

  const color = (branch) => {
    const v = D.branchMap && D.branchMap[branch];
    return (v && v.color) || NEUTRAL;
  };

  // People (the people file) are remembered once loaded, for personLink().
  let people = null;

  // A data file opened from disk (file://): the browser refuses fetch(), so the build ships each JSON
  // also as a script that stores it in self.FC_DATA[path].
  function loadScript(k, path) {
    const store = (g.FC_DATA = g.FC_DATA || {});
    if (path in store) return Promise.resolve(store[path]);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = D.root_path + path.replace(/\.json$/, '.js');
      s.onload = () => (path in store ? resolve(store[path]) : reject(new Error(k + ' missing')));
      s.onerror = () => reject(new Error(k + ' not loaded'));
      document.head.appendChild(s);
    });
  }

  // Loads data files (keys of D.data); all of them without an argument. -> Promise<{key: data}>
  function loadData(keys) {
    keys = keys || Object.keys(D.data);
    const fromDisk = location.protocol === 'file:';
    return Promise.all(keys.map((k) => {
      if (!D.data[k]) return Promise.reject(new Error('data: ' + k));
      if (fromDisk) return loadScript(k, D.data[k]);
      return fetch(D.root_path + D.data[k]).then((r) => {
        if (!r.ok) throw new Error(k + ' ' + r.status);
        return r.json();
      });
    })).then((results) => {
      const ctx = Object.fromEntries(keys.map((k, i) => [k, results[i]]));
      if (ctx.people) people = ctx.people;
      return ctx;
    });
  }

  // a {language: text} object -> the text of the page language (or of any language)
  const localized = (v) => (v && typeof v === 'object' ? (v[D.language] || Object.values(v)[0] || '') : v || '');

  const yearOf = (s) => { const m = /(\d{4})/.exec(s || ''); return m ? +m[1] : null; };

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'text') e.textContent = v;
      else if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const d of children) if (d != null && d !== false) e.append(d);
    return e;
  }

  const monogram = (name) => {
    const parts = (name || '?').replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
    if (!parts.length || name === 'N.N.') return '?';
    const a = parts[0][0], b = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (a + b).toUpperCase();
  };

  // Link to a person's page only for deceased people (pages of living people do not exist), otherwise null.
  // Requires the 'people' data to have been loaded earlier through loadData().
  function personLink(id) {
    const o = people && Object.hasOwn(people, id) ? people[id] : null;
    return o && !o.living ? D.lang_root + 'person/' + id + '.html' : null;
  }

  // Lightbox with a magnifier: wheel and pinch zoom, drag pans, a click on the image
  // toggles zoom, a click beside (or the close button) closes. Returns reset() for opening.
  function magnifier(lb) {
    const img = lb.querySelector('img');
    let z = 1, x = 0, y = 0, dragged = false, pinch = null;
    const points = new Map();
    const draw = () => {
      img.style.transform = z === 1 ? '' : `translate(${x}px, ${y}px) scale(${z})`;
      lb.classList.toggle('magnifier-zoom', z > 1);
    };
    const reset = () => { z = 1; x = 0; y = 0; dragged = false; points.clear(); pinch = null; draw(); };
    // zooms to nz so that the window point (sx, sy) stays under the finger/cursor
    const zoomTo = (nz, sx, sy) => {
      nz = Math.min(8, Math.max(1, nz));
      const r = img.getBoundingClientRect();
      const cx = r.left + r.width / 2 - x, cy = r.top + r.height / 2 - y;
      const k = nz / z;
      x = sx - cx - k * (sx - cx - x);
      y = sy - cy - k * (sy - cy - y);
      z = nz;
      if (z === 1) { x = 0; y = 0; }
      draw();
    };
    const closeBtn = el('button', { type: 'button', class: 'magnifier-close', 'aria-label': T.view_close || '×', text: '✕' });
    lb.append(closeBtn);
    lb.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomTo(z * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
    }, { passive: false });
    img.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      img.setPointerCapture(e.pointerId);
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (points.size === 1) dragged = false;
      if (points.size === 2) {
        const [a, b] = [...points.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z };
        dragged = true;
      }
    });
    img.addEventListener('pointermove', (e) => {
      const p = points.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (points.size === 2 && pinch) {
        const [a, b] = [...points.values()];
        zoomTo(pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
      } else if (points.size === 1 && z > 1) {
        if (Math.abs(dx) + Math.abs(dy) > 1) dragged = true;
        x += dx; y += dy; draw();
      }
    });
    const release = (e) => { points.delete(e.pointerId); if (points.size < 2) pinch = null; };
    img.addEventListener('pointerup', release);
    img.addEventListener('pointercancel', release);
    lb.addEventListener('click', (e) => {
      if (e.target === img) {
        if (!dragged) { if (z > 1) reset(); else zoomTo(2.5, e.clientX, e.clientY); }
        dragged = false;
        return;
      }
      if (e.target.closest('a')) return;
      lb.hidden = true; reset();
    });
    return reset;
  }

  // ---------- flags and colouring (tree and fan chart) ----------
  const COLORS_KEY = 'chronicle.colors';   // the colour mode, shared by the tree, the fan chart and the settings panel
  const Col = g.Coloring;   // only the tree and the fan chart load coloring.js (before this file)
  const flagsOf = (p) => (Col ? Col.flagsOf(p, D, D.language) : []);
  // the flags of a person as a row of small images (title: names and years of the states), or null
  function flagsEl(p, cls) {
    const flags = flagsOf(p);
    if (!flags.length) return null;
    const row = el('span', { class: cls || 'flags', title: flags.map((f) => f.names.join(', ')).join(' · ') });
    for (const f of flags) row.append(el('img', { src: f.src, alt: '', width: 15, height: 10 }));
    return row;
  }
  const colorModes = () => (D.color_modes && D.color_modes.length ? D.color_modes : Col.MODES);
  // mode from the address (#colors=), else the last used one
  function savedMode() {
    let m = new URLSearchParams(location.hash.slice(1)).get('colors');
    if (!m) { try { m = localStorage.getItem(COLORS_KEY); } catch (e) { m = null; } }
    return Col.parseMode(m, colorModes());
  }
  function saveMode(mode) {
    try { localStorage.setItem(COLORS_KEY, mode); } catch (e) { /* private window */ }
    const q = new URLSearchParams(location.hash.slice(1));
    if (mode === 'branch') q.delete('colors'); else q.set('colors', mode);
    const h = q.toString();
    try { history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); } catch (e) { /* file:// */ }
    g.dispatchEvent(new CustomEvent('chronicle:colors-changed', { detail: mode }));   // the settings panel follows
  }
  // legend: says what the colours mean (the mode is chosen in the settings panel); `visible` = people in view
  function colorLegend(target, { mode, visible, range, visibleBranches }) {
    target.replaceChildren();
    target.append(el('p', { class: 'mode' }, T.colors_label + ': ' + T['color_mode_' + mode]));
    const ul = el('ul');
    const labels = { state_unknown: T.color_state_unknown, era_unknown: T.color_era_unknown, documented_yes: T.color_documented_yes,
      documented_no: T.color_documented_no, living: T.color_living };
    const ctx = { ...D, range, language: D.language, visibleBranches };
    for (const it of Col.legendItems(mode, ctx, visible, labels)) {
      if (it.kind === 'branch') ul.append(el('li', { class: 'branch-' + it.branch }, el('span', { class: 'swatch' }), it.label));
      else if (it.kind === 'gradient') {
        const bar = el('span', { class: 'gradient' });
        bar.style.background = 'linear-gradient(to right, ' + it.stops.join(', ') + ')';
        ul.append(el('li', { class: 'scale' }, it.from + ' ', bar, ' ' + it.to));
      } else {
        const sw = el('span', { class: 'swatch' });
        sw.style.setProperty('--branch', it.color);
        ul.append(el('li', null, sw, it.kind === 'flag' ? el('img', { src: it.flag, alt: '', class: 'flag' }) : null, it.label));
      }
    }
    target.append(ul);
    return ul;
  }

  g.Chronicle = { D, T, el, monogram, yearOf, localized, color, loadData, personLink, magnifier, flagsOf, flagsEl,
    colors: !Col ? null : { modes: Col.MODES, saved: savedMode, save: saveMode, legend: colorLegend, forPerson: (p, mode, range) => Col.colorFor(p, mode, { ...D, range, language: D.language }), range: Col.eraRange } };
})(window);
