import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const Film = require('../static/film.js');
const load = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const BASE = load('./data/film/base.json');
const EN = load('../locales/en.json');
const CS = load('../locales/cs.json');

// config order of the branches; "cedar" has no chronicle, "alder" and "birch" have one
const BRANCHES = [
  { key: 'alder', name: { en: 'Alder' }, color: '#123456', chronicle: 'alder' },
  { key: 'birch', name: { en: 'Birch' }, color: '#654321', chronicle: 'birch' },
  { key: 'cedar', name: { en: 'Cedar family', cs: 'Cedarovi' }, color: '#0a0b0c', chronicle: null },
];
const STRINGS = {
  chapters: {
    alder: { title: 'The Alders', short: 'Alders', subtitle: 'Up the river' },
    birch: { title: 'The Birches', short: 'Birches', subtitle: 'Over the hill' },
    epilogue: { title: 'Today', subtitle: 'All paths meet' },
  },
  event_types: EN.event_types,
};
const options = (extra) => ({ branches: BRANCHES, strings: STRINGS, language: 'en', ...extra });
const copy = (o) => JSON.parse(JSON.stringify(o));

const PLACES = {
  ...BASE.places,
  'Lakeside': { coords: [45.11, 20.63], country: { en: 'Flatland', cs: 'Rovinsko' } },
  'Marshford': { coords: [45.12, 20.73], country: { en: 'Flatland', cs: 'Rovinsko' } },
  'Far Port': { coords: [43.55, 24.18], country: { en: 'Sealand', cs: 'Mořsko' } },
  'Dunecliff': { coords: [43.6, 24.2], country: { en: 'Sealand', cs: 'Mořsko' } },
  'Highmoor': { coords: [48.78, 16.88], country: { en: 'Flatland', cs: 'Rovinsko' } },
  'Highmoor Gate': { coords: [48.805, 16.638], country: { en: 'Flatland', cs: 'Rovinsko' } },
};
const ev = (id, place, year, branch = 'cedar', extra = {}) => ({
  id, type: 'birth', year, date: String(year), place, branch, people: ['I3'], documents: [], certainty: 'document',
  description: { en: `birth — ${id}`, cs: `narození — ${id}` }, ...extra });
// small data of one branch without the fixture events; person I3 is an ancestor
const small = (events, lines = []) => ({ ...copy(BASE), places: PLACES, events, lines });
const names = (s) => s.steps.map((k) => k.place.name);

// every string in the whole structure (steps point to chapters and back, hence the visited set)
function strings(x, seen = new Set(), out = []) {
  if (typeof x === 'string') out.push(x);
  else if (x && typeof x === 'object' && !seen.has(x)) { seen.add(x); for (const v of Object.values(x)) strings(v, seen, out); }
  return out;
}

test('chapter order follows the branch list; an empty chapter is left out', () => {
  const d = copy(BASE);
  d.places = PLACES;
  d.events = d.events.concat([ev('c1', 'Lakeside', 1893, 'cedar')]);
  assert.deepEqual(Film.build(d, options()).chapters.map((k) => k.branch), ['alder', 'birch', 'cedar', 'common']);
  const reversed = options({ branches: [...BRANCHES].reverse() });
  assert.deepEqual(Film.build(d, reversed).chapters.map((k) => k.branch), ['cedar', 'birch', 'alder', 'common']);
  const s = Film.build(BASE, options());
  assert.deepEqual(s.chapters.map((k) => k.branch), ['alder', 'birch', 'common']);
  assert.equal(s.chapters.at(-1).epilogue, true);
  assert.deepEqual(s.chapters.map((k) => k.number), ['I', 'II', '']);
  assert.ok(s.chapters.every((k) => k.steps.length));
});

test('chapter texts come from the chronicle slug; a branch without one falls back to its name', () => {
  const d = copy(BASE);
  d.places = PLACES;
  d.events = d.events.concat([ev('c1', 'Lakeside', 1893, 'cedar')]);
  const s = Film.build(d, options());
  const [alder, , cedar, epilogue] = s.chapters;
  assert.deepEqual([alder.title, alder.short, alder.subtitle], ['The Alders', 'Alders', 'Up the river']);
  assert.deepEqual([cedar.title, cedar.short, cedar.subtitle], ['Cedar family', 'Cedar family', '']);
  assert.deepEqual([epilogue.title, epilogue.subtitle], ['Today', 'All paths meet']);
  const cs = Film.build(d, options({ language: 'cs' }));
  assert.equal(cs.chapters[2].title, 'Cedarovi');
});

test('more branches than the Roman numerals of a short table', () => {
  const branches = Array.from({ length: 9 }, (_, i) => ({ key: 'b' + i, name: { en: 'B' + i }, chronicle: null }));
  const d = small(branches.map((b, i) => ev('e' + i, 'Lakeside', 1900 + i, b.key)));
  const s = Film.build(d, options({ branches }));
  assert.deepEqual(s.chapters.slice(0, 9).map((k) => k.number), ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX']);
});

test('living people appear only in the epilogue, without a year', () => {
  const d = copy(BASE);
  d.places = PLACES;
  // nasty inputs: an event of a living person only, an event of a living person and an ancestor, a line from a living person
  d.events.push(ev('zz1', 'Eastbrook', 1990, 'alder', { people: ['I7'], type: 'move' }));
  d.events.push(ev('zz2', 'Eastbrook', 1991, 'alder', { people: ['I3', 'I2'], type: 'marriage' }));
  d.lines.push({ from: 'I7', to: 'I1', branch: 'alder', points: [[50.45, 16.07, 1960, 'document'], [48.78, 16.88, 1990, 'document']] });
  const s = Film.build(d, options());
  const living = Object.keys(d.people).filter((i) => d.people[i].living);
  const epilogue = s.steps.at(-1);
  assert.equal(epilogue.epilogue, true);
  for (const k of s.steps.filter((x) => !x.epilogue)) assert.ok(!strings(k).some((r) => living.includes(r)), 'step ' + k.index);
  for (const t of s.legs) assert.ok(!strings(t).some((r) => living.includes(r)), 'leg ' + t.id);
  assert.ok(!s.steps.some((k) => k.events.some((u) => u.id === 'zz1' || u.id === 'zz2')));
  assert.ok(!s.legs.some((t) => t.branch === 'alder' && t.year === 1990));
  assert.deepEqual(epilogue.members, [
    { name: 'Rowan Hale', relationship: 'the author' }, { name: 'Sage Hale', relationship: 'sister' }]);
  assert.deepEqual(epilogue.events, []);
  assert.equal(epilogue.yearFrom, null);
  // the epilogue holds only name and relationship; no id, year, date or place
  assert.ok(!strings(epilogue.members).some((r) => living.includes(r) || /\d{4}|Westvale/.test(r)));
  for (const z of epilogue.members) assert.deepEqual(Object.keys(z).sort(), ['name', 'relationship']);
});

test('places within 3.5 km merge into one cluster', () => {
  const s = Film.build(BASE, options());
  const westvale = s.clusters.filter((c) => c.names.includes('Westvale'));
  assert.equal(westvale.length, 1);
  assert.deepEqual(westvale[0].names.sort(), ['Westvale', 'Westvale Hill']);
  assert.equal(westvale[0].name, 'Westvale');
  assert.equal(s.clusters.length, 4);   // Northfield, Eastbrook, Southport, Westvale
  assert.equal(westvale[0].country, 'Flatland');
  assert.equal(Film.build(BASE, options({ language: 'cs' })).clusters[0].country, 'Rovinsko');
});

test('at most 4 events on a card, the rest is counted in "more"', () => {
  const u = [1900, 1901, 1902, 1903, 1904, 1905].map((r, i) => ev('x' + i, 'Eastbrook', r, 'alder'));
  const k = Film.build(small(u), options()).steps[0];
  assert.equal(k.events.length, 4);
  assert.equal(k.more, 2);
  assert.equal(k.items.length, 4);
  assert.equal(k.yearTo, 1905);
  assert.equal(Film.build(BASE, options()).steps[0].more, 0);
});

test('a generational leg joins stops that have no dated leg', () => {
  const s = Film.build(small([ev('a', 'Northfield', 1877, 'alder'), ev('b', 'Eastbrook', 1902, 'alder')]), options());
  const g = s.legs.filter((t) => t.generational);
  assert.equal(g.length, 1);
  assert.equal(g[0].year, 1902);
  assert.equal(g[0].certainty, 'tree');
  assert.equal(g[0].branch, 'alder');
  assert.equal(g[0].from.name, 'Northfield');
  assert.equal(g[0].to.name, 'Eastbrook');
  assert.deepEqual(s.steps[1].legs, g);
  assert.deepEqual(s.steps[0].legs, []);
});

test('no generational leg within 3.5 km, across chapters, or where a dated leg exists', () => {
  // Westvale and Westvale Hill are one cluster; alder ends in Eastbrook, birch starts in Southport
  const u = [ev('a', 'Westvale', 1900, 'birch'), ev('b', 'Westvale Hill', 1930, 'birch'), ev('c', 'Eastbrook', 1900, 'alder')];
  assert.equal(Film.build(small(u), options()).legs.filter((t) => t.generational).length, 0);
  // base: alder and birch each have a dated leg from a line, so there is no generational one
  const z = Film.build(BASE, options());
  assert.equal(z.legs.filter((t) => t.generational).length, 0);
  assert.equal(z.steps.filter((k) => !k.epilogue).flatMap((k) => k.legs).length, 2);
  // two chapters with two stops each and no lines: two generational legs, each inside its own chapter
  const two = small([ev('a', 'Northfield', 1877, 'alder'), ev('b', 'Eastbrook', 1902, 'alder'),
    ev('c', 'Southport', 1880, 'birch'), ev('d', 'Westvale', 1907, 'birch')]);
  const g = Film.build(two, options()).legs.filter((t) => t.generational);
  assert.deepEqual(g.map((t) => [t.from.name, t.to.name]), [['Northfield', 'Eastbrook'], ['Southport', 'Westvale']]);
});

test('a generational leg does not end where another dated line starts (birthplace of the second family)', () => {
  const u = [ev('a', 'Northfield', 1877, 'alder'), ev('b', 'Eastbrook', 1890, 'alder')];
  const lines = [{ from: 'I4', to: 'I7', branch: 'alder', points: [[50.416, 16.163, 1890, 'document'], [48.78, 16.88, 1921, 'document']] }];
  assert.equal(Film.build(small(u, lines), options()).legs.filter((t) => t.generational).length, 0);
  // a line without a year (the way to living people) says nothing about the birthplace
  const none = [{ from: 'I4', to: 'I7', branch: 'alder', points: [[50.416, 16.163, 1890, 'document'], [48.78, 16.88, null, 'document']] }];
  assert.equal(Film.build(small(u, none), options()).legs.filter((t) => t.generational).length, 1);
});

test('no needless flight: Lakeside, Marshford, Sealand', () => {
  const u = [ev('A', 'Lakeside', 1893), ev('C', 'Far Port', 1893), ev('B', 'Marshford', 1897)];
  const lines = [{ from: 'I3', to: 'I7', branch: 'cedar', points: [[45.11, 20.63, 1893, 'document'], [45.12, 20.73, 1897, 'document']] }];
  const s = Film.build(small(u, lines), options());
  assert.deepEqual(names(s).slice(0, 3), ['Lakeside', 'Marshford', 'Far Port']);
  assert.deepEqual(s.steps.map((k) => k.index), s.steps.map((_, i) => i));
  assert.deepEqual(s.chapters[0].steps.map((k) => k.place.name), names(s).slice(0, 3));
  // a stop outside the 5-year window is not reordered
  const outside = Film.build(small([ev('A', 'Lakeside', 1893), ev('C', 'Far Port', 1893), ev('B', 'Marshford', 1903)]), options());
  assert.deepEqual(names(outside).slice(0, 3), ['Lakeside', 'Far Port', 'Marshford']);
});

test('a stop without a line merges with the previous one (Highmoor Gate into Highmoor)', () => {
  const u = [ev('V', 'Dunecliff', 1927), ev('B', 'Highmoor', 1950), ev('M', 'Highmoor Gate', 1950)];
  const lines = [{ from: 'I3', to: 'I7', branch: 'cedar', points: [[43.6, 24.2, 1927, 'document'], [48.78, 16.88, 1950, 'document']] }];
  const s = Film.build(small(u, lines), options());
  assert.deepEqual(names(s).filter((n) => n !== 'Westvale'), ['Dunecliff', 'Highmoor']);
  const highmoor = s.steps.find((k) => k.place.name === 'Highmoor');
  assert.deepEqual(highmoor.events.map((x) => x.id), ['B', 'M']);
  assert.equal(highmoor.legs.length, 1);
  // a distant stop (Eastbrook, about 600 km away) does not merge
  const far = Film.build(small([ev('V', 'Dunecliff', 1927), ev('B', 'Highmoor', 1950), ev('N', 'Eastbrook', 1950)], lines), options());
  assert.ok(names(far).includes('Eastbrook'));
});

test('events of one year are ordered by month, whatever the date format', () => {
  const u = [ev('mar', 'Eastbrook', 1900, 'alder', { date: '5 Mar 1900' }), ev('jan', 'Northfield', 1900, 'alder', { date: '2. 1. 1900' }),
    ev('summer', 'Southport', 1900, 'alder', { date: 'summer 1900' }), ev('dec', 'Westvale', 1900, 'alder', { date: 'December 1900' })];
  const s = Film.build(small(u), options());
  assert.deepEqual(s.steps.filter((k) => !k.epilogue).flatMap((k) => k.events.map((x) => x.id)), ['jan', 'mar', 'summer', 'dec']);
});

test('person filter: an ancestor keeps only their own steps, a living person gets nothing', () => {
  const s = Film.build(BASE, options({ person: 'I3' }));
  assert.deepEqual(s.chapters.map((k) => k.branch), ['alder']);
  assert.ok(s.steps.length >= 2);
  assert.ok(s.steps.every((k) => k.events.every((x) => x.people.includes('I3'))));
  assert.ok(!s.steps.some((k) => k.epilogue));
  const z = Film.build(BASE, options({ person: 'I2' }));
  assert.deepEqual(z.chapters, []);
  assert.equal(z.living, true);
  assert.deepEqual(Film.build(BASE, options({ person: 'I7' })).chapters, []);
  assert.equal(Film.build(BASE, options({ person: 'unknown' })).living, undefined);
});

test('event type labels and the description text follow the language', () => {
  const en = Film.build(BASE, options());
  const cs = Film.build(BASE, options({ language: 'cs', strings: { ...STRINGS, event_types: CS.event_types } }));
  const move = (s) => s.steps.flatMap((k) => k.items).find((p) => p.type === 'move');
  assert.equal(move(en).label, EN.event_types.move);
  assert.equal(move(cs).label, CS.event_types.move);
  assert.notEqual(move(en).label, move(cs).label);
  assert.equal(move(en).text, 'The family moves to the hill');
  const birth = en.steps.flatMap((k) => k.items).find((p) => p.type === 'birth');
  assert.equal(birth.label, 'birth');
});

test('locales: every film string exists in every language', () => {
  for (const [lang, t] of [['en', EN], ['cs', CS]]) {
    assert.ok(t.chapters.epilogue.title, `${lang} chapters.epilogue.title`);
    assert.ok(t.chapters.epilogue.subtitle, `${lang} chapters.epilogue.subtitle`);
    for (const type of ['birth', 'death', 'burial', 'marriage', 'move', 'transport', 'war', 'other']) {
      assert.ok(t.event_types[type], `${lang} event_types.${type}`);
    }
  }
});

test('shape of steps and legs, and the chapter colour from the branch', () => {
  const s = Film.build(BASE, options());
  assert.equal(s.chapters[0].color, '#123456');
  assert.equal(s.chapters[2].color, '#6a5640');   // the epilogue is neutral
  const k = s.steps[0];
  for (const f of ['index', 'chapter', 'place', 'yearFrom', 'yearTo', 'events', 'legs', 'items']) assert.ok(f in k, f);
  const t = s.steps.flatMap((x) => x.legs)[0];
  for (const f of ['from', 'to', 'year', 'yearFrom', 'branch', 'certainty', 'traveller']) assert.ok(f in t, f);
  assert.equal(t.traveller, 'Alder Ford');
  assert.equal(s.steps[0].place, s.clusters.find((x) => x.names.includes('Northfield')));
});
