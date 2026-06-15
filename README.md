# Theme Designer Pro — Preset Gallery

[![Build Bundles](https://github.com/silentoplayz/theme-designer-pro-presets/actions/workflows/build-bundles.yml/badge.svg)](https://github.com/silentoplayz/theme-designer-pro-presets/actions/workflows/build-bundles.yml)
![Canvas FX](https://img.shields.io/badge/Canvas_FX-61_animations-blue)
![CSS Presets](https://img.shields.io/badge/CSS-14_presets-purple)
![Themes](https://img.shields.io/badge/Themes-27_themes-green)
![Gradients](https://img.shields.io/badge/Gradients-13_presets-orange)

A curated collection of themes, Canvas FX animations, CSS presets, and gradient packs for [Theme Designer Pro](https://openwebui.com/posts/49fac49a-7cc3-4b9f-8f75-b3916abbfa5f) — the native theming tool for [Open WebUI](https://github.com/open-webui/open-webui).

> **Import any preset** directly into Theme Designer Pro using the built-in Import button, URL import, or drag-and-drop.

---

## 📦 Repository Structure

```
theme-designer-pro-presets/
├── .github/
│   ├── ISSUE_TEMPLATE/      # Bug report & preset submission forms
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── workflows/
│       └── build-bundles.yml  # CI: validate → build → commit
├── bundles/                 # Combined import-ready JSON files
├── canvas-fx/               # Canvas FX animation scripts (.js)
├── css-presets/              # CSS-only styling presets (.css)
├── gradients/               # Gradient preset packs (.json)
│   ├── animated/            #   Animated/transitioning gradients
│   │   ├── linear/
│   │   ├── mesh/
│   │   └── radial/
│   └── still/               #   Non-animated gradients
│       ├── linear/
│       ├── mesh/
│       └── radial/
├── schemas/                 # JSON schemas for validation
├── scripts/                 # Build, validation, and manifest tooling
├── themes/                  # Complete theme presets (.json)
├── tool/                    # Theme Designer Pro tool + documentation
├── .gitignore
├── CONTRIBUTING.md
├── LICENSE
├── manifest.json            # Centralized theme update manifest
└── README.md
```

> **Looking for the tool itself?** The Theme Designer Pro Open WebUI tool and its full documentation live in [`tool/`](tool/).

---

## 🚀 Quick Start

### Import Everything at Once

1. Open **Theme Designer Pro** in Open WebUI
2. Go to any Import modal → paste this URL:
   ```
   https://raw.githubusercontent.com/silentoplayz/theme-designer-pro-presets/main/bundles/everything.json
   ```
3. Click **Load URL** — all animations, CSS, themes, and gradients are imported in one shot

### Import a Category Bundle

Download or URL-import any bundle from [`bundles/`](bundles/):

| Bundle | Description |
|---|---|
| **`everything.json`** | **All presets in one import** |
| `canvas-fx-all.json` | All Canvas FX scripts |
| `css-presets-all.json` | All CSS presets |
| `themes-all.json` | All themes |
| `gradients-all.json` | All gradient presets |
| `gradients-still.json` | Static (non-animated) gradients only |
| `gradients-animated.json` | Animated gradients only |

### Import Individual Presets

- **Canvas FX**: Canvas FX tab → Import → select a `.js` file from [`canvas-fx/`](canvas-fx/)
- **CSS**: Style Overrides tab → Import → select a `.css` file from [`css-presets/`](css-presets/)
- **Themes**: Theme Library → Import → select a `.json` from [`themes/`](themes/)
- **Gradients**: Gradient tab → Import → select a `.json` from [`gradients/`](gradients/)

### Drag & Drop

Drag any `.js`, `.css`, or `.json` file directly onto the Theme Designer Pro interface.

### URL Import

Paste any GitHub file URL into an import modal's URL field — Theme Designer Pro automatically converts `github.com` blob URLs to raw content URLs.

---

## 📁 Preset Types

### 🎨 Canvas FX ([`canvas-fx/`](canvas-fx/))

JavaScript animation scripts that run behind the Open WebUI interface via OffscreenCanvas in a Web Worker. Each script is a standalone `.js` file. Many include a `CONFIG` block with tunable properties.

### 🎭 Themes ([`themes/`](themes/))

Complete theme configurations including OKLCH color tokens, CSS overrides, Canvas FX selection, and per-mode settings (dark, light, OLED, her). Exported as `.json` files. Every theme includes an `updateUrl` for automatic update checking.

### 🖌️ CSS Presets ([`css-presets/`](css-presets/))

CSS-only styling overrides — fonts, colors, spacing, component styles, and visual effects. Stored as raw `.css` files.

### 🌈 Gradients ([`gradients/`](gradients/))

Gradient presets for backgrounds, panels, and UI elements. Organized by motion (`still`/`animated`) and type (`linear`/`radial`/`mesh`).

### 📦 Bundles ([`bundles/`](bundles/))

Combined JSON files for one-click bulk import. See [`bundles/README.md`](bundles/README.md).

### 📐 Schemas ([`schemas/`](schemas/))

JSON Schema definitions documenting the data formats for themes, Canvas FX, CSS, gradient presets, and the update manifest.

### 📋 Manifest ([`manifest.json`](manifest.json))

Centralized theme update manifest listing every theme with its current version and raw GitHub `updateUrl`. Theme Designer Pro fetches this in a single request to check all themes for updates at once.

### 🛠️ Tool ([`tool/`](tool/))

The Theme Designer Pro Open WebUI tool source file and its full documentation. See [`tool/README.md`](tool/README.md) for installation, features, valve configuration, and usage instructions.

---

## 🔧 Canvas FX API Contract

All Canvas FX scripts must follow this Web Worker contract:

```javascript
// Receive messages from the host
self.onmessage = (e) => {
  switch (e.data.type) {
    case 'init':    // { canvas: OffscreenCanvas, width, height }
    case 'resize':  // { width, height }
    case 'mousemove': // { x, y }
  }
};

// Send heartbeat to prevent worker termination
setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

// Use requestAnimationFrame for the render loop
// NO DOM access (no document, window, alert, localStorage)
```

---

## ⚙️ CI/CD

This repository uses a [GitHub Actions workflow](.github/workflows/build-bundles.yml) to automatically validate, rebuild, and keep metadata in sync.

### What Happens on Push to `main`

1. **Validate** — `scripts/validate.js` runs against all preset files:
   - Canvas FX: checks for `onmessage` handler, forbidden DOM access, heartbeat (warning)
   - CSS: verifies non-empty files with valid syntax
   - Themes: validates required `name`, `updateUrl`, mode objects, and OKLCH color fields
   - Gradients: checks type, stops, correct subdirectory placement
   - Bundles: verifies backup flags match their content arrays
2. **Build bundles** — `scripts/build-bundles.js` regenerates all bundles
3. **Build manifest** — `scripts/build-manifest.js` regenerates `manifest.json` with current theme versions
4. **Update badges** — `scripts/update-badges.js` recalculates preset counts in README badge URLs
5. **Auto-commit** — if any generated files changed, the bot commits and pushes them

### What Happens on Pull Requests

Only the **Validate** step runs — bundles, manifest, and badges are not rebuilt. This gives contributors immediate feedback on whether their presets are correctly formatted before merge.

### Running Locally

```bash
node scripts/validate.js       # Check all presets (run before pushing)
```

> **Note**: Do **not** run the build scripts locally before committing — CI handles bundles, manifest, and badges automatically. Rebuilding locally causes merge conflicts on the next push. If you need to test build output, run the scripts but discard the generated file changes before committing.

---

## 📜 License

[MIT](LICENSE) — free to use, modify, and redistribute.

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on submitting presets, quality standards, and the curation process.
