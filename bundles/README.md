# Bundles

Pre-built import-ready JSON files generated from the individual presets in this repository. Download any bundle and import it directly into Theme Designer Pro for one-click bulk loading.

## Available Bundles

| Bundle | Description |
|---|---|
| **`everything.json`** | **All presets combined — animations, CSS, themes, and gradients in one import** |
| `canvas-fx-all.json` | All Canvas FX scripts |
| `css-presets-all.json` | All CSS presets |
| `themes-all.json` | All themes |
| `gradients-all.json` | All gradient presets |
| `gradients-still.json` | Static (non-animated) gradients only |
| `gradients-animated.json` | Animated gradients only |

## Usage

1. Download the bundle `.json` file you want
2. Open **Theme Designer Pro** in Open WebUI
3. Click **Import** and select the file
4. All presets from the bundle are loaded at once

You can also paste a bundle's raw GitHub URL directly into the import modal's URL field — Theme Designer Pro will auto-convert it.

## Regenerating

After adding or modifying presets, regenerate bundles from the repo root:

```bash
node scripts/build-bundles.js
```

> **Note**: Bundle files are checked into git so users can download them directly from GitHub without cloning the repo. The [CI workflow](../.github/workflows/build-bundles.yml) automatically regenerates all bundles on push to `main` — you generally don't need to run this manually.
