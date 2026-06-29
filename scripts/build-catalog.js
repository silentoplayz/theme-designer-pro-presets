#!/usr/bin/env node

/**
 * Build Preset Catalog
 *
 * Scans all preset directories (themes, canvas-fx, css-presets, gradients,
 * bundles) and produces a single docs/catalog.json describing every asset
 * in the repository.
 *
 * Usage:
 *   node scripts/build-catalog.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const CATALOG_PATH = path.join(DOCS_DIR, 'catalog.json');

const REPO_URL = 'https://github.com/silentoplayz/theme-designer-pro-presets';
const RAW_BASE = 'https://raw.githubusercontent.com/silentoplayz/theme-designer-pro-presets/main';

// Ensure docs directory exists
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

console.log('Building preset catalog...\n');

// ── Helpers ──

/** Title-case a filename stem (split on underscores) */
function titleCase(filename) {
  const stem = filename.replace(/\.[^.]+$/, '');
  return stem.split('_').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/** Extract a JSDoc field value (e.g. Title, Description) from script source.
 *  Captures multi-line values where continuation lines use `*   ` (3+ spaces). */
function extractJSDoc(source, field) {
  const lines = source.split('\n');
  const fieldRe = new RegExp(`\\*\\s*${field}:\\s*(.+)`);
  let result = '';
  let capturing = false;

  for (const line of lines) {
    if (!capturing) {
      const m = line.match(fieldRe);
      if (m) {
        result = m[1].trim();
        capturing = true;
      }
    } else {
      // Continuation line: `*   text` (3+ spaces of indentation after *)
      const cont = line.match(/\*\s{3,}(\S.*)$/);
      if (cont) {
        result += ' ' + cont[1].trim();
      } else {
        break; // Next field or end of JSDoc block
      }
    }
  }

  return result;
}

// ── Themes ──

function buildThemes() {
  const dir = path.join(ROOT, 'themes');
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  const themes = [];

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const stem = path.basename(file, '.json');

    const entry = {
      name: data.name || titleCase(file),
      file,
      description: data.description || '',
      author: data.author || '',
      version: data.version || '0.0.0',
      modes: {},
      importUrl: `${RAW_BASE}/themes/${file}`,
    };

    for (const mode of ['dark', 'light', 'oled', 'her']) {
      if (!data[mode]) continue;
      const m = data[mode];
      entry.modes[mode] = {
        h: m.h,
        c: m.c,
        l: m.l,
        hasCSS: !!(m.customCSS && m.customCssEnabled),
        hasFX: !!(m.canvasScript && m.canvasEnabled),
        hasGradient: !!(m.gradientEnabled && m.gradientStops && m.gradientStops.length > 0),
        hasOverrides: !!(m.overrides && Object.keys(m.overrides).length > 0),
      };
    }

    // Strip empty optional fields for cleaner output
    if (!entry.description) delete entry.description;
    if (!entry.author) delete entry.author;

    themes.push(entry);
  }

  console.log(`  ✓ themes — ${themes.length} entries`);
  return themes;
}

// ── Canvas FX ──

function buildCanvasFx() {
  const dir = path.join(ROOT, 'canvas-fx');
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
  const entries = [];

  for (const file of files) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    const title = extractJSDoc(source, 'Title');
    const description = extractJSDoc(source, 'Description');

    entries.push({
      name: title || titleCase(file),
      file,
      description: description || '',
      importUrl: `${RAW_BASE}/canvas-fx/${file}`,
    });

    // Strip empty description
    if (!entries[entries.length - 1].description) {
      delete entries[entries.length - 1].description;
    }
  }

  console.log(`  ✓ canvasFx — ${entries.length} entries`);
  return entries;
}

// ── CSS Presets ──

function buildCssPresets() {
  const dir = path.join(ROOT, 'css-presets');
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.css')).sort();
  const entries = files.map(file => ({
    name: titleCase(file),
    file,
    importUrl: `${RAW_BASE}/css-presets/${file}`,
  }));

  console.log(`  ✓ cssPresets — ${entries.length} entries`);
  return entries;
}

// ── Gradients ──

function collectGradientFiles(dir, relDir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...collectGradientFiles(fullPath, rel));
    } else if (entry.name.endsWith('.json')) {
      results.push({ fullPath, relPath: rel, filename: entry.name });
    }
  }
  return results;
}

function buildGradients() {
  const baseDir = path.join(ROOT, 'gradients');
  if (!fs.existsSync(baseDir)) return [];

  const files = collectGradientFiles(baseDir, '');
  const entries = [];

  for (const { fullPath, relPath, filename } of files) {
    const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

    entries.push({
      name: data.name || titleCase(filename),
      file: filename,
      type: data.type || 'linear',
      animated: !!data.animation,
      stops: data.stops || [],
      importUrl: `${RAW_BASE}/gradients/${relPath}`,
    });
  }

  console.log(`  ✓ gradients — ${entries.length} entries`);
  return entries;
}

// ── Bundles ──

function buildBundles() {
  const dir = path.join(ROOT, 'bundles');
  if (!fs.existsSync(dir)) return [];

  const BUNDLE_NAMES = {
    'everything.json': 'Everything',
    'canvas-fx-all.json': 'All Canvas FX',
    'css-presets-all.json': 'All CSS Presets',
    'themes-all.json': 'All Themes',
    'gradients-all.json': 'All Gradients',
    'gradients-animated.json': 'Animated Gradients',
    'gradients-still.json': 'Still Gradients',
  };

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  const entries = [];

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const meta = data._meta || {};

    entries.push({
      name: BUNDLE_NAMES[file] || titleCase(file),
      file,
      description: meta.description || '',
      importUrl: `${RAW_BASE}/bundles/${file}`,
    });

    // Strip empty description
    if (!entries[entries.length - 1].description) {
      delete entries[entries.length - 1].description;
    }
  }

  console.log(`  ✓ bundles — ${entries.length} entries`);
  return entries;
}

// ── Build ──

const catalog = {
  repo: REPO_URL,
  rawBase: RAW_BASE,
  themes: buildThemes(),
  canvasFx: buildCanvasFx(),
  cssPresets: buildCssPresets(),
  gradients: buildGradients(),
  bundles: buildBundles(),
};

fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n');

const sizeKB = (fs.statSync(CATALOG_PATH).size / 1024).toFixed(1);
console.log(`\n  ✓ docs/catalog.json — ${sizeKB} KB`);
console.log('Done!');
