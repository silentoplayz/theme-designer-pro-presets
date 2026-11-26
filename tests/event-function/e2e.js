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
  // Open WebUI shows an admin its What's New window until this is saved, and
  // that window takes the keystrokes a test types into a chat
  const { version } = (await api('GET', '/api/config')).json;
  await api('POST', '/api/v1/users/user/settings/update', { ui: { version } }, admin);
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
    { allow_personal_themes: true, auto_sync: false, ...valves }, admin);
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

test('a personal save before a page claims its stream still reaches it, and nothing is fetched twice', async ({ admin, user }) => {
  await saveTheme(admin, markerTheme('instance'));
  await removePersonalTheme(user);
  // Held until the save below has landed, so the save reaches no stream
  let release;
  const held = new Promise((r) => { release = r; });
  const page = await openPage({ token: user });
  await page.route('**/events/bind', async (route) => { await held; await route.continue(); });
  await page.goto(BASE + '/');
  await loaderReady(page);
  await expectParts(page, { vars: 'instance' });
  await saveTheme(user, markerTheme('mine'), true);
  release();
  await expectParts(page, { vars: 'mine' }, 'the personal save made before the claim');

  // With nothing saved in between, the claim fetches nothing again
  const fresh = await openPage({ token: user });
  let reads = 0;
  fresh.on('request', (r) => { if (r.url().endsWith('/me/theme.css')) reads++; });
  const bound = fresh.waitForResponse((r) => r.url().endsWith('/events/bind'), { timeout: WAIT_MS });
  await fresh.goto(BASE + '/');
  await bound;
  await expectParts(fresh, { vars: 'mine' });
  await new Promise((r) => setTimeout(r, 1500));
  await removePersonalTheme(user);
  if (reads !== 1) throw new Error(`the personal theme was fetched ${reads} times on one load`);
});

// A proxy that compresses a response itself hands its ETag on as W/"..."
const THEME_ASSETS = ['/theme.css', '/state.json', '/me/theme.css', '/me/state.json'];
async function weakenThemeTags(page) {
  await page.route((url) => THEME_ASSETS.some((a) => url.pathname === ROUTE + a), async (route) => {
    const res = await route.fetch();
    const headers = res.headers();
    if (headers.etag) headers.etag = 'W/' + headers.etag;
    await route.fulfill({ response: res, headers });
  });
}

test('a weakened ETag still gets a 304, and a page holding one refetches nothing it already has', async ({ admin, user }) => {
  await saveTheme(admin, markerTheme('instance'));
  await removePersonalTheme(admin);
  await saveTheme(user, markerTheme('mine'), true);
  try {
    for (const asset of THEME_ASSETS) {
      const auth = { Authorization: 'Bearer ' + user };
      const first = await fetch(BASE + ROUTE + asset, { headers: auth });
      const tag = first.headers.get('etag');
      if (!tag) throw new Error(asset + ' sent no ETag');
      const again = await fetch(BASE + ROUTE + asset, { headers: { ...auth, 'If-None-Match': 'W/' + tag } });
      if (again.status !== 304) throw new Error(`${asset} answered ${again.status} to W/${tag}`);
    }

    // The bind answer names the personal theme by its strong tags
    const mine = await openPage({ token: user });
    await weakenThemeTags(mine);
    let personalReads = 0;
    mine.on('request', (r) => { if (r.url().endsWith('/me/theme.css')) personalReads++; });
    const bound = mine.waitForResponse((r) => r.url().endsWith('/events/bind'), { timeout: WAIT_MS });
    await mine.goto(BASE + '/');
    await bound;
    await expectParts(mine, { vars: 'mine' });
    await new Promise((r) => setTimeout(r, 1500));
    if (personalReads !== 1) throw new Error(`the personal theme was fetched ${personalReads} times on one load`);

    // A save that changes only the gallery broadcasts the tags the page already holds
    const page = await openPage({ token: admin });
    await weakenThemeTags(page);
    await page.goto(BASE + '/');
    await loaderReady(page);
    await expectParts(page, { vars: 'instance' });
    await new Promise((r) => setTimeout(r, 1500));
    let reads = 0;
    page.on('request', (r) => { if (r.url().endsWith(ROUTE + '/theme.css')) reads++; });
    await saveTheme(admin, { ...markerTheme('instance'), library: JSON.stringify({ snapshots: [], saved: Date.now() }) });
    await new Promise((r) => setTimeout(r, 3000));
    if (reads) throw new Error(`a broadcast of the theme on screen refetched it ${reads} times`);
  } finally {
    await removePersonalTheme(user);
  }
});

// The designer asks in its own dialog: a browser can stop a page's native
// dialogs, and then confirm() answers no without showing anything
async function silenceNativeDialogs(page) {
  await page.evaluate(() => { window.confirm = () => false; });
}

async function answerAsk(page) {
  await page.waitForSelector('#ask-modal', { state: 'visible', timeout: WAIT_MS });
  await page.click('#ask-modal-confirm-btn');
}

test('Use instance theme works with the browser\'s dialogs turned off', async ({ admin, user }) => {
  await saveTheme(admin, markerTheme('instance'));
  await saveTheme(user, markerTheme('personal', {}, ['custom']), true);
  const page = await openPage({ token: user });
  await page.context().addCookies([{ name: 'token', value: user, url: BASE }]);
  await page.goto(BASE + ROUTE + '?embed=settings&scope=me');
  await page.waitForSelector('#tdp-use-instance-btn', { state: 'visible', timeout: WAIT_MS });
  await silenceNativeDialogs(page);
  // Settled now, so a failure before it is awaited stays a failed test, not a crash
  const reloaded = page.waitForEvent('load', { timeout: WAIT_MS }).catch((e) => e);
  await page.click('#tdp-use-instance-btn');
  await answerAsk(page);
  const load = await reloaded;
  if (load instanceof Error) throw load;
  const app = await openPage({ token: user });
  await app.goto(BASE + '/');
  await loaderReady(app);
  await expectParts(app, { vars: 'instance', custom: 'instance' }, 'after Use instance theme');
});

test('Update All asks once and installs every update with the browser\'s dialogs turned off', async ({ admin }) => {
  const script = 'self.onmessage = function () {};';
  const old = (name) => ({ name, version: '1.0.0', updateUrl: 'https://example.test/' + name + '.json', ...JSON.parse(markerTheme(name).state) });
  const remote = (name) => ({ ...old(name), version: '2.0.0', ...Object.fromEntries(MODES.map((m) => [m, { ...JSON.parse(markerTheme(name).state)[m], canvasEnabled: true, canvasScript: script }])) });
  await api('POST', ROUTE, { css: '', state: '', library: JSON.stringify({ snapshots: [old('first'), old('second')] }) }, admin);
  const page = await openDesigner(admin);
  await silenceNativeDialogs(page);
  await page.evaluate((updates) => {
    window._pendingBatchIndices = [0, 1];
    window._pendingBatchUpdates = { 0: updates[0], 1: updates[1] };
    window._pendingBatchMeta = {};
  }, [remote('first'), remote('second')]);
  const done = page.evaluate(() => window.applyAllBatchUpdates()).catch((e) => e);
  await answerAsk(page);
  const result = await done;
  if (result instanceof Error) throw result;
  const asked = await page.evaluate(() => document.getElementById('ask-modal').style.display);
  if (asked === 'flex') throw new Error('the designer asked again after the batch question');
  await waitFor('both themes updated', async () => {
    const res = await api('GET', ROUTE + '/library.json', undefined, admin);
    const snaps = (res.json && res.json.snapshots) || [];
    const versions = snaps.map((t) => t.version);
    return (versions.length === 2 && versions.every((v) => v === '2.0.0')) || versions;
  });
  await page.context().close();
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

test('Surfaces glaze the Settings window but not a shared chat\'s messages', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  const designer = await openDesigner(admin);
  await designer.evaluate(() => {
    document.getElementById('toggle-surfaces').click();
    ['surfaceMenuOpacity', 'surfaceDialogOpacity'].forEach((f) => { const s = document.getElementById('sl-' + f); s.value = '25'; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); });
    ['surfaceMenuBlur', 'surfaceDialogBlur'].forEach((f) => { const s = document.getElementById('sl-' + f); s.value = '20'; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); });
  });
  await waitFor('the glass saved', async () => (await savedState(admin)).dark?.surfaceDialogBlur === 20 || 'not yet');
  await designer.context().close();
  try {
    const now = Math.floor(Date.now() / 1000);
    const message = { id: 'm1', parentId: null, childrenIds: [], role: 'user', content: 'A shared message', timestamp: now };
    const made = await api('POST', '/api/v1/chats/new', { chat: { title: 'Shared', history: { messages: { m1: message }, currentId: 'm1' }, messages: [message] } }, admin);
    const shared = await api('POST', `/api/v1/chats/${made.json.id}/share`, undefined, admin);
    if (!shared.json || !shared.json.share_id) throw new Error('Could not share a chat: ' + shared.status);
    // A shared chat sits outside .app, in SvelteKit's page wrapper, which isn't an overlay
    const page = await openPage({ token: admin });
    await page.goto(`${BASE}/s/${shared.json.share_id}`);
    await loaderReady(page);
    await page.waitForSelector('.chat-user .rounded-3xl', { timeout: WAIT_MS });
    await new Promise((r) => setTimeout(r, 1000));
    const bubble = await page.evaluate(() => getComputedStyle(document.querySelector('.chat-user .rounded-3xl')).backdropFilter);
    if (bubble !== 'none') throw new Error('the shared chat\'s message is glazed: ' + bubble);
    const app = await openPage({ token: admin });
    await app.goto(BASE + '/');
    await loaderReady(app);
    await openSettings(app);
    await waitFor('a glazed Settings window', () => app.evaluate(() =>
      Array.from(document.querySelectorAll('body *')).some((e) => !e.closest('.app') && getComputedStyle(e).backdropFilter !== 'none') || 'none glazed'));
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

test('a Canvas FX cleanup that throws still lets the rest of the teardown run', async ({ admin }) => {
  // `document` sends the script to the main thread, where it can reach the cleanup list
  const script = [
    'void document;',
    'window.owuiCanvasCleanups.push(function () { throw new Error("cleanup throws"); });',
    'window.owuiCanvasCleanups.push(function () { window.__tdpLaterCleanupRan = true; });',
    'self.onmessage = function () {};',
  ].join('\n');
  await saveTheme(admin, markerTheme('fallback', { canvasEnabled: true, canvasScript: script }));
  const page = await openPage({ token: admin });
  await page.goto(BASE + '/');
  await loaderReady(page);
  await waitFor('the main-thread script running', () => page.evaluate(() =>
    !!document.getElementById('owui-canvas-script-runner') && typeof window.__owuiFbHandler === 'function' || 'not running'));
  await saveTheme(admin, markerTheme('plain', { canvasEnabled: false }));
  await expectParts(page, { vars: 'plain' }, 'the new theme');
  await waitFor('the teardown', () => page.evaluate(() => {
    const left = ['owui-theme-canvas-bg', 'owui-canvas-script-runner', 'owui-theme-bg-color'].filter((id) => document.getElementById(id));
    const out = { laterCleanupRan: window.__tdpLaterCleanupRan === true, left, handlerKept: '__owuiFbHandler' in window };
    return out.laterCleanupRan && !left.length && !out.handlerKept ? true : out;
  }));
});

test('Canvas FX follows the valve in a browser that opened a designer while it was off', async ({ admin, user }) => {
  const fx = { canvasEnabled: true, canvasScript: 'self.onmessage = function () {};' };
  const canvasUp = (page) => async () => !!(await page.$('#owui-theme-canvas-bg')) || 'missing';
  const designers = [
    { name: 'instance', token: admin, url: ROUTE, state: ROUTE + '/state.json' },
    { name: 'personal', token: user, url: ROUTE + '?scope=me', state: ROUTE + '/me/state.json' },
  ];
  let app;
  try {
    for (const d of designers) {
      await removePersonalTheme(admin);
      await removePersonalTheme(user);
      await saveTheme(admin, markerTheme('instance', d.name === 'instance' ? fx : {}));
      if (d.name === 'personal') await saveTheme(user, markerTheme('personal', fx), true);
      await setValves(admin, { enable_canvas_fx: false });
      const designer = await openPage({ token: d.token });
      await designer.context().addCookies([{ name: 'token', value: d.token, url: BASE }]);
      await designer.goto(BASE + d.url);
      await designer.waitForSelector('#theme-designer-container', { timeout: WAIT_MS });
      // Let it settle: it saves the theme it opened with
      await new Promise((r) => setTimeout(r, 2500));
      await setValves(admin, { enable_canvas_fx: true });
      // Same browser, without opening the designer again
      app = await designer.context().newPage();
      await designer.close();
      await app.goto(BASE + '/');
      await loaderReady(app);
      await waitFor(`the canvas on the app page after the ${d.name} designer`, canvasUp(app));
      // The designer must not have saved the theme with its animation off
      await waitFor(`Canvas FX on in the saved ${d.name} theme`, async () => {
        const res = await fetch(BASE + d.state, { headers: { Authorization: 'Bearer ' + d.token }, cache: 'no-store' });
        const saved = await res.json();
        return MODES.every((m) => saved[m].canvasEnabled && saved[m].canvasScript) || saved.dark;
      });
    }
    // A flag an older version left in this browser is cleared on the next page
    await app.evaluate(() => localStorage.setItem('owui_theme_valve_no_canvas', 'true'));
    await app.reload();
    await loaderReady(app);
    if (await app.evaluate(() => localStorage.getItem('owui_theme_valve_no_canvas') !== null)) throw new Error('the old flag was left in storage');
    await waitFor('the canvas after the old flag', canvasUp(app));

    // This browser's copy of the personal theme still carries the script. Signed
    // out with the valve off, then signing in without a page load must not run it.
    // Its pages re-add the token on load, so a signed-out page gets the copy
    const copy = await app.evaluate(() => Object.fromEntries(['owui_tdp_personal_css', 'owui_tdp_personal_state', 'owui_tdp_personal_uid']
      .map((k) => [k, localStorage.getItem(k)])));
    if (!copy.owui_tdp_personal_state || !copy.owui_tdp_personal_state.includes('canvasScript')) throw new Error('no copy of the personal theme with its script');
    await setValves(admin, { enable_canvas_fx: false });
    app = await openPage();
    await app.goto(BASE + '/auth');
    await app.evaluate((c) => Object.entries(c).forEach(([k, v]) => localStorage.setItem(k, v)), copy);
    await app.reload();
    await loaderReady(app);
    await new Promise((r) => setTimeout(r, 1500));
    await app.evaluate(() => {
      window.tdpCanvasSeen = false;
      new MutationObserver(() => {
        if (document.getElementById('owui-theme-canvas-bg')) window.tdpCanvasSeen = true;
      }).observe(document.documentElement, { childList: true, subtree: true });
    });
    await signInWithForm(app, USER);
    await new Promise((r) => setTimeout(r, 2000));
    if (await app.evaluate(() => window.tdpCanvasSeen)) throw new Error('the switched-off personal script ran after signing in');
  } finally {
    await setValves(admin, {});
    await removePersonalTheme(user);
    await saveTheme(admin, markerTheme('instance'));
  }
});

test('a Canvas FX animation draws no frames while the page gets none', async ({ admin }) => {
  // Counts its frames and reports them, and any message it shouldn't see, to the page
  const script = [
    'var frames = 0, channel = new BroadcastChannel("tdp-frames");',
    'function tick() { frames++; requestAnimationFrame(tick); }',
    'self.onmessage = function (e) {',
    '  if (e.data && e.data.type === "init") requestAnimationFrame(tick);',
    '  if (e.data && e.data.type === "owui-hold-frames") channel.postMessage("seen");',
    '};',
    'setInterval(function () { channel.postMessage(frames); }, 100);',
  ].join('\n');
  await saveTheme(admin, markerTheme('instance', { canvasEnabled: true, canvasScript: script }));
  const page = await openPage({ token: admin });
  await page.goto(BASE + '/');
  await loaderReady(page);
  await page.evaluate(() => {
    window.tdpFrames = 0;
    window.tdpSeen = false;
    new BroadcastChannel('tdp-frames').onmessage = (e) => {
      if (e.data === 'seen') window.tdpSeen = true;
      else window.tdpFrames = e.data;
    };
  });
  const frames = () => page.evaluate(() => window.tdpFrames);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // A hidden tab, and a window covered by another app: Firefox calls the
  // second visible, but the page gets no frames until it's uncovered
  const ways = {
    hidden: (on) => page.evaluate((h) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    }, on),
    covered: (on) => page.evaluate((c) => {
      if (c) {
        window.tdpHeldFrames = [];
        window.tdpRaf = window.requestAnimationFrame;
        window.requestAnimationFrame = (cb) => { window.tdpHeldFrames.push(cb); return 0; };
      } else {
        window.requestAnimationFrame = window.tdpRaf;
        window.tdpHeldFrames.forEach((cb) => window.requestAnimationFrame(cb));
      }
    }, on),
  };
  for (const [way, set] of Object.entries(ways)) {
    const before = await frames();
    await waitFor(`frames on screen, before ${way}`, async () => (await frames()) > before + 10 || await frames());
    await set(true);
    await wait(1000);
    const heldAt = await frames();
    await wait(1500);
    const drawn = (await frames()) - heldAt;
    if (drawn > 0) throw new Error(`the script drew ${drawn} frames while the page was ${way}`);
    await set(false);
    await waitFor(`frames again once no longer ${way}`, async () => (await frames()) > heldAt + 10 || await frames());
  }
  if (await page.evaluate(() => window.tdpSeen)) throw new Error('the script received the message that holds its frames');
});

// Counts the layout reads and timer callbacks the bootloader makes on a page,
// leaving out the two that run while an animation draws: the loop that hands
// the worker its input each frame, and the check that holds its frames
async function countBootloaderWork(page) {
  await page.context().addInitScript(() => {
    const ours = () => /\/static\/loader\.js/.test(new Error().stack || '');
    const work = window.tdpWork = { rects: 0, timers: 0, lastRoute: 0 };
    // The bootloader looks at the page again for 10s after each of these
    ['owui-tdp-route', 'popstate'].forEach((e) => window.addEventListener(e, () => { work.lastRoute = performance.now(); }));
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (ours()) work.rects++;
      return rect.apply(this, arguments);
    };
    ['setTimeout', 'setInterval', 'requestAnimationFrame'].forEach((name) => {
      const original = window[name];
      window[name] = function (fn, ...rest) {
        if (typeof fn === 'function' && ours() && !['_sendInput', '_syncFrames'].includes(fn.name)) {
          const run = fn;
          fn = function () { work.timers++; return run.apply(this, arguments); };
        }
        return original.call(window, fn, ...rest);
      };
    });
  });
}

// A Canvas FX script that hands the page every message it gets
// Naming "context" turns on the chat context channel
const RELAY_SCRIPT = 'var relay = new BroadcastChannel("tdp-relay"), READS = ["context"];\n' +
  'self.onmessage = function (e) { if (e.data && e.data.type) relay.postMessage(JSON.parse(JSON.stringify(e.data, function (k, v) { return k === "canvas" ? undefined : v; }))); };';

async function listenToRelay(page) {
  await page.evaluate(() => {
    window.tdpRelay = [];
    new BroadcastChannel('tdp-relay').onmessage = (e) => window.tdpRelay.push({ at: performance.now(), ...e.data });
  });
}

function lastRelayed(page, type) {
  return page.evaluate((t) => {
    const all = window.tdpRelay.filter((m) => m.type === t);
    return all.length ? all[all.length - 1] : null;
  }, type);
}

async function makeChat(admin, title, count) {
  const now = Math.floor(Date.now() / 1000);
  const messages = {};
  const ids = [];
  for (let i = 0; i < count; i++) {
    const id = `${title}-${i}`;
    const role = i % 2 ? 'assistant' : 'user';
    messages[id] = { id, parentId: ids[i - 1] || null, childrenIds: [], role, content: `${role} message ${i} of ${title}`, timestamp: now, ...(role === 'assistant' ? { model: 'none', done: true } : {}) };
    if (i) messages[ids[i - 1]].childrenIds.push(id);
    ids.push(id);
  }
  const made = await api('POST', '/api/v1/chats/new', { chat: { title, history: { messages, currentId: ids[ids.length - 1] }, messages: ids.map((id) => messages[id]) } }, admin);
  if (!made.json || !made.json.id) throw new Error('Could not make a chat: ' + made.status);
  return made.json.id;
}

test('a running Canvas FX reads no layout and runs no timers while a page sits idle', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance', { canvasEnabled: true, canvasScript: 'self.onmessage = function () {};' }));
  const chat = await makeChat(admin, 'idle', 2);
  const pages = [];
  // Open WebUI sends /workspace on to /workspace/models once its API calls finish
  for (const [where, final] of [['/c/' + chat, '/c/' + chat], ['/workspace', '/workspace/models']]) {
    const page = await openPage({ token: admin });
    await countBootloaderWork(page);
    await page.goto(BASE + where);
    pages.push({ where, final, page });
  }
  for (const { where, final, page } of pages) {
    await loaderReady(page);
    await waitFor(`the canvas on ${where}`, async () => !!(await page.$('#owui-theme-canvas-bg')) || 'missing');
    await page.waitForURL((url) => url.pathname === final, { timeout: WAIT_MS });
  }
  const read = () => Promise.all(pages.map(({ page }) => page.evaluate(() => ({ ...window.tdpWork, now: performance.now() }))));
  // A quiet 5s that starts 11s after the last route change on both pages and
  // has none in it
  let before, after;
  for (let tries = 0; ; tries++) {
    if (tries === 5) throw new Error('the pages kept changing route: ' + JSON.stringify(after));
    before = await read();
    const wait = Math.max(0, ...before.map((w) => w.lastRoute + 11000 - w.now));
    if (wait) { await new Promise((r) => setTimeout(r, wait)); continue; }
    await new Promise((r) => setTimeout(r, 5000));
    after = await read();
    if (after.every((w, i) => w.lastRoute === before[i].lastRoute)) break;
  }
  const busy = pages.map(({ where }, i) => ({ where, rects: after[i].rects - before[i].rects, timers: after[i].timers - before[i].timers }))
    .filter((w) => w.rects || w.timers);
  if (busy.length) throw new Error('the bootloader worked on an idle page in 5s: ' + JSON.stringify(busy));
});

test('the calm column follows the sidebar and Widescreen Mode', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance', { canvasEnabled: true, canvasScript: RELAY_SCRIPT }));
  const chat = await makeChat(admin, 'column', 2);
  const page = await openPage({ token: admin });
  await page.goto(BASE + '/c/' + chat);
  await loaderReady(page);
  await listenToRelay(page);
  await page.waitForSelector('#message-input-container', { timeout: WAIT_MS });
  await new Promise((r) => setTimeout(r, 1500));
  const column = async () => {
    const m = await lastRelayed(page, 'layout');
    return m && m.column;
  };
  const measured = () => page.evaluate(() => {
    const r = document.getElementById('message-input-container').getBoundingClientRect();
    const p = document.getElementById('chat-container').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), left: Math.max(0, Math.round(p.left)) };
  });
  // Each toggle must reach the script well inside the second a poll would take
  const delays = [];
  for (let i = 0; i < 3; i++) {
    const was = await measured();
    const start = await page.evaluate(() => performance.now());
    await page.keyboard.press('Control+Shift+KeyS');
    await waitFor(`the sidebar toggle ${i + 1} moving the chat`, async () => {
      const now = await measured();
      return now.left !== was.left || now;
    });
    await waitFor(`the column after sidebar toggle ${i + 1}`, async () => {
      const [c, now] = [await column(), await measured()];
      return !!c && Math.abs(c.left - now.left) < 3 && Math.abs(c.x - now.x) < 3 || { column: c, page: now };
    });
    const first = await page.evaluate((t) => {
      const m = window.tdpRelay.find((x) => x.type === 'layout' && x.at > t);
      return m ? Math.round(m.at - t) : null;
    }, start);
    delays.push(first);
    await new Promise((r) => setTimeout(r, 400));
  }
  if (delays.some((d) => d === null || d > 300)) throw new Error('the column reached the script late after a sidebar toggle (ms): ' + JSON.stringify(delays));
  // Widescreen Mode widens the input pill with nothing else moving, in a
  // window wide enough that the column isn't narrowed to leave margins
  await page.setViewportSize({ width: 1920, height: 1000 });
  await waitFor('the column in a wider window', async () => {
    const [c, now] = [await column(), await measured()];
    return !!c && Math.abs(c.x - now.x) < 3 || { column: c, page: now };
  });
  await expectColumnFollowsWidescreen(page, column);
});

// Flips Widescreen Mode in Settings and back, which is saved to the account,
// and expects the column's width to follow each time
async function expectColumnFollowsWidescreen(page, column) {
  const widthBefore = (await column()).width;
  await openSettings(page);
  await page.click('#settings-tabs-container button:has-text("Interface")');
  const toggle = page.locator('button[aria-labelledby="widescreen-mode-label"]');
  await toggle.waitFor({ timeout: WAIT_MS });
  for (const step of ['on', 'back']) {
    const was = (await column()).width;
    await toggle.click();
    await waitFor(`the column after Widescreen Mode ${step}`, async () => {
      const c = await column();
      return Math.abs(c.width - was) > 3 || c;
    }, 3000);
  }
  if (Math.abs((await column()).width - widthBefore) > 3) throw new Error('Widescreen Mode twice left the column a different width');
}

test('the calm column follows the input that a temporary chat\'s first message moves', async ({ admin }) => {
  await addPipeModel(admin);
  await saveTheme(admin, markerTheme('instance', { canvasEnabled: true, canvasScript: RELAY_SCRIPT }));
  const page = await openPage({ token: admin });
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto(BASE + '/?temporary-chat=true&models=' + BG_MODEL);
  await loaderReady(page);
  await listenToRelay(page);
  const input = page.locator('#chat-input');
  await input.waitFor({ timeout: WAIT_MS });
  // Past the route checks after a page load, and the address won't change
  await new Promise((r) => setTimeout(r, 11000));
  const placeholderPill = await page.evaluateHandle(() => document.getElementById('message-input-container'));
  await input.focus();
  await page.keyboard.type('hello');
  const typed = await input.textContent();
  if (typed !== 'hello') throw new Error('the message never reached #chat-input: ' + JSON.stringify(typed));
  await page.keyboard.press('Enter');
  // The pill under the chat replaces the one in the middle of the page
  await waitFor('the input under the chat', () => page.evaluate((old) => {
    const now = document.getElementById('message-input-container');
    return (!!now && now !== old && !!document.getElementById('messages-container')) || { pill: !!now, replaced: now !== old, chat: !!document.getElementById('messages-container'), input: (document.getElementById('chat-input') || {}).textContent };
  }, placeholderPill));
  if (new URL(page.url()).pathname !== '/') throw new Error('the temporary chat got an address: ' + page.url());
  await new Promise((r) => setTimeout(r, 1000));
  const column = async () => {
    const m = await lastRelayed(page, 'layout');
    return m && m.column;
  };
  await expectColumnFollowsWidescreen(page, column);
});

test('a mode switch in Settings repaints through window.applyTheme', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  const page = await openPage({ token: admin });
  await page.goto(BASE + '/');
  await loaderReady(page);
  await expectParts(page, { vars: 'instance' });
  if (await page.evaluate(() => typeof window.applyTheme) !== 'function') throw new Error('no window.applyTheme for Open WebUI to call');
  const mode = () => page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), cls: ['dark', 'light', 'her'].filter((c) => document.documentElement.classList.contains(c)).join() }));
  // Open WebUI's own Theme setting
  await openSettings(page);
  // OLED Dark leaves <html>'s classes as Dark had them. Open WebUI 0.13.5
  // retired it, so from there Settings offers Dark in its place.
  const hasOled = await page.locator('select[aria-label="Theme"] option[value="oled-dark"]').count() > 0;
  if (hasOled) {
    await page.selectOption('select[aria-label="Theme"]', 'oled-dark');
    await waitFor('OLED Dark from Settings', async () => { const m = await mode(); return (m.attr === 'oled-dark' && m.cls === 'dark') || m; });
  } else {
    await page.selectOption('select[aria-label="Theme"]', 'dark');
    await waitFor('Dark from Settings', async () => { const m = await mode(); return (m.attr === 'dark' && m.cls === 'dark') || m; });
  }
  await page.selectOption('select[aria-label="Theme"]', 'light');
  await waitFor('Light from Settings', async () => { const m = await mode(); return (m.attr === 'light' && m.cls === 'light') || m; });
  // The hook alone repaints: nothing else on the page changes here
  await page.keyboard.press('Escape');
  await page.evaluate(() => { localStorage.setItem('theme', 'dark'); window.applyTheme(); });
  await waitFor('Dark from the hook', async () => { const m = await mode(); return (m.attr === 'dark' && m.cls === 'dark') || m; }, 1000);
  // Another tab's switch
  const other = await page.context().newPage();
  await other.goto(BASE + '/');
  await loaderReady(other);
  await other.evaluate(() => localStorage.setItem('theme', 'light'));
  await waitFor('Light from another tab', async () => { const m = await mode(); return (m.attr === 'light' && m.cls === 'light') || m; });
  // A class written over the mode by some other script is put back
  await page.evaluate(() => { document.documentElement.classList.remove('light'); document.documentElement.classList.add('dark'); });
  await waitFor('the mode put back', async () => { const m = await mode(); return (m.attr === 'light' && m.cls === 'light') || m; }, 1000);
});

test('Canvas FX counts a chat\'s messages, not the edit box open on one, and follows the chat in view', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance', { canvasEnabled: true, canvasScript: RELAY_SCRIPT }));
  const first = await makeChat(admin, 'two', 2);
  const second = await makeChat(admin, 'four', 4);
  const page = await openPage({ token: admin });
  await page.goto(BASE + '/c/' + first);
  await loaderReady(page);
  await listenToRelay(page);
  const count = async (n, what, timeout) => waitFor(what, async () => {
    const m = await lastRelayed(page, 'context');
    return (m && m.messages === n) || (m && m.messages);
  }, timeout);
  await count(2, 'two messages');
  await page.evaluate(() => document.querySelector('#messages-container .user-message button[aria-label="Edit"]').click());
  await page.waitForSelector('[id^="message-edit-"]', { timeout: WAIT_MS });
  // Past the 2s the scan waits after a change
  await new Promise((r) => setTimeout(r, 3000));
  const during = await lastRelayed(page, 'context');
  if (during.messages !== 2) throw new Error(`an open edit box counted as a message: ${during.messages}`);
  await page.keyboard.press('Escape');
  // Through the sidebar's links, which Open WebUI's router follows without a page load
  const follow = (href) => page.evaluate((h) => document.querySelector(`a[href="${h}"]`).click(), href);
  await follow('/c/' + second);
  await count(4, 'four messages in the other chat');
  await follow('/');
  await count(0, 'no messages in a new chat');
  await follow('/c/' + first);
  await count(2, 'two messages back in the first chat');
});

// Counts what Open WebUI's socket sends, and hands it a frame as if the
// server had sent it
async function recordSocket(page) {
  await page.context().addInitScript(() => {
    window.tdpSocket = { ws: null, sends: 0 };
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function () {
      window.tdpSocket.ws = this;
      window.tdpSocket.sends++;
      return send.apply(this, arguments);
    };
  });
}

function receiveFrame(page, payload) {
  return page.evaluate((p) => {
    window.tdpSocket.ws.dispatchEvent(new MessageEvent('message', { data: '42' + JSON.stringify(['events', p]) }));
  }, payload);
}

function usageFrame(chat, message, total) {
  return { chat_id: chat, message_id: message, data: { type: 'chat:completion', data: { usage: { prompt_tokens: total - 1, completion_tokens: 1, total_tokens: total } } } };
}

test('Canvas FX gets exact token counts from the socket after a warm-cache reload, for the chat in view only', async ({ admin }) => {
  const me = (await api('GET', '/api/v1/auths/', undefined, admin)).json.id;
  await saveTheme(admin, markerTheme('instance', { canvasEnabled: true, canvasScript: RELAY_SCRIPT }));
  const first = await makeChat(admin, 'usage-a', 2);
  const second = await makeChat(admin, 'usage-b', 2);
  const page = await openPage({ token: admin });
  await recordSocket(page);
  await page.goto(BASE + '/c/' + first);
  await loaderReady(page);
  // The SvelteKit chunks now come from the cache, and a slow answer for
  // loader.js (no-cache, so always asked for) lets Open WebUI build its
  // socket first. A local server answers too fast to show it.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/static/loader.js*' }] });
  cdp.on('Fetch.requestPaused', (e) => setTimeout(() => cdp.send('Fetch.continueRequest', { requestId: e.requestId }).catch(() => {}), 1000));
  await page.reload();
  await loaderReady(page);
  await listenToRelay(page);
  const sends = await page.evaluate(() => window.tdpSocket.sends);
  // Opening another chat makes Open WebUI's socket send (leave, then join)
  await page.waitForSelector(`a[href="/c/${second}"]`, { state: 'attached', timeout: WAIT_MS });
  await page.evaluate((h) => document.querySelector(`a[href="${h}"]`).click(), '/c/' + second);
  await waitFor('the socket to send', async () => (await page.evaluate(() => window.tdpSocket.sends)) > sends || 'no send');
  await cdp.send('Fetch.disable');
  await receiveFrame(page, usageFrame(first, 'usage-a-1', 111));
  await receiveFrame(page, usageFrame(second, 'usage-b-1', 42));
  const exact = () => page.evaluate(() => window.tdpRelay.filter((m) => m.exactTokens != null).map((m) => m.exactTokens));
  await waitFor('the exact count of the chat in view', async () => { const e = await exact(); return e.includes(42) || e; });
  await new Promise((r) => setTimeout(r, 500));
  const got = await exact();
  if (got.length !== 1) throw new Error('another chat\'s usage reached the canvas: ' + JSON.stringify(got));
  // Open WebUI still handles what its socket gets, and the socket is up
  await receiveFrame(page, { chat_id: second, message_id: 'usage-b-1', data: { type: 'chat:title', data: 'Renamed by its socket' } });
  await waitFor('Open WebUI to rename the chat', async () => (await page.title()).includes('Renamed by its socket') || await page.title());
  // The copy the chat's room sends this user's other tabs, which Open WebUI drops too
  await receiveFrame(page, { ...usageFrame(second, 'usage-b-1', 7), user_id: me, shared: true });
  // A chat started from / has its id only after the first frames of its reply
  // arrive; Open WebUI matches them by a message on the page
  await page.evaluate(() => document.querySelector('a[href="/"]').click());
  await page.waitForURL((u) => u.pathname === '/', { timeout: WAIT_MS });
  await page.evaluate(() => { const m = document.createElement('div'); m.id = 'message-new-1'; document.body.append(m); });
  await receiveFrame(page, usageFrame('new-chat', 'new-1', 55));
  await receiveFrame(page, usageFrame(first, 'usage-a-0', 99));
  await waitFor('the exact count of the new chat', async () => { const e = await exact(); return e.includes(55) || e; });
  await new Promise((r) => setTimeout(r, 500));
  const all = await exact();
  if (JSON.stringify(all) !== '[42,55]') throw new Error('expected the exact counts [42,55], got ' + JSON.stringify(all));
  const open = await page.evaluate(() => window.tdpSocket.ws.readyState);
  if (open !== 1) throw new Error('Open WebUI\'s socket is no longer open: ' + open);
  if (page.errors.length) throw new Error('page errors: ' + page.errors.join('; '));
});

test('Canvas FX counts the first message of a temporary chat started long after the page loaded', async ({ admin }) => {
  await addPipeModel(admin);
  await saveTheme(admin, markerTheme('instance', { canvasEnabled: true, canvasScript: RELAY_SCRIPT }));
  const page = await openPage({ token: admin });
  await page.goto(BASE + '/?temporary-chat=true&models=' + BG_MODEL);
  await loaderReady(page);
  await listenToRelay(page);
  const input = page.locator('#chat-input');
  await input.waitFor({ timeout: WAIT_MS });
  // Past the route checks after a page load, and the address won't change
  await new Promise((r) => setTimeout(r, 11000));
  // Over the What's New window, when it shows
  await input.focus();
  await page.keyboard.type('hello');
  await page.keyboard.press('Enter');
  await waitFor('the temporary chat\'s messages', async () => {
    const m = await lastRelayed(page, 'context');
    return (m && m.messages > 0) || (m && m.messages);
  });
  if (new URL(page.url()).pathname !== '/') throw new Error('the temporary chat got an address: ' + page.url());
});

test('a Canvas FX script that reads no context watches no chat and leaves the socket alone', async ({ admin }) => {
  // getContext and a commented 'context' don't count as reading it
  const script = '// handles no \'context\' messages\nself.onmessage = function (e) { if (e.data.canvas) e.data.canvas.getContext("2d"); };';
  await saveTheme(admin, markerTheme('instance', { canvasEnabled: true, canvasScript: script }));
  const chat = await makeChat(admin, 'no-context', 2);
  const page = await openPage({ token: admin });
  await page.context().addInitScript(() => {
    window.tdpNative = { ws: WebSocket, send: WebSocket.prototype.send, add: WebSocket.prototype.addEventListener };
    window.tdpWatched = [];
    const observe = MutationObserver.prototype.observe;
    MutationObserver.prototype.observe = function (target) {
      if (/\/static\/loader\.js/.test(new Error().stack || '') && target && target.id) window.tdpWatched.push(target.id);
      return observe.apply(this, arguments);
    };
  });
  await page.goto(BASE + '/c/' + chat);
  await loaderReady(page);
  await waitFor('the canvas', async () => !!(await page.$('#owui-theme-canvas-bg')) || 'missing');
  await page.waitForSelector('#messages-container', { timeout: WAIT_MS });
  // Past the route checks after a page load
  await new Promise((r) => setTimeout(r, 5000));
  const found = await page.evaluate(() => ({
    watched: window.tdpWatched.filter((id) => id === 'messages-container').length,
    constructor: WebSocket === window.tdpNative.ws,
    send: WebSocket.prototype.send === window.tdpNative.send,
    addEventListener: WebSocket.prototype.addEventListener === window.tdpNative.add,
  }));
  if (found.watched || !found.constructor || !found.send || !found.addEventListener) throw new Error('context machinery ran: ' + JSON.stringify(found));
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

// Counts the renders the Settings tab and the Admin Panel link schedule
async function countTabRenders(page) {
  await page.context().addInitScript(() => {
    window.tdpRenders = 0;
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = function (fn) {
      if (typeof fn === 'function' && fn.name === 'render' && /\/static\/loader\.js/.test(new Error().stack || '')) {
        const run = fn;
        fn = function () { window.tdpRenders++; return run.apply(this, arguments); };
      }
      return raf.call(window, fn);
    };
  });
}

test('the Settings tab and the Admin Panel link schedule nothing while a chat page changes', async ({ admin }) => {
  await setValves(admin, { show_in_admin_panel: true });
  try {
    const page = await openPage({ token: admin });
    await countTabRenders(page);
    await page.goto(BASE + '/');
    await loaderReady(page);
    await new Promise((r) => setTimeout(r, 1500));
    // Tokens arriving in a reply, as a page-wide observer sees them
    const renders = await page.evaluate(() => new Promise((resolve) => {
      const reply = document.createElement('div');
      document.querySelector('.app').appendChild(reply);
      const before = window.tdpRenders;
      let n = 0;
      const timer = setInterval(() => {
        const token = document.createElement('span');
        token.textContent = 'token ' + n++ + ' ';
        reply.appendChild(token);
      }, 20);
      setTimeout(() => { clearInterval(timer); reply.remove(); resolve(window.tdpRenders - before); }, 3000);
    }));
    console.log(`        ${renders} renders in 3s of chat changes, ${renders * 20} a minute`);
    if (renders > 2) throw new Error(`${renders} renders in 3s of chat changes`);
    await openSettings(page);
    await page.waitForSelector('#settings-tabs-container .tdp-settings-tab[data-tdp-key="admin"]', { timeout: WAIT_MS });
  } finally {
    await setValves(admin, {});
  }
});

test('the Admin Panel\'s Themes link opens the designer and comes back after leaving the panel', async ({ admin }) => {
  await setValves(admin, { show_in_admin_panel: true });
  try {
    const page = await openPage({ token: admin });
    await page.goto(BASE + '/admin');
    await loaderReady(page);
    const state = () => page.evaluate(() => {
      const link = document.querySelector('nav .tdp-admin-page-link');
      return {
        // Evaluations opens on its leaderboard
        path: location.pathname.replace(/^\/admin\/evaluations\/.*/, '/admin/evaluations'),
        link: !!link,
        before: link && link.nextElementSibling ? link.nextElementSibling.getAttribute('href') : null,
        current: link ? link.getAttribute('aria-current') : null,
        open: !!document.querySelector('[data-tdp-admin-open] > .tdp-admin-page iframe'),
      };
    });
    const expect = (what, want) => waitFor(what, async () => {
      const got = await state();
      return Object.keys(want).every((k) => got[k] === want[k]) ? true : got;
    });
    await expect('the link before Settings', { link: true, before: '/admin/settings', current: 'false', open: false });
    await page.click('nav .tdp-admin-page-link');
    await expect('the designer open', { current: 'page', open: true });
    await page.click('nav a[href="/admin/evaluations"]');
    await expect('another page of the bar to close it', { path: '/admin/evaluations', current: 'false', open: false });
    await page.click('nav .tdp-admin-page-link');
    await expect('the designer open again', { current: 'page', open: true });
    await page.goBack();
    await expect('Back to close it', { path: '/admin/users/overview', current: 'false', open: false });
    // Out of the Admin Panel and into it again, both client-side
    await page.click('a[aria-label="New Chat"][href="/"]');
    await expect('the link gone with the panel', { path: '/', link: false });
    await page.evaluate(() => {
      const a = document.createElement('a');
      a.href = '/admin/evaluations';
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    await expect('the link back, closed', { path: '/admin/evaluations', link: true, before: '/admin/settings', current: 'false', open: false });
    await page.click('nav .tdp-admin-page-link');
    await expect('the designer open after coming back', { current: 'page', open: true });
    // Back from a new chat shows the Admin Panel with the address left on /
    await page.click('a[aria-label="New Chat"][href="/"]');
    await expect('the link gone with the panel again', { path: '/', link: false });
    await page.goBack();
    await waitFor('the Admin Panel back on screen', () => page.evaluate(() => !!document.querySelector('nav a[href="/admin/evaluations"]') || location.pathname));
    await expect('the link there under the address /', { link: true, before: '/admin/settings', current: 'false', open: false });
    await page.click('nav .tdp-admin-page-link');
    await expect('the designer open under the address /', { current: 'page', open: true });
  } finally {
    await setValves(admin, {});
  }
});

test('an app page does no theme work while nothing changes', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  const page = await openPage({ token: admin });
  await page.goto(BASE + '/');
  await loaderReady(page);
  await expectParts(page, { vars: 'instance' });
  await new Promise((r) => setTimeout(r, 1500));
  // Each repaint touched <html>'s classes, which the bootloader took for a
  // mode switch and answered with another repaint, every frame
  const changes = await page.evaluate(() => new Promise((resolve) => {
    let n = 0;
    const seen = new MutationObserver((ms) => { n += ms.length; });
    seen.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    setTimeout(() => { seen.disconnect(); resolve(n); }, 2000);
  }));
  if (changes) throw new Error(`<html> changed ${changes} times in 2s with nothing happening`);
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

test('a change in the designer reaches an open page in well under two seconds', async ({ admin }) => {
  await saveTheme(admin, liveTheme());
  const app = await openPage({ token: admin });
  await app.goto(BASE + '/');
  await loaderReady(app);
  await expectParts(app, { vars: 'instance' });
  const designer = await openDesigner(admin);
  await app.evaluate(() => {
    window.__tdpChanged = null;
    const style = document.getElementById('owui-dev-live-theme');
    new MutationObserver(() => { window.__tdpChanged = window.__tdpChanged || Date.now(); })
      .observe(style, { childList: true, characterData: true, subtree: true });
  });
  // Pages used to wait a random 0-2s before fetching, on top of a 250ms wait
  // before the designer saved, however few were open
  const tries = [];
  for (let i = 0; i < 3; i++) {
    await app.evaluate(() => { window.__tdpChanged = null; });
    const clicked = Date.now();
    await designer.evaluate(() => document.getElementById('toggle-custom-css').click());
    await app.waitForFunction(() => window.__tdpChanged, null, { timeout: WAIT_MS });
    tries.push(await app.evaluate(() => window.__tdpChanged) - clicked);
    await new Promise((r) => setTimeout(r, 500));
  }
  if (Math.max(...tries) > 1500) throw new Error('the change took ' + tries.join(', ') + 'ms to reach the page');
});

// A code save whose source ends every open stream when it runs, as a restart does
const END_STREAMS = '\nfrom open_webui.main import app as _tdp_app\n' +
  'Event._sse_clients = getattr(_tdp_app.state, "_theme_sse_clients", set())\n' +
  'Event._end_sse_streams()\n';

async function saveCode(admin, content) {
  const form = { id: FUNCTION_ID, name: 'Theme Designer Pro', content, meta: { description: 'End-to-end tests' } };
  const res = await api('POST', `/api/v1/functions/id/${FUNCTION_ID}/update`, form, admin);
  if (res.status !== 200) throw new Error('Could not save the function: ' + JSON.stringify(res.json));
}

// How long after `since` (or after its stream reopened, with reopened) each
// page asked for the theme
async function refetchDelays(pages, since, reopened) {
  const delays = await Promise.all(pages.map((p) => p.evaluate(([t, reopened]) => {
    const from = reopened ? window.__tdpOpens.find((o) => o > t) : t;
    const hit = from === undefined ? undefined : window.__tdpFetches.find((f) => f >= from);
    return hit === undefined ? null : hit - from;
  }, [since, reopened])));
  if (delays.includes(null)) throw new Error('a page never refetched: ' + JSON.stringify(delays));
  return delays;
}

// Each page's refetch is counted from its own reconnect, which the browser
// times. A reconnect resyncs over _RESYNC_SPREAD (2s); the reset broadcast
// over _refetch_spread, 64ms for these eight pages. Eight uniform delays fall
// within 8ms of each other with odds of about 4e-6 over 64ms and 1e-16 over
// 2s; before, they fell within 1ms (reconnect) and 0ms (reset).
async function expectSpreadRefetches(admin, personal) {
  if (!personal) await setValves(admin, { allow_personal_themes: false });
  try {
    await saveTheme(admin, markerTheme('instance'));
    const pages = [];
    for (let i = 0; i < 8; i++) {
      const page = await openPage({ token: admin });
      await page.addInitScript((route) => {
        window.__tdpFetches = [];
        window.__tdpOpens = [];
        const fetch = window.fetch;
        window.fetch = function (url) {
          const u = String((url && url.url) || url);
          if (u.includes(route) && !u.includes('/events')) window.__tdpFetches.push(Date.now());
          return fetch.apply(this, arguments);
        };
        const ES = window.EventSource;
        window.EventSource = function (url, init) {
          const es = new ES(url, init);
          es.addEventListener('open', () => window.__tdpOpens.push(Date.now()));
          return es;
        };
        window.EventSource.prototype = ES.prototype;
        window.EventSource.CLOSED = ES.CLOSED;
      }, ROUTE);
      await page.goto(BASE + '/');
      await loaderReady(page);
      await expectParts(page, { vars: 'instance' });
      pages.push(page);
    }
    if ((await Promise.all(pages.map((p) => p.evaluate(() => document.visibilityState)))).some((v) => v !== 'visible')) {
      throw new Error('a page is hidden, so it would not refetch at all');
    }
    const content = fs.readFileSync(FUNCTION_FILE, 'utf8');
    const delays = {};
    // A run killed between these two saves leaves the trailer installed, and
    // every save of the function then ends every stream; the next run's
    // installFunction saves the clean source again
    let failure = null;
    try {
      const since = Date.now();
      await saveCode(admin, content + END_STREAMS);
      await new Promise((r) => setTimeout(r, 8000));
      delays.reconnect = await refetchDelays(pages, since, true);
    } catch (e) {
      failure = e;
    }
    try {
      await saveCode(admin, content);
    } catch (e) {
      if (!failure) throw e;
      console.log('        restoring the function failed too: ' + e.message);
    }
    if (failure) throw failure;
    await new Promise((r) => setTimeout(r, 2000));
    const since = Date.now();
    await api('POST', ROUTE, { reset: true }, admin);
    await new Promise((r) => setTimeout(r, 2000));
    delays.reset = await refetchDelays(pages, since, false);
    console.log('        refetch delays (ms):', JSON.stringify(delays));
    const bunched = Object.keys(delays).filter((k) => Math.max(...delays[k]) - Math.min(...delays[k]) < 8);
    if (bunched.length) throw new Error(bunched.join(' and ') + ': every page refetched within 8ms of the others');
  } finally {
    if (!personal) await setValves(admin, {});
  }
}

test('a reconnect and a Global Reset spread their refetches instead of sending every page at once', ({ admin }) =>
  expectSpreadRefetches(admin, true));

test('with personal themes off, a reconnect and a Global Reset spread their refetches too', ({ admin }) =>
  expectSpreadRefetches(admin, false));

test('Wipe CSS Snippets and Wipe Canvas Presets leave the live theme alone', async ({ admin }) => {
  await saveTheme(admin, liveTheme());
  // No CSS snippets ship with the designer, so the library gets one to wipe
  await api('POST', ROUTE, { css: '', state: '', library: JSON.stringify({ css_presets: [{ name: 'A snippet', code: '.markdown-prose { letter-spacing: 0.01em; }' }] }) }, admin);
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
  const count = await page.evaluate(() => Number(document.getElementById('library-count').textContent) || 0);
  if (!count) throw new Error('the gallery is empty, nothing to delete');
  await page.evaluate(() => window.requestDelete(0));
  await page.waitForSelector('#confirm-delete-btn', { state: 'visible', timeout: WAIT_MS });
  await page.click('#confirm-delete-btn');
  await expectLiveThemeKept(admin, 'Deleting the gallery theme');
});

test('Apply Library Theme marks every part a gallery theme differs in', async ({ admin }) => {
  const theme = markerTheme('instance');
  await saveTheme(admin, theme);
  const live = JSON.parse(theme.state);
  const entry = { name: 'Aurora' };
  MODES.forEach((m) => { entry[m] = { ...live[m], paletteEnabled: false, surfacesEnabled: true, surfaceSidebarOpacity: 40 }; });
  await api('POST', ROUTE, { css: '', state: '', library: JSON.stringify({ snapshots: [entry] }) }, admin);
  const page = await openDesigner(admin);
  await page.evaluate(() => window.loadSnapshot(0));
  await page.waitForSelector('#sync-badge-surfaces', { state: 'visible', timeout: WAIT_MS });
  const differs = await page.evaluate(() => Object.fromEntries(['palette', 'overrides', 'css', 'canvas', 'gradient', 'surfaces', 'auth']
    .map((k) => [k, document.getElementById('sync-badge-' + k).classList.contains('diff-detected')])));
  const want = { palette: true, overrides: false, css: false, canvas: false, gradient: false, surfaces: true, auth: false };
  if (JSON.stringify(differs) !== JSON.stringify(want)) throw new Error('parts marked as different: ' + JSON.stringify(differs));
  await page.click('#sync-badge-palette');
  const palette = await page.$eval('#sync-diff-palette', (p) => p.textContent);
  if (!/Palette: on→off/.test(palette)) throw new Error('the palette diff does not show the switch: ' + palette);
  if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
  await page.context().close();
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

test('the designer hides OLED where Open WebUI retired it, and never switches anyone to it', async ({ admin }) => {
  // Open WebUI 0.13.5 turns a saved 'oled-dark' into Dark with black Theme
  // Colors, which hide the palette from that user
  const { version } = await (await fetch(BASE + '/api/config')).json();
  const [major, minor, patch] = String(version).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const retired = major > 0 || minor > 13 || (minor === 13 && patch >= 5);
  const page = await openDesigner(admin);
  const shown = await page.$eval('.mode-btn[data-mode="oled"]', (b) => getComputedStyle(b).display !== 'none');
  if (shown === retired) throw new Error(`the OLED tab is ${shown ? 'shown' : 'hidden'} on Open WebUI ${version}`);
  if (retired) {
    await page.evaluate(() => document.querySelector('.mode-btn[data-mode="oled"]').click());
    await new Promise((r) => setTimeout(r, 500));
    const theme = await page.evaluate(() => localStorage.getItem('theme'));
    if (theme === 'oled-dark') throw new Error('the designer switched Open WebUI to the retired OLED Dark');
  }
  if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
});

// Presses Tab (or Shift+Tab) until the focused element matches `selector`,
// the way someone without a mouse gets to a control
async function tabTo(page, selector, key = 'Tab') {
  for (let i = 0; i < 400; i++) {
    if (await page.evaluate((s) => document.activeElement.matches(s), selector)) return;
    await page.keyboard.press(key);
  }
  throw new Error(`${key} never reached ${selector}`);
}

// A library of two themes whose palettes differ in hue, so a save shows
// which one reached the server
async function keyboardLibrary(admin) {
  await saveTheme(admin, markerTheme('instance'));
  const live = JSON.parse(markerTheme('instance').state);
  const entry = (name, h) => ({ name, ...Object.fromEntries(MODES.map((m) => [m, { ...live[m], h }])) });
  await api('POST', ROUTE, { css: '', state: '', library: JSON.stringify({ snapshots: [entry('Ember', 20), entry('Lagoon', 190)] }) }, admin);
}

async function libraryNames(admin) {
  const res = await api('GET', ROUTE + '/library.json', undefined, admin);
  return ((res.json && res.json.snapshots) || []).map((t) => t.name);
}

test('a library that isn\'t a JSON object is refused and the saved one stays', async ({ admin, user }) => {
  for (const [url, token] of [[ROUTE, admin], [ROUTE + '/me', user]]) {
    const saved = JSON.stringify({ snapshots: [], saved: Date.now() });
    const ok = await api('POST', url, { css: '', state: '', library: saved }, token);
    if (ok.status !== 200) throw new Error(`${url}: a library save answered ${ok.status}`);
    for (const library of ['{"snapshots": [', '[1]', { snapshots: [] }, [1], 5]) {
      const res = await api('POST', url, { css: '', state: '', library }, token);
      if (res.status !== 400) throw new Error(`${url}: ${JSON.stringify(library)} answered ${res.status}`);
    }
    const now = await api('GET', url + '/library.json', undefined, token);
    if (JSON.stringify(now.json) !== saved) throw new Error(`${url}: the saved library changed to ${JSON.stringify(now.json)}`);
  }
});

test('the designer\'s tabs work from the keyboard', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  const page = await openDesigner(admin);
  await tabTo(page, '.tab');
  const expectTab = async (key, want) => {
    if (key) await page.keyboard.press(key);
    const got = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('.tab')];
      const focused = document.activeElement;
      const panel = document.getElementById(focused.getAttribute('aria-controls'));
      return {
        focused: focused.dataset.tab,
        selected: tabs.filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.dataset.tab).join(),
        tabStops: tabs.filter((t) => t.tabIndex === 0).map((t) => t.dataset.tab).join(),
        panelShown: !!panel && panel.style.display !== 'none' && panel.getAttribute('aria-labelledby') === focused.id,
      };
    });
    if (got.focused !== want || got.selected !== want || got.tabStops !== want || !got.panelShown) {
      throw new Error(`after ${key || 'Tab'}: ${JSON.stringify(got)}, wanted ${want} focused, selected and shown`);
    }
  };
  await expectTab(null, 'themes');
  await expectTab('ArrowRight', 'lch');
  await expectTab('End', 'backgrounds');
  await expectTab('ArrowRight', 'themes');
  await expectTab('ArrowLeft', 'backgrounds');
  await expectTab('Home', 'themes');
  if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
});

test('icon buttons and sliders have names, Tab skips a closed search box and keyboard focus shows the tooltip', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  const page = await openDesigner(admin);
  // Narrow, as in the Settings window, where the header buttons lose their text
  await page.setViewportSize({ width: 720, height: 800 });
  const cdp = await page.context().newCDPSession(page);
  const nameOf = async (selector) => {
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    return nodes[0].name?.value || '';
  };
  const unnamed = [];
  for (const selector of ['#json-view-btn', '#docs-modal-btn', '#theme-search-toggle-btn', '#theme-sort-btn', '#import-json-btn',
    '#delete-all-themes-btn', '#community-refresh-btn']) {
    if (!/[a-z]{3}/i.test(await nameOf(selector))) unnamed.push(selector);
  }
  await page.click('#tab-btn-lch');
  for (const selector of ['#sl-h', '#sl-c', '#sl-l', '.var-picker[data-var="--color-gray-50"]']) {
    if (!/[a-z]{3}/i.test(await nameOf(selector))) unnamed.push(selector);
  }
  if (unnamed.length) throw new Error('no name: ' + unnamed.join(', '));

  await page.click('#tab-btn-themes');
  await page.focus('#theme-search-toggle-btn');
  await page.keyboard.press('Shift+Tab');
  const before = await page.evaluate(() => document.activeElement.id);
  if (before === 'theme-search-input') throw new Error('Shift+Tab from the search button reached the closed search box');
  await tabTo(page, '#theme-sort-btn');
  const tip = await page.evaluate(() => { const t = document.querySelector('.owui-tooltip'); return t.classList.contains('visible') ? t.textContent : ''; });
  if (tip !== 'Default Sort') throw new Error(`keyboard focus on the sort button showed ${JSON.stringify(tip)}`);
  // Activated from the keyboard, it shows its new label at once
  await page.keyboard.press('Enter');
  const tipSorted = await page.evaluate(() => { const t = document.querySelector('.owui-tooltip'); return t.classList.contains('visible') ? t.textContent : ''; });
  const nameSorted = await nameOf('#theme-sort-btn');
  if (tipSorted !== 'Sort Ascending' || nameSorted !== 'Sort Ascending') throw new Error(`after Enter the sort button showed ${JSON.stringify(tipSorted)}, named ${JSON.stringify(nameSorted)}`);
  await page.keyboard.press('Tab');
  const tipAfter = await page.evaluate(() => document.querySelector('.owui-tooltip').textContent);
  if (/Sort/.test(tipAfter)) throw new Error('the tooltip stayed after focus moved on');

  // Opened, the search box takes focus and stays in the Tab order until closed again
  await page.click('#theme-search-toggle-btn');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const open = await page.evaluate(() => document.activeElement.id);
  await page.keyboard.press('Escape');
  const closed = await page.evaluate(() => document.getElementById('theme-search-input').tabIndex);
  if (open !== 'theme-search-input' || closed !== -1) throw new Error(`open search box focus ${open}, tabIndex once closed ${closed}`);
  if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
});

test('a pasted gradient backup is offered for import like the other backups', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  const page = await openDesigner(admin);
  const backup = { gradient_presets: [{ name: 'Pasted Conic', type: 'conic', angle: 30, intensity: 85, animation: false, speed: 8,
    stops: [{ color: '#112233', position: 0 }, { color: '#445566', position: 100 }] }], isGradientBackup: true, version: '1' };
  const offered = await page.evaluate((text) => {
    document.activeElement?.blur();
    const data = new DataTransfer();
    data.setData('text/plain', text);
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }));
    return getComputedStyle(document.getElementById('import-clipboard-modal')).display !== 'none';
  }, JSON.stringify(backup));
  if (!offered) throw new Error('the paste was ignored');
  await page.click('#clipboard-import-noapply-btn');
  await waitFor('the pasted preset in the gradient gallery', async () =>
    (await page.evaluate(() => document.getElementById('tab-bg').textContent.includes('Pasted Conic'))) || 'not there');
  if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
});

test('a legacy single-palette theme reads the same from the gallery, a backup and a paste', async ({ admin }) => {
  // The live theme saved in the legacy format, without a chroma
  await saveTheme(admin, { ...markerTheme('instance'), state: JSON.stringify({ h: 40, l: 20 }) });
  const live = JSON.parse(markerTheme('instance').state);
  // A legacy entry without a chroma, a theme with modes and a stray top-level
  // hue, and one with only a dark mode and a stray hue
  const stray = { name: 'Stray', h: 5, ...Object.fromEntries(MODES.map((m) => [m, { ...live[m], h: 77 }])) };
  const partial = { name: 'Partial', h: 9, dark: { ...live.dark, customCSS: '.partial-dark { color: red; }' } };
  await api('POST', ROUTE, { css: '', state: '', library: JSON.stringify({ snapshots: [{ name: 'Old', h: 30, l: 20 }, stray, partial] }) }, admin);
  const page = await openDesigner(admin);
  const library = async () => ((await api('GET', ROUTE + '/library.json', undefined, admin)).json || {}).snapshots || [];
  await waitFor('the migrated gallery saved', async () => {
    const lib = await library();
    const old = lib.find((t) => t.name === 'Old'), kept = lib.find((t) => t.name === 'Stray'), half = lib.find((t) => t.name === 'Partial');
    return (!!old && typeof old.dark.c === 'number' && !!kept && kept.dark.h === 77 && !!half && half.dark.customCSS === partial.dark.customCSS && !!half.light)
      || JSON.stringify({ oldChroma: old?.dark?.c, strayHue: kept?.dark?.h, partialCss: half?.dark?.customCSS, partialLight: !!half?.light });
  });
  const chroma = await page.$eval('#val-c', (e) => e.textContent);
  if (!/^\d/.test(chroma)) throw new Error('the legacy live theme shows a chroma of ' + chroma);
  // What a paste offers: true for the import dialog, the toast's text for a duplicate, false for nothing
  const paste = (value) => page.evaluate(async (text) => {
    document.activeElement?.blur();
    const toast = document.getElementById('action-toast');
    toast.classList.remove('show');
    const data = new DataTransfer();
    data.setData('text/plain', text);
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }));
    const modal = document.getElementById('import-clipboard-modal');
    if (getComputedStyle(modal).display !== 'none') return true;
    return toast.classList.contains('show') ? toast.innerText : false;
  }, JSON.stringify(value));
  const backup = await paste({ isLibraryBackup: true, themes: [{ name: 'Old', h: 30, l: 20 }] });
  if (!/already exists/.test(backup)) throw new Error('a backup of the gallery\'s legacy theme pasted again: ' + JSON.stringify(backup));
  const legacy = { h: 120, c: 50, l: 20 };
  if (await paste(legacy) !== true) throw new Error('a new legacy theme was not offered');
  await page.click('#clipboard-import-noapply-btn');
  await waitFor('the pasted legacy theme in the gallery', async () => (await library()).some((t) => t.name === 'clipboard-import') || 'not there');
  const again = await paste(legacy);
  if (!/already exists/.test(again)) throw new Error('the same legacy theme pasted again: ' + JSON.stringify(again));
  // Numbers written as text read as numbers, as they do everywhere else
  const text = await paste({ h: '250', c: '10', l: '20' });
  if (text !== true) throw new Error('a legacy theme with its numbers as text was not offered: ' + JSON.stringify(text));
  if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
  await page.context().close();
});

test('a variable\'s lock works from the keyboard and keeps focus', async ({ admin }) => {
  // Saved without an overrides object, as a theme from outside the designer can be
  await saveTheme(admin, markerTheme('instance'));
  const page = await openDesigner(admin);
  await tabTo(page, '.tab');
  await page.keyboard.press('ArrowRight');
  await tabTo(page, '.var-lock[data-var="--color-gray-50"]');
  await page.keyboard.press('Enter');
  // In the mode being edited, whichever that is
  await waitFor('the lock saved', async () => {
    const state = await savedState(admin);
    return MODES.some((m) => state[m].locks?.['--color-gray-50'] === true) || 'unlocked';
  });
  // The grid is rebuilt on every change; focus stays on the same lock
  const focused = await page.evaluate(() => [document.activeElement.className, document.activeElement.dataset.var, document.activeElement.getAttribute('aria-pressed')].join(' '));
  if (focused !== 'plain-button var-lock --color-gray-50 true') throw new Error('focus after the lock: ' + focused);
  if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
});

test('a page open as a tab is a page under Surfaces: Cards and panels reaches the calendar grid', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  const designer = await openDesigner(admin);
  await designer.evaluate(() => {
    document.getElementById('toggle-surfaces').click();
    const s = document.getElementById('sl-surfaceCardsOpacity');
    s.value = '20';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await waitFor('the Cards value saved', async () => (await savedState(admin)).dark?.surfaceCardsOpacity === 20 || 'not yet');
  await designer.context().close();
  const look = async (width) => {
    const page = await openPage({ token: admin });
    await page.setViewportSize({ width, height: 800 });
    await page.goto(BASE + '/calendar');
    await loaderReady(page);
    await page.waitForSelector('[id^="chat-panel-page%3A"][role="tabpanel"] div.rounded-2xl', { timeout: WAIT_MS });
    return page.evaluate(() => {
      const bg = (el) => getComputedStyle(el).backgroundColor;
      const pane = document.querySelector('[id^="chat-panel-page%3A"][role="tabpanel"]');
      const grid = pane.querySelector('div.rounded-2xl');
      // The drawer's fill is its panel's, the dialog's child, not the list inside it
      const drawer = document.getElementById('controls-container').closest('.modal > div');
      return {
        pane: bg(pane),
        grid: bg(grid),
        // Open WebUI 0.13.4 fills the calendar grid; from 0.13.5 it draws only a border
        gridFilled: /(^| )(dark:)?bg-/.test(grid.className),
        drawer: drawer ? bg(drawer) : 'no drawer',
        tab: bg(document.querySelector('#controls-container .panel-tab')),
      };
    });
  };
  // Cards and panels tints the fill Open WebUI gives a panel, and adds none
  const gridTook = (v) => v.gridFilled ? /\/ 0\.2\)$/.test(v.grid) : v.grid === 'rgba(0, 0, 0, 0)';
  const wide = await look(1280);
  if (wide.pane !== 'rgba(0, 0, 0, 0)') throw new Error('a fill covers the calendar page: ' + wide.pane);
  if (!gridTook(wide)) throw new Error('the calendar grid ignores Cards and panels: ' + wide.grid + (wide.gridFilled ? '' : ' (Open WebUI gives it no fill)'));
  if (/\/ 0\.2\)$/.test(wide.tab)) throw new Error('a tab in the tab strip took the Cards fill: ' + wide.tab);
  // Below 768px pages open in the Tabs drawer, which keeps its fill
  const narrow = await look(600);
  if (narrow.drawer === 'rgba(0, 0, 0, 0)' || narrow.drawer === 'no drawer') throw new Error('the Tabs drawer lost its fill: ' + narrow.drawer);
  if (!gridTook(narrow)) throw new Error('the calendar grid in the drawer ignores Cards and panels: ' + narrow.grid);
});

test('a tab shows the background, alone or in a split view', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  const designer = await openDesigner(admin);
  await designer.evaluate(() => document.getElementById('toggle-surfaces').click());
  await waitFor('Surfaces saved', async () => (await savedState(admin)).dark?.surfacesEnabled === true || 'not yet');
  await designer.context().close();
  const page = await openPage({ token: admin });
  await page.goto(BASE + '/');
  await loaderReady(page);
  await page.getByRole('button', { name: 'New tab' }).first().click();
  await page.locator('[role="menu"] button').filter({ hasText: 'New Chat' }).first().click();
  const pane = () => page.evaluate(() => {
    const v = [...document.querySelectorAll('#controls-container [role="tabpanel"]')].find((p) => getComputedStyle(p).display !== 'none');
    return v ? getComputedStyle(v).backgroundColor : null;
  });
  await waitFor('the new chat tab', async () => (await pane()) !== null || 'not open');
  if ((await pane()) !== 'rgba(0, 0, 0, 0)') throw new Error('a fill covers a chat tab that fills the view: ' + (await pane()));
  await page.locator('#controls-container button[aria-pressed]').first().click();
  await waitFor('the split', async () => (await page.locator('#controls-container [role="separator"]').count()) > 0 || 'not split');
  if ((await pane()) !== 'rgba(0, 0, 0, 0)') throw new Error('a fill covers the tab beside the chat: ' + (await pane()));
});

test('a mesh point and a variable\'s copy button work from the keyboard', async ({ admin }) => {
  const points = [{ x: 20, y: 20, color: '#ff0000', spread: 50 }, { x: 80, y: 80, color: '#0000ff', spread: 50 }];
  await saveTheme(admin, markerTheme('instance', { overrides: {}, gradientEnabled: true, gradientType: 'mesh', gradientMeshPoints: points }));
  const page = await openDesigner(admin);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await tabTo(page, '.tab');
  await page.keyboard.press('ArrowRight');
  await tabTo(page, '.var-name[data-control="copy"]');
  await page.keyboard.press('Enter');
  await waitFor('a variable copied', async () => {
    const text = await page.evaluate(() => navigator.clipboard.readText());
    return /^--app-base-50: #[0-9a-f]{6};$/i.test(text) || text;
  });
  await tabTo(page, '.tab[data-tab="lch"]', 'Shift+Tab');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  if (await page.evaluate(() => document.activeElement.dataset.tab) !== 'bg') throw new Error('not on the Gradient tab');
  const select = '.mesh-stop-row[data-index="1"] .mesh-stop-select';
  await tabTo(page, select);
  await page.keyboard.press('Enter');
  // The list is rebuilt with the point selected, and focus stays on it
  await waitFor('mesh point 2 selected', async () => page.evaluate((s) => {
    const el = document.querySelector(s);
    return (el.getAttribute('aria-pressed') === 'true' && el.closest('.mesh-stop-row').classList.contains('selected') && document.activeElement === el) || [el.getAttribute('aria-pressed'), document.activeElement.className].join();
  }, select));
  if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
});

test('a keyboard alone loads a gallery theme, enters Draft and publishes', async ({ admin }) => {
  await keyboardLibrary(admin);
  const page = await openDesigner(admin);
  const savedHue = async () => (await savedState(admin)).dark.h;
  // Enter on a card opens Apply Library Theme, and Enter again applies it
  await tabTo(page, '#snapshot-list .preset-btn[data-index="0"] .card-apply');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#sync-modal', { state: 'visible', timeout: WAIT_MS });
  await page.keyboard.press('Enter');
  await waitFor('Ember saved', async () => (await savedHue()) === 20 || await savedHue());
  await tabTo(page, '#draft-switch');
  await page.keyboard.press('Space');
  const draft = await page.$eval('#draft-switch', (s) => ({ checked: s.getAttribute('aria-checked'), publish: getComputedStyle(document.getElementById('draft-publish-btn')).display }));
  if (draft.checked !== 'true' || draft.publish === 'none') throw new Error('Space on the Draft switch left: ' + JSON.stringify(draft));
  // In Draft, a theme loaded from the gallery stays local until Publish
  await tabTo(page, '#snapshot-list .preset-btn[data-index="1"] .card-apply', 'Shift+Tab');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#sync-modal', { state: 'visible', timeout: WAIT_MS });
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 2000));
  if (await savedHue() !== 20) throw new Error('a theme loaded in Draft reached the server before Publish');
  await tabTo(page, '#draft-publish-btn');
  await page.keyboard.press('Enter');
  await waitFor('Lagoon published', async () => (await savedHue()) === 190 || await savedHue());
  if (await page.$eval('#draft-switch', (s) => s.getAttribute('aria-checked')) !== 'false') throw new Error('Publish left the Draft switch on');
  if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
});

test('a keyboard alone renames and deletes a gallery theme', async ({ admin }) => {
  await keyboardLibrary(admin);
  const page = await openDesigner(admin);
  await tabTo(page, '#snapshot-list .preset-btn[data-index="0"] .edit-snapshot');
  // A card's buttons show on hover, and on keyboard focus too
  await page.waitForFunction(() => getComputedStyle(document.activeElement).opacity === '1', null, { timeout: 2000 })
    .catch(() => { throw new Error('a focused card button stays invisible'); });
  await page.keyboard.press('Enter');
  await page.waitForSelector('#rename-modal', { state: 'visible', timeout: WAIT_MS });
  await page.waitForFunction(() => document.activeElement.id === 'rename-input', null, { timeout: WAIT_MS });
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Embers');
  await tabTo(page, '#confirm-rename-btn');
  await page.keyboard.press('Enter');
  await waitFor('the rename saved', async () => {
    const names = await libraryNames(admin);
    return names.join() === 'Embers,Lagoon' || names;
  });
  // The gallery is rebuilt after each; focus comes back to the same button,
  // or after a delete to the card that took the deleted one's place
  const focused = () => page.evaluate(() => document.activeElement.getAttribute('aria-label'));
  await waitFor('focus back on Edit', async () => (await focused()) === 'Edit theme' || await focused());
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  if (await focused() !== 'Delete theme') throw new Error('two Tabs from Edit reached ' + await focused());
  await page.keyboard.press('Enter');
  await page.waitForSelector('#delete-modal', { state: 'visible', timeout: WAIT_MS });
  await tabTo(page, '#confirm-delete-btn');
  await page.keyboard.press('Enter');
  await waitFor('the delete saved', async () => {
    const names = await libraryNames(admin);
    return names.join() === 'Lagoon' || names;
  });
  await waitFor('focus on the next card', async () => (await focused()) === 'Apply Lagoon' || await focused());
  if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
});

test('a dialog\'s backup checkbox ticks by a click on the box and by Space', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  const page = await openDesigner(admin);
  const checked = () => page.$eval('#nuclear-backup-cb', (cb) => cb.checked);
  await page.click('#nuclear-btn');
  await page.waitForSelector('#nuclear-modal', { state: 'visible', timeout: WAIT_MS });
  await page.click('#nuclear-backup-cb');
  if (!await checked()) throw new Error('a click on the box left it unticked');
  await page.click('#nuclear-backup-cb');
  if (await checked()) throw new Error('a second click left it ticked');
  await page.focus('#nuclear-backup-cb');
  await page.keyboard.press('Space');
  if (!await checked()) throw new Error('Space left it unticked');
  const named = await page.$eval('#nuclear-backup-cb', (cb) => [...cb.labels].map((l) => l.textContent.trim()).join());
  if (named !== 'Create a backup snapshot') throw new Error('the box is named: ' + named);
  if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
});

test('a dialog keeps Tab inside it and gives focus back to what opened it', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  const page = await openDesigner(admin);
  const focusIn = (sel) => page.evaluate((s) => document.querySelector(s).contains(document.activeElement), sel);
  const focusedId = () => page.evaluate(() => document.activeElement.id);
  // A lap and a bit each way, so both ends wrap
  const cycles = async (sel) => {
    const laps = await page.$$eval(`${sel} :is(button, input, select, textarea, a[href], summary, [tabindex])`,
      (els) => els.filter((el) => el.tabIndex >= 0 && el.checkVisibility()).length + 2);
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let i = 0; i < laps; i++) {
        await page.keyboard.press(key);
        if (!await focusIn(sel)) throw new Error(`${key} ${i + 1} left ${sel} for ${await focusedId() || await page.evaluate(() => document.activeElement.tagName)}`);
      }
    }
  };
  const open = async (trigger, dialog) => {
    await page.focus(trigger);
    await page.keyboard.press('Enter');
    await page.waitForSelector(dialog, { state: 'visible', timeout: WAIT_MS });
    if (!await focusIn(dialog)) throw new Error(`${dialog} opened without taking focus`);
  };
  const closed = async (how, trigger, dialog) => {
    await page.waitForSelector(dialog, { state: 'hidden', timeout: WAIT_MS });
    const id = await focusedId();
    if ('#' + id !== trigger) throw new Error(`after ${how}, focus is on "${id}", not ${trigger}`);
  };
  await open('#nuclear-btn', '#nuclear-modal');
  await cycles('#nuclear-modal');
  await tabTo(page, '#nuclear-modal button.btn:not([id])');
  await page.keyboard.press('Enter');
  await closed('Cancel', '#nuclear-btn', '#nuclear-modal');
  await open('#nuclear-btn', '#nuclear-modal');
  await page.keyboard.press('Escape');
  await closed('Escape', '#nuclear-btn', '#nuclear-modal');
  await open('#nuclear-btn', '#nuclear-modal');
  await page.mouse.click(5, 5);
  await closed('the backdrop', '#nuclear-btn', '#nuclear-modal');
  await open('#docs-modal-btn', '#tab-docs');
  // Collapsed sections keep boxes for their contents, which can't take focus
  await page.$$eval('#tab-docs details', (all) => all.forEach((d) => { d.open = false; }));
  await cycles('#tab-docs');
  await page.keyboard.press('Escape');
  await closed('Escape', '#docs-modal-btn', '#tab-docs');
  if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
});

test('askConfirm answers no on Escape and on the backdrop, and closes only itself', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  const page = await openDesigner(admin);
  const ask = async () => {
    await page.evaluate(() => { window.__answer = 'pending'; window.askConfirm('Sure?', 'Really?', 'Go').then((ok) => { window.__answer = ok; }); });
    await page.waitForSelector('#ask-modal', { state: 'visible', timeout: WAIT_MS });
  };
  const answer = async (want, how) => {
    await page.waitForFunction(() => window.__answer !== 'pending', null, { timeout: WAIT_MS })
      .catch(() => { throw new Error(`askConfirm never answered after ${how}`); });
    const got = await page.evaluate(() => window.__answer);
    if (got !== want) throw new Error(`after ${how} askConfirm answered ${got}`);
    if (await page.$eval('#ask-modal', (m) => m.style.display) !== 'none') throw new Error(`after ${how} the dialog is still open`);
  };
  await ask(); await page.keyboard.press('Escape'); await answer(false, 'Escape');
  await ask(); await page.mouse.click(5, 5); await answer(false, 'the backdrop');
  await ask(); await page.click('#ask-modal-confirm-btn'); await answer(true, 'Continue');
  // Asked over another dialog, Escape answers the question and leaves that one open
  await page.click('#nuclear-btn');
  await page.waitForSelector('#nuclear-modal', { state: 'visible', timeout: WAIT_MS });
  await ask(); await page.keyboard.press('Escape'); await answer(false, 'Escape over Global Reset');
  if (await page.$eval('#nuclear-modal', (m) => m.style.display) !== 'flex') throw new Error('Escape on the question closed Global Reset too');
  if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
});

test('a held Enter on Delete or Global Reset opens the dialog and confirms nothing', async ({ admin }) => {
  await keyboardLibrary(admin);
  const page = await openDesigner(admin);
  await page.evaluate(() => {
    window.__confirms = 0;
    ['confirm-delete-btn', 'confirm-nuclear-btn'].forEach((id) => document.getElementById(id).addEventListener('click', () => { window.__confirms++; }));
  });
  const hold = async (trigger, dialog) => {
    await page.focus(trigger);
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await new Promise((r) => setTimeout(r, 1000));
    const confirms = await page.evaluate(() => window.__confirms);
    if (confirms) throw new Error(`a held Enter on ${trigger} confirmed ${dialog}`);
    await page.waitForSelector(dialog, { state: 'visible', timeout: WAIT_MS });
    await page.keyboard.press('Escape');
    await page.waitForSelector(dialog, { state: 'hidden', timeout: WAIT_MS });
  };
  await hold('#snapshot-list .preset-btn[data-index="0"] .delete-snapshot', '#delete-modal');
  await hold('#nuclear-btn', '#nuclear-modal');
  const names = await libraryNames(admin);
  if (names.join() !== 'Ember,Lagoon') throw new Error('the library changed: ' + names);
  if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
});

test('Escape or a backdrop click in a JSON editor asks before it drops edits, and closes an unedited one', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  const page = await openDesigner(admin);
  await page.evaluate(() => window.saveSnapshot());
  await page.waitForSelector('#save-modal', { state: 'visible', timeout: WAIT_MS });
  const open = async () => {
    await page.focus('#save-json-edit-btn');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#save-json-edit-modal', { state: 'visible', timeout: WAIT_MS });
  };
  const focused = () => page.evaluate(() => document.activeElement.id);
  await open();
  await page.keyboard.press('Escape');
  await page.waitForSelector('#save-json-edit-modal', { state: 'hidden', timeout: WAIT_MS });
  if (await page.$eval('#ask-modal', (m) => m.style.display) === 'flex') throw new Error('an unedited editor asked');
  if (await focused() !== 'save-json-edit-btn') throw new Error('focus after closing an unedited editor: ' + await focused());
  await open();
  await page.focus('#save-json-edit-textarea');
  await page.keyboard.type(' ');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#ask-modal', { state: 'visible', timeout: WAIT_MS });
  await page.keyboard.press('Escape');
  await page.waitForSelector('#ask-modal', { state: 'hidden', timeout: WAIT_MS });
  if (await page.$eval('#save-json-edit-modal', (m) => m.style.display) !== 'flex') throw new Error('No closed the editor');
  if (await focused() !== 'save-json-edit-textarea') throw new Error('focus after No: ' + await focused());
  await page.keyboard.press('Escape');
  await page.waitForSelector('#ask-modal', { state: 'visible', timeout: WAIT_MS });
  await page.click('#ask-modal-confirm-btn');
  await page.waitForSelector('#save-json-edit-modal', { state: 'hidden', timeout: WAIT_MS });
  if (await focused() !== 'save-json-edit-btn') throw new Error('focus after Discard: ' + await focused());
  // The backdrop the same way; the editor covers the Save dialog under it
  const backdrop = () => page.mouse.click(5, 5);
  await open();
  await backdrop();
  await page.waitForSelector('#save-json-edit-modal', { state: 'hidden', timeout: WAIT_MS });
  if (await page.$eval('#ask-modal', (m) => m.style.display) === 'flex') throw new Error('the backdrop of an unedited editor asked');
  await open();
  await page.focus('#save-json-edit-textarea');
  await page.keyboard.type(' ');
  await backdrop();
  await page.waitForSelector('#ask-modal', { state: 'visible', timeout: WAIT_MS })
    .catch(() => { throw new Error('the backdrop of an edited editor did not ask'); });
  await page.keyboard.press('Escape');
  await page.waitForSelector('#ask-modal', { state: 'hidden', timeout: WAIT_MS });
  if (await page.$eval('#save-json-edit-modal', (m) => m.style.display) !== 'flex') throw new Error('No after the backdrop closed the editor');
  await backdrop();
  await page.waitForSelector('#ask-modal', { state: 'visible', timeout: WAIT_MS });
  await page.click('#ask-modal-confirm-btn');
  await page.waitForSelector('#save-json-edit-modal', { state: 'hidden', timeout: WAIT_MS });
  if (await page.$eval('#save-modal', (m) => m.style.display) !== 'flex') throw new Error('Discard on the backdrop closed the Save dialog too');
  if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
});

test('Overwrite and an update install give focus back to the card button that opened them', async ({ admin }) => {
  const url = 'https://raw.githubusercontent.com/example/themes/main/ember.json';
  const live = JSON.parse(markerTheme('instance').state);
  const entry = (name, h, version) => ({ name, version, updateUrl: url, ...Object.fromEntries(MODES.map((m) => [m, { ...live[m], h }])) });
  await saveTheme(admin, markerTheme('instance'));
  await api('POST', ROUTE, { css: '', state: '', library: JSON.stringify({ snapshots: [entry('Ember', 20, '1.0.0'), entry('Lagoon', 190, '1.0.0')] }) }, admin);
  const page = await openDesigner(admin);
  await page.route(/raw\.githubusercontent\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(entry('Ember', 40, '1.1.0')) }));
  const roundTrip = async (trigger, dialog, saved) => {
    await tabTo(page, trigger);
    await page.keyboard.press('Enter');
    await page.waitForSelector(dialog, { state: 'visible', timeout: WAIT_MS });
    await page.keyboard.press('Enter');
    await page.waitForSelector(dialog, { state: 'hidden', timeout: WAIT_MS });
    await waitFor(saved, async () => {
      const lib = await api('GET', ROUTE + '/library.json', undefined, admin);
      const snaps = (lib.json && lib.json.snapshots) || [];
      return (saved === 'the overwrite saved' ? snaps[1].dark.h !== 190 : snaps[0].version === '1.1.0') || JSON.stringify(snaps.map((t) => [t.version, t.dark.h]));
    });
    const at = await page.evaluate((sel) => document.activeElement.matches(sel), trigger);
    if (!at) throw new Error(`after ${saved}, focus is on ${await page.evaluate(() => document.activeElement.outerHTML.slice(0, 120))}`);
  };
  await roundTrip('#snapshot-list .preset-btn[data-index="1"] .update-snapshot', '#overwrite-modal', 'the overwrite saved');
  await roundTrip('#snapshot-list .preset-btn[data-index="0"] .check-update-snapshot', '#update-modal', 'the update installed');
  if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
});

test('Check for Updates finishes with a host that never answers, one that stalls mid-body and one that streams past the cap', async ({ admin }) => {
  // No content-length, so only counting the bytes as they arrive stops it
  let streamed = 0;
  const server = require('http').createServer((req, res) => {
    if (req.url === '/hang.json') return;
    const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (req.url === '/ok.json') { res.writeHead(200, cors); res.end(JSON.stringify(entry('Fine', '2.0.0'))); return; }
    res.writeHead(200, cors);
    if (req.url === '/stall.json') { res.write('{"name":'); return; }
    const chunk = Buffer.alloc(1 << 20, 0x20);
    let open = true;
    res.on('close', () => { open = false; });
    const pump = () => { while (open && streamed < 200 * chunk.length) { streamed += chunk.length; if (!res.write(chunk)) return res.once('drain', pump); } if (open) res.end('{}'); };
    pump();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const at = (file) => `http://127.0.0.1:${server.address().port}/${file}`;
  const live = JSON.parse(markerTheme('instance').state);
  const entry = (name, version, file) => ({ name, version, updateUrl: file ? at(file) : '', ...live });
  try {
    await api('POST', ROUTE, { css: '', state: '', library: JSON.stringify({ snapshots: [entry('Hangs', '1.0.0', 'hang.json'), entry('Huge', '1.0.0', 'huge.json'), entry('Stalls', '1.0.0', 'stall.json'), entry('Fine', '1.0.0', 'ok.json')] }) }, admin);
    const page = await openDesigner(admin);
    await page.route(/raw\.githubusercontent\.com/, (r) => r.fulfill({ status: 404 }));
    const started = Date.now();
    await page.click('#check-updates-btn');
    await page.waitForSelector('#update-results-modal', { state: 'visible', timeout: 30000 });
    const took = Date.now() - started;
    const text = await page.textContent('#update-results-list');
    for (const want of ['Updates Available (1)', 'Errors (3)', "didn't answer within 15 seconds", 'stopped sending for 15 seconds', 'Response too large']) {
      if (!text.includes(want)) throw new Error(`the results lack "${want}": ${text.slice(0, 400)}`);
    }
    if (took > 25000) throw new Error(`the check took ${took}ms`);
    if (streamed > 64 * 1024 * 1024) throw new Error(`the designer kept reading past the cap: ${streamed} bytes sent`);
    if (await page.$eval('#check-updates-btn', (b) => b.disabled)) throw new Error('Check for Updates stayed disabled');
    await page.context().close();
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

// The Custom CSS editor and the hue slider, driven through their own handlers
function designerControls(page) {
  return {
    now: () => page.evaluate(() => ({ css: document.getElementById('custom-css-editor').value, h: document.getElementById('sl-h').value })),
    type: (text) => page.evaluate((t) => {
      const editor = document.getElementById('custom-css-editor');
      editor.value = t;
      editor.dispatchEvent(new Event('input'));
    }, text),
    setHue: (h) => page.evaluate((v) => {
      const slider = document.getElementById('sl-h');
      slider.value = v;
      slider.dispatchEvent(new Event('input'));
      slider.dispatchEvent(new Event('change'));
    }, h),
    wheelHue: () => page.evaluate(() => document.getElementById('sl-h').dispatchEvent(new WheelEvent('wheel', { deltaY: -1, cancelable: true }))),
    click: (id) => page.evaluate((i) => document.getElementById(i).click(), id),
    ctrl: (key, shiftKey = false) => page.evaluate(([k, s]) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, shiftKey: s })), [key, shiftKey]),
  };
}

test('Undo right after typing or turning a slider undoes just that, and Redo brings it back', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  const page = await openDesigner(admin);
  const ui = designerControls(page);
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const expectNow = async (want, label) => {
    const got = await ui.now();
    if (got.css !== want.css || got.h !== want.h) throw new Error(`${label}: ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
  };
  // The editor applies text after 500ms and records it for Undo 800ms later
  for (const wait of [100, 700]) {
    await ui.setHue(String(100 + wait / 100));
    const before = await ui.now();
    const typed = before.css + `/* typed, undone after ${wait}ms */`;
    await ui.type(typed);
    await pause(wait);
    await ui.click('undo-btn');
    await pause(1500);
    await expectNow(before, `Undo ${wait}ms after typing`);
    await ui.click('redo-btn');
    await pause(300);
    await expectNow({ ...before, css: typed }, `Redo of typing undone after ${wait}ms`);
  }
  // Clear replaces the text the editor is still holding back
  const typed = (await ui.now()).css + '/* typed, then cleared */';
  await ui.type(typed);
  await pause(100);
  await ui.click('clear-css-btn');
  await pause(1500);
  const cleared = await ui.now();
  if (cleared.css !== '') throw new Error('Clear 100ms after typing left: ' + JSON.stringify(cleared.css));
  await ui.click('undo-btn');
  await pause(300);
  await expectNow({ ...cleared, css: typed }, 'Undo of Clear');
  // A wheel turn is recorded for Undo 400ms after it stops
  const before = await ui.now();
  await ui.wheelHue();
  await pause(100);
  const turned = await ui.now();
  if (turned.h === before.h) throw new Error('the wheel did not turn the slider');
  await ui.ctrl('z');
  await pause(800);
  await expectNow(before, 'Ctrl+Z right after a wheel turn');
  await ui.ctrl('z', true);
  await pause(300);
  await expectNow(turned, 'Ctrl+Shift+Z after undoing a wheel turn');
  if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
});

test('an Animation Settings control changed right after typing in the Canvas FX editor keeps its value and focus', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  const page = await openDesigner(admin);
  await page.click('.tab[data-tab="canvas"]');
  const script = 'const CONFIG = {\n  speed: 2, // 1-5\n};\n';
  const type = (text) => page.evaluate((v) => {
    const editor = document.getElementById('canvas-fx-editor');
    editor.value = v;
    editor.dispatchEvent(new Event('input'));
  }, text);
  await type(script);
  await page.waitForSelector('#canvas-settings-body input[data-key="speed"]', { state: 'attached', timeout: WAIT_MS });
  await page.evaluate(() => { document.getElementById('canvas-settings').open = true; });
  // The editor still holds this text back when the slider moves
  await type(script + '// typed\n');
  await page.evaluate(() => {
    const slider = document.querySelector('#canvas-settings-body input[data-key="speed"]');
    slider.focus();
    slider.value = '4';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 1500));
  const got = await page.evaluate(() => {
    const slider = document.querySelector('#canvas-settings-body input[data-key="speed"]');
    return {
      script: document.getElementById('canvas-fx-editor').value,
      panel: slider && slider.value,
      focused: document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key || null : null,
    };
  });
  if (!/speed: 4/.test(got.script) || !/\/\/ typed/.test(got.script)) throw new Error('the script is ' + JSON.stringify(got.script));
  if (got.panel !== '4') throw new Error('the panel shows speed ' + got.panel + ', the script says 4');
  if (got.focused !== 'speed') throw new Error('the slider lost focus to ' + got.focused);
});

test('a save in another designer reloads this one only once it stops typing, keeping what was typed', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  const typing = await openDesigner(admin);
  const other = await openDesigner(admin);
  await typing.evaluate(() => { window.__tdpNotReloaded = true; });
  const cssOnHere = await typing.$eval('#toggle-custom-css', (t) => t.checked);
  const key = (i) => typing.evaluate((t) => {
    if (!window.__tdpNotReloaded) return false;
    const editor = document.getElementById('custom-css-editor');
    editor.value += t;
    editor.dispatchEvent(new Event('input'));
    return true;
  }, `/* key ${i} */`).catch(() => false);
  // A key every 200ms, and the other designer saves after the third
  for (let i = 0; i < 20; i++) {
    if (!await key(i)) throw new Error(`the designer reloaded while it was being typed in, after ${i} keys`);
    if (i === 2) {
      await other.evaluate(() => {
        // Only a save someone made reloads other designers, not one a page makes as it opens
        document.dispatchEvent(new Event('pointerdown'));
        document.getElementById('toggle-custom-css').click();
      });
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  await waitFor('the reload once typing stopped', async () => !await typing.evaluate(() => !!window.__tdpNotReloaded).catch(() => true));
  // A save carries the whole theme: the last one wins, the other designer's switch included
  const dark = (await savedState(admin)).dark;
  const css = dark.customCSS || '';
  if (!css.endsWith('/* key 19 */')) throw new Error('the saved Custom CSS lost what was typed: ' + JSON.stringify(css.slice(-60)));
  if (dark.customCssEnabled !== cssOnHere) throw new Error('the last save did not replace the other designer\'s whole theme');
});

test('a save in another designer reloads this one only once every save it queued has gone out', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  const slow = await openDesigner(admin);
  const other = await openDesigner(admin);
  // Every save from this designer takes 6s to reach the server
  await slow.route((url) => url.pathname === ROUTE, async (route) => {
    if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 6000));
    await route.continue().catch(() => {});
  });
  await slow.evaluate(() => { window.__tdpNotReloaded = true; });
  const autoScope = await slow.$eval('#toggle-auto-scope', (t) => t.checked);
  await slow.evaluate(() => document.getElementById('toggle-custom-css').click());
  await other.evaluate(() => {
    document.dispatchEvent(new Event('pointerdown'));
    document.getElementById('toggle-palette-enabled').click();
  });
  // By now it waits on the first save, and a second one queues behind it
  await new Promise((r) => setTimeout(r, 2600));
  if (!await slow.evaluate(() => !!window.__tdpNotReloaded)) throw new Error('the designer reloaded with its first save still on the way');
  await slow.evaluate(() => document.getElementById('toggle-auto-scope').click());
  await waitFor('the reload once both saves went out', async () => !await slow.evaluate(() => !!window.__tdpNotReloaded).catch(() => true), 30000);
  if ((await savedState(admin)).dark.autoScope === autoScope) throw new Error('the reload cut off the save queued while it waited');
});

test('a designer whose stream got an HTTP error reconnects and reloads for a save made while it was down', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  const page = await openPage({ token: admin });
  await page.context().addCookies([{ name: 'token', value: admin, url: BASE }]);
  // The designer's own stream answers a proxy's 502 once, then waits for the save below
  let streams = 0, release;
  const saved = new Promise((r) => { release = r; });
  await page.route((url) => url.pathname === ROUTE + '/events' && url.searchParams.has('_badge'), async (route) => {
    if (++streams === 1) return route.fulfill({ status: 502, body: 'Bad Gateway' });
    await saved;
    await route.continue().catch(() => {});
  });
  await page.goto(BASE + ROUTE);
  await page.waitForSelector('#theme-designer-container', { timeout: WAIT_MS });
  await new Promise((r) => setTimeout(r, 2500));
  await page.evaluate(() => { window.__tdpNotReloaded = true; });
  await saveTheme(admin, markerTheme('elsewhere'));
  release();
  await waitFor('the stream reconnecting after the 502', async () => streams >= 2 || `${streams} request`, 15000);
  await waitFor('the reload for the save it missed', async () => !await page.evaluate(() => !!window.__tdpNotReloaded).catch(() => true), 20000);
  // Reloaded, it holds what is saved: its own stream's resync changes nothing
  await page.waitForSelector('#theme-designer-container', { timeout: WAIT_MS });
  await page.evaluate(() => { window.__tdpNotReloaded = true; });
  await waitFor('the reloaded designer\'s stream', async () => streams >= 3 || `${streams} requests`);
  // Past the 5s that keeps reloads apart
  await new Promise((r) => setTimeout(r, 7000));
  if (!await page.evaluate(() => !!window.__tdpNotReloaded).catch(() => false)) throw new Error('the designer reloaded again with nothing missed');
});

// A theme the Theme Designer Pro Launcher would sign, applied the way its chat
// card applies it: the designer in a frame, told by postMessage
// opts.personal applies it to the token's own theme, opts.mode to one mode; opts.before(page) runs in the chat's tab first
async function applyChatTheme(admin, theme, undo, opts = {}) {
  const crypto = require('crypto');
  const secret = process.env.WEBUI_SECRET_KEY || 'tests';
  const text = JSON.stringify(theme);
  const sha = crypto.createHash('sha256').update(text).digest('hex');
  const me = await api('GET', '/api/v1/auths/', undefined, admin);
  const prefix = 'tdp-apply.v2.';
  const body = Buffer.from(JSON.stringify({ u: me.json.id, x: Math.floor(Date.now() / 1000) + 300, s: opts.personal ? 'me' : 'everyone', h: sha, m: opts.mode || 'all' })).toString('base64url');
  const token = prefix + body + '.' + crypto.createHmac('sha256', secret).update(prefix + body).digest('base64url');
  const page = await openPage({ token: admin });
  await page.context().addCookies([{ name: 'token', value: admin, url: BASE }]);
  await page.goto(BASE + '/health');
  if (opts.before) await opts.before(page);
  const ask = (action) => page.evaluate(({ src, sha, text, wait, action }) => new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    setTimeout(() => reject(new Error('the designer never answered')), wait);
    addEventListener('message', function answer(e) {
      if (e.source !== frame.contentWindow || !e.data || e.data.tdpChatTheme !== sha) return;
      if (e.data.status === 'ready') frame.contentWindow.postMessage({ tdpChatTheme: sha, action, theme: text }, '*');
      else { removeEventListener('message', answer); frame.remove(); resolve(e.data); }
    });
    frame.src = src;
    document.body.appendChild(frame);
  }), { src: ROUTE + '?' + (opts.personal ? 'scope=me&' : '') + 'apply=' + encodeURIComponent(token), sha, text, wait: WAIT_MS * 2, action });
  const applied = await ask('apply');
  // Undo, as the card's button does: a new frame in the same tab
  return undo ? [applied, await ask('undo')] : applied;
}

test('a signed chat theme whose custom CSS fetches is refused, and one with data: URLs applies without manual overrides', async ({ admin }) => {
  const chatMode = (css) => ({ h: 250, c: 10, l: 16, paletteEnabled: true, customCSS: css, customCssEnabled: true, autoScope: true,
    manualOverrides: '--tdp-chat-override: url(https://evil.test/o.png);', manualOverridesEnabled: true });
  const chatTheme = (name, css) => ({ name, dark: chatMode(css), light: chatMode(css), oled: chatMode(css), her: chatMode(css) });
  try {
    await saveTheme(admin, markerTheme('instance'));
    for (const css of ['body{background:u\\72l(https://evil.test/a.png)}', 'body{background-image:image-set("https://evil.test/b.png" 1x)}',
      '@\\69mport "https://evil.test/c.css";', '@font-face{font-family:x;src:\\75rl(https://evil.test/d.woff)}',
      // An escaped quote opens no string, so the "/*" after it is no comment
      '.x{a:\\"}.y{content:"/*"}body{background:url(https://evil.test/e.png)}',
      // An unquoted url(data:x followed by a space is a broken url token: the browser skips to the ), "/*" and all
      'a{b:url(data:x /* ) } body{background:url(https://evil.test/f.png)} */ }']) {
      const answer = await applyChatTheme(admin, chatTheme('Fetching', css));
      if (answer.status !== 'error' || !/custom CSS can.t be applied/.test(answer.message)) throw new Error(`${css} got ${JSON.stringify(answer)}`);
      if (JSON.stringify(await savedState(admin)).includes('evil.test')) throw new Error(`${css} reached the saved theme`);
    }
    const clean = '#sidebar{background:url("data:image/png;base64,iVBORw0KGgo=")}';
    const answer = await applyChatTheme(admin, chatTheme('Data URLs', clean));
    if (answer.status !== 'applied') throw new Error('the theme with data: URLs got ' + JSON.stringify(answer));
    const saved = await savedState(admin);
    if (saved.dark.customCSS !== clean) throw new Error('the theme with data: URLs was not saved');
    if (saved.dark.manualOverrides || saved.dark.manualOverridesEnabled) throw new Error('the chat theme kept its manual overrides: ' + JSON.stringify(saved.dark.manualOverrides));
  } finally {
    await saveTheme(admin, markerTheme('instance'));
  }
});

test('an install link whose CSS fetches is refused, in the link or behind its address, and one with data: URLs is offered', async ({ admin }) => {
  const mode = (css, overrides = '') => ({ h: 250, c: 10, l: 16, paletteEnabled: true, customCSS: css, customCssEnabled: true, autoScope: true,
    manualOverrides: overrides, manualOverridesEnabled: !!overrides });
  const linked = (name, css, overrides) => ({ name, ...Object.fromEntries(MODES.map((m) => [m, mode(css, overrides)])) });
  // As the Studio writes it: base64url UTF-8 JSON
  const jsonLink = (theme) => '#tdp-import=json:' + encodeURIComponent(Buffer.from(JSON.stringify(theme)).toString('base64url'));
  // A dark or light mode that isn't an object: the designer imports no such theme, so nothing is left for the check to miss
  const fetching = { customCSS: '@import url(https://example.invalid/x.css);', customCssEnabled: true };
  const malformed = [
    { name: 'Light true', dark: fetching, light: true },
    { name: 'Light string', dark: fetching, light: 'x' },
    { name: 'Dark number', dark: 1, light: fetching },
    { name: 'Overrides light true', dark: { manualOverrides: '--a: url(https://example.invalid/m.png)', manualOverridesEnabled: true }, light: true },
  ];
  const page = await openPage({ token: admin });
  await page.context().addCookies([{ name: 'token', value: admin, url: BASE }]);
  await page.route('https://example.test/**', (r) => {
    const url = r.request().url();
    const bad = /\/m(\d)\.json$/.exec(url);
    return r.fulfill(url.endsWith('.css')
      ? { status: 200, contentType: 'text/css', body: '@import "https://example.invalid/v.css";' }
      : { status: 200, contentType: 'application/json', body: JSON.stringify(bad ? malformed[bad[1]] : linked('From an address', 'body{background:u\\72l(https://example.invalid/w.png)}')) });
  });
  const open = async (hash) => {
    await page.goto('about:blank');
    await page.goto(BASE + ROUTE + hash);
    await page.waitForSelector('#theme-designer-container', { timeout: WAIT_MS });
    await new Promise((r) => setTimeout(r, 1000));
    return page.evaluate(() => ({
      offered: getComputedStyle(document.getElementById('import-clipboard-modal')).display !== 'none',
      toast: document.getElementById('action-toast').innerText
    }));
  };
  const loadRefused = async (hash, button, status) => {
    await open(hash);
    await page.click(button);
    await waitFor(`${hash} refused`, async () => {
      const text = await page.textContent(status);
      return /can.t be applied/.test(text) || text;
    });
  };
  try {
    await saveTheme(admin, markerTheme('instance'));
    const refused = [
      linked('Imports', '@import url(https://example.invalid/x.css);'),
      linked('Escaped', 'body{background:u\\72l(https://example.invalid/a.png)}'),
      linked('Unquoted', 'a{b:url(data:x /* ) } body{background:url(https://example.invalid/b.png)} */ }'),
      linked('Overrides', '', '--tdp-link-override: url(https://example.invalid/o.png);'),
      { ...linked('Backup', ''), isLibraryBackup: true, themes: [linked('Inside', '@import "https://example.invalid/y.css";')] },
      { ...linked('Snippets', ''), isCssBackup: true, css_presets: [{ name: 'Fetching', code: '@import "https://example.invalid/z.css";' }] },
    ];
    for (const theme of refused) {
      const got = await open(jsonLink(theme));
      if (got.offered || !/can.t be applied/.test(got.toast)) throw new Error(`${theme.name} got ${JSON.stringify(got)}`);
    }
    for (const theme of malformed) {
      const got = await open(jsonLink(theme));
      if (got.offered) throw new Error(`${theme.name} was offered: ${JSON.stringify(got)}`);
    }
    for (let i = 0; i < malformed.length; i++) {
      await open('#tdp-import=theme:' + encodeURIComponent(`https://example.test/m${i}.json`));
      await page.click('#import-url-load-btn');
      await waitFor(`${malformed[i].name} through its address`, async () => (await page.textContent('#action-toast')).trim() !== '' || 'no toast yet');
    }
    const clean = await open(jsonLink(linked('Data URLs', '#sidebar{background:url("data:image/png;base64,iVBORw0KGgo=")}', '--tdp-link-override: #123456;')));
    if (!clean.offered) throw new Error('the theme with data: URLs was not offered: ' + JSON.stringify(clean));
    await loadRefused('#tdp-import=theme:' + encodeURIComponent('https://example.test/t.json'), '#import-url-load-btn', '#import-url-status');
    await loadRefused('#tdp-import=css:' + encodeURIComponent('https://example.test/s.css'), '#import-css-url-load-btn', '#import-css-url-status');
    const names = await libraryNames(admin);
    const leaked = ['Imports', 'Escaped', 'Unquoted', 'Overrides', 'Backup', 'Inside', 'Snippets', 'From an address', ...malformed.map((t) => t.name)].filter((n) => names.includes(n));
    if (leaked.length) throw new Error('refused themes reached the library: ' + leaked.join(', '));
    if (JSON.stringify(await savedState(admin)).includes('example.invalid')) throw new Error('a refused theme reached the saved theme');
  } finally {
    await page.context().close();
    await saveTheme(admin, markerTheme('instance'));
  }
});

test('a saved theme the designer can\'t read is not replaced by what it opens on', async ({ admin, user }) => {
  const theme = markerTheme('instance');
  for (const state of ['{"dark":', 'null', '[1]']) {
    const res = await api('POST', ROUTE, { ...theme, state }, admin);
    if (res.status !== 400) throw new Error(`a save with state ${state} got HTTP ${res.status}, not 400`);
  }
  // An object the designer has no reader for still gets past the server
  const unreadable = { ...theme, state: JSON.stringify({ note: 'unreadable' }) };
  const toastOf = (page) => page.$eval('#action-toast', (t) => t.innerText);
  try {
    await saveTheme(admin, unreadable);
    await saveTheme(user, unreadable, true);
    const page = await openDesigner(admin);
    // Twice: a reload in the same tab resumes the Draft, which reads fine
    for (const when of ['on opening', 'after a reload']) {
      if (when !== 'on opening') {
        await page.reload();
        await page.waitForSelector('#theme-designer-container', { timeout: WAIT_MS });
        await new Promise((r) => setTimeout(r, 2500));
      }
      if ((await savedState(admin)).note !== 'unreadable') throw new Error(`the instance designer saved over the theme ${when}`);
      if (!await page.$eval('#draft-switch', (s) => s.classList.contains('on'))) throw new Error(`the instance designer was not in Draft ${when}`);
      if (!/could not be read/.test(await toastOf(page))) throw new Error(`no message about the theme ${when}, the toast says: ` + await toastOf(page));
    }
    await page.click('#draft-publish-btn');
    await page.waitForSelector('#ask-modal', { state: 'visible', timeout: WAIT_MS });
    if ((await savedState(admin)).note !== 'unreadable') throw new Error('Publish replaced the theme before asking');
    await page.click('#ask-modal-confirm-btn');
    await waitFor('the published theme', async () => !!(await savedState(admin)).dark);

    const personal = await openPage({ token: user });
    await personal.context().addCookies([{ name: 'token', value: user, url: BASE }]);
    await personal.goto(BASE + ROUTE + '?scope=me');
    await personal.waitForSelector('#theme-designer-container', { timeout: WAIT_MS });
    await new Promise((r) => setTimeout(r, 2500));
    const res = await fetch(BASE + ROUTE + '/me/state.json', { headers: { Authorization: 'Bearer ' + user }, cache: 'no-store' });
    if ((await res.json()).note !== 'unreadable') throw new Error('the personal designer saved over the theme');
    if (!/could not be read/.test(await toastOf(personal))) throw new Error('no message in the personal designer, the toast says: ' + await toastOf(personal));
  } finally {
    await removePersonalTheme(user);
    await saveTheme(admin, theme);
  }
});

test('Undo of a chat theme applied over a theme the designer can\'t read refuses instead of saving the defaults', async ({ admin }) => {
  const theme = markerTheme('instance');
  const chatMode = { h: 30, c: 12, l: 18, paletteEnabled: true };
  try {
    await saveTheme(admin, { ...theme, state: JSON.stringify({ note: 'unreadable' }) });
    const [applied, undone] = await applyChatTheme(admin, { name: 'Over unreadable', dark: chatMode, light: chatMode, oled: chatMode, her: chatMode }, true);
    if (applied.status !== 'applied') throw new Error('the chat theme got ' + JSON.stringify(applied));
    if (undone.status !== 'error' || !/could not be read/.test(undone.message)) throw new Error('Undo got ' + JSON.stringify(undone));
    const saved = await savedState(admin);
    if (!saved.dark || saved.dark.h !== 30) throw new Error('Undo replaced the chat theme with ' + JSON.stringify(saved.dark));
  } finally {
    await saveTheme(admin, theme);
  }
});

// A designer whose theme saves are answered by `answer` while it's set
// With `downFirst`, its stream answers a proxy's 502 once and reconnects only on page.streamBack()
async function designerWithSaves(token, personal, downFirst) {
  const page = await openPage({ token });
  await page.context().addCookies([{ name: 'token', value: token, url: BASE }]);
  page.saves = { answer: null, posted: 0, states: [], libraryAnswer: null, libraryPosted: 0 };
  if (downFirst) {
    let streams = 0;
    const back = new Promise((r) => { page.streamBack = r; });
    await page.route((url) => url.pathname === ROUTE + '/events' && url.searchParams.has('_badge'), async (route) => {
      if (++streams === 1) return route.fulfill({ status: 502, body: 'Bad Gateway' });
      await back;
      await route.continue().catch(() => {});
    });
  }
  const path = ROUTE + (personal ? '/me' : '');
  await page.route((url) => url.pathname === path, async (route) => {
    const body = route.request().postDataJSON() || {};
    if (route.request().method() === 'POST' && body.library) page.saves.libraryPosted++;
    if (route.request().method() === 'POST' && body.library && page.saves.libraryAnswer) {
      return route.fulfill({ status: page.saves.libraryAnswer, body: 'Bad Gateway' });
    }
    if (route.request().method() !== 'POST' || !body.state) return route.continue();
    page.saves.posted++;
    try { page.saves.states.push(JSON.parse(body.state)); } catch (e) { /* not JSON */ }
    if (page.saves.answer === 'network') return route.abort('connectionrefused');
    if (page.saves.answer) return route.fulfill({ status: page.saves.answer, contentType: 'application/json', body: '{"error":"refused for the test"}' });
    return route.continue();
  });
  await page.goto(BASE + ROUTE + (personal ? '?scope=me' : ''));
  await page.waitForSelector('#theme-designer-container', { timeout: WAIT_MS });
  await new Promise((r) => setTimeout(r, 2500));
  // A real click: the browser asks before leaving only a page the user has used
  await page.mouse.click(5, 5);
  return page;
}
const flipCustomCss = (page) => page.evaluate(() => document.getElementById('toggle-custom-css').click());
async function failOneSave(page, answer) {
  page.saves.answer = answer;
  page.saves.posted = 0;
  await flipCustomCss(page);
  await waitFor(`the save answered ${answer}`, async () => page.saves.posted > 0 || 'no save');
  await new Promise((r) => setTimeout(r, 500));
  page.saves.answer = null;
  page.saves.posted = 0;
  page.saves.states = [];
}

const inDraft = (page) => page.$eval('#draft-switch', (s) => s.classList.contains('on'));

test('a failed save becomes a draft that only Publish sends, over another designer\'s save, and a refused one says why', async ({ admin }) => {
  const theme = markerTheme('instance');
  try {
    for (const answer of [502, 'network']) {
      await saveTheme(admin, theme);
      const page = await designerWithSaves(admin);
      await failOneSave(page, answer);
      await waitFor(`the draft after a save answered ${answer}`, async () => await inDraft(page) || 'not in Draft');
      // Another designer saves: theirs stays, and nothing goes out on its own
      await api('POST', ROUTE, { ...markerTheme('elsewhere'), origin: 'anotherdesigner' }, admin);
      await new Promise((r) => setTimeout(r, 7000));
      if (page.saves.posted) throw new Error(`the draft (${answer}) was sent on its own`);
      if ((await savedState(admin)).dark.customCssEnabled === true) throw new Error(`the draft (${answer}) replaced the newer save`);
      if (!await inDraft(page)) throw new Error('the designer left Draft');
      await page.evaluate(() => document.getElementById('draft-publish-btn').click());
      await waitFor(`the published draft (${answer})`, async () => (await savedState(admin)).dark.customCssEnabled === true || 'not published');
      await page.context().close();
    }
    await saveTheme(admin, theme);
    const page = await designerWithSaves(admin);
    page.saves.answer = 413;
    await flipCustomCss(page);
    await waitFor('the refused save\'s message', async () =>
      /refused for the test/.test(await page.$eval('#action-toast', (t) => t.innerText)) || await page.$eval('#action-toast', (t) => t.innerText));
    if (await inDraft(page)) throw new Error('a refused save switched to Draft');
  } finally {
    await saveTheme(admin, theme);
  }
});

test('a gallery change that failed is dropped for another designer\'s gallery save, which survives the reload', async ({ admin }) => {
  try {
    await api('POST', ROUTE, { css: '', state: '', library: JSON.stringify({ snapshots: [] }) }, admin);
    const page = await designerWithSaves(admin);
    page.saves.libraryPosted = 0;
    page.saves.libraryAnswer = 502;
    await page.evaluate(() => { CSS_PRESETS.push({ name: 'Mine', code: 'a{}' }); syncLibrary(); });
    await waitFor('the failed gallery save', async () => page.saves.libraryPosted > 0 || 'not sent');
    await new Promise((r) => setTimeout(r, 500));
    page.saves.libraryAnswer = null;
    let asked = 0;
    page.on('dialog', (d) => { if (d.type() === 'beforeunload') asked++; d.accept().catch(() => {}); });
    await page.evaluate(() => { window.__tdpNotReloaded = true; });
    await api('POST', ROUTE, { css: '', state: '', origin: 'anotherdesigner',
      library: JSON.stringify({ snapshots: [], css_presets: [{ name: 'Theirs', code: 'b{}' }] }) }, admin);
    await waitFor('the reload for their gallery save', async () => !await page.evaluate(() => !!window.__tdpNotReloaded).catch(() => true) || 'not reloaded', 20000);
    await page.waitForSelector('#theme-designer-container', { timeout: WAIT_MS });
    await new Promise((r) => setTimeout(r, 3000));
    if (asked) throw new Error('the reload for their save asked before leaving');
    const lib = (await api('GET', ROUTE + '/library.json', undefined, admin)).json || {};
    const names = (lib.css_presets || []).map((p) => p.name);
    if (!names.includes('Theirs') || names.includes('Mine')) throw new Error('the gallery after the reload: ' + JSON.stringify(names));
  } finally {
    await api('POST', ROUTE, { css: '', state: '', library: JSON.stringify({ snapshots: [] }) }, admin);
  }
});

test('a designer in Draft pauses its gallery saves for another designer\'s gallery save, and a reload shows theirs and keeps the draft', async ({ admin }) => {
  const theme = markerTheme('instance');
  const serverNames = async () => (((await api('GET', ROUTE + '/library.json', undefined, admin)).json || {}).css_presets || []).map((p) => p.name);
  try {
    await saveTheme(admin, theme);
    await api('POST', ROUTE, { css: '', state: '', library: JSON.stringify({ snapshots: [] }) }, admin);
    const page = await designerWithSaves(admin);
    await failOneSave(page, 502);
    await waitFor('the draft', async () => await inDraft(page) || 'not in Draft');
    page.saves.libraryPosted = 0;
    page.saves.libraryAnswer = 502;
    await page.evaluate(() => { CSS_PRESETS.push({ name: 'Mine', code: 'a{}' }); syncLibrary(); });
    await waitFor('the failed gallery save', async () => page.saves.libraryPosted > 0 || 'not sent');
    await new Promise((r) => setTimeout(r, 500));
    page.saves.libraryAnswer = null;
    await api('POST', ROUTE, { css: '', state: '', origin: 'anotherdesigner',
      library: JSON.stringify({ snapshots: [], css_presets: [{ name: 'Theirs', code: 'b{}' }] }) }, admin);
    await waitFor('the pause message', async () => /paused until this page reloads/.test(await page.$eval('#action-toast', (t) => t.innerText)) || 'no message');
    page.saves.libraryPosted = 0;
    await page.evaluate(() => { CSS_PRESETS.push({ name: 'Later', code: 'c{}' }); syncLibrary(); });
    await new Promise((r) => setTimeout(r, 2000));
    if (page.saves.libraryPosted) throw new Error('a gallery change went out while paused');
    if (!/paused/.test(await page.$eval('#action-toast', (t) => t.innerText))) throw new Error('the paused gallery change said nothing');
    const names = await serverNames();
    if (!names.includes('Theirs') || names.includes('Mine') || names.includes('Later')) throw new Error('the server gallery: ' + JSON.stringify(names));
    let asked = 0;
    page.on('dialog', (d) => { if (d.type() === 'beforeunload') asked++; d.accept().catch(() => {}); });
    await page.reload();
    await page.waitForSelector('#theme-designer-container', { timeout: WAIT_MS });
    await new Promise((r) => setTimeout(r, 2500));
    if (asked) throw new Error('the reload asked before leaving on account of the gallery');
    const after = await page.evaluate(() => CSS_PRESETS.map((p) => p.name));
    if (!after.includes('Theirs') || after.includes('Later')) throw new Error('the gallery after the reload: ' + JSON.stringify(after));
    if (!await inDraft(page) || !await page.$eval('#toggle-custom-css', (t) => t.checked)) throw new Error('the draft was lost on the reload');
    if (!/wasn.t saved/.test(await page.$eval('#action-toast', (t) => t.innerText))) throw new Error('the reload did not say the gallery change was lost');
  } finally {
    await api('POST', ROUTE, { css: '', state: '', library: JSON.stringify({ snapshots: [] }) }, admin);
    await saveTheme(admin, theme);
  }
});

test('a personal save that fails is held until Retry, which asks first over a theme saved elsewhere', async ({ user }) => {
  const personalState = async () => (await fetch(BASE + ROUTE + '/me/state.json', { headers: { Authorization: 'Bearer ' + user }, cache: 'no-store' })).json();
  try {
    await saveTheme(user, markerTheme('mine'), true);
    const page = await designerWithSaves(user, true);
    await failOneSave(page, 502);
    await page.waitForSelector('#tdp-held-save', { timeout: WAIT_MS });
    await page.evaluate(() => document.getElementById('toggle-palette-enabled').click());
    await new Promise((r) => setTimeout(r, 2000));
    if (page.saves.posted) throw new Error('a held save went out with the next change');
    await page.click('#tdp-held-save button');
    await waitFor('the save Retry sent', async () => (await personalState()).dark.customCssEnabled === true || 'not saved');
    if (await page.$('#tdp-held-save')) throw new Error('the Retry bar stayed');

    await failOneSave(page, 502);
    await page.waitForSelector('#tdp-held-save', { timeout: WAIT_MS });
    await api('POST', ROUTE + '/me', { ...markerTheme('elsewhere', { h: 99 }), origin: 'anotherdesigner' }, user);
    await new Promise((r) => setTimeout(r, 1500));
    await page.click('#tdp-held-save button');
    await page.waitForSelector('#ask-modal', { state: 'visible', timeout: WAIT_MS });
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 1500));
    if (page.saves.posted || (await personalState()).dark.h !== 99) throw new Error('Retry replaced the newer save without asking');

    // Reloaded, it asks before saving what it kept, and saves nothing on its own
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await page.reload();
    await page.waitForSelector('#theme-designer-container', { timeout: WAIT_MS });
    await page.waitForSelector('#ask-modal', { state: 'visible', timeout: WAIT_MS });
    await new Promise((r) => setTimeout(r, 2000));
    if ((await personalState()).dark.h !== 99) throw new Error('the reload saved what it kept without asking');
  } finally {
    await removePersonalTheme(user);
  }
});

test('a Factory Reset after a failed save neither asks before leaving nor brings the change back', async ({ admin }) => {
  const theme = markerTheme('instance');
  try {
    await saveTheme(admin, theme);
    const page = await designerWithSaves(admin);
    await failOneSave(page, 502);
    let asked = 0;
    page.on('dialog', (d) => { if (d.type() === 'beforeunload') asked++; d.accept().catch(() => {}); });
    await page.evaluate(() => { document.getElementById('factory-backup-cb').checked = false; });
    await page.evaluate(() => document.getElementById('factory-reset-btn').click());
    await page.evaluate(() => { window.__tdpNotReloaded = true; document.getElementById('confirm-factory-reset-btn').click(); });
    await waitFor('the reload after the reset', async () => !await page.evaluate(() => !!window.__tdpNotReloaded).catch(() => true) || 'not reloaded');
    await page.waitForSelector('#theme-designer-container', { timeout: WAIT_MS });
    await new Promise((r) => setTimeout(r, 2500));
    if (asked) throw new Error('the reset\'s reload asked before leaving');
    if (await inDraft(page)) throw new Error('the failed change came back as a draft');
  } finally {
    await saveTheme(admin, theme);
  }
});

test('a change made while the function is off waits as a draft through a reload until Publish', async ({ admin }) => {
  const theme = markerTheme('instance');
  const toggle = () => api('POST', `/api/v1/functions/id/${FUNCTION_ID}/toggle`, undefined, admin);
  let off = false;
  try {
    await saveTheme(admin, theme);
    const page = await openDesigner(admin);
    const customOn = await page.$eval('#toggle-custom-css', (t) => t.checked);
    await toggle(); off = true;
    await waitFor('the designer hearing the function is off', async () =>
      /inactive/i.test(await page.$eval('#inactive-badge-text', (b) => b.innerText)) || 'not yet');
    await flipCustomCss(page);
    await waitFor('the draft', async () => await inDraft(page) || 'not in Draft');
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await page.reload().catch(() => {});
    await toggle(); off = false;
    await new Promise((r) => setTimeout(r, 1500));
    await page.reload();
    await page.waitForSelector('#theme-designer-container', { timeout: WAIT_MS });
    await new Promise((r) => setTimeout(r, 2500));
    if (await page.$eval('#toggle-custom-css', (t) => t.checked) === customOn) throw new Error('the change was lost on the reload');
    if (!await inDraft(page)) throw new Error('the change did not stay a draft');
    if ((await savedState(admin)).dark.customCssEnabled === !customOn) throw new Error('the change was published without Publish');
  } finally {
    if (off) await toggle();
    await saveTheme(admin, theme);
  }
});

test('the hidden frame a chat theme applies through neither takes this tab\'s held changes nor its draft', async ({ admin, user }) => {
  const chatMode = { h: 30, c: 12, l: 18, paletteEnabled: true };
  const chat = { name: 'Hidden frame', dark: chatMode, light: chatMode, oled: chatMode, her: chatMode };
  const held = JSON.stringify(JSON.parse(markerTheme('held', { h: 77 }).state));
  const plant = (page) => page.evaluate((st) => {
    sessionStorage.setItem('owui_tdp_me_unsaved_theme', JSON.stringify({ scope: 'personal', state: st, confirmed: true }));
    sessionStorage.setItem('owui_theme_draft_mode', '1');
    sessionStorage.setItem('owui_dev_theme_v1', st);
  }, held);
  try {
    // One mode, so the others show what the frame loaded
    await saveTheme(admin, markerTheme('instance'));
    const answer = await applyChatTheme(user, chat, false, { personal: true, mode: 'dark', before: plant });
    if (answer.status !== 'applied') throw new Error('the personal chat theme got ' + JSON.stringify(answer));
    const res = await fetch(BASE + ROUTE + '/me/state.json', { headers: { Authorization: 'Bearer ' + user }, cache: 'no-store' });
    const mine = await res.json();
    if (mine.dark.h !== 30 || mine.light.h === 77) throw new Error('the hidden frame saved the held changes: ' + JSON.stringify(mine.light));
    const instance = await applyChatTheme(admin, chat, false, { mode: 'dark', before: plant });
    if (instance.status !== 'applied') throw new Error('the instance chat theme got ' + JSON.stringify(instance));
    const saved = await savedState(admin);
    if (saved.dark.h !== 30 || saved.light.h === 77) throw new Error('the hidden frame published this tab\'s draft: ' + JSON.stringify(saved.light));
    // With Draft Mode Default on, the frame still never enters Draft, so this tab's draft keys stay as they were
    await setValves(admin, { draft_mode_default: true });
    let after = null;
    const again = await applyChatTheme(admin, { ...chat, name: 'Hidden frame, valve on' }, false, { mode: 'dark', before: async (page) => {
      await plant(page);
      page.readDraft = () => page.evaluate(() => [sessionStorage.getItem('owui_theme_draft_mode'), sessionStorage.getItem('owui_dev_theme_v1')]);
      after = page;
    } });
    if (again.status !== 'applied') throw new Error('with Draft Mode Default on, the chat theme got ' + JSON.stringify(again));
    const [flag, draft] = await after.readDraft();
    if (flag !== '1' || draft !== held) throw new Error('the hidden frame changed this tab\'s draft: ' + JSON.stringify([flag, draft && draft.slice(0, 60)]));
    if ((await savedState(admin)).light.h === 77) throw new Error('with Draft Mode Default on, the hidden frame published this tab\'s draft');
  } finally {
    await setValves(admin, {});
    await removePersonalTheme(user);
    await saveTheme(admin, markerTheme('instance'));
  }
});

test('a theme\'s own accent reaches theme CSS and Canvas FX, and other accents stay generated', async ({ admin }) => {
  // Reports the colors it was given, every 200ms, to the page
  const script = [
    'var colors = null, channel = new BroadcastChannel("tdp-accent");',
    'self.onmessage = function (e) {',
    '  var t = e.data && e.data.type === "init" ? e.data.theme : e.data && e.data.type === "theme" ? e.data : null;',
    '  if (t && t.colors) colors = t.colors;',
    '};',
    'setInterval(function () { if (colors) channel.postMessage(colors); }, 200);',
  ].join('\n');
  const theme = markerTheme('instance', { h: 200, c: 40, canvasEnabled: true, canvasScript: script });
  const state = JSON.parse(theme.state);
  // Uppercase, as a hand-edited file might have it
  state.dark.accent = '#FF8800';
  await saveTheme(admin, { ...theme, state: JSON.stringify(state) });
  // The designer writes the theme CSS from the state it opens
  const designer = await openDesigner(admin);
  await designer.context().close();

  const accents = (page) => page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return ['--tdp-accent', '--tdp-accent-2', '--tdp-accent-3'].map((n) => style.getPropertyValue(n).trim());
  });
  const page = await openPage({ token: admin });
  await page.goto(BASE + '/');
  await loaderReady(page);
  await page.evaluate(() => {
    window.tdpAccentColors = null;
    new BroadcastChannel('tdp-accent').onmessage = (e) => { window.tdpAccentColors = e.data; };
  });
  // Dark sets the first accent; the other two come from hue 200 on a dark mode
  await waitFor('the accents in Dark', async () => {
    const a = await accents(page);
    return a[0] === '#ff8800' && a[1] === 'oklch(0.74 0.160 240.0)' && a[2] === 'oklch(0.74 0.160 160.0)' ? true : a;
  });
  await waitFor('the set accent in the Canvas FX theme', async () => {
    const c = await page.evaluate(() => window.tdpAccentColors);
    return c && c.accent === '#ff8800' && /^#[0-9a-f]{6}$/.test(c.accent2) && c.accent2 !== '#ff8800' ? true : c;
  });

  // Light sets none, so its first accent is generated too
  const light = await openPage({ token: admin });
  await light.addInitScript(() => localStorage.setItem('theme', 'light'));
  await light.goto(BASE + '/');
  await loaderReady(light);
  await waitFor('the accents in Light', async () => {
    const a = await accents(light);
    return a[0] === 'oklch(0.56 0.160 200.0)' ? true : a;
  });
  if (page.errors.length || light.errors.length) throw new Error('page errors: ' + [...page.errors, ...light.errors].join(' | '));
});

test('the designer moves an older browser copy of its gallery to the server and keeps none', async ({ admin }) => {
  const LIBRARY_KEYS = ['owui_theme_snapshots', 'owui_canvas_presets', 'owui_css_presets', 'owui_gradient_presets'];
  await saveTheme(admin, markerTheme('instance'));
  await api('POST', ROUTE, { css: '', state: '', library: JSON.stringify({ snapshots: [] }) }, admin);
  // What an older build left in this browser
  const page = await openPage({ token: admin });
  await page.context().addCookies([{ name: 'token', value: admin, url: BASE }]);
  await page.goto(BASE + '/auth');
  const old = { name: 'Browser copy', ...JSON.parse(markerTheme('old').state) };
  await page.evaluate((t) => localStorage.setItem('owui_theme_snapshots', JSON.stringify([t])), old);
  const galleryCount = () => page.evaluate(() => Number(document.getElementById('library-count').textContent) || 0);
  const kept = () => page.evaluate((keys) => keys.filter((k) => localStorage.getItem(k) !== null), LIBRARY_KEYS);

  await page.goto(BASE + ROUTE);
  await page.waitForSelector('#theme-designer-container', { timeout: WAIT_MS });
  await waitFor('the browser copy in the gallery', async () => (await galleryCount()) === 1 || await galleryCount());
  await waitFor('the browser copy on the server', async () => {
    const lib = await (await fetch(BASE + ROUTE + '/library.json', { headers: { Authorization: 'Bearer ' + admin } })).json();
    return (lib.snapshots || []).some((s) => s.name === 'Browser copy') || 'not there';
  });

  await page.reload();
  await page.waitForSelector('#theme-designer-container', { timeout: WAIT_MS });
  await waitFor('the gallery after a reload', async () => (await galleryCount()) === 1 || await galleryCount());
  const left = await kept();
  if (left.length) throw new Error('still in browser storage: ' + left.join(', '));
  if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
});

// ── Model and folder backgrounds ──

// A model of its own: a pipe function, which Open WebUI lists as a model
const BG_MODEL = 'tdp_bg_pipe';
const PIPE = 'class Pipe:\n    def pipe(self, body: dict) -> str:\n        return "ok"\n';
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// The model, with a background image uploaded the way its editor uploads one
async function addPipeModel(admin) {
  if ((await api('GET', `/api/v1/functions/id/${BG_MODEL}`, undefined, admin)).status === 200) return;
  const made = await api('POST', '/api/v1/functions/create',
    { id: BG_MODEL, name: 'Background model', content: PIPE, meta: { description: 'End-to-end tests' } }, admin);
  if (made.status !== 200) throw new Error('Could not add the model: ' + JSON.stringify(made.json));
  await api('POST', `/api/v1/functions/id/${BG_MODEL}/toggle`, undefined, admin);
}

// Uploaded the way the model editor uploads one: its address names the file
async function uploadPicture(token, base64) {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(base64, 'base64')], { type: 'image/png' }), 'background.png');
  const res = await fetch(BASE + '/api/v1/files/?process=false', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
  if (!res.ok) throw new Error('Could not upload the image: ' + res.status);
  return `/api/v1/files/${(await res.json()).id}/content`;
}

async function modelWithBackground(admin) {
  await addPipeModel(admin);
  const existing = await api('GET', `/api/v1/models/model?id=${BG_MODEL}`, undefined, admin);
  const had = existing.status === 200 && existing.json && existing.json.meta && existing.json.meta.background_image_url;
  if (had) return had;
  const url = await uploadPicture(admin, PNG_1PX);
  const made = await api('POST', '/api/v1/models/create',
    { id: BG_MODEL, base_model_id: null, name: 'Background model', meta: { background_image_url: url }, params: {} }, admin);
  if (made.status !== 200) throw new Error('Could not give the model a background: ' + JSON.stringify(made.json));
  return url;
}

// One of the user's folders, with a background image set the way Edit Folder sets one
async function folderWithBackground(user) {
  const made = await api('POST', '/api/v1/folders/', { name: 'Backgrounds ' + Date.now() }, user);
  if (made.status !== 200) throw new Error('Could not add a folder: ' + JSON.stringify(made.json));
  const meta = { background_image_url: 'data:image/png;base64,' + PNG_1PX };
  const updated = await api('POST', `/api/v1/folders/${made.json.id}/update`, { name: made.json.name, meta }, user);
  if (updated.status !== 200) throw new Error('Could not give the folder a background: ' + JSON.stringify(updated.json));
  return made.json.id;
}

function hidingBackgrounds(theme, hidden) {
  return { ...theme, state: JSON.stringify({ ...JSON.parse(theme.state), _hiddenBackgrounds: hidden }) };
}

// Whether Open WebUI's background image, and the dimming layer over it, show
async function expectChatBackground(page, shown, label) {
  await waitFor(label, () => page.evaluate((want) => {
    const image = [...document.querySelectorAll('div.pointer-events-none.absolute.bg-cover')]
      .find((el) => (el.getAttribute('style') || '').includes('background-image'));
    if (!image) return 'no background image on the page';
    const visible = (el) => !!el && getComputedStyle(el).display !== 'none';
    const state = { image: visible(image), dimming: visible(image.nextElementSibling) };
    return state.image === want && state.dimming === want ? true : state;
  }, shown));
}

test('a theme hides the background image of a model it names', async ({ admin }) => {
  await modelWithBackground(admin);
  await removePersonalTheme(admin);
  await saveTheme(admin, markerTheme('instance'));
  const page = await openPage({ token: admin });
  await page.goto(BASE + '/?models=' + BG_MODEL);
  await loaderReady(page);
  await expectChatBackground(page, true, 'the model\'s background before the theme names it');
  // A page already open follows the save
  await saveTheme(admin, hidingBackgrounds(markerTheme('instance'), { models: [BG_MODEL] }));
  await expectChatBackground(page, false, 'the model\'s background on an open page');
  const fresh = await openPage({ token: admin });
  await fresh.goto(BASE + '/?models=' + BG_MODEL);
  await loaderReady(fresh);
  await expectChatBackground(fresh, false, 'the model\'s background after a page load');
  if (fresh.errors.length) throw new Error('page errors: ' + fresh.errors.join(' | '));
});

test('a personal theme hides the background image of a folder it names', async ({ admin, user }) => {
  await saveTheme(admin, markerTheme('instance'));
  const folder = await folderWithBackground(user);
  await saveTheme(user, markerTheme('mine'), true);
  const page = await openPage({ token: user });
  await page.goto(BASE + '/folders/' + folder);
  await loaderReady(page);
  await expectChatBackground(page, true, 'the folder\'s background before the theme names it');
  await saveTheme(user, hidingBackgrounds(markerTheme('mine'), { folders: [folder] }), true);
  const fresh = await openPage({ token: user });
  await fresh.goto(BASE + '/folders/' + folder);
  await loaderReady(fresh);
  await expectChatBackground(fresh, false, 'the folder\'s background');
  await removePersonalTheme(user);
});

// How much of Open WebUI's background image, and the dimming layer over it, shows
async function expectChatBackgroundShare(page, share, label) {
  await waitFor(label, () => page.evaluate((want) => {
    const image = [...document.querySelectorAll('div.pointer-events-none.absolute.bg-cover')]
      .find((el) => (el.getAttribute('style') || '').includes('background-image'));
    if (!image) return 'no background image on the page';
    const seen = [image, image.nextElementSibling].map((el) => getComputedStyle(el).opacity);
    return seen.every((o) => o === want) ? true : 'opacity ' + seen.join(' and ');
  }, share));
}

// A model with no background image, so the Chat Background Image is the one shown
const PLAIN_MODEL = 'tdp_plain_pipe';
async function modelWithoutBackground(admin) {
  if ((await api('GET', `/api/v1/functions/id/${PLAIN_MODEL}`, undefined, admin)).status === 200) return;
  const made = await api('POST', '/api/v1/functions/create',
    { id: PLAIN_MODEL, name: 'Plain model', content: PIPE, meta: { description: 'End-to-end tests' } }, admin);
  if (made.status !== 200) throw new Error('Could not add the model: ' + JSON.stringify(made.json));
  await api('POST', `/api/v1/functions/id/${PLAIN_MODEL}/toggle`, undefined, admin);
}

test('a theme fades the Chat Background Image', async ({ admin }) => {
  await modelWithoutBackground(admin);
  // Set the way Settings > Interface sets it, and put back afterwards
  const before = (await api('GET', '/api/v1/users/user/settings', undefined, admin)).json || {};
  const had = (before.ui && before.ui.backgroundImageUrl) || null;
  const image = 'data:image/png;base64,' + PNG_1PX;
  const set = await api('POST', '/api/v1/users/user/settings/update',
    { ...before, ui: { ...(before.ui || {}), backgroundImageUrl: image } }, admin);
  if (set.status !== 200) throw new Error('Could not set the Chat Background Image: ' + set.status);
  try {
    await removePersonalTheme(admin);
    await saveTheme(admin, markerTheme('instance'));
    const page = await openPage({ token: admin });
    await page.goto(BASE + '/?models=' + PLAIN_MODEL);
    await loaderReady(page);
    await expectChatBackground(page, true, 'the Chat Background Image before the theme fades it');
    // A page already open follows the save
    await saveTheme(admin, hidingBackgrounds(markerTheme('instance'), { chat: 0 }));
    await expectChatBackground(page, false, 'the Chat Background Image at 0% on an open page');
    await saveTheme(admin, hidingBackgrounds(markerTheme('instance'), { chat: 40 }));
    const fresh = await openPage({ token: admin });
    await fresh.goto(BASE + '/?models=' + PLAIN_MODEL);
    await loaderReady(fresh);
    await expectChatBackgroundShare(fresh, '0.4', 'the Chat Background Image at 40% after a page load');
    if (fresh.errors.length) throw new Error('page errors: ' + fresh.errors.join(' | '));
  } finally {
    // A null field is what clears it: settings updates patch the Interface fields
    await api('POST', '/api/v1/users/user/settings/update',
      { ...before, ui: { ...(before.ui || {}), backgroundImageUrl: had } }, admin);
    await saveTheme(admin, markerTheme('instance'));
  }
});

test('Canvas FX draws over the Chat Background Image unless the theme turns it off', async ({ admin }) => {
  await modelWithoutBackground(admin);
  const before = (await api('GET', '/api/v1/users/user/settings', undefined, admin)).json || {};
  const had = (before.ui && before.ui.backgroundImageUrl) || null;
  await api('POST', '/api/v1/users/user/settings/update',
    { ...before, ui: { ...(before.ui || {}), backgroundImageUrl: 'data:image/png;base64,' + PNG_1PX } }, admin);
  const layer = (page) => page.evaluate(() => {
    const image = [...document.querySelectorAll('div.pointer-events-none.absolute.bg-cover')]
      .find((el) => (el.getAttribute('style') || '').includes('background-image'));
    if (!image) return 'no background image on the page';
    return getComputedStyle(image).zIndex + ' and ' + getComputedStyle(image.nextElementSibling).zIndex;
  });
  try {
    await removePersonalTheme(admin);
    const flags = { canvasEnabled: true, canvasScript: 'self.onmessage = function () {};' };
    // On by default: a theme that says nothing about it
    await saveTheme(admin, markerTheme('instance', flags));
    const page = await openPage({ token: admin });
    await page.goto(BASE + '/?models=' + PLAIN_MODEL);
    await loaderReady(page);
    await waitFor('the canvas', async () => !!(await page.$('#owui-theme-canvas-bg')) || 'missing');
    await waitFor('the Chat Background Image behind the canvas', async () => (await layer(page)) === '-1 and -1' || await layer(page));
    // Turned off, the image stays in front of the animation
    await saveTheme(admin, hidingBackgrounds(markerTheme('instance', flags), { behind: false }));
    await waitFor('the Chat Background Image in front when turned off', async () => (await layer(page)) === 'auto and 0' || await layer(page));
    // Without an animation it stays in front, where it can be seen
    await saveTheme(admin, markerTheme('instance'));
    const fresh = await openPage({ token: admin });
    await fresh.goto(BASE + '/?models=' + PLAIN_MODEL);
    await loaderReady(fresh);
    await waitFor('the Chat Background Image in front without a canvas', async () => (await layer(fresh)) === 'auto and 0' || await layer(fresh));
    if (fresh.errors.length) throw new Error('page errors: ' + fresh.errors.join(' | '));
  } finally {
    await api('POST', '/api/v1/users/user/settings/update',
      { ...before, ui: { ...(before.ui || {}), backgroundImageUrl: had } }, admin);
    await saveTheme(admin, markerTheme('instance'));
  }
});

test('Dimming thins Open WebUI\'s dimming layer, together with each image\'s opacity', async ({ admin }) => {
  await modelWithoutBackground(admin);
  const before = (await api('GET', '/api/v1/users/user/settings', undefined, admin)).json || {};
  const had = (before.ui && before.ui.backgroundImageUrl) || null;
  await api('POST', '/api/v1/users/user/settings/update',
    { ...before, ui: { ...(before.ui || {}), backgroundImageUrl: 'data:image/png;base64,' + PNG_1PX } }, admin);
  const opacity = (page) => page.evaluate(() => {
    const image = [...document.querySelectorAll('div.pointer-events-none.absolute.bg-cover')]
      .find((el) => (el.getAttribute('style') || '').includes('background-image'));
    if (!image) return 'no background image on the page';
    return getComputedStyle(image).opacity + ' and ' + getComputedStyle(image.nextElementSibling).opacity;
  });
  try {
    await removePersonalTheme(admin);
    await saveTheme(admin, hidingBackgrounds(markerTheme('instance'), { dimming: 40 }));
    const page = await openPage({ token: admin });
    await page.goto(BASE + '/?models=' + PLAIN_MODEL);
    await loaderReady(page);
    await waitFor('the dimming layer at 40%', async () => (await opacity(page)) === '1 and 0.4' || await opacity(page));
    await saveTheme(admin, hidingBackgrounds(markerTheme('instance'), { dimming: 40, chat: 50 }));
    await waitFor('the image at 50% under a dimming layer at 40%', async () => (await opacity(page)) === '0.5 and 0.2' || await opacity(page));
    if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
  } finally {
    await api('POST', '/api/v1/users/user/settings/update',
      { ...before, ui: { ...(before.ui || {}), backgroundImageUrl: had } }, admin);
    await saveTheme(admin, markerTheme('instance'));
  }
});

// Two more 1px pictures, so a change of Chat Background Image changes its address
const RED_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4IScHAAK2AQU0pnWqAAAAAElFTkSuQmCC';
const BLUE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQkzsBAAFiAQURG6MhAAAAAElFTkSuQmCC';

async function setChatBackground(token, url) {
  const before = (await api('GET', '/api/v1/users/user/settings', undefined, token)).json || {};
  const res = await api('POST', '/api/v1/users/user/settings/update',
    { ...before, ui: { ...(before.ui || {}), backgroundImageUrl: url } }, token);
  if (res.status !== 200) throw new Error('Could not set the Chat Background Image: ' + res.status);
  return (before.ui && before.ui.backgroundImageUrl) || null;
}

// The picture the theme draws behind the pages without a chat
const pageBackdrop = (page) => page.evaluate(() => {
  const app = document.querySelector('.app');
  return app ? getComputedStyle(app, '::before').backgroundImage : 'no .app';
});

// Holds a page's lookups of the Chat Background Image back, so another tab answers first
function answerLate(page) {
  return page.route((url) => url.pathname === '/api/v1/users/user/settings' || url.pathname === '/api/v1/models/model', async (route) => {
    if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, 1500));
    await route.continue().catch(() => {});
  });
}

const chatBackgroundChange = (savingTabFirst) => async ({ admin }) => {
  await modelWithoutBackground(admin);
  // Personal themes off, as they are by default
  await setValves(admin, { allow_personal_themes: false });
  const had = await setChatBackground(admin, RED_PNG);
  try {
    await saveTheme(admin, hidingBackgrounds(markerTheme('instance'), { chat: 0, pages: { share: 100, source: 'chat' } }));
    const page = await openPage({ token: admin });
    await page.goto(BASE + '/?models=' + PLAIN_MODEL);
    await loaderReady(page);
    await expectChatBackground(page, false, 'the first Chat Background Image');
    const tab = async () => {
      const p = await page.context().newPage();
      p.errors = [];
      p.on('pageerror', (e) => p.errors.push(e.message));
      return p;
    };
    // Another tab of the same account keeps the image it was showing
    const other = await tab();
    await other.goto(BASE + '/?models=' + PLAIN_MODEL);
    await loaderReady(other);
    await expectChatBackground(other, false, 'the first Chat Background Image in another tab');
    const workspace = await tab();
    await workspace.goto(BASE + '/workspace');
    await loaderReady(workspace);
    await waitFor('the Chat Background Image behind Workspace', async () => (await pageBackdrop(workspace)).includes('blob:') || await pageBackdrop(workspace));
    const backdrop = await pageBackdrop(workspace);
    await Promise.all([page, other, workspace].map((p) => p.evaluate(() => { window.__tdpSamePage = true; })));
    await answerLate(savingTabFirst ? other : page);
    // Picked in Settings > Interface, as a person picks one
    await openSettings(page);
    await page.click('button[aria-controls="tab-interface"]');
    await page.setInputFiles('#tab-interface input[type="file"]',
      { name: 'blue.png', mimeType: 'image/png', buffer: Buffer.from(BLUE_PNG.split(',')[1], 'base64') });
    await waitFor('the new image saved', async () => ((await api('GET', '/api/v1/users/user/settings', undefined, admin)).json?.ui?.backgroundImageUrl === BLUE_PNG) || 'not yet');
    await page.keyboard.press('Escape');
    await expectChatBackground(page, false, 'the new Chat Background Image');
    await expectChatBackground(other, false, 'the first Chat Background Image in a tab still showing it');
    await waitFor('the new Chat Background Image behind Workspace', async () => {
      const now = await pageBackdrop(workspace);
      return (now.includes('blob:') && now !== backdrop) || now;
    });
    for (const p of [page, other, workspace]) {
      if (!(await p.evaluate(() => window.__tdpSamePage === true))) throw new Error('a page reloaded');
      if (p.errors.length) throw new Error('page errors: ' + p.errors.join(' | '));
    }
  } finally {
    await setChatBackground(admin, had);
    await setValves(admin, {});
    await saveTheme(admin, markerTheme('instance'));
  }
};
test('a Chat Background Image changed in Settings follows the theme\'s fade without a reload, the saving tab answering first', chatBackgroundChange(true));
test('a Chat Background Image changed in Settings follows the theme\'s fade without a reload, another tab answering first', chatBackgroundChange(false));

test('a model\'s background changed by an admin follows the theme\'s fade without a reload', async ({ admin }) => {
  const first = await modelWithBackground(admin);
  await saveTheme(admin, hidingBackgrounds(markerTheme('instance'), { models: { [BG_MODEL]: 0 } }));
  const page = await openPage({ token: admin });
  await page.goto(BASE + '/?models=' + BG_MODEL);
  await loaderReady(page);
  await expectChatBackground(page, false, 'the model\'s first background');
  // A second tab, which answers last
  const other = await page.context().newPage();
  await other.goto(BASE + '/?models=' + BG_MODEL);
  await loaderReady(other);
  await answerLate(other);
  const hiddenRule = (p) => p.evaluate(() => (document.getElementById('owui-tdp-hidden-bg') || {}).textContent || '');
  const update = (url) => api('POST', '/api/v1/models/model/update?id=' + BG_MODEL,
    { id: BG_MODEL, base_model_id: null, name: 'Background model', meta: { background_image_url: url }, params: {} }, admin);
  try {
    const next = await uploadPicture(admin, BLUE_PNG.split(',')[1]);
    const res = await update(next);
    if (res.status !== 200) throw new Error('Could not change the model\'s background: ' + JSON.stringify(res.json));
    // The editor that saved it shows the new one, and other pages the one they have
    for (const p of [page, other]) {
      await waitFor('a fade for the new background and the old one', async () => {
        const css = await hiddenRule(p);
        return (css.includes(next) && css.includes(first)) || css;
      });
    }
    await expectChatBackground(page, false, 'the model\'s first background on a page still showing it');
    if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
  } finally {
    await update(first);
  }
});

test('with personal themes off, a page claims its stream only when it fades the Chat Background Image and its cookie didn\'t name it', async ({ admin }) => {
  await setValves(admin, { allow_personal_themes: false });
  const claims = async (theme, cookie) => {
    await saveTheme(admin, theme);
    const page = await openPage({ token: admin });
    if (cookie) await page.context().addCookies([{ name: 'token', value: admin, url: BASE }]);
    let n = 0;
    page.on('request', (r) => { if (r.url().endsWith(ROUTE + '/events/bind')) n++; });
    await page.goto(BASE + '/');
    await loaderReady(page);
    await new Promise((r) => setTimeout(r, 1500));
    await page.context().close();
    return n;
  };
  try {
    const fading = hidingBackgrounds(markerTheme('instance'), { chat: 0 });
    const got = {
      plain: await claims(markerTheme('instance'), false),
      fadingWithCookie: await claims(fading, true),
      fadingWithoutCookie: await claims(fading, false),
    };
    if (got.plain !== 0 || got.fadingWithCookie !== 0 || got.fadingWithoutCookie !== 1) throw new Error('claims: ' + JSON.stringify(got));
  } finally {
    await setValves(admin, {});
    await saveTheme(admin, markerTheme('instance'));
  }
});

test('a signed-out page\'s stream hears no model id the instance theme doesn\'t name', async ({ admin }) => {
  const first = await modelWithBackground(admin);
  await modelWithoutBackground(admin);
  // A workspace model no instance theme names
  const PRIVATE = 'tdp_private_model';
  const plain = { id: PRIVATE, base_model_id: PLAIN_MODEL, name: 'Private model', meta: {}, params: {} };
  if ((await api('GET', `/api/v1/models/model?id=${PRIVATE}`, undefined, admin)).status !== 200) {
    const made = await api('POST', '/api/v1/models/create', plain, admin);
    if (made.status !== 200) throw new Error('Could not add the model: ' + JSON.stringify(made.json));
  }
  await saveTheme(admin, hidingBackgrounds(markerTheme('instance'), { models: { [BG_MODEL]: 0 } }));
  // Every backgrounds-update frame a page's stream delivers
  const listening = async (token, path) => {
    const page = await openPage({ token });
    await page.addInitScript(() => {
      window.__tdpFrames = [];
      const Native = window.EventSource;
      window.EventSource = function (url, init) {
        const es = new Native(url, init);
        es.addEventListener('backgrounds-update', (e) => window.__tdpFrames.push(e.data));
        return es;
      };
      window.EventSource.prototype = Native.prototype;
      window.EventSource.CLOSED = Native.CLOSED;
    });
    await page.goto(BASE + path);
    await loaderReady(page);
    await new Promise((r) => setTimeout(r, 1000));
    return page;
  };
  const frames = (page) => page.evaluate(() => window.__tdpFrames.map((d) => JSON.parse(d)));
  const signedOut = await listening(null, '/auth');
  const signedIn = await listening(admin, '/');
  const res = await api('POST', '/api/v1/models/model/update?id=' + PRIVATE, plain, admin);
  if (res.status !== 200) throw new Error('Could not change the model: ' + JSON.stringify(res.json));
  await api('POST', '/api/v1/models/model/update?id=' + BG_MODEL,
    { id: BG_MODEL, base_model_id: null, name: 'Background model', meta: { background_image_url: first }, params: {} }, admin);
  await waitFor('the named model\'s frame on the sign-in page', async () => {
    const got = await frames(signedOut);
    return got.some((d) => (d.ids || []).includes(BG_MODEL)) || got;
  });
  const out = await frames(signedOut);
  if (out.some((d) => !d.ids || d.ids.includes(PRIVATE))) throw new Error('the sign-in page heard of another model: ' + JSON.stringify(out));
  // With personal themes on, a signed-in page still hears that some model changed
  await waitFor('an id-less frame on a signed-in page', async () => {
    const got = await frames(signedIn);
    return got.some((d) => d.scope === 'models' && !d.ids) || got;
  });
  if (JSON.stringify(await frames(signedIn)).includes(PRIVATE)) throw new Error('a frame named the other model');
});

test('a hidden Chat Background Image stays hidden after signing in on the sign-in page', async ({ admin }) => {
  await modelWithoutBackground(admin);
  await modelWithBackground(admin);
  const had = await setChatBackground(admin, RED_PNG);
  try {
    await saveTheme(admin, hidingBackgrounds(markerTheme('instance'), { chat: 0, models: { [BG_MODEL]: 0 } }));
    const page = await openPage();
    const asked = [];
    page.on('request', (r) => { if (/\/api\/v1\/(models\/model\?|users\/user\/settings$)/.test(r.url())) asked.push(r.url()); });
    await page.goto(BASE + '/auth?redirect=' + encodeURIComponent('/?models=' + PLAIN_MODEL));
    await loaderReady(page);
    await new Promise((r) => setTimeout(r, 500));
    if (asked.length) throw new Error('looked up backgrounds while signed out: ' + asked.join(', '));
    await page.evaluate(() => { window.__tdpSamePage = true; });
    await signInWithForm(page, ADMIN);
    await expectChatBackground(page, false, 'the Chat Background Image after signing in');
    await waitFor('the model\'s background looked up', async () => {
      const urls = await page.evaluate(() => JSON.parse(localStorage.getItem('owui_tdp_model_bg') || '{}'));
      return !!urls['tdp_bg_pipe'] || urls;
    });
    if (!(await page.evaluate(() => window.__tdpSamePage === true))) throw new Error('the page reloaded');
    if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
  } finally {
    await setChatBackground(admin, had);
    await saveTheme(admin, markerTheme('instance'));
  }
});

test('the sign-in page shows the instance theme\'s picture, which only an admin can set', async ({ admin, user }) => {
  const png = Buffer.from(PNG_1PX, 'base64');
  const upload = (token, body, type) => fetch(BASE + ROUTE + '/auth-background', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': type }, body,
  });
  let res = await upload(user, png, 'image/png');
  if (res.status !== 403) throw new Error('a user could upload the sign-in picture: ' + res.status);
  res = await upload(admin, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png');
  if (res.status !== 415) throw new Error('a file that isn\'t a picture was taken: ' + res.status);
  res = await upload(admin, png, 'image/png');
  if (res.status !== 200) throw new Error('could not upload the sign-in picture: ' + res.status);
  const { url } = await res.json();
  const served = await fetch(BASE + url);
  if (served.status !== 200 || served.headers.get('content-type') !== 'image/png') {
    throw new Error('the picture isn\'t served to a signed-out visitor: ' + served.status + ' ' + served.headers.get('content-type'));
  }
  const backdrop = (page) => page.evaluate(() => {
    const el = document.querySelector('#auth-page > div.absolute.h-full');
    if (!el) return 'no backdrop';
    const cs = getComputedStyle(el);
    return (cs.backgroundImage.includes('auth-background') ? 'picture' : 'none') + ' at ' + cs.opacity;
  });
  try {
    await saveTheme(admin, hidingBackgrounds(markerTheme('instance'), { auth: { url, share: 60 } }));
    const page = await openPage();
    await page.goto(BASE + '/auth');
    await loaderReady(page);
    await waitFor('the picture on the sign-in page', async () => (await backdrop(page)) === 'picture at 0.6' || await backdrop(page));
    await setValves(admin, { enable_auth_page_theming: false });
    const off = await openPage();
    await off.goto(BASE + '/auth');
    await loaderReady(off);
    await waitFor('no picture with Enable Auth Page Theming off', async () => (await backdrop(off)) === 'none at 1' || await backdrop(off));
    if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
  } finally {
    await setValves(admin, {});
    await saveTheme(admin, markerTheme('instance'));
    await fetch(BASE + ROUTE + '/auth-background', { method: 'DELETE', headers: { Authorization: 'Bearer ' + admin } });
  }
  const gone = await fetch(BASE + url);
  if (gone.status !== 404) throw new Error('the removed picture is still served: ' + gone.status);
});

test('a page on another origin can\'t save a theme or change a picture with the admin\'s cookie', async ({ admin }) => {
  // Another port of the same host: same site, so the Lax cookie goes along.
  // A real server, since Chrome lets only a page it loaded from loopback call loopback.
  const server = require('http').createServer((req, res) => res.end('<!doctype html><title>Other</title>'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const other = new URL(BASE);
  other.port = String(server.address().port);
  const theme = markerTheme('forged');
  const send = ({ base, route, theme, png }) => {
    const call = (path, init) => fetch(base + route + path, { credentials: 'include', ...init })
      .then((r) => r.status, () => 'blocked');
    const picture = new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))]);
    return Promise.all([
      call('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(theme) }),
      call('/page-background', { method: 'POST', body: picture }),
      call('/auth-background', { method: 'POST', body: picture }),
      call('/page-background', { method: 'DELETE' }),
    ]);
  };
  const args = { base: BASE, route: ROUTE, theme, png: PNG_1PX };
  await saveTheme(admin, markerTheme('instance'));
  const page = await openPage();
  try {
    await page.context().addCookies([{ name: 'token', value: admin, url: BASE, sameSite: 'Lax' }]);
    await page.goto(other.origin + '/');
    const forged = await page.evaluate(send, args);
    if (forged.some((s) => s !== 403)) throw new Error('another origin was not refused: ' + forged.join(', '));
    const css = await (await fetch(BASE + ROUTE + '/theme.css')).text();
    if (css.includes('forged')) throw new Error('the forged theme was saved');
    if ((await fetch(BASE + ROUTE + '/auth-background')).status !== 404) throw new Error('the forged picture was saved');
    // The designer's own origin, and a frame like the one Open WebUI shows a tool's card in
    await page.goto(BASE + '/health');
    if (String(await page.evaluate(send, args)) !== '200,200,200,200') throw new Error('a same-origin save was refused');
    const framed = await page.evaluate(async (args) => {
      const card = document.createElement('iframe');
      card.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-downloads');
      card.srcdoc = '<!doctype html><iframe src="' + args.route + '/theme.css"></iframe>';
      document.body.appendChild(card);
      const inner = await new Promise((resolve) => {
        const look = () => {
          const f = card.contentDocument && card.contentDocument.querySelector('iframe');
          if (f && f.contentDocument && f.contentDocument.readyState === 'complete' && f.contentWindow.location.pathname.endsWith('theme.css')) resolve(f.contentWindow);
          else setTimeout(look, 50);
        };
        look();
      });
      return (await new inner.Function('args', 'return (' + args.send + ')(args)')(args)).join(',');
    }, { ...args, send: send.toString() });
    if (framed !== '200,200,200,200') throw new Error('a save from a framed designer was refused: ' + framed);
    // No Origin at all, as from curl, signed in by the cookie alone
    const res = await fetch(BASE + ROUTE, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'token=' + admin }, body: JSON.stringify(markerTheme('instance')) });
    if (res.status !== 200) throw new Error('a request without an Origin was refused: ' + res.status);
  } finally {
    server.close();
    await saveTheme(admin, markerTheme('instance'));
    await fetch(BASE + ROUTE + '/auth-background', { method: 'DELETE', headers: { Authorization: 'Bearer ' + admin } });
    await fetch(BASE + ROUTE + '/page-background', { method: 'DELETE', headers: { Authorization: 'Bearer ' + admin } });
  }
});

test('an uploaded Other pages picture shows with or without Open WebUI\'s token cookie, fetched once a picture', async ({ admin }) => {
  const upload = async (base64) => {
    const res = await fetch(BASE + ROUTE + '/page-background', { method: 'POST', headers: { Authorization: 'Bearer ' + admin, 'Content-Type': 'image/png' }, body: Buffer.from(base64, 'base64') });
    if (res.status !== 200) throw new Error('could not upload the picture: ' + res.status);
    return (await res.json()).url;
  };
  const showing = (url) => saveTheme(admin, hidingBackgrounds(markerTheme('instance'), { pages: { source: 'url', url, share: 60 } }));
  const go = (page, where) => page.evaluate((w) => history.pushState(history.state, '', w), where);
  try {
    await showing(await upload(PNG_1PX));
    for (const cookie of [false, true]) {
      const page = await openPage({ token: admin });
      const asked = [];
      page.on('response', (r) => { if (new URL(r.url()).pathname === ROUTE + '/page-background') asked.push(r.status()); });
      await page.goto(BASE + '/');
      await loaderReady(page);
      await new Promise((r) => setTimeout(r, 1000));
      if (asked.length) throw new Error('fetched the picture on a chat page: ' + asked);
      // Open WebUI sets the cookie when the page checks its sign-in, which a
      // Secure cookie on plain http, for one, doesn't survive
      if (!cookie) await page.context().clearCookies();
      await go(page, '/workspace/models');
      await waitFor('the picture behind Workspace', async () => ((await pageBackdrop(page)).includes('blob:') && asked.length === 1) || [await pageBackdrop(page), asked]);
      const first = (await pageBackdrop(page)).match(/blob:[^"]+/)[0];
      for (const where of ['/notes', '/', '/workspace/models']) await go(page, where);
      await new Promise((r) => setTimeout(r, 500));
      if (asked.join() !== '200' || !(await pageBackdrop(page)).includes(first)) throw new Error('navigating fetched it again: ' + asked + ' ' + await pageBackdrop(page));
      if (!cookie) {
        // A new picture replaces the old one's blob address, which is let go
        await showing(await upload(BLUE_PNG.split(',')[1]));
        await waitFor('the new picture', async () => (!(await pageBackdrop(page)).includes(first) && (await pageBackdrop(page)).includes('blob:')) || [await pageBackdrop(page), asked]);
        const kept = await page.evaluate((u) => fetch(u).then(() => true, () => false), first);
        if (kept) throw new Error('the old picture\'s blob address was kept');
      }
      if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
      await page.context().close();
    }
  } finally {
    await saveTheme(admin, markerTheme('instance'));
    await fetch(BASE + ROUTE + '/page-background', { method: 'DELETE', headers: { Authorization: 'Bearer ' + admin } });
  }
});

test('a save in another designer reloads this one only once its picture upload is done', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  const slow = await openDesigner(admin);
  const other = await openDesigner(admin);
  await slow.route((url) => url.pathname === ROUTE + '/page-background', async (route) => {
    if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 6000));
    await route.continue().catch(() => {});
  });
  try {
    await slow.evaluate(() => { window.__tdpNotReloaded = true; });
    await slow.waitForSelector('input[data-pages="file"]', { state: 'attached', timeout: WAIT_MS });
    await slow.setInputFiles('input[data-pages="file"]', { name: 'slow.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1PX, 'base64') });
    await other.evaluate(() => {
      document.dispatchEvent(new Event('pointerdown'));
      document.getElementById('toggle-palette-enabled').click();
    });
    await new Promise((r) => setTimeout(r, 4000));
    if (!await slow.evaluate(() => !!window.__tdpNotReloaded)) throw new Error('the designer reloaded with its upload still on the way');
    await waitFor('the upload saved, then the reload', async () => {
      const pages = (await savedState(admin))._hiddenBackgrounds?.pages;
      return (!!pages && !await slow.evaluate(() => !!window.__tdpNotReloaded).catch(() => true)) || 'waiting';
    }, 30000);
  } finally {
    await saveTheme(admin, markerTheme('instance'));
    await fetch(BASE + ROUTE + '/page-background', { method: 'DELETE', headers: { Authorization: 'Bearer ' + admin } });
  }
});

test('a picture chosen while an upload is on the way wins over the upload', async ({ admin }) => {
  await saveTheme(admin, markerTheme('instance'));
  const page = await openDesigner(admin);
  let posted = false;
  await page.route((url) => url.pathname === ROUTE + '/page-background', async (route) => {
    if (route.request().method() === 'POST') { posted = true; await new Promise((r) => setTimeout(r, 3000)); }
    await route.continue().catch(() => {});
  });
  const chosen = 'https://example.com/chosen.png';
  try {
    await page.waitForSelector('input[data-pages="file"]', { state: 'attached', timeout: WAIT_MS });
    await page.setInputFiles('input[data-pages="file"]', { name: 'slow.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1PX, 'base64') });
    await waitFor('the upload on its way', async () => posted || 'not sent');
    await page.evaluate((u) => {
      document.querySelector('input[data-pages="url"]').value = u;
      document.querySelector('button[data-pages="use"]').click();
    }, chosen);
    await new Promise((r) => setTimeout(r, 5000));
    const pages = (await savedState(admin))._hiddenBackgrounds?.pages;
    if (!pages || pages.url !== chosen) throw new Error('the upload replaced the address chosen after it: ' + JSON.stringify(pages));
    const left = await fetch(BASE + ROUTE + '/page-background', { headers: { Authorization: 'Bearer ' + admin } });
    if (left.status !== 404) throw new Error('the superseded upload is still on the server: ' + left.status);
    if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
  } finally {
    await saveTheme(admin, markerTheme('instance'));
    await fetch(BASE + ROUTE + '/page-background', { method: 'DELETE', headers: { Authorization: 'Bearer ' + admin } });
  }
});

test('a picture removed while Publish is on the way is deleted with it', async ({ admin }) => {
  const res = await fetch(BASE + ROUTE + '/page-background', { method: 'POST', headers: { Authorization: 'Bearer ' + admin, 'Content-Type': 'image/png' }, body: Buffer.from(PNG_1PX, 'base64') });
  const { url } = await res.json();
  const served = async () => (await fetch(BASE + url, { headers: { Authorization: 'Bearer ' + admin } })).status;
  try {
    await saveTheme(admin, hidingBackgrounds(markerTheme('instance'), { pages: { source: 'url', url, share: 60 } }));
    const page = await openDesigner(admin);
    await page.evaluate(() => document.getElementById('draft-switch').click());
    await page.waitForSelector('button[data-pages="remove"]', { state: 'attached', timeout: WAIT_MS });
    let published = false;
    await page.route((u) => u.pathname === ROUTE, async (route) => {
      if (route.request().method() === 'POST' && !published) { published = true; await new Promise((r) => setTimeout(r, 3000)); }
      await route.continue().catch(() => {});
    });
    await page.evaluate(() => document.getElementById('draft-publish-btn').click());
    await waitFor('Publish on its way', async () => published || 'not sent');
    await page.evaluate(() => document.querySelector('button[data-pages="remove"]').click());
    await waitFor('the removed picture deleted once Publish lands', async () => (await served()) === 404 || 'still served', 15000);
    await waitFor('the live theme drops the removed picture', async () => !(await savedState(admin))._hiddenBackgrounds?.pages || 'still shows it');
    if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
  } finally {
    await saveTheme(admin, markerTheme('instance'));
    await fetch(BASE + ROUTE + '/page-background', { method: 'DELETE', headers: { Authorization: 'Bearer ' + admin } });
  }
});

test('a reset in Draft keeps the uploaded pictures until Publish, and Undo says what it can\'t bring back', async ({ admin }) => {
  const png = Buffer.from(PNG_1PX, 'base64');
  const put = async (where) => {
    const res = await fetch(BASE + ROUTE + where, { method: 'POST', headers: { Authorization: 'Bearer ' + admin, 'Content-Type': 'image/png' }, body: png });
    if (res.status !== 200) throw new Error('could not upload to ' + where + ': ' + res.status);
    return (await res.json()).url;
  };
  // Reading the page picture needs a sign-in
  const served = async (url) => (await fetch(BASE + url, { headers: { Authorization: 'Bearer ' + admin } })).status;
  const pictures = async () => {
    const auth = await put('/auth-background');
    const pages = await put('/page-background');
    await saveTheme(admin, hidingBackgrounds(markerTheme('instance'), { auth: { url: auth, share: 60 }, pages: { source: 'url', url: pages, share: 60 } }));
    return [auth, pages];
  };
  const resetMode = (page) => page.evaluate(() => {
    document.getElementById('reset-mode-btn').click();
    document.getElementById('confirm-reset-btn').click();
  });
  try {
    const [auth, pages] = await pictures();
    const draft = await openDesigner(admin);
    const writes = [];
    draft.on('request', (r) => { if (r.method() !== 'GET' && /-background/.test(r.url())) writes.push(r.method() + ' ' + new URL(r.url()).pathname); });
    await draft.evaluate(() => document.getElementById('draft-switch').click());
    await resetMode(draft);
    await draft.waitForSelector('input[data-pages="file"]', { state: 'attached', timeout: WAIT_MS });
    await draft.setInputFiles('input[data-pages="file"]', { name: 'new.png', mimeType: 'image/png', buffer: png });
    await new Promise((r) => setTimeout(r, 1000));
    if (writes.length) throw new Error('Draft changed the pictures on the server: ' + writes.join(', '));
    if (await served(auth) !== 200 || await served(pages) !== 200) throw new Error('a picture the published theme uses went away in Draft');
    // A reload keeps the draft, and Publish still deletes what it dropped
    await draft.reload();
    await draft.waitForSelector('#theme-designer-container', { timeout: WAIT_MS });
    await new Promise((r) => setTimeout(r, 2500));
    if (!await draft.$eval('#draft-publish-btn', (b) => b.classList.contains('visible'))) throw new Error('the reload left Draft');
    if (writes.length) throw new Error('the reloaded draft changed the pictures on the server: ' + writes.join(', '));
    await draft.evaluate(() => document.getElementById('draft-publish-btn').click());
    await waitFor('Publish deletes the pictures the reset dropped',
      async () => ((await served(auth)) === 404 && (await served(pages)) === 404) || writes);
    if (draft.errors.length) throw new Error('page errors: ' + draft.errors.join(' | '));

    // Live: the reset deletes them at once, and Undo says so
    const [liveAuth] = await pictures();
    const live = await openDesigner(admin);
    await resetMode(live);
    await waitFor('Live Reset Mode deletes the picture', async () => (await served(liveAuth)) === 404 || 'still served');
    await live.evaluate(() => document.getElementById('undo-btn').click());
    const toast = await live.$eval('#action-toast', (t) => t.innerText);
    if (!/Backgrounds/.test(toast) || !/can.t come back/.test(toast)) throw new Error('Undo after the reset said: ' + JSON.stringify(toast));
    if (live.errors.length) throw new Error('page errors: ' + live.errors.join(' | '));
  } finally {
    await saveTheme(admin, markerTheme('instance'));
    for (const where of ['/auth-background', '/page-background']) {
      await fetch(BASE + ROUTE + where, { method: 'DELETE', headers: { Authorization: 'Bearer ' + admin } });
    }
  }
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
  // The Canvas FX question before a theme with a script is applied, asked in
  // the designer's own dialog
  await page.evaluate(() => {
    const modal = document.getElementById('ask-modal');
    new MutationObserver(() => {
      if (modal.style.display === 'flex') document.getElementById('ask-modal-confirm-btn').click();
    }).observe(modal, { attributes: true, attributeFilter: ['style'] });
  });
  await page.evaluate((files) => {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(new File([f.text], f.name, { type: 'application/json' })));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, themes.map((t, i) => ({ name: `theme-${i}.json`, text: JSON.stringify(t) })));
  const count = () => page.evaluate(() => Number(document.getElementById('library-count').textContent) || 0);
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
  const catalog = read('docs/catalog.json');
  // The Studio opens gallery themes through the catalog, which CI rebuilds
  // after a merge, so a theme added on a branch joins this test then
  const listed = new Set((catalog.themes || []).map((t) => t.file));
  const gallery = fs.readdirSync(path.join(REPO_ROOT, 'themes')).filter((f) => f.endsWith('.json') && listed.has(f));
  const originals = [...fixtures.map(read), ...gallery.map((f) => read('themes/' + f))];
  const built = [
    ...['mesh', 'radial'].map((type) => ({ type, hash: 'gradient=' + catalog.gradients.find((g) => g.type === type).file })),
    // The catalog is rebuilt by CI after a merge, so it can list a script that was just removed
    { hash: 'fx=' + catalog.canvasFx.find((x) => fs.existsSync(path.join(REPO_ROOT, 'canvas-fx', x.file))).file },
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
