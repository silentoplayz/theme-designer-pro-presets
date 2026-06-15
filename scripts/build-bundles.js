#!/usr/bin/env node

/**
 * Bundle Builder for Theme Designer Pro Presets
 *
 * Scans preset directories and produces combined import-ready JSON files
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

  const files = fs.readdirSync(baseDir).filter(f => f.endsWith('.js')).sort();
  if (files.length === 0) {
    console.log('  ⏭  No Canvas FX scripts found, skipping bundle');
    return;
  }

  const presets = files.map(f => {
    const script = fs.readFileSync(path.join(baseDir, f), 'utf8');
    const titleMatch = script.match(/\*\s*Title:\s*(.+)/);
    const name = titleMatch
      ? titleMatch[1].trim()
      : f.replace('.js', '').split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    return { name, script };
  });

  const bundle = {
    canvas_presets: presets,
    isCanvasBackup: true,
    version: '1.0.0',
    _meta: {
      generated: new Date().toISOString(),
      count: presets.length,
    },
  };

  const outPath = path.join(BUNDLES_DIR, 'canvas-fx-all.json');
  fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2));
  console.log(`  ✓ canvas-fx-all.json — ${presets.length} animations (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);
}

// ── CSS Presets Bundle ──
function buildCssBundle() {
  const baseDir = path.join(ROOT, 'css-presets');
  if (!fs.existsSync(baseDir)) return;

  const files = fs.readdirSync(baseDir).filter(f => f.endsWith('.css')).sort();
  if (files.length === 0) {
    console.log('  ⏭  No CSS presets found, skipping bundle');
    return;
  }

  const presets = files.map(f => {
    const code = fs.readFileSync(path.join(baseDir, f), 'utf8');
    const name = f.replace('.css', '').split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    return { name, code };
  });

  const bundle = {
    css_presets: presets,
    isCssBackup: true,
    version: '1.0.0',
    _meta: { generated: new Date().toISOString(), count: presets.length },
  };

  const outPath = path.join(BUNDLES_DIR, 'css-presets-all.json');
  fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2));
  console.log(`  ✓ css-presets-all.json — ${presets.length} presets (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);
}

// ── Gradients Bundle ──
// Recursively scans gradients/{still,animated}/{linear,radial,mesh}/
function collectGradients(dir, category) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const subCat = category ? `${category}/${entry.name}` : entry.name;
      results.push(...collectGradients(fullPath, subCat));
    } else if (entry.name.endsWith('.json')) {
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      results.push({ ...data, _category: category || 'uncategorized' });
    }
  }
  return results;
}

function buildGradientBundle() {
  const baseDir = path.join(ROOT, 'gradients');
  if (!fs.existsSync(baseDir)) return;

  const all = collectGradients(baseDir, '');
  if (all.length === 0) {
    console.log('  ⏭  No gradient presets found, skipping bundle');
    return;
  }

  // Combined bundle
  const outPath = path.join(BUNDLES_DIR, 'gradients-all.json');
  fs.writeFileSync(outPath, JSON.stringify(all, null, 2));
  console.log(`  ✓ gradients-all.json — ${all.length} presets`);

  // Per-group bundles (still, animated)
  for (const group of ['still', 'animated']) {
    const groupPresets = all.filter(p => p._category.startsWith(group));
    if (groupPresets.length > 0) {
      const gPath = path.join(BUNDLES_DIR, `gradients-${group}.json`);
      fs.writeFileSync(gPath, JSON.stringify(groupPresets, null, 2));
      console.log(`  ✓ gradients-${group}.json — ${groupPresets.length} presets`);
    }
  }
}

// ── Themes Bundle ──
function buildThemesBundle() {
  const baseDir = path.join(ROOT, 'themes');
  if (!fs.existsSync(baseDir)) return;

  const files = fs.readdirSync(baseDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.log('  ⏭  No theme presets found, skipping bundle');
    return;
  }

  const presets = files.map(f =>
    JSON.parse(fs.readFileSync(path.join(baseDir, f), 'utf8'))
  );

  const bundle = {
    themes: presets,
    isLibraryBackup: true,
    version: '1.0.0',
    _meta: { generated: new Date().toISOString(), count: presets.length },
  };

  const outPath = path.join(BUNDLES_DIR, 'themes-all.json');
  fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2));
  console.log(`  ✓ themes-all.json — ${presets.length} themes (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);
}

// ── Everything Bundle ──
function buildEverythingBundle() {
  const bundle = {
    _meta: { generated: new Date().toISOString(), description: 'Combined bundle — all preset types' },
    version: '1.0.0',
  };
  let parts = [];

  // Canvas FX
  const fxDir = path.join(ROOT, 'canvas-fx');
  if (fs.existsSync(fxDir)) {
    const files = fs.readdirSync(fxDir).filter(f => f.endsWith('.js')).sort();
    if (files.length > 0) {
      bundle.canvas_presets = files.map(f => ({
        name: f.replace('.js', ''),
        script: fs.readFileSync(path.join(fxDir, f), 'utf8'),
      }));
      bundle.isCanvasBackup = true;
      parts.push(`${files.length} animations`);
    }
  }

  // CSS Presets
  const cssDir = path.join(ROOT, 'css-presets');
  if (fs.existsSync(cssDir)) {
    const files = fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).sort();
    if (files.length > 0) {
      bundle.css_presets = files.map(f => ({
        name: f.replace('.css', '').split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' '),
        code: fs.readFileSync(path.join(cssDir, f), 'utf8'),
      }));
      bundle.isCssBackup = true;
      parts.push(`${files.length} CSS`);
    }
  }

  // Gradients
  const gradDir = path.join(ROOT, 'gradients');
  if (fs.existsSync(gradDir)) {
    const gradFiles = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(dir, entry.name));
        else if (entry.name.endsWith('.json')) {
          gradFiles.push(JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8')));
        }
      }
    };
    walk(gradDir);
    if (gradFiles.length > 0) {
      bundle.gradient_presets = gradFiles;
      bundle.isGradientBackup = true;
      parts.push(`${gradFiles.length} gradients`);
    }
  }

  // Themes
  const themesDir = path.join(ROOT, 'themes');
  if (fs.existsSync(themesDir)) {
    const files = fs.readdirSync(themesDir).filter(f => f.endsWith('.json')).sort();
    if (files.length > 0) {
      bundle.themes = files.map(f =>
        JSON.parse(fs.readFileSync(path.join(themesDir, f), 'utf8'))
      );
      bundle.isLibraryBackup = true;
      parts.push(`${files.length} themes`);
    }
  }

  if (parts.length === 0) {
    console.log('  ⏭  No presets found for everything bundle');
    return;
  }

  const outPath = path.join(BUNDLES_DIR, 'everything.json');
  fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2));
  console.log(`  ✓ everything.json — ${parts.join(', ')} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);
}

// ── Run ──
console.log('Building bundles...\n');
buildCanvasFxBundle();
buildCssBundle();
buildGradientBundle();
buildThemesBundle();
buildEverythingBundle();
console.log('\nDone!');
