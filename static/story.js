// Story: anchors in the chronicle (.anchor[data-places="A;B"]) drive the map in the panel (engine map-draw.js).
// The legs of all lines are static ribbons; the lines of this chapter are strong, the others dimmed.
(function () {
  'use strict';
  const M = window.ChronicleMap, Sc = window.Film, R = window.Chronicle;
  const panel = document.getElementById('map');
  const canvas = document.getElementById('canvas');
  if (!M || !Sc || !R || !panel || !canvas) return;
  const { D, T, el, color, loadData } = R;
  const anchors = [...document.querySelectorAll('.anchor[data-places]')];
  const CHAPTER_VIEW = { expandKm: 60, maxKmPx: 4.5, minKmPx: 0.9, margin: 0.12 };
  const R2D = 180 / Math.PI;

  loadData(['events', 'lines', 'places', 'people', 'basemap', 'map']).then(async (data) => {
    await Promise.all(['400', 'italic 400', 'italic 600'].map((f) => document.fonts.load(f + ' 16px "EB Garamond"'))).catch(() => {});
    const sc = Sc.build(data, { branches: D.branches, strings: T, language: D.language });
    const map = M.create(canvas, { basemap: data.basemap, map: data.map, places: sc.clusters, language: D.language, strings: T });
    const ownBranch = (D.branches.find((b) => b.chronicle === D.slug) || {}).key || null;

    const progress = new Map(), dim = new Set();
    for (const t of sc.legs) {
      progress.set(t.id, 1);
      if (ownBranch && t.branch !== ownBranch) dim.add(t.id);
    }
    map.setLegs(sc.legs);
    map.setPlaces(sc.clusters);

    let active = null, place = null, activeCol, startTime = 0, names = [];
    const clustersFor = (j) => sc.clusters.filter((s) => j.includes(s.name) || s.names.some((n) => j.includes(n)));

    function writeCenter() {
      const k = map.camera();
      const lat = (2 * Math.atan(Math.exp(-k.y)) - Math.PI / 2) * R2D, lon = k.x * R2D;
      panel.dataset.center = lat.toFixed(4) + ',' + lon.toFixed(4);
    }

    function show(anchor) {
      if (anchor === active) return;
      active = anchor;
      names = anchor.dataset.places.split(';').map((s) => s.trim()).filter(Boolean);
      const clusters = clustersFor(names);
      if (!clusters.length) return;
      map.highlightPlaces(names);
      place = clusters[0]; startTime = performance.now();
      const t = sc.legs.find((x) => x.branch && (x.to.id === place.id || x.from.id === place.id));
      activeCol = t ? color(t.branch) : (ownBranch ? color(ownBranch) : undefined);
      map.flyTo(map.viewOn(clusters, [], CHAPTER_VIEW)).then(writeCenter);
    }

    let before = 0;
    function loop(time) {
      const dt = before ? Math.min(0.1, (time - before) / 1000) : 1 / 60;
      before = time;
      map.render(time, dt, {
        progress, dim, activePlace: place, activeT: (time - startTime) / 1000, activeColor: activeCol, spotlight: false, filmYear: null,
      });
      requestAnimationFrame(loop);
    }

    map.cameraFree(false);
    map.view(map.viewOn(sc.clusters, sc.legs, { expandKm: 50, maxKmPx: 6, minKmPx: 0.6, margin: 0.06 }));
    writeCenter();
    requestAnimationFrame(loop);

    if (!anchors.length) return;
    const io = new IntersectionObserver((entries) => {
      const entered = entries.filter((z) => z.isIntersecting);
      if (entered.length) show(entered[entered.length - 1].target);
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    anchors.forEach((k) => io.observe(k));
  }).catch((e) => {
    panel.append(el('p', { class: 'error', role: 'alert', text: T.data_error || String(e) }));
  });
})();
