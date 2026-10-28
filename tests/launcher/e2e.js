/**
 * End-to-end tests for the Theme Designer Pro Launcher on a running Open WebUI.
 *
 *   BASE_URL=http://127.0.0.1:3000 node tests/launcher/e2e.js
 *
 * BASE_URL must be a fresh, throwaway Open WebUI whose OpenAI connection is
 * scripted_model.py (see README.md): the tests sign up its first account as
 * admin, install the event function and the Launcher, and change themes.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');

const base = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const out = process.env.OUT || path.join(require('os').tmpdir(), 'tdp-launcher-e2e');
const DESIGNER = '/api/v1/theme-designer';
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const ROOT = path.join(__dirname, '..', '..');
const ADMIN = {name: 'Admin', email: 'admin@tdp.test', password: 'tdp-e2e-admin-pw'};
const USER = {name: 'User', email: 'user@tdp.test', password: 'tdp-e2e-user-pw'};
const PUBLIC = [{principal_type: 'user', principal_id: '*', permission: 'read'}];

async function api(method, p, token, body) {
  const headers = {'Content-Type': 'application/json'};
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(base + p, {method, headers, body: body ? JSON.stringify(body) : undefined});
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
  return {status: r.status, json, text};
}
const personalState = token => api('GET', DESIGNER + '/me/state.json', token).then(r => r.status === 200 && r.json && Object.keys(r.json).length ? r.json : null);
const instanceState = token => api('GET', DESIGNER + '/state.json', token).then(r => r.status === 200 ? r.json : null);

async function signIn(account) {
  const r = await api('POST', '/api/v1/auths/signin', null, {email: account.email, password: account.password});
  return r.status === 200 ? r.json.token : null;
}

// The accounts, the event function, the Launcher, and a model that has it with native function calling
async function setUp() {
  let admin = await signIn(ADMIN);
  if (!admin) {
    const r = await api('POST', '/api/v1/auths/signup', null, ADMIN);
    if (r.status !== 200 || r.json.role !== 'admin') throw new Error('Could not create the admin account: ' + r.status);
    admin = r.json.token;
  }
  let user = await signIn(USER);
  if (!user) { await api('POST', '/api/v1/auths/add', admin, {...USER, role: 'user'}); user = await signIn(USER); }
  const install = async (kind, id, name, file, extra = {}) => {
    const form = {id, name, content: fs.readFileSync(path.join(ROOT, file), 'utf8'), meta: {description: 'End-to-end tests'}, ...extra};
    const existing = await api('GET', `/api/v1/${kind}/id/${id}`, admin);
    const r = await api('POST', existing.status === 200 ? `/api/v1/${kind}/id/${id}/update` : `/api/v1/${kind}/create`, admin, form);
    if (r.status !== 200) throw new Error(`Could not install ${name}: ${r.text.slice(0, 200)}`);
  };
  await install('functions', 'theme_designer_pro', 'Theme Designer Pro', 'event-function/theme_designer_pro_event.py');
  const fn = await api('GET', '/api/v1/functions/id/theme_designer_pro', admin);
  if (!fn.json.is_active) await api('POST', '/api/v1/functions/id/theme_designer_pro/toggle', admin);
  await api('POST', '/api/v1/functions/id/theme_designer_pro/valves/update', admin, {allow_personal_themes: true});
  await install('tools', 'theme_designer_pro_launcher', 'Theme Designer Pro Launcher', 'launcher/theme_designer_pro_launcher.py', {access_grants: PUBLIC});
  const model = {id: 'theme-bot-tools', base_model_id: 'theme-bot', name: 'Theme Bot', meta: {toolIds: ['theme_designer_pro_launcher']}, params: {function_calling: 'native'}, access_grants: PUBLIC, is_active: true};
  if ((await api('GET', '/api/v1/models/model?id=theme-bot-tools', admin)).status !== 200) await api('POST', '/api/v1/models/create', admin, model);
  for (const t of [admin, user]) await api('POST', '/api/v1/users/user/settings/update', t, {ui: {iframeSandboxAllowSameOrigin: true, models: ['theme-bot-tools']}});
  return {admin, user};
}

(async () => {
  fs.mkdirSync(out, {recursive: true});
  const auth = await setUp();
  const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist']});
  const results = [];
  async function test(name, fn) {
    if (ONLY && !ONLY.test(name)) return;
    try { await fn(); results.push(['PASS', name]); console.log('PASS', name); }
    catch (e) { results.push(['FAIL', name]); console.log('FAIL', name, '\n ', e.stack.split('\n').slice(0, 4).join('\n  ')); }
  }
  async function pageFor(token, viewport = {width: 1440, height: 1000}) {
    const ctx = await browser.newContext({viewport, colorScheme: 'dark'});
    // Init scripts run in every frame, the sandboxed card's too, where storage throws
    await ctx.addInitScript(t => { try { localStorage.token = t; localStorage.theme = 'dark'; } catch (e) {} }, token);
    const page = await ctx.newPage();
    page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
    if (process.env.DEBUG_CONSOLE) { page.on('console', m => console.log('  console', m.type(), m.text().slice(0, 200))); page.on('crash', () => console.log('  CRASH')); }
    page.on('dialog', d => d.accept());
    await page.goto(base + '/?model=theme-bot-tools'); await page.locator('#chat-input').waitFor();
    const okay = page.getByRole('button', {name: "Okay, Let's Go!"}); if (await okay.isVisible().catch(() => false)) await okay.click();
    return page;
  }
  async function ask(page, text) {
    await page.locator('#chat-input').click(); await page.keyboard.insertText(text); await page.keyboard.press('Enter');
  }
  // The card's frame: an embed whose document has the card in it
  async function cardFrame(page, index = 0, timeout = 30000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const frames = [];
      for (const f of page.frames()) if (await f.locator('#card').count().catch(() => 0)) frames.push(f);
      if (frames[index]) return frames[index];
      await page.waitForTimeout(250);
    }
    throw new Error('No theme card appeared');
  }
  async function cardData(frame) { return JSON.parse(await frame.locator('#tdp-data').textContent()); }
  const designerFrames = page => page.frames().filter(f => f.url().includes(DESIGNER) && !f.url().includes('apply='));

  const honu = {name: 'Honu Lagoon', hue: 190, chroma: 30, lightness: 16, description: 'A turquoise lagoon where koi glide under frosted glass.', background: 'koi pond', glass: true};

  await test('a described theme shows a card, not the designer, with the catalog animation and glass', async () => {
    const page = await pageFor(auth.user);
    await ask(page, 'THEME ' + JSON.stringify(honu));
    const card = await cardFrame(page);
    assert.equal(await card.locator('#name').textContent(), 'Honu Lagoon');
    const sub = await card.locator('#sub').textContent();
    assert(/^Your theme · Koi Pond · glass$/.test(sub), sub);
    assert.equal(designerFrames(page).length, 0, 'the designer must not open');
    const data = await cardData(card); const theme = JSON.parse(data.theme);
    assert(theme.dark.canvasEnabled && /Koi Pond/.test(theme.dark.canvasScript));
    assert(theme.dark.customCssEnabled && theme.light.customCssEnabled && theme.oled.l === 0 && theme.light.l === 20);
    assert.equal(theme.dark.gradientEnabled, false, 'an animation replaces the gradient');
    await page.waitForTimeout(1500);
    await page.screenshot({path: out + '/card.png'});
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  await test('Preview opens a larger live preview and the chat frame grows to fit it', async () => {
    const page = await pageFor(auth.user);
    await ask(page, 'THEME ' + JSON.stringify(honu));
    const card = await cardFrame(page);
    const frameEl = await card.frameElement(); const before = (await frameEl.boundingBox()).height;
    await card.getByRole('button', {name: 'Preview', exact: true}).click();
    await card.locator('#big .tdp-stage').waitFor();
    await page.waitForTimeout(800);
    const after = (await frameEl.boundingBox()).height;
    assert(after > before + 200, `frame ${before} -> ${after}`);
    assert(await card.locator('#big .tdp-stage iframe[sandbox="allow-scripts"]').count() === 1, 'the isolated animation moved into the preview');
    await card.getByRole('button', {name: 'Light', exact: true}).click();
    assert(await card.locator('.tdp-stage.light-mode').count() === 1);
    await card.getByRole('button', {name: 'Dark', exact: true}).click();
    await page.waitForTimeout(1500);
    await frameEl.screenshot({path: out + '/preview.png'});
    await card.getByRole('button', {name: 'Close preview'}).click();
    assert(await card.locator('#thumb .tdp-stage').count() === 1);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  await test('Apply puts the theme on the user\'s own theme and the open page follows; Undo goes back to the instance theme', async () => {
    assert.equal(await personalState(auth.user), null, 'the user starts on the instance theme');
    const page = await pageFor(auth.user);
    const grayBefore = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-gray-900').trim());
    await ask(page, 'THEME ' + JSON.stringify(honu));
    const card = await cardFrame(page);
    await card.getByRole('button', {name: 'Apply theme'}).click();
    await card.getByRole('button', {name: 'Applied'}).waitFor({timeout: 45000});
    const state = await personalState(auth.user);
    assert(state && state.dark.h === 190 && state.dark.c === 30 && state.dark.canvasEnabled && state.light.customCssEnabled, JSON.stringify(state && state.dark).slice(0, 200));
    const lib = await api('GET', DESIGNER + '/me/library.json', auth.user);
    assert.equal(lib.json.snapshots[0].name, 'Honu Lagoon');
    await page.waitForFunction(g => getComputedStyle(document.documentElement).getPropertyValue('--color-gray-900').trim() !== g, grayBefore, {timeout: 10000});
    await page.waitForFunction(() => !!document.querySelector('canvas#owui-theme-canvas-bg, #owui-theme-canvas-bg canvas, canvas[id*="canvas"]'), null, {timeout: 10000});
    assert.equal(designerFrames(page).length, 0, 'no designer left in the page');
    await page.waitForTimeout(2000);
    await page.screenshot({path: out + '/applied.png'});
    await card.getByRole('button', {name: 'Undo'}).click();
    await card.locator('#note', {hasText: 'Your previous theme is back.'}).waitFor({timeout: 45000});
    assert.equal(await personalState(auth.user), null, 'Undo removed the personal theme');
    await page.waitForFunction(g => getComputedStyle(document.documentElement).getPropertyValue('--color-gray-900').trim() === g, grayBefore, {timeout: 10000});
    assert(await card.getByRole('button', {name: 'Apply theme'}).isEnabled());
    // Again: the theme is already in the gallery now
    await card.getByRole('button', {name: 'Apply theme'}).click();
    await card.getByRole('button', {name: 'Applied'}).waitFor({timeout: 45000});
    const again = await personalState(auth.user);
    assert(again && again.dark.h === 190);
    const lib2 = await api('GET', DESIGNER + '/me/library.json', auth.user);
    assert.equal(lib2.json.snapshots.filter(s => s.name === 'Honu Lagoon').length, 1, 'not added twice');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  await test('a theme changed after signing, or another account\'s link, applies nothing', async () => {
    const before = JSON.stringify(await personalState(auth.user));
    const page = await pageFor(auth.user);
    await ask(page, 'THEME ' + JSON.stringify({...honu, name: 'Signed Theme', hue: 20}));
    const data = await cardData(await cardFrame(page));
    const answer = await page.evaluate(({url, sha, theme}) => new Promise(resolve => {
      const f = document.createElement('iframe'); f.style.display = 'none'; f.src = url;
      addEventListener('message', e => {
        if (e.source !== f.contentWindow || !e.data || e.data.tdpChatTheme !== sha) return;
        if (e.data.status === 'ready') f.contentWindow.postMessage({tdpChatTheme: sha, action: 'apply', theme: theme.replace('"h":20', '"h":300')}, '*');
        else resolve(e.data);
      });
      document.body.appendChild(f); setTimeout(() => resolve({status: 'timeout'}), 40000);
    }), {url: data.applyUrl, sha: data.sha, theme: data.theme});
    assert.equal(answer.status, 'error'); assert(/does not match/.test(answer.message), answer.message);
    assert.equal(JSON.stringify(await personalState(auth.user)), before);
    await page.context().close();
    // The admin opening the user's signed link gets a designer that waits for nothing
    const admin = await pageFor(auth.admin);
    const heard = await admin.evaluate(({url, sha}) => new Promise(resolve => {
      const f = document.createElement('iframe'); f.style.display = 'none'; f.src = url;
      addEventListener('message', e => { if (e.source === f.contentWindow && e.data && e.data.tdpChatTheme === sha) resolve(e.data.status); });
      f.addEventListener('load', () => setTimeout(() => resolve('silent'), 6000));
      document.body.appendChild(f);
    }), {url: data.applyUrl, sha: data.sha});
    assert.equal(heard, 'silent');
    await admin.context().close();
  });

  await test('a still theme gets the gradient, and one mode only changes that mode', async () => {
    const page = await pageFor(auth.user);
    await ask(page, 'THEME ' + JSON.stringify({name: 'Ember Glow', hue: 25, chroma: 40, lightness: 14, background: '', glass: false, mode: 'oled'}));
    const card = await cardFrame(page);
    assert.equal(await card.locator('#sub').textContent(), 'Your theme · gradient');
    const before = await personalState(auth.user);
    await card.getByRole('button', {name: 'Apply theme'}).click();
    await card.getByRole('button', {name: 'Applied'}).waitFor({timeout: 45000});
    const after = await personalState(auth.user);
    assert(after.oled.h === 25 && after.oled.gradientEnabled && !after.oled.canvasEnabled && !after.oled.customCssEnabled);
    assert.equal(JSON.stringify(after.dark), JSON.stringify(before.dark), 'Dark is untouched');
    assert.equal(await card.locator('#note').textContent(), 'Applied to oled mode.');
    await page.context().close();
  });

  await test('an admin\'s "for everyone" theme changes the instance theme', async () => {
    const page = await pageFor(auth.admin);
    await ask(page, 'THEME ' + JSON.stringify({name: 'Harbor Night', hue: 230, chroma: 18, lightness: 12, background: 'falling leaves', everyone: true}));
    const card = await cardFrame(page);
    assert(/^Instance theme · Falling Leaves · glass$/.test(await card.locator('#sub').textContent()));
    await card.getByRole('button', {name: 'Apply theme'}).click();
    await card.getByRole('button', {name: 'Applied'}).waitFor({timeout: 45000});
    const state = await instanceState(auth.admin);
    assert(state && state.dark.h === 230 && /Falling Leaves/.test(state.dark.canvasScript));
    await page.context().close();
  });

  await test('"open the designer" still opens the designer in the chat', async () => {
    const page = await pageFor(auth.user);
    await ask(page, 'please open the designer');
    const end = Date.now() + 30000;
    while (Date.now() < end && !designerFrames(page).length) await page.waitForTimeout(250);
    assert(designerFrames(page).length >= 1, 'the designer opened');
    await page.context().close();
  });

  await test('without iframe Sandbox Allow Same Origin the card previews and says what to turn on', async () => {
    await api('POST', '/api/v1/users/user/settings/update', auth.user, {ui: {iframeSandboxAllowSameOrigin: false, models: ['theme-bot-tools']}});
    try {
      const page = await pageFor(auth.user);
      await ask(page, 'THEME ' + JSON.stringify(honu));
      const card = await cardFrame(page);
      assert(await card.getByRole('button', {name: 'Apply theme'}).isDisabled());
      assert(/iframe Sandbox Allow Same Origin/.test(await card.locator('#note').textContent()));
      await card.getByRole('button', {name: 'Preview', exact: true}).click();
      await card.locator('#big .tdp-stage').waitFor();
      await page.waitForTimeout(1500);
      await (await card.frameElement()).screenshot({path: out + '/no-same-origin.png'});
      // Open WebUI 0.11 itself sets `args` on every cross-origin embed without catching it; 0.12 catches it
      assert.deepEqual(page.errors.filter(e => !/named property 'args'/.test(e)), []);
      await page.context().close();
    } finally {
      await api('POST', '/api/v1/users/user/settings/update', auth.user, {ui: {iframeSandboxAllowSameOrigin: true, models: ['theme-bot-tools']}});
    }
  });

  await test('the card fits a phone screen', async () => {
    const page = await pageFor(auth.user, {width: 390, height: 844});
    await ask(page, 'THEME ' + JSON.stringify(honu));
    const card = await cardFrame(page);
    const box = await (await card.frameElement()).boundingBox();
    assert(box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
    assert(await card.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    await card.getByRole('button', {name: 'Preview', exact: true}).click();
    await page.waitForTimeout(1200);
    await page.screenshot({path: out + '/phone.png'});
    await page.context().close();
  });

  // ── Animations the chat model writes ──

  // The colors at points of a screenshot, read in the page
  async function pixels(page, png, points) {
    return page.evaluate(async ({b64, points}) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      return points.map(([px, py]) => [...x.getImageData(px, py, 1, 1).data].slice(0, 3));
    }, {b64: png.toString('base64'), points});
  }
  const red = ([r, g, b]) => r > 150 && g < 80 && b < 80;
  // What an attacker would write: every way out spelled so the Launcher's check misses it.
  // Green if anything reached the server, red if nothing did.
  const probe = `/**
 * Title: Probe
 * Description: Fills the canvas green when it reached the server, red when it could not.
 */
const RED = '#ff0000';   // nothing got through (0-1)
const GREEN = '#00ff00'; // something reached the server (0-1)
const GRAY = '#808080';  // still trying (0-1)
const TRIES = 4;         // ways out it tries (1-4)
const BASE = '${base}';
let ctx = null, w = 1, h = 1, reached = null;
const tries = [
	() => self['fe' + 'tch'](BASE + '/health').then(r => { if (r.ok) reached = true; }),
	() => self['fe' + 'tch'](BASE + '/api/v1/auths/', { credentials: 'include' }).then(r => { if (r.ok) reached = true; }),
	() => new Promise(res => { const X = self['XMLHttp' + 'Request']; const q = new X(); q.onload = () => { if (q.status === 200) reached = true; res(); }; q.onerror = res; q.open('GET', BASE + '/health'); q.send(); }),
	() => (0, self['ev' + 'al'])('imp' + 'ort(BASE + "/static/loader.js")').then(() => { reached = true; }),
];
Promise.allSettled(tries.map(t => { try { return t(); } catch (e) { return Promise.reject(e); } })).then(() => { if (reached === null) reached = false; draw(); });
function draw() {
	if (!ctx) return;
	ctx.fillStyle = reached === true ? GREEN : reached === false ? RED : GRAY;
	ctx.fillRect(0, 0, w, h);
}
self.onmessage = (e) => {
	const d = e.data;
	switch (d.type) {
		case 'init': ctx = d.canvas.getContext('2d'); w = d.canvas.width = d.width; h = d.canvas.height = d.height; draw(); break;
		case 'resize': w = ctx.canvas.width = d.width; h = ctx.canvas.height = d.height; draw(); break;
		case 'theme': break;
	}
};`;

  await test('an animation the model wrote previews and applies isolated, and reaches nothing', async () => {
    const page = await pageFor(auth.user);
    await ask(page, 'THEME ' + JSON.stringify({name: 'Probe Theme', hue: 0, chroma: 10, lightness: 12, animation_code: probe, glass: false}));
    const card = await cardFrame(page);
    assert.equal(await card.locator('#sub').textContent(), 'Your theme · Probe (new)');
    assert(await card.locator('#hint').isVisible());
    await card.getByRole('button', {name: 'View code'}).click();
    const shown = await card.locator('#source').textContent();
    assert(shown.startsWith('/**') && !shown.includes('tdp:isolated'), shown.slice(0, 60));
    await card.getByRole('button', {name: 'Hide code'}).click();
    await page.waitForTimeout(3000);
    const thumb = await card.locator('#thumb').boundingBox();
    const [inCard] = await pixels(page, await page.screenshot(), [[Math.round(thumb.x + thumb.width * 0.93), Math.round(thumb.y + thumb.height * 0.5)]]);
    assert(red(inCard), 'card preview ' + inCard);
    await card.getByRole('button', {name: 'Apply theme'}).click();
    await card.getByRole('button', {name: 'Applied'}).waitFor({timeout: 45000});
    const state = await personalState(auth.user);
    assert(state.dark.canvasScript.startsWith('/* tdp:isolated */'));
    await page.waitForFunction(() => document.querySelector('iframe[sandbox="allow-scripts"]') && document.getElementById('owui-theme-canvas-bg'), null, {timeout: 15000});
    assert.equal(await page.locator('#owui-canvas-script-runner').count(), 0, 'never on the page itself');
    await page.waitForTimeout(3000);
    const vp = page.viewportSize();
    const [onPage] = await pixels(page, await page.screenshot(), [[vp.width - 30, Math.round(vp.height / 2)]]);
    assert(red(onPage), 'page ' + onPage);
    // After a reload too, the way every later page load starts it
    await page.reload(); await page.locator('#chat-input').waitFor(); await page.waitForTimeout(3500);
    const [afterReload] = await pixels(page, await page.screenshot(), [[vp.width - 30, Math.round(vp.height / 2)]]);
    assert(red(afterReload), 'after reload ' + afterReload);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  await test('a script or stylesheet that breaks the rules goes back to the model, not to the user', async () => {
    const page = await pageFor(auth.user);
    await ask(page, 'THEME ' + JSON.stringify({name: 'Bad', hue: 0, chroma: 10, animation_code: probe.replace("ctx = d.canvas.getContext('2d');", "ctx = d.canvas.getContext('2d'); document.title = 'x';")}));
    // Open WebUI renders the backticks as code, so match the words around them
    await page.getByText(/Not built: the animation_code can.t be used because it uses\s*document/).waitFor({timeout: 30000});
    // The script a real model wrote in a chat (Launcher 2.1.0 let it through, and it threw on the card)
    const qwen = "// Title: Neon Rain Storm\n// Description: Heavy rain with neon glow and lightning\n\nself.onmessage = (e) => {\n  const t = e.data;\n  switch (t.type) {\n    case 'init':\n    case 'resize':\n    case 'theme':\n      if (t.type === 'init') {\n        self.onmessage = (e) => {\n          const d = e.data;\n          switch (d.type) {\n            case 'init':\n            case 'resize':\n              const c = d.canvas; const ctx = c.getContext('2d'); ctx.fillRect(0, 0, c.width, c.height);\n          }\n        };\n      }\n  }\n};";
    await ask(page, 'THEME ' + JSON.stringify({name: 'Neon Rain Storm', hue: 280, chroma: 30, animation_code: qwen}));
    await page.getByText(/Not built: the animation_code can.t be used because it doesn.t open with the header block.*templates\/animation\.js/).waitFor({timeout: 30000});
    await ask(page, 'THEME ' + JSON.stringify({name: 'Bad CSS', hue: 0, chroma: 10, custom_css: '#sidebar { background: url(https://example.com/x.png); }'}));
    await page.getByText(/Not built: the custom_css can.t be used because it loads a url\(\)/).waitFor({timeout: 30000});
    let cards = 0;
    for (const f of page.frames()) cards += await f.locator('#card').count().catch(() => 0);
    assert.equal(cards, 0);
    await page.context().close();
  });

  await test('Apply refuses an animation the model wrote on a Theme Designer Pro older than 1.18.0', async () => {
    if (!process.env.OLD_FUNCTION_FILE) { console.log('  (skipped: set OLD_FUNCTION_FILE to a 1.17.0 copy of the function)'); return; }
    const current = (await api('GET', '/api/v1/functions/id/theme_designer_pro', auth.admin)).json;
    const old = fs.readFileSync(process.env.OLD_FUNCTION_FILE, 'utf8');
    await api('POST', '/api/v1/functions/id/theme_designer_pro/update', auth.admin, {id: 'theme_designer_pro', name: current.name, content: old, meta: current.meta});
    try {
      const before = JSON.stringify(await personalState(auth.user));
      const page = await pageFor(auth.user);
      await ask(page, 'THEME ' + JSON.stringify({name: 'Old Probe', hue: 0, chroma: 10, animation_code: probe}));
      const card = await cardFrame(page);
      await card.getByRole('button', {name: 'Apply theme'}).click();
      await card.locator('#note', {hasText: 'Update Theme Designer Pro to 1.18.0'}).waitFor({timeout: 45000});
      assert.equal(JSON.stringify(await personalState(auth.user)), before);
      await page.context().close();
    } finally {
      await api('POST', '/api/v1/functions/id/theme_designer_pro/update', auth.admin, {id: 'theme_designer_pro', name: current.name, content: current.content, meta: current.meta});
    }
  });

  // ── The skill ──

  const SKILL_DIR = path.join(ROOT, 'skills', 'theme-designer-pro');
  const skillFiles = (function walk(dir) {
    return fs.readdirSync(dir).flatMap(f => fs.statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f)) : [path.join(dir, f)]);
  })(SKILL_DIR).map(f => path.relative(SKILL_DIR, f).split(path.sep).join('/')).sort();

  await test('the theme-designer-pro skill imports into Open WebUI with all its files', async () => {
    const version = (await (await fetch(base + '/api/version')).json()).version;
    if (/^0\.11\./.test(version)) { console.log('  (skipped: skills with files need Open WebUI 0.12)'); return; }
    // As the Workspace's folder import sends it
    const form = () => {
      const f = new FormData();
      for (const rel of skillFiles) f.append('files', new Blob([fs.readFileSync(path.join(SKILL_DIR, rel))]), 'theme-designer-pro/' + rel);
      return f;
    };
    const headers = {Authorization: 'Bearer ' + auth.admin};
    const preview = await (await fetch(base + '/api/v1/skills/import/preview', {method: 'POST', headers, body: form()})).json();
    assert.equal(preview.length, 1, JSON.stringify(preview).slice(0, 300));
    assert.equal(preview[0].name, 'theme-designer-pro');
    assert.deepEqual(preview[0].files.map(f => f.path).sort(), skillFiles);
    const body = form(); body.append('decisions', JSON.stringify([{action: preview[0].id_taken ? 'replace' : 'create', expected_version_id: preview[0].expected_version_id}]));
    const saved = await (await fetch(base + '/api/v1/skills/import', {method: 'POST', headers, body})).json();
    assert.equal(saved[0].status, 'saved', JSON.stringify(saved));
    const listed = await api('GET', `/api/v1/skills/id/${saved[0].id}/files`, auth.admin);
    const paths = (listed.json.files || listed.json).map(f => f.path).sort();
    assert.deepEqual(paths, skillFiles);
    const template = await api('GET', `/api/v1/skills/id/${saved[0].id}/files/content?path=templates/animation.js&version_id=${encodeURIComponent(listed.json.version_id)}`, auth.admin);
    assert(template.text.includes('Title: Drifting Motes'), template.text.slice(0, 120));
  });

  await test('the skill\'s animation template builds, previews and applies isolated', async () => {
    const template = fs.readFileSync(path.join(SKILL_DIR, 'templates', 'animation.js'), 'utf8');
    const page = await pageFor(auth.user);
    await ask(page, 'THEME ' + JSON.stringify({name: 'Template Motes', hue: 265, chroma: 22, lightness: 11, animation_code: template}));
    const card = await cardFrame(page);
    assert.equal(await card.locator('#sub').textContent(), 'Your theme · Drifting Motes (new) · glass');
    await page.waitForTimeout(2000);
    assert.equal(await card.locator('#note').isVisible(), false, 'no error on the card');
    await card.getByRole('button', {name: 'Apply theme'}).click();
    await card.getByRole('button', {name: 'Applied'}).waitFor({timeout: 45000});
    await page.waitForFunction(() => document.querySelector('iframe#owui-theme-canvas-bg[sandbox="allow-scripts"]'), null, {timeout: 15000});
    await page.waitForTimeout(3000);
    await page.screenshot({path: out + '/template-applied.png'});
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  await browser.close();
  const failed = results.filter(r => r[0] === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
