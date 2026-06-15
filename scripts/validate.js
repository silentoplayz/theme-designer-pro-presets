#!/usr/bin/env node

/**
 * Validate Presets Against JSON Schemas
 *
 * Checks that all preset files conform to their respective schemas.
 * Exits with code 1 if any validation errors are found.
 *
 * Usage:
 *   node scripts/validate.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let errors = 0;
let warnings = 0;
let checked = 0;

function fail(file, msg) {
  console.error(`  ✗ ${file}: ${msg}`);
  errors++;
}

function warn(file, msg) {
  console.warn(`  ⚠ ${file}: ${msg}`);
  warnings++;
}

function pass(file) {
  checked++;
}

// ── Helpers ──
function requireKeys(obj, keys, file) {
  for (const key of keys) {
    if (obj[key] === undefined) {
      fail(file, `missing required key "${key}"`);
      return false;
    }
  }
  return true;
}

// ── Canvas FX Validation ──
function validateCanvasFx() {
  const dir = path.join(ROOT, 'canvas-fx');
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  console.log(`\n🎨 Canvas FX: ${files.length} scripts`);

  for (const f of files) {
    const content = fs.readFileSync(path.join(dir, f), 'utf8');

    if (!content.includes('self.onmessage') && !content.includes('onmessage')) {
      fail(f, 'missing self.onmessage handler');
      continue;
    }

    if (!content.includes('heartbeat')) {
      warn(f, 'missing heartbeat postMessage (recommended for worker keepalive)');
    }

    // Check for forbidden DOM access
    const forbidden = ['document.', 'window.', 'localStorage', 'alert('];
    for (const word of forbidden) {
      if (content.includes(word)) {
        fail(f, `contains forbidden DOM access: "${word}"`);
        break;
      }
    }

    pass(f);
  }
}

// ── CSS Preset Validation ──
function validateCssPresets() {
  const dir = path.join(ROOT, 'css-presets');
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.css'));
  console.log(`\n🖌️  CSS Presets: ${files.length} files`);

  for (const f of files) {
    const content = fs.readFileSync(path.join(dir, f), 'utf8').trim();

    if (content.length === 0) {
      fail(f, 'empty file');
      continue;
    }

    // Basic CSS syntax: should have at least one { } block or @rule
    if (!content.includes('{') && !content.includes('@')) {
      fail(f, 'does not appear to contain valid CSS');
      continue;
    }

    pass(f);
  }
}

// ── Theme Validation ──
function validateThemes() {
  const dir = path.join(ROOT, 'themes');
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  console.log(`\n🎭 Themes: ${files.length} files`);

  for (const f of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      fail(f, `invalid JSON: ${e.message}`);
      continue;
    }

    if (!requireKeys(data, ['name'], f)) continue;

    // Must have at least dark and light
    if (!data.dark && !data.light) {
      fail(f, 'missing both "dark" and "light" mode configurations');
      continue;
    }

    // Validate mode objects have h/c/l (top-level or nested in oklch object)
    for (const mode of ['dark', 'light', 'oled', 'her']) {
      if (data[mode]) {
        const m = data[mode];
        const hasTopLevel = typeof m.h === 'number' && typeof m.c === 'number' && typeof m.l === 'number';
        const hasOklch = m.oklch && typeof m.oklch.h === 'number' && typeof m.oklch.c === 'number' && typeof m.oklch.l === 'number';
        if (!hasTopLevel && !hasOklch) {
          fail(f, `mode "${mode}" missing required h/c/l color fields`);
          break;
        }
      }
    }

    pass(f);
  }
}

// ── Gradient Validation ──
function validateGradients() {
  const dir = path.join(ROOT, 'gradients');
  if (!fs.existsSync(dir)) return;

  const files = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(d, entry.name));
      else if (entry.name.endsWith('.json')) files.push(path.join(d, entry.name));
    }
  };
  walk(dir);

  console.log(`\n🌈 Gradients: ${files.length} files`);

  for (const fp of files) {
    const f = path.relative(ROOT, fp);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch (e) {
      fail(f, `invalid JSON: ${e.message}`);
      continue;
    }

    if (!requireKeys(data, ['name', 'type'], f)) continue;

    const validTypes = ['linear', 'radial', 'mesh'];
    if (!validTypes.includes(data.type)) {
      fail(f, `invalid type "${data.type}" (expected: ${validTypes.join(', ')})`);
      continue;
    }

    // Verify file is in the correct subdirectory
    const isAnimated = data.animation === true;
    const expectedMotion = isAnimated ? 'animated' : 'still';
    if (!fp.includes(`/${expectedMotion}/`)) {
      fail(f, `animation=${isAnimated} but file is not in gradients/${expectedMotion}/`);
      continue;
    }

    // Mesh gradients must have meshPoints
    if (data.type === 'mesh' && (!data.meshPoints || data.meshPoints.length === 0)) {
      fail(f, 'mesh gradient missing meshPoints array');
      continue;
    }

    // Must have stops
    if (!data.stops || data.stops.length === 0) {
      fail(f, 'missing stops array');
      continue;
    }

    pass(f);
  }
}

// ── Bundle Validation ──
function validateBundles() {
  const dir = path.join(ROOT, 'bundles');
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  console.log(`\n📦 Bundles: ${files.length} files`);

  for (const f of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      fail(f, `invalid JSON: ${e.message}`);
      continue;
    }

    // Check backup flags match content
    if (data.isCanvasBackup && !Array.isArray(data.canvas_presets)) {
      fail(f, 'has isCanvasBackup but missing canvas_presets array');
    }
    if (data.isCssBackup && !Array.isArray(data.css_presets)) {
      fail(f, 'has isCssBackup but missing css_presets array');
    }
    if (data.isGradientBackup && !Array.isArray(data.gradient_presets)) {
      fail(f, 'has isGradientBackup but missing gradient_presets array');
    }
    if (data.isLibraryBackup && !Array.isArray(data.themes)) {
      fail(f, 'has isLibraryBackup but missing themes array');
    }

    pass(f);
  }
}

// ── Run ──
console.log('Validating presets...');
validateCanvasFx();
validateCssPresets();
validateThemes();
validateGradients();
validateBundles();

console.log(`\n${'─'.repeat(50)}`);
console.log(`Checked: ${checked + errors} files`);
if (warnings > 0) console.warn(`Warnings: ${warnings}`);
if (errors > 0) {
  console.error(`Errors:  ${errors}`);
  process.exit(1);
} else {
  console.log('✅ All presets valid!');
}
