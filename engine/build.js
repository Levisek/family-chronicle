// Build the static website in memory: pages, JSON data, images, manifest and the approval list.
// At the end the privacy check of the output runs; a finding makes the result not ok.
// Port of familychronicle/build.py (`_build` and `Pages`). The caller supplies every input file:
//   build({files, configPath, assets: {static, fonts, locales}, today, images}) -> Promise<BuildResult>
//   files     Map<string, Uint8Array> of the project folder (keys relative to it, "/")
//   configPath key of site.json in `files`
//   assets    static: Map<name, bytes> (static/*), fonts: Map<name, bytes> (*.ttf, OFL.txt),
//             locales: {lang: object} (locales/*.json)
//   images    ImageAdapter (see documents.js)
// BuildResult = {ok, files, findings, warnings, approval, manifest, fillIns: [{file, count}]}; `files` keys are relative to
// the output folder: "<site_dir>/...", "manifest.json", "approval.md".
(function (g) {
  'use strict';

  const req = typeof require !== 'undefined';
  const M = (name, key) => (req ? require(`./${name}.js`) : g.FCEngine[key || name]);
  const text = M('text');
  const sha = M('sha256');
  const config = M('config');
  const gedcom = M('gedcom');
  const scopeMod = M('scope');
  const relationship = M('relationship').relationship;
  const placesMod = M('places');
  const events = M('events');
  const mapview = M('mapview');
  const statesMod = M('states');
  const privacy = M('privacy');
  const documents = M('documents');
  const chronicles = M('chronicles');
  const templates = M('templates');

  const { BuildError } = config;
  const RESERVED_SLUG = 'open-questions';
  const COLOR = /^#[0-9a-fA-F]{3,8}$/;
  const e = (s) => text.escapeHtml(String(s));
  const has = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  // set a key that comes from user data (also "__proto__") as an own property
  const put = (obj, k, v) => Object.defineProperty(obj, k, { value: v, enumerable: true, writable: true, configurable: true });
  const pyFormat = (template, values) => template.replace(/\{(\w+)\}/g, (all, k) => (has(values, k) ? String(values[k]) : all));

  // --- JSON as Python's json.dumps(ensure_ascii=False, indent=1, sort_keys=True) ---------------
  function pyJson(obj, indent = 1, sortKeys = true, level = 0) {
    const pad = (n) => '\n' + ' '.repeat(indent * n);
    if (obj === null || obj === undefined) return 'null';
    if (typeof obj === 'number' || typeof obj === 'boolean') return JSON.stringify(obj);
    if (typeof obj === 'string') return JSON.stringify(obj);
    if (obj instanceof Map) obj = Object.fromEntries(obj);
    if (Array.isArray(obj)) {
      if (!obj.length) return '[]';
      return '[' + obj.map((x) => pad(level + 1) + pyJson(x, indent, sortKeys, level + 1)).join(',') + pad(level) + ']';
    }
    const keys = Object.keys(obj);
    if (sortKeys) keys.sort(cmp);
    if (!keys.length) return '{}';
    return '{' + keys.map((k) => pad(level + 1) + JSON.stringify(k) + ': ' + pyJson(obj[k], indent, sortKeys, level + 1)).join(',') + pad(level) + '}';
  }
  const jsonBytes = (obj) => text.utf8(pyJson(obj));

  // Markdown sometimes emits `style=""` (table alignment); the site allows none.
  function cleanHtml(h, tableLabel = 'Table') {
    h = h.replace(/<table>[\s\S]*?<\/table>/g, (m) => `<div class="table-wrap" role="region" tabindex="0" aria-label="${e(tableLabel)}">${m}</div>`);
    h = h.replace(/\sstyle="text-align:\s*(left|right|center);?"/g, ' class="align-$1"');
    return h.replace(/\sstyle="[^"]*"/g, '');
  }

  class Writer {
    constructor() { this.files = new Map(); }
    text(rel, content) { this.files.set(rel, text.utf8(content)); }
    bytes(rel, data) { this.files.set(rel, data); }
    hashed(relDir, name, ext, data) {
      const rel = `${relDir}/${name}.${sha.hash8(data)}.${ext}`;
      this.bytes(rel, data);
      return rel;
    }
    // A hashed JSON file in data/ plus a script twin with the same content (file:// refuses fetch).
    data(name, data) {
      const rel = this.hashed('data', name, 'json', data);
      const head = text.utf8(`(self.FC_DATA=self.FC_DATA||{})["${rel}"]=`);
      const tail = text.utf8(';\n');
      const twin = new Uint8Array(head.length + data.length + tail.length);
      twin.set(head); twin.set(data, head.length); twin.set(tail, head.length + data.length);
      this.bytes(rel.slice(0, -'.json'.length) + '.js', twin);
      return rel;
    }
  }

  // --- strings ---------------------------------------------------------------------------------
  function fill(value, replacements) {
    if (typeof value === 'string') { for (const [k, v] of replacements) value = value.split(k).join(v); return value; }
    if (Array.isArray(value)) return value.map((x) => fill(x, replacements));
    if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, x]) => [k, fill(x, replacements)]));
    return value;
  }
  function merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = isObject(v) && isObject(out[k]) ? merge(out[k], v) : v;
    return out;
  }
  function loadStrings(cfg, locales, rootGiven, rootFull, chapterTitles) {
    const overrides = cfg.strings || {};
    const out = {};
    for (const lang of cfg.languages) {
      let t = merge(JSON.parse(JSON.stringify(locales[lang])), overrides[lang] || {});
      delete t.privacy;
      delete t.skeleton;   // sentences of the chronicle draft (the app), not a text for the browser
      t = fill(t, [['{root_full}', rootFull], ['{root}', rootGiven]]);
      if (!isObject(t.chapters)) t.chapters = {};
      for (const [slug, [title, branchName]] of chapterTitles) {
        if (!has(t.chapters, slug)) put(t.chapters, slug, { title, short: branchName[lang] || title, subtitle: '' });
      }
      out[lang] = t;
    }
    return out;
  }
  const templateStrings = (t) => Object.fromEntries(Object.entries(t).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, e(v)]));

  // --- people and events --------------------------------------------------------------------------
  const townOf = (places, place) => (place ? places.town(place) || placesMod.toTown(place) || null : null);
  const fact = (ev, places, lang) => (ev ? { date: events.formatDate(ev.date, lang), place: townOf(places, ev.place) } : null);

  function partners(tree, scope, pid) {
    const out = {};
    for (const fid of tree.people.get(pid).families) {
      const f = tree.families.get(fid);
      if (!f) continue;
      const other = f.husband === pid ? f.wife : f.husband;
      if (!other || other === pid || !scope.people.has(other)) continue;
      const kinds = new Set(f.events.map((x) => x.type));
      if (kinds.has('DIV')) put(out, other, 'divorced');
      else if (!kinds.has('MARR') && (scope.living.has(pid) || scope.living.has(other))) put(out, other, 'partner');
      else put(out, other, 'spouse');
    }
    return out;
  }

  function ageText(years, approximate, t) {
    if (years === 0) return t.age_under_year;
    const key = years === 1 ? 'age_year' : years >= 2 && years <= 4 ? 'age_years_few' : 'age_years';
    const s = pyFormat(t[key], { n: years });
    return approximate ? pyFormat(t.age_about, { value: s }) : s;
  }

  function marriages(tree, scope, places, pid, lang) {
    const out = [];
    for (const fid of tree.people.get(pid).families) {
      const f = tree.families.get(fid);
      if (!f) continue;
      const other = f.husband === pid ? f.wife : f.husband;
      if (scope.living.has(other)) continue;
      for (const ev of f.events) {
        if (ev.type !== 'MARR') continue;
        const fc = fact(ev, places, lang);
        if (fc.date || fc.place) out.push({ spouse: scope.people.has(other) ? other : null, ...fc });
      }
    }
    return out;
  }

  function peopleJson(tree, scope, places, livingTown, t, lang, states, defaultLanguage) {
    const out = new Map();
    for (const pid of [...scope.people].sort(cmp)) {
      const p = tree.people.get(pid);
      const base = {
        name: `${p.given} ${p.surname}`.trim() || 'N.N.',
        relationship: relationship(scope, pid, lang),
        branch: scope.branchOf.has(pid) ? scope.branchOf.get(pid) : '',
        living: scope.living.has(pid),
        ahnentafel: scope.ahnentafel.has(pid) ? scope.ahnentafel.get(pid) : null,
        parents: tree.parents(pid).filter((r) => scope.people.has(r)),
        sex: p.sex === 'M' || p.sex === 'F' ? p.sex : '',
        partners: partners(tree, scope, pid),
      };
      if (scope.siblingOf.has(pid)) {
        base.sibling_of = scope.siblingOf.get(pid);
        if (scope.halfSiblings.has(pid)) base.half_sibling = true;
      }
      if (scope.spouseOf.has(pid)) {
        const info = scope.spouseFamilies.get(pid) || {};
        base.spouse_of = scope.spouseOf.get(pid);
        base.divorced = Boolean(info.divorce);
        if (!info.marriage && !info.divorce) base.partnership = true;
      }
      if (scope.living.has(pid)) {
        out.set(pid, { ...base, town: has(livingTown, pid) ? livingTown[pid] : null });
        continue;
      }
      const death = p.events.find((x) => x.type === 'DEAT') || null;
      const birth = p.birth;
      const person = {
        ...base,
        town: townOf(places, birth ? birth.place : null),
        birth: fact(birth, places, lang),
        death: fact(death, places, lang) || (p.hasDeath ? { date: '', place: null } : null),
        documents: [],
        mentions: [],
        page: `person/${pid}.html`,
      };
      const occupations = p.occupations.map((o) => o.value + (o.date && o.date.year ? ` (${o.date.year})` : ''));
      if (occupations.length) person.occupations = occupations;
      if (death && death.cause) person.death_cause = death.cause;
      const age = gedcom.ageAtDeath(birth ? birth.date : null, death ? death.date : null, death ? death.age : '');
      if (age) person.death_age = ageText(age[0], age[1], t);
      const m = marriages(tree, scope, places, pid, lang);
      if (m.length) person.marriages = m;
      const lived = states ? states.personStates(tree, places, pid, defaultLanguage, scope.living) : [];
      if (lived.length) person.states = lived;
      out.set(pid, person);
    }
    return out;
  }

  function linkDocuments(people, evs, published) {
    const ids = new Set(published.map((d) => d.id));
    for (const ev of evs) ev.documents = (ev.documents || []).filter((x) => ids.has(x));
    for (const d of published) {
      const main = documents.mainPeople(d);
      for (const pid of d.people || []) {
        const field = main.includes(pid) ? 'documents' : 'mentions';
        const p = people.get(pid);
        if (p && !p.living && !p[field].includes(d.id)) p[field].push(d.id);
      }
      if (d.year === null || d.year === undefined) continue;
      for (const ev of evs) {
        if (ev.certainty === 'tree' && ev.year === d.year && ev.people.some((p) => (d.people || []).includes(p)) && !ev.documents.includes(d.id)) {
          ev.documents.push(d.id);
          ev.certainty = 'document';
        }
      }
    }
  }

  function perChronicle(evs, manualIds) {
    for (const ev of evs) {
      if (manualIds.has(ev.id) && (ev.certainty === 'document' || ev.certainty === 'tree') && !ev.documents.length) ev.certainty = 'chronicle';
    }
  }

  function withoutLiving(evs, living) {
    const out = [], changed = [];
    for (const ev of evs) {
      const people = ev.people.filter((p) => !living.has(p));
      if (people.length !== ev.people.length) changed.push(ev);
      if (ev.people.length && !people.length) continue;
      out.push({ ...ev, people });
    }
    return [out, changed];
  }

  // --- pages ------------------------------------------------------------------------------------------
  class Pages {
    constructor(writer, strings, staticFiles, dataPaths, branchInfo, languages, defaultLanguage, firstChapter, extraData) {
      Object.assign(this, { writer, strings, static: staticFiles, dataPaths, branchInfo, languages, defaultLanguage, firstChapter, extraData });
      this.public = [];
    }
    prefix(lang) { return lang === this.defaultLanguage ? '' : `${lang}/`; }
    scripts(names, root) {
      return [...names, 'settings.js'].filter((n) => has(this.static, n)).map((n) => `<script src="${root}${this.static[n]}" defer></script>`).join('\n');
    }
    css(root, css) {
      return ['branches.css', 'style.css', ...css, 'themes.css'].filter((n) => has(this.static, n)).map((n) => `<link rel="stylesheet" href="${root}${this.static[n]}">`).join('\n');
    }
    theme(root) { return has(this.static, 'theme.js') ? `<script src="${root}${this.static['theme.js']}"></script>` : ''; }
    modes(langRoot, active, t) {
      const items = [];
      if (this.firstChapter) items.push(['story', `story/${this.firstChapter}.html`, t.mode_story]);
      items.push(['timeline', 'map.html#timeline', t.mode_timeline], ['map', 'map.html#full-map', t.mode_map]);
      return items.map(([k, url, name]) => `<a href="${langRoot}${url}"` + (k === active ? ' aria-current="true"' : '') + `>${e(name)}</a>`).join('\n');
    }
    page(lang, rel, title, body, { bodyClass, scripts, data, nav = null, mode = null, modes = false, css = [], full = false }) {
      const t = this.strings[lang];
      const path = this.prefix(lang) + rel;
      const root = '../'.repeat(path.split('/').length - 1);
      const langRoot = root + this.prefix(lang);
      const alt = Object.fromEntries(this.languages.map((x) => [x, root + this.prefix(x) + rel]));
      const alternate = [...this.languages.map((x) => `<link rel="alternate" hreflang="${x}" href="${alt[x]}">`),
        `<link rel="alternate" hreflang="x-default" href="${alt[this.defaultLanguage]}">`].join('\n');
      const current = ' aria-current="page"';
      const sw = this.languages.filter((x) => x !== lang).map((x) => `<a class="language" href="${alt[x]}" hreflang="${x}" lang="${x}" `
        + `aria-label="${e(t.language_label)}">${e(this.strings[x].language_name)}</a>`).join('\n');
      const payload = { ...data, ...this.extraData, language: lang, root_path: root, lang_root: langRoot, languages: this.languages,
        data: this.dataPaths[lang], branches: this.branchInfo, strings: t };
      const html = templates.base({
        lang, title: e(title), alternate, css: this.css(root, css), theme: this.theme(root),
        body_class: bodyClass + (full ? ' full' : ''), nav_label: e(t.nav_label), root: langRoot,
        nav_home_url: 'index.html', nav_tree_url: 'tree.html', nav_map_url: 'map.html',
        nav_home: e(t.nav_home), nav_tree: e(t.nav_tree), nav_map: e(t.nav_map),
        nav_home_cur: nav === 'home' ? current : '', nav_tree_cur: nav === 'tree' ? current : '', nav_map_cur: nav === 'map' ? current : '',
        language_links: sw, modes_label: e(t.modes_label), modes: modes ? this.modes(langRoot, mode, t) : '',
        content: body, footer: full ? '' : `<footer>\n<p>${e(t.sources)}</p>\n</footer>`,
        data: text.jsonInHtml(payload), scripts: this.scripts(scripts, root),
      });
      this.writer.text(path, html);
      this.public.push(path);
    }
  }

  function branchCss(cfg) {
    const rules = cfg.branches.filter((b) => COLOR.test(b.color || '')).map((b) => `.branch-${b.key} { --branch: ${b.color}; }`);
    return text.utf8('/* generated from site.json */\n' + rules.join('\n') + '\n');
  }

  function branchCards(cfg, slugs, lang, t) {
    return cfg.branches.filter((b) => has(slugs, b.key)).map((b) => {
      const description = (t.branch_descriptions || {})[b.key] || '';
      return `<li class="branch-${e(b.key)}"><a href="story/${e(slugs[b.key])}.html">`
        + `<span class="name">${e(b.name[lang] || b.key)}</span><span class="description">${e(description)}</span></a></li>`;
    }).join('\n');
  }

  function peopleTable(people, cfg, lang, t, root) {
    const names = Object.fromEntries(cfg.branches.map((b) => [b.key, b.name[lang] || b.key]));
    names.common = t.branch_common; names.other = t.branch_other; names.spouses = t.branch_spouses;
    const order = ['common', ...cfg.branches.map((b) => b.key), 'other', 'spouses'];
    const groups = new Map();
    for (const [pid, p] of people) {
      const key = p.spouse_of ? 'spouses' : p.branch || 'other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([pid, p]);
    }
    const parts = [];
    for (const key of [...order, ...[...groups.keys()].filter((k) => !order.includes(k))]) {
      const members = [...(groups.get(key) || [])].sort((x, y) => (x[1].ahnentafel === null ? 1 : 0) - (y[1].ahnentafel === null ? 1 : 0)
        || (x[1].ahnentafel || 0) - (y[1].ahnentafel || 0) || cmp(x[1].name, y[1].name));
      if (!members.length) continue;
      const items = members.map(([pid, p]) => {
        let name = e(p.name);
        if (p.page) name = `<a href="${root}${p.page}">${name}</a>`;
        const note = p.living ? ` (${e(t.living_label)})` : '';
        return `<li id="${pid}">${name}${note} — ${e(p.relationship)}</li>`;
      });
      parts.push(`<section><h2>${e(has(names, key) ? names[key] : key)}</h2>\n<ul>\n${items.join('\n')}\n</ul></section>`);
    }
    return parts.join('\n');
  }

  function personDocuments(ids, docs, exports, lang, t, root, files) {
    return ids.map((did) => {
      const d = docs.get(did), ex = exports[did];
      const caption = (d.description || {})[lang] || d.id;
      let img = `<img src="${root}${ex.crop}" width="${ex.width}" height="${ex.height}" alt="${e(caption)}" loading="lazy">`;
      img = `<a href="${root}${ex.sheet || ex.crop}">${img}</a>`;
      const links = ex.sheet ? [`<a href="${root}${ex.sheet}">${e(t.full_sheet)}</a>`] : [];
      const verified = documents.isVerified(d, files);
      const note = verified ? '' : ` <span class="unverified-caption">${e(documents.unverifiedLabel(d, t))}</span>`;
      const cls = 'document' + (verified ? '' : ' unverified');
      return `<figure class="${cls}">${img}<figcaption>${e(caption)}${note}${links.length ? ' · ' + links.join(' ') : ''}</figcaption></figure>`;
    }).join('\n');
  }

  function statesHtml(lived, states, lang) {
    const parts = [];
    for (const [key] of lived) {
      if (parts.length && parts[parts.length - 1][0] === key) continue;
      const state = states.states[key];
      parts.push([key, `<span class="state"><img class="flag" src="${e(states.flagUri(state.flag))}" alt="" width="21" height="14"> ${e(state.name[lang])}</span>`]);
    }
    return parts.map(([, h]) => h).join(' → ');
  }

  function personPage(pid, p, people, chapters, docs, exports, lang, t, root, files, states) {
    const details = [];
    for (const [key, label] of [['birth', t.person_born], ['death', t.person_died]]) {
      const u = p[key];
      if (u && (u.date || u.place)) details.push(`<dt>${e(label)}</dt><dd>${e([u.date, u.place].filter(Boolean).join(', '))}</dd>`);
    }
    if (p.death_age) details.push(`<dt>${e(t.person_age)}</dt><dd>${e(p.death_age)}</dd>`);
    if (p.death_cause) details.push(`<dt>${e(t.person_cause)}</dt><dd>${e(p.death_cause)}</dd>`);
    for (const m of p.marriages || []) {
      const who = m.spouse ? people.get(m.spouse) : null;
      const parts = [who && who.page ? `<a href="${who.page.split('/').pop()}">${e(who.name)}</a>` : who ? e(who.name) : ''];
      for (const x of [m.date, m.place]) if (x) parts.push(e(x));
      details.push(`<dt>${e(t.person_marriage)}</dt><dd>${parts.filter(Boolean).join(', ')}</dd>`);
    }
    if (p.occupations) details.push(`<dt>${e(t.person_occupation)}</dt><dd>${e(p.occupations.join('; '))}</dd>`);
    if (p.states && states) details.push(`<dt>${e(t.person_states)}</dt><dd>${statesHtml(p.states, states, lang)}</dd>`);
    const parents = p.parents.filter((r) => people.get(r).page);
    const parentsHtml = parents.length ? `<p class="parents">${e(t.person_parents)}: ` + parents.map((r) => {
      const q = people.get(r);
      return `<a href="${q.page.split('/').pop()}">${e(q.name)}</a>`;
    }).join(', ') + '</p>' : '';
    const paragraphs = Object.values(chapters).filter((ch) => ch.personParagraphs.has(pid)).map((ch) => ch.personParagraphs.get(pid)).join('\n');
    const chronicle = paragraphs ? `<section class="from-chronicle"><h2>${e(t.person_from_chronicle)}</h2>\n${cleanHtml(paragraphs, t.table)}</section>` : '';
    let docsHtml = '';
    if (p.documents.length) docsHtml = `<section class="documents"><h2>${e(t.person_documents)}</h2>\n` + personDocuments(p.documents, docs, exports, lang, t, root, files) + '</section>';
    if (p.mentions.length) {
      docsHtml += `<details class="mentions"><summary>${e(pyFormat(t.person_mentions, { n: p.mentions.length }))}</summary>\n`
        + personDocuments(p.mentions, docs, exports, lang, t, root, files) + '</details>';
    }
    return templates.person({
      branch: e(p.branch || 'common'), name: e(p.name), relationship_heading: e(t.person_relationship), relationship: e(p.relationship),
      details: details.join('\n'), parents: parentsHtml, chronicle, documents: docsHtml,
      tree_only: p.documents.length || p.mentions.length ? '' : `<p class="tree-only">${e(t.tree_only)}</p>`,
      root, map_url: 'map.html', tree_url: 'tree.html', id: e(pid), on_map: e(t.person_on_map), back: e(t.person_back),
    });
  }

  function approvalText(scope, people, published, withheld, exports, changed, lang = 'en') {
    const r = ['# To approve before publishing', '', '## Living people (only name, relationship and town are published)', ''];
    const living = [...scope.living].sort((a, b) => {
      const x = people.get(a).ahnentafel, y = people.get(b).ahnentafel;
      return (x === null ? 1 : 0) - (y === null ? 1 : 0) || (x || 0) - (y || 0) || cmp(a, b);
    });
    for (const pid of living) {
      const p = people.get(pid);
      r.push(`- ${p.name} (${pid}) — ${p.relationship}, ${p.town || 'not given'}`);
    }
    r.push('', '## Published documents', '');
    for (const d of published) {
      const mark = d.verified ? '' : ' [UNVERIFIED]';
      r.push(`- ${d.id}${mark} — ${(d.description || {})[lang] || ''} (people: ${(d.people || []).join(', ') || '—'})`);
    }
    r.push('', '## Full sheets with addresses (to consider)', '', 'The whole sheet (not only a crop) is published and the document is from 1900 or later.', '');
    const sheets = published.filter((d) => exports[d.id] && exports[d.id].sheet && d.year !== null && d.year !== undefined && d.year >= 1900);
    for (const d of sheets) r.push(`- ${d.id} (${d.year}) — ${(d.description || {})[lang] || ''}`);
    if (!sheets.length) r.push('- none');
    r.push('', '## Manual events from which a living person was removed', '',
      'A living person was removed from the event (an event only about living people was dropped entirely).', '');
    for (const ev of changed) r.push(`- ${ev.id} (${ev.year}) — ${(ev.description || {})[lang] || ''}`);
    if (!changed.length) r.push('- none');
    r.push('', '## Withheld documents', '');
    for (const [d, reason] of withheld) r.push(`- ${d.id} — ${reason}`);
    return r.join('\n') + '\n';
  }

  // --- paths in the project ------------------------------------------------------------------------
  const dirOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i + 1); };
  function projectPath(baseDir, rel) {
    try {
      return documents.resolve(baseDir + rel);
    } catch (error) {
      throw new BuildError(`path outside the project folder: ${rel}`);
    }
  }
  function readJson(files, key, what) {
    if (!files.has(key)) throw new BuildError(`cannot read the ${what} ${key}: file not found`);
    try {
      return JSON.parse(text.fromUtf8(files.get(key)));
    } catch (error) {
      throw new BuildError(`cannot read the ${what} ${key}: ${error.message}`);
    }
  }
  const byParts = (a, b) => {
    const x = a.split('/'), y = b.split('/');
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return cmp(x[i], y[i]);
    return x.length - y.length;
  };
  function isoNow(now = new Date()) {
    return now.toISOString().replace(/\.\d{3}Z$/, '+00:00');
  }

  // --- main function -----------------------------------------------------------------------------------
  async function build({ files, configPath, assets, today, images, now }) {
    const locales = assets.locales;
    if (!files.has(configPath)) throw new BuildError(`cannot read the config ${configPath}: file not found`);
    const cfg = config.parse(text.fromUtf8(files.get(configPath)), locales);
    const baseDir = dirOf(configPath);
    const p = (key) => projectPath(baseDir, cfg[key]);
    const languages = [...cfg.languages], defaultLanguage = cfg.default_language;
    const warnings = [];

    let tree;
    const gedKey = p('gedcom');
    if (!files.has(gedKey)) throw new BuildError(`cannot read the GEDCOM: file not found: ${cfg.gedcom}`);
    try {
      tree = gedcom.load(files.get(gedKey));
    } catch (error) {
      throw new BuildError(`cannot read the GEDCOM: ${error.message}`);
    }
    if (tree.encoding === 'windows-1252 (fallback)') {
      warnings.push('Warning: the GEDCOM says ANSI but is not UTF-8; it was read as Windows-1252. If names look wrong '
        + '(ø instead of ř, è instead of č), export the file again as UTF-8.');
    }
    if (!tree.people.has(cfg.root)) throw new BuildError(`root ${cfg.root} is not in the GEDCOM`);
    const scope = scopeMod.determineScope(tree, cfg, today);
    const places = new placesMod.Places(readJson(files, p('places'), 'places file'), cfg.ignore_places || []);
    let states = null;
    if (cfg.states) {
      const key = p('states');
      if (!files.has(key)) throw new BuildError(`cannot read the states file ${cfg.states}: file not found`);
      let data;
      try { data = JSON.parse(text.fromUtf8(files.get(key))); } catch (error) { throw new BuildError(`cannot read the states file ${cfg.states}: ${error.message}`); }
      try { states = statesMod.load(data, languages); } catch (error) { throw new BuildError(error.message); }
    }
    let mapJson;
    try { mapJson = mapview.mapData(places.data, cfg); } catch (error) { throw new BuildError(error.message); }
    let privacyExt;
    try { privacyExt = privacy.localeExtensions(languages, locales, cfg.strings); } catch (error) { throw new BuildError(error.message); }
    const livingTown = cfg.living_town || {};
    const wrong = Object.entries(livingTown).filter(([, v]) => places.town(v) !== v).map(([k, v]) => `${k}: ${v}`).sort(cmp);
    if (wrong.length) throw new BuildError('living_town is not a canonical place from the places file: ' + wrong.join('; '));

    // chronicles: the branches that have one, in config order
    const chronicleFiles = new Map();
    const slugs = {};
    for (const b of cfg.branches) {
      if (!b.chronicle) continue;
      const key = projectPath(baseDir, b.chronicle);
      if (!files.has(key)) throw new BuildError(`branch ${b.key}: chronicle file not found: ${b.chronicle}`);
      const slug = chronicles.chapterSlug(key);
      if (slug === RESERVED_SLUG || chronicleFiles.has(slug)) throw new BuildError(`chronicle name ${text.pyRepr(slug)} is reserved or used twice`);
      chronicleFiles.set(slug, key);
      put(slugs, b.key, slug);
    }

    const rootPerson = tree.people.get(cfg.root);
    const rootFull = `${rootPerson.given} ${rootPerson.surname}`.trim() || 'N.N.';
    const givenWords = rootPerson.given.split(/\s+/).filter(Boolean);
    const rootGiven = givenWords.length ? givenWords[0] : rootFull;
    const chapterTitles = cfg.branches.filter((b) => has(slugs, b.key))
      .map((b) => [slugs[b.key], [slugs[b.key], Object.fromEntries(languages.map((l) => [l, b.name[l]]))]]);
    const strings = loadStrings(cfg, locales, rootGiven, rootFull, chapterTitles);

    // events
    // document paths are relative to the config's folder
    const projectFiles = new Map([...files].filter(([k]) => k.startsWith(baseDir)).map(([k, v]) => [k.slice(baseDir.length), v]));
    let manualEvents = [], allDocuments = [];
    try {
      if (cfg.events) manualEvents = events.manual(readJson(files, p('events'), 'events file'), places, languages);
      if (cfg.documents) {
        const docKey = p('documents');
        allDocuments = documents.loadDocuments(readJson(files, docKey, 'documents file'), projectFiles);
      }
    } catch (error) {
      if (error instanceof BuildError) throw error;
      throw new BuildError(error.message);
    }
    let manualChanged;
    [manualEvents, manualChanged] = withoutLiving(manualEvents, scope.living);
    const manualIds = new Set(manualEvents.map((x) => x.id));
    const eventsByLang = {};
    for (const lang of languages) {
      eventsByLang[lang] = [...events.fromGedcom(tree, scope, places, lang, languages), ...manualEvents.map((x) => ({ ...x }))];
    }
    if (places.missing.size) warnings.push('Warning: places missing from the places file (left off the map): ' + [...places.missing].sort(cmp).join('; '));

    const [published, withheld] = documents.decide(allDocuments, scope, projectFiles,
      has(cfg, 'documents_cutoff_year') ? cfg.documents_cutoff_year : documents.DEFAULT_CUTOFF_YEAR);

    const writer = new Writer();
    const exports = {};
    for (const d of published) {
      let ex;
      try { ex = await documents.exportDocument(d, projectFiles, images); } catch (error) { throw new BuildError(error.message); }
      for (const [k, v] of ex.files) writer.bytes(k, v);
      exports[d.id] = { crop: ex.crop, sheet: ex.sheet, width: ex.width, height: ex.height };
    }
    const docs = new Map(published.map((d) => [d.id, d]));
    const allowed = new Set(Object.values(exports).flatMap((ex) => [ex.crop, ex.sheet]).filter(Boolean).map((x) => x.replace(/^documents\//, '')));

    const peopleByLang = {}, dataPaths = {};
    for (const lang of languages) {
      const people = peopleJson(tree, scope, places, livingTown, strings[lang], lang, states, defaultLanguage);
      const evs = eventsByLang[lang];
      linkDocuments(people, evs, published);
      perChronicle(evs, manualIds);
      peopleByLang[lang] = people;
      dataPaths[lang] = { people: writer.data(`people-${lang}`, jsonBytes(people)), events: writer.data(`events-${lang}`, jsonBytes(evs)) };
    }
    const defaultEvents = eventsByLang[defaultLanguage];
    const lines = events.migrationLines(tree, scope, defaultEvents, places, livingTown);
    const shared = {
      lines: writer.data('lines', jsonBytes(lines)),
      places: writer.data('places', jsonBytes(Object.fromEntries(Object.entries(places.data).map(([n, m]) => [n, { coords: m.coords, country: m.country || {} }])))),
      documents: writer.data('documents', jsonBytes(Object.fromEntries([...docs].map(([did, d]) => [did, {
        description: d.description || {}, crop: exports[did].crop, sheet: exports[did].sheet, verified: documents.isVerified(d, projectFiles),
      }])))),
    };
    shared.map = writer.data('map', jsonBytes(mapJson));
    if (cfg.basemap) {
      const key = p('basemap');
      if (files.has(key)) shared.basemap = writer.data('basemap', files.get(key));
    }
    for (const lang of languages) Object.assign(dataPaths[lang], shared);

    // people supported by sources
    const defaultPeople = peopleByLang[defaultLanguage];
    const backed = new Set(defaultEvents.filter((x) => x.certainty === 'document').flatMap((x) => x.people));
    let verifiedCount = 0;
    for (const [pid, person] of defaultPeople) {
      if (tree.people.get(pid).hasSource || backed.has(pid)
        || (person.documents || []).some((d) => docs.has(d) && documents.isVerified(docs.get(d), projectFiles))) verifiedCount += 1;
    }

    // static files
    const staticPaths = {};
    for (const name of [...assets.static.keys()].sort(cmp)) {
      const i = name.lastIndexOf('.');
      staticPaths[name] = writer.hashed('static', i < 0 ? '' : name.slice(0, i), i < 0 ? name : name.slice(i + 1), assets.static.get(name));
    }
    staticPaths['branches.css'] = writer.hashed('static', 'branches', 'css', branchCss(cfg));
    const fontNames = [...assets.fonts.keys()].filter((n) => n.endsWith('.ttf')).sort(cmp);
    if (assets.fonts.has('OFL.txt')) fontNames.push('OFL.txt');
    for (const n of fontNames) writer.bytes(`static/fonts/${n}`, assets.fonts.get(n));

    const branchInfo = cfg.branches.map((b) => ({ key: b.key, name: b.name, color: has(b, 'color') ? b.color : null,
      chronicle: has(slugs, b.key) ? slugs[b.key] : null, map_chapter: has(b, 'map_chapter') ? b.map_chapter : null }));
    const firstChapter = chronicleFiles.size ? [...chronicleFiles.keys()][0] : null;
    const pages = new Pages(writer, strings, staticPaths, dataPaths, branchInfo, languages, defaultLanguage, firstChapter, {
      root: cfg.root, root_name: rootFull, final_town: has(livingTown, cfg.root) ? livingTown[cfg.root] : null,
      color_modes: ['branch', ...(states ? ['state'] : []), 'era', 'documented'],
      ...(states ? states.pageData() : {}),
    });

    const sensitive = [...privacy.sensitiveDates(tree, scope).values()].flat();
    const imagesCfg = (cfg.chronicle_images || []).map((x) => [...x]);
    const openHeadings = cfg.open_questions_headings || {};

    // chronicles; the marks of the app's draft ("[Fill in: …]") stay off the website, counted
    const marks = chronicles.fillPattern(locales);
    const fillIns = [];
    for (const key of chronicleFiles.values()) {
      const dir = key.slice(0, key.lastIndexOf('/') + 1), slug = chronicles.chapterSlug(key);
      for (const f of [key, ...languages.map((l) => `${dir}${slug}.${l}.md`)]) {
        if (!files.has(f) || fillIns.some((x) => x.file === f)) continue;
        const count = (text.fromUtf8(files.get(f)).match(marks) || []).length;
        if (count) fillIns.push({ file: f, count });
      }
    }
    const chapters = Object.fromEntries(languages.map((l) => [l, {}]));
    for (const lang of languages) {
      for (const [slug, key] of chronicleFiles) {
        const ch = chronicles.render(key, lang, sensitive, published, exports, files, {
          strings: strings[lang], rootUrl: '../'.repeat(lang === defaultLanguage ? 1 : 2), defaultLanguage, images: imagesCfg,
          ext: privacyExt, docFiles: projectFiles, fillPattern: marks,
        });
        ch.html = cleanHtml(ch.html, strings[lang].table);
        put(chapters[lang], slug, ch);
      }
    }

    for (const lang of languages) {
      const t = strings[lang];
      const people = peopleByLang[lang];
      const counts = { n: people.size, verified: verifiedCount };
      let paragraphs = t.intro.map((x) => `<p>${e(x)}</p>`).join('\n');
      paragraphs += `\n<p class="counts">${e(pyFormat(t.counts, counts))}</p>`;
      pages.page(lang, 'index.html', t.site_title, templates.home({
        title: e(t.intro_title), paragraphs, root: '', story_url: firstChapter ? `story/${firstChapter}.html` : 'tree.html',
        tree_url: 'tree.html', map_url: 'map.html', branches_heading: e(t.intro_branches), cards: branchCards(cfg, slugs, lang, t),
        intro_story: e(t.intro_story), intro_tree: e(t.intro_tree), intro_map: e(t.intro_map),
      }), { bodyClass: 'home', scripts: [], data: {}, nav: 'home' });
      pages.page(lang, 'tree.html', t.tree_title, templates.tree({
        ...templateStrings(t), counts_short: e(pyFormat(t.counts_short, counts)), branches: peopleTable(people, cfg, lang, t, ''),
      }), { bodyClass: 'tree', scripts: ['coloring.js', 'common.js', 'view.js', 'tree.js'], data: {}, nav: 'tree', css: ['tree.css'], full: true });
      pages.page(lang, 'fan.html', t.fan_title, templates.fan(templateStrings(t)),
        { bodyClass: 'fan', scripts: ['coloring.js', 'common.js', 'view.js', 'fan.js'], data: {}, nav: 'tree', css: ['tree.css', 'fan.css'], full: true });
      pages.page(lang, 'map.html', t.map_title, templates.map(templateStrings(t)),
        { bodyClass: 'map', scripts: ['common.js', 'film.js', 'map-draw.js', 'map-film.js'], data: {}, nav: 'map', mode: 'timeline', modes: true, css: ['map.css'], full: true });

      const openQuestions = [];
      for (const slug of chronicleFiles.keys()) {
        const baseCh = chapters[defaultLanguage][slug];
        let ch = chapters[lang][slug];
        if (ch.sections.length !== baseCh.sections.length) ch = baseCh;
        const chosen = chronicles.cutSections(ch, chronicles.openSectionIndexes(baseCh, openHeadings[defaultLanguage] || []));
        if (chosen.length) openQuestions.push([ch, chosen]);
      }
      const chapterLinks = (active) => {
        const items = [...chronicleFiles.keys()].map((s) => [s, chapters[lang][s].title]);
        if (openQuestions.length) items.push([RESERVED_SLUG, t.open_questions_title]);
        return items.map(([s, n]) => `<li><a href="${s}.html"` + (s === active ? ' aria-current="page"' : '') + `>${e(n)}</a></li>`).join('\n');
      };
      for (const slug of chronicleFiles.keys()) {
        const ch = chapters[lang][slug];
        pages.page(lang, `story/${slug}.html`, ch.title, templates.story({
          chapters_heading: e(t.story_chapters), chapters: chapterLinks(slug), chapter: ch.html, map_panel: e(t.map_panel),
        }), { bodyClass: 'story', scripts: ['common.js', 'film.js', 'map-draw.js', 'story.js'], data: { slug, sections: ch.sections }, mode: 'story', modes: true, css: ['map.css'] });
      }
      if (openQuestions.length) {
        const body = [`<h1>${e(t.open_questions_title)}</h1>`, `<p>${e(t.open_questions_intro)}</p>`];
        for (const [ch, chosen] of openQuestions) {
          body.push(`<h2><a href="${ch.slug}.html">${e(ch.title)}</a></h2>`);
          for (const [title, h] of chosen) body.push(`<h3>${e(title)}</h3>\n${h}`);
        }
        pages.page(lang, `story/${RESERVED_SLUG}.html`, t.open_questions_title,
          `<div class="story open-questions"><nav class="chapters" aria-label="${e(t.story_chapters)}"><ul>\n`
          + `${chapterLinks(RESERVED_SLUG)}\n</ul></nav>\n<article class="chronicle">\n` + body.join('\n') + '\n</article></div>',
          { bodyClass: 'story', scripts: [], data: {}, mode: 'story', modes: true });
      }
      for (const [pid, person] of people) {
        if (person.living) continue;
        const body = personPage(pid, person, people, chapters[lang], docs, exports, lang, t, '../'.repeat(lang === defaultLanguage ? 1 : 2), projectFiles, states);
        pages.page(lang, `person/${pid}.html`, person.name, body, { bodyClass: 'person', scripts: [], data: { person: pid } });
      }
    }

    // sitemap
    const baseUrl = cfg.base_url.replace(/\/+$/, '') + '/';
    const urls = [...pages.public].sort(cmp).map((x) => `<url><loc>${e(baseUrl + x)}</loc></url>`).join('\n');
    writer.text('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '\n</urlset>\n');

    // output check: always after everything is written
    const findings = privacy.checkOutput(writer.files, privacy.livingForCheck(tree, scope), cfg.check_exceptions || [], allowed, privacyExt);
    const siteDir = cfg.site_dir;
    const out = new Map();
    const manifestFiles = {};
    for (const rel of [...writer.files.keys()].sort(byParts)) {
      manifestFiles[`${siteDir}/${rel}`] = sha.sha256Hex(writer.files.get(rel));
      out.set(`${siteDir}/${rel}`, writer.files.get(rel));
    }
    const approval = approvalText(scope, defaultPeople, published, withheld, exports, manualChanged, defaultLanguage);
    const manifest = { files: manifestFiles, check: findings.length ? 'failed' : 'ok', created: isoNow(now) };
    out.set('approval.md', text.utf8(approval));
    out.set('manifest.json', text.utf8(JSON.stringify(manifest, null, 2)));
    return { ok: !findings.length, files: out, findings, warnings, approval, manifest, fillIns };
  }

  const api = { build, BuildError, pyJson, cleanHtml };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).build = api;
})(typeof window !== 'undefined' ? window : globalThis);
