#!/usr/bin/env node

/**
 * Process Theme Submission
 *
 * Parses a GitHub Issue body (from the theme-submission template),
 * extracts and validates the theme JSON, generates a clean filename,
 * adds repository metadata (updateUrl, version), and writes the
 * theme file to themes/.
 *
 * Called by the theme-submission GitHub Actions workflow.
 *
 * Environment variables:
 *   ISSUE_BODY   — the raw issue body markdown
 *   ISSUE_NUMBER — the issue number (for PR references)
 *   ISSUE_AUTHOR — the GitHub username who opened the issue
 *
 * Outputs (written to $GITHUB_OUTPUT):
 *   result       — 'success' or 'failure'
 *   filename     — the generated filename (on success)
 *   theme_name   — the theme display name (on success)
 *   errors       — newline-separated error messages (on failure)
 *   warnings     — newline-separated warning messages (on success)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const THEMES_DIR = path.join(ROOT, 'themes');
const RAW_BASE = 'https://raw.githubusercontent.com/silentoplayz/theme-designer-pro-presets/main';

// ── Parse issue body ──

function parseIssueBody(body) {
  const sections = {};
  const lines = body.split('\n');
  let currentKey = null;
  let currentLines = [];

  for (const line of lines) {
    const headerMatch = line.match(/^### (.+)$/);
    if (headerMatch) {
      if (currentKey) {
        sections[currentKey] = currentLines.join('\n').trim();
      }
      currentKey = headerMatch[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentKey) {
    sections[currentKey] = currentLines.join('\n').trim();
  }
  return sections;
}

function extractJSON(raw) {
  // Strip markdown code fences if present
  let json = raw;

  // Handle ```json ... ``` blocks
  const fenceMatch = json.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (fenceMatch) {
    json = fenceMatch[1];
  }

  // Try parsing
  return JSON.parse(json);
}

function sanitizeFilename(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/\/\//g, ' ')                             // // → space
    .replace(/[^a-zA-Z0-9\s]/g, ' ')                  // non-alnum → space
    .trim()
    .replace(/\s+/g, '_')                              // spaces → underscores
    .toLowerCase()
    .slice(0, 60);
}

// ── Validation ──

function validateTheme(data) {
  const errors = [];
  const warnings = [];

  // Required top-level fields
  if (!data.name || typeof data.name !== 'string') {
    errors.push('Missing or invalid `name` field');
  }

  // Must have at least dark mode
  if (!data.dark || typeof data.dark !== 'object') {
    errors.push('Missing `dark` mode — every theme must have a dark mode');
  }
  if (!data.light || typeof data.light !== 'object') {
    warnings.push('Missing `light` mode — themes should have both dark and light modes for full coverage');
  }

  // Check mode structure
  const MODES = ['dark', 'light', 'oled', 'her'];
  const presentModes = MODES.filter(m => data[m] && typeof data[m] === 'object');

  if (presentModes.length === 0) {
    errors.push('No valid modes found. Theme must have at least one of: dark, light, oled, her');
  }

  for (const mode of presentModes) {
    const m = data[mode];

    // OKLCH color fields
    if (typeof m.h !== 'number') errors.push(`${mode}.h must be a number`);
    if (typeof m.c !== 'number') errors.push(`${mode}.c must be a number`);
    if (typeof m.l !== 'number') errors.push(`${mode}.l must be a number`);
  }

  // Warnings for missing modes
  const missingModes = MODES.filter(m => !presentModes.includes(m));
  if (missingModes.length > 0) {
    warnings.push(`Missing modes: ${missingModes.join(', ')} — the theme will work but won't cover all modes`);
  }

  // Check for forbidden content in Canvas FX scripts
  for (const mode of presentModes) {
    const script = data[mode].canvasScript;
    if (script && typeof script === 'string') {
      const forbidden = ['document.', 'window.', 'localStorage', 'alert(', 'eval(', 'Function('];
      for (const f of forbidden) {
        if (script.includes(f)) {
          errors.push(`${mode}.canvasScript contains forbidden API: ${f} — Canvas FX runs in a Web Worker and cannot access the DOM`);
        }
      }
    }
  }

  return { errors, warnings, presentModes };
}

// ── Main ──

function main() {
  const body = process.env.ISSUE_BODY;
  const issueNumber = process.env.ISSUE_NUMBER;
  const issueAuthor = process.env.ISSUE_AUTHOR;
  const outputFile = process.env.GITHUB_OUTPUT;

  if (!body) {
    console.error('ISSUE_BODY environment variable is not set');
    process.exit(1);
  }

  function setOutput(key, value) {
    if (outputFile) {
      // Handle multiline values with delimiter
      const delimiter = `EOF_${Date.now()}`;
      fs.appendFileSync(outputFile, `${key}<<${delimiter}\n${value}\n${delimiter}\n`);
    }
    console.log(`::set-output name=${key}::${value.replace(/\n/g, '%0A')}`);
  }

  console.log('Processing theme submission...\n');

  // Parse sections
  const sections = parseIssueBody(body);
  const themeName = sections['Theme Name'] || '';
  const jsonRaw = sections['Theme JSON'] || '';
  const description = sections['Description'] || '';
  const authorField = sections['Author Credit'] || issueAuthor || '';

  console.log(`Theme Name: ${themeName}`);
  console.log(`Author: ${authorField}`);
  console.log(`Description: ${description.slice(0, 80)}${description.length > 80 ? '...' : ''}`);
  console.log('');

  // Extract and parse JSON
  let data;
  try {
    data = extractJSON(jsonRaw);
  } catch (e) {
    const msg = `Invalid JSON: ${e.message}`;
    console.error(`❌ ${msg}`);
    setOutput('result', 'failure');
    setOutput('errors', msg);
    process.exit(0); // Exit cleanly so the workflow can comment
  }

  // Override name if provided in the form
  if (themeName) {
    data.name = themeName;
  }

  // Validate
  const { errors, warnings, presentModes } = validateTheme(data);

  if (errors.length > 0) {
    console.error('❌ Validation failed:\n');
    errors.forEach(e => console.error(`  • ${e}`));
    setOutput('result', 'failure');
    setOutput('errors', errors.join('\n'));
    process.exit(0);
  }

  // Generate filename
  const filename = sanitizeFilename(data.name) + '.json';
  const filepath = path.join(THEMES_DIR, filename);

  // Check for duplicates
  if (fs.existsSync(filepath)) {
    const msg = `A theme file named \`${filename}\` already exists in the repository. Please choose a different name or note that this is an update.`;
    console.error(`❌ ${msg}`);
    setOutput('result', 'failure');
    setOutput('errors', msg);
    process.exit(0);
  }

  // Add repository metadata
  data.version = data.version || '1.0.0';
  data.author = authorField;
  data.description = description || data.description || '';
  data.updateUrl = `${RAW_BASE}/themes/${filename}`;

  // Write the file
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2) + '\n');
  const sizeKB = (fs.statSync(filepath).size / 1024).toFixed(1);

  console.log(`\n✅ Theme written: themes/${filename} (${sizeKB} KB)`);
  console.log(`   Modes: ${presentModes.join(', ')}`);
  if (warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    warnings.forEach(w => console.log(`   • ${w}`));
  }

  // Set outputs
  setOutput('result', 'success');
  setOutput('filename', filename);
  setOutput('theme_name', data.name);
  setOutput('modes', presentModes.join(', '));
  setOutput('size', sizeKB);
  if (warnings.length > 0) {
    setOutput('warnings', warnings.join('\n'));
  }
}

main();
