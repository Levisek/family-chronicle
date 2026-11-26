// Step 4: coordinates of the places. Order: places.json as it is, the coordinates in the GEDCOM,
// the bundled gazetteer (the district "okres X" and the places already found narrow it; a pick by
// nearness is shown for checking), then (only on a click) Nominatim. What is left is asked about
// with where it comes from (person and event), the candidates by their distance to the family,
// a search under another name, a click into the map, "not a place" (ignore_places, can be taken
// back) or "later". Nothing is lost by going on: what is open stays open, the home screen says how
// many places are not on the map, and every place found can be corrected here.
(function (g) {
  'use strict';

  const FCApp = g.FCApp;
  const { h } = FCApp.dom;
  const t = FCApp.t;
  const E = () => g.FCEngine;
  const Z = () => g.FCEngine.gazetteer;
  const EUROPE = [-12, 42, 34, 62];
  const ONLINE_GAP_MS = 1100;   // Nominatim: at most one request per second
  const NEAR_LABEL_KM = 300;    // farther than this, "x km from y" says nothing
  let lastRequestAt = 0;        // over every lookup of the session, also a repeated click

  function placeStrings(tree) {
    const out = new Set();
    for (const p of tree.people.values()) for (const ev of p.events) if (ev.place) out.add(ev.place);
    for (const f of tree.families.values()) for (const ev of f.events) if (ev.place) out.add(ev.place);
    return [...out];
  }

  // place string -> [{id, type, year}]: who it comes from
  function sourcesOf(tree) {
    const out = new Map();
    const add = (place, id, ev) => {
      if (!place) return;
      if (!out.has(place)) out.set(place, []);
      out.get(place).push({ id, type: ev.type, year: ev.date && ev.date.year != null ? ev.date.year : null });
    };
    for (const p of tree.people.values()) for (const ev of p.events) add(ev.place, p.id, ev);
    for (const f of tree.families.values()) for (const ev of f.events) add(ev.place, f.husband || f.wife, ev);
    return out;
  }

  function prepare(s) {
    const known = new (E().places.Places)(s.places, s.cfg.ignore_places || []);
    const all = placeStrings(s.tree);
    const regions = all.filter((p) => !known.town(p) && Z().isRegion(p, g.FC_GAZ));
    const strings = all.filter((p) => !known.isIgnored(p) && !regions.includes(p));
    const res = Z().resolveAll(strings, s.tree, g.FC_GAZ, s.places);
    const towns = Z().nearFamily(Z().groupTowns(strings, res));
    for (const x of towns) {
      if (x.existing) {
        // a new spelling of a town already saved ("Kelč - dýmkař" next to Kelč): only the alias
        if (x.coords) addAliases(s, x);
        if (x.source === 'guess') x.check = true;   // picked by the app earlier, not checked yet
      } else if (x.status !== 'pending') {
        setPlace(s, x, x.coords, x.check ? 'guess' : x.source, x.guess ? countryOf(x.guess.cc) : x.country);
      }
    }
    return { towns, regions, sources: sourcesOf(s.tree), active: null, running: null };
  }

  // The place strings of a town that would not find it by name become its aliases (and no longer
  // aliases of another town).
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function addAliases(s, x, carry = []) {
    const key = E().places.key;
    const entry = s.places[x.town];
    const aliases = new Set([...(entry.aliases || []), ...carry]);
    for (const p of x.strings) {
      const town = E().places.toTown(p);
      if (key(p) !== key(x.town) && key(town || '') !== key(x.town)) aliases.add(p);
    }
    aliases.delete(x.town);
    entry.aliases = [...aliases];
    for (const [k, e] of Object.entries(s.places)) {
      if (k !== x.town && e && (e.aliases || []).some((a) => x.strings.includes(a))) e.aliases = e.aliases.filter((a) => !x.strings.includes(a));
    }
  }

  // The coordinates of a town. `name`: a new places.json key (a search under another name); when
  // that key is another town more than SAME_KM away, the old key stays (nothing is overwritten).
  // source 'guess': picked by the app, to be checked (kept so across sessions).
  const SAME_KM = 5;
  function setPlace(s, x, coords, source, country, name) {
    let carry = [];
    if (name && name !== x.town) {
      const other = own(s.places, name) ? s.places[name] : null;
      if (!other || !other.coords || Z().distanceKm(other.coords, coords) <= SAME_KM) {
        const mine = own(s.places, x.town) ? s.places[x.town] : null;
        if (mine) { carry = mine.aliases || []; delete s.places[x.town]; }
        x.town = name;
        x.existing = false;
      }
    }
    const old = own(s.places, x.town) ? s.places[x.town] : {};
    s.places[x.town] = { ...old, coords, country: country || old.country || {}, aliases: old.aliases || [], source };
    addAliases(s, x, carry);
    x.coords = coords;
    x.source = source;
  }

  const countryOf = (cc) => (g.FC_GAZ && g.FC_GAZ.countryNames && g.FC_GAZ.countryNames[cc]) || {};

  async function nominatim(query) {
    const wait = lastRequestAt + ONLINE_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    const r = await fetch(Z().nominatimUrl(query), { headers: { 'Accept-Language': FCApp.lang }, referrerPolicy: 'no-referrer', credentials: 'omit' });
    return Z().parseNominatim(await r.json()).map((c) => ({ ...c, origin: 'online' }));
  }

  async function lookupOnline(w, ps) {
    if (ps.running) return;
    const pending = ps.towns.filter((x) => x.status === 'pending');
    for (let i = 0; i < pending.length; i++) {
      if (FCApp.steps.current !== 4) break;
      ps.running = t('places_online_running', { i: i + 1, n: pending.length });
      w.rerender();
      const x = pending[i];
      try {
        const found = await nominatim(Z().onlineQuery(x.strings[0]));
        if (found.length) {
          x.online = found;
          x.status = 'online';
          x.check = true;
          x.guess = found[0];
          setPlace(w.state, x, [found[0].lat, found[0].lon], 'guess', countryOf(found[0].cc));
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

  // where a place comes from: "Josef Bauer – birth 1902", and how many more
  function origin(s, ps, x) {
    const list = x.strings.flatMap((p) => ps.sources.get(p) || []);
    if (!list.length) return null;
    const first = list[0];
    const i = first.id && E().project.personInfo(s.tree, first.id, {});
    const ev = t(`place_ev_${first.type}`) === `place_ev_${first.type}` ? t('place_ev_other') : t(`place_ev_${first.type}`);
    const text = `${i ? i.label : '–'}: ${ev}${first.year !== null ? ` ${first.year}` : ''}`;
    return h('div', { class: 'note place-origin' }, list.length > 1 ? t('places_origin_more', { first: text, n: list.length - 1 }) : text);
  }

  // candidates nearest to the family first, with the distance
  function sorted(ps, candidates) {
    return candidates.map((c) => ({ c, near: Z().closest([c.lat, c.lon], ps.towns) }))
      .sort((a, b) => (a.near ? a.near.km : 1e9) - (b.near ? b.near.km : 1e9));
  }
  const nearLabel = (near) => (near && near.km <= NEAR_LABEL_KM ? ` · ${t('places_km_from', { km: Math.round(near.km), town: near.town })}` : '');

  function openItem(w, ps, x) {
    const s = w.state;
    const pick = (c, name) => {
      x.status = 'found';
      x.check = false;
      x.editing = false;
      x.search = null;
      setPlace(s, x, [c.lat, c.lon], c.origin === 'online' ? 'online' : 'gazetteer', countryOf(c.cc), name);
      ps.active = null;
      w.changed();
      w.rerender();
    };
    const list = (cands, name) => h('div', { class: 'candidates' }, sorted(ps, cands).map(({ c, near }) => h('button', {
      type: 'button', class: 'link', onclick: () => pick(c, name),
    }, candidateLabel(c), h('span', { class: 'note' }, nearLabel(near)))));

    const input = h('input', { type: 'search', class: 'place-search', placeholder: t('places_other_name'), 'aria-label': `${t('places_other_name')}: ${x.town}`, value: (x.search && x.search.text) || '' });
    const search = async () => {
      const text = input.value.trim();
      if (!text) return;
      x.search = { text, results: Z().lookup(text, g.FC_GAZ).candidates, online: false };
      w.rerender();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
    let found = null;
    if (x.search) {
      const name = Z().townName(x.search.text, g.FC_GAZ);
      found = x.search.results.length ? h('div', {}, h('span', { class: 'note' }, t('places_found_for', { text: x.search.text })), list(x.search.results, name))
        : h('p', { class: 'note' }, t('places_nothing', { text: x.search.text }), ' ', x.search.online ? null : h('button', { type: 'button', class: 'link', onclick: async () => {
          try { x.search = { ...x.search, results: await nominatim(x.search.text), online: true }; } catch (e) { w.message(t('places_online_failed', { error: e.message })); }
          w.rerender();
        } }, t('places_search_online')));
    }
    const act = (label, onclick, cls) => h('button', { type: 'button', class: cls || 'link', onclick }, label);
    return h('li', { class: ['place', ps.active === x && 'active'], 'data-town': x.town },
      h('span', { class: 'place-name' }, x.town), x.strings[0] !== x.town ? h('span', { class: 'person-sub' }, ` ${x.strings[0]}`) : null,
      origin(s, ps, x),
      x.candidates && x.candidates.length ? h('div', {}, h('span', { class: 'note' }, t('places_pick')), list(x.candidates)) : null,
      h('div', { class: 'place-search-row' }, input, ' ', act(t('places_search'), search, 'button')),
      found,
      h('div', { class: 'place-actions' },
        act(t('places_click'), () => { ps.active = x; w.rerender(); }), ' · ',
        act(t('places_not_place'), () => {
          s.cfg.ignore_places = [...new Set([...(s.cfg.ignore_places || []), ...x.strings])];
          if (!x.existing) delete s.places[x.town];
          ps.towns = ps.towns.filter((y) => y !== x);
          if (ps.active === x) ps.active = null;
          w.changed();
          w.rerender();
        }), ' · ',
        x.editing ? act(t('places_keep'), () => { x.editing = false; x.search = null; if (ps.active === x) ps.active = null; w.rerender(); })
          : act(t('places_later'), () => { x.status = 'later'; x.search = null; if (ps.active === x) ps.active = null; w.rerender(); })));
  }

  function panel(w, ps) {
    const s = w.state;
    const pending = ps.towns.filter((x) => x.status === 'pending' || x.editing);
    const later = ps.towns.filter((x) => x.status === 'later');
    const check = ps.towns.filter((x) => x.check && x.status !== 'pending' && !x.editing);
    const found = ps.towns.filter((x) => x.coords && x.status !== 'pending' && !x.check && !x.editing);
    const box = h('div', { class: 'panel', id: 'places-panel' },
      h('h2', {}, t('places_count', { n: ps.towns.length })),
      h('p', { class: 'note' }, t('places_lead')),
      h('table', { class: 'tally' }, h('tbody', {},
        h('tr', {}, h('td', {}, t('places_found')), h('td', { id: 'tally-found' }, found.length)),
        h('tr', {}, h('td', {}, t('places_to_check')), h('td', { id: 'tally-online' }, check.length)),
        h('tr', {}, h('td', {}, t('places_left')), h('td', { id: 'tally-left' }, pending.filter((x) => !x.editing).length + later.length)))));
    if (check.length) {
      box.append(h('h3', {}, t('places_check_title')), h('ul', { class: 'place-list', id: 'check' }, check.map((x) => h('li', { class: 'place' },
        h('span', { class: 'place-name' }, x.town), ` – ${x.guess ? candidateLabel(x.guess) : ''}`, origin(s, ps, x),
        h('button', { type: 'button', class: 'link', onclick: () => {
          x.check = false;
          if (own(s.places, x.town)) s.places[x.town].source = 'manual';   // checked by the person
          w.changed();
          w.rerender();
        } }, t('places_ok')), ' · ',
        h('button', { type: 'button', class: 'link', onclick: () => {
          x.editing = true;
          const seen = new Set();
          x.candidates = [...(x.online || []), ...(x.candidates || [])].filter((c) => { const k = `${c.lat},${c.lon}`; if (seen.has(k)) return false; seen.add(k); return true; });
          w.rerender();
        } }, t('places_fix'))))));
    }
    if (pending.length) {
      box.append(h('h3', {}, t('places_open_title')), h('ul', { class: 'place-list', id: 'pending' }, pending.map((x) => openItem(w, ps, x))));
      box.appendChild(ps.running ? h('p', { class: 'progress', role: 'status' }, ps.running)
        : h('button', { type: 'button', class: 'button', id: 'online', onclick: () => lookupOnline(w, ps) }, t('places_online_button')));
      box.appendChild(h('p', { class: 'note' }, t('places_online_note')));
    }
    if (later.length) {
      box.appendChild(h('p', { class: 'note', id: 'later' }, t('places_later_list'), ' ', later.map((x, i) => [i ? ', ' : '',
        h('button', { type: 'button', class: 'link', onclick: () => { x.status = 'pending'; w.rerender(); } }, x.town)])));
    }
    if (ps.regions.length) box.appendChild(h('p', { class: 'note', id: 'regions' }, t('places_regions', { list: ps.regions.join(', ') })));
    const ignored = (s.cfg.ignore_places || []).filter((p) => ps.sources.has(p));
    if (ignored.length) {
      box.appendChild(h('p', { class: 'note', id: 'ignored' }, t('places_ignored'), ' ', ignored.map((p, i) => [i ? ', ' : '', p, ' (',
        h('button', { type: 'button', class: 'link', onclick: () => {
          s.cfg.ignore_places = s.cfg.ignore_places.filter((y) => y !== p);
          if (!s.cfg.ignore_places.length) delete s.cfg.ignore_places;
          s.placeState = null;
          w.changed();
          w.rerender();
        } }, t('places_undo')), ')'])));
    }
    if (found.length) {
      box.appendChild(h('details', { id: 'places-found' }, h('summary', {}, t('places_found_list', { n: found.length })),
        h('ul', { class: 'place-list' }, found.sort((a, b) => a.town.localeCompare(b.town, FCApp.lang)).map((x) => h('li', { class: 'place' },
          h('span', { class: 'place-name' }, x.town), ' ',
          h('button', { type: 'button', class: 'link', onclick: () => { x.editing = true; w.rerender(); } }, t('places_fix')))))));
    }
    return box;
  }

  function map(w, ps) {
    const s = w.state;
    const known = Object.entries(s.places).filter(([, e]) => e && e.coords).map(([n, e]) => [n, e.coords]);
    const box = known.length ? E().basemap.bboxFromPlaces(s.places, 3) : EUROPE;
    const svg = FCApp.mapclick(box, known, (coords) => {
      if (!ps.active) return;
      const x = ps.active;
      x.status = 'found';
      x.check = false;
      x.editing = false;
      x.search = null;
      setPlace(s, x, coords, 'manual', {});
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
      const entering = FCApp.steps.current !== 4;
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
      // coming back to the step: what was left for later is asked about again
      if (entering) for (const x of ps.towns) if (x.status === 'later') x.status = 'pending';
      if (!ps.towns.length && !ps.regions.length) { el.appendChild(h('p', { class: 'lead' }, t('places_none'))); return; }
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
        if (!(s.cfg.basemap && s.project.files.has(s.cfg.basemap))) delete s.cfg.basemap;   // keep a basemap of one's own
      }
    },
  };

  // For the home screen: how many towns of the family tree are neither on the map nor set aside.
  FCApp.placesMissing = (tree, places, ignore) => {
    const known = new (E().places.Places)(places || {}, ignore || []);
    const out = new Set();
    for (const p of placeStrings(tree)) {
      if (known.town(p) || known.isIgnored(p) || Z().isRegion(p, g.FC_GAZ || null)) continue;
      out.add(E().places.toTown(p) || p);
    }
    return out.size;
  };
})(window);
