# Scripts

Build and extraction tooling for the Theme Designer Pro Preset Gallery.

---

## `extract-presets.js`

Splits Theme Designer Pro bulk export files into individual preset files, ready for curation.

### Why

Theme Designer Pro exports everything in bulk — a single JSON file containing all your Canvas FX scripts, CSS presets, or themes. This script breaks those bulk files apart into individual files so you can review, rename, and curate them before committing to the gallery.

### Usage

```bash
node scripts/extract-presets.js <path-to-exports-directory> [--force]
```

### Arguments

| Argument | Required | Description |
|---|---|---|
| `<path>` | Yes | Path to the directory containing your Theme Designer Pro export files |
| `--force` | No | Overwrite existing files (by default, existing files are skipped) |

### What It Looks For

The script scans the given directory for these filename patterns:

| File Pattern | Extracts To | Format |
|---|---|---|
| `owui-canvas-backup-*.json` | `canvas-fx/*.js` | Raw JavaScript (the script source code) |
| `owui-css-backup-*.json` | `css-presets/*.json` | JSON with `name` and `code` fields |
| `owui-themes-backup-*.json` | `themes/*.json` | JSON with full theme config (all modes) |

### Filename Generation

Display names are converted to filesystem-safe filenames:

| Display Name | Generated Filename |
|---|---|
| `Rosé Pine` | `rose_pine` |
| `NEO-TACTICAL // ARCHIVE 01` | `neo_tactical_archive_01` |
| `01: The Architect (Matrix)` | `01_the_architect_matrix` |
| `@h4nn1b4l Custom CSS` | `h4nn1b4l_custom_css` |
| `Neon Cyberpunk (Animated)` | `neon_cyberpunk_animated` |

**Rules applied:**
1. Unicode normalization — accented characters become ASCII equivalents (`é` → `e`)
2. `//` separators are removed
3. All remaining non-alphanumeric characters become spaces
4. Spaces collapse into single underscores
5. Truncated to 60 characters max
6. Duplicate names get `_2`, `_3`, etc. appended

### Example

```bash
# Extract from your exports directory
node scripts/extract-presets.js ~/exports/theme-designer-pro/

# Output:
# 📦 Canvas FX: owui-canvas-backup-2026-05-06.json
#    Found 17 presets
#
#   ✓ Tactical Liquid Grid: tactical_liquid_grid.js (2.6 KB)
#   ✓ The Genesis Lattice: the_genesis_lattice.js (8.9 KB)
#   ...
#
# 🖌️  CSS Presets: owui-css-backup-2026-05-06.json
#    Found 11 presets
#   ...
#
# 🎭 Themes: owui-themes-backup-2026-05-06.json
#    Found 24 themes
#   ...
#
# ──────────────────────────────────────────────────
# Extracted: 52 files
#
# Filename mapping:
#   "Tactical Liquid Grid" → canvas-fx/tactical_liquid_grid.js
#   ...
```

### After Extraction

1. **Review the files** — check the filename mapping printed at the end
2. **Rename anything** you don't like — the generated names are a starting point
3. **Delete presets** you don't want in the gallery
4. **Regenerate bundles** — `node scripts/build-bundles.js`
5. **Commit and push** when you're happy with the curation

---

## `build-bundles.js`

Scans all preset directories and generates combined import-ready JSON bundles in `bundles/`.

### Usage

```bash
node scripts/build-bundles.js
```

### What It Generates

| Bundle | Source | Description |
|---|---|---|
| `canvas-fx-all.json` | `canvas-fx/*.js` | All Canvas FX animations |
| `css-presets-all.json` | `css-presets/*.json` | All CSS presets |
| `gradients-all.json` | `gradients/**/*.json` | All gradients (recursive) |
| `gradients-still.json` | `gradients/still/**/*.json` | Static gradients only |
| `gradients-animated.json` | `gradients/animated/**/*.json` | Animated gradients only |
| `themes-all.json` | `themes/*.json` | All themes |

Bundles are checked into git so users can download them directly from GitHub without cloning.

### When To Run

Run this after any changes to preset files — adding, removing, or modifying presets in any directory.
