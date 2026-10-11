#!/usr/bin/env node

/**
 * Render Theme Previews
 *
 * Opens a theme in the site's Studio (docs/studio/) in headless Chrome and
 * saves one screenshot of the mock Open WebUI per mode the theme defines,
 * so a reviewer sees the theme without opening the preview link.
 *
 * Called by the theme-submission GitHub Actions workflow. Needs
 * playwright-core and an installed Chrome (GitHub's Ubuntu runners have one);
 * the workflow installs playwright-core with --no-save.
 *
 * Usage:
 *   node scripts/render-previews.js <theme.json> <out-dir>
 *   node scripts/render-previews.js --markdown <base-url> <out-dir>
 *
 * The first form writes <mode>.png for each mode into <out-dir>. The second
 * prints a Markdown table of the screenshots in <out-dir>, linked under
 * <base-url>, for the PR body and the issue comment.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODES = ['dark', 'oled', 'light', 'her'];
const LABELS = { dark: 'Dark', oled: 'OLED', light: 'Light', her: 'Her' };
// The Studio only opens themes from this repo, so the theme is served under
// a repo URL and answered from disk
const REPO_RAW = 'https://raw.githubusercontent.com/silentoplayz/theme-designer-pro-presets/';
// How long a Canvas FX script gets to draw before the screenshot
const SETTLE_MS = 3500;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2',
};

// ── Static server for docs/ ──

function serve(dir) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(dir, url);
    if (!file.startsWith(dir)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ── Rendering ──

async function render(themePath, outDir) {
  const { chromium } = require('playwright-core');
  const theme = JSON.parse(fs.readFileSync(themePath, 'utf8'));
  const modes = MODES.filter((m) => theme[m]);
  if (!modes.length) throw new Error('the theme defines no modes');
  fs.mkdirSync(outDir, { recursive: true });

  const server = await serve(path.join(ROOT, 'docs'));
  const site = `http://127.0.0.1:${server.address().port}/`;
  const themeUrl = REPO_RAW + 'preview/themes/' + path.basename(themePath);
  // Runners have no GPU, so WebGL scripts draw through SwiftShader
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // The theme comes from disk and the site from the server; only the
    // site's Google Fonts are fetched from outside
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url === themeUrl) return route.fulfill({ path: themePath, contentType: 'application/json' });
      if (url.startsWith(site) || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)) return route.continue();
      return route.abort();
    });
    await page.goto(site + 'studio/#theme=' + encodeURIComponent(themeUrl));
    await page.waitForFunction(() => !!document.querySelector('#studio-title') &&
      document.querySelector('#studio-title').textContent !== 'Untitled theme', null, { timeout: 15000 });

    const frameUp = () => page.waitForFunction(() => {
      const frames = document.querySelectorAll('#studio-viewport iframe');
      return frames.length === 1 && document.getElementById('studio-msg').hidden;
    }, null, { timeout: 15000 });
    await frameUp();

    for (const mode of modes) {
      const btn = page.locator(`#mode-seg button[data-mode="${mode}"]`);
      if (await btn.getAttribute('aria-pressed') !== 'true') {
        // A rebuild mounts the new frame over the old one and drops the old
        // one once it has drawn, so wait for the old one to go
        const old = await page.locator('#studio-viewport iframe').elementHandle();
        await btn.click();
        await page.waitForFunction((el) => !el.isConnected, old, { timeout: 15000 });
        await frameUp();
      }
      await page.waitForTimeout(SETTLE_MS);
      await page.locator('#studio-viewport').screenshot({ path: path.join(outDir, mode + '.png') });
      console.log('rendered ' + mode);
    }
    if (errors.length) console.warn('page errors:\n' + errors.join('\n'));
  } finally {
    await browser.close();
    server.close();
  }
}

// ── Markdown for the PR and the issue ──

function markdown(baseUrl, outDir) {
  const shots = MODES.filter((m) => fs.existsSync(path.join(outDir, m + '.png')));
  const rows = [];
  for (let i = 0; i < shots.length; i += 2) {
    const pair = shots.slice(i, i + 2);
    rows.push('| ' + pair.map((m) => '**' + LABELS[m] + '**').join(' | ') + ' |');
    if (!i) rows.push('|' + pair.map(() => '---').join('|') + '|');
    rows.push('| ' + pair.map((m) => `![${LABELS[m]}](${baseUrl.replace(/\/$/, '')}/${m}.png)`).join(' | ') + ' |');
  }
  return rows.join('\n');
}

// ── Main ──

const args = process.argv.slice(2);
if (args[0] === '--markdown' && args.length === 3) {
  console.log(markdown(args[1], args[2]));
} else if (args.length === 2) {
  render(path.resolve(args[0]), path.resolve(args[1])).catch((e) => {
    console.error('Render failed: ' + e.message);
    process.exit(1);
  });
} else {
  console.error('Usage: render-previews.js <theme.json> <out-dir> | --markdown <base-url> <out-dir>');
  process.exit(2);
}
