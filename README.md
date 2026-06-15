# Theme Designer Pro — Preset Gallery

A curated collection of themes, Canvas FX animations, CSS presets, and gradient packs for [Theme Designer Pro](https://openwebui.com/t/silentoplayz/theme_designer_pro) — the native theming tool for [Open WebUI](https://github.com/open-webui/open-webui).

> **Import any preset** directly into Theme Designer Pro using the built-in Import button or drag-and-drop.

---

## 📦 Repository Structure

```
theme-designer-pro-presets/
├── canvas-fx/               # Canvas FX animation scripts (.js)
├── themes/                  # Complete theme presets (.json)
├── css-presets/              # CSS-only styling presets
├── gradients/                # Gradient preset packs
│   ├── still/               #   Non-animated gradients
│   │   ├── linear/          #     Linear gradients
│   │   ├── radial/          #     Radial gradients
│   │   └── mesh/            #     Mesh gradients
│   └── animated/            #   Animated/transitioning gradients
│       ├── linear/          #     Animated linear gradients
│       ├── radial/          #     Animated radial gradients
│       └── mesh/            #     Animated mesh gradients
├── bundles/                  # Combined import-ready JSON files
├── schemas/                  # JSON schemas for validation
├── scripts/                  # Build tooling
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

---

## 🚀 Quick Start

### Import a Bundle (All-in-One)

1. Download a JSON bundle from [`bundles/`](bundles/)
2. Open **Theme Designer Pro** in Open WebUI
3. Click **Import** → select the `.json` file
4. All presets from the bundle are loaded instantly

### Import Individual Presets

- **Canvas FX**: Open the **Canvas FX** tab → Import → select any `.js` file from `canvas-fx/`
- **CSS**: Open the **CSS** tab → Import → select any `.json` from `css-presets/`
- **Themes**: Use the **Theme Import** button → select a `.json` from `themes/`

### Drag & Drop

Drag any `.js` or `.json` file directly onto the Theme Designer Pro interface.

---

## 📁 Preset Types

### 🎨 Canvas FX (`canvas-fx/`)

JavaScript animation scripts that run behind the Open WebUI interface via OffscreenCanvas in a Web Worker. Each script is a standalone `.js` file.

Scripts marked with ⚙️ include a `CONFIG` block at the top with tunable properties — colors, speeds, particle counts, physics constants, and more. Edit the values directly in the Canvas FX editor and click Apply.

### 🎭 Themes (`themes/`)

Complete theme configurations including CSS overrides, Canvas FX selection, color tokens, and layout settings. A single theme file can cover multiple or all theme modes (dark, light, etc.). Exported as `.json` files.

### 🖌️ CSS Presets (`css-presets/`)

CSS-only styling overrides — fonts, colors, spacing, component styles. No Canvas FX included.

### 🌈 Gradients (`gradients/`)

Gradient preset packs for backgrounds, panels, and UI elements. Organized by motion and type:

| Path | Description |
|---|---|
| `gradients/still/linear/` | Static linear gradients |
| `gradients/still/radial/` | Static radial gradients |
| `gradients/still/mesh/` | Static mesh gradients |
| `gradients/animated/linear/` | Animated linear gradients (shifting, pulsing) |
| `gradients/animated/radial/` | Animated radial gradients |
| `gradients/animated/mesh/` | Animated mesh gradients |

### 📦 Bundles (`bundles/`)

Combined JSON files containing multiple presets for one-click bulk import. See [`bundles/README.md`](bundles/README.md) for details.

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
