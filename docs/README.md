# Theme Designer Pro website

The **[Theme Designer Pro website](https://silentoplayz.github.io/theme-designer-pro-presets/)**: a home page with a live demo and install steps, the **[Studio](https://silentoplayz.github.io/theme-designer-pro-presets/studio/)**, where you design a theme in the browser and download it for the designer, and the **[preset gallery](https://silentoplayz.github.io/theme-designer-pro-presets/gallery/)**, where you can search, filter and **live-preview** every theme, Canvas FX animation, CSS preset and gradient in this repository before importing it. It's plain HTML, CSS and JavaScript, with no build step and no dependencies.

The [`deploy-pages.yml`](../.github/workflows/deploy-pages.yml) workflow publishes this directory to GitHub Pages on every push that touches `docs/**`.

---

## 🌐 Running the site locally

`fetch()` doesn't work over `file://`, so opening `index.html` by double-clicking it leaves the pages empty. Serve this `docs/` directory over HTTP instead, with whichever server you have, and open the URL it prints:

```bash
cd docs
python3 -m http.server 8000
# → http://localhost:8000
```

`npx serve .` and `php -S localhost:8000` work too.

> [!TIP]
> `catalog.json` is committed to the repo, so a fresh clone runs right away. You don't need to build anything first.

> [!NOTE]
> **Previews need an internet connection.** Canvas FX scripts, themes and gradients load from `raw.githubusercontent.com` when you preview them. On `localhost`, the Open WebUI logo inside the mock chat shows as a broken image: the browser won't let the sandboxed preview frame load anything from your own machine. It shows on the published site.

### Hard-refresh after editing

Browsers cache the scripts and the stylesheet hard. If a change doesn't show, hard-refresh with `Ctrl+Shift+R` (`Cmd+Shift+R` on a Mac).

---

## 🔄 Regenerating `catalog.json`

Both pages draw from `catalog.json`, a list of every preset that [`scripts/build-catalog.js`](../scripts/build-catalog.js) builds. **CI rebuilds it** on every push to `main` that touches presets or scripts, so you don't normally edit it by hand.

To preview presets you just added, before you push:

```bash
# from the repo root
npm install          # first time only
npm run build:catalog
```

> [!WARNING]
> Don't commit a catalog you regenerated locally. CI regenerates it (and the bundles, manifest and badges) on push, and a local copy causes merge conflicts on the next build. Rebuild to test, then discard it with `git checkout docs/catalog.json` before you commit.

---

## 📁 Files

| File | Purpose |
|---|---|
| `index.html` | The home page: live demo, features, install steps. Also forwards old gallery links (`/#canvasFx?q=…`) to the gallery. |
| `studio/index.html` | The Studio: a palette for each mode, a gradient or Canvas FX background, a live preview, and a theme file to download or copy |
| `gallery/index.html` | The preset gallery: type tabs, search, sort, filters, the detail drawer and the full-screen preview |
| `assets/site.css` | All styling for both pages |
| `assets/palette.js` | The site's own palette. Every color in `site.css` comes from one hue and one chroma, which the home page's sliders change and the browser remembers |
| `assets/preview.js` | The preview engine: the designer's palette and gradient math, the mock Open WebUI chat, and the full-screen preview |
| `assets/ui.js` | Pieces both pages share: theme thumbnails, gradient swatches, Canvas FX thumbnails that play on hover, copying, the header |
| `assets/home.js` | The home page's demo, palette ramp and preset strips |
| `assets/studio.js` | The Studio's state, controls, share links and export. Its theme file has the same shape as the designer's own export, so it imports like any other |
| `assets/gallery.js` | The gallery's filtering, cards, drawer and shareable links |
| `catalog.json` | Generated list of every preset (see above) |
| `og-preview.png` | The image shown when someone shares a link to the site |

### Studio links

The Studio opens with whatever a link hands it, so other pages can send a preset straight there:

```
studio/#preset=synthwave_1984.json     ← start from a theme
studio/#gradient=electric_aurora.json  ← use a gradient
studio/#fx=firefly_meadow.js           ← use a Canvas FX script
studio/#h=200&c=40                     ← a hue and chroma, as the home page demo sends
studio/#s=…                            ← a whole design, from its share button
```

A shared design carries palette numbers and preset file names, never script text, so a link can only load scripts from this repository. Without a link, the Studio reopens the last design from this browser.

### Gallery links

The gallery keeps its state in the address, so any view can be shared:

```
gallery/#canvasFx?q=aurora&sort=newest
gallery/#themes?filter=canvas-fx
gallery/#gradients?p=electric_aurora.json     ← opens that preset's details
```

---

## ✨ Live preview: how it works

The previews show how a preset looks **inside Open WebUI** without running the real app:

- **Themes and CSS presets** render on a mock chat whose layout and sizes are copied from the Open WebUI source: sidebar, message bubbles, code blocks and the input bar. Sidebar chats are clickable, and mode pills switch between Dark, OLED, Light and Her. A preset that styles something the mock doesn't have has nothing to paint, so previews are labelled *Approximate*.
- **Canvas FX** run in a real Web Worker on an `OffscreenCanvas`, the same way the designer runs them, with mouse and touch input passed in. There's deliberately **no fallback that runs them on the page itself**, so browsers without `OffscreenCanvas` see a notice instead. In the gallery, a script plays when you hover its card (or tap its play button), one at a time.
- **Gradients** use the designer's own `buildGradientCss` math: intensity, linear, radial, mesh and animation.
- Every preview runs in a sandboxed `<iframe>` with no origin of its own, and preset CSS can't break out of its `<style>` tag.

The home page's demo uses the same mock. Its sliders send the new palette into the running mock instead of rebuilding it, and it stops its animation while it's scrolled out of view.

See [`../CONTRIBUTING.md`](../CONTRIBUTING.md) to submit presets that show up here.
