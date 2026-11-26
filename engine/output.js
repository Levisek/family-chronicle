// Where the app writes a build into the family folder. Everything goes under web/; a web/<site_dir>
// that a previous build did not make (no marker; a manifest.json alone is not enough, it is a common
// file name) is never replaced; a failed
// privacy check writes and deletes nothing. Paths are relative to the family folder.
//   plan(existing: Set<string>, result: BuildResult, siteDir) -> {writes: Map, deletes: string[]} | {refused}
(function (g) {
  'use strict';

  const MARKER = '.family-chronicle-output';
  const MARKER_TEXT = 'Output folder of Family Chronicle.\n';

  function plan(existing, result, siteDir) {
    if (!result || result.ok !== true) return { refused: 'check failed' };
    const site = `web/${siteDir}/`;
    const ours = existing.has(`web/${MARKER}`);
    const present = [...existing].filter((p) => p.startsWith(site));
    if (present.length && !ours) return { refused: `${site} exists and was not made by Family Chronicle; nothing was written or deleted` };
    const writes = new Map();
    for (const [k, v] of result.files) writes.set(`web/${k}`, v);
    writes.set(`web/${MARKER}`, new TextEncoder().encode(MARKER_TEXT));
    const deletes = present.filter((p) => !writes.has(p)).sort();
    return { writes, deletes };
  }

  const pad = (n) => String(n).padStart(2, '0');
  // "YYYY-MM-DD-HHMMSS" in local time, the name of a folder under history/
  const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

  // Copies of the files that are about to be overwritten: history/<stamp>/<path>.
  function backup(existing, paths, when) {
    const out = new Map();
    for (const p of paths) if (existing.has(p)) out.set(`history/${when}/${p}`, existing.get(p));
    return out;
  }

  const api = { MARKER, plan, backup, stamp };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).output = api;
})(typeof window !== 'undefined' ? window : globalThis);
