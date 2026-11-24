// Engine of the old-style map on a canvas (Mercator over Natural Earth, no tiles and no libraries).
// It handles the basemap, labels, the pen (legs), places, frame, camera (flight, spring, manual pan and zoom).
// It has no playback loop: whoever uses it (map-film.js, story.js) calls `render()` from rAF.
// In the browser `window.ChronicleMap`, in Node `module.exports` (pure functions for tests).
(function (g) {
  'use strict';

  const D2R = Math.PI / 180;
  const R_KM = 6371;

  // ---------- projection (Mercator, unit = radian; y grows downwards) ----------
  const proj = (lat, lon) => [lon * D2R, -Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2))];
  const latZ = (y) => (2 * Math.atan(Math.exp(-y)) - Math.PI / 2) / D2R;
  const inv = (x, y) => [latZ(y), x / D2R];
  const kmPerUnit = (y) => R_KM * Math.cos(latZ(y) * D2R);      // km per unit at the given latitude

  function km(a, b) {
    const dLat = (b[0] - a[0]) * D2R, dLon = (b[1] - a[1]) * D2R;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * D2R) * Math.cos(b[0] * D2R) * Math.sin(dLon / 2) ** 2;
    return 2 * R_KM * Math.asin(Math.sqrt(s));
  }

  // deterministic randomness
  function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  const hash = (str) => { let h = 2166136261; for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

  // ---------- map bounds and camera limits ----------
  // The build writes `bounds` = [south, west, north, east] (degrees) into the map data: the bounding box of
  // the places plus a margin. Without it the whole Mercator world is the limit.
  const WORLD_BOUNDS = [-80, -180, 80, 180];
  function worldBounds(box) {
    const b = Array.isArray(box) && box.length === 4 && box.every(Number.isFinite) ? box : WORLD_BOUNDS;
    const a = proj(b[2], b[1]), c = proj(b[0], b[3]);
    return [a[0], a[1], c[0], c[1]];
  }

  // View {x,y,z} (centre in the world, z = px per unit) adjusted so that the whole bounds ([x0, y0, x1, y1]
  // in world units) stay in view and the view does not wander off them: when the visible rectangle W x H is
  // smaller than the bounds in an axis it stays inside them, otherwise it is centred on them (a tall, narrow
  // panel shows the whole width and a little empty sea above and below). The zoom never goes below "bounds fit".
  function clampView(c, W, H, BOUNDS) {
    const bw = BOUNDS[2] - BOUNDS[0], bh = BOUNDS[3] - BOUNDS[1];
    const z = Math.max(c.z, Math.min(W / bw, H / bh));
    const hw = W / 2 / z, hh = H / 2 / z;
    const fit = (v, lo, hi, half) => (2 * half >= hi - lo ? (lo + hi) / 2 : Math.min(hi - half, Math.max(lo + half, v)));
    return { x: fit(c.x, BOUNDS[0], BOUNDS[2], hw), y: fit(c.y, BOUNDS[1], BOUNDS[3], hh), z };
  }

  // rectangle as [x0,y0,x1,y1] or {x0,y0,x1,y1}
  const rect = (r) => (Array.isArray(r) ? r : [r.x0, r.y0, r.x1, r.y1]);
  // Does a label intersect any place marker (the marker grows by `margin` px)? -> the label is not drawn.
  function collides(label, marks, margin) {
    const o = margin == null ? 4 : margin, p = rect(label);
    return marks.some((mark) => {
      const q = rect(mark);
      return p[0] < q[2] + o && p[2] > q[0] - o && p[1] < q[3] + o && p[3] > q[1] - o;
    });
  }

  // van Wijk & Nuij: smooth flight with zooming out (like d3.interpolateZoom); W = viewport width
  function createFlight(c0, c1, W) {
    const rho = 1.42, r2 = rho * rho, r4 = r2 * r2;
    const w0 = W / c0.z, w1 = W / c1.z;
    const ux0 = c0.x, uy0 = c0.y;
    const dx = c1.x - ux0, dy = c1.y - uy0, d2 = dx * dx + dy * dy;
    let i, S_;
    if (d2 < 1e-14) {
      S_ = Math.log(w1 / w0) / rho;
      i = (t) => ({ x: ux0 + t * dx, y: uy0 + t * dy, z: W / (w0 * Math.exp(rho * t * S_)) });
    } else {
      const d1 = Math.sqrt(d2);
      const b0 = (w1 * w1 - w0 * w0 + r4 * d2) / (2 * w0 * r2 * d1);
      const b1 = (w1 * w1 - w0 * w0 - r4 * d2) / (2 * w1 * r2 * d1);
      const q0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), q1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
      S_ = (q1 - q0) / rho;
      i = (t) => {
        const s = t * S_, what = Math.cosh(q0), u = w0 / (r2 * d1) * (what * Math.tanh(rho * s + q0) - Math.sinh(q0));
        return { x: ux0 + u * dx, y: uy0 + u * dy, z: W / (w0 * what / Math.cosh(rho * s + q0)) };
      };
    }
    return { i, duration: Math.min(4.2, Math.max(0.9, Math.abs(S_) * 0.95)) };
  }

  // Bezier arc between world points a, b (k = bend, + slight hand tremor). -> {points, seeds}
  function bezierArc(a, b, k, seed) {
    const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
    const nx = -dy / d, ny = dx / d;
    const r = rng(hash(seed));
    const c1 = [a[0] + dx * .28 + nx * d * k * 1.15, a[1] + dy * .28 + ny * d * k * 1.15];
    const c2 = [a[0] + dx * .74 + nx * d * k * .8, a[1] + dy * .74 + ny * d * k * .8];
    const N = 90, points = [], f1 = r() * 6, f2 = r() * 6;
    for (let i = 0; i <= N; i++) {
      const u = i / N, v = 1 - u;
      const x = v * v * v * a[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * b[0];
      const y = v * v * v * a[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * b[1];
      const chv = Math.sin(u * Math.PI) * d * 0.006 * (Math.sin(u * 17 + f1) + .5 * Math.sin(u * 41 + f2));
      points.push([x + nx * chv, y + ny * chv]);
    }
    return { points, seeds: [r() * 6, r() * 6] };
  }

  const hexA = (hex, a) => {
    const h6 = /^#[0-9a-f]{3}$/i.test(hex) ? '#' + [...hex.slice(1)].map((c) => c + c).join('') : hex;
    const n = parseInt(h6.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };
  const SEA = '#d9d8c1', LAND_COLOR = '#f1e7cd', NEUTRAL = '#6a5640';
  const values = (m) => (m instanceof Map ? m : new Map(Object.entries(m || {})));

  // ================================================================
  // create(canvas, { basemap, places, language, strings, color?, onManual?, manual? }) -> Map
  //  basemap  GeoJSON (the build's basemap file), places = all clusters (Film), strings = the page language's strings
  // ================================================================
  function create(cv, options) {
    options = options || {};
    const ctxMain = cv.getContext('2d');
    let ctx = ctxMain;
    const P = options.strings || {};
    const mapData = options.map || {};
    const BOUNDS = worldBounds(mapData.bounds);
    const mapLabels = (Array.isArray(mapData.labels) ? mapData.labels : []).map((l) => ({
      kind: l.kind, lat: l.lat, lon: l.lon,
      text: (l.text && typeof l.text === 'object' ? (l.text[options.language] || Object.values(l.text)[0]) : l.text) || '',
    })).filter((l) => l.text && Number.isFinite(l.lat) && Number.isFinite(l.lon));
    const branchColor = options.color || ((v) => (g.Chronicle && g.Chronicle.color ? g.Chronicle.color(v) : NEUTRAL));
    const RM = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    const noAnimation = typeof options.noAnimation === 'function' ? options.noAnimation : () => !!RM.matches;

    let W = 1280, H = 800, DPR = 1;
    const cam = { x: 0, y: 0, z: 1 };           // z = px per unit
    const velocity = { x: 0, y: 0, lz: 0 };
    let flight = null;                            // running flight {i, duration, t, target, res}
    let followTarget = null;                         // spring target {target:{x,y,z}, omega}
    let manual = false;                          // the user drags / zooms -> the camera does not follow
    let speed = 1;
    let free = null;                           // free area {x0,y0,x1,y1} outside the card and the controls
    let controlsTop = null;                     // y of the top edge of the controls (mobile: scale and year are above it)
    let placesAll = (options.places || []).slice();
    let placesShown = [], placeColors = new Map(), highlight = new Set();
    let legs = [], legInfo = new Map();
    let light = 0, filmYearAlpha = 0, activeCur = null;
    let cache = null, cacheVersion = 0;
    const occupied = [];                        // rectangles of the labels in the frame (text collisions)

    const basemap = prepareBasemap(options.basemap);

    // ---------- basemap ----------
    function prepareBasemap(geo) {
      const land = new Path2D(), borders = new Path2D(), rivers = new Path2D(), lakes = new Path2D();
      const add = (p, ring, close) => {
        ring.forEach(([lon, lat], i) => { const [x, y] = proj(lat, lon); i ? p.lineTo(x, y) : p.moveTo(x, y); });
        if (close) p.closePath();
      };
      for (const f of (geo && geo.features) || []) {
        const target = { land, borders, rivers, lakes }[f.properties.layer], gm = f.geometry;
        if (!target) continue;
        if (gm.type === 'MultiPolygon') gm.coordinates.forEach((poly) => poly.forEach((r) => add(target, r, true)));
        else if (gm.type === 'Polygon') gm.coordinates.forEach((r) => add(target, r, true));
        else if (gm.type === 'MultiLineString') gm.coordinates.forEach((l) => add(target, l, false));
        else if (gm.type === 'LineString') add(target, gm.coordinates, false);
      }
      return { land, borders, rivers, lakes, blotches: createBlotches(), pattern: null };
    }
    // low-frequency "watercolour" blotches on the land: a pattern anchored in the world
    function createBlotches() {
      const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
      const gx = c.getContext('2d'), img = gx.createImageData(N, N);
      const r = rng(11), grid = (n) => Array.from({ length: n * n }, r);
      const octaves = [[6, 1], [12, .5], [24, .25]].map(([n, a]) => ({ n, a, m: grid(n) }));
      const smooth = (t) => t * t * (3 - 2 * t);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let v = 0;
        for (const o of octaves) {
          const fx = x / N * o.n, fy = y / N * o.n, ix = Math.floor(fx), iy = Math.floor(fy);
          const tx = smooth(fx - ix), ty = smooth(fy - iy);
          const q = (a, b) => o.m[((b % o.n + o.n) % o.n) * o.n + ((a % o.n + o.n) % o.n)];
          v += o.a * ((q(ix, iy) * (1 - tx) + q(ix + 1, iy) * tx) * (1 - ty) + (q(ix, iy + 1) * (1 - tx) + q(ix + 1, iy + 1) * tx) * ty);
        }
        v /= 1.75;
        const i = (y * N + x) * 4;
        img.data[i] = 150; img.data[i + 1] = 112; img.data[i + 2] = 58;
        img.data[i + 3] = Math.max(0, (v - .38)) * 120;
      }
      gx.putImageData(img, 0, 0);
      return c;
    }

    // ---------- pen legs ----------
    function prepareLegs() {
      legInfo = new Map();
      const group = {}, firstOfGroup = {};
      const valid = legs.filter((t) => t && t.from && t.to && t.from !== t.to && t.from.coords && t.to.coords);
      // parallel legs (same start, nearby target, same year) fan out
      for (const t of valid) {
        const kl = `${t.from.id}:${Math.round(t.to.coords[0] * 4)}:${Math.round(t.to.coords[1] * 4)}:${t.year}`;
        const i = { t, order: (group[kl] = (group[kl] || 0) + 1) - 1, first: null, side: 1 };
        if (!i.order) firstOfGroup[kl] = i; else i.first = firstOfGroup[kl];
        legInfo.set(t.id, i);
      }
      for (const t of valid) {
        const i = legInfo.get(t.id);
        const a = proj(t.from.coords[0], t.from.coords[1]), b = proj(t.to.coords[0], t.to.coords[1]);
        const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
        const nx = -dy / d, ny = dx / d;
        // side of the bend: the one where the arc does not run over other family places
        const others = placesAll.filter((m) => m.id !== t.from.id && m.id !== t.to.id).map((m) => proj(m.coords[0], m.coords[1]));
        const score = (k) => {
          let min = 1e9;
          for (let n = 2; n <= 18; n++) {
            const u = n / 20, v = 1 - u;
            const c1x = a[0] + dx * .28 + nx * d * k * 1.15, c1y = a[1] + dy * .28 + ny * d * k * 1.15;
            const c2x = a[0] + dx * .74 + nx * d * k * .8, c2y = a[1] + dy * .74 + ny * d * k * .8;
            const x = v * v * v * a[0] + 3 * v * v * u * c1x + 3 * v * u * u * c2x + u * u * u * b[0];
            const y = v * v * v * a[1] + 3 * v * v * u * c1y + 3 * v * u * u * c2y + u * u * u * b[1];
            for (const [px, py] of others) min = Math.min(min, Math.hypot(px - x, py - y));
          }
          return min;
        };
        const baseK = 0.16 + 0.035 * i.order;
        let side = dx >= 0 ? 1 : -1;
        if (!i.order && score(-baseK * side) > score(baseK * side) * 1.35) side = -side;
        if (i.order && i.first) side = i.first.side || side;
        i.side = side;
        const o = bezierArc(a, b, baseK * side, t.id + (t.traveller || ''));
        i.points = o.points; i.seeds = o.seeds; i.km = km(t.from.coords, t.to.coords);
      }
    }
    const legProgress = (progress, id) => {
      const p = progress instanceof Map ? progress.get(id) : progress && progress[id];
      return p || 0;
    };

    // ---------- camera ----------
    const freeArea = () => free || { x0: 0, y0: 0, x1: W, y1: H };
    const mobile = () => W <= 760;
    const kmPerPx = () => kmPerUnit(cam.y) / cam.z;
    const stopKm = () => (mobile() ? 0.55 : 0.42);      // km per pixel at a stop

    // bb in the world -> view {x,y,z} so that bb is in the middle of the free area
    function frame(bb, o) {
      o = o || {};
      const f = freeArea(), margin = o.margin == null ? 0.16 : o.margin;
      const fw = (f.x1 - f.x0) * (1 - 2 * margin), fh = (f.y1 - f.y0) * (1 - 2 * margin);
      const bw = Math.max(bb[2] - bb[0], 1e-6), bh = Math.max(bb[3] - bb[1], 1e-6);
      let z = Math.min(fw / bw, fh / bh);
      const cy = (bb[1] + bb[3]) / 2, kj = kmPerUnit(cy);
      if (o.maxKmPx) z = Math.max(z, kj / o.maxKmPx);        // zoom out as far as
      if (o.minKmPx) z = Math.min(z, kj / o.minKmPx);        // zoom in as far as
      const cx = (bb[0] + bb[2]) / 2;
      return { x: cx - ((f.x0 + f.x1) / 2 - W / 2) / z, y: cy - ((f.y0 + f.y1) / 2 - H / 2) / z, z };
    }
    const bboxOfPoints = (pts) => {
      const bb = [1e9, 1e9, -1e9, -1e9];
      for (const [x, y] of pts) { bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y); }
      return bb;
    };
    const expandBb = (bb, kmRange) => { const u = kmRange / kmPerUnit((bb[1] + bb[3]) / 2); return [bb[0] - u, bb[1] - u, bb[2] + u, bb[3] + u]; };
    const world = (lat, lon) => proj(lat, lon);
    const coords = (m) => proj(m.coords[0], m.coords[1]);

    function viewStop(m, legsOf) {
      const pts = [coords(m)];
      for (const t of legsOf || []) { const i = legInfo.get(t.id); if (i && i.km < 260) pts.push(coords(t.from)); }
      return frame(expandBb(bboxOfPoints(pts), 45), { maxKmPx: 2.2, minKmPx: stopKm() });
    }
    // surroundings of places and leg starts; o = {expandKm, maxKmPx, minKmPx, margin} (chapter 60/4.5/0.9/0.12, whole 50/6/0.6/0.06)
    function viewOn(clusters, legsOf, o) {
      o = o || {};
      const pts = [];
      for (const m of clusters || []) pts.push(coords(m));
      for (const t of legsOf || []) pts.push(coords(t.from));
      if (!pts.length) return { x: cam.x, y: cam.y, z: cam.z };
      return frame(expandBb(bboxOfPoints(pts), o.expandKm == null ? 50 : o.expandKm), o);
    }
    // pen: a window around the tip (a bit back, a bit ahead): the camera moves with the pen and zooms out on long routes
    function viewPen(legsOf, progress) {
      const pts = [];
      for (const t of legsOf || []) {
        const inf = legInfo.get(t.id);
        if (!inf) continue;
        const p = legProgress(progress, t.id), n = inf.points.length - 1, i = Math.round(p * n);
        const step = Math.max(1, Math.round(n * Math.min(1, 230 / inf.km)));
        const back = Math.round(n * Math.min(1, 170 / inf.km));
        for (let j = Math.max(0, i - back); j <= Math.min(n, i + step); j += 3) pts.push(inf.points[j]);
        pts.push(inf.points[i]);
        if ((1 - p) * inf.km < 220) pts.push(inf.points[n]);
      }
      if (!pts.length) return { x: cam.x, y: cam.y, z: cam.z };
      return frame(expandBb(bboxOfPoints(pts), 25), { maxKmPx: 3.2, minKmPx: stopKm() });
    }

    const asView = (target, o) => (Array.isArray(target) ? frame(target, o) : target);
    function setCamera(c) { cam.x = c.x; cam.y = c.y; cam.z = c.z; velocity.x = velocity.y = velocity.lz = 0; }
    function cancelFlight(result) { if (flight) { const r = flight.res; flight = null; r(result); } }
    function spring(target, dt, omega) {
      // critically damped spring in x, y and log(z)
      const k = omega * omega, c = 2 * omega;
      const lz = Math.log(cam.z), clz = Math.log(target.z);
      const ax = k * (target.x - cam.x) - c * velocity.x, ay = k * (target.y - cam.y) - c * velocity.y, az = k * (clz - lz) - c * velocity.lz;
      velocity.x += ax * dt; velocity.y += ay * dt; velocity.lz += az * dt;
      cam.x += velocity.x * dt; cam.y += velocity.y * dt; cam.z = Math.exp(lz + velocity.lz * dt);
    }
    function cameraStep(dt) {
      if (manual) return;
      if (flight) {
        flight.t += dt * Math.max(1, speed * .8);
        const u = Math.min(1, flight.t / flight.duration);
        const e = u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        const c = flight.i(e); setCamera(c);
        if (u >= 1) cancelFlight(true);
        return;
      }
      if (!followTarget) return;
      if (noAnimation()) return setCamera(followTarget.target);
      spring(followTarget.target, Math.min(dt, 1 / 30), followTarget.omega);
    }
    function clampCamera() { setCameraRaw(clampView(cam, W, H, BOUNDS)); }
    function setCameraRaw(c) { cam.x = c.x; cam.y = c.y; cam.z = c.z; }   // without resetting the spring velocity

    // ---------- drawing ----------
    const toScreenPx = (x, y) => [(x - cam.x) * cam.z + W / 2, (y - cam.y) * cam.z + H / 2];
    const worldTransform = () => ctx.setTransform(DPR * cam.z, 0, 0, DPR * cam.z, DPR * (W / 2 - cam.x * cam.z), DPR * (H / 2 - cam.y * cam.z));

    function drawBasemap() {
      const z = cam.z, px = 1 / z;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.fillStyle = SEA; ctx.fillRect(0, 0, W, H);
      worldTransform();
      // water lines along the coast (concentric ripples as on engraved maps)
      ctx.lineJoin = 'round';
      for (let i = 6; i >= 1; i--) {
        const w = i * 6.5;
        ctx.lineWidth = w * px; ctx.strokeStyle = `rgba(92, 104, 96, ${0.16 + 0.03 * (6 - i)})`; ctx.stroke(basemap.land);
        ctx.lineWidth = (w - 1.1) * px; ctx.strokeStyle = SEA; ctx.stroke(basemap.land);
      }
      ctx.lineWidth = 3 * px; ctx.strokeStyle = 'rgba(120, 128, 112, .35)'; ctx.stroke(basemap.land);
      // land
      ctx.fillStyle = LAND_COLOR; ctx.fill(basemap.land);
      if (!basemap.pattern) basemap.pattern = ctx.createPattern(basemap.blotches, 'repeat');
      basemap.pattern.setTransform(new DOMMatrix().scaleSelf(0.00085, 0.00085));
      ctx.fillStyle = basemap.pattern; ctx.fill(basemap.land);
      // hand-coloured coast rim inside the land
      ctx.save(); ctx.clip(basemap.land);
      ctx.lineWidth = 9 * px; ctx.strokeStyle = 'rgba(176, 140, 82, .14)'; ctx.stroke(basemap.land);
      ctx.lineWidth = 3.5 * px; ctx.strokeStyle = 'rgba(150, 116, 62, .16)'; ctx.stroke(basemap.land);
      ctx.restore();
      ctx.lineWidth = 1.05 * px; ctx.strokeStyle = 'rgba(88, 74, 52, .75)'; ctx.stroke(basemap.land);
      // lakes
      ctx.fillStyle = SEA; ctx.fill(basemap.lakes);
      ctx.lineWidth = .8 * px; ctx.strokeStyle = 'rgba(88, 90, 80, .6)'; ctx.stroke(basemap.lakes);
      // borders: coloured band + dash-dot line
      ctx.lineWidth = 6 * px; ctx.strokeStyle = 'rgba(176, 104, 84, .085)'; ctx.stroke(basemap.borders);
      ctx.setLineDash([6 * px, 2.5 * px, 1.2 * px, 2.5 * px]);
      ctx.lineWidth = .95 * px; ctx.strokeStyle = 'rgba(112, 88, 62, .62)'; ctx.stroke(basemap.borders);
      ctx.setLineDash([]);
      // rivers
      ctx.lineCap = 'round';
      ctx.lineWidth = 2.6 * px; ctx.strokeStyle = 'rgba(160, 176, 170, .28)'; ctx.stroke(basemap.rivers);
      ctx.lineWidth = 1.0 * px; ctx.strokeStyle = 'rgba(78, 104, 112, .7)'; ctx.stroke(basemap.rivers);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    function gridParams() {
      const kmpp = kmPerPx();
      const step = kmpp > 2.4 ? 5 : kmpp > 0.9 ? 2 : kmpp > 0.45 ? 1 : 0.5;
      return { step, lat0: latZ(cam.y + H / 2 / cam.z), lat1: latZ(cam.y - H / 2 / cam.z),
        lon0: (cam.x - W / 2 / cam.z) / D2R, lon1: (cam.x + W / 2 / cam.z) / D2R };
    }
    function drawGrid(grid) {
      ctx.save();
      ctx.strokeStyle = 'rgba(110, 86, 58, .17)'; ctx.lineWidth = .8; ctx.setLineDash([1.5, 4]);
      ctx.beginPath();
      for (let lo = Math.ceil(grid.lon0 / grid.step) * grid.step; lo <= grid.lon1; lo += grid.step) { const [x] = toScreenPx(lo * D2R, 0); ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let la = Math.ceil(grid.lat0 / grid.step) * grid.step; la <= grid.lat1; la += grid.step) { const [, y] = toScreenPx(0, proj(la, 0)[1]); ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
      ctx.restore();
    }

    // Text with optional collision handling: opt.avoid = do not draw over labels already drawn in the frame,
    // opt.marks = {hard, soft}: nothing is drawn over "hard" (medallion of the active stop), a collision with "soft"
    // (dots of the drawn places) the label avoids by moving up/down, or stays; each needs opt.height.
    function text(t, x, y, font, colorT, opt) {
      opt = opt || {};
      ctx.font = font; ctx.letterSpacing = opt.tracking || '0px';
      ctx.textAlign = opt.align || 'center'; ctx.textBaseline = 'middle';
      if (opt.avoid || opt.marks) {
        const wd = ctx.measureText(t).width;
        const x0 = opt.align === 'left' ? x : opt.align === 'right' ? x - wd : x - wd / 2;
        const r = [x0 - 3, y - opt.height / 2, x0 + wd + 3, y + opt.height / 2];
        if (opt.marks) {
          if (collides(r, opt.marks.hard)) { ctx.letterSpacing = '0px'; return false; }
          if (collides(r, opt.marks.soft)) {          // a dot in the way: shift up/down, otherwise the label stays
            for (const k of [-1, 1, -2, 2, -3, 3]) {
              const dy = k * opt.height * .9, r2 = [r[0], r[1] + dy, r[2], r[3] + dy];
              if (!collides(r2, opt.marks.soft) && !collides(r2, opt.marks.hard)) { y += dy; break; }
            }
          }
        }
        if (opt.avoid) {
          if (collides(r, occupied, 0)) { ctx.letterSpacing = '0px'; return false; }
          occupied.push(r);
        }
      }
      if (opt.halo) { ctx.lineWidth = opt.halo; ctx.strokeStyle = opt.haloColor || 'rgba(244, 236, 216, .9)'; ctx.lineJoin = 'round'; ctx.strokeText(t, x, y); }
      ctx.fillStyle = colorT; ctx.fillText(t, x, y);
      ctx.letterSpacing = '0px';
      return true;
    }

    // Markers of the places drawn right now: hard = medallion of the active stop (labels are not drawn over it),
    // soft = dots of the other shown places (a country/region label moves away from them or stays).
    function placeMarks() {
      const markRect = (m, r) => { const [x, y] = toScreenPx(...coords(m)); return [x - r, y - r, x + r, y + r]; };
      const visible = (q) => q[2] > -40 && q[0] < W + 40 && q[3] > -40 && q[1] < H + 40;
      return { soft: placesShown.map((m) => markRect(m, 8)).filter(visible), hard: activeCur ? [markRect(activeCur, 26)] : [] };
    }
    // Labels come from the map data (config `map_labels`): region = spaced capitals, ridge = small italic
    // capitals; towns are drawn by drawCities().
    function drawLabels() {
      const kmpp = kmPerPx(), marks = placeMarks();
      const f = Math.max(.78, Math.min(1.45, Math.pow(1.1 / kmpp, 0.3)));
      for (const { kind, text: t, lat, lon } of mapLabels) {
        if (kind !== 'region' && kind !== 'ridge') continue;
        const p = proj(lat, lon), [x, y] = toScreenPx(p[0], p[1]);
        if (x < -200 || x > W + 200 || y < -50 || y > H + 50) continue;
        if (kind === 'region') {
          const a = kmpp < 0.5 ? .42 : .62, v = Math.round(15 * f);
          text(t.toUpperCase(), x, y, `500 ${v}px "EB Garamond"`, `rgba(92, 70, 46, ${a})`,
            { tracking: `${(5 * f).toFixed(1)}px`, halo: 0, marks, height: v * 1.2 });
        } else {
          const v = Math.round(11.5 * f);
          text(t.toUpperCase(), x, y, `italic 400 ${v}px "EB Garamond"`, 'rgba(96, 74, 48, .7)',
            { tracking: `${(4.5 * f).toFixed(1)}px`, marks, height: v * 1.2 });
        }
      }
    }

    // static layer (sea, land, borders, rivers, grid, labels) -> offscreen canvas
    function cacheCanvas() {
      if (!cache) cache = { cv: document.createElement('canvas'), x: 0, y: 0, z: 0, W: 0, H: 0, DPR: 0, version: -1 };
      const c = cache;
      if (c.W === W && c.H === H && c.DPR === DPR && c.version === cacheVersion && c.z === cam.z
          && Math.abs(c.x - cam.x) * cam.z <= 0.5 && Math.abs(c.y - cam.y) * cam.z <= 0.5) return c;
      if (c.cv.width !== Math.round(W * DPR) || c.cv.height !== Math.round(H * DPR)) { c.cv.width = Math.round(W * DPR); c.cv.height = Math.round(H * DPR); }
      ctx = c.cv.getContext('2d');
      drawBasemap();
      drawGrid(gridParams());
      drawLabels();
      ctx = ctxMain;
      Object.assign(c, { x: cam.x, y: cam.y, z: cam.z, W, H, DPR, version: cacheVersion });
      return c;
    }

    function drawCities() {
      const kmpp = kmPerPx();
      if (kmpp > 2.6) return;
      const familyPlaces = placesAll.map((m) => m.coords);
      const list = mapLabels.filter((l) => l.kind === 'town' && !familyPlaces.some((r) => km(r, [l.lat, l.lon]) < 9));
      for (const { text: n, lat: la, lon: lo } of list) {
        const a = Math.min(1, (2.6 - kmpp) / .8);
        const p = proj(la, lo), [x, y] = toScreenPx(p[0], p[1]);
        if (x < -50 || x > W + 50 || y < -50 || y > H + 50) continue;
        ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(241,231,205,${a})`; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = `rgba(90, 72, 50, ${.7 * a})`; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 1.1, 0, Math.PI * 2); ctx.fillStyle = `rgba(90, 72, 50, ${.8 * a})`; ctx.fill();
        text(n, x + 7, y - 1, 'italic 400 13.5px "EB Garamond"', `rgba(96, 80, 60, ${.75 * a})`, { align: 'left', halo: 3, avoid: true, height: 14 });
      }
    }

    // ink ribbon of variable width (pen pressure), optionally dashed
    function ribbon(pts, cumul, pathLen, width, colorS, dashes, seeds) {
      if (pathLen <= 0.5) return null;
      const Pp = [], U = [];
      for (let i = 0; i < pts.length; i++) {
        if (cumul[i] <= pathLen) { Pp.push(pts[i]); U.push(cumul[i]); continue; }
        const t = (pathLen - cumul[i - 1]) / (cumul[i] - cumul[i - 1]);
        Pp.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]); U.push(pathLen);
        break;
      }
      if (Pp.length < 2) return null;
      const total = cumul[cumul.length - 1];
      const L = [], R = [];
      for (let i = 0; i < Pp.length; i++) {
        const a = Pp[Math.max(0, i - 1)], b = Pp[Math.min(Pp.length - 1, i + 1)];
        let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const n = Math.hypot(nx, ny) || 1; nx /= n; ny /= n;
        const u = U[i] / total;
        const pressure = .84 + .13 * Math.sin(u * 9 + seeds[0]) + .07 * Math.sin(u * 23 + seeds[1]);
        const ramp = Math.min(1, .5 + U[i] / 16);               // pen attack
        const w = width * pressure * ramp / 2;
        L.push([Pp[i][0] + nx * w, Pp[i][1] + ny * w]); R.push([Pp[i][0] - nx * w, Pp[i][1] - ny * w]);
      }
      ctx.fillStyle = colorS;
      if (!dashes) {
        ctx.beginPath(); ctx.moveTo(L[0][0], L[0][1]);
        for (let i = 1; i < L.length; i++) ctx.lineTo(L[i][0], L[i][1]);
        for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
        ctx.closePath(); ctx.fill();
      } else {
        const ON = Math.max(7, width * 2.6), OFF = Math.max(5, width * 1.9), per = ON + OFF;
        ctx.beginPath();
        let i = 0;
        while (i < Pp.length - 1) {
          if (U[i] % per >= ON) { i++; continue; }
          const st = i; while (i < Pp.length - 1 && U[i + 1] % per < ON && U[i + 1] - U[st] < ON) i++;
          if (i === st) { i++; continue; }
          ctx.moveTo(L[st][0], L[st][1]);
          for (let k = st + 1; k <= i; k++) ctx.lineTo(L[k][0], L[k][1]);
          for (let k = i; k >= st; k--) ctx.lineTo(R[k][0], R[k][1]);
          ctx.closePath();
          i++;
        }
        ctx.fill();
      }
      return Pp[Pp.length - 1];
    }

    function drawLegs(progress, dim) {
      const kmpp = kmPerPx();
      const base = Math.max(2.4, Math.min(5, 3.7 * Math.pow(0.6 / kmpp, 0.22)));
      const tips = [];
      for (const t of legs) {
        const inf = legInfo.get(t.id), p = legProgress(progress, t.id);
        if (!inf || p <= 0) continue;
        const pts = inf.points.map(([x, y]) => toScreenPx(x, y));
        const cumul = [0];
        for (let i = 1; i < pts.length; i++) cumul.push(cumul[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        const pathLen = cumul[cumul.length - 1] * Math.min(1, p);
        const b = branchColor(t.branch);
        const dimFactor = dim.has(t.id) ? .42 : 1;
        const wd = base * (t.secondary ? .62 : t.generational ? .75 : 1);
        const dashes = t.uncertain || ((t.secondary || t.generational) && t.certainty !== 'document');
        ctx.save();
        ctx.globalAlpha = dimFactor;
        // light paper rim so that the ink stands out from the basemap
        if (!dashes) {
          ctx.globalAlpha = dimFactor * .75; ribbon(pts, cumul, pathLen, wd + 4, 'rgba(250, 244, 226, 1)', false, inf.seeds);
          ctx.globalAlpha = dimFactor * .2; ribbon(pts, cumul, pathLen, wd * 3.2, b, false, inf.seeds);
          ctx.globalAlpha = dimFactor;
        }
        // ink with a shadow
        ctx.shadowColor = 'rgba(60, 38, 14, .38)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1.4;
        ribbon(pts, cumul, pathLen, wd, b, dashes, inf.seeds);
        ctx.shadowColor = 'transparent';
        // initial drop of ink
        ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], wd * .75, 0, Math.PI * 2); ctx.fillStyle = b; ctx.fill();
        ctx.restore();
        // wet ink at the tip
        if (p < 1) {
          const piece = Math.min(70, pathLen);
          const tip = ribbon(pts, cumul, pathLen, 0.001, b, false, inf.seeds);
          let i = 1; while (i < cumul.length - 1 && cumul[i] < pathLen) i++;
          const fromT = Math.max(0, pathLen - piece);
          ctx.save();
          ctx.globalAlpha = .55;
          ctx.beginPath();
          let first = true;
          for (let j = 0; j < pts.length && cumul[j] <= pathLen; j++) {
            if (cumul[j] < fromT) continue;
            first ? ctx.moveTo(pts[j][0], pts[j][1]) : ctx.lineTo(pts[j][0], pts[j][1]); first = false;
          }
          if (tip) ctx.lineTo(tip[0], tip[1]);
          const gr = tip ? ctx.createLinearGradient(pts[Math.max(0, i - 6)][0], pts[Math.max(0, i - 6)][1], tip[0], tip[1]) : null;
          if (gr) { gr.addColorStop(0, 'rgba(30,18,8,0)'); gr.addColorStop(1, 'rgba(30,18,8,.65)'); ctx.strokeStyle = gr; }
          ctx.lineWidth = wd * .55; ctx.lineCap = 'round'; ctx.stroke();
          ctx.restore();
          if (tip) tips.push([tip, b, wd, t, pts[Math.max(0, i - 4)], p]);
        }
      }
      const names = new Set();
      for (const [h, b, wd, t, back, p] of tips) {
        const gr = ctx.createRadialGradient(h[0], h[1], 0, h[0], h[1], 16);
        gr.addColorStop(0, 'rgba(255, 244, 214, .9)'); gr.addColorStop(.25, hexA(b, .45)); gr.addColorStop(1, hexA(b, 0));
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(h[0], h[1], 16, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2a1a0c'; ctx.beginPath(); ctx.arc(h[0], h[1], wd * .62, 0, Math.PI * 2); ctx.fill();
        // traveller's name and "year of departure -> year of the stop" by the pen
        const pname = t.traveller || '';
        if (!pname || names.has(pname) || p < .06 || p > .97) continue;
        names.add(pname);
        const a = Math.min(1, (p - .06) / .08, (.97 - p) / .08);
        let nx = -(h[1] - back[1]), ny = h[0] - back[0]; const n = Math.hypot(nx, ny) || 1; nx /= n; ny /= n;
        if (ny > 0) { nx = -nx; ny = -ny; }
        const x = h[0] + nx * 22, y = h[1] + ny * 22, align = nx < -.3 ? 'right' : nx > .3 ? 'left' : 'center';
        ctx.save(); ctx.globalAlpha = a;
        text(pname, x, y, 'italic 500 15px "EB Garamond"', hexA(b, 1), { align: align, halo: 4, haloColor: 'rgba(246, 238, 218, .95)' });
        if (t.yearFrom) text(`${t.yearFrom} → ${t.year}`, x, y + 15, 'italic 400 12.5px "EB Garamond"', 'rgba(80, 62, 42, .85)', { align: align, halo: 3, haloColor: 'rgba(246, 238, 218, .95)' });
        ctx.restore();
      }
    }

    // family places: medallion with a pulse at the active stop, smaller markers for the other shown places
    function drawPlaces(time, o) {
      const active = o.activePlace || null;
      const list = placesShown.filter((m) => !active || m.id !== active.id);
      const placeColor = (m) => placeColors.get(m.id) || NEUTRAL;
      if (active) {   // the active label first (it has priority in collisions)
        const [x, y] = toScreenPx(...coords(active));
        occupied.push([x - 16, y - 16, x + 16, y + 16]);
        const onLeft = x > (freeArea().x1 - 180);
        text(active.name, onLeft ? x - 20 : x + 20, y - 2, 'italic 600 21px "EB Garamond"', '#2f2216',
          { align: onLeft ? 'right' : 'left', halo: 5, haloColor: 'rgba(244, 236, 216, .92)', avoid: true, height: 24 });
      }
      const visible = list.filter((m) => { const [x, y] = toScreenPx(...coords(m)); return x > -30 && x < W + 30 && y > -30 && y < H + 30; });
      for (const m of visible) {
        const [x, y] = toScreenPx(...coords(m)), b = placeColor(m), highlighted = highlight.has(m.id);
        if (highlighted) { ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.lineWidth = 1.6; ctx.strokeStyle = hexA(b, .55); ctx.stroke(); }
        ctx.beginPath(); ctx.arc(x, y, 5.2, 0, Math.PI * 2); ctx.fillStyle = '#faf3e0'; ctx.fill();
        ctx.lineWidth = 1.8; ctx.strokeStyle = b; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fillStyle = b; ctx.fill();
        occupied.push([x - 6, y - 6, x + 6, y + 6]);
      }
      for (const m of visible) {
        const [x, y] = toScreenPx(...coords(m)), highlighted = highlight.has(m.id);
        const font = `italic ${highlighted ? 600 : 500} 15px "EB Garamond"`;
        if (!text(m.name, x + 9, y - 1, font, 'rgba(52, 40, 26, .9)', { align: 'left', halo: 3.5, avoid: true, height: 16 }))
          text(m.name, x - 9, y - 1, font, 'rgba(52, 40, 26, .9)', { align: 'right', halo: 3.5, avoid: true, height: 16 });
      }
      if (active) {
        const [x, y] = toScreenPx(...coords(active));
        const b = o.activeColor || placeColor(active);
        const tt = Math.max(0, o.activeT || 0);
        const entrance = noAnimation() ? 1 : Math.min(1, tt / .55);
        const pulse = noAnimation() ? 1 : 1 + Math.sin(Math.min(1, tt / .55) * Math.PI) * .25;
        if (!noAnimation()) for (let k = 0; k < 3; k++) {         // pulse
          const f = ((tt * .55 + k / 3) % 1);
          ctx.beginPath(); ctx.arc(x, y, 10 + f * 34, 0, Math.PI * 2);
          ctx.lineWidth = 2 * (1 - f); ctx.strokeStyle = hexA(b, .55 * (1 - f) * entrance); ctx.stroke();
        }
        const r = 13 * entrance * pulse;
        ctx.save();
        ctx.shadowColor = 'rgba(50, 30, 10, .35)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = '#fbf5e4'; ctx.fill();
        ctx.restore();
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.lineWidth = 2.6; ctx.strokeStyle = b; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, r * .62, 0, Math.PI * 2); ctx.lineWidth = .8; ctx.strokeStyle = hexA(b, .6); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, r * .36, 0, Math.PI * 2); ctx.fillStyle = b; ctx.fill();
      }
    }

    // map frame with degree ticks and the scale
    function drawFrame(grid, scale) {
      const mob = mobile(), m = mob ? 5 : 10, b = mob ? 4 : 6;
      ctx.save();
      ctx.fillStyle = 'rgba(236, 224, 194, 1)';       // paper margin outside the frame
      ctx.fillRect(0, 0, W, m); ctx.fillRect(0, H - m, W, m); ctx.fillRect(0, 0, m, H); ctx.fillRect(W - m, 0, m, H);
      ctx.strokeStyle = '#4b3c2b'; ctx.lineWidth = 1.2;
      ctx.strokeRect(m + .5, m + .5, W - 2 * m - 1, H - 2 * m - 1);
      ctx.lineWidth = .6; ctx.strokeRect(m + b + .5, m + b + .5, W - 2 * (m + b) - 1, H - 2 * (m + b) - 1);
      // alternating ticks at half the grid step
      const halfStep = grid.step / 2;
      ctx.fillStyle = '#4b3c2b';
      let i = Math.floor(grid.lon0 / halfStep);
      for (let lo = i * halfStep; lo <= grid.lon1 + halfStep; lo += halfStep, i++) {
        if (i % 2) continue;
        const [x0] = toScreenPx(lo * D2R, 0), [x1] = toScreenPx((lo + halfStep) * D2R, 0);
        const a = Math.max(m + b, x0), z = Math.min(W - m - b, x1);
        if (z > a) { ctx.fillRect(a, m + 1, z - a, b - 1); ctx.fillRect(a, H - m - b, z - a, b - 1); }
      }
      i = Math.floor(grid.lat0 / halfStep);
      for (let la = i * halfStep; la <= grid.lat1 + halfStep; la += halfStep, i++) {
        if (i % 2) continue;
        const [, y0] = toScreenPx(0, proj(la, 0)[1]), [, y1] = toScreenPx(0, proj(la + halfStep, 0)[1]);
        const a = Math.max(m + b, Math.min(y0, y1)), z = Math.min(H - m - b, Math.max(y0, y1));
        if (z > a) { ctx.fillRect(m + 1, a, b - 1, z - a); ctx.fillRect(W - m - b, a, b - 1, z - a); }
      }
      // degrees
      if (!mob) {
        ctx.font = 'italic 400 11.5px "EB Garamond"'; ctx.fillStyle = 'rgba(75, 60, 43, .8)'; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
        const tmpl = P.degrees_east || '{n}°';
        for (let lo = Math.ceil(grid.lon0 / grid.step) * grid.step; lo <= grid.lon1; lo += grid.step) {
          const [x] = toScreenPx(lo * D2R, 0); if (x > 60 && x < W - 60) ctx.fillText(tmpl.replace('{n}', lo), x, m + b + 3);
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        for (let la = Math.ceil(grid.lat0 / grid.step) * grid.step; la <= grid.lat1; la += grid.step) {
          const [, y] = toScreenPx(0, proj(la, 0)[1]); if (y > 120 && y < H - 120) ctx.fillText(`${la}°`, m + b + 4, y);
        }
      }
      // scale
      if (scale) {
        const kmpp = kmPerPx(), targetPx = mob ? 90 : 130;
        const steps = [10, 20, 25, 50, 100, 200, 250, 500, 1000];
        let kmStep = steps[0]; for (const k of steps) if (k / kmpp <= targetPx) kmStep = k;
        const pathLen = kmStep / kmpp, x0 = mob ? 18 : 40, y0 = mob && controlsTop != null ? controlsTop - 16 : H - 104;
        ctx.fillStyle = 'rgba(244,236,216,.7)'; ctx.fillRect(x0 - 8, y0 - 18, pathLen + 52, 30);
        ctx.strokeStyle = '#4b3c2b'; ctx.lineWidth = 1;
        ctx.strokeRect(x0 + .5, y0 + .5, pathLen, 4);
        ctx.fillStyle = '#4b3c2b';
        for (let k = 0; k < 4; k += 2) ctx.fillRect(x0 + pathLen * k / 4, y0, pathLen / 4, 5);
        ctx.font = 'italic 400 12px "EB Garamond"'; ctx.textBaseline = 'bottom'; ctx.textAlign = 'center';
        ctx.fillText('0', x0, y0 - 2); ctx.fillText(String(kmStep / 2), x0 + pathLen / 2, y0 - 2);
        ctx.textAlign = 'left'; ctx.fillText(`${kmStep} ${P.unit_km || 'km'}`, x0 + pathLen - 4, y0 - 2);
      }
      ctx.restore();
    }

    // "spotlight": the surroundings of a stop darken slightly, the place lights up
    function drawSpotlight(dt, enabled, place) {
      light += ((enabled && place ? 1 : 0) - light) * Math.min(1, dt * 2.2);
      if (light < .01 || !place) return;
      const [x, y] = toScreenPx(...coords(place));
      const R = Math.max(W, H) * .75;
      const gr = ctx.createRadialGradient(x, y, 30, x, y, R);
      gr.addColorStop(0, `rgba(255, 250, 232, ${.32 * light})`);
      gr.addColorStop(.18, 'rgba(255, 250, 232, 0)');
      gr.addColorStop(.45, 'rgba(70, 48, 20, 0)');
      gr.addColorStop(1, `rgba(70, 48, 20, ${.16 * light})`);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    }

    // big film year at the top right with the chapter name (paper tag)
    function drawFilmYear(fr, dt) {
      if (!fr) { filmYearAlpha = 0; return; }
      filmYearAlpha = Math.min(1, filmYearAlpha + dt * 2.4);
      const mob = mobile();
      ctx.save(); ctx.globalAlpha = filmYearAlpha;
      const x = mob ? W - 16 : W - 46;
      const y = mob ? (controlsTop != null ? controlsTop : H - 60) - 86 : 76;
      const size = mob ? 40 : 72, sub = fr.subtitle || '';
      ctx.font = `italic 400 ${mob ? 13 : 17}px "EB Garamond"`;
      const subW = ctx.measureText(sub).width;
      ctx.font = `500 ${size}px "EB Garamond"`;
      const wd = Math.max(ctx.measureText('0000').width, subW) + (mob ? 22 : 36);
      const hh = size * .95 + (mob ? 22 : 30);
      ctx.fillStyle = 'rgba(250, 245, 230, .82)'; ctx.strokeStyle = 'rgba(160, 130, 90, .55)'; ctx.lineWidth = 1;
      ctx.shadowColor = 'rgba(60,40,15,.15)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
      ctx.fillRect(x - wd + (mob ? 8 : 14), y, wd, hh); ctx.shadowColor = 'transparent';
      ctx.strokeRect(x - wd + (mob ? 8 : 14) + .5, y + .5, wd - 1, hh - 1);
      ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(47, 34, 22, .95)'; ctx.fillText(String(fr.year), x - (mob ? 3 : 4), y + size * .86);
      ctx.font = `italic 400 ${mob ? 13 : 17}px "EB Garamond"`; ctx.fillStyle = hexA(fr.color || NEUTRAL, 1);
      ctx.fillText(sub, x - (mob ? 3 : 4), y + hh - (mob ? 8 : 11));
      ctx.restore();
    }

    // ---------- manual pan and zoom ----------
    const listeners = [];
    const listen = (target, type, fn, opt) => { target.addEventListener(type, fn, opt); listeners.push([target, type, fn, opt]); };
    function userTouch() {
      manual = true; cancelFlight(false);
      if (options.onManual) options.onManual();
    }
    function zoomAround(sx, sy, f) {
      const wx = (sx - W / 2) / cam.z + cam.x, wy = (sy - H / 2) / cam.z + cam.y;
      cam.z = Math.max(150, Math.min(30000, cam.z * f));
      cam.x = wx - (sx - W / 2) / cam.z; cam.y = wy - (sy - H / 2) / cam.z;
    }
    function pointerControls() {
      const pointers = new Map();
      let last = null;
      listen(cv, 'pointerdown', (e) => {
        cv.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]);
        cv.classList.add('dragging'); userTouch(); last = null;
      });
      listen(cv, 'pointermove', (e) => {
        if (!pointers.has(e.pointerId)) return;
        const prev = pointers.get(e.pointerId);
        pointers.set(e.pointerId, [e.clientX, e.clientY]);
        if (pointers.size === 1) {
          cam.x -= (e.clientX - prev[0]) / cam.z; cam.y -= (e.clientY - prev[1]) / cam.z;
        } else if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
          if (last) zoomAround(mx, my, d / last.d);
          last = { d };
        }
      });
      const end = (e) => { pointers.delete(e.pointerId); last = null; if (!pointers.size) cv.classList.remove('dragging'); };
      listen(cv, 'pointerup', end); listen(cv, 'pointercancel', end);
      listen(cv, 'wheel', (e) => {
        e.preventDefault(); userTouch();
        zoomAround(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0018)));
      }, { passive: false });
    }

    function resize() {
      DPR = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
      W = cv.clientWidth || window.innerWidth; H = cv.clientHeight || window.innerHeight;
      cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
      cacheVersion++;
      return { w: W, h: H, dpr: DPR };
    }

    // ---------- public API ----------
    const activeItems = (s) => (s instanceof Set ? s : new Set(s || []));
    const map = {
      // data
      setLegs(t) { legs = (t || []).slice(); prepareLegs(); },
      // shown places (markers + labels); colours: Map|object cluster id -> colour, otherwise neutral
      setPlaces(clusters, colors) {
        const fresh = (clusters || []).slice();
        if (fresh.map((m) => m.id).join() !== placesShown.map((m) => m.id).join()) cacheVersion++;   // labels depend on the shown places
        placesShown = fresh; placeColors = values(colors);
      },
      // highlights places by name (cluster.name or any of cluster.names)
      highlightPlaces(names) {
        const n = new Set(names || []);
        highlight = new Set(placesAll.concat(placesShown).filter((m) => n.has(m.name) || (m.names || []).some((x) => n.has(x))).map((m) => m.id));
      },
      // camera
      view(target, o) { cancelFlight(false); manual = false; setCamera(asView(target, o)); clampCamera(); },
      flyTo(target, o) {
        o = o || {};
        cancelFlight(false); manual = false;
        const c1 = asView(target, o);
        if (noAnimation()) { setCamera(c1); clampCamera(); return Promise.resolve(true); }
        const l = createFlight({ x: cam.x, y: cam.y, z: cam.z }, c1, W);
        return new Promise((res) => { flight = { i: l.i, duration: o.duration || l.duration, t: 0, target: c1, res }; });
      },
      stopFlight() { cancelFlight(false); },
      follow(target, omega) { followTarget = target ? { target, omega: omega || 2 } : null; },
      followPoint(sv, omega) { followTarget = sv ? { target: { x: sv[0], y: sv[1], z: cam.z }, omega: omega || 2 } : null; },
      cameraFree(v) { if (v !== undefined) { manual = !!v; if (manual) cancelFlight(false); } return manual; },
      camera() { return { x: cam.x, y: cam.y, z: cam.z }; },
      setCamera(c) { cancelFlight(false); setCamera(c); clampCamera(); },
      setSpeed(r) { speed = r || 1; },
      noAnimation,
      // helpers for computing views (world coordinates = Mercator in radians)
      world, frame, bbox: bboxOfPoints, expandBb: expandBb, kmPerPixel: kmPerPx,
      viewStop, viewOn, viewPen,
      legPoints(t) { const i = legInfo.get(t.id || t); return i ? i.points : null; },
      legKm(t) { const i = legInfo.get(t.id || t); return i ? i.km : 0; },
      toScreen(lat, lon) { const p = proj(lat, lon); return toScreenPx(p[0], p[1]); },
      // free area for the camera (outside the card and the controls) in px; null = the whole canvas.
      // o.controlsTop = y of the top edge of the controls (mobile: scale and film year are above it)
      setFreeArea(r, o) {
        if (r) { const q = rect(r); free = { x0: q[0], y0: q[1], x1: q[2], y1: q[3] }; } else free = null;
        if (o && 'controlsTop' in o) controlsTop = o.controlsTop;
      },
      resize,
      dimensions() { return { w: W, h: H, dpr: DPR }; },
      // One frame. time = ms (rAF), dt = seconds since the previous frame.
      // o: progress (Map|object leg id -> 0..1), dim (Set|array of leg ids drawn dimmed),
      //    activePlace (cluster with a medallion), activeT (seconds since arrival: entrance and pulse), activeColor,
      //    spotlight (bool; lights up the surroundings of activePlace), filmYear ({year, subtitle, color}|null), scale (default true)
      render(time, dt, o) {
        o = o || {}; dt = Math.min(0.05, dt || 0);
        cameraStep(dt);
        clampCamera();
        occupied.length = 0;
        const cur = o.activePlace || null;
        if ((cur && cur.id) !== (activeCur && activeCur.id)) cacheVersion++;
        activeCur = cur;
        const c = cacheCanvas();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(c.cv, 0, 0);
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        drawSpotlight(dt, !!o.spotlight, o.activePlace);
        drawLegs(o.progress, activeItems(o.dim));
        drawPlaces(time, o);
        drawCities();
        drawFrame(gridParams(), o.scale !== false);
        drawFilmYear(o.filmYear, dt);
      },
      destroy() {
        cancelFlight(false); followTarget = null;
        for (const [target, type, fn, opt] of listeners) target.removeEventListener(type, fn, opt);
        listeners.length = 0;
        if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', invalidate);
      },
    };

    const invalidate = () => { cacheVersion++; };
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', invalidate);
    listen(window, 'resize', () => resize());
    if (options.manualControls !== false) pointerControls();
    resize();
    setCamera(clampView(frame([BOUNDS[0], BOUNDS[1], BOUNDS[2], BOUNDS[3]]), W, H, BOUNDS));
    return map;
  }

  const api = { hexA, create, proj, inv, km, clampView, collides, createFlight, bezierArc, worldBounds };
  if (typeof module !== 'undefined') module.exports = api; else g.ChronicleMap = api;
})(typeof window !== 'undefined' ? window : globalThis);
