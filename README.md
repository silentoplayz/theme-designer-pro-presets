# Theme Designer Pro — Preset Gallery

A curated collection of themes, Canvas FX animations, CSS presets, and gradient packs for [Theme Designer Pro](https://openwebui.com/t/silentoplayz/theme_designer_pro) — the native theming tool for [Open WebUI](https://github.com/open-webui/open-webui).

> **Import any preset** directly into Theme Designer Pro using the built-in Import button, URL import, or drag-and-drop.

---

## 📦 Repository Structure

```
theme-designer-pro-presets/
├── canvas-fx/               # Canvas FX animation scripts (.js)
├── css-presets/              # CSS-only styling presets (.css)
├── themes/                  # Complete theme presets (.json)
├── gradients/               # Gradient preset packs (.json)
│   ├── still/               #   Non-animated gradients
│   │   ├── linear/
│   │   ├── radial/
│   │   └── mesh/
│   └── animated/            #   Animated/transitioning gradients
│       ├── linear/
│       ├── radial/
│       └── mesh/
├── bundles/                 # Combined import-ready JSON files
├── schemas/                 # JSON schemas for validation
├── scripts/                 # Build and extraction tooling
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

---

## 🚀 Quick Start

### Import Everything at Once

1. Open **Theme Designer Pro** in Open WebUI
2. Go to any Import modal → paste this URL:
   ```
   https://github.com/silentoplayz/theme-designer-pro-presets/blob/main/bundles/everything.json
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

Complete theme configurations including OKLCH color tokens, CSS overrides, Canvas FX selection, and per-mode settings (dark, light, OLED, her). Exported as `.json` files.

### 🖌️ CSS Presets ([`css-presets/`](css-presets/))

CSS-only styling overrides — fonts, colors, spacing, component styles, and visual effects. Stored as raw `.css` files.

### 🌈 Gradients ([`gradients/`](gradients/))

Gradient presets for backgrounds, panels, and UI elements. Organized by motion (`still`/`animated`) and type (`linear`/`radial`/`mesh`).

### 📦 Bundles ([`bundles/`](bundles/))

Combined JSON files for one-click bulk import. See [`bundles/README.md`](bundles/README.md).

### 📐 Schemas ([`schemas/`](schemas/))

JSON Schema definitions documenting the data formats for themes, Canvas FX, CSS, and gradient presets.

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

## 📜 License

[MIT](LICENSE) — free to use, modify, and redistribute.

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on submitting presets, quality standards, and the curation process.
