#!/usr/bin/env node

/**
 * End-to-end tests for the Theme Designer Pro event function
 *
 * Installs event-function/theme_designer_pro_event.py on a running Open WebUI
 * through its API, the way an admin would, then drives real pages in headless
 * Chrome: the app, the sign-in page, signing in and out, personal themes and
 * the designer itself.
 *
 * The themes saved here are markers, not real palettes. Each CSS section sets
 * one custom property on <html> (--tdp-vars, --tdp-structural, --tdp-gradient,
 * --tdp-custom) to the theme's name, so a test reads exactly which parts of
 * which theme reached a page, whatever the designer's generator does.
 *
 * Usage:
 *   npm ci
 *   npm install --no-save playwright-core@1.56.1
 *   BASE_URL=http://127.0.0.1:3000 node tests/event-function/e2e.js
 *
 * FUNCTION_FILE tests another copy of the function, and ONLY runs the tests
 * whose names match a pattern.
 *
 * BASE_URL must be a fresh, throwaway Open WebUI: the tests sign up its first
 * account as admin, install the function and overwrite its themes. Needs an
 * installed Google Chrome (GitHub's Ubuntu runners have one).
 */

const fs = require('fs');
const path = require('path');

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const ROUTE = '/api/v1/theme-designer';
const FUNCTION_ID = 'theme_designer_pro';
const FUNCTION_FILE = process.env.FUNCTION_FILE ||
  path.join(__dirname, '..', '..', 'event-function', 'theme_designer_pro_event.py');
const ADMIN = { name: 'Admin', email: 'admin@tdp.test', password: 'tdp-e2e-admin-pw' };
const USER = { name: 'User', email: 'user@tdp.test', password: 'tdp-e2e-user-pw' };
const MODES = ['dark', 'oled', 'light', 'her'];
const PARTS = ['vars', 'structural', 'gradient', 'custom'];
const WAIT_MS = 15000;

// ── Open WebUI API ──

async function api(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch (e) { /* not JSON */ }
  return { status: res.status, json };
}

async function signIn(account) {
  const res = await api('POST', '/api/v1/auths/signin', { email: account.email, password: account.password });
  return res.status === 200 ? res.json.token : null;
}

async function setUpAccounts() {
  // The first account to sign up on a fresh instance is its admin
  let admin = await signIn(ADMIN);
  if (!admin) {
    const res = await api('POST', '/api/v1/auths/signup', ADMIN);
    if (res.status !== 200 || res.json.role !== 'admin') throw new Error('Could not create the admin account: ' + res.status);
    admin = res.json.token;
  }
  let user = await signIn(USER);
  if (!user) {
    const res = await api('POST', '/api/v1/auths/add', { ...USER, role: 'user' }, admin);
    if (res.status !== 200) throw new Error('Could not add the user account: ' + res.status);
    user = await signIn(USER);
  }
  return { admin, user };
}

async function installFunction(admin) {
  const content = fs.readFileSync(FUNCTION_FILE, 'utf8');
  const form = { id: FUNCTION_ID, name: 'Theme Designer Pro', content, meta: { description: 'End-to-end tests' } };
  const existing = await api('GET', `/api/v1/functions/id/${FUNCTION_ID}`, undefined, admin);
  const saved = existing.status === 200
    ? await api('POST', `/api/v1/functions/id/${FUNCTION_ID}/update`, form, admin)
    : await api('POST', '/api/v1/functions/create', form, admin);
  if (saved.status !== 200) throw new Error('Could not install the function: ' + JSON.stringify(saved.json));
  const fn = await api('GET', `/api/v1/functions/id/${FUNCTION_ID}`, undefined, admin);
  // Switching it on is what makes it register its routes and publish its assets
  if (!fn.json.is_active) await api('POST', `/api/v1/functions/id/${FUNCTION_ID}/toggle`, undefined, admin);
  await setValves(admin, {});
}

async function setValves(admin, valves) {
  const res = await api('POST', `/api/v1/functions/id/${FUNCTION_ID}/valves/update`,
    { allow_personal_themes: true, ...valves }, admin);
  if (res.status !== 200) throw new Error('Could not set valves: ' + res.status);
}

// A marker theme: each section names the theme in its own custom property.
// `flags` go into every mode, `omit` leaves sections out.
function markerTheme(name, flags = {}, omit = []) {
  const markers = { vars: 'VARS', structural: 'STRUCTURAL', gradient: 'GRADIENT', custom: 'CUSTOM' };
  const sections = {};
  PARTS.forEach((part) => {
    sections[part] = omit.includes(part) ? '' :
      `/*[OWUI_${markers[part]}_START]*/\nhtml { --tdp-${part}: ${name}; }\n/*[OWUI_${markers[part]}_END]*/\n`;
  });
  const state = {};
  MODES.forEach((m) => { state[m] = { h: 250, c: 0, l: 20, paletteEnabled: true, ...flags }; });
  return { css: PARTS.map((p) => sections[p]).join(''), state: JSON.stringify(state), sections };
}

async function saveTheme(token, theme, personal) {
  const res = await api('POST', ROUTE + (personal ? '/me' : ''), theme, token);
  if (res.status !== 200) throw new Error('Could not save a theme: ' + JSON.stringify(res.json));
}

async function removePersonalTheme(token) {
  await api('POST', ROUTE + '/me', { reset: true }, token);
}

// ── Browser ──

let browser;

async function openPage({ token } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript((t) => {
    // Every page starts in Dark mode, and signed in when a token is given
    if (!localStorage.getItem('theme')) localStorage.setItem('theme', 'dark');
    if (t && !localStorage.getItem('token')) localStorage.setItem('token', t);
  }, token || null);
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  return page;
}

// Which theme each part of the CSS on <html> came from ('' when none)
function readParts(page) {
  return page.evaluate((parts) => {
    const style = getComputedStyle(document.documentElement);
    const out = {};
    parts.forEach((p) => { out[p] = style.getPropertyValue('--tdp-' + p).trim(); });
    return out;
  }, PARTS);
}

async function waitFor(what, check, timeout = WAIT_MS) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await check();
    if (last === true) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${what}: still ${JSON.stringify(last)} after ${timeout / 1000}s`);
}

// Waits until the parts named in `expected` read as given
async function expectParts(page, expected, label) {
  await waitFor(label || 'theme parts', async () => {
    const got = await readParts(page);
    return Object.keys(expected).every((k) => got[k] === expected[k]) ? true : got;
  });
}

async function loaderReady(page) {
  await page.waitForFunction(() => window._owuiBootloaderReady === true, null, { timeout: WAIT_MS });
}

// Signs in through Open WebUI's own form, which ends in a client-side goto()
async function signInWithForm(page, account) {
  await page.fill('#email', account.email);
  await page.fill('#password', account.password);
  await page.press('#password', 'Enter');
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: WAIT_MS });
}

// ── Tests ──

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('the instance theme reaches app pages', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  const page = await openPage({ token: admin });
  await page.goto(BASE + '/');
  await loaderReady(page);
  await expectParts(page, { vars: 'instance', structural: 'instance', gradient: 'instance', custom: 'instance' });
});

test('a sign-in page shows only the parts set to show there', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance', { customCssShowAuth: false, gradientShowAuth: false }));
  const page = await openPage();
  await page.goto(BASE + '/auth');
  await loaderReady(page);
  // custom.css carries the colors and custom CSS to every page, so this is
  // also the check that its copy of the instance theme is switched off here
  await expectParts(page, { vars: 'instance', custom: '', gradient: '' });
});

test('Only on Auth Pages keeps parts off app pages', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance', { customCssAuthOnly: true, gradientAuthOnly: true }));
  const app = await openPage({ token: admin });
  await app.goto(BASE + '/');
  await loaderReady(app);
  await expectParts(app, { vars: 'instance', custom: '', gradient: '' }, 'app page');
  const auth = await openPage();
  await auth.goto(BASE + '/auth');
  await loaderReady(auth);
  await expectParts(auth, { vars: 'instance', custom: 'instance', gradient: 'instance' }, 'sign-in page');
});

test('signing in switches to the app\'s parts without a reload', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance', { customCssAuthOnly: true }));
  const page = await openPage();
  await page.goto(BASE + '/auth');
  await loaderReady(page);
  await expectParts(page, { custom: 'instance' }, 'sign-in page');
  await page.evaluate(() => { window.__tdpSamePage = true; });
  await signInWithForm(page, ADMIN);
  await expectParts(page, { vars: 'instance', custom: '' }, 'after signing in');
  if (!(await page.evaluate(() => window.__tdpSamePage === true))) throw new Error('the page reloaded');
});

test('a personal theme replaces the instance theme after signing in, custom CSS included', async ({ admin, user }) => {
  await saveTheme(admin, markerTheme('instance'));
  // No custom CSS of its own, so any --tdp-custom here leaked from the instance theme
  await saveTheme(user, markerTheme('personal', {}, ['custom']), true);
  const page = await openPage();
  await page.goto(BASE + '/auth');
  await loaderReady(page);
  await expectParts(page, { vars: 'instance', custom: 'instance' }, 'sign-in page');
  await signInWithForm(page, USER);
  await expectParts(page, { vars: 'personal', custom: '' }, 'after signing in');
  // A full load, as Open WebUI's own sign-out does
  await page.evaluate(() => localStorage.removeItem('token'));
  await page.goto(BASE + '/auth');
  await loaderReady(page);
  await expectParts(page, { vars: 'instance', custom: 'instance' }, 'after signing out');
  const kept = await page.evaluate(() => !!localStorage.getItem('owui_tdp_personal_css'));
  if (!kept) throw new Error('this browser\'s copy of the personal theme was dropped on sign-out');
  await removePersonalTheme(user);
});

test('a personal theme survives a reload and Use instance theme removes it', async ({ admin, user }) => {
  await saveTheme(admin, markerTheme('instance'));
  await saveTheme(user, markerTheme('personal', {}, ['custom']), true);
  const page = await openPage({ token: user });
  await page.goto(BASE + '/');
  await loaderReady(page);
  await expectParts(page, { vars: 'personal', custom: '' }, 'personal theme');
  await page.reload();
  await loaderReady(page);
  await expectParts(page, { vars: 'personal', custom: '' }, 'after a reload');
  await removePersonalTheme(user);
  // Pushed to the user's open page over the live connection
  await expectParts(page, { vars: 'instance', custom: 'instance' }, 'after Use instance theme');
});

test('Enable Auth Page Theming off keeps the sign-in page on Open WebUI\'s look', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  await setValves(admin, { enable_auth_page_theming: false });
  try {
    const page = await openPage();
    await page.goto(BASE + '/auth');
    await loaderReady(page);
    await expectParts(page, { vars: '', structural: '', gradient: '', custom: '' });
  } finally {
    await setValves(admin, {});
  }
});

test('a Canvas FX animation runs on app pages and not where it\'s hidden', async ({ admin }) => {
  const theme = markerTheme('instance', {
    canvasEnabled: true,
    canvasScript: 'self.onmessage = function () {};',
    canvasShowAuth: false,
  });
  await saveTheme(admin, theme);
  const app = await openPage({ token: admin });
  await app.goto(BASE + '/');
  await loaderReady(app);
  await waitFor('canvas on the app page', async () => !!(await app.$('#owui-theme-canvas-bg')) || 'missing');
  const auth = await openPage();
  await auth.goto(BASE + '/auth');
  await loaderReady(auth);
  await expectParts(auth, { vars: 'instance' }, 'sign-in page');
  await new Promise((r) => setTimeout(r, 1500));
  if (await auth.$('#owui-theme-canvas-bg')) throw new Error('the canvas runs on the sign-in page');
});

// Open WebUI's own shortcut for Settings, once the app listens for it
async function openSettings(page) {
  await waitFor('Settings to open', async () => {
    if (await page.$('#settings-tabs-container')) return true;
    await page.keyboard.press('Control+Period');
    await new Promise((r) => setTimeout(r, 750));
    return !!(await page.$('#settings-tabs-container')) || 'closed';
  });
}

test('Settings marks the Themes tab whose theme is in use', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  await removePersonalTheme(admin);
  const page = await openPage({ token: admin });
  await page.goto(BASE + '/');
  await loaderReady(page);
  await expectParts(page, { vars: 'instance' }, 'instance theme');
  await openSettings(page);
  await page.waitForSelector('#settings-tabs-container .tdp-settings-tab[data-tdp-key="admin"]', { timeout: WAIT_MS });
  const marks = () => page.evaluate(() => {
    const out = {};
    document.querySelectorAll('#settings-tabs-container .tdp-settings-tab').forEach((tab) => {
      out[tab.getAttribute('data-tdp-key')] = { dot: !!tab.querySelector('.tdp-theme-dot'), title: tab.getAttribute('title') || '' };
    });
    return out;
  });
  await waitFor('the admin tab marked', async () => {
    const m = await marks();
    return m.admin && m.admin.dot && m.personal && !m.personal.dot ? true : m;
  });
  // The admin's own theme, saved elsewhere, arrives live and moves the mark
  await saveTheme(admin, markerTheme('personal', {}, ['custom']), true);
  await expectParts(page, { vars: 'personal' }, 'personal theme');
  await waitFor('the personal tab marked', async () => {
    const m = await marks();
    return m.personal.dot && !m.admin.dot && /replaces this one/.test(m.admin.title) ? true : m;
  });
  await removePersonalTheme(admin);
});

test('a user without the Admin tab sees a ring for the instance theme', async ({ admin, user }) => {
  await saveTheme(admin, markerTheme('instance'));
  await removePersonalTheme(user);
  const page = await openPage({ token: user });
  await page.goto(BASE + '/');
  await loaderReady(page);
  await expectParts(page, { vars: 'instance' }, 'instance theme');
  await openSettings(page);
  const mark = () => page.evaluate(() => {
    const tabs = document.querySelectorAll('#settings-tabs-container .tdp-settings-tab');
    const tab = document.querySelector('#settings-tabs-container .tdp-settings-tab[data-tdp-key="personal"]');
    const dot = tab && tab.querySelector('.tdp-theme-dot');
    return { tabs: tabs.length, dot: !!dot, ring: !!dot && dot.classList.contains('tdp-theme-dot-instance') };
  });
  await waitFor('a ring on the user\'s Themes tab', async () => {
    const m = await mark();
    return m.tabs === 1 && m.dot && m.ring ? true : m;
  });
  await saveTheme(user, markerTheme('personal', {}, ['custom']), true);
  await expectParts(page, { vars: 'personal' }, 'personal theme');
  await waitFor('a dot once the user has a theme of their own', async () => {
    const m = await mark();
    return m.dot && !m.ring ? true : m;
  });
  await removePersonalTheme(user);
});

// The instance designer, opened the way the admin's browser opens it
async function openDesigner(admin) {
  const page = await openPage({ token: admin });
  // The designer page itself takes the sign-in cookie Open WebUI sets
  await page.context().addCookies([{ name: 'token', value: admin, url: BASE }]);
  await page.goto(BASE + ROUTE);
  await page.waitForSelector('#theme-designer-container', { timeout: WAIT_MS });
  // Let it settle: it saves the theme it opened with
  await new Promise((r) => setTimeout(r, 2500));
  return page;
}

// The instance theme's saved state, as the server delivers it
async function savedState(admin) {
  const res = await fetch(BASE + ROUTE + '/state.json', { headers: { Authorization: 'Bearer ' + admin }, cache: 'no-store' });
  return res.json();
}

// A theme whose modes run marker custom CSS and a marker Canvas FX script
const LIVE_CSS = 'html { --tdp-live: 1; }';
const LIVE_SCRIPT = 'self.onmessage = function () { /* tdp-live */ };';
function liveTheme(extra = {}) {
  const theme = markerTheme('instance', {
    customCssEnabled: true, customCSS: LIVE_CSS, autoScope: false,
    canvasEnabled: true, canvasScript: LIVE_SCRIPT,
  });
  const state = JSON.parse(theme.state);
  Object.assign(state, extra);
  return { ...theme, state: JSON.stringify(state) };
}

async function expectLiveThemeKept(admin, action) {
  // Long enough for the designer's debounced save to have landed
  await new Promise((r) => setTimeout(r, 3000));
  const state = await savedState(admin);
  const lost = MODES.filter((m) => !state[m] || state[m].customCSS !== LIVE_CSS || state[m].canvasScript !== LIVE_SCRIPT);
  if (lost.length) throw new Error(`${action} changed the live theme in ${lost.join(', ')}`);
}

test('Wipe CSS Snippets and Wipe Canvas Presets leave the live theme alone', async ({ admin }) => {
  await saveTheme(admin, liveTheme());
  const page = await openDesigner(admin);
  for (const kind of ['css', 'canvas']) {
    await page.evaluate((k) => document.getElementById('delete-all-' + k + '-btn').click(), kind);
    await page.waitForSelector('#confirm-delete-all-' + kind + '-btn', { state: 'visible', timeout: WAIT_MS });
    await page.click('#confirm-delete-all-' + kind + '-btn');
    await expectLiveThemeKept(admin, kind === 'css' ? 'Wipe CSS Snippets' : 'Wipe Canvas Presets');
  }
});

test('deleting the gallery theme a mode came from leaves the live theme alone', async ({ admin }) => {
  const fromFirst = { type: 'snapshot', id: 0 };
  const theme = liveTheme({ _activeThemeRef: { dark: fromFirst, oled: fromFirst, light: fromFirst, her: fromFirst } });
  await saveTheme(admin, theme);
  // The gallery entry every mode came from, in the instance library
  const modes = JSON.parse(theme.state);
  const entry = { name: 'Gallery entry', dark: modes.dark, light: modes.light, oled: modes.oled, her: modes.her };
  await api('POST', ROUTE, { css: '', state: '', library: JSON.stringify({ snapshots: [entry] }) }, admin);
  const page = await openDesigner(admin);
  const count = await page.evaluate(() => JSON.parse(localStorage.getItem('owui_theme_snapshots') || '[]').length);
  if (!count) throw new Error('the gallery is empty, nothing to delete');
  await page.evaluate(() => window.requestDelete(0));
  await page.waitForSelector('#confirm-delete-btn', { state: 'visible', timeout: WAIT_MS });
  await page.click('#confirm-delete-btn');
  await expectLiveThemeKept(admin, 'Deleting the gallery theme');
});

test('the designer opens without errors and with nothing to undo', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  const page = await openDesigner(admin);
  // Undo as far as it goes: the history used to start from defaults or an
  // old copy of the theme, and undoing back to it published that
  const theme = () => page.evaluate(() => JSON.parse(localStorage.getItem('owui_dev_theme_v1') || '{}').dark || null);
  const before = JSON.stringify(await theme());
  for (let i = 0; i < 10 && await page.$eval('#undo-btn', (b) => !b.disabled); i++) {
    await page.click('#undo-btn');
    await new Promise((r) => setTimeout(r, 400));
  }
  if (JSON.stringify(await theme()) !== before) throw new Error('Undo right after opening changed the theme');
  // With personal themes on, an instance save reaches only people without one
  const tip = await page.$eval('#inactive-badge', (b) => b.getAttribute('data-tooltip') || '');
  if (!/using a theme of their own/.test(tip)) throw new Error('the badge says a save reaches: ' + tip);
  if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
});

// ── The theme format (schemas/theme-format.md) ──
// A theme file goes through the Studio and the designer, and each must read
// it the way the other wrote it.

const REPO_ROOT = path.join(__dirname, '..', '..');
const RAW = 'https://raw.githubusercontent.com/silentoplayz/theme-designer-pro-presets/main/';
const FIXTURES = 'tests/theme-format/fixtures';

// The site in docs/, on a free local port
function serveSite() {
  const http = require('http');
  const docs = path.join(REPO_ROOT, 'docs');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    let file = path.join(docs, path.normalize(decodeURIComponent(new URL(req.url, BASE).pathname)));
    if (file.endsWith(path.sep)) file = path.join(file, 'index.html');
    if (!file.startsWith(docs + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// The Studio reads presets from this repository on GitHub: it gets this
// checkout's copies instead, fixtures included
async function openStudio() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route(RAW + '**', (route) => {
    const file = path.join(REPO_ROOT, path.normalize(route.request().url().slice(RAW.length).split('?')[0]));
    if (!file.startsWith(REPO_ROOT + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404 });
    return route.fulfill({ status: 200, body: fs.readFileSync(file), headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  return page;
}

async function download(page, start, what) {
  const [file] = await Promise.all([
    page.waitForEvent('download', { timeout: WAIT_MS }).catch(() => { throw new Error('no download of ' + what); }),
    start(),
  ]);
  return JSON.parse(fs.readFileSync(await file.path(), 'utf8'));
}

// What the Studio's Download button gives for each address (#preset=,
// #theme=, #gradient= or #fx=)
async function studioDownloads(site, hashes) {
  const page = await openStudio();
  const out = [];
  for (const [i, hash] of hashes.entries()) {
    // A new query each time, so the page loads again rather than only its hash changing
    await page.goto(`${site}/studio/?n=${i}#${hash}`);
    await page.waitForFunction(() => {
      const note = document.getElementById('preset-note');
      return document.getElementById('preset').options.length > 1 &&
        (note.classList.contains('hidden') || /^(Started from|Previewing)/.test(note.textContent));
    }, null, { timeout: WAIT_MS });
    // Gradients and scripts apply after the preset
    await new Promise((r) => setTimeout(r, 300));
    // A theme started from nothing is named after what built it
    if (!/^(preset|theme)=/.test(hash)) await page.fill('#name', 'Built from ' + hash);
    out.push(await download(page, () => page.evaluate(() => document.getElementById('download').click()), 'the Studio\'s #' + hash));
  }
  if (page.errors.length) throw new Error('Studio page errors: ' + page.errors.join(' | '));
  return out;
}

// Drops the themes on the designer, the way a person drops downloaded files,
// and exports each one from its gallery
async function throughDesigner(admin, themes) {
  // An empty gallery, so none is skipped as a duplicate
  await api('POST', ROUTE, { css: '', state: '', library: JSON.stringify({ snapshots: [] }) }, admin);
  const page = await openDesigner(admin);
  // The Canvas FX question before a theme with a script is applied
  page.on('dialog', (d) => d.accept());
  await page.evaluate((files) => {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(new File([f.text], f.name, { type: 'application/json' })));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, themes.map((t, i) => ({ name: `theme-${i}.json`, text: JSON.stringify(t) })));
  const count = () => page.evaluate(() => JSON.parse(localStorage.getItem('owui_theme_snapshots') || '[]').length);
  await waitFor('themes in the gallery', async () => (await count()) === themes.length || `${await count()} of ${themes.length}`);
  // Each export as the file it would download: Chrome stops a page's
  // downloads after the first ten in a row
  await page.evaluate(() => {
    const make = URL.createObjectURL;
    URL.createObjectURL = (blob) => { window.__tdpBlob = blob; return make.call(URL, blob); };
  });
  const out = [];
  for (let i = 0; i < themes.length; i++) {
    const text = await page.evaluate(async (n) => {
      window.__tdpBlob = null;
      window.exportSnapshot(n);
      return window.__tdpBlob ? window.__tdpBlob.text() : null;
    }, i);
    if (!text) throw new Error('no export of gallery theme ' + i);
    out.push(JSON.parse(text));
  }
  if (page.errors.length) throw new Error('designer page errors: ' + page.errors.join(' | '));
  // Closed, so it can't save its gallery over the next round's
  await page.context().close();
  return out;
}

// Paths where two values differ. null and false read the same for a switch
// (older builds wrote null), and key order doesn't matter.
function differences(a, b, at = '', out = []) {
  if (out.length >= 8) return out;
  if ((a === null || a === false) && (b === null || b === false)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach((k) => differences(a[k], b[k], at + '.' + k, out));
  } else if (a !== b) {
    out.push(`${at || '(root)'}: ${JSON.stringify(a)?.slice(0, 60)} vs ${JSON.stringify(b)?.slice(0, 60)}`);
  }
  return out;
}

const META = ['name', 'description', 'author', 'version', 'targetVersion', 'repositoryUrl', 'updateUrl'];
const metaOf = (t) => Object.fromEntries(META.map((k) => [k, t[k] || '']));
const modesOf = (t) => Object.fromEntries(MODES.map((m) => [m, t[m]]));

test('a theme file keeps every setting through the Studio and the designer', async ({ admin }) => {
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
  const fixtures = fs.readdirSync(path.join(REPO_ROOT, FIXTURES)).filter((f) => f.endsWith('.json')).map((f) => `${FIXTURES}/${f}`);
  const gallery = fs.readdirSync(path.join(REPO_ROOT, 'themes')).filter((f) => f.endsWith('.json'));
  const originals = [...fixtures.map(read), ...gallery.map((f) => read('themes/' + f))];
  const catalog = read('docs/catalog.json');
  const built = [
    ...['mesh', 'radial'].map((type) => ({ type, hash: 'gradient=' + catalog.gradients.find((g) => g.type === type).file })),
    { hash: 'fx=' + catalog.canvasFx[0].file },
  ];
  const hashes = [
    ...fixtures.map((f) => 'theme=' + encodeURIComponent(RAW + f)),
    ...gallery.map((f) => 'preset=' + encodeURIComponent(f)),
    ...built.map((b) => b.hash),
  ];

  const server = await serveSite();
  let fromStudio;
  try {
    fromStudio = await studioDownloads(`http://127.0.0.1:${server.address().port}`, hashes);
  } finally {
    server.close();
  }
  const direct = await throughDesigner(admin, originals);
  const viaStudio = await throughDesigner(admin, fromStudio);
  const again = await throughDesigner(admin, direct);

  const failures = [];
  const check = (label, diffs) => { if (diffs.length) failures.push(`${label}\n          ${diffs.join('\n          ')}`); };
  const byName = (list) => new Map(list.map((t) => [t.name, t]));
  const directByName = byName(direct);
  const viaStudioByName = byName(viaStudio);
  const againByName = byName(again);

  // The designer keeps every value a complete, valid file has
  const every = originals[fixtures.findIndex((f) => f.endsWith('every-field.json'))];
  check('the designer changed the every-field fixture', differences(every, directByName.get(every.name)));

  originals.forEach((t, i) => {
    const d = directByName.get(t.name);
    if (!d) return failures.push(`the designer didn't export ${t.name}`);
    // What the designer wrote, it reads back unchanged
    const a = againByName.get(t.name);
    check(`${t.name}: the designer changed its own export`, a ? differences(d, a) : ['not exported']);
    // The Studio reads a file the way the designer does
    const s = viaStudioByName.get(fromStudio[i].name);
    check(`${t.name}: through the Studio, the designer got different modes`, s ? differences(modesOf(d), modesOf(s)) : ['not exported']);
  });

  // The themes built in the Studio carry what built them
  fromStudio.slice(originals.length).forEach((s, i) => {
    const kind = built[i].hash.split('=')[0];
    const ok = MODES.every((m) => kind === 'fx' ? s[m].canvasEnabled && s[m].canvasScript : s[m].gradientEnabled && s[m].gradientType === built[i].type);
    if (!ok) failures.push(`the Studio's download from #${built[i].hash} doesn't have its ${kind === 'fx' ? 'script' : 'gradient'} in every mode`);
  });

  // The designer keeps every value the Studio wrote, its metadata included
  fromStudio.forEach((s) => {
    const d = viaStudioByName.get(s.name);
    check(`${s.name}: the designer changed the Studio's file`, d ? differences({ ...metaOf(s), ...modesOf(s) }, { ...metaOf(d), ...modesOf(d) }) : ['not exported']);
  });

  // Every file either side wrote is valid against the schema
  const Ajv = require('ajv');
  const ajv = new Ajv({ allErrors: true, strict: false });
  require('ajv-formats')(ajv);
  const valid = ajv.compile(read('schemas/theme.schema.json'));
  [...fromStudio, ...direct].forEach((t) => {
    if (!valid(t)) failures.push(`${t.name} doesn't match the schema: ${ajv.errorsText(valid.errors)}`);
  });

  if (failures.length) throw new Error(`${failures.length} problems:\n        ${failures.join('\n        ')}`);
});

// ── Run ──

(async () => {
  const { chromium } = require('playwright-core');
  console.log(`Open WebUI at ${BASE}`);
  const health = await fetch(BASE + '/health').catch(() => null);
  if (!health || !health.ok) throw new Error('Open WebUI is not up at ' + BASE);
  const tokens = await setUpAccounts();
  await installFunction(tokens.admin);
  browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const only = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null;
  let failed = 0;
  for (const t of tests) {
    if (only && !only.test(t.name)) continue;
    const started = Date.now();
    try {
      await t.fn(tokens);
      console.log(`  ok    ${t.name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    } catch (e) {
      failed++;
      console.log(`  FAIL  ${t.name}\n        ${e.message}`);
    } finally {
      for (const context of browser.contexts()) await context.close();
    }
  }
  await browser.close();
  console.log(failed ? `\n${failed} failed` : '\nAll passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
