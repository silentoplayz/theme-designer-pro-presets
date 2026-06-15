# Theme Designer Pro — Preset Gallery

A curated collection of themes, Canvas FX animations, CSS presets, and gradient packs for [Theme Designer Pro](https://openwebui.com/t/silentoplayz/theme_designer_pro) — the native theming tool for [Open WebUI](https://github.com/open-webui/open-webui).

> **Import any preset** directly into Theme Designer Pro using the built-in Import button or drag-and-drop.

---

## 📦 Repository Structure

```
theme-designer-pro-presets/
├── canvas-fx/               # Canvas FX animation scripts (.js)
│   ├── cosmic/              # Space, stars, nebulae
│   ├── nature/              # Weather, water, organic
│   ├── retro/               # Synthwave, CRT, pixel art
│   ├── tech/                # Matrix, circuits, data
│   ├── bio/                 # DNA, cells, mycelium
│   ├── physics/             # Gravity, magnetics, waves
│   ├── interactive/         # High mouse interactivity
│   ├── geometric/           # Shapes, patterns, tessellation
│   └── abstract/            # Artistic, fluid, freeform
├── themes/                  # Complete theme presets (full config)
│   ├── dark/                # Dark themes
│   ├── light/               # Light themes
│   └── special/             # Seasonal, novelty, experimental
├── css-presets/             # CSS-only styling presets
├── gradients/               # Gradient preset packs
├── bundles/                 # Combined import-ready JSON files
│   └── README.md
├── schemas/                 # JSON schemas for validation
│   ├── canvas-preset.schema.json
│   └── theme.schema.json
├── CONTRIBUTING.md          # How to contribute & curate
├── LICENSE
└── README.md                # This file
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

**Configurable scripts** (marked with ⚙️) include a `CONFIG` block at the top of the file with tunable properties — colors, speeds, particle counts, physics constants, and more. Edit the values directly in the Canvas FX editor and click Apply.

**Categories:**
| Folder | Description | Examples |
|---|---|---|
| `cosmic/` | Space and celestial | Starfield Warp, Nebula Clouds, Galaxy Forge |
| `nature/` | Weather and organic | Rain on Glass, Firefly Meadow, Snow Globe |
| `retro/` | Vintage and nostalgic | Synthwave Grid, CRT Monitor, VHS Static |
| `tech/` | Digital and cyber | Matrix Rain, Circuit Board, Blueprint Grid |
| `bio/` | Biological systems | DNA Helix, Cell Division, Coral Growth |
| `physics/` | Simulations | Gravity Wells, Magnetic Sand, Cymatics |
| `interactive/` | Mouse-driven | Neon Dreamscape, Electric Tendrils, Fluid Dye |
| `geometric/` | Shapes and patterns | Kaleidoscope, Voronoi Cells, Stained Glass |
| `abstract/` | Artistic and fluid | Lava Lamp, Ink Bloom, Plasma Field |

### 🎭 Themes (`themes/`)

Complete theme configurations including CSS overrides, Canvas FX selection, color tokens, and layout settings. Exported as `.json` files.

### 🖌️ CSS Presets (`css-presets/`)

CSS-only styling overrides — fonts, colors, spacing, component styles. No Canvas FX included.

### 🌈 Gradients (`gradients/`)

Gradient preset packs for backgrounds, panels, and UI elements.

### 📦 Bundles (`bundles/`)

Combined JSON files containing multiple presets for one-click bulk import.

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
