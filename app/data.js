// Decodes the bundled data of app/data/*.js (base64 strings) into the maps the engine expects.
(function (g) {
  'use strict';

  function bytes(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  const toMap = (obj) => new Map(Object.keys(obj).map((k) => [k, bytes(obj[k])]));

  function assets() {
    const a = g.FC_ASSETS;
    return { static: toMap(a.static), fonts: toMap(a.fonts), locales: a.locales };
  }

  const example = () => toMap(g.FC_EXAMPLE);

  const FCApp = (g.FCApp = g.FCApp || {});
  FCApp.data = { assets, example, bytes };
})(window);
