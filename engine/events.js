// Events for the map and the story: from the GEDCOM, manual ones and migration lines.
// An event is an object with the keys id, type, year, date, place, branch, people, description,
// documents, certainty. Port of familychronicle/events.py; `manual` takes the parsed JSON.
(function (g) {
  'use strict';

  const req = typeof require !== 'undefined';
  const dates = req ? require('./dates.js') : g.FCEngine.dates;

  const TYPES = new Set(['birth', 'marriage', 'death', 'burial', 'move', 'war', 'transport', 'other']);
  const CERTAINTIES = new Set(['document', 'tree', 'chronicle', 'uncertain']);
  const REQUIRED = ['id', 'type', 'year', 'date', 'place', 'branch', 'people', 'description', 'documents', 'certainty'];
  const TYPE = { BIRT: 'birth', DEAT: 'death', BURI: 'burial', MARR: 'marriage' };
  const WORD = { birth: ['narození', 'birth'], death: ['úmrtí', 'death'], burial: ['pohřeb', 'burial'], marriage: ['sňatek', 'marriage'] };
  const ABOUT = { cs: 'kolem', en: 'about' };
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  // Display text of a date: "5 Mar 1890" (en), "5. 3. 1890" (cs), "about 1890".
  function formatDate(d, lang = 'en') {
    if (d === null || d === undefined) return '';
    if (d.year === null || d.year === undefined) return d.text;
    const cs = lang === 'cs';
    let t;
    if (d.day && d.month) t = cs ? `${d.day}. ${d.month}. ${d.year}` : `${d.day} ${dates.EN_SHORT[d.month - 1]} ${d.year}`;
    else if (d.month) t = `${(cs ? dates.CS_NOM : dates.EN_FULL)[d.month - 1]} ${d.year}`;
    else t = String(d.year);
    return d.approximate ? `${ABOUT[cs ? lang : 'en']} ${t}` : t;
  }

  const name = (tree, pid) => { const p = tree.people.get(pid); return `${p.given} ${p.surname}`.trim(); };

  // Birth, death, burial and marriage events of deceased map people.
  function fromGedcom(tree, scope, places, lang = 'en', languages = ['cs', 'en']) {
    const candidates = [];   // [type, event, people, id, branch, names]
    const mapDead = [...scope.mapPeople].filter((x) => !scope.living.has(x)).sort(cmp);
    for (const pid of mapDead) {
      for (const e of tree.people.get(pid).events) {
        if (TYPE[e.type]) {
          const t = TYPE[e.type];
          candidates.push([t, e, [pid], `${t}-${pid}`, scope.branchOf.has(pid) ? scope.branchOf.get(pid) : '', name(tree, pid)]);
        }
      }
    }
    for (const fid of [...tree.families.keys()].sort(cmp)) {
      const f = tree.families.get(fid);
      const spouses = [f.husband, f.wife].filter((x) => x && tree.people.has(x));
      if (spouses.length !== 2 || !spouses.some((x) => scope.mapPeople.has(x))) continue;
      if (spouses.some((x) => scope.living.has(x) || (!scope.mapPeople.has(x) && !tree.people.get(x).hasDeath))) continue;
      const withBranch = spouses.find((x) => scope.branchOf.has(x));
      const branch = withBranch !== undefined ? scope.branchOf.get(withBranch) : '';
      const names = spouses.map((x) => name(tree, x)).join(' + ');
      for (const e of f.events) {
        if (e.type === 'MARR') {
          candidates.push(['marriage', e, spouses.filter((x) => scope.mapPeople.has(x)), `marriage-${fid}`, branch, names]);
        }
      }
    }
    for (const u of places.unknown(candidates.filter((c) => c[1].place).map((c) => c[1].place))) places.missing.add(u);
    const out = [];
    for (const [t, e, people, eid, branch, names] of candidates) {
      const town = e.place ? places.town(e.place) : null;
      if (town === null) continue;
      const words = { cs: WORD[t][0] };
      const description = {};
      for (const l of languages) {
        Object.defineProperty(description, l, { value: `${Object.prototype.hasOwnProperty.call(words, l) ? words[l] : WORD[t][1]} — ${names}`, enumerable: true, writable: true, configurable: true });
      }
      out.push({
        id: eid, type: t, year: e.date ? e.date.year : null, date: formatDate(e.date, lang), place: town,
        branch, people, description, documents: [], certainty: 'tree',
      });
    }
    return out;
  }

  const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

  // Hand-written events (events.json). Malformed entries throw listing all problems.
  function manual(data, places, languages = ['cs', 'en']) {
    const out = [], errors = [];
    data.forEach((e, i) => {
      const ident = 'id' in e ? e.id : `#${i}`;
      const absent = REQUIRED.filter((k) => !(k in e));
      if (absent.length) { errors.push(`${ident}: missing ${absent.join(', ')}`); return; }
      if (!TYPES.has(e.type)) errors.push(`${ident}: unknown type ${e.type}`);
      if (!CERTAINTIES.has(e.certainty)) errors.push(`${ident}: unknown certainty ${e.certainty}`);
      if (!isObject(e.description) || !languages.every((l) => l in e.description)) {
        errors.push(`${ident}: description needs ${languages.join(', ')}`);
      }
      if (!Array.isArray(e.people) || !Array.isArray(e.documents)) errors.push(`${ident}: people and documents must be lists`);
      const town = e.place ? places.town(e.place) : null;
      if (town === null) { errors.push(`${ident}: unknown place ${e.place}`); return; }
      out.push({ ...e, place: town });
    });
    if (errors.length) throw new Error(errors.join('; '));
    return out;
  }

  const NO_END = Symbol('no end');

  // Lines from parents to children, as {branch, from, to, points}; a point is [lat, lon, year, certainty].
  function migrationLines(tree, scope, events, places, livingTown = {}) {
    livingTown = livingTown || {};
    const point = (town, year, certainty = 'tree') => { const [lat, lon] = places.coords(town); return [lat, lon, year, certainty]; };
    const orderKey = (e) => [e.year === null || e.year === undefined ? 1 : 0, e.year || 0, e.type !== 'birth' ? 1 : 0];
    const byOrder = (a, b) => { const x = orderKey(a), y = orderKey(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
    const same = (p, q) => p[0] === q[0] && p[1] === q[1];

    const lines = [];
    const ancestors = [...scope.ahnentafel.keys()].sort((a, b) => scope.ahnentafel.get(a) - scope.ahnentafel.get(b));
    for (const a of ancestors) {
      if (scope.living.has(a)) continue;
      const mine = events.filter((e) => e.people.includes(a) && e.place).sort(byOrder);
      if (!mine.length) continue;
      for (const c of tree.children(a)) {
        if (!scope.ahnentafel.has(c)) continue;
        let end;
        if (scope.living.has(c)) {
          const town = Object.prototype.hasOwnProperty.call(livingTown, c) ? livingTown[c] : null;
          end = town && places.town(town) ? point(town, null) : NO_END;
        } else {
          const birth = events.find((e) => e.type === 'birth' && e.people.length === 1 && e.people[0] === c && e.place);
          end = birth ? point(birth.place, birth.year, birth.certainty) : null;
        }
        if (end === null) continue;
        const points = [];
        for (const e of mine) {
          const p = point(e.place, e.year, e.certainty);
          if (!points.length || !same(points[points.length - 1], p)) points.push(p);
        }
        const last = points[points.length - 1];
        if (end === NO_END) { /* living child without a town: no further point */ }
        else if (same(last, end)) last.splice(2, last.length - 2, ...end.slice(2));
        else points.push(end);
        lines.push({ branch: scope.branchOf.has(a) ? scope.branchOf.get(a) : '', from: a, to: c, points });
      }
    }
    return lines;
  }

  const api = { TYPES, CERTAINTIES, REQUIRED, formatDate, fromGedcom, manual, migrationLines };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).events = api;
})(typeof window !== 'undefined' ? window : globalThis);
