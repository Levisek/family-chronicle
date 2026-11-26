// The draft of a branch chronicle from the data: the ancestors of the branch by generations, the
// oldest first, one paragraph a couple with the web markers (`<!-- person -->`, `<!-- place -->`),
// sentences from `locales/<lang>.json` > `skeleton`. A missing date or place is a mark
// "[Fill in: birthplace]" (shown yellow in the app, removed from the website). Living people get
// their name and relation only. A language without `skeleton` gets a list of facts, no sentences.
(function (g) {
  'use strict';

  const req = typeof require !== 'undefined';
  const M = (name) => (req ? require(`./${name}.js`) : g.FCEngine[name]);
  const placesMod = M('places');
  const events = M('events');
  const rel = M('relationship');

  const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (all, k) => (k in vars ? vars[k] : all));
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fullName = (p) => esc([p.given, p.surname].filter(Boolean).join(' ').trim() || p.id);
  const deathOf = (p) => p.events.find((e) => e.type === 'DEAT') || p.events.find((e) => e.type === 'BURI') || null;
  const yearOf = (ev) => (ev && ev.date && ev.date.year != null ? ev.date.year : null);

  // The marks of every language: "[Fill in: …]", "[Doplňte: …]" (kept in chronicles.js: the build
  // needs them and is loaded first).
  const fillPattern = (locales) => M('chronicles').fillPattern(locales);

  function build({ tree, scope, cfg, branchKey, lang, locale, places }) {
    const sk = locale && locale.skeleton ? locale.skeleton : null;
    const dl = lang === 'cs' ? 'cs' : 'en';
    const P = new placesMod.Places(places || {}, cfg.ignore_places || []);
    const town = (ev) => (ev && ev.place ? esc(P.town(ev.place) || placesMod.toTown(ev.place) || ev.place.split(',')[0].trim()) : '');
    const date = (ev) => (ev && ev.date ? esc(events.formatDate(ev.date, dl) || '') : '');
    const mark = (what) => `[${sk.fill_in}: ${sk[what]}]`;
    const living = (id) => scope.living.has(id);

    const branch = (cfg.branches || []).find((b) => b.key === branchKey);
    const title = branch ? (branch.name[lang] || Object.values(branch.name)[0] || branchKey) : branchKey;
    const out = [`# ${esc(title)}`, ''];

    // couples by the number of their child in the ahnentafel; generations from the oldest
    const couples = new Map();
    for (const [id, n] of scope.ahnentafel) {
      if (n < 2 || scope.branchOf.get(id) !== branchKey) continue;
      const k = Math.floor(n / 2);
      if (!couples.has(k)) couples.set(k, []);
      couples.get(k).push([n, id]);
    }
    const byGen = new Map();
    for (const [k, members] of couples) {
      const gen = Math.floor(Math.log2(k * 2));
      if (!byGen.has(gen)) byGen.set(gen, []);
      byGen.get(gen).push([k, members.sort((a, b) => a[0] - b[0]).map(([, id]) => id)]);
    }
    const gens = [...byGen.keys()].sort((a, b) => b - a);
    gens.forEach((gen, i) => {
      out.push(`## ${fill(sk ? sk.generation : (locale && locale.chapter_n) || '{n}', { n: i + 1 })}`, '');
      for (const [, ids] of byGen.get(gen).sort((a, b) => a[0] - b[0])) {
        out.push(...couple(ids), '');
      }
    });
    return out.join('\n').replace(/\n+$/, '\n');

    function familyOf(ids) {
      if (ids.length < 2) return null;
      for (const fid of tree.people.get(ids[0]).families) {
        const f = tree.families.get(fid);
        if (f && [f.husband, f.wife].includes(ids[1])) return f;
      }
      return null;
    }

    function couple(ids) {
      const people = ids.map((id) => tree.people.get(id));
      const fam = familyOf(ids);
      const anyLiving = ids.some(living);
      const towns = [];
      const addTown = (ev) => { const x = town(ev); if (x && !towns.includes(x)) towns.push(x); };
      if (!anyLiving) {
        for (const p of people) for (const ev of p.events) addTown(ev);
        if (fam) for (const ev of fam.events) addTown(ev);
      } else for (const p of people) if (!living(p.id)) for (const ev of p.events) addTown(ev);
      const lines = [`<!-- person: ${ids.join('; ')} -->`];
      if (towns.length) lines.push(`<!-- place: ${towns.join('; ')} -->`);
      const marr = fam ? fam.events.find((e) => e.type === 'MARR') || null : null;
      const kids = fam ? fam.children.filter((c) => tree.people.has(c)) : [];
      const kidText = (c) => {
        const p = tree.people.get(c);
        if (living(c)) return fullName(p);
        const b = yearOf(p.birth), d = yearOf(deathOf(p));
        return b === null && d === null ? fullName(p) : `${fullName(p)} (${b ?? '?'}–${d ?? ''})`;
      };

      if (!sk) {
        for (const p of people) {
          if (living(p.id)) { lines.push(`- ${fullName(p)} (${esc(rel.relationship(scope, p.id, dl))})`); continue; }
          const part = (label, ev) => (ev ? `${label} ${[date(ev), town(ev)].filter(Boolean).join(', ')}`.trim() : null);
          const facts = [part(locale.born_lc || 'born', p.birth), part(locale.died_lc || 'died', deathOf(p))].filter(Boolean);
          lines.push(`- ${fullName(p)}${facts.length ? `: ${facts.join('; ')}` : ''}`);
        }
        if (marr && !anyLiving) lines.push(`- ${locale.marriage_lc || 'marriage'} ${[date(marr), town(marr)].filter(Boolean).join(', ')}`.trim());
        return lines;
      }

      const said = [];
      const sex = (p) => (p.sex === 'F' ? 'f' : 'm');
      const when = (ev, what) => date(ev) || mark(what);
      const where = (ev, what) => town(ev) || mark(what);
      for (const p of people) {
        if (living(p.id)) { said.push(fill(sk.living, { name: fullName(p), relationship: esc(rel.relationship(scope, p.id, dl)) })); continue; }
        said.push(fill(sk[`born_${sex(p)}`], { name: fullName(p), date: when(p.birth, 'what_birth_date'), place: where(p.birth, 'what_birth_place') }));
        const occ = [...new Set(p.occupations.map((o) => (typeof o === 'string' ? o : o && o.value)).filter(Boolean))];
        if (occ.length) said.push(fill(sk.occupation, { name: fullName(p), list: esc(occ.join(', ')) }));
      }
      if (fam && people.length === 2 && !anyLiving) {
        said.push(fill(sk.married, { a: fullName(people[0]), b: fullName(people[1]), date: when(marr, 'what_marriage_date'), place: where(marr, 'what_marriage_place') }));
      }
      if (kids.length && !anyLiving) said.push(fill(sk.children, { list: kids.map(kidText).join(', ') }));
      if (!anyLiving) {
        const born = new Set(people.map((p) => town(p.birth)).filter(Boolean));
        const later = towns.filter((x) => !born.has(x));
        if (later.length) said.push(fill(sk.moved, { list: later.join(', ') }));
      }
      for (const p of people) {
        if (living(p.id)) continue;
        const d = deathOf(p);
        said.push(fill(sk[`died_${sex(p)}`], { name: fullName(p), date: when(d, 'what_death_date'), place: where(d, 'what_death_place') }));
      }
      lines.push(said.join(' '));
      return lines;
    }
  }

  // Blocks of a chronicle: paragraphs split by blank lines; a block that starts with a person
  // marker has a key (its ids).
  const ANCHOR = /^[ \t]*<!--[ \t]*person[ \t]*:([\s\S]*?)-->/;
  const keyOf = (block) => {
    const m = ANCHOR.exec(block);
    return m ? m[1].split(';').map((x) => x.trim().replace(/^@+|@+$/g, '')).filter(Boolean).join(';') : null;
  };
  const split = (md) => md.replace(/^\n+|\n+$/g, '').split(/\n(?:[ \t]*\n)+/);

  // A new draft over a chronicle somebody may have written in: a block that still has a mark is
  // replaced by the new draft of the same people; written blocks stay; people the chronicle does
  // not mention yet go to the end under `heading`.
  function refresh(current, fresh, pattern, heading) {
    const test = (s) => new RegExp(pattern.source).test(s);
    const freshBlocks = new Map();
    for (const b of split(fresh)) { const k = keyOf(b); if (k && !freshBlocks.has(k)) freshBlocks.set(k, b); }
    const seen = new Set();
    const blocks = split(current).map((b) => {
      const k = keyOf(b);
      if (!k) return b;
      seen.add(k);
      return freshBlocks.has(k) && test(b) ? freshBlocks.get(k) : b;
    });
    const added = [...freshBlocks].filter(([k]) => !seen.has(k)).map(([, b]) => b);
    if (added.length) blocks.push(`## ${heading}`, ...added);
    return blocks.join('\n\n') + '\n';
  }

  const api = { build, refresh, fillPattern };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).skeleton = api;
})(typeof window !== 'undefined' ? window : globalThis);
