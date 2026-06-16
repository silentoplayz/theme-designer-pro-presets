#!/usr/bin/env node

/**
 * Extract Curated Presets
 *
 * Generates theme JSON files from the 8 hardcoded curated presets
 * in Theme Designer Pro. Each preset gets a complete theme file
 * with all 4 modes and gradient configuration.
 *
 * Usage:
 *   node scripts/extract-curated.js [--force]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const THEMES_DIR = path.join(ROOT, 'themes');
const RAW_BASE = 'https://raw.githubusercontent.com/silentoplayz/theme-designer-pro-presets/main';

const force = process.argv.includes('--force');

// Curated presets from the tool (CURATED_PRESETS object)
// Format: { modeName: [h, c, l], gradient: { type, angle, stops } }
const CURATED_PRESETS = {
  midnight: {
    dark: [250, 20, 15], oled: [250, 20, 0], light: [250, 20, 15], her: [250, 20, 15],
    gradient: { type: 'linear', angle: 135, stops: [{ color: '#0a0a2e', position: 0 }, { color: '#1a1a4e', position: 33 }, { color: '#0d1b3e', position: 66 }, { color: '#0a0a2e', position: 100 }] }
  },
  emerald: {
    dark: [155, 15, 18], oled: [155, 15, 0], light: [155, 15, 18], her: [155, 15, 18],
    gradient: { type: 'linear', angle: 135, stops: [{ color: '#0b1a0f', position: 0 }, { color: '#1b3a26', position: 33 }, { color: '#0d2818', position: 66 }, { color: '#0b1a0f', position: 100 }] }
  },
  amber: {
    dark: [75, 20, 20], oled: [75, 20, 0], light: [75, 20, 20], her: [75, 20, 20],
    gradient: { type: 'linear', angle: 135, stops: [{ color: '#1a1608', position: 0 }, { color: '#2e2510', position: 33 }, { color: '#1f1a0a', position: 66 }, { color: '#1a1608', position: 100 }] }
  },
  amethyst: {
    dark: [290, 25, 18], oled: [290, 25, 0], light: [290, 25, 18], her: [290, 25, 18],
    gradient: { type: 'linear', angle: 135, stops: [{ color: '#0d0221', position: 0 }, { color: '#261447', position: 33 }, { color: '#1a0a35', position: 66 }, { color: '#0d0221', position: 100 }] }
  },
  ruby: {
    dark: [350, 25, 18], oled: [350, 25, 0], light: [350, 25, 18], her: [350, 25, 18],
    gradient: { type: 'linear', angle: 135, stops: [{ color: '#1a0a0a', position: 0 }, { color: '#3a1020', position: 33 }, { color: '#2a0815', position: 66 }, { color: '#1a0a0a', position: 100 }] }
  },
  sapphire: {
    dark: [210, 25, 18], oled: [210, 25, 0], light: [210, 25, 18], her: [210, 25, 18],
    gradient: { type: 'linear', angle: 135, stops: [{ color: '#0a1628', position: 0 }, { color: '#0d3b66', position: 33 }, { color: '#0a2540', position: 66 }, { color: '#0a1628', position: 100 }] }
  },
  topaz: {
    dark: [40, 20, 18], oled: [40, 20, 0], light: [40, 20, 18], her: [40, 20, 18],
    gradient: { type: 'linear', angle: 135, stops: [{ color: '#1a140a', position: 0 }, { color: '#2e2010', position: 33 }, { color: '#241a0c', position: 66 }, { color: '#1a140a', position: 100 }] }
  },
  obsidian: {
    dark: [0, 0, 10], oled: [0, 0, 0], light: [0, 0, 10], her: [0, 0, 10],
    gradient: { type: 'linear', angle: 135, stops: [{ color: '#000000', position: 0 }, { color: '#1a1a2e', position: 33 }, { color: '#16213e', position: 66 }, { color: '#0a0a1a', position: 100 }] }
  }
};

// Display names for each preset
const DISPLAY_NAMES = {
  midnight: 'Midnight',
  emerald: 'Emerald',
  amber: 'Amber',
  amethyst: 'Amethyst',
  ruby: 'Ruby',
  sapphire: 'Sapphire',
  topaz: 'Topaz',
  obsidian: 'Obsidian'
};

// Descriptions
const DESCRIPTIONS = {
  midnight: 'Deep indigo tones with a dark linear gradient backdrop. A refined nocturnal palette.',
  emerald: 'Rich green hues evoking a dense, jewel-toned forest with matching gradient.',
  amber: 'Warm golden-olive palette reminiscent of polished amber, with a subtle gradient glow.',
  amethyst: 'Vibrant purple tones inspired by amethyst crystals, with a deep violet gradient.',
  ruby: 'Deep crimson and rose tones with a rich red gradient backdrop.',
  sapphire: 'Cool blue tones reminiscent of a deep sapphire, with a matching ocean-depth gradient.',
  topaz: 'Warm bronze and sienna tones with an earthy gradient backdrop.',
  obsidian: 'Pure achromatic darkness with a subtle charcoal-to-navy gradient.'
};

function buildMode(preset, modeName) {
  const [h, c, l] = preset[modeName] || preset.dark;
  const gradient = preset.gradient || {};

  return {
    h,
    c,
    l,
    overrides: {},
    customCSS: '',
    customCssEnabled: false,
    autoScope: true,
    locks: {},
    canvasEnabled: false,
    canvasScript: '',
    canvasShowAuth: false,
    themeShowAuth: false,
    customCssShowAuth: false,
    gradientEnabled: true,
    gradientType: gradient.type || 'linear',
    gradientAngle: gradient.angle || 135,
    gradientStops: JSON.parse(JSON.stringify(gradient.stops || [])),
    gradientIntensity: 100,
    gradientAnimation: null,
    gradientAnimationSpeed: 5,
    gradientShowAuth: false,
    gradientRadialPosX: 50,
    gradientRadialPosY: 50,
    gradientRadialShape: 'ellipse',
    gradientRadialSize: 'farthest-corner',
    gradientMeshPoints: [],
    gradientMeshBgColor: '#000000'
  };
}

console.log('Extracting curated presets...\n');

let created = 0;
let skipped = 0;

for (const [id, preset] of Object.entries(CURATED_PRESETS)) {
  const filename = `${id}.json`;
  const filepath = path.join(THEMES_DIR, filename);

  if (fs.existsSync(filepath) && !force) {
    console.log(`  ⏭  ${filename} — already exists (use --force to overwrite)`);
    skipped++;
    continue;
  }

  const theme = {
    name: DISPLAY_NAMES[id],
    version: '1.0.0',
    author: 'silentoplayz (G30)',
    description: DESCRIPTIONS[id],
    updateUrl: `${RAW_BASE}/themes/${filename}`,
    dark: buildMode(preset, 'dark'),
    light: buildMode(preset, 'light'),
    oled: buildMode(preset, 'oled'),
    her: buildMode(preset, 'her')
  };

  fs.writeFileSync(filepath, JSON.stringify(theme, null, 2) + '\n');
  const sizeKB = (fs.statSync(filepath).size / 1024).toFixed(1);
  console.log(`  ✓ ${filename} (${sizeKB} KB)`);
  created++;
}

console.log(`\n──────────────────────────────────────────────────`);
console.log(`Created: ${created} | Skipped: ${skipped}`);
if (created > 0) {
  console.log(`\nNext steps:`);
  console.log(`  1. Review the generated files in themes/`);
  console.log(`  2. Run: node scripts/validate.js`);
  console.log(`  3. Commit and push (CI rebuilds bundles + manifest)`);
}
