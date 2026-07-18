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

    const onMove = (e) => queueMove(e.clientX, e.clientY);
    const onClick = (e) => post({ type: 'click', x: e.clientX, y: e.clientY });
    const onDown = (e) => post({ type: 'mousedown', x: e.clientX, y: e.clientY });
    const onUp = (e) => post({ type: 'mouseup', x: e.clientX, y: e.clientY });
    const touches = (e) => Array.from(e.touches.length ? e.touches : e.changedTouches).map((t) => ({ x: t.clientX, y: t.clientY }));
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

  const SVG = {
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    dots: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3"/></svg>',
    arrowUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    panel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18"/></svg>',
  };

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
    const hover = isLight ? 'var(--color-gray-100)' : 'var(--color-gray-850)';
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

    const structural = opts.transparent
      ? `
  body { background: transparent !important; }
  .app, main, nav { background: transparent !important; }
  #sidebar { background: color-mix(in srgb, ${sidebarBg} 72%, transparent) !important; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
  .chat-user > div { background: color-mix(in srgb, ${bubble} 72%, transparent); }`
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
.app { display: flex; height: 100vh; }

#sidebar { width: 245px; flex-shrink: 0; background: ${sidebarBg}; border-right: 1px solid ${borderSubtle}; padding: 8px 6px 8px; display: flex; flex-direction: column; overflow: hidden; }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 500; font-size: 13px; padding: 6px 10px 10px 8px; color: ${textMain}; }
.brand-dot { width: 24px; height: 24px; border-radius: 7px; background: #fff !important; color: #000 !important; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 800; letter-spacing: -0.02em; border: 1px solid rgb(0 0 0 / 0.1); }
.brand .panel-icon { margin-left: auto; color: ${textMuted}; }
.brand .panel-icon svg { width: 15px; height: 15px; }
.side-item { display: flex; align-items: center; gap: 10px; min-height: 32px; padding: 6px 11px; border-radius: 12px; color: ${textSoft}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; line-height: 20px; }
.side-item svg { width: 15px; height: 15px; color: ${textSoft}; }
.side-item { cursor: pointer; transition: background 0.15s; }
.side-item:hover { background: ${navHover}; }
.side-scroll .side-item:hover { background: ${itemHover}; }
.side-item.active, .side-scroll .side-item.active:hover { background: ${activeItem}; color: ${isLight ? 'var(--color-gray-800)' : 'var(--color-gray-200)'}; }
.side-item .age { margin-left: auto; font-size: 10px; color: ${ageText}; }
.side-item .add { margin-left: auto; color: ${textFaint}; }
.side-item .add svg { width: 12px; height: 12px; }
.side-label { font-size: 12px; color: ${textMuted}; padding: 16px 0 4px 10px; display: flex; align-items: center; }
.side-label .add { margin-left: auto; padding-right: 8px; color: ${textFaint}; }
.side-label .add svg { width: 12px; height: 12px; }
.side-pinned { display: flex; align-items: center; gap: 6px; padding: 14px 10px 2px; color: ${textMuted}; font-size: 12px; }
.side-pinned svg { width: 11px; height: 11px; }
.side-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; scrollbar-width: none; }
.side-scroll::-webkit-scrollbar { display: none; }
.side-user { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; color: ${textMain}; font-weight: 500; font-size: 13px; cursor: pointer; transition: background 0.15s; }
.side-user:hover { background: ${itemHover}; }
.side-label .add, .side-pinned, .brand .panel-icon { cursor: pointer; transition: color 0.15s; }
.side-label .add:hover, .brand .panel-icon:hover { color: ${textMain}; }
.avatar { width: 22px; height: 22px; border-radius: 50%; background: linear-gradient(135deg, #6366f1, #ec4899); flex-shrink: 0; }
.avatar.sm { width: 18px; height: 18px; border-radius: 6px; }

main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
nav { padding: 8px 12px 8px 16px; display: flex; align-items: center; gap: 10px; font-size: 13px; color: ${textMain}; position: relative; z-index: 2; }
${opts.transparent ? '' : `nav::before { content: ''; position: absolute; inset: 0 0 -34px 0; background: linear-gradient(to bottom, color-mix(in srgb, ${bg} 90%, transparent), color-mix(in srgb, ${bg} 50%, transparent) 40%, transparent 97%); z-index: -1; pointer-events: none; }`}
nav .dots { color: ${textMuted}; display: flex; }
nav .dots svg { width: 14px; height: 14px; }
nav .right { margin-left: auto; color: ${textMuted}; display: flex; gap: 14px; }
nav .right svg { width: 15px; height: 15px; }
nav .dots, nav .right { cursor: pointer; }
nav .dots:hover, nav .right:hover { color: ${textMain}; }

#messages-container { flex: 1; overflow: hidden; padding: 16px 24px 6px; display: flex; flex-direction: column; gap: 14px; max-width: 768px; width: 100%; margin: 0 auto; }
.chat-user { display: flex; justify-content: flex-end; padding-bottom: 4px; }
.chat-user > div { max-width: 90%; background: ${bubble}; border-radius: 24px; padding: 6px 16px; font-size: 0.9375rem; line-height: 1.625; color: ${proseText}; }
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
.code-block { border-radius: 16px; border: 1px solid ${borderSubtle}; background: ${codeBlockBg}; margin: 6px 0 10px; overflow: hidden; }
.code-block-header { display: flex; align-items: center; justify-content: space-between; padding: 6px 14px 0; font-size: 11px; color: ${textMuted}; }
.code-block-header .cb-action { cursor: pointer; color: ${isLight ? '#000' : '#fff'}; font-size: 11px; }
.code-block-header .cb-action:hover { opacity: 0.7; }
.prose pre { background: ${codeBlockBg}; padding: 8px 14px 12px; font-family: ui-monospace, 'JetBrains Mono', monospace; font-size: 12px; overflow: hidden; margin: 0; color: ${proseText}; }
.prose ul, .prose ol { margin: 4px 0 10px 22px; }
.prose li { margin-bottom: 4px; }
.prose blockquote { border-left: 2px solid ${border}; padding: 2px 0 2px 12px; color: ${textMuted}; margin: 6px 0 10px; }
.prose a { color: ${textMain}; text-decoration: underline; cursor: pointer; }
.prose table { border-collapse: collapse; margin: 6px 0 10px; font-size: 12.5px; }
.prose th, .prose td { border: 1px solid ${border}; padding: 5px 10px; text-align: left; }
.prose th { background: ${codeBg}; color: ${textMain}; font-weight: 600; }
.prose h4 { font-size: 0.9375rem; font-weight: 600; color: ${textMain}; margin: 8px 0 4px; }
.placeholder { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding-bottom: 30px; }
.ph-logo { width: 44px; height: 44px; border-radius: 12px; background: #fff !important; color: #000 !important; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; margin-bottom: 10px; border: 1px solid rgb(0 0 0 / 0.1); }
.ph-model { font-size: 28px; font-weight: 500; color: ${isLight ? 'var(--color-gray-800)' : 'var(--color-gray-100)'}; }
.ph-sub { font-size: 19px; color: ${isLight ? 'var(--color-gray-600)' : 'var(--color-gray-400)'}; margin: 2px 0 20px; }
.ph-label { font-size: 11px; color: ${textFaint}; margin-bottom: 8px; display: flex; align-items: center; gap: 5px; }
.ph-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: min(560px, 92%); }
.ph-card { border: 1px solid ${borderSubtle}; border-radius: 14px; padding: 10px 14px; cursor: pointer; transition: background 0.15s; }
.ph-card:hover { background: ${hover}; }
.ph-card b { display: block; font-size: 13px; color: ${textSoft}; font-weight: 600; }
.ph-card span { font-size: 12px; color: ${isLight ? 'var(--color-gray-500)' : 'var(--color-gray-400)'}; }
.msg-actions { display: flex; gap: 4px; margin-top: 8px; color: ${textMuted}; }
.msg-actions .icon-sm { padding: 4px; border-radius: 6px; display: flex; cursor: pointer; transition: background 0.15s, color 0.15s; }
.msg-actions .icon-sm:hover { background: ${ghostHover}; color: ${textMain}; }
.msg-actions svg { width: 15px; height: 15px; }

.input-wrap { padding: 0 16px 4px; max-width: 800px; width: 100%; margin: 0 auto; }
#chat-input-container { background: ${inputBg}; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); border: 1px solid ${borderSubtle}; border-radius: 24px; box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1); padding: 10px 10px 8px 18px; display: flex; flex-direction: column; gap: 8px; }
textarea { background: transparent; border: none; resize: none; outline: none; color: ${textMain}; font-family: inherit; font-size: 0.9375rem; height: 24px; width: 100%; padding-top: 2px; }
textarea::placeholder { color: ${textMuted}; }
.input-row { display: flex; align-items: center; gap: 4px; color: ${textSoft}; }
.input-row .icon-btn { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.15s; }
.input-row .icon-btn:hover { background: ${iconHover}; }
.input-row .spacer { flex: 1; }
.input-row svg { width: 17px; height: 17px; }
#send-message-button { width: 32px; height: 32px; border-radius: 50%; border: none; background: ${isLight ? 'var(--color-gray-900)' : '#fff'}; color: ${isLight ? '#fff' : 'var(--color-gray-900)'}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; cursor: default; margin-left: 4px; }
#send-message-button svg { width: 15px; height: 15px; }
#send-message-button { cursor: pointer; transition: filter 0.15s; }
#send-message-button:hover { filter: ${isLight ? 'brightness(1.4)' : 'brightness(0.88)'}; }
.footer-note { text-align: center; font-size: 10.5px; color: ${textFaint}; padding: 4px 0 6px; }
${structural}
</style>
<style>
${safeCSS}
</style>
</head>
<body data-initial-chat="${esc(opts.initialChat || 'default')}">
<div class="app">
  <div id="sidebar">
    <div class="brand"><div class="brand-dot" style="background:#fff !important; color:#000 !important;">OI</div> Open WebUI <span class="panel-icon">${SVG.panel}</span></div>
    <div class="side-item" data-chat="new">${SVG.pencil} New Chat</div>
    <div class="side-item">${SVG.search} Search</div>
    <div class="side-item">${SVG.notes} Notes</div>
    <div class="side-item">${SVG.grid} Workspace</div>
    <div class="side-item">${SVG.code} Playground</div>
    <div class="side-scroll">
      <div class="side-label">Models</div>
      <div class="side-item"><span class="avatar sm"></span> Preview Model</div>
      <div class="side-label">Notes <span class="add">${SVG.plus}</span></div>
      <div class="side-label">Channels <span class="add">${SVG.plus}</span></div>
      <div class="side-label">Folders <span class="add">${SVG.plus}</span></div>
      <div class="side-label">Chats</div>
      <div class="side-pinned">${SVG.chevron} Pinned</div>
      <div class="side-label">Today</div>
      <div class="side-item active" data-chat="default">Theme preview chat</div>
      <div class="side-label">Previous 7 days</div>
      <div class="side-item" data-chat="oklch">OKLCH color ramps <span class="age">1d</span></div>
      <div class="side-item" data-chat="fx">Canvas FX ideas <span class="age">2d</span></div>
      <div class="side-item" data-chat="gradient">Gradient inspiration <span class="age">3d</span></div>
      <div class="side-item" data-chat="transparency">Structural transparency <span class="age">4d</span></div>
      <div class="side-item" data-chat="notes">Preset gallery notes <span class="age">6d</span></div>
    </div>
    <div class="side-user"><div class="avatar"></div> You</div>
  </div>
  <main>
    <nav><span id="nav-title">Theme preview chat</span> <span class="dots">${SVG.dots}</span><span class="right">${SVG.pencil}${SVG.panel}</span></nav>
    <div id="messages-container">
      <div class="chat-user"><div>Show me what this preset looks like on a real conversation.</div></div>
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
          <div class="msg-actions"><span class="icon-sm">${SVG.dots}</span></div>
        </div>
      </div>
      <div class="chat-user"><div>Nice. The palette applies to every surface?</div></div>
      <div class="chat-assistant">
        <div class="ai-avatar" style="background:#fff !important; color:#000 !important;">OI</div>
        <div class="ai-col">
          <div class="ai-model">Preview Model</div>
          <div class="ai-stats">Response Speed: 98.7 t/s | Total Duration: 1.9s | Eval Count: 164 | Session: 2018 tokens</div>
          <div class="prose"><p><b>Exactly</b> — backgrounds, borders, and text all come from the preset, and Canvas FX or gradients render behind the whole interface.</p></div>
        </div>
      </div>
    </div>
    <div class="input-wrap">
      <div id="chat-input-container">
        <textarea placeholder="Send a Message" disabled></textarea>
        <div class="input-row">
          <span class="icon-btn">${SVG.plus}</span>
          <span class="icon-btn">${SVG.grid}</span>
          <span class="spacer"></span>
          <span class="icon-btn">${SVG.mic}</span>
          <button id="send-message-button">${SVG.arrowUp}</button>
        </div>
      </div>
      <div class="footer-note">Preview Model can make mistakes. Verify important information.</div>
    </div>
  </main>
</div>
<script>
(function () {
  var post = function (kind, data) {
    try { parent.postMessage(Object.assign({ __tdpPreview: true, kind: kind }, data), '*'); } catch (e) {}
  };
  window.addEventListener('mousemove', function (e) { post('mousemove', { x: e.clientX, y: e.clientY }); }, { passive: true });
  window.addEventListener('click', function (e) { post('click', { x: e.clientX, y: e.clientY }); }, true);
  window.addEventListener('mousedown', function (e) { post('mousedown', { x: e.clientX, y: e.clientY }); }, true);
  window.addEventListener('mouseup', function (e) { post('mouseup', { x: e.clientX, y: e.clientY }); }, true);
  var touchList = function (e) {
    var list = e.touches.length ? e.touches : e.changedTouches;
    var out = [];
    for (var i = 0; i < list.length; i++) out.push({ x: list[i].clientX, y: list[i].clientY });
    return out;
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

  function ai(stats, body) {
    return '<div class="chat-assistant"><div class="ai-avatar" style="background:#fff !important; color:#000 !important;">OI</div><div class="ai-col">' +
      '<div class="ai-model">Preview Model</div><div class="ai-stats">' + stats + '</div>' +
      '<div class="prose">' + body + '</div></div></div>';
  }
  function user(text) {
    return '<div class="chat-user"><div>' + text + '</div></div>';
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
          '<p>Shifting the base <b>lightness</b> slides the whole ramp while keeping the perceptual spacing intact.</p>')
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
          '<p>All of them fall back to <code>estimatedTokens</code> when exact usage data is unavailable.</p>')
    },
    'gradient': {
      title: 'Gradient inspiration',
      html: user('What kind of gradients look good behind a chat UI?') +
        ai('Response Speed: 101.4 t/s | Total Duration: 2.2s | Eval Count: 198 | Session: 1544 tokens',
          '<p>Three directions worth trying:</p>' +
          '<ol><li><b>Deep linear</b> — near-black corners into a saturated core</li>' +
          '<li><b>Radial glow</b> — a soft light source behind the input bar</li>' +
          '<li><b>Mesh</b> — several drifting color points for an aurora feel</li></ol>' +
          '<p>Browse the <a>preset gallery</a> for ready-made packs — every one imports with a single URL.</p>')
    },
    'transparency': {
      title: 'Structural transparency',
      html: user('How do effects show through the interface?') +
        ai('Response Speed: 108.9 t/s | Total Duration: 2.8s | Eval Count: 264 | Session: 2035 tokens',
          '<h4>The structural layer</h4>' +
          '<p>When Canvas FX or a gradient is active, layout containers turn <code>transparent</code> so the effect shines through, while the sidebar keeps a frosted-glass backdrop for readability.</p>' +
          '<p>Portaled menus and dialogs live <b>outside</b> the app container, so they stay opaque — no unreadable dropdowns.</p>')
    },
    'notes': {
      title: 'Preset gallery notes',
      html: user('Remind me what this gallery can preview.') +
        ai('Response Speed: 99.1 t/s | Total Duration: 1.6s | Eval Count: 142 | Session: 1210 tokens',
          '<p>Everything, live:</p>' +
          '<ul><li><b>Themes</b> — full palette on this mock UI, per mode</li>' +
          '<li><b>Canvas FX</b> — real Web Worker execution behind the chat</li>' +
          '<li><b>CSS presets</b> — applied to genuine Open WebUI markup</li>' +
          '<li><b>Gradients</b> — exact designer math, animation included</li></ul>')
    },
    'new': {
      title: 'New Chat',
      html: '<div class="placeholder"><div class="ph-logo" style="background:#fff !important; color:#000 !important;">OI</div>' +
        '<div class="ph-model">Preview Model</div>' +
        '<div class="ph-sub">How can I help you today?</div>' +
        '<div class="ph-label">&#9889; Suggested</div>' +
        '<div class="ph-grid">' +
        '<div class="ph-card"><b>Help me study</b><span>vocabulary for a college entrance exam</span></div>' +
        '<div class="ph-card"><b>Give me ideas</b><span>for weekend projects with the kids</span></div>' +
        '<div class="ph-card"><b>Show me a code snippet</b><span>of a sticky website header</span></div>' +
        '<div class="ph-card"><b>Overcome procrastination</b><span>give me tips</span></div>' +
        '</div></div>'
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
        buildMockSrcdoc({ modeKey, vars: themeVars(null), customCSS: '', transparent: true, initialChat: currentMockChat })
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
          buildMockSrcdoc({ modeKey, vars: themeVars(null), customCSS: css, transparent: false, initialChat: currentMockChat })
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
      let engine = null;
      let gradientEl = null;

      const renderMode = (modeKey) => {
        if (frame) { frame.remove(); frame = null; }
        if (engine) { engine.destroy(); engine = null; }
        if (gradientEl) { gradientEl.remove(); gradientEl = null; }
        setStatus('');

        const mode = theme[modeKey];
        const hasCanvas = mode.canvasEnabled && mode.canvasScript && mode.canvasScript.trim();
        const gLayers = mode.gradientEnabled ? gradientLayers(mode) : null;
        const hasEffects = !!(hasCanvas || gLayers);

        if (gLayers) {
          gradientEl = document.createElement('div');
          gradientEl.className = 'preview-gradient-bg';
          applyGradientToEl(gradientEl, gLayers);
          stage.appendChild(gradientEl);
        }
        if (hasCanvas) {
          engine = startCanvasEngine(mode.canvasScript, stage, setStatus);
        }

        frame = mountMockFrame(
          stage,
          buildMockSrcdoc({
            modeKey,
            vars: themeVars(mode),
            customCSS: mode.customCssEnabled !== false ? mode.customCSS || '' : '',
            transparent: hasEffects,
            initialChat: currentMockChat,
          })
        );
      };

      if (present.length > 1) {
        controlsEl.appendChild(pillGroup(present, present[0], renderMode));
      }
      renderMode(present[0]);

      active = {
        destroy() {
          if (engine) engine.destroy();
          if (frame) frame.remove();
          if (gradientEl) gradientEl.remove();
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
