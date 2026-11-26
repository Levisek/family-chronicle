// Step 4: coordinates of the places. Order: places.json as it is, the coordinates in the GEDCOM,
// the bundled gazetteer, then (only on a click) Nominatim, and what is left by hand: a choice from
// the candidates, a click into the map, or skip (the place is then missing from the map).
// Several equally good matches are never picked automatically.
(function (g) {
  'use strict';

  const FCApp = g.FCApp;
  const { h, clear } = FCApp.dom;
  const t = FCApp.t;
  const E = () => g.FCEngine;
  const EUROPE = [-12, 42, 34, 62];
  const ONLINE_GAP_MS = 1100;   // Nominatim: at most one request per second
  let lastRequestAt = 0;        // over every lookup of the session, also a repeated click

  function placeStrings(tree) {
    const out = new Set();
    for (const p of tree.people.values()) for (const ev of p.events) if (ev.place) out.add(ev.place);
    for (const f of tree.families.values()) for (const ev of f.events) if (ev.place) out.add(ev.place);
    return [...out];
  }

  function prepare(s) {
    const known = new (E().places.Places)(s.places, s.cfg.ignore_places || []);
    const strings = placeStrings(s.tree).filter((p) => !known.isIgnored(p));
    const res = E().gazetteer.resolveAll(strings, s.tree, g.FC_GAZ, s.places);
    const towns = E().gazetteer.groupTowns(strings, res);
    for (const x of towns) if (x.status !== 'pending' && !x.existing) setPlace(s, x, x.coords, x.source, x.country);
    return { towns, active: null, running: null };
  }

  function setPlace(s, x, coords, source, country) {
    const old = Object.prototype.hasOwnProperty.call(s.places, x.town) ? s.places[x.town] : {};
    s.places[x.town] = { ...old, coords, country: country || old.country || {}, aliases: old.aliases || [], source };
    x.coords = coords;
    x.source = source;
  }

  const countryOf = (cc) => (g.FC_GAZ && g.FC_GAZ.countryNames && g.FC_GAZ.countryNames[cc]) || {};

  async function lookupOnline(w, ps) {
    if (ps.running) return;
    const pending = ps.towns.filter((x) => x.status === 'pending');
    for (let i = 0; i < pending.length; i++) {
      if (FCApp.steps.current !== 4) break;
      ps.running = t('places_online_running', { i: i + 1, n: pending.length });
      w.rerender();
      const x = pending[i];
      const wait = lastRequestAt + ONLINE_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastRequestAt = Date.now();
      try {
        const r = await fetch(E().gazetteer.nominatimUrl(E().gazetteer.onlineQuery(x.strings[0])), { headers: { 'Accept-Language': FCApp.lang }, referrerPolicy: 'no-referrer', credentials: 'omit' });
        const found = E().gazetteer.parseNominatim(await r.json()).map((c) => ({ ...c, origin: 'online' }));
        if (found.length) {
          x.online = found;
          x.status = 'online';
          x.check = true;
          setPlace(w.state, x, [found[0].lat, found[0].lon], 'online', countryOf(found[0].cc));
          w.changed();
        }
      } catch (e) {
        ps.running = null;
        w.message(t('places_online_failed', { error: e.message }));
        return;
      }
    }
    ps.running = null;
    w.rerender();
  }

  function candidateLabel(c) {
    return [c.name, c.admin1 && c.admin1 !== c.name ? c.admin1 : null, c.cc].filter(Boolean).join(', ');
  }

  function panel(w, ps) {
    const s = w.state;
    const count = (st) => ps.towns.filter((x) => x.status === st).length;
    const pending = ps.towns.filter((x) => x.status === 'pending');
    const online = ps.towns.filter((x) => x.status === 'online' && x.check);
    const box = h('div', { class: 'panel', id: 'places-panel' },
      h('h2', {}, t('places_count', { n: ps.towns.length })),
      h('p', { class: 'note' }, t('places_lead')),
      h('table', { class: 'tally' }, h('tbody', {},
        h('tr', {}, h('td', {}, t('places_found')), h('td', { id: 'tally-found' }, count('found'))),
        h('tr', {}, h('td', {}, t('places_online')), h('td', { id: 'tally-online' }, count('online'))),
        h('tr', {}, h('td', {}, t('places_left')), h('td', { id: 'tally-left' }, pending.length)))));
    if (online.length) {
      box.appendChild(h('ul', { class: 'place-list' }, online.map((x) => h('li', { class: 'place' },
        h('span', { class: 'place-name' }, x.town), ` – ${t('places_check')}: `, candidateLabel(x.online[0]), ' ',
        h('button', { type: 'button', class: 'link', onclick: () => { x.check = false; w.changed(); w.rerender(); } }, t('places_ok')), ' · ',
        h('button', { type: 'button', class: 'link', onclick: () => {
          x.status = 'pending'; x.check = false; x.candidates = [...x.online, ...x.candidates];
          delete s.places[x.town]; w.changed(); w.rerender();
        } }, t('places_fix'))))));
    }
    if (pending.length) {
      box.appendChild(h('ul', { class: 'place-list', id: 'pending' }, pending.map((x) => h('li', { class: ['place', ps.active === x && 'active'] },
        h('span', { class: 'place-name' }, x.town), x.strings[0] !== x.town ? h('span', { class: 'person-sub' }, x.strings[0]) : null,
        x.candidates.length ? h('div', { class: 'candidates' }, h('span', { class: 'note' }, t('places_pick')), x.candidates.map((c) => h('button', {
          type: 'button', class: 'link', onclick: () => { x.status = 'found'; setPlace(s, x, [c.lat, c.lon], c.origin === 'online' ? 'online' : 'gazetteer', countryOf(c.cc)); ps.active = null; w.changed(); w.rerender(); },
        }, candidateLabel(c)))) : null,
        h('button', { type: 'button', class: 'link', onclick: () => { ps.active = x; w.rerender(); } }, t('places_click')), ' · ',
        h('button', { type: 'button', class: 'link', onclick: () => { x.status = 'skipped'; if (ps.active === x) ps.active = null; w.changed(); w.rerender(); } }, t('places_skip'))))));
      box.appendChild(ps.running ? h('p', { class: 'progress', role: 'status' }, ps.running)
        : h('button', { type: 'button', class: 'button', id: 'online', onclick: () => lookupOnline(w, ps) }, t('places_online_button')));
      box.appendChild(h('p', { class: 'note' }, t('places_online_note')));
    }
    const skipped = ps.towns.filter((x) => x.status === 'skipped');
    if (skipped.length) box.appendChild(h('p', { class: 'note' }, `${skipped.map((x) => x.town).join(', ')}: ${t('places_skipped')}`));
    return box;
  }

  function map(w, ps) {
    const s = w.state;
    const known = Object.entries(s.places).filter(([, e]) => e && e.coords).map(([n, e]) => [n, e.coords]);
    const box = known.length ? E().basemap.bboxFromPlaces(s.places, 3) : EUROPE;
    const svg = FCApp.mapclick(box, known, (coords) => {
      if (!ps.active) return;
      ps.active.status = 'found';
      setPlace(s, ps.active, coords, 'manual', {});
      ps.active = null;
      w.changed();
      w.rerender();
    });
    return h('figure', {}, svg, ps.active ? h('figcaption', { class: 'progress' }, t('places_map_hint', { name: ps.active.town })) : null);
  }

  FCApp.steps[4] = {
    wide: true,
    skip: true,
    render(el, w) {
      const s = w.state;
      FCApp.steps.current = 4;
      el.append(h('h1', {}, t('places_title')));
      if (!g.FC_GAZ || !g.FC_WORLD) {
        el.appendChild(h('p', { class: 'progress', role: 'status' }, t('places_loading')));
        Promise.all([FCApp.dom.loadScript('app/data/gazetteer.js'), FCApp.dom.loadScript('app/data/world.js')])
          .then(() => FCApp.steps.current === 4 && w.rerender(), (e) => FCApp.error(el, e.message));
        return;
      }
      if (!s.placeState || s.placeState.tree !== s.tree) { s.placeState = prepare(s); s.placeState.tree = s.tree; }
      const ps = s.placeState;
      if (!ps.towns.length) { el.appendChild(h('p', { class: 'lead' }, t('places_none'))); return; }
      el.appendChild(h('div', { class: 'places-layout' }, map(w, ps), panel(w, ps)));
    },
    leave(w) {
      const s = w.state;
      FCApp.steps.current = null;
      if (!g.FC_WORLD) return;
      const any = Object.values(s.places).some((e) => e && e.coords);
      if (any) {
        s.basemap = E().basemap.build(g.FC_WORLD, s.places, 2);
        s.cfg.basemap = s.cfg.basemap || 'basemap.geojson';
      } else {
        s.basemap = null;
        delete s.cfg.basemap;
      }
    },
  };
})(window);
