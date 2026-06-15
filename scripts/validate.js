#!/usr/bin/env node

/**
 * Validate Presets Against JSON Schemas
 *
 * Uses Ajv (JSON Schema draft-07) for structural validation, plus
 * supplementary manual checks for rules schemas cannot express
 * (DOM-access guards, file-path conventions, updateUrl matching, etc.).
 *
 * Exits with code 1 if any validation errors are found.
 *
 * Usage:
 *   node scripts/validate.js
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ROOT = path.resolve(__dirname, '..');
const SCHEMAS_DIR = path.join(ROOT, 'schemas');

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

// ── Schema Setup ──

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// Load and compile schemas
// Schema loading order matters: referenced schemas must be registered before
// schemas that use $ref to point to them (e.g. everything.schema.json refs
// gradient-preset.schema.json and theme.schema.json).
const referencedSchemas = ['gradient-preset.schema.json', 'theme.schema.json'];
const topLevelSchemas = {
  theme: 'theme.schema.json',
  gradient: 'gradient-preset.schema.json',
  canvas: 'canvas-preset.schema.json',
  css: 'css-preset.schema.json',
  manifest: 'manifest.schema.json',
  // everything must be last — it $refs gradient and theme schemas
  everything: 'everything.schema.json',
};

// Pre-register referenced schemas by filename so $ref resolves
for (const filename of referencedSchemas) {
  const schemaPath = path.join(SCHEMAS_DIR, filename);
  if (fs.existsSync(schemaPath)) {
    try {
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      schema.$id = filename; // ajv resolves $ref by $id
      ajv.addSchema(schema);
    } catch (e) {
      console.error(`Failed to load referenced schema ${filename}: ${e.message}`);
    }
  }
}

// Compile validators for each schema
const validators = {};
for (const [key, filename] of Object.entries(topLevelSchemas)) {
  const schemaPath = path.join(SCHEMAS_DIR, filename);
  if (fs.existsSync(schemaPath)) {
    try {
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      // Skip if already added as a referenced schema
      if (referencedSchemas.includes(filename)) {
        validators[key] = ajv.getSchema(filename);
      } else {
        validators[key] = ajv.compile(schema);
      }
    } catch (e) {
      console.error(`Failed to compile schema ${filename}: ${e.message}`);
    }
  }
}

/**
 * Run schema validation and report errors.
 * Returns true if valid, false if errors were found.
 */
function validateSchema(data, schemaKey, file) {
  const validate = validators[schemaKey];
  if (!validate) return true; // Schema not available, skip

  const valid = validate(data);
  if (!valid) {
    for (const err of validate.errors) {
      const location = err.instancePath || '(root)';
      fail(file, `schema: ${location} ${err.message}`);
    }
    return false;
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

    // Manual checks — schemas can't validate JS source content
    if (!content.includes('self.onmessage') && !content.includes('onmessage')) {
      fail(f, 'missing self.onmessage handler');
      continue;
    }

    if (!content.includes('heartbeat')) {
      warn(f, 'missing heartbeat postMessage (recommended for worker keepalive)');
    }

    // Check for forbidden DOM access
    const forbidden = ['document.', 'window.', 'localStorage', 'alert('];
    let hasForbidden = false;
    for (const word of forbidden) {
      if (content.includes(word)) {
        fail(f, `contains forbidden DOM access: "${word}"`);
        hasForbidden = true;
        break;
      }
    }

    if (!hasForbidden) pass(f);
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

    // Schema validation
    validateSchema(data, 'theme', f);

    // Supplementary manual checks beyond schema scope

    // Must have updateUrl pointing to raw GitHub
    if (!data.updateUrl) {
      fail(f, 'missing required "updateUrl" field');
      continue;
    }
    const expectedUrl = `https://raw.githubusercontent.com/silentoplayz/theme-designer-pro-presets/main/themes/${f}`;
    if (data.updateUrl !== expectedUrl) {
      fail(f, `updateUrl does not match expected raw GitHub URL`);
      continue;
    }

    // Must have both dark and light (schema enforces h/c/l within each mode)
    if (!data.dark || !data.light) {
      fail(f, 'missing required "dark" and/or "light" mode configuration (both are required)');
      continue;
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

    // Schema validation
    validateSchema(data, 'gradient', f);

    // Supplementary manual checks

    if (!data.name || !data.type) {
      // Schema already reports this, but we need to skip further checks
      continue;
    }

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

    // Linear/radial must have stops; mesh uses meshPoints instead
    if (data.type !== 'mesh' && (!data.stops || data.stops.length === 0)) {
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

    // Schema validation — pick the best matching schema
    if (f === 'everything.json') {
      validateSchema(data, 'everything', f);
    } else if (f === 'canvas-fx-all.json') {
      validateSchema(data, 'canvas', f);
    } else if (f === 'css-presets-all.json') {
      validateSchema(data, 'css', f);
    }
    // Gradient and theme bundles use the same flag-based format;
    // their inner items are validated individually above.

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

    // Reverse checks: content arrays without flags
    if (Array.isArray(data.canvas_presets) && !data.isCanvasBackup) {
      warn(f, 'has canvas_presets array but missing isCanvasBackup flag');
    }
    if (Array.isArray(data.css_presets) && !data.isCssBackup) {
      warn(f, 'has css_presets array but missing isCssBackup flag');
    }
    if (Array.isArray(data.gradient_presets) && !data.isGradientBackup) {
      warn(f, 'has gradient_presets array but missing isGradientBackup flag');
    }
    if (Array.isArray(data.themes) && !data.isLibraryBackup) {
      warn(f, 'has themes array but missing isLibraryBackup flag');
    }

    pass(f);
  }
}

// ── Manifest Validation ──
function validateManifest() {
  const manifestPath = path.join(ROOT, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return;

  console.log(`\n📋 Manifest`);

  let data;
  try {
    data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    fail('manifest.json', `invalid JSON: ${e.message}`);
    return;
  }

  validateSchema(data, 'manifest', 'manifest.json');
  pass('manifest.json');
}

// ── Run ──
console.log('Validating presets...');
validateCanvasFx();
validateCssPresets();
validateThemes();
validateGradients();
validateBundles();
validateManifest();

console.log(`\n${'─'.repeat(50)}`);
console.log(`Checked: ${checked + errors} files`);
if (warnings > 0) console.warn(`Warnings: ${warnings}`);
if (errors > 0) {
  console.error(`Errors:  ${errors}`);
  process.exit(1);
} else {
  console.log('✅ All presets valid!');
}
