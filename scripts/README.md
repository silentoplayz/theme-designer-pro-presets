# Scripts

Build, validation, and manifest tooling for the Theme Designer Pro Preset Gallery.

| Script | Purpose |
|---|---|
| `build-bundles.js` | Regenerate all import-ready bundles from individual presets |
| `build-catalog.js` | Generate `docs/catalog.json` for the GitHub Pages preset gallery |
| `build-manifest.js` | Generate `manifest.json` for bulk theme update checking |
| `extract-curated.js` | Generate theme JSON files from the 8 built-in curated presets |
| `extract-presets.js` | Split bulk export files into individual preset files |
| `process-submission.js` | Process GitHub Issue theme submissions (used by CI) |
| `update-badges.js` | Update shields.io badge counts in `README.md` and `tool/README.md` |
| `validate.js` | Validate all preset files against JSON schemas (via Ajv) and quality rules |

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
| `owui-css-backup-*.json` | `css-presets/*.css` | Raw CSS stylesheets |
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
4. **Regenerate bundles** — `npm run build`
5. **Commit and push** when you're happy with the curation

---

## `extract-curated.js`

Generates theme JSON files from the 8 hardcoded curated presets built into Theme Designer Pro.

### Usage

```bash
node scripts/extract-curated.js [--force]
```

### Arguments

| Argument | Required | Description |
|---|---|---|
| `--force` | No | Overwrite existing theme files (by default, existing files are skipped) |

Each curated preset (Midnight, Emerald, Amber, Amethyst, Ruby, Sapphire, Topaz, Obsidian) generates a complete theme file in `themes/` with all 4 modes and gradient configuration.

---

## `build-bundles.js`

Scans all preset directories and generates combined import-ready JSON bundles in `bundles/`.

### Usage

```bash
npm run build
# or: node scripts/build-bundles.js
```

### What It Generates

| Bundle | Source | Description |
|---|---|---|
| `everything.json` | All directories | All preset types in one import |
| `canvas-fx-all.json` | `canvas-fx/*.js` | All Canvas FX animations |
| `css-presets-all.json` | `css-presets/*.css` | All CSS presets |
| `gradients-all.json` | `gradients/**/*.json` | All gradients (recursive) |
| `gradients-still.json` | `gradients/still/**/*.json` | Static gradients only |
| `gradients-animated.json` | `gradients/animated/**/*.json` | Animated gradients only |
| `themes-all.json` | `themes/*.json` | All themes |

Bundles are checked into git so users can download them directly from GitHub without cloning.

### When To Run

Run this after any changes to preset files — adding, removing, or modifying presets in any directory. Note: the [CI workflow](../.github/workflows/build-bundles.yml) runs this automatically on push to `main`.

---

## `validate.js`

Validates all preset files against the repository's quality and schema rules. Used by CI to gate merges.

### Usage

```bash
npm run validate
# or: node scripts/validate.js
```

> **Prerequisite**: Run `npm install` first to install the Ajv schema validation dependency.

### What It Checks

| Category | Hard Errors | Warnings |
|---|---|---|
| Canvas FX | Missing `onmessage` handler, forbidden DOM access (`document`, `window`, `localStorage`, `alert`) | Missing heartbeat |
| CSS Presets | Empty file, no CSS syntax detected | — |
| Themes | Invalid JSON, missing `name`, missing `dark`/`light` modes, OKLCH `h`/`c`/`l` fields (via JSON Schema) | — |
| Gradients | Invalid JSON, missing `name`/`type`, invalid type, wrong subdirectory, missing stops/meshPoints | — |
| Bundles | Invalid JSON, backup flag without matching array | — |

Exits with code `1` if any hard errors are found. Warnings are printed but don't fail the build.

---

## `build-manifest.js`

Generates a centralized `manifest.json` listing every theme with its version, author, and update URL. Used by Theme Designer Pro's bulk update checker to compare versions in a single fetch.

### Usage

```bash
npm run build:manifest
# or: node scripts/build-manifest.js
```

### What It Generates

A `manifest.json` at the repo root with this structure:

```json
{
  "manifestVersion": "1.0",
  "generated": "2026-06-16T12:00:00.000Z",
  "manifestUrl": "https://github.com/silentoplayz/.../manifest.json",
  "themes": {
    "sovereign": {
      "name": "Sovereign",
      "version": "1.0.0",
      "updateUrl": "https://github.com/silentoplayz/.../themes/sovereign.json",
      "file": "themes/sovereign.json"
    }
  }
}
```

Themes without a `version` field default to `"0.0.0"`. Empty `author` and `description` fields are omitted for cleaner output.

---

## `process-submission.js`

Parses a GitHub Issue body (from the `theme-submission` issue template), extracts and validates the embedded theme JSON, generates a clean filename, adds repository metadata (`updateUrl`, `version`), and writes the theme file to `themes/`.

This script is called automatically by the [`theme-submission.yml`](../.github/workflows/theme-submission.yml) GitHub Actions workflow — it is not intended to be run manually.

### Environment Variables

| Variable | Description |
|---|---|
| `ISSUE_BODY` | The raw GitHub Issue body markdown |
| `ISSUE_NUMBER` | The issue number (for PR references) |
| `ISSUE_AUTHOR` | The GitHub username who opened the issue |

### Outputs

Writes to `$GITHUB_OUTPUT`:

| Output | Description |
|---|---|
| `result` | `success` or `failure` |
| `filename` | The generated filename (on success) |
| `theme_name` | The theme's display name (on success) |
| `modes` | Comma-separated list of modes included (on success) |
| `size` | File size in KB (on success) |
| `errors` | Newline-separated error messages (on failure) |
| `warnings` | Newline-separated warning messages (on success, if any) |

---

## `update-badges.js`

Counts all presets and updates the shields.io badge URLs in `README.md` with current numbers.

### Usage

```bash
npm run build:badges
# or: node scripts/update-badges.js
```

No output if badges are already correct. Prints `✅ README badges updated` and/or `✅ tool/README.md counts updated` when changes are made.

---

## `build-catalog.js`

Scans all preset directories and generates a comprehensive `docs/catalog.json` used by the [GitHub Pages preset gallery](https://silentoplayz.github.io/theme-designer-pro-presets/).

### Usage

```bash
npm run build:catalog
# or: node scripts/build-catalog.js
```

### What It Generates

A single `docs/catalog.json` containing metadata for every preset in the repository:

| Section | Data Included |
|---|---|
| `themes` | Name, description, author, version, per-mode OKLCH colors, feature flags (CSS, FX, gradient, overrides), import URL |
| `canvasFx` | Name (from JSDoc `Title:` or filename), description, import URL |
| `cssPresets` | Name (title-cased filename), import URL |
| `gradients` | Name, type (linear/radial/mesh), animated flag, color stops, import URL |
| `bundles` | Name, description, import URL |

The catalog is rebuilt automatically by CI on every push to `main`. The static site in `docs/` fetches this file at runtime to render the browsable gallery.
