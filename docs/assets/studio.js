/* Theme Designer Pro site: Studio.
   Builds a theme in the same shape the designer exports (buildThemeJson in
   the event function), so the file it downloads imports like any other. */
(function () {
  'use strict';

  const E = window.TDPEngine;
  const UI = window.TDPUI;
  const $ = (id) => document.getElementById(id);

  const MODES = ['dark', 'light', 'oled', 'her'];

  // The designer's DEFAULT_MODE_DATA (theme_designer_pro_event.py)
  const DEFAULT_MODE = {
    h: 250, c: 0, l: 20, overrides: {}, locks: {},
    paletteEnabled: true, customCSS: '', customCssEnabled: false,
    autoScope: true, canvasEnabled: false, canvasScript: '',
    manualOverrides: '', manualOverridesEnabled: false,
    gradientEnabled: false, gradientType: 'linear', gradientAngle: 135,
    gradientStops: [], gradientIntensity: 85, gradientAnimation: false,
    gradientRadialPosX: 50, gradientRadialPosY: 50, gradientRadialShape: 'ellipse', gradientRadialSize: 'farthest-corner',
    gradientMeshPoints: [], gradientMeshBgColor: '#0a0a12',
    gradientAnimationSpeed: 8, gradientShowAuth: true, themeShowAuth: true,
    customCssShowAuth: true, canvasShowAuth: true,
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const clamp = (v, lo, hi, d) => { v = Number(v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };

  function blankMode(key, h, c) {
    return Object.assign(clone(DEFAULT_MODE), { h: h, c: c, l: key === 'oled' ? 0 : 20 });
  }

  // ---- State ----
  // Each mode keeps a full designer mode object, plus two references the
  // page uses to show which gradient or script is picked and to share links.
  const start = window.TDPSite.get();
  let state = freshState(start.h, start.c);
  let catalog = null;
  let mountToken = 0;

  function freshState(h, c) {
    const modes = {};
    MODES.forEach((k) => { modes[k] = blankMode(k, h, c); });
    return { name: '', author: '', preset: '', linked: true, mode: 'dark', modes, refs: {} };
  }

  function cur() { return state.modes[state.mode]; }
  function ref(k) { return state.refs[k || state.mode] || (state.refs[k || state.mode] = {}); }

  // Changes to a linked theme go to every mode. OLED keeps its own
  // lightness, since its point is going darker than Dark.
  function targets() { return state.linked ? MODES : [state.mode]; }

  // ---- Preview ----

  const viewport = $('studio-viewport');
  const stage = UI.mockStage(viewport, $('studio-msg'), 'Open WebUI with your theme', { wide: true, fill: true });

  function previewOpts(key) {
    const m = state.modes[key];
    return {
      modeKey: key,
      vars: E.modeVars(m, key),
      customCSS: m.customCssEnabled ? m.customCSS || '' : '',
      canvasScript: m.canvasEnabled && m.canvasScript ? m.canvasScript : null,
      gradient: m.gradientEnabled ? E.gradientLayers(m) : null,
      transparent: false,
    };
  }

  function render() {
    const token = ++mountToken;
    // Let a burst of changes settle into one rebuild
    setTimeout(() => {
      if (token === mountToken) stage.show(previewOpts(state.mode));
    }, 30);
  }

  function recolor() {
    stage.pushVars(E.modeVars(cur(), state.mode));
  }

  // ---- Palette controls ----

  const h = $('h'), c = $('c'), l = $('l');

  function syncPalette() {
    const m = cur();
    h.value = m.h; c.value = m.c; l.value = m.l;
    $('h-out').textContent = Math.round(m.h) + '°';
    $('c-out').textContent = (m.c / 1000).toFixed(3);
    $('l-out').textContent = Math.round(m.l) + '%';
    const vars = E.themeVars(m);
    $('ramp').innerHTML = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '850', '900', '950']
      .map((s) => `<i style="background:${vars['--color-gray-' + s]}" title="--color-gray-${s}"></i>`).join('');
    document.documentElement.style.setProperty('--studio-h', m.h);
  }

  function setPalette(key, value) {
    targets().forEach((k) => {
      if (key === 'l' && k === 'oled' && state.mode !== 'oled') return;
      if (key === 'l' && state.mode === 'oled' && k !== 'oled') return;
      state.modes[k][key] = value;
    });
    syncPalette();
    recolor();
    // The page's own colors follow, as on the home page
    window.TDPSite.set({ h: cur().h, c: Math.min(cur().c, 80) }, false);
    queueSave();
  }

  h.addEventListener('input', () => setPalette('h', Number(h.value)));
  c.addEventListener('input', () => setPalette('c', Number(c.value)));
  l.addEventListener('input', () => setPalette('l', Number(l.value)));

  $('randomize').addEventListener('click', () => {
    const hue = Math.floor(Math.random() * 360);
    const chroma = 10 + Math.floor(Math.random() * 55);
    targets().forEach((k) => { state.modes[k].h = hue; state.modes[k].c = chroma; });
    syncPalette();
    recolor();
    window.TDPSite.set({ h: hue, c: chroma }, false);
    queueSave();
  });

  // ---- Modes ----

  $('mode-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b || b.dataset.mode === state.mode) return;
    state.mode = b.dataset.mode;
    // The Background buttons show the new mode's own choice
    bgTab = null;
    syncAll();
    render();
  });

  $('linked').addEventListener('change', (e) => {
    state.linked = e.target.checked;
    // Linking copies the current mode's palette and background to the rest
    if (state.linked) {
      const src = cur();
      MODES.forEach((k) => {
        if (k === state.mode) return;
        const m = state.modes[k];
        m.h = src.h; m.c = src.c;
        if (k !== 'oled' && state.mode !== 'oled') m.l = src.l;
        copyBackground(src, m);
        state.refs[k] = Object.assign({}, ref());
      });
    }
    queueSave();
  });

  // ---- Background ----

  const BG_FIELDS = ['gradientEnabled', 'gradientType', 'gradientAngle', 'gradientStops', 'gradientIntensity',
    'gradientAnimation', 'gradientAnimationSpeed', 'gradientRadialPosX', 'gradientRadialPosY',
    'gradientRadialShape', 'gradientRadialSize', 'gradientMeshPoints', 'gradientMeshBgColor',
    'canvasEnabled', 'canvasScript'];

  function copyBackground(from, to) {
    BG_FIELDS.forEach((f) => { to[f] = clone(from[f]); });
  }

  function bgKind(m) {
    if (m.canvasEnabled && m.canvasScript) return 'fx';
    if (m.gradientEnabled) return 'gradient';
    return 'none';
  }

  function applyGradient(g) {
    targets().forEach((k) => {
      const m = state.modes[k];
      Object.assign(m, {
        gradientEnabled: true,
        gradientType: g.type || 'linear',
        gradientAngle: g.angle != null ? g.angle : 135,
        gradientStops: clone(g.stops || []),
        gradientIntensity: g.intensity != null ? g.intensity : 85,
        gradientAnimation: !!g.animated,
        gradientAnimationSpeed: clamp(g.speed, 2, 30, 8),
        gradientRadialPosX: g.radialPosX != null ? g.radialPosX : 50,
        gradientRadialPosY: g.radialPosY != null ? g.radialPosY : 50,
        gradientRadialShape: g.radialShape || 'ellipse',
        gradientRadialSize: g.radialSize || 'farthest-corner',
        gradientMeshPoints: clone(g.meshPoints || []),
        gradientMeshBgColor: g.meshBgColor || '#0a0a12',
        canvasEnabled: false,
        canvasScript: '',
      });
      state.refs[k] = { gradient: g.file };
    });
  }

  async function applyFx(item) {
    const note = $('bg-note');
    note.textContent = 'Loading ' + UI.displayName(item) + '…';
    note.classList.remove('hidden');
    let script;
    try {
      script = await UI.fetchCached(item.importUrl, false);
    } catch (e) {
      note.textContent = 'That script didn\'t load. Check your connection and try again.';
      return;
    }
    targets().forEach((k) => {
      Object.assign(state.modes[k], { canvasEnabled: true, canvasScript: script, gradientEnabled: false });
      state.refs[k] = { fx: item.file };
    });
    syncBackground();
    render();
    queueSave();
  }

  function clearBackground() {
    targets().forEach((k) => {
      Object.assign(state.modes[k], { canvasEnabled: false, canvasScript: '', gradientEnabled: false });
      state.refs[k] = {};
    });
  }

  let bgTab = null;
  $('bg-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-bg]');
    if (!b) return;
    bgTab = b.dataset.bg;
    if (bgTab === 'none') {
      clearBackground();
      render();
      queueSave();
    }
    syncBackground();
  });

  $('grad-pick').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-file]');
    if (!b) return;
    const g = (catalog.gradients || []).find((x) => x.file === b.dataset.file);
    if (!g) return;
    applyGradient(g);
    syncBackground();
    render();
    queueSave();
  });

  $('gi').addEventListener('input', (e) => {
    targets().forEach((k) => { state.modes[k].gradientIntensity = Number(e.target.value); });
    $('gi-out').textContent = e.target.value + '%';
  });
  $('gi').addEventListener('change', () => { render(); queueSave(); });
  $('ga').addEventListener('change', (e) => {
    targets().forEach((k) => { state.modes[k].gradientAnimation = e.target.checked; });
    render();
    queueSave();
  });

  $('fx-pick').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-file]');
    if (!b || b.disabled) return;
    const item = (catalog.canvasFx || []).find((x) => x.file === b.dataset.file);
    if (item) applyFx(item);
  });

  let fxTimer = null;
  $('fx-search').addEventListener('input', () => {
    clearTimeout(fxTimer);
    fxTimer = setTimeout(renderFxList, 100);
  });

  function renderGradientPicker() {
    const picked = ref().gradient;
    $('grad-pick').innerHTML = (catalog.gradients || []).map((g) =>
      `<button type="button" data-file="${UI.esc(g.file)}" aria-pressed="${g.file === picked}" title="${UI.esc(g.name)}">
        <span class="grad" style="${UI.esc(UI.gradientStyle(g))}"></span><span class="grad-name">${UI.esc(g.name)}</span>
      </button>`
    ).join('');
  }

  function renderFxList() {
    const q = $('fx-search').value.trim().toLowerCase();
    const picked = ref().fx;
    const list = (catalog.canvasFx || [])
      .filter((x) => !q || (x.name + ' ' + x.file + ' ' + (x.description || '')).toLowerCase().includes(q))
      .sort((a, b) => UI.displayName(a).localeCompare(UI.displayName(b)));
    $('fx-pick').innerHTML = list.length ? list.map((x) => {
      const blocked = UI.fxBlocked(x);
      const tags = UI.fxTags(x).filter((t) => t !== 'Interactive');
      return `<button type="button" role="option" data-file="${UI.esc(x.file)}" aria-selected="${x.file === picked}" ${blocked ? 'disabled' : ''}>
        <span class="fx-dot" style="--h1:${UI.hashNum(x.name || x.file, 1) % 360}"></span>
        <span class="fx-row-name">${UI.esc(UI.displayName(x))}</span>
        <span class="fx-row-tag">${UI.esc(blocked || tags.join(' · '))}</span>
      </button>`;
    }).join('') : '<p class="studio-hint" style="padding:12px">No animation matches that search.</p>';
  }

  function syncBackground() {
    const m = cur();
    const kind = bgTab || bgKind(m);
    $('bg-seg').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.bg === kind ? 'true' : 'false'));
    $('bg-gradient').classList.toggle('hidden', kind !== 'gradient');
    $('bg-fx').classList.toggle('hidden', kind !== 'fx');
    $('gi').value = m.gradientIntensity;
    $('gi-out').textContent = Math.round(m.gradientIntensity) + '%';
    $('ga').checked = !!m.gradientAnimation;
    if (catalog) {
      renderGradientPicker();
      renderFxList();
    }
    const note = $('bg-note');
    const r = ref();
    const fromPreset = state.preset && bgKind(m) !== 'none' && !r.gradient && !r.fx;
    note.textContent = fromPreset ? 'This background comes from the preset you started from.' : '';
    note.classList.toggle('hidden', !fromPreset);
  }

  // ---- Details ----

  $('name').addEventListener('input', (e) => { state.name = e.target.value; syncTitle(); queueSave(); });
  $('author').addEventListener('input', (e) => { state.author = e.target.value; queueSave(); });

  function syncTitle() {
    $('studio-title').textContent = state.name.trim() || 'Untitled theme';
  }

  // ---- Presets ----

  $('preset').addEventListener('change', (e) => loadPreset(e.target.value));

  // A theme file in this repository that isn't in the catalog yet, such as
  // a submission on its pull request's commit
  const REPO_RAW = UI.RAW.replace(/main\/$/, '');
  function isRepoTheme(url) {
    return typeof url === 'string' && url.startsWith(REPO_RAW) && !url.includes('..') &&
      /^[\w-]+\/[\w./-]+\.json$/.test(url.slice(REPO_RAW.length));
  }

  async function loadPreset(file, overrides) {
    const note = $('preset-note');
    if (!file) {
      const keep = cur();
      state = freshState(keep.h, keep.c);
      note.classList.add('hidden');
      bgTab = null;
      syncAll();
      render();
      queueSave();
      return;
    }
    const submitted = isRepoTheme(file);
    const item = submitted ? { name: 'the theme', importUrl: file } : (catalog.themes || []).find((t) => t.file === file);
    if (!item) return;
    note.textContent = 'Loading ' + item.name + '…';
    note.classList.remove('hidden');
    let theme;
    try {
      theme = await UI.fetchCached(item.importUrl, true);
    } catch (e) {
      note.textContent = 'That theme didn\'t load. Check your connection and try again.';
      return;
    }
    const modes = {};
    MODES.forEach((k) => {
      modes[k] = Object.assign(clone(DEFAULT_MODE), theme[k] || theme.dark || {});
    });
    const same = MODES.every((k) => modes[k].h === modes.dark.h && modes[k].c === modes.dark.c);
    state = {
      name: theme.name ? theme.name + (submitted ? '' : ' (remix)') : '',
      author: state.author,
      preset: file,
      linked: same,
      mode: state.mode,
      modes,
      refs: {},
    };
    if (overrides) applyShared(overrides);
    // Old submission links still work once the theme is merged
    const merged = submitted && (catalog.themes || []).some((t) => t.file === file.split('/').pop());
    // The picker lists it, so the theme still shows as the starting point
    if (submitted && ![...$('preset').options].some((o) => o.value === file)) {
      $('preset').add(new Option((theme.name || 'Untitled theme') + (merged ? ' (as submitted)' : ' (not in the gallery yet)'), file));
    }
    const extras = [];
    if (MODES.some((k) => modes[k].customCssEnabled && modes[k].customCSS)) extras.push('custom CSS');
    if (MODES.some((k) => Object.keys(modes[k].overrides || {}).length || (modes[k].manualOverridesEnabled && modes[k].manualOverrides))) extras.push('color overrides');
    const lead = !submitted ? `Started from ${theme.name}.`
      : merged ? `Previewing ${theme.name || 'this theme'} as it was submitted.`
        : `Previewing ${theme.name || 'this theme'}, which isn't in the gallery yet.`;
    note.textContent = extras.length ? `${lead} Its ${extras.join(' and ')} come along in the download.` : lead;
    bgTab = null;
    syncAll();
    render();
    queueSave();
  }

  $('reset-all').addEventListener('click', () => {
    $('preset').value = '';
    window.TDPSite.reset();
    const p = window.TDPSite.get();
    state = freshState(p.h, p.c);
    bgTab = null;
    $('preset-note').classList.add('hidden');
    syncAll();
    render();
    queueSave();
  });

  // ---- Export ----

  function buildTheme() {
    // Empty link fields are left out: the designer fills them in on
    // import, and the repo's theme schema rejects them as invalid URIs
    const theme = {
      name: state.name.trim() || 'Untitled theme',
      description: 'Made in the Theme Designer Pro Studio.',
      version: '1.0.0',
    };
    if (state.author.trim()) theme.author = state.author.trim();
    MODES.forEach((k) => { theme[k] = Object.assign(clone(DEFAULT_MODE), state.modes[k]); });
    return theme;
  }

  function fileName() {
    const base = (state.name.trim() || 'untitled-theme').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return (base || 'theme') + '.json';
  }

  $('download').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(buildTheme(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    UI.showToast('Downloaded ' + fileName() + '. Drop it on the designer to import it.');
  });

  $('copy-json').addEventListener('click', (e) => {
    UI.copyText(JSON.stringify(buildTheme(), null, 2), e.currentTarget, 'Theme JSON copied. Paste it into the designer.');
  });

  $('install').addEventListener('click', () => UI.installTheme(buildTheme()));

  function renderInstallNote() {
    const note = $('install-note');
    const t = UI.installTarget();
    note.innerHTML = t
      ? `Installs to <b>${UI.esc(UI.hostOf(t))}</b>, ${t.scope === 'instance' ? 'the instance theme' : 'your own theme'}. <button type="button" class="linklike" data-install-setup>Change</button>`
      : 'The first time, you tell this site where your Open WebUI is. <button type="button" class="linklike" data-install-setup>Set it now</button>';
    note.querySelector('[data-install-setup]').addEventListener('click', () => UI.openInstallSetup());
  }
  document.addEventListener('tdp-install-target', renderInstallNote);
  renderInstallNote();

  // GitHub fills an issue form's fields from matching query parameters, and
  // answers 414 past its address limit. The JSON goes in compact; a theme
  // with a Canvas FX script is usually still too long, so then its JSON is
  // copied and a note on the page says to paste it.
  const SUBMIT_FORM = 'https://github.com/silentoplayz/theme-designer-pro-presets/issues/new';
  const MAX_FORM_URL = 7500;
  function openTab(url) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  $('submit').addEventListener('click', (e) => {
    const theme = buildTheme();
    const params = new URLSearchParams({ template: 'theme-submission.yml', title: 'Theme submission: ' + theme.name, name: theme.name });
    if (theme.author) params.set('author', theme.author);
    const base = SUBMIT_FORM + '?' + params.toString();
    const full = base + '&json=' + encodeURIComponent(JSON.stringify(theme));
    const note = $('submit-note');
    if (full.length <= MAX_FORM_URL) {
      note.classList.add('hidden');
      openTab(full);
      UI.showToast('Opened the submission form with your theme filled in.');
      return;
    }
    const json = JSON.stringify(theme, null, 2);
    UI.copyText(json, e.currentTarget, 'Theme JSON copied. Paste it into the form\'s Theme JSON field.');
    note.innerHTML = 'This theme is too long to fill in through a link' + (MODES.some((k) => state.modes[k].canvasEnabled) ? ', because of its Canvas FX script' : '') +
      ', so its JSON is on your clipboard. Paste it into the form\'s <b>Theme JSON</b> field. <button type="button" class="linklike" id="submit-copy-again">Copy it again</button>';
    note.classList.remove('hidden');
    $('submit-copy-again').addEventListener('click', (ev) => UI.copyText(json, ev.currentTarget, 'Theme JSON copied again.'));
    openTab(base);
  });

  $('share').addEventListener('click', (e) => {
    UI.copyText(location.href.split('#')[0] + '#' + encodeState(), e.currentTarget, 'Link to this design copied');
  });

  // ---- Links and memory ----
  // A design travels as palette numbers and the names of the presets it
  // uses, never as script text, so links stay short and only load scripts
  // from this repository.

  function sharedState() {
    const out = { n: state.name, a: state.author, p: state.preset, k: state.linked ? 1 : 0, m: {} };
    MODES.forEach((k) => {
      const m = state.modes[k];
      const r = state.refs[k] || {};
      const e = { h: m.h, c: m.c, l: m.l };
      if (r.gradient) Object.assign(e, { g: r.gradient, gi: m.gradientIntensity, ga: m.gradientAnimation ? 1 : 0 });
      else if (r.fx) e.f = r.fx;
      else if (state.preset && bgKind(m) !== 'none') e.keep = 1;
      out.m[k] = e;
    });
    return out;
  }

  function encodeState() {
    const json = JSON.stringify(sharedState());
    return 's=' + btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeState(str) {
    try {
      const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(b64))));
    } catch (e) {
      return null;
    }
  }

  // Palette numbers and gradient picks; scripts load afterwards
  function applyShared(s) {
    state.name = typeof s.n === 'string' ? s.n.slice(0, 80) : state.name;
    state.author = typeof s.a === 'string' ? s.a.slice(0, 80) : state.author;
    state.linked = s.k == null ? state.linked : !!s.k;
    const pending = [];
    MODES.forEach((k) => {
      const e = s.m && s.m[k];
      if (!e) return;
      const m = state.modes[k];
      m.h = clamp(e.h, 0, 360, m.h);
      m.c = clamp(e.c, 0, 150, m.c);
      m.l = clamp(e.l, 0, 100, m.l);
      if (e.keep) return;
      Object.assign(m, { canvasEnabled: false, canvasScript: '', gradientEnabled: false });
      state.refs[k] = {};
      if (e.g) {
        const g = (catalog.gradients || []).find((x) => x.file === e.g);
        if (g) {
          const was = state.linked;
          const mode = state.mode;
          state.linked = false;
          state.mode = k;
          applyGradient(g);
          m.gradientIntensity = clamp(e.gi, 0, 100, m.gradientIntensity);
          m.gradientAnimation = !!e.ga;
          state.linked = was;
          state.mode = mode;
        }
      } else if (e.f) {
        const item = (catalog.canvasFx || []).find((x) => x.file === e.f);
        if (item && !UI.fxBlocked(item)) pending.push([k, item]);
      }
    });
    return pending;
  }

  async function loadScripts(pending) {
    for (const [k, item] of pending) {
      try {
        const script = await UI.fetchCached(item.importUrl, false);
        Object.assign(state.modes[k], { canvasEnabled: true, canvasScript: script, gradientEnabled: false });
        state.refs[k] = { fx: item.file };
      } catch (e) {
        // Leave that mode without its script
      }
    }
  }

  const STORE = 'tdp-studio';
  let saveTimer = null;
  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE, JSON.stringify(sharedState())); } catch (e) {}
    }, 300);
  }

  // ---- Sync everything to the state ----

  function syncAll() {
    $('mode-seg').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === state.mode ? 'true' : 'false'));
    $('linked').checked = state.linked;
    $('name').value = state.name;
    $('author').value = state.author;
    $('preset').value = state.preset;
    syncTitle();
    syncPalette();
    syncBackground();
  }

  // ---- Start ----

  async function boot() {
    try {
      catalog = await UI.loadCatalog();
    } catch (e) {
      catalog = { themes: [], gradients: [], canvasFx: [] };
    }
    $('preset').insertAdjacentHTML('beforeend', (catalog.themes || [])
      .slice().sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => `<option value="${UI.esc(t.file)}">${UI.esc(t.name)}</option>`).join(''));

    // A shared link wins, then a gallery hand-off, then the last session
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    let shared = hash.get('s') ? decodeState(hash.get('s')) : null;
    if (!shared && !hash.toString()) {
      try { shared = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) {}
    }

    if (hash.get('preset')) {
      await loadPreset(hash.get('preset'));
    } else if (hash.get('theme')) {
      await loadPreset(hash.get('theme'));
    } else if (shared && shared.p) {
      await loadPreset(shared.p, null);
      await loadScripts(applyShared(shared));
    } else if (shared) {
      await loadScripts(applyShared(shared));
    }

    if (hash.get('gradient')) {
      const g = (catalog.gradients || []).find((x) => x.file === hash.get('gradient'));
      if (g) applyGradient(g);
    } else if (hash.get('fx')) {
      const item = (catalog.canvasFx || []).find((x) => x.file === hash.get('fx'));
      if (item && !UI.fxBlocked(item)) await applyFx(item);
    }
    if (hash.get('h')) {
      targets().forEach((k) => {
        state.modes[k].h = clamp(hash.get('h'), 0, 360, state.modes[k].h);
        if (hash.get('c')) state.modes[k].c = clamp(hash.get('c'), 0, 150, state.modes[k].c);
      });
    }
    if (location.hash) history.replaceState(null, '', location.pathname);

    syncAll();
    render();
    queueSave();
  }

  syncAll();
  boot();
})();
