/* Theme Designer Pro site: preset gallery.
   URL state lives in the hash, in the same format as v1 so old links work:
   #category?q=search&filter=value&sort=value&p=file */
(function () {
  'use strict';

  const UI = window.TDPUI;
  const $ = (id) => document.getElementById(id);
  const ICONS = UI.ICONS;

  const CATEGORIES = ['themes', 'canvasFx', 'gradients', 'cssPresets', 'bundles'];
  const PREVIEWABLE = ['themes', 'canvasFx', 'cssPresets', 'gradients'];
  const KIND = {
    themes: 'Theme',
    canvasFx: 'Canvas FX',
    gradients: 'Gradient',
    cssPresets: 'CSS preset',
    bundles: 'Bundle',
  };
  const NOUNS = {
    themes: ['theme', 'themes'],
    canvasFx: ['animation', 'animations'],
    gradients: ['gradient', 'gradients'],
    cssPresets: ['CSS preset', 'CSS presets'],
    bundles: ['bundle', 'bundles'],
  };
  // Which presets the Studio can start from, and how it's told
  const STUDIO_PARAM = { themes: 'preset', gradients: 'gradient', canvasFx: 'fx' };
  const FILTERS = {
    'canvas-fx': 'hasFX',
    gradient: 'hasGradient',
    'custom-css': 'hasCSS',
    overrides: 'hasOverrides',
  };

  const state = { category: 'themes', q: '', filter: 'all', sort: 'name-asc', p: null };
  let catalog = null;
  let visible = [];

  const grid = $('grid');
  const search = $('search');
  const sort = $('sort');
  const filters = $('filters');
  const drawer = $('drawer');
  const drawerContent = $('drawer-content');

  // ---- URL state ----

  function readHash() {
    const raw = location.hash.replace(/^#/, '');
    const [cat, qs] = raw.split('?');
    state.category = CATEGORIES.includes(cat) ? cat : 'themes';
    const params = new URLSearchParams(qs || '');
    state.q = params.get('q') || '';
    state.filter = FILTERS[params.get('filter')] ? params.get('filter') : 'all';
    state.sort = ['name-asc', 'name-desc', 'newest', 'oldest'].includes(params.get('sort')) ? params.get('sort') : 'name-asc';
    state.p = params.get('p');
  }

  function hashFor(p) {
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.filter !== 'all') params.set('filter', state.filter);
    if (state.sort !== 'name-asc') params.set('sort', state.sort);
    if (p) params.set('p', p);
    const qs = params.toString();
    return '#' + state.category + (qs ? '?' + qs : '');
  }

  function writeHash() {
    history.replaceState(null, '', hashFor(state.p));
  }

  // ---- Filtering ----

  function items() {
    let list = (catalog && catalog[state.category]) || [];
    if (state.q) {
      const q = state.q.toLowerCase();
      list = list.filter((it) =>
        [it.name, it.file, it.description, it.author].some((s) => (s || '').toLowerCase().includes(q))
      );
    }
    if (state.category === 'themes' && state.filter !== 'all') {
      const key = FILTERS[state.filter];
      list = list.filter((t) => Object.values(t.modes || {}).some((m) => m[key]));
    }
    list = [...list];
    const name = (x) => UI.displayName(x).toLowerCase();
    if (state.sort === 'name-asc') list.sort((a, b) => name(a).localeCompare(name(b)));
    else if (state.sort === 'name-desc') list.sort((a, b) => name(b).localeCompare(name(a)));
    else if (state.sort === 'newest') list.sort((a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || '') || name(a).localeCompare(name(b)));
    else list.sort((a, b) => (a.dateAdded || '').localeCompare(b.dateAdded || '') || name(a).localeCompare(name(b)));
    return list;
  }

  // ---- Visuals ----

  function bundleCount(b) {
    const c = catalog;
    switch (b.file) {
      case 'canvas-fx-all.json': return c.canvasFx.length;
      case 'css-presets-all.json': return c.cssPresets.length;
      case 'themes-all.json': return c.themes.length;
      case 'gradients-all.json': return c.gradients.length;
      case 'gradients-animated.json': return c.gradients.filter((g) => g.animated).length;
      case 'gradients-still.json': return c.gradients.filter((g) => !g.animated).length;
      case 'everything.json': return c.themes.length + c.canvasFx.length + c.cssPresets.length + c.gradients.length;
      default: return null;
    }
  }

  function visual(item, category, opts) {
    const o = opts || {};
    switch (category) {
      case 'themes': {
        const modes = UI.presentModes(item.modes);
        const first = o.mode || modes[0] || 'dark';
        const feats = [];
        if (modes.some((m) => item.modes[m].hasFX)) feats.push('Canvas FX');
        if (modes.some((m) => item.modes[m].hasGradient)) feats.push('Gradient');
        return `<div class="thumb" data-theme-thumb>${item.modes[first] ? UI.miniHTML(item.modes[first], first) : ''}
          ${feats.length ? `<div class="mini-flags">${feats.map((f) => `<span class="badge">${f}</span>`).join('')}</div>` : ''}
        </div>`;
      }
      case 'canvasFx':
        return UI.fxThumbHTML(item);
      case 'gradients':
        return `<div class="thumb thumb-grad" style="${UI.esc(UI.gradientStyle(item))}"></div>`;
      case 'cssPresets': {
        const h1 = UI.hashNum(item.file || '', 3) % 360;
        return `<div class="thumb thumb-code" style="--h1:${h1}" aria-hidden="true">
          <span>/* ${UI.esc(UI.displayName(item))} */</span>
          <span><span class="k">.app</span> {</span>
          <span>&nbsp;&nbsp;<span class="v">${UI.esc(item.file)}</span></span>
          <span>}</span>
        </div>`;
      }
      case 'bundles': {
        const n = bundleCount(item);
        return `<div class="thumb thumb-bundle" aria-hidden="true"><div class="stack"><i></i><i></i><i>${n != null ? n : ''}</i></div></div>`;
      }
    }
    return '';
  }

  function modeDots(item, current) {
    const modes = UI.presentModes(item.modes);
    if (modes.length < 2) return '';
    return `<span class="mode-dots" role="group" aria-label="Show mode">${modes.map((m) =>
      `<button type="button" class="mode-dot" data-mode="${m}" aria-pressed="${m === current}" title="${m === 'oled' ? 'OLED' : m[0].toUpperCase() + m.slice(1)}" aria-label="${m}"><i style="background:${UI.modeSwatch(item.modes[m], m)}"></i></button>`
    ).join('')}</span>`;
  }

  function cardMeta(item, category) {
    const b = [];
    if (category === 'themes') {
      UI.themeFeatures(item.modes).filter((f) => f === 'Custom CSS' || f === 'Overrides').forEach((f) => b.push(`<span class="badge">${f}</span>`));
      if (item.version) b.push(`<span class="badge">v${UI.esc(item.version)}</span>`);
      return b.join('') + modeDots(item, UI.presentModes(item.modes)[0]);
    }
    if (category === 'canvasFx') return UI.fxTags(item).map((t) => `<span class="badge">${t}</span>`).join('');
    if (category === 'gradients') {
      b.push(`<span class="badge">${UI.esc((item.type || 'linear')[0].toUpperCase() + (item.type || 'linear').slice(1))}</span>`);
      if (item.animated) b.push('<span class="badge badge-accent">Animated</span>');
      return b.join('');
    }
    if (category === 'bundles') return '<span class="badge">One import link</span>';
    return '';
  }

  function card(item, category, i) {
    const name = UI.displayName(item);
    return `<article class="card" data-i="${i}">
      <button type="button" class="card-open" aria-label="Details for ${UI.esc(name)}"></button>
      ${visual(item, category)}
      <div class="card-actions">
        <button type="button" class="icon-btn" data-act="install" aria-label="Install ${UI.esc(name)} on your Open WebUI" title="Install on my Open WebUI">${ICONS.install}</button>
        <button type="button" class="icon-btn" data-act="copy" aria-label="Copy the import link for ${UI.esc(name)}" title="Copy import link">${ICONS.copy}</button>
        ${PREVIEWABLE.includes(category) ? `<button type="button" class="icon-btn" data-act="preview" aria-label="Full-screen preview of ${UI.esc(name)}" title="Full-screen preview">${ICONS.expand}</button>` : ''}
      </div>
      <div class="card-body">
        <h2 class="card-title">${UI.esc(name)}</h2>
        ${item.description ? `<p class="card-desc">${UI.esc(item.description)}</p>` : ''}
        <div class="card-meta">${cardMeta(item, category)}</div>
      </div>
    </article>`;
  }

  // ---- Render ----

  function syncControls() {
    document.querySelectorAll('.cat').forEach((b) => b.setAttribute('aria-selected', b.dataset.category === state.category ? 'true' : 'false'));
    search.value = state.q;
    sort.value = state.sort;
    filters.classList.toggle('hidden', state.category !== 'themes');
    filters.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.filter === state.filter ? 'true' : 'false'));
    search.placeholder = 'Search ' + NOUNS[state.category][1];
  }

  function render() {
    if (!catalog) return;
    UI.live.stop();
    visible = items();
    $('loading').classList.add('hidden');
    $('empty').classList.toggle('hidden', visible.length > 0);
    grid.innerHTML = visible.map((it, i) => card(it, state.category, i)).join('');
    UI.wireFxThumbs(grid);
    const total = (catalog[state.category] || []).length;
    const [one, many] = NOUNS[state.category];
    $('result-count').innerHTML = visible.length === total
      ? `<b>${total}</b> ${total === 1 ? one : many}`
      : `<b>${visible.length}</b> of ${total} ${many}`;
    writeHash();
  }

  function setCategory(cat) {
    if (cat === state.category) return;
    state.category = cat;
    state.filter = 'all';
    syncControls();
    render();
  }

  // ---- Card interactions ----

  grid.addEventListener('click', (e) => {
    const cardEl = e.target.closest('.card');
    if (!cardEl) return;
    const item = visible[Number(cardEl.dataset.i)];
    if (!item) return;

    const dot = e.target.closest('.mode-dot');
    if (dot) {
      const thumb = cardEl.querySelector('[data-theme-thumb]');
      UI.setMiniMode(thumb, item.modes[dot.dataset.mode], dot.dataset.mode);
      cardEl.querySelectorAll('.mode-dot').forEach((d) => d.setAttribute('aria-pressed', d === dot ? 'true' : 'false'));
      return;
    }
    const act = e.target.closest('[data-act]');
    if (act) {
      if (act.dataset.act === 'copy') UI.copyText(item.importUrl, act, 'Import link copied. Paste it in the designer\'s Import dialog.');
      if (act.dataset.act === 'preview') openPreview(item);
      if (act.dataset.act === 'install') UI.installPreset(item, state.category);
      return;
    }
    if (e.target.closest('.thumb-play')) return;
    openDrawer(item);
  });

  function openPreview(item) {
    if (drawer.open) drawer.close();
    UI.live.stop();
    if (window.openPreview) window.openPreview(item, state.category);
  }

  // ---- Drawer ----

  $('drawer-close').innerHTML = ICONS.close;
  $('drawer-share').innerHTML = ICONS.link;
  $('drawer-close').addEventListener('click', () => drawer.close());

  // Light dismiss where closedby="any" isn't supported yet
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    drawer.addEventListener('click', (e) => {
      if (e.target !== drawer) return;
      const r = drawer.getBoundingClientRect();
      const inside = r.top <= e.clientY && e.clientY <= r.bottom && r.left <= e.clientX && e.clientX <= r.right;
      if (!inside) drawer.close();
    });
  }

  drawer.addEventListener('close', () => {
    UI.live.stop();
    drawerContent.innerHTML = '';
    state.p = null;
    writeHash();
  });

  let drawerItem = null;

  $('drawer-share').addEventListener('click', (e) => {
    if (!drawerItem) return;
    const url = location.href.split('#')[0] + hashFor(drawerItem.file);
    UI.copyText(url, e.currentTarget, 'Link to this preset copied');
  });

  function modeTable(item) {
    return `<div class="mode-table">${UI.presentModes(item.modes).map((m) => {
      const d = item.modes[m];
      const flags = [d.hasFX && 'Canvas FX', d.hasGradient && 'Gradient', d.hasCSS && 'CSS', d.hasOverrides && 'Overrides'].filter(Boolean);
      return `<div class="mode-cell">
        <div class="mode-cell-sw" style="background:${UI.modeSwatch(d, m)}"></div>
        <div class="mode-cell-body">
          <span class="mode-cell-name">${m === 'oled' ? 'OLED' : m}</span>
          <span class="mode-cell-val">H ${Math.round(d.h)} · C ${(d.c / 1000).toFixed(3)} · L ${d.l}%</span>
          ${flags.length ? `<div class="mode-cell-flags">${flags.map((f) => `<span class="badge">${f}</span>`).join('')}</div>` : ''}
        </div>
      </div>`;
    }).join('')}</div>`;
  }

  function openDrawer(item) {
    const cat = state.category;
    const name = UI.displayName(item);
    drawerItem = item;
    $('drawer-kind').textContent = KIND[cat];

    const meta = [];
    if (item.author) meta.push(`<span class="badge">${UI.esc(item.author)}</span>`);
    if (item.version) meta.push(`<span class="badge">v${UI.esc(item.version)}</span>`);
    const extra = cat === 'themes'
      ? UI.themeFeatures(item.modes).map((f) => `<span class="badge">${f}</span>`).join('')
      : cardMeta(item, cat);
    const modes = cat === 'themes' ? UI.presentModes(item.modes) : [];

    drawerContent.innerHTML = `
      <div class="drawer-visual">${visual(item, cat)}</div>
      <div class="drawer-body">
        <div>
          <h2 class="drawer-title" id="drawer-title">${UI.esc(name)}</h2>
          <div class="drawer-meta">${meta.join('')}${extra}</div>
        </div>
        ${modes.length > 1 ? `<div class="seg" id="drawer-modes" role="group" aria-label="Show mode">${modes.map((m, i) =>
          `<button type="button" data-mode="${m}" aria-pressed="${i === 0}">${m === 'oled' ? 'OLED' : m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>` : ''}
        ${item.description ? `<p class="drawer-desc">${UI.esc(item.description)}</p>` : ''}
        <div class="drawer-actions">
          <button type="button" class="btn btn-primary" data-act="install">${ICONS.install}Install on my Open WebUI</button>
          ${PREVIEWABLE.includes(cat) ? `<button type="button" class="btn btn-ghost" data-act="preview">${ICONS.expand}Full-screen preview</button>` : ''}
          <button type="button" class="btn btn-ghost" data-act="copy">${ICONS.copy}Copy import link</button>
          ${STUDIO_PARAM[cat] ? `<a class="btn btn-ghost" href="../studio/#${STUDIO_PARAM[cat]}=${encodeURIComponent(item.file)}">Open in Studio</a>` : ''}
        </div>
        <p class="install-note" id="drawer-install-note"></p>
        <div class="drawer-section">
          <span class="drawer-label">Import link</span>
          <div class="url-field"><code>${UI.esc(item.importUrl)}</code><button type="button" class="icon-btn" data-act="copy" aria-label="Copy the import link">${ICONS.copy}</button></div>
        </div>
        ${cat === 'themes' ? `<div class="drawer-section"><span class="drawer-label">Modes</span>${modeTable(item)}</div>` : ''}
        <div class="drawer-section">
          <span class="drawer-label">Or import it by hand</span>
          <ol class="howto">
            <li>Copy the import link above.</li>
            <li>In Theme Designer Pro, open <b>Import</b> and paste the link.</li>
            <li>Choose <b>Load URL</b>.</li>
          </ol>
        </div>
        <div class="drawer-section">
          <a class="text-link" href="${UI.esc(UI.sourceUrl(item))}" target="_blank" rel="noopener">${ICONS.github}View the file on GitHub</a>
        </div>
      </div>`;

    drawerContent.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.act === 'copy') UI.copyText(item.importUrl, b, 'Import link copied. Paste it in the designer\'s Import dialog.');
      else if (b.dataset.act === 'install') UI.installPreset(item, cat);
      else openPreview(item);
    }));
    renderInstallNote();

    const seg = $('drawer-modes');
    if (seg) {
      seg.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-mode]');
        if (!b) return;
        UI.setMiniMode(drawerContent.querySelector('[data-theme-thumb]'), item.modes[b.dataset.mode], b.dataset.mode);
        seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      });
    }

    drawerContent.scrollTop = 0;
    if (!drawer.open) drawer.showModal();
    state.p = item.file;
    writeHash();

    UI.wireFxThumbs(drawerContent);
    const fx = drawerContent.querySelector('.thumb-fx[data-fx]');
    if (fx && !UI.reducedMotion.matches) UI.live.play(fx, fx.getAttribute('data-fx'));
  }

  function renderInstallNote() {
    const note = $('drawer-install-note');
    if (!note) return;
    const t = UI.installTarget();
    note.innerHTML = t
      ? `Installs to <b>${UI.esc(UI.hostOf(t))}</b>, ${t.scope === 'instance' ? 'the instance theme' : 'your own theme'}. <button type="button" class="linklike" data-install-setup>Change</button>`
      : 'The first time, you tell this site where your Open WebUI is. <button type="button" class="linklike" data-install-setup>Set it now</button>';
    note.querySelector('[data-install-setup]').addEventListener('click', () => UI.openInstallSetup());
  }
  document.addEventListener('tdp-install-target', renderInstallNote);

  // ---- Controls ----

  $('cats').addEventListener('click', (e) => {
    const b = e.target.closest('.cat');
    if (b) setCategory(b.dataset.category);
  });

  // Arrow keys move between the type tabs
  $('cats').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = [...document.querySelectorAll('.cat')];
    const i = tabs.findIndex((t) => t.dataset.category === state.category);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    setCategory(next.dataset.category);
  });

  filters.addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    state.filter = c.dataset.filter;
    syncControls();
    render();
  });

  sort.addEventListener('change', () => {
    state.sort = sort.value;
    render();
  });

  let searchTimer = null;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = search.value.trim();
      render();
    }, 120);
  });

  $('clear-search').addEventListener('click', () => {
    state.q = '';
    state.filter = 'all';
    syncControls();
    render();
    search.focus();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !drawer.open && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      search.focus();
    }
  });

  window.addEventListener('hashchange', () => {
    readHash();
    syncControls();
    render();
    openFromHash();
  });

  function openFromHash() {
    if (!state.p) {
      if (drawer.open) drawer.close();
      return;
    }
    const item = (catalog[state.category] || []).find((x) => x.file === state.p);
    if (item) openDrawer(item);
  }

  // ---- Start ----

  readHash();
  syncControls();
  UI.loadCatalog()
    .then((c) => {
      catalog = c;
      CATEGORIES.forEach((k) => {
        const el = document.querySelector(`.cat-count[data-count="${k}"]`);
        if (el) el.textContent = (c[k] || []).length;
      });
      render();
      openFromHash();
    })
    .catch(() => {
      $('loading').innerHTML = '<p>The preset list didn\'t load. Check your connection and reload the page.</p>';
    });
})();
