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

test('Settings marks the Themes tab whose theme is in use', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  await removePersonalTheme(admin);
  const page = await openPage({ token: admin });
  await page.goto(BASE + '/');
  await loaderReady(page);
  await expectParts(page, { vars: 'instance' }, 'instance theme');
  // Open WebUI's own shortcut for Settings, once the app listens for it
  await waitFor('Settings to open', async () => {
    if (await page.$('#settings-tabs-container')) return true;
    await page.keyboard.press('Control+Period');
    await new Promise((r) => setTimeout(r, 750));
    return !!(await page.$('#settings-tabs-container')) || 'closed';
  });
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
  if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
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
