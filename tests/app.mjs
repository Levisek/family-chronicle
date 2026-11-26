// Smoke test of the offline app (Family Chronicle.html) from a file:// URL, no server.
//
//   PLAYWRIGHT_MODULES=<node_modules with playwright> node tests/app.mjs
//
// Without PLAYWRIGHT_MODULES it prints a message and exits 0 (it is optional). Every browser gets
// its own profile in a temporary folder. Nominatim is answered by page.route: no network.
// In Chromium the folder picker is replaced by an in-memory folder with the File System Access
// interface (window.__folders); the origin private file system is not open to file:// pages.
// Scenarios: chromium_example, chromium_folder, xss_name, leak_refused, online_only_places,
// firefox_backup_warning.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const modules = process.env.PLAYWRIGHT_MODULES;
if (!modules) {
  console.log('app.mjs skipped: set PLAYWRIGHT_MODULES to a node_modules directory with playwright.');
  process.exit(0);
}
const require = createRequire(modules.replace(/\/?$/, '/'));
const { chromium, firefox } = require('playwright');

const REPO = fileURLToPath(new URL('../', import.meta.url));
const APP = pathToFileURL(join(REPO, 'Family Chronicle.html')).href;
const TMP = mkdtempSync(join(tmpdir(), 'fc-app-'));
const results = [];

// a small GEDCOM: `name` is the person with the most ancestors, the place `place` is in no gazetteer
function gedcom(name, place = 'Linz', fatherPlace = 'Linz') {
  const people = [[1, name, 'M', 1990, 1], [2, 'Otto /Alt/', 'M', 1960, 2], [3, 'Ida /Berg/', 'F', 1962, 3],
    [4, 'Karl /Alt/', 'M', 1930, 0], [5, 'Rosa /Alt/', 'F', 1932, 0], [6, 'Emil /Berg/', 'M', 1931, 0], [7, 'Anna /Berg/', 'F', 1933, 0]];
  const lines = ['0 HEAD', '1 CHAR UTF-8'];
  for (const [id, n, sex, year, famc] of people) {
    lines.push(`0 @I${id}@ INDI`, `1 NAME ${n}`, `1 SEX ${sex}`, '1 BIRT', `2 DATE ${year}`, `2 PLAC ${id === 1 ? place : id === 2 ? fatherPlace : 'Linz'}`);
    if (year < 1940) lines.push('1 DEAT', '2 DATE 2000');
    if (famc) lines.push(`1 FAMC @F${famc}@`);
  }
  lines.push('0 @F1@ FAM', '1 HUSB @I2@', '1 WIFE @I3@', '1 CHIL @I1@', '0 @F2@ FAM', '1 HUSB @I4@', '1 WIFE @I5@', '1 CHIL @I2@',
    '0 @F3@ FAM', '1 HUSB @I6@', '1 WIFE @I7@', '1 CHIL @I3@', '0 TRLR', '');
  const path = join(TMP, `${Math.random().toString(36).slice(2)}.ged`);
  writeFileSync(path, lines.join('\n'));
  return path;
}

// The folder picker returns an in-memory folder `dir` (Chromium only): the part of
// FileSystemDirectoryHandle the app uses. Handles cannot go into IndexedDB (the app copes).
const FAKE_PICKER = (dir) => {
  const file = (name, store) => ({
    kind: 'file', name,
    async getFile() { const b = store.get(name); return new File([b], name); },
    async createWritable() { const parts = []; return { async write(x) { parts.push(x); }, async close() { store.set(name, new Uint8Array(await new Blob(parts).arrayBuffer())); } }; },
  });
  const folder = (name) => {
    const files = new Map(), dirs = new Map();
    const h = {
      kind: 'directory', name, files, dirs,
      async *entries() { for (const [n, d] of dirs) yield [n, d]; for (const n of files.keys()) yield [n, file(n, files)]; },
      async getDirectoryHandle(n, o = {}) { if (!dirs.has(n)) { if (!o.create) throw new DOMException('no', 'NotFoundError'); dirs.set(n, folder(n)); } return dirs.get(n); },
      async getFileHandle(n, o = {}) { if (!files.has(n)) { if (!o.create) throw new DOMException('no', 'NotFoundError'); files.set(n, new Uint8Array()); } return file(n, files); },
      async removeEntry(n) { if (!files.delete(n) && !dirs.delete(n)) throw new DOMException('no', 'NotFoundError'); },
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
    };
    return h;
  };
  window.__folders = window.__folders || {};
  window.showDirectoryPicker = async () => (window.__folders[dir] = window.__folders[dir] || folder(dir));
};

async function folderList(page, dir) {
  return page.evaluate((d) => {
    const out = {};
    const walk = (h, prefix) => {
      for (const [n, x] of h.dirs) walk(x, `${prefix}${n}/`);
      for (const [n, b] of h.files) out[prefix + n] = n.endsWith('.json') || n.endsWith('-output') ? new TextDecoder().decode(b) : b.length;
    };
    if (window.__folders[d]) walk(window.__folders[d], '');
    return out;
  }, dir);
}

async function open(type, name) {
  const ctx = await type.launchPersistentContext(join(TMP, `profile-${name}`), { headless: true, viewport: { width: 1280, height: 800 }, locale: 'en-US', acceptDownloads: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`console ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return { ctx, page, problems };
}

async function clean(page, problems) {
  const csp = await page.evaluate(() => window.__csp);
  return [...problems, ...csp.map((x) => `CSP: ${x}`)];
}

async function nextTo(page, step) {
  for (;;) {
    const current = await page.textContent('[aria-current="step"]');
    if (current.startsWith(`${step} `)) return;
    await page.click('#next');
    if (current.startsWith('3 ')) await page.waitForSelector('#places-panel, .page .lead', { timeout: 30000 });
  }
}

async function scenario(name, type, fn) {
  const t0 = Date.now();
  const { ctx, page, problems } = await open(type, name);
  try {
    const notes = (await fn(page)) || '';
    const left = await clean(page, problems);
    if (left.length) throw new Error(left.join('\n'));
    results.push([name, 'ok', `${Date.now() - t0} ms ${notes}`]);
  } catch (e) {
    await page.screenshot({ path: join(TMP, `${name}.png`) }).catch(() => {});
    results.push([name, 'FAIL', e.message.split('\n').slice(0, 6).join(' | ')]);
  } finally {
    await ctx.close();
  }
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

await scenario('chromium_example', chromium, async (page) => {
  await page.goto(APP);
  await page.click('text=Try it on the example');
  await nextTo(page, 6);
  await page.click('#build');
  await page.waitForSelector('#build-ok, .error', { timeout: 60000 });
  assert(await page.isVisible('#build-ok'), `build: ${await page.textContent('#screen')}`);
  return (await page.textContent('#build-ok')).replace(/^.*(Built in [\d.]+ s)\..*$/, '$1');
});

await scenario('chromium_folder', chromium, async (page) => {
  await page.addInitScript(FAKE_PICKER, 'family-folder');
  await page.goto(APP);
  await page.click('text=Start with your own GEDCOM');
  await page.setInputFiles('#ged-input', join(REPO, 'example/family.ged'));
  await page.waitForSelector('#gedcom-summary');
  await nextTo(page, 6);
  await page.click('#build');
  await page.waitForSelector('#choose-folder', { timeout: 60000 });
  await page.click('#choose-folder');
  await page.waitForSelector('#saved', { timeout: 30000 });
  const files = await folderList(page, 'family-folder');
  for (const f of ['site.json', 'places.json', 'basemap.geojson', 'family.ged', 'web/.family-chronicle-output', 'web/family/index.html', 'web/manifest.json']) assert(f in files, `missing ${f}`);
  assert(JSON.parse(files['web/manifest.json']).check === 'ok', 'manifest check is not ok');
  const places = JSON.parse(files['places.json']);
  assert(Object.values(places).every((p) => ['gedcom', 'gazetteer', 'online', 'manual'].includes(p.source)), 'places without a source');
  // saved again: the files a person wrote go to history/ first
  await page.click('#home');
  await page.click('#home-settings');
  await page.click('[aria-current="step"]');
  await page.check('input[type="checkbox"] >> nth=1');   // a second website language
  await nextTo(page, 6);
  await page.click('#build');
  await page.waitForSelector('#saved', { timeout: 60000 });
  const after = await folderList(page, 'family-folder');
  assert(Object.keys(after).some((f) => /^history\/\d{4}-\d\d-\d\d-\d{6}\/site\.json$/.test(f)), 'no backup of site.json in history/');
  return `${Object.keys(files).length} files`;
});

await scenario('xss_name', chromium, async (page) => {
  const evil = '<img src=x onerror=window.__x=1> /Evil/';
  await page.goto(APP);
  await page.click('text=Start with your own GEDCOM');
  await page.setInputFiles('#ged-input', gedcom(evil));
  await page.waitForSelector('#gedcom-summary');
  await page.click('#next');
  await page.waitForSelector('#people');
  assert((await page.textContent('#people')).includes('<img src=x onerror=window.__x=1>'), 'the name is not shown as text');
  assert(await page.locator('#people img').count() === 0, 'an img element was made from the name');
  await page.click('#next');
  await page.waitForSelector('#pedigree');
  assert((await page.textContent('#pedigree')).includes('<img'), 'the pedigree does not show the name as text');
  assert(await page.evaluate(() => window.__x) === undefined, 'the onerror handler ran');
});

await scenario('leak_refused', chromium, async (page) => {
  // a saved family whose intro gives the birth date of a living person (Daniel, born 12 March 1990)
  const files = {};
  const walk = (dir, prefix = '') => {
    for (const e of require('node:fs').readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), `${prefix}${e.name}/`);
      else files[prefix + e.name] = readFileSync(join(dir, e.name)).toString('base64');
    }
  };
  walk(join(REPO, 'example'));
  // (chronicles are redacted by the build; the intro in site.json is published as written)
  const site = JSON.parse(readFileSync(join(REPO, 'example/site.json'), 'utf8'));
  site.strings = { ...(site.strings || {}), en: { ...((site.strings || {}).en || {}), intro: ['Daniel was born on 12 March 1990.'] } };
  files['site.json'] = Buffer.from(JSON.stringify(site)).toString('base64');
  await page.addInitScript(FAKE_PICKER, 'leak');
  await page.goto(APP);
  await page.evaluate(async (all) => {
    const root = await window.showDirectoryPicker();
    for (const [path, b64] of Object.entries(all)) {
      let d = root;
      const parts = path.split('/');
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
      const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
      await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      await w.close();
    }
  }, files);
  await page.click('text=Open a saved family');
  await page.click('#home-build');
  await page.click('#build');
  await page.waitForSelector('#findings', { timeout: 60000 });
  assert((await page.textContent('#findings')).includes('12 March 1990'), 'the finding does not name the date');
  const list = await folderList(page, 'leak');
  assert(!Object.keys(list).some((f) => f.startsWith('web/')), 'web/ was written despite the finding');
  await page.click('#findings >> text=Add an exception');
  const save = page.locator('#findings button.primary-button').first();
  assert(await save.isDisabled(), 'the exception can be saved without a reason');
  await page.fill('#findings textarea >> nth=0', 'test');
  assert(!(await save.isDisabled()), 'a reason does not enable the button');
});

await scenario('online_only_places', chromium, async (page) => {
  const seen = [];
  await page.route('https://nominatim.openstreetmap.org/**', (route) => {
    seen.push({ url: route.request().url(), headers: route.request().headers(), at: Date.now() });
    const q = new URL(route.request().url()).searchParams.get('q');
    const body = q.startsWith('Xyzzy') ? [{ lat: '47.1', lon: '9.5', display_name: 'Xyzzy Hamlet, Nowhere', name: 'Xyzzy Hamlet' }] : [];
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  await page.goto(APP);
  await page.click('text=Start with your own GEDCOM');
  await page.setInputFiles('#ged-input', gedcom('Ann /Smith/', 'Xyzzy Hamlet, Neverland', 'Hlavní 12, Qwzz Dorf'));
  await page.waitForSelector('#gedcom-summary');
  await nextTo(page, 4);
  await page.waitForSelector('#online');
  await page.click('#online');
  await page.waitForFunction(() => document.querySelector('#places-panel') && !document.querySelector('#places-panel .progress'), null, { timeout: 15000 });
  // the place that was not found can be looked up again at once: still at most one request a second
  await page.click('#online');
  await page.waitForFunction(() => !document.querySelector('#places-panel .progress'), null, { timeout: 15000 });
  // only place strings of the GEDCOM go out, with the fixed parameters, at most one a second
  const places = new Set(['Xyzzy Hamlet, Neverland', 'Hlavní, Qwzz Dorf', 'Linz']);
  assert(seen.some((x) => new URL(x.url).searchParams.get('q') === 'Xyzzy Hamlet, Neverland'), 'the unknown place was not looked up');
  assert(!seen.some((x) => x.url.includes('12')), 'a house number went out');
  for (const [i, x] of seen.entries()) {
    const u = new URL(x.url);
    assert(JSON.stringify([...u.searchParams.keys()].sort()) === '["format","limit","q"]', `parameters: ${u.search}`);
    assert(places.has(u.searchParams.get('q')), `q: ${u.searchParams.get('q')}`);
    assert(!/ann|smith|1990/i.test(x.url), 'a name or a year went out');
    assert(!x.headers.referer, 'a referrer went out');
    if (i) assert(x.at - seen[i - 1].at >= 1000, 'two requests within a second');
  }
});

await scenario('firefox_backup_warning', firefox, async (page) => {
  await page.goto(APP);
  assert(await page.isVisible('text=This browser cannot save into a folder'), 'no banner about the folder');
  await page.click('text=Try it on the example');
  assert(!(await page.isVisible('.banner.warn')), 'warning before any change');
  await nextTo(page, 3);
  await page.fill('#branches input[type="text"] >> nth=0', 'Huber family');
  await page.press('#branches input[type="text"] >> nth=0', 'Tab');
  await page.waitForSelector('.banner.warn');
  assert((await page.textContent('.banner.warn')).includes('Download a backup'), 'the warning has no backup button');
  const [backup] = await Promise.all([page.waitForEvent('download'), page.click('.banner.warn button')]);
  const backupPath = join(TMP, 'backup.zip');
  await backup.saveAs(backupPath);
  execFileSync('unzip', ['-tq', backupPath]);
  assert(execFileSync('unzip', ['-p', backupPath, 'site.json'], { encoding: 'utf8' }).includes('Huber family'), 'the backup misses the change');
  assert(!(await page.isVisible('.banner.warn')), 'the warning stays after the backup');
  await nextTo(page, 6);
  await page.click('#build');
  await page.waitForSelector('#download-web', { timeout: 60000 });
  const [web] = await Promise.all([page.waitForEvent('download'), page.click('#download-web')]);
  const webPath = join(TMP, 'web.zip');
  await web.saveAs(webPath);
  execFileSync('unzip', ['-tq', webPath]);
  assert(execFileSync('unzip', ['-Z1', webPath], { encoding: 'utf8' }).includes('family/index.html'), 'the website ZIP has no index.html');
});

await scenario('firefox_saved_family', firefox, async (page) => {
  const keys = () => page.evaluate(() => new Promise((resolve) => {
    const r = indexedDB.open('fc-app', 1);
    r.onsuccess = () => { const q = r.result.transaction('projects').objectStore('projects').getAllKeys(); q.onsuccess = () => { r.result.close(); resolve(q.result); }; };
  }));
  const newFamily = async () => {
    await page.click('text=Start with your own GEDCOM');
    await page.setInputFiles('#ged-input', gedcom('Ann /Smith/'));
    await page.waitForSelector('#gedcom-summary');
    await nextTo(page, 6);
    await page.fill('#family-name', 'Smith');
    await page.click('#build');
    await page.waitForSelector('#choose-folder', { timeout: 60000 });
    assert((await page.textContent('#choose-folder')).includes('this browser'), 'Firefox offers a folder');
    await page.click('#choose-folder');
    await page.waitForSelector('#download-web', { timeout: 60000 });
  };
  await page.goto(APP);
  await newFamily();
  // saved only in the browser: the warning is there at once
  assert(await page.isVisible('.banner.warn'), 'no backup warning after saving into the browser');
  // saved again with a change: the old site.json is kept in history/ and goes into the backup
  await page.click('#home');
  await page.click('#home-settings');
  await page.check('input[type="checkbox"] >> nth=1');
  await nextTo(page, 6);
  await page.click('#build');
  await page.waitForSelector('#download-web', { timeout: 60000 });
  const [backup] = await Promise.all([page.waitForEvent('download'), page.click('.banner.warn button')]);
  const path = join(TMP, 'saved-backup.zip');
  await backup.saveAs(path);
  const names = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' });
  assert(/^history\/\d{4}-\d\d-\d\d-\d{6}\/site\.json$/m.test(names), `no history/ in the backup:\n${names}`);
  // a second family of the same name does not replace the first one
  await page.click('#home');
  await page.click('text=Start screen');
  await newFamily();
  const k = await keys();
  assert(k.includes('Smith') && k.length === 2, `families in the browser: ${JSON.stringify(k)}`);
});

for (const [name, status, note] of results) console.log(`${status.padEnd(4)} ${name}  ${note}`);
const failed = results.filter((r) => r[1] !== 'ok');
if (!failed.length) rmSync(TMP, { recursive: true, force: true });
else console.log(`screenshots and profiles: ${TMP}`);
process.exit(failed.length ? 1 : 0);
