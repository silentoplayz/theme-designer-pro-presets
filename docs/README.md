# Preset Gallery (GitHub Pages site)

The browsable **[Theme Designer Pro Preset Gallery](https://silentoplayz.github.io/theme-designer-pro-presets/)** — a dependency-free static site that lets you search, filter, and **live-preview** every theme, Canvas FX animation, CSS preset, and gradient in this repository before importing it.

This directory is published to GitHub Pages by the [`deploy-pages.yml`](../.github/workflows/deploy-pages.yml) workflow on every push that touches `docs/**`.

---

## 🌐 Running the gallery locally

The site is plain HTML/CSS/JS with **no build step**, but it **cannot be opened directly from the filesystem**. `app.js` does `fetch('catalog.json')`, and browsers block `fetch()` over the `file://` protocol — opening `index.html` with a double-click gives you a permanently blank "Loading presets…" screen. You must serve `docs/` over HTTP.

Pick whichever server you have. Run it **from inside this `docs/` directory**, then open the URL it prints.

**Python 3** (installed almost everywhere):

```bash
cd docs
python3 -m http.server 8000
# → http://localhost:8000
```

**Node.js:**

```bash
cd docs
npx serve .
# or: npx http-server .
```

**PHP:**

```bash
cd docs
php -S localhost:8000
```

> [!TIP]
> `catalog.json` is committed to the repo, so a fresh clone runs immediately — you do **not** need to build anything first.

> [!NOTE]
> **Live previews require an internet connection.** When you click **Preview** on a card, the gallery fetches that preset's raw file from `raw.githubusercontent.com` (which sends `Access-Control-Allow-Origin: *`, so it works cross-origin). The gallery listing itself works offline; individual previews will not.

### Hard-refresh after editing

`preview.js` and `style.css` are aggressively cached by the browser. If a change to those files doesn't show up, hard-refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`) or disable cache in DevTools.

---

## 🔄 Regenerating `catalog.json`

The gallery renders from `catalog.json`, a manifest of every preset built by [`scripts/build-catalog.js`](../scripts/build-catalog.js). **CI rebuilds it automatically** on every push to `main`, so you normally never touch it by hand.

If you want to preview presets you've just added locally *before* pushing:

```bash
# from the repo root
npm install          # first time only (installs the build deps)
npm run build:catalog
```

> [!WARNING]
> Do **not** commit a locally regenerated `catalog.json` (or bundles/manifest/badges). CI regenerates all of them on push, and committing your local copy causes merge conflicts on the next build. Rebuild it to test, then discard the change (`git checkout docs/catalog.json`) before committing.

---

## 📁 Files

| File | Purpose |
|---|---|
| `index.html` | Page structure — header, category tabs, toolbar, card grid, detail modal, and the live-preview overlay |
| `app.js` | Gallery logic — fetches `catalog.json`, renders cards, search/filter/sort, shareable URL hash state, detail modals |
| `preview.js` | The live-preview engine — renders themes/CSS on a mock Open WebUI chat, runs Canvas FX in a Web Worker, and composites gradients, all in a sandboxed iframe |
| `style.css` | All styling for the gallery and preview overlay |
| `catalog.json` | Generated manifest of every preset (see above) — the site's data source |
| `favicon.svg` | Site icon |
| `og-preview.png` | Open Graph / social share preview image |

---

## ✨ Live preview — how it works

The preview overlay reproduces how a preset looks **inside Open WebUI** without embedding the real app:

- **Themes / CSS** render on a mock chat whose layout and metrics are ported from the Open WebUI source (sidebar, message bubbles, code blocks, input bar). Sidebar chats are clickable, and dark/OLED/light/her mode pills let you compare modes. CSS previews are labelled *Approximate* — a preset targeting a selector the mock doesn't contain has nothing to paint.
- **Canvas FX** run in a real `OffscreenCanvas` **Web Worker** — the same execution model the designer uses — with mouse/touch input bridged in. There is intentionally **no main-thread fallback**, so unsupported browsers see a notice instead of gallery scripts running in page scope.
- **Gradients** are generated with the designer's exact `buildGradientCss` math (intensity, linear/radial/mesh, animation).
- Everything runs inside a sandboxed, opaque-origin `<iframe>`, and preset CSS is sanitized against `</style>` breakout.

See [`../CONTRIBUTING.md`](../CONTRIBUTING.md) for how to submit presets that show up here.
