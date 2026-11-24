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

  // Loads data files (keys of D.data); all of them without an argument. -> Promise<{key: data}>
  function loadData(keys) {
    keys = keys || Object.keys(D.data);
    return Promise.all(keys.map((k) => {
      if (!D.data[k]) return Promise.reject(new Error('data: ' + k));
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

  g.Chronicle = { D, T, el, monogram, yearOf, localized, color, loadData, personLink, magnifier };
})(window);
