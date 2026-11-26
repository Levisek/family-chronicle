// Site configuration (site.json): parse, normalise GEDCOM ids (with or without @) and check it
// like familychronicle/config.py together with build.py's _check_config. `living_years` is
// checked here too (an integer >= 100).
(function (g) {
  'use strict';

  const req = typeof require !== 'undefined';
  const scope = req ? require('./scope.js') : g.FCEngine.scope;
  const text = req ? require('./text.js') : g.FCEngine.text;

  class BuildError extends Error {
    constructor(message) { super(message); this.name = 'BuildError'; }
  }

  const KEY = /^[a-z0-9_-]+$/;
  const SITE_DIR = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  const REQUIRED = ['root', 'gedcom', 'base_url', 'languages', 'default_language', 'site_dir', 'branches', 'places'];
  const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const ref = (v) => (typeof v === 'string' ? v.trim().replace(/^@+|@+$/g, '') : v);

  // `json` is the text of site.json or the parsed object; `locales` ({lang: object}) lets the
  // check refuse a language without a strings file.
  function parse(json, locales) {
    let data;
    try {
      data = typeof json === 'string' ? JSON.parse(json) : JSON.parse(JSON.stringify(json));
    } catch (error) {
      throw new BuildError(`cannot read the config: ${error.message}`);
    }
    if (!isObject(data)) throw new BuildError('cannot read the config: it must be an object');
    if ('root' in data) data.root = ref(data.root);
    for (const key of ['living_extra', 'deceased_extra', 'exclude']) if (Array.isArray(data[key])) data[key] = data[key].map(ref);
    if (isObject(data.living_town)) data.living_town = Object.fromEntries(Object.entries(data.living_town).map(([k, v]) => [ref(k), v]));
    if (Array.isArray(data.branches)) {
      data.branches = data.branches.map((b) => (isObject(b) && Array.isArray(b.roots) ? { ...b, roots: b.roots.map(ref) } : b));
    }
    check(data, locales);
    return data;
  }

  function check(cfg, locales) {
    const missing = REQUIRED.filter((k) => !(k in cfg));
    if (missing.length) throw new BuildError(`config is missing: ${missing.join(', ')}`);
    if (typeof cfg.site_dir !== 'string' || !SITE_DIR.test(cfg.site_dir) || cfg.site_dir === '.' || cfg.site_dir === '..') {
      throw new BuildError(`site_dir must be a plain folder name, not ${text.pyRepr(cfg.site_dir)}`);
    }
    const languages = cfg.languages;
    if (!Array.isArray(languages) || !languages.length || !languages.every((x) => typeof x === 'string' && KEY.test(x))) {
      throw new BuildError('languages must be a list of codes such as ["en", "cs"]');
    }
    if (!languages.includes(cfg.default_language)) throw new BuildError('default_language must be one of languages');
    if (locales) {
      for (const lang of languages) {
        if (!Object.prototype.hasOwnProperty.call(locales, lang)) throw new BuildError(`no strings file locales/${lang}.json for language ${lang}`);
      }
    }
    const keys = [];
    for (const b of cfg.branches) {
      if (typeof b.key !== 'string' || !KEY.test(b.key)) throw new BuildError(`branch key must match [a-z0-9_-]+: ${text.pyRepr(b.key)}`);
      if (!isObject(b.name)) throw new BuildError(`branch ${b.key}: name must map language -> text`);
      keys.push(b.key);
    }
    if (new Set(keys).size !== keys.length) throw new BuildError('duplicate branch keys');
    for (const b of cfg.branches) {
      const target = b.map_chapter;
      if (target === undefined || target === null) continue;
      const other = cfg.branches.find((x) => x.key === target);
      if (target === b.key || !other) throw new BuildError(`branch ${b.key}: map_chapter must be the key of another branch, not ${text.pyRepr(target)}`);
      if (other.map_chapter !== undefined && other.map_chapter !== null) {
        throw new BuildError(`branch ${b.key}: map_chapter ${text.pyRepr(target)} itself joins another chapter (no chains)`);
      }
    }
    for (const x of cfg.check_exceptions || []) {
      if (typeof x === 'string') continue;
      if (!isObject(x) || typeof x.text !== 'string') throw new BuildError('check_exceptions: every entry must be a text or {"text", "reason"}');
      if (typeof x.reason !== 'string' || !x.reason.trim()) throw new BuildError(`check_exceptions: "${x.text}" needs a reason`);
    }
    if ('states' in cfg && !(typeof cfg.states === 'string' && cfg.states)) throw new BuildError('states must be the name of the states file');
    try {
      scope.checkLivingYears('living_years' in cfg ? cfg.living_years : scope.LIVING_YEARS);
    } catch (error) {
      throw new BuildError(error.message);
    }
  }

  const api = { BuildError, parse, ref };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).config = api;
})(typeof window !== 'undefined' ? window : globalThis);
