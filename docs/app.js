/* ========================================
   Theme Designer Pro — Preset Gallery
   Application logic: fetch, render, search
   Aligned with TDP visual language
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

  // ---- State ----
  let catalog = null;
  let activeCategory = 'themes';
  let searchQuery = '';
  let activeFilter = 'all';
  let activeSort = 'name-asc';

  // ---- DOM refs ----
  const grid = document.getElementById('card-grid');
  const emptyState = document.getElementById('empty-state');
  const loadingState = document.getElementById('loading-state');
  const searchInput = document.getElementById('search-input');
  const toast = document.getElementById('toast');
  const toolbar = document.getElementById('toolbar');
  const sortSelect = document.getElementById('sort-select');
  const filterChips = document.getElementById('filter-chips');

  // ---- Fetch catalog ----
  async function fetchCatalog() {
    try {
      const res = await fetch('catalog.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      catalog = await res.json();
      updateCounts();
      // Themes is the default tab — show toolbar
      toolbar.classList.remove('hidden');
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

  // ---- Render ----
  function render() {
    if (!catalog) return;

    const items = getFilteredItems();
    loadingState.classList.add('hidden');

    if (items.length === 0) {
      grid.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    grid.innerHTML = items.map((item) => renderCard(item, activeCategory)).join('');
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
    }

    return list;
  }

  function renderCard(item, category) {
    switch (category) {
      case 'themes':
        return renderThemeCard(item);
      case 'canvasFx':
        return renderFxCard(item);
      case 'cssPresets':
        return renderCssCard(item);
      case 'gradients':
        return renderGradientCard(item);
      case 'bundles':
        return renderBundleCard(item);
      default:
        return '';
    }
  }

  // ---- Theme card ----
  function renderThemeCard(t) {
    const modes = t.modes || {};
    const modeOrder = ['dark', 'light', 'oled', 'her'];
    const presentModes = modeOrder.filter((m) => modes[m]);

    // Collect features across all modes
    const features = new Set();
    for (const m of presentModes) {
      const mode = modes[m];
      if (mode.hasCSS) features.add('CSS');
      if (mode.hasFX) features.add('FX');
      if (mode.hasGradient) features.add('Gradient');
      if (mode.hasOverrides) features.add('Overrides');
    }

    // Palette strip — shows color for each mode
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

    // Feature badges with TDP color mapping
    const featureBadgeMap = {
      CSS: 'css',
      FX: 'fx',
      Gradient: 'gradient',
      Overrides: 'overrides',
    };

    const badgesHTML = [];

    // Feature badges
    for (const f of features) {
      const cls = featureBadgeMap[f] || f.toLowerCase();
      badgesHTML.push(`<span class="badge badge--${cls}">${escapeHTML(f)}</span>`);
    }

    const badgeRowHTML = badgesHTML.length
      ? `<div class="badge-row">${badgesHTML.join('')}</div>`
      : '';

    return `<article class="card">
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
      <button class="copy-btn" data-url="${escapeHTML(t.importUrl)}" onclick="copyUrl(this)">
        ${ICONS.copy}
        <span>Copy Import URL</span>
      </button>
    </article>`;
  }

  // ---- Canvas FX card ----
  function renderFxCard(fx) {
    return `<article class="card">
      <div class="card-header">
        <h2 class="card-name">${escapeHTML(fx.name)}</h2>
      </div>
      ${fx.description ? `<p class="card-description">${escapeHTML(fx.description)}</p>` : ''}
      <button class="copy-btn" data-url="${escapeHTML(fx.importUrl)}" onclick="copyUrl(this)">
        ${ICONS.copy}
        <span>Copy Import URL</span>
      </button>
    </article>`;
  }

  // ---- CSS Preset card ----
  function renderCssCard(css) {
    const displayName = css.name || titleCase(css.file || '');
    return `<article class="card">
      <div class="card-header">
        <h2 class="card-name">${escapeHTML(displayName)}</h2>
      </div>
      <button class="copy-btn" data-url="${escapeHTML(css.importUrl)}" onclick="copyUrl(this)">
        ${ICONS.copy}
        <span>Copy Import URL</span>
      </button>
    </article>`;
  }

  // ---- Gradient card ----
  function renderGradientCard(g) {
    const gradientCSS = buildGradientCSS(g);
    const typeBadgeClass =
      g.type === 'radial'
        ? 'badge--radial'
        : g.type === 'mesh'
          ? 'badge--mesh'
          : 'badge--linear';

    const typeLabel = (g.type || 'linear').charAt(0).toUpperCase() + (g.type || 'linear').slice(1);

    return `<article class="card">
      <div class="card-header">
        <h2 class="card-name">${escapeHTML(g.name)}</h2>
        <div class="card-meta">
          <span class="badge ${typeBadgeClass}">${escapeHTML(typeLabel)}</span>
          ${g.animated ? '<span class="badge badge--animated">Animated</span>' : ''}
        </div>
      </div>
      <div class="gradient-preview" style="background:${gradientCSS}" aria-label="Gradient preview"></div>
      <button class="copy-btn" data-url="${escapeHTML(g.importUrl)}" onclick="copyUrl(this)">
        ${ICONS.copy}
        <span>Copy Import URL</span>
      </button>
    </article>`;
  }

  function buildGradientCSS(g) {
    const stops = g.stops || [];
    if (stops.length === 0) {
      // Mesh gradients — show a placeholder
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

  // ---- Bundle card ----
  function renderBundleCard(b) {
    return `<article class="card card--bundle">
      <div class="card-header">
        <h2 class="card-name">${escapeHTML(b.name)}</h2>
        <span class="bundle-badge">✦ Bundle</span>
      </div>
      ${b.description ? `<p class="card-description">${escapeHTML(b.description)}</p>` : ''}
      <button class="copy-btn" data-url="${escapeHTML(b.importUrl)}" onclick="copyUrl(this)">
        ${ICONS.copy}
        <span>Copy Import URL</span>
      </button>
    </article>`;
  }

  // ---- Copy to clipboard ----
  window.copyUrl = async function (btn) {
    const url = btn.getAttribute('data-url');
    if (!url) return;

    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }

    // Visual feedback
    btn.classList.add('copied');
    btn.innerHTML = `${ICONS.check}<span>Copied!</span>`;

    showToast('Copied! Paste in Theme Designer Pro → Import');

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

  // ---- Tab handling ----
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      activeCategory = tab.getAttribute('data-category');

      // Show toolbar only for themes
      if (activeCategory === 'themes') {
        toolbar.classList.remove('hidden');
      } else {
        toolbar.classList.add('hidden');
      }

      // Reset filter when switching categories
      activeFilter = 'all';
      filterChips.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      filterChips.querySelector('[data-filter="all"]').classList.add('active');

      render();
    });
  });

  // ---- Filter chips ----
  filterChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    filterChips.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    activeFilter = chip.getAttribute('data-filter');
    render();
  });

  // ---- Sort ----
  sortSelect.addEventListener('change', () => {
    activeSort = sortSelect.value;
    render();
  });

  // ---- Search ----
  let debounceTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      searchQuery = searchInput.value.trim();
      render();
    }, 150);
  });

  // ---- Init ----
  fetchCatalog();
})();
