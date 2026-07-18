#!/usr/bin/env node

/**
 * Update Badge Counts
 *
 * Counts all presets and updates the shields.io badge URLs in README.md.
 * Run automatically by CI after bundle generation.
 *
 * Usage:
 *   node scripts/update-badges.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const README = path.join(ROOT, 'README.md');

// ── Count presets ──

function countFiles(dir, ext) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(f => f.endsWith(ext)).length;
}

function countRecursive(dir, ext) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(d, entry.name));
      else if (entry.name.endsWith(ext)) count++;
    }
  };
  walk(dir);
  return count;
}

const counts = {
  canvasFx: countFiles(path.join(ROOT, 'canvas-fx'), '.js'),
  css: countFiles(path.join(ROOT, 'css-presets'), '.css'),
  themes: countFiles(path.join(ROOT, 'themes'), '.json'),
  gradients: countRecursive(path.join(ROOT, 'gradients'), '.json'),
};

console.log(`Counts: ${counts.canvasFx} Canvas FX, ${counts.css} CSS, ${counts.themes} themes, ${counts.gradients} gradients`);

// ── Badge patterns ──

const badges = [
  {
    pattern: /!\[Canvas FX\]\(https:\/\/img\.shields\.io\/badge\/Canvas_FX-\d+_animations-blue\)/,
    replacement: `![Canvas FX](https://img.shields.io/badge/Canvas_FX-${counts.canvasFx}_animations-blue)`,
  },
  {
    pattern: /!\[CSS Presets\]\(https:\/\/img\.shields\.io\/badge\/CSS-\d+_presets-purple\)/,
    replacement: `![CSS Presets](https://img.shields.io/badge/CSS-${counts.css}_presets-purple)`,
  },
  {
    pattern: /!\[Themes\]\(https:\/\/img\.shields\.io\/badge\/Themes-\d+_themes-green\)/,
    replacement: `![Themes](https://img.shields.io/badge/Themes-${counts.themes}_themes-green)`,
  },
  {
    pattern: /!\[Gradients\]\(https:\/\/img\.shields\.io\/badge\/Gradients-\d+_presets-orange\)/,
    replacement: `![Gradients](https://img.shields.io/badge/Gradients-${counts.gradients}_presets-orange)`,
  },
];

// ── Update README ──

let content = fs.readFileSync(README, 'utf8');
let updated = false;

for (const { pattern, replacement } of badges) {
  const before = content;
  content = content.replace(pattern, replacement);
  if (content !== before) updated = true;
}

if (updated) {
  fs.writeFileSync(README, content);
  console.log('✅ README badges updated');
} else {
  console.log('ℹ️  Badges already up to date');
}

// ── Update tool/README.md ──

const TOOL_README = path.join(ROOT, 'tool', 'README.md');
if (fs.existsSync(TOOL_README)) {
  let toolContent = fs.readFileSync(TOOL_README, 'utf8');
  let toolUpdated = false;

  const toolBadges = [
    {
      pattern: /(\| \*\*Canvas FX\*\* \| )\d+( interactive background animations)/,
      replacement: `$1${counts.canvasFx}$2`,
    },
    {
      pattern: /(\| \*\*CSS Presets\*\* \| )\d+( styling presets)/,
      replacement: `$1${counts.css}$2`,
    },
  ];

  for (const { pattern, replacement } of toolBadges) {
    const before = toolContent;
    toolContent = toolContent.replace(pattern, replacement);
    if (toolContent !== before) toolUpdated = true;
  }

  if (toolUpdated) {
    fs.writeFileSync(TOOL_README, toolContent);
    console.log('✅ tool/README.md counts updated');
  } else {
    console.log('ℹ️  tool/README.md counts already up to date');
  }
}
