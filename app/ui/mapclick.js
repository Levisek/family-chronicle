// A plain map for placing a town by hand: equirectangular projection of a box, the land and the
// borders of Natural Earth (FC_WORLD) as SVG, dots for the places already known; a click gives
// [lat, lon]. FCApp.mapclick(box, known, onpick) -> SVG element; box = [lon0, lon1, lat0, lat1].
(function (g) {
  'use strict';

  const FCApp = g.FCApp;
  const { s } = FCApp.dom;
  const WIDTH = 900;

  function pathOf(rings, x, y) {
    return rings.map((r) => r.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('') + 'Z').join('');
  }

  function mapclick(box, known, onpick) {
    const [lon0, lon1, lat0, lat1] = box;
    // equirectangular, longitudes shortened by the cosine of the middle latitude
    const k = Math.cos(((lat0 + lat1) / 2) * Math.PI / 180) || 1;
    const height = Math.max(200, Math.round(WIDTH * (lat1 - lat0) / ((lon1 - lon0) * k)));
    const x = (lon) => ((lon - lon0) / (lon1 - lon0)) * WIDTH;
    const y = (lat) => ((lat1 - lat) / (lat1 - lat0)) * height;
    const svg = s('svg', { class: 'mapclick', viewBox: `0 0 ${WIDTH} ${height}`, role: 'img', 'aria-label': FCApp.t('places_map_label'), id: 'mapclick' });
    const world = g.FC_WORLD;
    const B = g.FCEngine.basemap;
    if (world) {
      const fc = (layer) => ({ features: (world[layer] || []).map((geometry) => ({ geometry })) });
      for (const f of B.processLayer('land', true, fc('land'), box)) {
        svg.appendChild(s('path', { class: 'land', d: f.geometry.coordinates.map((poly) => pathOf(poly, x, y)).join('') }));
      }
      for (const f of B.processLayer('borders', false, fc('borders'), box)) {
        svg.appendChild(s('path', { d: f.geometry.coordinates.map((l) => l.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('')).join(''), fill: 'none', stroke: '#b38b5d', 'stroke-dasharray': '4 3' }));
      }
    }
    for (const [name, [lat, lon]] of known) {
      svg.appendChild(s('g', {}, s('circle', { class: 'dot', cx: x(lon), cy: y(lat), r: 4 }),
        s('text', { x: x(lon) + 6, y: y(lat) + 4, 'font-size': 13, fill: '#3b2f22' }, name)));
    }
    svg.addEventListener('click', (e) => {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const m = pt.matrixTransform(svg.getScreenCTM().inverse());
      const lon = lon0 + (m.x / WIDTH) * (lon1 - lon0), lat = lat1 - (m.y / height) * (lat1 - lat0);
      onpick([Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4]);
    });
    return svg;
  }

  FCApp.mapclick = mapclick;
})(window);
