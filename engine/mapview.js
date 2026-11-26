// Map data for the browser: camera bounds derived from the places, and the optional
// hand-written labels from `map_labels` in site.json. Port of familychronicle/mapview.py.
(function (g) {
  'use strict';

  const text = typeof require !== 'undefined' ? require('./text.js') : g.FCEngine.text;

  const KINDS = ['region', 'town', 'ridge'];
  const MARGIN_RATIO = 0.25;   // of the span of the places, on every side
  const MIN_MARGIN = 1.0;      // degrees; also what a single place gets

  // [south, west, north, east] of all places with coordinates plus a margin, or null.
  function bounds(places) {
    const coords = Object.values(places).filter((m) => m.coords && m.coords.length).map((m) => m.coords);
    if (!coords.length) return null;
    const lats = coords.map((c) => c[0]), lons = coords.map((c) => c[1]);
    const south = Math.min(...lats), north = Math.max(...lats), west = Math.min(...lons), east = Math.max(...lons);
    const dlat = Math.max(MIN_MARGIN, (north - south) * MARGIN_RATIO);
    const dlon = Math.max(MIN_MARGIN, (east - west) * MARGIN_RATIO);
    const r = (x) => text.pyRound(x, 3);
    return [r(Math.max(-80.0, south - dlat)), r(Math.max(-180.0, west - dlon)),
      r(Math.min(80.0, north + dlat)), r(Math.min(180.0, east + dlon))];
  }

  const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

  // The validated `map_labels` of the config: [{text: {lang: str}, lat, lon, kind}].
  function labels(config) {
    const raw = 'map_labels' in config ? config.map_labels : [];
    if (!Array.isArray(raw)) throw new Error('map_labels must be a list');
    return raw.map((item, i) => {
      const where = `map_labels[${i}]`;
      if (!isObject(item)) throw new Error(`${where} must be an object`);
      const t = item.text;
      if (!isObject(t) || !Object.keys(t).length || !Object.values(t).every((v) => typeof v === 'string' && v)) {
        throw new Error(`${where}: text must map language -> non-empty text`);
      }
      for (const k of ['lat', 'lon']) {
        if (typeof item[k] !== 'number' || !Number.isFinite(item[k])) throw new Error(`${where}: ${k} must be a number`);
      }
      if (!(item.lat >= -90 && item.lat <= 90) || !(item.lon >= -180 && item.lon <= 180)) {
        throw new Error(`${where}: lat/lon out of range`);
      }
      if (!KINDS.includes(item.kind)) throw new Error(`${where}: kind must be one of ${KINDS.join(', ')}`);
      return { text: t, lat: item.lat, lon: item.lon, kind: item.kind };
    });
  }

  const mapData = (places, config) => ({ bounds: bounds(places), labels: labels(config) });

  const api = { KINDS, bounds, labels, mapData };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).mapview = api;
})(typeof window !== 'undefined' ? window : globalThis);
