// Film on the map: from the data (events, lines, places, people) builds chapters per branch,
// in them stops (place + events) and pen legs (moves). A pure function without DOM.
// In the browser `window.Film` (loaded with <script defer> before map-draw.js and map-film.js),
// in Node `module.exports` (tests).
(function (g) {
  'use strict';

  const ROMAN_PARTS = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  const roman = (n) => { let r = ''; for (const [v, s] of ROMAN_PARTS) while (n >= v) { r += s; n -= v; } return r; };
  const NEUTRAL_COLOR = '#6a5640';

  const CLUSTER_KM = 3.5;       // places closer than this are one point on the map (a town and its districts)
  const TARGET_KM = 30;          // the pen leg ends at a stop that is closer to the target than this
  const MERGE_YEARS = 15;     // consecutive events in the same place = one stop...
  const MAX_EVENTS = 4;     // ...but at most this many are on the card, the rest is only counted (more)
  const WINDOW_YEARS = 5;         // stops without a leg within this window are ordered by proximity
  const NO_LINE_KM = 40;     // a stop without a line merges with the previous one if it is closer than this...
  const NO_LINE_YEARS = 1;     // ...and at most that many years later
  const SECONDARY_KM = 600;   // longest leg of a secondary person (a move without a line of its own)

  const GLYPHS = {
    birth: '✶', death: '✝', burial: '✝', marriage: '⚭', move: '➝', transport: '➝', war: '⚔', other: '❧',
  };

  function km(a, b) {
    const R = 6371, r = Math.PI / 180;
    const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // order within a year by the date text: "5. 3. 1890", "5 Mar 1890", "March 1890", a season, "1890-92" (= 0)
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const SEASONS = { winter: 1, spring: 4, summer: 7, autumn: 10, fall: 10 };
  function month(date) {
    const d = (date || '').toLowerCase();
    const m = /\d+\.\s*(\d+)\.\s*\d{4}/.exec(d);
    if (m) return +m[1];
    if (/\d{4}\s*[–-]\s*\d{2,4}/.test(d)) return 0;
    const word = /[a-z]{3,}/.exec(d);
    if (word) {
      const i = MONTHS.indexOf(word[0].slice(0, 3));
      if (i >= 0 && !(word[0] in SEASONS)) return i + 1;
      if (word[0] in SEASONS) return SEASONS[word[0]];
    }
    return 0;
  }

  function build(data, options) {
    options = options || {};
    const language = options.language || 'en';
    const strings = options.strings || {};
    const { events, lines, places, people } = data;
    const living = (id) => !!(people[id] && people[id].living);

    // the film knows nothing about a living person
    if (options.person && living(options.person)) return { chapters: [], steps: [], clusters: [], legs: [], living: true };

    // branches: the list from the page data ({key, name, color, chronicle}); its order is the order of the chapters
    const branches = (options.branches || []).map((b) => (typeof b === 'string' ? { key: b } : b));
    const branchOf = (key) => branches.find((b) => b.key === key) || { key };
    // a branch with `map_chapter` has no chapter of its own: its stops and legs join the chapter of that branch
    const chapterOf = (key) => branchOf(key).map_chapter || key;
    const branchColor = (v) => branchOf(v).color || NEUTRAL_COLOR;
    const entry = (k) => (strings.chapters && strings.chapters[k]) || {};
    // chapter texts are keyed by the chronicle slug; a branch without them falls back to its name
    const chapterText = (key) => {
      const b = branchOf(key), t = entry(b.chronicle), nm = (b.name && (b.name[language] || Object.values(b.name)[0])) || key;
      return { title: t.title || nm, short: t.short || nm, subtitle: t.subtitle || '' };
    };
    const typeName = (t) => (strings.event_types && strings.event_types[t]) || '';

    // place clusters
    const clusters = [];   // {id, coords, name, names:[], country}
    const placeCluster = {};
    const placeNames = Object.keys(places).sort((a, b) => a.length - b.length); // "Town" before "Town-District"
    for (const n of placeNames) {
      const s = places[n].coords;
      let cluster = clusters.find((x) => km(x.coords, s) < CLUSTER_KM);
      if (!cluster) {
        cluster = { id: 'm' + clusters.length, coords: s, name: n, names: [], country: places[n].country[language] || Object.values(places[n].country)[0] };
        clusters.push(cluster);
      }
      cluster.names.push(n);
      placeCluster[n] = cluster;
    }
    const clusterAt = (lat, lon) => {
      let best = null, bd = 1e9;
      for (const cluster of clusters) { const d = km(cluster.coords, [lat, lon]); if (d < bd) { bd = d; best = cluster; } }
      return bd < CLUSTER_KM ? best : null;
    };

    const direct = (id) => people[id] && people[id].ahnentafel != null && !living(id);
    // sibling = same parents (living people carry no sibling_of, only parents)
    const sibling = (id, root) => {
      const a = people[id].parents || [], b = people[root].parents || [];
      return people[id].sibling_of === root || (a.length > 0 && a.length === b.length && a.every((r) => b.includes(r)));
    };
    const name = (id) => (people[id] && people[id].name) || id;

    // event selection: direct ancestors, events without people (history of a town) and moves; never an event of a living person
    const select = events.filter((u) => u.year != null && places[u.place] && !u.people.some(living) && (
      !u.people.length || u.people.some(direct) || ['move', 'transport', 'war', 'other', 'marriage'].includes(u.type)));

    // pen legs from the lines (sorted points, neighbouring points in different clusters)
    const legs = [];
    lines.forEach((l, li) => {
      if (living(l.from)) return;
      const points = l.points.map((b, i) => ({ lat: b[0], lon: b[1], year: b[2], certainty: b[3], i }))
        .sort((a, b) => (a.year == null) - (b.year == null) || (a.year || 0) - (b.year || 0) || a.i - b.i);
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const sa = clusterAt(a.lat, a.lon), sb = clusterAt(b.lat, b.lon);
        if (!sa || !sb || sa === sb) continue;
        legs.push({ id: 't' + legs.length, lineIndex: li, from: sa, to: sb, branch: chapterOf(l.branch),
          yearFrom: a.year, year: b.year, certainty: b.certainty, uncertain: b.certainty === 'uncertain' || a.certainty === 'uncertain',
          noYear: b.year == null, traveller: name(l.from) });
      }
    });

    const add = (step, u) => {
      if (step.events.length < MAX_EVENTS) step.events.push(u); else step.more++;
      step.yearTo = Math.max(step.yearTo, u.year);
    };

    // chapters and stops (chronological for now)
    const chapters = [];
    let steps = [];
    for (const { key: v } of branches) {
      if (chapterOf(v) !== v) continue;
      let ev = select.filter((u) => chapterOf(u.branch) === v);
      if (options.person) ev = ev.filter((u) => u.people.includes(options.person));
      ev = ev.map((u, i) => ({ u, i, m: month(u.date) }))
        .sort((a, b) => a.u.year - b.u.year || a.m - b.m || a.i - b.i).map((x) => x.u);
      if (!ev.length) continue;
      const t = chapterText(v);
      const chap = { branch: v, index: chapters.length, number: roman(chapters.length + 1), title: t.title, short: t.short,
        subtitle: t.subtitle, color: branchColor(v), yearFrom: ev[0].year, yearTo: ev[ev.length - 1].year, steps: [] };
      chapters.push(chap);
      let latest = null;
      for (const u of ev) {
        const cluster = placeCluster[u.place];
        if (latest && latest.place === cluster && u.year - latest.yearTo <= MERGE_YEARS) { add(latest, u); continue; }
        latest = { index: steps.length, chapter: chap, place: cluster, yearFrom: u.year, yearTo: u.year,
          events: [u], more: 0, legs: [] };
        steps.push(latest); chap.steps.push(latest);
      }
    }

    // assigning legs to stops: for each line in order, the first suitable stop after the previous leg
    const perLine = {};
    for (const t of legs) (perLine[t.lineIndex] = perLine[t.lineIndex] || []).push(t);
    const leftover = [];
    for (const list of Object.values(perLine)) {
      let min = 0;
      for (const t of list) {
        if (t.noYear) { leftover.push(t); continue; }
        let k = null;
        for (let i = min; i < steps.length; i++) {
          const s = steps[i];
          if (s.place !== t.from && km(s.place.coords, t.to.coords) <= TARGET_KM && km(s.place.coords, t.to.coords) < km(s.place.coords, t.from.coords)
              && s.yearTo >= (t.yearFrom || 0) && s.yearFrom <= t.year + 1
              && (options.person || s.chapter.branch === t.branch || s.place === t.to)) { k = s; break; }
        }
        if (!k) { leftover.push(t); continue; }
        k.legs.push(t); min = k.index;
      }
    }
    // supplementary legs: moves/transports of people who have no line of their own
    for (const s of steps) {
      if (s.legs.length) continue;
      const u = s.events.find((x) => ['move', 'transport'].includes(x.type) && x.people.length && !x.people.some(direct));
      if (!u) continue;
      const prev = steps.slice(0, s.index).reverse().find((x) => x.chapter === s.chapter && x.place !== s.place);
      if (!prev || km(prev.place.coords, s.place.coords) > SECONDARY_KM) continue;
      const t = { id: 'x' + s.index, lineIndex: -1, from: prev.place, to: s.place, branch: s.chapter.branch, yearFrom: prev.yearTo,
        year: u.year, certainty: u.certainty, uncertain: u.certainty === 'uncertain', secondary: true, traveller: '' };
      s.legs.push(t); legs.push(t);
    }

    // reordering within chapters (the steps are renumbered afterwards)
    for (const chap of chapters) {
      // a stop without a line, close to the previous one and in almost the same year, is added to its card (e.g. a stop in 1950 added to the card of a nearby one)
      let stepsList = [];
      for (const s of chap.steps) {
        const p = stepsList[stepsList.length - 1];
        if (p && !s.legs.length && km(p.place.coords, s.place.coords) <= NO_LINE_KM && s.yearFrom - p.yearTo <= NO_LINE_YEARS) {
          for (const u of s.events) add(p, u);
          p.more += s.more;
        } else stepsList.push(s);
      }
      // stops without a leg, close in time, go by nearest neighbour from the previous one (no needless flight)
      for (let i = 1; i < stepsList.length;) {
        const anchor = stepsList[i - 1], beh = [];
        for (let j = i; j < stepsList.length; j++) {
          const s = stepsList[j];
          if (s.yearFrom - anchor.yearFrom > WINDOW_YEARS) break;
          if (s.legs.some((t) => beh.some((r) => r.place === t.from)) || beh.some((r) => r.legs.some((t) => t.from === s.place))) break;
          beh.push(s);
        }
        if (beh.length < 2) { i++; continue; }
        const remaining = beh.slice(), fresh = [];
        let pos_ = anchor.place.coords;
        while (remaining.length) {
          let bestIdx = 0;
          remaining.forEach((s, n) => { if (km(pos_, s.place.coords) < km(pos_, remaining[bestIdx].place.coords)) bestIdx = n; });
          const [s] = remaining.splice(bestIdx, 1);
          fresh.push(s); pos_ = s.place.coords;
        }
        stepsList.splice(i, beh.length, ...fresh);
        i += beh.length;
      }
      // generational leg: between stops with no dated leg, the family's route is drawn by the tree;
      // not into a place from which another dated line starts (birthplace of the second family, not the target of a move)
      for (let i = 1; i < stepsList.length; i++) {
        const p = stepsList[i - 1], s = stepsList[i];
        if (s.legs.length || p.place === s.place) continue;
        if (legs.some((t) => t.from === s.place && t.year != null && !t.generational)) continue;
        const t = { id: 'g' + legs.length, lineIndex: -1, from: p.place, to: s.place, branch: chap.branch, yearFrom: p.yearTo,
          year: s.yearFrom, certainty: 'tree', uncertain: false, generational: true, traveller: '' };
        s.legs.push(t); legs.push(t);
      }
      chap.steps = stepsList;
    }
    steps = chapters.flatMap((k) => k.steps);

    // epilogue: the root and their siblings (name and relationship only), legs without a year and the final town
    if (!options.person) {
      const rootId = Object.keys(people).find((id) => people[id].ahnentafel === 1);
      if (rootId) {
        const members = [rootId].concat(Object.keys(people).filter((id) => id !== rootId && people[id].living && sibling(id, rootId)).sort())
          .map((id) => ({ name: people[id].name, relationship: people[id].relationship }));
        const t = entry('epilogue');
        const chap = { branch: 'common', index: chapters.length, number: '', title: t.title || '', subtitle: t.subtitle || '',
          color: NEUTRAL_COLOR, steps: [], epilogue: true };
        chapters.push(chap);
        const s = { index: steps.length, chapter: chap, place: placeCluster[people[rootId].town] || null, yearFrom: null, yearTo: null,
          events: [], more: 0, legs: leftover.filter((x) => x.noYear), epilogue: true, members };
        steps.push(s); chap.steps.push(s);
      }
    }
    steps.forEach((s, i) => { s.index = i; });

    for (const s of steps) {
      s.items = s.events.map((u) => {
        const p = (u.description && (u.description[language] || u.description.en || Object.values(u.description)[0])) || '';
        const i = p.indexOf(' — ');
        return { year: u.year, date: u.date, type: u.type, glyph: GLYPHS[u.type] || GLYPHS.other,
          label: i > 0 ? p.slice(0, i) : typeName(u.type), text: i > 0 ? p.slice(i + 3) : p,
          certainty: u.certainty, documents: u.documents, place: u.place, people: u.people };
      });
    }
    return { chapters, steps, clusters, legs };
  }

  // the branch whose chapter holds the stops of `key` (itself unless the branch has `map_chapter`)
  const chapterBranch = (branches, key) => { const b = (branches || []).find((x) => x.key === key); return (b && b.map_chapter) || key; };

  const api = { build, km, chapterBranch };
  if (typeof module !== 'undefined') module.exports = api; else g.Film = api;
})(typeof window !== 'undefined' ? window : globalThis);
