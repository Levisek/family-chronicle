// A small pedigree for the branch step: the starting person, the parents and the grandparents (the
// branches start there), each box coloured by the branch whose roots it belongs to.
(function (g) {
  'use strict';

  const FCApp = g.FCApp;
  const { s } = FCApp.dom;
  const BOX_W = 170, BOX_H = 40, GAP_Y = 34, PAD = 14;
  const NEUTRAL = '#8a7350';

  const name = (tree, id) => { const p = tree.people.get(id); return p ? [p.given, p.surname].filter(Boolean).join(' ') : ''; };

  function pedigree(tree, root, branches) {
    // generation k holds 2^k slots, slot j = ahnentafel number 2^k + j
    const gens = 3;
    const slots = [[root]];
    for (let k = 1; k < gens; k++) {
      const row = [];
      for (const id of slots[k - 1]) {
        const p = id ? tree.people.get(id) : null;
        const f = p && p.parentsFamily ? tree.families.get(p.parentsFamily) : null;
        row.push(f && tree.people.has(f.husband) ? f.husband : null, f && tree.people.has(f.wife) ? f.wife : null);
      }
      slots.push(row);
    }
    // colour: the branch of the person or of a descendant in the line, walking down from the top
    const colorOf = new Map();
    for (let k = gens - 1; k >= 0; k--) {
      slots[k].forEach((id, j) => {
        if (!id) return;
        const own = branches.find((b) => b.roots.includes(id));
        if (own) colorOf.set(`${k}.${j}`, own.color);
      });
    }
    const colorAt = (k, j) => {
      for (let kk = k; kk < gens; kk++) {
        // a box takes the colour of an ancestor box only when all its coloured ancestors agree
        const span = 2 ** (kk - k);
        const found = new Set();
        for (let x = j * span; x < (j + 1) * span; x++) if (colorOf.has(`${kk}.${x}`)) found.add(colorOf.get(`${kk}.${x}`));
        if (kk === k && found.size) return [...found][0];
        if (kk > k && found.size === 1 && k > 0) return [...found][0];
      }
      return NEUTRAL;
    };
    const width = 2 ** (gens - 1) * (BOX_W + PAD) + PAD;
    const height = gens * (BOX_H + GAP_Y) + PAD;
    const svg = s('svg', { class: 'pedigree', viewBox: `0 0 ${width} ${height}`, role: 'img', id: 'pedigree' });
    const pos = (k, j) => {
      const n = 2 ** k;
      const cell = (width - PAD) / n;
      const w = Math.min(BOX_W, cell - PAD);
      return { x: PAD / 2 + cell * j + (cell - w) / 2, y: height - (k + 1) * (BOX_H + GAP_Y) + GAP_Y / 2, w };
    };
    for (let k = 1; k < gens; k++) slots[k].forEach((id, j) => {
      if (!id || !slots[k - 1][j >> 1]) return;
      const a = pos(k, j), b = pos(k - 1, j >> 1);
      svg.appendChild(s('path', { d: `M${a.x + a.w / 2},${a.y + BOX_H} V${b.y - GAP_Y / 2} H${b.x + b.w / 2} V${b.y}`, fill: 'none', stroke: '#b9a27a' }));
    });
    slots.forEach((row, k) => row.forEach((id, j) => {
      if (!id) return;
      const p = pos(k, j);
      const color = colorAt(k, j);
      const label = name(tree, id);
      const max = Math.floor((p.w - 14) / 7);
      svg.appendChild(s('g', {},
        s('title', {}, label),
        s('rect', { x: p.x, y: p.y, width: p.w, height: BOX_H, rx: 3, fill: '#fbf6ea', stroke: color, 'stroke-width': 1 }),
        s('rect', { x: p.x, y: p.y, width: 5, height: BOX_H, fill: color }),
        s('text', { x: p.x + 10, y: p.y + BOX_H / 2 + 5 }, label.length > max ? `${label.slice(0, max - 1)}…` : label)));
    }));
    return svg;
  }

  FCApp.pedigree = pedigree;
})(window);
