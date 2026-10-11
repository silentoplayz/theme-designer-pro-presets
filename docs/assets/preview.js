/* ========================================
   Theme Designer Pro website
   Live preview engine: gradients, Canvas FX,
   themes, and CSS presets
   ======================================== */

(function () {
  'use strict';

  // The mock's logo resolves against this script, so it loads from any page
  const LOGO = new URL('owui-logo.png', (document.currentScript && document.currentScript.src) || location.href).href;

  // ---- OKLCH palette math (mirrors the designer's generator) ----

  const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 850, 900, 950];
  const LIGHTNESS_MAP = {
    50: 0.98, 100: 0.94, 200: 0.92, 300: 0.85, 400: 0.77, 500: 0.69,
    600: 0.51, 700: 0.42, 800: 0.32, 850: 0.27, 900: 0.2, 950: 0.16,
  };

  function themeVars(mode) {
    const vars = {};
    const paletteOn = !mode || mode.paletteEnabled !== false;
    const h = mode && mode.h != null ? mode.h : 250;
    const c = paletteOn && mode ? (mode.c || 0) / 1000 : 0;
    const l = mode && mode.l != null ? mode.l / 100 : 0.2;
    const deltaL = paletteOn ? l - 0.2 : 0;
    const ov = (paletteOn && mode && mode.overrides) || {};

    // Not colors: the frame reads these to give Canvas FX the theme's accents
    vars['--tdp-hue'] = String(h);
    vars['--tdp-chroma'] = String(paletteOn && mode ? (mode.c || 0) : 0);
    STEPS.forEach((step) => {
      const targetL = Math.max(0, Math.min(0.98, LIGHTNESS_MAP[step] + deltaL));
      const computed = `oklch(${targetL.toFixed(3)} ${c.toFixed(3)} ${c === 0 ? 0 : h})`;
      vars[`--color-gray-${step}`] = ov[`--color-gray-${step}`] || computed;
    });

    // Manual variable overrides win over the generated palette
    if (mode && mode.manualOverridesEnabled !== false && typeof mode.manualOverrides === 'string') {
      mode.manualOverrides.split('\n').forEach((line) => {
        const t = line.trim();
        if (t.startsWith('--') && t.includes(':') && !/[{}]/.test(t)) {
          const idx = t.indexOf(':');
          vars[t.slice(0, idx).trim()] = t.slice(idx + 1).replace(/;\s*$/, '').trim();
        }
      });
    }
    return vars;
  }

  // ---- Gradient CSS (mirrors the designer's buildGradientCss) ----

  function adjustHexIntensity(hex, intensity) {
    hex = String(hex || '').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return '#' + (hex || '000000');
    const factor = intensity / 100;
    const rgb = [0, 2, 4].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16);
      return Math.max(0, Math.min(255, Math.round(128 + (v - 128) * factor)));
    });
    return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  // Accepts a full gradient preset object (raw file) or a theme mode's gradient* fields
  function gradientLayers(g) {
    const type = g.type || g.gradientType || 'linear';
    const intensity = firstOf(g.intensity, g.gradientIntensity, 85);
    const animated = !!(g.animation || g.gradientAnimation || g.animated);
    const speed = firstOf(g.speed, g.gradientAnimationSpeed, 8);

    if (type === 'mesh') {
      const points = g.meshPoints || g.gradientMeshPoints || [];
      if (points.length < 2) return null;
      const bg = g.meshBgColor || g.gradientMeshBgColor || '#0a0a12';
      const layers = points
        .map((p) => `radial-gradient(at ${p.x}% ${p.y}%, ${adjustHexIntensity(p.color, intensity)} 0%, transparent ${p.spread}%)`)
        .join(', ');
      return { background: bg, backgroundImage: layers, animated, speed };
    }

    const stops = g.stops || g.gradientStops || [];
    if (stops.length < 2) return null;
    const stopsStr = [...stops]
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map((s) => `${adjustHexIntensity(s.color, intensity)} ${s.position || 0}%`)
      .join(', ');

    let fn;
    if (type === 'radial') {
      const shape = firstOf(g.radialShape, g.gradientRadialShape, 'ellipse');
      const size = firstOf(g.radialSize, g.gradientRadialSize, 'farthest-corner');
      const x = firstOf(g.radialPosX, g.gradientRadialPosX, 50);
      const y = firstOf(g.radialPosY, g.gradientRadialPosY, 50);
      fn = `radial-gradient(${shape} ${size} at ${x}% ${y}%, ${stopsStr})`;
    } else {
      const angle = firstOf(g.angle, g.gradientAngle, 135);
      fn = `linear-gradient(${angle}deg, ${stopsStr})`;
    }
    return { background: null, backgroundImage: fn, animated, speed };
  }

  function firstOf() {
    for (const v of arguments) if (v != null) return v;
  }

  function applyGradientToEl(el, layers) {
    el.style.background = '';
    el.style.animation = '';
    if (layers.background) el.style.backgroundColor = layers.background;
    el.style.backgroundImage = layers.backgroundImage;
    if (layers.animated) {
      el.style.backgroundSize = '300% 300%';
      el.style.animation = `tdp-preview-gradient-shift ${layers.speed}s ease infinite`;
    }
  }

  // ---- Canvas FX engine (Worker-only, mirrors the designer's protocol) ----
  //
  // Scripts run in a Web Worker from a Blob URL with an OffscreenCanvas —
  // the same execution model the designer uses. There is deliberately no
  // main-thread eval fallback here: on browsers without OffscreenCanvas the
  // preview shows a notice instead of executing gallery code in page scope.

  function startCanvasEngine(scriptText, stage, statusFn) {
    if (typeof HTMLCanvasElement === 'undefined' || !HTMLCanvasElement.prototype.transferControlToOffscreen) {
      statusFn('Live Canvas FX preview needs a browser with OffscreenCanvas support (Chrome, Edge, Firefox, Safari 17+).');
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.className = 'preview-canvas';
    canvas.width = stage.clientWidth;
    canvas.height = stage.clientHeight;
    stage.appendChild(canvas);

    const blob = new Blob([scriptText], { type: 'application/javascript' });
    const objectURL = URL.createObjectURL(blob);
    let worker;
    try {
      worker = new Worker(objectURL);
    } catch (err) {
      URL.revokeObjectURL(objectURL);
      canvas.remove();
      statusFn('Could not start the animation worker: ' + err.message);
      return null;
    }

    worker.onerror = (e) => {
      statusFn('Script error: ' + (e.message || 'the animation failed to run.'));
    };

    const offscreen = canvas.transferControlToOffscreen();
    const post = (msg, transfer) => { try { worker.postMessage(msg, transfer); } catch (_) { /* worker gone */ } };
    post(
      {
        type: 'init',
        canvas: offscreen,
        width: stage.clientWidth,
        height: stage.clientHeight,
        env: { authToken: '', baseUrl: '', locale: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      },
      [offscreen]
    );

    // rAF-coalesced pointer pump + immediate click/touch, per the engine contract
    let pendingMove = null;
    let rafId = null;
    const pump = () => {
      rafId = null;
      if (pendingMove) { post(pendingMove); pendingMove = null; }
    };
    const queueMove = (x, y) => {
      pendingMove = { type: 'mousemove', x, y };
      if (!rafId) rafId = requestAnimationFrame(pump);
    };

    const safeXY = (e) => { try { return { x: e.clientX, y: e.clientY }; } catch (_) { return null; } };
    const onMove = (e) => { const p = safeXY(e); if (p) queueMove(p.x, p.y); };
    const onClick = (e) => { const p = safeXY(e); if (p) post({ type: 'click', x: p.x, y: p.y }); };
    const onDown = (e) => { const p = safeXY(e); if (p) post({ type: 'mousedown', x: p.x, y: p.y }); };
    const onUp = (e) => { const p = safeXY(e); if (p) post({ type: 'mouseup', x: p.x, y: p.y }); };
    const touches = (e) => { try { return Array.from(e.touches.length ? e.touches : e.changedTouches).map((t) => ({ x: t.clientX, y: t.clientY })); } catch (_) { return []; } };
    const onTouchStart = (e) => {
      const c = touches(e);
      post({ type: 'touchstart', touches: c });
      if (c[0]) post({ type: 'mousedown', x: c[0].x, y: c[0].y });
    };
    const onTouchMove = (e) => {
      const c = touches(e);
      post({ type: 'touchmove', touches: c });
      if (c[0]) queueMove(c[0].x, c[0].y);
    };
    const onTouchEnd = (e) => {
      const c = touches(e);
      post({ type: 'touchend', touches: c });
      if (c[0]) post({ type: 'mouseup', x: c[0].x, y: c[0].y });
    };
    const onResize = () => post({ type: 'resize', width: stage.clientWidth, height: stage.clientHeight });
    const onBridge = (e) => {
      const d = e.data;
      if (!d || d.__tdpPreview !== true) return;
      switch (d.kind) {
        case 'mousemove': queueMove(d.x, d.y); break;
        case 'click': post({ type: 'click', x: d.x, y: d.y }); break;
        case 'mousedown': post({ type: 'mousedown', x: d.x, y: d.y }); break;
        case 'mouseup': post({ type: 'mouseup', x: d.x, y: d.y }); break;
        case 'touchstart':
          post({ type: 'touchstart', touches: d.touches });
          if (d.touches && d.touches[0]) post({ type: 'mousedown', x: d.touches[0].x, y: d.touches[0].y });
          break;
        case 'touchmove':
          post({ type: 'touchmove', touches: d.touches });
          if (d.touches && d.touches[0]) queueMove(d.touches[0].x, d.touches[0].y);
          break;
        case 'touchend':
          post({ type: 'touchend', touches: d.touches });
          if (d.touches && d.touches[0]) post({ type: 'mouseup', x: d.touches[0].x, y: d.touches[0].y });
          break;
      }
    };

    window.addEventListener('message', onBridge);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('click', onClick, true);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('resize', onResize);

    return {
      sendContext(detail) {
        post(Object.assign({ type: 'context' }, detail));
      },
      destroy() {
        window.removeEventListener('message', onBridge);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('click', onClick, true);
        window.removeEventListener('mousedown', onDown, true);
        window.removeEventListener('mouseup', onUp, true);
        window.removeEventListener('touchstart', onTouchStart);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);
        window.removeEventListener('resize', onResize);
        if (rafId) cancelAnimationFrame(rafId);
        worker.terminate();
        URL.revokeObjectURL(objectURL);
        canvas.remove();
      },
    };
  }

  // ---- Mock Open WebUI chat (inert sandboxed iframe) ----

  // Icon paths copied verbatim from Open WebUI's icon components so the mock
  // uses the same glyphs as the real app rather than lookalikes. Source paths:
  //   layout/Sidebar/icons/{EditPencil,Search,Notes,Workspace,Code,ChevronRight,Plus}.svelte
  //   icons/{Sidebar,PencilSquare,EllipsisHorizontal,Bolt,PlusAlt,Component,Mic,Voice}.svelte
  // Every one is a 24x24 stroke icon at stroke-width 1.5 (Voice overrides to 2.5).
  // Entries are path data strings; an entry may also be a raw element (Mic's
  // <rect>) so shapes stay byte-identical to the component they came from.
  function icon(shapes, opt) {
    const o = opt || {};
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="' + (o.fill || 'none') +
      '" stroke="currentColor" stroke-width="' + (o.strokeWidth || '1.5') +
      '" stroke-linecap="round" stroke-linejoin="round">' +
      shapes.map(function (s) { return s.charAt(0) === '<' ? s : '<path d="' + s + '"/>'; }).join('') + '</svg>';
  }

  const SVG = {
    // Sidebar/icons/EditPencil.svelte — sidebar "New Chat"
    editPencil: icon(['M14.3632 5.65156L15.8431 4.17157C16.6242 3.39052 17.8905 3.39052 18.6716 4.17157L20.0858 5.58579C20.8668 6.36683 20.8668 7.63316 20.0858 8.41421L18.6058 9.8942M14.3632 5.65156L4.74749 15.2672C4.41542 15.5993 4.21079 16.0376 4.16947 16.5054L3.92738 19.2459C3.87261 19.8659 4.39148 20.3848 5.0115 20.33L7.75191 20.0879C8.21972 20.0466 8.65806 19.8419 8.99013 19.5099L18.6058 9.8942M14.3632 5.65156L18.6058 9.8942']),
    // Sidebar/icons/Search.svelte
    search: icon(['M17 17L21 21', 'M3 11C3 15.4183 6.58172 19 11 19C13.213 19 15.2161 18.1015 16.6644 16.6493C18.1077 15.2022 19 13.2053 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11Z']),
    // Sidebar/icons/Notes.svelte
    notes: icon(['M4 19V5C4 3.89543 4.89543 3 6 3H19.4C19.7314 3 20 3.26863 20 3.6V16.7143', 'M6 17L20 17', 'M6 21L20 21', 'M6 21C4.89543 21 4 20.1046 4 19C4 17.8954 4.89543 17 6 17', 'M9 7L15 7']),
    // Sidebar/icons/Workspace.svelte
    workspace: icon(['M13.9922 17H16.9922M19.9922 17H16.9922M16.9922 17V14M16.9922 17V20', 'M4 9.4V4.6C4 4.26863 4.26863 4 4.6 4H9.4C9.73137 4 10 4.26863 10 4.6V9.4C10 9.73137 9.73137 10 9.4 10H4.6C4.26863 10 4 9.73137 4 9.4Z', 'M4 19.4V14.6C4 14.2686 4.26863 14 4.6 14H9.4C9.73137 14 10 14.2686 10 14.6V19.4C10 19.7314 9.73137 20 9.4 20H4.6C4.26863 20 4 19.7314 4 19.4Z', 'M14 9.4V4.6C14 4.26863 14.2686 4 14.6 4H19.4C19.7314 4 20 4.26863 20 4.6V9.4C20 9.73137 19.7314 10 19.4 10H14.6C14.2686 10 14 9.73137 14 9.4Z']),
    // Sidebar/icons/Code.svelte — "Playground"
    code: icon(['M13.5 6L10 18.5', 'M6.5 8.5L3 12L6.5 15.5', 'M17.5 8.5L21 12L17.5 15.5']),
    // Sidebar/icons/Plus.svelte — section "add" affordance
    plus: icon(['M6 12H12M18 12H12M12 12V6M12 12V18']),
    // Sidebar/icons/ChevronRight.svelte — "Pinned" disclosure
    chevron: icon(['M9 6L15 12L9 18']),
    // icons/ChevronDown.svelte — the model selector's trigger caret
    chevronDown: icon(['m19.5 8.25-7.5 7.5-7.5-7.5'], { strokeWidth: '2.5' }),
    // icons/Sidebar.svelte — sidebar collapse toggle
    panel: icon(['M19 21L5 21C3.89543 21 3 20.1046 3 19L3 5C3 3.89543 3.89543 3 5 3L19 3C20.1046 3 21 3.89543 21 5L21 19C21 20.1046 20.1046 21 19 21Z', 'M9.5 21V3', 'M5.5 10L7.25 12L5.5 14']),
    // icons/EllipsisHorizontal.svelte
    dots: icon(['M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM18.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z']),
    // icons/Knobs.svelte — the navbar's Chat Controls button
    knobs: icon(['M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75'], { strokeWidth: '1' }),
    // icons/ChatPlus.svelte — mobile navbar "New Chat"
    chatPlus: icon(['M9 12H12M15 12H12M12 12V9M12 12V15', 'M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 13.8214 2.48697 15.5291 3.33782 17L2.5 21.5L7 20.6622C8.47087 21.513 10.1786 22 12 22Z']),
    // icons/ChatBubbleDotted.svelte — Temporary Chat (dashes are part of the glyph)
    chatBubbleDotted: icon(['<path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 13.8214 2.48697 15.5291 3.33782 17L2.5 21.5L7 20.6622C8.47087 21.513 10.1786 22 12 22Z" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2.5 3.5"></path>']),
    // icons/Bolt.svelte — the "Suggested" marker on the chat placeholder
    bolt: icon(['m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z']),
    // icons/PlusAlt.svelte — input bar "More"
    plusAlt: icon(['M6 12H12M18 12H12M12 12V6M12 12V18']),
    // icons/Component.svelte — input bar "Integrations"
    component: icon(['M5.21173 15.1113L2.52473 12.4243C2.29041 12.1899 2.29041 11.8101 2.52473 11.5757L5.21173 8.88873C5.44605 8.65442 5.82595 8.65442 6.06026 8.88873L8.74727 11.5757C8.98158 11.8101 8.98158 12.1899 8.74727 12.4243L6.06026 15.1113C5.82595 15.3456 5.44605 15.3456 5.21173 15.1113Z', 'M11.5757 21.475L8.88874 18.788C8.65443 18.5537 8.65443 18.1738 8.88874 17.9395L11.5757 15.2525C11.8101 15.0182 12.19 15.0182 12.4243 15.2525L15.1113 17.9395C15.3456 18.1738 15.3456 18.5537 15.1113 18.788L12.4243 21.475C12.19 21.7094 11.8101 21.7094 11.5757 21.475Z', 'M11.5757 8.7475L8.88874 6.06049C8.65443 5.82618 8.65443 5.44628 8.88874 5.21197L11.5757 2.52496C11.8101 2.29065 12.19 2.29065 12.4243 2.52496L15.1113 5.21197C15.3456 5.44628 15.3456 5.82618 15.1113 6.06049L12.4243 8.7475C12.19 8.98181 11.8101 8.98181 11.5757 8.7475Z', 'M17.9396 15.1113L15.2526 12.4243C15.0183 12.1899 15.0183 11.8101 15.2526 11.5757L17.9396 8.88873C18.174 8.65442 18.5539 8.65442 18.7882 8.88873L21.4752 11.5757C21.7095 11.8101 21.7095 12.1899 21.4752 12.4243L18.7882 15.1113C18.5539 15.3456 18.174 15.3456 17.9396 15.1113Z']),
    // icons/Mic.svelte — "Dictate"
    mic: icon(['<rect x="9" y="2" width="6" height="12" rx="3" />', 'M5 10v1a7 7 0 0 0 14 0v-1M12 18v4m0 0H9m3 0h3']),
    // icons/Voice.svelte — the filled circle button shown while the input is empty
    voice: icon(['M12 4L12 20', 'M8 9L8 15', 'M20 10L20 14', 'M4 10L4 14', 'M16 7L16 17'], { strokeWidth: '2.5' }),
    // Sidebar/icons/MoreHorizontal.svelte — the per-chat menu trigger
    moreHorizontal: icon([
      'M20 12.5C20.2761 12.5 20.5 12.2761 20.5 12C20.5 11.7239 20.2761 11.5 20 11.5C19.7239 11.5 19.5 11.7239 19.5 12C19.5 12.2761 19.7239 12.5 20 12.5Z',
      'M12 12.5C12.2761 12.5 12.5 12.2761 12.5 12C12.5 11.7239 12.2761 11.5 12 11.5C11.7239 11.5 11.5 11.7239 11.5 12C11.5 12.2761 11.7239 12.5 12 12.5Z',
      'M4 12.5C4.27614 12.5 4.5 12.2761 4.5 12C4.5 11.7239 4.27614 11.5 4 11.5C3.72386 11.5 3.5 11.7239 3.5 12C3.5 12.2761 3.72386 12.5 4 12.5Z',
    ], { fill: 'currentColor', strokeWidth: '2' }),
    // The input bar's menus (InputMenu.svelte, IntegrationsMenu.svelte,
    // ModelSelector/Selector.svelte) and their icons/*.svelte glyphs
    clip: icon(['M21.4383 11.6622L12.2483 20.8522C11.1225 21.9781 9.59552 22.6106 8.00334 22.6106C6.41115 22.6106 4.88418 21.9781 3.75834 20.8522C2.63249 19.7264 2 18.1994 2 16.6072C2 15.015 2.63249 13.4881 3.75834 12.3622L12.9483 3.17222C13.6989 2.42166 14.7169 2 15.7783 2C16.8398 2 17.8578 2.42166 18.6083 3.17222C19.3589 3.92279 19.7806 4.94077 19.7806 6.00222C19.7806 7.06368 19.3589 8.08166 18.6083 8.83222L9.40834 18.0222C9.03306 18.3975 8.52406 18.6083 7.99334 18.6083C7.46261 18.6083 6.95362 18.3975 6.57834 18.0222C6.20306 17.6469 5.99222 17.138 5.99222 16.6072C5.99222 16.0765 6.20306 15.5675 6.57834 15.1922L15.0683 6.71222']),
    camera: icon(['M2 19V9C2 7.89543 2.89543 7 4 7H4.5C5.12951 7 5.72229 6.70361 6.1 6.2L8.32 3.24C8.43331 3.08892 8.61115 3 8.8 3H15.2C15.3889 3 15.5667 3.08892 15.68 3.24L17.9 6.2C18.2777 6.70361 18.8705 7 19.5 7H20C21.1046 7 22 7.89543 22 9V19C22 20.1046 21.1046 21 20 21H4C2.89543 21 2 20.1046 2 19Z', 'M12 17C14.2091 17 16 15.2091 16 13C16 10.7909 14.2091 9 12 9C9.79086 9 8 10.7909 8 13C8 15.2091 9.79086 17 12 17Z']),
    globeAlt: icon(['M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418']),
    documentArrowUp: icon(['M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m6.75 12-3-3m0 0-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z']),
    pageEdit: icon(['M20 12V5.74853C20 5.5894 19.9368 5.43679 19.8243 5.32426L16.6757 2.17574C16.5632 2.06321 16.4106 2 16.2515 2H4.6C4.26863 2 4 2.26863 4 2.6V21.4C4 21.7314 4.26863 22 4.6 22H11', 'M8 10H16M8 6H12M8 14H11', 'M17.9541 16.9394L18.9541 15.9394C19.392 15.5015 20.102 15.5015 20.5399 15.9394V15.9394C20.9778 16.3773 20.9778 17.0873 20.5399 17.5252L19.5399 18.5252M17.9541 16.9394L14.963 19.9305C14.8131 20.0804 14.7147 20.2741 14.6821 20.4835L14.4394 22.0399L15.9957 21.7973C16.2052 21.7646 16.3988 21.6662 16.5487 21.5163L19.5399 18.5252M17.9541 16.9394L19.5399 18.5252', 'M16 2V5.4C16 5.73137 16.2686 6 16.6 6H20']),
    database: icon(['M5 12V18C5 18 5 21 12 21C19 21 19 18 19 18V12', 'M5 6V12C5 12 5 15 12 15C19 15 19 12 19 12V6', 'M12 3C19 3 19 6 19 6C19 6 19 9 12 9C5 9 5 6 5 6C5 6 5 3 12 3Z']),
    clockRotateRight: icon(['M12 6L12 12L18 12', 'M21.8883 10.5C21.1645 5.68874 17.013 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C16.1006 22 19.6248 19.5318 21.1679 16', 'M17 16H21.4C21.7314 16 22 16.2686 22 16.6V21']),
    chevronRightAlt: icon(['m8.25 4.5 7.5 7.5-7.5 7.5']),
    chevronLeft: icon(['M15.75 19.5 8.25 12l7.5-7.5']),
    wrench: icon(['M21.75 6.75a4.5 4.5 0 0 1-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 1 1-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 0 1 6.336-4.486l-3.276 3.276a3.004 3.004 0 0 0 2.25 2.25l3.276-3.276c.256.565.398 1.192.398 1.852Z', 'M4.867 19.125h.008v.008h-.008v-.008Z']),
    searchAlt: icon(['m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z'], { strokeWidth: '2' }),
    photo: icon(['M21 7.6V20.4C21 20.7314 20.7314 21 20.4 21H7.6C7.26863 21 7 20.7314 7 20.4V7.6C7 7.26863 7.26863 7 7.6 7H20.4C20.7314 7 21 7.26863 21 7.6Z', 'M18 4H4.6C4.26863 4 4 4.26863 4 4.6V18', 'M7 16.8L12.4444 15L21 18', 'M16.5 13C15.6716 13 15 12.3284 15 11.5C15 10.6716 15.6716 10 16.5 10C17.3284 10 18 10.6716 18 11.5C18 12.3284 17.3284 13 16.5 13Z']),
    terminal: icon(['M13 16H18', 'M6 8L10 12L6 16', 'M2 18V6C2 4.89543 2.89543 4 4 4H20C21.1046 4 22 4.89543 22 6V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18Z'], { strokeWidth: '1.75' }),
    check: icon(['m4.5 12.75 6 6 9-13.5']),
    keyframes: icon(['M13.8476 13.317L9.50515 18.2798C8.70833 19.1905 7.29167 19.1905 6.49485 18.2798L2.15238 13.317C1.49259 12.563 1.49259 11.437 2.15238 10.683L6.49485 5.72018C7.29167 4.80952 8.70833 4.80952 9.50515 5.72017L13.8476 10.683C14.5074 11.437 14.5074 12.563 13.8476 13.317Z', 'M13 19L17.8844 13.3016C18.5263 12.5526 18.5263 11.4474 17.8844 10.6984L13 5', 'M17 19L21.8844 13.3016C22.5263 12.5526 22.5263 11.4474 21.8844 10.6984L17 5'], { strokeWidth: '2' }),
    documentPage: icon(['M4 21.4V2.6C4 2.26863 4.26863 2 4.6 2H16.2515C16.4106 2 16.5632 2.06321 16.6757 2.17574L19.8243 5.32426C19.9368 5.43679 20 5.5894 20 5.74853V21.4C20 21.7314 19.7314 22 19.4 22H4.6C4.26863 22 4 21.7314 4 21.4Z', 'M8 10L16 10', 'M8 18L16 18', 'M8 14L12 14', 'M16 2V5.4C16 5.73137 16.2686 6 16.6 6H20']),
    // The feature pills draw their icons a little heavier (MessageInput.svelte)
    globePill: icon(['M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418'], { strokeWidth: '1.75' }),
    photoPill: icon(['M21 7.6V20.4C21 20.7314 20.7314 21 20.4 21H7.6C7.26863 21 7 20.7314 7 20.4V7.6C7 7.26863 7.26863 7 7.6 7H20.4C20.7314 7 21 7.26863 21 7.6Z', 'M18 4H4.6C4.26863 4 4 4.26863 4 4.6V18', 'M7 16.8L12.4444 15L21 18', 'M16.5 13C15.6716 13 15 12.3284 15 11.5C15 10.6716 15.6716 10 16.5 10C17.3284 10 18 10.6716 18 11.5C18 12.3284 17.3284 13 16.5 13Z'], { strokeWidth: '1.75' }),
    terminalPill: icon(['M13 16H18', 'M6 8L10 12L6 16', 'M2 18V6C2 4.89543 2.89543 4 4 4H20C21.1046 4 22 4.89543 22 6V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18Z'], { strokeWidth: '2' }),
    wrenchPill: icon(['M21.75 6.75a4.5 4.5 0 0 1-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 1 1-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 0 1 6.336-4.486l-3.276 3.276a3.004 3.004 0 0 0 2.25 2.25l3.276-3.276c.256.565.398 1.192.398 1.852Z', 'M4.867 19.125h.008v.008h-.008v-.008Z'], { strokeWidth: '1.75' }),
    // Navbar: Temporary Chat on (ChatBubbleDottedChecked), the placeholder's
    // EyeSlash, and Chat Controls' collapsible chevrons and close button
    chatBubbleDottedChecked: icon(['M8 12L11 15L16 10', '<path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 13.8214 2.48697 15.5291 3.33782 17L2.5 21.5L7 20.6622C8.47087 21.513 10.1786 22 12 22Z" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2.5 3.5"></path>']),
    eyeSlash: icon(['M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88'], { strokeWidth: '2' }),
    chevronUpSm: icon(['m4.5 15.75 7.5-7.5 7.5 7.5'], { strokeWidth: '2' }),
    chevronDownSm: icon(['m19.5 8.25-7.5 7.5-7.5-7.5'], { strokeWidth: '2' }),
    chevronRightSm: icon(['m8.25 4.5 7.5 7.5-7.5 7.5'], { strokeWidth: '2' }),
    chevronRightBold: icon(['m8.25 4.5 7.5 7.5-7.5 7.5'], { strokeWidth: '3' }),
    close: icon(['M6 18 18 6M6 6l12 12']),
    // Sidebar/icons for the chat menu and the user menu
    share: icon(['M18 22C19.6569 22 21 20.6569 21 19C21 17.3431 19.6569 16 18 16C16.3431 16 15 17.3431 15 19C15 20.6569 16.3431 22 18 22Z', 'M18 8C19.6569 8 21 6.65685 21 5C21 3.34315 19.6569 2 18 2C16.3431 2 15 3.34315 15 5C15 6.65685 16.3431 8 18 8Z', 'M6 15C7.65685 15 9 13.6569 9 12C9 10.3431 7.65685 9 6 9C4.34315 9 3 10.3431 3 12C3 13.6569 4.34315 15 6 15Z', '<path d="M15.5 6.5L8.5 10.5" stroke-linecap="butt" stroke-linejoin="miter"/>', '<path d="M8.5 13.5L15.5 17.5" stroke-linecap="butt" stroke-linejoin="miter"/>']),
    download: icon(['M6 20L18 20', 'M12 4V16M12 16L15.5 12.5M12 16L8.5 12.5']),
    chatCheck: icon(['M8 12L11 15L16 10', 'M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 13.8214 2.48697 15.5291 3.33782 17L2.5 21.5L7 20.6622C8.47087 21.513 10.1786 22 12 22Z']),
    pin: icon(['M9.5 14.5L3 21', 'M5.00007 9.48528L14.1925 18.6777L15.8895 16.9806L15.4974 13.1944L21.0065 8.5211L15.1568 2.67141L10.4834 8.18034L6.69713 7.78823L5.00007 9.48528Z']),
    pinSlash: icon(['M9.5 14.5L3 21', 'M7.67602 7.8896L6.69713 7.78823L5.00007 9.48528L14.1925 18.6777L15.8895 16.9806L15.7879 16M11.4847 7L15.1568 2.67141L21.0065 8.5211L16.6991 12.175', 'M3 3L21 21']),
    copy: icon(['M19.4 20H9.6C9.26863 20 9 19.7314 9 19.4V9.6C9 9.26863 9.26863 9 9.6 9H19.4C19.7314 9 20 9.26863 20 9.6V19.4C20 19.7314 19.7314 20 19.4 20Z', 'M15 9V4.6C15 4.26863 14.7314 4 14.4 4H4.6C4.26863 4 4 4.26863 4 4.6V14.4C4 14.7314 4.26863 15 4.6 15H9']),
    folder: icon(['M2 11V4.6C2 4.26863 2.26863 4 2.6 4H8.77805C8.92127 4 9.05977 4.05124 9.16852 4.14445L12.3315 6.85555C12.4402 6.94876 12.5787 7 12.722 7H21.4C21.7314 7 22 7.26863 22 7.6V11M2 11V19.4C2 19.7314 2.26863 20 2.6 20H21.4C21.7314 20 22 19.7314 22 19.4V11M2 11H22']),
    archiveBox: icon(['m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z'], { strokeWidth: '1.7' }),
    trash: icon(['M20 9L18.005 20.3463C17.8369 21.3026 17.0062 22 16.0353 22H7.96474C6.99379 22 6.1631 21.3026 5.99496 20.3463L4 9', 'M21 6L15.375 6M3 6L8.625 6M8.625 6V4C8.625 2.89543 9.52043 2 10.625 2H13.375C14.4796 2 15.375 2.89543 15.375 4V6M8.625 6L15.375 6']),
    cog: icon(['M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z', 'M15 12a3 3 0 11-6 0 3 3 0 016 0z']),
    logOut: icon(['M12 12H19M19 12L16 15M19 12L16 9', 'M19 6V5C19 3.89543 18.1046 3 17 3H7C5.89543 3 5 3.89543 5 5V19C5 20.1046 5.89543 21 7 21H17C18.1046 21 19 20.1046 19 19V18']),
    emojiFace: icon(['M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22Z', 'M16.5 14.5C16.5 14.5 15 16.5 12 16.5C9 16.5 7.5 14.5 7.5 14.5', '<path fill="currentColor" d="M15.5 9C15.2239 9 15 8.77614 15 8.5C15 8.22386 15.2239 8 15.5 8C15.7761 8 16 8.22386 16 8.5C16 8.77614 15.7761 9 15.5 9Z"/>', '<path fill="currentColor" d="M8.5 9C8.22386 9 8 8.77614 8 8.5C8 8.22386 8.22386 8 8.5 8C8.77614 8 9 8.22386 9 8.5C9 8.77614 8.77614 9 8.5 9Z"/>']),
    user: icon(['M5 20V19C5 15.134 8.13401 12 12 12V12C15.866 12 19 15.134 19 19V20', 'M12 12C14.2091 12 16 10.2091 16 8C16 5.79086 14.2091 4 12 4C9.79086 4 8 5.79086 8 8C8 10.2091 9.79086 12 12 12Z']),
    // Channels: Hashtag, Lock, and the message toolbar's icons
    hashtag: icon(['M10 3L6 21', 'M20.5 16H2.5', 'M22 7H4', 'M18 3L14 21']),
    lock: icon(['M16 12H17.4C17.7314 12 18 12.2686 18 12.6V19.4C18 19.7314 17.7314 20 17.4 20H6.6C6.26863 20 6 19.7314 6 19.4V12.6C6 12.2686 6.26863 12 6.6 12H8M16 12V8C16 6.66667 15.2 4 12 4C8.8 4 8 6.66667 8 8V12M16 12H8'], { strokeWidth: '1.7' }),
    faceSmile: icon(['M15.182 15.182a4.5 4.5 0 0 1-6.364 0M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z']),
    arrowUpLeftAlt: icon(['M10.25 4.75L6.75 8.25L10.25 11.75', 'M6.75 8.25L12.75 8.25C14.9591 8.25 16.75 10.0409 16.75 12.25V19.25']),
    chatBubbleEllipsis: icon(['M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z']),
    pencil: icon(['M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125']),
    garbageBin: icon(['M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0']),
    // channel/MessageInput.svelte's inline 20- and 16-unit filled glyphs
    plusSolid: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z"/></svg>',
    micSolid: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z"/><path d="M5.5 9.643a.75.75 0 00-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-1.5v-1.546A6.001 6.001 0 0016 10v-.357a.75.75 0 00-1.5 0V10a4.5 4.5 0 01-9 0v-.357z"/></svg>',
    arrowUpSolid: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M8 14a.75.75 0 0 1-.75-.75V4.56L4.03 7.78a.75.75 0 0 1-1.06-1.06l4.5-4.5a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1-1.06 1.06L8.75 4.56v8.69A.75.75 0 0 1 8 14Z" clip-rule="evenodd"/></svg>',
    // icons/XMark.svelte: a 20-unit filled glyph, unlike the stroked set
    xMark: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/></svg>',
  };

  // ResponseMessage.svelte's action row — inline SVGs rather than components,
  // all w-4 h-4 at stroke-width 2.3. Read Aloud uses its idle (unmuted) state.
  const ACTION_SVG = {
    edit: icon(['M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125'], { strokeWidth: '2.3' }),
    copy: icon(['M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184'], { strokeWidth: '2.3' }),
    speak: icon(['M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z'], { strokeWidth: '2.3' }),
    thumbUp: icon(['M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3'], { strokeWidth: '2.3' }),
    thumbDown: icon(['M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17'], { strokeWidth: '2.3' }),
    continueResponse: icon(['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'M15.91 11.672a.375.375 0 0 1 0 .656l-5.603 3.113a.375.375 0 0 1-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112Z'], { strokeWidth: '2.3' }),
    // sibling pager chevrons (ResponseMessage.svelte ~L907/L978, size-3.5 at
    // stroke-width 2.5)
    prevMsg: icon(['M15.75 19.5 8.25 12l7.5-7.5'], { strokeWidth: '2.5' }),
    nextMsg: icon(['m8.25 4.5 7.5 7.5-7.5 7.5'], { strokeWidth: '2.5' }),
    // ResponseMessage.svelte "Generation Info" button (id="info-{id}"), shown
    // when message.usage exists, between Read Aloud and Good Response
    info: icon(['M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z'], { strokeWidth: '2.3' }),
    regenerate: icon(['M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99'], { strokeWidth: '2.3' }),
    // UserMessage.svelte:591 — Delete is drawn at stroke-width 2, not 2.3
    trash: icon(['m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0'], { strokeWidth: '2' }),
  };

  // Tooltip contents match the upstream <Tooltip content=...> wrappers, which
  // all use placement="bottom" on message action buttons.
  const ACTION_LABELS = {
    edit: 'Edit', copy: 'Copy', speak: 'Read Aloud', thumbUp: 'Good Response',
    thumbDown: 'Bad Response', continueResponse: 'Continue Response',
    regenerate: 'Regenerate', trash: 'Delete',
  };
  function actionBtn(k, extraClass) {
    return '<span class="msg-action' + (extraClass || '') + '" data-tip="' + ACTION_LABELS[k] +
      '" data-tip-placement="bottom">' + ACTION_SVG[k] + '</span>';
  }

  const CHAT_MENU = '<span class="chat-actions"><span class="chat-menu-btn" data-tip="More">' + SVG.moreHorizontal + '</span></span>';

  // UserMessage.svelte's Edit + Copy pair (same two glyphs the assistant row
  // uses), plus Delete — which L578 gates on `!isFirstMessage || siblings > 1`,
  // so the opening message of a conversation never carries it.
  function userActions(withDelete) {
    return '<div class="user-actions">' +
      ['edit', 'copy'].map(function (k) { return actionBtn(k); }).join('') +
      (withDelete ? actionBtn('trash', ' delete') : '') +
      '</div>';
  }
  const USER_ACTIONS = userActions(false);
  const USER_ACTIONS_DEL = userActions(true);

  // common/Collapsible.svelte with attributes.type === 'reasoning': the
  // "Thought for X seconds" trigger plus the reasoning body, which the
  // middleware emits as a blockquote. Collapsed by default like upstream
  // ($settings.expandDetails defaults false).
  function thoughtBlock(t) {
    if (!t) return '';
    return '<div class="thought" role="button">Thought for ' + t.seconds + ' seconds' + SVG.chevronDown + '</div>' +
      '<div class="thought-body markdown-prose" hidden><blockquote>' + t.body + '</blockquote></div>';
  }

  // Full message rows in Open WebUI's DOM shape (Message.svelte row >
  // UserMessage/ResponseMessage flex > chat-{role} block). Literal utility
  // class strings ride along so preset CSS written against the app's markup —
  // .user-message .rounded-3xl, [class*="bg-gray-"] — matches here too.
  function userRow(text, notFirst) {
    return '<div class="message-listitem group"><div class="msg user-message group">' +
      '<div class="chat-user w-full min-w-full">' +
      '<div class="bubble-row"><div class="bubble rounded-3xl max-w-[90%] px-4 py-1.5 bg-gray-50 dark:bg-gray-850"><div class="markdown-prose">' + text + '</div></div></div>' +
      userActions(!!notFirst) +
      '</div></div></div>';
  }
  // Sibling pager (ResponseMessage.svelte ~L900-995): chevron buttons around
  // a tracking-widest "i/n" count, leading the action row of each variant.
  function branchPager(i, n) {
    return '<div class="branch-pager">' +
      '<span class="branch-nav branch-prev">' + ACTION_SVG.prevMsg + '</span>' +
      '<span class="branch-count">' + (i + 1) + '/' + n + '</span>' +
      '<span class="branch-nav branch-next">' + ACTION_SVG.nextMsg + '</span>' +
      '</div>';
  }

  // A response with regenerated variants. Each variant carries its own stats
  // line, reasoning, body, actions (with per-variant Generation Info) and
  // follow-ups; only the first is visible until the pager switches.
  function aiRowMulti(variants) {
    var n = variants.length;
    return '<div class="message-listitem group"><div class="msg">' +
      '<div class="ai-avatar"><img src="' + LOGO + '" alt=""></div>' +
      '<div class="ai-col flex-auto w-0 pl-1 relative">' +
      '<div class="ai-model">Preview Model</div>' +
      '<div class="branches">' +
      variants.map(function (v, i) {
        return '<div class="branch' + (i === 0 ? ' active' : '') + '">' +
          '<div class="ai-stats">' + v.stats + '</div>' +
          '<div class="chat-assistant w-full min-w-full">' +
          thoughtBlock(v.thought) +
          '<div class="markdown-prose">' + v.body + '</div>' +
          msgActions(v.stats, n > 1 ? branchPager(i, n) : '') +
          followUps(v.fups || null) +
          '</div></div>';
      }).join('') +
      '</div></div></div></div>';
  }
  function aiRow(stats, body, fups, t) {
    return aiRowMulti([{ stats: stats, body: body, fups: fups, thought: t }]);
  }

  // FollowUps.svelte — hairline-separated rows under a "Follow up" heading
  function followUps(items) {
    if (!items || !items.length) return '';
    return '<div class="followups-wrap"><div class="followups">' +
      '<div class="followups-title">Follow up</div><div class="followups-list">' +
      items.map(function (q, i) {
        return '<div class="followup" data-tip="' + q + '">' + q + '</div>' + (i < items.length - 1 ? '<hr>' : '');
      }).join('') +
      '</div></div></div>';
  }

  // The row Open WebUI renders under a finished assistant reply, in source order.
  function statsTip(stats) {
    return String(stats || '').split(' | ').join('\n');
  }

  function msgActions(stats, pagerHtml) {
    return '<div class="msg-actions">' + (pagerHtml || '') +
      ['edit', 'copy', 'speak'].map(function (k) { return actionBtn(k); }).join('') +
      '<span class="msg-action" data-tip="' + esc(statsTip(stats)) + '" data-tip-placement="bottom">' + ACTION_SVG.info + '</span>' +
      ['thumbUp', 'thumbDown', 'continueResponse', 'regenerate'].map(function (k) { return actionBtn(k); }).join('') +
      '</div>';
  }
  // Template for the in-iframe script: it swaps the placeholder for each
  // message's own stats when building rows on chat switch.
  const MSG_ACTIONS_TPL = msgActions('__TDP_STATS__');

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function buildMockSrcdoc(opts) {
    // opts: { modeKey, vars, customCSS, transparent }
    // Layout metrics mirror Open WebUI's components: 245px sidebar
    // (stores/index.ts), 13px sidebar rows, text-xs time-range labels,
    // max-w-3xl chat column, 0.9375rem prose (markdown-prose), size-7
    // rounded-2xl avatars, rounded-3xl gray-850 user bubbles, and the
    // translucent shadowed rounded-3xl input shell (MessageInput.svelte).
    const isLight = opts.modeKey === 'light' || opts.modeKey === 'her';
    const safeCSS = String(opts.customCSS || '').replace(/<\//g, '<\\/');
    const htmlClass = opts.modeKey === 'her' ? 'her' : isLight ? 'light' : 'dark';
    const dataTheme = opts.modeKey === 'oled' ? 'oled-dark' : htmlClass;
    // OLED renders on true black in Open WebUI (gray-800..950 forced to
    // #101010/#050505/#000/#000) — apply the same values over any palette.
    const varsOut = Object.assign({}, opts.vars);
    if (opts.modeKey === 'oled') {
      varsOut['--color-gray-800'] = '#101010';
      varsOut['--color-gray-850'] = '#050505';
      varsOut['--color-gray-900'] = '#000000';
      varsOut['--color-gray-950'] = '#000000';
    }
    const varLines = Object.entries(varsOut).map(([k, v]) => `  ${k}: ${v};`).join('\n');

    const bg = isLight ? '#ffffff' : 'var(--color-gray-900)';
    const sidebarBg = isLight ? 'var(--color-gray-50)' : 'var(--color-gray-950)';
    const textMain = isLight ? 'var(--color-gray-800)' : 'var(--color-gray-100)';
    const textSoft = isLight ? 'var(--color-gray-700)' : 'var(--color-gray-300)';
    const textMuted = isLight ? 'var(--color-gray-500)' : 'var(--color-gray-500)';
    const textFaint = isLight ? 'var(--color-gray-400)' : 'var(--color-gray-600)';
    const border = isLight ? 'var(--color-gray-100)' : 'var(--color-gray-800)';
    const borderSubtle = isLight
      ? 'color-mix(in srgb, var(--color-gray-100) 40%, transparent)'
      : 'color-mix(in srgb, var(--color-gray-850) 30%, transparent)';
    const bubble = isLight ? 'var(--color-gray-50)' : 'var(--color-gray-850)';
    const codeBg = isLight ? 'var(--color-gray-50)' : 'var(--color-gray-800)';
    const itemHover = isLight ? 'var(--color-gray-50)' : 'var(--color-gray-900)';
    const navHover = isLight
      ? 'color-mix(in srgb, var(--color-gray-50) 40%, transparent)'
      : 'color-mix(in srgb, var(--color-gray-800) 40%, transparent)';
    const activeItem = isLight ? 'rgb(0 0 0 / 0.035)' : 'rgb(255 255 255 / 0.045)';
    const iconHover = isLight ? 'var(--color-gray-100)' : 'var(--color-gray-800)';
    const ghostHover = isLight ? 'rgb(0 0 0 / 0.05)' : 'rgb(255 255 255 / 0.05)';
    // Chat prose colors are NOT themed in Open WebUI: the typography plugin
    // bakes its palette from @theme (tailwind.css:5-18) as literals at build
    // time, so --color-gray-* overrides never reach message text — only
    // utility classes (stats line, sidebar, follow-ups) follow the theme.
    // These literals are the baked values: prose body gray-700 / invert
    // body gray-300.
    const proseText = isLight ? 'oklch(0.42 0 0)' : 'oklch(0.85 0 0)';
    const proseBold = isLight ? 'oklch(0.2 0 0)' : '#fff';
    const ageText = isLight ? 'var(--color-gray-400)' : 'var(--color-gray-500)';
    const codeBlockBg = isLight ? '#ffffff' : '#000000';
    const inputBg = isLight
      ? 'color-mix(in srgb, #ffffff 5%, transparent)'
      : 'color-mix(in srgb, var(--color-gray-500) 5%, transparent)';

    const hasInnerFx = !!(opts.canvasScript || opts.gradient);
    const effectsOn = opts.transparent || hasInnerFx;
    const structural = effectsOn
      ? `
  ${opts.transparent ? 'body { background: transparent !important; }' : ''}
  .app, main, nav { background: transparent !important; }
  #sidebar { background: color-mix(in srgb, ${sidebarBg} 72%, transparent) !important; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
  #chat-input-container { background: color-mix(in srgb, ${isLight ? '#ffffff' : 'var(--color-gray-900)'} 72%, transparent) !important; }
  .chat-user .bubble { background: transparent; }`
      : '';
    // In-iframe gradient: body background layers, exactly like the designer's
    // gradient section (emitted before custom CSS so cascade order matches)
    const g = opts.gradient;
    const gradientCSS = g
      ? `body { ${g.background ? `background-color: ${g.background} !important;` : ''} background-image: ${g.backgroundImage} !important; background-attachment: fixed !important; ${g.animated ? `background-size: 300% 300% !important; animation: tdp-preview-gradient-shift ${g.speed}s ease infinite;` : ''} }
${g.animated ? '@keyframes tdp-preview-gradient-shift { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }' : ''}`
      : '';

    return `<!DOCTYPE html>
<html class="${htmlClass}" data-theme="${dataTheme}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
:root {
${varLines}
}
* { box-sizing: border-box; margin: 0; }
/* --app-text-scale is Open WebUI's UI Scale mechanism (app.css:27-36): the
   Interface-settings slider sets the var and html font-size scales every
   rem-based size. Px-based chrome (sidebar, nav) stays fixed, as upstream. */
:root { --app-text-scale: 1; }
html { font-size: calc(1rem * var(--app-text-scale, 1)); }
html, body { height: 100%; }
body { background: ${bg}; font-family: -apple-system, BlinkMacSystemFont, 'Inter', ui-sans-serif, 'Segoe UI', Roboto, sans-serif; color: ${proseText}; overflow: hidden; font-size: 0.9375rem; -webkit-font-smoothing: antialiased; }
svg { width: 1rem; height: 1rem; flex-shrink: 0; }
.app { display: flex; height: 100vh; position: relative; }

/* Sidebar.svelte: w-[var(--sidebar-width)]=245px, border-e, px-1 rows,
   rounded-xl px-2 py-1.5 nav items, size-4 icons, text-[13px] leading-5.
   Collapsing swaps it for the w-[42px] rail (Sidebar.svelte L806-974); the
   panel itself uses transition:slide{duration:250,axis:'x'}. */
/* Sidebar.svelte:985 — the expanded panel is bg-gray-50/70 dark:bg-gray-950/70
   on desktop (opaque only on mobile, see the media query below). Painting it
   fully opaque here made any theme-applied border-radius cut a hard wedge of
   body colour out of each corner. */
.sidebar-panel { width: 245px; flex-shrink: 0; background: color-mix(in srgb, ${sidebarBg} 70%, transparent); border-right: 1px solid ${borderSubtle}; padding: 6px 4px 4px; display: flex; flex-direction: column; overflow: hidden; transition: width 250ms ease, opacity 150ms ease; }
/* min-width:0 is required — flex items default to min-width:auto, which would
   floor the panel at its nowrap content width and defeat width:0 */
.app.collapsed .sidebar-panel { width: 0; min-width: 0; padding-left: 0; padding-right: 0; border-right-width: 0; opacity: 0; pointer-events: none; }

/* The collapsed rail: w-[42px] py-1 px-1, justify-between, border-e-[0.5px] */
/* Sidebar.svelte:808 — the rail carries no background class at all, just a
   hover tint, so whatever is behind the app shows straight through it */
.sidebar-rail { display: none; width: 42px; flex-shrink: 0; padding: 4px; flex-direction: column; justify-content: space-between; align-items: center; background: transparent; border-right: 0.5px solid ${borderSubtle}; color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-300)'}; overflow: hidden; cursor: pointer; transition: background 0.15s; }
.app.collapsed .sidebar-rail { display: flex; }
/* hover:bg-gray-50/30 dark:hover:bg-gray-800/30 — a tint, not a fill */
.sidebar-rail:hover { background: ${isLight ? 'color-mix(in srgb, var(--color-gray-50) 30%, transparent)' : 'color-mix(in srgb, var(--color-gray-800) 30%, transparent)'}; }
.rail-group { display: flex; flex-direction: column; align-items: center; }
/* size-8.5 / size-8 hit areas wrapping a size-[30px] rounded-lg hover target */
.rail-btn { width: 2rem; height: 2rem; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.rail-btn.lg { width: 2.125rem; height: 2.125rem; }
.rail-btn > span { width: 1.875rem; height: 1.875rem; border-radius: 8px; display: flex; align-items: center; justify-content: center; transition: background 0.15s; }
.rail-btn:hover > span { background: ${navHover}; }
.rail-btn svg { width: 1rem; height: 1rem; }
/* the logo swaps to the sidebar-toggle glyph on hover (group-hover:hidden) */
.rail-logo img { width: 1.25rem; height: 1.25rem; border-radius: 50%; object-fit: cover; }
.rail-logo svg { display: none; }
.rail-logo:hover img { display: none; }
.rail-logo:hover svg { display: block; }
.rail-avatar { width: 1.375rem; height: 1.375rem; border-radius: 50%; background: linear-gradient(135deg, #6366f1, #ec4899); }
.brand { display: flex; align-items: center; gap: 2px; padding: 0 0 6px; color: ${textMain}; }
.brand-dot { width: 2.125rem; height: 2.125rem; border-radius: 12px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.brand-dot img { width: 1.25rem; height: 1.25rem; border-radius: 50%; object-fit: cover; }
.brand .brand-name { flex: 1; padding: 0 2px; font-size: 0.875rem; font-weight: 400; color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-200)'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.brand .panel-icon { width: 1.875rem; height: 1.875rem; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: ${textMuted}; }
.brand .panel-icon svg { width: 1rem; height: 1rem; }
.brand-dot:hover, .brand .panel-icon:hover { background: ${navHover}; }
.side-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.375rem 0.5rem; margin: 0 4px; border-radius: 12px; color: ${textSoft}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.8125rem; line-height: 1.25rem; }
.side-item svg { width: 1rem; height: 1rem; color: ${textSoft}; }
.side-item { cursor: pointer; transition: background 0.15s; }
.side-item:hover { background: ${navHover}; }
.side-scroll .side-item { padding: 6px 8px; }
.side-scroll .side-item:hover { background: ${itemHover}; }
.side-item.active, .side-scroll .side-item.active:hover { background: ${activeItem}; color: ${isLight ? 'var(--color-gray-800)' : 'var(--color-gray-200)'}; }
.side-item .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.side-item .age { flex-shrink: 0; padding-left: 8px; font-size: 0.625rem; color: ${ageText}; }
/* ChatItem.svelte: the menu sits absolute right-1 inset-y-0 mr-1.5 and is
   invisible until hover (or always, on the selected chat, which also swaps
   the time-ago indicator out and pads the title with pr-12) */
.side-scroll .side-item[data-chat] { position: relative; }
.chat-actions { position: absolute; top: 0; bottom: 0; right: 4px; margin-right: 6px; display: flex; align-items: center; visibility: hidden; }
.side-item:hover .chat-actions, .side-item.active .chat-actions { visibility: visible; }
.side-item:hover .age, .side-item.active .age { display: none; }
.side-item:hover .label, .side-item.active .label { padding-right: 20px; }
.chat-menu-btn { width: 1.25rem; height: 1.25rem; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: color 0.15s; }
.chat-menu-btn svg { width: 0.875rem; height: 0.875rem; }
.chat-menu-btn:hover { color: ${isLight ? '#000' : '#fff'}; }
.side-item .add { margin-left: auto; color: ${textFaint}; }
.side-item .add svg { width: 0.75rem; height: 0.75rem; }
/* Section.svelte: text-xs gray-400/gray-500 header with a size-3.5 Plus */
.side-label { font-size: 0.75rem; color: ${isLight ? 'var(--color-gray-400)' : 'var(--color-gray-500)'}; padding: 0.75rem 0.25rem 0.25rem 0.625rem; display: flex; align-items: center; }
.side-label .add { margin-left: auto; color: inherit; }
.side-label .add svg { width: 0.875rem; height: 0.875rem; }
.side-label .add:hover { color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; }
.side-pinned { display: flex; align-items: center; gap: 6px; margin: 0 4px; padding: 6px 8px; border-radius: 12px; color: ${textSoft}; font-size: 0.8125rem; line-height: 1.25rem; }
.side-pinned svg { width: 0.6875rem; height: 0.6875rem; }
.side-pinned:hover { background: ${itemHover}; }
.side-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; scrollbar-width: none; padding-top: 2px; }
.side-scroll::-webkit-scrollbar { display: none; }
.side-user { display: flex; align-items: center; gap: 8px; margin: 0 4px; padding: 6px 8px; border-radius: 12px; color: ${textMain}; font-weight: 400; font-size: 0.8125rem; line-height: 1.25rem; cursor: pointer; transition: background 0.15s; }
.side-user:hover { background: ${navHover}; }
.side-label .add, .side-pinned, .brand .panel-icon, .brand-dot { cursor: pointer; transition: background 0.15s, color 0.15s; }
.avatar { width: 1.375rem; height: 1.375rem; border-radius: 50%; background: linear-gradient(135deg, #6366f1, #ec4899); flex-shrink: 0; }
.avatar.sm { width: 1.25rem; height: 1.25rem; border-radius: 50%; }

main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
/* Navbar.svelte: pt-0.5 pb-1, pl-1.5 pr-1, title text-[15px] gray-700/300,
   size-6 rounded-lg icon buttons, and the -bottom-10 gradient scrim */
nav { padding: 2px 4px 4px 6px; display: flex; align-items: center; gap: 8px; color: ${textMain}; position: relative; z-index: 2; flex-shrink: 0; }
${opts.transparent ? '' : `nav::before { content: ''; position: absolute; inset: 0 0 -40px 0; background: linear-gradient(to bottom, color-mix(in srgb, ${bg} 90%, transparent), color-mix(in srgb, ${bg} 50%, transparent) 40%, transparent 97%); z-index: -1; pointer-events: none; }`}
#nav-title { padding: 4px 4px 4px 6px; font-size: 0.9375rem; font-weight: 400; color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-300)'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
nav .nav-btn { width: 1.5rem; height: 1.5rem; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; cursor: pointer; transition: background 0.15s, color 0.15s; }
nav .nav-btn svg { width: 1.125rem; height: 1.125rem; }
nav .nav-btn.controls svg { width: 1.25rem; height: 1.25rem; }
nav .nav-btn:hover { background: ${navHover}; color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-200)'}; }
nav .right { margin-left: auto; display: flex; align-items: center; gap: 8px; padding-right: 4px; }
/* Temporary Chat only renders when there's no chat id — i.e. on New Chat */
nav .right .temp-chat { display: none; }
nav .right.is-new .temp-chat { display: flex; }
/* Navbar.svelte:117 gates the title block (and the chat menu inside it) on
   chat?.id, so New Chat shows neither */
nav.is-new #nav-title, nav.is-new .nav-chat-menu { display: none; }

/* Messages.svelte: rows are max-w-[58rem] px-5 mb-3 inside a full-width scroller */
#messages-container { flex: 1; overflow: hidden; padding: 8px 0 6px; display: flex; flex-direction: column; width: 100%; }
#messages-container > .message-listitem { max-width: 58rem; width: 100%; margin: 0 auto 12px; padding: 0 20px; }
/* The gallery's floating .preview-topbar overlays the stage, so the opening
   message has to start below it. The navbar deliberately stays put and sits
   under the bar. Only the first row is offset — the New Chat placeholder
   centres itself and must not be pushed off-centre. The value is measured at
   runtime (the bar wraps on narrow screens); this default covers desktop. */
#messages-container > .message-listitem:first-child { margin-top: var(--tdp-first-row-offset, 37px); }
/* Row anatomy mirrors the real DOM so preset CSS lands identically:
   Message.svelte row (.message-listitem) > flex wrapper (.msg, with
   UserMessage's .user-message class) > .chat-user / .chat-assistant, which
   upstream sit INSIDE the flex column (UserMessage:168, ResponseMessage:676)
   as w-full min-w-full blocks — not on the outer row. */
.msg { display: flex; width: 100%; }
.chat-user, .chat-assistant { width: 100%; min-width: 100%; }
.bubble-row { display: flex; justify-content: flex-end; padding-bottom: 4px; }
.chat-user .bubble { max-width: 90%; background: ${bubble}; border-radius: 24px; padding: 0.375rem 1rem; font-size: 1rem; line-height: 1.625; color: ${proseText}; }
/* UserMessage.svelte: Edit + Copy in a justify-end row. Upstream they are
   hover-gated (invisible group-hover:visible); the mock keeps them visible
   so the preview shows the full anatomy without interaction. */
.user-actions { display: flex; align-items: center; justify-content: flex-end; color: ${isLight ? 'var(--color-gray-600)' : 'var(--color-gray-500)'}; }
.ai-avatar { width: 1.75rem; height: 1.75rem; flex-shrink: 0; margin: 2px 8px 0 0; }
.ai-avatar img { width: 100%; height: 100%; border-radius: 16px; object-fit: cover; display: block; }
.ai-col { flex: 1; min-width: 0; padding-left: 4px; }
.ai-model { font-size: 1rem; font-weight: 400; color: ${isLight ? '#000' : '#fff'}; margin-bottom: 1px; line-height: 1.4; }
.ai-stats { font-size: 1rem; color: ${textFaint}; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* common/Collapsible.svelte reasoning trigger: w-fit py-1 text-[0.9375rem]
   text-gray-500 hover:text-gray-700 dark:hover:text-gray-300, size-3 chevron
   at stroke-width 2.75; expanded slot content wrapped in mb-1.5 */
.thought { width: fit-content; padding: 4px 0; display: flex; align-items: center; gap: 8px; font-size: 1rem; color: var(--color-gray-500); cursor: pointer; transition: color 0.15s; }
.thought:hover { color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-300)'}; }
.thought svg { width: 0.75rem; height: 0.75rem; transform: translateY(1px); transition: transform 0.15s; }
.thought.open svg { transform: translateY(1px) rotate(180deg); }
.thought-body { margin-bottom: 6px; }
.thought-body[hidden] { display: none; }
/* The DOM class in Open WebUI is markdown-prose (app.css:124); "prose" is
   only a Tailwind @apply and never appears as a literal class. Preset CSS
   targeting .prose must miss here exactly as it misses in the app. */
.markdown-prose { font-size: 1rem; line-height: 1.625; color: ${proseText}; }
.markdown-prose p { margin-bottom: 8px; }
.markdown-prose p:last-child { margin-bottom: 0; }
.markdown-prose b { color: ${proseBold}; font-weight: 500; }
.markdown-prose code { background: ${codeBg}; padding: 2px 6px; border-radius: 6px; font-family: ui-monospace, 'JetBrains Mono', monospace; font-size: 0.8em; color: ${textMain}; }
/* CodeBlock.svelte: rounded-2xl border my-0.5, header py-1.5 px-3.5 text-xs */
.code-block { border-radius: 16px; border: 1px solid ${borderSubtle}; background: ${codeBlockBg}; margin: 12px 0; overflow: hidden; }
.code-block-header { display: flex; align-items: center; justify-content: space-between; padding: 6px 14px; font-size: 0.75rem; color: ${isLight ? '#000' : '#fff'}; }
.code-block-header .cb-action { cursor: pointer; padding: 2px 6px; border-radius: 6px; font-size: 0.75rem; }
.code-block-header .cb-action:hover { opacity: 0.7; }
.markdown-prose pre { background: ${codeBlockBg}; padding: 10px 20px 16px; font-family: ui-monospace, 'JetBrains Mono', monospace; font-size: 0.875rem; line-height: 1.5; overflow: hidden; margin: 0; color: ${proseText}; }
.markdown-prose ul, .markdown-prose ol { margin: 8px 0 8px 22px; }
.markdown-prose li { margin: 2px 0; }
.markdown-prose blockquote { border-left: 2px solid ${border}; padding: 2px 0 2px 12px; color: ${isLight ? 'oklch(0.2 0 0)' : 'oklch(0.94 0 0)'}; margin: 12px 0; }
.markdown-prose a { color: ${proseBold}; text-decoration: underline; cursor: pointer; }
.markdown-prose table { border-collapse: collapse; margin: 6px 0 10px; font-size: 0.78125rem; }
.markdown-prose th, .markdown-prose td { border: 1px solid ${border}; padding: 5px 10px; text-align: left; }
.markdown-prose th { background: ${codeBg}; color: ${proseBold}; font-weight: 600; }
.markdown-prose h4 { font-size: 0.9375rem; font-weight: 600; color: ${proseBold}; margin: 8px 0 4px; }
/* Placeholder.svelte: max-w-[58rem] translate-y-6 centered block, size-10
   rounded-2xl model image, text-2xl name; Suggestions.svelte rows are
   borderless px-2.5 py-1.5 rounded-lg with text-sm / text-xs lines */
.placeholder { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; max-width: 58rem; width: 100%; margin: 0 auto; padding: 0 8px 24px; transform: translateY(24px); }
/* Logo, model name and greeting left-align with the Suggested column — the
   head shares the suggestion block's width and padding so their edges meet */
.ph-head { width: min(42rem, 100%); padding: 0 20px; display: flex; flex-direction: column; align-items: flex-start; text-align: left; }
.ph-logo { width: 2.5rem; height: 2.5rem; margin-bottom: 2px; }
.ph-logo img { width: 100%; height: 100%; border-radius: 16px; object-fit: cover; display: block; }
.ph-model { font-size: 1.875rem; line-height: 2.25rem; font-weight: 400; color: ${isLight ? 'var(--color-gray-800)' : 'var(--color-gray-100)'}; max-width: 36rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ph-sub { font-size: 1.875rem; line-height: 2.25rem; font-weight: 400; color: ${isLight ? 'var(--color-gray-600)' : 'var(--color-gray-400)'}; margin: 0 0 22px; }
.ph-suggest { width: min(42rem, 100%); padding: 0 20px; }
.ph-label { font-size: 0.75rem; line-height: 1.4; color: ${isLight ? 'var(--color-gray-600)' : 'var(--color-gray-400)'}; margin-bottom: 4px; display: flex; align-items: center; gap: 4px; }
.ph-label svg { width: 0.875rem; height: 0.875rem; }
.ph-grid { display: grid; grid-template-columns: 1fr 1fr; align-items: start; }
.ph-card { border-radius: 8px; padding: 6px 10px; cursor: pointer; background: transparent; transition: color 0.15s; text-align: left; }
.ph-card b { display: block; font-size: 1rem; line-height: 1.375; font-weight: 400; color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-300)'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ph-card span { display: block; font-size: 0.8125rem; line-height: 1.375; font-weight: 400; color: ${isLight ? 'var(--color-gray-600)' : 'var(--color-gray-400)'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ph-card:hover b { color: ${isLight ? 'var(--color-gray-950)' : '#fff'}; }
.ph-card:hover span { color: ${isLight ? 'var(--color-gray-900)' : 'var(--color-gray-100)'}; }
/* ResponseMessage.svelte action row: text-gray-600 dark:text-gray-500 mt-0.5,
   buttons p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 */
.msg-actions { display: flex; align-items: center; justify-content: flex-start; margin-top: 2px; color: ${isLight ? 'var(--color-gray-600)' : 'var(--color-gray-500)'}; }
.msg-action { padding: 6px; border-radius: 8px; display: flex; cursor: pointer; transition: background 0.15s, color 0.15s; }
.msg-action:hover { background: ${ghostHover}; color: ${isLight ? '#000' : '#fff'}; }
.msg-actions svg { width: 1rem; height: 1rem; }
/* UserMessage.svelte:580 — Delete is p-1 rounded-sm and, unlike the p-1.5
   rounded-lg Edit/Copy beside it, takes no background on hover */
.msg-action.delete { padding: 4px; border-radius: 2px; }
.msg-action.delete:hover { background: transparent; color: ${isLight ? '#000' : '#fff'}; }

/* Sibling branches: one variant visible at a time, switched by the pager */
.branch { display: none; }
.branch.active { display: block; }
.branch-pager { display: flex; align-items: center; }
.branch-nav { display: flex; align-self: center; padding: 4px; border-radius: 6px; cursor: pointer; transition: background 0.15s, color 0.15s; }
.branch-nav:hover { background: ${ghostHover}; color: ${isLight ? '#000' : '#fff'}; }
.branch-nav svg { width: 0.875rem; height: 0.875rem; }
.branch-count { font-size: 0.875rem; letter-spacing: 0.1em; font-weight: 400; align-self: center; white-space: nowrap; color: ${isLight ? 'var(--color-gray-900)' : 'var(--color-gray-100)'}; }

/* ResponseMessage/FollowUps.svelte, rendered in a my-2.5 wrapper after the
   action row and only on the last message: an mt-4 block with a text-sm
   heading and text-sm rows separated by hairlines */
.followups-wrap { margin: 10px 0; }
.followups { margin-top: 16px; }
.followups-title { font-size: 0.9375rem; font-weight: 400; color: ${proseText}; }
.followups-list { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.followup { padding: 4px 0; font-size: 0.9375rem; text-align: left; color: var(--color-gray-500); cursor: pointer; transition: color 0.15s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.followup:hover { color: ${isLight ? '#000' : '#fff'}; }
.followups-list hr { border: none; border-top: 1px solid ${borderSubtle}; margin: 0; }

/* MessageInput.svelte: max-w-[58rem] px-2.5 mx-auto shell, shadow-lg
   rounded-3xl border-gray-100/30 dark:border-gray-850/30 bg-white/5
   dark:bg-gray-500/5 backdrop-blur-sm */
.input-wrap { padding: 0 10px; max-width: 58rem; width: 100%; margin: 0 auto; }
#chat-input-container { background: ${inputBg}; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); border: 1px solid ${borderSubtle}; border-radius: 24px; box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1); padding: 10px 10px 8px 18px; display: flex; flex-direction: column; gap: 8px; transition: border-color 0.15s; }
#chat-input-container:hover { border-color: ${isLight ? 'var(--color-gray-200)' : 'var(--color-gray-800)'}; }
/* The real chat input is a ProseMirror contenteditable (RichTextInput,
   id="chat-input", .input-prose = !text-[0.9375rem]) — NOT a <textarea>.
   Preset CSS that skins textarea/input fields therefore never touches the
   chat input in Open WebUI, and must not touch it here either. */
#chat-input { outline: none; width: 100%; min-height: 24px; padding-top: 2px; font-size: 1rem; line-height: 1.5; color: ${textMain}; }
#chat-input p { margin: 0; }
/* app.css:418 — placeholder is a ::before on the empty first paragraph */
.ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); float: left; color: ${isLight ? '#676767' : '#757575'}; pointer-events: none; height: 0; }
/* MessageInput.svelte controls: PlusAlt/Component sit in size-[1.875rem]
   rounded-full buttons, Dictate is rounded-full p-1.5 mr-0.5, and with an
   empty prompt the trailing control is Voice mode — bg-black dark:bg-white
   rounded-full p-[5px] — not the submit arrow. */
.input-row { display: flex; align-items: center; gap: 2px; }
.input-row .icon-btn { width: 1.875rem; height: 1.875rem; border-radius: 9999px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: ${isLight ? 'var(--color-gray-700)' : '#fff'}; cursor: pointer; transition: background 0.15s; }
.input-row .icon-btn:hover { background: ${iconHover}; }
.input-row .icon-btn svg { width: 1.125rem; height: 1.125rem; }
.input-row .icon-btn:first-child svg { width: 1.25rem; height: 1.25rem; }
.input-row .spacer { flex: 1; }
/* ModelSelector in the input row (MessageInput.svelte L2223-2231): a
   max-w-[13rem] trigger — rounded-lg pl-2 pr-1.5 py-1 gap-1.5 text-[13px]
   text-gray-600 dark:text-gray-300 — with a truncating label and a
   size-2.5 ChevronDown at stroke-width 2.5 */
.model-select { display: flex; align-items: center; gap: 6px; min-width: 0; max-width: 13rem; padding: 4px 6px 4px 8px; border-radius: 8px; font-size: 0.8125rem; font-weight: 400; color: ${isLight ? 'var(--color-gray-600)' : 'var(--color-gray-300)'}; cursor: pointer; transition: background 0.1s, color 0.1s; }
.model-select:hover { background: ${navHover}; color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-200)'}; }
.model-select .name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.model-select svg { width: 0.625rem; height: 0.625rem; flex-shrink: 0; margin-left: 4px; }
.mic-btn { padding: 6px; margin-right: 2px; border-radius: 9999px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: ${isLight ? 'var(--color-gray-600)' : 'var(--color-gray-300)'}; cursor: pointer; transition: color 0.15s; }
.mic-btn svg { width: 1.125rem; height: 1.125rem; }
.mic-btn:hover { color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-200)'}; }
/* The real Voice mode button carries bg-black/dark:bg-white as literal
   classes (MessageInput.svelte:2306) — presets style it through those
   (e.g. Astral Projection's .bg-black gradient), so the mock's button
   must carry the same class string. Styled via .call-button so the class
   tokens stay purely selector bait, like the bubble's bg-gray classes. */
.call-button { padding: 5px; border-radius: 9999px; border: none; background: ${isLight ? '#000' : '#fff'}; color: ${isLight ? '#fff' : '#000'}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; cursor: pointer; transition: background 0.15s; }
.call-button svg { width: 1.25rem; height: 1.25rem; }
.call-button:hover { background: ${isLight ? 'var(--color-gray-900)' : 'var(--color-gray-100)'}; }
/* The divider between More and Integrations (MessageInput.svelte):
   w-[0.0625rem] h-4 mx-1 bg-gray-200/50 dark:bg-gray-800/50 */
.input-divider { width: 1px; height: 1rem; margin: 0 4px; flex-shrink: 0; background: color-mix(in srgb, var(--color-gray-${isLight ? '200' : '800'}) 50%, transparent); }
.input-pills { display: flex; align-items: center; gap: 6px; margin-left: 4px; min-width: 0; }
.input-pills:empty { display: none; }
/* Selected tools: Wrench size-4 + count, px-1 gap-1 text-gray-600 dark:text-gray-300 */
.tools-pill { display: flex; align-items: center; gap: 4px; padding: 0 4px; border-radius: 8px; font-size: 0.875rem; color: ${isLight ? 'var(--color-gray-600)' : 'var(--color-gray-300)'}; cursor: pointer; transition: color 0.15s; }
.tools-pill:hover { color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-200)'}; }
.tools-pill svg { width: 1rem; height: 1rem; }
/* Web Search / Image / Code Interpreter while on: group p-[0.375rem]
   rounded-full border, text-sky-500 bg-sky-50 border-sky-200/40, dark
   text-sky-300 bg-sky-400/10 border-sky-500/20, with an XMark on hover */
.feature-pill { display: flex; align-items: center; gap: 6px; padding: 0.375rem; border-radius: 9999px; cursor: pointer; transition: background-color 0.3s, color 0.3s; ${isLight
    ? 'color: oklch(68.5% 0.169 237.323); background: oklch(97.7% 0.013 236.62); border: 1px solid oklch(90.1% 0.058 230.902 / 0.4);'
    : 'color: oklch(82.8% 0.111 230.318); background: oklch(74.6% 0.16 232.661 / 0.1); border: 1px solid oklch(68.5% 0.169 237.323 / 0.2);'} }
.feature-pill:hover { background: ${isLight ? 'oklch(95.1% 0.026 236.824)' : 'oklch(50% 0.134 242.749 / 0.1)'}; }
.feature-pill svg { width: 1rem; height: 1rem; }
.feature-pill .terminal-icon svg { width: 0.875rem; height: 0.875rem; }
.feature-pill .x { display: none; }
.feature-pill:hover .x { display: flex; }

/* DropdownMenu.svelte, portaled to <body> by Dropdown.svelte: rounded-xl p-0.5
   border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-850
   dark:text-white shadow-lg, fixed at z-9999, flyAndScale in over 200ms */
.tdp-menu { position: fixed; z-index: 9999; display: flex; flex-direction: column; padding: 2px; border-radius: 12px; border: 1px solid ${border}; background: ${isLight ? '#fff' : 'var(--color-gray-850)'}; color: ${isLight ? textMain : '#fff'}; box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1); overflow: hidden; font-size: 0.8125rem; opacity: 0; transform: translateY(-8px) scale(0.95); transition: opacity 0.2s cubic-bezier(0.33, 1, 0.68, 1), transform 0.2s cubic-bezier(0.33, 1, 0.68, 1); }
.tdp-menu.in { opacity: 1; transform: none; }
/* InputMenu w-70 max-h-72; IntegrationsMenu min-w-70 max-w-70 max-h-72 */
.tdp-menu.input-menu, .tdp-menu.integrations-menu { width: 17.5rem; max-height: 18rem; }
.tdp-view { display: flex; flex-direction: column; min-height: 0; max-height: calc(18rem - 4px); overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; }
.tdp-view.from-left { animation: tdp-fly-left 0.15s cubic-bezier(0.33, 1, 0.68, 1); }
.tdp-view.from-right { animation: tdp-fly-right 0.15s cubic-bezier(0.33, 1, 0.68, 1); }
@keyframes tdp-fly-left { from { opacity: 0; transform: translateX(-20px); } }
@keyframes tdp-fly-right { from { opacity: 0; transform: translateX(20px); } }
/* Rows: flex gap-2 w-full items-center h-[1.6875rem] px-2 text-[0.8125rem]
   font-normal rounded-xl hover:bg-gray-50/40 dark:hover:bg-gray-800/40 */
.tdp-row { display: flex; align-items: center; gap: 8px; width: 100%; height: 1.6875rem; padding: 0 8px; flex-shrink: 0; border: 0; border-radius: 12px; background: transparent; color: inherit; font: inherit; font-size: 0.8125rem; font-weight: 400; text-align: left; cursor: pointer; user-select: none; }
.tdp-row:hover, .tdp-row.hl { background: ${navHover}; }
.tdp-row > svg, .tdp-row .ico svg { width: 1rem; height: 1rem; flex-shrink: 0; }
.tdp-row .ico { display: flex; flex-shrink: 0; }
.tdp-row .ico.sm svg, .tdp-row > svg.sm { width: 0.875rem; height: 0.875rem; }
.tdp-row .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tdp-row .count { margin-left: 2px; color: var(--color-gray-500); }
.tdp-row .chev { display: flex; color: var(--color-gray-500); }
.tdp-row .chev svg { width: 1rem; height: 1rem; }
.tdp-row.back { justify-content: flex-start; }
.tdp-row .doc svg { width: 0.875rem; height: 0.875rem; }
.tdp-row.item .label { color: ${isLight ? '#000' : 'var(--color-gray-100)'}; }
/* SearchInput.svelte: my-0.5 ml-2 mr-0.5 h-[1.6875rem] gap-2, Search size-3.5 */
.tdp-search { display: flex; align-items: center; gap: 8px; height: 1.6875rem; margin: 2px 2px 2px 8px; flex-shrink: 0; }
.tdp-search svg { width: 0.875rem; height: 0.875rem; flex-shrink: 0; }
.tdp-search input { width: 100%; min-width: 0; border: 0; outline: none; background: transparent; color: inherit; font: inherit; font-size: 0.8125rem; font-weight: 400; }
.tdp-search input::placeholder { color: ${isLight ? 'var(--color-gray-400)' : 'var(--color-gray-500)'}; }
.tdp-empty { text-align: center; font-size: 0.75rem; color: var(--color-gray-500); padding: 12px 0; }
.tdp-kb-files { display: flex; flex-direction: column; gap: 2px; padding-left: 12px; margin-bottom: 4px; }
.tdp-row .expand { display: flex; margin-left: 8px; opacity: 0.5; transition: opacity 0.15s; }
.tdp-row .expand:hover { opacity: 1; }
.tdp-row .expand svg { width: 0.75rem; height: 0.75rem; }
/* Switch.svelte: a 28x16 track, bg-gray-900 dark:bg-white when on and
   bg-gray-300 dark:bg-gray-700 when off, with a 12px thumb at 2px or 14px */
.tdp-switch { position: relative; width: 28px; height: 16px; margin: 0 1px; flex-shrink: 0; border-radius: 9999px; background: ${isLight ? 'var(--color-gray-300)' : 'var(--color-gray-700)'}; transition: background-color 0.15s; }
.tdp-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 9999px; background: ${isLight ? '#fff' : 'var(--color-gray-500)'}; transition: left 0.15s, background-color 0.15s; }
.tdp-switch.on { background: ${isLight ? 'var(--color-gray-900)' : '#fff'}; }
.tdp-switch.on::after { left: 14px; background: ${isLight ? '#fff' : '#000'}; }

/* ModelSelector/Selector.svelte: w-[20rem] rounded-xl border p-0.5 shadow-lg,
   opened above the trigger with its right edge on the trigger's (bottom-end,
   flipped, offset 2) */
.tdp-menu.model-menu { width: 20rem; max-width: calc(100vw - 1rem); }
.model-menu .compare { display: flex; align-items: center; justify-content: center; width: 1.375rem; height: 1.375rem; flex-shrink: 0; border-radius: 8px; color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; cursor: pointer; transition: background-color 0.1s, color 0.1s; }
.model-menu .compare:hover { background: ${navHover}; color: ${isLight ? 'var(--color-gray-900)' : 'var(--color-gray-100)'}; }
.model-menu .compare.on { background: ${isLight ? 'var(--color-gray-50)' : 'color-mix(in srgb, var(--color-gray-800) 60%, transparent)'}; color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-200)'}; }
.model-menu .compare svg { width: 0.75rem; height: 0.75rem; }
.model-list { min-height: 0; max-height: 18rem; overflow-y: auto; scrollbar-width: thin; }
/* ModelItem.svelte: h-8 rounded-xl px-2 text-[0.8125rem] text-gray-700
   dark:text-gray-100, selected bg-gray-50/70 dark:bg-gray-800/60, a size-4
   round avatar, EllipsisHorizontal and a size-3 Check */
.model-item { display: flex; align-items: center; width: 100%; height: 2rem; padding: 0 8px; border-radius: 12px; font-size: 0.8125rem; color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-100)'}; cursor: pointer; user-select: none; transition: background-color 75ms; }
.model-item:hover { background: ${navHover}; }
.model-item.selected, .model-item.hl { background: color-mix(in srgb, var(--color-gray-${isLight ? '50' : '800'}) ${isLight ? '70' : '60'}%, transparent); }
.model-item .main { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; overflow: hidden; }
.model-item img { width: 1rem; height: 1rem; border-radius: 9999px; flex-shrink: 0; }
.model-item .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.model-item .size { flex-shrink: 0; font-size: 0.6875rem; color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; }
.model-item .end { display: flex; align-items: center; gap: 6px; margin-left: auto; padding-left: 8px; flex-shrink: 0; }
.model-item .end svg { width: 1rem; height: 1rem; }
.model-item .end .tick svg { width: 0.75rem; height: 0.75rem; }
.model-empty { display: flex; align-items: center; min-height: 2rem; padding: 0 8px; border-radius: 12px; font-size: 0.8125rem; color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-100)'}; }
.model-foot { display: flex; justify-content: flex-end; padding: 4px 8px; line-height: 1; flex-shrink: 0; }
.model-foot span { font-size: 0.65rem; color: var(--color-gray-500); cursor: pointer; text-underline-offset: 2px; }
.model-foot span:hover { color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-300)'}; text-decoration: underline; }
.model-menu .pb { height: 4px; flex-shrink: 0; }

/* ---- Sidebar sections (Sidebar/Section.svelte) fold, with a chevron that
   shows on hover and turns 90deg while open ---- */
.side-section[data-section] > .side-label { cursor: pointer; transition: color 0.1s; }
.side-section > .side-label:hover { color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; }
.sec-chev { display: flex; margin-left: 4px; opacity: 0; transition: opacity 0.1s, transform 0.1s; }
.sec-chev svg { width: 0.6875rem; height: 0.6875rem; }
.side-label:hover .sec-chev { opacity: 1; }
.side-section.open > .side-label .sec-chev { transform: rotate(90deg); }
.side-section > .side-section-body { display: none; }
.side-section.open > .side-section-body { display: block; }
.side-label .sec-more svg { width: 0.875rem; height: 0.875rem; }
.side-label .add + .add { margin-left: 2px; }
.side-label.time-label { cursor: default; }
.side-note { cursor: default; }
/* ChannelItem.svelte: p-1 rounded-xl, a size-3 Hashtag (size-3.5 Lock), the
   unread count badge and a Settings gear that shows on hover */
.channel-item { display: flex; align-items: center; gap: 4px; margin: 0 4px; padding: 4px; border-radius: 12px; font-size: 0.8125rem; line-height: 1.25rem; color: ${isLight ? 'var(--color-gray-600)' : 'var(--color-gray-400)'}; cursor: pointer; user-select: none; transition: background 0.15s; }
.channel-item:hover { background: ${itemHover}; }
.channel-item.active { background: ${isLight ? 'var(--color-gray-100)' : 'var(--color-gray-900)'}; }
.channel-item.unread { color: ${isLight ? '#000' : '#fff'}; }
.channel-item .ch-ico { width: 1rem; height: 1rem; margin-left: 4px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.channel-item .ch-ico svg { width: 0.75rem; height: 0.75rem; }
.channel-item .ch-ico.lock svg { width: 0.875rem; height: 0.875rem; }
.channel-item .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.unread-badge { display: inline-flex; align-items: center; justify-content: center; height: 1rem; min-width: 1rem; padding: 0 4px; border-radius: 6px; flex-shrink: 0; font-size: 0.625rem; font-weight: 600; line-height: 1rem; ${isLight ? 'background: oklch(68.5% 0.169 237.323 / 0.1); color: oklch(58.8% 0.158 241.966);' : 'background: oklch(74.6% 0.16 232.661 / 0.1); color: oklch(82.8% 0.111 230.318);'} }
.channel-item .ch-settings { display: flex; padding: 2px; margin: 0 4px 0 2px; border-radius: 8px; opacity: 0; color: ${isLight ? 'inherit' : 'var(--color-gray-300)'}; transition: opacity 0.15s; }
.channel-item:hover .ch-settings { opacity: 1; }
.channel-item .ch-settings svg { width: 0.875rem; height: 0.875rem; }
/* RecursiveFolder.svelte: py-1 px-1.5 rounded-xl, the Folder icon turning
   into a chevron on hover, children behind the same left rule as Pinned */
.folder-row { display: flex; align-items: center; gap: 6px; margin: 0 4px; padding: 4px 6px; border-radius: 12px; font-size: 0.8125rem; line-height: 1.25rem; color: ${textSoft}; cursor: pointer; transition: background 0.15s; }
.folder-row:hover { background: ${itemHover}; }
.folder-row svg { width: 0.875rem; height: 0.875rem; flex-shrink: 0; }
.folder-row .folder-chev { display: none; }
.folder-row .folder-chev svg { width: 0.75rem; height: 0.75rem; transition: transform 0.15s; }
.folder-row:hover .folder-ico { display: none; }
.folder-row:hover .folder-chev { display: flex; width: 0.875rem; justify-content: center; }
.side-folder.open .folder-chev svg { transform: rotate(90deg); }
.folder-children, .pinned-list { margin-left: 16px; padding-left: 4px; margin-top: 1px; border-left: 1px solid ${isLight ? 'var(--color-gray-100)' : 'var(--color-gray-900)'}; display: none; flex-direction: column; }
.side-folder.open .folder-children, .side-pinned-wrap.open .pinned-list { display: flex; }
.folder-children .side-item, .pinned-list .side-item { margin: 0; }
/* common/Folder.svelte header: py-1.5 pl-2 gap-1.5 text-xs text-gray-500,
   a size-3 ChevronDown/ChevronRight swapped, not rotated */
.side-pinned { gap: 6px; padding: 6px 8px; font-size: 0.75rem; color: var(--color-gray-500); cursor: pointer; }
.side-pinned .pin-chev { display: flex; padding: 1px; }
.side-pinned .pin-chev svg { width: 0.75rem; height: 0.75rem; }
.side-pinned-wrap { margin-bottom: 4px; }
/* ChatItem.svelte: a size-1.5 sky dot for unread chats */
.unread-dot { width: 6px; height: 6px; border-radius: 9999px; background: oklch(68.5% 0.169 237.323); flex-shrink: 0; margin-right: 2px; }
.side-item.unread .label { color: ${isLight ? 'var(--color-gray-800)' : 'var(--color-gray-200)'}; }
.side-item.menu-open { background: ${activeItem}; }
.side-item.menu-open .chat-actions { visibility: visible; }
.side-item.menu-open .age { display: none; }
.ap-add { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; margin: 4px 0 20px; cursor: pointer; }
.ap-add svg { width: 0.75rem; height: 0.75rem; }
.ap-switch { justify-content: space-between; margin-top: 4px; }
.side-item .rename { flex: 1; min-width: 0; margin-right: 40px; border: 0; outline: none; background: transparent; color: inherit; font: inherit; }
/* Avatars carry the green status dot (enable_user_status) */
.avatar-wrap { position: relative; display: flex; flex-shrink: 0; }
.status-dot { position: absolute; right: -2px; bottom: -2px; width: 10px; height: 10px; border-radius: 9999px; background: oklch(72.3% 0.219 149.579); border: 2px solid ${isLight ? '#fff' : 'var(--color-gray-900)'}; }
.side-user .avatar { width: 1.375rem; height: 1.375rem; }
.side-user { gap: 12px; }

/* ---- More dropdowns (common/DropdownMenu.svelte): ChatMenu, UserMenu, the
   Chats header's More, submenus and the reaction picker ---- */
.tdp-menu.chat-menu { min-width: 12.5rem; }
.tdp-menu.user-menu { font-size: 0.75rem; }
.tdp-menu.chats-more { min-width: 10.625rem; }
.tdp-menu.submenu { min-width: 10rem; max-width: 200px; z-index: 10000; }
.tdp-menu .mi { display: flex; align-items: center; gap: 8px; width: 100%; height: 1.6875rem; padding: 0 8px; border: 0; border-radius: 12px; background: transparent; color: inherit; font: inherit; font-size: 0.8125rem; text-align: left; cursor: pointer; user-select: none; flex-shrink: 0; transition: background 0.15s; }
.tdp-menu .mi svg { width: 0.875rem; height: 0.875rem; flex-shrink: 0; }
.tdp-menu .mi .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-menu .mi:hover, .submenu .mi:hover, .chats-more .mi:hover { background: ${isLight ? 'var(--color-gray-100)' : 'var(--color-gray-900)'}; }
.user-menu .mi:hover, .user-menu .mi.hl { background: color-mix(in srgb, var(--color-gray-${isLight ? '50' : '800'}) 60%, transparent); }
.chat-menu .mi.sub.hl { background: ${isLight ? 'var(--color-gray-100)' : 'var(--color-gray-900)'}; }
.tdp-menu hr { border: 0; border-top: 1px solid color-mix(in srgb, var(--color-gray-${isLight ? '50' : '800'}) 30%, transparent); margin: 2px 4px; }
.user-menu .mi.who, .user-menu .mi.status { font-size: 0.75rem; }
.user-menu .who img, .user-menu .who .avatar { width: 1.125rem; height: 1.125rem; }
.user-menu .who .ico, .user-menu .status .ico { width: 1.125rem; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.user-menu .active-users { margin-left: auto; display: flex; align-items: center; gap: 4px; padding: 2px 6px; font-size: 0.6875rem; line-height: 1; color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; }
.user-menu .active-users i { width: 6px; height: 6px; border-radius: 9999px; background: oklch(72.3% 0.219 149.579); }
.user-menu .status .clear { display: flex; align-items: center; justify-content: center; width: 1.25rem; height: 1.25rem; opacity: 0.5; }
.user-menu .status .clear:hover { opacity: 1; }
.tdp-menu.emoji-menu { flex-direction: row; gap: 2px; padding: 4px; }
.emoji-menu .em { width: 1.75rem; height: 1.75rem; display: flex; align-items: center; justify-content: center; border-radius: 8px; font-size: 1.05rem; cursor: pointer; }
.emoji-menu .em:hover { background: ${navHover}; }

/* ---- Temporary Chat: the checked icon, the placeholder's label, and a
   dashed message bar (MessageInput.svelte) ---- */
nav .temp-chat .on, nav .temp-chat.active .off { display: none; }
nav .temp-chat.active .on { display: flex; }
nav .temp-chat > span { display: flex; }
.ph-temp { display: none; align-items: center; gap: 6px; margin-top: 4px; margin-bottom: 2px; width: fit-content; font-size: 0.75rem; color: var(--color-gray-500); }
.ph-temp svg { width: 0.875rem; height: 0.875rem; }
body.temp-chat .ph-temp { display: flex; }
body.temp-chat #chat-input-container { border-style: dashed; border-color: ${isLight ? 'var(--color-gray-100)' : 'var(--color-gray-800)'}; }
body.temp-chat #chat-input-container:hover { border-color: ${isLight ? 'var(--color-gray-200)' : 'var(--color-gray-700)'}; }

/* ---- Side panes: ChatControls and Thread sit after a resizer's border ---- */
.side-pane { flex: none; height: 100%; display: flex; flex-direction: column; min-height: 0; background: ${isLight ? '#fff' : 'var(--color-gray-900)'}; border-left: 1px solid ${isLight ? 'var(--color-gray-50)' : 'color-mix(in srgb, var(--color-gray-850) 30%, transparent)'}; position: relative; z-index: 10; }
.side-pane[hidden] { display: none; }
.controls-pane { width: 350px; }
.thread-pane { width: 420px; }
@media (max-width: 1023px) {
  .side-pane { position: absolute; top: 0; right: 0; bottom: 0; z-index: 40; box-shadow: -10px 0 30px rgb(0 0 0 / 0.15); }
}
.cc-tabs { display: flex; align-items: center; justify-content: space-between; padding: 8px; flex-shrink: 0; }
.cc-tab { padding: 4px 10px; font-size: 0.875rem; border-radius: 8px; white-space: nowrap; background: color-mix(in srgb, var(--color-gray-${isLight ? '100' : '800'}) ${isLight ? '40' : '25'}%, transparent); color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-200)'}; }
.pane-close { display: flex; align-items: center; justify-content: center; padding: 4px; border-radius: 8px; color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; cursor: pointer; }
.pane-close svg { width: 1rem; height: 1rem; }
.cc-body { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 12px 16px; scrollbar-width: thin; font-size: 0.875rem; color: ${isLight ? 'inherit' : 'var(--color-gray-200)'}; }
/* Collapsible.svelte headers: py-1 text-xs text-gray-500, a size-2.5 chevron
   (up while open) at the right */
.cc-sec + .cc-sec { margin-top: 4px; }
.cc-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 4px 0; border: 0; background: none; font: inherit; font-size: 0.75rem; color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; cursor: pointer; user-select: none; transition: color 0.15s; }
.cc-head:hover { color: ${isLight ? 'var(--color-gray-900)' : 'var(--color-gray-100)'}; }
.cc-head svg { width: 0.625rem; height: 0.625rem; transform: translateY(1px); }
.cc-head .up, .cc-sec.open .cc-head .down { display: none; }
.cc-sec.open .cc-head .up { display: flex; }
.cc-head .down { display: flex; }
.cc-content { display: none; padding: 4px 0; font-size: 0.75rem; }
.cc-sec.open .cc-content { display: block; }
.cc-content textarea { width: 100%; resize: vertical; border: 0; outline: none; background: transparent; color: inherit; font: inherit; font-size: 0.75rem; padding: 4px 0; }
.cc-content textarea::placeholder, .cc-content input::placeholder { color: ${isLight ? 'var(--color-gray-400)' : 'var(--color-gray-500)'}; }
.cc-content select { flex: 1; min-width: 0; padding: 4px; border: 0; border-radius: 4px; outline: none; background: transparent; color: inherit; font: inherit; font-size: 0.75rem; }
.cc-valves { display: flex; gap: 8px; }
/* AdvancedParams.svelte: a label and a "Default" button per row, then a
   slider and number box once set */
.ap { color: ${isLight ? 'var(--color-gray-900)' : 'var(--color-gray-100)'}; }
.ap-row { padding: 2px 0; }
.ap-line { display: flex; justify-content: space-between; align-items: center; }
.ap-label { font-size: 0.75rem; color: ${isLight ? 'var(--color-gray-600)' : 'var(--color-gray-400)'}; }
.ap-btn { padding: 4px 12px; font-size: 0.75rem; border-radius: 4px; flex-shrink: 0; cursor: pointer; }
.ap-custom { display: flex; gap: 8px; margin-top: 2px; align-items: center; }
.ap-custom input[type=range] { flex: 1; height: 8px; border-radius: 8px; appearance: none; -webkit-appearance: none; background: ${isLight ? 'var(--color-gray-200)' : 'var(--color-gray-700)'}; cursor: pointer; }
.ap-custom input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 9999px; background: ${isLight ? 'var(--color-gray-900)' : '#fff'}; }
.ap-custom input[type=number], .ap-custom input[type=text] { background: transparent; border: 0; outline: none; color: inherit; font: inherit; font-size: 0.75rem; }
.ap-custom input[type=number] { width: 3.5rem; text-align: center; }
.ap-custom input[type=text] { width: 100%; font-size: 0.875rem; }

/* ---- Channel (channel/Channel.svelte, Navbar, Messages, Message) ---- */
main.channel-mode > nav, main.channel-mode > #messages-container, main.channel-mode > .input-wrap { display: none; }
.channel-view { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.channel-view[hidden] { display: none; }
.ch-nav { display: flex; align-items: center; padding: 4px 12px; flex-shrink: 0; position: relative; z-index: 2; }
.ch-title { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; margin-left: 4px; font-size: 0.875rem; font-weight: 500; line-height: 1.25rem; color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-300)'}; }
.ch-title svg { width: 1rem; height: 1rem; flex-shrink: 0; }
.ch-nav-btns { display: flex; align-items: center; gap: 4px; color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; }
.ch-nav-btn { display: flex; align-items: center; gap: 4px; height: 1.75rem; min-width: 1.75rem; justify-content: center; padding: 0 6px; border-radius: 8px; cursor: pointer; transition: background 0.15s; }
.ch-nav-btn:hover { background: color-mix(in srgb, var(--color-gray-${isLight ? '50' : '800'}) 60%, transparent); }
.ch-nav-btn svg { width: 1rem; height: 1rem; }
.ch-nav-btn .n { font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.ch-scroll { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 10px; scrollbar-width: none; }
.ch-intro { padding: 32px 16px 16px; display: flex; flex-direction: column; gap: 6px; }
.ch-intro .t { font-size: 1.125rem; font-weight: 500; line-height: 1.5rem; color: ${textMain}; }
.ch-intro .d { font-size: 0.75rem; line-height: 1.25rem; color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; }
.ch-intro-rule { margin: 0 16px 8px; border: 0; border-top: 1px solid color-mix(in srgb, var(--color-gray-${isLight ? '100' : '800'}) ${isLight ? '60' : '40'}%, transparent); }
.cm { position: relative; padding: 0 16px; transition: background 0.1s; }
.cm.head { padding-top: 10px; padding-bottom: 2px; }
.cm:hover { background: color-mix(in srgb, var(--color-gray-${isLight ? '300' : '700'}) 5%, transparent); }
.cm.pinned { background: ${isLight ? 'oklch(97.3% 0.071 103.193 / 0.2)' : 'oklch(97.3% 0.071 103.193 / 0.05)'}; }
.cm.replying { border-left: 4px solid oklch(62.3% 0.214 259.815); padding-left: 12px; background: ${isLight ? 'oklch(93.2% 0.032 255.585 / 0.1)' : 'oklch(93.2% 0.032 255.585 / 0.05)'}; }
.cm-pin-label { display: flex; align-items: center; gap: 4px; margin-left: 36px; margin-bottom: 2px; font-size: 0.6875rem; line-height: 1rem; }
.cm-pin-label svg { width: 0.75rem; height: 0.75rem; color: ${isLight ? 'oklch(79.5% 0.184 86.047)' : 'oklch(90.5% 0.182 98.111)'}; }
.cm-pin-label span { color: var(--color-gray-500); }
.cm-row { display: flex; width: 100%; }
.cm-av { width: 1.5rem; flex-shrink: 0; }
.cm-av .av { width: 1.5rem; height: 1.5rem; margin-top: 2px; border-radius: 9999px; display: flex; align-items: center; justify-content: center; font-size: 0.6875rem; font-weight: 600; color: #fff; overflow: hidden; }
.cm-av .av img { width: 100%; height: 100%; object-fit: cover; }
.cm-av .t2 { margin: 4px -4px 0; transform: translateY(1px); text-align: center; font-size: 0.6875rem; line-height: 1rem; font-variant-numeric: tabular-nums; color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; opacity: 0; transition: opacity 0.1s; }
.cm:hover .cm-av .t2 { opacity: 1; }
.cm-body { flex: 1; min-width: 0; padding-left: 12px; }
.cm-meta { display: flex; align-items: baseline; gap: 6px; line-height: 1.25rem; }
.cm-name { font-size: 0.8125rem; font-weight: 500; color: ${isLight ? 'var(--color-gray-900)' : 'var(--color-gray-100)'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cm-time { font-size: 0.6875rem; line-height: 1rem; color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; transform: translateY(1px); flex-shrink: 0; }
.cm-text { font-size: 0.875rem; line-height: 1.375rem; color: ${proseText}; overflow-wrap: anywhere; }
.cm-text b { color: ${isLight ? 'var(--color-gray-900)' : '#fff'}; font-weight: 600; }
.cm-text code { font-size: 0.8125rem; padding: 1px 4px; border-radius: 6px; background: ${codeBg}; }
.cm-text .mention { color: ${isLight ? 'oklch(58.8% 0.158 241.966)' : 'oklch(82.8% 0.111 230.318)'}; }
.cm-text .edited { font-size: 0.625rem; color: var(--color-gray-500); padding-left: 4px; }
.cm-edit textarea { width: 100%; resize: none; border: 0; outline: none; background: transparent; color: inherit; font: inherit; font-size: 0.875rem; line-height: 1.375rem; }
.cm-edit .btns { display: flex; justify-content: flex-end; gap: 6px; margin: 8px 0 4px; font-size: 0.875rem; }
.cm-edit .btns span { padding: 6px 14px; border-radius: 24px; cursor: pointer; }
.cm-edit .cancel { background: ${isLight ? '#fff' : 'var(--color-gray-900)'}; color: ${isLight ? 'var(--color-gray-800)' : 'var(--color-gray-100)'}; }
.cm-edit .save { background: ${isLight ? 'var(--color-gray-900)' : '#fff'}; color: ${isLight ? 'var(--color-gray-100)' : 'var(--color-gray-800)'}; }
/* Reply-to quote above a reply */
.cm-quote { position: relative; font-size: 0.75rem; margin-bottom: 4px; }
.cm-quote::before { content: ''; position: absolute; left: 12px; top: 8px; width: 24px; height: 12px; border-top: 1.5px solid; border-left: 1.5px solid; border-top-left-radius: 8px; border-color: ${isLight ? 'var(--color-gray-200)' : 'var(--color-gray-700)'}; }
.cm-quote .q { margin-left: 36px; display: flex; align-items: center; gap: 6px; min-width: 0; }
.cm-quote .q .av { width: 1rem; height: 1rem; margin-left: 2px; border-radius: 9999px; font-size: 0.5rem; display: flex; align-items: center; justify-content: center; color: #fff; flex-shrink: 0; }
.cm-quote .q .who { flex-shrink: 0; color: ${textMain}; }
.cm-quote .q .what { color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The hover toolbar: rounded-lg bg-white dark:bg-gray-850 shadow-md p-0.5 */
.cm-tools { position: absolute; right: 4px; top: -12px; z-index: 30; display: flex; gap: 4px; padding: 2px; border-radius: 8px; background: ${isLight ? '#fff' : 'var(--color-gray-850)'}; border: 1px solid color-mix(in srgb, var(--color-gray-${isLight ? '100' : '850'}) 30%, transparent); box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1); opacity: 0; pointer-events: none; transition: opacity 0.1s; color: ${textMain}; }
.cm:hover .cm-tools, .cm.tools-open .cm-tools { opacity: 1; pointer-events: auto; }
.cm-tools span { display: flex; padding: 4px; border-radius: 8px; cursor: pointer; transition: background 0.15s; }
.cm-tools span:hover { background: ${isLight ? 'var(--color-gray-100)' : 'var(--color-gray-800)'}; }
.cm-tools svg { width: 1rem; height: 1rem; }
/* Reactions: min-h-6 rounded-lg px-1.5, blue when you reacted */
.cm-reacts { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 4px 0; }
.cm-react { display: flex; align-items: center; gap: 6px; min-height: 1.5rem; padding: 2px 6px; border-radius: 8px; font-size: 0.875rem; line-height: 1rem; cursor: pointer; background: color-mix(in srgb, var(--color-gray-${isLight ? '300' : '500'}) 10%, transparent); outline: 1px solid transparent; transition: outline-color 0.15s; }
.cm-react:hover { outline-color: ${isLight ? 'color-mix(in srgb, var(--color-gray-700) 30%, transparent)' : 'color-mix(in srgb, var(--color-gray-300) 30%, transparent)'}; }
.cm-react.mine { background: oklch(80.9% 0.105 251.813 / 0.1); outline-color: oklch(62.3% 0.214 259.815 / 0.5); }
.cm-react .n { font-size: 0.6875rem; color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; }
.cm-react-add { display: flex; padding: 4px; border-radius: 8px; cursor: pointer; background: color-mix(in srgb, var(--color-gray-500) 10%, transparent); color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; outline: 1px solid transparent; }
.cm-react-add:hover { outline-color: ${isLight ? 'color-mix(in srgb, var(--color-gray-700) 30%, transparent)' : 'color-mix(in srgb, var(--color-gray-300) 30%, transparent)'}; }
.cm-react-add svg { width: 1rem; height: 1rem; }
/* "N Replies - Last reply ..." opens the thread */
.cm-replies { display: flex; margin: -2px 0 6px; }
.cm-replies span.btn { display: flex; align-items: center; min-width: 0; padding: 4px 0; font-size: 0.6875rem; color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; cursor: pointer; transition: color 0.15s; }
.cm-replies span.btn:hover { color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-300)'}; }
.cm-replies b { font-weight: 500; margin-right: 4px; }
.cm-replies svg { width: 0.625rem; height: 0.625rem; margin-left: 4px; }
/* channel/MessageInput.svelte: one compact rounded-2xl card */
.ch-input-wrap { padding: 0 12px 12px; flex-shrink: 0; position: relative; }
.ch-typing { position: absolute; left: 12px; right: 12px; top: -26px; padding: 0 4px; font-size: 0.75rem; color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; display: none; align-items: center; gap: 6px; }
.ch-typing.show { display: flex; }
.ch-typing b { font-weight: 400; color: ${isLight ? '#000' : '#fff'}; }
.ch-typing .dots { display: inline-flex; gap: 2px; }
.ch-typing .dots i { width: 4px; height: 4px; border-radius: 9999px; background: currentColor; animation: tdp-typing 1.2s infinite ease-in-out; }
.ch-typing .dots i:nth-child(2) { animation-delay: 0.15s; }
.ch-typing .dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes tdp-typing { 0%, 60%, 100% { opacity: 0.25; } 30% { opacity: 1; } }
.ch-input { display: flex; flex-direction: column; border-radius: 16px; border: 1px solid color-mix(in srgb, var(--color-gray-${isLight ? '100' : '800'}) ${isLight ? '60' : '50'}%, transparent); background: ${isLight ? '#fff' : 'color-mix(in srgb, var(--color-gray-400) 5%, transparent)'}; box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1); color: ${isLight ? 'inherit' : 'var(--color-gray-100)'}; transition: border-color 0.15s; }
.ch-input:hover, .ch-input:focus-within { border-color: ${isLight ? 'var(--color-gray-100)' : 'var(--color-gray-800)'}; }
.ch-reply-bar { display: none; align-items: center; justify-content: space-between; padding: 8px 12px 0; font-size: 0.75rem; color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; }
.ch-input.replying .ch-reply-bar { display: flex; }
.ch-reply-bar .x { display: flex; align-items: center; justify-content: center; width: 1.5rem; height: 1.5rem; border-radius: 6px; cursor: pointer; }
.ch-reply-bar .x:hover { background: ${isLight ? 'var(--color-gray-50)' : 'var(--color-gray-800)'}; }
.ch-reply-bar .x svg { width: 0.875rem; height: 0.875rem; }
.ch-edit { margin: 0 8px; padding: 8px 4px 2px; min-height: 1.375rem; max-height: 8rem; overflow: auto; outline: none; font-size: 0.875rem; line-height: 1.375rem; position: relative; }
.ch-edit:empty::before { content: attr(data-placeholder); position: absolute; color: #676767; pointer-events: none; }
.ch-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 6px 6px; }
.ch-plus, .ch-mic { width: 1.75rem; height: 1.75rem; display: flex; align-items: center; justify-content: center; border-radius: 8px; cursor: pointer; flex-shrink: 0; transition: background 0.15s, color 0.15s; }
.ch-plus { color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; }
.ch-plus:hover { background: ${isLight ? 'var(--color-gray-100)' : 'var(--color-gray-800)'}; }
.ch-mic { color: ${isLight ? 'var(--color-gray-600)' : 'var(--color-gray-300)'}; }
.ch-plus svg, .ch-mic svg, .ch-send svg { width: 1rem; height: 1rem; }
.ch-right { display: flex; align-items: center; gap: 4px; }
.ch-send { width: 1.75rem; height: 1.75rem; border-radius: 9999px; display: flex; align-items: center; justify-content: center; background: ${isLight ? 'var(--color-gray-200)' : 'var(--color-gray-700)'}; color: ${isLight ? '#fff' : 'var(--color-gray-900)'}; transition: background 0.15s; }
.ch-input.has-text .ch-send { background: ${isLight ? '#000' : '#fff'}; color: ${isLight ? '#fff' : '#000'}; cursor: pointer; }
.ch-input.has-text .ch-mic { display: none; }
/* Thread (channel/Thread.svelte) */
.th-head { display: flex; align-items: center; justify-content: space-between; min-height: 2.5rem; padding: 6px 16px; border-bottom: 1px solid color-mix(in srgb, var(--color-gray-${isLight ? '100' : '800'}) ${isLight ? '60' : '40'}%, transparent); flex-shrink: 0; }
.th-head .t { font-size: 0.875rem; font-weight: 500; color: ${textMain}; }
.th-head .pane-close { width: 1.75rem; height: 1.75rem; }
.th-head .pane-close:hover { background: color-mix(in srgb, var(--color-gray-${isLight ? '50' : '800'}) 60%, transparent); }
.thread-pane .ch-scroll { padding-top: 12px; }
.footer-note { text-align: center; font-size: 0.65625rem; color: ${textFaint}; padding: 4px 0 6px; }

/* Tooltip.svelte -> tippy theme 'dark' (app.css:379): rounded-lg bg-gray-950
   text-xs border border-gray-900 shadow-xl, content padding 5px 9px */
#tdp-tooltip { position: fixed; z-index: 300; max-width: 300px; padding: 5px 9px; border-radius: 8px; background: var(--color-gray-950); border: 1px solid var(--color-gray-900); color: #fff; font-size: 0.75rem; line-height: 1.35; box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1); pointer-events: none; opacity: 0; transition: opacity 0.1s; white-space: pre-line; }
/* Generation Info renders its usage block in a <pre> upstream */
#tdp-tooltip.pre { font-family: ui-monospace, 'JetBrains Mono', monospace; text-align: left; }
#tdp-tooltip.show { opacity: 1; }

/* Backdrop behind the mobile sidebar (Sidebar.svelte L767-776:
   fixed md:hidden z-40 inset-0 bg-black/60, closes on click) */
#backdrop { display: none; position: fixed; inset: 0; z-index: 40; background: rgb(0 0 0 / 0.6); }
/* Both are mobile-only upstream. Selectors must out-specify nav .nav-btn. */
nav .nav-toggle, nav .nav-newchat { display: none; }

/* --- Mobile: BREAKPOINT is 768 in routes/+layout.svelte --- */
@media (max-width: 767px) {
  /* no collapsed rail on mobile — it renders under {#if !$mobile && ...} */
  .sidebar-rail { display: none !important; }
  /* the panel becomes a fixed drawer, opaque rather than the 70% desktop wash */
  .sidebar-panel { position: fixed; top: 0; left: 0; height: 100%; z-index: 50; width: 245px; min-width: 245px;
    background: ${isLight ? 'var(--color-gray-50)' : 'var(--color-gray-950)'};
    transform: translateX(-100%); transition: transform 250ms ease; opacity: 1; pointer-events: auto;
    padding: 6px 4px 4px; border-right-width: 1px; }
  .app.collapsed .sidebar-panel { transform: translateX(-100%); }
  .app:not(.collapsed) .sidebar-panel { transform: translateX(0); }
  .app:not(.collapsed) #backdrop { display: block; }
  /* Navbar gains the sidebar toggle and a New Chat button, and px-2.5 pt-1.5 */
  nav { padding-left: 10px; padding-right: 10px; }
  nav .nav-toggle { display: flex; }
  .app:not(.collapsed) nav .nav-toggle { display: none; }
  nav .nav-newchat { display: flex; }
  #messages-container > .message-listitem { padding: 0 12px; }
  .input-wrap { padding: 0 6px; }
  .placeholder { padding-left: 8px; padding-right: 8px; }
  .ph-suggest { padding: 0 8px; }
  .ph-grid { grid-template-columns: 1fr; }
  .ph-model, .ph-sub { font-size: 1.5rem; line-height: 2rem; }
  .ph-logo { width: 2.25rem; height: 2.25rem; }
  .model-select { max-width: 8rem; }
}

${structural}
${gradientCSS}
</style>
<style>
${safeCSS}
</style>
</head>
<body data-initial-chat="${esc(opts.initialChat || 'default')}" data-sidebar-collapsed="${opts.initialCollapsed ? '1' : '0'}">
${opts.canvasScript ? '<canvas id="owui-theme-canvas-bg" style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:0;pointer-events:none;"></canvas>' : ''}
<div class="app">
  <div class="sidebar-rail">
    <div class="rail-group">
      <span class="rail-btn lg rail-logo" data-tip="Open Sidebar" data-tip-placement="right"><span><img src="${LOGO}" alt="">${SVG.panel}</span></span>
      <span class="rail-btn rail-action" data-chat="new" data-tip="New Chat" data-tip-placement="right" style="margin-top:4px"><span>${SVG.editPencil}</span></span>
      <span class="rail-btn rail-action" data-tip="Search" data-tip-placement="right"><span>${SVG.search}</span></span>
      <span class="rail-btn rail-action" data-tip="Notes" data-tip-placement="right"><span>${SVG.notes}</span></span>
      <span class="rail-btn rail-action" data-tip="Workspace" data-tip-placement="right"><span>${SVG.workspace}</span></span>
      <span class="rail-btn rail-action" data-tip="Playground" data-tip-placement="right"><span>${SVG.code}</span></span>
    </div>
    <span class="rail-btn lg rail-action" id="rail-user" role="button" aria-label="User menu"><span><span class="avatar-wrap"><span class="rail-avatar"></span><span class="status-dot"></span></span></span></span>
  </div>
  <div id="backdrop"></div>
  <div class="sidebar-panel" id="sidebar">
    <div class="brand"><div class="brand-dot"><img src="${LOGO}" alt=""></div><span class="brand-name">Open WebUI</span><span class="panel-icon" data-tip="Close Sidebar">${SVG.panel}</span></div>
    <div class="side-item" data-chat="new">${SVG.editPencil} <span class="label">New Chat</span></div>
    <div class="side-item">${SVG.search} <span class="label">Search</span></div>
    <div class="side-item">${SVG.notes} <span class="label">Notes</span></div>
    <div class="side-item">${SVG.workspace} <span class="label">Workspace</span></div>
    <div class="side-item">${SVG.code} <span class="label">Playground</span></div>
    <div class="side-scroll">
      <!-- Sidebar/Section.svelte: each header folds its section, with a
           chevron that shows on hover; Channels and Folders start closed
           upstream, Channels opens here to show one off -->
      <div class="side-section open" data-section="models">
        <div class="side-label" data-section-toggle role="button" aria-expanded="true">Models <span class="sec-chev">${SVG.chevron}</span></div>
        <div class="side-section-body"><div class="side-item" data-chat="new"><span class="avatar sm"></span> <span class="label">Preview Model</span></div></div>
      </div>
      <div class="side-section" data-section="notes">
        <div class="side-label" data-section-toggle role="button" aria-expanded="false">Notes <span class="sec-chev">${SVG.chevron}</span><span class="add" data-tip="New Note">${SVG.plus}</span></div>
        <div class="side-section-body"><div class="side-item side-note">${SVG.notes} <span class="label">Theme ideas</span></div></div>
      </div>
      <div class="side-section open" data-section="channels">
        <div class="side-label" data-section-toggle role="button" aria-expanded="true">Channels <span class="sec-chev">${SVG.chevron}</span><span class="add" data-tip="Create Channel">${SVG.plus}</span></div>
        <div class="side-section-body">
          <div class="channel-item unread" data-chat="channel:general"><span class="ch-ico">${SVG.hashtag}</span><span class="label">general</span><span class="unread-badge" title="Unread">3</span><span class="ch-settings" data-tip="Edit">${SVG.cog}</span></div>
          <div class="channel-item" data-chat="channel:design"><span class="ch-ico">${SVG.hashtag}</span><span class="label">design</span><span class="ch-settings" data-tip="Edit">${SVG.cog}</span></div>
          <div class="channel-item" data-chat="channel:theme-lab"><span class="ch-ico lock">${SVG.lock}</span><span class="label">theme-lab</span><span class="ch-settings" data-tip="Edit">${SVG.cog}</span></div>
        </div>
      </div>
      <div class="side-section" data-section="folders">
        <div class="side-label" data-section-toggle role="button" aria-expanded="false">Folders <span class="sec-chev">${SVG.chevron}</span><span class="add" data-tip="New Folder">${SVG.plus}</span></div>
        <div class="side-section-body">
          <div class="side-folder" data-folder="Theme work"><div class="folder-row" role="button" aria-expanded="false"><span class="folder-ico">${SVG.folder}</span><span class="folder-chev">${SVG.chevron}</span><span class="label">Theme work</span></div>
            <div class="folder-children"><div class="side-item" data-chat="launch"><span class="label">Launch checklist</span><span class="age">5d</span>${CHAT_MENU}</div></div></div>
        </div>
      </div>
      <div class="side-section open" data-section="chats">
        <div class="side-label" data-section-toggle role="button" aria-expanded="true">Chats <span class="sec-chev">${SVG.chevron}</span><span class="add sec-more" data-tip="More" aria-label="More">${SVG.moreHorizontal}</span></div>
        <div class="side-section-body">
          <!-- common/Folder.svelte: Pinned is open by default, its chats
               indented behind a left rule -->
          <div class="side-pinned-wrap open">
            <div class="side-pinned" role="button" aria-expanded="true"><span class="pin-chev">${SVG.chevronDownSm}</span><span class="label">Pinned</span></div>
            <div class="pinned-list">
              <div class="side-item" data-chat="brand"><span class="label">Brand palette v2</span><span class="age">2w</span>${CHAT_MENU}</div>
              <div class="side-item" data-chat="digest"><span class="label">Weekly theme digest</span><span class="age">3w</span>${CHAT_MENU}</div>
            </div>
          </div>
          <div class="side-label time-label">Today</div>
          <div class="side-item active" data-chat="default"><span class="label">Theme preview chat</span>${CHAT_MENU}</div>
          <div class="side-label time-label">Previous 7 days</div>
          <div class="side-item" data-chat="oklch"><span class="label">OKLCH color ramps</span><span class="age">1d</span>${CHAT_MENU}</div>
          <div class="side-item" data-chat="fx"><span class="label">Canvas FX ideas</span><span class="age">2d</span>${CHAT_MENU}</div>
          <div class="side-item" data-chat="gradient"><span class="label">Gradient inspiration</span><span class="age">3d</span>${CHAT_MENU}</div>
          <div class="side-item" data-chat="transparency"><span class="label">Structural transparency</span><span class="age">4d</span>${CHAT_MENU}</div>
          <div class="side-item" data-chat="notes"><span class="label">Preset gallery notes</span><span class="age">6d</span>${CHAT_MENU}</div>
        </div>
      </div>
    </div>
    <div class="side-user" id="side-user" role="button" aria-label="User menu"><span class="avatar-wrap"><span class="avatar"></span><span class="status-dot"></span></span> You</div>
  </div>
  <main>
    <nav><span class="nav-btn nav-toggle" data-tip="Open Sidebar">${SVG.panel}</span><span id="nav-title">Theme preview chat</span><span class="nav-btn nav-chat-menu">${SVG.dots}</span><span class="right" id="nav-right"><span class="nav-btn nav-newchat" data-tip="New Chat">${SVG.chatPlus}</span><span class="nav-btn temp-chat" id="temporary-chat-button" role="button" aria-label="Temporary Chat" aria-pressed="false" data-tip="Temporary Chat"><span class="off">${SVG.chatBubbleDotted}</span><span class="on">${SVG.chatBubbleDottedChecked}</span></span><span class="nav-btn controls" id="chat-controls-button" role="button" aria-label="Controls" data-tip="Controls">${SVG.knobs}</span></span></nav>
    <div id="messages-container">
      ${userRow('Show me what this preset looks like on a real conversation.', false)}
      ${aiRow('Response Speed: 104.3 t/s | Total Duration: 2.418s | Prompt Evals: 147 | Eval Count: 236 | Session: 1854 tokens',
        '<p>Here you go: this mock chat mirrors Open WebUI\'s layout: <b>sidebar</b>, <b>message bubbles</b>, <code>inline code</code>, and the input bar below.</p>' +
        '<div class="code-block"><div class="code-block-header"><span>javascript</span><span class="cb-action">Copy</span></div><pre>const theme = \'applied\';</pre></div>' +
        '<p>Every surface is painted by the preset\'s <code>--color-gray-*</code> ramp, the same variables the designer generates.</p>',
        null,
        { seconds: 6, body: 'The user wants to see the preset on realistic chat content. I should show the layout pieces the theme actually paints: the sidebar, a user bubble, inline code, a fenced code block, and the input shell, so every themed surface is visible at once.' })}
      ${userRow('Nice. The palette applies to every surface?', true)}
      ${aiRowMulti([
        {
          stats: 'Response Speed: 98.7 t/s | Total Duration: 1.9s | Eval Count: 164 | Session: 2018 tokens',
          body: '<p><b>Exactly.</b> Backgrounds, borders, and text all come from the preset, and Canvas FX or gradients render behind the whole interface.</p>',
        },
        {
          stats: 'Response Speed: 101.2 t/s | Total Duration: 2.3s | Eval Count: 189 | Session: 2043 tokens',
          body: '<p>It does. The designer emits one <code>--color-gray-*</code> ramp per mode, and every surface here reads from it: backgrounds, borders, bubbles, even this pager. Regenerate a response and the palette holds.</p>',
        },
      ])}
    </div>
    <div class="input-wrap">
      <div id="chat-input-container">
        <div id="chat-input" class="ProseMirror input-prose" contenteditable="false"><p class="is-editor-empty" data-placeholder="Send a Message"><br></p></div>
        <div class="input-row">
          <span class="icon-btn" id="input-menu-button" role="button" aria-label="More" aria-haspopup="true" data-tip="More">${SVG.plusAlt}</span>
          <span class="input-divider"></span>
          <span class="icon-btn" id="integration-menu-button" role="button" aria-label="Integrations" aria-haspopup="true" data-tip="Integrations">${SVG.component}</span>
          <span class="input-pills" id="input-pills"></span>
          <span class="spacer"></span>
          <span class="model-select" id="model-selector-model-button" role="button" aria-haspopup="listbox"><span class="name">Preview Model</span>${SVG.chevronDown}</span>
          <span class="mic-btn" data-tip="Dictate">${SVG.mic}</span>
          <button class="call-button bg-black text-white dark:bg-white dark:text-black rounded-full p-[5px] self-center" data-tip="Voice mode">${SVG.voice}</button>
        </div>
      </div>
      <div class="footer-note">Preview Model can make mistakes. Verify important information.</div>
    </div>
    <!-- channel/Channel.svelte: its own navbar, list and input (built by script) -->
    <div class="channel-view" id="channel-view" hidden></div>
  </main>
  <!-- ChatControls.svelte on desktop: a 350px pane after a resizer border -->
  <aside class="side-pane controls-pane" id="controls-pane" hidden aria-label="Controls"></aside>
  <!-- channel/Thread.svelte: a 420px pane beside the channel -->
  <aside class="side-pane thread-pane" id="thread-pane" hidden aria-label="Thread"></aside>
</div>
<script type="application/json" id="tdp-state">${JSON.stringify(opts.initialState || null).replace(/</g, '\\u003c')}</script>
<script>
// What you change in the mock (renamed, pinned, cloned or moved chats, your
// status, Chat Controls, channel messages) is sent up as you change it, and a
// rebuild for another mode or palette hands it back here, so switching modes
// keeps it. Each part registers a getter and reads its saved value on start.
(function () {
  var saved = null;
  try { saved = JSON.parse(document.getElementById('tdp-state').textContent); } catch (e) {}
  var parts = {}, queued = false;
  function post() {
    queued = false;
    var out = {};
    for (var k in parts) { try { out[k] = parts[k](); } catch (e) {} }
    try { parent.postMessage({ __tdpPreview: true, kind: 'mockstate', state: out }, '*'); } catch (e) {}
  }
  window.__tdpState = {
    saved: saved || {},
    add: function (name, get) { parts[name] = get; },
    save: function () { if (!queued) { queued = true; setTimeout(post, 0); } }
  };
  // The sidebar's rows are restored as markup before anything binds to them
  var side = document.querySelector('.sidebar-panel .side-scroll');
  if (side && saved && typeof saved.side === 'string') side.innerHTML = saved.side;
  if (side) {
    window.__tdpState.add('side', function () {
      var copy = side.cloneNode(true);
      copy.querySelectorAll('input.rename').forEach(function (i) { i.remove(); });
      copy.querySelectorAll('.label[hidden]').forEach(function (l) { l.hidden = false; });
      copy.querySelectorAll('.menu-open').forEach(function (r) { r.classList.remove('menu-open'); });
      return copy.innerHTML;
    });
    new MutationObserver(window.__tdpState.save).observe(side, { subtree: true, childList: true, attributes: true, characterData: true });
  }
})();
</script>
${opts.canvasScript ? `<script type="application/json" id="cfx-src">${JSON.stringify(opts.canvasScript).replace(/</g, '\\u003c')}</script>
<script>
(function () {
  var el = document.getElementById('cfx-src');
  var canvas = document.getElementById('owui-theme-canvas-bg');
  if (!el || !canvas) return;
  var report = function (text) { try { parent.postMessage({ __tdpPreview: true, kind: 'status', text: text }, '*'); } catch (e) {} };
  if (!canvas.transferControlToOffscreen) { report('Live Canvas FX preview needs a browser with OffscreenCanvas support.'); return; }
  var src;
  try { src = JSON.parse(el.textContent); } catch (e) { return; }
  // A frame that was just added can run this before it has a size, and a
  // script started at 0x0 can divide by it, so wait until it has one
  var px = null;
  var toRgb = function (value) {
    if (!px) { var c = document.createElement('canvas'); c.width = c.height = 1; px = c.getContext('2d', { willReadFrequently: true }); }
    px.clearRect(0, 0, 1, 1);
    px.fillStyle = '#808080';
    px.fillStyle = value;
    px.fillRect(0, 0, 1, 1);
    var d = px.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  // The same function as the designer's bootloader (theme_designer_pro_event.py)
  function buildCanvasTheme(readVar, toRgb, mode, hue, chroma) {
    var dark = mode === 'dark' || mode === 'oled';
    var hex = function(c) { return '#' + c.map(function(v) { return (v < 16 ? '0' : '') + v.toString(16); }).join(''); };
    var ramp = {}, rampRgb = {};
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 850, 900, 950].forEach(function(s) {
      rampRgb[s] = toRgb(readVar('--color-gray-' + s) || '#808080');
      ramp[s] = hex(rampRgb[s]);
    });
    // Accents in the theme's hue, as colorful as the theme itself
    var ac = chroma > 0 ? Math.min(0.18, Math.max(0.06, chroma / 250)) : 0;
    var al = dark ? 0.74 : 0.56;
    var accent = function(dh) { return toRgb('oklch(' + al + ' ' + ac.toFixed(3) + ' ' + ((hue + dh + 360) % 360).toFixed(1) + ')'); };
    var src = {
      background: rampRgb[dark ? 900 : 50], surface: rampRgb[dark ? 850 : 100],
      text: rampRgb[dark ? 100 : 900], muted: rampRgb[dark ? 400 : 500],
      accent: accent(0), accent2: accent(40), accent3: accent(-40)
    };
    var colors = {}, rgb = {};
    Object.keys(src).forEach(function(k) {
      colors[k] = hex(src[k]);
      rgb[k] = src[k].map(function(v) { return Math.round(v / 2.55) / 100; });
    });
    return { type: 'theme', mode: mode, dark: dark, hue: hue, chroma: chroma / 1000, colors: colors, rgb: rgb, ramp: ramp };
  }
  var started = false;
  var start = function () {
    if (started || !window.innerWidth || !window.innerHeight) return;
    started = true;
    window.removeEventListener('resize', start);
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    var url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
    var worker;
    try { worker = new Worker(url); } catch (e) { report('Could not start the animation worker: ' + e.message); return; }
    worker.onerror = function (e) { report('Script error: ' + (e.message || 'the animation failed to run.')); };
    var off = canvas.transferControlToOffscreen();
    var wpost = function (m, t) { try { worker.postMessage(m, t); } catch (e) {} };
    // The palette channel, as the designer sends it: with init, then on change
    var lastTheme = '';
    var theme = function () {
      try {
        var cs = getComputedStyle(document.documentElement);
        var dt = document.documentElement.getAttribute('data-theme');
        var mode = dt === 'oled-dark' ? 'oled' : dt === 'her' || dt === 'light' ? dt : 'dark';
        var t = buildCanvasTheme(function (n) { return cs.getPropertyValue(n).trim(); }, toRgb, mode,
          parseFloat(cs.getPropertyValue('--tdp-hue')) || 0, parseFloat(cs.getPropertyValue('--tdp-chroma')) || 0);
        lastTheme = JSON.stringify(t);
        return t;
      } catch (e) { return null; }
    };
    wpost({ type: 'init', canvas: off, width: window.innerWidth, height: window.innerHeight, env: { authToken: '', baseUrl: '', locale: navigator.language, timezone: '' }, theme: theme() }, [off]);
    window.addEventListener('tdp-palette', function () {
      var before = lastTheme, t = theme();
      if (t && lastTheme !== before) wpost(t);
    });
    var pend = null, raf = null;
    var pump = function () { raf = null; if (pend) { wpost(pend); pend = null; } };
    var qm = function (x, y) { pend = { type: 'mousemove', x: x, y: y }; if (!raf) raf = requestAnimationFrame(pump); };
    var xy = function (e) { try { return { x: e.clientX, y: e.clientY }; } catch (err) { return null; } };
    window.addEventListener('mousemove', function (e) { var p = xy(e); if (p) qm(p.x, p.y); }, { passive: true });
    window.addEventListener('click', function (e) { var p = xy(e); if (p) wpost({ type: 'click', x: p.x, y: p.y }); }, true);
    window.addEventListener('mousedown', function (e) { var p = xy(e); if (p) wpost({ type: 'mousedown', x: p.x, y: p.y }); }, true);
    window.addEventListener('mouseup', function (e) { var p = xy(e); if (p) wpost({ type: 'mouseup', x: p.x, y: p.y }); }, true);
    window.addEventListener('touchstart', function (e) { try { var t = e.touches[0]; if (t) wpost({ type: 'mousedown', x: t.clientX, y: t.clientY }); } catch (err) {} }, { passive: true });
    window.addEventListener('touchmove', function (e) { try { var t = e.touches[0]; if (t) qm(t.clientX, t.clientY); } catch (err) {} }, { passive: true });
    window.addEventListener('resize', function () { if (window.innerWidth && window.innerHeight) wpost({ type: 'resize', width: window.innerWidth, height: window.innerHeight }); });
  };
  window.addEventListener('resize', start);
  (function wait() { start(); if (!started) requestAnimationFrame(wait); })();
})();
</script>` : ''}
<script>
(function () {
  var post = function (kind, data) {
    try { parent.postMessage(Object.assign({ __tdpPreview: true, kind: kind }, data), '*'); } catch (e) {}
  };
  var xy = function (e) { try { return { x: e.clientX, y: e.clientY }; } catch (err) { return null; } };
  window.addEventListener('mousemove', function (e) { var p = xy(e); if (p) post('mousemove', p); }, { passive: true });
  window.addEventListener('click', function (e) { var p = xy(e); if (p) post('click', p); }, true);
  window.addEventListener('mousedown', function (e) { var p = xy(e); if (p) post('mousedown', p); }, true);
  window.addEventListener('mouseup', function (e) { var p = xy(e); if (p) post('mouseup', p); }, true);
  var touchList = function (e) {
    try {
      var list = e.touches.length ? e.touches : e.changedTouches;
      var out = [];
      for (var i = 0; i < list.length; i++) out.push({ x: list[i].clientX, y: list[i].clientY });
      return out;
    } catch (err) { return []; }
  };
  window.addEventListener('touchstart', function (e) { post('touchstart', { touches: touchList(e) }); }, { passive: true });
  window.addEventListener('touchmove', function (e) { post('touchmove', { touches: touchList(e) }); }, { passive: true });
  window.addEventListener('touchend', function (e) { post('touchend', { touches: touchList(e) }); }, { passive: true });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') post('escape', {}); });
})();

(function () {
  var msgs = document.getElementById('messages-container');
  var navTitle = document.getElementById('nav-title');
  if (!msgs || !navTitle) return;
  var BOLT_SVG = ${JSON.stringify(SVG.bolt)};
  var EYE_SVG = ${JSON.stringify(SVG.eyeSlash)};

  var MSG_ACTIONS_TPL = ${JSON.stringify(MSG_ACTIONS_TPL)};
  function msgActions(stats, pagerHtml) {
    var tip = String(stats || '').split(' | ').join('\\n')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    var row = MSG_ACTIONS_TPL.replace('__TDP_STATS__', tip);
    return pagerHtml ? row.replace('<div class="msg-actions">', '<div class="msg-actions">' + pagerHtml) : row;
  }

  function branchPager(i, n) {
    return '<div class="branch-pager">' +
      '<span class="branch-nav branch-prev">' + BRANCH_PREV + '</span>' +
      '<span class="branch-count">' + (i + 1) + '/' + n + '</span>' +
      '<span class="branch-nav branch-next">' + BRANCH_NEXT + '</span>' +
      '</div>';
  }
  var USER_ACTIONS = ${JSON.stringify(USER_ACTIONS)};
  var USER_ACTIONS_DEL = ${JSON.stringify(USER_ACTIONS_DEL)};
  var THOUGHT_CHEVRON = ${JSON.stringify(SVG.chevronDown)};
  var BRANCH_PREV = ${JSON.stringify(ACTION_SVG.prevMsg)};
  var BRANCH_NEXT = ${JSON.stringify(ACTION_SVG.nextMsg)};

  // Follow-ups only render on the last message upstream, and each of these
  // conversations has exactly one reply — so every ai() call may carry them.
  function followUps(items) {
    if (!items || !items.length) return '';
    return '<div class="followups-wrap"><div class="followups">' +
      '<div class="followups-title">Follow up</div><div class="followups-list">' +
      items.map(function (q, i) {
        return '<div class="followup" data-tip="' + q + '">' + q + '</div>' + (i < items.length - 1 ? '<hr>' : '');
      }).join('') +
      '</div></div></div>';
  }

  // Mirrors the outer thoughtBlock — reasoning collapsible, collapsed first
  function thought(t) {
    if (!t) return '';
    return '<div class="thought" role="button">Thought for ' + t.seconds + ' seconds' + THOUGHT_CHEVRON + '</div>' +
      '<div class="thought-body markdown-prose" hidden><blockquote>' + t.body + '</blockquote></div>';
  }
  function aiMulti(variants) {
    var n = variants.length;
    return '<div class="message-listitem group"><div class="msg">' +
      '<div class="ai-avatar"><img src="${LOGO}" alt=""></div>' +
      '<div class="ai-col flex-auto w-0 pl-1 relative">' +
      '<div class="ai-model">Preview Model</div>' +
      '<div class="branches">' +
      variants.map(function (v, i) {
        return '<div class="branch' + (i === 0 ? ' active' : '') + '">' +
          '<div class="ai-stats">' + v.stats + '</div>' +
          '<div class="chat-assistant w-full min-w-full">' + thought(v.thought) +
          '<div class="markdown-prose">' + v.body + '</div>' +
          msgActions(v.stats, n > 1 ? branchPager(i, n) : '') +
          followUps(v.fups || null) +
          '</div></div>';
      }).join('') +
      '</div></div></div></div>';
  }
  function ai(stats, body, fups, t) {
    return aiMulti([{ stats: stats, body: body, fups: fups, thought: t }]);
  }
  // notFirst mirrors UserMessage.svelte's !isFirstMessage gate on Delete
  function user(text, notFirst) {
    return '<div class="message-listitem group"><div class="msg user-message group">' +
      '<div class="chat-user w-full min-w-full">' +
      '<div class="bubble-row"><div class="bubble rounded-3xl max-w-[90%] px-4 py-1.5 bg-gray-50 dark:bg-gray-850"><div class="markdown-prose">' + text + '</div></div></div>' +
      (notFirst ? USER_ACTIONS_DEL : USER_ACTIONS) +
      '</div></div></div>';
  }

  var CHATS = {
    'default': { title: 'Theme preview chat', html: msgs.innerHTML },
    'oklch': {
      title: 'OKLCH color ramps',
      html: user('How does the 12-step gray ramp work?') +
        ai('Response Speed: 112.6 t/s | Total Duration: 3.1s | Eval Count: 301 | Session: 2410 tokens',
          '<p>Each mode generates twelve <code>--color-gray-*</code> steps from a single OKLCH base. Tables inherit the palette too:</p>' +
          '<table><thead><tr><th>Step</th><th>Lightness</th><th>Typical use</th></tr></thead><tbody>' +
          '<tr><td><code>50</code></td><td>98%</td><td>Light backgrounds</td></tr>' +
          '<tr><td><code>850</code></td><td>27%</td><td>Bubbles, panels</td></tr>' +
          '<tr><td><code>950</code></td><td>16%</td><td>Sidebar</td></tr>' +
          '</tbody></table>' +
          '<p>Shifting the base <b>lightness</b> slides the whole ramp while keeping the perceptual spacing intact.</p>',
          ['Why OKLCH instead of HSL for the ramp?',
           'How do I keep contrast accessible across all twelve steps?',
           'Can I pin a single step and regenerate the rest?'])
    },
    'fx': {
      title: 'Canvas FX ideas',
      html: user('Give me some Canvas FX concepts that react to the conversation.') +
        ai('Response Speed: 96.2 t/s | Total Duration: 4.7s | Eval Count: 412 | Session: 3188 tokens',
          '<p>A few <b>context-aware</b> favorites:</p>' +
          '<ul><li><b>Sunflower</b>: seed to full bloom as tokens accumulate</li>' +
          '<li><b>Mushroom farm</b>: mycelium spreads with every reply</li>' +
          '<li><b>Hourglass</b>: sand drains as the window fills</li></ul>' +
          '<blockquote>Any metaphor with a clear empty-to-full progression works. The engine streams live token counts to your script.</blockquote>' +
          '<p>All of them fall back to <code>estimatedTokens</code> when exact usage data is unavailable.</p>',
          ['What data does the engine stream to my script?',
           'How expensive are these effects on a laptop GPU?',
           'Can a script react to which model is selected?'])
    },
    'gradient': {
      title: 'Gradient inspiration',
      html: user('What kind of gradients look good behind a chat UI?') +
        aiMulti([
          {
            stats: 'Response Speed: 101.4 t/s | Total Duration: 2.2s | Eval Count: 198 | Session: 1544 tokens',
            body: '<p>Three directions worth trying:</p>' +
              '<ol><li><b>Deep linear</b>: near-black corners into a saturated core</li>' +
              '<li><b>Radial glow</b>: a soft light source behind the input bar</li>' +
              '<li><b>Mesh</b>: several drifting color points for an aurora feel</li></ol>' +
              '<p>Browse the <a>preset gallery</a> for ready-made packs. Every one imports with a single URL.</p>',
            fups: ['How do I animate a gradient without it feeling busy?',
              'Which gradients hold up in light mode?',
              'Can I export a gradient I built back out as a preset?'],
          },
          {
            stats: 'Response Speed: 97.8 t/s | Total Duration: 2.6s | Eval Count: 214 | Session: 1602 tokens',
            body: '<p>Regenerated take: anchor a <b>radial glow</b> behind the input bar first, then layer a slow mesh drift over it for depth without motion sickness.</p>' +
              '<p>Keep the darkest stop near the sidebar so text stays readable, and preview both <code>dark</code> and <code>light</code> before committing.</p>',
            fups: ['What intensity works best for mesh gradients?',
              'Can the gradient animate only when the chat is idle?'],
          },
        ])
    },
    'transparency': {
      title: 'Structural transparency',
      html: user('How do effects show through the interface?') +
        ai('Response Speed: 108.9 t/s | Total Duration: 2.8s | Eval Count: 264 | Session: 2035 tokens',
          '<h4>The structural layer</h4>' +
          '<p>When Canvas FX or a gradient is active, layout containers turn <code>transparent</code> so the effect shines through, while the sidebar keeps a frosted-glass backdrop for readability.</p>' +
          '<p>Portaled menus and dialogs live <b>outside</b> the app container, so they stay opaque and every dropdown stays readable.</p>',
          ['Which containers get transparency applied?',
           'How do I keep code blocks readable over an effect?',
           'Does the frosted sidebar cost much performance?'],
          { seconds: 12, body: 'They are asking how effects remain visible behind the UI. The key is the structural layer: it clears backgrounds on the layout wrappers while the sidebar keeps a frosted backdrop, and portaled overlays are deliberately left opaque so menus stay legible.' })
    },
    'notes': {
      title: 'Preset gallery notes',
      html: user('Remind me what this gallery can preview.') +
        ai('Response Speed: 99.1 t/s | Total Duration: 1.6s | Eval Count: 142 | Session: 1210 tokens',
          '<p>Everything, live:</p>' +
          '<ul><li><b>Themes</b>: full palette on this mock UI, per mode</li>' +
          '<li><b>Canvas FX</b>: real Web Worker execution behind the chat</li>' +
          '<li><b>CSS presets</b>: applied to genuine Open WebUI markup</li>' +
          '<li><b>Gradients</b>: exact designer math, animation included</li></ul>',
          ['How do I submit a preset to this gallery?',
           'Can I preview a preset before importing it?',
           'What makes a good Canvas FX submission?'])
    },
    brand: {
      title: 'Brand palette v2',
      html: user('Can you turn our brand teal into a full gray ramp?') +
        ai('Response Speed: 97.4 t/s | Total Duration: 1.9s | Eval Count: 171 | Session: 1402 tokens',
          '<p>Sure. Keep the hue and drop the chroma low, and the twelve steps stay readable in every mode:</p>' +
          '<ul><li><b>Hue</b>: 192, your teal</li><li><b>Chroma</b>: 0.022 for surfaces, the accent keeps its full color</li><li><b>Lightness</b>: 18% for Dark, 0% for OLED</li></ul>',
          ['Show it on Light mode', 'Pick an accent that pairs with it'])
    },
    digest: {
      title: 'Weekly theme digest',
      html: user('Summarize what changed in the gallery this week.') +
        ai('Response Speed: 102.6 t/s | Total Duration: 2.1s | Eval Count: 204 | Session: 1688 tokens',
          '<p>A busy week:</p>' +
          '<ul><li><b>Koi Pond</b> and <b>Midsummer</b> joined the themes</li>' +
          '<li>Twelve Canvas FX now <b>follow your theme</b></li>' +
          '<li>The Studio can tune an animation\\'s own settings</li></ul>',
          null)
    },
    launch: {
      title: 'Launch checklist',
      html: user('What should I check before I submit a theme?') +
        ai('Response Speed: 95.8 t/s | Total Duration: 1.7s | Eval Count: 158 | Session: 1290 tokens',
          '<ol><li>Each mode reads well: Dark, OLED, Light and Her</li>' +
          '<li>Text keeps its contrast over the background</li>' +
          '<li>The Canvas FX runs smoothly on a laptop</li>' +
          '<li>The preview link from the submission bot looks right</li></ol>',
          null)
    },
    'new': {
      title: 'New Chat',
      html: '<div class="placeholder">' +
        '<div class="ph-head">' +
        '<div class="ph-temp" data-tip="This chat won\\'t appear in history and your messages will not be saved.">' + EYE_SVG + 'Temporary Chat</div>' +
        '<div class="ph-logo"><img src="${LOGO}" alt=""></div>' +
        '<div class="ph-model">Preview Model</div>' +
        '<div class="ph-sub">How can I help you today?</div>' +
        '</div>' +
        '<div class="ph-suggest">' +
        '<div class="ph-label">' + BOLT_SVG + 'Suggested</div>' +
        '<div class="ph-grid">' +
        '<div class="ph-card"><b>Tell me a fun fact</b><span>about the Roman Empire</span></div>' +
        '<div class="ph-card"><b>Help me study</b><span>vocabulary for a college entrance exam</span></div>' +
        '<div class="ph-card"><b>Explain options trading</b><span>if I\\'m familiar with buying and selling stocks</span></div>' +
        '<div class="ph-card"><b>Overcome procrastination</b><span>give me tips</span></div>' +
        '<div class="ph-card"><b>Show me a code snippet</b><span>of a website\\'s sticky header</span></div>' +
        '<div class="ph-card"><b>Give me ideas</b><span>for what to do with my kids\\' art</span></div>' +
        '</div></div></div>'
    }
  };

  var mainEl = document.querySelector('main');
  function openChat(key) {
    var channel = key.indexOf('channel:') === 0;
    var chat = CHATS[key];
    if (!chat && !channel) return;
    document.querySelectorAll('.side-item.active, .channel-item.active').forEach(function (a) { a.classList.remove('active'); });
    if (key !== 'new') {
      document.querySelectorAll('.side-scroll [data-chat="' + key + '"]').forEach(function (item) {
        item.classList.add('active');
        item.classList.remove('unread');
        var dot = item.querySelector('.unread-dot, .unread-badge');
        if (dot) dot.remove();
      });
    }
    // A saved chat is never temporary; the Thread and Controls panes belong
    // to the view they were opened from
    if (key !== 'new' && window.__tdpTemp) window.__tdpTemp(false);
    if (window.__tdpPanes) window.__tdpPanes.closeAll(channel);
    mainEl.classList.toggle('channel-mode', channel);
    if (channel) {
      if (window.__tdpChannel) window.__tdpChannel.open(key.slice(8));
      try { parent.postMessage({ __tdpPreview: true, kind: 'chatchange', chat: key }, '*'); } catch (e) {}
      return;
    }
    if (window.__tdpChannel) window.__tdpChannel.close();
    var row = document.querySelector('.side-scroll [data-chat="' + key + '"] .label');
    navTitle.textContent = key !== 'new' && row ? row.textContent : chat.title;
    // Navbar.svelte gates Temporary Chat on !chat?.id, so it shows only here
    var navRight = document.getElementById('nav-right');
    if (navRight) navRight.classList.toggle('is-new', key === 'new');
    // and :117 gates the title + chat menu on chat?.id — hidden on New Chat
    var navEl = document.querySelector('nav');
    if (navEl) navEl.classList.toggle('is-new', key === 'new');
    msgs.innerHTML = chat.html;
    // the offset is measured, so it has to be recomputed for the new content
    if (window.__tdpApplyInset) window.__tdpApplyInset();
    try { parent.postMessage({ __tdpPreview: true, kind: 'chatchange', chat: key }, '*'); } catch (e) {}
  }

  // Delegated, so rows the chat menu renames, clones or moves keep working
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-chat]') : null;
    if (!el || e.target.closest('.chat-actions, .ch-settings, input')) return;
    openChat(el.getAttribute('data-chat'));
  });
  window.__tdpOpenChat = openChat;

  // Branch pager: show the previous/next regenerated variant. Bounds are
  // guarded like showPreviousMessage/showNextMessage upstream.
  msgs.addEventListener('click', function (e) {
    var nav = e.target && e.target.closest ? e.target.closest('.branch-nav') : null;
    if (!nav || !msgs.contains(nav)) return;
    var wrap = nav.closest('.branches');
    if (!wrap) return;
    var branches = [].slice.call(wrap.children);
    var cur = -1;
    branches.forEach(function (b, i) { if (b.classList.contains('active')) cur = i; });
    var next = nav.classList.contains('branch-next') ? cur + 1 : cur - 1;
    if (cur < 0 || next < 0 || next >= branches.length) return;
    branches[cur].classList.remove('active');
    branches[next].classList.add('active');
  });

  // Reasoning collapsibles toggle like Collapsible.svelte. Delegated from the
  // container so chat switches (which replace innerHTML) keep working.
  msgs.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('.thought') : null;
    if (!t || !msgs.contains(t)) return;
    var body = t.nextElementSibling;
    if (!body || !body.classList.contains('thought-body')) return;
    var open = body.hasAttribute('hidden');
    if (open) body.removeAttribute('hidden'); else body.setAttribute('hidden', '');
    t.classList.toggle('open', open);
  });

  var initial = document.body.getAttribute('data-initial-chat');
  // Channels are set up by a later script, so they open once it has run
  if (initial && initial !== 'default' && (CHATS[initial] || initial.indexOf('channel:') === 0)) setTimeout(function () { openChat(initial); }, 0);
})();

// Sidebar collapse/expand. Open WebUI drives this from the showSidebar store:
// the expanded panel's header button closes it, and the collapsed rail (the
// whole column is a button) reopens it.
(function () {
  var app = document.querySelector('.app');
  var rail = document.querySelector('.sidebar-rail');
  var toggle = document.querySelector('.brand .panel-icon');
  if (!app || !rail || !toggle) return;

  var backdrop = document.getElementById('backdrop');
  var navToggle = document.querySelector('.nav-toggle');
  var MOBILE = 768; // routes/+layout.svelte BREAKPOINT

  // Sandboxed srcdoc frames run this script before layout, while innerWidth
  // is still 0 — which must not read as "mobile", or every mode-pill rebuild
  // would collapse an expanded sidebar.
  function isMobile() { return window.innerWidth > 0 && window.innerWidth < MOBILE; }

  var panel = document.querySelector('.sidebar-panel');

  // Upstream the rail (Sidebar.svelte:810) and the expanded panel (:983) are
  // separate elements behind an {#if}, but both carry id="sidebar" — so only
  // ever one exists and preset CSS written against #sidebar hits whichever is
  // showing. The mock keeps both in the DOM for the collapse transition, so
  // the id is moved to the visible one instead. Without this, a theme styling
  // #sidebar (rounding, borders, backgrounds) would skip the collapsed rail.
  function syncSidebarId(collapsed) {
    var active = collapsed ? rail : panel;
    var inactive = collapsed ? panel : rail;
    if (inactive) inactive.removeAttribute('id');
    if (active) active.id = 'sidebar';
  }

  function setCollapsed(on) {
    app.classList.toggle('collapsed', on);
    syncSidebarId(on);
    try { parent.postMessage({ __tdpPreview: true, kind: 'sidebarchange', collapsed: on }, '*'); } catch (e) {}
  }

  toggle.addEventListener('click', function (e) { e.stopPropagation(); setCollapsed(true); });

  // The rail expands when you click the logo or empty space, but its action
  // buttons don't — upstream each one calls stopImmediatePropagation so it
  // runs its own handler instead of the enclosing expand button. The New Chat
  // pencil therefore opens the New Chat view with the sidebar still collapsed,
  // and the user menu sits outside that button entirely.
  rail.addEventListener('click', function () { setCollapsed(false); });
  rail.querySelectorAll('.rail-action').forEach(function (el) {
    el.addEventListener('click', function (e) { e.stopPropagation(); });
  });
  if (navToggle) navToggle.addEventListener('click', function (e) { e.stopPropagation(); setCollapsed(false); });
  if (backdrop) backdrop.addEventListener('click', function () { setCollapsed(true); });

  // showSidebar defaults to false on mobile, and closes when crossing into it.
  // Applied twice: once synchronously (attr only, width may still be 0) and
  // once after first layout, when the mobile default can be judged for real.
  var attrCollapsed = document.body.getAttribute('data-sidebar-collapsed') === '1';
  var wasMobile = isMobile();
  function applyInitial() {
    var start = attrCollapsed || isMobile();
    app.classList.toggle('collapsed', start);
    syncSidebarId(start);
    wasMobile = isMobile();
  }
  applyInitial();
  requestAnimationFrame(applyInitial);
  window.addEventListener('resize', function () {
    var now = isMobile();
    if (now !== wasMobile) {
      wasMobile = now;
      if (now) setCollapsed(true);
    }
  });
})();

// Tippy-style tooltips (Tooltip.svelte, theme 'dark'). One fixed element,
// delegated hover, placements top (default) / bottom / right matching the
// upstream call sites. Delegation keeps injected chat HTML working.
(function () {
  var tip = document.createElement('div');
  tip.id = 'tdp-tooltip';
  document.body.appendChild(tip);
  var current = null;
  document.addEventListener('mouseover', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (el === current) return;
    current = el;
    if (!el) { tip.classList.remove('show'); return; }
    tip.textContent = el.getAttribute('data-tip');
    tip.classList.toggle('pre', tip.textContent.indexOf('\\n') !== -1);
    tip.classList.add('show');
    var r = el.getBoundingClientRect();
    var p = el.getAttribute('data-tip-placement') || 'top';
    var tw = tip.offsetWidth, th = tip.offsetHeight, x, y;
    if (p === 'bottom') { x = r.left + r.width / 2 - tw / 2; y = r.bottom + 6; }
    else if (p === 'right') { x = r.right + 6; y = r.top + r.height / 2 - th / 2; }
    else { x = r.left + r.width / 2 - tw / 2; y = r.top - th - 6; }
    x = Math.max(4, Math.min(x, window.innerWidth - tw - 4));
    y = Math.max(4, Math.min(y, window.innerHeight - th - 4));
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  });
  document.addEventListener('mouseleave', function () { current = null; tip.classList.remove('show'); }, true);
})();

// The input bar's menus as mocks that work: More (InputMenu.svelte),
// Integrations (IntegrationsMenu.svelte) and the model selector
// (ModelSelector/Selector.svelte). Each is portaled to <body> and opens above
// its button, as Dropdown.svelte flips up at the bottom of the screen, and
// carries the upstream class names so a preset's CSS reaches it too. They
// show what an admin sees with web search, image generation and three tools
// set up; a row that would upload, capture or fetch just closes the menu.
(function () {
  var moreBtn = document.getElementById('input-menu-button');
  var intBtn = document.getElementById('integration-menu-button');
  var modelBtn = document.getElementById('model-selector-model-button');
  var pills = document.getElementById('input-pills');
  if (!moreBtn || !intBtn || !modelBtn || !pills) return;
  var I = ${JSON.stringify({ share: SVG.share, download: SVG.download, editPencil: SVG.editPencil, chatCheck: SVG.chatCheck, pin: SVG.pin, pinSlash: SVG.pinSlash, copy: SVG.copy, folder: SVG.folder, archiveBox: SVG.archiveBox, trash: SVG.trash, cog: SVG.cog, logOut: SVG.logOut, emojiFace: SVG.emojiFace, user: SVG.user, workspace: SVG.workspace, notes: SVG.notes, code: SVG.code, checkAlt: SVG.check, clip: SVG.clip, camera: SVG.camera, globeAlt: SVG.globeAlt, documentArrowUp: SVG.documentArrowUp, pageEdit: SVG.pageEdit, database: SVG.database, clockRotateRight: SVG.clockRotateRight, chevronRightAlt: SVG.chevronRightAlt, chevronLeft: SVG.chevronLeft, chevronDown: SVG.chevronDown, wrench: SVG.wrench, searchAlt: SVG.searchAlt, photo: SVG.photo, terminal: SVG.terminal, check: SVG.check, keyframes: SVG.keyframes, documentPage: SVG.documentPage, dots: SVG.dots, globePill: SVG.globePill, photoPill: SVG.photoPill, terminalPill: SVG.terminalPill, wrenchPill: SVG.wrenchPill, xMark: SVG.xMark })};
  var LOGO_SRC = ${JSON.stringify(LOGO)};

  var TOOLS = ['Web Scraper', 'Calculator', 'Weather'];
  var FILES = ['palette-notes.md', 'brand-guidelines.pdf', 'dark-mode-screenshot.png', 'theme-export.json'];
  var NOTES = ['Theme ideas', 'Font pairings'];
  var KNOWLEDGE = [
    { name: 'Design System', files: ['tokens.json', 'components.md'] },
    { name: 'Product Docs', files: ['getting-started.md', 'faq.md'] }
  ];
  var MODELS = [
    { name: 'Preview Model' }, { name: 'Preview Model Mini' }, { name: 'Reasoning Model' },
    { name: 'Vision Model' }, { name: 'Local Model', size: '8B' }
  ];
  var state = { webSearch: false, image: false, code: false, tools: [false, false, false], model: 0, compare: false };
  var open = null;

  function chats() {
    var out = [];
    document.querySelectorAll('.side-scroll [data-chat] .label').forEach(function (el) {
      if (el.closest('[data-chat="new"]')) return;
      if (out.indexOf(el.textContent) === -1) out.push(el.textContent);
    });
    return out;
  }
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function chev() { return '<span class="chev">' + I.chevronRightAlt + '</span>'; }
  function sw(on) { return '<span class="tdp-switch' + (on ? ' on' : '') + '" role="switch" aria-checked="' + on + '"></span>'; }
  function row(act, ico, label, more) {
    return '<button type="button" class="tdp-row" data-act="' + act + '">' + ico + '<span class="label">' + label + '</span>' + (more || '') + '</button>';
  }
  function toggleRow(key, ico, label) {
    return '<button type="button" class="tdp-row" data-act="toggle:' + key + '" aria-pressed="' + state[key] + '"><span class="ico' + (key === 'webSearch' ? '' : ' sm') + '">' + ico + '</span><span class="label">' + label + '</span>' + sw(state[key]) + '</button>';
  }
  function isNewChat() { var n = document.querySelector('nav'); return !!(n && n.classList.contains('is-new')); }

  // ---- Opening, placing and closing ----

  function hideTip() { var t = document.getElementById('tdp-tooltip'); if (t) t.classList.remove('show'); }

  function close() {
    if (!open) return;
    closeSub();
    open.el.remove();
    open.trigger.setAttribute('aria-expanded', 'false');
    if (open.ctx && open.ctx.onClose) open.ctx.onClose();
    open = null;
  }

  // Where each menu sits: Dropdown.svelte puts a menu's left edge (start) or
  // right edge (end) on its trigger, 4px off it and 16px from the window's
  // edges; Selector.svelte uses end, 2px and 8px
  var SPECS = {
    more: { align: 'start', gap: 4, pad: 16 }, integrations: { align: 'start', gap: 4, pad: 16 },
    model: { align: 'end', gap: 2, pad: 8 }, chat: { align: 'start', gap: 4, pad: 16 },
    user: { align: 'end', gap: 4, pad: 16 }, chatsMore: { align: 'end', gap: 4, pad: 16 },
    emoji: { align: 'start', gap: 4, pad: 16 }
  };

  function show(kind, trigger, view, ctx) {
    var was = open && open.kind, wasTrigger = open && open.trigger;
    close();
    if (was === kind && wasTrigger === trigger && !view) return;
    hideTip();
    var el = document.createElement('div');
    open = { kind: kind, el: el, trigger: trigger, ctx: ctx || {} };
    trigger.setAttribute('aria-expanded', 'true');
    document.body.appendChild(el);
    if (kind === 'more') renderMore(view || 'root', 'from-left');
    else if (kind === 'integrations') renderIntegrations(view || 'root', 'from-left');
    else if (kind === 'model') renderModels();
    else RENDER[kind](el, open.ctx);
    place();
    el.addEventListener('click', onMenuClick);
    el.addEventListener('mouseover', onMenuHover);
    requestAnimationFrame(function () { if (open && open.el === el) el.classList.add('in'); });
  }

  // Both open downward unless there is more room above (the input bar's and
  // the user menu flip up; a chat's opens down)
  function place() {
    if (!open) return;
    var el = open.el, r = open.trigger.getBoundingClientRect();
    var spec = SPECS[open.kind];
    var w = el.offsetWidth, h = el.offsetHeight;
    // An end-aligned menu is placed by its right edge, so only that side
    // keeps the gap from the window
    var left = spec.align === 'end' ? r.right - w : r.left;
    left = Math.min(left, window.innerWidth - w - spec.pad);
    if (spec.align !== 'end') left = Math.max(spec.pad, left);
    left = Math.max(4, left);
    var below = window.innerHeight - r.bottom;
    var top = below >= r.top ? r.bottom + spec.gap : r.top - spec.gap - h;
    el.style.left = left + 'px';
    el.style.top = Math.max(8, top) + 'px';
  }

  // DropdownSub.svelte: opens on hover to the right of its row, 8px off,
  // flipping left when there is no room
  function openSub(row, html) {
    if (open.sub && open.sub.row === row) return;
    closeSub();
    var sub = document.createElement('div');
    sub.className = 'tdp-menu submenu app-dropdown-menu in';
    sub.setAttribute('role', 'menu');
    sub.innerHTML = html;
    document.body.appendChild(sub);
    var mr = open.el.getBoundingClientRect(), rr = row.getBoundingClientRect();
    sub.style.minWidth = mr.width + 'px';
    var left = mr.right + 8;
    if (left + sub.offsetWidth > window.innerWidth - 8) left = mr.left - 8 - sub.offsetWidth;
    sub.style.left = Math.max(8, left) + 'px';
    sub.style.top = Math.max(8, Math.min(rr.top - 3, window.innerHeight - sub.offsetHeight - 8)) + 'px';
    sub.addEventListener('click', onMenuClick);
    open.sub = { el: sub, row: row };
    row.classList.add('hl');
  }
  function closeSub() {
    if (!open || !open.sub) return;
    open.sub.row.classList.remove('hl');
    open.sub.el.remove();
    open.sub = null;
  }

  document.addEventListener('mousedown', function (e) {
    if (!open || open.el.contains(e.target) || open.trigger.contains(e.target)) return;
    if (open.sub && open.sub.el.contains(e.target)) return;
    close();
  }, true);
  // Escape closes the menu, and goes no further: the page around the
  // preview would take it as closing the whole preview
  window.addEventListener('keydown', function (e) {
    if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  }, true);
  window.addEventListener('resize', place);

  moreBtn.addEventListener('click', function () { show('more', moreBtn); });
  intBtn.addEventListener('click', function () { show('integrations', intBtn); });
  modelBtn.addEventListener('click', function () { show('model', modelBtn); });

  // ---- More ----

  function renderMore(view, fly) {
    var el = open.el;
    el.className = 'tdp-menu input-menu app-dropdown-menu rounded-xl border border-gray-100 dark:border-gray-800 z-50 bg-white dark:bg-gray-850 dark:text-white shadow-lg' + (open.el.classList.contains('in') ? ' in' : '');
    el.setAttribute('role', 'menu');
    open.view = view;
    if (view === 'root') {
      el.innerHTML = '<div class="tdp-view ' + fly + '">' +
        row('close', I.clip, 'Upload Files') +
        row('close', I.camera, 'Capture') +
        row('close', I.globeAlt, 'Attach Webpage') +
        row('tab:files', I.documentArrowUp, 'Attach Files', chev()) +
        row('tab:notes', I.pageEdit, 'Attach Notes', chev()) +
        row('tab:knowledge', I.database, 'Attach Knowledge', chev()) +
        row('tab:chats', I.clockRotateRight, 'Reference Chats', chev()) +
        '</div>';
    } else {
      var t = SUBTABS[view];
      el.innerHTML = '<div class="tdp-view ' + fly + '">' +
        '<button type="button" class="tdp-row back" data-act="back">' + I.chevronLeft + '<span class="label">' + t.title + '</span></button>' +
        '<div class="tdp-search">' + I.searchAlt + '<input placeholder="' + t.placeholder + '" autocomplete="off"></div>' +
        '<div class="tdp-list"></div></div>';
      var input = el.querySelector('input');
      input.addEventListener('input', function () { fillList(view, input.value); });
      fillList(view, '');
    }
    place();
  }

  var SUBTABS = {
    files: { title: 'Files', placeholder: 'Search Files', empty: 'No files found', items: function () { return FILES; } },
    notes: { title: 'Notes', placeholder: 'Search Notes', empty: 'No notes found', items: function () { return NOTES; } },
    knowledge: { title: 'Knowledge', placeholder: 'Search Knowledge', empty: 'No knowledge bases found.', items: function () { return KNOWLEDGE.map(function (k) { return k.name; }); } },
    chats: { title: 'Chats', placeholder: 'Search Chats', empty: 'No chats found', items: chats }
  };

  function fillList(view, q) {
    var list = open.el.querySelector('.tdp-list');
    var t = SUBTABS[view];
    var items = t.items().filter(function (n) { return n.toLowerCase().indexOf(q.trim().toLowerCase()) !== -1; });
    if (!items.length) { list.innerHTML = '<div class="tdp-empty">' + t.empty + '</div>'; place(); return; }
    list.innerHTML = items.map(function (name, i) {
      var hl = i === 0 ? ' hl' : '';
      if (view === 'knowledge') {
        var kb = KNOWLEDGE.filter(function (k) { return k.name === name; })[0];
        return '<div class="tdp-row item' + hl + '" data-act="close"><span class="ico sm">' + I.database + '</span><span class="label">' + esc(name) + '</span>' +
          '<span class="expand" data-act="expand" role="button" aria-label="Show files">' + I.chevronRightAlt + '</span></div>' +
          '<div class="tdp-kb-files" hidden>' + kb.files.map(function (f) {
            return '<div class="tdp-row item" data-act="close"><span class="doc">' + I.documentPage + '</span><span class="label">' + esc(f) + '</span></div>';
          }).join('') + '</div>';
      }
      var ico = view === 'chats' ? '' : '<span class="doc">' + (view === 'notes' ? I.pageEdit : I.documentPage) + '</span>';
      return '<button type="button" class="tdp-row item' + hl + '" data-act="close">' + ico + '<span class="label">' + esc(name) + '</span></button>';
    }).join('');
    place();
  }

  // ---- Integrations ----

  function renderIntegrations(view, fly) {
    var el = open.el;
    el.className = 'tdp-menu integrations-menu app-dropdown-menu rounded-xl border border-gray-100 dark:border-gray-800 z-50 bg-white dark:bg-gray-850 dark:text-white shadow-lg' + (open.el.classList.contains('in') ? ' in' : '');
    el.setAttribute('role', 'menu');
    open.view = view;
    if (view === 'root') {
      el.innerHTML = '<div class="tdp-view ' + fly + '">' +
        row('tab:tools', I.wrench, 'Tools <span class="count">' + TOOLS.length + '</span>', chev()) +
        toggleRow('webSearch', I.globeAlt, 'Web Search') +
        toggleRow('image', I.photo, 'Image') +
        toggleRow('code', I.terminal, 'Code Interpreter') +
        '</div>';
    } else {
      el.innerHTML = '<div class="tdp-view ' + fly + '">' +
        '<button type="button" class="tdp-row back" data-act="back">' + I.chevronLeft + '<span class="label">Tools <span class="count">' + TOOLS.length + '</span></span></button>' +
        '<div class="tdp-search">' + I.searchAlt + '<input placeholder="Search tools" autocomplete="off"></div>' +
        '<div class="tdp-list"></div></div>';
      var input = el.querySelector('input');
      input.addEventListener('input', function () { fillTools(input.value); });
      fillTools('');
    }
    place();
  }

  function fillTools(q) {
    var list = open.el.querySelector('.tdp-list');
    var rows = TOOLS.map(function (name, i) {
      if (name.toLowerCase().indexOf(q.trim().toLowerCase()) === -1) return '';
      return '<button type="button" class="tdp-row" data-act="tool:' + i + '" aria-pressed="' + state.tools[i] + '"><span class="ico">' + I.wrench + '</span><span class="label">' + esc(name) + '</span>' + sw(state.tools[i]) + '</button>';
    }).join('');
    list.innerHTML = rows || '<div class="tdp-empty">No tools found</div>';
    place();
  }

  // The pills after Integrations: selected tools, then each feature that is on
  function renderPills() {
    var n = state.tools.filter(Boolean).length, h = '';
    if (n) h += '<span class="tools-pill" data-pill="tools" role="button" aria-label="Available Tools" data-tip="' + n + ' Available Tools">' + I.wrenchPill + '<span>' + n + '</span></span>';
    if (state.webSearch) h += pill('webSearch', 'Web Search', I.globePill);
    if (state.image) h += pill('image', 'Image', I.photoPill);
    if (state.code) h += pill('code', 'Code Interpreter', '<span class="terminal-icon">' + I.terminalPill + '</span>');
    pills.innerHTML = h;
  }
  function pill(key, tip, ico) {
    return '<span class="feature-pill group" data-pill="' + key + '" role="button" aria-pressed="true" data-tip="' + tip + '">' + ico + '<span class="x">' + I.xMark + '</span></span>';
  }
  pills.addEventListener('click', function (e) {
    var p = e.target.closest('[data-pill]');
    if (!p) return;
    hideTip();
    if (p.dataset.pill === 'tools') { show('integrations', intBtn, 'tools'); return; }
    state[p.dataset.pill] = false;
    renderPills();
    if (open && open.kind === 'integrations' && open.view === 'root') renderIntegrations('root', '');
  });

  // ---- Model selector ----

  function renderModels() {
    var el = open.el;
    el.className = 'tdp-menu model-menu z-40 w-[20rem] rounded-xl border border-gray-100 bg-white p-0.5 shadow-lg dark:border-gray-800 dark:bg-gray-850 dark:text-white';
    el.innerHTML = '<div class="tdp-search">' + I.searchAlt +
      '<input id="model-search-input" placeholder="Search a model" autocomplete="off" aria-label="Search In Models">' +
      '<span class="compare' + (state.compare ? ' on' : '') + '" data-act="compare" role="button" aria-label="Compare">' + I.keyframes + '</span></div>' +
      '<div class="model-list" role="listbox" aria-label="Available models"></div>' +
      (isNewChat() ? '<div class="model-foot"><span data-act="close">Set as default</span></div>' : '<div class="pb"></div>');
    var input = el.querySelector('input');
    open.hl = state.model;
    input.addEventListener('input', function () { open.hl = -1; fillModels(input.value); });
    input.addEventListener('keydown', function (e) {
      var rows = [].slice.call(open.el.querySelectorAll('.model-item'));
      if (!rows.length) return;
      var at = rows.findIndex(function (r) { return r.classList.contains('hl'); });
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        at = e.key === 'ArrowDown' ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1);
        rows.forEach(function (r, i) { r.classList.toggle('hl', i === at); });
        rows[at].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        pickModel(Number((rows[at] || rows[0]).dataset.model));
      }
    });
    fillModels('');
    input.focus();
  }

  function fillModels(q) {
    var list = open.el.querySelector('.model-list');
    var shown = MODELS.map(function (m, i) { return i; }).filter(function (i) { return MODELS[i].name.toLowerCase().indexOf(q.trim().toLowerCase()) !== -1; });
    // A search highlights its first result, for the arrow keys and Enter
    if (shown.indexOf(open.hl) === -1) open.hl = shown.length ? shown[0] : -1;
    var rows = MODELS.map(function (m, i) {
      if (shown.indexOf(i) === -1) return '';
      var sel = i === state.model;
      return '<div class="model-item' + (sel ? ' selected' : '') + (i === open.hl ? ' hl' : '') + '" role="option" aria-selected="' + sel + '" data-model="' + i + '">' +
        '<div class="main"><img src="' + LOGO_SRC + '" alt=""><span class="name">' + esc(m.name) + '</span>' + (m.size ? '<span class="size">' + m.size + '</span>' : '') + '</div>' +
        '<div class="end"><span aria-label="More Options">' + I.dots + '</span>' + (sel ? '<span class="tick">' + I.check + '</span>' : '') + '</div></div>';
    }).join('');
    list.innerHTML = rows || '<div class="model-empty">No results found</div>';
    place();
  }

  function pickModel(i) {
    state.model = i;
    modelBtn.querySelector('.name').textContent = MODELS[i].name;
    close();
  }

  // ---- Sidebar menus, the Chats header's More and the reaction picker ----

  function mi(act, ico, label, more) {
    return '<button type="button" class="mi" data-act="do:' + act + '">' + (ico || '') + '<span class="label">' + label + '</span>' + (more || '') + '</button>';
  }
  var RENDER = {
    // Sidebar/ChatMenu.svelte, for an admin with one folder
    chat: function (el, ctx) {
      el.className = 'tdp-menu chat-menu app-dropdown-menu select-none rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-850 dark:text-white shadow-lg';
      el.setAttribute('role', 'menu');
      var pinned = ctx.pinned();
      el.innerHTML =
        mi('none', I.share, 'Share') +
        '<button type="button" class="mi sub" data-act="do:download" data-sub="download">' + I.download + '<span class="label">Download</span></button>' +
        mi('rename', I.editPencil, 'Rename') +
        mi('unread', I.chatCheck, 'Mark as unread') +
        '<hr>' +
        mi('pin', pinned ? I.pinSlash : I.pin, pinned ? 'Unpin' : 'Pin') +
        mi('clone', I.copy, 'Clone') +
        '<button type="button" class="mi sub" data-act="do:move" data-sub="move">' + I.folder + '<span class="label">Move</span></button>' +
        mi('archive', I.archiveBox, 'Archive') +
        mi('delete', I.trash, 'Delete');
    },
    // Sidebar/UserMenu.svelte, an admin with user status on
    user: function (el, ctx) {
      el.className = 'tdp-menu user-menu app-dropdown-menu font-sans text-xs rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-850 dark:text-white shadow-lg';
      el.setAttribute('role', 'menu');
      el.style.width = ctx.width + 'px';
      var st = ctx.status();
      el.innerHTML =
        '<button type="button" class="mi who" data-act="close"><span class="ico"><span class="avatar"></span></span><span class="label">You</span><span class="active-users" data-tip="Active Users"><i></i>1</span></button>' +
        (st
          ? '<button type="button" class="mi status" data-act="close"><span class="ico">' + st.emoji + '</span><span class="label">' + st.text + '</span><span class="clear" data-act="do:clear-status" data-tip="Clear status">' + I.xMark + '</span></button>'
          : '<button type="button" class="mi status" data-act="do:status"><span class="ico">' + I.emojiFace + '</span><span class="label">Update your status</span></button>') +
        '<hr>' +
        mi('none', I.workspace, 'Workspace') + mi('none', I.notes, 'Notes') + mi('none', I.code, 'Playground') +
        '<hr>' +
        mi('none', I.user, 'Admin Panel') + mi('none', I.cog, 'Settings') + mi('none', I.logOut, 'Sign Out');
    },
    chatsMore: function (el) {
      el.className = 'tdp-menu chats-more app-dropdown-menu rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-850 dark:text-white shadow-lg';
      el.innerHTML = mi('read-all', I.checkAlt, 'Mark all as read');
    },
    emoji: function (el) {
      el.className = 'tdp-menu emoji-menu rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-850 shadow-lg';
      el.innerHTML = ['\ud83d\udc4d', '\u2764\ufe0f', '\ud83d\ude02', '\ud83c\udf89', '\ud83d\udc40', '\ud83c\udfa8'].map(function (em) {
        return '<span class="em" data-act="do:emoji" data-emoji="' + em + '">' + em + '</span>';
      }).join('');
    }
  };
  window.__tdpMenus = { show: show, close: close, item: mi };

  // ---- Clicks inside a menu ----

  function onMenuHover(e) {
    var item = e.target.closest('.mi');
    if (item && open.ctx.subs) {
      if (item.dataset.sub) openSub(item, open.ctx.subs[item.dataset.sub]());
      else closeSub();
    }
    var r = e.target.closest('.tdp-list .tdp-row.item, .model-item');
    if (!r) return;
    open.el.querySelectorAll('.hl').forEach(function (x) { if (x !== r) x.classList.remove('hl'); });
    r.classList.add('hl');
  }

  function onMenuClick(e) {
    var model = e.target.closest('.model-item');
    if (model) { pickModel(Number(model.dataset.model)); return; }
    var a = e.target.closest('[data-act]');
    if (!a) return;
    var act = a.dataset.act;
    if (act === 'close') { close(); return; }
    if (act.indexOf('do:') === 0) {
      var ctx = open.ctx;
      if (a.dataset.sub) { openSub(a, ctx.subs[a.dataset.sub]()); return; }
      var keep = ctx.onAct && ctx.onAct(act.slice(3), a);
      if (!keep) close();
      return;
    }
    if (act === 'expand') {
      e.stopPropagation();
      var files = a.closest('.tdp-row').nextElementSibling;
      files.hidden = !files.hidden;
      a.innerHTML = files.hidden ? I.chevronRightAlt : I.chevronDown;
      place();
      return;
    }
    if (act === 'compare') { state.compare = !state.compare; a.classList.toggle('on', state.compare); return; }
    if (act === 'back') {
      if (open.kind === 'more') renderMore('root', 'from-left'); else renderIntegrations('root', 'from-left');
      return;
    }
    if (act.indexOf('tab:') === 0) {
      var view = act.slice(4);
      if (open.kind === 'more') renderMore(view, 'from-right'); else renderIntegrations(view, 'from-right');
      var input = open.el.querySelector('input');
      if (input) input.focus();
      return;
    }
    if (act.indexOf('toggle:') === 0) {
      var key = act.slice(7);
      state[key] = !state[key];
      a.setAttribute('aria-pressed', state[key]);
      a.querySelector('.tdp-switch').classList.toggle('on', state[key]);
      renderPills();
      return;
    }
    if (act.indexOf('tool:') === 0) {
      var i = Number(act.slice(5));
      state.tools[i] = !state.tools[i];
      a.setAttribute('aria-pressed', state.tools[i]);
      a.querySelector('.tdp-switch').classList.toggle('on', state.tools[i]);
      renderPills();
    }
  }
})();

// The sidebar's moving parts: sections, Pinned and folders fold
// (Sidebar/Section.svelte, common/Folder.svelte, RecursiveFolder.svelte);
// each chat's More menu (Sidebar/ChatMenu.svelte) renames, pins, clones,
// moves, archives and deletes rows in the mock; the user menu
// (Sidebar/UserMenu.svelte); Temporary Chat (Navbar.svelte) and the Chat
// Controls pane (ChatControls.svelte, Controls/Controls.svelte).
(function () {
  var M = window.__tdpMenus;
  var side = document.querySelector('.sidebar-panel .side-scroll');
  if (!M || !side) return;
  var I = ${JSON.stringify({ chevronDownSm: SVG.chevronDownSm, chevronRightSm: SVG.chevronRightSm, chevronUpSm: SVG.chevronUpSm, folder: SVG.folder, close: SVG.close, plusAlt: SVG.plusAlt })};

  function closest(e, sel) { return e.target && e.target.closest ? e.target.closest(sel) : null; }
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  // ---- Folding ----

  function fold(box, head, on) {
    box.classList.toggle('open', on);
    head.setAttribute('aria-expanded', on);
  }

  side.addEventListener('click', function (e) {
    var btn = closest(e, '.chat-menu-btn');
    if (btn) { chatMenu(btn); return; }
    var add = closest(e, '.side-label .add');
    if (add) {
      if (add.classList.contains('sec-more')) {
        M.show('chatsMore', add, null, { onAct: function (act) { if (act === 'read-all') markAllRead(); } });
      }
      return;
    }
    var head = closest(e, '[data-section-toggle]');
    if (head) { fold(head.parentElement, head, !head.parentElement.classList.contains('open')); return; }
    var pin = closest(e, '.side-pinned');
    if (pin) {
      var on = !pin.parentElement.classList.contains('open');
      fold(pin.parentElement, pin, on);
      pin.querySelector('.pin-chev').innerHTML = on ? I.chevronDownSm : I.chevronRightSm;
      return;
    }
    var folder = closest(e, '.folder-row');
    if (folder) fold(folder.parentElement, folder, !folder.parentElement.classList.contains('open'));
  });

  // ---- A chat's More menu ----

  var FOLDERS = function () { return [].map.call(side.querySelectorAll('.side-folder'), function (f) { return f.dataset.folder; }); };
  var pinnedWrap = side.querySelector('.side-pinned-wrap');
  var pinnedList = side.querySelector('.pinned-list');

  function chatMenu(btn) {
    var row = btn.closest('.side-item');
    row.classList.add('menu-open');
    M.show('chat', btn, null, {
      pinned: function () { return !!row.closest('.pinned-list'); },
      subs: {
        download: function () { return M.item('close-only', '', 'Export chat (.json)') + M.item('close-only', '', 'Plain text (.txt)') + M.item('close-only', '', 'PDF document (.pdf)'); },
        move: function () {
          return FOLDERS().map(function (n) {
            return '<button type="button" class="mi" data-act="do:move-to" data-folder="' + esc(n) + '">' + I.folder + '<span class="label">' + esc(n) + '</span></button>';
          }).join('');
        }
      },
      onAct: function (act, el) { chatAct(row, act, el); },
      onClose: function () { row.classList.remove('menu-open'); }
    });
  }

  function todayAnchor() {
    var labels = side.querySelectorAll('.time-label');
    for (var i = 0; i < labels.length; i++) if (labels[i].textContent === 'Today') return labels[i];
    return labels[0];
  }
  function syncPinned() { pinnedWrap.hidden = !pinnedList.children.length; }

  function chatAct(row, act, el) {
    if (act === 'rename') rename(row);
    else if (act === 'unread') {
      if (!row.querySelector('.unread-dot')) row.insertAdjacentHTML('afterbegin', '<span class="unread-dot"></span>');
      row.classList.add('unread');
    } else if (act === 'pin') {
      if (row.closest('.pinned-list')) todayAnchor().after(row);
      else { pinnedList.prepend(row); fold(pinnedWrap, pinnedWrap.querySelector('.side-pinned'), true); pinnedWrap.querySelector('.pin-chev').innerHTML = I.chevronDownSm; }
      syncPinned();
    } else if (act === 'clone') {
      var copy = row.cloneNode(true);
      copy.classList.remove('active', 'unread', 'menu-open');
      ['.age', '.unread-dot'].forEach(function (s) { var x = copy.querySelector(s); if (x) x.remove(); });
      copy.querySelector('.label').textContent = 'Clone of ' + row.querySelector('.label').textContent;
      todayAnchor().after(copy);
    } else if (act === 'move-to') {
      var f = side.querySelector('.side-folder[data-folder="' + el.dataset.folder + '"]');
      if (!f) return;
      f.querySelector('.folder-children').appendChild(row);
      fold(f, f.querySelector('.folder-row'), true);
      var sec = f.closest('.side-section');
      fold(sec, sec.querySelector('[data-section-toggle]'), true);
      syncPinned();
    } else if (act === 'archive' || act === 'delete') {
      if (row.classList.contains('active') && window.__tdpOpenChat) window.__tdpOpenChat('new');
      row.remove();
      syncPinned();
    }
  }

  // ChatItem.svelte: the title becomes an input in place; Enter or leaving
  // it saves, Escape cancels
  function rename(row) {
    var label = row.querySelector('.label');
    var old = label.textContent;
    var input = document.createElement('input');
    input.className = 'rename';
    input.value = old;
    label.hidden = true;
    label.after(input);
    row.classList.add('menu-open');
    input.focus();
    input.select();
    var done = false;
    function finish(save) {
      if (done) return;
      done = true;
      var v = input.value.trim();
      if (save && v) {
        label.textContent = v;
        if (row.classList.contains('active')) document.getElementById('nav-title').textContent = v;
      }
      input.remove();
      label.hidden = false;
      row.classList.remove('menu-open');
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', function () { finish(true); });
  }

  function markAllRead() {
    side.querySelectorAll('.side-item.unread').forEach(function (r) {
      r.classList.remove('unread');
      var d = r.querySelector('.unread-dot');
      if (d) d.remove();
    });
  }

  // ---- The user menu: w-[calc(var(--sidebar-width)-1rem)] from the panel,
  // w-[15rem] from the rail ----

  var ST = window.__tdpState;
  var status = ST.saved.status || null;
  ST.add('status', function () { return status; });
  function userMenu(trigger, width) {
    M.show('user', trigger, null, {
      width: width,
      status: function () { return status; },
      onAct: function (act) {
        if (act === 'status') status = { emoji: '🎨', text: 'Designing a theme' };
        if (act === 'clear-status') status = null;
        ST.save();
      }
    });
  }
  var sideUser = document.getElementById('side-user');
  var railUser = document.getElementById('rail-user');
  if (sideUser) sideUser.addEventListener('click', function () { userMenu(sideUser, sideUser.parentElement.offsetWidth - 16); });
  if (railUser) railUser.addEventListener('click', function (e) { e.stopPropagation(); userMenu(railUser, 240); });

  // ---- Temporary Chat: only the icon changes on the button; the
  // placeholder gains its label and the message bar a dashed border ----

  var tempBtn = document.getElementById('temporary-chat-button');
  function setTemp(on) {
    document.body.classList.toggle('temp-chat', on);
    if (!tempBtn) return;
    tempBtn.classList.toggle('active', on);
    tempBtn.setAttribute('aria-pressed', on);
  }
  window.__tdpTemp = setTemp;
  if (tempBtn) tempBtn.addEventListener('click', function () { setTemp(!document.body.classList.contains('temp-chat')); ST.save(); });
  if (ST.saved.temp) setTemp(true);
  ST.add('temp', function () { return document.body.classList.contains('temp-chat'); });

  // ---- Chat Controls ----

  var pane = document.getElementById('controls-pane');
  var thread = document.getElementById('thread-pane');
  var ctrlBtn = document.getElementById('chat-controls-button');
  window.__tdpPanes = {
    closeAll: function (all) {
      if (thread) thread.hidden = true;
      if (all && pane) pane.hidden = true;
    }
  };

  // AdvancedParams.svelte for an admin, in order: cycling rows step through
  // their values, the rest turn from Default to a slider, a box or a switch
  var PARAMS = [
    ['Stream Chat Response', 'cycle', ['On', 'Off']],
    ['Stream Delta Chunk Size', 'range', [1, 128, 1, 1]],
    ['Context Compaction Threshold', 'text', ['Enter token threshold', '80000']],
    ['Function Calling', 'cycle', ['Native', 'Legacy']],
    ['Reasoning Tags', 'cycle', ['Custom', 'Enabled', 'Disabled']],
    ['Seed', 'text', ['Enter Seed', '0']],
    ['Stop Sequence', 'text', ['Enter stop sequence', '']],
    ['Temperature', 'range', [0, 2, 0.05, 0.8]],
    ['Reasoning Effort', 'text', ['Enter reasoning effort', 'medium']],
    ['logit_bias', 'text', ['Enter comma-separated "token:bias_value" pairs (example: 5432:100, 413:-100)', '']],
    ['max_tokens', 'range', [-2, 131072, 1, 128]],
    ['top_k', 'range', [0, 1000, 1, 40]],
    ['top_p', 'range', [0, 1, 0.05, 0.9]],
    ['min_p', 'range', [0, 1, 0.05, 0]],
    ['frequency_penalty', 'range', [-2, 2, 0.05, 1.1]],
    ['presence_penalty', 'range', [-2, 2, 0.05, 0]],
    ['mirostat', 'range', [0, 2, 1, 0]],
    ['mirostat_eta', 'range', [0, 1, 0.05, 0.1]],
    ['mirostat_tau', 'range', [0, 10, 0.5, 5]],
    ['repeat_last_n', 'range', [-1, 128, 1, 64]],
    ['tfs_z', 'range', [0, 2, 0.05, 1]],
    ['repeat_penalty', 'range', [-2, 2, 0.05, 1.1]],
    ['use_mmap', 'switch', []],
    ['use_mlock', 'switch', []],
    ['think (Ollama)', 'cycle', ['On', 'Custom', 'Off']],
    ['format (Ollama)', 'cycle', ['JSON']],
    ['num_keep (Ollama)', 'range', [-1, 10240000, 1, 24]],
    ['num_ctx (Ollama)', 'range', [-1, 10240000, 1, 2048]],
    ['num_batch (Ollama)', 'range', [256, 8192, 256, 512]],
    ['num_thread (Ollama)', 'range', [1, 256, 1, 2]],
    ['num_gpu (Ollama)', 'range', [0, 256, 1, 0]],
    ['keep_alive (Ollama)', 'text', ["e.g. '30s','10m'. Valid time units are 's', 'm', 'h'.", '5m']]
  ];

  function section(key, title, open, body) {
    return '<div class="cc-sec' + (open ? ' open' : '') + '" data-sec="' + key + '"><button type="button" class="cc-head" aria-expanded="' + open + '"><span>' + title + '</span><span class="down">' + I.chevronDownSm + '</span><span class="up">' + I.chevronUpSm + '</span></button><div class="cc-content">' + body + '</div></div>';
  }

  function buildControls() {
    var rows = PARAMS.map(function (p, i) {
      return '<div class="ap-row" data-p="' + i + '"><div class="ap-line"><div class="ap-label">' + esc(p[0]) + '</div><span class="ap-btn" role="button">Default</span></div><div class="ap-extra"></div></div>';
    }).join('');
    pane.innerHTML =
      '<div class="cc-tabs"><div class="cc-tab">Controls</div><span class="pane-close" role="button" aria-label="Close">' + I.close + '</span></div>' +
      '<div class="cc-body">' +
      section('valves', 'Valves', false, '<div class="cc-valves"><select><option>Tools</option><option>Functions</option></select><select><option disabled selected>Select a tool</option><option>Web Scraper</option><option>Calculator</option><option>Weather</option></select></div>') +
      section('system', 'System Prompt', true, '<textarea rows="3" placeholder="Enter system prompt"></textarea>') +
      section('params', 'Advanced Params', true, '<div class="ap">' + rows + '<div class="ap-add" role="button">' + I.plusAlt + '<span>Add Custom Parameter</span></div></div>') +
      '</div>';
  }

  function paramClick(row) {
    var p = PARAMS[Number(row.dataset.p)];
    var btn = row.querySelector('.ap-btn');
    var extra = row.querySelector('.ap-extra');
    if (p[1] === 'cycle') {
      var steps = ['Default'].concat(p[2]);
      btn.textContent = steps[(steps.indexOf(btn.textContent) + 1) % steps.length];
      return;
    }
    var on = btn.textContent === 'Default';
    btn.textContent = on ? 'Custom' : 'Default';
    if (!on) { extra.innerHTML = ''; return; }
    var a = p[2];
    if (p[1] === 'range') {
      extra.innerHTML = '<div class="ap-custom"><input type="range" min="' + a[0] + '" max="' + a[1] + '" step="' + a[2] + '" value="' + a[3] + '"><input type="number" min="' + a[0] + '" max="' + a[1] + '" step="any" value="' + a[3] + '"></div>';
    } else if (p[1] === 'text') {
      extra.innerHTML = '<div class="ap-custom"><input type="text" value="' + esc(a[1]) + '" placeholder="' + esc(a[0]) + '"></div>';
    } else {
      extra.innerHTML = '<div class="ap-custom ap-switch"><div class="ap-label">Enabled</div><span class="tdp-switch on" role="switch" aria-checked="true"></span></div>';
    }
  }

  // The pane is saved as markup, with what was typed, picked or slid
  // written back into it
  function controlsHtml() {
    var copy = pane.cloneNode(true);
    var live = pane.querySelectorAll('input, textarea, select');
    copy.querySelectorAll('input, textarea, select').forEach(function (el, i) {
      var v = live[i];
      if (el.tagName === 'TEXTAREA') el.textContent = v.value;
      else if (el.tagName === 'SELECT') [].forEach.call(el.options, function (o, j) { if (j === v.selectedIndex) o.setAttribute('selected', ''); else o.removeAttribute('selected'); });
      else el.setAttribute('value', v.value);
    });
    return copy.innerHTML;
  }

  if (pane && ctrlBtn) {
    if (ST.saved.controls && ST.saved.controls.html) pane.innerHTML = ST.saved.controls.html;
    else buildControls();
    if (ST.saved.controls && ST.saved.controls.open) pane.hidden = false;
    ST.add('controls', function () { return { open: !pane.hidden, html: controlsHtml() }; });
    new MutationObserver(ST.save).observe(pane, { subtree: true, childList: true, attributes: true, characterData: true });
    pane.addEventListener('change', ST.save);
    pane.addEventListener('input', function (e) {
      var t = e.target, other = null;
      if (t.type === 'range') other = t.nextElementSibling;
      else if (t.type === 'number') other = t.previousElementSibling;
      if (other) other.value = t.value;
      ST.save();
    });
    ctrlBtn.addEventListener('click', function () {
      pane.hidden = !pane.hidden;
      if (thread) thread.hidden = true;
    });
    pane.addEventListener('click', function (e) {
      if (closest(e, '.pane-close')) { pane.hidden = true; return; }
      var head = closest(e, '.cc-head');
      if (head) { var sec = head.parentElement; var on = !sec.classList.contains('open'); sec.classList.toggle('open', on); head.setAttribute('aria-expanded', on); return; }
      var b = closest(e, '.ap-btn');
      if (b) { paramClick(b.closest('.ap-row')); return; }
      var sw = closest(e, '.ap-switch .tdp-switch');
      if (sw) {
        var on2 = !sw.classList.contains('on');
        sw.classList.toggle('on', on2);
        sw.setAttribute('aria-checked', on2);
        sw.previousElementSibling.textContent = on2 ? 'Enabled' : 'Disabled';
      }
    });
  }
})();

// Channels (channel/Channel.svelte, Navbar.svelte, Messages.svelte,
// Messages/Message.svelte, MessageInput.svelte) and threads (Thread.svelte)
// as a mock that works: messages group by author, the hover toolbar reacts,
// replies, pins, opens a thread, edits and deletes, and you can type into
// the channel and the thread. Times read like dayjs in English: "2:14 PM"
// for today, "14:14" on a grouped row.
(function () {
  var view = document.getElementById('channel-view');
  var threadPane = document.getElementById('thread-pane');
  var M = window.__tdpMenus;
  if (!view || !threadPane || !M) return;
  var I = ${JSON.stringify({ faceSmile: SVG.faceSmile, arrowUpLeftAlt: SVG.arrowUpLeftAlt, pin: SVG.pin, pinSlash: SVG.pinSlash, chatBubbleEllipsis: SVG.chatBubbleEllipsis, pencil: SVG.pencil, garbageBin: SVG.garbageBin, chevronRightBold: SVG.chevronRightBold, xMark: SVG.xMark, plusSolid: SVG.plusSolid, micSolid: SVG.micSolid, arrowUpSolid: SVG.arrowUpSolid, lock: SVG.lock, hashtag: SVG.hashtag, user: SVG.user })};
  var LOGO_SRC = ${JSON.stringify(LOGO)};

  var USERS = {
    maya: { name: 'Maya', bg: 'linear-gradient(135deg, #f59e0b, #ef4444)' },
    jonas: { name: 'Jonas', bg: 'linear-gradient(135deg, #10b981, #3b82f6)' },
    you: { name: 'You', bg: 'linear-gradient(135deg, #6366f1, #ec4899)' },
    model: { name: 'Preview Model', model: true }
  };
  var DAY = 'Sunday, October 11, 2026 ';
  var nextId = 100;
  function m(u, t, hm, text, more) {
    var o = { id: nextId++, u: u, t: t, hm: hm, text: text, reacts: [], thread: [] };
    for (var k in more) o[k] = more[k];
    return o;
  }
  var CHANNELS = {
    general: {
      members: 4, created: 'October 1, 2026',
      msgs: [
        m('maya', '2:14 PM', '14:14', 'Morning! The new <b>Koi Pond</b> theme just landed in the gallery 🎏', { reacts: [{ e: '👍', n: 3, mine: true }, { e: '🎨', n: 2 }] }),
        m('maya', '2:15 PM', '14:15', 'Light mode keeps the pond-water gradient; Dark and OLED run the canvas.'),
        m('jonas', '2:20 PM', '14:20', 'Looks great. Does the canvas follow the theme hue now?', {
          thread: [
            m('maya', '2:22 PM', '14:22', 'It does. Twelve of the gallery animations pick up the accent now.'),
            m('you', '2:24 PM', '14:24', 'And they recolor live while you drag the hue slider.'),
            m('maya', '2:40 PM', '14:40', 'Even OLED gets its own palette ✨')
          ], last: '5 minutes ago'
        }),
        m('you', '2:31 PM', '14:31', '<span class="mention">@Preview Model</span> suggest an accent for a teal palette?'),
        m('model', '2:31 PM', '14:31', 'Try a warm coral around <code>oklch(0.72 0.14 30)</code>: it sits across the wheel from teal and stays readable in every mode.'),
        m('jonas', '2:38 PM', '14:38', 'Pinning the release checklist: palette, OLED pass, light-mode contrast, submit.', { pinned: true })
      ],
      typing: { u: 'maya', t: '2:45 PM', hm: '14:45', text: 'Shipping it after lunch 🚀' }
    },
    design: {
      members: 6, created: 'September 12, 2026',
      msgs: [
        m('jonas', '11:02 AM', '11:02', 'Sidebar transparency or opaque for the new dashboard theme?'),
        m('maya', '11:05 AM', '11:05', 'Translucent. The frosted glass reads well over the gradient.', { reacts: [{ e: '💯', n: 2 }] })
      ]
    },
    'theme-lab': {
      members: 2, private: true, created: 'October 8, 2026',
      msgs: [
        m('you', '9:12 AM', '09:12', 'Private sandbox for experiments before they hit the gallery.'),
        m('maya', '9:20 AM', '09:20', 'Testing a context-aware sunflower that grows with the chat 🌻')
      ]
    }
  };

  var current = null, threadOf = null, replyTo = null, typingTimers = [], typedOnce = {};
  var ST = window.__tdpState, was = ST.saved.channels;
  if (was && was.data) { CHANNELS = was.data; nextId = was.nextId; typedOnce = was.typed || {}; }
  ST.add('channels', function () {
    return { data: CHANNELS, nextId: nextId, typed: typedOnce, current: current, thread: threadOf ? threadOf.id : null, replyTo: replyTo };
  });
  new MutationObserver(ST.save).observe(view, { childList: true, subtree: true });
  new MutationObserver(ST.save).observe(threadPane, { childList: true, subtree: true });

  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function now() {
    var d = new Date(), h = d.getHours(), mm = String(d.getMinutes()).padStart(2, '0');
    return { t: ((h % 12) || 12) + ':' + mm + (h < 12 ? ' AM' : ' PM'), hm: String(h).padStart(2, '0') + ':' + mm };
  }
  function avatar(u) {
    var user = USERS[u];
    if (user.model) return '<div class="av"><img src="' + LOGO_SRC + '" alt=""></div>';
    return '<div class="av" style="background:' + user.bg + '">' + user.name.charAt(0) + '</div>';
  }
  function find(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function msgById(id) {
    var ch = CHANNELS[current];
    var hit = find(ch.msgs, id);
    if (hit) return { msg: hit, list: ch.msgs };
    for (var i = 0; i < ch.msgs.length; i++) {
      var t = find(ch.msgs[i].thread, id);
      if (t) return { msg: t, list: ch.msgs[i].thread, parent: ch.msgs[i] };
    }
    return null;
  }

  // ---- Rendering ----

  function messageHtml(msg, prev, inThread) {
    var head = !prev || prev.u !== msg.u || msg.replyTo;
    var user = USERS[msg.u];
    var tools = '<div class="cm-tools">' +
      '<span data-do="react" data-tip="Add Reaction">' + I.faceSmile + '</span>' +
      '<span data-do="reply" data-tip="Reply" aria-label="Reply">' + I.arrowUpLeftAlt + '</span>' +
      '<span data-do="pin" data-tip="' + (msg.pinned ? 'Unpin' : 'Pin') + '">' + (msg.pinned ? I.pinSlash : I.pin) + '</span>' +
      (inThread ? '' : '<span data-do="thread" data-tip="Reply in Thread" aria-label="Reply in Thread">' + I.chatBubbleEllipsis + '</span>') +
      '<span data-do="edit" data-tip="Edit">' + I.pencil + '</span>' +
      '<span data-do="delete" data-tip="Delete">' + I.garbageBin + '</span></div>';
    var pin = msg.pinned ? '<div class="cm-pin-label">' + I.pin + '<span>Pinned</span></div>' : '';
    var quote = '';
    if (msg.replyTo) {
      var q = msgById(msg.replyTo);
      if (q) quote = '<div class="cm-quote"><div class="q">' + avatar(q.msg.u) + '<span class="who">' + USERS[q.msg.u].name + '</span><span class="what">' + q.msg.text.replace(/<[^>]+>/g, '') + '</span></div></div>';
    }
    var reacts = '';
    if (msg.reacts.length) {
      reacts = '<div class="cm-reacts">' + msg.reacts.map(function (r, i) {
        return '<span class="cm-react' + (r.mine ? ' mine' : '') + '" data-react="' + i + '" data-tip="' + (r.mine ? (r.n > 1 ? 'You and ' + (r.n - 1) + ' others' : 'You') : r.n + ' people') + ' reacted with ' + r.e + '"><span>' + r.e + '</span><span class="n">' + r.n + '</span></span>';
      }).join('') + '<span class="cm-react-add" data-do="react" data-tip="Add Reaction">' + I.faceSmile + '</span></div>';
    }
    var replies = '';
    if (!inThread && msg.thread.length) {
      replies = '<div class="cm-replies"><span class="btn" data-do="thread"><b>' + msg.thread.length + ' Replies</b><span> - Last reply ' + (msg.last || 'a few seconds ago') + '</span>' + I.chevronRightBold + '</span></div>';
    }
    var body = msg.editing
      ? '<div class="cm-edit"><textarea rows="2">' + esc(msg.text.replace(/<[^>]+>/g, '')) + '</textarea><div class="btns"><span class="cancel" data-do="edit-cancel">Cancel</span><span class="save" data-do="edit-save">Save</span></div></div>'
      : '<div class="cm-text">' + msg.text + (msg.edited ? '<span class="edited">(edited)</span>' : '') + '</div>';
    return '<div class="cm' + (head ? ' head' : '') + (msg.pinned ? ' pinned' : '') + (replyTo === msg.id ? ' replying' : '') + '" data-id="' + msg.id + '">' + tools + pin + quote +
      '<div class="cm-row"><div class="cm-av">' + (head ? avatar(msg.u) : '<div class="t2" data-tip="' + DAY + msg.t + '">' + msg.hm + '</div>') + '</div>' +
      '<div class="cm-body">' + (head ? '<div class="cm-meta"><span class="cm-name">' + user.name + '</span><span class="cm-time" data-tip="' + DAY + msg.t + '">' + msg.t + '</span></div>' : '') +
      body + reacts + replies + '</div></div></div>';
  }

  function listHtml(list, inThread) {
    return list.map(function (msg, i) { return messageHtml(msg, list[i - 1], inThread); }).join('');
  }

  function inputHtml(placeholder) {
    return '<div class="ch-input-wrap"><div class="ch-typing"></div><div class="ch-input" id="message-input-container">' +
      '<div class="ch-reply-bar"><span class="who"></span><span class="x" data-do="reply-cancel" role="button" aria-label="Cancel">' + I.xMark + '</span></div>' +
      '<div class="ch-edit" contenteditable="true" data-placeholder="' + placeholder + '"></div>' +
      '<div class="ch-bar"><span class="ch-plus" id="input-menu-button" role="button" aria-label="More">' + I.plusSolid + '</span>' +
      '<div class="ch-right"><span class="ch-mic" id="voice-input-button" role="button" aria-label="Voice Input" data-tip="Record voice">' + I.micSolid + '</span>' +
      '<span class="ch-send" id="send-message-button" role="button" aria-label="Send message" data-tip="Send message">' + I.arrowUpSolid + '</span></div></div></div></div>';
  }

  function renderChannel(scroll) {
    var ch = CHANNELS[current];
    var box = view.querySelector('.ch-scroll');
    var keep = box && !scroll ? box.scrollTop : null;
    box.innerHTML = '<div class="ch-intro"><div class="t">' + current + '</div><div class="d">This channel was created on ' + ch.created + '. This is the very beginning of the ' + current + ' channel.</div></div>' +
      (ch.msgs.length ? '<hr class="ch-intro-rule">' : '') + listHtml(ch.msgs, false);
    box.scrollTop = keep === null ? box.scrollHeight : keep;
  }

  function renderThread(scroll) {
    if (!threadOf) return;
    var box = threadPane.querySelector('.ch-scroll');
    var keep = !scroll ? box.scrollTop : null;
    box.innerHTML = listHtml([threadOf].concat(threadOf.thread), true);
    box.scrollTop = keep === null ? box.scrollHeight : keep;
  }

  function rerender() { renderChannel(false); renderThread(false); }

  // ---- Opening ----

  function open(name) {
    if (!CHANNELS[name]) return;
    close();
    current = name;
    var ch = CHANNELS[name];
    view.hidden = false;
    view.innerHTML = '<div class="ch-nav"><div class="ch-title">' + (ch.private ? I.lock : I.hashtag) + '<span>' + name + '</span></div>' +
      '<div class="ch-nav-btns"><span class="ch-nav-btn" role="button" aria-label="Pinned Messages" data-tip="Pinned Messages">' + I.pin + '</span>' +
      '<span class="ch-nav-btn" role="button" aria-label="User Count" data-tip="Users">' + I.user + '<span class="n">' + ch.members + '</span></span></div></div>' +
      '<div class="ch-scroll"></div>' + inputHtml('Type here...');
    renderChannel(true);
    document.getElementById('nav-title').textContent = name;
    if (ch.typing && !typedOnce[name]) simulateTyping(name);
  }

  function close() {
    typingTimers.forEach(clearTimeout);
    typingTimers = [];
    closeThread();
    replyTo = null;
    current = null;
    view.hidden = true;
    view.innerHTML = '';
  }

  // Someone else in the channel: the typing line, then their message
  function simulateTyping(name) {
    var ch = CHANNELS[name], ty = ch.typing;
    var line = view.querySelector('.ch-typing');
    typingTimers.push(setTimeout(function () {
      if (current !== name) return;
      line.innerHTML = '<span class="dots"><i></i><i></i><i></i></span><span><b>' + USERS[ty.u].name + '</b> is typing...</span>';
      line.classList.add('show');
    }, 1400));
    typingTimers.push(setTimeout(function () {
      if (current !== name) return;
      line.classList.remove('show');
      typedOnce[name] = true;
      ch.msgs.push(m(ty.u, ty.t, ty.hm, ty.text));
      renderChannel(true);
    }, 4200));
  }

  function openThread(msg) {
    threadOf = msg;
    var pane = document.getElementById('controls-pane');
    if (pane) pane.hidden = true;
    threadPane.hidden = false;
    threadPane.innerHTML = '<div class="th-head"><div class="t">Thread</div><span class="pane-close" role="button" aria-label="Close">' + I.xMark + '</span></div>' +
      '<div class="ch-scroll"></div>' + inputHtml('Reply to thread...');
    renderThread(true);
  }
  function closeThread() {
    threadOf = null;
    threadPane.hidden = true;
    threadPane.innerHTML = '';
  }

  // ---- Acting on messages ----

  function setReply(id) {
    replyTo = id;
    var bar = view.querySelector('.ch-input');
    var hit = id && msgById(id);
    bar.classList.toggle('replying', !!hit);
    if (hit) bar.querySelector('.who').textContent = 'Replying to ' + USERS[hit.msg.u].name;
    renderChannel(false);
    if (hit) bar.querySelector('.ch-edit').focus();
  }

  function addReaction(msg, e) {
    for (var i = 0; i < msg.reacts.length; i++) {
      if (msg.reacts[i].e === e) {
        if (!msg.reacts[i].mine) { msg.reacts[i].mine = true; msg.reacts[i].n++; }
        rerender();
        return;
      }
    }
    msg.reacts.push({ e: e, n: 1, mine: true });
    rerender();
  }

  function onClick(e) {
    var host = e.currentTarget;
    var el = e.target.closest('[data-do], [data-react], .pane-close, .ch-plus, .ch-send');
    if (!el) return;
    if (el.classList.contains('pane-close')) { closeThread(); return; }
    if (el.classList.contains('ch-plus')) { M.show('more', el); return; }
    if (el.classList.contains('ch-send')) { send(host); return; }
    var row = el.closest('.cm');
    var hit = row && msgById(Number(row.dataset.id));
    var act = el.dataset.do;
    if (act === 'reply-cancel') { setReply(null); return; }
    if (!hit) return;
    var msg = hit.msg;
    if (el.dataset.react) {
      var r = msg.reacts[Number(el.dataset.react)];
      r.mine = !r.mine;
      r.n += r.mine ? 1 : -1;
      if (!r.n) msg.reacts.splice(Number(el.dataset.react), 1);
      rerender();
      return;
    }
    if (act === 'react') {
      row.classList.add('tools-open');
      M.show('emoji', el, null, {
        onAct: function (a, item) { if (a === 'emoji') addReaction(msg, item.dataset.emoji); },
        onClose: function () { row.classList.remove('tools-open'); }
      });
    } else if (act === 'reply') {
      if (host === threadPane) { threadPane.querySelector('.ch-edit').focus(); return; }
      setReply(msg.id);
    } else if (act === 'pin') { msg.pinned = !msg.pinned; rerender(); }
    else if (act === 'thread') openThread(hit.parent || msg);
    else if (act === 'edit') { msg.editing = true; rerender(); var ta = host.querySelector('.cm[data-id="' + msg.id + '"] textarea'); if (ta) ta.focus(); }
    else if (act === 'edit-cancel') { msg.editing = false; rerender(); }
    else if (act === 'edit-save') {
      var v = row.querySelector('textarea').value.trim();
      msg.editing = false;
      if (v) { msg.text = esc(v); msg.edited = true; }
      rerender();
    } else if (act === 'delete') {
      hit.list.splice(hit.list.indexOf(msg), 1);
      if (threadOf === msg) closeThread();
      if (replyTo === msg.id) setReply(null);
      rerender();
    }
  }

  function send(host) {
    var edit = host.querySelector('.ch-edit');
    var text = edit.innerText.trim();
    if (!text) return;
    var t = now();
    var msg = m('you', t.t, t.hm, esc(text));
    if (host === threadPane) {
      threadOf.thread.push(msg);
      threadOf.last = 'a few seconds ago';
    } else {
      if (replyTo) msg.replyTo = replyTo;
      CHANNELS[current].msgs.push(msg);
      replyTo = null;
      host.querySelector('.ch-input').classList.remove('replying');
    }
    edit.innerHTML = '';
    host.querySelector('.ch-input').classList.remove('has-text');
    renderChannel(host === view);
    renderThread(true);
  }

  function onKey(e) {
    var edit = e.target.closest && e.target.closest('.ch-edit');
    if (!edit) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e.currentTarget); }
    if (e.key === 'Escape' && replyTo) { e.preventDefault(); e.stopPropagation(); setReply(null); }
  }
  function onInput(e) {
    var edit = e.target.closest && e.target.closest('.ch-edit');
    if (!edit) return;
    if (!edit.innerText.trim()) edit.innerHTML = '';
    edit.closest('.ch-input').classList.toggle('has-text', !!edit.innerText.trim());
  }

  [view, threadPane].forEach(function (host) {
    host.addEventListener('click', onClick);
    host.addEventListener('keydown', onKey);
    host.addEventListener('input', onInput);
  });

  window.__tdpChannel = { open: open, close: close };

  // After the first chat opens (openChat defers it the same way), bring back
  // the open thread and the reply in progress
  if (was && was.current) setTimeout(function () {
    if (current !== was.current) return;
    if (was.thread) { var t = msgById(was.thread); if (t) openThread(t.parent || t.msg); }
    if (was.replyTo && msgById(was.replyTo)) setReply(was.replyTo);
  }, 0);
})();

// The floating preview toolbar lives in the parent and can change height when
// it wraps, so ask for its real height instead of assuming one. Only the first
// message clears it — the navbar intentionally stays under the bar.
(function () {
  var root = document.documentElement;
  var inset = null;

  // Measure where the first row lands with no offset, then add exactly enough
  // to reach the inset. Derived rather than hardcoded so it survives changes
  // to the navbar's height and the container's padding.
  function apply() {
    if (inset === null) return;
    var row = document.querySelector('#messages-container > .message-listitem');
    if (!row) return; // the New Chat placeholder needs no offset
    root.style.setProperty('--tdp-first-row-offset', '0px');
    var natural = row.getBoundingClientRect().top;
    var needed = Math.max(0, Math.round(inset - natural));
    root.style.setProperty('--tdp-first-row-offset', needed + 'px');
  }

  window.__tdpApplyInset = apply;

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.__tdpPreview !== true) return;
    if (d.kind === 'topinset') {
      var px = Number(d.px);
      if (!isFinite(px) || px < 0) return;
      inset = px;
      apply();
    } else if (d.kind === 'textscale') {
      // Interface.svelte's UI Scale slider — setTextScale(scale) upstream
      var sc = Number(d.scale);
      if (!isFinite(sc) || sc < 1 || sc > 1.5) return;
      root.style.setProperty('--app-text-scale', String(sc));
      apply(); // content height changed, so the first-row offset must too
    } else if (d.kind === 'vars' && d.vars && typeof d.vars === 'object') {
      // The home page's hue slider recolors the mock without rebuilding it
      Object.keys(d.vars).forEach(function (k) {
        var v = d.vars[k];
        if (/^--color-gray-\\d+$/.test(k) && typeof v === 'string' && !/[;{}<]/.test(v)) root.style.setProperty(k, v);
        else if (/^--tdp-(hue|chroma)$/.test(k) && isFinite(Number(v))) root.style.setProperty(k, String(Number(v)));
      });
      window.dispatchEvent(new Event('tdp-palette'));
    }
  });

  window.addEventListener('resize', apply);
  try { parent.postMessage({ __tdpPreview: true, kind: 'ready' }, '*'); } catch (e) {}
})();
</script>
</body>
</html>`;
  }

  function mountMockFrame(stage, srcdoc) {
    const frame = document.createElement('iframe');
    frame.className = 'preview-frame';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('title', 'Theme preview');
    frame.setAttribute('allowtransparency', 'true');
    frame.srcdoc = srcdoc;
    stage.appendChild(frame);
    return frame;
  }

  // ---- Shared with the home page and the gallery cards ----

  window.TDPEngine = {
    themeVars,
    gradientLayers,
    applyGradientToEl,
    buildMockSrcdoc,
    mountMockFrame,
    modeVars(mode, modeKey) {
      const vars = themeVars(mode);
      if (modeKey === 'oled') {
        vars['--color-gray-800'] = '#101010';
        vars['--color-gray-850'] = '#050505';
        vars['--color-gray-900'] = '#000000';
        vars['--color-gray-950'] = '#000000';
      }
      return vars;
    },
  };

  // The home page has no full-screen preview
  if (!document.getElementById('preview-overlay')) return;

  // ---- Overlay shell ----

  const overlay = document.getElementById('preview-overlay');
  const stage = document.getElementById('preview-stage');
  const titleEl = document.getElementById('preview-title');
  const controlsEl = document.getElementById('preview-controls');
  const statusEl = document.getElementById('preview-status');
  const closeBtn = document.getElementById('preview-close-btn');

  let active = null; // { destroy() }
  let currentMockChat = 'default'; // survives mode-pill rebuilds within one preview
  let currentSidebarCollapsed = false; // ditto, so switching modes keeps the rail state
  let currentMockState = null; // ditto, for what was changed inside the mock
  let currentTextScale = 1; // UI Scale slider value, reapplied to rebuilt frames

  function setStatus(msg) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('visible', !!msg);
  }

  function closePreview() {
    if (active && active.destroy) active.destroy();
    active = null;
    stage.innerHTML = '';
    stage.style.background = '';
    controlsEl.innerHTML = '';
    setStatus('');
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function openOverlay(title) {
    currentMockChat = 'default';
    currentSidebarCollapsed = false;
    currentMockState = null;
    currentTextScale = 1;
    titleEl.textContent = title;
    stage.innerHTML = '';
    controlsEl.innerHTML = '';
    setStatus('');
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
  }

  // The topbar floats over the stage and wraps on narrow screens, so the mock
  // is told its real height rather than hardcoding one on both sides.
  function topInsetPx() {
    const bar = overlay.querySelector('.preview-topbar');
    if (!bar) return 76;
    const r = bar.getBoundingClientRect();
    const stageTop = stage.getBoundingClientRect().top;
    return Math.max(0, Math.round(r.bottom - stageTop) + 8);
  }

  function sendTopInset(win) {
    const msg = { __tdpPreview: true, kind: 'topinset', px: topInsetPx() };
    const targets = win ? [win] : Array.from(stage.querySelectorAll('iframe')).map((f) => f.contentWindow);
    targets.forEach((w) => { try { if (w) w.postMessage(msg, '*'); } catch (e) {} });
  }

  function sendTextScale(win) {
    const msg = { __tdpPreview: true, kind: 'textscale', scale: currentTextScale };
    const targets = win ? [win] : Array.from(stage.querySelectorAll('iframe')).map((f) => f.contentWindow);
    targets.forEach((w) => { try { if (w) w.postMessage(msg, '*'); } catch (e) {} });
  }

  window.addEventListener('resize', () => {
    if (overlay.classList.contains('open')) sendTopInset();
  });

  closeBtn.addEventListener('click', closePreview);
  window.addEventListener('message', (e) => {
    if (!e.data || e.data.__tdpPreview !== true || !overlay.classList.contains('open')) return;
    if (e.data.kind === 'escape') closePreview();
    if (e.data.kind === 'chatchange' && typeof e.data.chat === 'string') currentMockChat = e.data.chat;
    if (e.data.kind === 'sidebarchange') currentSidebarCollapsed = !!e.data.collapsed;
    if (e.data.kind === 'mockstate' && e.data.state) currentMockState = e.data.state;
    if (e.data.kind === 'status' && typeof e.data.text === 'string') setStatus(e.data.text);
    // a frame just mounted (including after a mode-pill rebuild) — answer it
    if (e.data.kind === 'ready') requestAnimationFrame(() => { sendTopInset(e.source); if (currentTextScale !== 1) sendTextScale(e.source); });
  });
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('open')) {
        e.stopImmediatePropagation();
        closePreview();
      }
    },
    true
  );

  async function fetchRaw(url, asJSON) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return asJSON ? res.json() : res.text();
  }

  // Every preview type renders on the same mock chat, so the caveat applies to
  // all four — not just CSS presets. Appended last so it trails any pills or
  // interaction hints the caller already added.
  function addMockNote() {
    // Open WebUI's UI Scale slider (Interface.svelte: range 1-1.5, step
    // 0.01, shown as "Nx") riding along in the preview pill. Every mock
    // preview gets it, so it mounts with the shared note.
    const wrap = document.createElement('label');
    wrap.className = 'preview-scale';
    wrap.innerHTML = '<span>UI Scale</span>';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '1';
    slider.max = '1.5';
    slider.step = '0.01';
    slider.value = String(currentTextScale);
    const out = document.createElement('output');
    const fmt = (v) => (Number(v) === 1 ? '1x' : Number(v).toFixed(2).replace(/0$/, '') + 'x');
    out.textContent = fmt(slider.value);
    slider.addEventListener('input', () => {
      currentTextScale = Number(slider.value);
      out.textContent = fmt(slider.value);
      sendTextScale();
    });
    wrap.appendChild(slider);
    wrap.appendChild(out);
    controlsEl.appendChild(wrap);

    const note = document.createElement('span');
    note.className = 'preview-hint';
    note.textContent = 'Approximate: rendered on a mock chat layout';
    controlsEl.appendChild(note);
    return note;
  }

  function pillGroup(labels, activeLabel, onPick) {
    const wrap = document.createElement('div');
    wrap.className = 'preview-pills';
    labels.forEach((label) => {
      const b = document.createElement('button');
      b.className = 'preview-pill' + (label === activeLabel ? ' active' : '');
      b.textContent = label === 'oled' ? 'OLED' : label.charAt(0).toUpperCase() + label.slice(1);
      b.addEventListener('click', () => {
        wrap.querySelectorAll('.preview-pill').forEach((p) => p.classList.remove('active'));
        b.classList.add('active');
        onPick(label);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  // Non-theme previews have no palette of their own; OLED overlays the exact
  // values Open WebUI applies for oled-dark (Settings/General.svelte L182-186)
  // on the designer's default ramp.
  function defaultModeVars(modeKey) {
    const vars = themeVars(null);
    if (modeKey === 'oled') {
      vars['--color-gray-800'] = '#101010';
      vars['--color-gray-850'] = '#050505';
      vars['--color-gray-900'] = '#000000';
      vars['--color-gray-950'] = '#000000';
    }
    return vars;
  }

  // Shared: mount the mock UI over an effect layer, with mode pills
  function mockOverEffect(defaultMode) {
    let frame = null;
    const renderMode = (modeKey) => {
      if (frame) frame.remove();
      // The mock body is transparent here, so the stage is the effect's
      // backdrop — it must match the app's body: true black for OLED, white
      // for light (scripts that don't paint a background rely on it, and the
      // light sidebar's gray-50 wash only reads correctly over white).
      stage.style.background = modeKey === 'oled' ? '#000000' : modeKey === 'light' ? '#ffffff' : '';
      frame = mountMockFrame(
        stage,
        buildMockSrcdoc({ modeKey, vars: defaultModeVars(modeKey), customCSS: '', transparent: true, initialChat: currentMockChat, initialCollapsed: currentSidebarCollapsed, initialState: currentMockState })
      );
    };
    controlsEl.appendChild(pillGroup(['dark', 'oled', 'light'], defaultMode, renderMode));
    renderMode(defaultMode);
    return { remove: () => { if (frame) frame.remove(); } };
  }

  // ---- Per-type preview flows ----

  async function previewGradient(item) {
    openOverlay(item.name || 'Gradient');
    setStatus('Loading gradient…');
    try {
      const g = await fetchRaw(item.importUrl, true);
      const layers = gradientLayers(g);
      if (!layers) throw new Error('gradient has no renderable stops');
      const bgEl = document.createElement('div');
      bgEl.className = 'preview-gradient-bg';
      applyGradientToEl(bgEl, layers);
      stage.appendChild(bgEl);
      const mock = mockOverEffect('dark');
      active = { destroy: () => mock.remove() };
      addMockNote();
      setStatus('');
    } catch (err) {
      setStatus('Could not load this gradient: ' + err.message);
    }
  }

  async function previewCanvasFx(item) {
    openOverlay(item.name || 'Canvas FX');
    setStatus('Loading script…');
    try {
      const src = await fetchRaw(item.importUrl, false);
      setStatus('');
      const engine = startCanvasEngine(src, stage, setStatus);
      if (!engine) return;
      const mock = mockOverEffect('dark');
      active = { destroy() { engine.destroy(); mock.remove(); } };

      const hint = document.createElement('span');
      hint.className = 'preview-hint';
      hint.textContent = 'Move, click, or touch to interact';
      controlsEl.appendChild(hint);

      if (/(case|===)\s*['"]context['"]/.test(src)) {
        const wrap = document.createElement('label');
        wrap.className = 'preview-context';
        wrap.innerHTML = '<span>Simulate context</span>';
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '100';
        slider.value = '0';
        slider.addEventListener('input', () => {
          const pct = Number(slider.value) / 100;
          engine.sendContext({
            messages: Math.round(pct * 40),
            chars: Math.round(pct * 512000),
            estimatedTokens: Math.round(pct * 128000),
          });
        });
        wrap.appendChild(slider);
        controlsEl.appendChild(wrap);
      }

      addMockNote();
    } catch (err) {
      setStatus('Could not load this script: ' + err.message);
    }
  }

  async function previewCss(item) {
    openOverlay(item.name || titleCaseFile(item.file) || 'CSS Preset');
    setStatus('Loading CSS…');
    try {
      const css = await fetchRaw(item.importUrl, false);
      setStatus('');
      let frame = null;
      const renderMode = (modeKey) => {
        if (frame) frame.remove();
        frame = mountMockFrame(
          stage,
          buildMockSrcdoc({ modeKey, vars: defaultModeVars(modeKey), customCSS: css, transparent: false, initialChat: currentMockChat, initialCollapsed: currentSidebarCollapsed, initialState: currentMockState })
        );
      };
      controlsEl.appendChild(pillGroup(['dark', 'oled', 'light'], 'dark', renderMode));
      renderMode('dark');
      addMockNote();
      active = { destroy() { if (frame) frame.remove(); } };
    } catch (err) {
      setStatus('Could not load this preset: ' + err.message);
    }
  }

  async function previewTheme(item) {
    openOverlay(item.name || 'Theme');
    setStatus('Loading theme…');
    try {
      const theme = await fetchRaw(item.importUrl, true);
      setStatus('');
      const present = ['dark', 'oled', 'light', 'her'].filter((m) => theme[m] && typeof theme[m] === 'object');
      if (present.length === 0) throw new Error('no mode data found');

      let frame = null;

      const renderMode = (modeKey) => {
        if (frame) { frame.remove(); frame = null; }
        setStatus('');

        const mode = theme[modeKey];
        const hasCanvas = mode.canvasEnabled && mode.canvasScript && mode.canvasScript.trim();
        const gLayers = mode.gradientEnabled ? gradientLayers(mode) : null;

        frame = mountMockFrame(
          stage,
          buildMockSrcdoc({
            modeKey,
            vars: themeVars(mode),
            customCSS: mode.customCssEnabled !== false ? mode.customCSS || '' : '',
            canvasScript: hasCanvas ? mode.canvasScript : null,
            gradient: gLayers,
            initialChat: currentMockChat,
            initialCollapsed: currentSidebarCollapsed,
            initialState: currentMockState,
          })
        );
      };

      if (present.length > 1) {
        controlsEl.appendChild(pillGroup(present, present[0], renderMode));
      }
      renderMode(present[0]);
      addMockNote();

      active = {
        destroy() {
          if (frame) frame.remove();
        },
      };
    } catch (err) {
      setStatus('Could not load this theme: ' + err.message);
    }
  }

  function titleCaseFile(file) {
    return String(file || '')
      .replace(/\.(json|css|js)$/i, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }

  // ---- Public entry ----

  window.openPreview = function (item, category) {
    switch (category) {
      case 'gradients': return previewGradient(item);
      case 'canvasFx': return previewCanvasFx(item);
      case 'cssPresets': return previewCss(item);
      case 'themes': return previewTheme(item);
    }
  };
})();
