// Ancestor fan: circular chart by ahnentafel numbers. Root in the middle, father on the left, mother on the right,
// each ring one generation older. Branch colours from D.branchMap; data only through Chronicle (common.js).
// The idea follows the fan chart of the rodokmen-skill project (J. Šaršon, MIT); the code is original.
(function () {
  'use strict';
  const { D, T, loadData, yearOf, localized, personLink } = window.Chronicle;
  const NS = 'http://www.w3.org/2000/svg';
  const LANGUAGE = D.language;
  const NEUTRAL = '#8a7350';

  // ring widths (0 = centre, the root); outer radii are computed from the oldest known generation
  const WIDTH = [92, 104, 104, 104, 118, 128, 128, 122, 116, 110, 104];
  const FONT_SIZE = [21, 20, 19, 18, 17, 15.5, 13.5, 12, 11, 10, 9];
  const RADIAL_FROM = 4;                       // from the 4th generation the text runs along the ray
  let R = [], MAX_GEN = 0;
  function rings(maxGen) {
    MAX_GEN = Math.min(maxGen, WIDTH.length - 1);
    R = []; let r = 0;
    for (let g = 0; g <= MAX_GEN; g++) { r += WIDTH[g]; R.push(r); }
  }

  const svg = document.getElementById('fan');
  const vp = document.getElementById('viewport');
  const s = (tag, attrs, ...children) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) e.setAttribute(k, v);
    for (const d of children) if (d != null) e.append(d);
    return e;
  };
  const gen = (n) => Math.floor(Math.log2(n));
  // half circle: angle 90 = left, 180 = top, 270 = right -> the left half is the father's line, the right half the mother's
  const angle = (n) => { const g = gen(n), step = 180 / 2 ** g; return [90 + (n - 2 ** g) * step, 90 + (n - 2 ** g + 1) * step]; };
  const point = (r, a) => { const rad = (a + 90) * Math.PI / 180; return [r * Math.cos(rad), r * Math.sin(rad)]; };
  const f = (x) => x.toFixed(2);

  function sector(r0, r1, a0, a1) {
    if (a1 - a0 >= 359.999) {   // full ring (only in theory, generation 0 is a circle)
      return `M${f(-r1)},0A${r1},${r1} 0 1,1 ${f(r1)},0A${r1},${r1} 0 1,1 ${f(-r1)},0Z`;
    }
    const v = a1 - a0 > 180 ? 1 : 0;
    const [x0, y0] = point(r1, a0), [x1, y1] = point(r1, a1), [x2, y2] = point(r0, a1), [x3, y3] = point(r0, a0);
    return `M${f(x0)},${f(y0)}A${r1},${r1} 0 ${v},1 ${f(x1)},${f(y1)}L${f(x2)},${f(y2)}A${r0},${r0} 0 ${v},0 ${f(x3)},${f(y3)}Z`;
  }

  const branchColor = (v) => (D.branchMap && D.branchMap[v] && D.branchMap[v].color) || NEUTRAL;
  const years = (o) => {
    if (o.living) return '';
    const a = o.birth && yearOf(o.birth.date), b = o.death && yearOf(o.death.date);
    if (a && b) return a + '–' + b;
    if (a) return '* ' + a;
    if (b) return '† ' + b;
    return '';
  };
  const split = (name) => {          // "Mary Ann Smith" -> ["Mary Ann", "Smith"]
    const c = (name || 'N.N.').split(/\s+/);
    return c.length > 1 ? [c.slice(0, -1).join(' '), c[c.length - 1]] : [c[0], ''];
  };

  let arcId = 0, SMALL_LABELS = [];
  function textArc(group, r0, r1, a0, a1, rows, g) {
    // text along an arc; in the lower half reversed so that it reads left to right
    const down = ((a0 + a1) / 2) % 360 < 90 || ((a0 + a1) / 2) % 360 > 270;
    const height = FONT_SIZE[g] * 1.18;
    const center = (r0 + r1) / 2;
    rows.forEach((r, i) => {
      if (!r.text) return;
      const shift = (i - (rows.length - 1) / 2) * height;
      const rr = down ? center + shift + height * 0.32 : center - shift - height * 0.32;
      const margin = 2;
      const [xa, ya] = point(rr, down ? a1 - margin : a0 + margin), [xb, yb] = point(rr, down ? a0 + margin : a1 - margin);
      const id = 'arcId' + (arcId++);
      const v = a1 - a0 > 180 ? 1 : 0;
      group.append(s('path', { id, d: `M${f(xa)},${f(ya)}A${rr},${rr} 0 ${v},${down ? 0 : 1} ${f(xb)},${f(yb)}`, class: 'guide' }));
      const tp = s('textPath', { href: '#' + id, startOffset: '50%' });
      tp.textContent = r.text;
      // shrink so that it fits into the arc (estimated character width 0.5 em)
      const arcLen = Math.PI * rr * (a1 - a0 - 2 * margin) / 180;
      const basic = FONT_SIZE[g] * (r.smaller ? 0.82 : 1);
      const resize = Math.min(basic, arcLen / (r.text.length * 0.5));
      group.append(s('text', { class: 'label ' + (r.cls || ''), 'font-size': f(resize), 'text-anchor': 'middle' }, tp));
    });
  }

  function textRadial(group, r0, r1, a0, a1, rows, g) {
    const am = (a0 + a1) / 2;
    const onLeft = ((am % 360) + 360) % 360 < 180;   // left half: rotate so that the text is not upside down
    const width = (r1 - r0) - 10;
    const arcId = Math.PI * (r0 + r1) / 2 * (a1 - a0) / 180;   // room across the ray
    const [cx, cy] = point((r0 + r1) / 2, am);
    const rot = onLeft ? am - 90 : am + 90;   // the ray direction on screen is am+90 degrees
    const everything = rows.filter((r) => r.text);
    const label = (font, visibleRows) => {
      const height = font * 1.12;
      const t = s('text', { class: 'label', transform: `translate(${f(cx)},${f(cy)}) rotate(${f(rot)})`, 'text-anchor': 'middle' });
      visibleRows.forEach((r, i) => {
        const velocity = font * (r.smaller ? 0.82 : 1);
        let txt = r.text;
        const max = Math.floor(width / (velocity * 0.5));
        if (txt.length > max) txt = txt.slice(0, Math.max(1, max - 1)) + '…';
        t.append(s('tspan', { x: 0, y: f((i - (visibleRows.length - 1) / 2) * height + font * 0.35), 'font-size': f(velocity), class: r.cls || null }, txt));
      });
      return t;
    };
    // basic: full font, as many rows as fit (narrow sector: font reduced to one row)
    const font = Math.max(0.6, Math.min(FONT_SIZE[g], (arcId - 1) / 1.12));
    const howMany = Math.max(1, Math.floor((arcId - 1) / (font * 1.12)));
    const basic = label(font, everything.slice(0, howMany));
    group.append(basic);
    // detail for zoom: all lines, font by available space; shown once readable
    if (everything.length > howMany) {
      const pd = Math.max(0.5, Math.min(FONT_SIZE[g], (arcId - 1) / (1.12 * everything.length)));
      const detail = label(pd, everything);
      group.append(detail);
      SMALL_LABELS.push({ basic, detail, pz: font >= FONT_SIZE[g] ? 0 : font, pd });
    } else if (font < FONT_SIZE[g]) SMALL_LABELS.push({ basic, detail: null, pz: font, pd: font });
  }

  // descendants of the chosen person: lower half circle, each child gets an angle by the number of their leaf descendants
  let MAX_DOWN = 0, UP = 0;
  function descendants(people, root) {
    const children = {};
    for (const [id, o] of Object.entries(people)) {
      if (o.ahnentafel != null || o.spouse_of || o.sibling_of) continue;
      for (const r of o.parents || []) (children[r] = children[r] || []).push(id);
    }
    const year = (id) => yearOf((people[id].birth || {}).date) || 9999;
    for (const k in children) children[k].sort((a, b) => year(a) - year(b));
    const weight = {};
    const w = (x, h) => { if (h > 12) return 1; const d = children[x] || []; return (weight[x] = d.length ? d.reduce((t, y) => t + w(y, h + 1), 0) : 1); };
    w(root, 0);
    const out = [];   // [id, generation, a0, a1]
    const split = (x, g, from, end) => {   // angles decrease from left (450) to right (270)
      let a = from;
      for (const d of children[x] || []) {
        const wd = (from - end) * weight[d] / weight[x];
        out.push([d, g + 1, a - wd, a]);
        split(d, g + 1, a, a - wd);
        a -= wd;
      }
    };
    if ((children[root] || []).length) split(root, 0, 450, 270);
    MAX_DOWN = Math.max(0, ...out.map((x) => x[1]));
    return out;
  }

  function drawAll(people, root) {
    SMALL_LABELS = [];
    const byAhnentafel = {};
    for (const [id, o] of Object.entries(people)) if (o.ahnentafel != null && !(o.ahnentafel in byAhnentafel)) byAhnentafel[o.ahnentafel] = id;
    const down = descendants(people, root);
    rings(Math.max(0, MAX_DOWN, ...Object.keys(byAhnentafel).map((n) => gen(+n))));
    MAX_DOWN = Math.min(MAX_DOWN, MAX_GEN);
    const maxUp = UP = Math.min(MAX_GEN, Math.max(0, ...Object.keys(byAhnentafel).map((n) => gen(+n))));

    const world = s('g', { id: 'world' });
    svg.append(world);
    // shadowed paper disc (below only as far as the descendants reach)
    world.append(s('path', { d: sector(0, R[maxUp] + 14, 90, 270), class: 'disc' }));
    if (MAX_DOWN) world.append(s('path', { d: sector(0, R[MAX_DOWN] + 14, 270, 450), class: 'disc' }));

    // generation arcs and the father/mother axis
    for (let g = 1; g <= maxUp; g++) {
      const [x0, y0] = point(R[g], 90), [x1, y1] = point(R[g], 270);
      world.append(s('path', { d: `M${f(x0)},${f(y0)}A${R[g]},${R[g]} 0 0,1 ${f(x1)},${f(y1)}`, class: 'circles' }));
    }
    for (let g = 1; g <= MAX_DOWN; g++) {
      const [x0, y0] = point(R[g], 270), [x1, y1] = point(R[g], 450);
      world.append(s('path', { d: `M${f(x0)},${f(y0)}A${R[g]},${R[g]} 0 0,1 ${f(x1)},${f(y1)}`, class: 'circles' }));
    }
    const [mx, my] = point(R[maxUp] + 8, 180);
    world.append(s('line', { x1: 0, y1: 0, x2: f(mx), y2: f(my), class: 'axis' }));

    const sectorLayer = s('g'), textLayer = s('g');
    world.append(sectorLayer, textLayer);

    // unknown: missing parents of known ancestors (one ring further, only up to MAX_GEN)
    for (const nStr of Object.keys(byAhnentafel)) {
      const n = +nStr;
      for (const p of [2 * n, 2 * n + 1]) {
        if (gen(p) > maxUp || byAhnentafel[p]) continue;
        const [a0, a1] = angle(p), g = gen(p);
        const v = s('path', { d: sector(R[g - 1], R[g], a0, a1), class: 'sector unknown' });
        v.append(s('title', {}, T.fan_unknown));
        sectorLayer.append(v);
        if (g <= 6 && Math.PI * (R[g - 1] + R[g]) / 2 * (a1 - a0) / 180 > 14) {
          const [cx, cy] = point((R[g - 1] + R[g]) / 2, (a0 + a1) / 2);
          textLayer.append(s('text', { x: f(cx), y: f(cy + 5), class: 'question', 'text-anchor': 'middle' }, '?'));
        }
      }
    }

    // known ancestors and descendants
    const sectors = Object.entries(byAhnentafel).map(([nStr, id]) => [id, gen(+nStr), ...(+nStr > 1 ? angle(+nStr) : [90, 270])]);
    for (const [id, g, a0, a1] of [...sectors, ...down]) {
      const o = people[id];
      if (g > MAX_GEN) continue;
      // descendants without a branch of their own (common) get the colour of the chosen person
      const color = branchColor(g > 0 && o.ahnentafel == null && !(D.branchMap || {})[o.branch] ? people[root].branch : o.branch);
      const [pname, prt] = split(o.name);
      const rows = [{ text: pname }, { text: prt, cls: 'surname' }, { text: years(o), cls: 'years', smaller: true }];
      const relationship = o.relationship || '';
      const chapterTitle = [o.name, years(o), relationship].filter(Boolean).join(' · ');
      const link = personLink(id);
      const wrap = link ? s('a', { href: link, class: 'person', 'data-id': id }) : s('g', { class: 'person', 'data-id': id });
      wrap.append(s('title', {}, chapterTitle));

      if (g === 0) {
        wrap.append(s('path', { d: MAX_DOWN ? sector(0, R[0], 0, 360) : sector(0, R[0], 90, 270), class: 'sector center', fill: color }));
        const t = s('text', { class: 'label center-text', 'text-anchor': 'middle' });
        [[pname, -R[0] * 0.48, ''], [prt, -R[0] * 0.48 + FONT_SIZE[0] * 1.15, 'surname']].forEach(([x, y, tr]) => {
          if (!x) return;
          t.append(s('tspan', { x: 0, y, 'font-size': FONT_SIZE[0], class: tr || null }, x));
        });
        wrap.append(t);
        textLayer.append(wrap);
        continue;
      }
      const fill = s('path', { d: sector(R[g - 1], R[g], a0, a1), class: 'sector', fill: color,
        'fill-opacity': f(Math.max(0.2, 0.46 - g * 0.025)) });
      wrap.append(fill);
      if (g < RADIAL_FROM) textArc(wrap, R[g - 1], R[g], a0, a1, rows, g);
      else textRadial(wrap, R[g - 1], R[g], a0, a1, rows, g);
      sectorLayer.append(wrap);
    }

    // side labels
    // with descendants below, the side labels go outside next to the disc, otherwise below the axis
    const sides = MAX_DOWN ? [[T.fan_paternal, 90, 'end'], [T.fan_maternal, 270, 'start']] : [[T.fan_paternal, 90, 'start'], [T.fan_maternal, 270, 'end']];
    for (const [txt, a, anchor] of sides) {
      if (MAX_DOWN) {
        const [x] = point(R[maxUp], a);
        world.append(s('text', { x: f(x + Math.sign(x) * 22), y: -10, class: 'side', 'text-anchor': anchor }, txt));
      } else {   // below the axis at the first ring, so that they are visible on mobile too and the tools bar does not cover them
        const [x] = point((R[0] + R[2]) / 2, a);
        world.append(s('text', { x: f(x), y: 30, class: 'side', 'text-anchor': 'middle' }, txt));
      }
    }
    // generation numbers along the axis at the top
    for (let g = 1; g <= maxUp; g++) {
      const [x, y] = point((R[g - 1] + R[g]) / 2, 180);
      world.append(s('text', { x: f(x), y: f(y + 4), class: 'gen-number', 'text-anchor': 'middle' }, String(g)));
    }
    if (MAX_DOWN) {
      const [, y] = point(R[MAX_DOWN] + 34, 0);
      world.append(s('text', { x: 0, y: f(y), class: 'side', 'text-anchor': 'middle' }, T.fan_descendants));
    }
    return world;
  }

  function legend(people) {
    const el = document.getElementById('legend');
    const used = new Set(Object.values(people).filter((o) => !o.spouse_of && !o.sibling_of).map((o) => o.branch));
    const h = document.createElement('h2'); h.textContent = T.fan_legend; el.append(h);
    const ul = document.createElement('ul');
    for (const v of D.branches || []) {
      const key = v.key;
      if (!used.has(key)) continue;
      const li = document.createElement('li');
      li.className = 'branch-' + key;
      const sw = document.createElement('span'); sw.className = 'swatch';
      li.append(sw, document.createTextNode(localized(v.name) || key));
      ul.append(li);
    }
    const li = document.createElement('li'); li.className = 'unknown';
    const sw = document.createElement('span'); sw.className = 'swatch';
    li.append(sw, document.createTextNode(T.fan_unknown));
    ul.append(li);
    el.append(ul);
  }

  // ---------- pan and zoom ----------
  let scale = 1, tx = 0, ty = 0, world, PEOPLE = {};
  const narrow = () => vp.clientWidth < 600;
  // top edge of the free area: below the bar, on mobile below the legend too
  const strip = () => Math.max(document.querySelector('.bar').getBoundingClientRect().bottom,
    narrow() ? document.getElementById('legend').getBoundingClientRect().bottom : 0);
  function fit() {
    const w = vp.clientWidth, down = narrow() ? 70 : 30, hh = vp.clientHeight - strip() - down;
    const rr = R[UP] + 30, rd = MAX_DOWN ? R[MAX_DOWN] + 50 : 60;
    scale = Math.min((w - 40) / (2 * Math.max(rr, rd)), hh / (rr + rd));
    if (narrow()) {   // phone: the whole fan would be unreadably small -> fit the inner 4 generations to the width, the rest by drag and pinch
      const g = Math.min(4, UP, MAX_DOWN || 4);
      scale = Math.max(scale, Math.min((w - 16) / (2 * (R[g] + 12)), hh / (R[g] + rd)));
    }
    const height = (rr + rd) * scale;   // portrait: the fan is centred vertically; if it does not fit, the centre goes to the bottom
    tx = w / 2;
    // phone: centre towards the bottom (above the tools), room at the top for older generations
    ty = narrow() || height > hh ? strip() + hh - rd * scale + 15 : strip() + 15 + (hh - height) / 2 + rr * scale;
    applyTransform();
  }
  function applyTransform() {
    world.setAttribute('transform', `translate(${f(tx)},${f(ty)}) scale(${scale.toFixed(4)})`);
    // show reduced labels once they are at least ~7 px on screen; with a big enough detail swap it for the basic one
    const show = (el, yes) => { if (el._shown !== yes) { el._shown = yes; el.style.display = yes ? '' : 'none'; } };
    for (const d of SMALL_LABELS) {
      const detail = d.detail && d.pd * scale >= 7;
      if (d.detail) show(d.detail, detail);
      show(d.basic, !detail && (!d.pz || d.pz * scale >= 7));   // pz 0 = full font, always visible
    }
  }
  function zoom(k, cx, cy) {
    cx = cx == null ? vp.clientWidth / 2 : cx; cy = cy == null ? vp.clientHeight / 2 : cy;
    const m = Math.min(20, Math.max(0.08, scale * k)); const kk = m / scale;
    tx = cx - (cx - tx) * kk; ty = cy - (cy - ty) * kk; scale = m; applyTransform();
  }

  // bubble with a person (touch and people without a page); with a mouse a click opens the page directly
  const bubble = document.createElement('div');
  bubble.className = 'fan-bubble'; bubble.hidden = true; bubble.setAttribute('role', 'dialog');
  document.body.append(bubble);
  function showBubble(id) {
    const o = PEOPLE[id]; if (!o) return;
    bubble.replaceChildren();
    const closeBtn = document.createElement('button'); closeBtn.type = 'button'; closeBtn.className = 'close'; closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', T.close); closeBtn.addEventListener('click', () => { bubble.hidden = true; });
    const h = document.createElement('strong'); h.textContent = o.name;
    const sub = document.createElement('span');
    sub.textContent = [years(o), o.relationship || ''].filter(Boolean).join(' · ');
    bubble.append(closeBtn, h, sub);
    const link = personLink(id);
    if (link) {
      const a = document.createElement('a'); a.href = link; a.textContent = T.person_page; bubble.append(a);
    } else if (o.living) {
      const p = document.createElement('small'); p.textContent = T.living_note; bubble.append(p);
    }
    bubble.hidden = false;
  }

  function controls() {
    vp.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
    // drag and pinch with fingers anywhere (also over a sector); a click after a drag is discarded
    const show = new Map();
    let start = null, pinch = null, dragged = false, type = 'mouse';
    vp.addEventListener('pointerdown', (e) => {
      type = e.pointerType;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      show.set(e.pointerId, [e.clientX, e.clientY]);
      start = { x: e.clientX, y: e.clientY }; dragged = false;
      if (show.size === 2) { const [a, b] = [...show.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); }
    });
    vp.addEventListener('pointermove', (e) => {
      if (!show.has(e.pointerId)) return;
      const prev = show.get(e.pointerId);
      show.set(e.pointerId, [e.clientX, e.clientY]);
      if (show.size === 2 && pinch) {
        const [a, b] = [...show.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        zoom(d / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); pinch = d;
        tx += (e.clientX - prev[0]) / 2; ty += (e.clientY - prev[1]) / 2; applyTransform();
        dragged = true; return;
      }
      if (!dragged && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) {
        dragged = true; vp.classList.add('dragging'); vp.setPointerCapture(e.pointerId);
      }
      if (dragged) { tx += e.clientX - prev[0]; ty += e.clientY - prev[1]; applyTransform(); }
    });
    const end = (e) => {
      show.delete(e.pointerId);
      if (show.size < 2) pinch = null;
      if (!show.size) { vp.classList.remove('dragging'); setTimeout(() => { dragged = false; }, 0); }
    };
    vp.addEventListener('pointerup', end); vp.addEventListener('pointercancel', end);
    vp.addEventListener('dragstart', (e) => e.preventDefault());
    vp.addEventListener('click', (e) => {
      if (dragged) { e.preventDefault(); e.stopPropagation(); return; }
      const pcard = e.target.closest('.person');
      if (!pcard) { bubble.hidden = true; return; }
      if (type !== 'mouse' || !pcard.getAttribute('href')) { e.preventDefault(); showBubble(pcard.dataset.id); }
    }, true);
    document.getElementById('b-plus').addEventListener('click', () => zoom(1.3));
    document.getElementById('b-minus').addEventListener('click', () => zoom(1 / 1.3));
    document.getElementById('b-center').addEventListener('click', fit);
    vp.addEventListener('keydown', (e) => {
      if (e.key === '+' || e.key === '=') zoom(1.2);
      else if (e.key === '-') zoom(1 / 1.2);
      else if (e.key === '0') fit();
      else if (e.key === 'Escape') bubble.hidden = true;
    });
    window.addEventListener('resize', fit);
  }

  loadData(['people']).then((d) => {
    const view = window.Chronicle.view.prepare(d.people, document.querySelector('.bar'));
    const people = view.people;
    if (!view.isRoot) {
      document.querySelector('.bar-title small').textContent = T.fan_subtitle_from.replace('{name}', people[view.from].name);
    }
    svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%');
    PEOPLE = people;
    world = drawAll(people, view.from);
    legend(people);
    fit();
    controls();
  }).catch((e) => { vp.textContent = (T.tree_load_error || 'Error') + ' (' + e.message + ')'; });
})();
