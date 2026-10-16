# Contributing to Theme Designer Pro Presets

Thank you for your interest in contributing! This repository is a **curated gallery** — every preset is reviewed for quality, performance, and visual impact before being accepted.

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## 📋 Submission Checklist

Before submitting a PR, ensure your preset meets these requirements:

### Canvas FX Scripts

Every script follows the house standard in [`canvas-fx/README.md`](canvas-fx/README.md). In short:

- [ ] **Runs in the worker:** no `document`, `window`, `alert` or `localStorage` in the code
- [ ] **Handles** `init`, `resize` (with `dpr`), `theme`, `motion`, `layout`, and the pointer or `context` messages it uses
- [ ] **No heartbeat:** the engine ignores anything a script posts back
- [ ] **Follows the theme:** its own colors as defaults, the theme's when `FOLLOW_THEME` is on, recolored in place, no `'lighter'` on light themes
- [ ] **Fits behind a chat:** a transparent canvas, a calm band (`CENTER_CALM`) centered on the chat column the engine reports in `column`, focal points in the margins between the column and the chat area's edges or in the bottom fifth, no flashes
- [ ] **Answers taps through `mousedown` only,** gently, since every click on the page reaches it
- [ ] **Cheap:** elapsed-time motion with `dt` clamped to 0.1 s, nothing allocated per frame, sprites instead of per-particle gradients
- [ ] **Respects reduced motion** and the screen's pixel ratio
- [ ] **WebGL:** premultiplied alpha, `webglcontextlost` handled, shader errors to `console.error`
- [ ] **A header** with `Title:` and a one-line `Description:`, and **at least 10 settings** as top-level constants with `(min-max)` ranges
- [ ] **4 to 14 KB,** never over 20 KB, with no external imports

### Themes

- [ ] Exported as valid JSON from Theme Designer Pro, with a `name`, `description`, `author` and `version`
- [ ] Includes an `updateUrl` field set to the raw GitHub URL for the file:
  ```
  https://raw.githubusercontent.com/silentoplayz/theme-designer-pro-presets/main/themes/your_theme.json
  ```
- [ ] **Every mode designed:** Dark, Light, OLED and Her each read well, none a copy of another's colors
- [ ] **Palette from hue, chroma and lightness;** step overrides only where the generator can't get there
- [ ] **Custom CSS follows the CSS rules below**
- [ ] **A version bump on every change,** or nobody who installed the theme is offered the update. Updating replaces all four modes, so say what changed in the description or the release notes
- [ ] Tested on both desktop and mobile viewports

### CSS Presets

These rules apply to theme custom CSS too. CI checks the first and warns on the others.

- [ ] **Style the rounded input pill, `#message-input-container`,** never `#chat-input-container`, the square box inside it
- [ ] **Recolor through the palette first.** Open WebUI's surfaces read `var(--color-gray-*)`, so most of a look comes from the palette, and CSS adds only what the palette can't. For accent colors, use `var(--tdp-accent)`, `var(--tdp-accent-2)` and `var(--tdp-accent-3)` instead of hex: every mode defines them, with the accents the theme sets in the Design Studio or the ones generated from its palette
- [ ] **Stable hooks only:** IDs such as `#sidebar`, `#message-input-container`, `#sidebar-chat-item`, classes such as `.chat-user`, `.chat-assistant`, `.markdown-prose`. No Tailwind utility classes as selectors, and none of the stale ones CI warns about
- [ ] **Keep Open WebUI's shapes:** the input is a pill, bubbles and cards are rounded; don't square them off or box text in
- [ ] **No blanket `input`, `textarea` or `*` rules,** which restyle every field in Settings and hide focus rings
- [ ] **`!important` only where a background is otherwise cleared** (Canvas FX and gradients clear most surfaces first)
- [ ] Works in light and dark, with readable contrast in both

### Gradient Presets

- [ ] Exported as valid JSON from Theme Designer Pro
- [ ] Includes a descriptive `name` field
- [ ] Has a valid `type` (`linear`, `radial`, or `mesh`)
- [ ] Placed in the correct subdirectory based on motion and type

---

## 📁 File Placement

```
canvas-fx/your_animation.js              # Canvas FX scripts
css-presets/your_preset.css               # CSS presets (raw CSS)
themes/your_theme.json                    # Theme presets
gradients/still/linear/your_gradient.json # Still linear gradient
gradients/animated/mesh/your_gradient.json # Animated mesh gradient
```

### Naming Convention

Use `lowercase_with_underscores` for all filenames:

```
starfield_warp.js
neon_dreamscape.css
midnight_ocean.json
```

### Where Files Go

| Preset type | Directory | Format |
|---|---|---|
| Canvas FX animation | `canvas-fx/` | `.js` |
| CSS styling preset | `css-presets/` | `.css` |
| Complete theme | `themes/` | `.json` |
| Still gradient | `gradients/still/{linear,mesh,radial}/` | `.json` |
| Animated gradient | `gradients/animated/{linear,mesh,radial}/` | `.json` |

---

## 🎨 Quality Standards

### Visual

- **First impression matters:** polished and intentional, never a tech demo
- **Quiet behind the chat:** people read over this for hours. The chat column stays calm; the motion lives at the edges
- **The theme's colors:** a script that follows the palette matches every theme it is paired with
- **Smooth motion:** elapsed-time movement, no jitter, organic easing

### Performance

- **Smooth on a mid-range laptop** (2020-era i5, integrated GPU), and nearly free while the page is hidden
- **Memory stable:** pools with hard caps, nothing allocated per frame
- **Efficient rendering:** sprites for glows, one reused `ImageData` for per-pixel work, a reduced render scale for soft shader effects

### Interactivity

- **Influence, not control:** the cursor nudges the scene and its effect fades when the cursor stops
- **Taps stay gentle:** every click on the page reaches the script, the Send button's included
- **Beautiful with no input at all:** most of its life is spent unattended

---

## 💬 Questions & Ideas First

Not sure if your idea fits, or stuck on something? Start in [Discussions](../../discussions) — [Q&A](../../discussions/categories/q-a) for help, [Ideas](../../discussions/categories/ideas) to float a preset concept before building it, and [Show and tell](../../discussions/categories/show-and-tell) for finished setups. Keep Issues for bug reports and the submission form below.

---

## 🤖 Automated Theme Submission (Recommended)

The easiest way to submit a theme — **no git required**:

1. Export your theme from Theme Designer Pro (Theme Library → select theme → **↓ Export**)
2. Open a [Theme Submission issue](../../issues/new?template=theme-submission.yml)
3. Paste your JSON, fill in the name and description
4. Submit — a bot automatically validates and opens a PR for you

The bot will comment on your issue with the result:
- **✅ Valid** — a PR is created and linked, ready for maintainer review, with a link that previews your theme in the [Studio](https://silentoplayz.github.io/theme-designer-pro-presets/studio/)
- **❌ Invalid** — specific errors are listed so you can fix and re-submit

---

## 🔄 Curation Process

1. **Submit** — via the automated [Theme Submission form](../../issues/new?template=theme-submission.yml) or a manual PR
2. **Maintainer review** — checked for quality, performance, API compliance, and visual polish
3. **Testing** — verified in Theme Designer Pro on the latest Open WebUI version
4. **Merge** — accepted presets are added and bundles are regenerated automatically

### What Gets Rejected

- Scripts that lag or stutter
- Animations that look unfinished or like a tutorial exercise
- Duplicate concepts without meaningful differentiation
- Presets that break Open WebUI's UI
- Files with external dependencies or network requests

---

## 🛠️ Before You Push

Run validation locally to catch errors before CI:

```bash
npm install   # first time only — installs validation dependencies
npm run validate
```

Or without npm:

```bash
node scripts/validate.js
```

> **Important**: Do **not** rebuild bundles, manifest, or badges locally — CI handles all generated files automatically on push to `main`. Committing generated files locally causes merge conflicts.

---

## 📝 Settings Block Template

The designer shows each top-level constant in the banner as a slider, switch or color picker, and a `(min-max)` range in its comment sets the slider's range. [`canvas-fx/nebula_webgl.js`](canvas-fx/nebula_webgl.js) is a complete example.

```javascript
/**
 * Title: Your Animation Name
 * Description: One line on what it draws and how it responds.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const INTENSITY    = 0.8;        // how strongly it shows (0-1)
const SPEED        = 1;          // overall speed (0-3)
const CENTER_CALM  = 0.7;        // how much it fades behind the chat column (0-1)
const FOLLOW_THEME = true;       // take the colors from the theme's palette
const COLOR_A      = '#7aa2ff';  // main color when not following the theme
/* ──────────────────────────────────────────── */
```
