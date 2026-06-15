#!/usr/bin/env node

/**
 * Build Theme Update Manifest
 *
 * Scans themes/*.json and generates a centralized manifest.json
 * listing every theme with its version, author, and update URL.
 *
 * Usage:
 *   node scripts/build-manifest.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const THEMES_DIR = path.join(ROOT, 'themes');
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');

const BASE_URL = 'https://raw.githubusercontent.com/silentoplayz/theme-designer-pro-presets/main';
const MANIFEST_URL = `${BASE_URL}/manifest.json`;

console.log('Building theme manifest...');

if (!fs.existsSync(THEMES_DIR)) {
  console.log('  ⏭  No themes/ directory found, skipping manifest');
  process.exit(0);
}

const themeFiles = fs.readdirSync(THEMES_DIR)
  .filter(f => f.endsWith('.json'))
  .sort();

const themes = {};
let noVersion = 0;

for (const file of themeFiles) {
  const data = JSON.parse(fs.readFileSync(path.join(THEMES_DIR, file), 'utf8'));
  const stem = path.basename(file, '.json');

  if (!data.version) noVersion++;

  themes[stem] = {
    name: data.name || stem,
    version: data.version || '0.0.0',
    author: data.author || '',
    description: data.description || '',
    updateUrl: `${BASE_URL}/themes/${file}`,
    file: `themes/${file}`
  };

  // Strip empty optional fields for cleaner output
  if (!themes[stem].author) delete themes[stem].author;
  if (!themes[stem].description) delete themes[stem].description;
}

const manifest = {
  manifestVersion: '1.0',
  generated: new Date().toISOString(),
  manifestUrl: MANIFEST_URL,
  themes
};

fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');

console.log(`  ✓ manifest.json — ${themeFiles.length} themes`);
if (noVersion > 0) {
  console.log(`  ⚠ ${noVersion} theme(s) missing version field (defaulting to 0.0.0)`);
}
console.log('Done!');
