# family-chronicle: rules for Claude Code

GEDCOM + Markdown chronicles -> static family website (tree, fan chart, migration map film,
chronicles, documents) and a PDF book. Living people are protected. Read `README.md` first and
`docs/data-format.md` before touching the build or the browser scripts.

## Run and test

```bash
.venv/bin/python -I -m unittest discover -s tests -t .      # Python tests
node --test tests/*.test.mjs                                # JS tests
.venv/bin/python -I build.py --config example/site.json --out /tmp/family-site --today 2026-11-23
PLAYWRIGHT_MODULES=<node_modules with playwright and axe-core> node tests/browser.mjs <url>   # optional
```

- Always run Python with `-I`; entry points add the repo to `sys.path` themselves.
- `--out` must be outside the config's folder. Never build into the repo. The build refuses an existing
  `<site_dir>` without a `manifest.json` next to it.
- Before saying "done", run the Python and JS test suites and a build of the example (it must end with `check ok`).

## Rules

- **No hard-coding.** No names, ids, places, years, colours, branch keys or URLs in code. If a
  value differs between families, it belongs in `site.json`, `places.json`, `events.json`,
  `documents.json` or `locales/<lang>.json`.
- **Every new field or special case gets a test**, including the ugly input that caused it
  (GEDCOM quirks go to `tests/data/`). Fix a bug by writing the failing test first.
- **Visual change = screenshot.** Look at the page before and after (1280x800 and a mobile width),
  and say what changed. A passing test does not show that a chart looks right.
- **The map knows no places of its own.** Camera bounds come from the build (`data/map.*.json`,
  `familychronicle/mapview.py`); region, town and ridge labels come from `map_labels` in `site.json`.
  Never add place names, coordinates or hand-drawn geography to `static/*.js` or the locales.
- **Locales are generic.** Texts that belong to one family (branch descriptions, chapter titles,
  intro) go to `strings` in that family's `site.json`, not to `locales/<lang>.json`. A language with
  other month names or birth words adds `privacy` to its locale file (see the README).
- **Never weaken privacy.** Do not lower `living_years` (the code refuses < 100), do not skip or
  bypass `check_output`, do not edit generated output to make the check pass. A finding means
  fixing the cause; a harmless string goes into `check_exceptions` in the config, with a reason in
  the commit message. The book defaults to `include_hidden: false` and must stay that way; in that mode its images go
  through the documents whitelist and its HTML through `check_output`. `include_hidden` must be a real boolean.
- **Keep `docs/data-format.md` in sync with the JS.** Changing a key, id, class or string in the
  build means changing the scripts, the CSS, the doc and the tests in the same commit. Every string
  key used by a script must exist in every `locales/<lang>.json` (`tests/js-strings.test.mjs`).
- **English identifiers** in code, JSON keys, CSS classes and file names. Czech is allowed only in
  `locales/cs.json`, in example chronicle translations and in month/relationship word tables
  (data, not identifiers).
- **Example data only is invented.** Never put real people, places, scan names or paths from a real
  family into this repo, its tests, its screenshots or its commit messages.
- Keep modules small and single-purpose. New behaviour goes into the module that owns the
  concern, or into a new module, not into `build.py` by default.
- Edit files, do not rewrite them. Do not add dependencies without a reason; Python deps are in
  `requirements.txt`, the browser scripts use no libraries.

## Commits

English, short subject, optional body. No `Co-Authored-By` or other footers. Do not amend or
force-push published commits.
