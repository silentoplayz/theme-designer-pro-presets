/* Theme Designer Pro site: home page. */
(function () {
  'use strict';

  const E = window.TDPEngine;
  const UI = window.TDPUI;
  const $ = (id) => document.getElementById(id);

  // ---- Live demo ----

  const BACKGROUNDS = [
    { id: 'none', label: 'None' },
    { id: 'fireflies', label: 'Fireflies', fx: 'firefly_meadow.js' },
    { id: 'ocean', label: 'Deep ocean', fx: 'deep_ocean.js' },
    { id: 'chrome', label: 'Liquid chrome', fx: 'liquid_chrome_webgl.js', webgl: true },
    { id: 'gradient', label: 'Mesh gradient', gradient: 'electric_aurora.json' },
  ].filter((b) => !b.webgl || UI.hasWebGL);

  const palette = window.TDPSite.get();
  const state = {
    h: palette.h,
    c: palette.c,
    mode: 'dark',
    bg: UI.reducedMotion.matches ? 'none' : 'fireflies',
  };

  let catalog = null;
  let frame = null;
  let mountToken = 0;
  let onScreen = true;
  const viewport = $('demo-viewport');
  const msg = $('demo-msg');
  const sourceCache = new Map();

  function mode() {
    return { h: state.h, c: state.c, l: 20 };
  }

  function findItem(list, file) {
    return (catalog && catalog[list] || []).find((x) => x.file === file);
  }

  function fetchSource(url, json) {
    const key = url + (json ? '#json' : '');
    if (!sourceCache.has(key)) {
      sourceCache.set(key, fetch(url).then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return json ? r.json() : r.text();
      }).catch((e) => { sourceCache.delete(key); throw e; }));
    }
    return sourceCache.get(key);
  }

  // The mock is laid out at a desktop size and scaled to fit, so it reads
  // like a screenshot of Open WebUI instead of a squeezed copy of it.
  function fit() {
    const w = viewport.clientWidth;
    const small = w < 640;
    const vw = small ? 720 : 1280;
    const vh = small ? 900 : 760;
    viewport.style.setProperty('--vw', vw);
    viewport.style.setProperty('--vh', vh);
    viewport.style.setProperty('--s', String(w / vw));
  }
  new ResizeObserver(fit).observe(viewport);
  fit();

  async function mount() {
    const token = ++mountToken;
    const bg = BACKGROUNDS.find((b) => b.id === state.bg) || BACKGROUNDS[0];
    let canvasScript = null;
    let gradient = null;
    try {
      if (bg.fx) {
        const item = findItem('canvasFx', bg.fx);
        if (item) canvasScript = await fetchSource(item.importUrl, false);
      } else if (bg.gradient) {
        const item = findItem('gradients', bg.gradient);
        if (item) gradient = E.gradientLayers(await fetchSource(item.importUrl, true));
      }
    } catch (e) {
      // Offline or rate-limited: show the theme without the background
    }
    if (token !== mountToken) return;
    const srcdoc = E.buildMockSrcdoc({
      modeKey: state.mode,
      vars: E.modeVars(mode(), state.mode),
      customCSS: '',
      canvasScript,
      gradient,
      transparent: false,
    });
    // The new frame loads on top of the old one, which goes once it's drawn,
    // so switching modes or backgrounds never flashes an empty box
    const old = frame;
    const fresh = E.mountMockFrame(viewport, srcdoc);
    fresh.setAttribute('title', 'Open WebUI with the theme you are building');
    frame = fresh;
    let timer = null;
    const done = () => {
      window.removeEventListener('message', onReady);
      clearTimeout(timer);
      if (old && old !== frame) old.remove();
      msg.hidden = true;
    };
    const onReady = (e) => {
      if (e.source === fresh.contentWindow && e.data && e.data.kind === 'ready') done();
    };
    window.addEventListener('message', onReady);
    timer = setTimeout(done, 5000);
  }

  function unmount() {
    if (frame) frame.remove();
    frame = null;
    msg.hidden = false;
  }

  function pushVars() {
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage({ __tdpPreview: true, kind: 'vars', vars: E.modeVars(mode(), state.mode) }, '*');
    } catch (e) {}
  }

  // Stop the animation while the demo is off screen
  new IntersectionObserver((entries) => {
    const visible = entries[0].isIntersecting;
    if (visible === onScreen) return;
    onScreen = visible;
    const bg = BACKGROUNDS.find((b) => b.id === state.bg);
    if (!bg || !bg.fx) return;
    if (visible) mount();
    else { mountToken++; unmount(); }
  }, { threshold: 0 }).observe(viewport);

  // ---- Controls ----

  const hue = $('hue');
  const chroma = $('chroma');
  const hueOut = $('hue-out');
  const chromaOut = $('chroma-out');

  function syncControls() {
    hue.value = state.h;
    chroma.value = state.c;
    hueOut.textContent = Math.round(state.h) + '°';
    chromaOut.textContent = (state.c / 1000).toFixed(3);
  }

  function onPalette(persist) {
    syncControls();
    window.TDPSite.set({ h: state.h, c: state.c }, persist);
    pushVars();
  }

  hue.addEventListener('input', () => { state.h = Number(hue.value); onPalette(false); });
  chroma.addEventListener('input', () => { state.c = Number(chroma.value); onPalette(false); });
  hue.addEventListener('change', () => onPalette(true));
  chroma.addEventListener('change', () => onPalette(true));

  $('reset-hue').addEventListener('click', () => {
    window.TDPSite.reset();
    const p = window.TDPSite.get();
    state.h = p.h;
    state.c = p.c;
    syncControls();
    pushVars();
  });

  $('mode-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b || b.dataset.mode === state.mode) return;
    state.mode = b.dataset.mode;
    $('mode-seg').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    mount();
  });

  const chips = $('bg-chips');
  chips.innerHTML = BACKGROUNDS.map((b) =>
    `<button type="button" class="chip" data-bg="${b.id}" aria-pressed="${b.id === state.bg}">${UI.esc(b.label)}</button>`
  ).join('');
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-bg]');
    if (!b || b.dataset.bg === state.bg) return;
    state.bg = b.dataset.bg;
    chips.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    mount();
  });

  // Another tab or the reset button changed the site palette
  document.addEventListener('tdp-palette', (e) => {
    renderRamp();
    renderLayers();
    if (e.detail.h !== state.h || e.detail.c !== state.c) {
      state.h = e.detail.h;
      state.c = e.detail.c;
      syncControls();
      pushVars();
    }
  });

  syncControls();

  // ---- Palette ramp ----

  const STEP_NAMES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '850', '900', '950'];
  const ramp = $('ramp');
  ramp.innerHTML = STEP_NAMES.map((s) =>
    `<div class="ramp-step"><div class="ramp-swatch" data-step="${s}"></div><div class="ramp-name">${s}</div></div>`
  ).join('');

  function renderRamp() {
    const vars = E.themeVars(mode());
    ramp.querySelectorAll('.ramp-swatch').forEach((el) => {
      const v = vars['--color-gray-' + el.dataset.step];
      el.style.background = v;
      // Each bar stands as tall as its shade is light
      const l = parseFloat(String(v).replace('oklch(', ''));
      if (isFinite(l)) el.style.height = Math.round(28 + l * 72) + '%';
      el.title = `--color-gray-${el.dataset.step}: ${v}`;
    });
    $('ramp-values').innerHTML = `Hue <b>${Math.round(state.h)}°</b> · Chroma <b>${(state.c / 1000).toFixed(3)}</b> · Lightness <b>20%</b>`;
  }

  // ---- Instance and personal ----

  function renderLayers() {
    const inst = mode();
    const personal = { h: (state.h + 80) % 360, c: 45, l: 20 };
    $('layers').innerHTML = `
      <div class="layer">
        <div class="layer-label"><b>Instance theme</b><span class="tag">everyone</span></div>
        <div class="thumb" style="border-radius:14px;border:1px solid var(--line)">${UI.miniHTML(inst, 'dark')}</div>
      </div>
      <div class="layer">
        <div class="layer-label"><b>Personal theme</b><span class="tag">just you</span></div>
        <div class="thumb" style="border-radius:14px;border:1px solid var(--line)">${UI.miniHTML(personal, 'dark')}</div>
      </div>`;
  }

  // ---- Chat-to-theme ----

  (function renderMoss() {
    const vars = E.themeVars({ h: 142, c: 45, l: 20 });
    $('moss').innerHTML = ['950', '900', '800', '600', '400', '200']
      .map((s) => `<i style="background:${vars['--color-gray-' + s]}"></i>`).join('');
  })();

  renderRamp();
  renderLayers();

  // ---- Catalog-driven pieces ----

  const FX_PICKS = ['deep_ocean.js', 'firefly_meadow.js', 'constellation_map.js', 'ink_bloom.js', 'lava_lamp.js', 'retro_sun.js'];
  const THEME_PICKS = ['Synthwave 1984', 'Bioluminescence', 'Project Singularity', 'Retro Terminal (CRT)'];

  function galleryLink(category, file) {
    return `gallery/#${category}?p=${encodeURIComponent(file)}`;
  }

  function renderCounts() {
    const n = (k) => (catalog[k] || []).length;
    const counts = {
      themes: n('themes'),
      canvasFx: n('canvasFx'),
      cssPresets: n('cssPresets'),
      gradients: n('gradients'),
    };
    counts.total = counts.themes + counts.canvasFx + counts.cssPresets + counts.gradients;
    document.querySelectorAll('[data-count]').forEach((el) => {
      const v = counts[el.dataset.count];
      if (v != null) el.textContent = v;
    });
  }

  function renderFx() {
    const all = catalog.canvasFx || [];
    let picks = FX_PICKS.map((f) => all.find((x) => x.file === f)).filter(Boolean);
    if (picks.length < 6) picks = picks.concat(all.filter((x) => !picks.includes(x)).slice(0, 6 - picks.length));
    const grid = $('fx-grid');
    grid.innerHTML = picks.map((fx) =>
      `<div class="fx-tile">${UI.fxThumbHTML(fx)}<a class="fx-name" style="pointer-events:auto" href="${galleryLink('canvasFx', fx.file)}">${UI.esc(UI.displayName(fx))}</a></div>`
    ).join('');
    UI.wireFxThumbs(grid);
  }

  function renderGradients() {
    $('grad-strip').innerHTML = (catalog.gradients || []).slice(0, 12).map((g) =>
      `<a href="${galleryLink('gradients', g.file)}"><span class="grad" style="${UI.esc(UI.gradientStyle(g))}"></span>${UI.esc(g.name)}</a>`
    ).join('');
  }

  function renderThemePicks() {
    const all = catalog.themes || [];
    let picks = THEME_PICKS.map((n) => all.find((t) => t.name === n)).filter(Boolean);
    if (picks.length < 4) picks = picks.concat(all.filter((x) => !picks.includes(x)).slice(0, 4 - picks.length));
    $('theme-picks').innerHTML = picks.map((t) => {
      const modes = UI.presentModes(t.modes);
      const first = modes[0] || 'dark';
      const feats = UI.themeFeatures(t.modes).slice(0, 3);
      return `<a class="card" href="${galleryLink('themes', t.file)}">
        <div class="thumb">${UI.miniHTML(t.modes[first], first)}</div>
        <div class="card-body">
          <div class="card-title">${UI.esc(t.name)}</div>
          ${t.description ? `<div class="card-desc">${UI.esc(t.description)}</div>` : ''}
          <div class="card-meta">${feats.map((f) => `<span class="badge">${UI.esc(f)}</span>`).join('')}</div>
        </div>
      </a>`;
    }).join('');
  }

  UI.loadCatalog()
    .then((c) => {
      catalog = c;
      renderCounts();
      renderFx();
      renderGradients();
      renderThemePicks();
      mount();
    })
    .catch(() => {
      catalog = {};
      mount();
    });
})();
