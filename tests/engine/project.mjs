// Test helpers: a folder as a file map, and the assets of this repository.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function folderMap(dir, prefix = '') {
  const out = new Map();
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) for (const [k, v] of folderMap(full, `${prefix}${name}/`)) out.set(k, v);
    else out.set(prefix + name, new Uint8Array(readFileSync(full)));
  }
  return out;
}

export function repoAssets() {
  const locales = {};
  for (const n of readdirSync(join(ROOT, 'locales'))) if (n.endsWith('.json')) locales[n.slice(0, -5)] = JSON.parse(readFileSync(join(ROOT, 'locales', n), 'utf8'));
  return { static: folderMap(join(ROOT, 'static')), fonts: folderMap(join(ROOT, 'fonts')), locales };
}

export const REPO = ROOT;
