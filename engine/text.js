// Small text helpers shared by the engine modules: HTML escaping like Python's
// html.escape(quote=True), JSON for <script> blocks, UTF-8 and accent stripping.
(function (g) {
  'use strict';

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  // Like html.escape(s, quote=False)
  const escapeText = (s) => String(s).replace(/[&<>]/g, (c) => ESC[c]);

  // JSON for <script type="application/json">: compact, `</` and `<!` escaped.
  const jsonInHtml = (obj) => JSON.stringify(obj).replace(/<(?=[/!])/g, '\\u003c');

  const utf8 = (s) => new TextEncoder().encode(s);
  const fromUtf8 = (bytes) => new TextDecoder('utf-8').decode(bytes);
  const stripAccents = (s) => String(s).normalize('NFKD').replace(/\p{M}/gu, '');

  const api = { escapeHtml, escapeText, jsonInHtml, utf8, fromUtf8, stripAccents };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).text = api;
})(typeof window !== 'undefined' ? window : globalThis);
