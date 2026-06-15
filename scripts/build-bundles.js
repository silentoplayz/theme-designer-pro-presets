#!/usr/bin/env node

/**
 * Bundle Builder for Theme Designer Pro Presets
 *
 * Scans category folders and produces combined import-ready JSON files
 * in the bundles/ directory.
 *
 * Usage: node scripts/build-bundles.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUNDLES_DIR = path.join(ROOT, 'bundles');

// Ensure bundles directory exists
if (!fs.existsSync(BUNDLES_DIR)) fs.mkdirSync(BUNDLES_DIR, { recursive: true });

// ── Canvas FX Bundle ──
function buildCanvasFxBundle() {
  const baseDir = path.join(ROOT, 'canvas-fx');
  if (!fs.existsSync(baseDir)) return;

  const presets = [];
  const categories = fs.readdirSync(baseDir).filter(d =>
    fs.statSync(path.join(baseDir, d)).isDirectory()
  );

  for (const cat of categories) {
    const catDir = path.join(baseDir, cat);
    const files = fs.readdirSync(catDir).filter(f => f.endsWith('.js')).sort();
    for (const file of files) {
      const script = fs.readFileSync(path.join(catDir, file), 'utf8');
      const titleMatch = script.match(/\*\s*Title:\s*(.+)/);
      const name = titleMatch
        ? titleMatch[1].trim()
        : file.replace('.js', '').split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
      presets.push({ name, script, category: cat });
    }
  }

  if (presets.length === 0) {
    console.log('  ⏭  No Canvas FX scripts found, skipping bundle');
    return;
  }

  const bundle = {
    canvas_presets: presets.map(({ name, script }) => ({ name, script })),
    isCanvasBackup: true,
    version: '1.0.0',
    _meta: {
      generated: new Date().toISOString(),
      count: presets.length,
      categories: [...new Set(presets.map(p => p.category))],
    },
  };

  const outPath = path.join(BUNDLES_DIR, 'canvas-fx-all.json');
  fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2));
  console.log(`  ✓ canvas-fx-all.json — ${presets.length} animations (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);

  // Per-category bundles
  const cats = [...new Set(presets.map(p => p.category))];
  for (const cat of cats) {
    const catPresets = presets.filter(p => p.category === cat);
    const catBundle = {
      canvas_presets: catPresets.map(({ name, script }) => ({ name, script })),
      isCanvasBackup: true,
      version: '1.0.0',
      _meta: { generated: new Date().toISOString(), count: catPresets.length, category: cat },
    };
    const catPath = path.join(BUNDLES_DIR, `canvas-fx-${cat}.json`);
    fs.writeFileSync(catPath, JSON.stringify(catBundle, null, 2));
    console.log(`  ✓ canvas-fx-${cat}.json — ${catPresets.length} animations`);
  }
}

// ── CSS Presets Bundle ──
function buildCssBundle() {
  const baseDir = path.join(ROOT, 'css-presets');
  if (!fs.existsSync(baseDir)) return;

  const files = fs.readdirSync(baseDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) return;

  const presets = files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(baseDir, f), 'utf8'));
    return data;
  });

  const outPath = path.join(BUNDLES_DIR, 'css-presets-all.json');
  fs.writeFileSync(outPath, JSON.stringify(presets, null, 2));
  console.log(`  ✓ css-presets-all.json — ${presets.length} presets`);
}

// ── Gradients Bundle ──
function buildGradientBundle() {
  const baseDir = path.join(ROOT, 'gradients');
  if (!fs.existsSync(baseDir)) return;

  const files = fs.readdirSync(baseDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) return;

  const presets = files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(baseDir, f), 'utf8'));
    return data;
  });

  const outPath = path.join(BUNDLES_DIR, 'gradients-all.json');
  fs.writeFileSync(outPath, JSON.stringify(presets, null, 2));
  console.log(`  ✓ gradients-all.json — ${presets.length} presets`);
}

// ── Run ──
console.log('Building bundles...\n');
buildCanvasFxBundle();
buildCssBundle();
buildGradientBundle();
console.log('\nDone!');
