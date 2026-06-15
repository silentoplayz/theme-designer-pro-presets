# Bundles

Pre-built import-ready JSON files generated from the individual presets in this repository.

## Available Bundles

| Bundle | Description |
|---|---|
| `canvas-fx-all.json` | All Canvas FX animations combined |
| `canvas-fx-{category}.json` | Per-category Canvas FX bundles (cosmic, nature, etc.) |
| `css-presets-all.json` | All CSS presets combined |
| `gradients-all.json` | All gradient presets combined |

## Usage

1. Download the bundle `.json` file you want
2. Open **Theme Designer Pro** in Open WebUI
3. Click **Import** and select the file
4. All presets from the bundle are loaded at once

## Regenerating

After adding or modifying presets, regenerate bundles from the repo root:

```bash
node scripts/build-bundles.js
```

> **Note**: Bundle files are checked into git so users can download them directly from GitHub without cloning the repo.
