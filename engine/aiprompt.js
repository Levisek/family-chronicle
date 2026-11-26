// The request for an AI chat that writes a branch chronicle: the instructions (texts of the app),
// the facts of the people of the branch and the current text. Deceased people with their dates,
// places, marriages, occupations and children; living people with their name and relation only
// (also as children or spouses of someone else: no year). The current text goes through the same
// redaction as the website (dates of living people are removed).
(function (g) {
  'use strict';

  const req = typeof require !== 'undefined';
  const M = (name) => (req ? require(`./${name}.js`) : g.FCEngine[name]);
  const placesMod = M('places');
  const events = M('events');
  const rel = M('relationship');
  const privacy = M('privacy');

  const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (all, k) => (k in vars ? vars[k] : all));
  const nameOf = (p) => [p.given, p.surname].filter(Boolean).join(' ').trim() || p.id;
  const deathOf = (p) => p.events.find((e) => e.type === 'DEAT') || p.events.find((e) => e.type === 'BURI') || null;
  const yearOf = (ev) => (ev && ev.date && ev.date.year != null ? ev.date.year : null);
  const idCmp = (a, b) => a.localeCompare(b, 'en', { numeric: true });

  function build({ tree, scope, cfg, branchKey, lang, languageName, current, places, texts, locales }) {
    const dl = lang === 'cs' ? 'cs' : 'en';
    const P = new placesMod.Places(places || {}, cfg.ignore_places || []);
    const town = (ev) => (ev && ev.place ? P.town(ev.place) || placesMod.toTown(ev.place) || ev.place.split(',')[0].trim() : '');
    const fact = (label, ev) => {
      if (!ev) return null;
      const x = [ev.date ? events.formatDate(ev.date, 'en') : '', town(ev)].filter(Boolean).join(', ');
      return x ? `${label} ${x}` : null;
    };
    const living = (id) => scope.living.has(id);
    const short = (id) => {
      const p = tree.people.get(id);
      if (!p) return id;
      if (living(id)) return nameOf(p);
      const b = yearOf(p.birth), d = yearOf(deathOf(p));
      return b === null && d === null ? nameOf(p) : `${nameOf(p)} (${b ?? '?'}–${d ?? ''})`;
    };

    // the people of the branch, and their spouses
    const inBranch = (id) => scope.branchOf.get(id) === branchKey;
    const ids = [...scope.people].filter((id) => inBranch(id) || (scope.spouseOf.has(id) && inBranch(scope.spouseOf.get(id))));
    const BIG = 1e9;
    ids.sort((a, b) => (scope.ahnentafel.get(b) ?? 0) - (scope.ahnentafel.get(a) ?? 0) || ((scope.ahnentafel.has(a) ? 0 : BIG) - (scope.ahnentafel.has(b) ? 0 : BIG)) || idCmp(a, b));

    const lines = [];
    for (const id of ids) {
      const p = tree.people.get(id);
      if (living(id)) { lines.push(`- ${nameOf(p)} [${id}]: living, ${rel.relationship(scope, id, dl)}`); continue; }
      const parts = [fact('born', p.birth), fact('died', deathOf(p))];
      const occ = [...new Set(p.occupations.map((o) => o && o.value).filter(Boolean))];
      if (occ.length) parts.push(`occupation ${occ.join(', ')}`);
      for (const fid of p.families) {
        const f = tree.families.get(fid);
        if (!f) continue;
        const other = [f.husband, f.wife].find((x) => x && x !== id && tree.people.has(x));
        const marr = f.events.find((e) => e.type === 'MARR');
        if (other) parts.push(living(other) ? `partner ${short(other)}` : [`married ${short(other)}`, marr ? fact('', marr) : null].filter(Boolean).join(','));
        const kids = f.children.filter((c) => tree.people.has(c));
        if (kids.length) parts.push(`children ${kids.map(short).join(', ')}`);
      }
      const parents = tree.parents(id);
      if (parents.length) parts.push(`parents ${parents.map(short).join(', ')}`);
      lines.push(`- ${nameOf(p)} [${id}]: ${[rel.relationship(scope, id, dl), ...parts.filter(Boolean)].join('; ')}`);
    }

    const branch = (cfg.branches || []).find((b) => b.key === branchKey);
    const branchName = branch ? (branch.name[lang] || Object.values(branch.name)[0] || branchKey) : branchKey;
    const langs = (cfg.languages || [lang]).filter((l) => locales && locales[l]);
    const ext = locales ? privacy.localeExtensions(langs.length ? langs : Object.keys(locales), locales, cfg.strings) : null;
    const text = privacy.redact(String(current || ''), [...privacy.sensitiveDates(tree, scope).values()].flat(), ext);
    return [
      fill(texts.intro, { branch: branchName, language: languageName || lang }), '',
      texts.rules, '',
      `## ${texts.facts_title}`, '', ...lines, '',
      `## ${texts.chronicle_title}`, '', text.trimEnd(), '',
    ].join('\n');
  }

  const api = { build };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).aiprompt = api;
})(typeof window !== 'undefined' ? window : globalThis);
