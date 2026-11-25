// Browser smoke test of the generated site in headless Chromium.
//
//   PLAYWRIGHT_MODULES=<path to a node_modules dir with playwright and axe-core> \
//     node tests/browser.mjs http://127.0.0.1:8799/family/
//
// Without PLAYWRIGHT_MODULES the test prints a message and exits 0 (it is optional).
// Optional: CHROMIUM_PATH (browser executable), SHOTS_DIR (default: <tmp>/fc-shots).
// Walks every page of sitemap.xml at 1280x800 and 390x844 and fails on a console error or
// warning, a CSP violation, a request outside the origin, a response >= 400, horizontal
// overflow on mobile and an axe-core serious/critical violation. On top of that it checks
// the tree (expand, search, panel), the fan, the film on the map (hash modes, resize, data
// failure), the story map and the first-visit dialog, and saves screenshots.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const modules = process.env.PLAYWRIGHT_MODULES;
if (!modules) {
  console.log('browser.mjs skipped: set PLAYWRIGHT_MODULES to a node_modules directory with playwright and axe-core.');
  process.exit(0);
}
const base = (process.argv[2] || '').replace(/\/?$/, '/');
if (!/^https?:\/\//.test(base)) {
  console.error('Usage: browser.mjs <site url>, e.g. http://127.0.0.1:8799/family/');
  process.exit(2);
}
const require = createRequire(modules.replace(/\/?$/, '/'));
const { chromium } = require('playwright');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const SHOTS = process.env.SHOTS_DIR || join(tmpdir(), 'fc-shots');
mkdirSync(SHOTS, { recursive: true });
const origin = new URL(base).origin;

const sitemap = await (await fetch(base + 'sitemap.xml')).text();
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
// the sitemap holds absolute URLs of the configured base_url; reduce them to paths relative to the site root
const prefix = locs.reduce((p, u) => { let i = 0; while (i < p.length && p[i] === u[i]) i++; return p.slice(0, i); }, locs[0]).replace(/[^/]*$/, '');
const pages = locs.map((u) => u.slice(prefix.length));
if (pages.length < 10) { console.error('The sitemap has only', pages.length, 'pages'); process.exit(1); }

const KEY_PAGES = new Map([
  ['index.html', 'home'], ['tree.html', 'tree'], ['fan.html', 'fan'], ['person/I14.html', 'person'],
  ['story/huber.html', 'story'], ['map.html', 'map'], ['cs/index.html', 'cs-home'], ['cs/tree.html', 'cs-tree'],
]);
const problems = [];
const report = (where, what) => problems.push(`${where}: ${what}`);

const options = { headless: true };
if (process.env.CHROMIUM_PATH) options.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(options);
const VIEWPORTS = [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]];

// a failing step is recorded as a problem; it must not stop the whole run
async function step(where, name, fn) {
  try { await fn(); } catch (e) { report(where, `${name}: ${String(e.message).split('\n')[0]}`); }
}
const wait = (page, ms) => page.waitForTimeout(ms);
const isMobile = (where) => where.startsWith('mobile');
const shot = (page, name, where) => page.screenshot({ path: `${SHOTS}/${name.replace('@', isMobile(where) ? 'm' : 'd')}.png` });
const hash = (page, h) => page.evaluate((x) => { location.hash = x; }, h);
const strings = (page) => page.evaluate(() => JSON.parse(document.querySelector('#data').textContent).strings);
const phaseIs = (page, list) => page.waitForFunction((l) => l.includes(document.body.dataset.phase), list, { timeout: 6000 });
// start as a returning visitor: the first-visit dialog of the person view would cover the page
const returning = (ctx) => ctx.addInitScript(() => {
  try { if (localStorage.getItem('chronicle.from') == null) localStorage.setItem('chronicle.from', 'I1'); } catch (e) { /* no storage */ }
});

async function tree(page, name, where) {
  await page.waitForSelector('button.pcard', { timeout: 8000 });
  await wait(page, 900);
  const count = () => page.locator('button.pcard').count();
  const main = name === 'tree.html';
  const inView = async (sel) => {
    const bb = await page.locator(sel).first().boundingBox(), v = page.viewportSize();
    return !!bb && bb.x >= 0 && bb.y >= 0 && bb.x + bb.width <= v.width && bb.y + bb.height <= v.height;
  };
  const pick = async (text, id) => {
    const input = page.locator('#search');
    await input.click(); await input.fill('');
    await input.pressSequentially(text, { delay: 20 });
    await page.locator(`#suggestions li[data-id="${id}"]`).first().waitFor({ timeout: 3000 });
    await page.locator(`#suggestions li[data-id="${id}"]`).first().click();
    await page.waitForSelector('#panel:not([hidden])', { timeout: 3000 });
    await page.keyboard.press('Escape');
    await wait(page, 1000);
  };
  if (main) await shot(page, 'tree-@-01-default', where);
  await step(where, 'root and living card', async () => {
    if (!/Daniel/.test(await page.locator('.pcard.root').first().innerText())) report(where, '.pcard.root does not contain the root person');
    if (!(await inView('button.pcard[data-id="I1"]'))) report(where, 'the root card is not in the viewport without any clicking');
    const living = page.locator('button.pcard[data-id="I3"]');
    if (await living.count() !== 1) report(where, 'card of the living person I3 is missing');
    else {
      // the whole card HTML without data-id and style: a living person shows no year anywhere
      const html = (await living.evaluate((e) => e.outerHTML)).replace(/ (data-id|style)="[^"]*"/g, '');
      if (/\d{4}/.test(html)) report(where, `the card of a living person contains 4 digits: ${html.slice(0, 200)}`);
    }
    await page.locator('button.pcard').first().focus();
    if (!(await page.evaluate(() => document.activeElement.matches('button.pcard')))) report(where, 'a card cannot be focused with the keyboard');
  });
  await step(where, 'ancestor by search', async () => {
    if (!(await page.locator('button.pcard[data-id="I5"]').count())) await pick('Karl', 'I5');
    if (!(await page.locator('button.pcard[data-id="I5"]').count())) report(where, 'I5 is missing in the tree even after picking it from the search');
  });
  if (main && !isMobile(where)) await step(where, 'panel + screenshot', async () => {
    await page.locator('button.pcard[data-id="I5"]').click();
    await page.waitForSelector('#panel:not([hidden])', { timeout: 3000 });
    await wait(page, 900);
    await shot(page, 'tree-@-04-panel', where);
    const onMap = await page.locator('.p-actions a[href*="#person=I5"]').count();
    if (!onMap) report(where, 'the panel has no "show on the map" link with #person=I5');
    // a document thumbnail opens the lightbox, Escape closes it (and only it, not the panel)
    await page.locator('.p-documents a').first().click();
    await page.waitForSelector('#lightbox:not([hidden])', { timeout: 3000 });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#lightbox[hidden]', { state: 'attached', timeout: 3000 });
    if (await page.locator('#panel[hidden]').count()) report(where, 'Escape in the lightbox closed the panel as well');
    await page.keyboard.press('Escape');
    await wait(page, 600);
  });
  await step(where, 'siblings', async () => {
    const n0 = await count();
    const s = page.locator('.sibling-btn[data-id="I5"]');
    if (await s.count() !== 1) return report(where, 'missing .sibling-btn[data-id="I5"]');
    // a plain click (not dispatchEvent): the button must be reachable on mobile after the camera moved
    await s.click({ timeout: 4000 }).catch((e) => report(where, `.sibling-btn I5 cannot be clicked: ${String(e.message).split('\n')[0]}`));
    await wait(page, 700);
    if (await count() <= n0) report(where, `expanding siblings did not add a card (${n0} -> ${await count()})`);
    if (await s.getAttribute('aria-expanded') !== 'true') report(where, 'aria-expanded is not true after expanding siblings');
  });
  await step(where, 'search', async () => {
    const input = page.locator('#search');
    await input.click(); await input.fill('');
    await input.pressSequentially('hilde', { delay: 20 });
    await page.locator('#suggestions li').first().waitFor({ timeout: 3000 }).catch(() => report(where, 'searching "hilde" suggested nothing'));
    if (!(await page.locator('#suggestions li').count())) return;
    await page.locator('#suggestions li').first().click();
    await page.waitForSelector('#panel:not([hidden])', { timeout: 3000 }).catch(() => report(where, 'picking a suggestion did not open #panel'));
    await page.keyboard.press('Escape');
    await wait(page, 500);
  });
  await step(where, 'expand all', async () => {
    const b = page.locator('#b-all');
    if (isMobile(where)) { if (await b.isVisible()) report(where, '#b-all is visible on mobile (expected hidden)'); return; }
    if (!(await b.isVisible())) return report(where, '#b-all is not visible');
    const n0 = await count();
    await b.click();
    await wait(page, 900);
    if (await count() <= n0) report(where, `#b-all did not add cards (${n0} -> ${await count()})`);
    if (main) await shot(page, 'tree-@-08-all', where);
  });
}

// settings panel: theme and colour mode are applied, remembered and shared between the tree and the fan chart
async function appearance(page, where) {
  const forget = () => page.evaluate(() => { for (const k of ['chronicle.theme', 'chronicle.colors']) localStorage.removeItem(k); });
  await step(where, 'settings: theme and colours', async () => {
    await forget();
    await page.goto(base + 'tree.html', { waitUntil: 'load' });
    await page.waitForSelector('button.pcard'); await wait(page, 600);
    const T = await strings(page);
    await page.locator('.settings-toggle').click();
    if (!(await page.locator('#settings-panel').isVisible())) report(where, 'the settings panel did not open');
    await page.locator('.settings-theme[data-theme="night"]').click();
    if (await page.evaluate(() => document.documentElement.getAttribute('data-theme')) !== 'night') report(where, 'the Night theme was not applied');
    if (isMobile(where) === false) await shot(page, 'settings-@', where);
    const before = await page.locator('button.pcard[data-id="I1"]').evaluate((e) => e.style.getPropertyValue('--branch'));
    await page.selectOption('#settings-colors', 'state');
    await wait(page, 400);
    const legend = await page.locator('#legend .mode').innerText();
    if (!legend.toLowerCase().includes(T.color_mode_state.toLowerCase())) report(where, `the tree legend does not name the mode: ${legend}`);
    if (await page.locator('#legend select').count()) report(where, 'the legend has its own select (the mode is chosen in the settings panel)');
    const after = await page.locator('button.pcard[data-id="I1"]').evaluate((e) => e.style.getPropertyValue('--branch'));
    if (before === after) report(where, 'the card colour did not change with the colour mode');
    if (!(await page.locator('button.pcard .flags img').count())) report(where, 'no flags on the cards (states are configured)');
    await page.keyboard.press('Escape');
    if (await page.locator('#settings-panel').isVisible()) report(where, 'Escape did not close the settings panel');
    // the path from a selected person to the root
    await page.evaluate(() => window.__tree.select('I19'));
    await page.waitForSelector('#panel:not([hidden])', { timeout: 3000 });
    if ((await page.locator('.pcard.on-path').count()) < 2 || !(await page.locator('#cards.path').count())) report(where, 'no path is marked for the selected person');
    await page.keyboard.press('Escape'); await wait(page, 300);
    if (await page.locator('.pcard.on-path').count()) report(where, 'the path stays after the panel is closed');
    // remembered: the fan chart opens in the same theme and mode, and the panel shows the same choice
    await page.goto(base + 'fan.html', { waitUntil: 'load' });
    await page.waitForSelector('#fan .sector'); await wait(page, 400);
    if (await page.evaluate(() => document.documentElement.getAttribute('data-theme')) !== 'night') report(where, 'the theme is not remembered on the fan page');
    const fanLegend = await page.locator('#legend .mode').innerText();
    if (!fanLegend.toLowerCase().includes(T.color_mode_state.toLowerCase())) report(where, `the fan legend does not follow the mode: ${fanLegend}`);
    await page.locator('.settings-toggle').click();
    if (await page.locator('#settings-colors').inputValue() !== 'state') report(where, 'the settings panel does not show the remembered mode');
    await page.selectOption('#settings-colors', 'era');
    await wait(page, 300);
    if (!(await page.locator('#legend .gradient').count())) report(where, 'the era legend has no scale');
    if (isMobile(where) === false) await shot(page, 'fan-night-@', where);
    // the mode from the address wins over the remembered one
    await page.goto(base + 'fan.html?from-address#colors=documented', { waitUntil: 'load' });   // another query: a real load, not a hash change
    await page.waitForSelector('#fan .sector'); await wait(page, 300);
    if (!(await page.locator('#legend li').allInnerTexts()).some((x) => x.includes(T.color_documented_yes))) report(where, '#colors=documented was not applied');
    await forget();
  });
}

async function fan(page, name, where) {
  await page.waitForSelector('#fan .sector', { timeout: 8000 });
  await wait(page, 500);
  await step(where, 'fan', async () => {
    const n = await page.locator('#fan .sector').count();
    if (n < 8) report(where, `the fan has only ${n} sectors`);
    if (!(await page.locator('#legend li').count())) report(where, 'the fan legend is empty');
    if (name === 'fan.html') await shot(page, 'fan-@-01', where);
    // a click on a living person's sector opens a bubble instead of a link
    await page.locator('#fan .person[data-id="I3"]').first().dispatchEvent('click').catch(() => {});
    await wait(page, 200);
    await page.keyboard.press('Escape');
  });
}

// step index by year and place (from aria-valuetext of the timeline), not hardcoded
async function findStop(page, re) {
  const max = Number(await page.getAttribute('#timeline', 'aria-valuemax'));
  for (let i = 0; i <= max; i++) {
    await hash(page, `stop=${i}`);
    await page.waitForFunction((n) => document.querySelector('#timeline').getAttribute('aria-valuenow') === String(n), i, { timeout: 3000 });
    if (re.test(await page.getAttribute('#timeline', 'aria-valuetext'))) return i;
  }
  return -1;
}

async function mapPage(page, vp, where) {
  await page.waitForSelector('body[data-phase]', { state: 'attached', timeout: 8000 });
  await wait(page, 600);
  let maxAll;
  await step(where, 'intro and playing', async () => {
    await hash(page, 'timeline'); await wait(page, 400);
    if (!(await page.locator('#film-intro').isVisible())) report(where, '#timeline: #film-intro is not visible');
    maxAll = Number(await page.getAttribute('#timeline', 'aria-valuemax'));
    const FILM = ['flight', 'drawing', 'stop'];
    const state = () => page.evaluate(() => [document.body.dataset.phase, document.querySelector('#timeline').getAttribute('aria-valuenow')].join('/'));
    const p0 = await page.evaluate(() => document.body.dataset.phase);
    if (FILM.includes(p0)) report(where, `the film is already running before #b-play (phase ${p0})`);
    await page.locator('#b-play').click();
    await phaseIs(page, FILM).catch(() => report(where, `after #b-play there was no flight/drawing/stop phase within 6 s (is ${p0})`));
    await page.locator('#b-play').click();   // the second click pauses
    await wait(page, 300);
    const s1 = await state();
    await wait(page, 1800);
    if (s1 !== await state()) report(where, 'the second click on #b-play did not pause the film');
  });
  await step(where, 'stop 3', async () => {
    await hash(page, 'stop=3');
    await page.waitForSelector('#card[data-stop="3"]', { state: 'visible', timeout: 4000 });
  });
  await step(where, 'full map', async () => {
    await hash(page, 'full-map');
    await page.waitForFunction(() => document.body.dataset.phase === 'end', null, { timeout: 6000 });
    await wait(page, 1200);
    const current = await page.locator('nav.modes a[aria-current]').first().textContent({ timeout: 2000 }).catch(() => null);
    const T = await strings(page);
    if (!current || current.trim() !== T.mode_map) report(where, `aria-current on "${T.mode_map}" is missing (is: ${JSON.stringify(current)})`);
    const seen = await page.locator(':text("Natural Earth")').evaluateAll((es) => es.some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }));
    if (!seen) report(where, 'the Natural Earth attribution is not visible on the full map');
    await shot(page, 'map-@-10-full-map', where);
  });
  await step(where, 'person', async () => {
    await hash(page, 'timeline'); await wait(page, 400);
    await hash(page, 'person=I14'); await wait(page, 600);
    const m = Number(await page.getAttribute('#timeline', 'aria-valuemax'));
    if (!(m < maxAll)) report(where, `#person=I14: aria-valuemax ${m} is not smaller than for the whole film (${maxAll})`);
    if (await page.evaluate(() => document.body.dataset.phase) === 'intro') report(where, '#person=I14: the film did not start (phase intro)');
  });
  const intro = () => page.evaluate(() => ({
    phase: document.body.dataset.phase, sub: document.querySelector('#film-intro-sub').textContent.trim(),
    intro: !document.querySelector('#film-intro').hidden, card: !!document.querySelector('#card[data-stop]:not([hidden])'),
    max: Number(document.querySelector('#timeline').getAttribute('aria-valuemax')),
  }));
  await step(where, 'living person', async () => {
    await hash(page, 'timeline'); await wait(page, 500);
    await hash(page, 'person=I3'); await wait(page, 600);
    const T = await strings(page), st = await intro();
    // the static parts of T.person_living (without {name}, {relationship}) must be in the message
    const parts = T.person_living.split(/\{[^}]+\}/).map((x) => x.trim()).filter(Boolean);
    if (!parts.every((c) => st.sub.includes(c))) report(where, `#person=I3: the message does not match T.person_living (is ${JSON.stringify(st.sub.slice(0, 60))})`);
    if (!/Eva/.test(st.sub)) report(where, '#person=I3: the name is missing in the message');
    if (!st.intro) report(where, '#person=I3: #film-intro is not visible');
    if (st.phase !== 'intro') report(where, `#person=I3: phase ${st.phase}, expected intro`);
    if (st.card) report(where, '#person=I3: #card[data-stop] is visible');
    if (st.max !== maxAll) report(where, `#person=I3: the timeline has ${st.max} steps, expected the whole film (${maxAll}), no stop of a living person`);
  });
  for (const h of ['person=X999', 'person=constructor', 'person=toString', 'person=%E0%A4%A']) {
    await step(where, `hash ${h}`, async () => {
      await hash(page, 'timeline'); await wait(page, 400);
      await hash(page, h); await wait(page, 500);
      const T = await strings(page), st = await intro();
      if (st.sub !== T.film_intro_sub) report(where, `#${h}: #film-intro-sub is not the default intro (is ${JSON.stringify(st.sub.slice(0, 60))})`);
      if (st.phase !== 'intro') report(where, `#${h}: phase ${st.phase}, expected intro`);
      if (st.max !== maxAll) report(where, `#${h}: the timeline has ${st.max} steps, expected the whole film (${maxAll})`);
    });
  }
  // the first stop that is reached by a leg: only there the film can be paused in the middle of drawing
  const drawable = async () => {
    const n = Number(await page.getAttribute('#timeline', 'aria-valuemax'));
    for (let i = 0; i <= n; i++) {
      await hash(page, `stop=${i}&drawing=0.5`); await wait(page, 250);
      if (await page.evaluate(() => document.body.dataset.phase) === 'drawing') return i;
    }
    return -1;
  };
  await step(where, 'screenshots', async () => {
    await hash(page, 'timeline'); await wait(page, 300);
    const i = await drawable();
    if (i < 0) return report(where, 'no stop can be paused in the middle of drawing');
    await wait(page, 900); await shot(page, 'map-@-04-drawing', where);
    await hash(page, `stop=${i}`); await phaseIs(page, ['stop']); await wait(page, 900); await shot(page, 'map-@-07-stop', where);
  });
  await step(where, 'resize', async () => {
    await hash(page, 'timeline'); await wait(page, 300);
    const i = await drawable();
    if (i < 0) return report(where, 'resize: no stop can be paused in the middle of drawing');
    await wait(page, 500);
    const state = () => page.evaluate(() => ({ phase: document.body.dataset.phase, now: document.querySelector('#timeline').getAttribute('aria-valuenow'), card: document.querySelector('#card')?.dataset.stop ?? null }));
    const s0 = await state();
    if (s0.phase !== 'drawing' || s0.now !== String(i)) return report(where, `resize: the initial state is not drawing stop ${i} (${JSON.stringify(s0)})`);
    const orig = page.viewportSize();
    await page.setViewportSize(isMobile(where) ? { width: 1280, height: 800 } : { width: 390, height: 844 }); await wait(page, 700);
    const s1 = await state();
    await page.setViewportSize(orig); await wait(page, 700);
    if (JSON.stringify(s0) !== JSON.stringify(s1)) report(where, `resizing in the middle of drawing changed the state (${JSON.stringify(s0)} -> ${JSON.stringify(s1)})`);
  });
}

async function storyMap(page, vp, where) {
  await page.waitForSelector('#map[data-center]', { timeout: 8000 });
  const center = () => page.locator('#map').getAttribute('data-center');
  await wait(page, 300);
  const c0 = await center();
  await page.evaluate(() => {
    const anchors = [...document.querySelectorAll('.anchor[data-places]')];
    const a = anchors.find((e) => e.dataset.places.includes('Linz')) || anchors.at(-1);
    window.scrollTo(0, a.getBoundingClientRect().top + window.scrollY - window.innerHeight / 2);
  });
  await wait(page, 2500);
  if (c0 === await center()) report(where, `after scrolling to the Linz anchor #map[data-center] did not change (${c0})`);
  await page.screenshot({ path: `${SHOTS}/${vp}-story-map.png` });
}

// first visit: the "Who are you?" dialog of the person view; choosing a person redraws from them
async function firstVisit() {
  const where = 'desktop first-visit';
  const ctx = await browser.newContext({ viewport: VIEWPORTS[0][1] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report(where, `exception: ${e.message}`));
  await page.goto(base + 'tree.html', { waitUntil: 'load' });
  await step(where, 'dialog', async () => {
    await page.waitForSelector('dialog.view-dialog[open]', { timeout: 5000 });
    await page.locator('dialog.view-dialog input').fill('thomas');
    await page.locator('dialog.view-dialog ul button').first().click();
    await page.waitForSelector('button.pcard', { timeout: 8000 });
    await wait(page, 900);
    const label = await page.locator('.view-btn span').first().textContent();
    if (!/Thomas/.test(label || '')) report(where, `the view button does not show the chosen person (${label})`);
    const rel = await page.locator('button.pcard.root .rel').first().textContent();
    if (!rel) report(where, 'the root card has no relationship text');
    await shot(page, 'tree-d-09-view-from-father', where);
    await page.goto(base + 'fan.html', { waitUntil: 'load' });
    await page.waitForSelector('#fan .sector', { timeout: 8000 });
    await shot(page, 'fan-d-02-view-from-father', where);
  });
  await ctx.close();
}

// data failure: in a clean context, without the generic guards (the aborted request is in the console on purpose)
async function dataFailure() {
  const where = 'desktop data-failure';
  const ctx = await browser.newContext({ viewport: VIEWPORTS[0][1] });
  await returning(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report(where, `exception: ${e.message}`));
  await page.route('**/data/events*', (r) => r.abort());
  await page.goto(base + 'map.html', { waitUntil: 'load' });
  await step(where, 'data error', async () => {
    const text = (await strings(page)).data_error;
    await page.waitForFunction((t) => document.querySelector('#card')?.textContent.includes(t), text, { timeout: 5000 });
  });
  await ctx.close();
}

for (const [vp, viewport] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport });
  await returning(ctx);
  await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const page = await ctx.newPage();
  let where = '';
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) report(where, `console ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => report(where, `exception: ${e.message}`));
  page.on('request', (r) => {
    if (r.url().startsWith('data:')) return;
    if (new URL(r.url()).origin !== origin) report(where, `request outside the origin: ${r.url()}`);
  });
  page.on('response', (r) => { if (r.status() >= 400) report(where, `HTTP ${r.status()} ${r.url()}`); });

  for (const rel of pages) {
    where = `${vp} ${rel}`;
    await page.goto(base + rel, { waitUntil: 'load' });
    if (/(^|\/)tree\.html$/.test(rel)) await page.waitForSelector('button.pcard');
    const csp = await page.evaluate(() => window.__csp);
    if (csp.length) report(where, `CSP: ${csp.join('; ')}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (vp === 'mobile' && overflow > 0) report(where, `horizontal overflow by ${overflow}px`);
    await page.evaluate(async () => { await Promise.all([document.fonts.load('1em "EB Garamond"'), document.fonts.load('italic 1em "EB Garamond"'), document.fonts.load('bold 1em "EB Garamond"')]); await document.fonts.ready; });
    if (await page.locator('#map[data-center]').count() || /(^|\/)story\/[^/]+\.html$/.test(rel) && await page.locator('#map').count()) await page.waitForSelector('#map[data-center]', { timeout: 8000 });
    // axe (page.evaluate is not affected by the CSP)
    await page.evaluate(AXE);
    const violations = await page.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'] })).violations);
    for (const x of violations.filter((v) => ['serious', 'critical'].includes(v.impact))) {
      report(where, `axe ${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
    }
    if (KEY_PAGES.has(rel)) await page.screenshot({ path: `${SHOTS}/${vp}-${KEY_PAGES.get(rel)}.png`, fullPage: true });
    if (rel === 'map.html') await mapPage(page, vp, where);
    else if (rel === 'story/huber.html') await storyMap(page, vp, where);
    else if (rel === 'tree.html') {
      for (const h of ['constructor', 'toString']) {      // a key from the prototype must not throw in jump()
        await page.goto(`${base}tree.html#person=${h}`, { waitUntil: 'load' });
        await page.waitForSelector('button.pcard'); await wait(page, 400);
      }
      await page.goto(base + rel, { waitUntil: 'load' }); await page.waitForSelector('button.pcard');
      await tree(page, 'tree.html', where);
      await appearance(page, where);
    } else if (rel === 'cs/tree.html') await tree(page, 'cs', where);
    else if (rel === 'fan.html' || rel === 'cs/fan.html') await fan(page, rel, where);
  }
  await ctx.close();
}
await firstVisit();
await dataFailure();
await browser.close();

if (problems.length) {
  const unique = [...new Set(problems)];
  console.log(unique.slice(0, 60).join('\n'));
  console.log(`BROWSER FAIL: ${unique.length} problems on ${pages.length} pages`);
  process.exit(1);
}
console.log(`BROWSER OK: ${pages.length} pages x 2 sizes, no problems (screenshots in ${SHOTS})`);
