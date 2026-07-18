/* ========================================
   Theme Designer Pro — Preset Gallery
   Live preview engine: gradients, Canvas FX,
   themes, and CSS presets
   ======================================== */

(function () {
  'use strict';

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
    // icons/Sidebar.svelte — sidebar collapse toggle
    panel: icon(['M19 21L5 21C3.89543 21 3 20.1046 3 19L3 5C3 3.89543 3.89543 3 5 3L19 3C20.1046 3 21 3.89543 21 5L21 19C21 20.1046 20.1046 21 19 21Z', 'M9.5 21V3', 'M5.5 10L7.25 12L5.5 14']),
    // icons/PencilSquare.svelte — navbar "New Chat"
    pencilSquare: icon(['m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10']),
    // icons/EllipsisHorizontal.svelte
    dots: icon(['M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM18.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z']),
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
    regenerate: icon(['M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99'], { strokeWidth: '2.3' }),
  };

  const CHAT_MENU = '<span class="chat-actions"><span class="chat-menu-btn">' + SVG.moreHorizontal + '</span></span>';

  // UserMessage.svelte's Edit + Copy pair (same two glyphs the assistant row uses)
  const USER_ACTIONS =
    '<div class="user-actions">' +
    ['edit', 'copy'].map(function (k) { return '<span class="msg-action">' + ACTION_SVG[k] + '</span>'; }).join('') +
    '</div>';

  // FollowUps.svelte — hairline-separated rows under a "Follow up" heading
  function followUps(items) {
    if (!items || !items.length) return '';
    return '<div class="followups-wrap"><div class="followups">' +
      '<div class="followups-title">Follow up</div><div class="followups-list">' +
      items.map(function (q, i) {
        return '<div class="followup">' + q + '</div>' + (i < items.length - 1 ? '<hr>' : '');
      }).join('') +
      '</div></div></div>';
  }

  // The row Open WebUI renders under a finished assistant reply, in source order.
  const MSG_ACTIONS =
    '<div class="msg-actions">' +
    ['edit', 'copy', 'speak', 'thumbUp', 'thumbDown', 'continueResponse', 'regenerate']
      .map(function (k) { return '<span class="msg-action">' + ACTION_SVG[k] + '</span>'; })
      .join('') +
    '</div>';

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
    const varLines = Object.entries(opts.vars).map(([k, v]) => `  ${k}: ${v};`).join('\n');

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
    const proseText = isLight ? 'var(--color-gray-700)' : 'var(--color-gray-100)';
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
  .chat-user .bubble { background: color-mix(in srgb, ${bubble} 72%, transparent); }`
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
<head><meta charset="utf-8">
<style>
:root {
${varLines}
}
* { box-sizing: border-box; margin: 0; }
html, body { height: 100%; }
body { background: ${bg}; font-family: -apple-system, BlinkMacSystemFont, 'Inter', ui-sans-serif, 'Segoe UI', Roboto, sans-serif; color: ${proseText}; overflow: hidden; font-size: 0.9375rem; -webkit-font-smoothing: antialiased; }
svg { width: 16px; height: 16px; flex-shrink: 0; }
.app { display: flex; height: 100vh; position: relative; }

/* Sidebar.svelte: w-[var(--sidebar-width)]=245px, border-e, px-1 rows,
   rounded-xl px-2 py-1.5 nav items, size-4 icons, text-[13px] leading-5.
   Collapsing swaps it for the w-[42px] rail (Sidebar.svelte L806-974); the
   panel itself uses transition:slide{duration:250,axis:'x'}. */
#sidebar { width: 245px; flex-shrink: 0; background: ${sidebarBg}; border-right: 1px solid ${borderSubtle}; padding: 6px 4px 4px; display: flex; flex-direction: column; overflow: hidden; transition: width 250ms ease, opacity 150ms ease; }
/* min-width:0 is required — flex items default to min-width:auto, which would
   floor the panel at its nowrap content width and defeat width:0 */
.app.collapsed #sidebar { width: 0; min-width: 0; padding-left: 0; padding-right: 0; border-right-width: 0; opacity: 0; pointer-events: none; }

/* The collapsed rail: w-[42px] py-1 px-1, justify-between, border-e-[0.5px] */
#rail { display: none; width: 42px; flex-shrink: 0; padding: 4px; flex-direction: column; justify-content: space-between; align-items: center; background: ${sidebarBg}; border-right: 0.5px solid ${borderSubtle}; color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-300)'}; overflow: hidden; cursor: pointer; transition: background 0.15s; }
.app.collapsed #rail { display: flex; }
#rail:hover { background: ${isLight ? 'color-mix(in srgb, var(--color-gray-50) 30%, ' + sidebarBg + ')' : 'color-mix(in srgb, var(--color-gray-800) 30%, ' + sidebarBg + ')'}; }
.rail-group { display: flex; flex-direction: column; align-items: center; }
/* size-8.5 / size-8 hit areas wrapping a size-[30px] rounded-lg hover target */
.rail-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.rail-btn.lg { width: 34px; height: 34px; }
.rail-btn > span { width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; transition: background 0.15s; }
.rail-btn:hover > span { background: ${navHover}; }
.rail-btn svg { width: 16px; height: 16px; }
/* the logo swaps to the sidebar-toggle glyph on hover (group-hover:hidden) */
.rail-logo i { width: 20px; height: 20px; border-radius: 50%; background: #fff !important; color: #000 !important; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 800; font-style: normal; letter-spacing: -0.02em; border: 1px solid rgb(0 0 0 / 0.1); }
.rail-logo svg { display: none; }
.rail-logo:hover i { display: none; }
.rail-logo:hover svg { display: block; }
.rail-avatar { width: 22px; height: 22px; border-radius: 50%; background: linear-gradient(135deg, #6366f1, #ec4899); }
.brand { display: flex; align-items: center; gap: 2px; padding: 0 0 6px; color: ${textMain}; }
.brand-dot { width: 34px; height: 34px; border-radius: 12px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.brand-dot i { width: 20px; height: 20px; border-radius: 50%; background: #fff !important; color: #000 !important; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 800; font-style: normal; letter-spacing: -0.02em; border: 1px solid rgb(0 0 0 / 0.1); }
.brand .brand-name { flex: 1; padding: 0 2px; font-size: 14px; font-weight: 400; color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-200)'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.brand .panel-icon { width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: ${textMuted}; }
.brand .panel-icon svg { width: 16px; height: 16px; }
.brand-dot:hover, .brand .panel-icon:hover { background: ${navHover}; }
.side-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; margin: 0 4px; border-radius: 12px; color: ${textSoft}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; line-height: 20px; }
.side-item svg { width: 16px; height: 16px; color: ${textSoft}; }
.side-item { cursor: pointer; transition: background 0.15s; }
.side-item:hover { background: ${navHover}; }
.side-scroll .side-item { padding: 6px 8px; }
.side-scroll .side-item:hover { background: ${itemHover}; }
.side-item.active, .side-scroll .side-item.active:hover { background: ${activeItem}; color: ${isLight ? 'var(--color-gray-800)' : 'var(--color-gray-200)'}; }
.side-item .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.side-item .age { flex-shrink: 0; padding-left: 8px; font-size: 10px; color: ${ageText}; }
/* ChatItem.svelte: the menu sits absolute right-1 inset-y-0 mr-1.5 and is
   invisible until hover (or always, on the selected chat, which also swaps
   the time-ago indicator out and pads the title with pr-12) */
.side-scroll .side-item[data-chat] { position: relative; }
.chat-actions { position: absolute; top: 0; bottom: 0; right: 4px; margin-right: 6px; display: flex; align-items: center; visibility: hidden; }
.side-item:hover .chat-actions, .side-item.active .chat-actions { visibility: visible; }
.side-item:hover .age, .side-item.active .age { display: none; }
.side-item:hover .label, .side-item.active .label { padding-right: 20px; }
.chat-menu-btn { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: color 0.15s; }
.chat-menu-btn svg { width: 14px; height: 14px; }
.chat-menu-btn:hover { color: ${isLight ? '#000' : '#fff'}; }
.side-item .add { margin-left: auto; color: ${textFaint}; }
.side-item .add svg { width: 12px; height: 12px; }
/* Section.svelte: text-xs gray-400/gray-500 header with a size-3.5 Plus */
.side-label { font-size: 12px; color: ${isLight ? 'var(--color-gray-400)' : 'var(--color-gray-500)'}; padding: 12px 4px 4px 10px; display: flex; align-items: center; }
.side-label .add { margin-left: auto; color: inherit; }
.side-label .add svg { width: 14px; height: 14px; }
.side-label .add:hover { color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; }
.side-pinned { display: flex; align-items: center; gap: 6px; margin: 0 4px; padding: 6px 8px; border-radius: 12px; color: ${textSoft}; font-size: 13px; line-height: 20px; }
.side-pinned svg { width: 11px; height: 11px; }
.side-pinned:hover { background: ${itemHover}; }
.side-divider { height: 1px; margin: 6px 4px; background: ${borderSubtle}; }
.side-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; scrollbar-width: none; padding-top: 2px; }
.side-scroll::-webkit-scrollbar { display: none; }
.side-user { display: flex; align-items: center; gap: 8px; margin: 0 4px; padding: 6px 8px; border-radius: 12px; color: ${textMain}; font-weight: 400; font-size: 13px; line-height: 20px; cursor: pointer; transition: background 0.15s; }
.side-user:hover { background: ${navHover}; }
.side-label .add, .side-pinned, .brand .panel-icon, .brand-dot { cursor: pointer; transition: background 0.15s, color 0.15s; }
.avatar { width: 22px; height: 22px; border-radius: 50%; background: linear-gradient(135deg, #6366f1, #ec4899); flex-shrink: 0; }
.avatar.sm { width: 20px; height: 20px; border-radius: 50%; }

main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
/* Navbar.svelte: pt-0.5 pb-1, pl-1.5 pr-1, title text-[15px] gray-700/300,
   size-6 rounded-lg icon buttons, and the -bottom-10 gradient scrim */
nav { padding: 2px 4px 4px 6px; display: flex; align-items: center; gap: 8px; color: ${textMain}; position: relative; z-index: 2; flex-shrink: 0; }
${opts.transparent ? '' : `nav::before { content: ''; position: absolute; inset: 0 0 -40px 0; background: linear-gradient(to bottom, color-mix(in srgb, ${bg} 90%, transparent), color-mix(in srgb, ${bg} 50%, transparent) 40%, transparent 97%); z-index: -1; pointer-events: none; }`}
#nav-title { padding: 4px 4px 4px 6px; font-size: 15px; font-weight: 400; color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-300)'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
nav .nav-btn { width: 24px; height: 24px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: ${textMuted}; cursor: pointer; transition: background 0.15s, color 0.15s; }
nav .nav-btn svg { width: 16px; height: 16px; }
nav .nav-btn:hover { background: ${navHover}; color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-200)'}; }
nav .right { margin-left: auto; display: flex; align-items: center; gap: 8px; padding-right: 4px; }

/* Messages.svelte: rows are max-w-[58rem] px-5 mb-3 inside a full-width scroller */
#messages-container { flex: 1; overflow: hidden; padding: 8px 0 6px; display: flex; flex-direction: column; width: 100%; }
#messages-container > .chat-user,
#messages-container > .chat-assistant { max-width: 58rem; width: 100%; margin: 0 auto 12px; padding: 0 20px; }
.chat-user { display: flex; flex-direction: column; align-items: flex-end; }
.chat-user .bubble { max-width: 90%; background: ${bubble}; border-radius: 24px; padding: 6px 16px; font-size: 0.9375rem; line-height: 1.625; color: ${proseText}; }
/* UserMessage.svelte: Edit + Copy in a justify-end row, invisible until the
   message is hovered (invisible group-hover:visible) */
.user-actions { display: flex; justify-content: flex-end; color: ${isLight ? 'var(--color-gray-600)' : 'var(--color-gray-500)'}; visibility: hidden; }
.chat-user:hover .user-actions { visibility: visible; }
.chat-assistant { display: flex; }
.ai-avatar { width: 28px; height: 28px; border-radius: 16px; background: #fff !important; color: #000 !important; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 800; flex-shrink: 0; margin: 2px 8px 0 0; border: 1px solid rgb(0 0 0 / 0.1); }
.ai-col { flex: 1; min-width: 0; padding-left: 4px; }
.ai-model { font-size: 0.9375rem; font-weight: 400; color: ${isLight ? '#000' : '#fff'}; margin-bottom: 1px; line-height: 1.4; }
.ai-stats { font-size: 10.5px; color: ${textFaint}; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.prose { font-size: 0.9375rem; line-height: 1.625; color: ${proseText}; }
.prose p { margin-bottom: 8px; }
.prose p:last-child { margin-bottom: 0; }
.prose b { color: ${isLight ? '#000' : '#fff'}; font-weight: 500; }
.prose code { background: ${codeBg}; padding: 2px 6px; border-radius: 6px; font-family: ui-monospace, 'JetBrains Mono', monospace; font-size: 0.8em; color: ${textMain}; }
/* CodeBlock.svelte: rounded-2xl border my-0.5, header py-1.5 px-3.5 text-xs */
.code-block { border-radius: 16px; border: 1px solid ${borderSubtle}; background: ${codeBlockBg}; margin: 12px 0; overflow: hidden; }
.code-block-header { display: flex; align-items: center; justify-content: space-between; padding: 6px 14px; font-size: 12px; color: ${isLight ? '#000' : '#fff'}; }
.code-block-header .cb-action { cursor: pointer; padding: 2px 6px; border-radius: 6px; font-size: 12px; }
.code-block-header .cb-action:hover { opacity: 0.7; }
.prose pre { background: ${codeBlockBg}; padding: 4px 20px 16px; font-family: ui-monospace, 'JetBrains Mono', monospace; font-size: 14px; line-height: 1.5; overflow: hidden; margin: 0; color: ${proseText}; }
.prose ul, .prose ol { margin: 8px 0 8px 22px; }
.prose li { margin: 2px 0; }
.prose blockquote { border-left: 2px solid ${border}; padding: 2px 0 2px 12px; color: ${textMuted}; margin: 12px 0; }
.prose a { color: ${textMain}; text-decoration: underline; cursor: pointer; }
.prose table { border-collapse: collapse; margin: 6px 0 10px; font-size: 12.5px; }
.prose th, .prose td { border: 1px solid ${border}; padding: 5px 10px; text-align: left; }
.prose th { background: ${codeBg}; color: ${textMain}; font-weight: 600; }
.prose h4 { font-size: 0.9375rem; font-weight: 600; color: ${textMain}; margin: 8px 0 4px; }
/* Placeholder.svelte: max-w-[58rem] translate-y-6 centered block, size-10
   rounded-2xl model image, text-2xl name; Suggestions.svelte rows are
   borderless px-2.5 py-1.5 rounded-lg with text-sm / text-xs lines */
.placeholder { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; max-width: 58rem; width: 100%; margin: 0 auto; padding: 0 8px 24px; transform: translateY(-12px); }
.ph-logo { width: 40px; height: 40px; border-radius: 16px; background: #fff !important; color: #000 !important; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 13px; margin-bottom: 2px; border: 1px solid rgb(0 0 0 / 0.1); }
.ph-model { font-size: 1.5rem; line-height: 2rem; font-weight: 400; color: ${isLight ? 'var(--color-gray-800)' : 'var(--color-gray-100)'}; max-width: 36rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ph-sub { font-size: 1.5rem; line-height: 2rem; font-weight: 400; color: ${isLight ? 'var(--color-gray-600)' : 'var(--color-gray-400)'}; margin: 0 0 22px; }
.ph-suggest { width: min(42rem, 100%); padding: 0 20px; }
.ph-label { font-size: 12px; line-height: 1.4; color: ${isLight ? 'var(--color-gray-600)' : 'var(--color-gray-400)'}; margin-bottom: 4px; display: flex; align-items: center; gap: 4px; }
.ph-label svg { width: 14px; height: 14px; }
.ph-grid { display: grid; grid-template-columns: 1fr 1fr; align-items: start; }
.ph-card { border-radius: 8px; padding: 6px 10px; cursor: pointer; background: transparent; transition: color 0.15s; text-align: left; }
.ph-card b { display: block; font-size: 14px; line-height: 1.375; font-weight: 400; color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-300)'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ph-card span { display: block; font-size: 12px; line-height: 1.375; font-weight: 400; color: ${isLight ? 'var(--color-gray-600)' : 'var(--color-gray-400)'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ph-card:hover b { color: ${isLight ? 'var(--color-gray-950)' : '#fff'}; }
.ph-card:hover span { color: ${isLight ? 'var(--color-gray-900)' : 'var(--color-gray-100)'}; }
/* ResponseMessage.svelte action row: text-gray-600 dark:text-gray-500 mt-0.5,
   buttons p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 */
.msg-actions { display: flex; align-items: center; justify-content: flex-start; margin-top: 2px; color: ${isLight ? 'var(--color-gray-600)' : 'var(--color-gray-500)'}; }
.msg-action { padding: 6px; border-radius: 8px; display: flex; cursor: pointer; transition: background 0.15s, color 0.15s; }
.msg-action:hover { background: ${ghostHover}; color: ${isLight ? '#000' : '#fff'}; }
.msg-actions svg { width: 16px; height: 16px; }

/* ResponseMessage/FollowUps.svelte, rendered in a my-2.5 wrapper after the
   action row and only on the last message: an mt-4 block with a text-sm
   heading and text-sm rows separated by hairlines */
.followups-wrap { margin: 10px 0; }
.followups { margin-top: 16px; }
.followups-title { font-size: 0.875rem; font-weight: 400; color: ${proseText}; }
.followups-list { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.followup { padding: 4px 0; font-size: 0.875rem; text-align: left; color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; cursor: pointer; transition: color 0.15s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.followup:hover { color: ${isLight ? '#000' : '#fff'}; }
.followups-list hr { border: none; border-top: 1px solid ${borderSubtle}; margin: 0; }

/* MessageInput.svelte: max-w-[58rem] px-2.5 mx-auto shell, shadow-lg
   rounded-3xl border-gray-100/30 dark:border-gray-850/30 bg-white/5
   dark:bg-gray-500/5 backdrop-blur-sm */
.input-wrap { padding: 0 10px; max-width: 58rem; width: 100%; margin: 0 auto; }
#chat-input-container { background: ${inputBg}; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); border: 1px solid ${borderSubtle}; border-radius: 24px; box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1); padding: 10px 10px 8px 18px; display: flex; flex-direction: column; gap: 8px; transition: border-color 0.15s; }
#chat-input-container:hover { border-color: ${isLight ? 'var(--color-gray-200)' : 'var(--color-gray-800)'}; }
textarea { background: transparent; border: none; resize: none; outline: none; color: ${textMain}; font-family: inherit; font-size: 0.9375rem; height: 24px; width: 100%; padding-top: 2px; }
textarea::placeholder { color: ${textMuted}; }
/* MessageInput.svelte controls: PlusAlt/Component sit in size-[1.875rem]
   rounded-full buttons, Dictate is rounded-full p-1.5 mr-0.5, and with an
   empty prompt the trailing control is Voice mode — bg-black dark:bg-white
   rounded-full p-[5px] — not the submit arrow. */
.input-row { display: flex; align-items: center; gap: 2px; }
.input-row .icon-btn { width: 30px; height: 30px; border-radius: 9999px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: ${isLight ? 'var(--color-gray-700)' : '#fff'}; cursor: pointer; transition: background 0.15s; }
.input-row .icon-btn:hover { background: ${iconHover}; }
.input-row .icon-btn svg { width: 18px; height: 18px; }
.input-row .icon-btn:first-child svg { width: 20px; height: 20px; }
.input-row .spacer { flex: 1; }
.mic-btn { padding: 6px; margin-right: 2px; border-radius: 9999px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: ${isLight ? 'var(--color-gray-600)' : 'var(--color-gray-300)'}; cursor: pointer; transition: color 0.15s; }
.mic-btn svg { width: 18px; height: 18px; }
.mic-btn:hover { color: ${isLight ? 'var(--color-gray-700)' : 'var(--color-gray-200)'}; }
#call-button { padding: 5px; border-radius: 9999px; border: none; background: ${isLight ? '#000' : '#fff'}; color: ${isLight ? '#fff' : '#000'}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; cursor: pointer; transition: background 0.15s; }
#call-button svg { width: 20px; height: 20px; }
#call-button:hover { background: ${isLight ? 'var(--color-gray-900)' : 'var(--color-gray-100)'}; }
.footer-note { text-align: center; font-size: 10.5px; color: ${textFaint}; padding: 4px 0 6px; }
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
  <div id="rail" title="Open Sidebar">
    <div class="rail-group">
      <span class="rail-btn lg rail-logo"><span><i>OI</i>${SVG.panel}</span></span>
      <span class="rail-btn" style="margin-top:4px">${'<span>' + SVG.editPencil + '</span>'}</span>
      <span class="rail-btn"><span>${SVG.search}</span></span>
      <span class="rail-btn"><span>${SVG.notes}</span></span>
      <span class="rail-btn"><span>${SVG.workspace}</span></span>
      <span class="rail-btn"><span>${SVG.code}</span></span>
    </div>
    <span class="rail-btn lg"><span><span class="rail-avatar"></span></span></span>
  </div>
  <div id="sidebar">
    <div class="brand"><div class="brand-dot"><i>OI</i></div><span class="brand-name">Open WebUI</span><span class="panel-icon">${SVG.panel}</span></div>
    <div class="side-item" data-chat="new">${SVG.editPencil} <span class="label">New Chat</span></div>
    <div class="side-item">${SVG.search} <span class="label">Search</span></div>
    <div class="side-item">${SVG.notes} <span class="label">Notes</span></div>
    <div class="side-item">${SVG.workspace} <span class="label">Workspace</span></div>
    <div class="side-item">${SVG.code} <span class="label">Playground</span></div>
    <div class="side-divider"></div>
    <div class="side-scroll">
      <div class="side-label">Models</div>
      <div class="side-item"><span class="avatar sm"></span> <span class="label">Preview Model</span></div>
      <div class="side-label">Notes <span class="add">${SVG.plus}</span></div>
      <div class="side-label">Channels <span class="add">${SVG.plus}</span></div>
      <div class="side-label">Folders <span class="add">${SVG.plus}</span></div>
      <div class="side-label">Chats</div>
      <div class="side-pinned">${SVG.chevron} <span class="label">Pinned</span></div>
      <div class="side-label">Today</div>
      <div class="side-item active" data-chat="default"><span class="label">Theme preview chat</span>${CHAT_MENU}</div>
      <div class="side-label">Previous 7 days</div>
      <div class="side-item" data-chat="oklch"><span class="label">OKLCH color ramps</span><span class="age">1d</span>${CHAT_MENU}</div>
      <div class="side-item" data-chat="fx"><span class="label">Canvas FX ideas</span><span class="age">2d</span>${CHAT_MENU}</div>
      <div class="side-item" data-chat="gradient"><span class="label">Gradient inspiration</span><span class="age">3d</span>${CHAT_MENU}</div>
      <div class="side-item" data-chat="transparency"><span class="label">Structural transparency</span><span class="age">4d</span>${CHAT_MENU}</div>
      <div class="side-item" data-chat="notes"><span class="label">Preset gallery notes</span><span class="age">6d</span>${CHAT_MENU}</div>
    </div>
    <div class="side-user"><div class="avatar"></div> You</div>
  </div>
  <main>
    <nav><span id="nav-title">Theme preview chat</span><span class="nav-btn">${SVG.dots}</span><span class="right"><span class="nav-btn">${SVG.pencilSquare}</span><span class="nav-btn">${SVG.panel}</span></span></nav>
    <div id="messages-container">
      <div class="chat-user"><div class="bubble">Show me what this preset looks like on a real conversation.</div>${USER_ACTIONS}</div>
      <div class="chat-assistant">
        <div class="ai-avatar" style="background:#fff !important; color:#000 !important;">OI</div>
        <div class="ai-col">
          <div class="ai-model">Preview Model</div>
          <div class="ai-stats">Response Speed: 104.3 t/s | Total Duration: 2.418s | Prompt Evals: 147 | Eval Count: 236 | Session: 1854 tokens</div>
          <div class="prose">
            <p>Here you go — this mock chat mirrors Open WebUI's layout: <b>sidebar</b>, <b>message bubbles</b>, <code>inline code</code>, and the input bar below.</p>
            <div class="code-block"><div class="code-block-header"><span>javascript</span><span class="cb-action">Copy</span></div><pre>const theme = 'applied';</pre></div>
            <p>Every surface is painted by the preset's <code>--color-gray-*</code> ramp — the same variables the designer generates.</p>
          </div>
          ${MSG_ACTIONS}
        </div>
      </div>
      <div class="chat-user"><div class="bubble">Nice. The palette applies to every surface?</div>${USER_ACTIONS}</div>
      <div class="chat-assistant">
        <div class="ai-avatar" style="background:#fff !important; color:#000 !important;">OI</div>
        <div class="ai-col">
          <div class="ai-model">Preview Model</div>
          <div class="ai-stats">Response Speed: 98.7 t/s | Total Duration: 1.9s | Eval Count: 164 | Session: 2018 tokens</div>
          <div class="prose"><p><b>Exactly</b> — backgrounds, borders, and text all come from the preset, and Canvas FX or gradients render behind the whole interface.</p></div>
          ${MSG_ACTIONS}
          ${followUps([
            'How do I import one of these presets into my instance?',
            'Which presets look best with structural transparency enabled?',
            'Can I combine a Canvas FX script with a gradient background?',
            'What happens to the palette in OLED mode?',
          ])}
        </div>
      </div>
    </div>
    <div class="input-wrap">
      <div id="chat-input-container">
        <textarea placeholder="Send a Message" disabled></textarea>
        <div class="input-row">
          <span class="icon-btn">${SVG.plusAlt}</span>
          <span class="icon-btn">${SVG.component}</span>
          <span class="spacer"></span>
          <span class="mic-btn">${SVG.mic}</span>
          <button id="call-button">${SVG.voice}</button>
        </div>
      </div>
      <div class="footer-note">Preview Model can make mistakes. Verify important information.</div>
    </div>
  </main>
</div>
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
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  var url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
  var worker;
  try { worker = new Worker(url); } catch (e) { report('Could not start the animation worker: ' + e.message); return; }
  worker.onerror = function (e) { report('Script error: ' + (e.message || 'the animation failed to run.')); };
  var off = canvas.transferControlToOffscreen();
  var wpost = function (m, t) { try { worker.postMessage(m, t); } catch (e) {} };
  wpost({ type: 'init', canvas: off, width: window.innerWidth, height: window.innerHeight, env: { authToken: '', baseUrl: '', locale: navigator.language, timezone: '' } }, [off]);
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
  window.addEventListener('resize', function () { wpost({ type: 'resize', width: window.innerWidth, height: window.innerHeight }); });
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

  var MSG_ACTIONS = ${JSON.stringify(MSG_ACTIONS)};
  var USER_ACTIONS = ${JSON.stringify(USER_ACTIONS)};

  // Follow-ups only render on the last message upstream, and each of these
  // conversations has exactly one reply — so every ai() call may carry them.
  function followUps(items) {
    if (!items || !items.length) return '';
    return '<div class="followups-wrap"><div class="followups">' +
      '<div class="followups-title">Follow up</div><div class="followups-list">' +
      items.map(function (q, i) {
        return '<div class="followup">' + q + '</div>' + (i < items.length - 1 ? '<hr>' : '');
      }).join('') +
      '</div></div></div>';
  }

  function ai(stats, body, fups) {
    return '<div class="chat-assistant"><div class="ai-avatar" style="background:#fff !important; color:#000 !important;">OI</div><div class="ai-col">' +
      '<div class="ai-model">Preview Model</div><div class="ai-stats">' + stats + '</div>' +
      '<div class="prose">' + body + '</div>' + MSG_ACTIONS + followUps(fups) + '</div></div>';
  }
  function user(text) {
    return '<div class="chat-user"><div class="bubble">' + text + '</div>' + USER_ACTIONS + '</div>';
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
          '<ul><li><b>Sunflower</b> — seed to full bloom as tokens accumulate</li>' +
          '<li><b>Mushroom farm</b> — mycelium spreads with every reply</li>' +
          '<li><b>Hourglass</b> — sand drains as the window fills</li></ul>' +
          '<blockquote>Any metaphor with a clear empty-to-full progression works — the engine streams live token counts to your script.</blockquote>' +
          '<p>All of them fall back to <code>estimatedTokens</code> when exact usage data is unavailable.</p>',
          ['What data does the engine stream to my script?',
           'How expensive are these effects on a laptop GPU?',
           'Can a script react to which model is selected?'])
    },
    'gradient': {
      title: 'Gradient inspiration',
      html: user('What kind of gradients look good behind a chat UI?') +
        ai('Response Speed: 101.4 t/s | Total Duration: 2.2s | Eval Count: 198 | Session: 1544 tokens',
          '<p>Three directions worth trying:</p>' +
          '<ol><li><b>Deep linear</b> — near-black corners into a saturated core</li>' +
          '<li><b>Radial glow</b> — a soft light source behind the input bar</li>' +
          '<li><b>Mesh</b> — several drifting color points for an aurora feel</li></ol>' +
          '<p>Browse the <a>preset gallery</a> for ready-made packs — every one imports with a single URL.</p>',
          ['How do I animate a gradient without it feeling busy?',
           'Which gradients hold up in light mode?',
           'Can I export a gradient I built back out as a preset?'])
    },
    'transparency': {
      title: 'Structural transparency',
      html: user('How do effects show through the interface?') +
        ai('Response Speed: 108.9 t/s | Total Duration: 2.8s | Eval Count: 264 | Session: 2035 tokens',
          '<h4>The structural layer</h4>' +
          '<p>When Canvas FX or a gradient is active, layout containers turn <code>transparent</code> so the effect shines through, while the sidebar keeps a frosted-glass backdrop for readability.</p>' +
          '<p>Portaled menus and dialogs live <b>outside</b> the app container, so they stay opaque — no unreadable dropdowns.</p>',
          ['Which containers get transparency applied?',
           'How do I keep code blocks readable over an effect?',
           'Does the frosted sidebar cost much performance?'])
    },
    'notes': {
      title: 'Preset gallery notes',
      html: user('Remind me what this gallery can preview.') +
        ai('Response Speed: 99.1 t/s | Total Duration: 1.6s | Eval Count: 142 | Session: 1210 tokens',
          '<p>Everything, live:</p>' +
          '<ul><li><b>Themes</b> — full palette on this mock UI, per mode</li>' +
          '<li><b>Canvas FX</b> — real Web Worker execution behind the chat</li>' +
          '<li><b>CSS presets</b> — applied to genuine Open WebUI markup</li>' +
          '<li><b>Gradients</b> — exact designer math, animation included</li></ul>',
          ['How do I submit a preset to this gallery?',
           'Can I preview a preset before importing it?',
           'What makes a good Canvas FX submission?'])
    },
    'new': {
      title: 'New Chat',
      html: '<div class="placeholder"><div class="ph-logo" style="background:#fff !important; color:#000 !important;">OI</div>' +
        '<div class="ph-model">Preview Model</div>' +
        '<div class="ph-sub">How can I help you today?</div>' +
        '<div class="ph-suggest">' +
        '<div class="ph-label">' + BOLT_SVG + 'Suggested</div>' +
        '<div class="ph-grid">' +
        '<div class="ph-card"><b>Help me study</b><span>vocabulary for a college entrance exam</span></div>' +
        '<div class="ph-card"><b>Give me ideas</b><span>for weekend projects with the kids</span></div>' +
        '<div class="ph-card"><b>Show me a code snippet</b><span>of a sticky website header</span></div>' +
        '<div class="ph-card"><b>Overcome procrastination</b><span>give me tips</span></div>' +
        '</div></div></div>'
    }
  };

  function openChat(key) {
    var chat = CHATS[key];
    if (!chat) return;
    document.querySelectorAll('.side-item.active').forEach(function (a) { a.classList.remove('active'); });
    if (key !== 'new') {
      var item = document.querySelector('.side-scroll [data-chat="' + key + '"]');
      if (item) item.classList.add('active');
    }
    navTitle.textContent = chat.title;
    msgs.innerHTML = chat.html;
    try { parent.postMessage({ __tdpPreview: true, kind: 'chatchange', chat: key }, '*'); } catch (e) {}
  }

  document.querySelectorAll('[data-chat]').forEach(function (el) {
    el.addEventListener('click', function () { openChat(el.getAttribute('data-chat')); });
  });

  var initial = document.body.getAttribute('data-initial-chat');
  if (initial && initial !== 'default' && CHATS[initial]) openChat(initial);
})();

// Sidebar collapse/expand. Open WebUI drives this from the showSidebar store:
// the expanded panel's header button closes it, and the collapsed rail (the
// whole column is a button) reopens it.
(function () {
  var app = document.querySelector('.app');
  var rail = document.getElementById('rail');
  var toggle = document.querySelector('.brand .panel-icon');
  if (!app || !rail || !toggle) return;

  function setCollapsed(on) {
    app.classList.toggle('collapsed', on);
    try { parent.postMessage({ __tdpPreview: true, kind: 'sidebarchange', collapsed: on }, '*'); } catch (e) {}
  }

  toggle.addEventListener('click', function (e) { e.stopPropagation(); setCollapsed(true); });
  rail.addEventListener('click', function () { setCollapsed(false); });

  if (document.body.getAttribute('data-sidebar-collapsed') === '1') app.classList.add('collapsed');
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

  function setStatus(msg) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('visible', !!msg);
  }

  function closePreview() {
    if (active && active.destroy) active.destroy();
    active = null;
    stage.innerHTML = '';
    controlsEl.innerHTML = '';
    setStatus('');
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function openOverlay(title) {
    currentMockChat = 'default';
    currentSidebarCollapsed = false;
    titleEl.textContent = title;
    stage.innerHTML = '';
    controlsEl.innerHTML = '';
    setStatus('');
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
  }

  closeBtn.addEventListener('click', closePreview);
  window.addEventListener('message', (e) => {
    if (!e.data || e.data.__tdpPreview !== true || !overlay.classList.contains('open')) return;
    if (e.data.kind === 'escape') closePreview();
    if (e.data.kind === 'chatchange' && typeof e.data.chat === 'string') currentMockChat = e.data.chat;
    if (e.data.kind === 'sidebarchange') currentSidebarCollapsed = !!e.data.collapsed;
    if (e.data.kind === 'status' && typeof e.data.text === 'string') setStatus(e.data.text);
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

  function pillGroup(labels, activeLabel, onPick) {
    const wrap = document.createElement('div');
    wrap.className = 'preview-pills';
    labels.forEach((label) => {
      const b = document.createElement('button');
      b.className = 'preview-pill' + (label === activeLabel ? ' active' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        wrap.querySelectorAll('.preview-pill').forEach((p) => p.classList.remove('active'));
        b.classList.add('active');
        onPick(label);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  // Shared: mount the mock UI over an effect layer, with dark/light pills
  function mockOverEffect(defaultMode) {
    let frame = null;
    const renderMode = (modeKey) => {
      if (frame) frame.remove();
      frame = mountMockFrame(
        stage,
        buildMockSrcdoc({ modeKey, vars: themeVars(null), customCSS: '', transparent: true, initialChat: currentMockChat, initialCollapsed: currentSidebarCollapsed })
      );
    };
    controlsEl.appendChild(pillGroup(['dark', 'light'], defaultMode, renderMode));
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
          buildMockSrcdoc({ modeKey, vars: themeVars(null), customCSS: css, transparent: false, initialChat: currentMockChat, initialCollapsed: currentSidebarCollapsed })
        );
      };
      controlsEl.appendChild(pillGroup(['dark', 'light'], 'dark', renderMode));
      const note = document.createElement('span');
      note.className = 'preview-hint';
      note.textContent = 'Approximate — rendered on a mock chat layout';
      controlsEl.appendChild(note);
      renderMode('dark');
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
          })
        );
      };

      if (present.length > 1) {
        controlsEl.appendChild(pillGroup(present, present[0], renderMode));
      }
      renderMode(present[0]);

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
