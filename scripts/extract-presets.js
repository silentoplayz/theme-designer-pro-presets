#!/usr/bin/env node

/**
 * Extract Individual Presets from Theme Designer Pro Backup Files
 *
 * Reads the bulk export JSON files from Theme Designer Pro and splits them
 * into individual files, ready to be placed into the preset gallery repo.
 *
 * Usage:
 *   node scripts/extract-presets.js <path-to-exports-directory>
 *
 * Example:
 *   node scripts/extract-presets.js ~/exports/
 *
 * This will look for:
 *   - owui-canvas-backup-*.json  → extracts to canvas-fx/
 *   - owui-css-backup-*.json     → extracts to css-presets/
 *   - owui-themes-backup-*.json  → extracts to themes/
 *
 * Files are NOT overwritten by default. Use --force to overwrite existing files.
 *
 * Filename generation:
 *   "NEO-TACTICAL // ARCHIVE 01"  →  neo_tactical_archive_01.js
 *   "01: The Architect (Matrix)"  →  01_the_architect_matrix.js
 *   "@h4nn1b4l Custom CSS"        →  h4nn1b4l_custom_css.css
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const force = args.includes('--force');
const exportDir = args.find(a => !a.startsWith('--'));

if (!exportDir) {
  console.error('Usage: node scripts/extract-presets.js <path-to-exports-directory> [--force]');
  console.error('');
  console.error('Options:');
  console.error('  --force    Overwrite existing files');
  console.error('');
  console.error('Example:');
  console.error('  node scripts/extract-presets.js ~/theme-exports/');
  process.exit(1);
}

const resolvedDir = path.resolve(exportDir);
if (!fs.existsSync(resolvedDir)) {
  console.error(`Error: Directory not found: ${resolvedDir}`);
  process.exit(1);
}

// ── Filename sanitization ──
function nameToFilename(name) {
  return name
    .normalize('NFD')                    // Decompose accents (é → e + ́)
    .replace(/[\u0300-\u036f]/g, '')     // Strip diacritical marks
    .toLowerCase()
    .replace(/\/\//g, '')               // Remove //
    .replace(/[^a-z0-9\s]/g, ' ')       // Non-alphanumeric → space
    .trim()
    .replace(/\s+/g, '_')              // Collapse spaces → underscore
    .replace(/^_+|_+$/g, '')           // Trim leading/trailing underscores
    .slice(0, 60);                     // Cap length
}

function writeFile(filePath, content, label) {
  if (fs.existsSync(filePath) && !force) {
    console.log(`  ⏭  SKIP (exists): ${path.basename(filePath)}`);
    return false;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  console.log(`  ✓ ${label}: ${path.basename(filePath)} (${(Buffer.byteLength(content) / 1024).toFixed(1)} KB)`);
  return true;
}

// ── Find export files ──
const files = fs.readdirSync(resolvedDir);
const canvasFile = files.find(f => f.match(/owui-canvas-backup.*\.json/i));
const cssFile = files.find(f => f.match(/owui-css-backup.*\.json/i));
const themesFile = files.find(f => f.match(/owui-themes-backup.*\.json/i));

let totalExtracted = 0;
let totalSkipped = 0;

// ── Extract Canvas FX ──
if (canvasFile) {
  console.log(`\n📦 Canvas FX: ${canvasFile}`);
  const data = JSON.parse(fs.readFileSync(path.join(resolvedDir, canvasFile), 'utf8'));
  const presets = data.canvas_presets || [];
  console.log(`   Found ${presets.length} presets\n`);

  const usedNames = new Set();
  for (const preset of presets) {
    let filename = nameToFilename(preset.name);
    // Handle duplicates
    if (usedNames.has(filename)) {
      let suffix = 2;
      while (usedNames.has(`${filename}_${suffix}`)) suffix++;
      filename = `${filename}_${suffix}`;
    }
    usedNames.add(filename);

    const outPath = path.join(ROOT, 'canvas-fx', `${filename}.js`);
    if (writeFile(outPath, preset.script, preset.name)) totalExtracted++;
    else totalSkipped++;
  }
} else {
  console.log('\n⏭  No canvas backup file found');
}

// ── Extract CSS Presets ──
if (cssFile) {
  console.log(`\n🖌️  CSS Presets: ${cssFile}`);
  const data = JSON.parse(fs.readFileSync(path.join(resolvedDir, cssFile), 'utf8'));
  const presets = data.css_presets || [];
  console.log(`   Found ${presets.length} presets\n`);

  const usedNames = new Set();
  for (const preset of presets) {
    let filename = nameToFilename(preset.name);
    if (usedNames.has(filename)) {
      let suffix = 2;
      while (usedNames.has(`${filename}_${suffix}`)) suffix++;
      filename = `${filename}_${suffix}`;
    }
    usedNames.add(filename);

    // Write raw CSS (matches Theme Designer Pro's .css export format)
    const outPath = path.join(ROOT, 'css-presets', `${filename}.css`);
    if (writeFile(outPath, preset.code, preset.name)) totalExtracted++;
    else totalSkipped++;
  }
} else {
  console.log('\n⏭  No CSS backup file found');
}

// ── Extract Themes ──
if (themesFile) {
  console.log(`\n🎭 Themes: ${themesFile}`);
  const data = JSON.parse(fs.readFileSync(path.join(resolvedDir, themesFile), 'utf8'));
  const themes = data.themes || [];
  console.log(`   Found ${themes.length} themes\n`);

  const usedNames = new Set();
  for (const theme of themes) {
    let filename = nameToFilename(theme.name);
    if (usedNames.has(filename)) {
      let suffix = 2;
      while (usedNames.has(`${filename}_${suffix}`)) suffix++;
      filename = `${filename}_${suffix}`;
    }
    usedNames.add(filename);

    const outPath = path.join(ROOT, 'themes', `${filename}.json`);
    if (writeFile(outPath, JSON.stringify(theme, null, 2), theme.name)) totalExtracted++;
    else totalSkipped++;
  }
} else {
  console.log('\n⏭  No themes backup file found');
}

// ── Summary ──
console.log(`\n${'─'.repeat(50)}`);
console.log(`Extracted: ${totalExtracted} files`);
if (totalSkipped > 0) console.log(`Skipped:   ${totalSkipped} files (already exist, use --force to overwrite)`);
console.log('');

// Show filename mapping
console.log('Filename mapping:');
if (canvasFile) {
  const data = JSON.parse(fs.readFileSync(path.join(resolvedDir, canvasFile), 'utf8'));
  (data.canvas_presets || []).forEach(p => {
    console.log(`  "${p.name}" → canvas-fx/${nameToFilename(p.name)}.js`);
  });
}
if (cssFile) {
  const data = JSON.parse(fs.readFileSync(path.join(resolvedDir, cssFile), 'utf8'));
  (data.css_presets || []).forEach(p => {
    console.log(`  "${p.name}" → css-presets/${nameToFilename(p.name)}.css`);
  });
}
if (themesFile) {
  const data = JSON.parse(fs.readFileSync(path.join(resolvedDir, themesFile), 'utf8'));
  (data.themes || []).forEach(p => {
    console.log(`  "${p.name}" → themes/${nameToFilename(p.name)}.json`);
  });
}
