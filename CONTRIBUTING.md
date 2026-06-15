# Contributing to Theme Designer Pro Presets

Thank you for your interest in contributing! This repository is a **curated gallery** — every preset is reviewed for quality, performance, and visual impact before being accepted.

---

## 📋 Submission Checklist

Before submitting a PR, ensure your preset meets these requirements:

### Canvas FX Scripts

- [ ] **Web Worker compatible** — no `document`, `window`, `alert`, or `localStorage` access
- [ ] **Handles all message types** — `init`, `resize`, `mousemove`
- [ ] **Includes heartbeat** — `setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);`
- [ ] **Uses `requestAnimationFrame`** for the render loop
- [ ] **Has a JSDoc header** with `Title` and `Description`
- [ ] **Has a CONFIG block** (strongly recommended) with:
  - Box-decorated borders for visibility
  - Inline comments with valid ranges for each property
  - At least 10 tunable properties
  - Descriptive section grouping
- [ ] **Performs well** — no visible lag on mid-range hardware
  - Avoid allocations in the render loop (no `new Array()`, no object literals in hot paths)
  - Precompute values at init, not per-frame
  - Use typed arrays (`Float32Array`) for large datasets
- [ ] **Mouse interaction** is responsive and satisfying
- [ ] **File is self-contained** — no external imports or dependencies

### Themes

- [ ] Exported as valid JSON from Theme Designer Pro
- [ ] Includes a descriptive name
- [ ] Tested on both desktop and mobile viewports
- [ ] No hardcoded pixel values that break on different screen sizes

### CSS Presets

- [ ] Valid CSS
- [ ] Uses CSS custom properties where appropriate for easy customization
- [ ] Doesn't break core Open WebUI layout or functionality

---

## 📁 File Organization

### Canvas FX Naming Convention

```
lowercase_with_underscores.js
```

Examples: `starfield_warp.js`, `neon_dreamscape.js`, `fluid_dye.js`

### Category Placement

Place files in the most fitting category folder:

| If the animation is about... | Put it in... |
|---|---|
| Stars, galaxies, space | `canvas-fx/cosmic/` |
| Weather, water, plants, animals | `canvas-fx/nature/` |
| 80s/90s nostalgia, CRT, pixel art | `canvas-fx/retro/` |
| Code, circuits, data, HUDs | `canvas-fx/tech/` |
| Cells, DNA, organisms | `canvas-fx/bio/` |
| Gravity, waves, magnetics | `canvas-fx/physics/` |
| Heavy mouse interaction focus | `canvas-fx/interactive/` |
| Geometric shapes, tessellation | `canvas-fx/geometric/` |
| Artistic, abstract, fluid | `canvas-fx/abstract/` |

If a script fits multiple categories, choose the **primary** one.

---

## 🎨 Quality Standards

### Visual

- **First impression matters** — the animation should look polished and intentional, not like a tech demo
- **Subtle is often better** — these run behind a chat UI, so overwhelming animations are distracting
- **Color palette should be harmonious** — avoid clashing colors; prefer curated palettes
- **Smooth motion** — no jitter, no stuttering, organic easing

### Performance

- **Target 60fps** on a mid-range laptop (2020-era i5, integrated GPU)
- **Memory stable** — no growing arrays, no leaked particles, no unbounded buffers
- **Efficient rendering** — use `ImageData` for per-pixel work instead of thousands of `fillRect` calls
- **Lazy init** — precompute noise tables, color LUTs, etc. at init time

### Interactivity

- **Mouse should feel responsive** — sub-frame latency, smooth tracking
- **Interaction should be meaningful** — not just "particles follow mouse"
- **Provide visual feedback** — the user should immediately see that their input did something

---

## 🔄 Curation Process

1. **Submit a PR** with your preset(s) in the correct category folder
2. **Maintainer review** — checked for quality, performance, API compliance, and visual polish
3. **Testing** — verified in Theme Designer Pro on the latest Open WebUI version
4. **Merge** — accepted presets are added and the relevant bundle JSON is regenerated

### What Gets Rejected

- Scripts that lag or stutter
- Animations that look unfinished or like a tutorial exercise
- Duplicate concepts without meaningful differentiation
- Presets that break Open WebUI's UI
- Files with external dependencies or network requests

---

## 🛠️ Regenerating Bundles

After adding new presets, regenerate the combined bundle files:

```bash
# From the repository root
node scripts/build-bundles.js
```

This scans all category folders and produces the combined JSON files in `bundles/`.

---

## 📝 CONFIG Block Template

Use this template for new Canvas FX scripts:

```javascript
/**
 * Title: Your Animation Name
 * Description: A clear, compelling description of what this animation does
 *   and how the mouse interacts with it. Wrap at ~80 chars.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Section Name --
  propertyName: defaultValue,             // Description and valid range (min-max)
};
// ═══════════════════════════════════════════════════════════
```
