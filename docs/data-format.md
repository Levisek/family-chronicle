# Data format of the generated site

The contract between the Python build (`familychronicle/build.py`) and the scripts in `static/`
(`coloring.js`, `common.js`, `film.js`, `map-draw.js`, `map-film.js`, `story.js`, `tree.js`, `fan.js`, `view.js`,
`theme.js`, `settings.js`) and style sheets (`style.css`, `tree.css`, `fan.css`, `map.css`, `themes.css`). The scripts read only the keys, ids and
classes described here. `tests/js-strings.test.mjs` checks that every string key the scripts use exists in
every `locales/<lang>.json`; `tests/contract.test.mjs` checks the document keys.

`python -I build.py --config example/site.json [--out DIR] [--today YYYY-MM-DD]`

## Output layout

```
DIR/<site_dir>/            the website (nothing in it is uploaded by the build)
  index.html tree.html fan.html map.html sitemap.xml
  story/<slug>.html        one per branch with a `chronicle`; slug = chronicle file name up to the first dot
  story/open-questions.html  only when a chronicle has "open question" sections
  person/<id>.html         deceased people only
  <lang>/...               the same tree for every language except `default_language`
  data/*.<hash8>.json      see below
  static/*.<hash8>.js|css  copies of static/ with a content hash, plus branches.<hash8>.css
  static/fonts/            fonts and OFL.txt
  documents/<id>-<hash8>.webp, <id>-sheet-<hash8>.webp   published document crops and sheets
DIR/manifest.json          {"files": {"<site_dir>/path": sha256}, "check": "ok"|"failed", "created": iso}
DIR/approval.md            what to read before publishing
```

Exit code: 0 ok, 1 input problem or output check finding (the manifest then says `"check": "failed"`),
2 refused output (filesystem root, home, the config folder, anything inside or above it, or an existing
`<site_dir>` that has no `.family-chronicle-output` marker from a previous build next to it; a
`manifest.json` alone does not count, the name is common). The build replaces `<site_dir>` only when
that marker exists. All paths in the config resolve against the config's folder,
including the paths inside `documents.json`. The default language lives at the site root, every other
language under `<lang>/`.

## Config keys read by the build (`site.json`)

| key | meaning |
|---|---|
| `root`, `gedcom`, `places`, `base_url`, `languages`, `default_language`, `site_dir`, `branches` | required |
| `events`, `documents`, `basemap`, `states` | optional files (relative to the config); `states` is the file of historical states, see below |
| `branches[]` | `key` `[a-z0-9_-]+`, `name{lang: text}`, `color`, `roots[]`, optional `chronicle` (path to the default-language `.md`), optional `map_chapter` (key of another branch, see below) |
| `ignore_places`, `living_town{id: town}`, `living_extra`, `deceased_extra`, `exclude`, `living_years`, `check_exceptions`, `documents_cutoff_year`, `documents_skip_dirs`, `open_questions_headings{lang: [headings]}` | see the README |
| `strings{lang: {key: value}}` | merged over `locales/<lang>.json`; nested objects (`chapters`, `branch_descriptions`) merge key by key |
| `map_labels` | optional `[{text{lang: text}, lat, lon, kind}]`, `kind` is `region`, `town` or `ridge` |
| `chronicle_images` | optional list of `[chapter slug, snippet, source, crop, caption]` for `<!-- img: -->` |

GEDCOM ids may be written `I1` or `@I1@` (`root`, `roots`, `living_extra`, `deceased_extra`, `exclude`,
`living_town` keys). `{root}` and `{root_full}` inside any string are replaced at build time by the root
person's given name and full name. Chapter names for a chronicle that has no entry in `chapters` are filled
in (`title` = chronicle title or slug, `short` = branch name, `subtitle` = "").

`branches[].map_chapter`: the key of another branch. The film on the map gives every branch its own chapter;
a branch with `map_chapter` has none, its stops and legs join the chapter of that branch (and take its colour).
The target must be another branch that has no `map_chapter` itself (no chains), otherwise the build stops. The
chapter of the target exists even when only the joining branch has events. Branch cards, the tree and the fan
chart are not affected.

## States file (`states` in `site.json`)

Optional. Describes the historical states a person lived in, so that the tree and the fan chart can show flags and
colour people by the state of their birth. All of it is data of the family; the scripts know no state.

```json
{"flags":   {"<flag key>": {"stripes": ["#rrggbb", ...], "direction": "horizontal" | "vertical",
                             "hoist_triangle": "#rrggbb", "color": "#rrggbb"}},
 "states":  {"<state key>": {"name": {"<lang>": "..."}, "flag": "<flag key>"}},
 "regions": {"<region>": [[from_year, "<state key>"], ...]}}
```

- `flags`: 1 to 6 `stripes` (`direction` defaults to `horizontal`), an optional triangle at the hoist and an optional
  `color` (the colour of the flag in the colour mode "state"; without it the build spreads hues evenly). Flags are
  simplified and drawn by the build as small SVG data URIs.
- `states`: `name` needs a text for every configured language; a name should not contain years (the page adds them).
  States with the same flag share its colour and are listed together in the legend.
- `regions`: each entry is a timeline, `[from_year, state]` valid until the next entry; the years are strictly
  increasing and may carry a fraction (`1918.82` = late October 1918).
- A place belongs to the region named by its `region` entry in `places.json`, otherwise to the region named like its
  country in the default language. A place without a region adds nothing.

Per person the build works out `states` (below) from the dated events (birth, death, burial, marriage, divorce) and
the places of the person, only for deceased people; a marriage with a living partner is left out. Between two events
the person is in the region of the earlier one; an event without a place carries on in the previous region. Equal
neighbouring states are merged. A broken file (missing language, unknown flag or state, years out of order) stops
the build with a message.

## Page data block

Every page has `<script type="application/json" id="data">`. Keys:

| key | meaning |
|---|---|
| `language` | page language |
| `root_path` | `""`, `"../"`, `"../../"` to the site root |
| `lang_root` | path to the root of the page's language version |
| `data` | paths of the JSON files below, relative to `root_path` |
| `branches` | list of `{key, name{lang}, color, chronicle(slug or null), map_chapter(key or null)}`, in config order |
| `strings` | the strings of the page language |
| `languages` | all configured language codes |
| `root` | root person id |
| `root_name` | root person's full name |
| `final_town` | `living_town[root]` or null |
| `slug`, `sections` | story pages: `sections` = `[{id, title, places[], people[]}]` |
| `person` | person pages: the person id |
| `color_modes` | the colour modes the page offers, in the order of the settings panel: `branch`, `state` (only with a states file), `era`, `documented` |
| `states` | only with a states file: `{state key: {name{lang}, flag}}` |
| `flags` | only with a states file: `{flag key: {src (data URI), color}}` |

`branches` also carry `map_chapter` (key or `null`).

## JSON files (`data` paths)

`data` = `{people, events, lines, places, documents, map, basemap?}` (`basemap` only when configured).
`people` and `events` are **per language** (`people-<lang>.<hash>.json`) because dates and relationship
texts are language specific; the page's `data` points at its own language.

**people**: `{id: person}`. Everyone in scope has: `name`, `relationship` (a plain string), `branch` (a
branch key, `common` or `other`), `living`, `ahnentafel`, `parents`, `sex` (`M`/`F`/`""`), `partners`
(values `spouse`/`divorced`/`partner`). Optional: `sibling_of`, `half_sibling`, `spouse_of`, `divorced`,
`partnership`. Living people additionally have only `town`. Deceased people also have: `town` (birth town),
`birth` and `death` as `{date, place}`, `documents`, `mentions`, `page` (`person/<id>.html`); optional
`occupations`, `death_cause`, `death_age` (string), `marriages` (items `{spouse, date, place}`), `states`
(`[[state key, year_from, year_to], ...]`, only with a states file and only when a region is known; never for the
living, because a state at a given time would give away their age).

**events**: `id, type, year, date, place, branch, people, description{lang}, documents, certainty`. `description`
has a text for every configured language. Types `birth marriage death burial move war transport other`,
certainty `document tree chronicle uncertain`. Event ids `<type>-<personId>`, `marriage-<familyId>`.

**lines**: `[{branch, from, to, points [[lat, lon, year, certainty], ...]}]`.

**places**: `{town: {coords [lat, lon], country {lang: name}}}`.

**documents**: `{id: {description{lang}, crop, sheet, verified}}`; `crop`/`sheet` are paths relative to the
site root (`documents/...`; `sheet` may be null); `verified` is a boolean.

**map**: `{bounds, labels}`. `bounds` = `[south, west, north, east]` in degrees: the bounding box of all
places plus a margin (25 % of the span, at least 1 degree), clamped to latitude +-80; `null` when there are
no places (the camera is then limited only by the Mercator world). `map-draw.js` limits and frames the
camera with it. `labels` = the validated `map_labels` of the config (`[]` when none): `region` is drawn as
spaced capitals, `ridge` as small italic capitals, `town` as a dot with a name that is hidden near a family
place. The text is `{lang: text}`; the script picks the page language or any available one.

**basemap**: the GeoJSON; the layer property is `layer` with `land lakes borders rivers`.

## URLs and fragments

`index.html`, `tree.html`, `fan.html`, `map.html`, `story/<slug>.html`, `story/open-questions.html`,
`person/<id>.html`; every language except `default_language` has the same tree under `<lang>/`.
Map fragments: `map.html#timeline`, `map.html#full-map`, `map.html#person=<id>`.

## HTML hooks (ids and classes the JS and CSS use)

Branch colours: `.branch-<key> { --branch: ... }` in `static/branches.<hash>.css`. Body classes: `home tree fan
map story person full`.

| template | ids and classes |
|---|---|
| base | `main`, `modes`, `language` (links, one per other language) |
| tree | `bar`, `bar-title`, `tabs`, `search`, `#search`, `#suggestions`/`.suggestions`, `tree-layer`, `#surface`, `#bands`/`.bands` (`.band`, `.odd`), `#connectors`/`.connectors`, `#cards`/`.cards` (`.path` while a path is marked; `.pcard.on-path`), `#generations`/`.generations` (`.gen-label`, with `<small>` for the birth years of the row), `#legend`/`.tree-legend`, `#minimap`/`.minimap`, `.flags` (flags on a card), `.p-states`, `.tools`, `#b-center`, `#b-all`, `#panel-close`/`.panel-close`, `#panel-content`, `.people-list`, `.page-sources` |
| fan | `fan-surface`, `#fan`/`.fan`, `#legend`/`fan-legend`, `.flag` (flag images inside the chart), `.states` (flags in the bubble) |
| legend (tree and fan) | `.mode` (the line "Colours: mode"), `ul > li`, `.swatch`, `.flag`, `.scale` with `.gradient`; in the branch mode `li.branch-<key>` |
| settings (every page) | `.settings-toggle` (the gear in the header), `#settings-panel`/`.settings-panel`, `.settings-themes`, `.settings-theme` (`data-theme`, `aria-checked`) with `.sample`, `#settings-colors` (select), `.settings-heading`, `.settings-note` |
| map | `#b-card` (hides the stop card on a phone; sets `body.card-hidden`), `canvas-wrap`, `#wrap`, `#canvas`, `paper-grain`, `vignette`, `cartouche`, `cartouche-text`, `cartouche-top`, `cartouche-sub` (also `#cartouche-sub`), `compass`, `compass-rings`, `compass-points`, `compass-points-minor`, `.light`, `.center`, `film-intro`, `film-intro-top`, `film-intro-sub`, `film-intro-buttons` (ids `#film-intro`, `#film-intro-sub` likewise), `btn-main`, `btn-text`, `#start`, `#full-map`, `chapter-title`/`#chapter-title`, `ct-number ct-heading ct-sub ct-years` (ids too), `#card`/`.card`, `controls`, `ctl-buttons`, `#b-prev`, `#b-play`/`.play`, `icon-play`/`icon-pause`, `#b-next`, `#timeline`/`.timeline`, `timeline-track timeline-thumb timeline-year timeline-bubble` (ids too), `#b-speed`, `#b-end` |
| story | `story`, `chapters`, `chronicle`, `#map`, `map-panel`, `#canvas`, `open-questions` |
| person | `person`, `relationship`, `parents`, `links`, `from-chronicle`, `documents`, `mentions`, `tree-only`, `.state` and `.flag` (the "Historical states" row) |
| home | `intro-text`, `branch-cards`, `.branch-list`, `.name`/`.description`, `#branches-h`, `.counts` |
| chronicles | `anchor`, `uncertain`, `untranslated`, `document unverified`, `unverified-caption`, `note-documents` |
| tables | `table-wrap`, `align-<x>` |

## Strings (`locales/<lang>.json`)

One file per language; every language file has the same keys (`tests/test_build.py` checks `en` and `cs`).
`language_name` is the language's own name. Placeholders are `{name}`, `{list}`, `{relationship}`, `{what}`,
`{value}`, `{verified}`, `{n}` and `{x}`; `{root}` / `{root_full}` never reach the JS (replaced at build
time). Strings are generic: texts that belong to one family (branch descriptions, chapter titles, an intro)
come from `strings` in `site.json`.

Groups: navigation and view modes (`nav_*`, `mode_*`, `tab_*`), the fan chart (`fan_*`), the tree (`tree_*`
and the button labels), person pages (`person_*`, with `person_states`), the map and film (`map_*`, `film_*`,
`player_*`, `legend_*`, `card_*`, `end_*`), the person view (`view_*`), certainty labels (`certainty_*`), the settings
panel (`settings_*`, `theme_chronicle`, `theme_night`, `theme_atlas`), the colour legend (`colors_label`,
`color_mode_branch|state|era|documented`, `color_documented_yes|no`, `color_living`, `color_state_unknown`,
`color_era_unknown`), counts and dates (`counts`, `counts_short`, `date_about`, `degrees_east`, `unit_km`,
`compass_north`). `settings.js` and `coloring.js` build some keys at run time (`theme_<theme>`,
`color_mode_<mode>`); `tests/js-strings.test.mjs` checks them.

Nested keys:

- `roles`, `roles_of`: `father mother son daughter brother sister husband wife former_husband former_wife
  partner partner_f`.
- `event_types`: `birth death burial marriage move transport war other`.
- `chapters`: entries `{title, short, subtitle}` keyed by chronicle slug; `epilogue` has `title` and `subtitle`
  (no `short`).
- `branch_descriptions`: keyed by branch key; empty in the shipped locales.
- `generations_up`, `generations_down`: generation labels.
- age strings, inflected in Python: `age_year`, `age_years_few` (2-4), `age_years`, `age_under_year`, `age_about`.

Optional, used only by the build and never sent to the browser: `privacy` =
`{"months": [12 lists of month spellings], "birth_prefixes": ["geb.", ...]}`. Redaction and `check_output`
treat these like the built-in Czech and English month names and "born" words, for every configured language.

## Themes, settings and colour modes

- `theme.js` is loaded in `<head>` **without** `defer` and sets `<html data-theme="night|atlas">` from
  `localStorage` before the page is painted; the default Chronicle look has no attribute. `themes.css` is the last
  style sheet of every page and only overrides (panel, Night and Atlas); print is always Chronicle.
- `settings.js` (last script of every page, no dependency on `common.js`) puts the gear button and the panel into the
  `<header>`: the theme as a radio group and the colour mode as a select (only the modes of `color_modes`).
- Storage: `chronicle.theme` (`chronicle`, `night` or `atlas`) and `chronicle.colors` (`branch`, `state`, `era`,
  `documented`). The colour mode may also come from the address, `#colors=<mode>`, which wins over the stored one.
- Events on `window`: `chronicle:theme` (detail: the theme) and `chronicle:colors` (detail: the mode, sent by the panel;
  the tree and the fan chart listen), `chronicle:colors-changed` (sent by the tree or the fan chart after they
  stored a mode, so that the panel follows).
- `coloring.js` (pure; `window.Coloring`, `module.exports` for Node tests) holds the modes: `branch` (the branch
  colour), `state` (the colour of the flag of the first state), `era` (birth year on a warm-to-cool scale over the
  range of the deceased), `documented` (has documents or not). The living get one neutral colour in every mode but
  `branch`. Only the tree and the fan chart load it (before `common.js`). The legend only says which mode is on.
- Tree: bands per generation, the span of birth years in the generation label, a path from the selected person to
  the root (ancestors in the line; for a sibling through the shared parents, for a partner through the spouse), and a
  minimap that appears on wide screens when the tree does not fit.

## Scripts, hash modes and browser storage

Browser globals: `window.Chronicle` (`common.js`: `D` page data, `T` strings, `el`, `loadData`, `localized`,
`personLink`, `magnifier`, `flagsOf`, `flagsEl`, `colors` (tree and fan only), ...; `view.js` adds `Chronicle.view`),
`window.Coloring` (`coloring.js`), `window.Film` (`film.js`, a pure function
`Film.build(data, {branches, strings, language, person?})`; also `module.exports` for Node tests) and
`window.ChronicleMap` (`map-draw.js`, the canvas engine, created with
`create(canvas, {basemap, map, places, language, strings})`; also `module.exports`).

- The order of the film's chapters is the order of the page data's `branches` (a branch with `map_chapter` is
  skipped: its stops join the chapter of the branch it names; `Film.chapterBranch(branches, key)` resolves it). The texts of a chapter come from
  `strings.chapters[<chronicle slug>]`; a branch without a chronicle (or without an entry) uses its name.
  The epilogue uses `strings.chapters.epilogue`. Chapter numbers are Roman numerals without an upper limit.
- `map.html` hash modes: `#timeline` (intro), `#full-map`, `#person=<id>` (the film of one person),
  `#stop=<n>` (open a stop), `#stop=<n>&drawing=<0..1>` (pause in the middle of drawing; for screenshots and tests).
  `tree.html` and `fan.html` accept `#person=<id>` (select) and `?from=<id>` / `#from=<id>`.
- The person view ("From: ...") remembers the chosen person in `localStorage` under `chronicle.from`; the first
  visit shows a "Who are you?" dialog. It recomputes relationship words in the browser, in English, or in Czech for
  the `cs` locale (other languages get the English words, as in `relationship.py`).
- `date_about`: `locales/<lang>.json` has `date_about` ("about", "kolem"), the word the date text starts with when
  the date is approximate; the tree shows an approximation mark before such years.
- Test hook: `window.__tree` on the tree page (used by browser tests, never read by the scripts).
- `<body data-phase>` on the map page is `intro`, `flight`, `drawing`, `stop` or `end`; `#card[data-stop]` is the
  open stop; `#map[data-center]` on a story page is the centre of the map panel.

## Engine API (`engine/*.js`)

The JS port of the build (offline app, phase 1). Classic scripts without imports: in the browser
`window.FCEngine.<module>`, in Node `module.exports`. The core touches no disk, DOM or network.

```js
const result = await FCEngine.build.build({
  files,       // Map<string, Uint8Array>: the project folder, keys relative to it with "/"
  configPath,  // key of site.json in `files`; other paths in the config resolve against its folder
  assets: { static, fonts, locales },  // Map of static/*, Map of fonts/*, {lang: locales/<lang>.json}
  today,       // Date for the living-people rule
  images,      // ImageAdapter, see below
});
// result = {ok, files, findings, warnings, approval, manifest, fillIns}
//   fillIns: [{file, count}] the "[Fill in: …]" marks left in the chronicles (their sentences are
//   left off the website)
//   files: Map with "<site_dir>/...", "manifest.json", "approval.md"
//   ok === false when the output check found something (manifest.check === "failed")
```

Errors in the input throw `FCEngine.config.BuildError` with the same messages as `build.py`.
The output check always runs; no option turns it off, and `living_years` below 100 is refused.

**ImageAdapter** turns a scan into a WebP without metadata:

```js
{ async toWebp(bytes, mime, crop /* [x0, y0, x1, y1] or null */, maxSize, quality)
    -> { data: Uint8Array, width, height } }
```

`width`/`height` are the output size (`FCEngine.documents.fitSize` gives Pillow's thumbnail size).
Crops use 1400 px and quality 80, whole sheets 2600 px and 75. PDF sources are refused with a hint
to save the page as an image.

**`check_exceptions`** entries may be a string or `{"text": "...", "reason": "..."}`; the reason is
required (the Python build accepts strings only).

`engine/templates.js` is generated from `templates/*.html` by `node tools/make-templates.mjs`,
`engine/entities.js` from Python's HTML entity table by `tools/make_entities.py`. The golden
outputs of the Python build are in `tests/golden/` (`tests/golden/make_golden.py`);
`tests/engine/parity.test.mjs` compares the JS build of `example/` with them.

## Offline app (`Family Chronicle.html`, `app/`)

The app opens from disk (`file://`): no server, no `fetch` of its own files, no Workers, no ES
modules. Classic scripts register `window.FCApp.<module>`; the engine modules above are loaded in
dependency order by `Family Chronicle.html`. CSP: `default-src 'self'; img-src 'self' data: blob:;
connect-src https://nominatim.openstreetmap.org; style-src 'self'; script-src 'self'`. Data from a
GEDCOM or a family folder goes into the DOM only as text (`FCApp.dom.h`), never as HTML.

**Generated data** (committed; regenerate after changing the sources):

| File | Global | Made by | From |
|---|---|---|---|
| `app/data/assets.js` | `FC_ASSETS = {static, fonts, locales}` (base64) | `node tools/make-app-data.mjs` | `static/`, `fonts/`, `locales/` |
| `app/data/example.js` | `FC_EXAMPLE = {path: base64}` | `node tools/make-app-data.mjs` | `example/` |
| `app/data/gazetteer.js` | `FC_GAZ = {names, index, admin1, countries, countryNames}` | `node tools/gazetteer.mjs <dir>` | GeoNames dump (CC BY 4.0) |
| `app/data/world.js` | `FC_WORLD = {land, lakes, borders, rivers}` | `node tools/world.mjs <dir>` | Natural Earth 50m |

`node tools/make-app-data.mjs --check` exits 1 when the first two are out of date (the tests run it).
The gazetteer and the world map are loaded only in the Places step.

**The family folder** (what the app reads and writes):

```
family.ged        the last GEDCOM loaded in the wizard
site.json         as above; the wizard writes root, branches, languages, living rules, base_url
places.json       {town: {coords, country, aliases, source}}
basemap.geojson   the basemap cropped to the places (engine/basemap.js, margin 2 degrees)
chronicles/<key>.md, <key>.<lang>.md   the chronicles; the app makes a draft and edits them
chronicles/.versions/<key>[.<lang>]-<YYYY-MM-DD-HHMMSS>.md   the text before every save
documents/, documents.json, events.json   as before (documents get edited in phase 4)
AGENTS.md         notes for an AI assistant with access to the folder; written once, never replaced
history/<YYYY-MM-DD-HHMMSS>/   copies of the files the wizard is about to overwrite (site.json,
                  places.json, family.ged, the basemap, documents.json, chronicles)
web/              the built website: web/<site_dir>/, web/manifest.json, web/approval.md,
                  web/.family-chronicle-output (marker)
```

- `places.json` entries get `"source": "gedcom" | "gazetteer" | "online" | "manual"`; the build
  ignores it. Order of lookup: places.json as it is, `PLAC`/`MAP`/`LATI`/`LONG` in the GEDCOM
  (`tree.placeCoords`), the gazetteer, then Nominatim only after a click (only the place string,
  at most one request a second), then a choice from candidates or a click into the map.
  Several equal matches are never picked automatically.
- **A newer GEDCOM** (step 1 when the family already has one): `engine/match.js` pairs the people.
  Same id + same name + same birth year = the same person; otherwise the name without diacritics,
  the birth year within 2 years and, among several, the parents' names. One candidate is taken;
  several or none become a question, only for ids the family uses (root, branch roots,
  `living_extra`, `deceased_extra`, `exclude`, `living_town`, `people`/`main` of documents,
  `<!-- person -->` in chronicles (`chronicles/*.md` and each branch's `chronicle` with its
  translations), `people` of events.json; `@I5@` counts as `I5`). The person
  confirms the answers with one button; one new person cannot answer two questions. Then
  `match.remap` moves all of them to the new ids. An id without a pair is dropped, except in a
  document's `people`, where it stays as `?<old id>` so the document is held back until it is linked
  again; a branch left without roots is removed (and a `map_chapter` to it), and the overview says
  so. Then `match.changes` lists added and gone people, changed birth and
  death dates, new places and who now counts as living or deceased.
- **Chronicle draft** (`engine/skeleton.js`): the ancestors of a branch by generations, one
  paragraph a couple with `<!-- person -->` and `<!-- place -->`, sentences from
  `locales/<lang>.json` > `skeleton` (a language without it gets a list of facts). A missing date or
  place is `[<skeleton.fill_in>: <what>]`, e.g. `[Fill in: birthplace]`. Living people: name and
  relation only. `skeleton.refresh` puts a new draft over a chronicle: a block that still has a mark
  and was not written in is replaced; in one that was, only the sentences with a mark get their
  filled-in form; blocks without a mark stay; people not in it yet go to the end. `skeleton` is removed from
  the strings sent to the website.
- **AI request** (`engine/aiprompt.js`): instructions (app texts), facts of the branch (deceased
  with dates and places; living people name and relation only, also as children and partners)
  and the current text redacted like the website. The app only shows it for copying.
- The app writes only under `web/` for a build. A `web/<site_dir>/` without `web/manifest.json` and
  without the marker is never replaced (`engine/output.js`). A failed check writes nothing.
- `check_exceptions` added in the app are always `{"text", "reason"}`; the reason is required.
- Chrome/Edge save into the folder (File System Access; the handle is remembered in IndexedDB
  `fc-app`). Firefox/Safari keep the family in IndexedDB (`fc-app`, store `projects`) and download
  the website and a backup as ZIP files (`engine/zip.js`, STORE); every change that is only in the
  browser shows a warning with "Download a backup".
