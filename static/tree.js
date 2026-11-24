// Family tree on one surface: pan/zoom, expanding ancestors and siblings, side panel of a person, search.
// Layout: root at the bottom, ancestors up, siblings beside. Data only through Chronicle (common.js).
(function () {
  'use strict';
  const { D, T, el, loadData, monogram, yearOf, localized, color, personLink, magnifier } = window.Chronicle;
  let resetMagnifier = () => {};
  const LANGUAGE = D.language;
  const NEUTRAL = '#6a5640';
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MOBILE = window.matchMedia('(max-width: 760px)');

  // sizes of cards and gaps; all cards the same size (siblings are not "lesser"), compact on mobile
  let CW, CH, ROW, GAP, GAP_S, PAR, BUS, compact;
  function dimensions() {
    compact = MOBILE.matches;
    if (compact) { CW = 132; CH = 72; ROW = 126; GAP = 14; GAP_S = 8; PAR = 10; BUS = 24; }
    else { CW = 214; CH = 76; ROW = 158; GAP = 26; GAP_S = 16; PAR = 34; BUS = 30; }
  }
  dimensions();

  let people, documents, onMap, ROOT_ID, FROM_ID;
  const expandedSet = new Set(), siblingsOpen = new Set(), childrenOpen = new Set();
  let selected = null;
  let els;

  const template = (s, values) => s.replace(/\{(\w+)\}/g, (_, k) => values[k]);
  const relationshipFormal = (o) => o.relationship || '';
  // distant relative: the relationship through the name of the nearest person ("brother of <name>") instead of "brother of 3x great-grandfather"
  function genitiveWord(w, f) {   // Czech genitive of a name (common patterns; uncertain forms are left alone); Czech letters are written as \u escapes
    if (f) {
      if (/\u00e1$/.test(w)) return w.slice(0, -1) + '\u00e9';
      if (/ia$/.test(w)) return w.slice(0, -1) + 'e';
      if (/[\u017e\u0161\u010d\u0159cj\u0165\u010f]a$/.test(w)) return w.slice(0, -1) + 'e';
      if (/a$/.test(w)) return w.slice(0, -1) + 'y';
      return w;
    }
    if (/\u00fd$/.test(w)) return w.slice(0, -1) + '\u00e9ho';
    if (/\u00ed$/.test(w)) return w + 'ho';
    if (/[^aeiouy\u00e1\u00e9\u00ed\u00f3\u00fa\u016f\u00fd]ek$/.test(w)) return w.slice(0, -2) + 'ka';
    if (/[^aeiouy\u00e1\u00e9\u00ed\u00f3\u00fa\u016f\u00fd]el$/.test(w)) return w.slice(0, -2) + 'la';
    if (/[^aeiouy\u00e1\u00e9\u00ed\u00f3\u00fa\u016f\u00fd]ec$/.test(w)) return w.slice(0, -2) + 'ce';
    if (/[cj\u017e\u0161\u010d\u0159]$/.test(w)) return w + 'e';
    if (/[\u017e\u0161\u010d\u0159cj]a$/.test(w)) return w.slice(0, -1) + 'i';
    if (/a$/.test(w)) return w.slice(0, -1) + 'y';
    if (/[bd\u010ffghklmn\u0148pqr\u0159s\u0161t\u0165vwxz]$/.test(w)) return w + 'a';
    return w;
  }
  const nameGenitive = (id) => (LANGUAGE === 'cs' ? people[id].name.split(' ').map((w) => genitiveWord(w, people[id].sex === 'F')).join(' ') : people[id].name);
  const bySex = (o, m, f) => (o.sex === 'F' ? f : m);
  const rel = (key, id) => T.roles_of[key].replace('{x}', nameGenitive(id));
  // only where the formal relationship is long ("brother of great-grandfather", "husband of sister..."); "brother of father" or "cousin" stay
  const isLong = (o) => { const f = o.relationship || ''; return /pra|great|×/i.test(f) || f.split(' ').length >= 3; };
  function relationshipByName(o) {
    const id = o.id;
    if (id === ROOT_ID || !isLong(o) || o.half_sibling) return '';   // "half" would get lost in the name
    if (o.ahnentafel != null) {   // from the 5th generation (3x great-grandfather) "father of <name>"
      if (o.ahnentafel < 32) return '';
      const child = Object.keys(people).find((k) => people[k].ahnentafel === (o.ahnentafel >> 1));
      return child ? rel(bySex(o, 'father', 'mother'), child) : '';
    }
    if (o.spouse_of && people[o.spouse_of]) {
      const a = o.spouse_of;
      // for the root, a close ancestor and the root's sibling the plain word is enough ("husband of grandmother")
      if (a === ROOT_ID || (people[a].ahnentafel != null && people[a].ahnentafel < 32) || people[a].sibling_of === ROOT_ID) return '';
      const k = o.divorced ? bySex(o, 'former_husband', 'former_wife') : o.partnership ? bySex(o, 'partner', 'partner_f') : bySex(o, 'husband', 'wife');
      return rel(k, a);
    }
    if (o.sibling_of && people[o.sibling_of] && o.sibling_of !== ROOT_ID) return rel(bySex(o, 'brother', 'sister'), o.sibling_of);
    const r = parentOfChild[id];
    if (r && r !== ROOT_ID && people[r].sibling_of !== ROOT_ID) return rel(bySex(o, 'son', 'daughter'), r);
    return '';
  }
  const relationshipText = (o) => relationshipByName(o) || relationshipFormal(o);
  const descriptionText = (x) => localized(x.description);

  // ---------- relationships ----------
  const isAncestor = (id) => people[id] && people[id].ahnentafel != null;
  const ancestorParents = (id) => (people[id].parents || []).filter(isAncestor).sort((a, b) => people[a].ahnentafel - people[b].ahnentafel);
  // siblings of ancestors (incl. half-siblings), spouses/partners and children of people outside the ancestor line
  let siblingsMap = {}, spousesMap = {}, childrenMap = {}, parentOfChild = {};
  const isSpouse = (id) => !!(people[id] && people[id].spouse_of);
  function prepareLinks() {
    siblingsMap = {}; spousesMap = {}; childrenMap = {}; parentOfChild = {};
    const add = (m, k, v) => (m[k] = m[k] || []).push(v);
    for (const [id, o] of Object.entries(people)) {
      if (o.ahnentafel != null) continue;
      if (o.sibling_of && isAncestor(o.sibling_of)) add(siblingsMap, o.sibling_of, id);
      else if (o.spouse_of && people[o.spouse_of]) add(spousesMap, o.spouse_of, id);
      else if ((o.parents || []).includes(ROOT_ID)) { add(childrenMap, ROOT_ID, id); parentOfChild[id] = ROOT_ID; }   // descendants of the chosen person
      else {
        // descendant of a sibling: the blood parent is the one who did not marry in
        const r = (o.parents || []).find((x) => people[x] && !isSpouse(x) && !isAncestor(x));
        if (r) { add(childrenMap, r, id); parentOfChild[id] = r; }
      }
    }
    const year = (id) => yearOf((people[id].birth || {}).date) || 9999;
    for (const m of [siblingsMap, childrenMap]) for (const k in m) m[k].sort((a, b) => year(a) - year(b));
    // the partner with whom they have the most children sits next to the person; divorced ones further away
    const common = (k, m) => (childrenMap[k] || []).filter((d) => (people[d].parents || []).includes(m)).length;
    for (const k in spousesMap) spousesMap[k].sort((a, b) => (people[a].divorced ? 1 : 0) - (people[b].divorced ? 1 : 0) || common(k, b) - common(k, a));
  }
  const siblings_of = (id) => siblingsMap[id] || [];
  const spouses = (id) => spousesMap[id] || [];
  const children = (id) => childrenMap[id] || [];
  const siblingAnchor = (id) => (people[id] && people[id].sibling_of) || null;

  // branches a person comes from (grandparents are a mix of two branches, the root of all)
  const BRANCH_ORDER = (D.branches || []).map((b) => b.key);
  const branchMemo = new Map();
  function personBranches(id) {
    if (branchMemo.has(id)) return branchMemo.get(id);
    branchMemo.set(id, []);
    const o = people[id];
    let v = [];
    if (o.branch && BRANCH_ORDER.includes(o.branch)) v = [o.branch];
    else if (!o.spouse_of) {
      const s = new Set();
      for (const r of o.parents || []) if (people[r] && !isSpouse(r)) personBranches(r).forEach((x) => s.add(x));
      if (!s.size && o.sibling_of && people[o.sibling_of]) personBranches(o.sibling_of).forEach((x) => s.add(x));
      v = BRANCH_ORDER.filter((x) => s.has(x));
    }
    branchMemo.set(id, v);
    return v;
  }

  function years(o) {
    if (o.living) return '';
    const n = o.birth && o.birth.date, u = o.death && o.death.date;
    const fmt = (d) => { const r = yearOf(d); if (!r) return ''; return (d.trim().toLowerCase().startsWith((T.date_about || 'about').toLowerCase()) ? '≈' : '') + r; };
    const a = fmt(n), b = fmt(u);
    if (a && b) return `${a} – ${b}`;
    if (a) return `* ${a}`;
    if (b) return `† ${b}`;
    return '';
  }
  function personColor(o) {
    const v = personBranches(o.id);
    return v.length === 1 ? color(v[0]) : NEUTRAL;
  }
  // several branches: ring and stripe made of their colours
  function mixed(o, dir) {
    const v = personBranches(o.id);
    if (v.length < 2) return null;
    const step = 100 / v.length;
    const parts = v.map((x, i) => `${color(x)} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`).join(', ');
    return dir === 'circle' ? `conic-gradient(${parts})` : `linear-gradient(to bottom, ${parts})`;
  }
  function makeBadge(o, cls) {
    const text = monogram(o.name);
    const m = el('span', { class: cls + (text.length > 1 && /[MW\u017d\u0160\u010c]/.test(text) ? ' wide' : '') + (o.sex === 'M' ? ' male' : ''), 'aria-hidden': 'true', text });
    m.style.setProperty('--branch', personColor(o));
    const k = mixed(o, 'circle');
    if (k) { m.classList.add('mixed'); m.style.setProperty('--circle', k); }
    return m;
  }

  // ---------- layout (outlines per row so that subtrees do not overlap) ----------
  // outline c: level (0 = the person's row, positive up, negative down) -> [min, max]
  function insert(target, sub, shift, dl) {
    for (const [k, v] of sub.pos) target.pos.set(k, { ...v, x: v.x + shift });
    for (const [l, [a, b]] of sub.c) {
      const L = l + dl, s = target.c.get(L);
      target.c.set(L, s ? [Math.min(s[0], a + shift), Math.max(s[1], b + shift)] : [a + shift, b + shift]);
    }
  }
  // shift so that sub lies entirely to the right (dir 1) / left (dir -1) of outline c; gap m0 on level 0
  function offsetFor(c, sub, dir, m0, dl) {
    let off = dir > 0 ? -Infinity : Infinity;
    for (const [l, [a, b]] of sub.c) {
      const s = c.get(l + dl);
      if (!s) continue;
      const m = l + dl === 0 ? m0 : GAP;
      off = dir > 0 ? Math.max(off, s[1] + m - a) : Math.min(off, s[0] - m - b);
    }
    return Number.isFinite(off) ? off : 0;
  }
  const singleCard = (id, gen, type, anchor) => ({ pos: new Map([[id, { x: 0, gen, type, anchor }]]), c: new Map([[0, [-CW / 2, CW / 2]]]) });

  // person outside the lineage: the person, their spouses and (open) children under them
  function layDown(id, gen, type, anchor, dir) {
    const u = singleCard(id, gen, type, anchor);
    spouses(id).forEach((m) => insert(u, singleCard(m, gen, 'spouse', id), offsetFor(u.c, singleCard(m, gen), dir, PAR, 0), 0));
    addChildren(u, id, gen);
    return u;
  }
  // open children under a person (centred under the couple person + first partner)
  function addChildren(u, id, gen) {
    const dd = childrenOpen.has(id) ? children(id) : [];
    if (dd.length) {
      const block = { pos: new Map(), c: new Map() };
      for (const d of dd) {
        const sub = layDown(d, gen - 1, 'descendant', id, 1);
        insert(block, sub, block.pos.size ? offsetFor(block.c, sub, 1, GAP_S, 0) : 0, 0);
      }
      // centre under the couple (person + first partner)
      const p = spouses(id).length ? u.pos.get(spouses(id)[0]).x / 2 : 0;
      const [a, b] = block.c.get(0);
      insert(u, block, p - (a + b) / 2, -1);
    }
  }

  function layout(id, gen, side) {
    const u = singleCard(id, gen, id === ROOT_ID ? 'root' : 'lineage');
    const dir = side === 'L' ? -1 : 1;
    // further partners of the ancestor (for the root on the opposite side from the sister), then siblings with their families
    const dirSpouse = id === ROOT_ID ? -dir : dir;
    for (const m of spouses(id)) insert(u, singleCard(m, gen, 'spouse', id), offsetFor(u.c, singleCard(m, gen), dirSpouse, PAR, 0), 0);
    if (siblingsOpen.has(id)) {
      for (const s of siblings_of(id)) {
        const sub = layDown(s, gen, 'sibling', id, dir);
        insert(u, sub, offsetFor(u.c, sub, dir, GAP_S, 0), 0);
      }
    }
    if (id === ROOT_ID) addChildren(u, id, gen);
    const bloodline = expandedSet.has(id) ? ancestorParents(id) : [];
    if (bloodline.length === 2) {
      const F = layout(bloodline[0], gen + 1, 'L'), M = layout(bloodline[1], gen + 1, 'R');
      let d = CW + PAR;
      for (const [l, [, fb]] of F.c) { const m = M.c.get(l); if (m) d = Math.max(d, fb - m[0] + GAP); }
      // the family of the parents' siblings (cousins...) must not reach into the own row and below
      const xf = Math.min(-d / 2, offsetFor(u.c, F, -1, GAP, 1));
      const xm = Math.max(d / 2, offsetFor(u.c, M, 1, GAP, 1));
      insert(u, F, xf, 1); insert(u, M, xm, 1);
    } else if (bloodline.length === 1) {
      const P = layout(bloodline[0], gen + 1, side);
      insert(u, P, dir > 0 ? Math.max(0, offsetFor(u.c, P, 1, GAP, 1)) : Math.min(0, offsetFor(u.c, P, -1, GAP, 1)), 1);
    }
    return u;
  }

  function layoutAll() {
    const { pos } = layout(ROOT_ID, 0, 'R');
    const target = new Map();
    for (const [id, p] of pos) {
      target.set(id, { x: p.x - CW / 2, y: -p.gen * ROW, w: CW, h: CH, gen: p.gen, type: p.type, anchor: p.anchor, o: 1 });
    }
    return target;
  }

  // ---------- rendering with animation ----------
  const cardEls = new Map();     // id -> card element
  const controlEls = new Map();       // 'r:id' | 's:id' | 'd:id' -> button (ancestors / siblings / children)
  let cur = new Map();              // id -> current {x,y,o,...}
  let animation = null;
  let dragged = false;

  function createCard(id) {
    const o = people[id];
    const b = el('button', { type: 'button', class: 'pcard' + (id === ROOT_ID ? ' root' : ''), 'data-id': id,
      'data-label': id === ROOT_ID ? T.start_label : null,
      'aria-label': `${o.name}, ${relationshipText(o)}${o.living ? '' : ', ' + T.deceased}` });
    b.style.setProperty('--branch', personColor(o));
    if (o.sex === 'M') b.classList.add('male'); else if (o.sex === 'F') b.classList.add('female');
    if (isAncestor(id)) b.classList.add('ancestor');
    if (personBranches(id).length) {
      const prt = el('span', { class: 'strip' });
      const g = mixed(o, 'strip');
      if (g) prt.style.background = g;
      b.append(prt);
    }
    if (!o.living) b.append(el('span', { class: 'ribbon', 'aria-hidden': 'true' }));
    const glyph = o.sex === 'M' ? '♂' : o.sex === 'F' ? '♀' : '';
    if (glyph) b.append(el('span', { class: 'glyph', 'aria-hidden': 'true', text: glyph }));
    b.append(makeBadge(o, 'badge'),
      el('span', { class: 'txt' },
        el('span', { class: 'pname', text: o.name }),
        years(o) ? el('span', { class: 'years', text: years(o) }) : null,
        el('span', { class: 'rel', text: relationshipText(o) })));
    if ((o.documents || []).length) b.append(el('span', { class: 'seal', title: T.has_documents, text: '✓' }));
    b.addEventListener('click', (e) => { if (dragged) return; e.stopPropagation(); select(id); });
    return b;
  }

  // the "+ / -" (parents) and "+n / -" (siblings) buttons are siblings of the card, not its children (no nested controls)
  function control(key, id, needed, create) {
    let b = controlEls.get(key);
    if (!needed) { if (b) { b.remove(); controlEls.delete(key); } return null; }
    if (!b) {
      b = el('button', { type: 'button', 'data-id': id });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => { e.stopPropagation(); if (!dragged) create(id); });
      controlEls.set(key, b); els.cards.append(b);
    }
    return b;
  }
  function updateControls(id, type) {
    const o = people[id];
    const lineage = type === 'root' || type === 'lineage';
    const r = control('r:' + id, id, lineage && ancestorParents(id).length > 0, toggleAncestors);
    if (r) {
      const ot = expandedSet.has(id);
      r.className = 'expand' + (ot ? ' collapse' : '');
      r.textContent = ot ? '−' : T.plus_parents;
      r.title = ot ? T.hide_ancestors : T.show_parents;
      r.setAttribute('aria-label', `${r.title}: ${o.name}`);
      r.setAttribute('aria-expanded', String(ot));
    }
    const n = siblings_of(id).length;
    const s = control('s:' + id, id, lineage && n > 0, toggleSiblings);
    if (s) {
      const ot = siblingsOpen.has(id);
      s.className = 'sibling-btn';
      s.textContent = ot ? '−' : `+${n}`;
      s.title = ot ? T.hide_siblings : template(T.siblings_n, { n });
      s.setAttribute('aria-label', `${s.title}: ${o.name}`);
      s.setAttribute('aria-expanded', String(ot));
    }
    const nd = children(id).length;
    const d = control('d:' + id, id, (type === 'sibling' || type === 'descendant' || type === 'root') && nd > 0, toggleChildren);
    if (d) {
      const ot = childrenOpen.has(id);
      d.className = 'children-btn';
      d.textContent = ot ? '−' : `+${nd}`;
      d.title = ot ? T.hide_children : template(T.children_n, { n: nd });
      d.setAttribute('aria-label', `${d.title}: ${o.name}`);
      d.setAttribute('aria-expanded', String(ot));
    }
  }

  function redraw(origin) {
    const target = layoutAll();
    const start = new Map();
    // new cards slide out from the card they were expanded from; disappearing ones slide back
    for (const [id, t] of target) {
      if (cur.has(id)) start.set(id, { ...cur.get(id) });
      else {
        const origin_src = origin && cur.get(origin) ? cur.get(origin) : t;
        start.set(id, { ...t, x: origin_src.x + (origin_src.w - t.w) / 2, y: origin_src.y, o: 0 });
        const e = createCard(id);
        cardEls.set(id, e); els.cards.append(e);
      }
      const e = cardEls.get(id);
      e.classList.toggle('sibling', t.type === 'sibling');
      e.classList.toggle('spouse', t.type === 'spouse');
      e.classList.toggle('descendant', t.type === 'descendant');
      updateControls(id, t.type);
    }
    const end = new Map(target);
    for (const [id, a] of cur) {
      if (target.has(id)) continue;
      const back = origin && target.get(origin) ? target.get(origin) : a;
      start.set(id, { ...a });
      end.set(id, { ...a, x: back.x + (back.w - a.w) / 2, y: back.y, o: 0, leaving: true });
      updateControls(id, 'leaving');   // a leaving card carries no controls
    }
    const durationMs = reduced() ? 0 : 520;
    animation = { start, end, t0: performance.now(), T: durationMs };
    if (!durationMs) finishAnimation(); else tickAnimation(performance.now());
  }
  const ease = (u) => (u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  function tickAnimation(time) {
    if (!animation) return;
    const u = Math.min(1, (time - animation.t0) / animation.T);
    const e = ease(u);
    cur = new Map();
    for (const [id, b] of animation.end) {
      const a = animation.start.get(id) || b;
      cur.set(id, { ...b, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, o: a.o + (b.o - a.o) * e,
        w: a.w + (b.w - a.w) * e, h: a.h + (b.h - a.h) * e });
    }
    drawPositions();
    if (u >= 1) finishAnimation(); else requestAnimationFrame(tickAnimation);
  }
  function finishAnimation() {
    if (!animation) return;
    cur = new Map();
    for (const [id, b] of animation.end) {
      if (b.leaving) { const e = cardEls.get(id); if (e) e.remove(); cardEls.delete(id); continue; }
      cur.set(id, { ...b });
    }
    animation = null;
    drawPositions();
  }

  function drawPositions() {
    const offsetFor = compact ? 8 : 12;
    for (const [id, p] of cur) {
      const e = cardEls.get(id);
      if (!e) continue;
      e.style.transform = `translate(${p.x}px, ${p.y}px)`;
      e.style.opacity = p.o;
      e.style.width = p.w + 'px'; e.style.height = p.h + 'px';
      e.style.pointerEvents = p.leaving ? 'none' : '';
      const r = controlEls.get('r:' + id), s = controlEls.get('s:' + id), d = controlEls.get('d:' + id);
      const pe = p.leaving ? 'none' : '';
      if (r) { r.style.transform = `translate(${p.x + p.w / 2}px, ${p.y - 1}px)`; r.style.opacity = p.o; r.style.pointerEvents = pe; }
      if (s) { s.style.transform = `translate(${p.x + p.w + offsetFor}px, ${p.y + p.h / 2}px)`; s.style.opacity = p.o; s.style.pointerEvents = pe; }
      if (d) { d.style.transform = `translate(${p.x + p.w / 2}px, ${p.y + p.h + 1}px)`; d.style.opacity = p.o; d.style.pointerEvents = pe; }
    }
    drawConnectors();
    drawGenerations();
  }

  function drawConnectors() {
    const parts = [];
    const R = 9;
    // the line knows whom it connects; for a selected person only the lines to their parents, partners and children stay prominent
    const glow = (ids) => (selected && ids.includes(selected) ? ' glow' : '');
    const piece = (cls, ids, attrs) => parts.push(`<path class="${(cls + glow(ids)).trim()}" ${attrs}/>`);
    const ring = (ids, attrs) => parts.push(`<circle class="wedding${glow(ids)}" ${attrs}/>`);
    const route = (x0, y0, xb, x1, y1) => {
      // straight down to the bus, horizontally, straight down to the child: rounded corners
      if (Math.abs(x1 - x0) < 1) return `M${x0},${y0}V${y1}`;
      const s = Math.sign(x1 - x0), r = Math.min(R, Math.abs(x1 - x0) / 2);
      return `M${x0},${y0}V${xb - r}Q${x0},${xb} ${x0 + s * r},${xb}H${x1 - s * r}Q${x1},${xb} ${x1},${xb + r}V${y1}`;
    };
    const rSn = compact ? 3.2 : 4.2;
    const beside = (a, b) => Math.abs(a.y - b.y) < 1 && Math.abs((a.x + a.w / 2) - (b.x + b.w / 2)) <= a.w + PAR + 2;
    // point where the lines to the couple's children start (middle of the connector, or the bottom of the card when the partner does not sit next to it)
    const pairCenter = (a, b) => {
      if (!b || !beside(a, b)) return [a.x + a.w / 2, a.y + a.h];
      const [l, r] = a.x < b.x ? [a, b] : [b, a];
      return [(l.x + l.w + r.x) / 2, l.y + l.h / 2];
    };
    const drawPair = (a, b, cls, o, withRing, ids) => {
      const [l, r] = a.x < b.x ? [a, b] : [b, a];
      if (beside(a, b)) {
        const y = l.y + l.h / 2;
        piece('pair' + cls, ids, `opacity="${o}" d="M${l.x + l.w},${y}H${r.x}"`);
        if (withRing) ring(ids, `opacity="${o}" cx="${(l.x + l.w + r.x) / 2}" cy="${y}" r="${rSn}"`);
        return;
      }
      // partner further away (behind another card): an arc under the cards
      const yb = l.y + l.h + (compact ? 7 : 10);
      piece('pair' + cls, ids, `opacity="${o}" d="M${l.x + l.w / 2},${l.y + l.h}V${yb}H${r.x + r.w / 2}V${r.y + r.h}"`);
    };
    // parents: who has the child (for highlighting), not where the line goes from
    // lineage (the child is an ancestor): thicker line in the branch colour
    const lineageClass = (d) => { if (!isAncestor(d)) return ''; const v = personBranches(d); return 'bloodline' + (v.length === 1 ? ' branch-' + v[0] : ''); };
    const toChildren = (mx, my, ids, o, parents) => {
      for (const d of ids) {
        const q = cur.get(d);
        if (q) piece(lineageClass(d), [...parents, d], `opacity="${Math.min(o, q.o)}" d="${route(mx, my, q.y - BUS, q.x + q.w / 2, q.y)}"`);
      }
    };
    for (const [id, p] of cur) {
      if (p.type === 'root' || p.type === 'lineage') {
        // parents -> line child and their (own) siblings
        const sibling = siblings_of(id).filter((s) => cur.has(s) && cur.get(s).anchor === id);
        const bloodline = ancestorParents(id).filter((r) => cur.has(r));
        if (bloodline.length) {
          const pa = bloodline.map((r) => cur.get(r));
          const o = Math.min(p.o, ...pa.map((q) => q.o));
          let mx, my;
          if (pa.length === 2) {   // parents in the lineage: always a straight line (nobody sits between them), a ring in the middle
            const [f, m] = pa[0].x < pa[1].x ? pa : [pa[1], pa[0]];
            my = f.y + f.h / 2; mx = (f.x + f.w + m.x) / 2;
            // other cards (cousins) sit between the parents: the couple's line runs under the cards, not through them
            const between = [...cur].some(([k, q]) => !bloodline.includes(k) && q.o > .05 && Math.abs(q.y - f.y) < 1 && q.x + q.w > f.x + f.w + 1 && q.x < m.x - 1);
            if (between) {
              const yb = f.y + f.h + (compact ? 12 : 18), fx = f.x + f.w / 2, gx = m.x + m.w / 2;
              mx = Math.min(gx, Math.max(fx, p.x + p.w / 2)); my = yb;
              piece('pair bloodline', bloodline, `opacity="${o}" d="M${fx},${f.y + f.h}V${yb}H${gx}V${m.y + m.h}"`);
            } else piece('pair bloodline', bloodline, `opacity="${o}" d="M${f.x + f.w},${my}H${m.x}"`);
            ring(bloodline, `opacity="${o}" cx="${mx}" cy="${my}" r="${rSn}"`);
          }
          else { mx = pa[0].x + pa[0].w / 2; my = pa[0].y + pa[0].h; }
          toChildren(mx, my, [id, ...sibling.filter((s) => !people[s].half_sibling)], o, bloodline);
        }
        // half-siblings: from the ancestor and their other partner
        for (const s of sibling.filter((x) => people[x].half_sibling)) {
          const r = (people[s].parents || []).find((x) => cur.has(x) && isAncestor(x));
          if (!r) continue;
          const m = (people[s].parents || []).find((x) => x !== r && cur.has(x));
          const [mx, my] = pairCenter(cur.get(r), m && cur.get(m));
          toChildren(mx, my, [s], cur.get(r).o, m ? [r, m] : [r]);
        }
      } else if (p.type === 'spouse') {
        const a = cur.get(p.anchor);
        const o = people[id];
        if (a) drawPair(a, p, o.divorced ? ' divorced' : o.partnership ? ' partners' : '', Math.min(a.o, p.o), !o.divorced && !o.partnership, [p.anchor, id]);
      } else if (p.type === 'descendant') {
        const r = cur.get(p.anchor);
        if (!r) continue;
        const m = (people[id].parents || []).find((x) => x !== p.anchor && cur.has(x) && cur.get(x).type === 'spouse');
        const [mx, my] = pairCenter(r, m && cur.get(m));
        toChildren(mx, my, [id], Math.min(r.o, p.o), m ? [p.anchor, m] : [p.anchor]);
      }
    }
    els.connectors.innerHTML = parts.join('');
    els.connectors.classList.toggle('select', !!selected && cardEls.has(selected));
    if (selected) els.connectors.style.setProperty('--branch', personColor(people[selected]));
  }

  // ---------- camera ----------
  const cam = { x: 0, y: 0, k: 1 };
  let camAnimation = null, zoomTarget = null, momentum = null;
  const topEdge = () => els.bar.getBoundingClientRect().bottom;   // below the thin navigation strip and the bar
  function applyCamera() {
    els.surface.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`;
    drawGenerations();
  }
  function drawGenerations() {
    const gens = new Set([...cur.values()].filter((p) => !p.leaving).map((p) => p.gen));
    const v = topEdge();
    const spany = [];
    for (const g of [...gens].sort((a, b) => a - b)) {
      const y = (-g * ROW + CH / 2) * cam.k + cam.y;   // vertically at the middle of the row's cards
      if (y < v + 10 || y > window.innerHeight - 10) continue;
      const names = [people[ROOT_ID].name.split(' ')[0], ...T.generations_up.slice(1)];
      const n = g < 0 ? (T.generations_down || [])[-g - 1] || T.younger_generation : names[g] || template(T.generation_far, { n: g - 2 });
      const s = el('span', { class: 'gen-label', text: n });
      s.style.top = y + 'px';
      spany.push(s);
    }
    els.generations.replaceChildren(...spany);
  }
  function freeWidth() {
    return !els.panel.hidden && window.innerWidth > 760 ? window.innerWidth - 410 : window.innerWidth;
  }
  function freeHeight() {
    return !els.panel.hidden && window.innerWidth <= 760 ? window.innerHeight - els.panel.getBoundingClientRect().height : window.innerHeight;
  }
  function animateCamera(target, duration) {
    if (reduced()) { Object.assign(cam, target); applyCamera(); return; }
    camAnimation = { a: { ...cam }, b: target, t0: performance.now(), T: duration || 700 };
    zoomTarget = null; momentum = null;
  }
  function centerOn(id, k) {
    const p = cur.get(id) || layoutAll().get(id);
    if (!p) return;
    k = k || Math.max(cam.k, .85);
    const v = topEdge();
    const sx = freeWidth() / 2, sy = v + (freeHeight() - v) / 2;
    animateCamera({ k, x: sx - (p.x + p.w / 2) * k, y: sy - (p.y + p.h / 2) * k });
  }
  function boundsOf(target, ids) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const id of ids || target.keys()) {
      const p = target.get(id); if (!p) continue;
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h);
    }
    return { x0, y0, x1, y1 };
  }
  function overview(duration) {
    const target = layoutAll();
    const v = topEdge();
    const W = freeWidth(), H = freeHeight() - v - 70;
    // mobile: the default view frames the root, their parents and sister so that it is readable
    const ids = compact && duration === 0 ? [ROOT_ID, ...ancestorParents(ROOT_ID), ...(siblingsOpen.has(ROOT_ID) ? siblings_of(ROOT_ID) : [])] : null;
    const { x0, y0, x1, y1 } = boundsOf(target, ids);
    const leftPad = compact ? 44 : 100, margin = compact ? 20 : 40;   // room on the left for generation labels
    const k = Math.max(.1, Math.min(compact && ids ? 1.1 : 1.05, (W - leftPad - margin) / (x1 - x0), (H - 40) / (y1 - y0)));
    const c = { k, x: leftPad + (W - leftPad) / 2 - (x0 + x1) / 2 * k, y: v + 20 + (H - 40) / 2 - (y0 + y1) / 2 * k + 14 };
    if (duration === 0) { Object.assign(cam, c); applyCamera(); } else animateCamera(c, duration);
  }
  function cameraLoop(time) {
    if (camAnimation) {
      const u = Math.min(1, (time - camAnimation.t0) / camAnimation.T), e = ease(u);
      const { a, b } = camAnimation;
      // zoom in the logarithm, shift so that the centre arrives smoothly
      const k = Math.exp(Math.log(a.k) + (Math.log(b.k) - Math.log(a.k)) * e);
      const W = window.innerWidth / 2, H = window.innerHeight / 2;
      const wa = [(W - a.x) / a.k, (H - a.y) / a.k], wb = [(W - b.x) / b.k, (H - b.y) / b.k];
      const wx = wa[0] + (wb[0] - wa[0]) * e, wy = wa[1] + (wb[1] - wa[1]) * e;
      cam.k = k; cam.x = W - wx * k; cam.y = H - wy * k;
      applyCamera();
      if (u >= 1) camAnimation = null;
    } else if (zoomTarget) {
      const f = Math.exp((Math.log(zoomTarget.k) - Math.log(cam.k)) * .28);
      zoomAround(zoomTarget.sx, zoomTarget.sy, f);
      if (Math.abs(Math.log(zoomTarget.k / cam.k)) < .002) zoomTarget = null;
    } else if (momentum) {
      cam.x += momentum.vx; cam.y += momentum.vy;
      momentum.vx *= .92; momentum.vy *= .92;
      applyCamera();
      if (Math.hypot(momentum.vx, momentum.vy) < .2) momentum = null;
    }
    requestAnimationFrame(cameraLoop);
  }
  function zoomAround(sx, sy, f) {
    const k = Math.max(.1, Math.min(2.4, cam.k * f));
    const wx = (sx - cam.x) / cam.k, wy = (sy - cam.y) / cam.k;
    cam.k = k; cam.x = sx - wx * k; cam.y = sy - wy * k;
    applyCamera();
  }

  function surfaceControls() {
    const vp = els.viewport;
    const show = new Map();
    let start = null, pinch = null, last = [];
    vp.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      // a text selected elsewhere (bar, panel) would turn dragging into dragging the text
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) selection.removeAllRanges();
      show.set(e.pointerId, [e.clientX, e.clientY]);
      start = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
      dragged = false; camAnimation = null; momentum = null; zoomTarget = null; last = [];
      if (show.size === 2) { const [a, b] = [...show.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: cam.k }; }
    });
    vp.addEventListener('pointermove', (e) => {
      if (!show.has(e.pointerId)) return;
      const prev = show.get(e.pointerId);
      show.set(e.pointerId, [e.clientX, e.clientY]);
      if (show.size === 2 && pinch) {
        const [a, b] = [...show.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        zoomAround((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (pinch.k * d / pinch.d) / cam.k);
        cam.x += (e.clientX - prev[0]) / 2; cam.y += (e.clientY - prev[1]) / 2; applyCamera();
        dragged = true; return;
      }
      if (!dragged && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) {
        dragged = true; vp.classList.add('dragging'); vp.setPointerCapture(e.pointerId);
      }
      if (dragged) {
        cam.x += e.clientX - prev[0]; cam.y += e.clientY - prev[1]; applyCamera();
        last.push([performance.now(), e.clientX, e.clientY]); if (last.length > 5) last.shift();
      }
    });
    const end = (e) => {
      show.delete(e.pointerId);
      if (show.size < 2) pinch = null;
      if (!show.size) {
        vp.classList.remove('dragging');
        if (dragged && last.length > 1 && !reduced()) {
          const [t0, x0, y0] = last[0], [t1, x1, y1] = last[last.length - 1];
          const dt = Math.max(16, t1 - t0);
          if (performance.now() - t1 < 80) momentum = { vx: (x1 - x0) / dt * 16, vy: (y1 - y0) / dt * 16 };
        }
        setTimeout(() => { dragged = false; }, 0);
      }
    };
    vp.addEventListener('pointerup', end); vp.addEventListener('pointercancel', end);
    vp.addEventListener('dragstart', (e) => e.preventDefault());
    vp.addEventListener('wheel', (e) => {
      e.preventDefault(); camAnimation = null; momentum = null;
      if (e.ctrlKey || e.deltaMode || Math.abs(e.deltaY) >= 40 || !Number.isInteger(e.deltaY)) {
        const k0 = zoomTarget ? zoomTarget.k : cam.k;
        zoomTarget = { k: Math.max(.1, Math.min(2.4, k0 * Math.exp(-e.deltaY * (e.deltaMode ? .05 : .0022) * (e.ctrlKey ? 4 : 1)))), sx: e.clientX, sy: e.clientY };
      } else { cam.x -= e.deltaX; cam.y -= e.deltaY; applyCamera(); }   // touchpad: pan
    }, { passive: false });
    vp.addEventListener('click', () => { if (!dragged) closePanel(); });
    vp.addEventListener('keydown', (e) => {
      const step = 60;
      if (e.key === 'ArrowLeft') cam.x += step; else if (e.key === 'ArrowRight') cam.x -= step;
      else if (e.key === 'ArrowUp') cam.y += step; else if (e.key === 'ArrowDown') cam.y -= step;
      else if (e.key === '+' || e.key === '=') zoomAround(innerWidth / 2, innerHeight / 2, 1.2);
      else if (e.key === '-') zoomAround(innerWidth / 2, innerHeight / 2, 1 / 1.2);
      else return;
      e.preventDefault(); applyCamera();
    });
    document.getElementById('b-plus').addEventListener('click', () => { zoomTarget = { k: Math.min(2.4, cam.k * 1.35), sx: freeWidth() / 2, sy: innerHeight / 2 }; });
    document.getElementById('b-minus').addEventListener('click', () => { zoomTarget = { k: Math.max(.1, cam.k / 1.35), sx: freeWidth() / 2, sy: innerHeight / 2 }; });
    document.getElementById('b-center').addEventListener('click', () => { closePanel(); centerOn(ROOT_ID, 1); });
    document.getElementById('b-all').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      // whole tree: all ancestors, all siblings and all their families
      const ids = Object.keys(people);
      const all = ids.every((id) => (!isAncestor(id) || ((!ancestorParents(id).length || expandedSet.has(id)) && (!siblings_of(id).length || siblingsOpen.has(id))))
        && (!children(id).length || isAncestor(id) || childrenOpen.has(id)));
      if (all) {
        expandedSet.clear(); siblingsOpen.clear(); childrenOpen.clear();
        defaultExpansion(); siblingsOpen.add(ROOT_ID); btn.textContent = T.expand_all;
      } else {
        for (const id of ids) {
          if (isAncestor(id)) { if (ancestorParents(id).length) expandedSet.add(id); if (siblings_of(id).length) siblingsOpen.add(id); }
          if (children(id).length && (!isAncestor(id) || id === ROOT_ID)) childrenOpen.add(id);
        }
        btn.textContent = T.collapse;
      }
      redraw(null); setTimeout(() => overview(800), 40);
    });
  }

  // ---------- actions ----------
  function toggleAncestors(id) {
    if (expandedSet.has(id)) {
      // collapse everything above too
      const removeSubtree = (x) => { expandedSet.delete(x); for (const r of ancestorParents(x)) { removeSubtree(r); siblingsOpen.delete(r); } };
      removeSubtree(id);
      redraw(id);
    } else {
      expandedSet.add(id);
      redraw(id);
      // move the view so that the new parents are visible
      setTimeout(() => { const r = ancestorParents(id); if (r.length) ensureVisible([id, ...r]); }, 60);
    }
  }
  function toggleSiblings(id) {
    if (siblingsOpen.has(id)) siblingsOpen.delete(id); else siblingsOpen.add(id);
    redraw(id);
    if (siblingsOpen.has(id)) setTimeout(() => ensureVisible([id, ...siblings_of(id)]), 60);
  }
  function toggleChildren(id) {
    if (childrenOpen.has(id)) {
      const removeSubtree = (x) => { childrenOpen.delete(x); children(x).forEach(removeSubtree); };
      removeSubtree(id);
    } else childrenOpen.add(id);
    redraw(id);
    if (childrenOpen.has(id)) setTimeout(() => ensureVisible([id, ...children(id)]), 60);
  }
  function ensureVisible(ids) {
    const target = layoutAll();
    const { x0, y0, x1, y1 } = boundsOf(target, ids);
    const W = freeWidth(), H = freeHeight(), v = topEdge();
    const sx0 = x0 * cam.k + cam.x, sx1 = x1 * cam.k + cam.x, sy0 = y0 * cam.k + cam.y, sy1 = y1 * cam.k + cam.y;
    if (sx0 > 20 && sx1 < W - 20 && sy0 > v + 20 && sy1 < H - 80) return;
    const k = Math.min(cam.k, (W - 60) / (x1 - x0), (H - v - 140) / (y1 - y0));
    animateCamera({ k, x: W / 2 - (x0 + x1) / 2 * k, y: v + (H - v) / 2 - (y0 + y1) / 2 * k });
  }
  // path from the root to a person (expand ancestors, siblings, siblings' children; a partner shows up with the spouse)
  function reveal(id) {
    if (!people[id]) return;
    if (people[id].spouse_of) return reveal(people[id].spouse_of);
    if (parentOfChild[id]) { childrenOpen.add(parentOfChild[id]); return reveal(parentOfChild[id]); }
    let anchor = id;
    if (!isAncestor(id)) {
      anchor = siblingAnchor(id);
      if (anchor) siblingsOpen.add(anchor);
    }
    if (!anchor || !isAncestor(anchor)) return;
    let n = people[anchor].ahnentafel;
    while (n > 1) { n = Math.floor(n / 2); const x = Object.keys(people).find((k) => people[k].ahnentafel === n); if (x) expandedSet.add(x); }
  }
  const jump = (id) => { reveal(id); redraw(null); setTimeout(() => select(id, true), 80); };

  function select(id, center_it) {
    if (selected && cardEls.get(selected)) cardEls.get(selected).classList.remove('selected');
    selected = id;
    const e = cardEls.get(id);
    if (e) { e.classList.add('selected'); e.classList.remove('highlight'); void e.offsetWidth; if (center_it) e.classList.add('highlight'); }
    els.panel.hidden = false;
    drawConnectors();
    renderPanel(id);
    if (center_it) centerOn(id, Math.max(cam.k, .9));
    else ensureVisible([id]);
  }
  function closePanel() {
    els.panel.hidden = true;
    if (selected && cardEls.get(selected)) cardEls.get(selected).classList.remove('selected');
    selected = null;
    drawConnectors();
  }

  function renderPanel(id) {
    const o = people[id];
    const p = els.panelContent;
    p.replaceChildren();
    els.panel.style.setProperty('--branch', personColor(o));
    const branchName = personBranches(id).map((v) => D.branchMap[v] ? localized(D.branchMap[v].name) : '').filter(Boolean).join(' · ');
    p.append(el('div', { class: 'p-head' },
      makeBadge(o, 'badge'),
      el('div', null, el('h2', { text: o.name }), el('div', { class: 'p-relationship', text: relationshipText(o) }),
        relationshipByName(o) ? el('div', { class: 'p-relationship2', text: relationshipFormal(o) }) : null,
        branchName ? el('span', { class: 'p-branch', text: branchName }) : null)));
    const dl = el('dl', { class: 'p-details' });
    const row = (k, val) => { if (val) dl.append(el('dt', { text: k }), el('dd', { text: val })); };
    if (o.living) {
      row(T.town_lc, o.town);
      if (dl.children.length) p.append(dl);
      p.append(el('p', { class: 'p-note', text: T.living_note }));
    } else {
      const fmt = (u) => u ? [u.date, u.place].filter(Boolean).join(', ') : '';
      row(T.born_lc, fmt(o.birth)); row(T.died_lc, fmt(o.death)); row(T.age_lc, o.death_age); row(T.cause_lc, o.death_cause);
      for (const sn of o.marriages || []) row(T.marriage_lc, [sn.spouse && people[sn.spouse] ? people[sn.spouse].name : '', sn.date, sn.place].filter(Boolean).join(', '));
      row(T.occupation_lc, (o.occupations || []).join('; '));
      row(T.town_lc, o.town);
      if (dl.children.length) p.append(dl);
    }
    const actions = el('div', { class: 'p-actions' });
    const card = personLink(id);
    if (card) actions.append(el('a', { class: 'main', href: card, text: T.person_page }));
    if (!o.living && onMap.has(id)) actions.append(el('a', { href: D.lang_root + 'map.html#person=' + id, text: T.show_on_map }));
    if (isAncestor(id) && ancestorParents(id).length && !expandedSet.has(id)) actions.append(el('button', { type: 'button', text: T.show_parents_button, onclick: () => { toggleAncestors(id); renderPanel(id); } }));
    if (siblings_of(id).length && !siblingsOpen.has(id)) actions.append(el('button', { type: 'button', text: template(T.siblings_button, { n: siblings_of(id).length }), onclick: () => { toggleSiblings(id); renderPanel(id); } }));
    if ((!isAncestor(id) || id === ROOT_ID) && children(id).length && !childrenOpen.has(id) && cardEls.has(id)) actions.append(el('button', { type: 'button', text: template(T.children_button, { n: children(id).length }), onclick: () => { toggleChildren(id); renderPanel(id); } }));
    if (id !== FROM_ID) actions.append(el('button', { type: 'button', class: 'from-person', text: T.view_draw_from_person, onclick: () => window.Chronicle.view.set(id) }));
    if (actions.children.length) p.append(actions);
    // own documents (the record is about the person) and separately mentions (in someone else's record as a parent, godparent...)
    const documentList = (ids) => {
      const doc = (ids || []).map((d) => documents[d]).filter((x) => x && x.crop);
      if (!doc.length) return null;
      const ul = el('ul');
      for (const x of doc) {
        const caption = descriptionText(x);
        ul.append(el('li', { class: x.verified ? '' : 'unverified' }, el('a', { href: D.root_path + (x.sheet || x.crop), title: caption,
          onclick: (e) => { e.preventDefault(); showDocument(x); } },
        el('img', { src: D.root_path + x.crop, alt: '', loading: 'lazy' }), caption.length > 70 ? caption.slice(0, 68) + '…' : caption)));
      }
      return { n: doc.length, ul };
    };
    const own = documentList(o.documents), mentionsList = documentList(o.mentions);
    if (own) p.append(el('section', { class: 'p-documents' }, el('h3', { text: template(T.documents_n, { n: own.n }) }), own.ul));
    if (mentionsList) p.append(el('details', { class: 'p-documents p-mentions' }, el('summary', { text: template(T.tree_mentions, { n: mentionsList.n }) }), mentionsList.ul));
    // family: parents, children and siblings as quick jumps
    const bloodline = (o.parents || []).filter((r) => people[r]);
    const k = siblingAnchor(id);
    const sibling = isAncestor(id) ? siblings_of(id)
      : k && people[k] ? [k, ...siblings_of(k).filter((x) => x !== id)]
        : parentOfChild[id] ? children(parentOfChild[id]).filter((x) => x !== id) : [];
    const child = Object.keys(people).filter((x) => (people[x].parents || []).includes(id));
    // partners: married into the person, the person married into someone, for an ancestor the other parent of their line child
    const partners = [...spouses(id), ...(o.spouse_of ? [o.spouse_of] : [])];
    if (isAncestor(id)) {
      for (const x of child) if (isAncestor(x)) for (const r of ancestorParents(x)) if (r !== id && !partners.includes(r)) partners.push(r);
    }
    p.append(familyPanel(id, bloodline, partners, child, sibling));
  }
  // family by groups: parents / partners with their children below each / other children / siblings
  function familyPanel(id, bloodline, partners, child, sibling) {
    const o = people[id], R = T.roles;
    const row = (x, role) => el('li', null, el('button', { type: 'button', onclick: () => jump(x) },
      makeBadge(people[x], 'badge mini'),
      el('span', { class: 'r-name' }, people[x].name, years(people[x]) ? el('small', { class: 'r-years', text: years(people[x]) }) : null),
      role ? el('small', { class: 'r-role', text: role }) : null));
    const block = (title, items) => el('div', { class: 'r-block' }, el('h4', { text: title }), el('ul', null, ...items));
    const sectionEl = el('section', { class: 'p-family' }, el('h3', { text: T.family }));
    const childRow = (d) => row(d, bySex(people[d], R.son, R.daughter));
    if (bloodline.length) sectionEl.append(block(T.group_parents, bloodline.map((x) => row(x, people[x].sex === 'M' ? R.father : people[x].sex === 'F' ? R.mother : T.parent_lc))));
    const leftover = new Set(child);
    for (const pa of partners) {
      const after = people[pa], union = (o.partners || {})[pa] || (after.partners || {})[id] || '';
      const div = after.divorced || o.divorced || union === 'divorced', prt = after.partnership || o.partnership || union === 'partner';
      const top = div ? bySex(after, R.former_husband, R.former_wife) : prt ? bySex(after, R.partner, R.partner_f) : bySex(after, R.husband, R.wife);
      const theirs = child.filter((d) => (people[d].parents || []).includes(pa));
      theirs.forEach((d) => leftover.delete(d));
      const sn = (o.marriages || []).find((x) => x.spouse === pa);
      const b = block(top, [row(pa, sn ? '∞ ' + [sn.date, sn.place].filter(Boolean).join(', ') : '')]);
      if (theirs.length) b.append(el('ul', { class: 'r-children' }, ...theirs.map(childRow)));
      sectionEl.append(b);
    }
    if (leftover.size) sectionEl.append(block(T.group_children, [...leftover].map(childRow)));
    if (sibling.length) sectionEl.append(block(T.group_siblings, sibling.map((x) => row(x, bySex(people[x], R.brother, R.sister)))));
    return sectionEl.children.length > 1 ? sectionEl : document.createDocumentFragment();
  }
  function showDocument(x) {
    const lb = els.lightbox;
    const img = lb.querySelector('img');
    img.src = D.root_path + (x.sheet || x.crop);
    img.alt = descriptionText(x);
    lb.querySelector('figcaption').textContent = descriptionText(x);
    resetMagnifier();
    lb.hidden = false;
  }

  // ---------- search ----------
  const stripDiacritics = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function search() {
    const inp = document.getElementById('search'), ul = document.getElementById('suggestions');
    let results = [], i = 0;
    const show = () => {
      ul.replaceChildren();
      results.forEach((id, j) => {
        const o = people[id];
        ul.append(el('li', { role: 'option', 'data-id': id, 'aria-selected': j === i ? 'true' : 'false', onmousedown: (e) => { e.preventDefault(); choose(id); } },
          makeBadge(o, 'badge mini'),
          el('span', null, o.name, el('small', { text: [relationshipText(o), years(o)].filter(Boolean).join(' · ') }))));
      });
      ul.hidden = !results.length; inp.setAttribute('aria-expanded', String(!ul.hidden));
    };
    const choose = (id) => {
      inp.value = people[id].name; ul.hidden = true; inp.setAttribute('aria-expanded', 'false'); inp.blur();
      jump(id);
    };
    inp.addEventListener('input', () => {
      const q = stripDiacritics(inp.value.trim());
      results = q.length < 2 ? [] : Object.keys(people).filter((id) => stripDiacritics(people[id].name).includes(q)).slice(0, 10);
      i = 0; show();
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { i = Math.min(results.length - 1, i + 1); show(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { i = Math.max(0, i - 1); show(); e.preventDefault(); }
      else if (e.key === 'Enter' && results[i]) { choose(results[i]); }
      else if (e.key === 'Escape') { ul.hidden = true; inp.setAttribute('aria-expanded', 'false'); }
    });
    inp.addEventListener('blur', () => setTimeout(() => { ul.hidden = true; inp.setAttribute('aria-expanded', 'false'); }, 120));
  }

  // desktop: four generations; mobile: only the root with parents (the cards fit into the default view)
  function defaultExpansion() {
    childrenOpen.add(ROOT_ID);
    if (compact) { expandedSet.add(ROOT_ID); return; }
    for (const id of Object.keys(people)) if (isAncestor(id) && people[id].ahnentafel < 8) expandedSet.add(id);
  }

  async function start() {
    els = {
      viewport: document.getElementById('viewport'), surface: document.getElementById('surface'),
      connectors: document.getElementById('connectors'), cards: document.getElementById('cards'),
      generations: document.getElementById('generations'), panel: document.getElementById('panel'),
      panelContent: document.getElementById('panel-content'), lightbox: document.getElementById('lightbox'),
      bar: document.querySelector('.bar'),
    };
    const d = await loadData(['people', 'documents', 'events', 'lines']);
    if (!Object.values(d.people).some((o) => o.ahnentafel === 1)) throw new Error('people: no root (ahnentafel 1)');
    // the whole tree always from the root; the chosen person only changes the relationship words and the tree centres on them
    const view = window.Chronicle.view.prepare(d.people, els.bar, true);
    people = view.people; documents = d.documents;
    ROOT_ID = view.root; FROM_ID = view.from;
    if (!view.isRoot) els.bar.querySelector('.bar-title small').textContent = template(T.view_subtitle, { name: people[FROM_ID].name });
    onMap = new Set();
    for (const u of d.events) if (u.year != null) u.people.forEach((x) => onMap.add(x));
    for (const l of d.lines) if (l.points.some((b) => b[2] != null)) onMap.add(l.from);
    for (const [id, o] of Object.entries(d.people)) if (o.living) onMap.delete(id);
    for (const [i, x] of Object.entries(people)) x.id = i;
    prepareLinks();
    defaultExpansion();
    siblingsOpen.add(ROOT_ID);        // the sister (siblings of the root) is next to the root from the start
    await document.fonts.ready;
    redraw(null);
    finishAnimation();
    overview(0);
    surfaceControls();
    search();
    document.getElementById('panel-close').addEventListener('click', closePanel);
    resetMagnifier = magnifier(els.lightbox);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!els.lightbox.hidden) { els.lightbox.hidden = true; resetMagnifier(); } else closePanel(); } });
    window.addEventListener('resize', () => applyCamera());
    MOBILE.addEventListener('change', () => {   // switch between the mobile and the wide layout
      dimensions();
      for (const e of [...cardEls.values(), ...controlEls.values()]) e.remove();
      controlEls.clear();
      cardEls.clear(); cur = new Map(); animation = null;
      expandedSet.clear(); defaultExpansion();
      redraw(null); finishAnimation(); overview(0);
    });
    requestAnimationFrame(cameraLoop);
    const params = new URLSearchParams(location.search.slice(1) + '&' + location.hash.slice(1));
    const pcard = params.get('person');
    if (pcard && Object.hasOwn(people, pcard)) setTimeout(() => jump(pcard), 100);
    else if (FROM_ID !== ROOT_ID) setTimeout(() => jump(FROM_ID), 100);
    // test hook: browser.mjs drives the tree through it (select a person, expand, camera); normal code does not read it
    window.__tree = { select: jump, toggleAncestors, toggleSiblings, overview, cam };
  }
  start().catch((e) => { console.debug(e); document.body.append(el('p', { class: 'tree-error', text: T.tree_load_error })); });
})();
