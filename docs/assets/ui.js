/* Theme Designer Pro site: pieces shared by the home page and the gallery.
   Needs preview.js loaded first (window.TDPEngine). */
(function () {
  'use strict';

  const ROOT = document.body.getAttribute('data-root') || './';
  const REPO = 'https://github.com/silentoplayz/theme-designer-pro-presets';
  const RAW = 'https://raw.githubusercontent.com/silentoplayz/theme-designer-pro-presets/main/';
  const MODE_ORDER = ['dark', 'oled', 'light', 'her'];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)');

  const ICONS = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    github: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a10.9 10.9 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  };

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function titleCase(file) {
    return String(file || '')
      .replace(/\.(json|css|js)$/i, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }

  function displayName(item) {
    return item.name || titleCase(item.file);
  }

  // Stable small numbers from a string, for each script's idle art
  function hashNum(str, salt) {
    let h = 2166136261 ^ (salt || 0);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0);
  }

  function sourceUrl(item) {
    const path = String(item.importUrl || '').replace(RAW, '');
    return `${REPO}/blob/main/${path}`;
  }

  async function loadCatalog() {
    const res = await fetch(ROOT + 'catalog.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // ---- Copying ----

  const toast = document.getElementById('toast');
  let toastTimer = null;

  function showToast(msg) {
    if (!toast) return;
    toast.innerHTML = ICONS.check + '<span></span>';
    toast.querySelector('span').textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  async function copyText(text, btn, msg) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (err) {}
      ta.remove();
    }
    if (btn) {
      btn.classList.add('is-done');
      clearTimeout(btn._doneTimer);
      btn._doneTimer = setTimeout(() => btn.classList.remove('is-done'), 1800);
    }
    showToast(msg || 'Copied');
  }

  // ---- Theme visuals ----

  function presentModes(modes) {
    return MODE_ORDER.filter((m) => modes && modes[m]);
  }

  function varsStyle(vars) {
    return Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
  }

  function modeSwatch(mode, modeKey) {
    const vars = window.TDPEngine.modeVars(mode, modeKey);
    if (modeKey === 'light' || modeKey === 'her') return vars['--color-gray-100'];
    return vars['--color-gray-900'];
  }

  // A small Open WebUI drawn with the theme's own ramp
  function miniHTML(mode, modeKey) {
    const vars = window.TDPEngine.modeVars(mode, modeKey);
    // A theme with a moving background gets a glow in its hue, as a hint of it
    const fx = mode && (mode.hasFX || mode.hasGradient);
    const glow = fx ? `--mh:${Math.round(mode.h || 0)};` : '';
    return `<div class="mini${fx ? ' has-fx' : ''}" data-mode="${modeKey}" style="${esc(glow + varsStyle(vars))}" aria-hidden="true">
      <div class="mini-side"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="mini-main">
        <div class="mini-bubble"></div>
        <div class="mini-lines"><i></i><i></i><i></i></div>
        <div class="mini-code"></div>
        <div class="mini-input"></div>
      </div>
    </div>`;
  }

  function setMiniMode(thumb, mode, modeKey) {
    const old = thumb.querySelector('.mini');
    const tmp = document.createElement('div');
    tmp.innerHTML = miniHTML(mode, modeKey);
    if (old) old.replaceWith(tmp.firstElementChild);
    else thumb.prepend(tmp.firstElementChild);
  }

  function themeFeatures(modes) {
    const out = new Set();
    presentModes(modes).forEach((m) => {
      const d = modes[m];
      if (d.hasFX) out.add('Canvas FX');
      if (d.hasGradient) out.add('Gradient');
      if (d.hasCSS) out.add('Custom CSS');
      if (d.hasOverrides) out.add('Overrides');
    });
    return [...out];
  }

  // ---- Gradient visuals ----

  function gradientStyle(g) {
    const layers = window.TDPEngine.gradientLayers(g);
    if (!layers) return 'background:linear-gradient(135deg,#27272a,#18181b)';
    let s = `background-image:${layers.backgroundImage};`;
    if (layers.background) s += `background-color:${layers.background};`;
    if (layers.animated) s += `background-size:300% 300%;animation:tdp-preview-gradient-shift ${layers.speed}s ease infinite;`;
    return s;
  }

  // ---- Canvas FX visuals ----

  function fxArtStyle(name) {
    const a = hashNum(name, 1), b = hashNum(name, 7);
    const h1 = a % 360;
    const h2 = (h1 + 60 + (b % 140)) % 360;
    return `--h1:${h1};--h2:${h2};--x1:${15 + (a >> 9) % 40}%;--y1:${10 + (a >> 15) % 50}%;--x2:${55 + (b >> 9) % 35}%;--y2:${45 + (b >> 15) % 50}%`;
  }

  function fxTags(item) {
    const f = (item.file || '').toLowerCase();
    const tags = [];
    if (/webgpu/.test(f)) tags.push('WebGPU');
    else if (/webgl/.test(f) || /\(webgl\)/i.test(item.name || '')) tags.push('WebGL');
    if (/^context_/.test(f)) tags.push('Reacts to chat');
    if (/^(tap_|touch_)|bubble_pop|ripple_pond/.test(f)) tags.push('Interactive');
    return tags;
  }

  // The script runs inside a sandboxed, opaque-origin frame, in a Worker on
  // an OffscreenCanvas: the same model as the designer and the full preview.
  function fxSrcdoc(script) {
    const json = JSON.stringify(script).replace(/</g, '\\u003c');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:#07070a}canvas{display:block;width:100%;height:100%}</style></head><body><canvas id="c"></canvas>
<script type="application/json" id="src">${json}<\/script>
<script>
(function(){
  var c=document.getElementById('c');
  var src=JSON.parse(document.getElementById('src').textContent);
  var w=innerWidth,h=innerHeight;c.width=w;c.height=h;
  try{
    var url=URL.createObjectURL(new Blob([src],{type:'application/javascript'}));
    var wk=new Worker(url);
    var off=c.transferControlToOffscreen();
    wk.postMessage({type:'init',canvas:off,width:w,height:h,env:{authToken:'',baseUrl:'',locale:navigator.language,timezone:'UTC'}},[off]);
    var p=function(m){try{wk.postMessage(m)}catch(e){}};
    var raf=null,mv=null;
    addEventListener('mousemove',function(e){mv={type:'mousemove',x:e.clientX,y:e.clientY};if(!raf)raf=requestAnimationFrame(function(){raf=null;if(mv){p(mv);mv=null}})},{passive:true});
    addEventListener('mousedown',function(e){p({type:'mousedown',x:e.clientX,y:e.clientY})},true);
    addEventListener('mouseup',function(e){p({type:'mouseup',x:e.clientX,y:e.clientY})},true);
    addEventListener('click',function(e){p({type:'click',x:e.clientX,y:e.clientY})},true);
    addEventListener('resize',function(){p({type:'resize',width:innerWidth,height:innerHeight})});
  }catch(e){}
})();
<\/script></body></html>`;
  }

  const scriptCache = new Map();
  function fetchScript(url) {
    if (!scriptCache.has(url)) {
      scriptCache.set(url, fetch(url).then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      }).catch((e) => { scriptCache.delete(url); throw e; }));
    }
    return scriptCache.get(url);
  }

  const supportsFx = typeof HTMLCanvasElement !== 'undefined' && !!HTMLCanvasElement.prototype.transferControlToOffscreen;

  // One script plays at a time across the page
  const live = {
    thumb: null,
    token: 0,
    async play(thumb, url) {
      if (!supportsFx || this.thumb === thumb) return;
      this.stop();
      const token = ++this.token;
      this.thumb = thumb;
      thumb.classList.add('is-loading');
      try {
        const script = await fetchScript(url);
        if (token !== this.token) return;
        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.setAttribute('title', 'Canvas FX preview');
        frame.setAttribute('tabindex', '-1');
        frame.srcdoc = fxSrcdoc(script);
        thumb.appendChild(frame);
        thumb.classList.add('is-live');
        setPlayLabel(thumb, true);
      } catch (e) {
        if (token === this.token) this.thumb = null;
      } finally {
        thumb.classList.remove('is-loading');
      }
    },
    stop(thumb) {
      if (thumb && thumb !== this.thumb) return;
      this.token++;
      if (this.thumb) {
        const f = this.thumb.querySelector('iframe');
        if (f) f.remove();
        this.thumb.classList.remove('is-live');
        setPlayLabel(this.thumb, false);
      }
      this.thumb = null;
    },
  };

  function setPlayLabel(thumb, playing) {
    const b = thumb.querySelector('.thumb-play');
    if (!b) return;
    const label = canHover.matches ? (playing ? 'Playing' : 'Hover to play') : (playing ? 'Stop' : 'Play');
    b.innerHTML = (playing ? ICONS.pause : ICONS.play) + `<span>${label}</span>`;
    b.setAttribute('aria-label', playing ? 'Stop the animation' : 'Play the animation');
  }

  const hasWebGL = (() => {
    try { return !!new OffscreenCanvas(1, 1).getContext('webgl'); } catch (e) { return false; }
  })();

  // A script this browser can't run gets a note instead of a black box
  function fxBlocked(item) {
    const f = (item.file || '').toLowerCase();
    if (/webgpu/.test(f) && !navigator.gpu) return 'Needs WebGPU';
    if (/webgl/.test(f) && !hasWebGL) return 'Needs WebGL';
    return '';
  }

  function fxThumbHTML(item, extraClass) {
    const blocked = fxBlocked(item);
    if (blocked) {
      return `<div class="thumb thumb-fx ${extraClass || ''}" style="${fxArtStyle(item.name || item.file)}">
        <span class="thumb-play thumb-note">${blocked}</span>
      </div>`;
    }
    return `<div class="thumb thumb-fx ${extraClass || ''}" style="${fxArtStyle(item.name || item.file)}" data-fx="${esc(item.importUrl)}">
      ${supportsFx ? `<button type="button" class="thumb-play">${ICONS.play}<span>${canHover.matches ? 'Hover to play' : 'Play'}</span></button>` : ''}
    </div>`;
  }

  // Wire every Canvas FX thumbnail inside root: hover plays on a mouse,
  // the button plays and stops on touch and keyboard.
  function wireFxThumbs(root) {
    if (!supportsFx) return;
    root.querySelectorAll('.thumb-fx[data-fx]').forEach((thumb) => {
      if (thumb._wired) return;
      thumb._wired = true;
      const url = thumb.getAttribute('data-fx');
      const host = thumb.closest('.card, .fx-tile') || thumb;
      let timer = null;
      if (canHover.matches) {
        host.addEventListener('pointerenter', () => {
          clearTimeout(timer);
          timer = setTimeout(() => live.play(thumb, url), 180);
        });
        host.addEventListener('pointerleave', () => {
          clearTimeout(timer);
          live.stop(thumb);
        });
      }
      const btn = thumb.querySelector('.thumb-play');
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (live.thumb === thumb) live.stop(thumb);
          else live.play(thumb, url);
        });
      }
    });
  }

  // ---- Page chrome ----

  function initChrome() {
    const header = document.querySelector('.site-header');
    if (header) {
      const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
      const menu = header.querySelector('.menu-btn');
      if (menu) {
        menu.addEventListener('click', () => {
          const open = header.classList.toggle('menu-open');
          menu.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        header.querySelectorAll('.nav a').forEach((a) => a.addEventListener('click', () => {
          header.classList.remove('menu-open');
          menu.setAttribute('aria-expanded', 'false');
        }));
      }
    }

    const reveals = document.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add('is-in');
            io.unobserve(en.target);
          }
        });
      }, { rootMargin: '0px 0px -8% 0px' });
      reveals.forEach((el) => io.observe(el));
    } else {
      reveals.forEach((el) => el.classList.add('is-in'));
    }
  }

  initChrome();

  window.TDPUI = {
    ROOT, REPO, RAW, MODE_ORDER, ICONS, reducedMotion, canHover, supportsFx,
    esc, titleCase, displayName, sourceUrl, loadCatalog, copyText, showToast,
    presentModes, modeSwatch, miniHTML, setMiniMode, themeFeatures,
    gradientStyle, fxThumbHTML, fxBlocked, hasWebGL, fxTags, wireFxThumbs, live, hashNum,
  };
})();
