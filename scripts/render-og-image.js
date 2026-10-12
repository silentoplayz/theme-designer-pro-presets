#!/usr/bin/env node

/**
 * Render the Link-Preview Image
 *
 * Draws docs/og-preview.png, the image shown when someone shares a link to
 * the site, from scripts/og-image.html in headless Chrome. Its chips count
 * the gallery from docs/catalog.json, so run this after build-catalog.js.
 *
 * The image is stamped with what it shows (the chips, and a hash of the
 * template), and is only drawn again when either changes, so a run with
 * nothing new writes nothing and starts no browser.
 *
 * Called by the Validate & Build Bundles workflow. Needs playwright-core and
 * an installed Chrome (GitHub's Ubuntu runners have one); the workflow
 * installs playwright-core with --no-save. The template loads its fonts from
 * Google Fonts.
 *
 * Usage:
 *   node scripts/render-og-image.js [--force]
 */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const TEMPLATE = path.join(__dirname, 'og-image.html');
const OUT = path.join(DOCS, 'og-preview.png');
const STAMP_KEY = 'tdp-og';

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};

// The chips the template draws, worked out the same way it does
function expectedChips() {
  const catalog = JSON.parse(fs.readFileSync(path.join(DOCS, 'catalog.json'), 'utf8'));
  const count = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  return [
    count((catalog.canvasFx || []).length, 'Canvas FX', 'Canvas FX'),
    count((catalog.themes || []).length, 'theme', 'themes'),
    count((catalog.gradients || []).length, 'gradient', 'gradients'),
    'Live previews',
  ];
}

// ── PNG text chunks ──

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunks(png) {
  const out = [];
  for (let at = 8; at + 12 <= png.length;) {
    const len = png.readUInt32BE(at);
    out.push({ type: png.toString('latin1', at + 4, at + 8), start: at, end: at + 12 + len, data: png.subarray(at + 8, at + 8 + len) });
    at += 12 + len;
  }
  return out;
}

function readStamp(file) {
  if (!fs.existsSync(file)) return null;
  for (const c of chunks(fs.readFileSync(file))) {
    if (c.type !== 'tEXt') continue;
    const zero = c.data.indexOf(0);
    if (c.data.toString('latin1', 0, zero) !== STAMP_KEY) continue;
    try { return JSON.parse(c.data.toString('latin1', zero + 1)); } catch (e) { return null; }
  }
  return null;
}

// The PNG with a tEXt chunk holding the stamp, just before IEND
function withStamp(png, stamp) {
  const end = chunks(png).find((c) => c.type === 'IEND');
  const body = Buffer.concat([Buffer.from('tEXt', 'latin1'), Buffer.from(STAMP_KEY + '\0' + JSON.stringify(stamp), 'latin1')]);
  const chunk = Buffer.alloc(body.length + 8);
  chunk.writeUInt32BE(body.length - 4, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), body.length + 4);
  return Buffer.concat([png.subarray(0, end.start), chunk, png.subarray(end.start)]);
}

// ── Drawing ──

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = url.pathname === '/__og.html' ? TEMPLATE : path.join(DOCS, path.normalize(decodeURIComponent(url.pathname)));
    if (file !== TEMPLATE && (!file.startsWith(DOCS + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory())) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function draw() {
  const { chromium } = require('playwright-core');
  const server = await serve();
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/__og.html`);
    await page.waitForFunction(() => window.__og, null, { timeout: 30000 });
    const og = await page.evaluate(() => window.__og);
    if (og.error) throw new Error('the template failed: ' + og.error);
    return og;
  } finally {
    await browser.close();
    server.close();
  }
}

(async () => {
  const stamp = {
    chips: expectedChips(),
    template: crypto.createHash('sha256').update(fs.readFileSync(TEMPLATE)).digest('hex').slice(0, 16),
  };
  if (!process.argv.includes('--force') && JSON.stringify(readStamp(OUT)) === JSON.stringify(stamp)) {
    console.log(`og-preview.png is up to date (${stamp.chips.join(', ')})`);
    return;
  }
  const og = await draw();
  if (JSON.stringify(og.chips) !== JSON.stringify(stamp.chips)) {
    throw new Error(`the template drew ${og.chips.join(', ')}, expected ${stamp.chips.join(', ')}`);
  }
  const png = Buffer.from(og.png.slice(og.png.indexOf(',') + 1), 'base64');
  fs.writeFileSync(OUT, withStamp(png, stamp));
  console.log(`Wrote og-preview.png (${stamp.chips.join(', ')})`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
