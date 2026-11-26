// Map basemap: Natural Earth 50m (public domain, bundled as app/data/world.js by tools/world.mjs)
// cropped to the area of the places. Port of familychronicle/basemap.py.
//   Bbox = [lon0, lon1, lat0, lat1]
//   world = {land, lakes, borders, rivers}: arrays of GeoJSON geometries
(function (g) {
  'use strict';

  const LAYERS = [['land', true], ['lakes', true], ['borders', false], ['rivers', false]];

  // "lon0,lon1,lat0,lat1" -> Bbox; an error when malformed or inverted
  function parseBbox(text) {
    const parts = String(text).split(',');
    const nums = parts.map((x) => (x.trim() === '' ? NaN : Number(x)));
    if (parts.length !== 4 || nums.some((x) => !Number.isFinite(x))) throw new Error(`bbox must be four numbers lon0,lon1,lat0,lat1 (got ${JSON.stringify(text)})`);
    const [lon0, lon1, lat0, lat1] = nums;
    if (lon0 >= lon1 || lat0 >= lat1) throw new Error(`bbox is empty or inverted: ${JSON.stringify(text)}`);
    return nums;
  }

  // Bounding box of all place coordinates, widened by `margin` degrees on each side.
  function bboxFromPlaces(placesData, margin) {
    const coords = Object.values(placesData || {}).filter((e) => e && e.coords).map((e) => e.coords);
    if (!coords.length) throw new Error('places: no places with coords');
    const lats = coords.map((c) => c[0]), lons = coords.map((c) => c[1]);
    return [Math.max(Math.min(...lons) - margin, -180), Math.min(Math.max(...lons) + margin, 180),
      Math.max(Math.min(...lats) - margin, -90), Math.min(Math.max(...lats) + margin, 90)];
  }

  // Intersection of segment pq with a clip edge (axis 0 = lon, 1 = lat).
  function edge(p, q, axis, value) {
    const t = (value - p[axis]) / (q[axis] - p[axis]);
    const r = [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
    r[axis] = value;
    return r;
  }

  // Sutherland-Hodgman against the rectangle.
  function clipRing(ring, box) {
    const [lon0, lon1, lat0, lat1] = box;
    let out = ring.map((b) => [b[0], b[1]]);
    const edges = [[0, lon0, (v) => v >= lon0], [0, lon1, (v) => v <= lon1], [1, lat0, (v) => v >= lat0], [1, lat1, (v) => v <= lat1]];
    for (const [axis, value, inside] of edges) {
      const src = out;
      out = [];
      for (let i = 0; i < src.length; i++) {
        const b = src[i], a = src[(i - 1 + src.length) % src.length];
        if (inside(b[axis])) {
          if (!inside(a[axis])) out.push(edge(a, b, axis, value));
          out.push(b);
        } else if (inside(a[axis])) out.push(edge(a, b, axis, value));
      }
      if (!out.length) return [];
    }
    return out;
  }

  // Split a polyline into the pieces inside the rectangle (Liang-Barsky per segment).
  function clipLine(line, box) {
    const [lon0, lon1, lat0, lat1] = box;
    const pieces = [];
    let cur = [];
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1];
      let t0 = 0, t1 = 1, ok = true;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      for (const [p, q] of [[-dx, a[0] - lon0], [dx, lon1 - a[0]], [-dy, a[1] - lat0], [dy, lat1 - a[1]]]) {
        if (p === 0) {
          if (q < 0) { ok = false; break; }
        } else {
          const r = q / p;
          if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
        }
      }
      if (!ok || t0 > t1) {
        if (cur.length > 1) pieces.push(cur);
        cur = [];
        continue;
      }
      const p0 = [a[0] + t0 * dx, a[1] + t0 * dy], p1 = [a[0] + t1 * dx, a[1] + t1 * dy];
      if (!cur.length || t0 > 0) {
        if (cur.length > 1) pieces.push(cur);
        cur = [p0];
      }
      cur.push(p1);
      if (t1 < 1) { pieces.push(cur); cur = []; }
    }
    if (cur.length > 1) pieces.push(cur);
    return pieces;
  }

  const r3 = (x) => Number(x.toFixed(3)) || 0;   // || 0: no -0 in the output

  function roundPoints(points) {
    const out = [];
    for (const b of points) {
      const r = [r3(b[0]), r3(b[1])];
      const last = out[out.length - 1];
      if (!last || last[0] !== r[0] || last[1] !== r[1]) out.push(r);
    }
    return out;
  }

  function area(p) {
    let s = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) / 2;
  }

  function processLayer(layer, polygon, geojson, box) {
    const features = [];
    for (const f of geojson.features) {
      const geom = f.geometry;
      if (!geom) continue;
      if (polygon) {
        const many = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
        const polygons = [];
        for (const poly of many) {
          const rings = [];
          let dropped = false;
          for (let i = 0; i < poly.length; i++) {
            const r = roundPoints(clipRing(poly[i], box));
            if (r.length >= 3 && area(r) > 0.0005) rings.push(r.concat([r[0]]));
            else if (i === 0) { dropped = true; break; }   // the outer ring vanished: drop the whole polygon
          }
          if (!dropped && rings.length) polygons.push(rings);
        }
        if (polygons.length) features.push({ type: 'Feature', properties: { layer }, geometry: { type: 'MultiPolygon', coordinates: polygons } });
      } else {
        const many = geom.type === 'MultiLineString' ? geom.coordinates : [geom.coordinates];
        const pieces = [];
        for (const line of many) for (const k of clipLine(line, box)) { const r = roundPoints(k); if (r.length > 1) pieces.push(r); }
        if (pieces.length) features.push({ type: 'Feature', properties: { layer }, geometry: { type: 'MultiLineString', coordinates: pieces } });
      }
    }
    return features;
  }

  // The basemap.geojson of a project: every layer of `world` cropped to the places plus `margin`.
  function build(world, placesData, margin) {
    const box = bboxFromPlaces(placesData, margin);
    const features = [];
    for (const [layer, polygon] of LAYERS) {
      const fc = { features: (world[layer] || []).map((geometry) => ({ geometry })) };
      features.push(...processLayer(layer, polygon, fc, box));
    }
    return { type: 'FeatureCollection', features };
  }

  const api = { LAYERS, parseBbox, bboxFromPlaces, clipRing, clipLine, processLayer, build };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).basemap = api;
})(typeof window !== 'undefined' ? window : globalThis);
