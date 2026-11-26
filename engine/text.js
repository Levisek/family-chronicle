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

  // Python's round(x, nd): the exact binary value rounded to nd decimals, ties to even.
  function pyRound(x, nd = 0) {
    if (!Number.isFinite(x)) return x;
    const neg = x < 0;
    const exact = Math.abs(x).toFixed(Math.min(100, nd + 80));   // exact decimal expansion
    const [ip, fp] = exact.split('.');
    const keep = ip + fp.slice(0, nd);
    const rest = fp.slice(nd);
    let up = false;
    if (rest[0] > '5' || (rest[0] === '5' && /[1-9]/.test(rest.slice(1)))) up = true;
    else if (rest[0] === '5') up = Number(keep[keep.length - 1]) % 2 === 1;
    let digits = BigInt(keep) + (up ? 1n : 0n);
    const v = Number(digits) / 10 ** nd;
    return neg ? -v : v;
  }

  const api = { pyRound, escapeHtml, escapeText, jsonInHtml, utf8, fromUtf8, stripAccents };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).text = api;
})(typeof window !== 'undefined' ? window : globalThis);
