/* ========================================
   Theme Designer Pro — Preset Gallery
   Application logic: fetch, render, search,
   detail modal, shareable URL state
   ======================================== */

(function () {
  'use strict';

  // ---- Helpers ----

  function oklchToCSS(h, c, l) {
    return `oklch(${l}% ${c / 100} ${h})`;
  }

  function titleCase(str) {
    return str
      .replace(/[-_]/g, ' ')
      .replace(/\.json$/i, '')
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // SVG icons
  const ICONS = {
    copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  };

  const FEATURE_BADGE_MAP = {
    CSS: 'css',
    FX: 'fx',
    Gradient: 'gradient',
    Overrides: 'overrides',
  };

  const MODE_ORDER = ['dark', 'light', 'oled', 'her'];
  const VALID_CATEGORIES = ['themes', 'canvasFx', 'cssPresets', 'gradients', 'bundles'];

  // ---- State ----
  let catalog = null;
  let activeCategory = 'themes';
  let searchQuery = '';
  let activeFilter = 'all';
  let activeSort = 'name-asc';
  let suppressHashUpdate = false;

  // ---- DOM refs ----
  const grid = document.getElementById('card-grid');
  const emptyState = document.getElementById('empty-state');
  const loadingState = document.getElementById('loading-state');
  const searchInput = document.getElementById('search-input');
  const toast = document.getElementById('toast');
  const toolbar = document.getElementById('toolbar');
  const sortSelect = document.getElementById('sort-select');
  const filterChips = document.getElementById('filter-chips');
  const detailModal = document.getElementById('detail-modal');
  const detailContent = document.getElementById('detail-content');
  const detailCloseBtn = document.getElementById('detail-close-btn');

  // ============================================================
  //  URL STATE — read/write hash for shareable links
  //  Format: #category?q=search&filter=value&sort=value
  // ============================================================

  function readHashState() {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;

    const [cat, queryStr] = hash.split('?');

    if (cat && VALID_CATEGORIES.includes(cat)) {
      activeCategory = cat;
    }

    if (queryStr) {
      const params = new URLSearchParams(queryStr);
      if (params.has('q')) searchQuery = params.get('q');
      if (params.has('filter')) activeFilter = params.get('filter');
      if (params.has('sort')) activeSort = params.get('sort');
    }
  }

  function writeHashState() {
    if (suppressHashUpdate) return;

    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (activeFilter !== 'all') params.set('filter', activeFilter);
    if (activeSort !== 'name-asc') params.set('sort', activeSort);

    const qs = params.toString();
    const hash = '#' + activeCategory + (qs ? '?' + qs : '');

    // Replace state silently (no scroll jump, no history spam)
    history.replaceState(null, '', hash);
  }

  function syncUIFromState() {
    // Sync tabs
    document.querySelectorAll('.tab').forEach((t) => {
      const isCurrent = t.getAttribute('data-category') === activeCategory;
      t.classList.toggle('active', isCurrent);
      t.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
    });

    // Sync toolbar visibility — always show sort, but filter chips only for themes
    toolbar.classList.remove('hidden');
    filterChips.style.display = activeCategory === 'themes' ? '' : 'none';

    // Sync search
    searchInput.value = searchQuery;

    // Sync filter chips
    filterChips.querySelectorAll('.chip').forEach((c) => {
      c.classList.toggle('active', c.getAttribute('data-filter') === activeFilter);
    });

    // Sync sort
    sortSelect.value = activeSort;
  }

  // ============================================================
  //  DETAIL MODAL
  // ============================================================

  let previouslyFocused = null;

  function openDetail(item, category) {
    let html = '';
    switch (category) {
      case 'themes':
        html = buildThemeDetail(item);
        break;
      case 'canvasFx':
        html = buildSimpleDetail(item, 'Canvas FX Animation');
        break;
      case 'cssPresets':
        html = buildSimpleDetail(item, 'CSS Preset');
        break;
      case 'gradients':
        html = buildGradientDetail(item);
        break;
      case 'bundles':
        html = buildSimpleDetail(item, 'Import Bundle');
        break;
    }

    previouslyFocused = document.activeElement;
    detailContent.innerHTML = html;
    detailModal.classList.add('open');
    detailModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    // Focus the close button for keyboard users
    detailCloseBtn.focus();
  }

  function closeDetail() {
    detailModal.classList.remove('open');
    detailModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    // Restore focus to the element that opened the modal
    if (previouslyFocused && previouslyFocused.focus) {
      previouslyFocused.focus();
      previouslyFocused = null;
    }
  }

  // Close on backdrop click
  detailModal.addEventListener('click', (e) => {
    if (e.target === detailModal) closeDetail();
  });

  // Close button
  detailCloseBtn.addEventListener('click', closeDetail);

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && detailModal.classList.contains('open')) {
      closeDetail();
      return;
    }
    // Focus trap inside modal
    if (e.key === 'Tab' && detailModal.classList.contains('open')) {
      const panel = detailModal.querySelector('.detail-panel');
      const focusable = panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
  });

  // Expose for inline onclick and keyboard activation
  window.openThemeDetail = function (index) {
    if (!catalog) return;
    const items = getFilteredItems();
    if (items[index]) openDetail(items[index], activeCategory);
  };

  // Keyboard activation for cards (Enter/Space)
  window.cardKeyHandler = function (e, index) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openThemeDetail(index);
    }
  };

  function buildThemeDetail(t) {
    const modes = t.modes || {};
    const presentModes = MODE_ORDER.filter((m) => modes[m]);
    const features = collectFeatures(modes, presentModes);

    // Mode palette cards
    const modesHTML = presentModes
      .map((m) => {
        const mode = modes[m];
        const color = oklchToCSS(mode.h, mode.c, mode.l);

        // Per-mode feature mini-badges
        const modeFeatures = [];
        if (mode.hasCSS) modeFeatures.push('<span class="badge badge--css" style="font-size:0.55rem;padding:2px 6px">CSS</span>');
        if (mode.hasFX) modeFeatures.push('<span class="badge badge--fx" style="font-size:0.55rem;padding:2px 6px">FX</span>');
        if (mode.hasGradient) modeFeatures.push('<span class="badge badge--gradient" style="font-size:0.55rem;padding:2px 6px">Gradient</span>');
        if (mode.hasOverrides) modeFeatures.push('<span class="badge badge--overrides" style="font-size:0.55rem;padding:2px 6px">Overrides</span>');

        return `<div class="detail-mode-card">
          <div class="detail-mode-swatch" style="background:${color}"></div>
          <div class="detail-mode-name">${m}</div>
          <div class="detail-mode-values">H${mode.h} C${(mode.c / 100).toFixed(2)} L${mode.l}%</div>
          ${modeFeatures.length ? `<div class="detail-mode-features">${modeFeatures.join('')}</div>` : ''}
        </div>`;
      })
      .join('');

    // Feature badges
    const badgesHTML = [...features]
      .map((f) => {
        const cls = FEATURE_BADGE_MAP[f] || f.toLowerCase();
        return `<span class="badge badge--${cls}">${escapeHTML(f)}</span>`;
      })
      .join('');

    return `
      <h2 class="detail-title">${escapeHTML(t.name)}</h2>
      <div class="detail-meta">
        ${t.version ? `<span class="detail-version">v${escapeHTML(t.version)}</span>` : ''}
        ${t.author ? `<span class="detail-author">${escapeHTML(t.author)}</span>` : ''}
      </div>
      ${t.description ? `<p class="detail-description">${escapeHTML(t.description)}</p>` : ''}
      ${badgesHTML ? `<div class="detail-section-label">Features</div><div class="detail-badges">${badgesHTML}</div>` : ''}
      <div class="detail-section-label">Mode Palettes</div>
      <div class="detail-palette">${modesHTML}</div>
      <div class="detail-section-label">Import URL</div>
      <div class="detail-import-url">${escapeHTML(t.importUrl)}</div>
      <button class="copy-btn" data-url="${escapeHTML(t.importUrl)}" onclick="copyUrl(this)">
        ${ICONS.copy}
        <span>Copy Import URL</span>
      </button>
    `;
  }

  function buildGradientDetail(g) {
    const gradientCSS = buildGradientCSS(g);
    const typeLabel = (g.type || 'linear').charAt(0).toUpperCase() + (g.type || 'linear').slice(1);
    const typeBadgeClass =
      g.type === 'radial' ? 'badge--radial' : g.type === 'mesh' ? 'badge--mesh' : 'badge--linear';

    return `
      <h2 class="detail-title">${escapeHTML(g.name)}</h2>
      <div class="detail-meta">
        <span class="badge ${typeBadgeClass}">${escapeHTML(typeLabel)}</span>
        ${g.animated ? '<span class="badge badge--animated">Animated</span>' : ''}
      </div>
      <div class="gradient-preview" style="background:${gradientCSS};height:80px;margin-bottom:20px;border-radius:var(--radius-sm)" aria-label="Gradient preview"></div>
      <div class="detail-section-label">Import URL</div>
      <div class="detail-import-url">${escapeHTML(g.importUrl)}</div>
      <button class="copy-btn" data-url="${escapeHTML(g.importUrl)}" onclick="copyUrl(this)">
        ${ICONS.copy}
        <span>Copy Import URL</span>
      </button>
    `;
  }

  function buildSimpleDetail(item, typeLabel) {
    const displayName = item.name || titleCase(item.file || '');
    return `
      <h2 class="detail-title">${escapeHTML(displayName)}</h2>
      <div class="detail-meta">
        <span class="detail-version">${escapeHTML(typeLabel)}</span>
        ${item.author ? `<span class="detail-author">${escapeHTML(item.author)}</span>` : ''}
      </div>
      ${item.description ? `<p class="detail-description">${escapeHTML(item.description)}</p>` : ''}
      <div class="detail-section-label">Import URL</div>
      <div class="detail-import-url">${escapeHTML(item.importUrl)}</div>
      <button class="copy-btn" data-url="${escapeHTML(item.importUrl)}" onclick="copyUrl(this)">
        ${ICONS.copy}
        <span>Copy Import URL</span>
      </button>
    `;
  }

  // ============================================================
  //  FETCH & RENDER
  // ============================================================

  async function fetchCatalog() {
    try {
      const res = await fetch('catalog.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      catalog = await res.json();
      updateCounts();

      // Read URL state before first render
      readHashState();
      syncUIFromState();

      render();
    } catch (err) {
      loadingState.innerHTML = `
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
        <p>Unable to load catalog. Make sure <code>catalog.json</code> exists.</p>
      `;
    }
  }

  function updateCounts() {
    if (!catalog) return;
    setText('count-themes', (catalog.themes || []).length);
    setText('count-canvasFx', (catalog.canvasFx || []).length);
    setText('count-cssPresets', (catalog.cssPresets || []).length);
    setText('count-gradients', (catalog.gradients || []).length);
    setText('count-bundles', (catalog.bundles || []).length);
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function render() {
    if (!catalog) return;

    const items = getFilteredItems();
    loadingState.classList.add('hidden');

    if (items.length === 0) {
      grid.innerHTML = '';
      emptyState.classList.remove('hidden');
      writeHashState();
      return;
    }

    emptyState.classList.add('hidden');
    grid.innerHTML = items.map((item, i) => renderCard(item, activeCategory, i)).join('');
    writeHashState();
  }

  function getFilteredItems() {
    let list = catalog[activeCategory] || [];

    // Text search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((item) => {
        const name = (item.name || item.file || '').toLowerCase();
        const desc = (item.description || '').toLowerCase();
        const author = (item.author || '').toLowerCase();
        return name.includes(q) || desc.includes(q) || author.includes(q);
      });
    }

    // Feature filter (themes only)
    if (activeCategory === 'themes' && activeFilter !== 'all') {
      list = list.filter((item) => {
        const modes = item.modes || {};
        const modeNames = Object.keys(modes);
        switch (activeFilter) {
          case 'gradient':
            return modeNames.some((m) => modes[m].hasGradient);
          case 'canvas-fx':
            return modeNames.some((m) => modes[m].hasFX);
          case 'custom-css':
            return modeNames.some((m) => modes[m].hasCSS);
          case 'overrides':
            return modeNames.some((m) => modes[m].hasOverrides);
          default:
            return true;
        }
      });
    }

    // Sort
    list = [...list];
    if (activeSort === 'name-asc') {
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (activeSort === 'name-desc') {
      list.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
    } else if (activeSort === 'newest') {
      list.sort((a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || ''));
    } else if (activeSort === 'oldest') {
      list.sort((a, b) => (a.dateAdded || '').localeCompare(b.dateAdded || ''));
    }

    return list;
  }

  function collectFeatures(modes, presentModes) {
    const features = new Set();
    for (const m of presentModes) {
      const mode = modes[m];
      if (mode.hasCSS) features.add('CSS');
      if (mode.hasFX) features.add('FX');
      if (mode.hasGradient) features.add('Gradient');
      if (mode.hasOverrides) features.add('Overrides');
    }
    return features;
  }

  // ============================================================
  //  CARD RENDERERS
  // ============================================================

  function renderCard(item, category, index) {
    switch (category) {
      case 'themes':
        return renderThemeCard(item, index);
      case 'canvasFx':
        return renderFxCard(item, index);
      case 'cssPresets':
        return renderCssCard(item, index);
      case 'gradients':
        return renderGradientCard(item, index);
      case 'bundles':
        return renderBundleCard(item, index);
      default:
        return '';
    }
  }

  function renderThemeCard(t, index) {
    const modes = t.modes || {};
    const presentModes = MODE_ORDER.filter((m) => modes[m]);
    const features = collectFeatures(modes, presentModes);

    // Palette strip
    const paletteHTML = presentModes.length
      ? `<div class="palette-strip">
          ${presentModes
            .map((m) => {
              const mode = modes[m];
              const color = oklchToCSS(mode.h, mode.c, mode.l);
              return `<div class="palette-group">
                <div class="palette-swatch" style="background:${color}" title="${m}: oklch(${mode.l}% ${(mode.c / 100).toFixed(3)} ${mode.h})"></div>
                <span class="palette-mode-name">${m}</span>
              </div>`;
            })
            .join('')}
        </div>`
      : '';

    // Feature badges
    const badgesHTML = [...features]
      .map((f) => {
        const cls = FEATURE_BADGE_MAP[f] || f.toLowerCase();
        return `<span class="badge badge--${cls}">${escapeHTML(f)}</span>`;
      });

    const badgeRowHTML = badgesHTML.length
      ? `<div class="badge-row">${badgesHTML.join('')}</div>`
      : '';

    return `<article class="card" tabindex="0" role="button" onclick="openThemeDetail(${index})" onkeydown="cardKeyHandler(event, ${index})" style="cursor:pointer">
      <div class="card-header">
        <h2 class="card-name">${escapeHTML(t.name)}</h2>
        <div class="card-meta">
          ${t.version ? `<span class="card-version">v${escapeHTML(t.version)}</span>` : ''}
        </div>
      </div>
      ${t.description ? `<p class="card-description">${escapeHTML(t.description)}</p>` : ''}
      ${t.author ? `<span class="card-author">${escapeHTML(t.author)}</span>` : ''}
      ${paletteHTML}
      ${badgeRowHTML}
      <button class="copy-btn" data-url="${escapeHTML(t.importUrl)}" onclick="event.stopPropagation(); copyUrl(this)">
        ${ICONS.copy}
        <span>Copy Import URL</span>
      </button>
    </article>`;
  }

  function renderFxCard(fx, index) {
    return `<article class="card" tabindex="0" role="button" onclick="openThemeDetail(${index})" onkeydown="cardKeyHandler(event, ${index})" style="cursor:pointer">
      <div class="card-header">
        <h2 class="card-name">${escapeHTML(fx.name)}</h2>
      </div>
      ${fx.description ? `<p class="card-description">${escapeHTML(fx.description)}</p>` : ''}
      <button class="copy-btn" data-url="${escapeHTML(fx.importUrl)}" onclick="event.stopPropagation(); copyUrl(this)">
        ${ICONS.copy}
        <span>Copy Import URL</span>
      </button>
    </article>`;
  }

  function renderCssCard(css, index) {
    const displayName = css.name || titleCase(css.file || '');
    return `<article class="card" tabindex="0" role="button" onclick="openThemeDetail(${index})" onkeydown="cardKeyHandler(event, ${index})" style="cursor:pointer">
      <div class="card-header">
        <h2 class="card-name">${escapeHTML(displayName)}</h2>
      </div>
      <button class="copy-btn" data-url="${escapeHTML(css.importUrl)}" onclick="event.stopPropagation(); copyUrl(this)">
        ${ICONS.copy}
        <span>Copy Import URL</span>
      </button>
    </article>`;
  }

  function renderGradientCard(g, index) {
    const gradientCSS = buildGradientCSS(g);
    const typeBadgeClass =
      g.type === 'radial'
        ? 'badge--radial'
        : g.type === 'mesh'
          ? 'badge--mesh'
          : 'badge--linear';

    const typeLabel = (g.type || 'linear').charAt(0).toUpperCase() + (g.type || 'linear').slice(1);

    return `<article class="card" tabindex="0" role="button" onclick="openThemeDetail(${index})" onkeydown="cardKeyHandler(event, ${index})" style="cursor:pointer">
      <div class="card-header">
        <h2 class="card-name">${escapeHTML(g.name)}</h2>
        <div class="card-meta">
          <span class="badge ${typeBadgeClass}">${escapeHTML(typeLabel)}</span>
          ${g.animated ? '<span class="badge badge--animated">Animated</span>' : ''}
        </div>
      </div>
      <div class="gradient-preview" style="background:${gradientCSS}" aria-label="Gradient preview"></div>
      <button class="copy-btn" data-url="${escapeHTML(g.importUrl)}" onclick="event.stopPropagation(); copyUrl(this)">
        ${ICONS.copy}
        <span>Copy Import URL</span>
      </button>
    </article>`;
  }

  function buildGradientCSS(g) {
    const stops = g.stops || [];
    if (stops.length === 0) {
      return 'linear-gradient(135deg, #27272a, #18181b)';
    }
    const stopsStr = stops
      .map((s) => {
        const pos = s.position != null ? ` ${s.position}%` : '';
        return `${s.color}${pos}`;
      })
      .join(', ');

    if (g.type === 'radial') {
      return `radial-gradient(ellipse at center, ${stopsStr})`;
    }
    return `linear-gradient(135deg, ${stopsStr})`;
  }

  function renderBundleCard(b, index) {
    return `<article class="card card--bundle" tabindex="0" role="button" onclick="openThemeDetail(${index})" onkeydown="cardKeyHandler(event, ${index})" style="cursor:pointer">
      <div class="card-header">
        <h2 class="card-name">${escapeHTML(b.name)}</h2>
        <span class="bundle-badge">✦ Bundle</span>
      </div>
      ${b.description ? `<p class="card-description">${escapeHTML(b.description)}</p>` : ''}
      <button class="copy-btn" data-url="${escapeHTML(b.importUrl)}" onclick="event.stopPropagation(); copyUrl(this)">
        ${ICONS.copy}
        <span>Copy Import URL</span>
      </button>
    </article>`;
  }

  // ============================================================
  //  COPY TO CLIPBOARD
  // ============================================================

  window.copyUrl = async function (btn) {
    const url = btn.getAttribute('data-url');
    if (!url) return;

    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }

    btn.classList.add('copied');
    btn.innerHTML = `${ICONS.check}<span>Copied!</span>`;

    showToast('Copied! Paste in Theme Designer → Import');

    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = `${ICONS.copy}<span>Copy Import URL</span>`;
    }, 2000);
  };

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  }

  // ============================================================
  //  EVENT HANDLERS
  // ============================================================

  // Tab handling
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      activeCategory = tab.getAttribute('data-category');

      toolbar.classList.remove('hidden');
      filterChips.style.display = activeCategory === 'themes' ? '' : 'none';

      // Reset filter when switching categories
      activeFilter = 'all';
      filterChips.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      filterChips.querySelector('[data-filter="all"]').classList.add('active');

      render();
    });
  });

  // Filter chips
  filterChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    filterChips.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    activeFilter = chip.getAttribute('data-filter');
    render();
  });

  // Sort
  sortSelect.addEventListener('change', () => {
    activeSort = sortSelect.value;
    render();
  });

  // Search
  let debounceTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      searchQuery = searchInput.value.trim();
      render();
    }, 150);
  });

  // Handle browser back/forward with hash changes
  window.addEventListener('hashchange', () => {
    suppressHashUpdate = true;
    readHashState();
    syncUIFromState();
    render();
    suppressHashUpdate = false;
  });

  // ---- Init ----
  fetchCatalog();
})();
