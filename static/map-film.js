// Film of the family's journey: the player on top of the map engine (map-draw.js) and the film builder (film.js).
// Its own stop cards, timeline, chapter titles, intro, controls, keys and modes from the hash
// (#timeline, #full-map, #person=<id>, #stop=<n>). The engine has no loop, it is here.
(function () {
  'use strict';
  const { D, T, el, color, loadData, localized, personLink, magnifier } = window.Chronicle || {};
  let resetMagnifier = () => {};
  const Sc = window.Film, RM = window.ChronicleMap;
  const canvas = document.getElementById('canvas');
  if (!D || !Sc || !RM || !canvas) return;

  const RMOT = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => RMOT.matches;
  const EPILOGUE_COLOR = '#7a2e0e';
  const PHASE_DOM = { intro: 'intro', chapterTitle: 'flight', approach: 'flight', draw: 'drawing', arrive: 'stop', hold: 'stop', end: 'end' };
  const id = (x) => document.getElementById(x);
  const els = {
    card: id('card'), controls: id('controls'), filmIntro: id('film-intro'), chapterTitle: id('chapter-title'),
    ctNumber: id('ct-number'), ctHeading: id('ct-heading'), ctSub: id('ct-sub'), ctYears: id('ct-years'),
    timeline: id('timeline'), timelineTrack: id('timeline-track'), thumb: id('timeline-thumb'), timelineYear: id('timeline-year'),
    bubble: id('timeline-bubble'), bPlay: id('b-play'), lightbox: id('lightbox'),
  };
  const fillTemplate = (s, v) => Object.entries(v || {}).reduce((r, [k, x]) => r.split('{' + k + '}').join(x), s);

  let data, sc, map, finalTown = null, branchNames = '';
  const progress = new Map();                     // leg id -> 0..1
  let dim = new Set();
  const S = {
    step: -1, phase: 'intro', t: 0, playing: false, speed: 1, once: false, end: false, arrivalTime: 0,
    visited: new Set(), flying: false, person: undefined, isEmpty: false, mode: null,
  };
  let flightToken = 0;

  // ---------- helpers ----------
  const finalName = () => (finalTown && finalTown.name) || D.final_town || '';
  const stepPlace = (s) => s.place || (s.epilogue ? finalTown : null);
  const stepColor = (s) => (s.chapter.epilogue ? EPILOGUE_COLOR : color(s.chapter.branch));
  const mobile = () => map.dimensions().w <= 760;
  const personName = (pid) => (data.people[pid] && data.people[pid].name) || '';

  function phase(f) {
    S.phase = f; S.t = 0;
    document.body.dataset.phase = PHASE_DOM[f];
    syncMode();
  }
  // nav.modes: aria-current on Timeline, or on Full map
  function syncMode() {
    const r = S.end ? 'map' : 'timeline';
    if (r === S.mode) return;
    const was = S.mode; S.mode = r;
    for (const a of document.querySelectorAll('nav.modes a')) {
      const h = a.getAttribute('href') || '';
      const is = h.endsWith(r === 'map' ? '#full-map' : '#timeline');
      if (is) a.setAttribute('aria-current', 'true');
      else if (/#(full-map|timeline)$/.test(h)) a.removeAttribute('aria-current');
    }
    if (was && !S.person) history.replaceState(null, '', location.pathname + location.search + (r === 'map' ? '#full-map' : '#timeline'));
  }

  // ---------- state of legs and places ----------
  function prepareStateTo(i) {
    progress.clear(); S.visited.clear();
    for (const s of sc.steps) {
      const done = s.index < i;
      for (const t of s.legs) progress.set(t.id, done ? 1 : 0);
      if (done) visit(s);
    }
    updatePlaces();
  }
  function visit(s) {
    const m = stepPlace(s);
    if (m) S.visited.add(m.id);
    for (const t of s.legs) { S.visited.add(t.from.id); S.visited.add(t.to.id); }
  }
  function updatePlaces() {
    const colors = new Map();
    for (const s of sc.steps) { const m = stepPlace(s); if (m && S.visited.has(m.id) && !colors.has(m.id)) colors.set(m.id, stepColor(s)); }
    map.setPlaces(sc.clusters.filter((m) => S.visited.has(m.id)), colors);
  }
  function updateDimming() {
    dim = new Set();
    const cur = !S.end && S.step >= 0 ? sc.steps[S.step] : null;
    if (!cur || cur.chapter.epilogue) return;
    for (const s of sc.steps) if (s.chapter !== cur.chapter) for (const t of s.legs) dim.add(t.id);
  }

  // ---------- free area and views ----------
  function recomputeSurface() {
    const { w: W } = map.dimensions(), mob = W <= 760;
    const ct = canvas.getBoundingClientRect().top;                    // the canvas starts below the navigation strip
    const controlsTop = els.controls.getBoundingClientRect().top - ct;
    const r = { x0: 0, y0: mob ? 56 : 0, x1: W, y1: controlsTop - 6 };
    if (mob) { if (!els.card.hidden) r.y1 = Math.min(r.y1, els.card.offsetTop - ct - 4); }
    else if (S.phase !== 'intro' && S.step >= 0) r.x1 = W - 410;       // room for the card, even when it is not shown right now
    if (!mob) r.y0 = S.end || S.phase === 'intro' || S.phase === 'chapterTitle' ? 110 : 20;
    map.setFreeArea([r.x0, r.y0, r.x1, r.y1], { controlsTop: controlsTop });
  }
  const viewAll = () => {
    recomputeSurface();
    return map.viewOn(sc.steps.map(stepPlace).filter(Boolean), sc.steps.flatMap((s) => s.legs),
      { expandKm: 50, maxKmPx: 6, minKmPx: .6, margin: .06 });
  };
  const viewChapter = (k) => {
    recomputeSurface();
    return map.viewOn(k.steps.map(stepPlace).filter(Boolean), k.steps.flatMap((s) => s.legs),
      { expandKm: 60, maxKmPx: 4.5, minKmPx: .9, margin: .12 });
  };
  const viewStop = (s) => {
    recomputeSurface();
    const m = stepPlace(s);
    return m ? map.viewStop(m, s.legs) : viewAll();
  };
  const viewPen = (s) => { recomputeSurface(); return map.viewPen(s.legs, progress); };

  function startFlight(target) {
    const token = ++flightToken;
    S.flying = true;
    map.flyTo(target).then(() => { if (token === flightToken) S.flying = false; });
  }
  function stopFlight() { flightToken++; S.flying = false; map.stopFlight(); }

  // ---------- card ----------
  function renderCard(s) {
    const k = els.card;
    k.replaceChildren(); k.classList.remove('expanded');
    k.dataset.stop = String(s.index);
    k.style.setProperty('--branch', stepColor(s));
    if (s.epilogue) return epilogueCard(s);
    const chap = s.chapter, nextStep = sc.steps[s.index + 1];
    const yearEl = el('div', { class: 'card-year' }, el('span', { text: String(s.yearFrom) }), s.yearTo !== s.yearFrom ? el('small', { text: '– ' + s.yearTo }) : null);
    k.append(
      el('div', { class: 'card-chapter' }, el('span', { text: `${chap.number} · ${chap.title}` }), el('span', { text: `${chap.steps.indexOf(s) + 1}/${chap.steps.length}` })),
      yearEl, el('h2', { class: 'card-place', text: s.place.name }), el('div', { class: 'card-country', text: s.place.country }));
    const ol = el('ol', { class: 'card-events' });
    const limit = mobile() ? 2 : Infinity;
    s.items.forEach((p, i) => {
      const source = el('div', { class: 'card-source' }, el('span', { class: 'certainty c-' + p.certainty, text: T['certainty_' + p.certainty] || p.certainty }));
      for (const d of (p.documents || []).slice(0, 2)) {
        const doc = data.documents[d];
        if (!doc || !doc.crop) continue;
        const description = localized(doc.description);
        source.append(el('a', { class: 'thumbnail', href: D.root_path + (doc.sheet || doc.crop), title: description,
          onclick: (e) => { e.preventDefault(); showDocument(doc); } }, el('img', { src: D.root_path + doc.crop, alt: description, loading: 'lazy' })));
      }
      const people = (p.people || []).filter((o) => data.people[o]).slice(0, 3).map((o) => {
        const url = personLink(o);
        return url ? el('a', { href: url, text: personName(o) }) : el('span', { text: personName(o) });
      });
      const peopleEl = people.length ? el('span', { class: 'card-people' }) : null;
      people.forEach((x, n) => { if (n) peopleEl.append(', '); peopleEl.append(x); });
      ol.append(el('li', { class: i >= limit ? 'card-hidden' : null },
        el('span', { class: 'card-glyph', 'aria-hidden': 'true', text: p.glyph }),
        el('div', null,
          el('span', { class: 'card-label', text: p.label || T.card_event }),
          el('span', { class: 'card-date', text: p.date && p.date !== String(p.year) ? p.date : String(p.year) }),
          p.place !== s.place.name ? el('span', { class: 'card-where', text: ' · ' + p.place }) : null,
          el('p', { class: 'card-text', text: p.text }), peopleEl, source)));
    });
    k.append(ol);
    const hiddenCount = Math.max(0, s.items.length - limit);
    const nextWhat = !nextStep ? T.next_whole_map : fillTemplate(T.next_up, { what: nextStep.chapter !== chap ? nextStep.chapter.title : (stepPlace(nextStep) || { name: '' }).name });
    const nextButton = hiddenCount ? el('button', { type: 'button', class: 'card-more', text: fillTemplate(T.card_more_n, { n: hiddenCount }), onclick: () => {
      k.classList.add('expanded'); nextButton.remove(); k.querySelectorAll('li.card-hidden').forEach((x) => x.classList.add('shown'));
    } }) : null;
    k.append(el('div', { class: 'card-next' }, el('span', { text: nextWhat }), nextButton, el('button', { type: 'button', onclick: () => next(), text: nextStep ? T.next_button : T.whole_map_button })));
    k.append(el('div', { class: 'card-countdown' }, el('i')));
    [...ol.children].forEach((x, i) => { if (!x.classList.contains('card-hidden')) setTimeout(() => x.classList.add('shown'), reduced() ? 0 : 250 + i * 650 / S.speed); });
  }
  function epilogueCard(s) {
    const k = els.card;
    k.append(
      el('div', { class: 'card-chapter' }, el('span', { text: T.epilogue }), el('span', { text: T.today })),
      el('h2', { class: 'card-place', text: finalName() }),
      el('p', { class: 'card-text', text: T.epilogue_text }),
      el('ul', { class: 'card-living' }, ...(s.members || []).map((z) => el('li', null, z.name, el('span', { text: z.relationship })))));
    if (s.legs.length) k.append(el('p', { class: 'card-country', text: fillTemplate(T.card_no_year, { list: s.legs.map((t) => `${t.from.name} → ${t.to.name}`).join(', ') }) }));
    k.append(el('p', { class: 'card-country', text: T.card_living_note }),
      el('div', { class: 'card-next' }, el('span', { text: T.next_whole_map }), el('button', { type: 'button', onclick: () => next(), text: T.whole_map_button })),
      el('div', { class: 'card-countdown' }, el('i')));
    k.querySelectorAll('li').forEach((x) => x.classList.add('shown'));
  }
  function endCard() {
    const k = els.card;
    k.replaceChildren(); k.classList.remove('expanded'); delete k.dataset.stop;
    k.style.setProperty('--branch', EPILOGUE_COLOR);
    const item = (b, text, dashes, from) => {
      const i = el('i', { class: dashes ? 'dashed' : null });
      const li = el('li', null, i, text instanceof Node ? text : el('span', { text }), from ? el('small', { text: from }) : null);
      li.style.setProperty('--b', b); return li;
    };
    const leg = el('ul', { class: 'card-legend' });
    for (const chap of sc.chapters.filter((x) => !x.epilogue)) leg.append(item(chap.color, el('b', { text: chap.title }), false, `${chap.yearFrom}–${chap.yearTo}`));
    leg.append(item('#6a5640', T.legend_solid, false), item('#6a5640', T.legend_dashed, true));
    k.append(
      el('div', { class: 'card-chapter' }, el('span', { text: T.mode_map }), el('span', { text: fillTemplate(T.end_stops, { n: sc.steps.filter((s) => !s.epilogue).length }) })),
      el('h2', { class: 'card-place', text: T.end_title }),
      el('p', { class: 'card-text', text: T.end_text }), leg,
      el('div', { class: 'card-next' }, el('span'), el('button', { type: 'button', onclick: () => goTo(0, true), text: T.restart })),
      el('p', { class: 'card-sources', text: `${T.sources} · ${T.map_attribution}` }));
  }
  function showDocument(doc) {
    const lb = els.lightbox, cap = lb.querySelector('figcaption');
    const description = localized(doc.description);
    lb.querySelector('img').src = D.root_path + doc.crop;
    lb.querySelector('img').alt = description;
    cap.replaceChildren(description);
    if (doc.sheet) cap.append(' · ', el('a', { href: D.root_path + doc.sheet, target: '_blank', rel: 'noopener', text: T.open_full_sheet, onclick: (e) => e.stopPropagation() }));
    resetMagnifier();
    lb.hidden = false;
  }

  // ---------- timeline ----------
  function buildTimeline() {
    const track = els.timelineTrack;
    track.replaceChildren();
    els.segment = [];
    for (const chap of sc.chapters) {
      const segment = el('div', { class: 'timeline-segment' }, el('i'),
        el('b', { text: chap.epilogue ? T.today : `${chap.short} ${chap.yearFrom}–${chap.yearTo}` }));
      segment.style.setProperty('--b', chap.color); segment.style.flex = String(chap.steps.length);
      chap.steps.forEach((s, i) => { if (i) { const u = el('u'); u.style.left = (i / chap.steps.length) * 100 + '%'; segment.append(u); } });
      track.append(segment); els.segment.push(segment);
    }
    els.timeline.setAttribute('aria-valuemax', String(Math.max(0, sc.steps.length - 1)));
  }
  const stepFromX = (clientX) => {   // by segments (they have different widths)
    for (let i = 0; i < sc.chapters.length; i++) {
      const r = els.segment[i].getBoundingClientRect();
      if (clientX <= r.right + 1.5 || i === sc.chapters.length - 1) {
        const chap = sc.chapters[i], f = Math.max(0, Math.min(.999, (clientX - r.left) / r.width));
        return chap.steps[Math.floor(f * chap.steps.length)].index;
      }
    }
    return 0;
  };
  function timelineControls() {
    let dragging = false;
    const bub = els.bubble;
    const showBubble = (e) => {
      const i = stepFromX(e.clientX), s = sc.steps[i], r = els.timeline.getBoundingClientRect();
      bub.hidden = false; bub.style.left = (e.clientX - r.left) + 'px';
      const m = stepPlace(s);
      bub.textContent = s.epilogue ? `${T.today} · ${finalName()}` : `${s.yearFrom} · ${m ? m.name : ''}`;
      return i;
    };
    els.timeline.addEventListener('pointerdown', (e) => { if (!sc.steps.length) return; dragging = true; els.timeline.setPointerCapture(e.pointerId); goTo(showBubble(e)); });
    els.timeline.addEventListener('pointermove', (e) => { if (!sc.steps.length) return; const i = showBubble(e); if (dragging && i !== S.step) goTo(i); });
    els.timeline.addEventListener('pointerup', () => { dragging = false; });
    els.timeline.addEventListener('pointerleave', () => { if (!dragging) bub.hidden = true; });
    els.timeline.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.stopPropagation(); e.preventDefault(); e.key === 'ArrowLeft' ? prev() : next(); }
    });
  }
  function updateTimeline() {
    if (!sc.steps.length) return;
    sc.chapters.forEach((chap, ki) => {
      const first = chap.steps[0].index, last = chap.steps[chap.steps.length - 1].index;
      let f = 0;
      if (S.end || S.step > last) f = 1;
      else if (S.step >= first) f = (S.step - first + (['arrive', 'hold'].includes(S.phase) ? 1 : 0.5)) / chap.steps.length;
      els.segment[ki].querySelector('i').style.width = (f * 100) + '%';
    });
    const s = sc.steps[Math.max(0, S.step)], chap = s.chapter;
    const segment = els.segment[sc.chapters.indexOf(chap)], r = segment.getBoundingClientRect(), ro = els.timeline.getBoundingClientRect();
    const f = S.end ? 1 : (chap.steps.indexOf(s) + .5) / chap.steps.length;
    els.thumb.style.left = (S.end ? ro.width : (r.left - ro.left + f * r.width)) + 'px';
    els.timelineYear.textContent = S.end || S.step < 0 ? '' : s.epilogue ? T.today : String(s.yearFrom);
    els.timeline.setAttribute('aria-valuenow', String(Math.max(0, S.step)));
    const m = stepPlace(s);
    els.timeline.setAttribute('aria-valuetext', s.epilogue ? T.today : `${s.yearFrom} ${m ? m.name : ''}`);
  }

  // ---------- player ----------
  const legDuration = (s) => Math.min(7.5, Math.max(2.4, 1.6 + 2.0 * Math.sqrt(Math.max(...s.legs.map((t) => map.legKm(t))) / 100)));
  const holdDuration = (s) => s.epilogue ? 7 : 3.4 + 1.1 * Math.max(0, s.items.length - 1) + (s.items.some((p) => p.text.length > 90) ? 1.2 : 0);
  const pen = (u) => { const e = u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; return .15 * u + .85 * e; };   // the pen speeds up and slows down

  function setPhase(f) {
    phase(f);
    const s = sc.steps[S.step];
    if (f === 'chapterTitle') {
      els.card.hidden = true;
      const chap = s.chapter;
      els.chapterTitle.style.setProperty('--branch', chap.color);
      els.ctNumber.textContent = chap.epilogue ? T.epilogue : fillTemplate(T.chapter_n, { n: chap.number });
      els.ctHeading.textContent = chap.title;
      els.ctSub.textContent = chap.subtitle;
      els.ctYears.textContent = chap.epilogue ? T.today : `${chap.yearFrom} – ${chap.yearTo}`;
      els.chapterTitle.hidden = false;
      startFlight(viewChapter(chap));
    } else if (f === 'approach') {
      els.chapterTitle.hidden = true;
      startFlight(s.legs.length ? viewPen(s) : viewStop(s));
    } else if (f === 'draw') {
      for (const t of s.legs) progress.set(t.id, 0);
      stopFlight();
    } else if (f === 'arrive') {
      for (const t of s.legs) progress.set(t.id, 1);
      visit(s); updatePlaces();
      S.arrivalTime = performance.now();
      renderCard(s);
      els.card.hidden = false;
      stopFlight();
    }
    updateDimming();
    updateTimeline();
  }
  function startStep(i) {
    S.step = i; S.end = false; map.cameraFree(false);
    const s = sc.steps[i];
    if (reduced()) { setPhase('arrive'); map.view(viewStop(s)); return; }
    setPhase(s.chapter.steps[0] === s ? 'chapterTitle' : 'approach');
  }
  // jump to a stop (card open); instant = without a flight (hash, reduced motion)
  function goTo(i, playOn, instant) {
    i = Math.max(0, Math.min(sc.steps.length - 1, i));
    els.filmIntro.hidden = true; els.chapterTitle.hidden = true;
    prepareStateTo(i);
    S.step = i; S.end = false; S.once = false; map.cameraFree(false);
    setPhase('arrive');
    if (instant || reduced()) { stopFlight(); map.view(viewStop(sc.steps[i])); S.arrivalTime = performance.now() - 900; }
    else startFlight(viewStop(sc.steps[i]));
    if (playOn != null) setPlaying(playOn);
  }
  function next() {
    if (!sc.steps.length) return;
    if (S.phase === 'intro') return startFilm();
    if (S.end) return;
    if (['chapterTitle', 'approach', 'draw'].includes(S.phase)) { setPhase('arrive'); startFlight(viewStop(sc.steps[S.step])); return; }
    if (S.step >= sc.steps.length - 1) return showEnd();
    els.card.hidden = true;
    if (!S.playing) S.once = true;          // paused: advance to the next stop only
    startStep(S.step + 1);
  }
  function prev() {
    if (S.phase === 'intro' || !sc.steps.length) return;
    goTo(S.end ? sc.steps.length - 1 : S.step - 1);
  }
  function showEnd() {
    if (!sc.steps.length) return;
    els.filmIntro.hidden = true; els.chapterTitle.hidden = true;
    prepareStateTo(sc.steps.length);
    S.step = sc.steps.length - 1; S.end = true; S.once = false; map.cameraFree(false);
    phase('end');
    updateDimming();
    endCard(); els.card.hidden = false;
    setPlaying(false);
    startFlight(viewAll());
    updateTimeline();
  }
  function startFilm() {
    if (!sc.steps.length) return;
    els.filmIntro.hidden = true;
    prepareStateTo(0);
    setPlaying(!reduced());
    startStep(0);
  }
  // intro screen over the whole map
  function intro() {
    setPlaying(false); stopFlight();
    S.step = -1; S.end = false; S.once = false; map.cameraFree(false);
    prepareStateTo(0);
    els.card.hidden = true; els.chapterTitle.hidden = true; els.filmIntro.hidden = false;
    phase('intro'); updateDimming(); updateTimeline();
    map.view(viewAll());
  }
  // paused in the middle of drawing step i (fraction 0..1); for screenshots and tests: #stop=<i>&drawing=<fraction>
  function pauseOnLeg(i, fraction) {
    const s = sc.steps[i];
    els.filmIntro.hidden = true; els.chapterTitle.hidden = true;
    prepareStateTo(i); S.step = i; S.end = false; map.cameraFree(false); setPlaying(false);
    els.card.hidden = true;
    setPhase('draw');
    S.t = legDuration(s) * fraction;
    for (const t of s.legs) progress.set(t.id, pen(fraction));
    map.view(viewPen(s));
  }
  function setPlaying(h) {
    S.playing = h;
    document.body.classList.toggle('playing', h);
    els.bPlay.setAttribute('aria-label', h ? T.map_pause : T.map_play);
  }
  function togglePlay() {
    if (!sc.steps.length) return;
    if (S.phase === 'intro') return startFilm();
    if (S.end) return goTo(0, true);
    setPlaying(!S.playing);
    if (S.playing) { map.cameraFree(false); if (S.phase === 'hold' && S.t >= holdDuration(sc.steps[S.step])) next(); }
  }

  function phaseStep(dt) {
    if (S.phase === 'intro' || S.end) return;
    const s = sc.steps[S.step], v = S.speed, running = S.playing || S.once;
    S.t += dt * v;
    if (S.phase === 'chapterTitle') {
      if (S.t > 3.4 && running) setPhase('approach');
    } else if (S.phase === 'approach') {
      if (!S.flying) setPhase(s.legs.length ? 'draw' : 'arrive');
    } else if (S.phase === 'draw') {
      if (!running) { S.t -= dt * v; return; }
      const u = Math.min(1, S.t / legDuration(s)), ee = pen(u);
      s.legs.forEach((t, n) => progress.set(t.id, Math.min(1, ee * (0.94 + 0.06 * Math.min(n, 2) / 2) / 0.94)));
      if (u >= 1) setPhase('arrive');
    } else if (S.phase === 'arrive') {
      if (S.t > .6) { S.phase = 'hold'; S.t = 0; S.once = false; }
    } else if (S.phase === 'hold') {
      const Td = holdDuration(s), i = els.card.querySelector('.card-countdown i');
      if (i) i.style.transform = `scaleX(${S.playing ? Math.min(1, S.t / Td) : 0})`;
      if (!S.playing) { S.t = Math.min(S.t, Td * .999); return; }
      if (S.t >= Td) next();
    }
  }
  // where the camera aims outside flights (flights go through map.flyTo)
  function followCamera() {
    if (S.end) return map.follow(viewAll(), 2.0);
    const s = sc.steps[S.step];
    if (S.phase === 'draw') return map.follow(viewPen(s), 2.6);
    if (S.phase === 'arrive' || S.phase === 'hold') return map.follow(viewStop(s), 1.7);
    map.follow(null);
  }
  // big year during flight and drawing; the timeline shows the same year
  function filmYear() {
    const s = S.step >= 0 && !S.end ? sc.steps[S.step] : null;
    if (!s || s.epilogue || !['approach', 'draw'].includes(S.phase)) return null;
    const from = Math.min(...s.legs.map((t) => t.yearFrom || s.yearFrom), s.yearFrom);
    let year = from;
    if (S.phase === 'draw' && s.legs.length) year = Math.round(from + (s.yearFrom - from) * Math.max(...s.legs.map((t) => progress.get(t.id) || 0)));
    if (els.timelineYear.textContent !== String(year)) els.timelineYear.textContent = String(year);
    return { year, subtitle: `${s.chapter.number} · ${s.chapter.title}`, color: color(s.chapter.branch) };
  }

  let lastTime = 0;
  function loop(time) {
    const dt = Math.min(0.05, (time - (lastTime || time)) / 1000);
    lastTime = time;
    if (sc.steps.length) {
      phaseStep(dt);
      if (S.phase !== 'intro') followCamera();
    }
    recomputeSurface();
    const cur = ['arrive', 'hold'].includes(S.phase) && !S.end ? sc.steps[S.step] : null;
    const place = cur ? stepPlace(cur) : null;
    map.render(time, dt, {
      progress, dim, activePlace: place, activeT: (time - S.arrivalTime) / 1000, activeColor: cur ? stepColor(cur) : undefined,
      spotlight: !!place, filmYear: sc.steps.length ? filmYear() : null, scale: !(mobile() && !els.card.hidden),
    });
    requestAnimationFrame(loop);
  }

  // ---------- film, hash, start ----------
  function loadFilm(person) {
    const o = { branches: D.branches, strings: T, language: D.language };
    S.person = person; S.isEmpty = false;
    sc = Sc.build(data, person ? { ...o, person } : o);
    if (person && !sc.steps.length) { S.isEmpty = true; sc = Sc.build(data, o); }
    progress.clear(); S.visited.clear(); dim = new Set();
    map.setLegs(sc.legs);
    buildTimeline();
    const pcard = person && data.people[person];
    id('cartouche-sub').textContent = pcard && !S.isEmpty ? fillTemplate(T.person_journey, { name: pcard.name })
      : branchNames;
    id('film-intro-sub').textContent = pcard && S.isEmpty
      ? fillTemplate(pcard.living ? T.person_living : T.person_no_stop, { name: pcard.name, relationship: pcard.relationship || '' })
      : T.film_intro_sub;
    updatePlaces();
  }
  function readHash() {
    const o = {};
    for (const c of location.hash.replace(/^#/, '').split('&')) {
      if (!c) continue;
      const [k, v] = c.split('=');
      try { o[k] = v === undefined ? '' : decodeURIComponent(v); } catch (e) { /* malformed % escape: ignore the value */ }
    }
    return o;
  }
  function applyHash() {
    const h = readHash(), person = h.person && Object.hasOwn(data.people, h.person) ? h.person : null;
    if (person !== S.person) loadFilm(person);
    S.mode = null;                              // let syncMode() set aria-current again (without writing to the hash)
    els.card.hidden = true;
    if (!sc.steps.length) { intro(); els.filmIntro.hidden = true; els.card.replaceChildren(el('p', { class: 'error', text: T.map_nothing })); els.card.hidden = false; return; }
    const n = parseInt(h.stop, 10), fraction = parseFloat(h.drawing);
    if (!isNaN(n) && !isNaN(fraction) && sc.steps[Math.max(0, Math.min(sc.steps.length - 1, n))].legs.length) pauseOnLeg(Math.max(0, Math.min(sc.steps.length - 1, n)), Math.max(0, Math.min(1, fraction)));
    else if (!isNaN(n)) goTo(n, false, true);
    else if ('full-map' in h) showEnd();
    else if (person && !S.isEmpty) startFilm();
    else intro();
    syncMode();
  }

  function start() {
    resetMagnifier = magnifier(els.lightbox);
    timelineControls();
    id('start').addEventListener('click', startFilm);
    id('full-map').addEventListener('click', showEnd);
    id('b-play').addEventListener('click', togglePlay);
    id('b-next').addEventListener('click', next);
    id('b-prev').addEventListener('click', prev);
    id('b-end').addEventListener('click', showEnd);
    const bSpeed = id('b-speed');
    bSpeed.addEventListener('click', () => {
      const r = [0.5, 1, 2]; S.speed = r[(r.indexOf(S.speed) + 1) % r.length];
      map.setSpeed(S.speed);
      bSpeed.textContent = (S.speed === .5 ? '½' : S.speed) + '×';
    });
    document.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || (e.target.closest && e.target.closest('input, textarea'))) return;
      if (!els.lightbox.hidden) { if (e.key === 'Escape') { els.lightbox.hidden = true; resetMagnifier(); } return; }
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'End') { e.preventDefault(); showEnd(); }
      else if (e.key === 'Home') { e.preventDefault(); goTo(0); }
    });
    window.addEventListener('hashchange', applyHash);
    applyHash();
    requestAnimationFrame(loop);
  }

  function error() {
    const k = els.card;
    els.filmIntro.hidden = true; els.chapterTitle.hidden = true;
    k.replaceChildren(el('p', { class: 'error', role: 'alert', text: T.data_error }));
    k.hidden = false;
  }

  loadData(['events', 'lines', 'places', 'people', 'documents', 'basemap', 'map']).then(async (d) => {
    data = d;
    await Promise.all(['400', 'italic 400', 'italic 600'].map((f) => document.fonts.load(f + ' 16px "EB Garamond"'))).catch(() => {});
    const baseFilm = Sc.build(data, { branches: D.branches, strings: T, language: D.language });
    const withChapter = new Set(baseFilm.chapters.filter((k) => !k.epilogue).map((k) => k.branch));
    // short branch names for the cartouche: "Smith and Jones" -> "Smith", "(note)" dropped
    branchNames = D.branches.filter((b) => withChapter.has(b.key))
      .map((b) => localized(b.name).replace(/\s*\(.*?\)/g, '').split(/\s+and\s+/)[0]).filter(Boolean).join(' · ');
    finalTown = baseFilm.clusters.find((m) => m.name === ((D && D.final_town) || '')) || null;
    map = RM.create(canvas, { basemap: data.basemap, map: data.map, places: baseFilm.clusters, language: D.language, strings: T });
    sc = baseFilm;
    start();
  }).catch(error);
})();
