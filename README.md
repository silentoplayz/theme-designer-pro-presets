# Theme Designer Pro — Preset Gallery

[![Build Bundles](https://github.com/silentoplayz/theme-designer-pro-presets/actions/workflows/build-bundles.yml/badge.svg)](https://github.com/silentoplayz/theme-designer-pro-presets/actions/workflows/build-bundles.yml)
![Canvas FX](https://img.shields.io/badge/Canvas_FX-84_animations-blue)
![CSS Presets](https://img.shields.io/badge/CSS-10_presets-purple)
![Themes](https://img.shields.io/badge/Themes-33_themes-green)
![Gradients](https://img.shields.io/badge/Gradients-13_presets-orange)

A curated collection of themes, Canvas FX animations, CSS presets, and gradient packs for [Theme Designer Pro](https://openwebui.com/posts/49fac49a-7cc3-4b9f-8f75-b3916abbfa5f) — the native theming tool for [Open WebUI](https://github.com/open-webui/open-webui).

> **[Browse the Preset Gallery →](https://silentoplayz.github.io/theme-designer-pro-presets/)** — preview every theme, effect, and gradient before importing.

> **Import any preset** directly into Theme Designer Pro using the built-in Import button, URL import, or drag-and-drop.

---

## 📦 Repository Structure

```
theme-designer-pro-presets/
├── .github/
│   ├── ISSUE_TEMPLATE/      # Bug report, preset, & theme submission forms
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── workflows/
│       ├── build-bundles.yml   # CI: validate → build → commit
│       ├── deploy-pages.yml    # CD: deploy docs/ to GitHub Pages
│       └── theme-submission.yml # Automated theme submission processing
├── bundles/                 # Combined import-ready JSON files
├── canvas-fx/               # Canvas FX animation scripts (.js)
├── css-presets/             # CSS-only styling presets (.css)
├── docs/                    # GitHub Pages preset catalog
├── event-function/          # Theme Designer Pro event function + documentation
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
├── tools/                   # Theme Designer Pro tools + documentation
│   ├── theme_designer_pro.py          # Standalone tool (individual users)
│   ├── theme_designer_pro_launcher.py # Launcher companion (event function)
│   └── README.md
├── .gitignore
├── CONTRIBUTING.md
├── LICENSE
├── manifest.json            # Centralized theme update manifest
└── README.md
```

> **Looking for the theming tools?** The Theme Designer Pro tool lives in [`tools/`](tools/), the event function lives in [`event-function/`](event-function/), and the companion launcher tool is at [`tools/theme_designer_pro_launcher.py`](tools/theme_designer_pro_launcher.py).

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

### 🛠️ Tool ([`tools/`](tools/))

The Theme Designer Pro Open WebUI **tool** — invoked via AI chat, renders inside an iframe artifact, and persists themes in browser localStorage. Designed for **individual users** who want personal theme customization without requiring admin access. See [`tools/README.md`](tools/README.md) for installation, features, valve configuration, and usage instructions.

> **Note:** Active development is focused on the Event Function. The standalone Tool remains fully functional but is in maintenance mode.

### ⚡ Event Function ([`event-function/`](event-function/))

The Theme Designer Pro **event function** — a standalone admin page variant with server-side persistence and real-time SSE push to all connected users. Designed for **server administrators** who want instance-wide theming. See [`event-function/README.md`](event-function/README.md) for installation and how it differs from the tool.

### 🚀 Launcher Tool ([`tools/theme_designer_pro_launcher.py`](tools/theme_designer_pro_launcher.py))

A lightweight **companion tool** for the Event Function that opens the designer page directly inside an Open WebUI chat via iframe — no need to navigate to the URL manually. Admin-only. Requires the Event Function to be installed and running.

---

## ⚙️ CI/CD

This repository uses three [GitHub Actions workflows](.github/workflows/) to automate validation, builds, deployments, and community submissions.

### Validate & Build Bundles ([`build-bundles.yml`](.github/workflows/build-bundles.yml))

#### What Happens on Push to `main`

> The workflow only triggers when preset files are modified (`.js` in `canvas-fx/`, `.css` in `css-presets/`, `.json` in `themes/`, `gradients/`, `schemas/`, or `.js` in `scripts/`). README and documentation edits do not trigger a rebuild.

1. **Validate** — `scripts/validate.js` runs against all preset files:
   - Canvas FX: checks for `onmessage` handler, forbidden DOM access, heartbeat (warning)
   - CSS: verifies non-empty files with valid syntax
   - Themes: validates required `name`, `updateUrl`, at least one mode, and OKLCH color fields
   - Gradients: checks type, stops, correct subdirectory placement
   - Bundles: verifies backup flags match their content arrays
2. **Build bundles** — `scripts/build-bundles.js` regenerates all bundles
3. **Build manifest** — `scripts/build-manifest.js` regenerates `manifest.json` with current theme versions
4. **Update badges** — `scripts/update-badges.js` recalculates preset counts in README badge URLs
5. **Build catalog** — `scripts/build-catalog.js` regenerates `docs/catalog.json` for the [GitHub Pages gallery](https://silentoplayz.github.io/theme-designer-pro-presets/)
6. **Auto-commit** — if any generated files changed, the bot commits and pushes them

#### What Happens on Pull Requests

Only the **Validate** step runs — bundles, manifest, and badges are not rebuilt. This gives contributors immediate feedback on whether their presets are correctly formatted before merge.

### Theme Submission Bot ([`theme-submission.yml`](.github/workflows/theme-submission.yml))

Triggered when a [Theme Submission](https://github.com/silentoplayz/theme-designer-pro-presets/issues/new?template=theme-submission.yml) issue is opened:

1. **Parse** — extracts the theme JSON from the issue body
2. **Validate** — checks required fields, OKLCH values, Canvas FX safety
3. **On success** — creates a branch, writes the theme file, opens a PR, and comments with a summary
4. **On failure** — comments with specific error messages so the submitter can fix and resubmit

This allows anyone to submit a theme without knowing git — see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

### Deploy to GitHub Pages ([`deploy-pages.yml`](.github/workflows/deploy-pages.yml))

Deploys the [`docs/`](docs/) preset gallery to [GitHub Pages](https://silentoplayz.github.io/theme-designer-pro-presets/).

- **After builds**: Triggers automatically when `Validate & Build Bundles` completes successfully (via `workflow_run`), ensuring the catalog is deployed with the latest rebuilt `docs/catalog.json`.
- **On direct changes**: Also triggers on pushes that modify `docs/` or `tools/` files, so documentation and gallery edits are deployed immediately without waiting for a bundle build.
- **Concurrency**: Uses a `pages` concurrency group to cancel stale deployments and ensure only one deployment runs at a time.

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
