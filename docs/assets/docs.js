/* Theme Designer Pro site: the documentation pages.
   Each page is a Markdown file in the repository, read from main when it
   opens, so the docs here always match the repository. Links between the
   files open here; links to anything else in the repository open GitHub. */
(function () {
  'use strict';

  const RAW = 'https://raw.githubusercontent.com/silentoplayz/theme-designer-pro-presets/main/';
  const REPO = 'https://github.com/silentoplayz/theme-designer-pro-presets';

  // The pages, in the sidebar's order: [key, file, title, one-line summary]
  const PAGES = [
    ['function', 'event-function/README.md', 'Theme Designer Pro', 'Install, use and configure the event function'],
    ['theme-format', 'schemas/theme-format.md', 'Theme format', 'Every field of a theme file'],
    ['canvas-fx', 'canvas-fx/README.md', 'Canvas FX scripts', 'Write an animated background'],
    ['launcher', 'launcher/README.md', 'Launcher Tool', 'Open the designer from a chat'],
    ['contributing', 'CONTRIBUTING.md', 'Make a preset', 'Share a theme, script or gradient'],
  ];
  const BY_FILE = Object.fromEntries(PAGES.map((p) => [p[1], p[0]]));
  // Sections that are release notes fold into one group in the contents
  const RELEASE = /^(what['’]s new in|unreleased)\b/i;

  const $ = (id) => document.getElementById(id);
  const content = $('doc-content');
  const toc = $('docs-toc');
  const pagesNav = $('docs-pages');
  const filter = $('docs-filter');
  const meta = $('docs-meta');
  const side = document.querySelector('.docs-side');
  const cache = {};
  let current = null;
  let spy = null;

  // GitHub's heading ids: lower case, punctuation and emoji dropped, spaces
  // to hyphens, and repeats numbered
  function slugger() {
    const seen = {};
    return (text) => {
      let base = text.toLowerCase().trim()
        .replace(/[ -⁯⸀-⹿\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~’]/g, '')
        .replace(/[\p{Extended_Pictographic}️‍]/gu, '')
        .trim()
        .replace(/\s/g, '-');
      let slug = base, n = seen[base] || 0;
      if (n) slug = base + '-' + n;
      seen[base] = n + 1;
      return slug;
    };
  }

  function plain(text) {
    return text.replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s+/g, ' ').trim();
  }

  // A link in a file, resolved against that file's folder
  function resolve(file, href) {
    const parts = file.split('/').slice(0, -1);
    href.split('/').forEach((seg) => {
      if (seg === '..') parts.pop();
      else if (seg && seg !== '.') parts.push(seg);
    });
    return parts.join('/');
  }

  function rewriteLinks(root, file) {
    root.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (/^(https?:|mailto:)/.test(href)) {
        if (!href.startsWith(location.origin)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        return;
      }
      if (href.startsWith('#')) { a.setAttribute('href', '#' + current + '/' + href.slice(1)); return; }
      const [pathPart, hash] = href.split('#');
      let path = resolve(file, pathPart);
      const asReadme = path.replace(/\/?$/, '/README.md').replace(/^\//, '');
      const key = BY_FILE[path] || BY_FILE[asReadme];
      if (key) { a.setAttribute('href', '#' + key + (hash ? '/' + hash : '')); return; }
      const isDir = pathPart.endsWith('/');
      a.href = REPO + (isDir ? '/tree/main/' : '/blob/main/') + path + (hash ? '#' + hash : '');
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    });
    root.querySelectorAll('img[src]').forEach((img) => {
      const src = img.getAttribute('src');
      if (!/^(https?:|data:)/.test(src)) img.src = RAW + resolve(file, src);
      img.loading = 'lazy';
    });
  }

  // GitHub's alerts: a quote that opens with [!NOTE], [!TIP], [!IMPORTANT],
  // [!WARNING] or [!CAUTION]
  function alerts(root) {
    root.querySelectorAll('blockquote').forEach((q) => {
      const p = q.querySelector('p');
      const m = p && p.innerHTML.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(<br>)?/i);
      if (!m) return;
      const kind = m[1].toLowerCase();
      p.innerHTML = p.innerHTML.slice(m[0].length);
      if (!p.textContent.trim()) p.remove();
      q.classList.add('doc-alert', 'doc-alert-' + kind);
      q.insertAdjacentHTML('afterbegin', '<div class="doc-alert-title">' + kind[0].toUpperCase() + kind.slice(1) + '</div>');
    });
  }

  function render(md, file) {
    const html = DOMPurify.sanitize(marked.parse(md, { gfm: true }), { ADD_ATTR: ['target'] });
    content.innerHTML = html;
    const slug = slugger();
    content.querySelectorAll('h1, h2, h3, h4').forEach((h) => {
      h.id = slug(h.textContent);
      const a = document.createElement('a');
      a.className = 'heading-link';
      a.href = '#' + current + '/' + h.id;
      a.setAttribute('aria-label', 'Link to this section');
      a.textContent = '#';
      h.append(a);
    });
    alerts(content);
    rewriteLinks(content, file);
    content.querySelectorAll('table').forEach((t) => {
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      t.before(wrap);
      wrap.append(t);
    });
  }

  function buildToc() {
    const heads = [...content.querySelectorAll('h2, h3')];
    let html = '', inRelease = false, releaseCount = 0;
    heads.forEach((h) => {
      const label = plain(h.textContent.replace(/#$/, ''));
      const isRelease = h.tagName === 'H2' && RELEASE.test(label);
      if (isRelease && !inRelease) {
        inRelease = true;
        html += '<details class="toc-group"><summary>Release notes<span class="toc-count"></span></summary>';
      } else if (!isRelease && h.tagName === 'H2' && inRelease) {
        inRelease = false;
        html += '</details>';
      }
      if (isRelease) releaseCount++;
      if (inRelease && h.tagName === 'H3') return;
      html += '<a class="toc-link ' + h.tagName.toLowerCase() + '" href="#' + current + '/' + h.id + '" data-id="' + h.id + '">' +
        label.replace(/^what['’]s new in /i, '').replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</a>';
    });
    if (inRelease) html += '</details>';
    toc.innerHTML = html || '<p class="toc-empty">No sections</p>';
    indexSections();
    const count = toc.querySelector('.toc-count');
    if (count) count.textContent = releaseCount;
    applyFilter();
    watchSections(heads);
  }

  // Each section's words, heading to next heading, for the filter
  let sectionText = {};
  function indexSections() {
    sectionText = {};
    let id = null;
    [...content.children].forEach((el) => {
      if (/^H[23]$/.test(el.tagName)) id = el.id;
      if (id) sectionText[id] = (sectionText[id] || '') + ' ' + el.textContent.toLowerCase();
    });
  }

  function applyFilter() {
    const q = filter.value.trim().toLowerCase();
    toc.querySelectorAll('.toc-link').forEach((a) => {
      a.hidden = !!q && a.textContent.toLowerCase().indexOf(q) === -1 && (sectionText[a.dataset.id] || '').indexOf(q) === -1;
    });
    toc.querySelectorAll('.toc-group').forEach((g) => {
      const any = [...g.querySelectorAll('.toc-link')].some((a) => !a.hidden);
      g.hidden = !!q && !any;
      if (q && any) g.open = true;
    });
  }

  // The contents follow the reader: the section in view is marked
  function watchSections(heads) {
    if (spy) spy.disconnect();
    if (!('IntersectionObserver' in window)) return;
    const visible = new Set();
    spy = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target); });
      const first = heads.find((h) => visible.has(h));
      if (first) mark(first.id);
    }, { rootMargin: '-72px 0px -70% 0px' });
    heads.forEach((h) => spy.observe(h));
  }

  function mark(id) {
    toc.querySelectorAll('.toc-link.is-current').forEach((a) => a.classList.remove('is-current'));
    const a = toc.querySelector('.toc-link[data-id="' + CSS.escape(id) + '"]');
    if (!a) return;
    a.classList.add('is-current');
    const group = a.closest('.toc-group');
    if (group && !group.open) group.open = true;
  }

  function buildPages() {
    pagesNav.innerHTML = PAGES.map(([key, , title, summary]) =>
      '<a class="docs-page' + (key === current ? ' is-current' : '') + '" href="#' + key + '"' + (key === current ? ' aria-current="page"' : '') + '>' +
      '<span class="t">' + title + '</span><span class="s">' + summary + '</span></a>').join('');
  }

  function route() {
    const raw = decodeURIComponent(location.hash.slice(1));
    const [key, ...rest] = raw.split('/');
    const page = PAGES.find((p) => p[0] === key) || PAGES[0];
    const anchor = rest.join('/');
    if (page[0] !== current) open(page, anchor);
    else scrollTo(anchor);
  }

  function scrollTo(anchor) {
    const el = anchor && document.getElementById(anchor);
    if (el) { el.scrollIntoView(); mark(anchor); }
  }

  async function open(page, anchor) {
    const [key, file, title] = page;
    current = key;
    buildPages();
    document.title = title + ' · Docs · Theme Designer Pro';
    meta.innerHTML = '<a href="' + REPO + '/blob/main/' + file + '" target="_blank" rel="noopener noreferrer">View on GitHub</a>' +
      '<a href="' + REPO + '/edit/main/' + file + '" target="_blank" rel="noopener noreferrer">Suggest an edit</a>';
    content.innerHTML = '<p class="muted">Loading ' + title + '…</p>';
    toc.innerHTML = '';
    try {
      if (!cache[file]) {
        const res = await fetch(RAW + file, { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        cache[file] = await res.text();
      }
      if (current !== key) return;
      render(cache[file], file);
      buildToc();
      if (anchor) scrollTo(anchor);
      else window.scrollTo(0, 0);
    } catch (e) {
      content.innerHTML = '<p>This page didn\'t load (' + String(e.message || e).replace(/</g, '&lt;') + '). You can read it <a href="' + REPO + '/blob/main/' + file + '">on GitHub</a>.</p>';
    }
  }

  filter.addEventListener('input', applyFilter);
  window.addEventListener('hashchange', route);

  // On a phone the sidebar folds above the page, and a pick closes it
  const toggle = document.querySelector('.docs-side-toggle');
  toggle.addEventListener('click', () => {
    const open = side.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  side.addEventListener('click', (e) => {
    if (e.target.closest('a') && side.classList.contains('is-open')) {
      side.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
    content.innerHTML = '<p>The documentation needs two scripts from cdnjs.cloudflare.com that didn\'t load. You can read it <a href="' + REPO + '/tree/main/event-function#readme">on GitHub</a>.</p>';
    return;
  }
  route();
})();
