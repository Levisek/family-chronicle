# Data format of the generated site

The contract between the Python build (`familychronicle/build.py`) and the scripts in `static/`
(`common.js`, `film.js`, `map-draw.js`, `map-film.js`, `story.js`, `tree.js`, `fan.js`, `view.js`) and
style sheets (`style.css`, `tree.css`, `fan.css`, `map.css`). The scripts read only the keys, ids and
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
`<site_dir>` that has no `manifest.json` from a previous build next to it). The build replaces
`<site_dir>` only when that manifest exists. All paths in the config resolve against the config's folder,
including the paths inside `documents.json`. The default language lives at the site root, every other
language under `<lang>/`.

## Config keys read by the build (`site.json`)

| key | meaning |
|---|---|
| `root`, `gedcom`, `places`, `base_url`, `languages`, `default_language`, `site_dir`, `branches` | required |
| `events`, `documents`, `basemap` | optional files (relative to the config) |
| `branches[]` | `key` `[a-z0-9_-]+`, `name{lang: text}`, `color`, `roots[]`, optional `chronicle` (path to the default-language `.md`) |
| `ignore_places`, `living_town{id: town}`, `living_extra`, `deceased_extra`, `exclude`, `living_years`, `check_exceptions`, `documents_cutoff_year`, `documents_skip_dirs`, `open_questions_headings{lang: [headings]}` | see the README |
| `strings{lang: {key: value}}` | merged over `locales/<lang>.json`; nested objects (`chapters`, `branch_descriptions`) merge key by key |
| `map_labels` | optional `[{text{lang: text}, lat, lon, kind}]`, `kind` is `region`, `town` or `ridge` |
| `chronicle_images` | optional list of `[chapter slug, snippet, source, crop, caption]` for `<!-- img: -->` |

GEDCOM ids may be written `I1` or `@I1@` (`root`, `roots`, `living_extra`, `deceased_extra`, `exclude`,
`living_town` keys). `{root}` and `{root_full}` inside any string are replaced at build time by the root
person's given name and full name. Chapter names for a chronicle that has no entry in `chapters` are filled
in (`title` = chronicle title or slug, `short` = branch name, `subtitle` = "").

## Page data block

Every page has `<script type="application/json" id="data">`. Keys:

| key | meaning |
|---|---|
| `language` | page language |
| `root_path` | `""`, `"../"`, `"../../"` to the site root |
| `lang_root` | path to the root of the page's language version |
| `data` | paths of the JSON files below, relative to `root_path` |
| `branches` | list of `{key, name{lang}, color, chronicle(slug or null)}`, in config order |
| `strings` | the strings of the page language |
| `languages` | all configured language codes |
| `root` | root person id |
| `root_name` | root person's full name |
| `final_town` | `living_town[root]` or null |
| `slug`, `sections` | story pages: `sections` = `[{id, title, places[], people[]}]` |
| `person` | person pages: the person id |

## JSON files (`data` paths)

`data` = `{people, events, lines, places, documents, map, basemap?}` (`basemap` only when configured).
`people` and `events` are **per language** (`people-<lang>.<hash>.json`) because dates and relationship
texts are language specific; the page's `data` points at its own language.

**people**: `{id: person}`. Everyone in scope has: `name`, `relationship` (a plain string), `branch` (a
branch key, `common` or `other`), `living`, `ahnentafel`, `parents`, `sex` (`M`/`F`/`""`), `partners`
(values `spouse`/`divorced`/`partner`). Optional: `sibling_of`, `half_sibling`, `spouse_of`, `divorced`,
`partnership`. Living people additionally have only `town`. Deceased people also have: `town` (birth town),
`birth` and `death` as `{date, place}`, `documents`, `mentions`, `page` (`person/<id>.html`); optional
`occupations`, `death_cause`, `death_age` (string), `marriages` (items `{spouse, date, place}`).

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
| tree | `bar`, `bar-title`, `tabs`, `search`, `#search`, `#suggestions`/`.suggestions`, `tree-layer`, `#surface`, `#connectors`/`.connectors`, `#cards`/`.cards`, `#generations`/`.generations`, `.tools`, `#b-center`, `#b-all`, `#panel-close`/`.panel-close`, `#panel-content`, `.people-list`, `.page-sources` |
| fan | `fan-surface`, `#fan`/`.fan`, `#legend`/`fan-legend` |
| map | `canvas-wrap`, `#wrap`, `#canvas`, `paper-grain`, `vignette`, `cartouche`, `cartouche-text`, `cartouche-top`, `cartouche-sub` (also `#cartouche-sub`), `compass`, `compass-rings`, `compass-points`, `compass-points-minor`, `.light`, `.center`, `film-intro`, `film-intro-top`, `film-intro-sub`, `film-intro-buttons` (ids `#film-intro`, `#film-intro-sub` likewise), `btn-main`, `btn-text`, `#start`, `#full-map`, `chapter-title`/`#chapter-title`, `ct-number ct-heading ct-sub ct-years` (ids too), `#card`/`.card`, `controls`, `ctl-buttons`, `#b-prev`, `#b-play`/`.play`, `icon-play`/`icon-pause`, `#b-next`, `#timeline`/`.timeline`, `timeline-track timeline-thumb timeline-year timeline-bubble` (ids too), `#b-speed`, `#b-end` |
| story | `story`, `chapters`, `chronicle`, `#map`, `map-panel`, `#canvas`, `open-questions` |
| person | `person`, `relationship`, `parents`, `links`, `from-chronicle`, `documents`, `mentions`, `tree-only` |
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
and the button labels), person pages (`person_*`), the map and film (`map_*`, `film_*`, `player_*`,
`legend_*`, `card_*`, `end_*`), the person view (`view_*`), certainty labels (`certainty_*`), counts and
dates (`counts`, `counts_short`, `date_about`, `degrees_east`, `unit_km`, `compass_north`).

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

## Scripts, hash modes and browser storage

Browser globals: `window.Chronicle` (`common.js`: `D` page data, `T` strings, `el`, `loadData`, `localized`,
`personLink`, `magnifier`, ...; `view.js` adds `Chronicle.view`), `window.Film` (`film.js`, a pure function
`Film.build(data, {branches, strings, language, person?})`; also `module.exports` for Node tests) and
`window.ChronicleMap` (`map-draw.js`, the canvas engine, created with
`create(canvas, {basemap, map, places, language, strings})`; also `module.exports`).

- The order of the film's chapters is the order of the page data's `branches`. The texts of a chapter come from
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
