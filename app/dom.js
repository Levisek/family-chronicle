// DOM helpers. Text from the GEDCOM and the family folder goes in only as text nodes or attribute
// values, never as HTML; inline style attributes are blocked by the CSP, so styles go through CSSOM.
(function (g) {
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';

  function apply(el, attrs) {
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
      else if (k === 'style') for (const [p, x] of Object.entries(v)) el.style.setProperty(p, x);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'checked' || k === 'disabled' || k === 'value' || k === 'selected') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }

  function append(el, children) {
    for (const c of children) {
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) append(el, c);
      else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }

  // h('p', {class: 'x', onclick: f}, 'text', child, [more])
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    apply(el, attrs);
    append(el, children);
    return el;
  }

  function s(tag, attrs, ...children) {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'style') for (const [p, x] of Object.entries(v)) el.style.setProperty(p, x);
      else el.setAttribute(k, String(v));
    }
    append(el, children);
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  // Save bytes as a download (Blob URL, no navigation away from the app).
  function download(bytes, name, type = 'application/zip') {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // Add a bundled script (app/data/*.js) once; resolves when it ran.
  const loaded = new Map();
  function loadScript(src) {
    if (!loaded.has(src)) {
      loaded.set(src, new Promise((resolve, reject) => {
        const el = h('script', { src });
        el.addEventListener('load', () => resolve());
        el.addEventListener('error', () => { loaded.delete(src); reject(new Error(`cannot load ${src}`)); });
        document.head.appendChild(el);
      }));
    }
    return loaded.get(src);
  }

  const FCApp = (g.FCApp = g.FCApp || {});
  FCApp.dom = { h, s, clear, download, loadScript };
})(window);
