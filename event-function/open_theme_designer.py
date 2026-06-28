"""
title: Theme Designer Pro
description: Instance-wide theme designer for Open WebUI. Registers an interactive UI at /api/v1/theme-designer and persists themes server-side as CSS injected into index.html — all users see the admin's theme immediately.
author: @G30
author_url: https://openwebui.com/u/g30
funding_url: https://buymeacoffee.com/iamg30
version: 1.0.0
license: MIT
required_open_webui_version: 0.9.0
"""

import json as _json
import logging
import os
import re as _re
import asyncio
import threading
from pathlib import Path

from pydantic import BaseModel, Field

VERSION = "1.0.0"
ROUTE_PATH = "/api/v1/theme-designer"
CSS_FILE_NAME = "open_theme_designer.css"

log = logging.getLogger(__name__)


class Event:
    class Valves(BaseModel):
        theme_active: bool = Field(
            default=True,
            description=(
                "Master toggle. When OFF, strips all injected CSS and bootloader from "
                "index.html so the instance looks stock. Toggle back ON to re-enable."
            ),
        )
        enable_custom_css: bool = Field(
            default=True,
            description="Allow the Style Overrides (custom CSS) editor. When disabled, the Style Overrides tab is hidden.",
        )
        enable_canvas_fx: bool = Field(
            default=True,
            description="Allow Canvas FX (JavaScript background animations). When disabled, the Canvas FX tab is hidden and running animations are suppressed.",
        )
        enable_gradient_builder: bool = Field(
            default=True,
            description="Allow the Gradient Background builder. When disabled, the Gradient tab is hidden.",
        )
        enable_auth_page_theming: bool = Field(
            default=True,
            description="Allow theming the login/signup pages. When disabled, all auth visibility toggles are hidden and forced off.",
        )
        enable_url_import: bool = Field(
            default=True,
            description="Allow importing themes, CSS snippets, and canvas scripts from remote URLs.",
        )
        allowed_import_domains: str = Field(
            default="",
            description="Comma-separated allowlist of domains for URL imports (e.g. 'raw.githubusercontent.com, openwebui.com'). Empty = allow all.",
        )
        draft_mode_default: bool = Field(
            default=False,
            description="Open the designer in Draft mode by default. When enabled, the designer starts in Draft mode on every fresh page load, preventing accidental live changes.",
        )
        designer_url: str = Field(
            default=ROUTE_PATH,
            description=(
                "🎨 **[Theme Designer Pro](/api/v1/theme-designer)** — "
                "The URL path where the designer UI is served. "
                "Change this to serve the designer at a custom path. "
                "Requires a server restart or event trigger to take effect."
            ),
        )

    BOOTLOADER_SCRIPT = """
    <!-- OWUI Theme Pro Bootloader -->
    <script id="owui-theme-bootloader">
    (function() {
        try {
            // In-memory theme state — primary source for canvas, eliminates localStorage dependency
            var _owuiThemeState = null;
            // In-memory CSS — primary source for draft mode, where sessionStorage is invisible to bootloader
            var _owuiThemeCss = null;

            // Fetch server-side CSS and state — keeps ALL users in sync with admin's theme
            // Skip on the designer page (it manages its own state directly)
            if (!window.__THEME_DESIGNER__) {
            // Check for state JSON embedded in index.html (injected by server)
            var embeddedState = document.getElementById('owui-theme-state');
            if (embeddedState) {
                try { _owuiThemeState = embeddedState.textContent; } catch(x) {}
            }

            // Seed in-memory CSS from localStorage immediately so the synchronous
            // initial refresh() below has the latest data (localStorage is shared
            // across all tabs for the same origin and is updated by SSE handlers).
            // This prevents stale embedded CSS from persisting on duplicated tabs.
            try {
                var lsCss = localStorage.getItem('owui_dev_theme_v1_css');
                if (lsCss) _owuiThemeCss = lsCss;
                var lsState = localStorage.getItem('owui_dev_theme_v1');
                if (lsState) _owuiThemeState = lsState;
            } catch(x) {}

            // Fetch CSS from server (always needed — index.html has a safe subset without structural/gradient)
            // cache: 'no-store' bypasses browser cache entirely — critical for duplicated tabs
            fetch('__THEME_ROUTE__/theme.css', { cache: 'no-store' })
                .then(function(r) { if (r.ok && r.status !== 204) return r.text(); return ''; })
                .then(function(css) {
                    if (css && css.trim()) {
                        _owuiThemeCss = css;
                        // Write-through to localStorage (Watchtower recovery fallback)
                        try { localStorage.setItem('owui_dev_theme_v1_css', css); } catch(x) {}
                        enforceTheme();
                    }
                }).catch(function() {});

            // Always fetch state from server — embedded state in index.html may be stale
            // (only updated on next event() call, not on every theme save).
            // The embedded state above is still useful for the synchronous initial paint
            // (flash prevention), but the server fetch overrides it with the latest data.
            fetch('__THEME_ROUTE__/state.json', { cache: 'no-store' })
                .then(function(r) { if (r.ok && r.status !== 204) return r.text(); return ''; })
                .then(function(state) {
                    if (state && state.trim() && state !== '{}') {
                        _owuiThemeState = state;
                        // Write-through to localStorage (Watchtower recovery fallback)
                        try { localStorage.setItem('owui_dev_theme_v1', state); } catch(x) {}
                        initCanvas();
                        enforceTheme();
                    }
                }).catch(function() {});
            }

            // In-memory disable flag — prevents storage/MutationObserver from re-injecting after theme-disable
            var _disabled = false;

            function themeToMode(theme) {
                if (theme === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                return { 'oled-dark': 'oled', her: 'her', light: 'light', dark: 'dark' }[theme] || 'dark';
            }

            function enforceTheme() {
                const savedCss = _owuiThemeCss || localStorage.getItem('owui_dev_theme_v1_css');
                if (savedCss) {
                    let style = document.getElementById('owui-dev-live-theme');
                    if (!style) {
                        style = document.createElement('style');
                        style.id = 'owui-dev-live-theme';
                        document.head.appendChild(style);
                    }
                    
                    let finalCss = savedCss;
                    // Sanitize: strip any stale body::before rules from cached CSS (legacy hue-rotate feature)
                    finalCss = finalCss.replace(/[^{}]*body\s*::before\s*\{[^}]*\}/g, '');
                    const isAuthPage = window.location.pathname.startsWith('/auth');

                    // Strip palette vars for modes with paletteEnabled === false (applies on all pages)
                    try {
                        const savedData = JSON.parse(_owuiThemeState || localStorage.getItem('owui_dev_theme_v1') || '{}');
                        ['dark', 'oled', 'light', 'her'].forEach(function(m) {
                            if (savedData[m] && savedData[m].paletteEnabled === false) {
                                var palTag = m.toUpperCase();
                                var palRe = new RegExp('/\\*\\[OWUI_PAL_' + palTag + '_START\\]\\*/[\\s\\S]*?/\\*\\[OWUI_PAL_' + palTag + '_END\\]\\*/', 'g');
                                finalCss = finalCss.replace(palRe, '');
                            }
                        });
                    } catch(e) { console.warn('Theme Pro:', e); }

                    if (isAuthPage) {
                        try {
                            const savedData = JSON.parse(_owuiThemeState || localStorage.getItem('owui_dev_theme_v1') || '{}');
                            const mode = themeToMode(localStorage.getItem('theme') || 'dark');
                            const config = savedData[mode];
                            
                            if (config) {
                                if (config.themeShowAuth === false) {
                                    finalCss = finalCss.replace(/\/\*\[OWUI_VARS_START\]\*\/[\s\S]*?\/\*\[OWUI_VARS_END\]\*\//g, '');
                                }
                                if (config.customCssShowAuth === false) {
                                    finalCss = finalCss.replace(/\/\*\[OWUI_CUSTOM_START\]\*\/[\s\S]*?\/\*\[OWUI_CUSTOM_END\]\*\//g, '');
                                }
                                if (config.canvasShowAuth === false && config.gradientShowAuth === false) {
                                    finalCss = finalCss.replace(/\/\*\[OWUI_STRUCTURAL_START\]\*\/[\s\S]*?\/\*\[OWUI_STRUCTURAL_END\]\*\//g, '');
                                }
                                if (config.gradientShowAuth === false) {
                                    finalCss = finalCss.replace(/\/\*\[OWUI_GRADIENT_START\]\*\/[\s\S]*?\/\*\[OWUI_GRADIENT_END\]\*\//g, '');
                                }
                            }
                        } catch(e) { console.warn('Theme Pro:', e); }
                    }
                    
                    if (style.innerHTML !== finalCss) style.innerHTML = finalCss;
                    // Remove server-embedded CSS — it's a stale subset that can conflict
                    // with the full live CSS (especially custom CSS with !important rules)
                    var serverStyle = document.getElementById('owui-server-theme');
                    if (serverStyle) serverStyle.remove();
                }
                
                const storedTheme = localStorage.getItem('theme');
                if (storedTheme) {
                    if (document.documentElement.getAttribute('data-theme') !== storedTheme) {
                        document.documentElement.setAttribute('data-theme', storedTheme);
                    }
                    const html = document.documentElement;
                    const currentTheme = storedTheme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : storedTheme;
                    const classMap = { dark: 'dark', 'oled-dark': 'dark', her: 'her', light: 'light' };
                    const target = classMap[currentTheme];
                    if (target && !html.classList.contains(target)) {
                        html.classList.add(target);
                        ['dark', 'light', 'her'].filter(c => c !== target).forEach(c => html.classList.remove(c));
                    }
                }
            }
            
            // Context observer for Canvas FX — watches chat DOM for message
            // count/size and sends periodic { type: 'context' } updates to the
            // Canvas FX Worker/handler. Enables context-aware animations.
            function startContextObserver(sendFn) {
                var _observer = null;
                var _scanTimer = 0;
                var _pollTimer = 0;
                var _lastChars = -1;
                var _lastMsgCount = -1;

                // Custom event API — any Open WebUI plugin/extension can dispatch
                // window.dispatchEvent(new CustomEvent('owui-canvas-context', { detail: { ratio: 0.65, ... } }))
                var _onCustom = function(e) {
                    if (e.detail) sendFn(Object.assign({ type: 'context' }, e.detail));
                };
                window.addEventListener('owui-canvas-context', _onCustom);

                function scan() {
                    var container = document.getElementById('messages-container');
                    if (!container) return;

                    var messageEls = container.querySelectorAll('[id^="message-"]');
                    var msgCount = messageEls.length;
                    var totalChars = 0;

                    // Measure user message text
                    container.querySelectorAll('.chat-user').forEach(function(el) {
                        totalChars += (el.textContent || '').length;
                    });
                    // Measure assistant message text
                    container.querySelectorAll('.chat-assistant').forEach(function(el) {
                        totalChars += (el.textContent || '').length;
                    });

                    // Only send if data actually changed
                    if (totalChars !== _lastChars || msgCount !== _lastMsgCount) {
                        _lastChars = totalChars;
                        _lastMsgCount = msgCount;
                        sendFn({
                            type: 'context',
                            messages: msgCount,
                            chars: totalChars,
                            estimatedTokens: Math.ceil(totalChars / 4)
                        });
                    }
                }

                function setup() {
                    var container = document.getElementById('messages-container');
                    if (!container) {
                        // SPA hasn't rendered the chat yet — poll until it appears
                        _pollTimer = setTimeout(setup, 1000);
                        return;
                    }

                    _observer = new MutationObserver(function() {
                        clearTimeout(_scanTimer);
                        _scanTimer = setTimeout(scan, 2000); // Debounce: scan at most every 2s
                    });
                    _observer.observe(container, { childList: true, subtree: true, characterData: true });

                    // Also re-attach if SPA navigates away and back (container gets replaced)
                    var _navObserver = new MutationObserver(function() {
                        if (!document.getElementById('messages-container')) {
                            if (_observer) _observer.disconnect();
                            _lastChars = -1;
                            _lastMsgCount = -1;
                            // Send a zero-state so scripts know context was reset
                            sendFn({ type: 'context', messages: 0, chars: 0, estimatedTokens: 0 });
                            _pollTimer = setTimeout(setup, 1000);
                        }
                    });
                    _navObserver.observe(document.body, { childList: true, subtree: false });

                    // Store for cleanup
                    _observer._navObserver = _navObserver;

                    // Initial scan
                    scan();
                }

                setup();

                // Return cleanup function
                return function() {
                    window.removeEventListener('owui-canvas-context', _onCustom);
                    if (_observer) {
                        _observer.disconnect();
                        if (_observer._navObserver) _observer._navObserver.disconnect();
                    }
                    clearTimeout(_scanTimer);
                    clearTimeout(_pollTimer);
                };
            }

            let lastCanvasScript = null;
            let lastCanvasWasEnabled = null;

            function initCanvas(forceFallback) {
                try {
                    if (!document.body) {
                        setTimeout(initCanvas, 50);
                        return;
                    }
                    // Valve gate: admin disabled Canvas FX
                    if (localStorage.getItem('owui_theme_valve_no_canvas') === 'true') {
                        if (window.owuiCanvasCleanups) {
                            window.owuiCanvasCleanups.forEach(fn => fn());
                            window.owuiCanvasCleanups = [];
                        }
                        ['owui-theme-canvas-bg','owui-canvas-script-runner','owui-theme-bg-color'].forEach(id => {
                            const el = document.getElementById(id);
                            if (el) el.remove();
                        });
                        lastCanvasScript = '_VALVE_DISABLED_';
                        lastCanvasWasEnabled = false;
                        return;
                    }
                    const savedData = JSON.parse(_owuiThemeState || localStorage.getItem('owui_dev_theme_v1') || '{}');
                    const mode = themeToMode(document.documentElement.getAttribute('data-theme') || 'dark');
                    const config = savedData[mode];
                    
                    const isAuthPage = window.location.pathname.startsWith('/auth');
                    if (isAuthPage && config && config.canvasShowAuth === false) {
                        if (window.owuiCanvasCleanups) {
                            window.owuiCanvasCleanups.forEach(fn => fn());
                            window.owuiCanvasCleanups =[];
                        }
                        const existingCanvas = document.getElementById('owui-theme-canvas-bg');
                        const existingScript = document.getElementById('owui-canvas-script-runner');
                        const existingBg = document.getElementById('owui-theme-bg-color');
                        if (existingCanvas) existingCanvas.remove();
                        if (existingScript) existingScript.remove();
                        if (existingBg) existingBg.remove();
                        lastCanvasScript = "_AUTH_HIDDEN_";
                        lastCanvasWasEnabled = false;
                        return;
                    }
                    
                    const existingCanvas = document.getElementById('owui-theme-canvas-bg');
                    const isCanvasExpected = config && config.canvasEnabled && config.canvasScript && config.canvasScript.trim() !== '';
                    
                    if (!forceFallback && config && lastCanvasScript === config.canvasScript && lastCanvasWasEnabled === isCanvasExpected) {
                        if (!isCanvasExpected || existingCanvas) return;
                    }

                    if (window.owuiCanvasCleanups) {
                        window.owuiCanvasCleanups.forEach(fn => fn());
                        window.owuiCanvasCleanups =[];
                    }
                    
                    if (existingCanvas) existingCanvas.remove();
                    const existingBg = document.getElementById('owui-theme-bg-color');
                    if (existingBg) existingBg.remove();
                    document.querySelectorAll('#owui-canvas-script-runner').forEach(el => el.remove());
                    
                    if (config && config.canvasEnabled && config.canvasScript) {
                        lastCanvasScript = config.canvasScript;
                        lastCanvasWasEnabled = true;
                        
                        const bg = document.createElement('div');
                        bg.id = 'owui-theme-bg-color';
                        bg.style = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: -2; pointer-events: none;';
                        document.body.prepend(bg);

                        const canvas = document.createElement('canvas');
                        canvas.id = 'owui-theme-canvas-bg';
                        canvas.width = window.innerWidth;
                        canvas.height = window.innerHeight;
                        canvas.style = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 0; pointer-events: none;';
                        document.body.prepend(canvas);
                        
                        window.owuiCanvasCleanups = window.owuiCanvasCleanups ||[];
                        
                        const useWorker = !forceFallback && !!canvas.transferControlToOffscreen;
                        let _canvasSend = null;
                        
                        if (useWorker) {
                            // REAL WORKER MODE (OffscreenCanvas)
                            const blob = new Blob([config.canvasScript], { type: 'application/javascript' });
                            const objectURL = URL.createObjectURL(blob);
                            const worker = new Worker(objectURL);
                            let workerFailed = false;

                            // Fallback: if the script throws (e.g., uses `document` which Workers lack),
                            // terminate the worker and re-run via main-thread fallback mode.
                            worker.onerror = function(ev) {
                                if (workerFailed) return;
                                workerFailed = true;
                                ev.preventDefault(); // Suppress console error for the re-thrown ReferenceError
                                worker.terminate();
                                URL.revokeObjectURL(objectURL);
                                // Clean up DOM elements created for Worker mode
                                if (canvas && canvas.parentNode) canvas.remove();
                                if (bg && bg.parentNode) bg.remove();
                                // Re-run cleanups registered by the failed worker attempt
                                if (window.owuiCanvasCleanups) {
                                    window.owuiCanvasCleanups.forEach(function(fn) { try { fn(); } catch(x) {} });
                                    window.owuiCanvasCleanups = [];
                                }
                                // Re-create DOM elements and run in fallback mode
                                initCanvas(true); // force fallback
                            };

                            const offscreen = canvas.transferControlToOffscreen();
                            
                            worker.postMessage({ type: 'init', canvas: offscreen, width: window.innerWidth, height: window.innerHeight },[offscreen]);
                            
                            // Throttle mousemove via rAF coalescing — on high-refresh displays,
                            // mousemove fires at 120Hz+. Coalescing to once per animation frame
                            // cuts cross-thread postMessage overhead in half.
                            let _mouseX = -9999, _mouseY = -9999, _mouseDirty = false;
                            const _onMouse = (e) => { _mouseX = e.clientX; _mouseY = e.clientY; _mouseDirty = true; };
                            let _mouseRaf = 0;
                            (function _sendMouse() {
                                _mouseRaf = requestAnimationFrame(_sendMouse);
                                if (_mouseDirty) { worker.postMessage({ type: 'mousemove', x: _mouseX, y: _mouseY }); _mouseDirty = false; }
                            })();

                            // Debounce resize — prevents Worker from re-allocating buffers
                            // dozens of times during a drag-resize.
                            let _resizeTimer = 0;
                            const _onResize = () => {
                                clearTimeout(_resizeTimer);
                                _resizeTimer = setTimeout(() => {
                                    worker.postMessage({ type: 'resize', width: window.innerWidth, height: window.innerHeight });
                                }, 150);
                            };
                            // Bridge: receive forwarded mousemove from child iframes (they can't bubble to parent window)
                            const _onIframeMsg = (e) => { if (e.data && e.data.type === 'owui-canvas-mousemove') { _mouseX = e.data.x; _mouseY = e.data.y; _mouseDirty = true; } };
                            
                            window.addEventListener('mousemove', _onMouse);
                            window.addEventListener('resize', _onResize);
                            window.addEventListener('message', _onIframeMsg);
                            
                            window.owuiCanvasCleanups.push(() => {
                                window.removeEventListener('mousemove', _onMouse);
                                window.removeEventListener('resize', _onResize);
                                window.removeEventListener('message', _onIframeMsg);
                                cancelAnimationFrame(_mouseRaf);
                                clearTimeout(_resizeTimer);
                                worker.terminate();
                                URL.revokeObjectURL(objectURL);
                            });

                            _canvasSend = function(data) { try { worker.postMessage(data); } catch(x) {} };
                        } else {
                            // FALLBACK MODE (Main Thread Fake Worker)
                            const scriptEl = document.createElement('script');
                            scriptEl.id = 'owui-canvas-script-runner';
                            const nonceScript = document.querySelector('script[nonce]');
                            if (nonceScript && nonceScript.nonce) scriptEl.setAttribute('nonce', nonceScript.nonce);
                            
                            scriptEl.textContent = `
                            try {
                                (function() {
                                    const _canvas = document.getElementById('owui-theme-canvas-bg');
                                    if (!_canvas) return;
                                    
                                    // Throttle mousemove via rAF coalescing (same as Worker mode)
                                    let _mouseX = -9999, _mouseY = -9999, _mouseDirty = false;
                                    const _onMouse = (e) => { _mouseX = e.clientX; _mouseY = e.clientY; _mouseDirty = true; };
                                    let _mouseRafId = 0;
                                    (function _pumpMouse() {
                                        _mouseRafId = window.requestAnimationFrame(_pumpMouse);
                                        if (_mouseDirty && window._onmessage) { window._onmessage({ data: { type: 'mousemove', x: _mouseX, y: _mouseY } }); _mouseDirty = false; }
                                    })();

                                    // Debounce resize
                                    let _resizeTimer = 0;
                                    const _onResize = () => {
                                        clearTimeout(_resizeTimer);
                                        _resizeTimer = setTimeout(() => {
                                            _canvas.width = window.innerWidth; _canvas.height = window.innerHeight;
                                            if (window._onmessage) window._onmessage({ data: { type: 'resize', width: window.innerWidth, height: window.innerHeight } });
                                        }, 150);
                                    };
                                    // Bridge: receive forwarded mousemove from child iframes (they can't bubble to parent window)
                                    const _onIframeMsg = (e) => { if (e.data && e.data.type === 'owui-canvas-mousemove') { _mouseX = e.data.x; _mouseY = e.data.y; _mouseDirty = true; } };
                                    
                                    window.addEventListener('mousemove', _onMouse);
                                    window.addEventListener('resize', _onResize);
                                    window.addEventListener('message', _onIframeMsg);
                                    // Trigger initial resize synchronously (no debounce for first paint)
                                    _canvas.width = window.innerWidth; _canvas.height = window.innerHeight;
    
                                    const _rAFs =[];
                                    const _intervals =[];
                                    let _stopped = false;
                                    const requestAnimationFrame = (fn) => { if (_stopped) return -1; const id = window.requestAnimationFrame(fn); _rAFs.push(id); return id; };
                                    const setInterval = (fn, delay) => { if (_stopped) return -1; const id = window.setInterval(fn, delay); _intervals.push(id); return id; };
                                    
                                    let _onmessage = null;
                                    const self = { postMessage: (msg) => {}, set onmessage(fn) { _onmessage = fn; window._onmessage = fn; } };
    
                                    window.owuiCanvasCleanups.push(() => {
                                        _stopped = true;
                                        window.removeEventListener('mousemove', _onMouse);
                                        window.removeEventListener('resize', _onResize);
                                        window.removeEventListener('message', _onIframeMsg);
                                        window.cancelAnimationFrame(_mouseRafId);
                                        clearTimeout(_resizeTimer);
                                        _rAFs.forEach(id => window.cancelAnimationFrame(id));
                                        _intervals.forEach(id => window.clearInterval(id));
                                    });
    
                                    (function() {
                                        let onmessage = null;
                                        ${config.canvasScript}
                                        const finalHandler = onmessage || _onmessage;
                                        if (finalHandler) {
                                            window._onmessage = finalHandler;
                                            finalHandler({ data: { type: 'init', canvas: _canvas, width: window.innerWidth, height: window.innerHeight } });
                                        }
                                    })();
                                })();
                            } catch(e) { console.error('Canvas FX Fallback Error:', e); }`;
                            document.body.appendChild(scriptEl);

                            _canvasSend = function(data) { if (window._onmessage) window._onmessage({ data: data }); };
                        }

                        // Start context observer — sends { type: 'context' } updates
                        // to the Canvas FX script with live chat metrics
                        if (_canvasSend) {
                            var _ctxCleanup = startContextObserver(_canvasSend);
                            window.owuiCanvasCleanups.push(_ctxCleanup);
                        }
                    } else {
                        lastCanvasScript = "_DISABLED_";
                        lastCanvasWasEnabled = false;
                    }
                } catch(e) {
                    lastCanvasScript = "_DISABLED_";
                    lastCanvasWasEnabled = false;
                }
            }
            
            function refresh() { if (_disabled) return; enforceTheme(); initCanvas(); }

            refresh();
            
            const observer = new MutationObserver((mutations) => {
                let trigger = false;
                if (!document.getElementById('owui-dev-live-theme') &&
                    (document.getElementById('owui-server-theme') || _owuiThemeCss || _owuiThemeState || localStorage.getItem('owui_dev_theme_v1_css'))) {
                    trigger = true;
                }
                mutations.forEach(m => {
                    if (m.type === 'attributes' && (m.attributeName === 'class' || m.attributeName === 'data-theme')) {
                        trigger = true;
                    }
                });
                if (trigger) refresh();
            });
            
            observer.observe(document.documentElement, { attributes: true, attributeFilter:['class', 'data-theme'] });
            if (document.head) observer.observe(document.head, { childList: true });
            
            window.addEventListener('storage', (e) => {
                const triggerKeys =['theme', 'owui_dev_theme_v1_css', 'owui_dev_theme_v1'];
                if (triggerKeys.includes(e.key) && e.newValue) {
                    if (e.key === 'theme') {
                        document.documentElement.setAttribute('data-theme', e.newValue);
                    }
                    refresh();
                }
            });

            window.addEventListener('popstate', refresh);
            window.addEventListener('owui-theme-updated', function(e) {
                // Designer passes theme state and CSS directly via CustomEvent.detail
                // so draft-mode updates work (sessionStorage is invisible to bootloader)
                if (e.detail && e.detail.state) _owuiThemeState = e.detail.state;
                if (e.detail && e.detail.css) _owuiThemeCss = e.detail.css;
                refresh();
            });
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refresh);

            // Patch history for SPA navigation
            const _pushState = history.pushState;
            history.pushState = function() { _pushState.apply(this, arguments); refresh(); };
            const _replaceState = history.replaceState;
            history.replaceState = function() { _replaceState.apply(this, arguments); refresh(); };

            // Live theme push via Server-Sent Events (cross-tab/browser/device)
            if (!window.__THEME_DESIGNER__) {
                try {
                    var es = new EventSource('__THEME_ROUTE__/events');
                    es.addEventListener('theme-update', function(e) {
                        _disabled = false;  // Re-enable if admin turned it back on
                        try {
                            var d = JSON.parse(e.data);
                            // 1. Update in-memory state and CSS (primary source for canvas + enforce)
                            if (d.css) _owuiThemeCss = d.css;
                            if (d.state) _owuiThemeState = d.state;
                            // 2. Write-through to localStorage (Watchtower recovery fallback)
                            try {
                                if (d.css) localStorage.setItem('owui_dev_theme_v1_css', d.css);
                                if (d.state) localStorage.setItem('owui_dev_theme_v1', d.state);
                            } catch(x) {} // Quota exceeded is non-fatal
                        } catch(x) {}
                        // 3. Refresh DOM and canvas
                        refresh();
                    });
                    es.addEventListener('theme-disable', function() {
                        // Admin disabled or reset — set disable flag, clear state, strip DOM
                        _disabled = true;
                        _owuiThemeState = null;
                        _owuiThemeCss = null;
                        // Clean up canvas resources (Worker, event listeners, rAF loops)
                        if (window.owuiCanvasCleanups) {
                            window.owuiCanvasCleanups.forEach(function(fn) { try { fn(); } catch(x) {} });
                            window.owuiCanvasCleanups = [];
                        }
                        try {
                            ['owui_dev_theme_v1_css', 'owui_dev_theme_v1'].forEach(function(k) {
                                localStorage.removeItem(k);
                            });
                        } catch(x) {}
                        // Remove ALL injected elements (styles, canvas, bg, script runner)
                        ['owui-dev-live-theme', 'owui-server-theme', 'owui-theme-style',
                         'owui-theme-canvas-bg', 'owui-theme-bg-color', 'owui-canvas-script-runner'
                        ].forEach(function(id) {
                            var el = document.getElementById(id);
                            if (el) el.remove();
                        });
                        // NOTE: SSE stays open — if admin re-enables, theme-update will re-apply
                    });
                    es.onerror = function() { /* EventSource auto-reconnects */ };
                    // Free the HTTP/1.1 connection slot before the new page starts loading —
                    // prevents NetworkError in Open WebUI's ModelSelector caused by
                    // connection pool exhaustion (6 per-domain limit) during refresh.
                    window.addEventListener('beforeunload', function() { es.close(); });
                } catch(e) { console.warn('Theme Pro SSE:', e); }
            }

            // Safety net: MutationObserver (L356) handles SPA element removal.
            // SSE (above) handles live updates. No polling timer needed.
        } catch(e) { console.warn('Theme Pro:', e); }
    })();
    </script>
"""

    def __init__(self):
        self.valves = self.Valves()

    # -- URL validation -------------------------------------------------------

    def _get_route_base(self) -> str:
        """Return the validated designer URL, auto-correcting if needed."""
        route = self.valves.designer_url.rstrip("/")
        if not route.startswith("/api/v1/"):
            corrected = "/api/v1" + (route if route.startswith("/") else "/" + route)
            log.warning(
                "[Theme Pro] designer_url '%s' is outside /api/v1/ — "
                "auto-correcting to '%s' (SPA catch-all intercepts non-API routes)",
                route,
                corrected,
            )
            return corrected
        return route

    # -- bootloader management -----------------------------------------------

    def _strip_bootloader(self, content: str) -> str:
        """Remove ALL existing bootloader instances from content string.

        Uses a while loop (not if) so that accumulated duplicates —
        e.g. from previous bugs or interrupted writes — are fully
        stripped before re-injection.
        """
        start_marker = "<!-- OWUI Theme Pro Bootloader -->"
        end_marker = "</script>"
        while start_marker in content:
            start_idx = content.find(start_marker)
            end_idx = content.find(end_marker, start_idx)
            if end_idx == -1:
                break
            end_idx += len(end_marker)
            if end_idx < len(content) and content[end_idx] == "\n":
                end_idx += 1
            content = content[:start_idx] + content[end_idx:]
        return content

    def _find_index_file(self):
        """Find the frontend index.html served by SPAStaticFiles."""
        # Use the authoritative FRONTEND_BUILD_DIR from Open WebUI config
        try:
            from open_webui.env import FRONTEND_BUILD_DIR

            idx = Path(FRONTEND_BUILD_DIR) / "index.html"
            if idx.exists():
                return str(idx)
        except ImportError:
            pass

        # Fallback: guess common paths
        fallbacks = [
            "/app/backend/open_webui/frontend/index.html",
            "/app/build/index.html",
            "../build/index.html",
            "./build/index.html",
        ]
        for path in fallbacks:
            if os.path.exists(path):
                return path
        return None

    # File-based lock to serialize all index.html read-modify-write operations
    # across processes/workers. threading.Lock only protects within a single process,
    # but Open WebUI fires event() from multiple concurrent contexts during startup.
    _index_lock_path = None  # Set lazily on first use

    @classmethod
    def _get_index_lock(cls):
        """Return a context manager that acquires an exclusive file lock."""
        import fcntl
        from contextlib import contextmanager

        @contextmanager
        def _flock():
            if cls._index_lock_path is None:
                try:
                    from open_webui.env import DATA_DIR
                    cls._index_lock_path = Path(DATA_DIR) / "theme" / ".index.lock"
                except ImportError:
                    cls._index_lock_path = Path("/tmp/.owui_index.lock")
                cls._index_lock_path.parent.mkdir(parents=True, exist_ok=True)
            fd = open(cls._index_lock_path, "w")
            try:
                fcntl.flock(fd, fcntl.LOCK_EX)
                yield
            finally:
                fcntl.flock(fd, fcntl.LOCK_UN)
                fd.close()

        return _flock()

    def _inject_bootloader(self):
        """Inject the theme bootloader into index.html."""
        path = self._find_index_file()
        if not path:
            return

        try:
            with Event._get_index_lock():
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read()

                content = self._strip_bootloader(content)

                if "owui-theme-bootloader" not in content:
                    if "</head>" in content:
                        new_content = content.replace(
                            "</head>", self._get_bootloader_script() + "</head>"
                        )
                        with open(path, "w", encoding="utf-8") as f:
                            f.write(new_content)
                        log.info(
                            "[Theme Pro] Successfully injected bootloader into %s", path
                        )
        except Exception as e:
            log.warning("[Theme Pro] Error injecting bootloader into %s: %s", path, e)

    def _get_bootloader_script(self) -> str:
        """Return the bootloader script with the correct route URL substituted."""
        return self.BOOTLOADER_SCRIPT.replace("__THEME_ROUTE__", self._get_route_base())

    # -- CSS file persistence ------------------------------------------------

    def _get_css_path(self) -> Path:
        """Return the path to the persisted theme CSS file."""
        try:
            from open_webui.env import DATA_DIR

            css_dir = Path(DATA_DIR) / "theme"
        except ImportError:
            css_dir = Path("/app/backend/data/theme")
        css_dir.mkdir(parents=True, exist_ok=True)
        return css_dir / CSS_FILE_NAME

    def _save_css(self, css: str) -> None:
        """Write theme CSS to disk."""
        path = self._get_css_path()
        path.write_text(css, encoding="utf-8")
        log.info("[Theme Pro] Saved theme CSS to %s (%d bytes)", path, len(css))

    def _load_css(self) -> str | None:
        """Read theme CSS from disk, or None if not found."""
        path = self._get_css_path()
        if path.exists():
            return path.read_text(encoding="utf-8")
        return None

    def _get_state_path(self) -> Path:
        """Return the path to the persisted theme state JSON file."""
        return self._get_css_path().with_name("open_theme_designer.json")

    def _save_state(self, state: str) -> None:
        """Write theme state JSON to disk."""
        path = self._get_state_path()
        path.write_text(state, encoding="utf-8")
        log.info("[Theme Pro] Saved theme state to %s (%d bytes)", path, len(state))

    def _load_state(self) -> str | None:
        """Read theme state JSON from disk, or None if not found."""
        path = self._get_state_path()
        if path.exists():
            return path.read_text(encoding="utf-8")
        return None

    def _get_library_path(self) -> Path:
        """Return the path to the persisted preset/snapshot library file."""
        return self._get_css_path().with_name("open_theme_designer_library.json")

    def _save_library(self, library: str) -> None:
        """Write preset/snapshot library JSON to disk."""
        path = self._get_library_path()
        path.write_text(library, encoding="utf-8")
        log.info("[Theme Pro] Saved library to %s (%d bytes)", path, len(library))

    def _load_library(self) -> str | None:
        """Read preset/snapshot library JSON from disk, or None if not found."""
        path = self._get_library_path()
        if path.exists():
            return path.read_text(encoding="utf-8")
        return None

    def _inject_theme_css(self) -> None:
        """Inject the saved theme CSS into index.html as an inline <style>.

        Strips the STRUCTURAL section (transparency rules for canvas/gradient)
        from the inline version — those rules make everything transparent, which
        causes a white flash before the canvas script loads. The bootloader
        applies the full CSS after canvas is ready.
        """
        css = self._load_css()
        if not css:
            return

        path = self._find_index_file()
        if not path:
            return

        # Strip structural transparency rules — they need canvas/gradient to be
        # running first, which the bootloader handles after async fetch.
        import re

        safe_css = re.sub(
            r"/\*\[OWUI_STRUCTURAL_START\]\*/.*?/\*\[OWUI_STRUCTURAL_END\]\*/",
            "/* structural rules deferred to bootloader */",
            css,
            flags=re.DOTALL,
        )
        safe_css = re.sub(
            r"/\*\[OWUI_GRADIENT_START\]\*/.*?/\*\[OWUI_GRADIENT_END\]\*/",
            "/* gradient rules deferred to bootloader */",
            safe_css,
            flags=re.DOTALL,
        )

        STYLE_ID = "owui-server-theme"
        START_MARKER = f'<style id="{STYLE_ID}">'
        END_MARKER = "</style><!-- /owui-server-theme -->"

        try:
            with Event._get_index_lock():
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read()

                # Strip ALL existing server theme blocks (not just the first —
                # previous bugs could have left duplicates that would accumulate)
                while START_MARKER in content:
                    start = content.find(START_MARKER)
                    end = content.find(END_MARKER, start)
                    if end == -1:
                        break
                    end += len(END_MARKER)
                    if end < len(content) and content[end] == "\n":
                        end += 1
                    content = content[:start] + content[end:]

                # Also strip ALL existing state JSON blocks
                STATE_START = '<script type="application/json" id="owui-theme-state">'
                STATE_END = "</script><!-- /owui-theme-state -->"
                while STATE_START in content:
                    s_start = content.find(STATE_START)
                    s_end = content.find(STATE_END, s_start)
                    if s_end == -1:
                        break
                    s_end += len(STATE_END)
                    if s_end < len(content) and content[s_end] == "\n":
                        s_end += 1
                    content = content[:s_start] + content[s_end:]

                style_block = f"{START_MARKER}\n{safe_css}\n{END_MARKER}\n"

                # Also embed state JSON for FOUC-free canvas init (no async fetch needed)
                state_json = self._load_state() or "{}"
                # Enforce Canvas FX valve: strip canvas data so remote clients can't see it
                if not self.valves.enable_canvas_fx:
                    state_json = self._strip_canvas_from_state(state_json)
                state_block = f"{STATE_START}{state_json}{STATE_END}\n"

                if "</head>" in content:
                    inject_block = style_block + state_block
                    new_content = content.replace("</head>", inject_block + "</head>")
                    with open(path, "w", encoding="utf-8") as f:
                        f.write(new_content)
                    log.info("[Theme Pro] Injected server theme CSS + state into %s", path)
        except Exception as e:
            log.warning("[Theme Pro] Error injecting theme CSS into %s: %s", path, e)

    def _strip_theme_css_from_index(self) -> None:
        """Remove the server theme CSS and state JSON blocks from index.html."""
        path = self._find_index_file()
        if not path:
            return

        try:
            with Event._get_index_lock():
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read()

                changed = False

                # Strip ALL CSS blocks (while loop handles accumulated duplicates)
                CSS_START = '<style id="owui-server-theme">'
                CSS_END = "</style><!-- /owui-server-theme -->"
                while CSS_START in content:
                    start = content.find(CSS_START)
                    end = content.find(CSS_END, start)
                    if end == -1:
                        break
                    end += len(CSS_END)
                    if end < len(content) and content[end] == "\n":
                        end += 1
                    content = content[:start] + content[end:]
                    changed = True

                # Strip ALL state JSON blocks
                STATE_START = '<script type="application/json" id="owui-theme-state">'
                STATE_END = "</script><!-- /owui-theme-state -->"
                while STATE_START in content:
                    start = content.find(STATE_START)
                    end = content.find(STATE_END, start)
                    if end == -1:
                        break
                    end += len(STATE_END)
                    if end < len(content) and content[end] == "\n":
                        end += 1
                    content = content[:start] + content[end:]
                    changed = True

                if changed:
                    with open(path, "w", encoding="utf-8") as f:
                        f.write(content)
                    log.info("[Theme Pro] Stripped server theme assets from %s", path)
        except Exception as e:
            log.warning("[Theme Pro] Error stripping theme assets from %s: %s", path, e)

    # -- route registration --------------------------------------------------

    @staticmethod
    async def _require_admin(request) -> bool:
        """Manual admin auth check — bypasses FastAPI DI which fails in APIRoute closures."""
        from starlette.responses import JSONResponse

        try:
            from open_webui.utils.auth import decode_token
            from open_webui.models.users import Users
        except ImportError:
            return JSONResponse(
                {"error": "Auth modules unavailable — access denied"},
                status_code=503,
            )

        token = None
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:]
        if token is None:
            token = request.cookies.get("token")
        if hasattr(request.state, "token") and request.state.token:
            token = token or request.state.token.credentials

        if not token:
            return JSONResponse({"error": "Not authenticated"}, status_code=401)

        try:
            data = decode_token(token)
        except Exception:
            return JSONResponse({"error": "Invalid token"}, status_code=401)
        if not data or "id" not in data:
            return JSONResponse({"error": "Invalid token"}, status_code=401)

        user = await Users.get_user_by_id(data["id"])
        if not user or user.role != "admin":
            return JSONResponse({"error": "Admin access required"}, status_code=403)

        return True  # Auth passed

    def _register_route(self, app) -> None:
        """Register theme designer routes before the SPA catch-all mount.

        Routes registered:
          GET  /api/v1/theme-designer           → Admin-only designer SPA
          POST /api/v1/theme-designer           → Admin-only CSS save
          GET  /api/v1/theme-designer/theme.css → Public theme CSS (for bootloader)
        """
        from starlette.routing import Mount

        route_base = self._get_route_base()

        # Reset injection flag on route registration (happens on every hot reload).
        # This ensures event() re-runs the injection cycle after a function re-save,
        # which is needed to clean up any stale duplicate blocks from previous bugs.
        Event._injected = False

        # Persist SSE client list on app.state so it survives function re-saves/hot-reloads.
        # When the module is reloaded, Event._sse_clients resets to [], but app.state persists.
        # Re-aliasing ensures broadcast methods push to ALL clients (including pre-reload ones).
        if not hasattr(app.state, "_theme_sse_clients"):
            app.state._theme_sse_clients = []
        Event._sse_clients = app.state._theme_sse_clients

        # Remove stale routes from previous function load so new handlers take effect
        # Clean up default, current, AND previous paths to ensure only one URL is active
        stale_paths = set()
        paths_to_clean = [ROUTE_PATH, route_base]
        if Event._last_designer_url:
            paths_to_clean.append(Event._last_designer_url.rstrip("/"))
        for path in paths_to_clean:
            stale_paths.update(
                {
                    path,
                    path + "/theme.css",
                    path + "/state.json",
                    path + "/events",
                    path + "/library.json",
                }
            )
        app.routes[:] = [
            r for r in app.routes if getattr(r, "path", "") not in stale_paths
        ]

        event_instance = self

        from starlette.requests import Request
        from starlette.responses import HTMLResponse, JSONResponse, PlainTextResponse
        from starlette.routing import Route

        # -- GET /api/v1/theme-designer (admin only) -------------------------

        async def theme_designer_page(request: Request):
            auth = await event_instance._require_admin(request)
            if auth is not True:
                return auth  # Returns the JSONResponse error
            return HTMLResponse(
                content=event_instance._build_html(),
                headers={"Cache-Control": "no-store"},
            )

        # -- POST /api/v1/theme-designer (admin only) ------------------------

        async def save_theme_css(request: Request):
            auth = await event_instance._require_admin(request)
            if auth is not True:
                return auth
            return await event_instance._handle_css_save(request)

        # -- GET /api/v1/theme-designer/theme.css (public — CSS is visual) ---

        CSS_ROUTE = route_base + "/theme.css"

        async def serve_theme_css(request: Request):
            """Serve the saved theme CSS file. No auth — themes are visual."""
            if not event_instance.valves.theme_active:
                return PlainTextResponse("", media_type="text/css", status_code=204)
            css = event_instance._load_css()
            if css:
                return PlainTextResponse(
                    content=css,
                    media_type="text/css",
                    headers={"Cache-Control": "no-cache, must-revalidate"},
                )
            return PlainTextResponse("", media_type="text/css", status_code=204)

        # -- GET /api/v1/theme-designer/state.json (public — for canvas FX) ---

        STATE_ROUTE = route_base + "/state.json"

        async def serve_theme_state(request: Request):
            """Serve the saved theme state JSON. No auth — for bootloader seeding."""
            if not event_instance.valves.theme_active:
                return PlainTextResponse(
                    "{}", media_type="application/json", status_code=204
                )
            state = event_instance._load_state()
            if state:
                # Enforce Canvas FX valve: strip canvas data from served state
                if not event_instance.valves.enable_canvas_fx:
                    state = event_instance._strip_canvas_from_state(state)
                return PlainTextResponse(
                    content=state,
                    media_type="application/json",
                    headers={"Cache-Control": "no-cache, must-revalidate"},
                )
            return PlainTextResponse(
                "{}", media_type="application/json", status_code=204
            )

        # -- GET /api/v1/theme-designer/events (SSE — live push to all clients) --

        SSE_ROUTE = route_base + "/events"

        async def theme_sse(request: Request):
            """Server-Sent Events endpoint for live theme updates."""
            from starlette.responses import StreamingResponse

            queue = asyncio.Queue(maxsize=8)
            Event._sse_clients.append(queue)

            async def event_stream():
                try:
                    yield "retry: 3000\n\n"  # Auto-reconnect after 3s
                    while True:
                        try:
                            msg = await asyncio.wait_for(queue.get(), timeout=30)
                            yield msg  # Pre-formatted SSE string
                        except asyncio.TimeoutError:
                            yield ": heartbeat\n\n"  # Keep-alive ping
                except (asyncio.CancelledError, GeneratorExit):
                    pass
                finally:
                    if queue in Event._sse_clients:
                        Event._sse_clients.remove(queue)

            return StreamingResponse(
                event_stream(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",  # Disable nginx buffering
                },
            )

        get_route = Route(route_base, theme_designer_page, methods=["GET"])
        post_route = Route(route_base, save_theme_css, methods=["POST"])
        css_route = Route(CSS_ROUTE, serve_theme_css, methods=["GET"])
        state_route = Route(STATE_ROUTE, serve_theme_state, methods=["GET"])
        sse_route = Route(SSE_ROUTE, theme_sse, methods=["GET"])

        LIBRARY_ROUTE = f"{route_base}/library.json"

        async def serve_theme_library(request):
            """Serve saved preset/snapshot library JSON (admin only)."""
            auth = await Event._require_admin(request)
            if auth is not True:
                return auth
            library = self._load_library()
            if library:
                return PlainTextResponse(library, media_type="application/json")
            return PlainTextResponse("{}", media_type="application/json")

        library_route = Route(LIBRARY_ROUTE, serve_theme_library, methods=["GET"])

        # Find the SPA catch-all mount and insert before it
        spa_idx = len(app.routes)
        for i, r in enumerate(app.routes):
            if isinstance(r, Mount) and getattr(r, "name", "") == "spa-static-files":
                spa_idx = i
                break

        app.routes.insert(spa_idx, get_route)
        app.routes.insert(spa_idx + 1, post_route)
        app.routes.insert(spa_idx + 2, css_route)
        app.routes.insert(spa_idx + 3, state_route)
        app.routes.insert(spa_idx + 4, sse_route)
        app.routes.insert(spa_idx + 5, library_route)
        log.info(
            "[Theme Pro] Registered routes at %s (position %d)", route_base, spa_idx
        )

    async def _handle_css_save(self, request) -> "JSONResponse":
        """Handle POST to save or reset theme CSS + state."""
        from starlette.responses import JSONResponse

        try:
            body = await request.json()
            css = body.get("css", "")
            state = body.get("state", "")
            is_reset = body.get("reset", False)

            if is_reset:
                path = self._get_css_path()
                if path.exists():
                    path.unlink()
                    log.info("[Theme Pro] Deleted theme CSS file")
                state_path = self._get_state_path()
                if state_path.exists():
                    state_path.unlink()
                    log.info("[Theme Pro] Deleted theme state file")
                library_path = self._get_library_path()
                if library_path.exists():
                    library_path.unlink()
                    log.info("[Theme Pro] Deleted theme library file")
                self._strip_theme_css_from_index()
                # Also strip bootloader on full reset
                idx = self._find_index_file()
                if idx:
                    with Event._get_index_lock():
                        with open(idx, "r", encoding="utf-8") as f:
                            content = f.read()
                        cleaned = self._strip_bootloader(content)
                        if cleaned != content:
                            with open(idx, "w", encoding="utf-8") as f:
                                f.write(cleaned)
                            log.info("[Theme Pro] Stripped bootloader on reset")
                Event._broadcast_disable()  # Push disable to all SSE clients (strip + reload)
                return JSONResponse({"status": "reset"})

            # Library-only sync (no CSS/state to save — e.g., draft mode preset import)
            if not css:
                library = body.get("library", "")
                if library and isinstance(library, str):
                    self._save_library(library)
                    return JSONResponse({"status": "ok", "library_only": True})
                return JSONResponse({"status": "ok", "noop": True})

            if not isinstance(css, str):
                return JSONResponse({"error": "css must be a string"}, status_code=400)

            self._save_css(css)
            if state and isinstance(state, str):
                self._save_state(state)

            # Save library data if provided (presets, snapshots)
            library = body.get("library", "")
            if library and isinstance(library, str):
                self._save_library(library)

            # Only inject bootloader + broadcast if theme is active
            # Check BOTH the client-sent flag (reliable — set at page render) AND the instance valve (defense-in-depth)
            suppress = body.get("suppress_broadcast", False)
            should_broadcast = (not suppress) and self.valves.theme_active
            if should_broadcast:
                # NOTE: index.html injection is handled by event() on startup/valve change.
                # The POST handler only broadcasts via SSE for live updates — no need to
                # rewrite index.html on every slider adjustment (was causing disk thrash
                # and duplicate block accumulation).
                # Enforce Canvas FX valve: strip canvas data from SSE broadcast
                broadcast_state = state if isinstance(state, str) else ""
                if broadcast_state and not self.valves.enable_canvas_fx:
                    broadcast_state = self._strip_canvas_from_state(broadcast_state)
                Event._broadcast_update(css, broadcast_state)

            return JSONResponse(
                {"status": "ok", "bytes": len(css), "theme_active": should_broadcast}
            )
        except Exception as e:
            log.exception("[Theme Pro] Error saving CSS")
            return JSONResponse({"error": str(e)}, status_code=500)

    # -- HTML assembly -------------------------------------------------------

    def _build_html(self) -> str:
        """Assemble the full Theme Designer HTML with current valve config."""
        html_content = r"""<!DOCTYPE html>
<html lang="en" id="tool-html">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Theme Designer Pro</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono&display=swap" rel="stylesheet">
    <style>
        :root {
            --accent: #3b82f6;
            --bg-deep: oklch(0.20 0 0);
            --bg-surface: oklch(0.24 0 0);
            --bg-elevated: oklch(0.28 0 0);
            --border: #3f3f46;
            --text-main: #f4f4f5;
            --text-muted: #a1a1aa;
            --radius-lg: 20px;
            --radius-md: 14px;
            --color-danger: #ef4444;
            --color-danger-hover: #dc2626;
            --color-success: #22c55e;
            --bg-control-light: #fafafa;
        }

        * { box-sizing: border-box; -webkit-font-smoothing: antialiased; transition: background-color 0.3s, border-color 0.3s, color 0.3s; }
        
        body { 
            font-family: 'Inter', sans-serif;
            background-color: var(--bg-deep); 
            color: var(--text-main); 
            margin: 0; 
            padding: 0;
            display: flex;
            flex-direction: column;
            overflow-x: hidden;
            min-height: 100vh;
            isolation: isolate;
        }

        /* LIGHT MODE OVERRIDES FOR TOOL UI */
        body.light-mode {
            --bg-deep: #f4f4f5;
            --bg-surface: #ffffff;
            --bg-elevated: #e4e4e7;
            --border: #d4d4d8;
            --text-main: #18181b;
            --text-muted: #52525b;
            --lm-shadow: rgba(0,0,0,0.1);
            --lm-border-subtle: rgba(0,0,0,0.05);
            --lm-bg-tint: rgba(0,0,0,0.02);
            --lm-bg-hover: rgba(0,0,0,0.15);
            --lm-locked-bg: #eff6ff;
        }
        body.light-mode .container { background: var(--bg-surface); }
        body.light-mode .header { background: transparent; }
        body.light-mode .tabs { background: var(--bg-deep); border-color: var(--border); }
        body.light-mode .tab.active { background: var(--bg-surface); box-shadow: 0 4px 12px var(--lm-shadow); color: var(--accent); }
        body.light-mode .mode-toggle { background: var(--bg-deep); border-color: var(--border); }
        body.light-mode .mode-btn.active { background: var(--bg-surface); box-shadow: 0 4px 12px var(--lm-shadow); border-color: var(--lm-border-subtle); color: var(--accent); }
        body.light-mode .control-group { background: var(--bg-control-light); border-color: var(--border); }
        body.light-mode input[type="range"] { background: var(--border); }
        body.light-mode input[type="range"]::-webkit-slider-thumb { border-color: var(--accent); background: white; }
        body.light-mode .preset-btn { background: var(--bg-surface); border-color: var(--border); }
        body.light-mode .btn { background: var(--bg-surface); color: var(--text-main); border-color: var(--border); }
        body.light-mode .btn:hover { background: var(--bg-deep); }
        body.light-mode .btn-primary { background: var(--accent); color: white; border-color: var(--accent); }
        body.light-mode .btn-primary:hover { background: #2563eb; }
        body.light-mode .var-item { background: var(--bg-surface); border-color: var(--lm-border-subtle); }
        body.light-mode .var-item.is-locked { border-color: var(--accent); background: var(--lm-locked-bg) !important; }
        body.light-mode .doc-code-inline { background: rgba(0,0,0,0.06); }
        body.light-mode .modal-overlay > div { background: var(--bg-surface); }
        body.light-mode input[type="text"] { background: var(--bg-surface) !important; color: var(--text-main) !important; border-color: var(--border) !important; }
        body.light-mode .preset-btn:hover { box-shadow: 0 10px 20px -5px var(--lm-shadow); }
        body.light-mode .footer { background: transparent; border-color: transparent; }
        body.light-mode .curated-scroll-container::-webkit-scrollbar-track { background: var(--lm-border-subtle); }
        body.light-mode .curated-scroll-container::-webkit-scrollbar-thumb { background: var(--lm-bg-hover); }
        body.light-mode .curated-scroll-container::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.25); }
        body.light-mode .var-action-btn { background: var(--lm-border-subtle); border-color: var(--lm-shadow); color: var(--text-main); }
        body.light-mode .var-action-btn:hover { background: var(--accent); border-color: var(--accent); color: white; }
        body.light-mode .owui-tooltip { background: var(--bg-surface); color: var(--text-main); border: 1px solid var(--lm-shadow); box-shadow: 0 8px 16px var(--lm-shadow); }
        body.light-mode .owui-tooltip .tt-name { color: var(--text-main); }
        body.light-mode .owui-tooltip .tt-author { color: var(--text-muted); }
        body.light-mode .owui-tooltip .tt-desc { color: var(--text-main); }
        body.light-mode .owui-tooltip .tt-version { background: rgba(99, 102, 241, 0.12); color: #6366f1; border-color: rgba(99, 102, 241, 0.2); }
        body.light-mode .tag-filter-dropdown { background: var(--bg-surface); border-color: var(--lm-shadow); box-shadow: 0 12px 32px var(--lm-shadow); }
        body.light-mode .tag-filter-option:hover { background: rgba(0,0,0,0.04); }

        /* HIGH LIGHTNESS / WASHED OUT OVERRIDES */
        body#tool-body.washed-out input[type="range"] { background: var(--lm-bg-hover); }
        body#tool-body.washed-out .preset-btn:hover { box-shadow: 0 10px 20px -5px var(--lm-shadow); }
        body#tool-body.washed-out .var-item.is-locked { background: var(--lm-locked-bg) !important; }
        body#tool-body.washed-out .btn-danger { color: #dc2626 !important; border-color: rgba(220, 38, 38, 0.3) !important; }
        body#tool-body.washed-out .var-action-btn { background: var(--lm-border-subtle); border-color: var(--lm-shadow); color: var(--text-main); }
        body#tool-body.washed-out .var-action-btn:hover { background: var(--accent); border-color: var(--accent); color: white; }

        /* NATIVE-LIKE TOOLTIP */
        .owui-tooltip { position: absolute; background: #18181b; color: #f4f4f5; padding: 6px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 500; pointer-events: none; z-index: 100000; opacity: 0; transform: translateY(4px); transition: opacity 0.15s ease, transform 0.15s ease; white-space: nowrap; font-family: 'Inter', sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05); }
        .owui-tooltip.visible { opacity: 1; transform: translateY(0); }
        .owui-tooltip.rich { white-space: normal; padding: 10px 14px; max-width: 280px; display: flex; flex-direction: column; gap: 5px; }
        .owui-tooltip .tt-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .owui-tooltip .tt-name { font-weight: 700; font-size: 0.78rem; color: #ffffff; }
        .owui-tooltip .tt-version { font-size: 0.55rem; font-weight: 600; background: rgba(99, 102, 241, 0.25); color: #a5b4fc; padding: 1px 6px; border-radius: 8px; border: 1px solid rgba(99, 102, 241, 0.3); letter-spacing: 0.02em; }
        .owui-tooltip .tt-author { font-size: 0.65rem; color: #a1a1aa; }
        .owui-tooltip .tt-desc { font-size: 0.65rem; color: #d4d4d8; font-style: italic; line-height: 1.3; }
        .owui-tooltip .tt-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
        .owui-tooltip .tt-tag { font-size: 0.55rem; font-weight: 600; padding: 1px 6px; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.04em; }
        .owui-tooltip .tt-tag-css { background: rgba(16, 185, 129, 0.2); color: #6ee7b7; border: 1px solid rgba(16, 185, 129, 0.3); }
        .owui-tooltip .tt-tag-canvas { background: rgba(251, 146, 60, 0.2); color: #fdba74; border: 1px solid rgba(251, 146, 60, 0.3); }
        .owui-tooltip .tt-tag-overrides { background: rgba(147, 51, 234, 0.2); color: #c4b5fd; border: 1px solid rgba(147, 51, 234, 0.3); }
        .owui-tooltip .tt-tag-url { background: rgba(6, 182, 212, 0.2); color: #67e8f9; border: 1px solid rgba(6, 182, 212, 0.3); }
        .owui-tooltip .tt-tag-gradient { background: rgba(244, 114, 182, 0.2); color: #f9a8d4; border: 1px solid rgba(244, 114, 182, 0.3); }

        /* TAG FILTER DROPDOWN */
        .tag-filter-wrap { position: relative; }
        .tag-filter-dropdown { display: none; position: absolute; top: calc(100% + 6px); right: 0; background: var(--bg-deep); border: 1px solid var(--border); border-radius: 10px; min-width: 160px; z-index: 9999; box-shadow: 0 12px 32px rgba(0,0,0,0.45); padding: 4px; overflow: hidden; animation: tagDropIn 0.15s ease; }
        .tag-filter-dropdown.open { display: block; }
        @keyframes tagDropIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        .tag-filter-option { display: flex; align-items: center; gap: 8px; padding: 7px 12px; font-size: 0.68rem; font-weight: 500; color: var(--text-muted); cursor: pointer; border-radius: 7px; transition: background 0.15s, color 0.15s; border: none; background: transparent; width: 100%; text-align: left; font-family: inherit; }
        .tag-filter-option:hover { background: rgba(255,255,255,0.06); color: var(--text-main); }
        .tag-filter-option.active { color: var(--text-main); background: rgba(99, 102, 241, 0.1); }
        .tag-filter-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .tag-filter-dot-all { background: var(--text-muted); }
        .tag-filter-dot-css { background: #6ee7b7; }
        .tag-filter-dot-canvas { background: #fdba74; }
        .tag-filter-dot-overrides { background: #c4b5fd; }
        .tag-filter-dot-linked { background: #67e8f9; }
        .tag-filter-dot-gradient { background: #f472b6; }
        .tag-filter-btn.has-filter { color: var(--accent); }
        .tag-filter-dot-linear { background: #60a5fa; }
        .tag-filter-dot-radial { background: #f472b6; }
        .tag-filter-dot-mesh { background: #a78bfa; }
        .sort-btn .sort-icon { display: none; }
        .sort-btn[data-sort="default"] .sort-icon-default { display: block; }
        .sort-btn[data-sort="asc"] .sort-icon-asc { display: block; }
        .sort-btn[data-sort="desc"] .sort-icon-desc { display: block; }

        /* === GRADIENT BUILDER === */
        .gradient-preview-bar { width: 100%; height: 48px; border-radius: 14px; border: 1px solid var(--border); background: var(--bg-deep); position: relative; overflow: hidden; transition: 0.3s; cursor: crosshair; }
        .gradient-preview-bar.empty { background: repeating-conic-gradient(var(--bg-elevated) 0% 25%, var(--bg-deep) 0% 50%) 50% / 16px 16px; cursor: default; }
        .gradient-type-pills { display: flex; gap: 4px; background: var(--bg-deep); padding: 3px; border-radius: 10px; border: 1px solid var(--border); }
        .gradient-type-pill { flex: 1; padding: 7px 10px; border-radius: 7px; border: none; background: transparent; color: var(--text-muted); font-size: 0.68rem; font-weight: 700; cursor: pointer; transition: 0.2s; text-align: center; font-family: inherit; }
        .gradient-type-pill.active { background: var(--bg-elevated); color: var(--text-main); box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
        body.light-mode .gradient-type-pill.active { background: var(--bg-surface); box-shadow: 0 4px 12px var(--lm-shadow); }
        .gradient-stops-list { display: flex; flex-direction: column; gap: 8px; position: relative; }
        .gradient-stop-row { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: var(--bg-deep); border: 1px solid var(--border); border-radius: 12px; transition: background 0.2s, border-color 0.2s, opacity 0.2s; user-select: none; }
        .gradient-stop-row:hover { border-color: var(--accent); }
        .gradient-stop-row.dragging-src { opacity: 0.3; }
        .gradient-drag-handle { display: flex; align-items: center; justify-content: center; cursor: grab; color: var(--text-muted); opacity: 0.4; transition: opacity 0.15s, color 0.15s; flex-shrink: 0; padding: 2px 0; touch-action: none; }
        .gradient-drag-handle:hover { opacity: 1; color: var(--accent); }
        .gradient-drag-handle:active { cursor: grabbing; }
        .gradient-drag-handle svg { pointer-events: none; }
        .gradient-drop-indicator { position: absolute; left: 8px; right: 8px; height: 2px; background: var(--accent); border-radius: 1px; pointer-events: none; z-index: 10; box-shadow: 0 0 6px var(--accent); transition: top 0.1s ease; }
        .gradient-drag-ghost { position: fixed; pointer-events: none; z-index: 99999; opacity: 0.85; border-radius: 12px; border: 1.5px solid var(--accent); box-shadow: 0 8px 24px rgba(0,0,0,0.4); transform: scale(1.02); }
        .gradient-stop-swatch { width: 38px; height: 38px; border-radius: 10px; border: 2px solid rgba(255,255,255,0.1); flex-shrink: 0; cursor: pointer; position: relative; overflow: hidden; }
        .gradient-stop-swatch input[type="color"] { position: absolute; inset: -6px; width: calc(100% + 12px); height: calc(100% + 12px); border: none; cursor: pointer; background: none; padding: 0; }
        .gradient-stop-swatch input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
        .gradient-stop-swatch input[type="color"]::-webkit-color-swatch { border: none; border-radius: 8px; }
        .gradient-stop-swatch input[type="color"]::-moz-color-swatch { border: none; border-radius: 8px; }
        .gradient-stop-pos { width: 52px; text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 0.68rem; font-weight: 700; color: var(--accent); background: transparent; border: none; outline: none; }
        .gradient-stop-slider { flex: 1; }
        .gradient-stop-delete { width: 28px; height: 28px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: var(--text-muted); font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s; flex-shrink: 0; }
        .gradient-stop-delete:hover { background: var(--color-danger); color: white; border-color: var(--color-danger); }
        .gradient-stop-dup { width: 28px; height: 28px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: var(--text-muted); font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s; flex-shrink: 0; }
        .gradient-stop-dup:hover { background: var(--accent); color: white; border-color: var(--accent); }
        .gradient-add-stop { width: 100%; padding: 10px; border-radius: 12px; border: 2px dashed var(--border); background: transparent; color: var(--text-muted); font-size: 0.7rem; font-weight: 700; cursor: pointer; transition: 0.2s; font-family: inherit; display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 8px; }
        .gradient-add-stop:hover { border-color: var(--accent); color: var(--text-main); background: color-mix(in srgb, var(--accent) 5%, transparent); }
        .gradient-preset-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
        .gradient-preset-chip { padding: 0; border-radius: 12px; border: 1px solid var(--border); cursor: pointer; transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1); display: flex; flex-direction: column; align-items: center; gap: 6px; overflow: hidden; background: var(--bg-deep); position: relative; }
        .gradient-preset-chip:hover { border-color: var(--accent); transform: translateY(-3px); box-shadow: 0 8px 16px -4px rgba(0,0,0,0.5); overflow: visible; }
        .gradient-preset-chip.active { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent), 0 8px 24px -8px rgba(59,130,246,0.4); overflow: visible; }
        .gradient-preset-chip .selected-check { position: absolute; bottom: 4px; right: 6px; font-size: 10px; color: var(--accent); display: none; z-index: 1; }
        .gradient-preset-chip.active .selected-check { display: block; }
        .gradient-preset-swatch { width: 100%; height: 40px; border-radius: 11px 11px 0 0; }
        .gradient-preset-label { font-size: 0.72rem; font-weight: 700; color: var(--text-muted); padding: 4px 8px 10px; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%; }
        body.light-mode .gradient-stop-swatch { border-color: var(--lm-shadow); }
        body.light-mode .gradient-stop-row { background: var(--bg-control-light); border-color: var(--border); }
        body.light-mode .gradient-preset-chip { background: var(--bg-surface); border-color: var(--border); }
        body.light-mode .gradient-preset-chip:hover { box-shadow: 0 8px 16px -4px var(--lm-shadow); }
        .gradient-preset-chip .edit-snapshot { position: absolute; top: -6px; left: -6px; }
        .gradient-preset-chip .delete-snapshot { position: absolute; top: -6px; right: -6px; }
        .gradient-preset-chip:hover .edit-snapshot, .gradient-preset-chip:hover .delete-snapshot { opacity: 1; transform: scale(1); }
        .sort-btn.has-sort { color: var(--accent); }

        /* === RADIAL GRADIENT CONTROLS === */
        .radial-xy-pad { position: relative; width: 120px; height: 120px; background: var(--bg-deep); border: 1px solid var(--border); border-radius: 12px; cursor: crosshair; overflow: hidden; touch-action: none; }
        .radial-xy-pad::before, .radial-xy-pad::after { content: ''; position: absolute; background: var(--border); pointer-events: none; opacity: 0.3; }
        .radial-xy-pad::before { left: 50%; top: 0; width: 1px; height: 100%; }
        .radial-xy-pad::after { top: 50%; left: 0; height: 1px; width: 100%; }
        .radial-xy-dot { position: absolute; width: 14px; height: 14px; border-radius: 50%; background: var(--accent); border: 2px solid rgba(255,255,255,0.9); box-shadow: 0 2px 8px rgba(0,0,0,0.4); transform: translate(-50%, -50%); pointer-events: none; z-index: 1; transition: box-shadow 0.15s; }
        .radial-xy-pad:active .radial-xy-dot { box-shadow: 0 0 0 4px rgba(59,130,246,0.3), 0 2px 8px rgba(0,0,0,0.4); }
        .radial-xy-label { text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; font-weight: 700; color: var(--accent); margin-top: 6px; }
        .radial-shape-pills { display: flex; gap: 4px; background: var(--bg-deep); padding: 3px; border-radius: 8px; border: 1px solid var(--border); }
        .radial-shape-pill { flex: 1; padding: 6px 8px; border-radius: 6px; border: none; background: transparent; color: var(--text-muted); font-size: 0.62rem; font-weight: 700; cursor: pointer; transition: 0.2s; text-align: center; font-family: inherit; }
        .radial-shape-pill.active { background: var(--bg-elevated); color: var(--text-main); box-shadow: 0 3px 8px rgba(0,0,0,0.3); }
        .radial-size-pills { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; background: var(--bg-deep); padding: 3px; border-radius: 8px; border: 1px solid var(--border); }
        .radial-size-pill { padding: 6px 6px; border-radius: 6px; border: none; background: transparent; color: var(--text-muted); font-size: 0.58rem; font-weight: 700; cursor: pointer; transition: 0.2s; text-align: center; font-family: inherit; white-space: nowrap; }
        .radial-size-pill.active { background: var(--bg-elevated); color: var(--text-main); box-shadow: 0 3px 8px rgba(0,0,0,0.3); }
        body.light-mode .radial-shape-pill.active, body.light-mode .radial-size-pill.active { background: var(--bg-surface); box-shadow: 0 3px 8px var(--lm-shadow); }
        body.light-mode .radial-xy-pad { border-color: var(--border); }
        body.light-mode .radial-xy-dot { border-color: rgba(0,0,0,0.2); }

        /* === MESH GRADIENT EDITOR === */
        .mesh-editor-pad { position: relative; width: 100%; height: 160px; background: var(--bg-deep); border: 1px solid var(--border); border-radius: 12px; cursor: crosshair; overflow: hidden; touch-action: none; }
        .mesh-dot { position: absolute; width: 16px; height: 16px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.85); box-shadow: 0 2px 6px rgba(0,0,0,0.4); transform: translate(-50%, -50%); cursor: grab; z-index: 1; transition: transform 0.12s, box-shadow 0.12s; pointer-events: auto; }
        .mesh-dot:hover { transform: translate(-50%, -50%) scale(1.15); }
        .mesh-dot.selected { z-index: 2; border-color: white; box-shadow: 0 0 0 3px var(--accent), 0 2px 8px rgba(0,0,0,0.5); transform: translate(-50%, -50%) scale(1.15); }
        .mesh-dot:active { cursor: grabbing; }
        .mesh-hint { text-align: center; font-size: 0.58rem; color: var(--text-muted); opacity: 0.6; margin-top: 6px; }
        .mesh-stops-list { display: flex; flex-direction: column; gap: 8px; position: relative; }
        .mesh-stop-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: var(--bg-deep); border: 1px solid var(--border); border-radius: 12px; transition: background 0.2s, border-color 0.2s, opacity 0.2s; user-select: none; cursor: pointer; }
        .mesh-stop-row:hover { border-color: var(--accent); }
        .mesh-stop-row.selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--bg-deep)); box-shadow: 0 0 0 1px var(--accent); }
        .mesh-stop-row.dragging-src { opacity: 0.3; }
        body.light-mode .mesh-dot { border-color: rgba(0,0,0,0.3); }
        body.light-mode .mesh-dot.selected { border-color: var(--accent); }
        body.light-mode .mesh-stop-row { background: var(--bg-control-light); border-color: var(--border); }
        body.light-mode .mesh-stop-row.selected { background: color-mix(in srgb, var(--accent) 6%, var(--bg-control-light)); }

        .container { 
            position: relative;
            isolation: isolate;
            width: 100%; 
            max-width: 100%; 
            background: var(--bg-surface); 
            display: flex; 
            flex-direction: column; 
            height: 100vh;
            overflow: hidden;
        }

        @keyframes containerShow {
            from { opacity: 0; transform: translateY(40px) scale(0.96); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .header { 
            display: flex; 
            align-items: center;
            padding: 12px 24px;
            background: transparent;
            border-bottom: none;
            flex-shrink: 0;
            z-index: 100;
            gap: 16px;
        }
        .header h1 { font-size: 1rem; margin: 0; font-weight: 800; display: flex; align-items: center; gap: 12px; letter-spacing: -0.02em; white-space: nowrap; flex-shrink: 0; }

        .tabs { display: flex; background: var(--bg-deep); padding: 6px; border-radius: 16px; border: 1px solid var(--border); overflow-x: auto; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent; -webkit-overflow-scrolling: touch; flex-shrink: 0; z-index: 90; margin: 12px auto 0; width: calc(100% - 96px); max-width: 1600px; box-sizing: border-box; }
        .tabs::-webkit-scrollbar { height: 4px; }
        .tabs::-webkit-scrollbar-track { background: transparent; }
        .tabs::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }
        .tab { flex: 1 0 auto; padding: 14px 18px; text-align: center; font-size: 1rem; font-weight: 700; cursor: pointer; border-radius: 12px; color: var(--text-muted); transition: 0.2s ease; white-space: nowrap; }
        .tab.active { background: var(--bg-elevated); color: var(--text-main); box-shadow: 0 4px 12px rgba(0,0,0,0.4); }

        .content-area { padding: 32px 48px; display: flex; flex-direction: column; gap: 28px; flex: 1; overflow-y: auto; overflow-x: hidden; max-width: 1600px; margin: 0 auto; width: 100%; box-sizing: border-box; min-height: 0; }
        .section-title { font-size: 0.95rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 2.5px; font-weight: 800; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
        
        .mode-toggle { display: flex; background: rgba(0,0,0,0.2); padding: 3px; border-radius: 10px; border: 1px solid var(--border); gap: 2px; flex: 1; min-width: 0; }
        .mode-btn { flex: 1; padding: 8px 10px; border-radius: 7px; border: none; background: transparent; color: var(--text-muted); font-size: 0.78rem; font-weight: 700; cursor: pointer; transition: 0.2s; display: flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; }
        .mode-btn.active { background: var(--bg-elevated); color: var(--text-main); box-shadow: 0 4px 12px rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.05); }
        .mode-btn.system-active { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
        body.light-mode .mode-btn.system-active { background: color-mix(in srgb, var(--accent) 10%, transparent); }

        .control-group { background: var(--bg-deep); border: 1px solid var(--border); padding: 36px; border-radius: var(--radius-md); transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
        .slider-row { display: flex; flex-direction: column; gap: 18px; margin-bottom: 28px; }
        .slider-row label { display: flex; justify-content: space-between; font-size: 1.05rem; color: var(--text-muted); font-weight: 600; cursor: pointer; user-select: none; transition: color 0.2s; }
        .slider-row label:hover { color: var(--text-main); }
        .slider-val { color: var(--accent); font-family: 'JetBrains Mono', monospace; font-weight: 700; }

        .sync-option { display: flex; align-items: center; gap: 18px; background: var(--bg-deep); padding: 22px; border-radius: 16px; margin-bottom: 12px; cursor: pointer; transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1); border: 1px solid var(--border); text-align: left; user-select: none; }
        .sync-option:hover { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 5%, transparent); }
        .sync-option input { width: 24px; height: 24px; cursor: pointer; accent-color: var(--accent); }
        .sync-option label { cursor: pointer; font-size: 1.05rem; font-weight: 700; flex: 1; color: var(--text-main); }
        .sync-option span { font-size: 0.9rem; color: var(--text-muted); display: block; font-weight: 400; margin-top: 4px; }

        .sync-mode-pill { position: relative; display: flex; align-items: center; justify-content: center; gap: 8px; background: var(--bg-deep); padding: 16px; border-radius: 14px; cursor: pointer; border: 1px solid var(--border); transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1); font-size: 1rem; font-weight: 700; color: var(--text-muted); user-select: none; }
        .sync-mode-pill:hover:not(.disabled) { border-color: var(--accent); color: var(--text-main); transform: translateY(-2px); }
        .sync-mode-pill.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--text-main); box-shadow: 0 4px 12px rgba(59, 130, 246, 0.1); }
        .sync-mode-pill.disabled { opacity: 0.25; cursor: not-allowed; border-color: transparent; }
        .sync-mode-pill .selected-check { position: absolute; bottom: 4px; right: 6px; font-size: 9px; color: var(--accent); display: none; }
        .sync-mode-pill.active:not(.disabled) .selected-check { display: block; }

        /* Delta Badge Indicators for Sync Settings */
        .sync-delta-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 0.55rem; font-weight: 700; padding: 2px 8px; border-radius: 20px; letter-spacing: 0.3px; vertical-align: middle; margin-left: 6px; white-space: nowrap; transition: opacity 0.2s ease, transform 0.2s ease; animation: syncBadgePop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        .sync-delta-badge.in-sync { background: rgba(34, 197, 94, 0.12); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.25); }
        .sync-delta-badge.diff-detected { background: rgba(234, 179, 8, 0.12); color: #eab308; border: 1px solid rgba(234, 179, 8, 0.25); cursor: pointer; }
        body.light-mode .sync-delta-badge.in-sync { background: rgba(22, 163, 74, 0.08); color: #16a34a; border-color: rgba(22, 163, 74, 0.2); }
        body.light-mode .sync-delta-badge.diff-detected { background: rgba(202, 138, 4, 0.08); color: #ca8a04; border-color: rgba(202, 138, 4, 0.2); }
        @keyframes syncBadgePop { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }

        /* Sync Diff Panel — Expandable Detail View */
        .sync-diff-chevron { cursor: pointer; font-size: 9px; color: var(--text-muted); transition: transform 0.25s cubic-bezier(0.4,0,0.2,1); padding: 4px 2px; opacity: 0.6; user-select: none; flex-shrink: 0; }
        .sync-diff-chevron:hover { opacity: 1; }
        .sync-diff-chevron.expanded { transform: rotate(180deg); }
        .sync-diff-panel { margin: -2px 0 10px 4px; max-height: 240px; overflow-y: auto; border-left: 2px solid color-mix(in srgb, var(--accent) 40%, transparent); padding: 8px 0 4px 10px; scrollbar-width: thin; scrollbar-color: var(--accent) transparent; }
        .sync-diff-panel::-webkit-scrollbar { width: 4px; }
        .sync-diff-panel::-webkit-scrollbar-thumb { background: var(--accent); border-radius: 4px; }
        @keyframes diffSlideIn { from { opacity: 0; max-height: 0; } to { opacity: 1; max-height: 240px; } }
        .sync-diff-panel[data-animating] { animation: diffSlideIn 0.25s ease forwards; }

        .sync-diff-mode-row { padding: 6px 0; font-size: 0.6rem; color: var(--text-muted); }
        .sync-diff-mode-row + .sync-diff-mode-row { border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent); }
        .sync-diff-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
        .sync-diff-grid .sync-diff-mode-row { border-top: none; }
        .sync-diff-grid .sync-diff-mode-row + .sync-diff-mode-row { border-top: none; }
        .sync-diff-mode-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-weight: 700; font-size: 0.6rem; }
        .sync-diff-mode-header .mode-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .sync-diff-mode-header .mode-dot.dark { background: #6366f1; }
        .sync-diff-mode-header .mode-dot.oled { background: #1e1e1e; border: 1px solid #444; }
        .sync-diff-mode-header .mode-dot.light { background: #fbbf24; }
        .sync-diff-mode-header .mode-dot.her { background: #ec4899; }
        .sync-diff-match-tag { font-size: 0.5rem; color: #22c55e; font-weight: 600; opacity: 0.8; }
        body.light-mode .sync-diff-match-tag { color: #16a34a; }

        .sync-diff-ramp-row { display: flex; align-items: center; gap: 8px; margin: 3px 0; }
        .sync-diff-ramp-label { font-size: 0.5rem; font-weight: 600; width: 30px; flex-shrink: 0; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.5px; }
        .sync-diff-ramp { display: flex; gap: 1px; height: 14px; flex: 1; border-radius: 4px; overflow: hidden; }
        .sync-diff-ramp .swatch { flex: 1; min-width: 0; }
        .sync-diff-values { display: flex; gap: 10px; font-size: 0.5rem; font-family: 'SF Mono', 'Fira Code', monospace; margin-left: 0; opacity: 0.7; }
        .sync-diff-values .delta { color: #eab308; font-weight: 600; }
        body.light-mode .sync-diff-values .delta { color: #ca8a04; }

        .sync-diff-code-box { background: rgba(0,0,0,0.25); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.48rem; line-height: 1.5; max-height: 52px; overflow: hidden; white-space: pre; color: var(--text-muted); margin: 4px 0 2px 0; }
        .sync-diff-code-box .truncation { opacity: 0.4; font-style: italic; }
        body.light-mode .sync-diff-code-box { background: rgba(0,0,0,0.04); }

        .sync-diff-code-summary { display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.2); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; cursor: pointer; transition: 0.2s; font-size: 0.5rem; color: var(--text-muted); margin: 4px 0 2px; user-select: none; }
        .sync-diff-code-summary:hover { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, transparent); }
        .sync-diff-code-summary .summary-label { font-family: 'SF Mono', 'Fira Code', monospace; opacity: 0.7; }
        .sync-diff-code-summary .summary-action { font-size: 0.45rem; color: var(--accent); opacity: 0.7; white-space: nowrap; }
        body.light-mode .sync-diff-code-summary { background: rgba(0,0,0,0.03); }

        .sync-diff-code-expanded { margin: 4px 0 2px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; animation: diffSlideIn 0.2s ease; }
        .sync-diff-code-expanded .diff-header { display: flex; font-size: 0.45rem; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; opacity: 0.5; }
        .sync-diff-code-expanded .diff-header span { flex: 1; padding: 4px 8px; }
        .sync-diff-code-expanded .diff-header span + span { border-left: 1px solid var(--border); }
        .sync-diff-code-expanded .diff-body { display: flex; max-height: 200px; overflow-y: auto; scrollbar-width: thin; }
        .sync-diff-code-expanded .diff-col { flex: 1; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.44rem; line-height: 1.6; white-space: pre-wrap; word-break: break-all; min-width: 0; }
        .sync-diff-code-expanded .diff-col + .diff-col { border-left: 1px solid var(--border); }
        .sync-diff-code-expanded .diff-line { padding: 0 6px; }
        .sync-diff-code-expanded .diff-line.removed { background: rgba(239,68,68,0.1); color: #f87171; }
        .sync-diff-code-expanded .diff-line.added { background: rgba(34,197,94,0.1); color: #4ade80; }
        .sync-diff-code-expanded .diff-line.unchanged { opacity: 0.35; }
        .sync-diff-code-expanded .diff-line.empty-placeholder { opacity: 0.15; font-style: italic; }
        body.light-mode .sync-diff-code-expanded .diff-line.removed { background: rgba(239,68,68,0.06); color: #dc2626; }
        body.light-mode .sync-diff-code-expanded .diff-line.added { background: rgba(34,197,94,0.06); color: #16a34a; }

        .sync-diff-gradient-bar { height: 16px; border-radius: 4px; border: 1px solid var(--border); margin: 4px 0; }

        .sync-diff-prop-table { margin: 4px 0 2px 0; font-size: 0.5rem; }
        .sync-diff-prop-table td { padding: 1px 8px 1px 0; }
        .sync-diff-prop-table .prop-key { opacity: 0.6; }
        .sync-diff-prop-table .prop-match { color: #22c55e; }
        .sync-diff-prop-table .prop-diff { color: #eab308; font-weight: 600; }
        body.light-mode .sync-diff-prop-table .prop-match { color: #16a34a; }
        body.light-mode .sync-diff-prop-table .prop-diff { color: #ca8a04; }


        input[type="range"] { -webkit-appearance: none; width: 100%; height: 10px; background: #000; border-radius: 5px; outline: none; }
        input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 24px; height: 24px; border-radius: 50%; background: #fff; cursor: pointer; border: 4px solid var(--accent); box-shadow: 0 0 15px rgba(59, 130, 246, 0.4); transition: 0.2s; }
        input[type="range"]::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: #fff; cursor: pointer; border: 4px solid var(--accent); box-shadow: 0 0 15px rgba(59, 130, 246, 0.4); }
        input[type="range"]::-moz-range-track { background: transparent; border: none; height: 10px; }
        body.light-mode input[type="range"] { background: var(--border); }

        .color-row { display: flex; gap: 24px; align-items: center; margin-bottom: 28px; }
        .color-preview { width: 72px; height: 72px; border-radius: 18px; border: 2px solid rgba(255, 255, 255, 0.1); flex-shrink: 0; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); }
        
        .preset-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
        
        .curated-scroll-container { overflow-x: auto; overflow-y: hidden; padding: 12px 8px; margin: -12px -8px 0 -8px; width: calc(100% + 16px); border-radius: 12px; scrollbar-width: auto; }
        .curated-scroll-container::-webkit-scrollbar { height: 8px; }
        .curated-scroll-container::-webkit-scrollbar-track { background: var(--bg-deep); border-radius: 4px; border: 1px solid var(--border); margin: 0 8px; }
        .curated-scroll-container::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
        .curated-scroll-container::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
        .curated-flex { display: flex; gap: 16px; }
        .curated-flex .preset-btn { flex: 0 0 calc((100% - 48px) / 4); min-width: 220px; }

        .preset-btn { background: var(--bg-deep); border: 1px solid var(--border); padding: 20px; border-radius: 16px; font-size: 1rem; color: var(--text-muted); cursor: pointer; transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1); display: flex; flex-direction: column; align-items: center; gap: 12px; font-weight: 600; position: relative; min-width: 0; }
        .preset-btn:hover { border-color: var(--accent); color: var(--text-main); transform: translateY(-4px); box-shadow: 0 10px 20px -5px rgba(0,0,0,0.6); }
        .preset-btn:hover .delete-snapshot, .preset-btn:hover .update-snapshot, .preset-btn:hover .edit-snapshot, .preset-btn:hover .export-snapshot { opacity: 1; transform: scale(1); }
        .preset-dots { display: flex; gap: 1px; width: 100%; height: 32px; border-radius: 10px; overflow: hidden; background: rgba(255,255,255,0.02); padding: 2px; border: 1px solid rgba(255,255,255,0.05); }

        .snapshot-action { position: absolute; width: 22px; height: 22px; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; cursor: pointer; border: 3px solid var(--bg-surface); z-index: 10; opacity: 0; transform: scale(0.5); transition: 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        .snapshot-action:hover { transform: scale(1.2) !important; }

        .delete-snapshot { top: -6px; right: -6px; background: #ef4444; font-size: 14px; font-weight: 800; }
        .delete-snapshot:hover { background: #dc2626; }
        .update-snapshot { bottom: -6px; right: -6px; background: var(--accent); }
        .update-snapshot:hover { background: #2563eb; }
        .edit-snapshot { top: -6px; left: -6px; background: #6b7280; }
        .edit-snapshot:hover { background: #4b5563; }
        .export-snapshot { bottom: -6px; left: -6px; background: #8b5cf6; }
        .export-snapshot:hover { background: #6d28d9; }

        .check-update-snapshot { top: 50%; right: -8px; transform: translateY(-50%) scale(0.5); background: #10b981; font-size: 12px; }
        .preset-btn:hover .check-update-snapshot { opacity: 1; transform: translateY(-50%) scale(1); }
        .check-update-snapshot:hover { background: #059669; transform: translateY(-50%) scale(1.2) !important; }

        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; display: inline-block; }

        .preset-btn.active-theme { border-color: var(--accent); border-width: 1px; box-shadow: 0 0 0 2px var(--accent), 0 10px 30px -10px rgba(59, 130, 246, 0.5); background: rgba(59, 130, 246, 0.08); }
        .selected-check { position: absolute; bottom: 8px; right: 8px; font-size: 10px; color: var(--accent); display: none; }
        .active-theme .selected-check { display: block; }

        /* Tonal Ramp Animation Upgrades */
        .ramp-block { display: flex; align-items: center; justify-content: center; font-size: 0.78rem; font-weight: 800; font-family: 'JetBrains Mono', monospace; flex:1; height:100%; cursor:pointer; transition: 0.15s cubic-bezier(0.4, 0, 0.2, 1); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); position: relative; user-select: none; }
        .ramp-block:hover { transform: scale(1.1) translateY(-2px); z-index: 10; box-shadow: 0 10px 20px -5px rgba(0,0,0,0.5); border-color: rgba(255,255,255,0.2); }
        body.light-mode .ramp-block { border-color: var(--lm-border-subtle); }
        body.light-mode .ramp-block:hover { border-color: var(--lm-bg-hover); box-shadow: 0 10px 20px -5px var(--lm-bg-hover); }

        .var-scroll { max-height: none; overflow-y: auto; padding-right: 8px; }
        .var-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
        .var-item { display: flex; justify-content: space-between; align-items: center; padding: 20px; background: var(--bg-deep); border-radius: 16px; border: 1px solid var(--border); transition: 0.2s; }
        
        .var-item.is-locked { border-color: var(--accent); background: rgba(59, 130, 246, 0.08); }
        
        .var-name { font-size: 1rem; font-family: 'JetBrains Mono', monospace; color: var(--text-muted); font-weight: 500; cursor: pointer; transition: color 0.2s ease; }
        .var-name:hover { color: var(--accent) !important; }
        
        .var-controls { display: flex; gap: 8px; align-items: center; }
        .var-lock { cursor: pointer; font-size: 14px; opacity: 0.3; transition: 0.2s; padding: 4px; border-radius: 6px; }
        .var-lock:hover { opacity: 1; background: rgba(255, 255, 255, 0.05); }
        .is-locked .var-lock { opacity: 1; color: var(--accent); }
        
        .var-reset { cursor: pointer; font-size: 14px; opacity: 0.3; transition: 0.2s; padding: 4px; border-radius: 6px; display: flex; align-items: center; justify-content: center; }
        .var-reset:hover { opacity: 1; background: rgba(255, 255, 255, 0.05); }

        .var-picker { -webkit-appearance: none; border: none; width: 40px; height: 40px; border-radius: 12px; cursor: pointer; background: none; padding: 0; overflow: hidden; }
        .var-picker::-webkit-color-swatch { border: 2px solid rgba(255, 255, 255, 0.1); border-radius: 10px; }
        .var-picker::-moz-color-swatch { border: 2px solid rgba(255, 255, 255, 0.1); border-radius: 10px; }
        .var-picker-wrap { position: relative; width: 40px; height: 40px; flex-shrink: 0; }
        .var-picker-aa { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 800; pointer-events: none; z-index: 1; font-family: 'Inter', sans-serif; letter-spacing: 0.02em; text-shadow: 0 0 3px rgba(0,0,0,0.15); }
        
        .var-action-btn { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: var(--text-muted); font-size: 0.78rem; font-weight: 600; padding: 8px 16px; border-radius: 10px; cursor: pointer; transition: 0.2s; z-index: 10; }
        .var-action-btn:hover { background: var(--accent); border-color: var(--accent); color: white; }

        .code-container { display: flex; flex-direction: column; gap: 20px; height: 100%; }
        
        /* Native-Style OWUI Code Blocks */
        .owui-code-block { display: flex; flex-direction: column; background: #000000; border-radius: 12px; border: none; overflow: hidden; flex: 1; box-shadow: 0 4px 12px rgba(0,0,0,0.1), inset 0 0 0 1px rgba(255,255,255,0.1); }
        body.light-mode .owui-code-block { background: var(--bg-surface); box-shadow: 0 4px 12px var(--lm-border-subtle), inset 0 0 0 1px var(--lm-shadow); }
        
        .owui-code-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 14px; background: rgba(255, 255, 255, 0.03); border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
        body.light-mode .owui-code-header { background: var(--lm-bg-tint); border-bottom-color: var(--lm-border-subtle); }
        
        .owui-code-lang { font-size: 0.75rem; color: var(--text-muted); font-family: 'Inter', sans-serif; display: flex; align-items: center; gap: 8px; }
        
        .owui-code-actions { display: flex; gap: 4px; }
        .owui-code-btn { background: transparent; border: none; color: var(--text-main); font-size: 0.75rem; padding: 4px 8px; border-radius: 6px; cursor: pointer; transition: 0.2s; }
        .owui-code-btn:hover { background: rgba(255, 255, 255, 0.1); }
        body.light-mode .owui-code-btn:hover { background: var(--lm-border-subtle); }
        
        .owui-code-block textarea { flex: 1; width: 100%; background: transparent; border: none; color: #e4e4e7; font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; resize: none; outline: none; padding: 16px 16px 16px 12px; line-height: 1.6; white-space: pre-wrap; overflow-x: hidden; overflow-y: auto; }
        body.light-mode .owui-code-block textarea { color: var(--text-main); }

        .owui-code-body { display: flex; flex: 1; overflow: hidden; min-height: 0; }
        .owui-line-numbers { white-space: pre; padding: 16px 8px 16px 14px; text-align: right; user-select: none; pointer-events: none; font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; line-height: 1.6; color: rgba(255,255,255,0.18); min-width: 36px; flex-shrink: 0; overflow: hidden; box-sizing: border-box; border-right: 1px solid rgba(255,255,255,0.06); }
        body.light-mode .owui-line-numbers { color: rgba(0,0,0,0.18); border-right-color: var(--lm-border-subtle); }

        /* Documentation Styling (Native Technical Style) */
        .docs-container { display: flex; flex-direction: column; padding-bottom: 40px; }
        .doc-accordion { border-bottom: 1px solid var(--border); }
        .doc-accordion summary { padding: 28px 0; cursor: pointer; display: flex; justify-content: space-between; align-items: center; list-style: none; font-weight: 700; color: var(--text-main); font-size: 1.2rem; transition: 0.2s; }
        .doc-accordion summary::-webkit-details-marker { display: none; }
        .doc-accordion summary:hover { color: var(--accent); }
        .doc-accordion[open] summary { color: var(--accent); padding-bottom: 12px; }
        .doc-accordion summary svg { transition: 0.3s; opacity: 0.5; }
        .doc-accordion[open] summary svg { transform: rotate(180deg); opacity: 1; color: var(--accent); }
        .doc-inner { padding: 0 0 32px; color: var(--text-muted); font-size: 1.05rem; line-height: 1.85; }
        
        .doc-inner h4 { font-size: 1.1rem; color: var(--text-main); margin: 32px 0 16px; font-weight: 700; }
        .doc-inner p { margin-bottom: 16px; }
        .doc-inner ul { padding-left: 18px; margin-bottom: 20px; }
        .doc-inner li { margin-bottom: 8px; list-style-type: disc; }
        .doc-inner li b { color: var(--text-main); }
        
        .doc-table-wrap { overflow-x: auto; margin-top: 12px; border-radius: 12px; border: 1px solid var(--border); background: rgba(0,0,0,0.2); }
        body.light-mode .doc-table-wrap { background: var(--lm-bg-tint); }
        .doc-table { width: 100%; border-collapse: collapse; min-width: 450px; }
        .doc-table th { text-align: left; padding: 12px 16px; border-bottom: 1px solid var(--border); color: var(--text-main); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.6; }
        .doc-table td { padding: 12px 16px; font-size: 0.75rem; vertical-align: middle; border-bottom: 1px solid rgba(255,255,255,0.03); }
        body.light-mode .doc-table td { border-bottom-color: var(--lm-bg-tint); }
        .doc-table tr:last-child td { border-bottom: none; }
        .doc-swatch { width: 14px; height: 14px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.1); display: inline-block; vertical-align: middle; margin-right: 8px; }
        .doc-code-inline { background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; color: var(--accent); }

        .action-toast { position: fixed; top: 90px; right: 28px; background: var(--accent); color: white; padding: 10px 22px; border-radius: 20px; font-size: 0.85rem; font-weight: 700; opacity: 0; pointer-events: none; transition: 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); z-index: 9999; box-shadow: 0 4px 15px rgba(59,130,246,0.4); transform: translateY(-5px) scale(0.95); }
        .action-toast.show { opacity: 1; transform: translateY(0) scale(1); }

        /* Draft Mode Toggle */
        .draft-toggle { display: flex; align-items: center; gap: 8px; font-size: 0.78rem; font-weight: 600; flex-shrink: 0; }
        .draft-toggle-label { color: var(--text-muted); transition: color 0.2s; white-space: nowrap; user-select: none; }
        .draft-toggle-label.active { color: var(--accent); }
        .draft-switch { position: relative; width: 40px; height: 22px; background: rgba(255,255,255,0.1); border-radius: 11px; cursor: pointer; transition: background 0.3s; border: 1px solid rgba(255,255,255,0.08); flex-shrink: 0; }
        .draft-switch.on { background: var(--accent); border-color: var(--accent); }
        .draft-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: white; border-radius: 50%; transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
        .draft-switch.on::after { transform: translateX(18px); }
        body.light-mode .draft-switch { background: var(--lm-border-subtle); border-color: var(--lm-shadow); }
        body.light-mode .draft-switch.on { background: var(--accent); border-color: var(--accent); }
        .draft-publish-btn { background: var(--accent); color: white; border: none; padding: 8px 18px; border-radius: 10px; font-size: 0.8rem; font-weight: 700; cursor: pointer; transition: all 0.2s; display: none; white-space: nowrap; box-shadow: 0 2px 8px rgba(59,130,246,0.3); }
        .draft-publish-btn:hover { filter: brightness(1.15); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(59,130,246,0.4); }
        .draft-publish-btn.visible { display: flex; align-items: center; gap: 6px; }
        @keyframes draft-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .draft-dot { width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; animation: draft-pulse 1.5s ease-in-out infinite; flex-shrink: 0; }
        .inactive-badge { display: none; align-items: center; gap: 6px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); color: #ef4444; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.05em; padding: 5px 12px; border-radius: 8px; text-transform: uppercase; white-space: nowrap; }
        .inactive-badge.visible { display: flex; }
        .inactive-badge .inactive-dot { width: 7px; height: 7px; border-radius: 50%; background: #ef4444; animation: draft-pulse 1.5s ease-in-out infinite; flex-shrink: 0; }

        .header-json-btn { background: transparent; border: 1px solid var(--border); color: var(--text-muted); font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; font-weight: 700; padding: 12px 18px; border-radius: 12px; cursor: pointer; transition: 0.2s ease; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
        .header-json-btn:hover { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
        body.light-mode .header-json-btn { border-color: var(--border); color: var(--text-muted); }
        body.light-mode .header-json-btn:hover { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, transparent); }

        .footer { padding: 16px 48px; border-top: none; background: transparent; display: flex; justify-content: space-between; align-items: center; gap: 16px; overflow: hidden; flex-shrink: 0; z-index: 100; max-width: 1600px; margin: 0 auto; width: 100%; box-sizing: border-box; }
        .footer-left { display: flex; gap: 12px; align-items: center; }
        .footer-right { display: flex; gap: 12px; align-items: center; }
        .footer-actions { display: flex; gap: 12px; align-items: center; }
        .btn { padding: 12px 22px; border-radius: 20px; border: 1px solid var(--border); background: var(--bg-deep); color: var(--text-main); font-size: 0.95rem; font-weight: 700; cursor: pointer; transition: 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; white-space: nowrap; flex-shrink: 0; }
        .btn-icon { padding: 0; width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; }
        .btn:hover { border-color: var(--text-muted); transform: translateY(-2px); }
        .btn-primary { background: var(--accent); border: none; color: white !important; }
        .btn-danger { color: #f87171 !important; border-color: rgba(248, 113, 113, 0.2); }
        .btn-sm { flex: 1; font-size: 0.68rem; padding: 10px 8px; }

        @media (max-width: 768px) {
            /* Header: wrap into rows */
            .header { padding: 10px 12px; flex-wrap: wrap; gap: 8px; }
            .header h1 { font-size: 0.85rem; gap: 8px; order: 1; flex-shrink: 1; min-width: 0; }
            .inactive-badge { font-size: 0.6rem; padding: 3px 8px; order: 2; }
            /* Swap: buttons move to top-right (order 3), mode toggle drops to full-width row below (order 4) */
            .header-btns-wrap { order: 3; gap: 6px; }
            .mode-toggle { flex-basis: 100%; min-width: 0; order: 4; }
            .mode-btn { flex-direction: column; gap: 2px; padding: 7px 4px; font-size: 0.6rem; }
            .header-json-btn { padding: 8px 10px; font-size: 0.7rem; gap: 4px; }

            /* Tabs: smaller and scrollable */
            .tabs { margin: 8px 12px 0; padding: 4px; border-radius: 12px; width: calc(100% - 24px); }
            .tab { padding: 10px 14px; font-size: 0.78rem; border-radius: 10px; }

            /* Content area */
            .content-area { padding: 12px; gap: 16px; }
            .control-group { padding: 20px 16px; border-radius: 12px; }
            .section-title { font-size: 0.8rem; letter-spacing: 1.5px; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }

            /* Ramp: horizontal scroll */
            #ramp-gray { overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; flex-wrap: nowrap; }
            #ramp-gray::-webkit-scrollbar { display: none; }
            .ramp-block { min-width: 38px; font-size: 0.65rem; }

            /* Variable grid: single column on small screens */
            .var-grid { grid-template-columns: 1fr; gap: 12px; }
            .var-item { padding: 14px; }

            /* Preset grid */
            .preset-grid { grid-template-columns: repeat(2, 1fr); gap: 12px; }
            .preset-btn { padding: 14px; gap: 8px; border-radius: 12px; }
            .curated-flex .preset-btn { flex: 0 0 calc((100% - 12px) / 2); }

            /* Slider rows */
            .slider-row { gap: 12px; margin-bottom: 18px; }

            /* Footer: stack into centered rows */
            .footer { padding: 10px 8px; flex-wrap: wrap; justify-content: center; gap: 8px; box-sizing: border-box; }
            .footer-left { width: 100%; justify-content: center; gap: 6px; flex-wrap: wrap; }
            .footer-right { width: 100%; justify-content: center; gap: 8px; }
            .footer-right > div { margin-right: 0; border-right: none; padding-right: 0; }
            .footer-actions { width: 100%; justify-content: center; gap: 6px; }

            /* Buttons */
            .btn { padding: 8px 12px; font-size: 0.7rem; height: auto; min-height: 32px; border-radius: 14px; }
            .btn span.mobile-hide { display: none; }
            .btn-icon { width: 32px; height: 32px; }
            .draft-publish-btn { padding: 6px 14px; font-size: 0.72rem; }
            .draft-toggle { font-size: 0.72rem; }

            /* Code editors */
            .owui-code-area { font-size: 11px !important; }

            /* Modals */
            .modal-panel-save, .control-group.modal-panel-save { width: 95vw !important; max-width: 95vw !important; padding: 20px !important; }
            .metadata-grid { grid-template-columns: 1fr !important; }

            /* Gallery toolbars: allow icon row to wrap */
            .flex-center-gap6 { flex-wrap: wrap; gap: 4px; }
            .btn-icon { width: 30px; height: 30px; min-width: 30px; }

            /* Variable action buttons */
            .var-action-btn { font-size: 0.65rem; padding: 6px 10px; }

            /* Curated presets: scroll container */
            .curated-scroll-container { -webkit-overflow-scrolling: touch; }
            .curated-flex { gap: 10px; }

            /* Gradient preset grid */
            .gradient-preset-grid { grid-template-columns: repeat(2, 1fr); }

            /* Sync modal */
            .sync-delta-grid { grid-template-columns: 1fr !important; }
        }

        /* Extra-small screens (iPhone SE, etc.) */
        @media (max-width: 390px) {
            .header h1 { font-size: 0.75rem; }
            .mode-btn { font-size: 0.55rem; padding: 6px 2px; }
            .tab { padding: 8px 10px; font-size: 0.7rem; }
            .ramp-block { min-width: 34px; font-size: 0.6rem; }
            .section-title { font-size: 0.72rem; }
            .btn { padding: 6px 8px; font-size: 0.62rem; }
            .content-area { padding: 8px; gap: 12px; }
            .control-group { padding: 16px 12px; }
        }

        /* Narrow phones: icon-only header buttons to fit on title row */
        @media (max-width: 480px) {
            .header-json-btn .btn-label { display: none; }
            .header-json-btn { padding: 7px 9px; min-width: 0; }
            .header-btns-wrap { gap: 4px; }
        }
        .modal-overlay { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); backdrop-filter:blur(12px); z-index:1100; justify-content:center; align-items:center; }
        .modal-overlay.z-low { backdrop-filter:blur(8px); z-index:1000; }
        .modal-overlay.z-high { z-index:1200; }
        .modal-icon { width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 20px; }
        .modal-icon-danger { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
        .modal-icon-info { background: rgba(59, 130, 246, 0.1); color: var(--accent); }
        .modal-icon-update { background: rgba(16, 185, 129, 0.1); color: #10b981; font-size: 22px; }
        .modal-icon-save { background: rgba(59, 130, 246, 0.06); color: var(--accent); }
        .modal-panel { width: 420px; max-width: 95vw; background:var(--bg-surface); text-align:center; box-shadow: 0 30px 60px rgba(0,0,0,0.8); padding: 36px; border-radius: var(--radius-md); }
        .modal-panel-danger { border: 1px solid rgba(239, 68, 68, 0.5); }
        .modal-panel-info { border: 1px solid var(--accent); }
        .modal-panel-neutral { border: 1px solid var(--border); }
        .modal-panel-save { width: 620px; max-width: 95vw; background:var(--bg-surface); border: 1px solid var(--accent); box-shadow: 0 20px 50px rgba(0,0,0,1); padding: 32px; border-radius: var(--radius-md); }
        .metadata-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 22px; }
        .metadata-field label { font-size: 0.6rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700; margin-bottom: 5px; display: block; }
        .metadata-field input[type="text"] { width: 100%; background: var(--bg-deep) !important; border: 1px solid var(--border) !important; color: var(--text-main) !important; padding: 10px 12px; border-radius: 10px; font-family: 'Inter', sans-serif; font-size: 0.8rem; outline: none; transition: border-color 0.2s; box-sizing: border-box; }
        .metadata-field input[type="text"]:focus { border-color: var(--accent) !important; }
        .metadata-field input[type="text"]::placeholder { color: var(--text-muted); opacity: 0.5; }
        .modal-input { width: 100%; background: var(--bg-deep); border: 1px solid var(--border); color: var(--text-main); padding: 12px; border-radius: 12px; margin-bottom: 24px; font-family: 'Inter', sans-serif; font-size: 0.85rem; outline: none; }

        @media (max-width: 500px) { .metadata-grid { grid-template-columns: 1fr; } .modal-panel-save { width: 95vw; } .modal-panel { width: 95vw; } }

        /* === UTILITY CLASSES (extracted from repeated inline styles) === */
        .toggle-label { display: flex; align-items: center; gap: 7px; font-size: 0.65rem; color: var(--text-main); cursor: pointer; text-transform: none; letter-spacing: 0; }
        .toggle-label-gap5 { display: flex; align-items: center; gap: 5px; font-size: 0.65rem; color: var(--text-main); cursor: pointer; }
        .toggle-label-ml { display: flex; align-items: center; gap: 7px; font-size: 0.65rem; color: var(--text-main); cursor: pointer; margin-left: 8px; }
        .cb-input { -webkit-appearance: none; appearance: none; position: relative; width: 34px; height: 18px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.08); border-radius: 9px; cursor: pointer; transition: background 0.3s, border-color 0.3s; flex-shrink: 0; margin: 0; }
        .cb-input::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; background: white; border-radius: 50%; transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
        .cb-input:checked { background: var(--accent); border-color: var(--accent); }
        .cb-input:checked::after { transform: translateX(16px); }
        body.light-mode .cb-input { background: var(--lm-border-subtle); border-color: var(--lm-shadow); }
        body.light-mode .cb-input:checked { background: var(--accent); border-color: var(--accent); }
        .search-wrap { position: relative; display: flex; align-items: center; overflow: hidden; }
        .search-icon-overlay { position: absolute; left: 8px; pointer-events: none; opacity: 0.4; }
        .search-input-expand { width: 0; padding: 0; border: 1px solid transparent; background: transparent; color: var(--text-main); font-size: 0.65rem; border-radius: var(--radius-md); outline: none; transition: all 0.3s ease; opacity: 0; font-family: inherit; }
        .var-action-static { position: static; padding: 4px 8px; white-space: nowrap; }
        .doc-subheading { font-weight: 700; font-size: 0.72rem; margin: 16px 0 8px; color: var(--text-main); }
        .doc-pre { font-size: 0.65rem; background: var(--bg-deep); padding: 10px 12px; border-radius: 8px; overflow-x: auto; border: 1px solid var(--border); line-height: 1.6; margin: 8px 0; }
        .doc-pre-sm { font-size: 0.62rem; background: var(--bg-deep); padding: 8px 10px; border-radius: 7px; overflow-x: auto; border: 1px solid var(--border); line-height: 1.5; margin-bottom: 10px; }
        .sub-label { font-size: 0.65rem; color: var(--text-muted); font-weight: 800; text-transform: uppercase; letter-spacing: 2px; }
        .sub-label-mb { font-size: 0.65rem; color: var(--text-muted); font-weight: 800; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 10px; }
        .empty-state { text-align: center; width: 100%; padding: 20px; color: var(--text-muted); font-size: 0.75rem; border: 1px dashed var(--border); border-radius: 12px; opacity: 0.6; }
        .empty-state-lg { text-align: center; padding: 40px 20px; color: var(--text-muted); font-size: 0.75rem; border: 1px dashed var(--border); border-radius: 20px; opacity: 0.6; }
        .flex-center { display: flex; align-items: center; gap: 12px; }
        .flex-center-gap6 { display: flex; gap: 6px; align-items: center; }
        .flex-center-gap8 { display: flex; gap: 8px; align-items: center; }
        .flex-end { display: flex; gap: 12px; justify-content: flex-end; }
        .section-title-bar { align-items: center; display: flex; justify-content: space-between; }
        .doc-table-compact { width: 100%; border-collapse: collapse; font-size: 0.68rem; margin: 8px 0 16px; }
        .doc-table-compact th { text-align: left; padding: 8px 10px; font-weight: 800; color: var(--text-main); }
        .doc-table-compact td { padding: 8px 10px; }
    </style>
</head>
<body id="tool-body">

<div id="drop-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(59, 130, 246, 0.1); backdrop-filter:blur(6px); z-index:10000; border: 4px dashed var(--accent); align-items:center; justify-content:center; flex-direction:column; box-sizing:border-box;">
    <div style="font-size: 56px; margin-bottom: 16px; animation: bounce 1s infinite;">📥</div>
    <h2 style="color:var(--text-main); font-weight:800; font-size: 1.5rem; letter-spacing: -0.02em;">Drop Theme JSON to Import</h2>
</div>

<style>
@keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
</style>

<div class="container" id="app-container">
    <div class="header">
        <h1>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
            </svg>
            Theme Designer Pro | v{VERSION}
        </h1>
        <span class="inactive-badge" id="inactive-badge" data-tooltip="The Theme Active valve is OFF — changes are saved but not pushed to users"><span class="inactive-dot"></span> Theme Inactive</span>
        <div class="mode-toggle" id="global-mode-toggle" role="radiogroup" aria-label="Theme mode">
            <button class="mode-btn" data-mode="system" role="radio" aria-checked="false">🖥️ System</button>
            <button class="mode-btn active" data-mode="dark" role="radio" aria-checked="true">🌑 Dark</button>
            <button class="mode-btn" data-mode="oled" role="radio" aria-checked="false">🌌 OLED</button>
            <button class="mode-btn" data-mode="light" role="radio" aria-checked="false">☀️ Light</button>
            <button class="mode-btn" data-mode="her" id="mode-btn-her" style="display: none;" role="radio" aria-checked="false">🌷 Her</button>
        </div>
        <div class="header-btns-wrap" style="display: flex; align-items: center; gap: 10px; flex-shrink: 0; margin-left: auto;">
            <button class="header-json-btn" id="check-updates-btn" data-tooltip="Check all themes for updates">
                <span style="font-size: 13px; line-height: 1;">⟳</span>
                <span class="btn-label">Updates</span>
            </button>
            <button class="header-json-btn" id="json-view-btn" data-tooltip="View current theme as JSON">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1"/><path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/></svg>
                <span class="btn-label">JSON</span>
            </button>
        </div>
    </div>
    <div id="action-toast" class="action-toast"></div>

    <div class="tabs" role="tablist" aria-label="Designer sections">
        <div class="tab active" data-tab="lch" role="tab" tabindex="0" aria-selected="true">🎨 Design Studio</div>
        <div class="tab" data-tab="vars" role="tab" tabindex="-1" aria-selected="false">🎯 Color Variables</div>
        <div class="tab" data-tab="custom" role="tab" tabindex="-1" aria-selected="false">✏️ Style Overrides</div>
        <div class="tab" data-tab="canvas" role="tab" tabindex="-1" aria-selected="false">✨ Canvas FX</div>
        <div class="tab" data-tab="bg" role="tab" tabindex="-1" aria-selected="false">🌈 Gradient</div>
        <div class="tab" data-tab="code" role="tab" tabindex="-1" aria-selected="false">📋 CSS Output</div>
        <div class="tab" data-tab="docs" role="tab" tabindex="-1" aria-selected="false">📖 Documentation</div>
    </div>

    <div class="content-area">

        <div id="tab-lch" class="tab-content" role="tabpanel">
            <div class="section-title" style="display: flex; justify-content: space-between; align-items: center;">
                <div>Core Palette</div>
                <div class="flex-center">
                    <label class="toggle-label" data-tooltip="Enable or disable the generated color palette for this mode"><input type="checkbox" id="toggle-palette-enabled" class="cb-input"> Enabled</label>
                    <label class="toggle-label" data-tooltip="Show theme colors on Login/Signup pages (Default: Visible)"><input type="checkbox" id="toggle-theme-auth" class="cb-input"> Show on Auth Pages</label>
                </div>
            </div>
            <div class="control-group">
                <div class="color-row">
                    <div class="color-preview" id="prev-main"></div>
                    <div style="flex:1">
                        <div class="slider-row">
                            <label data-reset="h"><span data-tooltip="Double-click to reset" style="cursor:pointer">Hue</span> <span class="slider-val" id="val-h">250°</span></label>
                            <input type="range" id="sl-h" min="0" max="360" value="250">
                        </div>
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
                    <div class="slider-row">
                        <label data-reset="c"><span data-tooltip="Double-click to reset" style="cursor:pointer">Chroma</span> <span class="slider-val" id="val-c">0.00</span></label>
                        <input type="range" id="sl-c" min="0" max="150" value="0">
                    </div>
                    <div class="slider-row">
                        <label data-reset="l"><span data-tooltip="Double-click to reset" style="cursor:pointer">Lightness</span> <span class="slider-val" id="val-l">20%</span></label>
                        <input type="range" id="sl-l" min="0" max="100" value="20">
                    </div>
                </div>
                <div style="display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end;">
                    <button class="btn" id="random-btn" data-tooltip="Generate random base colors" style="font-size: 0.62rem; padding: 8px 14px;">✦ Randomize</button>
                    <button class="btn" id="extract-btn" data-tooltip="Paste or upload an image to extract palette" style="font-size: 0.62rem; padding: 8px 14px;">◎ Extract</button>
                </div>
            </div>


            <div class="section-title" style="margin-top: 32px;">OKLCH Tonal Ramp</div>
            <div id="ramp-gray" style="display: flex; height: 52px; margin-top: 10px; gap: 6px; margin-bottom: 32px;"></div>

            <div id="gallery-toolbar-theme"></div>

            <div class="section-title" style="margin-top: 16px;"><div>Curated Presets <span style="opacity: 0.5;" id="curated-count-wrap">| <span id="curated-count">0</span></span></div></div>
            <div class="curated-scroll-container">
                <div class="curated-flex">
                    <button class="preset-btn" data-preset="midnight">
                        <div class="preset-dots" id="dot-midnight"></div>
                        Midnight
                        <div class="selected-check">✓</div>
                    </button>
                    <button class="preset-btn" data-preset="emerald">
                        <div class="preset-dots" id="dot-emerald"></div>
                        Emerald
                        <div class="selected-check">✓</div>
                    </button>
                    <button class="preset-btn" data-preset="amber">
                        <div class="preset-dots" id="dot-amber"></div>
                        Amber
                        <div class="selected-check">✓</div>
                    </button>
                    <button class="preset-btn" data-preset="amethyst">
                        <div class="preset-dots" id="dot-amethyst"></div>
                        Amethyst
                        <div class="selected-check">✓</div>
                    </button>
                    <button class="preset-btn" data-preset="ruby">
                        <div class="preset-dots" id="dot-ruby"></div>
                        Ruby
                        <div class="selected-check">✓</div>
                    </button>
                    <button class="preset-btn" data-preset="sapphire">
                        <div class="preset-dots" id="dot-sapphire"></div>
                        Sapphire
                        <div class="selected-check">✓</div>
                    </button>
                    <button class="preset-btn" data-preset="topaz">
                        <div class="preset-dots" id="dot-topaz"></div>
                        Topaz
                        <div class="selected-check">✓</div>
                    </button>
                    <button class="preset-btn" data-preset="obsidian">
                        <div class="preset-dots" id="dot-obsidian"></div>
                        Obsidian
                        <div class="selected-check">✓</div>
                    </button>
                </div>
            </div>
        </div>

        <div id="tab-vars" class="tab-content" role="tabpanel" style="display:none">
            <div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.2);padding:12px;border-radius:14px;font-size:0.65rem;color:var(--text-muted);font-style:italic;margin-bottom:16px;border-left:4px solid var(--accent);display:flex;gap:12px;align-items:center;">
                <span style="font-size:1.1rem">💡</span>
                <span><b>Pro Tip:</b> Click a variable name to copy its CSS code. Locking (🔒) a variable pins it for the <i>currently selected mode</i> and protects it from being changed by sliders, randomization, or image extraction. Mode overrides are managed separately.</span>
            </div>
            
            <div class="section-title" style="align-items: center; margin-bottom: 12px; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px;">
                <div>Individual Variable Overrides</div>
                <div style="display:flex; gap:8px; flex-wrap: wrap; align-items: center; width:100%;">
                    <button class="var-action-btn var-action-static" id="random-btn-vars" data-tooltip="Generate random base colors">✦ Randomize</button>
                    <button class="var-action-btn var-action-static" id="extract-btn-vars" data-tooltip="Paste or upload an image to extract palette">◎ Extract</button>
                    <div style="display:flex; gap:8px; flex-wrap: wrap; margin-left:auto;">
                        <button class="var-action-btn var-action-static" id="lock-all-btn" data-tooltip="Lock All Variables" aria-label="Lock all variables"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="vertical-align:-1px; margin-right:2px;"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>Lock All</button>
                        <button class="var-action-btn var-action-static" id="unlock-all-btn" data-tooltip="Unlock All Variables" aria-label="Unlock all variables"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="vertical-align:-1px; margin-right:2px;"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>Unlock All</button>
                        <button class="var-action-btn var-action-static" id="reset-all-btn" data-tooltip="Reset Unlocked Overrides to Default" aria-label="Reset all unlocked overrides to default">⟲ Reset All</button>
                    </div>
                </div>
            </div>

            <div class="var-scroll">
                <div class="var-grid" id="variable-grid"></div>
            </div>

            <div class="section-title" style="margin-top: 28px; align-items: center; display: flex; justify-content: space-between;">
                <div>Manual Variable Overrides</div>
                <div class="flex-center">
                    <label class="toggle-label" data-tooltip="Enable manual variable overrides for this mode"><input type="checkbox" id="toggle-manual-overrides" class="cb-input"> Enabled</label>
                </div>
            </div>
            <div class="owui-code-block" style="min-height: 180px; max-height: 340px;">
                <div class="owui-code-header">
                    <span class="owui-code-lang">css variables</span>
                    <div class="owui-code-actions">
                        <button class="owui-code-btn" id="clear-manual-overrides-btn" data-tooltip="Clear Manual Overrides">Clear</button>
                        <button class="owui-code-btn copy-css-btn" data-target="manual-overrides-editor" data-tooltip="Copy Overrides to Clipboard">Copy</button>
                    </div>
                </div>
                <textarea id="manual-overrides-editor" spellcheck="false" style="min-height: 140px;" placeholder="/* Define raw CSS variable overrides here.&#10;   These are injected after the theme palette,&#10;   giving them final priority.&#10;   Use standard --variable-name: value; syntax.&#10;   One variable per line. */&#10;&#10;--color-gray-900: #1a1a2e;&#10;--color-gray-950: #0f0f1a;&#10;--color-gray-50: #e8e8f0;"></textarea>
            </div>
        </div>

        <div id="tab-custom" class="tab-content" role="tabpanel" style="display:none; height: 100%;">
            <div class="code-container">
                <div class="section-title section-title-bar">
                    <div>Mode-Specific Raw CSS</div>
                    <div class="flex-center">
                        <label class="toggle-label" data-tooltip="Toggle custom CSS for this mode"><input type="checkbox" id="toggle-custom-css" class="cb-input"> Enabled</label>
                        <label class="toggle-label" data-tooltip="Wraps your CSS in mode selectors. Uncheck if your code uses manual mode prefixes."><input type="checkbox" id="toggle-auto-scope" checked class="cb-input"> Auto-Scope</label>
                        <label class="toggle-label" data-tooltip="Show custom CSS on Login/Signup pages (Default: Visible)"><input type="checkbox" id="toggle-custom-auth" class="cb-input"> Show on Auth Pages</label>
                    </div>
                </div>

                <div class="owui-code-block" style="min-height: 300px; max-height: 300px;">
                    <div class="owui-code-header">
                        <span class="owui-code-lang">css</span>
                        <div class="owui-code-actions">
                            <button class="owui-code-btn" id="save-css-btn" data-tooltip="Save CSS to Gallery" data-action="save-css">Save</button>
                            <button class="owui-code-btn" id="clear-css-btn" data-tooltip="Clear Custom CSS">Clear</button>
                            <button class="owui-code-btn copy-css-btn" data-target="custom-css-editor" data-tooltip="Copy CSS to Clipboard">Copy</button>
                        </div>
                    </div>
                    <textarea id="custom-css-editor" spellcheck="false" placeholder="/* Enter raw CSS here.&#10;   Leave 'Auto-Scope' OFF if you are writing global CSS&#10;   or using manual mode prefixes.&#10;   Turn 'Auto-Scope' ON to safely auto-wrap your CSS&#10;   for this specific mode! */&#10;&#10;#sidebar {&#10;  border-right: 2px solid var(--accent);&#10;}"></textarea>
                </div>

                <div id="gallery-toolbar-css"></div>
            </div>
        </div>

        <div id="tab-canvas" class="tab-content" role="tabpanel" style="display:none; height: 100%;">
            <div class="code-container">
                <div class="section-title section-title-bar">
                    <div>Web Worker Canvas FX <span id="canvas-worker-badge" style="display:none; font-size: 0.55rem; font-weight: 800; padding: 2px 6px; border-radius: 12px; margin-left: 8px; vertical-align: middle; text-transform: uppercase; letter-spacing: 0.05em;"></span></div>
                    <div class="flex-center">
                        <label class="toggle-label" data-tooltip="Run animation script in background"><input type="checkbox" id="toggle-canvas-fx" class="cb-input"> Enabled</label>
                        <label class="toggle-label" data-tooltip="Show animations on Login/Signup pages (Default: Visible)"><input type="checkbox" id="toggle-canvas-auth" class="cb-input"> Show on Auth Pages</label>
                    </div>
                </div>
                
                <div class="owui-code-block" style="min-height: 300px; max-height: 300px;">
                    <div class="owui-code-header">
                        <span class="owui-code-lang">javascript</span>
                        <div class="owui-code-actions">
                            <button class="owui-code-btn" id="save-canvas-btn" data-tooltip="Save Script to Gallery" data-action="save-canvas">Save</button>
                            <button class="owui-code-btn" id="clear-canvas-btn" data-tooltip="Clear Canvas Script">Clear</button>
                            <button class="owui-code-btn copy-css-btn" data-target="canvas-fx-editor" data-tooltip="Copy JS to Clipboard">Copy</button>
                        </div>
                    </div>
                    <textarea id="canvas-fx-editor" spellcheck="false" placeholder="/* Enter Canvas animation script here.&#10;   When enabled, your script runs safely&#10;   in the background (if supported).&#10;   Open WebUI's structural wrappers will&#10;   turn transparent so the animation is&#10;   fully visible underneath! */"></textarea>
                </div>

                <div id="gallery-toolbar-canvas"></div>
            </div>
        </div>

        <div id="tab-bg" class="tab-content" role="tabpanel" style="display:none;">
            <div class="section-title section-title-bar">
                <div>System Gradient Background</div>
                <div class="flex-center">
                    <label class="toggle-label" data-tooltip="Enable gradient background"><input type="checkbox" id="toggle-gradient-bg" class="cb-input"> Enabled</label>
                    <label class="toggle-label" data-tooltip="Slowly shift gradient position with a looping animation"><input type="checkbox" id="toggle-gradient-animation" class="cb-input"> Animate</label>
                    <label class="toggle-label" data-tooltip="Show gradient on Login/Signup pages (Default: Visible)"><input type="checkbox" id="toggle-gradient-auth" checked class="cb-input"> Show on Auth Pages</label>
                </div>
            </div>

            <div id="gradient-conflict-warning" style="display:none; background: rgba(217, 119, 6, 0.12); border: 1px solid rgba(217, 119, 6, 0.35); border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; font-size: 0.7rem; color: #f59e0b; line-height: 1.5;">
                ⚠️ <strong>Gradient conflict detected</strong> — Your <em>Custom CSS Snippet</em> contains gradient background rules. Because the Custom CSS Snippet is injected <em>after</em> the Gradient Builder output in the final stylesheet, its <code>background-image</code> declaration will <strong>override</strong> the Gradient Builder's gradient via CSS cascade. To use the Gradient Builder's output, remove or disable the conflicting gradient rules in your <strong>Custom CSS Snippet</strong> on the <strong>CSS Output</strong> tab.
            </div>

            <div class="control-group" id="gradient-controls-group">
                <div style="margin-bottom: 16px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                        <div class="sub-label">Gradient Type</div>
                    </div>
                    <div class="gradient-type-pills" id="gradient-type-pills" role="group" aria-label="Gradient type">
                        <button class="gradient-type-pill active" data-gtype="linear" aria-pressed="true">Linear</button>
                        <button class="gradient-type-pill" data-gtype="radial" aria-pressed="false">Radial</button>
                        <button class="gradient-type-pill" data-gtype="mesh" aria-pressed="false">Mesh</button>

                    </div>
                </div>

                <div id="gradient-radial-controls" style="display:none; margin-top: 12px; padding-top: 14px; border-top: 1px dashed var(--border);">
                    <div class="sub-label-mb">Radial Settings</div>
                    <div style="display: flex; gap: 16px; align-items: flex-start;">
                        <div style="display: flex; flex-direction: column; align-items: center; flex-shrink: 0;">
                            <div class="radial-xy-pad" id="radial-xy-pad" data-tooltip="Drag to set gradient center. Double-click to reset." role="application" aria-label="Gradient center position" tabindex="0">
                                <div class="radial-xy-dot" id="radial-xy-dot" style="left:50%;top:50%;"></div>
                            </div>
                            <div class="radial-xy-label" id="radial-xy-label">50%, 50%</div>
                        </div>
                        <div style="flex: 1; display: flex; flex-direction: column; gap: 10px;">
                            <div>
                                <div style="font-size: 0.6rem; color: var(--text-muted); font-weight: 700; margin-bottom: 6px;">Shape</div>
                                <div class="radial-shape-pills" id="radial-shape-pills" role="group" aria-label="Radial shape">
                                    <button class="radial-shape-pill active" data-shape="ellipse" aria-pressed="true">Ellipse</button>
                                    <button class="radial-shape-pill" data-shape="circle" aria-pressed="false">Circle</button>
                                </div>
                            </div>
                            <div>
                                <div style="font-size: 0.6rem; color: var(--text-muted); font-weight: 700; margin-bottom: 6px;">Size</div>
                                <div class="radial-size-pills" id="radial-size-pills" role="group" aria-label="Radial size">
                                    <button class="radial-size-pill active" data-size="farthest-corner" data-tooltip="Extends to farthest corner" aria-pressed="true">Farthest Corner</button>
                                    <button class="radial-size-pill" data-size="closest-side" data-tooltip="Extends to closest side" aria-pressed="false">Closest Side</button>
                                    <button class="radial-size-pill" data-size="farthest-side" data-tooltip="Extends to farthest side" aria-pressed="false">Farthest Side</button>
                                    <button class="radial-size-pill" data-size="closest-corner" data-tooltip="Extends to closest corner" aria-pressed="false">Closest Corner</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div id="gradient-mesh-controls" style="display:none; margin-top: 12px; padding-top: 14px; border-top: 1px dashed var(--border);">
                    <div class="sub-label-mb">Mesh Editor</div>
                    <div class="mesh-editor-pad" id="mesh-editor-pad" role="application" aria-label="Mesh gradient editor. Click to add points, drag to move, double-click to remove." tabindex="0"></div>
                    <div class="mesh-hint" id="mesh-hint">Click to add · Drag to move · Double-click to remove</div>
                    <div id="mesh-stops-section" style="margin-top: 14px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <div class="sub-label">Color Stops</div>
                            <div style="font-size: 0.6rem; color: var(--text-muted);" id="mesh-stop-count">0/16 points</div>
                        </div>
                        <div class="mesh-stops-list" id="mesh-stops-list">
                            <!-- Injected by JS -->
                        </div>
                        <button class="gradient-add-stop" id="mesh-add-stop-btn" data-action="add-mesh-stop" style="margin-top:8px;">
                            <i data-icon="plus"></i>
                            Add Color Stop
                        </button>
                    </div>
                    <div style="display:flex; align-items:center; gap:10px; margin-top:12px;">
                        <div style="font-size:0.6rem; color:var(--text-muted); font-weight:700;">Base Color</div>
                        <div class="gradient-stop-swatch" id="mesh-bg-swatch" style="width:24px;height:24px;"><input type="color" id="mesh-bg-color" value="#0a0a12"></div>
                        <div style="flex:1;"></div>
                    </div>
                </div>

                <div id="gradient-preview-section" style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border);">
                    <div style="font-size: 0.65rem; color: var(--text-muted); font-weight: 800; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 10px;">Preview</div>
                    <div class="gradient-preview-bar empty" id="gradient-preview-bar"></div>
                </div>

                <div id="gradient-stops-section" style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <div class="sub-label">Color Stops</div>
                        <div style="font-size: 0.6rem; color: var(--text-muted);" id="gradient-stop-count">0/16 stops</div>
                    </div>
                    <div class="gradient-stops-list" id="gradient-stops-list">
                        <!-- Injected by JS -->
                    </div>
                    <button class="gradient-add-stop" id="gradient-add-stop-btn" data-action="add-gradient-stop">
                        <i data-icon="plus"></i>
                        Add Color Stop
                    </button>
                </div>

                <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--border);">
                    <div style="font-size: 0.65rem; color: var(--text-muted); font-weight: 800; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 14px;">Controls</div>
                    <div class="slider-row" id="gradient-angle-row">
                        <label data-reset="gradient-angle"><span data-tooltip="Double-click to reset to 135°" style="cursor:pointer">Gradient Direction</span> <span class="slider-val" id="val-gradient-angle">135°</span></label>
                        <input type="range" id="sl-gradient-angle" min="0" max="360" value="135">
                    </div>
                    <div class="slider-row">
                        <label data-reset="gradient-intensity"><span data-tooltip="Double-click to reset to 85%" style="cursor:pointer">Color Intensity</span> <span class="slider-val" id="val-gradient-intensity">85%</span></label>
                        <input type="range" id="sl-gradient-intensity" min="0" max="100" value="85">
                    </div>
                    <div id="gradient-speed-row-wrapper">
                        <div class="slider-row" id="gradient-speed-row" style="margin-top: 10px; display: none;">
                            <label data-reset="gradient-speed"><span data-tooltip="Double-click to reset to 8s" style="cursor:pointer">Animation Speed</span> <span class="slider-val" id="val-gradient-speed">8s</span></label>
                            <input type="range" id="sl-gradient-speed" min="2" max="30" value="8">
                        </div>
                    </div>
                </div>

                <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--border);">
                    <div style="font-size: 0.65rem; color: var(--text-muted); font-weight: 800; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 14px;">Quick Actions</div>
                    <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px;">
                        <button class="btn btn-sm" data-action="reverse-gradient" data-tooltip="Reverse stop order (flip gradient)" id="gradient-reverse-btn" style="grid-column: span 2;">⇄ Reverse</button>
                        <button class="btn btn-sm" data-action="distribute-gradient" data-tooltip="Space stops evenly across 0–100%" id="gradient-distribute-btn" style="grid-column: span 2;">⫶ Distribute</button>
                        <button class="btn btn-sm" data-action="random-gradient" data-tooltip="Generate a random gradient" style="grid-column: span 2;">✦ Random</button>
                        <button class="btn btn-sm" data-action="reset-gradient" data-tooltip="Clear all gradient stops" style="grid-column: span 3;">⟲ Reset</button>
                        <button class="btn btn-sm" id="gradient-transfer-btn" data-tooltip="Copy current colors to other gradient types" data-action="toggle-transfer" style="grid-column: span 3;">⇌ Transfer Colors</button>
                    </div>
                    <div id="gradient-transfer-panel" style="display:none; margin-top: 12px; padding: 14px 16px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-deep);">
                        <div style="font-size: 0.65rem; font-weight: 700; color: var(--text-main); margin-bottom: 10px;">Transfer colors from <span id="transfer-source-label" style="color: var(--accent); font-weight:800;"></span> to:</div>
                        <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom: 12px;" id="transfer-targets">
                            <label id="transfer-target-linear" class="toggle-label-gap5"><input type="checkbox" class="cb-input" value="linear"> Linear</label>
                            <label id="transfer-target-radial" class="toggle-label-gap5"><input type="checkbox" class="cb-input" value="radial"> Radial</label>
                            <label id="transfer-target-mesh" class="toggle-label-gap5"><input type="checkbox" class="cb-input" value="mesh"> Mesh</label>
                        </div>
                        <div style="display:flex; gap:8px; justify-content:flex-end;">
                            <button class="btn" style="font-size:0.62rem; padding:6px 14px;" data-action="toggle-transfer">Cancel</button>
                            <button class="btn" style="font-size:0.62rem; padding:6px 14px; background:var(--accent) !important; color:white !important; border:none;" data-action="execute-transfer">Transfer</button>
                        </div>
                    </div>
                </div>
            </div>

            <div style="margin-top: 24px;">
                <div id="gallery-toolbar-gradient"></div>
            </div>
        </div>

        <div id="tab-code" class="tab-content" role="tabpanel" style="display:none; height: 100%;">
            <div class="code-container" style="gap: 20px;">
                <div style="display: flex; flex-direction: column; flex: 1;">
                    <div class="section-title">Tailwind v4 @theme Block</div>
                    
                    <div class="owui-code-block" style="min-height: 180px; max-height: 400px;">
                        <div class="owui-code-header">
                            <span class="owui-code-lang">
                                css
                                <label class="toggle-label-ml" data-tooltip="Compress output for production"><input type="checkbox" id="toggle-minify-tailwind" class="cb-input"> Minify</label>
                            </span>
                            <div class="owui-code-actions">
                                <button class="owui-code-btn" id="download-tailwind-btn" data-tooltip="Download Tailwind CSS Block">Download</button>
                                <button class="owui-code-btn copy-css-btn" data-target="tailwind-css" data-tooltip="Copy CSS to Clipboard">Copy</button>
                            </div>
                        </div>
                        <textarea id="tailwind-css" spellcheck="false" readonly></textarea>
                    </div>
                </div>
                
                <div style="display: flex; flex-direction: column; flex: 1;">
                    <div class="section-title">Raw CSS Output</div>
                    
                    <div class="owui-code-block" style="min-height: 250px; max-height: 400px;">
                        <div class="owui-code-header">
                            <span class="owui-code-lang">
                                css
                                <label class="toggle-label-ml" data-tooltip="Compress output for production"><input type="checkbox" id="toggle-minify-css" class="cb-input"> Minify</label>
                            </span>
                            <div class="owui-code-actions">
                                <button class="owui-code-btn" id="download-css-btn" data-tooltip="Download CSS File">Download</button>
                                <button class="owui-code-btn copy-css-btn" data-target="raw-css" data-tooltip="Copy CSS to Clipboard">Copy</button>
                            </div>
                        </div>
                        <textarea id="raw-css" spellcheck="false" readonly></textarea>
                    </div>
                </div>
            </div>
        </div>

        <div id="tab-docs" class="tab-content" role="tabpanel" style="display:none;">
            <div class="docs-container">
                
                <details class="doc-accordion">
                    <summary>1. Getting Started & Architecture <i data-icon="chevron"></i></summary>
                    <div class="doc-inner">
                        <p>Theme Designer Pro is an <b>Event Function</b> that registers a standalone admin page at <code>{ROUTE_BASE}</code>. Admins access the designer by navigating directly to that URL (configurable via the <b>Designer URL</b> valve). It uses a multi-layer schema separating core color logic from manual overrides, custom CSS, and structural transparency, and persists themes server-side so they apply to <b>all users</b> in real-time.</p>
                        <ul>
                            <li><b>Admin-Only Design Page:</b> Only administrators can access the designer page. The generated theme is served to all users via a bootloader script injected into <code>index.html</code>.</li>
                            <li><b>Persistence Engine:</b> Themes are persisted server-side in <code>DATA_DIR/theme/</code> as <code>open_theme_designer.css</code>, <code>open_theme_designer.json</code>, and <code>open_theme_designer_library.json</code>. On page load, the server embeds a safe subset of theme CSS inline into <code>index.html</code> (with structural/gradient rules stripped to prevent a white flash before canvas loads). The bootloader then fetches the full CSS from <code>{ROUTE_BASE}/theme.css</code> and applies it — including the deferred structural/gradient rules. State JSON is also embedded directly into <code>index.html</code> &mdash; eliminating an async fetch for state data. The system uses <code>localStorage</code> only as a write-through backup for offline/Watchtower recovery scenarios.</li>
                            <li><b>Live Push via SSE:</b> Theme changes are broadcast to <b>all connected users in real-time</b> using Server-Sent Events (SSE). When the admin edits the theme, the updated CSS and state are pushed inline to every open browser tab — across container tabs, different browsers, and different devices — with no page refresh required. The SSE channel at <code>{ROUTE_BASE}/events</code> auto-reconnects on connection loss (retry interval: 3 seconds) and survives function hot-reloads.</li>
                            <li><b>SSE Heartbeat:</b> The server sends a keep-alive heartbeat every 30 seconds to detect stale connections. If a client disconnects (closes the tab, loses network), the server-side queue is automatically cleaned up.</li>
                            <li><b>SSE Hot-Reload Persistence:</b> SSE connections survive function re-saves (hot-reloads). The client list is stored on the ASGI app's state object, which persists across module reloads. This means re-saving the function code in the admin panel does <b>not</b> break live push to existing tabs.</li>
                            <li><b>Theme Disable/Re-Enable:</b> When the <b>Theme Active</b> valve is toggled OFF and a system event fires (e.g., a chat message or user login), the server detects the change and broadcasts a <code>theme-disable</code> SSE event that strips all theme-related elements (styles, canvas, background div, script runner) and clears <code>localStorage</code> on every connected client &mdash; no page refresh needed. When toggled back ON, the server broadcasts a <code>theme-update</code> event that re-applies the theme to all clients. See Section 17 for details on the detection mechanism.</li>
                            <li><b>Server Sync:</b> When the admin makes changes, they are automatically synced to the server via POST to <code>{ROUTE_BASE}</code> (debounced at 250ms). The server saves the CSS and state files, re-injects the bootloader, and broadcasts the update to all SSE clients.</li>
                            <li><b>Draft Mode:</b> Toggle between <b>Live</b> and <b>Draft</b> mode via the header switch. In Draft mode, changes are only visible on the designer page itself — they are <b>not</b> synced to the server or pushed to other users. Click <b>Publish</b> (or switch the toggle back to Live) to push all draft changes live. See Section 4 for full details.</li>
                            <li><b>Draft Isolation:</b> In Draft mode, the <code>syncToServer()</code> function is gated off &mdash; changes are rendered locally on the designer page but never pushed to the server or broadcast via SSE. The Storage wrapper automatically routes bootloader-watched keys (<code>theme</code>, <code>css_cache</code>) to <code>sessionStorage</code> instead of <code>localStorage</code>, ensuring that other tabs &mdash; which read theme data from the server (via embedded index.html data or SSE) &mdash; never see draft changes.</li>
                            <li><b>Hot Reload:</b> The function hot-reloads when updated in the admin panel — no server restart is needed.</li>
                            <li><b>Auto-Save:</b> Your active theme configuration is saved automatically after every change. No manual save is required — use the <b>Save (+)</b> button only to create named snapshots in your theme library.</li>
                            <li><b>Core Palette:</b> The OKLCH color palette is enabled by default for all modes. Use the <b>Enabled</b> toggle in the Core Palette section to disable palette generation for a specific mode if you prefer to manage colors entirely through manual overrides.</li>
                            <li><b>Auth Pages:</b> You can selectively toggle theme components (Colors, Custom CSS, Canvas FX, and Gradient Background) for the Login/Signup screens using the individual <b>Show on Auth Pages</b> checkboxes. By default, all four components are visible on auth pages.</li>
                            <li><b>Adaptive UI:</b> The designer's interface automatically adapts to match your current Open WebUI theme, seamlessly switching between dark and light appearances.</li>
                            <li><b>Layer Order:</b> The generated CSS applies in this order: <i>OKLCH Palette → Manual Variable Overrides → Structural Rules → Gradient Background → Custom CSS</i>. Each layer can override the one before it.</li>
                            <li><b>Session Persistence:</b> The designer utilizes <code>sessionStorage</code> to remember exactly which tab you were working in. If you navigate away and return to the designer, it will restore your last active tab automatically.</li>
                            <li><b>Legacy Data Migration:</b> Upgrading from an older version? The designer automatically detects legacy data structures and gracefully migrates your saved snapshots and active themes to the latest format without data loss.</li>
                            <li><b>Live Cross-UI Detection:</b> The designer actively listens to your environment. If you change the Open WebUI theme natively (via OS settings or keyboard shortcuts) while the designer is open, it will instantly switch its internal mode tab to match your live environment.</li>
                            <li><b>Valves:</b> Admins can configure feature gating (enable/disable Canvas FX, Custom CSS, Gradient Builder, auth page theming, URL imports) and the designer URL via Valves in the function settings. The <b>Designer URL</b> valve must start with <code>/api/v1/</code> — if it doesn't, the system auto-corrects it to prevent the SPA catch-all from intercepting the route.</li>
                            <li><b>Self-Adapting UI &amp; Contrast Protection:</b> The Theme Designer Pro interface dynamically themes <i>itself</i> based on the colors you pick. It includes built-in contrast protection, automatically shifting text and border colors to remain legible if you create ultra-washed-out palettes.</li>
                            <li><b>Fully Responsive:</b> The designer interface seamlessly adapts to mobile screens so you can tweak your theme on the go.</li>
                            <li><b>Canvas FX Security:</b> Canvas FX scripts are arbitrary JavaScript executed in all users' browsers. Only administrators can set Canvas FX scripts through the designer. <b>Never paste untrusted scripts</b> — always review Canvas FX code before enabling it, especially scripts obtained from third parties.</li>
                        </ul>
                    </div>
                </details>

                <details class="doc-accordion">
                    <summary>2. OKLCH Foundation & Modes <i data-icon="chevron"></i></summary>
                    <div class="doc-inner">
                        <p>Unlike standard hex-based themes, this designer uses the <b>OKLCH</b> color space to generate perceptually uniform palettes. This means the visual "weight" of colors remains identical as you shift hues.</p>
                        <ul>
                            <li><b>Global Modes:</b> Easily switch between <b>Dark</b>, <b>OLED</b> (pure black), <b>Light</b>, <b>Her</b>, and <b>System</b> modes using the segmented toggle. Settings, variables, and CSS are managed entirely separately for each mode. System mode proxies to your OS preference (see Section 3). <i>Note: The Her tab dynamically reveals itself by securely syncing with the Open WebUI administrator's <code>enable_easter_eggs</code> configuration in real-time via the <code>/api/config</code> endpoint.</i></li>
                            <li><b>Hue / Chroma / Lightness:</b> Control the base angle, intensity, and brightness. <i>(Pro-Tip: Double-click any slider label to reset it to default).</i></li>
                            <li><b>Tonal Ramp:</b> Below the sliders, the OKLCH Tonal Ramp visualizes the generated 12-step color scale. Click any block in the ramp to copy its hex value to your clipboard.</li>
                            <li><b>Curated Presets:</b> The <b>Design Studio</b> tab includes a built-in gallery of hand-tuned color presets. Click any preset to instantly apply its hue, chroma, and lightness values to the current mode. Each curated preset also includes a bundled gradient background configuration. When applied via Sync, the gradient is automatically loaded alongside the palette colors.</li>
                            <li><b>Sync:</b> Click the <b>Sync</b> button in the footer to selectively copy palette, overrides, CSS, Canvas FX, Gradient Background, or auth settings from the current mode to one or more target modes. Colored badges appear next to each option indicating whether the source and target are already <span style="color:#10b981;">in sync</span> or have <span style="color:#f59e0b;">differences</span>.</li>
                        </ul>
                    </div>
                </details>

                <details class="doc-accordion">
                    <summary>3. System Theme & OS Integration <i data-icon="chevron"></i></summary>
                    <div class="doc-inner">
                        <p>The <b>System</b> mode allows Open WebUI to automatically follow your Operating System's theme preference (Light vs. Dark).</p>
                        <ul>
                            <li><b>Real-time Detection:</b> The designer actively listens for OS theme changes. Switching your system to Dark mode will instantly apply your <b>Dark</b> design set, including your specific Canvas FX and Custom CSS.</li>
                            <li><b>Isolation:</b> When in System mode, the designer acts as a proxy for the currently active design. Editing sliders or overrides will save data to the design set your system is currently using.</li>
                            <li><b>Dual-Layer CSS:</b> The generated CSS includes native <code>@media (prefers-color-scheme)</code> blocks. This ensures your theme remains applied even if browser class management is delayed or overridden by the application.</li>
                        </ul>
                    </div>
                </details>

                <details class="doc-accordion">
                    <summary>4. Draft Mode & Publishing <i data-icon="chevron"></i></summary>
                    <div class="doc-inner">
                        <p>Draft Mode lets you preview and iterate on theme changes without pushing them live to users. It's designed for safe experimentation.</p>
                        <h4>How It Works</h4>
                        <ul>
                            <li><b>Toggle:</b> Click the <b>Live / Draft</b> switch in the header to enter Draft mode. A pulsing amber dot and <b>DRAFT</b> badge indicate you're in draft mode.</li>
                            <li><b>Local-Only:</b> In Draft mode, theme CSS and state are <b>not</b> synced to the server or pushed to other users via SSE. However, library data (snapshots, presets) continues to sync to the server normally — only the CSS and state are sent as empty stubs, preventing draft theme content from leaking. The designer page <i>is</i> your preview surface.</li>
                            <li><b>Draft Isolation:</b> In Draft mode, the <code>syncToServer()</code> function is gated off — theme CSS and state are written to <code>sessionStorage</code> (tab-scoped) but never pushed to the server or broadcast via SSE. The <code>syncLibrary()</code> function still runs to keep presets in sync, but sends empty CSS/state and sets <code>suppress_broadcast: true</code>. Since other tabs read theme data from the server (via embedded index.html data or SSE), and <code>sessionStorage</code> is invisible to other tabs, draft changes remain fully isolated to the designer tab.</li>
                        </ul>
                        <h4>Publishing</h4>
                        <ul>
                            <li><b>Publish Button:</b> Click the <b>Publish</b> button that appears in Draft mode to push all pending changes to the server and broadcast them to all users via SSE. The toast confirms: "Published! Theme pushed to all users."</li>
                            <li><b>Toggle Back:</b> Switching the toggle from Draft back to Live is equivalent to clicking Publish — it triggers the same sync and broadcast.</li>
                            <li><b>Discard:</b> If you close the tab without publishing, your draft changes are lost — they are stored in <code>sessionStorage</code>, which is tab-scoped and destroyed when the tab closes. Within the same tab session, draft changes survive page refreshes. The last-published server-side theme remains active for everyone else.</li>
                        </ul>
                        <h4>What Draft Mode Does NOT Do</h4>
                        <ul>
                            <li>It does <b>not</b> apply draft changes to regular OWUI pages — even for the admin. The designer page is the only preview surface.</li>
                            <li>It does <b>not</b> persist draft state across browser sessions or tab closures. Closing the tab or browser discards the draft. However, refreshing the page within the same tab session preserves your working state via <code>sessionStorage</code>.</li>
                        </ul>
                    </div>
                </details>

                <details class="doc-accordion">
                    <summary>5. Variable Overrides & Locks (🔒) <i data-icon="chevron"></i></summary>
                    <div class="doc-inner">
                        <p>While the OKLCH engine dynamically calculates a 12-step ramp, you can manually override any individual step in the <b>Color Variables</b> tab.</p>
                        <h4>Color Picker Overrides</h4>
                        <ul>
                            <li><b>Locking Variables:</b> Clicking the lock (🔒) icon pins a variable. Locked variables are protected and will NOT be overwritten if you change the OKLCH sliders, randomize the theme, or extract a palette from an image. Use the bulk <b>Lock All</b> / <b>Unlock All</b> buttons to quickly pin or release the entire variable set at once.</li>
                            <li><b>Click-to-Copy:</b> Click any variable name (e.g., <i>gray-900</i>) to instantly copy its CSS declaration (<code>--color-gray-900: #hex;</code>) to your clipboard.</li>
                            <li><b>Contrast Preview:</b> Each color swatch features an <b>Aa</b> contrast preview badge for at-a-glance legibility assessment. The badge text color automatically adjusts based on the swatch's lightness to remain readable.</li>
                        </ul>
                        <h4>Manual Variable Overrides</h4>
                        <p>Below the color picker grid, you'll find the <b>Manual Variable Overrides</b> code block. This feature is inspired by the legacy Open WebUI Theming system fork and gives power users direct control over CSS custom properties.</p>
                        <ul>
                            <li><b>Purpose:</b> Define raw CSS variable declarations (e.g., <code>--color-gray-900: #1a1a2e;</code>) that are injected <i>after</i> the generated palette, giving them final override priority.</li>
                            <li><b>Mode-Specific:</b> Overrides are saved independently per mode (Dark, OLED, Light, Her). Switching modes loads that mode's specific overrides.</li>
                            <li><b>Enabled Toggle:</b> Use the checkbox to quickly enable or disable manual overrides without losing your code.</li>
                            <li><b>Syntax:</b> Write one variable per line using standard <code>--variable-name: value;</code> syntax. Comments (<code>/* */</code> and <code>//</code>) are automatically skipped. The designer appends <code>!important</code> for you.</li>
                            <li><b>System Mode:</b> Manual overrides include automatic <code>@media (prefers-color-scheme)</code> support, ensuring they work correctly when the user's OS theme preference is set to System.</li>
                        </ul>
                    </div>
                </details>
                
                <details class="doc-accordion">
                    <summary>6. Custom CSS & Auto-Scoping <i data-icon="chevron"></i></summary>
                    <div class="doc-inner">
                        <p>Write raw CSS overrides using a robust code editor with auto-indentation, bracket pairing, and auto-closing pairs. Your CSS is saved <i>per-mode</i>. Use the <b>Preset Gallery</b> to save, rename, and manage reusable snippets.</p>
                        <ul>
                            <li><b>Auto-Scope:</b> When enabled, your CSS is automatically wrapped in the appropriate mode selectors (e.g., <code>html.dark</code>). <code>@keyframes</code> blocks are intelligently extracted and placed outside the scoped wrapper. This prevents your Dark mode CSS from accidentally ruining your Light mode styling.</li>
                            <li><b>Raw Mode:</b> Disable Auto-Scope if you prefer to write global rules or manually write your own target selectors. In this mode, <code>:root</code> references are automatically replaced with the mode's selector.</li>
                            <li><b>Show on Auth Pages:</b> Toggle whether your custom CSS applies on Login/Signup screens. Enabled by default.</li>
                            <li><b>Import/Export:</b> Drag and drop native <code>.css</code> files directly into the UI, or export your snippets for easy sharing.</li>
                            <li><b>Editor Features:</b> The code editor traps the <b>Tab</b> key to insert 2-space indents, includes a synced <b>line number gutter</b>, and auto-closes matching brackets and quotes as you type.</li>
                        </ul>
                        <h4>Changing Fonts</h4>
                        <p>You can change the global font family for your entire Open WebUI instance by pasting a CSS rule into the editor. Because Open WebUI relies on Tailwind utility classes, using the global selector with <code>!important</code> is the cleanest way to force a unified look. Here are a few quick examples:</p>
                        <p style="font-size:0.7rem; font-weight:700; margin-top:10px; margin-bottom:4px; opacity:0.9;">Native OS (San Francisco / Segoe UI)</p>
                        <div style="position: relative;">
                        <pre class="doc-pre-sm" id="font-example-native"><code>body, input, textarea, button, select, * {
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Helvetica, sans-serif !important;
  letter-spacing: -0.01em !important;
}</code></pre>
                            <button class="owui-code-btn" style="position: absolute; top: 6px; right: 6px; font-size: 0.6rem;" onclick="navigator.clipboard.writeText(document.getElementById('font-example-native').textContent).then(()=>showToast('Copied to clipboard'))">Copy</button>
                        </div>
                        <p style="font-size:0.7rem; font-weight:700; margin-bottom:4px; opacity:0.9;">Hacker Terminal (Monospace)</p>
                        <div style="position: relative;">
                        <pre class="doc-pre-sm" id="font-example-mono"><code>body, input, textarea, button, select, * {
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', 'Courier New', monospace !important;
}</code></pre>
                            <button class="owui-code-btn" style="position: absolute; top: 6px; right: 6px; font-size: 0.6rem;" onclick="navigator.clipboard.writeText(document.getElementById('font-example-mono').textContent).then(()=>showToast('Copied to clipboard'))">Copy</button>
                        </div>
                        <p style="font-size:0.7rem; font-weight:700; margin-bottom:4px; opacity:0.9;">Editorial (Serif)</p>
                        <div style="position: relative;">
                        <pre class="doc-pre-sm" id="font-example-serif"><code>body, input, textarea, button, select, * {
  font-family: 'Georgia', 'Cambria', 'Times New Roman', serif !important;
  line-height: 1.65 !important;
}</code></pre>
                            <button class="owui-code-btn" style="position: absolute; top: 6px; right: 6px; font-size: 0.6rem;" onclick="navigator.clipboard.writeText(document.getElementById('font-example-serif').textContent).then(()=>showToast('Copied to clipboard'))">Copy</button>
                        </div>
                    </div>
                </details>

                <details class="doc-accordion">
                    <summary>7. Canvas FX Animations <i data-icon="chevron"></i></summary>
                    <div class="doc-inner">
                        <p>Inject interactive JavaScript animations directly into the background of Open WebUI. The designer automatically applies a <i>Structural Layer</i> that makes native UI components transparent so the animation shines through.</p>
                        <ul>
                            <li><b>Background Worker Execution:</b> By default, scripts run in a true background Web Worker utilizing <code>OffscreenCanvas</code> (if supported by your browser) to ensure high-performance rendering without blocking the UI thread. It falls back to the main thread in two cases: (1) the browser doesn't support <code>OffscreenCanvas</code>, or (2) the script throws a runtime error in the Worker (e.g., referencing <code>document</code>, which is unavailable in Workers) — the runtime automatically catches the error, terminates the broken Worker, and re-runs the script on the main thread. A status badge in the designer UI shows the browser's <code>OffscreenCanvas</code> capability.</li>
                            <li><b>Event Handling:</b> Four message types are sent to your script via <code>self.onmessage</code>: <code>init</code> (with canvas, width, height), <code>mousemove</code> (with x, y coordinates), <code>resize</code> (with updated width, height), and <code>context</code> (with live chat context metrics &mdash; message count, character count, estimated tokens).</li>
                            <li><b>Show on Auth Pages:</b> Toggle whether canvas animations appear on Login/Signup screens. Enabled by default.</li>
                            <li><b>Preset Gallery:</b> Save, rename, update, delete, and export individual animations. You can directly import native <code>.js</code> animation files by dragging and dropping them into the UI!</li>

                        </ul>

                        <h4 style="font-size: 0.78rem; font-weight: 800; margin: 24px 0 12px; color: var(--text-main); letter-spacing: -0.01em;">Canvas Worker Protocol</h4>
                        <p>Your Canvas FX script runs inside a <b>Web Worker</b> with an <code>OffscreenCanvas</code>. The runtime communicates with your script using a structured message protocol via <code>self.onmessage</code>. Understanding this contract is essential for writing reliable animations.</p>

                        <p class="doc-subheading">Inbound Messages (Runtime &rarr; Your Script)</p>
                        <p>Four message types are dispatched to your script's <code>self.onmessage</code> handler:</p>
                        <table class="doc-table-compact">
                            <thead>
                                <tr style="border-bottom: 1px solid var(--border);">
                                    <th>Type</th>
                                    <th>Payload</th>
                                    <th>When</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr style="border-bottom: 1px solid var(--border);">
                                    <td><code>init</code></td>
                                    <td><code>{ canvas, width, height }</code></td>
                                    <td>Fired once on startup. <code>canvas</code> is an <code>OffscreenCanvas</code> transferred via <code>postMessage</code>. Call <code>canvas.getContext('2d')</code> to obtain your drawing context. <code>width</code> and <code>height</code> are the initial viewport dimensions.</td>
                                </tr>
                                <tr style="border-bottom: 1px solid var(--border);">
                                    <td><code>resize</code></td>
                                    <td><code>{ width, height }</code></td>
                                    <td>Fired when the browser window is resized. Update your internal <code>width</code>/<code>height</code> and <code>canvas.width</code>/<code>canvas.height</code> accordingly.</td>
                                </tr>
                                <tr style="border-bottom: 1px solid var(--border);">
                                    <td><code>mousemove</code></td>
                                    <td><code>{ x, y }</code></td>
                                    <td>Fired on cursor movement (throttled to once per <code>requestAnimationFrame</code>). Coordinates are <code>clientX</code>/<code>clientY</code> (viewport-relative).</td>
                                </tr>
                                <tr>
                                    <td><code>context</code></td>
                                    <td><code>{ messages, chars, estimatedTokens }</code></td>
                                    <td>Fired when chat content changes (debounced to every ~2s). <code>messages</code> is the number of message elements visible, <code>chars</code> is the total character count across all messages, and <code>estimatedTokens</code> is <code>chars / 4</code> (rough approximation). Enables context-aware animations that grow or change as the conversation progresses. External scripts can also dispatch custom data via <code>window.dispatchEvent(new CustomEvent('owui-canvas-context', { detail: { ... } }))</code>.</td>
                                </tr>
                            </tbody>
                        </table>

                        <p class="doc-subheading">Heartbeat Keepalive (Recommended)</p>
                        <p>Your script <b>should</b> send periodic heartbeat messages back to the main thread using <code>self.postMessage()</code>. While not strictly enforced by the runtime, including a heartbeat is a best practice that signals your worker is alive and functioning correctly. A 1-second interval is recommended:</p>
                        <pre class="doc-pre"><code>setInterval(() =&gt; {
  self.postMessage({ type: 'heartbeat' });
}, 1000);</code></pre>

                        <p class="doc-subheading">Animation Loop</p>
                        <p><code>requestAnimationFrame()</code> is available inside Web Workers that hold an <code>OffscreenCanvas</code>. Use it for your render loop. Avoid using <code>setInterval</code> for rendering &mdash; <code>requestAnimationFrame</code> syncs to the display refresh rate and pauses when the tab is hidden.</p>

                        <p class="doc-subheading">Lifecycle &amp; Cleanup</p>
                        <p>When the theme mode changes, or the user disables Canvas FX, the runtime calls <code>worker.terminate()</code>. Your script does not need to handle cleanup &mdash; termination is immediate and the Blob URL is revoked automatically. A fresh worker is created if Canvas FX is re-enabled or the mode switches to one with a different script.</p>

                        <p class="doc-subheading">Main Thread Fallback</p>
                        <p>Your script runs on the main thread in a sandboxed scope in two cases: (1) the browser does not support <code>OffscreenCanvas</code>, or (2) your script throws a runtime error in the Worker (e.g., referencing <code>document</code> or other DOM APIs unavailable in Workers). In this mode:</p>
                        <ul>
                            <li>The <code>canvas</code> in the <code>init</code> message is a standard <code>&lt;canvas&gt;</code> DOM element (not an <code>OffscreenCanvas</code>).</li>
                            <li>A synthetic <code>self</code> object is provided with an <code>onmessage</code> setter and a no-op <code>postMessage</code>.</li>
                            <li><code>requestAnimationFrame</code> and <code>setInterval</code> calls are tracked and automatically cleaned up on teardown.</li>
                            <li>Your script code should work identically in both modes as long as you use the <code>self.onmessage</code> pattern and don&rsquo;t rely on Worker-specific APIs beyond what&rsquo;s listed here.</li>
                        </ul>

                        <p class="doc-subheading">Minimal Script Template</p>
                        <pre class="doc-pre"><code>let canvas, ctx, width, height;
let mouse = { x: -1000, y: -1000 };

// Recommended: heartbeat keepalive
setInterval(() =&gt; {
  self.postMessage({ type: 'heartbeat' });
}, 1000);

// Message handler
self.onmessage = (e) =&gt; {
  switch (e.data.type) {
    case 'init':
      canvas = e.data.canvas;
      ctx = canvas.getContext('2d');
      width = e.data.width;
      height = e.data.height;
      canvas.width = width;
      canvas.height = height;
      animate();
      break;
    case 'resize':
      width = e.data.width;
      height = e.data.height;
      canvas.width = width;
      canvas.height = height;
      break;
    case 'mousemove':
      mouse.x = e.data.x;
      mouse.y = e.data.y;
      break;
    case 'context':
      // e.data.messages, e.data.chars, e.data.estimatedTokens
      break;
  }
};

function animate() {
  ctx.clearRect(0, 0, width, height);
  // Your drawing code here
  requestAnimationFrame(animate);
}</code></pre>
                    </div>
                </details>
                
                <details class="doc-accordion">
                    <summary>8. Advanced Tools & Image Extraction <i data-icon="chevron"></i></summary>
                    <div class="doc-inner">
                        <p>The footer contains powerful utilities to speed up your workflow.</p>
                        <ul>
                            <li><b>Extract from Image:</b> Click the <b>Extract</b> button to upload an image, or <b>paste an image directly from your clipboard (Ctrl+V)</b>. The designer will calculate the <b>dominant color</b> in the image and apply its hue and chroma to the sliders. Locked variables remain unaffected.</li>
                            <li><b>Randomize:</b> Generates a cohesive random palette. Locked variables will remain unaffected.</li>
                            <li><b>Undo / Redo:</b> Full history support via the <b>Undo</b> and <b>Redo</b> buttons in the footer, or use <b>Ctrl+Z</b> / <b>Ctrl+Y</b> keyboard shortcuts. The history stack tracks palette changes, overrides, locks, CSS, Canvas, Manual Variable Overrides, and Gradient Background.</li>
                            <li><b>Reset Mode:</b> Clears only the current active mode — OKLCH sliders, variable overrides, locks, Custom CSS, Canvas FX, Manual Variable Overrides, and Gradient Background are all wiped. A confirmation dialog gives you the option to create a backup snapshot first.</li>
                            <li><b>Global Reset:</b> Completely wipes all overrides across all 4 modes. A confirmation dialog gives you the option to create a backup snapshot first.</li>
                            <li><b>Factory Reset:</b> Permanently removes <b>all</b> data — active theme state, saved snapshot library, CSS presets, Canvas presets, Gradient presets, and saved metadata. This action is irreversible and cannot be undone.</li>
                            <li><b>JSON View:</b> Click the <b>{ } JSON</b> button in the header to view the current theme as formatted JSON in a modal. Includes a <b>Collapse/Expand</b> toggle for minified output and a <b>Copy to Clipboard</b> button. If a snapshot is active, the output includes its metadata (name, version, author, description, etc.).</li>
                            <li><b>Clipboard Import (JSON):</b> Pressing <b>Ctrl+V</b> with theme JSON on your clipboard triggers an import dialog. The tool auto-detects the theme structure, checks for duplicates, and warns about embedded Canvas FX scripts for security review before importing.</li>
                            <li><b>Modal Shortcuts:</b> Press <b>Escape</b> to close any open modal, or <b>Enter</b> to confirm the primary action.</li>
                        </ul>
                    </div>
                </details>
                
                <details class="doc-accordion">
                    <summary>9. Libraries & Data Management <i data-icon="chevron"></i></summary>
                    <div class="doc-inner">
                        <p>Theme Designer Pro features isolated libraries for Themes, Custom CSS, Canvas Scripts, and Gradient Presets. Themes save complete snapshots of all 4 modes, including locks, CSS, Canvas scripts, Manual Variable Overrides, and Gradient Background configuration.</p>
                        <h4>Theme Library</h4>
                        <ul>
                            <li><b>Snapshot Coverage:</b> When saving a theme snapshot, all associated data is captured &mdash; OKLCH sliders, variable locks & overrides, Manual Variable Overrides, Custom CSS, Canvas FX scripts, and Gradient Background configuration across all 4 modes.</li>
                            <li><b>Theme Metadata:</b> When saving a snapshot, you can attach rich metadata &mdash; <b>Name</b>, <b>Description</b>, <b>Author</b>, <b>Theme Version</b>, <b>Target WebUI Version</b>, <b>Repository URL</b>, and a <b>Theme Update URL</b>. Metadata is embedded in exported <code>.json</code> files and preserved through imports, enabling a robust community theme sharing ecosystem.</li>
                            <li><b>Visual Indicators:</b> Hovering over a theme card displays a rich tooltip showing the name, version, author, description, and color-coded feature tags: <span style="color:#10b981;">Custom CSS</span>, <span style="color:#f59e0b;">Canvas FX</span>, <span style="color:#a78bfa;">Overrides</span>, and <span style="color:#22d3ee;">Linked</span> (URL-linked themes).</li>
                            <li><b>Search:</b> Click the 🔍 icon to search themes by name, author, or description. Press Escape to close the search bar.</li>
                            <li><b>Tag Filter:</b> Click the filter icon to narrow the library by feature &mdash; show only themes that contain Custom CSS, Canvas FX, Overrides, or those that are Linked to an update URL.</li>
                            <li><b>Sort:</b> Click the sort icon to cycle through <b>Default</b> (creation order), <b>A&rarr;Z</b>, or <b>Z&rarr;A</b> alphabetical sorting.</li>
                            <li><b>Import from URL:</b> Click the Import button to open a modal where you can paste a direct URL to a theme JSON file (e.g., a GitHub raw link). The tool will fetch, validate, and add it to your library. You can also import local <code>.json</code> files from the same modal.</li>
                            <li><b>Duplicate Detection:</b> When importing themes (via file, URL, or clipboard), the tool automatically checks for duplicates and skips identical themes already in your library.</li>
                        </ul>
                        <h4>Preset Galleries</h4>
                        <ul>
                            <li><b>Universal Importing:</b> You can click any Import icon, or simply <b>drag and drop</b> <code>.json</code>, <code>.css</code>, or <code>.js</code> files anywhere onto the application. The designer automatically routes the files to their correct galleries.</li>
                            <li><b>Export & Wipe:</b> Each gallery has a download icon to export that collection as a single JSON backup file, and a trash icon to permanently wipe that gallery's contents.</li>
                            <li><b>Server-Side Sync:</b> All preset libraries (themes, CSS snippets, canvas scripts, gradient presets) are automatically synced to the server whenever you add, rename, delete, or import presets. This means your presets survive browser data clears, work across devices, and are included in server backups. On first load, the designer auto-migrates any existing localStorage-only presets to the server.</li>
                        </ul>
                        <h4>CSS Output Tab</h4>
                        <ul>
                            <li><b>Dual Output:</b> The <b>CSS Output</b> tab provides two separate code views: a <b>Tailwind v4 @theme Block</b> and a <b>Raw CSS Output</b>. Both update live as you make changes.</li>
                            <li><b>Minify Toggle:</b> Each output has a Minify checkbox to switch between formatted and minified CSS.</li>
                            <li><b>Download & Copy:</b> Download buttons export each output as a <code>.css</code> file with a smart filename based on the active theme/preset name. Copy buttons send the output to your clipboard.</li>
                        </ul>
                    </div>
                </details>

                <details class="doc-accordion">
                    <summary>10. Theme Updates <i data-icon="chevron"></i></summary>
                    <div class="doc-inner">
                        <p>Theme Designer Pro includes a built-in update system that lets you check for newer versions of themes hosted remotely. This requires a <b>Theme Update URL</b> to be set on a saved snapshot.</p>
                        <h4>Setting Up</h4>
                        <ul>
                            <li><b>Theme Update URL:</b> When saving or editing a theme snapshot, provide a direct URL to the theme's JSON file (e.g., a GitHub raw link). This URL is where the designer will check for newer versions.</li>
                            <li><b>Exporting for Updates:</b> Use the <b>Export</b> button (↓) on any snapshot to download a <code>.json</code> file. This exported file includes all metadata (name, version, author, description, updateUrl) and can be hosted anywhere accessible via HTTP.</li>
                            <li><b>Version Field:</b> Set a meaningful version string (e.g., <code>1.0.0</code>) when saving. The update checker uses semantic version comparison — an update is only triggered when the remote version is <i>higher</i> than the local version.</li>
                        </ul>
                        <h4>Per-Theme Updates</h4>
                        <ul>
                            <li><b>Update Icon (⟳):</b> Snapshots that have a Theme Update URL display a green ⟳ button on hover (right edge of the card). Clicking it fetches the remote JSON and compares versions.</li>
                            <li><b>Update Modal:</b> When an update is detected, a confirmation modal shows the current version, available version, author, and description from the remote source. Click <b>Update Theme</b> to apply or <b>Skip</b> to dismiss.</li>
                            <li><b>What Gets Updated:</b> The update replaces all mode data (Dark, OLED, Light, Her) and syncs metadata (version, description, author) from the remote. Your local theme name and URLs are preserved.</li>
                        </ul>
                        <h4>Global Update Check</h4>
                        <ul>
                            <li><b>Updates Button:</b> The <b>Updates</b> button in the header (next to JSON) scans <i>all</i> saved snapshots that have a Theme Update URL. It checks them concurrently and displays a batch results modal.</li>
                            <li><b>Batch Results:</b> The results modal lists available updates with individual <b>Update</b> buttons, a count of themes already up to date, and any errors (e.g., CORS failures or unreachable URLs).</li>
                        </ul>
                        <h4>CORS Requirements</h4>
                        <ul>
                            <li>The designer uses <code>fetch()</code> to check URLs. The remote server must allow cross-origin requests (<code>Access-Control-Allow-Origin: *</code>). GitHub raw URLs (<code>raw.githubusercontent.com</code>) work out of the box. Custom servers may need CORS headers configured.</li>
                        </ul>
                    </div>
                </details>

                <details class="doc-accordion">
                    <summary>11. Reference: Available Variables <i data-icon="chevron"></i></summary>
                    <div class="doc-inner">
                        <p>The following variables are dynamically generated and applied to the Open WebUI root.</p>
                        <div class="doc-table-wrap">
                            <table class="doc-table">
                                <thead>
                                    <tr>
                                        <th>Variable Name</th>
                                        <th>Default Tonal Depth</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr><td><span class="doc-code-inline">--color-gray-50</span></td><td>98% Lightness</td></tr>
                                    <tr><td><span class="doc-code-inline">--color-gray-100</span></td><td>94% Lightness</td></tr>
                                    <tr><td><span class="doc-code-inline">--color-gray-200</span></td><td>92% Lightness</td></tr>
                                    <tr><td><span class="doc-code-inline">--color-gray-300</span></td><td>85% Lightness</td></tr>
                                    <tr><td><span class="doc-code-inline">--color-gray-400</span></td><td>77% Lightness</td></tr>
                                    <tr><td><span class="doc-code-inline">--color-gray-500</span></td><td>69% Lightness</td></tr>
                                    <tr><td><span class="doc-code-inline">--color-gray-600</span></td><td>51% Lightness</td></tr>
                                    <tr><td><span class="doc-code-inline">--color-gray-700</span></td><td>42% Lightness</td></tr>
                                    <tr><td><span class="doc-code-inline">--color-gray-800</span></td><td>32% Lightness</td></tr>
                                    <tr><td><span class="doc-code-inline">--color-gray-850</span></td><td>27% Lightness</td></tr>
                                    <tr><td><span class="doc-code-inline">--color-gray-900</span></td><td>20% Lightness</td></tr>
                                    <tr><td><span class="doc-code-inline">--color-gray-950</span></td><td>16% Lightness</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </details>

                <details class="doc-accordion">
                    <summary>12. Gradient Backgrounds <i data-icon="chevron"></i></summary>
                    <div class="doc-inner">
                        <p>The <b>Gradient</b> tab provides a dedicated visual gradient builder for applying CSS gradient backgrounds to your Open WebUI instance. The builder automatically generates all required CSS — including structural transparency rules, sidebar/textarea backdrop blur, and chat overlay blending — so you don't need to write any CSS manually.</p>

                        <h4>Gradient Builder Controls</h4>
                        <ul>
                            <li><b>Gradient Type:</b> Choose between <b>Linear</b> (directional), <b>Radial</b> (center-outward), and <b>Mesh</b> (multi-point radial overlay) gradient modes.</li>
                            <li><b>Color Stops:</b> Add, remove, and reorder color stops with interactive swatches and position sliders. Each stop has a color picker and a position value (0–100%).</li>
                            <li><b>Mesh Gradient:</b> An interactive visual editor lets you place, drag, and color up to 16 color points on a 2D pad. Each point has a configurable spread radius. The tool composites multiple overlapping radial-gradient layers against a customizable background color to simulate a mesh gradient effect. Click to add points, drag to reposition, and double-click to remove.</li>
                            <li><b>Direction (Linear):</b> A slider controls the gradient angle (0°–360°). Double-click the label to reset to the default 135°.</li>
                            <li><b>Color Intensity:</b> A slider scales the overall vibrancy of the gradient (0–100%). Double-click to reset to 85%.</li>
                            <li><b>Animate Gradient:</b> Enable a looping CSS animation that slowly shifts the gradient position. An additional speed slider (2–30s) controls the animation duration.</li>
                            <li><b>Enabled Toggle:</b> Turn the gradient on/off without losing your stop configuration.</li>
                            <li><b>Show on Auth Pages:</b> Controls whether the gradient appears on Login/Signup screens. Enabled by default.</li>
                            <li><b>Reset / Random:</b> Clear all stops or generate a randomized gradient.</li>
                        </ul>

                        <h4>How It Works</h4>
                        <p>When the gradient is enabled (with at least 2 color stops), the designer automatically generates a <i>Structural Layer</i> that makes all layout containers transparent so the gradient shows through. It also adds semi-opaque backdrop-blur rules to the sidebar and textarea for readability, and overrides the chat overlay for proper blending.</p>

                        <h4>Conflict Detection</h4>
                        <p>If your <b>Custom CSS Snippet</b> already contains gradient <code>background-image</code> rules, the builder displays a warning banner. Because the Custom CSS Snippet is injected <em>after</em> the Gradient Builder output in the final stylesheet, the Custom CSS gradient will <b>override</b> the builder's gradient via CSS cascade. To use the Gradient Builder exclusively, remove or disable the conflicting rules in your Custom CSS Snippet.</p>

                        <h4>Quick Presets</h4>
                        <p>The builder includes 12 ready-to-use gradient presets. Click any preset to instantly apply its color stops, type, and direction:</p>
                        <div class="doc-table-wrap">
                            <table class="doc-table">
                                <thead>
                                    <tr>
                                        <th>Preset</th>
                                        <th>Type</th>
                                        <th>Colors</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr><td>Midnight</td><td>Linear 135°</td><td><span class="doc-code-inline">#0f0c29, #302b63, #24243e</span></td></tr>
                                    <tr><td>Emerald</td><td>Linear 135°</td><td><span class="doc-code-inline">#0d2818, #04471c, #058c42</span></td></tr>
                                    <tr><td>Amethyst</td><td>Linear 135°</td><td><span class="doc-code-inline">#1a0a2e, #3d1e6d, #6b3fa0</span></td></tr>
                                    <tr><td>Sapphire</td><td>Linear 135°</td><td><span class="doc-code-inline">#041e42, #0c2d5a, #1e40af</span></td></tr>
                                    <tr><td>Aurora</td><td>Linear 135° (animated)</td><td><span class="doc-code-inline">#0f0c29, #1b5e20, #1a237e, #6a1b9a</span></td></tr>
                                    <tr><td>Sunset</td><td>Linear 180°</td><td><span class="doc-code-inline">#1a0a2e, #b91c1c, #d97706, #f59e0b</span></td></tr>
                                    <tr><td>Ocean</td><td>Linear 180°</td><td><span class="doc-code-inline">#001219, #005f73, #0a9396</span></td></tr>
                                    <tr><td>Neon</td><td>Linear 135°</td><td><span class="doc-code-inline">#0d0221, #0d0b52, #6a11cb, #f953c6</span></td></tr>
                                    <tr><td>Nebula</td><td>Mesh</td><td><span class="doc-code-inline">#6366f1, #ec4899, #06b6d4, #8b5cf6</span></td></tr>
                                    <tr><td>Lagoon</td><td>Mesh</td><td><span class="doc-code-inline">#0d9488, #22d3ee, #059669, #0284c7</span></td></tr>
                                    <tr><td>Ember</td><td>Mesh</td><td><span class="doc-code-inline">#dc2626, #ea580c, #d97706, #991b1b</span></td></tr>
                                    <tr><td>Arctic</td><td>Mesh</td><td><span class="doc-code-inline">#38bdf8, #22d3ee, #818cf8, #2563eb</span></td></tr>
                                </tbody>
                            </table>
                        </div>

                        <p style="margin-top: 12px; font-size: 0.7rem; color: var(--text-muted); line-height: 1.5;"><b>Advanced:</b> For more complex gradient setups beyond what the builder offers, you can also write gradient CSS manually in the <b>Style Overrides</b> tab using Custom CSS. Note that because Custom CSS is injected after the builder's output, it will override (not layer with) the builder's gradient if both target <code>background-image</code> on the same element.</p>
                    </div>
                </details>

                <details class="doc-accordion">
                    <summary>13. Structural Transparency & Layer Stack <i data-icon="chevron"></i></summary>
                    <div class="doc-inner">
                        <p>When you enable a <b>Canvas FX animation</b> or a <b>Gradient Background</b>, the designer automatically generates a set of CSS rules called the <i>Structural Layer</i>. This layer makes the native Open WebUI UI panels transparent so the background effect shines through, while intelligently preserving opaque backgrounds on overlay UI elements (dropdown menus, modals, dialogs) for text readability.</p>

                        <h4>The 5 Rendering Layers (Back to Front)</h4>
                        <p>When Canvas FX and/or Gradient Background are active, the final visual output is composed of 5 distinct layers stacked using CSS <code>z-index</code> and <code>position: fixed</code>:</p>
                        <div class="doc-table-wrap">
                            <table class="doc-table">
                                <thead>
                                    <tr>
                                        <th>Layer</th>
                                        <th>z-index</th>
                                        <th>What It Does</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr><td><b>1. Body Background</b></td><td>—</td><td>The <code>body</code> element's <code>background-color</code> (your OKLCH palette's base gray) and, if gradient is active, the <code>background-image</code> gradient.</td></tr>
                                    <tr><td><b>2. Background Color Div</b></td><td>-2</td><td>A full-viewport <code>&lt;div id="owui-theme-bg-color"&gt;</code> inserted behind everything. When Canvas FX is active, its background is set to <code>transparent</code> by the structural layer so the canvas shows through. Without Canvas, this layer is inert.</td></tr>
                                    <tr><td><b>3. Canvas Element</b></td><td>0</td><td>A full-viewport <code>&lt;canvas id="owui-theme-canvas-bg"&gt;</code> where your Canvas FX animation renders. Has <code>pointer-events: none</code> so it never intercepts clicks.</td></tr>
                                    <tr><td><b>4. Structural Transparency</b></td><td>—</td><td>CSS rules that set <code>background-color: transparent</code> on <code>.app</code>, <code>.app&nbsp;&gt;&nbsp;div</code>, <code>main</code>, <code>nav</code>, <code>.sticky</code>, and <code>[class*="bg-gray-"]</code> layout wrappers — but explicitly <b>excludes</b> interactive elements (<code>button</code>, <code>a</code>, <code>input</code>, <code>select</code>, <code>label</code>, <code>span</code>) and overlay UI (<code>[role="menu"]</code>, <code>[role="dialog"]</code>, <code>[role="listbox"]</code>). Uses CSS <code>:where()</code> for zero-specificity transparency so overlay restore rules always win.</td></tr>
                                    <tr><td><b>5. Glass Panels</b></td><td>—</td><td>Semi-opaque overlays with <code>backdrop-filter: blur()</code> on the <b>sidebar</b> and <b>textarea</b>. These give text areas readability while still letting the background show through. The Gradient Builder auto-calculates RGBA values from the darkest gradient stop.</td></tr>
                                </tbody>
                            </table>
                        </div>

                        <h4>Overlay UI Protection</h4>
                        <p>Dropdown menus, modal dialogs, and listbox selectors are <b>portaled</b> outside the <code>.app</code> wrapper &mdash; they are appended directly to <code>&lt;body&gt;</code>. To ensure these remain readable against canvas/gradient backgrounds, the structural layer uses a multi-pronged strategy:</p>
                        <ul>
                            <li><b>Zero-specificity transparency:</b> The broad <code>[class*="bg-gray-"]</code> transparency rule is wrapped in CSS <code>:where()</code>, giving it zero specificity contribution. This means <i>any</i> selector with normal specificity can override it.</li>
                            <li><b>Element exclusions:</b> Interactive elements like <code>button</code>, <code>a</code>, <code>input</code>, <code>select</code>, <code>label</code>, and <code>span</code> are excluded from transparency entirely via <code>:not()</code> filters. This protects toggle knobs (<code>bg-white</code> circles), styled buttons, and other small UI widgets. Dropdown menus, modal dialogs, and listbox selectors &mdash; which are <b>portaled</b> outside the <code>.app</code> wrapper &mdash; are naturally unaffected because the transparency rules only target elements within <code>.app</code>, <code>#app-container</code>, and <code>#auth-page</code> scope.</li>
                            <li><b>Sidebar child restore:</b> Inside <code>#sidebar</code>, a <code>revert-layer</code> rule restores original backgrounds on nested <code>[class*="bg-gray-"]</code> elements, preventing sidebar items from becoming invisible.</li>
                        </ul>
                        <p style="font-size: 0.7rem; color: var(--text-muted); line-height: 1.5;"><b>Note:</b> The <code>[class*="bg-white"]</code> attribute selector is intentionally <b>not</b> included in the transparency rules. Elements with <code>bg-white</code> classes in Open WebUI are almost always interactive widgets (toggle indicators, button styling, card backgrounds), not structural layout wrappers.</p>

                        <h4>What Triggers the Structural Layer?</h4>
                        <p>The structural transparency rules are <b>only</b> emitted when at least one of the following is true for the active mode:</p>
                        <ul>
                            <li><b>Canvas FX</b> is enabled and has a non-empty script, <b>or</b></li>
                            <li><b>Gradient Background</b> is enabled and has at least 2 color stops (or 2 mesh points for Mesh gradients).</li>
                        </ul>
                        <p>If neither is active, the designer emits simple opaque <code>background-color</code> rules for <code>body</code>, <code>#sidebar</code>, and <code>textarea</code> — no transparency is applied.</p>

                        <h4>What Can Conflict with Transparency?</h4>
                        <ul>
                            <li><b>Custom CSS setting opaque backgrounds:</b> If your Custom CSS Snippet sets <code>background-color</code> on <code>.app</code>, <code>main</code>, or other layout containers, it can override the structural transparency and block the background effect from showing through. To fix this, set those backgrounds to <code>transparent</code> in your Custom CSS.</li>
                            <li><b>Open WebUI updates:</b> If Open WebUI changes its class names or DOM structure (e.g., renaming <code>.app</code> to something else), the structural layer selectors may stop matching. This can cause panels to revert to opaque backgrounds, hiding the canvas or gradient behind them.</li>
                            <li><b>Canvas FX + Gradient coexistence:</b> Both features share the same structural layer. When both are active simultaneously, the canvas animation renders on top of the gradient background. The gradient sits on <code>body</code> (layer 1), while the canvas renders at z-index 0 (layer 3). The canvas has a transparent background by default, so the gradient may partially show through depending on what your canvas script draws.</li>
                            <li><b>Third-party extensions or custom elements:</b> Elements using <code>bg-gray-*</code> classes that are not <code>button</code>, <code>a</code>, <code>input</code>, <code>select</code>, <code>label</code>, or <code>span</code> will be made transparent. If a third-party extension injects custom UI with gray backgrounds, it may become transparent. Use the Style Overrides tab to restore specific elements if needed.</li>
                        </ul>

                        <h4>CSS Output Order</h4>
                        <p style="font-size: 0.7rem; line-height: 1.6; opacity: 0.85;">Understanding the injection order helps debug cascade conflicts. The final CSS is assembled in this order:</p>
                        <ol style="font-size: 0.72rem; line-height: 1.7; padding-left: 18px;">
                            <li><b>OKLCH Variable Declarations</b> — <code>--color-gray-*</code> palette ramps per mode</li>
                            <li><b>Manual Variable Overrides</b> — user-defined CSS custom properties (injected after palette for priority)</li>
                            <li><b>Structural Background Rules</b> — transparent or opaque <code>body</code>/<code>#sidebar</code>/<code>textarea</code> rules + overlay UI restores</li>
                            <li><b>Gradient Background CSS</b> — <code>background-image</code>, sidebar/textarea blur rules</li>
                            <li><b>Custom CSS Snippet</b> — your raw CSS (last = highest cascade priority)</li>
                        </ol>
                        <p style="font-size: 0.68rem; color: var(--text-muted); margin-top: 6px;">Because Custom CSS is injected last, it always wins any cascade tie — this is why a gradient <code>background-image</code> in Custom CSS will override the Gradient Builder's output.</p>
                    </div>
                </details>

                <details class="doc-accordion">
                    <summary>14. Keyboard Shortcuts & Editor Tips <i data-icon="chevron"></i></summary>
                    <div class="doc-inner">
                        <p>A consolidated reference of all keyboard shortcuts available throughout the designer.</p>
                        <div class="doc-table-wrap">
                            <table class="doc-table">
                                <thead>
                                    <tr>
                                        <th>Shortcut</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr><td><span class="doc-code-inline">Ctrl+Z</span></td><td>Undo last change</td></tr>
                                    <tr><td><span class="doc-code-inline">Ctrl+Y</span></td><td>Redo last undone change</td></tr>
                                    <tr><td><span class="doc-code-inline">Ctrl+V</span> (image)</td><td>Extract palette colors from a clipboard image</td></tr>
                                    <tr><td><span class="doc-code-inline">Ctrl+V</span> (JSON)</td><td>Import a theme from clipboard JSON data</td></tr>
                                    <tr><td><span class="doc-code-inline">Escape</span></td><td>Close any open modal or search bar</td></tr>
                                    <tr><td><span class="doc-code-inline">Enter</span></td><td>Confirm the primary action in a modal</td></tr>
                                    <tr><td><span class="doc-code-inline">Double-click</span> slider label</td><td>Reset that slider to its default value</td></tr>
                                </tbody>
                            </table>
                        </div>
                        <h4 style="margin-top: 16px;">Code Editor Shortcuts</h4>
                        <p>These apply inside the Custom CSS, Canvas FX, and Manual Overrides editors:</p>
                        <div class="doc-table-wrap">
                            <table class="doc-table">
                                <thead>
                                    <tr>
                                        <th>Key</th>
                                        <th>Behavior</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr><td><span class="doc-code-inline">Tab</span></td><td>Inserts a 2-space indent while tab trap is active (default on). Press <span class="doc-code-inline">Escape</span> to toggle.</td></tr>
                                    <tr><td><span class="doc-code-inline">Enter</span></td><td>Auto-indents the new line to match the previous line's indentation</td></tr>
                                    <tr><td><span class="doc-code-inline">{</span></td><td>Auto-inserts closing <span class="doc-code-inline">}</span> — also applies to <span class="doc-code-inline">(</span>, <span class="doc-code-inline">[</span>, <span class="doc-code-inline">"</span>, and <span class="doc-code-inline">'</span></td></tr>
                                    <tr><td><span class="doc-code-inline">Enter</span> after <span class="doc-code-inline">{</span></td><td>Creates an indented block with the closing <span class="doc-code-inline">}</span> on the next line</td></tr>
                                    <tr><td><span class="doc-code-inline">Escape</span></td><td>Toggles tab trap mode &mdash; when off, Tab moves focus instead of inserting spaces</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </details>

                <details class="doc-accordion">
                    <summary>15. Compliance & Legal Disclaimer <i data-icon="chevron"></i></summary>
                    <div class="doc-inner">
                        <p><b>Theme Designer Pro is an event function provided for educational and customization purposes. By using this function, you acknowledge and agree to the following:</b></p>
                        <ul>
                            <li><b>Compliance Responsibility:</b> As of Open WebUI v0.6.6+, the software license strictly prohibits altering, removing, obscuring, or replacing any "Open WebUI" branding (including the name, logo, or distinguishing visual identifiers) in deployments with <b>more than 50 active users</b> in a 30-day period without an Enterprise License.</li>
                            <li><b>Administrative Burden:</b> The responsibility to ensure compliance with the Open WebUI License rests <b>entirely</b> with the server administrator. While modifying color palettes is permitted, you must ensure that your use of the designer (specifically the Style Overrides tab) is not used to hide, obscure, or alter the Open WebUI logo and branding in violation of the license.</li>
                            <li><b>Liability Waiver:</b> The author of Theme Designer Pro (@G30) shall not be held liable for any material breach of license, legal action, or service termination resulting from the use or misuse of this function on a hosted or distributed Open WebUI instance.</li>
                            <li><b>Safe Harbor:</b> If your deployment is for personal use, internal team use (with permission), or for an organization of 50 or fewer active users, you are generally exempt from these strict branding restrictions.</li>
                        </ul>
                        <p style="font-size:0.75rem; margin-top:12px; opacity:0.8;">This function is provided "as is" without warranty of any kind. By using Theme Designer Pro, you acknowledge that modifying system files (index.html) may have security implications. Use only on trusted instances.</p>
                    </div>
                </details>

                <details class="doc-accordion">
                    <summary>16. Community Presets <i data-icon="chevron"></i></summary>
                    <div class="doc-inner">
                        <p>Import any preset directly into Theme Designer Pro using the built-in Import button, URL import, or drag-and-drop.</p>

                        <div class="doc-subheading">🚀 Quick Start — Import Everything at Once</div>
                        <p>Open any Import modal in Theme Designer Pro, paste this URL, and click <b>Load URL</b> — all animations, CSS, themes, and gradients are imported in one shot:</p>
                        <div style="position: relative; margin-bottom: 16px;">
                            <code class="doc-pre" style="display: block; margin: 0; font-size: 0.62rem; user-select: all; word-break: break-all; padding-right: 60px;" id="url-bundle-all">https://raw.githubusercontent.com/silentoplayz/theme-designer-pro-presets/main/bundles/everything.json</code>
                            <button class="owui-code-btn" style="position: absolute; top: 50%; right: 8px; transform: translateY(-50%); font-size: 0.6rem;" onclick="navigator.clipboard.writeText(document.getElementById('url-bundle-all').textContent).then(()=>showToast('Copied URL'))">Copy</button>
                        </div>

                        <div class="doc-subheading">📦 Import by Category</div>
                        <p>Prefer to import only specific types? Use these individual bundle URLs:</p>
                        <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 0.65rem; font-weight: 700; color: var(--text-main); min-width: 100px;">🎨 Themes</span>
                                <div style="position: relative; flex: 1;">
                                    <code class="doc-pre" style="display: block; margin: 0; font-size: 0.6rem; user-select: all; word-break: break-all; padding-right: 60px;" id="url-bundle-themes">https://raw.githubusercontent.com/silentoplayz/theme-designer-pro-presets/main/bundles/themes-all.json</code>
                                    <button class="owui-code-btn" style="position: absolute; top: 50%; right: 8px; transform: translateY(-50%); font-size: 0.6rem;" onclick="navigator.clipboard.writeText(document.getElementById('url-bundle-themes').textContent).then(()=>showToast('Copied URL'))">Copy</button>
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 0.65rem; font-weight: 700; color: var(--text-main); min-width: 100px;">✨ Canvas FX</span>
                                <div style="position: relative; flex: 1;">
                                    <code class="doc-pre" style="display: block; margin: 0; font-size: 0.6rem; user-select: all; word-break: break-all; padding-right: 60px;" id="url-bundle-canvas">https://raw.githubusercontent.com/silentoplayz/theme-designer-pro-presets/main/bundles/canvas-fx-all.json</code>
                                    <button class="owui-code-btn" style="position: absolute; top: 50%; right: 8px; transform: translateY(-50%); font-size: 0.6rem;" onclick="navigator.clipboard.writeText(document.getElementById('url-bundle-canvas').textContent).then(()=>showToast('Copied URL'))">Copy</button>
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 0.65rem; font-weight: 700; color: var(--text-main); min-width: 100px;">🎨 CSS Presets</span>
                                <div style="position: relative; flex: 1;">
                                    <code class="doc-pre" style="display: block; margin: 0; font-size: 0.6rem; user-select: all; word-break: break-all; padding-right: 60px;" id="url-bundle-css">https://raw.githubusercontent.com/silentoplayz/theme-designer-pro-presets/main/bundles/css-presets-all.json</code>
                                    <button class="owui-code-btn" style="position: absolute; top: 50%; right: 8px; transform: translateY(-50%); font-size: 0.6rem;" onclick="navigator.clipboard.writeText(document.getElementById('url-bundle-css').textContent).then(()=>showToast('Copied URL'))">Copy</button>
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 0.65rem; font-weight: 700; color: var(--text-main); min-width: 100px;">🌈 Gradients</span>
                                <div style="position: relative; flex: 1;">
                                    <code class="doc-pre" style="display: block; margin: 0; font-size: 0.6rem; user-select: all; word-break: break-all; padding-right: 60px;" id="url-bundle-gradients">https://raw.githubusercontent.com/silentoplayz/theme-designer-pro-presets/main/bundles/gradients-all.json</code>
                                    <button class="owui-code-btn" style="position: absolute; top: 50%; right: 8px; transform: translateY(-50%); font-size: 0.6rem;" onclick="navigator.clipboard.writeText(document.getElementById('url-bundle-gradients').textContent).then(()=>showToast('Copied URL'))">Copy</button>
                                </div>
                            </div>
                        </div>

                        <div class="doc-subheading">🔗 Resources</div>
                        <ul>
                            <li><b>Preset Gallery:</b> Visit <a href="https://silentoplayz.github.io/theme-designer-pro-presets/" target="_blank" rel="noopener noreferrer" style="color: var(--accent); text-decoration: underline;">silentoplayz.github.io/theme-designer-pro-presets</a> to browse, preview, and copy import URLs for curated presets.</li>
                            <li><b>Submit Your Own:</b> Share your creations with the community! Open a <a href="https://github.com/silentoplayz/theme-designer-pro-presets/issues/new?template=theme-submission.yml" target="_blank" rel="noopener noreferrer" style="color: var(--accent); text-decoration: underline;">Theme Submission</a> on GitHub to contribute your theme to the gallery.</li>
                            <li><b>Source Repository:</b> <a href="https://github.com/silentoplayz/theme-designer-pro-presets" target="_blank" rel="noopener noreferrer" style="color: var(--accent); text-decoration: underline;">github.com/silentoplayz/theme-designer-pro-presets</a></li>
                        </ul>
                    </div>
                </details>

                <details class="doc-accordion">
                    <summary>17. Troubleshooting &amp; FAQ <i data-icon="chevron"></i></summary>
                    <div class="doc-inner">
                        <p>Common issues and their solutions.</p>
                        <ul>
                            <li><b>Python permission error when injecting the bootloader.</b> The event function must have write access to your Open WebUI <code>index.html</code> file. If you are running a highly restricted bare-metal deployment or custom volume mappings, the function cannot inject the persistence script.</li>
                            <li><b>Canvas FX animations are lagging.</b> Heavy mathematically complex animations can drain resources. Ensure your browser supports <code>OffscreenCanvas</code> (indicated by the green <b>Background Worker</b> badge in the designer UI). Note: the badge reflects browser <i>capability</i>, not the actual execution path &mdash; if your script uses DOM APIs like <code>document</code>, the runtime auto-falls back to the main thread even when the badge shows "Background Worker." If your script runs on the main thread, keep animations simple. Even with Web Workers, massive particle counts or heavy calculations can still consume significant CPU/GPU resources.</li>
                            <li><b>My theme doesn't apply to other users.</b> Ensure the admin has synced the theme via the designer. The bootloader serves the theme to all users on page load from <code>{ROUTE_BASE}/theme.css</code>. If the theme files are missing from <code>DATA_DIR/theme/</code>, the bootloader has nothing to serve. If users already have the page open, the SSE channel should push updates automatically — verify the connection is active by checking the browser's Network tab for an open <code>EventSource</code> request to <code>{ROUTE_BASE}/events</code>.</li>
                            <li><b>Theme changes aren't appearing live on other devices/browsers.</b> Live push uses Server-Sent Events (SSE). Verify that: (1) the other device has the page open (SSE only pushes to active connections), (2) your reverse proxy isn't buffering SSE responses (nginx requires <code>X-Accel-Buffering: no</code>, which is set automatically), and (3) the browser's Network tab shows an active connection to <code>{ROUTE_BASE}/events</code>. If the connection drops, the browser auto-reconnects after 3 seconds.</li>
                            <li><b>Theme reverts after disabling the function.</b> Disabling the event function stops <code>event()</code> from running, but the bootloader remains in <code>index.html</code> and the theme CSS persists. To fully remove the theme, use <code>Theme Active = OFF</code> (which actively strips the bootloader and CSS) before disabling the function, or follow the Uninstallation steps in Section 19.</li>
                            <li><b>Theme Active valve change doesn't take effect immediately.</b> Valve changes are detected automatically on the next system event (e.g., a chat message or user login). The system compares the current valve state to the previous state and broadcasts the appropriate SSE event (<code>theme-disable</code> or <code>theme-update</code>). There is no <code>on_valves_updated</code> hook in Open WebUI's event function API, so one system event must fire to trigger the detection.</li>
                            <li><b>Theme Active OFF doesn't fully strip the theme.</b> The <code>theme-disable</code> SSE event removes all 6 injected DOM elements by ID: <code>owui-dev-live-theme</code> (main CSS), <code>owui-server-theme</code> (server-injected CSS), <code>owui-theme-style</code> (legacy), <code>owui-theme-canvas-bg</code> (canvas), <code>owui-theme-bg-color</code> (background div), and <code>owui-canvas-script-runner</code> (canvas script). It also clears the in-memory theme state and localStorage cache to prevent re-injection by the MutationObserver.</li>
                            <li><b>Live push stopped working after re-saving the function.</b> This should not happen — SSE connections are persisted on <code>app.state</code> and survive function hot-reloads. If you do experience this, verify the SSE endpoint is accessible at <code>{ROUTE_BASE}/events</code>. The server sends a heartbeat every 30 seconds — if the connection is truly dead, the EventSource will auto-reconnect after 3 seconds.</li>
                            <li><b>Draft mode is fully sandboxed.</b> Theme CSS and state data use <code>sessionStorage</code> (tab-scoped), <code>syncToServer()</code> is gated off entirely, and mode changes (Dark/Light/System/etc.) are only applied locally to the designer page's <code>&lt;html&gt;</code> element — <code>localStorage.setItem('theme')</code> is skipped, so other tabs and the admin's live session are never affected.</li>
                            <li><b>Designer URL valve set to a path without /api/v1/.</b> The designer auto-corrects URLs that don't start with <code>/api/v1/</code> to prevent the SPA catch-all from intercepting the route. A warning is logged when auto-correction occurs. Check your Open WebUI logs for <code>[Theme Pro]</code> messages.</li>
                        </ul>
                    </div>
                </details>

                <details class="doc-accordion">
                    <summary>18. Uninstallation &amp; Complete Removal <i data-icon="chevron"></i></summary>
                    <div class="doc-inner">
                        <p>Because this function injects a bootloader script directly into your server's <code>index.html</code> file, <b>simply disabling or removing the event function will not remove the theme engine from your interface.</b> Follow these steps for a complete removal:</p>
                        <h4>Step 1: Purge Browser LocalStorage</h4>
                        <p>The easiest way is to use the <b>Factory Reset</b> button in the <b>Danger Zone</b> section below (Section 20). Alternatively, open your Open WebUI instance, press <b>F12</b> to open Developer Tools, go to the <b>Console</b> tab, and paste:</p>
                        <div style="position: relative;">
                        <pre class="doc-pre" id="purge-localstorage-code"><code>['owui_dev_theme_v1', 'owui_dev_theme_v1_css',
 'owui_theme_snapshots',
 'owui_canvas_presets', 'owui_css_presets', 'owui_gradient_presets',
 'owui_canvas_last_mode', 'owui_canvas_last_script',
 'owui_theme_last_metadata', 'owui_theme_valve_no_canvas'].forEach(k =&gt; {
  localStorage.removeItem(k); console.log('Purged: ' + k);
}); sessionStorage.removeItem('owui_theme_draft_mode');
location.reload();</code></pre>
                            <button class="owui-code-btn" style="position: absolute; top: 8px; right: 8px; font-size: 0.6rem;" onclick="navigator.clipboard.writeText(document.getElementById('purge-localstorage-code').textContent).then(()=>showToast('Copied to clipboard'))">Copy</button>
                        </div>
                        <h4>Step 2: Remove Server-Side Theme Files</h4>
                        <p>Delete the theme files from the server's data directory:</p>
                        <ul>
                            <li><code>DATA_DIR/theme/open_theme_designer.css</code></li>
                            <li><code>DATA_DIR/theme/open_theme_designer.json</code></li>
                            <li><code>DATA_DIR/theme/open_theme_designer_library.json</code></li>
                        </ul>
                        <h4>Step 3: Remove the Server Bootloader</h4>
                        <ul>
                            <li><b>The Docker Way (Simplest):</b> Restart or update your container (e.g., <code>docker compose down &amp;&amp; docker compose up -d</code>). This replaces the patched <code>index.html</code> with a fresh copy from the image.</li>
                            <li><b>The Manual Way:</b> Open the <code>index.html</code> file on your server (commonly at <code>/app/build/index.html</code>) and delete the entire block wrapped in the <code>&lt;!-- OWUI Theme Pro Bootloader --&gt;</code> markers.</li>
                        </ul>
                        <h4>Step 4: Disable or Remove the Event Function</h4>
                        <p>In the Open WebUI admin panel, navigate to Functions and disable or delete the Theme Designer Pro event function.</p>
                    </div>
                </details>

                <details class="doc-accordion" open>
                    <summary>19. Portability & Backups <i data-icon="chevron"></i></summary>
                    <div class="doc-inner" style="display:flex; flex-direction:column; align-items:center; gap:16px;">
                        <p style="margin:0; text-align:center;">Export your complete theme library snapshots, custom CSS presets, canvas animation scripts, and gradient presets to separate portable backup files at once. You can restore them anytime using the import features in their respective tabs.</p>
                        
                        <button class="btn" id="export-all-backups-btn" style="border:1px solid var(--border); padding:10px 24px; font-weight:600; border-radius:var(--radius-md); display:flex; align-items:center; gap:8px; cursor:pointer; transition:all 0.2s; margin-top: 8px; background:rgba(255, 255, 255, 0.03);">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                            <span>Export All Backups (.JSON)</span>
                        </button>
                    </div>
                </details>

                <details class="doc-accordion" open>
                    <summary style="color: #ef4444;">20. Danger Zone <i data-icon="chevron"></i></summary>
                    <div class="doc-inner" style="display:flex; flex-direction:column; align-items:center; gap:16px;">
                        <p style="margin:0; text-align:center; color:var(--text-muted); font-size:0.75rem; line-height:1.6;">Permanently wipe <b>all</b> Theme Designer Pro data including your theme library, CSS snippets, canvas scripts, gradient presets, and active configuration. This action cannot be undone.</p>
                        <button class="btn" id="factory-reset-btn" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); padding: 10px 24px; font-weight: 600; border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s; width: 100%; max-width: 320px;">Factory Reset (Wipe All Data)</button>
                    </div>
                </details>
            </div>
        </div>
    </div>

    <div class="footer">
        <div class="footer-left">
            <button class="btn btn-danger" id="nuclear-btn" data-tooltip="Reset all modes to default">Global Reset</button>
            <button class="btn btn-danger" id="reset-mode-btn" data-tooltip="Reset only the current mode to default" style="opacity: 0.85;">Reset Mode</button>
            <button class="btn" id="sync-mode-btn" data-tooltip="Selective sync between theme modes">Sync</button>
            
            <div style="display: flex; gap: 4px; margin-left: 8px; border-left: 1px solid var(--border); padding-left: 12px;">
                <button class="btn btn-icon" id="undo-btn" data-tooltip="Undo (Ctrl+Z)" aria-label="Undo" disabled style="width: 32px; height: 32px; opacity: 0.5;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
                </button>
                <button class="btn btn-icon" id="redo-btn" data-tooltip="Redo (Ctrl+Y)" aria-label="Redo" disabled style="width: 32px; height: 32px; opacity: 0.5;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>
                </button>
            </div>
        </div>
        <div class="footer-right">
            <div class="draft-toggle" id="draft-toggle-wrap">
                    <span class="draft-toggle-label active" id="draft-label-live">Live</span>
                    <div class="draft-switch" id="draft-switch" data-tooltip="Toggle Draft Mode — changes won't push to users until you Publish"></div>
                    <span class="draft-toggle-label" id="draft-label-draft"><span class="draft-dot" style="display:none;" id="draft-dot"></span> Draft</span>
            </div>
            <button class="draft-publish-btn" id="draft-publish-btn" data-tooltip="Push all changes live to all users">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                Publish
            </button>
        </div>
        <input type="file" id="image-input" accept="image/*" style="display:none" multiple>
    </div>

    <!-- Modal Overlays -->
    <div id="save-modal" class="modal-overlay z-low">
        <div class="control-group modal-panel-save">
            <div class="modal-icon modal-icon-save">💾</div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
                <div class="section-title" style="margin: 0;">Save Theme Snapshot</div>
                <button class="btn" id="save-json-edit-btn" style="font-size: 0.6rem; padding: 5px 12px; border-radius: 8px; white-space: nowrap;" data-tooltip="Edit snapshot as raw JSON before saving">{ } Manual Editor</button>
            </div>
            <div class="metadata-grid">
                <div class="metadata-field">
                    <label>Name</label>
                    <input type="text" id="theme-name-input" placeholder="My Custom Theme">
                </div>
                <div class="metadata-field">
                    <label>Description</label>
                    <input type="text" id="theme-desc-input" placeholder="A short description">
                </div>
                <div class="metadata-field">
                    <label>Author</label>
                    <input type="text" id="theme-author-input" placeholder="Your name">
                </div>

                <div class="metadata-field">
                    <label>Theme Version</label>
                    <input type="text" id="theme-version-input" placeholder="1.0.0">
                </div>
                <div class="metadata-field">
                    <label>Target WebUI Version</label>
                    <input type="text" id="theme-target-input" placeholder="0.9.0">
                </div>
                <div class="metadata-field">
                    <label>Repository URL</label>
                    <input type="text" id="theme-repo-input" placeholder="https://github.com/...">
                </div>
                <div class="metadata-field" style="grid-column: 1 / -1;">
                    <label>Theme Update URL</label>
                    <input type="text" id="theme-update-input" placeholder="https://...">
                </div>
            </div>
            <div class="flex-end">
                <button class="btn" data-dismiss="save-modal">Cancel</button>
                <button class="btn btn-primary" id="confirm-save-btn">Save Theme</button>
            </div>
        </div>
    </div>

    <!-- Factory-Generated Modals -->
    <div id="modal-factory-container"></div>

    <div id="rename-modal" class="modal-overlay">
        <div class="control-group modal-panel-save modal-panel-neutral" style="border-color: var(--border);">
            <div class="modal-icon modal-icon-save">✏️</div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
                <div class="section-title" style="margin: 0;">Edit Theme Snapshot</div>
                <button class="btn" id="snapshot-json-edit-btn" style="font-size: 0.6rem; padding: 5px 12px; border-radius: 8px; white-space: nowrap;" data-tooltip="Edit snapshot as raw JSON">{ } Manual Editor</button>
            </div>
            <div class="metadata-grid">
                <div class="metadata-field">
                    <label>Name</label>
                    <input type="text" id="rename-input" placeholder="Theme Name">
                </div>
                <div class="metadata-field">
                    <label>Description</label>
                    <input type="text" id="rename-desc-input" placeholder="A short description">
                </div>
                <div class="metadata-field">
                    <label>Author</label>
                    <input type="text" id="rename-author-input" placeholder="Your name">
                </div>
                <div class="metadata-field">
                    <label>Theme Version</label>
                    <input type="text" id="rename-version-input" placeholder="1.0.0">
                </div>
                <div class="metadata-field">
                    <label>Target WebUI Version</label>
                    <input type="text" id="rename-target-input" placeholder="0.9.0">
                </div>
                <div class="metadata-field">
                    <label>Repository URL</label>
                    <input type="text" id="rename-repo-input" placeholder="https://github.com/...">
                </div>
                <div class="metadata-field" style="grid-column: 1 / -1;">
                    <label>Theme Update URL</label>
                    <input type="text" id="rename-update-input" placeholder="https://...">
                </div>
            </div>
            <div class="flex-end">
                <button class="btn" data-dismiss="rename-modal">Cancel</button>
                <button class="btn btn-primary" id="confirm-rename-btn">Save Changes</button>
            </div>
        </div>
    </div>

    <div id="update-modal" class="modal-overlay z-high">
        <div class="control-group modal-panel modal-panel-neutral" style="width: 380px; max-width: 90vw;">
            <div class="modal-icon modal-icon-update">⟳</div>
            <div class="section-title" style="justify-content:center; margin-bottom: 8px;">Update Available</div>
            <p id="update-modal-info" style="font-size: 0.78rem; color:var(--text-muted); margin-bottom:20px; line-height:1.6; text-align:center;"></p>
            <div id="update-modal-details" style="background: var(--bg-deep); border: 1px solid var(--border); border-radius: 12px; padding: 14px; margin-bottom: 20px; font-size: 0.72rem; line-height: 1.7; color: var(--text-muted);"></div>
            <div class="flex-end">
                <button class="btn" id="update-skip-btn">Skip</button>
                <button class="btn btn-primary" id="update-confirm-btn" style="background: #10b981;">Update Theme</button>
            </div>
        </div>
    </div>

    <div id="update-results-modal" class="modal-overlay z-high">
        <div class="control-group modal-panel modal-panel-neutral" style="width: 420px; max-width: 90vw; max-height: 70vh; overflow-y: auto;">
            <div class="modal-icon modal-icon-update">⟳</div>
            <div class="section-title" style="justify-content:center; margin-bottom: 8px;">Update Check Results</div>
            <div id="update-results-list" style="margin-bottom: 20px;"></div>
            <div style="display:flex; gap:12px; justify-content:flex-end; align-items:center;">
                <button class="btn btn-primary" id="update-all-btn" style="background:#10b981; display:none;" data-action="apply-all-updates">Update All</button>
                <button class="btn" data-dismiss="update-results-modal">Close</button>
            </div>
        </div>
    </div>

    
    
    <div id="sync-modal" class="modal-overlay">
        <div class="control-group modal-panel modal-panel-info" style="width: 820px; max-width: 95vw; max-height: 90vh; display: flex; flex-direction: column;">
            <div class="modal-icon modal-icon-info">🔄</div>
            <div class="section-title" id="sync-modal-title" style="color:var(--accent); justify-content:center; margin-bottom: 8px;">Selective Sync</div>
            <p id="sync-source-description" style="font-size: 0.75rem; color:var(--text-muted); margin-bottom:24px; line-height:1.6;">Choose what to copy from <b><span id="sync-source-mode"></span></b>.</p>
            
            <div style="flex: 1; overflow-y: auto; min-height: 0; scrollbar-width: thin;">
            <div class="section-title" style="margin: 0 0 12px; font-size: 0.55rem; color: var(--accent); opacity: 0.8; letter-spacing: 1.5px; display: flex; justify-content: space-between; align-items: center;">
                <span>1. Target Modes</span>
                <span id="sync-toggle-targets" style="text-transform: none; font-size: 0.55rem; cursor: pointer; letter-spacing: 0.5px; opacity: 0.7; transition: 0.2s;">Deselect All</span>
            </div>
            <div id="sync-target-container" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 24px;">
                <!-- Dynamic Pills -->
            </div>

            <div class="section-title" style="margin: 0 0 12px; font-size: 0.55rem; color: var(--accent); opacity: 0.8; letter-spacing: 1.5px; display: flex; justify-content: space-between; align-items: center;">
                <span>2. Sync Settings</span>
                <span id="sync-toggle-options" style="text-transform: none; font-size: 0.55rem; cursor: pointer; letter-spacing: 0.5px; opacity: 0.7; transition: 0.2s;">Deselect All</span>
            </div>
            <div style="margin-bottom: 24px;">
                <div class="sync-option">
                    <input type="checkbox" id="sync-opt-palette" checked>
                    <label>
                        OKLCH Palette <span class="sync-delta-badge" id="sync-badge-palette" style="display:none;"></span>
                        <span>L, C, H base color values</span>
                    </label>
                    <span class="sync-diff-chevron" data-setting="palette" style="display:none;">▾</span>
                </div>
                <div class="sync-diff-panel" id="sync-diff-palette" style="display:none;"></div>

                <div class="sync-option">
                    <input type="checkbox" id="sync-opt-overrides" checked>
                    <label>
                        Variable Overrides <span class="sync-delta-badge" id="sync-badge-overrides" style="display:none;"></span>
                        <span>Manual 50-950 ramp steps & locks</span>
                    </label>
                    <span class="sync-diff-chevron" data-setting="overrides" style="display:none;">▾</span>
                </div>
                <div class="sync-diff-panel" id="sync-diff-overrides" style="display:none;"></div>

                <div class="sync-option">
                    <input type="checkbox" id="sync-opt-css" checked>
                    <label>
                        Custom CSS Snippet <span class="sync-delta-badge" id="sync-badge-css" style="display:none;"></span>
                        <span>All raw styles from Custom CSS tab</span>
                    </label>
                    <span class="sync-diff-chevron" data-setting="css" style="display:none;">▾</span>
                </div>
                <div class="sync-diff-panel" id="sync-diff-css" style="display:none;"></div>

                <div class="sync-option">
                    <input type="checkbox" id="sync-opt-canvas" checked>
                    <label>
                        Canvas FX Script <span class="sync-delta-badge" id="sync-badge-canvas" style="display:none;"></span>
                        <span>Background animation code & state</span>
                    </label>
                    <span class="sync-diff-chevron" data-setting="canvas" style="display:none;">▾</span>
                </div>
                <div class="sync-diff-panel" id="sync-diff-canvas" style="display:none;"></div>

                <div class="sync-option">
                    <input type="checkbox" id="sync-opt-gradient" checked>
                    <label>
                        Gradient Background <span class="sync-delta-badge" id="sync-badge-gradient" style="display:none;"></span>
                        <span>Color stops, direction, type & animation</span>
                    </label>
                    <span class="sync-diff-chevron" data-setting="gradient" style="display:none;">▾</span>
                </div>
                <div class="sync-diff-panel" id="sync-diff-gradient" style="display:none;"></div>

                <div class="sync-option">
                    <input type="checkbox" id="sync-opt-auth" checked>
                    <label>
                        Auth Page Visibility <span class="sync-delta-badge" id="sync-badge-auth" style="display:none;"></span>
                        <span>'Show on Auth Pages' toggles for all tabs</span>
                    </label>
                    <span class="sync-diff-chevron" data-setting="auth" style="display:none;">▾</span>
                </div>
                <div class="sync-diff-panel" id="sync-diff-auth" style="display:none;"></div>
            </div>
            </div>

            <div style="display:flex; gap:12px; justify-content:center;">
                <button class="btn" id="sync-cancel-btn" style="flex:1;" data-dismiss="sync-modal">Do Not Sync</button>
                <button class="btn btn-primary" id="confirm-sync-btn" style="flex:1;">Sync Selected</button>
            </div>
        </div>
    </div>

    <div id="json-view-modal" class="modal-overlay z-high" style="padding: 24px;">
        <div style="width: 100%; max-width: 600px; max-height: 90%; display: flex; flex-direction: column; gap: 0; animation: containerShow 0.3s cubic-bezier(0.16, 1, 0.3, 1);">
            <div class="owui-code-block" style="flex: 1; display: flex; flex-direction: column; min-height: 0; max-height: 100%;">
                <div class="owui-code-header">
                    <span class="owui-code-lang">json</span>
                    <div class="owui-code-actions">
                        <button class="owui-code-btn" id="json-collapse-btn" data-tooltip="Collapse JSON">Collapse</button>
                        <button class="owui-code-btn copy-css-btn" data-target="json-view-textarea" data-tooltip="Copy JSON to Clipboard">Copy</button>
                        <button class="owui-code-btn" id="json-close-btn" style="color: var(--text-muted);" data-tooltip="Close JSON Viewer">Close</button>
                    </div>
                </div>
                <textarea id="json-view-textarea" readonly spellcheck="false" style="flex: 1; min-height: 400px; cursor: text; user-select: text;"></textarea>
            </div>
            <div style="display: flex; justify-content: flex-end; padding: 10px 0 0; gap: 8px;">
                <span id="json-valid-badge" style="font-size: 0.65rem; font-weight: 700; color: #22c55e; opacity: 0.7;">Valid JSON</span>
            </div>
        </div>
    </div>

    <div id="snapshot-json-edit-modal" class="modal-overlay z-high" style="padding: 24px;">
        <div style="width: 100%; max-width: 600px; max-height: 90%; display: flex; flex-direction: column; gap: 0; animation: containerShow 0.3s cubic-bezier(0.16, 1, 0.3, 1);">
            <div class="owui-code-block" style="flex: 1; display: flex; flex-direction: column; min-height: 0; max-height: 100%;">
                <div class="owui-code-header">
                    <span class="owui-code-lang">json — Manual Snapshot Editor</span>
                    <div class="owui-code-actions">
                        <button class="owui-code-btn" id="snapshot-json-collapse-btn" data-tooltip="Collapse JSON">Collapse</button>
                        <button class="owui-code-btn copy-css-btn" data-target="snapshot-json-edit-textarea" data-tooltip="Copy JSON to Clipboard">Copy</button>
                        <button class="owui-code-btn" id="snapshot-json-cancel-btn" style="color: var(--text-muted);" data-tooltip="Close without saving">Close</button>
                    </div>
                </div>
                <textarea id="snapshot-json-edit-textarea" spellcheck="false" style="flex: 1; min-height: 400px; cursor: text; user-select: text;"></textarea>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 0 0; gap: 8px;">
                <span id="snapshot-json-valid-badge" style="font-size: 0.65rem; font-weight: 700; color: #22c55e; opacity: 0.7;">Valid JSON</span>
                <div style="display: flex; gap: 8px;">
                    <button class="btn" id="snapshot-json-discard-btn">Cancel</button>
                    <button class="btn btn-primary" id="snapshot-json-save-btn">Save Changes</button>
                </div>
            </div>
        </div>
    </div>

    <div id="save-json-edit-modal" class="modal-overlay z-high" style="padding: 24px;">
        <div style="width: 100%; max-width: 600px; max-height: 90%; display: flex; flex-direction: column; gap: 0; animation: containerShow 0.3s cubic-bezier(0.16, 1, 0.3, 1);">
            <div class="owui-code-block" style="flex: 1; display: flex; flex-direction: column; min-height: 0; max-height: 100%;">
                <div class="owui-code-header">
                    <span class="owui-code-lang">json — New Theme Editor</span>
                    <div class="owui-code-actions">
                        <button class="owui-code-btn" id="save-json-collapse-btn" data-tooltip="Collapse JSON">Collapse</button>
                        <button class="owui-code-btn copy-css-btn" data-target="save-json-edit-textarea" data-tooltip="Copy JSON to Clipboard">Copy</button>
                        <button class="owui-code-btn" id="save-json-cancel-btn" style="color: var(--text-muted);" data-tooltip="Close without saving">Close</button>
                    </div>
                </div>
                <textarea id="save-json-edit-textarea" spellcheck="false" style="flex: 1; min-height: 400px; cursor: text; user-select: text;"></textarea>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 0 0; gap: 8px;">
                <span id="save-json-valid-badge" style="font-size: 0.65rem; font-weight: 700; color: #22c55e; opacity: 0.7;">Valid JSON</span>
                <div style="display: flex; gap: 8px;">
                    <button class="btn" id="save-json-discard-btn">Cancel</button>
                    <button class="btn btn-primary" id="save-json-save-btn">Save as New Theme</button>
                </div>
            </div>
        </div>
    </div>

</div>

<script type="text/plain" id="bootloader-src">{BOOTLOADER_SRC}</script>

<script>
    const STORAGE_KEY = 'owui_dev_theme_v1';
    const steps =[50, 100, 200, 300, 400, 500, 600, 700, 800, 850, 900, 950];
    const MODES = ['dark', 'light', 'oled', 'her'];
    const $ = (id) => document.getElementById(id);

    // --- SVG Icon Constants ---
    const ICONS = {
        chevron: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>',
        search: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
        searchLg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
        sortDefault: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15l5 5 5-5"/><path d="M7 9l5-5 5 5"/></svg>',
        sortAsc: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>',
        sortDesc: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
        upload: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>',
        download: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
        trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
        filter: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>',
        plusAccent: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
        plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
        file: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
        dragHandle: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
        lockClosed: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="vertical-align:-2px"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
        lockOpen: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="opacity:0.5; vertical-align:-2px"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
    };
    // Populate data-icon placeholders after DOM ready
    function hydrateIcons() { document.querySelectorAll('[data-icon]').forEach(el => { const k = el.dataset.icon; if (ICONS[k]) el.innerHTML = ICONS[k]; }); }

    // --- Gallery Toolbar Generator ---
    const GALLERY_TOOLBARS = [
        {
            mountId: 'gallery-toolbar-theme', title: 'Theme Library',
            countId: 'library-count', countWrapId: 'library-count-wrap',
            searchId: 'theme-search-input', searchToggleId: 'theme-search-toggle-btn', searchPlaceholder: 'Search themes...', searchTooltip: 'Search Themes',
            sortId: 'theme-sort-btn',
            filter: { btnId: 'tag-filter-toggle-btn', dropdownId: 'tag-filter-dropdown', tooltip: 'Filter by Tag', options: [
                { value: 'all', label: 'All Themes' }, { value: 'css', label: 'Custom CSS' }, { value: 'canvas', label: 'Canvas FX' }, { value: 'gradient', label: 'Gradient' }, { value: 'overrides', label: 'Overrides' }, { value: 'linked', label: 'Linked' }
            ]},
            importId: 'import-json-btn', importTooltip: 'Import JSON',
            exportId: 'export-all-btn', exportTooltip: 'Export All (Backup)',
            save: { id: 'save-snapshot-btn', tooltip: 'Save as New Theme' },
            deleteId: 'delete-all-themes-btn', deleteTooltip: 'Delete All Themes',
            scrollId: 'snapshot-scroll', scrollStyle: 'max-height: 210px; overflow-y: auto; overflow-x: hidden; padding: 12px 8px; margin: -12px -8px 12px -8px; width: calc(100% + 16px); display: none;',
            galleryId: 'snapshot-list', galleryClass: 'preset-grid',
        },
        {
            mountId: 'gallery-toolbar-css', title: 'Preset Gallery',
            countId: 'css-count', countWrapId: 'css-count-wrap',
            searchId: 'css-search-input', searchToggleId: 'css-search-toggle-btn', searchPlaceholder: 'Search snippets...', searchTooltip: 'Search Snippets',
            sortId: 'css-sort-btn',
            importId: 'import-css-btn', importTooltip: 'Import CSS or JSON',
            exportId: 'export-all-css-btn', exportTooltip: 'Export All (Backup)',
            deleteId: 'delete-all-css-btn', deleteTooltip: 'Delete All Snippets',
            scrollId: 'css-preset-scroll', scrollStyle: 'max-height: 600px; overflow-y: auto; overflow-x: hidden; padding: 12px 8px; margin: -12px -8px 16px -8px; width: calc(100% + 16px); display: none;',
            galleryId: 'css-preset-gallery', galleryClass: 'preset-grid',
        },
        {
            mountId: 'gallery-toolbar-canvas', title: 'Preset Gallery',
            countId: 'canvas-count', countWrapId: 'canvas-count-wrap',
            searchId: 'canvas-search-input', searchToggleId: 'canvas-search-toggle-btn', searchPlaceholder: 'Search scripts...', searchTooltip: 'Search Scripts',
            sortId: 'canvas-sort-btn',
            importId: 'import-canvas-btn', importTooltip: 'Import JS or JSON',
            exportId: 'export-all-canvas-btn', exportTooltip: 'Export All (Backup)',
            deleteId: 'delete-all-canvas-btn', deleteTooltip: 'Delete All Presets',
            scrollId: 'canvas-preset-scroll', scrollStyle: 'max-height: 320px; overflow-y: auto; overflow-x: hidden; padding: 12px 8px; margin: -12px -8px 16px -8px; width: calc(100% + 16px); display: none;',
            galleryId: 'canvas-preset-gallery', galleryClass: 'preset-grid',
        },
        {
            mountId: 'gallery-toolbar-gradient', title: 'Preset Gallery',
            countId: 'gradient-quick-count', countWrapId: 'gradient-quick-count-wrap', countWrapStyle: 'opacity: 0.5;',
            searchId: 'gradient-search-input', searchToggleId: 'gradient-search-toggle-btn', searchPlaceholder: 'Search presets...', searchTooltip: 'Search Presets',
            sortId: 'gradient-sort-btn',
            filter: { btnId: 'gradient-filter-toggle-btn', dropdownId: 'gradient-filter-dropdown', tooltip: 'Filter by Type', options: [
                { value: 'all', label: 'All Types' }, { value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }, { value: 'mesh', label: 'Mesh' }
            ]},
            importId: 'import-gradient-btn', importTooltip: 'Import JSON',
            exportId: 'export-all-gradient-btn', exportTooltip: 'Export All (Backup)',
            save: { id: 'save-gradient-preset-btn', tooltip: 'Save Current Gradient', onclick: 'window.saveGradientPreset()' },
            deleteId: 'delete-all-gradient-btn', deleteTooltip: 'Delete All Presets',
            scrollId: 'gradient-preset-scroll', scrollStyle: 'max-height: 210px; overflow-y: auto; overflow-x: hidden; padding: 12px 8px; margin: -12px -8px 0 -8px; width: calc(100% + 16px);',
            galleryId: 'gradient-preset-gallery', galleryClass: 'gradient-preset-grid',
        },
    ];

    function buildGalleryToolbar(cfg) {
        const countWrapStyle = cfg.countWrapStyle || 'display:none; opacity: 0.5;';
        let filterHtml = '';
        if (cfg.filter) {
            const opts = cfg.filter.options.map((o, i) =>
                `<button class="tag-filter-option${i === 0 ? ' active' : ''}" data-filter="${o.value}"><span class="tag-filter-dot tag-filter-dot-${o.value}"></span>${o.label}</button>`
            ).join('');
            filterHtml = `<div class="tag-filter-wrap"><button class="btn btn-icon tag-filter-btn" id="${cfg.filter.btnId}" data-tooltip="${cfg.filter.tooltip}">${ICONS.filter}</button><div class="tag-filter-dropdown" id="${cfg.filter.dropdownId}">${opts}</div></div>`;
        }
        let saveHtml = '';
        if (cfg.save) {
            const oc = cfg.save.onclick ? ` onclick="${cfg.save.onclick}"` : '';
            saveHtml = `<button class="btn btn-icon" id="${cfg.save.id}"${oc} data-tooltip="${cfg.save.tooltip}">${ICONS.plusAccent}</button>`;
        }
        return `<div class="section-title" style="margin-top: 8px; display: flex; align-items: center; gap: 8px;">` +
            `<div style="flex:1;">${cfg.title} <span id="${cfg.countWrapId}" style="${countWrapStyle}">| <span id="${cfg.countId}">0</span></span></div>` +
            `<div class="flex-center-gap6">` +
                `<div class="search-wrap"><i class="search-icon-overlay">${ICONS.search}</i><input type="text" id="${cfg.searchId}" placeholder="${cfg.searchPlaceholder}" class="search-input-expand" /></div>` +
                `<button class="btn btn-icon" id="${cfg.searchToggleId}" data-tooltip="${cfg.searchTooltip}">${ICONS.searchLg}</button>` +
                `<button class="btn btn-icon sort-btn" id="${cfg.sortId}" data-sort="default" data-tooltip="Default Sort">` +
                    `<i class="sort-icon sort-icon-default">${ICONS.sortDefault}</i>` +
                    `<i class="sort-icon sort-icon-asc">${ICONS.sortAsc}</i>` +
                    `<i class="sort-icon sort-icon-desc">${ICONS.sortDesc}</i></button>` +
                filterHtml +
                `<button class="btn btn-icon" id="${cfg.importId}" data-tooltip="${cfg.importTooltip}">${ICONS.upload}</button>` +
                `<button class="btn btn-icon" id="${cfg.exportId}" data-tooltip="${cfg.exportTooltip}">${ICONS.download}</button>` +
                saveHtml +
                `<button class="btn btn-icon btn-danger" id="${cfg.deleteId}" data-tooltip="${cfg.deleteTooltip}">${ICONS.trash}</button>` +
            `</div></div>` +
            `<div id="${cfg.scrollId}" style="${cfg.scrollStyle}"><div id="${cfg.galleryId}" class="${cfg.galleryClass}"></div></div>`;
    }

    function hydrateToolbars() {
        GALLERY_TOOLBARS.forEach(cfg => {
            const mount = document.getElementById(cfg.mountId);
            if (mount) mount.innerHTML = buildGalleryToolbar(cfg);
        });
    }

    // --- Centralized Event Delegation ---
    const ACTION_MAP = {
        // Gradient actions
        'reverse-gradient':      () => window.reverseGradientStops(),
        'distribute-gradient':   () => window.distributeGradientStops(),
        'reset-gradient':        () => window.resetGradient(),
        'random-gradient':       () => window.randomGradient(),
        'toggle-transfer':       () => window.toggleTransferPanel(),
        'execute-transfer':      () => window.executeTransferColors(),
        'add-mesh-stop':         () => window.addMeshStop(),
        'add-gradient-stop':     () => window.addGradientStop(),
        // Save actions
        'save-css':              () => window.saveCssSnapshot(),
        'save-canvas':           () => window.saveCanvasSnapshot(),
        // Batch update
        'apply-all-updates':     () => window.applyAllBatchUpdates(),
    };

    function setupDelegation() {
        const body = document.getElementById('tool-body');
        if (!body) return;

        // Click delegation
        body.addEventListener('click', (e) => {
            // data-action handlers
            const actionEl = e.target.closest('[data-action]');
            if (actionEl) {
                const fn = ACTION_MAP[actionEl.dataset.action];
                if (fn) { fn(actionEl, e); return; }
            }

            // data-dismiss="modalId" — close modal
            const dismissEl = e.target.closest('[data-dismiss]');
            if (dismissEl) {
                hideModal(dismissEl.dataset.dismiss);
                if (dismissEl.dataset.dismiss === 'sync-modal') collapseAllSyncDiffs();
                return;
            }

            // sync-option click → toggle checkbox
            const syncOpt = e.target.closest('.sync-option');
            if (syncOpt && !e.target.closest('input') && !e.target.closest('.sync-diff-chevron')) {
                const cb = syncOpt.querySelector('input');
                if (cb) cb.click();
                return;
            }

            // sync-diff-chevron → toggle diff panel
            const chevron = e.target.closest('.sync-diff-chevron');
            if (chevron) {
                e.stopPropagation();
                const setting = chevron.dataset.setting;
                if (setting) toggleSyncDiff(setting);
                return;
            }
        });

        // Dblclick delegation for slider resets
        body.addEventListener('dblclick', (e) => {
            const resetEl = e.target.closest('[data-reset]');
            if (resetEl) {
                const fn = resetEl.dataset.reset;
                if (fn === 'h' || fn === 'c' || fn === 'l') resetSlider(fn);
                else if (fn === 'gradient-angle') resetGradientAngle();
                else if (fn === 'gradient-intensity') resetGradientIntensity();
                else if (fn === 'gradient-speed') resetGradientSpeed();
            }
        });
    }

    // --- Utility Helpers ---
    // Keys that the bootloader's `storage` event listener watches — must use sessionStorage in draft mode
    const _BOOTLOADER_WATCHED_KEYS = new Set(['theme', 'css_cache']);

    const Storage = {
        _keys: {
            theme: STORAGE_KEY,
            css_cache: STORAGE_KEY + '_css',
            snapshots: 'owui_theme_snapshots',
            canvas: 'owui_canvas_presets',
            css: 'owui_css_presets',
            gradients: 'owui_gradient_presets',
            metadata: 'owui_theme_last_metadata',
        },
        _resolve(key) { return this._keys[key] || key; },
        // In draft mode, bootloader-watched keys go to sessionStorage (tab-scoped, no cross-tab leak)
        _store(key) { return (_draftMode && _BOOTLOADER_WATCHED_KEYS.has(key)) ? sessionStorage : localStorage; },
        get(key, fallback = null) {
            try { return JSON.parse(this._store(key).getItem(this._resolve(key))) || fallback; }
            catch { return fallback; }
        },
        set(key, value) {
            this._store(key).setItem(this._resolve(key), JSON.stringify(value));
        },
        getRaw(key) { return this._store(key).getItem(this._resolve(key)); },
        setRaw(key, value) { this._store(key).setItem(this._resolve(key), value); },
        remove(key) { this._store(key).removeItem(this._resolve(key)); }
    };

    // --- Server-Side CSS Sync ---
    let _syncTimer = null;
    let _draftMode = false;  // When true, syncToServer is suppressed

    function setDraftMode(on) {
        if (on && !_draftMode) {
            // Entering draft: seed sessionStorage with current localStorage values
            // so the designer starts with the live theme as baseline
            _BOOTLOADER_WATCHED_KEYS.forEach(key => {
                const resolved = Storage._resolve(key);
                const val = localStorage.getItem(resolved);
                if (val) sessionStorage.setItem(resolved, val);
            });
        }
        if (!on && _draftMode) {
            // Exiting draft: migrate sessionStorage data back to localStorage
            // so the bootloader and live-mode reads see the published state
            _BOOTLOADER_WATCHED_KEYS.forEach(key => {
                const resolved = Storage._resolve(key);
                const val = sessionStorage.getItem(resolved);
                if (val) localStorage.setItem(resolved, val);
                sessionStorage.removeItem(resolved);
            });
        }
        _draftMode = on;
        // When exiting draft, persist the current mode to localStorage now that
        // the draft gate is lifted — this was suppressed during draft editing.
        if (!on) {
            syncParentNativeMode(activeMode);
        }
        const sw = document.getElementById('draft-switch');
        const labelLive = document.getElementById('draft-label-live');
        const labelDraft = document.getElementById('draft-label-draft');
        const publishBtn = document.getElementById('draft-publish-btn');
        const draftDot = document.getElementById('draft-dot');
        if (sw) sw.classList.toggle('on', on);
        if (labelLive) labelLive.classList.toggle('active', !on);
        if (labelDraft) labelDraft.classList.toggle('active', on);
        if (publishBtn) publishBtn.classList.toggle('visible', on);
        if (draftDot) draftDot.style.display = on ? 'inline-block' : 'none';
        sessionStorage.setItem('owui_theme_draft_mode', on ? '1' : '0');
    }

    function publishTheme() {
        // Push the current theme state to the server (bypasses draft gate)
        const css = Storage.getRaw('css_cache') || '';
        const state = Storage.getRaw('theme') || '{}';
        const suppress = window.__THEME_PRO_CONFIG__?.themeActive === false;
        fetch('{ROUTE_BASE}', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ css, state, suppress_broadcast: suppress })
        }).then(r => {
            if (r.ok) {
                if (suppress) {
                    showToast('Saved! Theme Active is OFF — not pushed to users.');
                } else {
                    showToast('Published! Theme pushed to all users.');
                }
                setDraftMode(false);
            } else {
                r.json().then(d => showToast('Publish failed: ' + (d.error || 'Unknown error')));
            }
        }).catch(e => showToast('Publish error: ' + e.message));
    }

    function syncToServer(css) {
        // Draft mode: skip server sync (changes stay local only)
        if (_draftMode) return;
        // Debounce: wait 250ms of inactivity before POSTing (kept low for near-instant SSE push)
        clearTimeout(_syncTimer);
        _syncTimer = setTimeout(() => {
            // Also send full theme state (includes canvas FX scripts per mode)
            const state = localStorage.getItem('owui_dev_theme_v1') || '{}';
            // If theme is inactive, tell server to save data but suppress injection/broadcast
            const suppress = window.__THEME_PRO_CONFIG__?.themeActive === false;
            fetch('{ROUTE_BASE}', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ css, state, suppress_broadcast: suppress })
            }).then(r => {
                if (r.ok) {
                    r.json().then(d => {
                        if (d.theme_active === false) {
                            console.log('[Theme Pro] CSS + state saved (theme inactive — not pushed to users)');
                        } else {
                            console.log('[Theme Pro] CSS + state synced to server');
                        }
                    }).catch(() => console.log('[Theme Pro] CSS + state synced to server'));
                }
                else r.json().then(d => console.warn('[Theme Pro] Server sync failed:', d));
            }).catch(e => console.warn('[Theme Pro] Server sync error:', e));
        }, 250);
    }

    // --- Server-Side Library Sync (presets, snapshots) ---
    let _libTimer = null;
    function syncLibrary() {
        clearTimeout(_libTimer);
        _libTimer = setTimeout(() => {
            const library = JSON.stringify({
                snapshots: getSnapshots(),
                canvas_presets: typeof CANVAS_PRESETS !== 'undefined' ? CANVAS_PRESETS : [],
                css_presets: typeof CSS_PRESETS !== 'undefined' ? CSS_PRESETS : [],
                gradient_presets: typeof CUSTOM_GRADIENT_PRESETS !== 'undefined' ? CUSTOM_GRADIENT_PRESETS : []
            });
            // Send ONLY the library data — CSS + state syncing is handled exclusively
            // by syncToServer() to prevent dual-writer race conditions where this
            // function's stale localStorage read could overwrite fresh CSS.
            fetch('{ROUTE_BASE}', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ css: '', state: '', library, suppress_broadcast: true })
            }).then(r => {
                if (r.ok) console.log('[Theme Pro] Library synced to server');
                else console.warn('[Theme Pro] Library sync failed');
            }).catch(e => console.warn('[Theme Pro] Library sync error:', e));
        }, 500);
    }

    function downloadFile(data, filename, mimeType = 'application/json') {
        const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    function minifyCss(css) {
        return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n/g, ' ').replace(/\s{2,}/g, ' ')
                  .replace(/{\s+/g, '{').replace(/}\s+/g, '}').replace(/;\s+/g, ';').replace(/:\s+/g, ':').trim();
    }

    // === Modal Factory (F1 Refactor) ===
    function buildModals() {
        const ctr = $('modal-factory-container');
        if (!ctr) return;

        const close = id => `onclick="hideModal('${id}')"`;
        const nameSpan = id => `<span id="${id}" style="color:var(--text-main); font-weight:bold; display:inline-block; vertical-align:bottom; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"></span>`;

        const V = {
            danger:  { panel: ' modal-panel-danger',  tc: '#ef4444',      ic: 'modal-icon-danger', bc: 'btn btn-danger',  bs: 'flex:1; background:#ef4444 !important; border:none; color:white !important;' },
            info:    { panel: ' modal-panel-info',     tc: 'var(--accent)', ic: 'modal-icon-info',   bc: 'btn btn-primary', bs: 'flex:1; background:var(--accent) !important; border:none; color:white !important;' },
            neutral: { panel: ' modal-panel-neutral',  tc: 'var(--accent)', ic: 'modal-icon-save',   bc: 'btn btn-primary', bs: 'flex:1;' },
            bare:    { panel: '',                      tc: 'var(--accent)', ic: '',                  bc: 'btn btn-primary', bs: 'flex:1;' },
        };

        function buildConfirm(d) {
            const v = V[d.variant || 'danger'];
            const zCls = d.zClass ? ` ${d.zClass}` : '';
            const icon = d.icon ? `<div class="modal-icon ${d.iconCls || v.ic}">${d.icon}</div>` : '';
            const mb = d.msgMb || '28px';
            const extra = d.msgCenter ? ' text-align:center;' : '';
            const bCls = d.btnCls || v.bc;
            const bStyle = d.btnStyle || v.bs;
            const center = d.noCenter ? '' : ' justify-content:center;';
            const msgId = d.msgId ? ` id="${d.msgId}"` : '';
            let cbHtml = '';
            if (d.cb) {
                const chk = d.cb.checked ? ' checked' : '';
                cbHtml = `<div style="display:flex; align-items:center; justify-content:center; gap:8px; margin-bottom:24px; cursor:pointer;" onclick="const cb = document.getElementById('${d.cb.id}'); cb.checked = !cb.checked;"><input type="checkbox" id="${d.cb.id}"${chk} style="cursor:pointer;"><label style="font-size:0.75rem; color:var(--text-muted); cursor:pointer; user-select:none;">${d.cb.label}</label></div>`;
            }
            return `<div id="${d.id}" class="modal-overlay${zCls}" role="dialog" aria-modal="true" aria-labelledby="${d.id}-title"><div class="control-group modal-panel${v.panel}">${icon}<div class="section-title" id="${d.id}-title" style="color:${v.tc}; justify-content:center; margin-bottom: 8px;">${d.title}</div><p${msgId} style="font-size: 0.75rem; color:var(--text-muted); margin-bottom:${mb}; line-height:1.6;${extra}">${d.msg}</p>${d.extraHtml || ''}${cbHtml}<div style="display:flex; gap:12px;${center}"><button class="btn" style="flex:1;" ${close(d.id)}>${d.cancelLabel || 'Cancel'}</button><button class="${bCls}" id="${d.confirmId}" style="${bStyle}">${d.confirmLabel}</button></div></div></div>`;
        }

        function buildInput(d) {
            const v = V[d.variant || 'neutral'];
            const zCls = d.zClass ? ` ${d.zClass}` : '';
            const icon = d.icon ? `<div class="modal-icon ${d.iconCls || v.ic}">${d.icon}</div>` : '';
            const titleMb = d.icon ? '8px' : '16px';
            const desc = d.desc ? `<p style="font-size: 0.75rem; color:var(--text-muted); margin-bottom:20px; text-align:center;">${d.desc}</p>` : '';
            const center = d.noCenter ? '' : ' justify-content:center;';
            return `<div id="${d.id}" class="modal-overlay${zCls}" role="dialog" aria-modal="true" aria-labelledby="${d.id}-title"><div class="control-group modal-panel${v.panel}">${icon}<div class="section-title" id="${d.id}-title" style="color:${v.tc}; justify-content:center; margin-bottom: ${titleMb};">${d.title}</div>${desc}<input type="text" id="${d.inputId}" class="modal-input" placeholder="${d.placeholder}"><div style="display:flex; gap:12px;${center}"><button class="btn" style="flex:1;" ${close(d.id)}>Cancel</button><button class="btn btn-primary" id="${d.confirmId}" style="flex:1;">${d.confirmLabel}</button></div></div></div>`;
        }

        function buildImport(d) {
            const zCls = d.zClass ? ` ${d.zClass}` : '';
            const dlSvg = ICONS.download;
            const fileSvg = ICONS.file;
            return `<div id="${d.id}" class="modal-overlay${zCls}" role="dialog" aria-modal="true" aria-labelledby="${d.id}-title"><div class="control-group modal-panel-save" style="width: 480px;"><div class="modal-icon modal-icon-save">\u{1F4E5}</div><div class="section-title" id="${d.id}-title" style="margin-bottom: 16px;">${d.title}</div><p style="font-size: 0.75rem; color:var(--text-muted); margin-bottom:20px; line-height:1.6;">${d.desc}</p><div class="metadata-field" style="margin-bottom: 20px;"><div class="flex-center-gap8"><input type="text" id="${d.urlId}" placeholder="${d.urlPlaceholder}" style="flex:1; width:100%; background: var(--bg-deep) !important; border: 1px solid var(--border) !important; color: var(--text-main) !important; padding: 9px 11px; border-radius: 10px; font-family: 'Inter', sans-serif; font-size: 0.78rem; outline: none; transition: border-color 0.2s; box-sizing: border-box;"><button class="btn" id="${d.loadBtnId}" style="flex-shrink:0; display:flex; align-items:center; gap:6px;">${dlSvg} Load URL</button></div><div id="${d.statusId}" style="display:none; margin-top:10px; font-size:0.7rem; padding:8px 12px; border-radius:8px;"></div></div><div style="display:flex; gap:12px; justify-content:flex-end; border-top: 1px solid var(--border); padding-top: 16px;"><button class="btn" ${close(d.id)}>Cancel</button><button class="btn" id="${d.fileBtnId}" style="display:flex; align-items:center; gap:6px;">${fileSvg} Import File</button></div></div></div>`;
        }

        const canvasWarning = `<div id="canvas-warning" style="display:none; background:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.3); border-radius:12px; padding:12px; margin-bottom:20px; text-align:left;"><div style="color:#ef4444; font-size:0.7rem; font-weight:bold; margin-bottom:4px; display:flex; align-items:center; gap:6px;"><span>\u26A0\uFE0F</span> Security Warning</div><p style="font-size:0.65rem; color:var(--text-muted); margin:0;">This theme contains <b>Canvas FX animation scripts</b>. Only import if you trust the source.</p></div>`;

        const defs = [
            // ── Confirm: Delete with name ──
            { t:'c', id:'delete-modal', icon:'!', title:'Delete Theme?', msg:'Are you sure you want to permanently remove "'+nameSpan('delete-theme-name')+'"?', confirmId:'confirm-delete-btn', confirmLabel:'Delete' },
            { t:'c', id:'overwrite-modal', icon:'💾', title:'Overwrite Theme?', msg:'This will replace all saved data in "'+nameSpan('overwrite-theme-name')+'" with your current configuration. This cannot be undone.', confirmId:'confirm-overwrite-btn', confirmLabel:'Overwrite', variant:'info' },
            { t:'c', id:'delete-canvas-modal', icon:'!', title:'Delete Preset?', msg:'Are you sure you want to permanently remove "'+nameSpan('delete-canvas-name')+'"? This cannot be undone.', confirmId:'confirm-delete-canvas-btn', confirmLabel:'Delete' },
            { t:'c', id:'delete-css-modal', icon:'!', title:'Delete Snippet?', msg:'Are you sure you want to permanently remove "'+nameSpan('delete-css-name')+'"? This cannot be undone.', confirmId:'confirm-delete-css-btn', confirmLabel:'Delete' },
            { t:'c', id:'delete-gradient-modal', variant:'danger', title:'Delete Gradient Preset?', msg:'Are you sure you want to delete "'+nameSpan('delete-gradient-name')+'"?', msgMb:'20px', msgCenter:true, noCenter:true, confirmId:'confirm-delete-gradient-btn', confirmLabel:'Delete', btnCls:'btn btn-danger', btnStyle:'flex:1;' },

            // ── Confirm: Mass delete ──
            { t:'c', id:'delete-all-themes-modal', icon:'!', title:'Wipe Theme Library?', msg:'Are you sure you want to permanently remove <b>ALL</b> saved themes from your library?', confirmId:'confirm-delete-all-themes-btn', confirmLabel:'Wipe All' },
            { t:'c', id:'delete-all-canvas-modal', icon:'!', title:'Wipe Canvas Presets?', msg:'Are you sure you want to permanently remove <b>ALL</b> saved animation scripts? This cannot be undone.', confirmId:'confirm-delete-all-canvas-btn', confirmLabel:'Wipe All' },
            { t:'c', id:'delete-all-css-modal', icon:'!', title:'Wipe CSS Snippets?', msg:'Are you sure you want to permanently remove <b>ALL</b> saved CSS snippets? This cannot be undone.', confirmId:'confirm-delete-all-css-btn', confirmLabel:'Wipe All' },
            { t:'c', id:'delete-all-gradient-modal', icon:'!', title:'Wipe Gradient Presets?', msg:'Are you sure you want to permanently remove <b>ALL</b> saved gradient presets? Built-in presets will not be affected. This cannot be undone.', confirmId:'confirm-delete-all-gradient-btn', confirmLabel:'Wipe All' },

            // ── Confirm: Danger with backup checkbox ──
            { t:'c', id:'nuclear-modal', icon:'\u2622\uFE0F', title:'Global Reset?', msg:'This will wipe all active overrides across ALL modes.', msgMb:'20px', confirmId:'confirm-nuclear-btn', confirmLabel:'Wipe', cb:{ id:'nuclear-backup-cb', label:'Create a backup snapshot' } },
            { t:'c', id:'factory-reset-modal', icon:'\u{1F6A8}', title:'Factory Reset?', msg:'This will permanently WIPE all themes, snapshots, and settings. This action is irreversible.', msgMb:'20px', confirmId:'confirm-factory-reset-btn', confirmLabel:'Wipe All', cb:{ id:'factory-backup-cb', label:'Export a backup before wiping', checked:true } },
            { t:'c', id:'reset-modal', icon:'\u267B\uFE0F', title:'Reset Mode?', msg:'Are you sure you want to reset the <b><span id="reset-target-mode"></span></b> mode? All color overrides, locks, custom CSS, and Canvas FX for this mode will be wiped.', msgMb:'20px', confirmId:'confirm-reset-btn', confirmLabel:'Reset Mode', cb:{ id:'reset-backup-cb', label:'Create a backup snapshot' } },

            // ── Confirm: Info ──
            { t:'c', id:'reset-all-confirm-modal', variant:'info', icon:'\u{1F512}', title:'Reset Overrides', msg:'Cannot reset because all color variable overrides are currently locked. Would you like to unlock all variables now?', confirmId:'confirm-reset-all-confirm-btn', confirmLabel:'Unlock & Reset' },
            { t:'c', id:'export-all-backups-modal', variant:'info', icon:'\u{1F4E6}', title:'Export All Backups', msgId:'export-all-backups-desc', msg:'This will download separate <b>.json</b> backup files for your <b>Theme Library</b>, <b>CSS Snippets</b>, <b>Canvas Scripts</b>, and <b>Gradient Presets</b> (if any exist).', confirmId:'confirm-export-all-backups-btn', confirmLabel:'Export' },
            { t:'c', id:'import-clipboard-modal', variant:'info', icon:'\u{1F4CB}', title:'Import from Clipboard?', msg:"We've detected a theme configuration on your clipboard. Would you like to import and apply it now?", msgMb:'20px', confirmId:'confirm-clipboard-import-btn', confirmLabel:'Import & Apply', btnCls:'btn btn-primary', btnStyle:'flex:1;', extraHtml:canvasWarning },

            // ── Save/Name ──
            { t:'i', id:'save-canvas-modal', zClass:'z-low', icon:'\u{1F3A8}', title:'Save Canvas Preset', desc:'Save the current animation as a reusable preset.', inputId:'canvas-name-input', placeholder:'Preset Name', confirmId:'confirm-save-canvas-btn', confirmLabel:'Save Preset' },
            { t:'i', id:'save-css-modal', zClass:'z-low', icon:'\u2702\uFE0F', title:'Save CSS Snippet', desc:'Save the current Custom CSS as a reusable snippet.', inputId:'css-name-input', placeholder:'Snippet Name', confirmId:'confirm-save-css-btn', confirmLabel:'Save Snippet' },
            { t:'i', id:'save-gradient-modal', variant:'bare', title:'Save Gradient Preset', inputId:'gradient-preset-name-input', placeholder:'Preset Name', confirmId:'confirm-save-gradient-btn', confirmLabel:'Save', noCenter:true },

            // ── Rename ──
            { t:'i', id:'rename-canvas-modal', icon:'\u270F\uFE0F', iconCls:'modal-icon-info', title:'Rename Preset', desc:'Enter a new name for this animation:', inputId:'rename-canvas-input', placeholder:'Preset Name', confirmId:'confirm-rename-canvas-btn', confirmLabel:'Rename' },
            { t:'i', id:'rename-css-modal', icon:'\u270F\uFE0F', iconCls:'modal-icon-info', title:'Rename Snippet', desc:'Enter a new name for this snippet:', inputId:'rename-css-input', placeholder:'Snippet Name', confirmId:'confirm-rename-css-btn', confirmLabel:'Rename' },
            { t:'i', id:'rename-gradient-modal', variant:'bare', title:'Rename Gradient Preset', inputId:'rename-gradient-input', placeholder:'New Name', confirmId:'confirm-rename-gradient-btn', confirmLabel:'Rename', noCenter:true },

            // ── Import + URL ──
            { t:'im', id:'import-theme-modal', zClass:'z-low', title:'Import Community Theme', desc:'Load a custom theme by providing a URL to a valid theme.json file.', urlId:'import-url-input', urlPlaceholder:'https://example.com/theme.json', loadBtnId:'import-url-load-btn', statusId:'import-url-status', fileBtnId:'import-file-trigger-btn' },
            { t:'im', id:'import-css-modal', zClass:'z-low', title:'Import CSS Snippet', desc:'Load a CSS snippet by providing a URL to a valid .css or .json file, or import from your device.', urlId:'import-css-url-input', urlPlaceholder:'https://example.com/snippet.css', loadBtnId:'import-css-url-load-btn', statusId:'import-css-url-status', fileBtnId:'import-css-file-trigger-btn' },
            { t:'im', id:'import-canvas-modal', zClass:'z-low', title:'Import Canvas Script', desc:'Load a canvas animation by providing a URL to a valid .js or .json file, or import from your device.', urlId:'import-canvas-url-input', urlPlaceholder:'https://example.com/animation.js', loadBtnId:'import-canvas-url-load-btn', statusId:'import-canvas-url-status', fileBtnId:'import-canvas-file-trigger-btn' },
            { t:'im', id:'import-gradient-modal', zClass:'z-low', title:'Import Gradient Presets', desc:'Load gradient presets by providing a URL to a valid .json file, or import from your device.', urlId:'import-gradient-url-input', urlPlaceholder:'https://example.com/gradients.json', loadBtnId:'import-gradient-url-load-btn', statusId:'import-gradient-url-status', fileBtnId:'import-gradient-file-trigger-btn' },
        ];

        ctr.innerHTML = defs.map(d => {
            if (d.t === 'c') return buildConfirm(d);
            if (d.t === 'i') return buildInput(d);
            if (d.t === 'im') return buildImport(d);
        }).join('');
    }
    buildModals();
    hydrateIcons();
    hydrateToolbars();

    // ── v1.5.8 Constants ──
    const TIMING = { tooltipFade: 160, toastDuration: 2500, editorDebounce: 500, historyDebounce: 800, wheelDebounce: 400, gradientStopDebounce: 600, historyLimit: 50 };
    const createNullModeMap = () => ({ dark: null, oled: null, light: null, her: null });

    // === V1.5.8 DRY Utilities ===
    const DEFAULT_MODE_DATA = {
        h: 250, c: 0, l: 20, overrides: {}, locks: {},
        paletteEnabled: true, customCSS: "", customCssEnabled: false,
        autoScope: true, canvasEnabled: false, canvasScript: "",
        manualOverrides: "", manualOverridesEnabled: false,
        gradientEnabled: false, gradientType: 'linear', gradientAngle: 135,
        gradientStops: [], gradientIntensity: 85, gradientAnimation: false,
        gradientRadialPosX: 50, gradientRadialPosY: 50, gradientRadialShape: 'ellipse', gradientRadialSize: 'farthest-corner',
        gradientMeshPoints: [], gradientMeshBgColor: '#0a0a12',
        gradientAnimationSpeed: 8, gradientShowAuth: true, themeShowAuth: true,
        customCssShowAuth: true, canvasShowAuth: true
    };

    function createDefaultModeData(overrides = {}) {
        return { ...DEFAULT_MODE_DATA, overrides: {}, locks: {}, gradientStops: [], gradientMeshPoints: [], ...overrides };
    }

    function getSnapshots() { return Storage.get('snapshots', []); }
    function saveSnapshots(s) { Storage.set('snapshots', s); syncLibrary(); }

    function parseHex(hex) {
        const h = hex.startsWith('#') ? hex.slice(1) : hex;
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }

    function getLuminance(hex) {
        const [r, g, b] = parseHex(hex);
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }

    const DEFAULT_STEP_COLORS = {
        dark: { 800: '#333333', 850: '#262626', 900: '#171717', 950: '#0d0d0d' },
        oled: { 800: '#101010', 850: '#050505', 900: '#000000', 950: '#000000' }
    };

    function getDefaultStepColor(step, chroma, lightness, mode) {
        if (chroma !== 0) return null;
        if (lightness === 20 && mode === 'dark') return DEFAULT_STEP_COLORS.dark[step] || null;
        if (lightness === 0 && mode === 'oled') return DEFAULT_STEP_COLORS.oled[step] || null;
        return null;
    }

    function showStatus(el, msg, type = 'error') {
        const colors = {
            error:   { bg: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' },
            loading: { bg: 'rgba(59, 130, 246, 0.1)', color: 'var(--accent)', border: '1px solid rgba(59, 130, 246, 0.3)' },
            success: { bg: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', border: '1px solid rgba(34, 197, 94, 0.3)' }
        };
        const c = colors[type] || colors.error;
        el.style.display = 'block';
        el.style.background = c.bg;
        el.style.color = c.color;
        el.style.border = c.border;
        el.innerHTML = msg;
    }

    function cleanMode(m) {
        const c = structuredClone(m);
        delete c.manualOverridesEnabled;
        return c;
    }

    function normalizeModeData(d, { forExport = false } = {}) {
        if (!d) return d;
        // Format normalization (handles JSON Viewer and other non-standard formats)
        if (d.oklch && d.h === undefined) {
            d.h = d.oklch.hue ?? 250;
            d.c = d.oklch.chroma ?? 0;
            d.l = d.oklch.lightness ?? 20;
            delete d.oklch;
        }
        if (Array.isArray(d.locks)) {
            const o = {};
            d.locks.forEach(k => o[k] = true);
            d.locks = o;
        }
        delete d.variables;
        // Fill defaults from DEFAULT_MODE_DATA
        const result = { ...createDefaultModeData(), ...d };
        if (forExport) delete result.manualOverridesEnabled;
        return result;
    }

    async function loadFromUrl({ urlInputId, statusId, loadBtnId, modalId, fetchMsg, emptyMsg, defaultName, defaultExt, mimeType, importFn }) {
        const urlInput = $(urlInputId);
        const statusEl = $(statusId);
        const loadBtn = $(loadBtnId);
        const url = (urlInput.value || '').trim();

        if (!url) {
            showStatus(statusEl, emptyMsg, 'error');
            return;
        }

        try { new URL(url); } catch {
            showStatus(statusEl, 'Invalid URL format. Please enter a valid URL.', 'error');
            return;
        }

        const origHTML = loadBtn.innerHTML;
        loadBtn.disabled = true;
        loadBtn.innerHTML = '<span class="spin">⟳</span> Loading...';
        showStatus(statusEl, fetchMsg, 'loading');

        try {
            // Auto-convert GitHub URLs to raw content URLs
            let fetchUrl = url;
            // github.com/user/repo/blob/branch/path → raw.githubusercontent.com/user/repo/branch/path
            const ghBlobMatch = fetchUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
            if (ghBlobMatch) {
                fetchUrl = `https://raw.githubusercontent.com/${ghBlobMatch[1]}/${ghBlobMatch[2]}/${ghBlobMatch[3]}`;
            }
            // github.com/user/repo/raw/branch/path → raw.githubusercontent.com/user/repo/branch/path
            const ghRawMatch = fetchUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/raw\/(.+)$/);
            if (ghRawMatch) {
                fetchUrl = `https://raw.githubusercontent.com/${ghRawMatch[1]}/${ghRawMatch[2]}/${ghRawMatch[3]}`;
            }
            // gist.github.com/user/id/raw/... is already fine, but gist.github.com/user/id → needs /raw
            const gistMatch = fetchUrl.match(/^https?:\/\/gist\.github\.com\/([^/]+)\/([a-f0-9]+)\/?$/);
            if (gistMatch) {
                fetchUrl = `https://gist.githubusercontent.com/${gistMatch[1]}/${gistMatch[2]}/raw`;
            }

            const res = await fetch(fetchUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            const text = await res.text();
            const fileName = url.split('/').pop().split('?')[0] || defaultName;

            let isJson = fileName.endsWith('.json');
            if (!isJson) { try { JSON.parse(text); isJson = true; } catch {} }

            const ext = isJson ? '.json' : defaultExt;
            const finalName = fileName.endsWith(ext) ? fileName : fileName + ext;
            const type = isJson ? 'application/json' : mimeType;
            const blob = new Blob([text], { type });
            const file = new File([blob], finalName, { type });

            $(modalId).style.display = 'none';
            await importFn([file]);
        } catch (err) {
            showStatus(statusEl, `Error: ${err.message}`, 'error');
        } finally {
            loadBtn.disabled = false;
            loadBtn.innerHTML = origHTML;
        }
    }

    function triggerFileImport({ accept, modalId, importFn }) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.multiple = true;
        input.onchange = async (e) => {
            const files = Array.from(e.target.files);
            if (files.length) {
                $(modalId).style.display = 'none';
                await importFn(files);
            }
        };
        input.click();
    }

    function ensureAllModes(data) {
        if (!data.oled) { data.oled = structuredClone(data.dark); data.oled.l = 0; }
        if (!data.her) { data.her = structuredClone(data.light || data.dark); }
        return data;
    }

    const GRADIENT_PROP_KEYS = [
        'gradientEnabled', 'gradientType', 'gradientAngle', 'gradientStops',
        'gradientIntensity', 'gradientAnimation', 'gradientAnimationSpeed',
        'gradientRadialPosX', 'gradientRadialPosY', 'gradientRadialShape', 'gradientRadialSize',
        'gradientMeshPoints', 'gradientMeshBgColor'
    ];
    const GRADIENT_CLONE_KEYS = new Set(['gradientStops', 'gradientMeshPoints']);

    function compareGradientProps(a, b) {
        return GRADIENT_PROP_KEYS.every(k => {
            const av = a[k], bv = b[k];
            if (GRADIENT_CLONE_KEYS.has(k)) return JSON.stringify(av || []) === JSON.stringify(bv || []);
            return (av ?? '') === (bv ?? '');
        });
    }

    function copyGradientProps(target, source) {
        for (const k of GRADIENT_PROP_KEYS) {
            if (source[k] !== undefined) target[k] = GRADIENT_CLONE_KEYS.has(k) ? structuredClone(source[k]) : source[k];
        }
    }

    function copyAuthProps(target, source) {
        for (const k of ['paletteEnabled', 'themeShowAuth', 'customCssShowAuth', 'canvasShowAuth', 'gradientShowAuth']) {
            if (source[k] !== undefined) target[k] = source[k];
        }
    }

    function resetTooltipStyles(el) {
        el.style.background = '';
        el.style.color = '';
        el.style.borderColor = '';
    }


    const DEFAULT_CANVAS_SCRIPT = `/**
 * Title: Tactical Liquid Grid
 * Description: An interactive grid of crosshairs that behaves like an elastic fabric.
 */

let canvas, ctx, width, height;
let points =[];
let mouse = { x: -5000, y: -5000 };

const CONFIG = { spacing: 40, friction: 0.85, ease: 0.1, mouseDist: 150, mouseForce: 50, color: 'rgba(255, 255, 255, 0.15)', activeColor: '#00ffff' };

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

self.onmessage = (e) => {
    switch (e.data.type) {
        case 'init':
            canvas = e.data.canvas;
            ctx = canvas.getContext('2d');
            resize(e.data.width, e.data.height);
            startAnimation();
            break;
        case 'resize': resize(e.data.width, e.data.height); break;
        case 'mousemove': mouse.x = e.data.x; mouse.y = e.data.y; break;
    }
};

function resize(w, h) {
    width = w; height = h;
    if (canvas) { canvas.width = width; canvas.height = height; }
    initGrid();
}

class Point {
    constructor(x, y) { this.originX = x; this.originY = y; this.x = x; this.y = y; this.vx = 0; this.vy = 0; }
    update() {
        const dx = mouse.x - this.x, dy = mouse.y - this.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < CONFIG.mouseDist) {
            const angle = Math.atan2(dy, dx);
            const force = (CONFIG.mouseDist - dist) / CONFIG.mouseDist;
            this.vx -= Math.cos(angle) * force * CONFIG.mouseForce;
            this.vy -= Math.sin(angle) * force * CONFIG.mouseForce;
        }
        this.vx += (this.originX - this.x) * CONFIG.ease;
        this.vy += (this.originY - this.y) * CONFIG.ease;
        this.vx *= CONFIG.friction; this.vy *= CONFIG.friction;
        this.x += this.vx; this.y += this.vy;
    }
    draw() {
        const speed = Math.abs(this.vx) + Math.abs(this.vy);
        ctx.strokeStyle = speed > 0.5 ? CONFIG.activeColor : CONFIG.color;
        ctx.lineWidth = speed > 0.5 ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(this.x - 3, this.y); ctx.lineTo(this.x + 3, this.y);
        ctx.moveTo(this.x, this.y - 3); ctx.lineTo(this.x, this.y + 3);
        ctx.stroke();
    }
}

function initGrid() {
    points =[];
    for (let x = 0; x <= width + CONFIG.spacing; x += CONFIG.spacing) {
        for (let y = 0; y <= height + CONFIG.spacing; y += CONFIG.spacing) {
            points.push(new Point(x, y));
        }
    }
}

function startAnimation() {
    function render() {
        if (!ctx) return;
        ctx.clearRect(0, 0, width, height);
        for (let i = 0; i < points.length; i++) { points[i].update(); points[i].draw(); }
        requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
}`;

    let CANVAS_PRESETS = Storage.get('canvas');
    if (!CANVAS_PRESETS || !Array.isArray(CANVAS_PRESETS) || CANVAS_PRESETS.length === 0) {
        CANVAS_PRESETS =[
            {
                name: "Tactical Liquid Grid",
                script: DEFAULT_CANVAS_SCRIPT
            }
        ];
        Storage.set('canvas', CANVAS_PRESETS);
        syncLibrary();
    }

    let CSS_PRESETS = Storage.get('css');
    if (!CSS_PRESETS || !Array.isArray(CSS_PRESETS) || CSS_PRESETS.length === 0) {
        CSS_PRESETS =[
            {
                name: "Tactical HUD",
                code: "/* ==============================\n   Tactical HUD\n   Designed to pair with the\n   Tactical Liquid Grid canvas.\n   ============================== */\n\n/* --- Base: dark void + subtle grid --- */\nbody {\n  background-color: #020a12 !important;\n  background-image:\n    linear-gradient(rgba(0, 220, 255, 0.03) 1px, transparent 1px),\n    linear-gradient(90deg, rgba(0, 220, 255, 0.03) 1px, transparent 1px) !important;\n  background-size: 40px 40px !important;\n  background-attachment: fixed !important;\n}\n\n/* --- Transparency: let Canvas FX bleed through --- */\n#app, #app > div, #app > div > div, main, .app,\n[class*=\"bg-gray-\"]:not(button):not(a):not(input):not(select):not(.user-message *) {\n  background-color: transparent !important;\n  background-image: none !important;\n}\n\n/* --- Sidebar: frosted glass panel --- */\n#sidebar {\n  background-color: rgba(2, 10, 18, 0.82) !important;\n  backdrop-filter: blur(14px) saturate(1.2) !important;\n  -webkit-backdrop-filter: blur(14px) saturate(1.2) !important;\n  border-right: 1px solid rgba(0, 220, 255, 0.18) !important;\n  box-shadow: inset -6px 0 20px rgba(0, 220, 255, 0.04) !important;\n}\n\n/* Sidebar gradient overlays */\n.sidebar-bg-gradient-to-t,\n.sidebar-bg-gradient-to-b {\n  --tw-gradient-from: rgba(2, 10, 18, 0.9) !important;\n  --tw-gradient-to: transparent !important;\n}\n\n/* Active sidebar chat highlight */\n#sidebar a.bg-gray-100\\/10,\n#sidebar [class*=\"bg-gray-850\"] {\n  background-color: rgba(0, 220, 255, 0.08) !important;\n  border-left: 2px solid #00dcff !important;\n}\n\n/* --- Navbar gradient overlay --- */\n#navbar-bg-gradient-to-b {\n  background-image: linear-gradient(\n    to bottom,\n    rgba(2, 10, 18, 0.8),\n    transparent\n  ) !important;\n}\n\n/* --- Chat scroll overlay --- */\n#chat-container .bg-linear-to-t {\n  background-image: linear-gradient(\n    to top,\n    rgba(2, 10, 18, 0.85),\n    rgba(2, 10, 18, 0.3)\n  ) !important;\n}\n\n/* --- User message bubble --- */\n.user-message .rounded-3xl {\n  background-color: rgba(0, 220, 255, 0.07) !important;\n  border: 1px solid rgba(0, 220, 255, 0.15) !important;\n}\n\n/* --- Chat input area --- */\n#chat-input-container {\n  background-color: rgba(2, 10, 18, 0.7) !important;\n  backdrop-filter: blur(10px) !important;\n  -webkit-backdrop-filter: blur(10px) !important;\n  border: 1px solid rgba(0, 220, 255, 0.15) !important;\n  border-radius: 14px !important;\n  transition: border-color 0.3s, box-shadow 0.3s !important;\n}\n\n#chat-input-container:focus-within {\n  border-color: rgba(0, 220, 255, 0.5) !important;\n  box-shadow: 0 0 20px rgba(0, 220, 255, 0.1),\n              0 0 60px rgba(0, 220, 255, 0.04) !important;\n}\n\ntextarea {\n  background-color: transparent !important;\n}\n\n/* --- Send button: pulsing neon --- */\n#send-message-button {\n  background-color: rgba(0, 220, 255, 0.85) !important;\n  color: #020a12 !important;\n  box-shadow: 0 0 12px rgba(0, 220, 255, 0.35) !important;\n  animation: hud-pulse 2.5s ease-in-out infinite !important;\n}\n\n@keyframes hud-pulse {\n  0%, 100% { box-shadow: 0 0 8px rgba(0, 220, 255, 0.25); }\n  50% { box-shadow: 0 0 22px rgba(0, 220, 255, 0.55),\n                    0 0 50px rgba(0, 220, 255, 0.12); }\n}\n\n/* --- Prose / Markdown content --- */\n.prose {\n  color: #c4e8f0 !important;\n}\n\n.prose h1, .prose h2, .prose h3 {\n  color: #00dcff !important;\n}\n\n.prose a {\n  color: #00dcff !important;\n  text-decoration-color: rgba(0, 220, 255, 0.3) !important;\n}\n\n.prose strong {\n  color: #e0f4ff !important;\n}\n\n.prose hr {\n  border-color: rgba(0, 220, 255, 0.12) !important;\n}\n\n/* --- Code blocks --- */\n.prose pre {\n  background-color: rgba(2, 8, 16, 0.92) !important;\n  border: 1px solid rgba(0, 220, 255, 0.12) !important;\n  border-radius: 10px !important;\n  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4) !important;\n}\n\n.prose code:not(pre code) {\n  background-color: rgba(0, 220, 255, 0.1) !important;\n  color: #00dcff !important;\n  padding: 1px 5px !important;\n  border-radius: 4px !important;\n}\n\n/* --- Tables --- */\n.prose table {\n  border-color: rgba(0, 220, 255, 0.15) !important;\n}\n\n.prose th {\n  background-color: rgba(0, 220, 255, 0.06) !important;\n  color: #00dcff !important;\n  border-color: rgba(0, 220, 255, 0.15) !important;\n}\n\n.prose td {\n  border-color: rgba(0, 220, 255, 0.08) !important;\n}\n\n/* --- Inputs & textareas (settings, modals) --- */\ninput[type=\"text\"],\ninput[type=\"password\"],\ninput[type=\"email\"],\ninput[type=\"number\"],\ninput[type=\"search\"],\nselect {\n  background-color: rgba(2, 10, 18, 0.8) !important;\n  border-color: rgba(0, 220, 255, 0.15) !important;\n  color: #e0f4ff !important;\n}\n\ninput:focus, select:focus {\n  border-color: rgba(0, 220, 255, 0.4) !important;\n  box-shadow: 0 0 10px rgba(0, 220, 255, 0.08) !important;\n  outline: none !important;\n}\n\n/* --- Dialogs & modals --- */\n[role=\"dialog\"] > div {\n  background-color: rgba(5, 14, 24, 0.95) !important;\n  backdrop-filter: blur(16px) !important;\n  border: 1px solid rgba(0, 220, 255, 0.12) !important;\n}\n\n/* --- Tooltips (Tippy) --- */\n.tippy-box {\n  background-color: rgba(2, 12, 20, 0.95) !important;\n  border: 1px solid rgba(0, 220, 255, 0.2) !important;\n  color: #c4e8f0 !important;\n}\n\n.tippy-arrow::before {\n  color: rgba(2, 12, 20, 0.95) !important;\n}\n\n/* --- Global border tint --- */\n* {\n  border-color: rgba(0, 220, 255, 0.08) !important;\n}\n\n/* --- Scrollbar --- */\n::-webkit-scrollbar { width: 5px; }\n::-webkit-scrollbar-track { background: transparent; }\n::-webkit-scrollbar-thumb {\n  background: rgba(0, 220, 255, 0.25);\n  border-radius: 4px;\n}\n::-webkit-scrollbar-thumb:hover {\n  background: rgba(0, 220, 255, 0.5);\n}\n\n/* --- Selection highlight --- */\n::selection {\n  background: rgba(0, 220, 255, 0.25) !important;\n  color: #ffffff !important;\n}"
            }
        ];
        Storage.set('css', CSS_PRESETS);
        syncLibrary();
    }

    let CUSTOM_GRADIENT_PRESETS = Storage.get('gradients', []);
    if (!Array.isArray(CUSTOM_GRADIENT_PRESETS)) CUSTOM_GRADIENT_PRESETS = [];

    // Load presets from server (source of truth) — auto-migrate from localStorage on first run
    (function loadServerLibrary() {
        fetch('{ROUTE_BASE}/library.json', { credentials: 'same-origin' })
            .then(r => r.ok ? r.json() : null)
            .then(lib => {
                if (!lib) return;
                const hasServerData = (lib.snapshots && lib.snapshots.length > 0)
                    || (lib.canvas_presets && lib.canvas_presets.length > 0)
                    || (lib.css_presets && lib.css_presets.length > 0)
                    || (lib.gradient_presets && lib.gradient_presets.length > 0);

                if (hasServerData) {
                    // Server has data — use it as source of truth
                    if (lib.snapshots && lib.snapshots.length > 0) saveSnapshots(lib.snapshots);
                    if (lib.canvas_presets && lib.canvas_presets.length > 0) { CANVAS_PRESETS.splice(0, CANVAS_PRESETS.length, ...lib.canvas_presets); Storage.set('canvas', CANVAS_PRESETS); }
                    if (lib.css_presets && lib.css_presets.length > 0) { CSS_PRESETS.splice(0, CSS_PRESETS.length, ...lib.css_presets); Storage.set('css', CSS_PRESETS); }
                    if (lib.gradient_presets && lib.gradient_presets.length > 0) { CUSTOM_GRADIENT_PRESETS.splice(0, CUSTOM_GRADIENT_PRESETS.length, ...lib.gradient_presets); Storage.set('gradients', CUSTOM_GRADIENT_PRESETS); }
                    // Re-render preset UIs
                    if (typeof renderSnapshots === 'function') renderSnapshots();
                    if (typeof renderCanvasPresets === 'function') renderCanvasPresets();
                    if (typeof renderCssPresets === 'function') renderCssPresets();
                    if (typeof renderGradientPresets === 'function') renderGradientPresets();
                    console.log('[Theme Pro] Library loaded from server');
                } else {
                    // Server empty — auto-migrate localStorage data (one-time)
                    const hasLocalData = getSnapshots().length > 0
                        || CANVAS_PRESETS.length > 0
                        || CSS_PRESETS.length > 0
                        || CUSTOM_GRADIENT_PRESETS.length > 0;
                    if (hasLocalData) {
                        syncLibrary();
                        console.log('[Theme Pro] Auto-migrated localStorage presets to server');
                    }
                }
            })
            .catch(e => console.warn('[Theme Pro] Library load failed:', e));
    })();

    // Mathematically match Open WebUI's native Tailwind v4 exact baseline
    const lightnessMap = { 50: 0.98, 100: 0.94, 200: 0.92, 300: 0.85, 400: 0.77, 500: 0.69, 600: 0.51, 700: 0.42, 800: 0.32, 850: 0.27, 900: 0.20, 950: 0.16 };
    
    const CURATED_PRESETS = { 
        midnight: { dark:[250, 20, 15], oled:[250, 20, 0], light:[250, 20, 15], her:[250, 20, 15], gradient: { type: 'linear', angle: 135, stops: [{color:'#0a0a2e',position:0},{color:'#1a1a4e',position:33},{color:'#0d1b3e',position:66},{color:'#0a0a2e',position:100}] } },
        emerald: { dark:[155, 15, 18], oled:[155, 15, 0], light:[155, 15, 18], her:[155, 15, 18], gradient: { type: 'linear', angle: 135, stops: [{color:'#0b1a0f',position:0},{color:'#1b3a26',position:33},{color:'#0d2818',position:66},{color:'#0b1a0f',position:100}] } },
        amber: { dark:[75, 20, 20], oled:[75, 20, 0], light:[75, 20, 20], her:[75, 20, 20], gradient: { type: 'linear', angle: 135, stops: [{color:'#1a1608',position:0},{color:'#2e2510',position:33},{color:'#1f1a0a',position:66},{color:'#1a1608',position:100}] } },
        amethyst: { dark:[290, 25, 18], oled:[290, 25, 0], light:[290, 25, 18], her:[290, 25, 18], gradient: { type: 'linear', angle: 135, stops: [{color:'#0d0221',position:0},{color:'#261447',position:33},{color:'#1a0a35',position:66},{color:'#0d0221',position:100}] } },
        ruby: { dark:[350, 25, 18], oled:[350, 25, 0], light:[350, 25, 18], her:[350, 25, 18], gradient: { type: 'linear', angle: 135, stops: [{color:'#1a0a0a',position:0},{color:'#3a1020',position:33},{color:'#2a0815',position:66},{color:'#1a0a0a',position:100}] } },
        sapphire: { dark:[210, 25, 18], oled:[210, 25, 0], light:[210, 25, 18], her:[210, 25, 18], gradient: { type: 'linear', angle: 135, stops: [{color:'#0a1628',position:0},{color:'#0d3b66',position:33},{color:'#0a2540',position:66},{color:'#0a1628',position:100}] } },
        topaz: { dark:[40, 20, 18], oled:[40, 20, 0], light:[40, 20, 18], her:[40, 20, 18], gradient: { type: 'linear', angle: 135, stops: [{color:'#1a140a',position:0},{color:'#2e2010',position:33},{color:'#241a0c',position:66},{color:'#1a140a',position:100}] } },
        obsidian: { dark:[0, 0, 10], oled:[0, 0, 0], light:[0, 0, 10], her:[0, 0, 10], gradient: { type: 'linear', angle: 135, stops: [{color:'#000000',position:0},{color:'#1a1a2e',position:33},{color:'#16213e',position:66},{color:'#0a0a1a',position:100}] } }
    };
    const curatedCountEl = document.getElementById('curated-count');
    if (curatedCountEl) curatedCountEl.textContent = Object.keys(CURATED_PRESETS).length;

    function renderTonalRampHTML(config, dataMode) {
        const h = config.h, c = config.c / 1000, l = config.l / 100;
        const ov = config.overrides || {};
        const deltaL = l - 0.20;

        const colors = steps.map(step => {
            const baseL = lightnessMap[step];
            const targetL = Math.max(0.00, Math.min(0.98, baseL + deltaL));
            let val = `oklch(${targetL.toFixed(3)} ${c.toFixed(3)} ${c === 0 ? 0 : h})`;

            const stepOverride = getDefaultStepColor(step, config.c, config.l, dataMode);
            if (stepOverride) val = stepOverride;

            return ov[`--color-gray-${step}`] || val;
        });

        return colors.map(col => `<div style="flex:1; height:100%; background:${col};"></div>`).join('');
    }

    // If resuming a draft session, prefer draft state over published state
    const _resumingDraft = sessionStorage.getItem('owui_theme_draft_mode') === '1';
    const saved = (() => {
        if (_resumingDraft) {
            // In draft mode, Storage routes bootloader-watched keys (incl. 'theme')
            // to sessionStorage — so Storage.get('theme') reads the draft state
            const draftData = Storage.get('theme', null);
            if (draftData) return draftData;
        }
        return Storage.get('theme', {});
    })();
    
    let activeMode = 'dark'; // 'dark', 'oled', 'light', or 'her'

    // Auto-detect OWUI theme to match designer appearance
    (function() {
        try {
            const owuiTheme = localStorage.getItem('theme') || 'dark';
            if (owuiTheme === 'light') { activeMode = 'light'; document.body.classList.add('light-mode'); }
            else if (owuiTheme === 'her') { activeMode = 'her'; document.body.classList.add('light-mode'); }
            else if (owuiTheme === 'oled-dark') { activeMode = 'oled'; }
            else if (owuiTheme === 'system') {
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                if (!prefersDark) { activeMode = 'light'; document.body.classList.add('light-mode'); }
            }
        } catch(e) {}
    })();
    let shouldInject = true;
    let activeThemeRef = saved._activeThemeRef || createNullModeMap(); 
    let activeCanvasRef = saved._activeCanvasRef || createNullModeMap();
    let activeCssRef = saved._activeCssRef || createNullModeMap();
    let activeGradientRef = saved._activeGradientRef || createNullModeMap();
    
    let themeData = {
        dark: saved.dark || createDefaultModeData(),
        oled: saved.oled || createDefaultModeData({ l: 0 }),
        light: saved.light || createDefaultModeData(),
        her: saved.her || createDefaultModeData()
    };

    // History Engine (Undo/Redo)
    let historyStack =[];
    let historyIndex = -1;

    function pushState() {
        // Remove redo history if we are in the middle of the stack
        if (historyIndex < historyStack.length - 1) {
            historyStack = historyStack.slice(0, historyIndex + 1);
        }
        
        // Push deep copy of current data (including refs)
        historyStack.push(structuredClone({
            themeData,
            activeThemeRef,
            activeCanvasRef,
            activeCssRef,
            activeGradientRef
        }));
        
        // Limit stack size (e.g., 50 states)
        if (historyStack.length > TIMING.historyLimit) {
            historyStack.shift();
        } else {
            historyIndex++;
        }
        
        updateHistoryButtons();
    }

    function commitChange({ clearRef = true, push = true, dm = null, snapshots = false } = {}) {
        const mode = dm || getActiveDataMode();
        if (clearRef) activeThemeRef[mode] = null;
        shouldInject = true;
        updatePalette();
        if (push) pushState();
        if (snapshots) renderSnapshots();
    }

    function migrateLegacyTheme(data) {
        const ov = data.overrides || {};
        const locks = {};
        Object.keys(ov).forEach(k => locks[k] = true);
        return {
            name: data.name || 'Imported Theme',
            dark: createDefaultModeData({ h: data.h, c: data.c, l: data.l, overrides: structuredClone(ov), locks: structuredClone(locks) }),
            oled: createDefaultModeData({ h: data.h, c: data.c, l: 0, overrides: structuredClone(ov), locks: structuredClone(locks) }),
            light: createDefaultModeData({ h: data.h, c: data.c, l: data.l }),
            her: createDefaultModeData({ h: data.h, c: data.c, l: data.l }),
        };
    }

    function buildCuratedSourceData(presetData, mode) {
        const mp = presetData[mode] || presetData.dark;
        const pg = presetData.gradient || {};
        return {
            ...createDefaultModeData({ h: mp[0], c: mp[1], l: mp[2] }),
            paletteEnabled: true, gradientEnabled: true,
            gradientType: pg.type || 'linear', gradientAngle: pg.angle || 135,
            gradientStops: structuredClone(pg.stops || []), gradientIntensity: 100,
        };
    }

    function initDragDrop(listEl, rowSelector, reorderFn) {
        let srcIndex = null, ghost = null, indicator = null, dropIndex = null, offsetY = 0;

        function getRowRects() {
            return Array.from(listEl.querySelectorAll(rowSelector)).map(r => ({
                el: r, index: parseInt(r.dataset.index), rect: r.getBoundingClientRect()
            }));
        }

        function cleanup() {
            if (ghost) { ghost.remove(); ghost = null; }
            if (indicator) { indicator.remove(); indicator = null; }
            listEl.querySelectorAll(rowSelector + '.dragging-src').forEach(r => r.classList.remove('dragging-src'));
            document.body.style.cursor = '';
            srcIndex = null;
            dropIndex = null;
        }

        listEl.querySelectorAll('.gradient-drag-handle').forEach(handle => {
            handle.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const row = handle.closest(rowSelector);
                if (!row) return;
                srcIndex = parseInt(row.dataset.index);
                dropIndex = srcIndex;

                const rect = row.getBoundingClientRect();
                offsetY = e.clientY - rect.top;
                ghost = row.cloneNode(true);
                ghost.className = 'gradient-drag-ghost';
                ghost.style.width = rect.width + 'px';
                ghost.style.left = rect.left + 'px';
                ghost.style.top = (e.clientY - offsetY) + 'px';
                ghost.style.background = getComputedStyle(row).background;
                document.body.appendChild(ghost);

                indicator = document.createElement('div');
                indicator.className = 'gradient-drop-indicator';
                listEl.appendChild(indicator);

                row.classList.add('dragging-src');
                document.body.style.cursor = 'grabbing';
                handle.setPointerCapture(e.pointerId);

                const onMove = (ev) => {
                    if (srcIndex === null) return;
                    if (ghost) ghost.style.top = (ev.clientY - offsetY) + 'px';

                    const rows = getRowRects();
                    let newDropIndex = srcIndex;
                    const pointerY = ev.clientY;

                    for (let i = 0; i < rows.length; i++) {
                        const mid = rows[i].rect.top + rows[i].rect.height / 2;
                        if (pointerY < mid) { newDropIndex = i; break; }
                        newDropIndex = i + 1;
                    }
                    if (newDropIndex > rows.length) newDropIndex = rows.length;
                    dropIndex = newDropIndex;

                    if (indicator && rows.length > 0) {
                        const listRect = listEl.getBoundingClientRect();
                        let indicatorTop;
                        if (dropIndex === 0) {
                            indicatorTop = rows[0].rect.top - listRect.top - 4;
                        } else if (dropIndex >= rows.length) {
                            indicatorTop = rows[rows.length - 1].rect.bottom - listRect.top + 3;
                        } else {
                            indicatorTop = (rows[dropIndex - 1].rect.bottom + rows[dropIndex].rect.top) / 2 - listRect.top;
                        }
                        indicator.style.top = indicatorTop + 'px';
                    }
                };

                const onUp = () => {
                    handle.removeEventListener('pointermove', onMove);
                    handle.removeEventListener('pointerup', onUp);
                    handle.removeEventListener('pointercancel', onUp);

                    if (srcIndex !== null && dropIndex !== null && dropIndex !== srcIndex && dropIndex !== srcIndex + 1) {
                        const targetIndex = dropIndex > srcIndex ? dropIndex - 1 : dropIndex;
                        reorderFn(srcIndex, targetIndex);
                    }
                    cleanup();
                };

                handle.addEventListener('pointermove', onMove);
                handle.addEventListener('pointerup', onUp);
                handle.addEventListener('pointercancel', onUp);
            });
        });
    }

    function showModal(id) { $(id).style.display = 'flex'; }
    function hideModal(id) { $(id).style.display = 'none'; }

    function restoreHistoryState(state) {
        const dm = getActiveDataMode();
        if (state.themeData) {
            themeData = state.themeData;
            activeThemeRef = state.activeThemeRef;
            activeCanvasRef = state.activeCanvasRef;
            activeCssRef = state.activeCssRef;
            activeGradientRef = state.activeGradientRef || activeGradientRef;
        } else {
            themeData = state;
            activeThemeRef[dm] = null;
            activeCanvasRef[dm] = null;
            activeCssRef[dm] = null;
            activeGradientRef[dm] = null;
        }
        commitChange({ clearRef: false, push: false });
        updateHistoryButtons();
    }

    function undo() {
        if (historyIndex > 0) {
            historyIndex--;
            restoreHistoryState(structuredClone(historyStack[historyIndex]));
            showToast("Undone");
        }
    }

    function redo() {
        if (historyIndex < historyStack.length - 1) {
            historyIndex++;
            restoreHistoryState(structuredClone(historyStack[historyIndex]));
            showToast("Redone");
        }
    }

    function updateHistoryButtons() {
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');
        
        if (undoBtn) {
            undoBtn.disabled = historyIndex <= 0;
            undoBtn.style.opacity = undoBtn.disabled ? "0.3" : "1";
        }
        if (redoBtn) {
            redoBtn.disabled = historyIndex >= historyStack.length - 1;
            redoBtn.style.opacity = redoBtn.disabled ? "0.3" : "1";
        }
    }

    function showToast(msg) {
        const toast = document.getElementById('action-toast');
        if (toast) {
            toast.innerText = msg;
            toast.classList.add('show');
            clearTimeout(toast._hideTimer);
            toast._hideTimer = setTimeout(() => {
                toast.classList.remove('show');
            }, TIMING.toastDuration);
        }
    }

    // Custom Tooltip Engine
    const tooltipEl = document.createElement('div');
    tooltipEl.className = 'owui-tooltip';
    document.body.appendChild(tooltipEl);
    let activeTooltipTarget = null;

    document.body.addEventListener('mouseover', (e) => {
        const target = e.target.closest('[data-tooltip], [data-tooltip-html]');
        if (!target) return;
        const htmlContent = target.getAttribute('data-tooltip-html');
        const text = htmlContent || target.getAttribute('data-tooltip');
        if (!text) return;

        // Cancel any pending cleanup from a previous mouseout
        clearTimeout(tooltipEl._richCleanup);
        activeTooltipTarget = target;
        if (htmlContent) {
            tooltipEl.innerHTML = htmlContent;
            tooltipEl.classList.add('rich');
        } else {
            tooltipEl.textContent = text;
            tooltipEl.classList.remove('rich');
        }
        tooltipEl.classList.add('visible');
        
        const applyTooltipColor = (hex) => {
            tooltipEl.style.background = hex;
            tooltipEl.style.borderColor = 'rgba(255, 255, 255, 0.15)';
            tooltipEl.style.color = (getLuminance(hex) > 0.6) ? '#000000' : '#ffffff';
        };

        if (target.classList.contains('ramp-block')) {
            const hex = target.getAttribute('data-hex') || text.replace('Copy ', '');
            applyTooltipColor(hex);
        } else if (target.classList.contains('var-picker')) {
            const hex = target.value || text;
            applyTooltipColor(hex);
        } else {
            // Reset styles to defaults for regular tooltips
            resetTooltipStyles(tooltipEl);
        }
        
        const rect = target.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft || document.body.scrollLeft || 0;
        
        let top = rect.top + scrollTop - tooltipEl.offsetHeight - 8;
        let left = rect.left + scrollLeft + (rect.width / 2) - (tooltipEl.offsetWidth / 2);
        
        if (top < scrollTop) top = rect.bottom + scrollTop + 8;
        if (left < scrollLeft) left = scrollLeft + 8;
        if (left + tooltipEl.offsetWidth > window.innerWidth + scrollLeft) {
            left = window.innerWidth + scrollLeft - tooltipEl.offsetWidth - 8;
        }
        
        tooltipEl.style.top = top + 'px';
        tooltipEl.style.left = left + 'px';
    });

    function scheduleTooltipCleanup() {
        clearTimeout(tooltipEl._richCleanup);
        tooltipEl._richCleanup = setTimeout(() => {
            tooltipEl.classList.remove('rich');
            resetTooltipStyles(tooltipEl);
        }, TIMING.tooltipFade);
    }

    document.body.addEventListener('mouseout', (e) => {
        if (activeTooltipTarget && !activeTooltipTarget.contains(e.relatedTarget)) {
            tooltipEl.classList.remove('visible');
            activeTooltipTarget = null;
            scheduleTooltipCleanup();
        }
    });

    document.body.addEventListener('mousedown', () => {
        tooltipEl.classList.remove('visible');
        scheduleTooltipCleanup();
    });

    const isOverridesMatch = (m1, m2) => {
        const o1 = m1.overrides || {}, o2 = m2.overrides || {};
        const l1 = m1.locks || {}, l2 = m2.locks || {};
        const k1 = Object.keys(o1), k2 = Object.keys(o2);
        const lk1 = Object.keys(l1), lk2 = Object.keys(l2);
        const matchOverrides = k1.length === k2.length && k1.every(k => o1[k] === o2[k]);
        const matchLocks = lk1.length === lk2.length && lk1.every(k => l1[k] === l2[k]);
        return matchOverrides && matchLocks;
    };

    const isModeMatch = (m1, m2) => {
        if (!m1 || !m2) return false;
        return m1.h === m2.h && m1.c === m2.c && m1.l === m2.l && 
               !!m1.paletteEnabled === !!m2.paletteEnabled &&
               isOverridesMatch(m1, m2) && 
               (m1.customCSS || "") === (m2.customCSS || "") && 
               (m1.customCssEnabled !== false) === (m2.customCssEnabled !== false) && 
               (m1.autoScope === true) === (m2.autoScope === true) &&
               (m1.canvasEnabled === true) === (m2.canvasEnabled === true) &&
               (m1.canvasScript || "") === (m2.canvasScript || "") &&
               (m1.gradientEnabled === true) === (m2.gradientEnabled === true) &&
               (m1.gradientType || DEFAULT_MODE_DATA.gradientType) === (m2.gradientType || DEFAULT_MODE_DATA.gradientType) &&
               (m1.gradientAngle ?? DEFAULT_MODE_DATA.gradientAngle) === (m2.gradientAngle ?? DEFAULT_MODE_DATA.gradientAngle) &&
               JSON.stringify(m1.gradientStops || []) === JSON.stringify(m2.gradientStops || []) &&
               (m1.gradientRadialPosX ?? 50) === (m2.gradientRadialPosX ?? 50) &&
               (m1.gradientRadialPosY ?? 50) === (m2.gradientRadialPosY ?? 50) &&
               (m1.gradientRadialShape || 'ellipse') === (m2.gradientRadialShape || 'ellipse') &&
               (m1.gradientRadialSize || 'farthest-corner') === (m2.gradientRadialSize || 'farthest-corner') &&
               JSON.stringify(m1.gradientMeshPoints || []) === JSON.stringify(m2.gradientMeshPoints || []) &&
               (m1.gradientMeshBgColor || '#0a0a12') === (m2.gradientMeshBgColor || '#0a0a12');
    };


    function getVariablesMap(config, mode) {
        const vars = {};
        const h = config.h, c = config.c / 1000, l = config.l / 100;
        const ov = config.overrides || {};
        const deltaL = l - 0.20;
        const dm = mode || getActiveDataMode();

        steps.forEach(step => {
            const baseL = lightnessMap[step];
            const targetL = Math.max(0.00, Math.min(0.98, baseL + deltaL));
            let computedVal = `oklch(${targetL.toFixed(3)} ${c.toFixed(3)} ${c === 0 ? 0 : h})`;

            const stepOverride = getDefaultStepColor(step, config.c, config.l, dm);
            if (stepOverride) computedVal = stepOverride;

            vars[`--color-gray-${step}`] = ov[`--color-gray-${step}`] || computedVal;
        });
        return vars;
    }

    function getDefaultColorForStep(mode, step) {
        const defaultL = (mode === 'oled') ? 0 : 20;
        const h = 250, c = 0, l = defaultL / 100;
        const baseL = lightnessMap[step];
        const targetL = Math.max(0.00, Math.min(0.98, baseL + (l - 0.20)));
        let computedVal = `oklch(${targetL.toFixed(3)} ${c.toFixed(3)} 0)`;

        const stepOverride = getDefaultStepColor(step, 0, defaultL, mode);
        if (stepOverride) computedVal = stepOverride;
        return computedVal;
    }

    function isModeAtDefault(mode) {
        const defaultL = (mode === 'oled') ? 0 : 20;
        return themeData[mode].h === DEFAULT_MODE_DATA.h && themeData[mode].c === DEFAULT_MODE_DATA.c && themeData[mode].l === defaultL;
    }

    function applyBaseColorsToMode(mode, h, c, l) {
        const dataMode = (mode === 'system') ? getActiveDataMode() : mode;
        if (!themeData[dataMode]) return;
        
        themeData[dataMode].h = h;
        themeData[dataMode].c = c;
        themeData[dataMode].l = l;
        // Wipe unlocked overrides so they fall back to the new slider values
        if (!themeData[dataMode].overrides) themeData[dataMode].overrides = {};
        if (!themeData[dataMode].locks) themeData[dataMode].locks = {};
        
        Object.keys(themeData[dataMode].overrides).forEach(varName => {
            if (!themeData[dataMode].locks[varName]) {
                delete themeData[dataMode].overrides[varName];
            }
        });
    }

    function detectWashedOut(dataMode, activeVars) {
        const bgVal = (dataMode === 'light' || dataMode === 'her') ? activeVars['--color-gray-50'] : activeVars['--color-gray-950'];
        const effL = getEffectiveLightness(bgVal);
        return {
            dark: (dataMode === 'dark' || dataMode === 'oled') && (effL > 0.50),
            light: (dataMode === 'light' || dataMode === 'her') && (effL > 0.45)
        };
    }

    function updatePalette() {
        const dm = getActiveDataMode();
        const config = themeData[dm];
        
        // Sync UI Sliders
        ['h', 'c', 'l'].forEach(k => { if ($(`sl-${k}`)) $(`sl-${k}`).value = config[k]; });
        if ($('val-h')) $('val-h').innerText = config.h + '°';
        if ($('val-c')) $('val-c').innerText = (config.c / 1000).toFixed(2);
        if ($('val-l')) $('val-l').innerText = Math.round(config.l) + '%';
        
        // Main Preview Box
        const lNorm = config.l / 100;
        const preview = $('prev-main');
        if (preview) {
            preview.style.background = `oklch(${lNorm} ${config.c / 1000} ${config.h})`;
            preview.innerHTML = `<span style="color:${lNorm > 0.45 ? 'black' : 'white'}; font-size:10px; font-weight:bold; display:flex; justify-content:center; align-items:center; height:100%;">Aa</span>`;
        }

        // Ramp
        const activeVars = getVariablesMap(config);
        const dataMode = dm;
        const washedOut = detectWashedOut(dataMode, activeVars);
        document.body.classList.toggle('washed-out', washedOut.dark || washedOut.light);

        const gRamp = $('ramp-gray');
        if (gRamp) {
            gRamp.innerHTML = steps.map(s => {
                const hex = oklchToHex(activeVars[`--color-gray-${s}`]);
                const rawVal = activeVars[`--color-gray-${s}`];
                let lVal = 0;
                if (rawVal.startsWith('oklch(')) lVal = parseFloat(rawVal.split(' ')[0].replace('oklch(', ''));
                else if (rawVal.startsWith('#')) {
                    const r = parseInt(rawVal.slice(1,3), 16), g = parseInt(rawVal.slice(3,5), 16), b = parseInt(rawVal.slice(5,7), 16);
                    lVal = (r*0.299 + g*0.587 + b*0.114) / 255;
                }
                const textColor = lVal > 0.6 ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)';
                return `<div class="ramp-block" data-hex="${hex}" style="background: ${activeVars[`--color-gray-${s}`]}; color: ${textColor};" onclick="navigator.clipboard.writeText('${hex}').then(()=>showToast('Copied ${hex}'))" data-tooltip="Copy ${hex}">${s}</div>`;
            }).join('');
        }

        // Sync Custom CSS Editor
        const syncCheck = (id, val) => { const el = $(id); if (el) el.checked = val; };
        if ($('custom-css-editor')) { $('custom-css-editor').value = config.customCSS || ""; updateLineNumbers($('custom-css-editor')); }

        syncCheck('toggle-custom-css', config.customCssEnabled !== false);
        syncCheck('toggle-auto-scope', config.autoScope !== false);
        syncCheck('toggle-palette-enabled', !!config.paletteEnabled);
        syncCheck('toggle-theme-auth', config.themeShowAuth !== false);
        syncCheck('toggle-custom-auth', config.customCssShowAuth !== false);
        
        // Sync Manual Overrides Editor
        if ($('manual-overrides-editor')) { $('manual-overrides-editor').value = config.manualOverrides || ""; updateLineNumbers($('manual-overrides-editor')); }

        syncCheck('toggle-manual-overrides', !!config.manualOverridesEnabled);
        
        // Sync Canvas Editor
        if ($('canvas-fx-editor')) { $('canvas-fx-editor').value = config.canvasScript || ""; updateLineNumbers($('canvas-fx-editor')); }

        syncCheck('toggle-canvas-fx', config.canvasEnabled === true);
        syncCheck('toggle-canvas-auth', config.canvasShowAuth !== false);
        
        const workerBadge = $('canvas-worker-badge');
        if (workerBadge) {
            if (config.canvasEnabled && config.canvasScript && config.canvasScript.trim() !== '') {
                workerBadge.style.display = 'inline-block';
                if (typeof HTMLCanvasElement !== 'undefined' && !!HTMLCanvasElement.prototype.transferControlToOffscreen) {
                    workerBadge.innerText = 'Background Worker';
                    workerBadge.style.color = '#10b981';
                    workerBadge.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
                } else {
                    workerBadge.innerText = 'Main Thread (Fallback)';
                    workerBadge.style.color = '#f59e0b';
                    workerBadge.style.backgroundColor = 'rgba(245, 158, 11, 0.1)';
                }
            } else {
                workerBadge.style.display = 'none';
            }
        }

        renderVariableGrid(config, activeVars);
        updateCodeView();
        if (shouldInject) injectLive();
        else forceLocalIframeTheme();
        updateActiveHighlights();
        renderCanvasPresets();
        renderCssPresets();
        renderCuratedDots();
        renderGradientTab();
    }

    function updateActiveHighlights() {
        const dm = getActiveDataMode();
        const snapshots = getSnapshots();
        
        // Auto-resolution removed in favor of proper ref persistence to prevent "swapping" confusion.
        // Highlights now strictly follow explicit user selection or loaded state.
        
        document.querySelectorAll('#snapshot-list .preset-btn').forEach((btn, i) => {
            const isRef = activeThemeRef[dm] && activeThemeRef[dm].type === 'snapshot' && activeThemeRef[dm].id === i;
            btn.classList.toggle('active-theme', !!isRef);
        });

        document.querySelectorAll('.preset-btn[data-preset]').forEach(btn => {
            const pId = btn.dataset.preset;
            const isRef = activeThemeRef[dm] && activeThemeRef[dm].type === 'preset' && activeThemeRef[dm].id === pId;
            btn.classList.toggle('active-theme', !!isRef);
        });

        // Highlight the resolved data mode when in System mode
        document.querySelectorAll('.mode-btn').forEach(btn => {
            const m = btn.dataset.mode;
            btn.classList.toggle('system-active', activeMode === 'system' && m !== 'system' && m === dm);
        });
    }

    function renderCuratedDots() {
        const dm = getActiveDataMode();
        Object.keys(CURATED_PRESETS).forEach(id => {
            const pArr = CURATED_PRESETS[id][dm] || CURATED_PRESETS[id].dark;
            const dot = document.getElementById('dot-' + id);
            if (dot) {
                dot.style.background = '';
                dot.innerHTML = renderTonalRampHTML({h: pArr[0], c: pArr[1], l: pArr[2], overrides: {}}, dm);
            }
        });
    }

    function renderPresetGallery({ presets, galleryId, scrollAreaId, searchInputId, countWrapId, countId,
        sortVar, contentField, activeRefMap, loadFnName, emptyMsg, noResultsPrefix,
        actionFns: { rename, update, del, exp }, actionLabels }) {
        const gallery = $(galleryId);
        const scrollArea = $(scrollAreaId);
        if (!gallery || !scrollArea) return;
        const dm = getActiveDataMode();

        const countWrap = $(countWrapId);
        const countEl = $(countId);

        const searchInput = $(searchInputId);
        const searchQuery = (searchInput ? searchInput.value : '').trim().toLowerCase();
        let filtered = presets.map((p, i) => ({ ...p, _origIndex: i }));
        if (searchQuery) {
            filtered = filtered.filter(p => (p.name || '').toLowerCase().includes(searchQuery));
        }
        if (sortVar !== 'default') {
            filtered.sort((a, b) => {
                const nameA = (a.name || '').toLowerCase();
                const nameB = (b.name || '').toLowerCase();
                return sortVar === 'asc' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
            });
        }

        if (countEl) countEl.innerText = searchQuery ? filtered.length + '/' + presets.length : presets.length;
        if (countWrap) countWrap.style.display = presets.length > 0 ? 'inline' : 'none';

        if (presets.length === 0) {
            scrollArea.style.display = 'block';
            gallery.style.display = 'block';
            gallery.innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
            return;
        }

        if (filtered.length === 0) {
            scrollArea.style.display = 'block';
            gallery.style.display = 'block';
            gallery.innerHTML = `<div class="empty-state">${noResultsPrefix} &ldquo;${_esc(searchQuery)}&rdquo;</div>`;
            return;
        }

        scrollArea.style.display = 'block';
        gallery.style.display = 'grid';

        gallery.innerHTML = filtered.map((p) => {
            const i = p._origIndex;
            const content = p[contentField];
            const isEnabledField = contentField === 'script' ? 'canvasEnabled' : 'customCssEnabled';
            const isContentField = contentField === 'script' ? 'canvasScript' : 'customCSS';
            const isActive = themeData[dm][isEnabledField] && themeData[dm][isContentField] === content && activeRefMap[dm] === i;
            const actions = `
            <div class="snapshot-action edit-snapshot" onclick="event.stopPropagation(); ${rename}(${i})" data-tooltip="${actionLabels.rename}">✎</div>
            <div class="snapshot-action update-snapshot" onclick="event.stopPropagation(); ${update}(${i})" data-tooltip="${actionLabels.update}">💾</div>
            <div class="snapshot-action delete-snapshot" onclick="event.stopPropagation(); ${del}(${i})" data-tooltip="${actionLabels.del}">×</div>
            <div class="snapshot-action export-snapshot" onclick="event.stopPropagation(); ${exp}(${i})" data-tooltip="${actionLabels.exp}">↓</div>
            `;
            return `
            <div class="preset-btn ${isActive ? 'active-theme' : ''}" style="padding: 12px 8px;" onclick="${loadFnName}(${i})">
                ${actions}
                <div class="preset-dots" style="background: var(--border); opacity: 0.5;"></div>
                <span style="font-size: 10px; width: 100%; overflow: hidden; text-overflow: ellipsis; text-align: center; white-space: nowrap; display: block;">${p.name}</span>
                <div class="selected-check">✓</div>
            </div>
            `;
        }).join('');
    }

    function renderCanvasPresets() {
        renderPresetGallery({
            presets: CANVAS_PRESETS, galleryId: 'canvas-preset-gallery', scrollAreaId: 'canvas-preset-scroll',
            searchInputId: 'canvas-search-input', countWrapId: 'canvas-count-wrap', countId: 'canvas-count',
            sortVar: typeof activeCanvasSort !== 'undefined' ? activeCanvasSort : 'default',
            contentField: 'script', activeRefMap: activeCanvasRef, loadFnName: 'loadCanvasPreset',
            emptyMsg: 'Your saved animations will appear here.',
            noResultsPrefix: 'No scripts match',
            actionFns: { rename: 'requestCanvasRename', update: 'updateCanvasSnapshot', del: 'requestCanvasDelete', exp: 'exportCanvasSnapshot' },
            actionLabels: { rename: 'Rename animation', update: 'Overwrite with editor script', del: 'Delete preset', exp: 'Export script' }
        });
    }

    function renderCssPresets() {
        renderPresetGallery({
            presets: CSS_PRESETS, galleryId: 'css-preset-gallery', scrollAreaId: 'css-preset-scroll',
            searchInputId: 'css-search-input', countWrapId: 'css-count-wrap', countId: 'css-count',
            sortVar: typeof activeCssSort !== 'undefined' ? activeCssSort : 'default',
            contentField: 'code', activeRefMap: activeCssRef, loadFnName: 'loadCssPreset',
            emptyMsg: 'Your saved CSS snippets will appear here.',
            noResultsPrefix: 'No snippets match',
            actionFns: { rename: 'requestCssRename', update: 'updateCssSnapshot', del: 'requestCssDelete', exp: 'exportCssSnapshot' },
            actionLabels: { rename: 'Rename snippet', update: 'Overwrite with editor code', del: 'Delete snippet', exp: 'Export CSS' }
        });
    }

    function loadPreset(type, index) {
        const isCanvas = type === 'canvas';
        const presets = isCanvas ? CANVAS_PRESETS : CSS_PRESETS;
        const p = presets[index];
        if (p) {
            const dm = getActiveDataMode();
            if (isCanvas) {
                themeData[dm].canvasEnabled = true;
                themeData[dm].canvasScript = p.script;
                if ($('canvas-fx-editor')) $('canvas-fx-editor').value = p.script;
                activeCanvasRef[dm] = index;
            } else {
                themeData[dm].customCssEnabled = true;
                themeData[dm].customCSS = p.code;
                if ($('custom-css-editor')) $('custom-css-editor').value = p.code;
                activeCssRef[dm] = index;
            }
            commitChange();
            showToast('Loaded ' + p.name);
        }
    }
    window.loadCanvasPreset = (index) => loadPreset('canvas', index);
    window.loadCssPreset = (index) => loadPreset('css', index);

    function renderVariableGrid(config, activeVars) {
        const grid = document.getElementById('variable-grid');
        if (!grid) return;
        
        grid.innerHTML = Object.entries(activeVars).map(([name, val]) => {
            const isLocked = (config.locks || {})[name] === true;
            const hex = oklchToHex(val);
            return `
            <div class="var-item ${isLocked ? 'is-locked' : ''}">
                <span class="var-name" style="font-size: 0.6rem; cursor: pointer;" 
                      onmouseover="this.style.color='var(--accent)'" 
                      onmouseout="this.style.color='var(--text-muted)'" 
                      onclick="navigator.clipboard.writeText('${name}: ${hex};').then(()=>showToast('Copied ${name}: ${hex};'))" 
                      data-tooltip="Copy ${name}: ${hex};">
                    ${name.split('-').pop()}
                </span>
                <div class="var-controls">
                    <div class="var-lock" data-var="${name}" data-tooltip="${isLocked ? 'Unlock variable' : 'Lock current color'}">
                        ${isLocked ? ICONS.lockClosed : ICONS.lockOpen}
                    </div>
                    <div class="var-reset" data-var="${name}" data-tooltip="Reset variable to default">
                        ⟲
                    </div>
                    <div class="var-picker-wrap">
                        <span class="var-picker-aa" style="color:${getEffectiveLightness(hex) > 0.45 ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.8)'}">Aa</span>
                        <input type="color" class="var-picker" data-var="${name}" value="${hex}" data-tooltip="${hex.toUpperCase()}">
                    </div>
                </div>
            </div>`;
        }).join('');

        grid.querySelectorAll('.var-picker').forEach(p => {
            p.addEventListener('input', (e) => {
                const dm = getActiveDataMode();
                const varName = e.target.dataset.var;
                themeData[dm].overrides[varName] = e.target.value;
                themeData[dm].locks[varName] = true;
                commitChange({ clearRef: false, push: false });
            });
            p.addEventListener('change', () => pushState());
        });

        grid.querySelectorAll('.var-lock').forEach(l => {
            l.addEventListener('click', (e) => {
                const dm = getActiveDataMode();
                const varName = e.target.closest('.var-lock').dataset.var;
                const isLocked = (themeData[dm].locks || {})[varName];
                
                if (isLocked) {
                    themeData[dm].locks[varName] = false;
                } else {
                    themeData[dm].locks[varName] = true;
                    themeData[dm].overrides[varName] = activeVars[varName];
                }
                commitChange({ clearRef: false });
            });
        });

        grid.querySelectorAll('.var-reset').forEach(r => {
            r.addEventListener('click', (e) => {
                const varName = e.target.closest('.var-reset').dataset.var;
                const dm = getActiveDataMode();
                
                if (themeData[dm].locks) {
                    themeData[dm].locks[varName] = false;
                }
                if (themeData[dm].overrides) {
                    if (isModeAtDefault(dm)) {
                        delete themeData[dm].overrides[varName];
                    } else {
                        const step = parseInt(varName.split('-').pop());
                        themeData[dm].overrides[varName] = getDefaultColorForStep(dm, step);
                    }
                }
                
                commitChange({ clearRef: false });
                showToast(`Reset ${varName.split('-').pop()} to default`);
            });
        });
    }

    function oklchToHex(str) {
        if (str.startsWith('#')) return str;
        const canvas = document.createElement('canvas');
        canvas.width = 1; canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000000'; ctx.fillStyle = str;       
        ctx.fillRect(0, 0, 1, 1);
        const data = ctx.getImageData(0, 0, 1, 1).data;
        return "#" +[data[0], data[1], data[2]].map(x => x.toString(16).padStart(2, '0')).join('');
    }

    function getEffectiveLightness(colorStr) {
        if (!colorStr) return 0.20;
        if (colorStr.startsWith('oklch(')) {
            return parseFloat(colorStr.split(' ')[0].replace('oklch(', ''));
        } else if (colorStr.startsWith('#')) {
            return getLuminance(colorStr);
        }
        return 0.20;
    }

    function extractKeyframes(css) {
        let keyframes = '';
        let cleanedCss = css;
        let startIndex = cleanedCss.indexOf('@keyframes');
        
        while (startIndex !== -1) {
            let openBraces = 0;
            let i = startIndex;
            let started = false;
            while (i < cleanedCss.length) {
                if (cleanedCss[i] === '{') { openBraces++; started = true; }
                else if (cleanedCss[i] === '}') { openBraces--; }
                
                i++;
                if (started && openBraces === 0) {
                    keyframes += cleanedCss.substring(startIndex, i) + '\n';
                    cleanedCss = cleanedCss.substring(0, startIndex) + cleanedCss.substring(i);
                    break;
                }
            }
            startIndex = cleanedCss.indexOf('@keyframes');
        }
        return { keyframes, cleanedCss };
    }

    // === Gradient CSS Helpers ===
    function hexToRgba(hex, alpha) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const [r, g, b] = parseHex(hex);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function getDarkestStop(stops) {
        if (!stops || stops.length === 0) return '#000000';
        let darkest = stops[0].color;
        let minLum = Infinity;
        stops.forEach(s => {
            const lum = getLuminance(s.color);
            if (lum < minLum) { minLum = lum; darkest = s.color; }
        });
        return darkest;
    }

    function adjustHexIntensity(hex, intensity) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        let [r, g, b] = parseHex(hex);
        const factor = intensity / 100;
        r = Math.max(0, Math.min(255, Math.round(128 + (r - 128) * factor)));
        g = Math.max(0, Math.min(255, Math.round(128 + (g - 128) * factor)));
        b = Math.max(0, Math.min(255, Math.round(128 + (b - 128) * factor)));
        return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
    }

    function buildGradientStructuralCss({ selector, baseColor, animCss, keyframesCss, comment, bodyBg }) {
        const sidebarRgba = hexToRgba(baseColor, 0.75);
        const overlayFrom = hexToRgba(baseColor, 0.7);
        const overlayTo = hexToRgba(baseColor, 0.35);
        const textareaRgba = hexToRgba(baseColor, 0.5);
        return `\n/*[OWUI_GRADIENT_START]*/\n/* ${comment} */\n${selector} body {\n${bodyBg}\n  background-attachment: fixed !important;\n${animCss}\n}\n${selector} body::before { content: none !important; display: none !important; }\n${selector} #chat-container .bg-linear-to-t {\n  background-image: linear-gradient(to top, ${overlayFrom}, ${overlayTo}) !important;\n}\n${selector} #sidebar {\n  background-color: ${sidebarRgba} !important;\n  backdrop-filter: blur(12px) !important;\n}\n${selector} textarea {\n  background-color: ${textareaRgba} !important;\n  backdrop-filter: blur(8px) !important;\n}\n${keyframesCss}/*[OWUI_GRADIENT_END]*/\n`;
    }

    function buildGradientCss(modeData, selector) {
        if (!modeData.gradientEnabled) return '';

        const gType = modeData.gradientType || 'linear';
        const intensity = modeData.gradientIntensity != null ? modeData.gradientIntensity : 85;

        // === MESH GRADIENT ===
        if (gType === 'mesh') {
            const points = modeData.gradientMeshPoints || [];
            if (points.length < 2) return '';
            const bgColor = modeData.gradientMeshBgColor || '#0a0a12';
            const meshLayers = points.map(p => {
                const c = adjustHexIntensity(p.color, intensity);
                return `radial-gradient(at ${p.x}% ${p.y}%, ${c} 0%, transparent ${p.spread}%)`;
            }).join(', ');


            const speed = modeData.gradientAnimationSpeed || 8;

            {
                let animCss = '';
                let keyframesCss = '';
                if (modeData.gradientAnimation) {
                    animCss = `  background-size: 300% 300% !important;\n  animation: owui-gradient-shift ${speed}s ease infinite !important;`;
                    keyframesCss = `\n@keyframes owui-gradient-shift {\n  0% { background-position: 0% 50%; }\n  50% { background-position: 100% 50%; }\n  100% { background-position: 0% 50%; }\n}\n`;
                }
                return buildGradientStructuralCss({
                    selector, baseColor: bgColor, animCss, keyframesCss,
                    comment: 'Mesh Gradient Background',
                    bodyBg: `  background-color: ${bgColor} !important;\n  background-image: ${meshLayers} !important;`
                });
            }
        }

        if (!modeData.gradientStops || modeData.gradientStops.length < 2) return '';

        // intensity already declared above for mesh check
        const sortedStops = [...modeData.gradientStops].sort((a, b) => a.position - b.position);
        const stopsStr = sortedStops
            .map(s => `${adjustHexIntensity(s.color, intensity)} ${s.position}%`)
            .join(', ');

        let gradientFunc;
        // gType already declared above for mesh check
        const angle = modeData.gradientAngle != null ? modeData.gradientAngle : 135;
        if (gType === 'radial') {
            const rShape = modeData.gradientRadialShape || 'ellipse';
            const rSize = modeData.gradientRadialSize || 'farthest-corner';
            const rPosX = modeData.gradientRadialPosX ?? 50;
            const rPosY = modeData.gradientRadialPosY ?? 50;
            gradientFunc = `radial-gradient(${rShape} ${rSize} at ${rPosX}% ${rPosY}%, ${stopsStr})`;
        } else {
            gradientFunc = `linear-gradient(${angle}deg, ${stopsStr})`;
        }

        const darkest = getDarkestStop(sortedStops);

        let animCss = '';
        let keyframesCss = '';
        if (modeData.gradientAnimation) {
            const speed = modeData.gradientAnimationSpeed || 8;
            animCss = `  background-size: 300% 300% !important;\n  animation: owui-gradient-shift ${speed}s ease infinite !important;`;
            keyframesCss = `\n@keyframes owui-gradient-shift {\n  0% { background-position: 0% 50%; }\n  50% { background-position: 100% 50%; }\n  100% { background-position: 0% 50%; }\n}\n`;
        }

        return buildGradientStructuralCss({
            selector, baseColor: darkest, animCss, keyframesCss,
            comment: 'System Gradient Background',
            bodyBg: `  background-image: ${gradientFunc} !important;`
        });
    }

    function generateTailwindCSS() {
        const dm = getActiveDataMode();
        const vars = getVariablesMap(themeData[dm]);
        let code = `/* Tailwind v4 @theme Block (Active Mode: ${activeMode.toUpperCase()}) */\n@theme {\n`;
        Object.entries(vars).forEach(([k, v]) => {
            code += `  ${k}: ${v};\n`;
        });
        code += `}`;
        return code;
    }

    function generateCoreCSS() {
        const buildCustomCss = (modeData, selector) => {
            if (modeData.customCSS && modeData.customCssEnabled !== false) {
                // Sanitize: neutralize any marker comment sequences to prevent
                // spoofing the /*[OWUI_*]*/ markers used for auth-page CSS stripping
                let cssText = modeData.customCSS.replace(/\/\*\[OWUI_/g, '/* [OWUI_');
                if (modeData.autoScope) {
                    const { keyframes, cleanedCss } = extractKeyframes(cssText);
                    let scoped = cleanedCss.replace(/:root/gi, '&');
                    return `\n/*[OWUI_CUSTOM_START]*/\n/* Custom CSS (Auto-Scoped) */\n${selector} {\n${scoped}\n}\n${keyframes}\n/*[OWUI_CUSTOM_END]*/\n`;
                } else {
                    let scoped = cssText.replace(/:root/gi, selector);
                    return `\n/*[OWUI_CUSTOM_START]*/\n/* Custom CSS (Raw) */\n${scoped}\n/*[OWUI_CUSTOM_END]*/\n`;
                }
            }
            return '';
        };
        
        const getBgRules = (mode, selector, bgBody, bgSidebar, bgTextarea) => {
            const config = themeData[mode];
            const hasCanvas = config.canvasEnabled && config.canvasScript && config.canvasScript.trim();
            const hasGradient = config.gradientEnabled && (
                (config.gradientType === 'mesh' && config.gradientMeshPoints && config.gradientMeshPoints.length >= 2) ||
                (config.gradientType !== 'mesh' && config.gradientStops && config.gradientStops.length >= 2)
            );
            if (hasCanvas || hasGradient) {
                return `
${selector} body { background-color: var(${bgBody}) !important; }
${hasCanvas ? `${selector} #owui-theme-bg-color { background-color: transparent !important; }` : ''}
${selector} .app, ${selector} #app-container, ${selector} #auth-container { background-color: transparent !important; background-image: none !important; position: relative; }
${selector} .app > div, ${selector} #app-container > *, ${selector} #auth-page > div, ${selector} main { background-color: transparent !important; background-image: none !important; }
${selector} .app :where([class*="bg-gray-"]:not(button):not(a):not(input):not(select):not(label):not(span)) { background-color: transparent !important; background-image: none !important; }
${selector} #app-container :where([class*="bg-gray-"]:not(button):not(a):not(input):not(select):not(label):not(span)) { background-color: transparent !important; background-image: none !important; }
${selector} #auth-page :where([class*="bg-gray-"]:not(button):not(a):not(input):not(select):not(label):not(span)):where(:not(#auth-login-card *)) { background-color: transparent !important; background-image: none !important; }
${selector} .app :where(.message-content) { background-color: transparent !important; }
${selector} .app :where(nav, .sticky, [class*="bg-gradient"]) { background-color: transparent !important; background-image: none !important; }
${selector} #sidebar { background-color: var(${bgSidebar}) !important; }
${selector} #sidebar * :where([class*="bg-gray-"]) { background-color: revert-layer; }
${selector} textarea { background-color: var(${bgTextarea}) !important; }
`;
            } else {
                return `
${selector} body { background-color: var(${bgBody}) !important; }
${selector} #sidebar { background-color: var(${bgSidebar}) !important; }
${selector} textarea { background-color: var(${bgTextarea}) !important; }
`;
            }
        };

        // Helper: wrap CSS content in @media (prefers-color-scheme) for system mode support
        const wrapSystemMedia = (modeId, contentFn) => {
            if (modeId !== 'dark' && modeId !== 'light') return '';
            return `@media (prefers-color-scheme: ${modeId}) {\n${contentFn('html[data-theme="system"], :root[data-theme="system"]')}\n}\n`;
        };

        const modes =[
            { id: 'light', name: 'LIGHT MODE', sel: ':root:not(.dark):not(.her):not([data-theme="dark"]):not([data-theme="oled-dark"]):not([data-theme="her"])', bgBody: '--color-gray-50', bgSidebar: '--color-gray-50', bgTextarea: '--color-gray-200' },
            { id: 'dark', name: 'DARK MODE', sel: 'html.dark:not([data-theme="oled-dark"]), html[data-theme="dark"]', bgBody: '--color-gray-900', bgSidebar: '--color-gray-950', bgTextarea: '--color-gray-850' },
            { id: 'oled', name: 'OLED DARK MODE', sel: 'html.dark[data-theme="oled-dark"], html[data-theme="oled-dark"]', bgBody: '--color-gray-900', bgSidebar: '--color-gray-950', bgTextarea: '--color-gray-850' },
            { id: 'her', name: 'HER MODE', sel: 'html.her, html[data-theme="her"]', bgBody: '--color-gray-50', bgSidebar: '--color-gray-50', bgTextarea: '--color-gray-200' }
        ];

        // Helper: format manual override lines with !important
        const formatOverrideLine = (line, indent = '  ') => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('/*') || trimmed.startsWith('//') || trimmed.startsWith('*')) return '';
            if (trimmed.startsWith('--')) {
                // Block CSS scope breakout: reject lines containing braces
                if (/[{}]/.test(trimmed)) return '';
                // Neutralize marker comment sequences in override values
                const sanitized = trimmed.replace(/\/\*\[OWUI_/g, '/* [OWUI_');
                const withImportant = sanitized.endsWith(';') ? sanitized.slice(0, -1) + ' !important;' : sanitized + ' !important;';
                return `${indent}${withImportant}\n`;
            }
            return '';
        };

        let code = `/*[OWUI_VARS_START]*/\n`;
        modes.forEach(m => {
            const modeTag = m.id.toUpperCase();
            const modeData = themeData[m.id];
            const vars = getVariablesMap(modeData, m.id);

            // Palette variables
            code += `/*[OWUI_PAL_${modeTag}_START]*/\n`;
            code += `/* --- ${m.name} VARIABLES --- */\n${m.sel} {\n`;
            Object.entries(vars).forEach(([k, v]) => { code += `  ${k}: ${v} !important;\n`; });
            code += `}\n`;
            code += wrapSystemMedia(m.id, (sel) => {
                let inner = `  ${sel} {\n`;
                Object.entries(vars).forEach(([k, v]) => { inner += `    ${k}: ${v} !important;\n`; });
                inner += `  }`;
                return inner;
            });
            code += `\n/*[OWUI_PAL_${modeTag}_END]*/\n`;

            // Manual variable overrides (injected after palette for final priority)
            if (modeData.manualOverrides && modeData.manualOverrides.trim() && !!modeData.manualOverridesEnabled) {
                const lines = modeData.manualOverrides.split('\n');
                code += `/* --- ${m.name} MANUAL OVERRIDES --- */\n${m.sel} {\n`;
                lines.forEach(line => { code += formatOverrideLine(line); });
                code += `}\n`;
                code += wrapSystemMedia(m.id, (sel) => {
                    let inner = `  ${sel} {\n`;
                    lines.forEach(line => { inner += formatOverrideLine(line, '    '); });
                    inner += `  }`;
                    return inner;
                });
                code += `\n`;
            }
        });
        code += `/*[OWUI_VARS_END]*/\n\n`;

        // Structural, gradient, and custom CSS — single pass, separate marker regions
        let gradientCss = '';
        let customCss = '';
        code += `/*[OWUI_STRUCTURAL_START]*/\n`;
        modes.forEach(m => {
            const modeData = themeData[m.id];

            // Background overrides (inside STRUCTURAL markers)
            code += `/* --- ${m.name} Background Overrides --- */\n`;
            code += getBgRules(m.id, m.sel, m.bgBody, m.bgSidebar, m.bgTextarea);
            code += wrapSystemMedia(m.id, () => getBgRules(m.id, 'html[data-theme="system"]', m.bgBody, m.bgSidebar, m.bgTextarea));

            // Accumulate gradient + custom CSS for output after structural block
            gradientCss += buildGradientCss(modeData, m.sel);
            gradientCss += wrapSystemMedia(m.id, (sel) => buildGradientCss(modeData, sel));
            customCss += buildCustomCss(modeData, m.sel);
            customCss += wrapSystemMedia(m.id, () => buildCustomCss(modeData, 'html[data-theme="system"]'));
        });
        code += `/*[OWUI_STRUCTURAL_END]*/\n`;
        code += gradientCss;
        code += customCss;

        return code;
    }

    let _codeViewStale = true;
    function updateCodeView() {
        const codeTab = document.getElementById('tab-code');
        if (codeTab && codeTab.style.display === 'none') { _codeViewStale = true; return; }
        _codeViewStale = false;
        let rawCss = generateCoreCSS();
        if (document.getElementById('toggle-minify-css')?.checked) rawCss = minifyCss(rawCss);
        const rawTextarea = document.getElementById('raw-css');
        if (rawTextarea) { rawTextarea.value = rawCss; updateLineNumbers(rawTextarea); }
        
        let twCss = generateTailwindCSS();
        if (document.getElementById('toggle-minify-tailwind')?.checked) twCss = minifyCss(twCss);
        const twTextarea = document.getElementById('tailwind-css');
        if (twTextarea) { twTextarea.value = twCss; updateLineNumbers(twTextarea); }
    }
    
    // Minify Toggle Listeners
    document.getElementById('toggle-minify-css')?.addEventListener('change', updateCodeView);
    document.getElementById('toggle-minify-tailwind')?.addEventListener('change', updateCodeView);
    
    function forceLocalIframeTheme() {
        const dm = getActiveDataMode();
        const config = themeData[dm];
        const dataMode = dm;
        const activeVars = getVariablesMap(config);
        
        const washedOut = detectWashedOut(dataMode, activeVars);

        let darkTextMain = washedOut.dark ? "#18181b" : "var(--color-gray-50)";
        let darkTextMuted = washedOut.dark ? "#52525b" : "var(--color-gray-400)";
        let darkBorder = washedOut.dark ? "rgba(0,0,0,0.2)" : "var(--color-gray-800)";

        let lightTextMain = washedOut.light ? "#18181b" : "var(--color-gray-950)";
        let lightTextMuted = washedOut.light ? "#52525b" : "var(--color-gray-600)";
        let lightBorder = washedOut.light ? "rgba(0,0,0,0.2)" : "var(--color-gray-200)";
        let lightBgElevated = washedOut.light ? "rgba(0,0,0,0.05)" : "var(--color-gray-100)";
        
        // Strip user Custom CSS, Structural, and Gradient rules from the generated CSS.
        // We add a targeted gradient rule for body#tool-body below instead.
        let iframeCss = generateCoreCSS()
            .replace(/\/\*\[OWUI_CUSTOM_START\]\*\/[\s\S]*?\/\*\[OWUI_CUSTOM_END\]\*\//g, '')
            .replace(/\/\*\[OWUI_STRUCTURAL_START\]\*\/[\s\S]*?\/\*\[OWUI_STRUCTURAL_END\]\*\//g, '')
            .replace(/\/\*\[OWUI_GRADIENT_START\]\*\/[\s\S]*?\/\*\[OWUI_GRADIENT_END\]\*\//g, '');

        // Build a targeted gradient rule for the designer page body
        let toolGradientCss = '';
        try {
            const gradDm = getActiveDataMode();
            const gradConfig = themeData[gradDm];
            if (gradConfig && gradConfig.gradientEnabled) {
                const gradCss = buildGradientCss(gradConfig, '');
                // Extract just the body background-image rule and re-target to body#tool-body
                const bodyMatch = gradCss.match(/body\s*\{([^}]*background-image[^}]*)\}/);
                if (bodyMatch) {
                    toolGradientCss = `body#tool-body { ${bodyMatch[1]} }`;
                }
            }
        } catch(e) { console.warn('[Theme Pro] Gradient preview error:', e); }

        iframeCss += `
            /* Iframe Self-Theming Overrides */
            html#tool-html, body#tool-body { background-color: var(--bg-deep) !important; }
            ${toolGradientCss}
            
            body#tool-body {
                --bg-deep: var(--color-gray-900) !important;
                --bg-surface: var(--color-gray-850) !important;
                --bg-elevated: var(--color-gray-800) !important;
                --border: ${darkBorder} !important;
                --text-main: ${darkTextMain} !important;
                --text-muted: ${darkTextMuted} !important;
            }
            body#tool-body.light-mode {
                --bg-deep: var(--color-gray-50) !important;
                --bg-surface: #ffffff !important;
                --bg-elevated: ${lightBgElevated} !important;
                --border: ${lightBorder} !important;
                --text-main: ${lightTextMain} !important;
                --text-muted: ${lightTextMuted} !important;
            }
        `;
        
        let oldIframeStyle = document.getElementById('iframe-live-theme');
        if (oldIframeStyle) oldIframeStyle.remove();
        let iframeStyle = document.createElement('style');
        iframeStyle.id = 'iframe-live-theme';
        iframeStyle.innerHTML = iframeCss;
        document.head.appendChild(iframeStyle);
        
        const html = document.documentElement;
        const osDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        if (activeMode === 'system') {
            html.setAttribute('data-theme', 'system');
            applyModeToElement(html, osDark ? 'dark' : 'light');
            html.setAttribute('data-theme', 'system'); // restore after applyModeToElement overwrites it
        } else {
            applyModeToElement(html, activeMode);
        }

        const isLightUI = (activeMode === 'light' || activeMode === 'her' || (activeMode === 'system' && !osDark));
        document.body.classList.toggle('light-mode', isLightUI);
        document.body.classList.toggle('washed-out', washedOut.dark || washedOut.light);
    }

    function syncParentNativeMode(mode) {
        try {
            const html = document.documentElement;
            if (mode === 'system') {
                html.classList.remove('dark', 'light', 'her');
                html.setAttribute('data-theme', 'system');
            } else {
                applyModeToElement(html, mode);
            }
            // Only persist mode to localStorage when NOT in draft mode.
            // Draft mode previews the mode locally but must not leak to
            // other tabs or the admin's live session.
            if (!_draftMode) {
                localStorage.setItem('theme', MODE_CONFIG[mode]?.dataTheme || mode);
            }
        } catch(e) { console.warn('Theme Pro:', e); }
    }

    function injectLive() {
        let css = generateCoreCSS();
        try {
                let oldStyle = document.getElementById('owui-dev-live-theme');
                if (shouldInject) {
                    if (!oldStyle) {
                        oldStyle = document.createElement('style');
                        oldStyle.id = 'owui-dev-live-theme';
                        document.head.appendChild(oldStyle);
                    }
                    // Strip palette vars for modes with paletteEnabled === false
                    const modes = MODES;
                    modes.forEach(m => {
                        if (themeData[m] && themeData[m].paletteEnabled === false) {
                            const tag = m.toUpperCase();
                            const re = new RegExp('/\\*\\[OWUI_PAL_' + tag + '_START\\]\\*/[\\s\\S]*?/\\*\\[OWUI_PAL_' + tag + '_END\\]\\*/', 'g');
                            css = css.replace(re, '');
                        }
                    });
                    oldStyle.innerHTML = css;
                    Storage.setRaw('css_cache', css);
                    syncToServer(css);
                    const storagePayload = {
                        ...themeData,
                        _activeThemeRef: activeThemeRef,
                        _activeCanvasRef: activeCanvasRef,
                        _activeCssRef: activeCssRef,
                        _activeGradientRef: activeGradientRef
                    };
                    Storage.set('theme', storagePayload);
                    
                    // Keep data-theme synced for accurate rendering
                    const pTheme = localStorage.getItem('theme');
                    if (pTheme && document.documentElement.getAttribute('data-theme') !== pTheme) {
                        document.documentElement.setAttribute('data-theme', pTheme);
                    }
                    
                    // If bootloader is missing (e.g. after Watchtower update), inject it dynamically
                    if (!document.getElementById('owui-theme-bootloader')) {
                        try {
                            // On the designer page, set flag so bootloader skips server fetch
                            // (designer manages state directly; server fetch would race with syncToServer)
                            if (document.getElementById('app-container')) {
                                window.__THEME_DESIGNER__ = true;
                            }
                            const bootScript = document.createElement('script');
                            bootScript.id = 'owui-theme-bootloader';
                            const nonceScript = document.querySelector('script[nonce]');
                            if (nonceScript && nonceScript.nonce) bootScript.setAttribute('nonce', nonceScript.nonce);
                            // Read bootloader source from the stored template (single source of truth)
                            bootScript.textContent = document.getElementById('bootloader-src').textContent;
                            document.head.appendChild(bootScript);
                        } catch(e) { console.warn('[Theme Pro] Could not inject bootloader dynamically:', e); }
                    }
                    
                    // Trigger Bootloader Canvas Refresh
                    // Pass theme state directly via CustomEvent detail so the bootloader's
                    // initCanvas() sees the current canvas script (critical for draft mode,
                    // where sessionStorage is invisible to the bootloader's normal read path)
                    try {
                        const stateStr = JSON.stringify({
                            ...themeData,
                            _activeThemeRef: activeThemeRef,
                            _activeCanvasRef: activeCanvasRef,
                            _activeCssRef: activeCssRef,
                            _activeGradientRef: activeGradientRef
                        });
                        window.dispatchEvent(new CustomEvent('owui-theme-updated', { detail: { state: stateStr, css: css } }));
                    } catch(e) { console.warn('Theme Pro:', e); }
                } else if (oldStyle) {
                    oldStyle.remove();
                }
        } catch (e) { console.warn('Theme Pro:', e); }
        forceLocalIframeTheme();
    }

    function resetActiveMode(silent = false, saveBackup = false) {
        if (!silent && saveBackup) {
            const snapshots = getSnapshots();
            snapshots.unshift({
                name: `Backup: Pre-Reset`,
                dark: cleanMode(themeData.dark),
                oled: cleanMode(themeData.oled),
                light: cleanMode(themeData.light),
                her: cleanMode(themeData.her)
            });
            saveSnapshots(snapshots);
        }

        const dm = getActiveDataMode();
        const defaultL = activeMode === 'oled' ? 0 : 20;
        themeData[dm] = createDefaultModeData({ l: defaultL });
        activeThemeRef[dm] = null;
        activeCanvasRef[dm] = null;
        activeCssRef[dm] = null;
        activeGradientRef[dm] = null;
        commitChange({ clearRef: false, snapshots: true });
        if (!silent) {
            if (saveBackup) {
                showToast(`${activeMode.charAt(0).toUpperCase() + activeMode.slice(1)} Mode Reset (Backup Saved).`);
            } else {
                showToast(`${activeMode.charAt(0).toUpperCase() + activeMode.slice(1)} Mode Reset.`);
            }
        }
    }

    function nuclearReset(silent = false, saveBackup = false) {
        if (!silent && saveBackup) {
            const snapshots = getSnapshots();
            snapshots.unshift({
                name: `Backup: Global Reset`,
                dark: cleanMode(themeData.dark),
                oled: cleanMode(themeData.oled),
                light: cleanMode(themeData.light),
                her: cleanMode(themeData.her)
            });
            saveSnapshots(snapshots);
        }
        
        shouldInject = true; 
        themeData = {
            dark: createDefaultModeData(),
            oled: createDefaultModeData({ l: 0 }),
            light: createDefaultModeData(),
            her: createDefaultModeData()
        };
        activeThemeRef = { dark: null, oled: null, light: null, her: null };
        activeCanvasRef = { dark: null, oled: null, light: null, her: null };
        activeCssRef = { dark: null, oled: null, light: null, her: null };
        activeGradientRef = { dark: null, oled: null, light: null, her: null };
        try {
            const targets = [window];
            targets.forEach(t => {
                try {
                    t.localStorage.removeItem('owui_dev_theme_v1');
                    t.localStorage.removeItem('owui_dev_theme_v1_css');
                    const el = t.document.getElementById('owui-dev-live-theme');
                    if (el) el.remove();
                } catch(e) { console.warn('Theme Pro:', e); }
            });
            syncParentNativeMode(activeMode);
            commitChange({ clearRef: false, snapshots: true });
            if (!silent) {
                if (saveBackup) {
                    showToast("All Modes Reset (Backup Saved).");
                } else {
                    showToast("All Modes Reset.");
                }
            }
        } catch (e) { console.warn('Theme Pro:', e); }
    }
    
    // Slider Double-Click Reset Function
    window.resetSlider = (key) => {
        const dm = getActiveDataMode();
        const defaults = { h: 250, c: 0, l: (dm === 'oled' ? 0 : 20) };
        if (defaults[key] !== undefined) {
            document.getElementById(`sl-${key}`).value = defaults[key];
            document.getElementById(`sl-${key}`).dispatchEvent(new Event('input'));
        }
    };

    /* --- EVENT LISTENERS --- */
    const getActiveDataMode = () => {
        if (activeMode === 'system') {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return activeMode;
    };

    // Mode → CSS class/data-theme mapping (used by forceLocalIframeTheme + syncParentNativeMode)
    const MODE_CONFIG = {
        dark:   { add: 'dark',  remove: ['light', 'her'], dataTheme: 'dark' },
        oled:   { add: 'dark',  remove: ['light', 'her'], dataTheme: 'oled-dark' },
        her:    { add: 'her',   remove: ['dark', 'light'], dataTheme: 'her' },
        light:  { add: 'light', remove: ['dark', 'her'],  dataTheme: 'light' },
        system: { add: null,    remove: ['dark', 'light', 'her'], dataTheme: 'system' },
    };

    function applyModeToElement(el, mode) {
        const cfg = MODE_CONFIG[mode] || MODE_CONFIG.dark;
        if (cfg.add) el.classList.add(cfg.add);
        cfg.remove.forEach(c => el.classList.remove(c));
        el.setAttribute('data-theme', cfg.dataTheme);
    }

    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mode-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-checked', 'false'); });
            btn.classList.add('active');
            btn.setAttribute('aria-checked', 'true');
            activeMode = btn.dataset.mode;
            
            syncParentNativeMode(activeMode);
            updatePalette();
            renderSnapshots();
        });
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (activeMode === 'system') {
            updatePalette();
            renderSnapshots();
        }
    });
    ['h', 'c', 'l'].forEach(key => {
        const slider = document.getElementById(`sl-${key}`);
        
        slider.addEventListener('input', (e) => {
            const dm = getActiveDataMode();
            applyBaseColorsToMode(activeMode, 
                key === 'h' ? parseFloat(e.target.value) : themeData[dm].h,
                key === 'c' ? parseFloat(e.target.value) : themeData[dm].c,
                key === 'l' ? parseFloat(e.target.value) : themeData[dm].l
            );
            commitChange({ push: false });
        });
        
        slider.addEventListener('change', () => pushState());
        
        // Precision Scroll Tuning
        slider.addEventListener('wheel', (e) => {
            e.preventDefault();
            const step = 1;
            const direction = e.deltaY < 0 ? 1 : -1;
            slider.value = parseFloat(slider.value) + (direction * step);
            slider.dispatchEvent(new Event('input'));
            // Debounced pushState since wheel doesn't trigger 'change'
            clearTimeout(slider._wheelTimer);
            slider._wheelTimer = setTimeout(() => pushState(), 400);
        });
    });

    document.getElementById('lock-all-btn').addEventListener('click', () => {
        const dm = getActiveDataMode();
        const vars = getVariablesMap(themeData[dm]);
        if (!themeData[dm].locks) themeData[dm].locks = {};
        if (!themeData[dm].overrides) themeData[dm].overrides = {};
        
        Object.keys(vars).forEach(k => {
            themeData[dm].locks[k] = true;
            themeData[dm].overrides[k] = vars[k];
        });
        commitChange({ clearRef: false });
        showToast("Locked all variables");
    });

    document.getElementById('unlock-all-btn').addEventListener('click', () => {
        const dm = getActiveDataMode();
        const vars = getVariablesMap(themeData[dm]);
        if (!themeData[dm].locks) themeData[dm].locks = {};
        
        Object.keys(vars).forEach(k => {
            themeData[dm].locks[k] = false;
        });
        commitChange({ clearRef: false });
        showToast("Unlocked all variables");
    });

    document.getElementById('reset-all-btn').addEventListener('click', () => {
        const dm = getActiveDataMode();
        const vars = getVariablesMap(themeData[dm]);
        const locks = themeData[dm].locks || {};
        const overrides = themeData[dm].overrides || {};
        
        const varKeys = Object.keys(vars);
        const lockedCount = varKeys.filter(k => locks[k] === true).length;
        
        if (lockedCount === varKeys.length) {
            showModal('reset-all-confirm-modal');
            return;
        }
        
        let resetCount = 0;
        varKeys.forEach(k => {
            if (!locks[k]) {
                if (overrides[k] !== undefined) {
                    delete overrides[k];
                    resetCount++;
                }
            }
        });
        
        // Reset core sliders back to factory defaults for the active data mode
        themeData[dm].h = 250;
        themeData[dm].c = 0;
        themeData[dm].l = (dm === 'oled') ? 0 : 20;
        
        commitChange({ clearRef: false });
        if (resetCount > 0) {
            showToast(`Reset active mode base & ${resetCount} unlocked overrides to defaults`);
        } else {
            showToast("Reset active mode base to defaults");
        }
    });

    document.getElementById('confirm-reset-all-confirm-btn').addEventListener('click', () => {
        const dm = getActiveDataMode();
        const vars = getVariablesMap(themeData[dm]);
        const locks = themeData[dm].locks || {};
        const overrides = themeData[dm].overrides || {};
        
        Object.keys(vars).forEach(k => {
            locks[k] = false;
            delete overrides[k];
        });
        
        // Reset core sliders back to factory defaults for the active data mode
        themeData[dm].h = 250;
        themeData[dm].c = 0;
        themeData[dm].l = (dm === 'oled') ? 0 : 20;
        
        hideModal('reset-all-confirm-modal');
        commitChange({ clearRef: false });
        showToast("Unlocked and reset all variables to defaults");
    });

    // Performance Optimization: Debounce IDE-Grade Behaviors
    // --- Line Number Gutter Engine ---
    function setupGutter(textarea) {
        if (textarea._lineGutter) return;
        const parent = textarea.parentElement;
        if (!parent.classList.contains('owui-code-body')) {
            const wrapper = document.createElement('div');
            wrapper.className = 'owui-code-body';
            parent.insertBefore(wrapper, textarea);
            const gutter = document.createElement('div');
            gutter.className = 'owui-line-numbers';
            wrapper.appendChild(gutter);
            wrapper.appendChild(textarea);
            textarea._lineGutter = gutter;
        }
        textarea.addEventListener('scroll', () => {
            textarea._lineGutter.scrollTop = textarea.scrollTop;
        });
    }

    function updateLineNumbers(textarea) {
        const gutter = textarea._lineGutter;
        if (!gutter) return;
        const lines = (textarea.value || '').split('\n');
        const count = Math.max(lines.length, 1);
        if (gutter._lastCount === count) {
            gutter.scrollTop = textarea.scrollTop;
            return;
        }
        gutter._lastCount = count;
        const nums = [];
        for (let i = 1; i <= count; i++) nums.push(i);
        gutter.textContent = nums.join('\n');
        gutter.scrollTop = textarea.scrollTop;
    }

    const bindEditor = (id, propKey) => {
        const editor = document.getElementById(id);
        if (!editor) return;

        setupGutter(editor);

        editor.addEventListener('input', (e) => {
            updateLineNumbers(editor);
            clearTimeout(editor._timer);
            const capturedDm = getActiveDataMode(); // Capture mode at input time, not fire time
            editor._timer = setTimeout(() => {
                themeData[capturedDm][propKey] = e.target.value;
                activeThemeRef[capturedDm] = null;
                if (propKey === 'canvasScript') activeCanvasRef[capturedDm] = null;
                if (propKey === 'customCSS') activeCssRef[capturedDm] = null;
                commitChange({ clearRef: false, push: false });
                // Debounced pushState for editor changes
                clearTimeout(editor._historyTimer);
                editor._historyTimer = setTimeout(() => pushState(), 800);
            }, 500); 
        });

        editor._tabTrapped = true; // Default: Tab inserts spaces
        editor.addEventListener('keydown', function(e) {
            // Escape toggles tab-trap mode
            if (e.key === 'Escape') {
                this._tabTrapped = !this._tabTrapped;
                return;
            }
            // Handle Tab: insert spaces when trapped, navigate focus when not
            if (e.key === 'Tab' && this._tabTrapped) {
                e.preventDefault();
                const start = this.selectionStart;
                const end = this.selectionEnd;
                this.value = this.value.substring(0, start) + "  " + this.value.substring(end);
                this.selectionStart = this.selectionEnd = start + 2;
                this.dispatchEvent(new Event('input'));
            }
            
            // Handle Auto-Indent on Enter
            if (e.key === 'Enter') {
                e.preventDefault();
                const start = this.selectionStart;
                const val = this.value;
                const beforeCursor = val.substring(0, start);
                const afterCursor = val.substring(this.selectionEnd);
                
                const lines = beforeCursor.split(/\r?\n/);
                const lastLine = lines[lines.length - 1] || '';
                const indentMatch = lastLine.match(/^\s*/);
                const currentIndent = indentMatch ? indentMatch[0] : '';
                
                let insertText = '\n' + currentIndent;
                let newCursorPos = start + insertText.length;
                
                if (lastLine.trim().endsWith('{')) {
                    insertText += '  ';
                    newCursorPos = start + insertText.length;
                    if (!afterCursor.trim().startsWith('}')) {
                        insertText += '\n' + currentIndent + '}';
                    }
                }
                
                this.value = beforeCursor + insertText + afterCursor;
                this.selectionStart = this.selectionEnd = newCursorPos;
                this.dispatchEvent(new Event('input'));
            }
            
            // Handle Auto-Closing Pairs
            const pairs = { '{': '}', '[': ']', '(': ')', '"': '"', "'": "'" };
            if (pairs[e.key] && this.selectionStart === this.selectionEnd) {
                e.preventDefault();
                const start = this.selectionStart;
                this.value = this.value.substring(0, start) + e.key + pairs[e.key] + this.value.substring(start);
                this.selectionStart = this.selectionEnd = start + 1;
                this.dispatchEvent(new Event('input'));
            }
        });

        updateLineNumbers(editor);
    };

    // Handles remaining read-only textareas (CSS Output, JSON viewers, etc.)
    function initLineNumbers() {
        document.querySelectorAll('.owui-code-block textarea').forEach(textarea => {
            if (textarea._lineGutter) return; // Skip editors already initialized by bindEditor()
            setupGutter(textarea);
            textarea.addEventListener('input', () => updateLineNumbers(textarea));
            updateLineNumbers(textarea);
        });
    }

    // Bind editable editors first (creates gutters), then init remaining read-only textareas
    bindEditor('custom-css-editor', 'customCSS');
    bindEditor('canvas-fx-editor', 'canvasScript');
    bindEditor('manual-overrides-editor', 'manualOverrides');
    initLineNumbers();

    function clearEditor(editorId, dataKey, extraRefKey, toastMsg) {
        const el = $(editorId);
        if (el && el.value !== '') {
            const dm = getActiveDataMode();
            el.value = '';
            themeData[dm][dataKey] = '';
            activeThemeRef[dm] = null;
            if (extraRefKey) extraRefKey[dm] = null;
            commitChange({ clearRef: false });
            showToast(toastMsg);
        }
    }

    document.getElementById('clear-css-btn').addEventListener('click', () => clearEditor('custom-css-editor', 'customCSS', activeCssRef, 'Custom CSS Cleared'));

    const clearManualOverridesBtn = document.getElementById('clear-manual-overrides-btn');
    if (clearManualOverridesBtn) clearManualOverridesBtn.addEventListener('click', () => clearEditor('manual-overrides-editor', 'manualOverrides', null, 'Manual Overrides Cleared'));
    
    const clearCanvasBtn = document.getElementById('clear-canvas-btn');
    if (clearCanvasBtn) clearCanvasBtn.addEventListener('click', () => clearEditor('canvas-fx-editor', 'canvasScript', activeCanvasRef, 'Canvas Script Cleared'));

    [['toggle-palette-enabled', 'paletteEnabled'],['toggle-custom-css', 'customCssEnabled'],['toggle-auto-scope', 'autoScope'],['toggle-theme-auth', 'themeShowAuth'],['toggle-custom-auth', 'customCssShowAuth'],['toggle-canvas-auth', 'canvasShowAuth'],['toggle-manual-overrides', 'manualOverridesEnabled'],['toggle-gradient-auth', 'gradientShowAuth']
    ].forEach(([id, key]) => {
        const el = $(id);
        if (el) el.addEventListener('change', (e) => {
            const dm = getActiveDataMode();
            themeData[dm][key] = e.target.checked;
            commitChange();
        });
    });

    const toggleCanvasFx = $('toggle-canvas-fx');
    if (toggleCanvasFx) toggleCanvasFx.addEventListener('change', (e) => {
        const dm = getActiveDataMode();
        themeData[dm].canvasEnabled = e.target.checked;
        if (e.target.checked && !themeData[dm].canvasScript) {
            themeData[dm].canvasScript = DEFAULT_CANVAS_SCRIPT;
            if ($('canvas-fx-editor')) $('canvas-fx-editor').value = DEFAULT_CANVAS_SCRIPT;
        }
        commitChange();
    });

    // === GRADIENT BUILDER LOGIC ===

    window._gradientSliderActive = false;

    const GRADIENT_PRESETS = {
        midnight: { name: 'Midnight', stops: [{color:'#0f0c29',position:0},{color:'#302b63',position:50},{color:'#24243e',position:100}], type:'linear', angle:135 },
        emerald: { name: 'Emerald', stops: [{color:'#0d2818',position:0},{color:'#04471c',position:40},{color:'#058c42',position:100}], type:'linear', angle:135 },
        amethyst: { name: 'Amethyst', stops: [{color:'#1a0a2e',position:0},{color:'#3d1e6d',position:50},{color:'#6b3fa0',position:100}], type:'linear', angle:135 },
        sapphire: { name: 'Sapphire', stops: [{color:'#041e42',position:0},{color:'#0c2d5a',position:50},{color:'#1e40af',position:100}], type:'linear', angle:135 },
        aurora: { name: 'Aurora', stops: [{color:'#0f0c29',position:0},{color:'#1b5e20',position:33},{color:'#1a237e',position:66},{color:'#6a1b9a',position:100}], type:'linear', angle:135, animation:true },
        sunset: { name: 'Sunset', stops: [{color:'#1a0a2e',position:0},{color:'#b91c1c',position:33},{color:'#d97706',position:66},{color:'#f59e0b',position:100}], type:'linear', angle:180 },
        ocean: { name: 'Ocean', stops: [{color:'#001219',position:0},{color:'#005f73',position:50},{color:'#0a9396',position:100}], type:'linear', angle:180 },
        neon: { name: 'Neon', stops: [{color:'#0d0221',position:0},{color:'#0d0b52',position:25},{color:'#6a11cb',position:50},{color:'#f953c6',position:100}], type:'linear', angle:135 },
        meshNebula: { name: 'Nebula', type: 'mesh', meshBgColor: '#08081a', meshPoints: [{color:'#6366f1',x:20,y:18,spread:55},{color:'#ec4899',x:72,y:12,spread:48},{color:'#06b6d4',x:50,y:78,spread:52},{color:'#8b5cf6',x:82,y:62,spread:42}] },
        meshLagoon: { name: 'Lagoon', type: 'mesh', meshBgColor: '#040f0f', meshPoints: [{color:'#0d9488',x:18,y:28,spread:55},{color:'#22d3ee',x:78,y:18,spread:48},{color:'#059669',x:45,y:72,spread:52},{color:'#0284c7',x:85,y:72,spread:42}] },
        meshEmber: { name: 'Ember', type: 'mesh', meshBgColor: '#0f0500', meshPoints: [{color:'#dc2626',x:28,y:22,spread:52},{color:'#ea580c',x:72,y:18,spread:48},{color:'#d97706',x:48,y:72,spread:55},{color:'#991b1b',x:14,y:78,spread:42}] },
        meshArctic: { name: 'Arctic', type: 'mesh', meshBgColor: '#050a14', meshPoints: [{color:'#38bdf8',x:28,y:18,spread:52},{color:'#22d3ee',x:72,y:22,spread:48},{color:'#818cf8',x:45,y:78,spread:55},{color:'#2563eb',x:85,y:62,spread:42}] }
    };

    function renderGradientTab() {
        const dm = getActiveDataMode();
        const config = themeData[dm];

        // Sync mode label


        // Sync toggles
        const syncCheck = (id, val) => { const el = $(id); if (el) el.checked = val; };
        syncCheck('toggle-gradient-bg', config.gradientEnabled === true);
        syncCheck('toggle-gradient-auth', config.gradientShowAuth !== false);
        syncCheck('toggle-gradient-animation', config.gradientAnimation === true);

        // Detect Custom CSS gradient conflict
        const conflictWarning = $('gradient-conflict-warning');
        if (conflictWarning) {
            const css = (config.customCSS || '').toLowerCase();
            const hasConflict = config.gradientEnabled && config.customCssEnabled !== false && css &&
                (/linear-gradient|radial-gradient|conic-gradient/.test(css) && /background/.test(css));
            conflictWarning.style.display = hasConflict ? 'block' : 'none';
        }

        // Sync type pills
        document.querySelectorAll('.gradient-type-pill').forEach(pill => {
            pill.classList.toggle('active', pill.dataset.gtype === (config.gradientType || 'linear'));
        });

        // Sync sliders
        const angle = config.gradientAngle != null ? config.gradientAngle : 135;
        const intensity = config.gradientIntensity != null ? config.gradientIntensity : 85;
        const speed = config.gradientAnimationSpeed || 8;
        if ($('sl-gradient-angle')) $('sl-gradient-angle').value = angle;
        if ($('val-gradient-angle')) $('val-gradient-angle').innerText = angle + '°';
        if ($('sl-gradient-intensity')) $('sl-gradient-intensity').value = intensity;
        if ($('val-gradient-intensity')) $('val-gradient-intensity').innerText = intensity + '%';
        if ($('sl-gradient-speed')) $('sl-gradient-speed').value = speed;
        if ($('val-gradient-speed')) $('val-gradient-speed').innerText = speed + 's';

        // Show/hide angle row for non-linear types
        const angleRow = $('gradient-angle-row');
        const isMesh = config.gradientType === 'mesh';
        if (angleRow) angleRow.style.display = (config.gradientType === 'radial' || isMesh) ? 'none' : 'flex';

        // Show/hide stops section and preview for mesh
        const stopsSection = $('gradient-stops-section');
        if (stopsSection) stopsSection.style.display = isMesh ? 'none' : '';
        const previewSection = $('gradient-preview-section');
        if (previewSection) previewSection.style.display = isMesh ? 'none' : '';

        // Show/hide radial controls
        const radialControls = $('gradient-radial-controls');
        if (radialControls) {
            radialControls.style.display = (config.gradientType === 'radial') ? 'block' : 'none';
            if (config.gradientType === 'radial') {
                const posX = config.gradientRadialPosX ?? 50;
                const posY = config.gradientRadialPosY ?? 50;
                const dot = $('radial-xy-dot');
                if (dot) { dot.style.left = posX + '%'; dot.style.top = posY + '%'; }
                const xyLabel = $('radial-xy-label');
                if (xyLabel) xyLabel.innerText = posX + '%, ' + posY + '%';
                const rShape = config.gradientRadialShape || 'ellipse';
                document.querySelectorAll('.radial-shape-pill').forEach(p => p.classList.toggle('active', p.dataset.shape === rShape));
                const rSize = config.gradientRadialSize || 'farthest-corner';
                document.querySelectorAll('.radial-size-pill').forEach(p => p.classList.toggle('active', p.dataset.size === rSize));
                const xyPad = $('radial-xy-pad');
                if (xyPad && config.gradientStops && config.gradientStops.length >= 2) {
                    const rdIntensity = config.gradientIntensity != null ? config.gradientIntensity : 85;
                    const sorted = [...config.gradientStops].sort((a, b) => a.position - b.position);
                    const xyStopsStr = sorted.map(s => `${adjustHexIntensity(s.color, rdIntensity)} ${s.position}%`).join(', ');
                    xyPad.style.backgroundImage = `radial-gradient(${rShape} ${rSize} at ${posX}% ${posY}%, ${xyStopsStr})`;
                } else if (xyPad) {
                    xyPad.style.backgroundImage = '';
                }
            }
        }

        // Show/hide mesh controls
        const meshControls = $('gradient-mesh-controls');
        if (meshControls) {
            meshControls.style.display = isMesh ? 'block' : 'none';
            if (isMesh) {
                const meshPad = $('mesh-editor-pad');
                const points = config.gradientMeshPoints || [];
                const rdIntensity = config.gradientIntensity != null ? config.gradientIntensity : 85;

                // Update pad background with live mesh preview
                if (meshPad) {
                    if (points.length >= 2) {
                        const bgColor = config.gradientMeshBgColor || '#0a0a12';
                        const layers = points.map(p => {
                            const c = adjustHexIntensity(p.color, rdIntensity);
                            return `radial-gradient(at ${p.x}% ${p.y}%, ${c} 0%, transparent ${p.spread}%)`;
                        }).join(', ');
                        meshPad.style.backgroundImage = layers;
                        meshPad.style.backgroundColor = bgColor;
                    } else {
                        meshPad.style.backgroundImage = '';
                        meshPad.style.backgroundColor = '';
                    }

                    // Render dots (skip during drag)
                    if (!window._meshDragActive) {
                        meshPad.innerHTML = points.map((p, i) => `<div class="mesh-dot ${i === window._selectedMeshPoint ? 'selected' : ''}" data-index="${i}" style="left:${p.x}%;top:${p.y}%;background:${p.color};"></div>`).join('');
                    }
                }

                // Point count
                const countEl = $('mesh-stop-count');
                if (countEl) countEl.innerText = `${points.length}/16 points`;

                // Hint
                const hint = $('mesh-hint');
                if (hint) hint.textContent = points.length >= 16 ? 'Maximum 16 points reached' : 'Click to add \u00b7 Drag to move \u00b7 Double-click to remove';

                // Add stop button visibility
                const addBtn = $('mesh-add-stop-btn');
                if (addBtn) addBtn.style.display = points.length >= 16 ? 'none' : '';

                // Render mesh stops list — skip during active slider drag to preserve DOM
                const meshStopsList = $('mesh-stops-list');
                if (meshStopsList && !window._meshSpreadSliderActive) {
                    meshStopsList.innerHTML = points.map((p, i) => `
                        <div class="mesh-stop-row ${i === window._selectedMeshPoint ? 'selected' : ''}" data-index="${i}" onclick="window.selectMeshPoint(${i})" role="listitem" tabindex="0" aria-label="Mesh point ${i + 1}: ${p.color} at ${p.x}%, ${p.y}%">
                            <div class="gradient-drag-handle" data-tooltip="Drag to reorder">
                                ${ICONS.dragHandle}
                            </div>
                            <div class="gradient-stop-swatch" style="background: ${p.color};">
                                <input type="color" value="${p.color}" aria-label="Mesh point ${i + 1} color" onchange="window.updateMeshStop(${i}, {color: this.value})" oninput="this.parentElement.style.background = this.value; window.updateMeshStop(${i}, {color: this.value})">
                            </div>
                            <input type="range" class="gradient-stop-slider" min="10" max="80" value="${p.spread}" aria-label="Mesh point ${i + 1} spread" onpointerdown="window._meshSpreadSliderActive = true" oninput="window.updateMeshStop(${i}, {spread: parseInt(this.value)}); this.nextElementSibling.innerText = this.value + '%'" onchange="window._meshSpreadSliderActive = false; window.updateMeshStop(${i}, {spread: parseInt(this.value)})">
                            <span class="gradient-stop-pos">${p.spread}%</span>
                            <button class="gradient-stop-delete" onclick="event.stopPropagation(); window.removeMeshStop(${i})" ${points.length <= 2 ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''} data-tooltip="Remove stop" aria-label="Remove mesh point ${i + 1}">×</button>
                        </div>
                    `).join('');

                    initDragDrop(meshStopsList, '.mesh-stop-row', window.reorderMeshStop);
                }

                // Base color sync
                const bgSw = $('mesh-bg-swatch');
                if (bgSw) bgSw.style.background = config.gradientMeshBgColor || '#0a0a12';
                const bgIn = $('mesh-bg-color');
                if (bgIn && !window._meshDragActive) bgIn.value = config.gradientMeshBgColor || '#0a0a12';
            }
        }

        // Show/hide animation speed row
        const speedRow = $('gradient-speed-row');
        if (speedRow) speedRow.style.display = config.gradientAnimation ? 'flex' : 'none';

        // Render color stops — skip during active slider drag to preserve the DOM element
        const stopsList = $('gradient-stops-list');
        if (stopsList && !window._gradientSliderActive) {
            const stops = config.gradientStops || [];
            const stopCount = $('gradient-stop-count');
            if (stopCount) stopCount.innerText = `${stops.length}/16 stops`;

            // Add stop button visibility
            const gradAddBtn = $('gradient-add-stop-btn');
            if (gradAddBtn) gradAddBtn.style.display = stops.length >= 16 ? 'none' : '';

            stopsList.innerHTML = stops.map((stop, i) => `
                <div class="gradient-stop-row" data-index="${i}" role="listitem">
                    <div class="gradient-drag-handle" data-tooltip="Drag to reorder">
                        ${ICONS.dragHandle}
                    </div>
                    <div class="gradient-stop-swatch" style="background: ${stop.color};">
                        <input type="color" value="${stop.color}" aria-label="Stop ${i + 1} color" onchange="window.updateGradientStop(${i}, {color: this.value})" oninput="this.parentElement.style.background = this.value">
                    </div>
                    <input type="range" class="gradient-stop-slider" min="0" max="100" value="${stop.position}" aria-label="Stop ${i + 1} position" onpointerdown="window._gradientSliderActive = true" oninput="window.updateGradientStop(${i}, {position: parseInt(this.value)}); this.nextElementSibling.innerText = this.value + '%'" onchange="window._gradientSliderActive = false; window.updateGradientStop(${i}, {position: parseInt(this.value)})">
                    <span class="gradient-stop-pos">${stop.position}%</span>
                    <button class="gradient-stop-dup" onclick="window.duplicateGradientStop(${i})" ${stops.length >= 16 ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''} data-tooltip="Duplicate stop" aria-label="Duplicate color stop ${i + 1}">⧉</button>
                    <button class="gradient-stop-delete" onclick="window.removeGradientStop(${i})" ${stops.length <= 2 && config.gradientEnabled ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''} data-tooltip="Remove stop" aria-label="Remove color stop ${i + 1}">×</button>
                </div>
            `).join('');

            initDragDrop(stopsList, '.gradient-stop-row', window.reorderGradientStop);
        }

        // Render preview bar
        const previewBar = $('gradient-preview-bar');
        if (previewBar) {
            const gType = config.gradientType || 'linear';
            if (gType === 'mesh') {
                const points = config.gradientMeshPoints || [];
                if (points.length >= 2) {
                    const bgColor = config.gradientMeshBgColor || '#0a0a12';
                    const layers = points.map(p => {
                        const c = adjustHexIntensity(p.color, intensity);
                        return `radial-gradient(at ${p.x}% ${p.y}%, ${c} 0%, transparent ${p.spread}%)`;
                    }).join(', ');
                    previewBar.style.backgroundImage = layers;
                    previewBar.style.backgroundColor = bgColor;
                    previewBar.classList.remove('empty');
                } else {
                    previewBar.style.backgroundImage = '';
                    previewBar.style.backgroundColor = '';
                    previewBar.classList.add('empty');
                }
            } else {
                previewBar.style.backgroundColor = '';
                const stops = config.gradientStops || [];
                if (stops.length >= 2) {
                    const sorted = [...stops].sort((a, b) => a.position - b.position);
                    const stopsStr = sorted.map(s => `${adjustHexIntensity(s.color, intensity)} ${s.position}%`).join(', ');
                    let gradFunc;
                    if (gType === 'radial') {
                        const rShape = config.gradientRadialShape || 'ellipse';
                        const rSize = config.gradientRadialSize || 'farthest-corner';
                        const rPosX = config.gradientRadialPosX ?? 50;
                        const rPosY = config.gradientRadialPosY ?? 50;
                        gradFunc = `radial-gradient(${rShape} ${rSize} at ${rPosX}% ${rPosY}%, ${stopsStr})`;
                    } else gradFunc = `linear-gradient(90deg, ${stopsStr})`;
                    previewBar.style.backgroundImage = gradFunc;
                    previewBar.classList.remove('empty');
                } else {
                    previewBar.style.backgroundImage = '';
                    previewBar.classList.add('empty');
                }
            }
        }

        // Render gradient presets
        renderGradientPresets();
    }

    function renderGradientPresets() {
        const gallery = $('gradient-preset-gallery');
        if (!gallery) return;
        const dm = getActiveDataMode();
        const config = themeData[dm];

        // Search filtering
        const searchInput = $('gradient-search-input');
        const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

        // Sort state
        const sortState = typeof activeGradientSort !== 'undefined' ? activeGradientSort : 'default';

        // Build unified preset list: built-in + custom
        const builtInEntries = Object.entries(GRADIENT_PRESETS).map(([id, preset]) => ({
            type: 'builtin', id, preset
        }));
        const customEntries = CUSTOM_GRADIENT_PRESETS.map((preset, i) => ({
            type: 'custom', index: i, preset
        }));
        let allEntries = [...builtInEntries, ...customEntries];

        // Apply type filter
        const typeFilter = typeof activeGradientTypeFilter !== 'undefined' ? activeGradientTypeFilter : 'all';
        if (typeFilter !== 'all') {
            allEntries = allEntries.filter(e => (e.preset.type || 'linear') === typeFilter);
        }

        // Apply search
        if (searchTerm) {
            allEntries = allEntries.filter(e => e.preset.name.toLowerCase().includes(searchTerm));
        }

        // Apply sort
        if (sortState === 'asc') {
            allEntries.sort((a, b) => a.preset.name.localeCompare(b.preset.name));
        } else if (sortState === 'desc') {
            allEntries.sort((a, b) => b.preset.name.localeCompare(a.preset.name));
        }

        // Update count
        const totalCount = Object.keys(GRADIENT_PRESETS).length + CUSTOM_GRADIENT_PRESETS.length;
        const isFiltered = searchTerm || typeFilter !== 'all';
        const countWrap = $('gradient-quick-count-wrap');
        const countEl = $('gradient-quick-count');
        if (countEl) countEl.innerText = isFiltered ? allEntries.length + '/' + totalCount : totalCount;
        if (countWrap) countWrap.style.display = totalCount > 0 ? '' : 'none';

        function buildSwatchHtml(preset) {
            let gradStr, bgColorStyle = '';
            if (preset.type === 'mesh' && preset.meshPoints) {
                const layers = preset.meshPoints.map(p =>
                    `radial-gradient(at ${p.x}% ${p.y}%, ${p.color} 0%, transparent ${p.spread}%)`
                ).join(', ');
                gradStr = layers;
                bgColorStyle = `background-color:${preset.meshBgColor || '#0a0a12'};`;
            } else {
                const stops = preset.stops || [];
                if (stops.length === 0) return { gradStr: 'none', bgColorStyle: '' };
                const sorted = [...stops].sort((a, b) => a.position - b.position);
                const stopsStr = sorted.map(s => `${s.color} ${s.position}%`).join(', ');
                gradStr = `linear-gradient(90deg, ${stopsStr})`;
            }
            return { gradStr, bgColorStyle };
        }

        const gradRef = activeGradientRef[dm];

        let html = allEntries.map(entry => {
            const { gradStr, bgColorStyle } = buildSwatchHtml(entry.preset);
            const isActive = gradRef && gradRef.type === entry.type && (entry.type === 'builtin' ? gradRef.id === entry.id : gradRef.index === entry.index);
            if (entry.type === 'builtin') {
                return `
                <div class="gradient-preset-chip ${isActive ? 'active' : ''}" onclick="window.applyGradientPreset('${entry.id}')" data-tooltip="${entry.preset.name.replace(/"/g, '&quot;').replace(/'/g, '&#39;')}" style="position:relative;">
                    <div class="gradient-preset-swatch" style="${bgColorStyle}background-image: ${gradStr};"></div>
                    <div class="gradient-preset-label">${entry.preset.name}</div>
                    <div class="selected-check">✓</div>
                </div>`;
            } else {
                return `
                <div class="gradient-preset-chip ${isActive ? 'active' : ''}" onclick="window.applyCustomGradientPreset(${entry.index})" data-tooltip="${entry.preset.name.replace(/"/g, '&quot;').replace(/'/g, '&#39;')}" style="position:relative;">
                    <div class="gradient-preset-swatch" style="${bgColorStyle}background-image: ${gradStr};"></div>
                    <div class="snapshot-action edit-snapshot" onclick="event.stopPropagation(); window.requestRenameGradientPreset(${entry.index})" data-tooltip="Rename preset">✎</div>
                    <div class="snapshot-action delete-snapshot" onclick="event.stopPropagation(); window.requestDeleteGradientPreset(${entry.index})" data-tooltip="Delete preset">×</div>
                    <div class="gradient-preset-label">${entry.preset.name}</div>
                    <div class="selected-check">✓</div>
                </div>`;
            }
        }).join('');

        if (allEntries.length === 0 && searchTerm) {
            html = `<div style="grid-column:1/-1; text-align:center; padding:20px 0; color:var(--text-muted); font-size:0.7rem;">No presets match "${searchTerm}"</div>`;
        }

        gallery.innerHTML = html;
    }

    // --- Shared Stop Helpers ---
    function randomHex() { return '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'); }

    function getStopsProp(type) { return type === 'mesh' ? 'gradientMeshPoints' : 'gradientStops'; }

    function persistGradientPresets() { Storage.set('gradients', CUSTOM_GRADIENT_PRESETS); syncLibrary(); }

    const stopCRUD = {
        remove(type, index) {
            const dm = getActiveDataMode();
            const prop = getStopsProp(type);
            const arr = themeData[dm][prop] || [];
            if (arr.length <= 2) return;
            if (type === 'gradient') window._gradientSliderActive = false;
            if (type === 'mesh') {
                arr.splice(index, 1);
                if (window._selectedMeshPoint === index) window._selectedMeshPoint = null;
                else if (window._selectedMeshPoint != null && window._selectedMeshPoint > index) window._selectedMeshPoint--;
            } else {
                themeData[dm][prop] = arr.filter((_, i) => i !== index);
            }
            commitChange();
        },
        update(type, index, updates) {
            const dm = getActiveDataMode();
            const arr = themeData[dm][getStopsProp(type)] || [];
            if (index < 0 || index >= arr.length) return;
            Object.assign(arr[index], updates);
            if (type === 'gradient') themeData[dm].gradientStops = [...arr];
            commitChange({ push: false });
            const timerKey = type === 'mesh' ? '_meshStopHistoryTimer' : '_gradientStopHistoryTimer';
            clearTimeout(window[timerKey]);
            window[timerKey] = setTimeout(() => pushState(), 600);
        },
    };

    window.addGradientStop = (color, position) => {
        window._gradientSliderActive = false;
        const dm = getActiveDataMode();
        const stops = themeData[dm].gradientStops || [];
        if (stops.length >= 16) return;
        const newColor = color || randomHex();
        let newPos = position;
        if (newPos == null) {
            if (stops.length === 0) newPos = 0;
            else if (stops.length === 1) newPos = 100;
            else {
                const sorted = [...stops].sort((a, b) => a.position - b.position);
                let maxGap = 0, gapStart = 0;
                for (let i = 0; i < sorted.length - 1; i++) {
                    const gap = sorted[i+1].position - sorted[i].position;
                    if (gap > maxGap) { maxGap = gap; gapStart = i; }
                }
                newPos = Math.round((sorted[gapStart].position + sorted[gapStart+1].position) / 2);
            }
        }
        themeData[dm].gradientStops = [...stops, { color: newColor, position: newPos }];
        if (!themeData[dm].gradientEnabled && themeData[dm].gradientStops.length >= 2) {
            themeData[dm].gradientEnabled = true;
        }
        commitChange();
    };

    window.removeGradientStop = (index) => stopCRUD.remove('gradient', index);

    window.duplicateGradientStop = (index) => {
        window._gradientSliderActive = false;
        const dm = getActiveDataMode();
        const stops = themeData[dm].gradientStops || [];
        if (stops.length >= 16 || index < 0 || index >= stops.length) return;
        const src = stops[index];
        const newPos = Math.min(100, Math.max(0, src.position + 5));
        stops.splice(index + 1, 0, { color: src.color, position: newPos });
        themeData[dm].gradientStops = [...stops];
        commitChange();
    };

    window.updateGradientStop = (index, updates) => stopCRUD.update('gradient', index, updates);

    window.reorderGradientStop = (fromIndex, toIndex) => {
        const dm = getActiveDataMode();
        const stops = [...(themeData[dm].gradientStops || [])];
        if (fromIndex < 0 || fromIndex >= stops.length || toIndex < 0 || toIndex >= stops.length) return;
        const positions = stops.map(s => s.position);
        const colors = stops.map(s => s.color);
        const [movedColor] = colors.splice(fromIndex, 1);
        colors.splice(toIndex, 0, movedColor);
        themeData[dm].gradientStops = positions.map((pos, i) => ({ color: colors[i], position: pos }));
        commitChange();
    };

    // Mesh stop CRUD — shares remove/update via stopCRUD
    window.addMeshStop = () => {
        const dm = getActiveDataMode();
        const points = themeData[dm].gradientMeshPoints || [];
        if (points.length >= 16) return;
        const color = randomHex();
        const x = Math.floor(Math.random() * 60) + 20;
        const y = Math.floor(Math.random() * 60) + 20;
        points.push({ color, x, y, spread: 50 });
        themeData[dm].gradientMeshPoints = points;
        window._selectedMeshPoint = points.length - 1;
        if (!themeData[dm].gradientEnabled && points.length >= 2) {
            themeData[dm].gradientEnabled = true;
        }
        commitChange();
    };

    window.removeMeshStop = (index) => stopCRUD.remove('mesh', index);

    window.updateMeshStop = (index, updates) => stopCRUD.update('mesh', index, updates);

    window.selectMeshPoint = (index) => {
        const dm = getActiveDataMode();
        const points = themeData[dm].gradientMeshPoints || [];
        if (index >= 0 && index < points.length) {
            window._selectedMeshPoint = (window._selectedMeshPoint === index) ? null : index;
            updatePalette();
        }
    };

    window.reorderMeshStop = (fromIndex, toIndex) => {
        const dm = getActiveDataMode();
        const points = [...(themeData[dm].gradientMeshPoints || [])];
        if (fromIndex < 0 || fromIndex >= points.length || toIndex < 0 || toIndex >= points.length) return;
        const [moved] = points.splice(fromIndex, 1);
        points.splice(toIndex, 0, moved);
        themeData[dm].gradientMeshPoints = points;
        if (window._selectedMeshPoint === fromIndex) window._selectedMeshPoint = toIndex;
        else if (window._selectedMeshPoint != null) {
            if (fromIndex < window._selectedMeshPoint && toIndex >= window._selectedMeshPoint) window._selectedMeshPoint--;
            else if (fromIndex > window._selectedMeshPoint && toIndex <= window._selectedMeshPoint) window._selectedMeshPoint++;
        }
        commitChange();
    };

    window.randomGradient = () => {
        window._gradientSliderActive = false;
        const dm = getActiveDataMode();
        const numStops = 3 + Math.floor(Math.random() * 3); // 3 to 5 stops
        const hueBase = Math.floor(Math.random() * 360);
        const stops = [];
        for (let i = 0; i < numStops; i++) {
            const hue = (hueBase + Math.floor(Math.random() * 120) - 60 + 360) % 360;
            const sat = 50 + Math.floor(Math.random() * 50);
            const lit = 10 + Math.floor(Math.random() * 40);
            const pos = Math.round((i / (numStops - 1)) * 100);
            // Convert HSL to Hex
            const c = (1 - Math.abs(2 * lit / 100 - 1)) * sat / 100;
            const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
            const m = lit / 100 - c / 2;
            let r, g, b;
            if (hue < 60) { r = c; g = x; b = 0; }
            else if (hue < 120) { r = x; g = c; b = 0; }
            else if (hue < 180) { r = 0; g = c; b = x; }
            else if (hue < 240) { r = 0; g = x; b = c; }
            else if (hue < 300) { r = x; g = 0; b = c; }
            else { r = c; g = 0; b = x; }
            const toHex = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
            stops.push({ color: '#' + toHex(r) + toHex(g) + toHex(b), position: pos });
        }
        themeData[dm].gradientStops = stops;
        themeData[dm].gradientEnabled = true;
        const rType = ['linear', 'radial', 'mesh'][Math.floor(Math.random() * 3)];
        themeData[dm].gradientType = rType;
        themeData[dm].gradientAngle = Math.floor(Math.random() * 360);
        if (rType === 'radial') {
            themeData[dm].gradientRadialPosX = Math.floor(Math.random() * 80) + 10;
            themeData[dm].gradientRadialPosY = Math.floor(Math.random() * 80) + 10;
            themeData[dm].gradientRadialShape = ['circle', 'ellipse'][Math.floor(Math.random() * 2)];
            themeData[dm].gradientRadialSize = ['farthest-corner', 'closest-side', 'farthest-side', 'closest-corner'][Math.floor(Math.random() * 4)];
        }
        if (rType === 'mesh') {
            const numPoints = 3 + Math.floor(Math.random() * 3);
            const hueBase = Math.floor(Math.random() * 360);
            const meshPts = [];
            for (let mi = 0; mi < numPoints; mi++) {
                const hue = (hueBase + Math.floor(Math.random() * 160) - 80 + 360) % 360;
                const sat = 60 + Math.floor(Math.random() * 35);
                const lit = 40 + Math.floor(Math.random() * 25);
                const c = `hsl(${hue}, ${sat}%, ${lit}%)`;
                const tempEl = document.createElement('div');
                tempEl.style.color = c;
                document.body.appendChild(tempEl);
                const rgb = getComputedStyle(tempEl).color;
                document.body.removeChild(tempEl);
                const match = rgb.match(/\d+/g);
                const hex = match ? '#' + match.slice(0,3).map(v => parseInt(v).toString(16).padStart(2,'0')).join('') : '#6366f1';
                meshPts.push({ color: hex, x: Math.floor(Math.random() * 80) + 10, y: Math.floor(Math.random() * 80) + 10, spread: 30 + Math.floor(Math.random() * 30) });
            }
            themeData[dm].gradientMeshPoints = meshPts;
            themeData[dm].gradientMeshBgColor = '#' + Math.floor(Math.random() * 0x0f0f0f).toString(16).padStart(6, '0');
            window._selectedMeshPoint = null;
        }
        commitChange();
        showToast('Random gradient generated!');
    };

    window.resetGradient = () => {
        window._gradientSliderActive = false;
        const dm = getActiveDataMode();
        themeData[dm].gradientEnabled = false;
        themeData[dm].gradientStops = [];
        themeData[dm].gradientType = 'linear';
        themeData[dm].gradientAngle = 135;
        themeData[dm].gradientIntensity = 85;
        themeData[dm].gradientAnimation = false;
        themeData[dm].gradientAnimationSpeed = 8;
        themeData[dm].gradientRadialPosX = 50;
        themeData[dm].gradientRadialPosY = 50;
        themeData[dm].gradientRadialShape = 'ellipse';
        themeData[dm].gradientRadialSize = 'farthest-corner';
        themeData[dm].gradientMeshPoints = [];
        themeData[dm].gradientMeshBgColor = '#0a0a12';
        window._selectedMeshPoint = null;
        commitChange();
        showToast('Gradient cleared');
    };

    window.toggleTransferPanel = () => {
        const panel = document.getElementById('gradient-transfer-panel');
        if (!panel) return;
        const isOpen = panel.style.display !== 'none';
        if (isOpen) { panel.style.display = 'none'; return; }
        const dm = getActiveDataMode();
        const currentType = themeData[dm].gradientType || 'linear';
        const sourceLabel = document.getElementById('transfer-source-label');
        if (sourceLabel) sourceLabel.textContent = currentType.charAt(0).toUpperCase() + currentType.slice(1);
        // Hide current type, show others, reset checkboxes
        ['linear', 'radial', 'mesh'].forEach(t => {
            const label = document.getElementById('transfer-target-' + t);
            if (label) {
                label.style.display = (t === currentType) ? 'none' : 'flex';
                const cb = label.querySelector('input[type="checkbox"]');
                if (cb) cb.checked = (t !== currentType);
            }
        });
        panel.style.display = 'block';
    };

    window.executeTransferColors = () => {
        const dm = getActiveDataMode();
        const config = themeData[dm];
        const currentType = config.gradientType || 'linear';
        const targets = [];
        document.querySelectorAll('#transfer-targets input[type="checkbox"]:checked').forEach(cb => targets.push(cb.value));
        if (targets.length === 0) { showToast('Select at least one target type'); return; }

        // Extract colors from current type
        let colors = [];
        if (currentType === 'mesh') {
            colors = (config.gradientMeshPoints || []).map(p => p.color);
        } else {
            colors = (config.gradientStops || []).map(s => s.color);
        }
        if (colors.length < 2) { showToast('Need at least 2 colors to transfer'); return; }

        let transferred = [];
        for (const target of targets) {
            if (target === currentType) continue;
            if (target === 'mesh') {
                // Convert to mesh points: distribute along a diagonal
                const points = colors.map((color, i) => {
                    const t = colors.length > 1 ? i / (colors.length - 1) : 0.5;
                    return { color, x: Math.round(15 + t * 70), y: Math.round(15 + t * 70), spread: 50 };
                });
                config.gradientMeshPoints = points;
                config.gradientMeshBgColor = config.gradientMeshBgColor || '#0a0a12';
            } else {
                // Convert to linear/radial stops: distribute positions evenly
                const stops = colors.map((color, i) => ({
                    color,
                    position: colors.length > 1 ? Math.round((i / (colors.length - 1)) * 100) : 50
                }));
                config.gradientStops = stops;
            }
            transferred.push(target.charAt(0).toUpperCase() + target.slice(1));
        }

        hideModal('gradient-transfer-panel');
        activeGradientRef[dm] = null;
        commitChange({ clearRef: false });
        showToast(`Colors transferred to ${transferred.join(' & ')}!`);
    };

    window.reverseGradientStops = () => {
        window._gradientSliderActive = false;
        const dm = getActiveDataMode();
        const gType = themeData[dm].gradientType || 'linear';
        if (gType === 'mesh') {
            const points = themeData[dm].gradientMeshPoints || [];
            if (points.length < 2) return;
            points.forEach(p => { p.x = 100 - p.x; p.y = 100 - p.y; });
            themeData[dm].gradientMeshPoints = [...points];
        } else {
            const stops = themeData[dm].gradientStops || [];
            if (stops.length < 2) return;
            stops.forEach(s => { s.position = 100 - s.position; });
            themeData[dm].gradientStops = [...stops];
        }
        commitChange();
        showToast('Gradient reversed');
    };

    window.distributeGradientStops = () => {
        window._gradientSliderActive = false;
        const dm = getActiveDataMode();
        const gType = themeData[dm].gradientType || 'linear';
        if (gType === 'mesh') {
            // For mesh: distribute points in a grid-like pattern
            const points = themeData[dm].gradientMeshPoints || [];
            if (points.length < 2) return;
            const cols = Math.ceil(Math.sqrt(points.length));
            const rows = Math.ceil(points.length / cols);
            const padX = 15, padY = 15;
            points.forEach((p, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                p.x = Math.round(padX + (col / Math.max(cols - 1, 1)) * (100 - 2 * padX));
                p.y = Math.round(padY + (row / Math.max(rows - 1, 1)) * (100 - 2 * padY));
            });
            themeData[dm].gradientMeshPoints = [...points];
        } else {
            const stops = themeData[dm].gradientStops || [];
            if (stops.length < 2) return;
            stops.forEach((s, i) => { s.position = Math.round(i / (stops.length - 1) * 100); });
            themeData[dm].gradientStops = [...stops];
        }
        commitChange();
        showToast('Stops distributed evenly');
    };

    function presetToGradientData(p) {
        return {
            gradientEnabled: true, gradientType: p.type || 'linear', gradientAngle: p.angle ?? 135,
            gradientStops: p.stops || [], gradientAnimation: !!p.animation,
            gradientIntensity: p.intensity ?? 85, gradientAnimationSpeed: p.speed || 8,
            gradientRadialPosX: p.radialPosX ?? 50, gradientRadialPosY: p.radialPosY ?? 50,
            gradientRadialShape: p.radialShape || 'ellipse', gradientRadialSize: p.radialSize || 'farthest-corner',
            gradientMeshPoints: p.meshPoints || [], gradientMeshBgColor: p.meshBgColor || '#0a0a12',
        };
    }

    function applyGradient(preset, ref) {
        window._gradientSliderActive = false;
        const dm = getActiveDataMode();
        copyGradientProps(themeData[dm], presetToGradientData(preset));
        if (preset.type === 'mesh' && preset.meshPoints) window._selectedMeshPoint = null;
        activeThemeRef[dm] = null;
        activeGradientRef[dm] = ref;
        commitChange({ clearRef: false });
        showToast(`Loaded "${preset.name}" gradient`);
    }

    window.applyGradientPreset = (presetId) => {
        const preset = GRADIENT_PRESETS[presetId];
        if (!preset) return;
        applyGradient(preset, { type: 'builtin', id: presetId });
    };

    // Custom gradient preset CRUD
    let _gradientPresetToDelete = null;

    window.saveGradientPreset = () => {
        const dm = getActiveDataMode();
        const config = themeData[dm];
        const stops = config.gradientStops || [];
        const meshPoints = config.gradientMeshPoints || [];
        const gType = config.gradientType || 'linear';
        if ((gType === 'mesh' && meshPoints.length < 2) || (gType !== 'mesh' && stops.length < 2)) {
            showToast('Add at least 2 stops first');
            return;
        }
        const input = $('gradient-preset-name-input');
        input.value = `Gradient ${new Date().toLocaleTimeString()}`;
        showModal('save-gradient-modal');
        setTimeout(() => { input.focus(); input.select(); }, 50);
    };

    const confirmSaveGradientBtn = $('confirm-save-gradient-btn');
    if (confirmSaveGradientBtn) confirmSaveGradientBtn.addEventListener('click', () => {
        const name = $('gradient-preset-name-input').value.trim();
        if (!name) return;
        const dm = getActiveDataMode();
        const config = themeData[dm];
        const preset = {
            name,
            type: config.gradientType || 'linear',
            stops: structuredClone(config.gradientStops || []),
            angle: config.gradientAngle ?? 135,
            intensity: config.gradientIntensity ?? 85,
            animation: !!config.gradientAnimation,
            speed: config.gradientAnimationSpeed || 8,
            radialPosX: config.gradientRadialPosX ?? 50,
            radialPosY: config.gradientRadialPosY ?? 50,
            radialShape: config.gradientRadialShape || 'ellipse',
            radialSize: config.gradientRadialSize || 'farthest-corner',
        };
        if (preset.type === 'mesh') {
            preset.meshPoints = structuredClone(config.gradientMeshPoints || []);
            preset.meshBgColor = config.gradientMeshBgColor || '#0a0a12';
        }
        CUSTOM_GRADIENT_PRESETS.push(preset);
        persistGradientPresets();
        hideModal('save-gradient-modal');
        renderGradientPresets();
        showToast('Gradient preset saved!');
    });

    window.applyCustomGradientPreset = (index) => {
        const preset = CUSTOM_GRADIENT_PRESETS[index];
        if (!preset) return;
        applyGradient(preset, { type: 'custom', index: index });
    };

    window.requestDeleteGradientPreset = (index) => {
        _gradientPresetToDelete = index;
        $('delete-gradient-name').innerText = CUSTOM_GRADIENT_PRESETS[index].name;
        showModal('delete-gradient-modal');
    };

    const confirmDeleteGradientBtn = $('confirm-delete-gradient-btn');
    if (confirmDeleteGradientBtn) confirmDeleteGradientBtn.addEventListener('click', () => {
        if (_gradientPresetToDelete === null) return;
        const deletedIdx = _gradientPresetToDelete;
        CUSTOM_GRADIENT_PRESETS.splice(deletedIdx, 1);
        persistGradientPresets();
        // Adjust activeGradientRef for ALL modes — prevents stale/wrong active indicator
        MODES.forEach(m => {
            if (activeGradientRef[m] && activeGradientRef[m].type === 'custom') {
                if (activeGradientRef[m].index === deletedIdx) {
                    activeGradientRef[m] = null;
                } else if (activeGradientRef[m].index > deletedIdx) {
                    activeGradientRef[m].index--;
                }
            }
        });
        hideModal('delete-gradient-modal');
        renderGradientPresets();
        _gradientPresetToDelete = null;
        showToast('Gradient preset deleted');
    });

    let _gradientPresetToRename = null;

    window.requestRenameGradientPreset = (index) => {
        _gradientPresetToRename = index;
        const input = $('rename-gradient-input');
        input.value = CUSTOM_GRADIENT_PRESETS[index].name;
        showModal('rename-gradient-modal');
        setTimeout(() => { input.focus(); input.select(); }, 50);
    };

    const confirmRenameGradientBtn = $('confirm-rename-gradient-btn');
    if (confirmRenameGradientBtn) confirmRenameGradientBtn.addEventListener('click', () => {
        if (_gradientPresetToRename === null) return;
        const newName = $('rename-gradient-input').value.trim();
        if (!newName) return;
        CUSTOM_GRADIENT_PRESETS[_gradientPresetToRename].name = newName;
        persistGradientPresets();
        hideModal('rename-gradient-modal');
        renderGradientPresets();
        _gradientPresetToRename = null;
        showToast('Gradient preset renamed');
    });

    // Export all custom gradient presets
    const exportAllGradientBtn = $('export-all-gradient-btn');
    if (exportAllGradientBtn) exportAllGradientBtn.onclick = () => {
        if (CUSTOM_GRADIENT_PRESETS.length === 0) return showToast('No custom gradient presets to export');
        const dateStr = new Date().toISOString().split('T')[0];
        downloadFile({ gradient_presets: CUSTOM_GRADIENT_PRESETS, isGradientBackup: true, version: '{VERSION}' }, `owui-gradient-presets-backup-${dateStr}.json`);
        showToast('Gradient presets exported!');
    };

    // Delete all custom gradient presets
    setupMassDelete({
        triggerId: 'delete-all-gradient-btn', modalId: 'delete-all-gradient-modal',
        confirmId: 'confirm-delete-all-gradient-btn',
        emptyMsg: 'No presets to delete', toastMsg: 'Gradient Presets Cleared!',
        isEmpty: () => CUSTOM_GRADIENT_PRESETS.length === 0,
        onConfirm: () => {
            CUSTOM_GRADIENT_PRESETS.length = 0;
            persistGradientPresets();
            activeGradientRef = { dark: null, oled: null, light: null, her: null };
            renderGradientPresets();
        }
    });

    // Import gradient presets
    const importGradientBtn = $('import-gradient-btn');
    if (importGradientBtn) importGradientBtn.onclick = () => {
        const urlInput = $('import-gradient-url-input');
        const statusEl = $('import-gradient-url-status');
        if (urlInput) urlInput.value = '';
        if (statusEl) { statusEl.style.display = 'none'; statusEl.textContent = ''; }
        showModal('import-gradient-modal');
    };

    // Import Gradient File button inside the import modal
    document.getElementById('import-gradient-file-trigger-btn').onclick = () => triggerFileImport({
        accept: '.json', modalId: 'import-gradient-modal', importFn: handleGradientImport
    });

    // Load URL button inside the gradient import modal
    document.getElementById('import-gradient-url-load-btn').onclick = () => loadFromUrl({
        urlInputId: 'import-gradient-url-input', statusId: 'import-gradient-url-status',
        loadBtnId: 'import-gradient-url-load-btn', modalId: 'import-gradient-modal',
        fetchMsg: 'Fetching gradient presets from URL...', emptyMsg: 'Please enter a URL to a JSON file.',
        defaultName: 'gradients.json', defaultExt: '.json', mimeType: 'application/json',
        importFn: handleGradientImport
    });

    // Allow Enter key to trigger gradient URL load
    document.getElementById('import-gradient-url-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('import-gradient-url-load-btn').click();
    });

    // Prevent the global drop overlay from showing when dragging over the gradient modal
    const gradientModal = $('import-gradient-modal');
    if (gradientModal) {
        gradientModal.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
        gradientModal.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); });
    }

    function resetGradientProp(prop, val) { themeData[getActiveDataMode()][prop] = val; commitChange(); }
    window.resetGradientAngle = () => resetGradientProp('gradientAngle', 135);
    window.resetGradientIntensity = () => resetGradientProp('gradientIntensity', 85);
    window.resetGradientSpeed = () => resetGradientProp('gradientAnimationSpeed', 8);

    // Gradient type pill handlers
    document.querySelectorAll('.gradient-type-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            document.querySelectorAll('.gradient-type-pill').forEach(p => p.setAttribute('aria-pressed', 'false'));
            pill.setAttribute('aria-pressed', 'true');
            const dm = getActiveDataMode();
            themeData[dm].gradientType = pill.dataset.gtype;
            // Auto-populate mesh defaults when switching to mesh
            if (pill.dataset.gtype === 'mesh' && themeData[dm].gradientEnabled && (!themeData[dm].gradientMeshPoints || themeData[dm].gradientMeshPoints.length < 2)) {
                themeData[dm].gradientMeshPoints = [{color:'#6366f1',x:25,y:25,spread:50},{color:'#ec4899',x:75,y:30,spread:45},{color:'#06b6d4',x:50,y:75,spread:50}];
                themeData[dm].gradientMeshBgColor = themeData[dm].gradientMeshBgColor || '#0a0a12';
            }
            window._selectedMeshPoint = null;
            commitChange();
        });
    });

    // Radial XY pad handler
    const xyPad = $('radial-xy-pad');
    if (xyPad) {
        let xyDragging = false;
        function updateXYFromEvent(e) {
            const rect = xyPad.getBoundingClientRect();
            const x = Math.max(0, Math.min(100, Math.round((e.clientX - rect.left) / rect.width * 100)));
            const y = Math.max(0, Math.min(100, Math.round((e.clientY - rect.top) / rect.height * 100)));
            const dm = getActiveDataMode();
            themeData[dm].gradientRadialPosX = x;
            themeData[dm].gradientRadialPosY = y;
            const dot = $('radial-xy-dot');
            if (dot) { dot.style.left = x + '%'; dot.style.top = y + '%'; }
            const label = $('radial-xy-label');
            if (label) label.innerText = x + '%, ' + y + '%';
            commitChange({ push: false });
        }
        xyPad.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            xyDragging = true;
            xyPad.setPointerCapture(e.pointerId);
            updateXYFromEvent(e);
        });
        xyPad.addEventListener('pointermove', (e) => { if (xyDragging) updateXYFromEvent(e); });
        xyPad.addEventListener('pointerup', () => { if (xyDragging) { xyDragging = false; pushState(); } });
        xyPad.addEventListener('lostpointercapture', () => { if (xyDragging) { xyDragging = false; pushState(); } });
        xyPad.addEventListener('dblclick', () => {
            const dm = getActiveDataMode();
            themeData[dm].gradientRadialPosX = 50;
            themeData[dm].gradientRadialPosY = 50;
            commitChange();
        });

        // Keyboard navigation for radial XY pad (accessibility)
        xyPad.addEventListener('keydown', (e) => {
            if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) return;
            e.preventDefault();
            const dm = getActiveDataMode();
            const step = e.shiftKey ? 5 : 1;

            if (e.key === 'Home') {
                themeData[dm].gradientRadialPosX = 50;
                themeData[dm].gradientRadialPosY = 50;
            } else {
                let x = themeData[dm].gradientRadialPosX ?? 50;
                let y = themeData[dm].gradientRadialPosY ?? 50;
                if (e.key === 'ArrowLeft')  x = Math.max(0, x - step);
                if (e.key === 'ArrowRight') x = Math.min(100, x + step);
                if (e.key === 'ArrowUp')    y = Math.max(0, y - step);
                if (e.key === 'ArrowDown')  y = Math.min(100, y + step);
                themeData[dm].gradientRadialPosX = x;
                themeData[dm].gradientRadialPosY = y;
            }
            commitChange();
        });
    }

    // Radial pill handlers (shape + size)
    [
        ['.radial-shape-pill', 'shape', 'gradientRadialShape'],
        ['.radial-size-pill', 'size', 'gradientRadialSize'],
    ].forEach(([sel, attr, prop]) => {
        document.querySelectorAll(sel).forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll(sel).forEach(p => p.setAttribute('aria-pressed', 'false'));
                pill.setAttribute('aria-pressed', 'true');
                themeData[getActiveDataMode()][prop] = pill.dataset[attr];
                commitChange();
            });
        });
    });

    // Mesh editor pad handlers
    window._selectedMeshPoint = null;
    window._meshDragActive = false;
    const meshPad = $('mesh-editor-pad');
    if (meshPad) {
        let meshDragIdx = null, meshDragMoved = false;
        meshPad.addEventListener('pointerdown', (e) => {
            const dot = e.target.closest('.mesh-dot');
            if (dot) {
                meshDragIdx = parseInt(dot.dataset.index);
                window._meshDragActive = true;
                meshDragMoved = false;
                meshPad.setPointerCapture(e.pointerId);
                e.preventDefault();
                window._selectedMeshPoint = meshDragIdx;
                // Direct DOM selection — don't call updatePalette() to preserve dblclick target
                meshPad.querySelectorAll('.mesh-dot').forEach(d => d.classList.remove('selected'));
                dot.classList.add('selected');
                // Highlight corresponding row in the stops list
                const meshStopsListEl = $('mesh-stops-list');
                if (meshStopsListEl) {
                    meshStopsListEl.querySelectorAll('.mesh-stop-row').forEach(r => r.classList.remove('selected'));
                    const targetRow = meshStopsListEl.querySelector(`.mesh-stop-row[data-index="${meshDragIdx}"]`);
                    if (targetRow) targetRow.classList.add('selected');
                }
            } else {
                const dm = getActiveDataMode();
                const points = themeData[dm].gradientMeshPoints || [];
                if (points.length >= 16) return;
                const rect = meshPad.getBoundingClientRect();
                const x = Math.max(0, Math.min(100, Math.round((e.clientX - rect.left) / rect.width * 100)));
                const y = Math.max(0, Math.min(100, Math.round((e.clientY - rect.top) / rect.height * 100)));
                const color = randomHex();
                points.push({ color, x, y, spread: 50 });
                themeData[dm].gradientMeshPoints = points;
                window._selectedMeshPoint = points.length - 1;
                commitChange();
            }
        });
        meshPad.addEventListener('pointermove', (e) => {
            if (!window._meshDragActive || meshDragIdx == null) return;
            meshDragMoved = true;
            const rect = meshPad.getBoundingClientRect();
            const x = Math.max(0, Math.min(100, Math.round((e.clientX - rect.left) / rect.width * 100)));
            const y = Math.max(0, Math.min(100, Math.round((e.clientY - rect.top) / rect.height * 100)));
            const dm = getActiveDataMode();
            const points = themeData[dm].gradientMeshPoints || [];
            if (points[meshDragIdx]) {
                points[meshDragIdx].x = x;
                points[meshDragIdx].y = y;
                const dotEl = meshPad.querySelector(`.mesh-dot[data-index="${meshDragIdx}"]`);
                if (dotEl) { dotEl.style.left = x + '%'; dotEl.style.top = y + '%'; }
                commitChange({ push: false });
            }
        });
        meshPad.addEventListener('pointerup', () => {
            if (window._meshDragActive) {
                window._meshDragActive = false;
                if (meshDragMoved) commitChange({ clearRef: false });
                meshDragIdx = null;
            }
        });
        meshPad.addEventListener('lostpointercapture', () => {
            if (window._meshDragActive) {
                window._meshDragActive = false;
                if (meshDragMoved) commitChange({ clearRef: false });
                meshDragIdx = null;
            }
        });
        meshPad.addEventListener('dblclick', (e) => {
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const dot = el && el.closest('.mesh-dot');
            if (!dot) return;
            const idx = parseInt(dot.dataset.index);
            const dm = getActiveDataMode();
            const points = themeData[dm].gradientMeshPoints || [];
            if (points.length <= 2) return;
            points.splice(idx, 1);
            if (window._selectedMeshPoint === idx) window._selectedMeshPoint = null;
            else if (window._selectedMeshPoint > idx) window._selectedMeshPoint--;
            commitChange();
        });

        // Keyboard navigation for mesh pad (accessibility)
        meshPad.addEventListener('keydown', (e) => {
            const dm = getActiveDataMode();
            const points = themeData[dm].gradientMeshPoints || [];
            const selIdx = window._selectedMeshPoint;

            // Arrow keys: move selected point (Shift = 5px step)
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selIdx !== null && points[selIdx]) {
                e.preventDefault();
                const step = e.shiftKey ? 5 : 1;
                if (e.key === 'ArrowLeft')  points[selIdx].x = Math.max(0, points[selIdx].x - step);
                if (e.key === 'ArrowRight') points[selIdx].x = Math.min(100, points[selIdx].x + step);
                if (e.key === 'ArrowUp')    points[selIdx].y = Math.max(0, points[selIdx].y - step);
                if (e.key === 'ArrowDown')  points[selIdx].y = Math.min(100, points[selIdx].y + step);
                commitChange();
                return;
            }

            // Delete/Backspace: remove selected point (min 2)
            if ((e.key === 'Delete' || e.key === 'Backspace') && selIdx !== null && points.length > 2) {
                e.preventDefault();
                points.splice(selIdx, 1);
                window._selectedMeshPoint = null;
                commitChange();
                return;
            }

            // Tab: cycle through mesh points
            if (e.key === 'Tab' && points.length > 0) {
                e.preventDefault();
                const next = selIdx === null ? 0 : (selIdx + (e.shiftKey ? -1 : 1) + points.length) % points.length;
                window._selectedMeshPoint = next;
                commitChange({ push: false });
            }
        });
    }

    // Mesh stop handlers are now inline in the rendered stop rows (via window.updateMeshStop, window.removeMeshStop, etc.)
    // Initialize slider active flag
    window._meshSpreadSliderActive = false;

    // Mesh base color handler
    const meshBgColorInput = $('mesh-bg-color');
    if (meshBgColorInput) {
        meshBgColorInput.addEventListener('input', (e) => {
            const dm = getActiveDataMode();
            themeData[dm].gradientMeshBgColor = e.target.value;
            const sw = $('mesh-bg-swatch');
            if (sw) sw.style.background = e.target.value;
            commitChange({ push: false });
        });
        meshBgColorInput.addEventListener('change', () => pushState());
    }

    // Gradient toggle handler
    const toggleGradientBg = $('toggle-gradient-bg');
    if (toggleGradientBg) toggleGradientBg.addEventListener('change', (e) => {
        const dm = getActiveDataMode();
        themeData[dm].gradientEnabled = e.target.checked;
        if (e.target.checked) {
            if (themeData[dm].gradientType === 'mesh') {
                if (!themeData[dm].gradientMeshPoints || themeData[dm].gradientMeshPoints.length < 2) {
                    themeData[dm].gradientMeshPoints = [{color:'#6366f1',x:25,y:25,spread:50},{color:'#ec4899',x:75,y:30,spread:45},{color:'#06b6d4',x:50,y:75,spread:50}];
                    themeData[dm].gradientMeshBgColor = themeData[dm].gradientMeshBgColor || '#0a0a12';
                }
            } else if (!themeData[dm].gradientStops || themeData[dm].gradientStops.length < 2) {
                themeData[dm].gradientStops = [
                    { color: '#0f0c29', position: 0 },
                    { color: '#302b63', position: 50 },
                    { color: '#24243e', position: 100 }
                ];
            }
        }
        commitChange();
    });

    // Gradient animation toggle handler
    const toggleGradientAnim = $('toggle-gradient-animation');
    if (toggleGradientAnim) toggleGradientAnim.addEventListener('change', (e) => {
        const dm = getActiveDataMode();
        themeData[dm].gradientAnimation = e.target.checked;
        commitChange();
    });

    // Gradient slider handlers
    const gradientSliders = [
        ['sl-gradient-angle', 'gradientAngle', 'val-gradient-angle', v => v + '°'],
        ['sl-gradient-intensity', 'gradientIntensity', 'val-gradient-intensity', v => v + '%'],
        ['sl-gradient-speed', 'gradientAnimationSpeed', 'val-gradient-speed', v => v + 's']
    ];
    gradientSliders.forEach(([sliderId, prop, valId, fmt]) => {
        const slider = $(sliderId);
        if (slider) {
            slider.addEventListener('input', () => {
                const dm = getActiveDataMode();
                themeData[dm][prop] = parseInt(slider.value);
                if ($(valId)) $(valId).innerText = fmt(slider.value);
                commitChange({ push: false });
            });
            slider.addEventListener('change', () => pushState());
        }
    });

    // === END GRADIENT BUILDER LOGIC ===

    $('reset-mode-btn').onclick = () => {
        const names = { dark: 'Dark', oled: 'OLED', light: 'Light', her: 'Her', system: 'System' };
        const dm = getActiveDataMode();
        const label = activeMode === 'system' ? `System (${names[dm]})` : names[activeMode];
        $('reset-target-mode').innerText = label;
        $('reset-backup-cb').checked = false;
        showModal('reset-modal');
    };

    $('confirm-reset-btn').onclick = () => {
        hideModal('reset-modal');
        const saveBackup = $('reset-backup-cb').checked;
        resetActiveMode(false, saveBackup);
    };
    
    $('nuclear-btn').onclick = () => {
        $('nuclear-backup-cb').checked = false;
        showModal('nuclear-modal');
    };
    
    $('confirm-nuclear-btn').onclick = () => {
        hideModal('nuclear-modal');
        const saveBackup = $('nuclear-backup-cb').checked;
        nuclearReset(false, saveBackup);
    };
    $('factory-reset-btn').onclick = () => showModal('factory-reset-modal');
    $('confirm-factory-reset-btn').onclick = () => {
        // Export backup if checkbox is checked
        const backupCb = $('factory-backup-cb');
        if (backupCb && backupCb.checked) {
            const snapshots = getSnapshots();
            const cssPresets = Storage.get('css', []);
            const canvasPresets = Storage.get('canvas', []);
            const dateStr = new Date().toISOString().split('T')[0];
            if (snapshots.length > 0) downloadFile({ themes: snapshots, isLibraryBackup: true }, `owui-themes-backup-${dateStr}.json`);
            if (cssPresets.length > 0) downloadFile({ css_presets: cssPresets, isCssBackup: true }, `owui-css-backup-${dateStr}.json`);
            if (canvasPresets.length > 0) downloadFile({ canvas_presets: canvasPresets, isCanvasBackup: true }, `owui-canvas-backup-${dateStr}.json`);
            const gradientPresets = Storage.get('gradients', []);
            if (gradientPresets.length > 0) downloadFile({ gradient_presets: gradientPresets, isGradientBackup: true }, `owui-gradient-presets-backup-${dateStr}.json`);
        }
        const keysToWipe =[
            'owui_dev_theme_v1', 
            'owui_dev_theme_v1_css',
            'owui_theme_snapshots',
            'owui_canvas_presets',
            'owui_css_presets',
            'owui_gradient_presets',
            'owui_canvas_last_mode',
            'owui_canvas_last_script',
            'owui_theme_last_metadata',
            'owui_theme_valve_no_canvas'
        ];
        keysToWipe.forEach(k => {
            Storage.remove(k);
            try { localStorage.removeItem(k); } catch(e) { console.warn('Theme Pro:', e); }
        });
        try { sessionStorage.removeItem('owui_theme_draft_mode'); } catch(e) {}
        // Clear server-side theme CSS, bootloader, and broadcast disable — THEN reload
        fetch('{ROUTE_BASE}', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ css: '', reset: true })
        }).then(r => {
            if (r.ok) {
                console.log('[Theme Pro] Factory reset complete — reloading');
            } else {
                console.warn('[Theme Pro] Factory reset server responded with', r.status);
            }
            window.location.reload();
        }).catch(e => {
            console.warn('[Theme Pro] Factory reset server POST failed:', e);
            // Reload anyway — local state is already wiped
            window.location.reload();
        });
    };

    let syncSourceType = 'active-mode'; // 'active-mode', 'curated-preset', 'snapshot'
    let syncSourceId = null;

    function updateTargetsHeaderToggleState() {
        const enabledTargets = MODES.filter(m => {
            const cb = $(`sync-target-${m}`);
            return cb && !cb.disabled;
        });
        const checkedTargets = enabledTargets.filter(m => {
            const cb = $(`sync-target-${m}`);
            return cb && cb.checked;
        });
        const toggleBtn = $('sync-toggle-targets');
        if (toggleBtn && enabledTargets.length > 0) {
            toggleBtn.innerText = (checkedTargets.length === enabledTargets.length) ? 'Deselect All' : 'Select All';
        }
    }

    function updateOptionsHeaderToggleState() {
        const options = ['palette', 'overrides', 'css', 'canvas', 'gradient', 'auth'];
        const checkedOptions = options.filter(opt => {
            const cb = $(`sync-opt-${opt}`);
            return cb && cb.checked;
        });
        const toggleBtn = $('sync-toggle-options');
        if (toggleBtn) {
            toggleBtn.innerText = (checkedOptions.length === options.length) ? 'Deselect All' : 'Select All';
        }
    }

    // Attach option toggle change listeners on initialization
    ['palette', 'overrides', 'css', 'canvas', 'gradient', 'auth'].forEach(opt => {
        const cb = $(`sync-opt-${opt}`);
        if (cb) {
            cb.addEventListener('change', updateOptionsHeaderToggleState);
        }
    });

    $('sync-toggle-targets').onclick = () => {
        const toggleBtn = $('sync-toggle-targets');
        const shouldSelect = (toggleBtn.innerText === 'Select All');
        MODES.forEach(m => {
            const cb = $(`sync-target-${m}`);
            if (cb && !cb.disabled) {
                cb.checked = shouldSelect;
                const pill = cb.closest('.sync-mode-pill');
                if (pill) pill.classList.toggle('active', shouldSelect);
            }
        });
        toggleBtn.innerText = shouldSelect ? 'Deselect All' : 'Select All';
        updateSyncDeltaBadges();
    };

    $('sync-toggle-options').onclick = () => {
        const toggleBtn = $('sync-toggle-options');
        const shouldSelect = (toggleBtn.innerText === 'Select All');
        ['palette', 'overrides', 'css', 'canvas', 'gradient', 'auth'].forEach(opt => {
            const cb = $(`sync-opt-${opt}`);
            if (cb) cb.checked = shouldSelect;
        });
        toggleBtn.innerText = shouldSelect ? 'Deselect All' : 'Select All';
    };

    // === Delta Badge Logic for Sync Settings ===
    function getSyncSourceData(targetMode) {
        if (syncSourceType === 'active-mode') {
            const dm = getActiveDataMode();
            const srcRef = activeThemeRef[dm];
            const tgtRef = activeThemeRef[targetMode];

            // If both the active mode and the target mode point to the same snapshot,
            // compare the target against the snapshot's own per-mode data instead of
            // cross-comparing against the active mode's live themeData. This prevents
            // false "Diff" badges when a snapshot with legitimately different per-mode
            // values (e.g., different lightness for OLED vs Dark) is applied to all modes.
            if (srcRef && tgtRef && srcRef.type === tgtRef.type && srcRef.id === tgtRef.id) {
                if (srcRef.type === 'snapshot') {
                    const snapshots = getSnapshots();
                    const s = snapshots[srcRef.id];
                    if (s && s[targetMode]) {
                        return s[targetMode];
                    }
                } else if (srcRef.type === 'preset') {
                    const presetData = CURATED_PRESETS[srcRef.id];
                    if (presetData) {
                        return buildCuratedSourceData(presetData, targetMode);
                    }
                }
            }

            return themeData[dm];
        } else if (syncSourceType === 'snapshot') {
            const snapshots = getSnapshots();
            const s = snapshots[syncSourceId];
            if (!s) return null;
            let src = s[targetMode];
            if (!src) {
                if (targetMode === 'oled' && s.dark) src = structuredClone(s.dark);
                else if (targetMode === 'her' && s.light) src = structuredClone(s.light);
                else src = structuredClone(s.dark || s.light);
            }
            return src;
        } else if (syncSourceType === 'curated-preset') {
            const presetData = CURATED_PRESETS[syncSourceId];
            if (!presetData) return null;
            return buildCuratedSourceData(presetData, targetMode);
        }
        return null;
    }

    function deepEqualObj(a, b) {
        if (a === b) return true;
        if (!a || !b) return (!a && !b);
        const ka = Object.keys(a), kb = Object.keys(b);
        if (ka.length !== kb.length) return false;
        return ka.every(k => a[k] === b[k]);
    }

    function setSyncBadge(badge, isSync, diffCount) {
        if (!badge) return;
        badge.style.display = 'inline-flex';
        const settingKey = (badge.id || '').replace('sync-badge-', '');
        const chevron = document.querySelector(`.sync-diff-chevron[data-setting="${settingKey}"]`);
        if (isSync) {
            badge.className = 'sync-delta-badge in-sync';
            badge.innerHTML = '✓ In Sync';
            badge.onclick = null;
            badge.style.cursor = 'default';
            if (chevron) { chevron.style.display = 'none'; chevron.classList.remove('expanded'); }
            const panel = $(`sync-diff-${settingKey}`);
            if (panel) panel.style.display = 'none';
        } else {
            badge.className = 'sync-delta-badge diff-detected';
            badge.innerHTML = diffCount > 1 ? `⚠ ${diffCount} modes differ` : '⚠ Diff';
            badge.style.cursor = 'pointer';
            badge.onclick = (e) => { e.stopPropagation(); toggleSyncDiff(settingKey); };
            if (chevron) chevron.style.display = '';
        }
    }

    // Per-mode diff data cache (populated by updateSyncDeltaBadges)
    let syncDiffData = {};

    function updateSyncDeltaBadges() {
        const badges = {
            palette:   $('sync-badge-palette'),
            overrides: $('sync-badge-overrides'),
            css:       $('sync-badge-css'),
            canvas:    $('sync-badge-canvas'),
            gradient:  $('sync-badge-gradient'),
            auth:      $('sync-badge-auth')
        };

        const targetModes = MODES.filter(m => {
            const cb = $(`sync-target-${m}`);
            return cb && cb.checked && !cb.disabled;
        });

        // Reset diff data
        syncDiffData = { palette: [], overrides: [], css: [], canvas: [], gradient: [], auth: [] };

        if (targetModes.length === 0) {
            Object.values(badges).forEach(b => { if (b) b.style.display = 'none'; });
            ['palette','overrides','css','canvas','gradient','auth'].forEach(k => {
                const chevron = document.querySelector(`.sync-diff-chevron[data-setting="${k}"]`);
                if (chevron) chevron.style.display = 'none';
                const panel = $(`sync-diff-${k}`);
                if (panel) panel.style.display = 'none';
            });
            return;
        }

        let paletteDiffs = 0, overridesDiffs = 0, cssDiffs = 0, canvasDiffs = 0, gradientDiffs = 0, authDiffs = 0;

        for (const mode of targetModes) {
            const sourceData = getSyncSourceData(mode);
            if (!sourceData) continue;
            const targetData = themeData[mode];

            // === Palette ===
            let incomingL = sourceData.l;
            if (syncSourceType === 'active-mode' && mode === 'oled' && sourceData === themeData[getActiveDataMode()]) incomingL = 0;
            const eps = 0.5;
            const valOk = (v) => v != null && !isNaN(v);
            const pairsMatch = (a, b) => {
                const aOk = valOk(a), bOk = valOk(b);
                if (!aOk && !bOk) return true;
                if (aOk !== bOk) return false;
                return Math.abs(a - b) <= eps;
            };
            const pMatch = pairsMatch(sourceData.h, targetData.h) && pairsMatch(sourceData.c, targetData.c) && pairsMatch(incomingL, targetData.l);
            syncDiffData.palette.push({ mode, match: pMatch, src: { h: targetData.h, c: targetData.c, l: targetData.l }, tgt: { h: sourceData.h, c: sourceData.c, l: incomingL }, srcOverrides: targetData.overrides, tgtOverrides: sourceData.overrides });
            if (!pMatch) paletteDiffs++;

            // === Overrides ===
            const oMatch = deepEqualObj(sourceData.overrides || {}, targetData.overrides || {});
            syncDiffData.overrides.push({ mode, match: oMatch, src: targetData.overrides || {}, tgt: sourceData.overrides || {} });
            if (!oMatch) overridesDiffs++;

            // === CSS ===
            const srcCss = (sourceData.customCSS || '').trim();
            const tgtCss = (targetData.customCSS || '').trim();
            const srcCssEnabled = !!sourceData.customCssEnabled;
            const tgtCssEnabled = !!targetData.customCssEnabled;
            const srcAutoScope = sourceData.autoScope !== false;
            const tgtAutoScope = targetData.autoScope !== false;
            const cMatch = srcCss === tgtCss && srcCssEnabled === tgtCssEnabled && srcAutoScope === tgtAutoScope;
            syncDiffData.css.push({ mode, match: cMatch, src: tgtCss, tgt: srcCss });
            if (!cMatch) cssDiffs++;

            // === Canvas ===
            const srcCanvas = (sourceData.canvasScript || '').trim();
            const tgtCanvas = (targetData.canvasScript || '').trim();
            const srcCanvasEnabled = !!sourceData.canvasEnabled;
            const tgtCanvasEnabled = !!targetData.canvasEnabled;
            const cvMatch = srcCanvas === tgtCanvas && srcCanvasEnabled === tgtCanvasEnabled;
            syncDiffData.canvas.push({ mode, match: cvMatch, src: tgtCanvas, tgt: srcCanvas });
            if (!cvMatch) canvasDiffs++;

            // === Gradient ===
            const gMatch = compareGradientProps(sourceData, targetData);
            syncDiffData.gradient.push({
                mode, match: gMatch,
                src: { stops: targetData.gradientStops || [], type: targetData.gradientType || 'linear', angle: targetData.gradientAngle ?? 135, intensity: targetData.gradientIntensity ?? 85, anim: !!targetData.gradientAnimation, radialPosX: targetData.gradientRadialPosX ?? 50, radialPosY: targetData.gradientRadialPosY ?? 50, radialShape: targetData.gradientRadialShape || 'ellipse', radialSize: targetData.gradientRadialSize || 'farthest-corner', meshPoints: targetData.gradientMeshPoints || [], meshBgColor: targetData.gradientMeshBgColor || '#0a0a12' },
                tgt: { stops: sourceData.gradientStops || [], type: sourceData.gradientType || 'linear', angle: sourceData.gradientAngle ?? 135, intensity: sourceData.gradientIntensity ?? 85, anim: !!sourceData.gradientAnimation, radialPosX: sourceData.gradientRadialPosX ?? 50, radialPosY: sourceData.gradientRadialPosY ?? 50, radialShape: sourceData.gradientRadialShape || 'ellipse', radialSize: sourceData.gradientRadialSize || 'farthest-corner', meshPoints: sourceData.gradientMeshPoints || [], meshBgColor: sourceData.gradientMeshBgColor || '#0a0a12' }
            });
            if (!gMatch) gradientDiffs++;

            // === Auth ===
            const incomingAuth = [sourceData.themeShowAuth, sourceData.customCssShowAuth, sourceData.canvasShowAuth, sourceData.gradientShowAuth].map(v => v !== false);
            const currentAuth = [targetData.themeShowAuth, targetData.customCssShowAuth, targetData.canvasShowAuth, targetData.gradientShowAuth].map(v => v !== false);
            const aMatch = incomingAuth.every((v, i) => v === currentAuth[i]);
            syncDiffData.auth.push({ mode, match: aMatch, srcAuth: currentAuth, tgtAuth: incomingAuth });
            if (!aMatch) authDiffs++;
        }

        setSyncBadge(badges.palette, paletteDiffs === 0, paletteDiffs);
        setSyncBadge(badges.overrides, overridesDiffs === 0, overridesDiffs);
        setSyncBadge(badges.css, cssDiffs === 0, cssDiffs);
        setSyncBadge(badges.canvas, canvasDiffs === 0, canvasDiffs);
        setSyncBadge(badges.gradient, gradientDiffs === 0, gradientDiffs);
        setSyncBadge(badges.auth, authDiffs === 0, authDiffs);

        // Re-render any currently expanded diff panels
        ['palette','overrides','css','canvas','gradient','auth'].forEach(k => {
            const panel = $(`sync-diff-${k}`);
            if (panel && panel.style.display !== 'none') renderSyncDiffPanel(k);
        });
    }

    // === Diff Panel Accordion ===
    function collapseAllSyncDiffs() {
        ['palette','overrides','css','canvas','gradient','auth'].forEach(k => {
            const panel = $(`sync-diff-${k}`);
            if (panel) panel.style.display = 'none';
            const chevron = document.querySelector(`.sync-diff-chevron[data-setting="${k}"]`);
            if (chevron) chevron.classList.remove('expanded');
        });
    }

    function toggleSyncDiff(settingKey) {
        const panel = $(`sync-diff-${settingKey}`);
        const chevron = document.querySelector(`.sync-diff-chevron[data-setting="${settingKey}"]`);
        if (!panel) return;
        const isOpen = panel.style.display !== 'none';
        collapseAllSyncDiffs();
        if (!isOpen) {
            renderSyncDiffPanel(settingKey);
            panel.style.display = 'block';
            panel.setAttribute('data-animating', '');
            setTimeout(() => panel.removeAttribute('data-animating'), 260);
            if (chevron) chevron.classList.add('expanded');
        }
    }

    // === Diff Panel Renderers ===
    function _modeLabel(m) { return { dark: 'Dark', oled: 'OLED', light: 'Light', her: 'Her' }[m] || m; }
    function _esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    function _rampSwatches(config) {
        // Generate 12 mini color swatches from OKLCH config
        const h = config.h, c = (config.c || 0) / 1000, l = (config.l || 0) / 100;
        const ov = config.overrides || {};
        const deltaL = l - 0.20;
        return steps.map(step => {
            const baseL = lightnessMap[step];
            const targetL = Math.max(0.00, Math.min(0.98, baseL + deltaL));
            const computedVal = ov[`--color-gray-${step}`] || `oklch(${targetL.toFixed(3)} ${c.toFixed(3)} ${c === 0 ? 0 : h})`;
            return `<div class="swatch" style="background:${computedVal}"></div>`;
        }).join('');
    }

    function renderSyncDiffPanel(key) {
        _codeDiffIdCounter = 0;
        const panel = $(`sync-diff-${key}`);
        if (!panel) return;
        const data = syncDiffData[key] || [];
        if (data.length === 0) { panel.innerHTML = '<div style="opacity:0.5; font-size:0.55rem; padding:4px;">No targets selected</div>'; return; }

        // Use 2-column grid layout for overrides diffs
        const useGrid = key === 'overrides' && data.length >= 2;
        let html = useGrid ? '<div class="sync-diff-grid">' : '';
        for (const entry of data) {
            html += `<div class="sync-diff-mode-row">`;
            html += `<div class="sync-diff-mode-header"><span class="mode-dot ${entry.mode}"></span> ${_modeLabel(entry.mode)} `;
            if (entry.match) {
                html += `<span class="sync-diff-match-tag">✓ Match</span>`;
                html += `</div></div>`;
                continue;
            }
            html += `</div>`;

            // Dispatch to setting-specific renderer
            if (key === 'palette') html += _renderPaletteDiff(entry);
            else if (key === 'overrides') html += _renderOverridesDiff(entry);
            else if (key === 'css') html += _renderCssDiff(entry);
            else if (key === 'canvas') html += _renderCanvasDiff(entry);
            else if (key === 'gradient') html += _renderGradientDiff(entry);
            else if (key === 'auth') html += _renderAuthDiff(entry);

            html += `</div>`;
        }
        if (useGrid) html += '</div>';
        panel.innerHTML = html;
    }

    function _renderPaletteDiff(entry) {
        const s = entry.src, t = entry.tgt;
        const srcConf = { h: s.h, c: s.c, l: s.l, overrides: entry.srcOverrides || {} };
        const tgtConf = { h: t.h, c: t.c, l: t.l, overrides: entry.tgtOverrides || {} };
        let h = '';
        h += `<div class="sync-diff-ramp-row"><span class="sync-diff-ramp-label">From</span><div class="sync-diff-ramp">${_rampSwatches(srcConf)}</div></div>`;
        h += `<div class="sync-diff-ramp-row"><span class="sync-diff-ramp-label">To</span><div class="sync-diff-ramp">${_rampSwatches(tgtConf)}</div></div>`;
        // Delta values
        const fmt = (v) => v != null && !isNaN(v) ? Number(v).toFixed(1) : '—';
        const dH = (s.h != null && t.h != null) ? (t.h - s.h).toFixed(1) : null;
        const dC = (s.c != null && t.c != null) ? (t.c - s.c).toFixed(1) : null;
        const dL = (s.l != null && t.l != null) ? (t.l - s.l).toFixed(1) : null;
        h += `<div class="sync-diff-values">`;
        h += `<span>H: ${fmt(s.h)}→${fmt(t.h)}${dH && dH !== '0.0' ? ` <span class="delta">(Δ${dH > 0 ? '+':''}${dH})</span>` : ''}</span>`;
        h += `<span>C: ${fmt(s.c)}→${fmt(t.c)}${dC && dC !== '0.0' ? ` <span class="delta">(Δ${dC > 0 ? '+':''}${dC})</span>` : ''}</span>`;
        h += `<span>L: ${fmt(s.l)}→${fmt(t.l)}${dL && dL !== '0.0' ? ` <span class="delta">(Δ${dL > 0 ? '+':''}${dL})</span>` : ''}</span>`;
        h += `</div>`;
        return h;
    }

    function _renderOverridesDiff(entry) {
        const srcKeys = Object.keys(entry.src);
        const tgtKeys = Object.keys(entry.tgt);
        const allKeys = [...new Set([...srcKeys, ...tgtKeys])].sort();
        const diffKeys = allKeys.filter(k => entry.src[k] !== entry.tgt[k]);

        let h = `<table class="sync-diff-prop-table"><tr style="opacity:0.5;font-size:0.45rem;"><td>Variable</td><td>Source</td><td>Target</td></tr>`;
        const maxShow = 5;
        diffKeys.slice(0, maxShow).forEach(k => {
            const sv = entry.src[k] || '<span style="opacity:0.3;">—</span>';
            const tv = entry.tgt[k] || '<span style="opacity:0.3;">—</span>';
            h += `<tr><td class="prop-key">${_esc(k)}</td><td>${sv}</td><td>${tv}</td></tr>`;
        });
        h += `</table>`;
        if (diffKeys.length > maxShow) {
            h += `<div style="font-size:0.45rem; opacity:0.4; margin-left:0;">...+${diffKeys.length - maxShow} more</div>`;
        }
        h += `<div style="font-size:0.45rem; opacity:0.5; margin-left:0; margin-top:2px;">${diffKeys.length} of ${allKeys.length} variables differ</div>`;
        return h;
    }

    let _codeDiffIdCounter = 0;

    function _renderCssDiff(entry) {
        return _renderCodeDiffClickable(entry.src, entry.tgt, entry.mode, 'css');
    }

    function _renderCanvasDiff(entry) {
        let srcLabel = '', tgtLabel = '';
        if (typeof CANVAS_PRESETS !== 'undefined') {
            CANVAS_PRESETS.forEach(p => {
                if (p.script === entry.src) srcLabel = ` "${_esc(p.name)}"`;
                if (p.script === entry.tgt) tgtLabel = ` "${_esc(p.name)}"`;
            });
        }
        return _renderCodeDiffClickable(entry.src, entry.tgt, entry.mode, 'canvas', srcLabel, tgtLabel);
    }

    function _renderCodeDiffClickable(srcCode, tgtCode, mode, type, srcExtra, tgtExtra) {
        const id = `cdiff-${type}-${mode}-${_codeDiffIdCounter++}`;
        const srcLines = srcCode ? srcCode.split('\n') : [];
        const tgtLines = tgtCode ? tgtCode.split('\n') : [];
        const srcCount = srcLines.length;
        const tgtCount = tgtLines.length;
        const srcDesc = srcCode ? `${srcCount} lines${srcExtra || ''}` : '(empty)';
        const tgtDesc = tgtCode ? `${tgtCount} lines${tgtExtra || ''}` : '(empty)';

        let h = '';
        // Clickable summary row
        h += `<div class="sync-diff-code-summary" onclick="_toggleCodeDiffExpand('${id}')">`;
        h += `<span class="summary-label">${srcDesc} → ${tgtDesc}</span>`;
        h += `<span class="summary-action" id="${id}-action">▸ View Diff</span>`;
        h += `</div>`;

        // Build diff lines
        const srcSet = new Set(srcLines);
        const tgtSet = new Set(tgtLines);

        let srcHtml = '', tgtHtml = '';
        const maxLen = Math.max(srcCount, tgtCount);
        for (let i = 0; i < maxLen; i++) {
            const sl = i < srcCount ? srcLines[i] : null;
            const tl = i < tgtCount ? tgtLines[i] : null;
            if (sl !== null) {
                const cls = (sl === '' && i >= srcCount) ? 'empty-placeholder' : (!tgtSet.has(sl) ? 'removed' : (sl === (tgtLines[i] || null) ? 'unchanged' : 'removed'));
                srcHtml += `<div class="diff-line ${cls}">${_esc(sl) || '&nbsp;'}</div>`;
            } else {
                srcHtml += `<div class="diff-line empty-placeholder">&nbsp;</div>`;
            }
            if (tl !== null) {
                const cls = (tl === '' && i >= tgtCount) ? 'empty-placeholder' : (!srcSet.has(tl) ? 'added' : (tl === (srcLines[i] || null) ? 'unchanged' : 'added'));
                tgtHtml += `<div class="diff-line ${cls}">${_esc(tl) || '&nbsp;'}</div>`;
            } else {
                tgtHtml += `<div class="diff-line empty-placeholder">&nbsp;</div>`;
            }
        }

        // Expanded diff (hidden by default)
        h += `<div class="sync-diff-code-expanded" id="${id}" style="display:none;">`;
        h += `<div class="diff-header"><span>Current (${srcCount})</span><span>Incoming (${tgtCount})</span></div>`;
        h += `<div class="diff-body">`;
        h += `<div class="diff-col">${srcHtml || '<div class="diff-line empty-placeholder">(empty)</div>'}</div>`;
        h += `<div class="diff-col">${tgtHtml || '<div class="diff-line empty-placeholder">(empty)</div>'}</div>`;
        h += `</div></div>`;
        return h;
    }

    window._toggleCodeDiffExpand = function(id) {
        const el = document.getElementById(id);
        const action = document.getElementById(id + '-action');
        if (!el) return;
        const isOpen = el.style.display !== 'none';
        el.style.display = isOpen ? 'none' : 'block';
        if (action) action.textContent = isOpen ? '▸ View Diff' : '▾ Hide Diff';
    };

    function _renderGradientDiff(entry) {
        const s = entry.src, t = entry.tgt;
        let h = '';
        // Gradient preview bars
        const makeGradientCSS = (data) => {
            if (data.type === 'mesh' && data.meshPoints && data.meshPoints.length >= 2) {
                const layers = data.meshPoints.map(p => `radial-gradient(at ${p.x}% ${p.y}%, ${p.color} 0%, transparent ${p.spread}%)`).join(', ');
                return `${data.meshBgColor || '#0a0a12'}; background-image: ${layers}`;
            }
            if (!data.stops || data.stops.length === 0) return 'transparent';
            const stopStr = data.stops.map(st => `${st.color} ${st.position}%`).join(', ');
            if (data.type === 'radial') {
                const rShape = data.radialShape || 'ellipse';
                const rSize = data.radialSize || 'farthest-corner';
                const rPosX = data.radialPosX ?? 50;
                const rPosY = data.radialPosY ?? 50;
                return `radial-gradient(${rShape} ${rSize} at ${rPosX}% ${rPosY}%, ${stopStr})`;
            }
            if (data.type === 'conic') return `conic-gradient(from ${data.angle}deg, ${stopStr})`;
            return `linear-gradient(${data.angle}deg, ${stopStr})`;
        };
        h += `<div style="margin-left:0;">`;
        h += `<div style="font-size:0.45rem; opacity:0.4; margin-bottom:2px;">Source</div>`;
        h += `<div class="sync-diff-gradient-bar" style="background:${makeGradientCSS(s)};"></div>`;
        h += `<div style="font-size:0.45rem; opacity:0.4; margin-bottom:2px; margin-top:4px;">Target</div>`;
        h += `<div class="sync-diff-gradient-bar" style="background:${makeGradientCSS(t)};"></div>`;
        h += `</div>`;
        // Property table
        const props = [
            ['Type', s.type, t.type],
            ['Angle', s.angle + '°', t.angle + '°'],
            ['Stops', s.stops.length, t.stops.length],
            ['Animated', s.anim ? 'Yes' : 'No', t.anim ? 'Yes' : 'No']
        ];
        h += `<table class="sync-diff-prop-table">`;
        props.forEach(([key, sv, tv]) => {
            const match = String(sv) === String(tv);
            h += `<tr><td class="prop-key">${key}</td><td>${sv}</td><td>→ ${tv}</td><td class="${match ? 'prop-match' : 'prop-diff'}">${match ? '✓' : '⚠'}</td></tr>`;
        });
        h += `</table>`;
        return h;
    }

    function _renderAuthDiff(entry) {
        const labels = ['Theme on Auth', 'CSS on Auth', 'Canvas on Auth', 'Gradient on Auth'];
        let h = `<table class="sync-diff-prop-table">`;
        labels.forEach((label, i) => {
            const sv = entry.srcAuth[i];
            const tv = entry.tgtAuth[i];
            const match = sv === tv;
            h += `<tr><td class="prop-key">${label}</td><td>${sv ? '✓ ON' : '✗ OFF'}</td><td>→ ${tv ? '✓ ON' : '✗ OFF'}</td><td class="${match ? 'prop-match' : 'prop-diff'}">${match ? '✓' : '⚠'}</td></tr>`;
        });
        h += `</table>`;
        return h;
    }

    function showSyncModal(sourceType, sourceId) {
        syncSourceType = sourceType;
        syncSourceId = sourceId;

        const names = { dark: 'Dark', oled: 'OLED', light: 'Light', her: 'Her', system: 'System' };
        const dm = getActiveDataMode();
        
        let titleText = "Selective Sync";
        let descText = "";
        let confirmText = "Sync Selected";
        let cancelText = "Do Not Sync";

        if (sourceType === 'active-mode') {
            const sourceName = activeMode === 'system' ? `System (${names[dm]})` : names[dm];
            descText = `Choose what to copy from <b>${sourceName}</b>.`;
            cancelText = "Do Not Sync";
        } else if (sourceType === 'curated-preset') {
            titleText = "Apply Curated Preset";
            descText = `Choose where and what to apply from preset <b>${sourceId.charAt(0).toUpperCase() + sourceId.slice(1)}</b>.`;
            confirmText = "Apply Preset";
            cancelText = "Do Not Apply";
        } else if (sourceType === 'snapshot') {
            const snapshots = getSnapshots();
            const name = snapshots[sourceId]?.name || `Theme ${sourceId}`;
            titleText = "Apply Library Theme";
            descText = `Choose where and what to apply from <b>${name}</b>.`;
            confirmText = "Apply Theme";
            cancelText = "Do Not Apply";
        }

        $('sync-modal-title').innerText = titleText;
        $('sync-source-description').innerHTML = descText;
        $('confirm-sync-btn').innerText = confirmText;
        $('sync-cancel-btn').innerText = cancelText;

        // Populate targets
        const container = $('sync-target-container');
        container.innerHTML = '';
        MODES.forEach(m => {
            const isSource = (sourceType === 'active-mode' && m === dm);
            const isChecked = !isSource;

            const pill = document.createElement('div');
            pill.className = `sync-mode-pill ${isSource ? 'disabled' : ''} ${isChecked ? 'active' : ''}`;
            pill.setAttribute('role', 'checkbox');
            pill.setAttribute('aria-checked', String(isChecked));
            pill.setAttribute('aria-label', names[m]);
            if (!isSource) pill.setAttribute('tabindex', '0');
            pill.innerHTML = `
                <input type="checkbox" id="sync-target-${m}" ${isSource ? 'disabled' : ''} ${isChecked ? 'checked' : ''} style="display:none">
                <span>${names[m]}</span>
                <div class="selected-check">✓</div>
            `;
            if (!isSource) {
                const toggle = () => {
                    const cb = pill.querySelector('input');
                    cb.checked = !cb.checked;
                    pill.classList.toggle('active', cb.checked);
                    pill.setAttribute('aria-checked', String(cb.checked));
                    updateTargetsHeaderToggleState();
                    updateSyncDeltaBadges();
                };
                pill.onclick = toggle;
                pill.addEventListener('keydown', (e) => {
                    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
                });
            }
            container.appendChild(pill);
        });

        // Default all sync settings to checked
        ['palette', 'overrides', 'css', 'canvas', 'gradient', 'auth'].forEach(opt => {
            const cb = $(`sync-opt-${opt}`);
            if (cb) cb.checked = true;
        });

        const toggleTargets = $('sync-toggle-targets');
        if (toggleTargets) toggleTargets.innerText = 'Deselect All';
        const toggleOptions = $('sync-toggle-options');
        if (toggleOptions) toggleOptions.innerText = 'Deselect All';

        collapseAllSyncDiffs();
        updateSyncDeltaBadges();
        showModal('sync-modal');
    }

    $('sync-mode-btn').addEventListener('click', () => {
        showSyncModal('active-mode', null);
    });

    $('confirm-sync-btn').onclick = () => {
        const syncPalette = $('sync-opt-palette').checked;
        const syncOverrides = $('sync-opt-overrides').checked;
        const syncCss = $('sync-opt-css').checked;
        const syncCanvas = $('sync-opt-canvas').checked;
        const syncGradient = $('sync-opt-gradient')?.checked;
        const syncAuth = $('sync-opt-auth').checked;

        const targetModes = MODES.filter(m => {
            const cb = $(`sync-target-${m}`);
            return cb && cb.checked && !cb.disabled;
        });

        if (targetModes.length === 0) {
            showToast("No target modes selected!");
            return;
        }

        if (!syncPalette && !syncOverrides && !syncCss && !syncCanvas && !syncGradient && !syncAuth) {
            showToast("Nothing selected to sync/apply!");
            return;
        }

        hideModal('sync-modal');
        collapseAllSyncDiffs();

    function applySyncToMode(mode, sourceData, opts) {
        if (opts.syncPalette) {
            themeData[mode].h = sourceData.h;
            themeData[mode].c = sourceData.c;
            themeData[mode].l = opts.adjustL ? opts.adjustL(mode, sourceData.l) : sourceData.l;
        }
        if (opts.syncOverrides) {
            themeData[mode].overrides = structuredClone(sourceData.overrides || {});
            if (opts.rebuildLocks) {
                themeData[mode].locks = {};
                Object.keys(themeData[mode].overrides).forEach(k => themeData[mode].locks[k] = true);
            } else {
                themeData[mode].locks = structuredClone(sourceData.locks || {});
            }
            // Also sync manual CSS variable overrides
            themeData[mode].manualOverrides = sourceData.manualOverrides || '';
            themeData[mode].manualOverridesEnabled = !!sourceData.manualOverridesEnabled;
        }
        if (opts.syncCss) {
            themeData[mode].customCSS = sourceData.customCSS || '';
            themeData[mode].customCssEnabled = !!sourceData.customCssEnabled;
            themeData[mode].autoScope = sourceData.autoScope !== false;
            activeCssRef[mode] = opts.cssRef !== undefined ? opts.cssRef : null;
            if (themeData[mode].customCssEnabled && themeData[mode].customCSS) {
                CSS_PRESETS.forEach((cs, ci) => {
                    if (cs.code === themeData[mode].customCSS) activeCssRef[mode] = ci;
                });
            }
        }
        if (opts.syncCanvas) {
            themeData[mode].canvasEnabled = !!sourceData.canvasEnabled;
            themeData[mode].canvasScript = sourceData.canvasScript || '';
            activeCanvasRef[mode] = opts.canvasRef !== undefined ? opts.canvasRef : null;
            if (themeData[mode].canvasEnabled && themeData[mode].canvasScript) {
                CANVAS_PRESETS.forEach((cp, ci) => {
                    if (cp.script === themeData[mode].canvasScript) activeCanvasRef[mode] = ci;
                });
            }
        }
        if (opts.syncGradient) {
            copyGradientProps(themeData[mode], sourceData);
            // Update gradient ref — try to match against built-in presets
            activeGradientRef[mode] = opts.gradientRef !== undefined ? opts.gradientRef : null;
        }
        if (opts.syncAuth) copyAuthProps(themeData[mode], sourceData);
    }

        if (syncSourceType === 'active-mode') {
            const dm = getActiveDataMode();
            const srcRef = activeThemeRef[dm];

            targetModes.forEach(mode => {
                let sourceData = themeData[dm];
                let usePerModeSource = false;
                const tgtRef = activeThemeRef[mode];

                if (srcRef && tgtRef && srcRef.type === tgtRef.type && srcRef.id === tgtRef.id) {
                    if (srcRef.type === 'snapshot') {
                        const snapshots = getSnapshots();
                        const s = snapshots[srcRef.id];
                        if (s && s[mode]) { sourceData = s[mode]; usePerModeSource = true; }
                    } else if (srcRef.type === 'preset') {
                        const presetData = CURATED_PRESETS[srcRef.id];
                        if (presetData) { sourceData = buildCuratedSourceData(presetData, mode); usePerModeSource = true; }
                    }
                }

                applySyncToMode(mode, sourceData, {
                    syncPalette, syncOverrides, syncCss, syncCanvas, syncGradient, syncAuth,
                    rebuildLocks: usePerModeSource,
                    cssRef: usePerModeSource ? undefined : activeCssRef[dm],
                    canvasRef: usePerModeSource ? undefined : activeCanvasRef[dm],
                    gradientRef: usePerModeSource ? undefined : activeGradientRef[dm],
                });
                if (syncPalette && syncOverrides && syncCss && syncCanvas) {
                    activeThemeRef[mode] = activeThemeRef[dm] ? { ...activeThemeRef[dm] } : null;
                }
            });
            showToast("Theme synced successfully!");
        } else if (syncSourceType === 'curated-preset') {
            const presetData = CURATED_PRESETS[syncSourceId];
            if (!presetData) return;

            targetModes.forEach(mode => {
                const sourceData = buildCuratedSourceData(presetData, mode);
                applySyncToMode(mode, sourceData, {
                    syncPalette, syncOverrides, syncCss, syncCanvas, syncGradient, syncAuth,
                    rebuildLocks: true,
                });
                if (syncPalette) activeThemeRef[mode] = { type: 'preset', id: syncSourceId };
            });
            showToast(`Preset "${syncSourceId}" applied!`);
        } else if (syncSourceType === 'snapshot') {
            const snapshots = getSnapshots();
            const s = snapshots[syncSourceId];
            if (!s) return;

            targetModes.forEach(mode => {
                let sourceModeData = s[mode];
                if (!sourceModeData) {
                    if (mode === 'oled' && s.dark) { sourceModeData = structuredClone(s.dark); sourceModeData.l = 0; }
                    else if (mode === 'her' && s.light) { sourceModeData = structuredClone(s.light); }
                    else { sourceModeData = structuredClone(s.dark || s.light); }
                }
                applySyncToMode(mode, sourceModeData, {
                    syncPalette, syncOverrides, syncCss, syncCanvas, syncGradient, syncAuth,
                    rebuildLocks: true,
                });
                if (syncPalette) activeThemeRef[mode] = { type: 'snapshot', id: syncSourceId };
            });
            showToast(`Theme "${s.name}" applied!`);
        }

        commitChange({ clearRef: false });
    };

    $('undo-btn').onclick = () => undo();
    $('redo-btn').onclick = () => redo();

    window.addEventListener('keydown', (e) => {
        // Modal configs: [modalId, confirmButtonId, allowBackspaceCancel]
        const modalConfigs = [
            ['delete-modal', 'confirm-delete-btn', true],
            ['overwrite-modal', 'confirm-overwrite-btn', true],
            ['save-modal', 'confirm-save-btn', false],
            ['rename-modal', 'confirm-rename-btn', false],
            ['nuclear-modal', 'confirm-nuclear-btn', true],
            ['factory-reset-modal', 'confirm-factory-reset-btn', true],
            ['save-canvas-modal', 'confirm-save-canvas-btn', false],
            ['delete-canvas-modal', 'confirm-delete-canvas-btn', true],
            ['rename-canvas-modal', 'confirm-rename-canvas-btn', false],
            ['save-css-modal', 'confirm-save-css-btn', false],
            ['delete-css-modal', 'confirm-delete-css-btn', true],
            ['rename-css-modal', 'confirm-rename-css-btn', false],
            ['delete-all-themes-modal', 'confirm-delete-all-themes-btn', true],
            ['delete-all-canvas-modal', 'confirm-delete-all-canvas-btn', true],
            ['delete-all-css-modal', 'confirm-delete-all-css-btn', true],
            ['reset-all-confirm-modal', 'confirm-reset-all-confirm-btn', true],
            ['sync-modal', 'confirm-sync-btn', true],
            ['reset-modal', 'confirm-reset-btn', true],
            ['import-clipboard-modal', 'confirm-clipboard-import-btn', true],
            ['json-view-modal', null, true],
            ['update-modal', 'update-confirm-btn', true],
            ['update-results-modal', null, true],
            ['export-all-backups-modal', 'confirm-export-all-backups-btn', true],
            ['save-gradient-modal', 'confirm-save-gradient-btn', false],
            ['delete-gradient-modal', 'confirm-delete-gradient-btn', true],
            ['rename-gradient-modal', 'confirm-rename-gradient-btn', false],
            ['delete-all-gradient-modal', 'confirm-delete-all-gradient-btn', true],
            ['import-gradient-modal', null, true]
        ];

        for (const [modalId, confirmBtnId, allowBackspace] of modalConfigs) {
            const modal = $(modalId);
            if (modal && modal.style.display === 'flex') {
                if (e.key === 'Enter') { 
                    e.preventDefault(); 
                    const btn = $(confirmBtnId);
                    if (btn) btn.click(); 
                    return; 
                }
                if (e.key === 'Escape' || (e.key === 'Backspace' && allowBackspace)) {
                    e.preventDefault(); 
                    modal.style.display = 'none'; 
                    return;
                }
            }
        }

        // Undo/Redo Shortcuts — skip when user is typing in a text field
        const activeEl = document.activeElement;
        const isEditing = activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT');
        if ((e.ctrlKey || e.metaKey) && !isEditing) {
            if (e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo();
            } else if (e.key === 'z' && e.shiftKey) {
                e.preventDefault();
                redo();
            } else if (e.key === 'y') {
                e.preventDefault();
                redo();
            }
        }
    });

    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); t.setAttribute('tabindex', '-1'); });
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
            tab.setAttribute('tabindex', '0');
            document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
            document.getElementById('tab-' + tab.dataset.tab).style.display = 'block';
            sessionStorage.setItem('owui_theme_tool_tab', tab.dataset.tab);
            
            // Contextual UI Visibility
            const isDocs = tab.dataset.tab === 'docs';
            ['reset-mode-btn', 'sync-mode-btn'].forEach(id => {
                if ($(id)) $(id).style.display = isDocs ? 'none' : 'flex';
            });

            // Flush stale CSS Output if switching to the code tab
            if (tab.dataset.tab === 'code' && _codeViewStale) updateCodeView();
        });
    });

    // Horizontal wheel scroll for tabs
    const tabsBar = document.querySelector('.tabs');
    if (tabsBar) {
        tabsBar.addEventListener('wheel', (e) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                tabsBar.scrollLeft += e.deltaY;
            }
        }, { passive: false });
    }

    // Horizontal wheel scroll for curated presets gallery
    const curatedScroll = document.querySelector('.curated-scroll-container');
    if (curatedScroll) {
        curatedScroll.addEventListener('wheel', (e) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                curatedScroll.scrollLeft += e.deltaY;
            }
        }, { passive: false });
    }

    document.querySelectorAll('.copy-css-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            const txt = document.getElementById(targetId).value;
            navigator.clipboard.writeText(txt).then(() => {
                const originalText = btn.innerText;
                btn.innerText = 'Copied';
                btn.style.color = 'var(--accent)';
                setTimeout(() => {
                    btn.innerText = originalText;
                    btn.style.color = '';
                }, 2000);
            });
        });
    });

    const downloadCssBtn = document.getElementById('download-css-btn');
    const downloadTailwindBtn = document.getElementById('download-tailwind-btn');

    function getDownloadName() {
        const dm = getActiveDataMode();
        let activeName = "custom-theme";
        if (activeThemeRef[dm] && activeThemeRef[dm].type === 'snapshot') {
            const snapshots = getSnapshots();
            if (snapshots[activeThemeRef[dm].id]) {
                activeName = snapshots[activeThemeRef[dm].id].name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            }
        } else if (activeThemeRef[dm] && activeThemeRef[dm].type === 'preset') {
            activeName = activeThemeRef[dm].id;
        }
        return activeName;
    }

    if (downloadCssBtn) {
        downloadCssBtn.addEventListener('click', () => {
            const content = document.getElementById('raw-css').value;
            const blob = new Blob([content], { type: 'text/css' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `owui-${getDownloadName()}-raw.css`;
            a.click();
            URL.revokeObjectURL(url);
            showToast("Raw CSS downloaded!");
        });
    }

    if (downloadTailwindBtn) {
        downloadTailwindBtn.addEventListener('click', () => {
            const content = document.getElementById('tailwind-css').value;
            const blob = new Blob([content], { type: 'text/css' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `owui-${getDownloadName()}-tailwind.css`;
            a.click();
            URL.revokeObjectURL(url);
            showToast("Tailwind CSS Block downloaded!");
        });
    }

    let renameIndex = null;
    window.requestRename = (index) => {
        const snapshots = getSnapshots();
        renameIndex = index;
        const snap = snapshots[index];
        const input = document.getElementById('rename-input');
        input.value = snap.name;
        // Populate all metadata fields
        const f = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
        f('rename-desc-input', snap.description);
        f('rename-author-input', snap.author);
        f('rename-version-input', snap.version);
        f('rename-target-input', snap.targetVersion);
        f('rename-repo-input', snap.repositoryUrl);
        f('rename-update-input', snap.updateUrl);
        showModal('rename-modal');
        setTimeout(() => input.focus(), 100);
    };

    document.getElementById('confirm-rename-btn').addEventListener('click', () => {
        const newName = document.getElementById('rename-input').value.trim();
        if (newName && renameIndex !== null) {
            const snapshots = getSnapshots();
            snapshots[renameIndex].name = newName;
            // Save all metadata fields
            const g = (id) => (document.getElementById(id)?.value || '').trim();
            snapshots[renameIndex].description = g('rename-desc-input');
            snapshots[renameIndex].author = g('rename-author-input');
            snapshots[renameIndex].version = g('rename-version-input') || '1.0.0';
            snapshots[renameIndex].targetVersion = g('rename-target-input');
            snapshots[renameIndex].repositoryUrl = g('rename-repo-input');
            snapshots[renameIndex].updateUrl = g('rename-update-input');
            saveSnapshots(snapshots);
            renderSnapshots();
            showToast('Theme Updated!');
        }
        hideModal('rename-modal');
    });

    document.getElementById('save-snapshot-btn').addEventListener('click', () => saveSnapshot());

    document.getElementById('random-btn').addEventListener('click', () => {
        const dm = getActiveDataMode();
        const rh = Math.floor(Math.random() * 360);
        const rc = 5 + Math.random() * 55;
        const rl = dm === 'oled' ? 0 : 10 + Math.random() * 30;
        applyBaseColorsToMode(activeMode, rh, rc, rl);
        commitChange();
    });

    function processImageForPalette(file) {
        if (!file) return;
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            // Scale down large images for performance
            const maxDim = 150;
            const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            canvas.width = Math.round(img.width * scale) || 1;
            canvas.height = Math.round(img.height * scale) || 1;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

            // Dominant color extraction via hue histogram with saturation weighting
            const bucketCount = 36; // 10° per bucket
            const buckets = Array.from({length: bucketCount}, () => ({ weight: 0, sinSum: 0, cosSum: 0, satSum: 0, count: 0 }));

            for (let i = 0; i < data.length; i += 4) {
                const r = data[i], g = data[i+1], b = data[i+2];
                const cMax = Math.max(r, g, b), cMin = Math.min(r, g, b);
                const delta = cMax - cMin;
                const lightness = (cMax + cMin) / 510;
                // Skip near-black, near-white, and desaturated pixels
                if (lightness < 0.08 || lightness > 0.92 || delta < 25) continue;

                const sat = delta / 255;
                let h = 0;
                if (delta !== 0) {
                    if (cMax === r) h = ((g - b) / delta) % 6;
                    else if (cMax === g) h = (b - r) / delta + 2;
                    else h = (r - g) / delta + 4;
                }
                h = h * 60; if (h < 0) h += 360;

                const rad = h * Math.PI / 180;
                const idx = Math.min(Math.floor(h / 10), bucketCount - 1);
                buckets[idx].weight += sat;
                buckets[idx].sinSum += Math.sin(rad) * sat;
                buckets[idx].cosSum += Math.cos(rad) * sat;
                buckets[idx].satSum += sat;
                buckets[idx].count++;
            }

            // Find the dominant hue bucket
            let bestIdx = 0, bestWeight = 0;
            for (let i = 0; i < bucketCount; i++) {
                if (buckets[i].weight > bestWeight) { bestWeight = buckets[i].weight; bestIdx = i; }
            }

            const best = buckets[bestIdx];
            if (best.count === 0) {
                showToast('No dominant color found \u2014 image may be too desaturated.');
                return;
            }

            // Circular mean for accurate hue averaging across the bucket
            let h = Math.round(Math.atan2(best.sinSum, best.cosSum) * 180 / Math.PI);
            if (h < 0) h += 360;
            const chromaNorm = Math.min(100, Math.round((best.satSum / best.count) * 80));
            const dm = getActiveDataMode();
            const targetL = dm === 'oled' ? 0 : 20;

            applyBaseColorsToMode(activeMode, h, chromaNorm, targetL);
            commitChange();
            showToast(`Palette Extracted! (Hue ${h}°)`);
        };
        img.src = URL.createObjectURL(file);
    }

    document.getElementById('extract-btn').addEventListener('click', () => document.getElementById('image-input').click());

    // Color Variables tab: wire duplicate Randomize/Extract buttons
    const randomBtnVars = document.getElementById('random-btn-vars');
    if (randomBtnVars) randomBtnVars.addEventListener('click', () => document.getElementById('random-btn').click());
    const extractBtnVars = document.getElementById('extract-btn-vars');
    if (extractBtnVars) extractBtnVars.addEventListener('click', () => document.getElementById('image-input').click());
    
    document.getElementById('image-input').addEventListener('change', (e) => {
        processImageForPalette(e.target.files[0]);
    });
    
    // Smart Paste Listener (Images OR JSON)
    let pendingClipboardData = null;
    window.addEventListener('paste', async (e) => {
        const items = e.clipboardData.items;
        let handled = false;
        
        for (let index in items) {
            const item = items[index];
            if (item.kind === 'file' && item.type.indexOf('image/') !== -1) {
                processImageForPalette(item.getAsFile());
                handled = true;
                break;
            }
        }
        
        if (!handled) {
            const text = e.clipboardData.getData('text');
            if (text) {
                try {
                    const parsed = JSON.parse(text);
                    if (parsed && (parsed.h !== undefined || parsed.dark || parsed.themes || parsed.canvas_presets || parsed.css_presets)) {
                        
                        // Check for duplicates before showing the import modal
                        const existingSnaps = getSnapshots();
                        let allDuplicates = false;
                        if (parsed.isLibraryBackup && Array.isArray(parsed.themes)) {
                            allDuplicates = parsed.themes.length > 0 && parsed.themes.every(t => isThemeDuplicate(t, existingSnaps));
                        } else if (parsed.dark && parsed.light && !parsed.canvas_presets && !parsed.css_presets) {
                            allDuplicates = isThemeDuplicate(parsed, existingSnaps);
                        } else if (parsed.h !== undefined) {
                            const legacyTheme = { name: 'clipboard', dark: { h: parsed.h, c: parsed.c, l: parsed.l, overrides: parsed.overrides || {} }, light: { h: parsed.h, c: parsed.c, l: parsed.l, overrides: {} }, oled: { h: parsed.h, c: parsed.c, l: 0, overrides: parsed.overrides || {} }, her: { h: parsed.h, c: parsed.c, l: parsed.l, overrides: {} } };
                            allDuplicates = isThemeDuplicate(legacyTheme, existingSnaps);
                        }
                        if (allDuplicates) {
                            showToast('Theme already exists in your library.');
                            return;
                        }

                        pendingClipboardData = text;
                        
                        // Detect Canvas FX for Security Warning
                        let hasCanvas = false;
                        if (parsed.themes) {
                            hasCanvas = parsed.themes.some(t => 
                                (t.dark?.canvasScript && t.dark?.canvasEnabled) || 
                                (t.light?.canvasScript && t.light?.canvasEnabled) ||
                                (t.oled?.canvasScript && t.oled?.canvasEnabled) ||
                                (t.her?.canvasScript && t.her?.canvasEnabled)
                            );
                        } else if (parsed.dark || parsed.light || parsed.oled || parsed.her) {
                            hasCanvas = (parsed.dark?.canvasScript && parsed.dark?.canvasEnabled) || 
                                        (parsed.light?.canvasScript && parsed.light?.canvasEnabled) ||
                                        (parsed.oled?.canvasScript && parsed.oled?.canvasEnabled) ||
                                        (parsed.her?.canvasScript && parsed.her?.canvasEnabled);
                        } else if (parsed.canvas_presets) {
                            hasCanvas = true;
                        } else if (parsed.h !== undefined) {
                             hasCanvas = parsed.canvasEnabled && parsed.canvasScript;
                        }

                        document.getElementById('canvas-warning').style.display = hasCanvas ? 'block' : 'none';
                        showModal('import-clipboard-modal');
                    }
                } catch(err) { console.warn('Theme Pro:', err); }
            }
        }
    });

    $('confirm-clipboard-import-btn').onclick = async () => {
        if (pendingClipboardData) {
            const file = new File([pendingClipboardData], "clipboard-import.json", { type: "application/json" });
            await handleFilesImport([file]);
            pendingClipboardData = null;
        }
        hideModal('import-clipboard-modal');
    };

    document.querySelectorAll('.preset-btn[data-preset]').forEach(b => b.addEventListener('click', () => {
        const pId = b.dataset.preset;
        showSyncModal('curated-preset', pId);
    }));

    // --- Mass Import/Export Portability ---
    document.getElementById('export-all-btn').onclick = () => {
        const snapshots = getSnapshots();
        if (snapshots.length === 0) return showToast("Error: Your library is empty!");
        const cleanedSnapshots = snapshots.map(s => {
            const clone = structuredClone(s);
            MODES.forEach(m => { if (clone[m]) delete clone[m].manualOverridesEnabled; });
            return clone;
        });
        const dateStr = new Date().toISOString().split('T')[0];
        downloadFile({ themes: cleanedSnapshots, isLibraryBackup: true, version: "{VERSION}" }, `owui-themes-backup-${dateStr}.json`);
    };

    const exportAllCanvasBtn = document.getElementById('export-all-canvas-btn');
    if (exportAllCanvasBtn) {
        exportAllCanvasBtn.onclick = () => {
            if (CANVAS_PRESETS.length === 0) return showToast("Error: No canvas presets to export!");
            const dateStr = new Date().toISOString().split('T')[0];
            downloadFile({ canvas_presets: CANVAS_PRESETS, isCanvasBackup: true, version: "{VERSION}" }, `owui-canvas-backup-${dateStr}.json`);
        };
    }

    const exportAllCssBtn = document.getElementById('export-all-css-btn');
    if (exportAllCssBtn) {
        exportAllCssBtn.onclick = () => {
            if (CSS_PRESETS.length === 0) return showToast("Error: No CSS presets to export!");
            const dateStr = new Date().toISOString().split('T')[0];
            downloadFile({ css_presets: CSS_PRESETS, isCssBackup: true, version: "{VERSION}" }, `owui-css-backup-${dateStr}.json`);
        };
    }

    const exportAllBackupsBtn = document.getElementById('export-all-backups-btn');
    if (exportAllBackupsBtn) {
        exportAllBackupsBtn.onclick = () => {
            // Populate dynamic item counts
            const descEl = $('export-all-backups-desc');
            if (descEl) {
                const tCount = getSnapshots().length;
                const cCount = CSS_PRESETS.length;
                const vCount = CANVAS_PRESETS.length;
                const parts = [];
                if (tCount > 0) parts.push(`<b>${tCount}</b> theme${tCount !== 1 ? 's' : ''}`);
                if (cCount > 0) parts.push(`<b>${cCount}</b> CSS snippet${cCount !== 1 ? 's' : ''}`);
                if (vCount > 0) parts.push(`<b>${vCount}</b> canvas preset${vCount !== 1 ? 's' : ''}`);
                const gCount = CUSTOM_GRADIENT_PRESETS.length;
                if (gCount > 0) parts.push(`<b>${gCount}</b> gradient preset${gCount !== 1 ? 's' : ''}`);
                if (parts.length > 0) {
                    descEl.innerHTML = `Download separate <b>.json</b> backup files for: ${parts.join(', ')}.`;
                } else {
                    descEl.innerHTML = `No data available to export yet. Save some themes, CSS snippets, or canvas presets first.`;
                }
            }
            showModal('export-all-backups-modal');
        };

        document.getElementById('confirm-export-all-backups-btn').onclick = () => {
            hideModal('export-all-backups-modal');
            const snapshots = getSnapshots();
            const dateStr = new Date().toISOString().split('T')[0];
            let exportedCount = 0;

            if (snapshots.length > 0) {
                downloadFile({ themes: snapshots, isLibraryBackup: true, version: "{VERSION}" }, `owui-themes-backup-${dateStr}.json`);
                exportedCount++;
            }
            if (CSS_PRESETS.length > 0) {
                downloadFile({ css_presets: CSS_PRESETS, isCssBackup: true, version: "{VERSION}" }, `owui-css-backup-${dateStr}.json`);
                exportedCount++;
            }
            if (CANVAS_PRESETS.length > 0) {
                downloadFile({ canvas_presets: CANVAS_PRESETS, isCanvasBackup: true, version: "{VERSION}" }, `owui-canvas-backup-${dateStr}.json`);
                exportedCount++;
            }
            if (CUSTOM_GRADIENT_PRESETS.length > 0) {
                downloadFile({ gradient_presets: CUSTOM_GRADIENT_PRESETS, isGradientBackup: true, version: "{VERSION}" }, `owui-gradient-presets-backup-${dateStr}.json`);
                exportedCount++;
            }

            if (exportedCount > 0) {
                showToast(`Exported ${exportedCount} library backup files successfully!`);
            } else {
                showToast("Error: No data available to export.");
            }
        };
    }

    // --- JSON Modal Factory ---
    function setupJsonModal({ modalId, textareaId, collapseId, closeBtnId, openBtnId, onOpen, onCollapse }) {
        const modal = $(modalId), textarea = $(textareaId);
        const collapseBtn = $(collapseId), closeBtn = $(closeBtnId), openBtn = $(openBtnId);
        let collapsed = false;

        if (openBtn) openBtn.addEventListener('click', () => {
            collapsed = false;
            if (collapseBtn) collapseBtn.innerText = 'Collapse';
            onOpen(textarea, false);
            updateLineNumbers(textarea);
            showModal(modalId);
        });

        if (closeBtn) closeBtn.addEventListener('click', () => hideModal(modalId));

        if (collapseBtn) collapseBtn.addEventListener('click', () => {
            const result = onCollapse(textarea, !collapsed);
            if (result === false) return; // validation failed
            collapsed = !collapsed;
            collapseBtn.innerText = collapsed ? 'Expand' : 'Collapse';
            updateLineNumbers(textarea);
        });

        return { modal, textarea };
    }

    // Normalize an entire snapshot object to ensure all mode fields have defaults
    function normalizeSnapshot(snap) {
        const normalized = {
            name: snap.name || '',
            description: snap.description || '',
            author: snap.author || '',
            version: snap.version || '1.0.0',
            targetVersion: snap.targetVersion || '',
            repositoryUrl: snap.repositoryUrl || '',
            updateUrl: snap.updateUrl || ''
        };
        MODES.forEach(mode => {
            if (snap[mode]) {
                normalized[mode] = normalizeModeData(structuredClone(snap[mode]), { forExport: true });
            }
        });
        return normalized;
    }

    function buildThemeJson(collapsed) {
        // Pull metadata from the active snapshot if one is loaded
        const dm = getActiveDataMode();
        const ref = activeThemeRef[dm];
        let meta = { name: '', description: '', author: '', version: '1.0.0', targetVersion: '', repositoryUrl: '', updateUrl: '' };
        if (ref && ref.type === 'snapshot') {
            const snaps = getSnapshots();
            const s = snaps[ref.id];
            if (s) {
                meta.name = s.name || '';
                meta.description = s.description || '';
                meta.author = s.author || '';
                meta.version = s.version || '1.0.0';
                meta.targetVersion = s.targetVersion || '';
                meta.repositoryUrl = s.repositoryUrl || '';
                meta.updateUrl = s.updateUrl || '';
            }
        }
        
        const snapshot = {
            name: meta.name,
            description: meta.description,
            author: meta.author,
            version: meta.version,
            targetVersion: meta.targetVersion,
            repositoryUrl: meta.repositoryUrl,
            updateUrl: meta.updateUrl
        };
        
        // Match export mode order: dark, light, oled, her
        MODES.forEach(mode => {
            snapshot[mode] = normalizeModeData(structuredClone(themeData[mode]), { forExport: true });
        });
        
        return JSON.stringify(snapshot, null, collapsed ? 0 : 2);
    }

    // JSON Viewer (read-only)
    setupJsonModal({
        modalId: 'json-view-modal', textareaId: 'json-view-textarea',
        collapseId: 'json-collapse-btn', closeBtnId: 'json-close-btn', openBtnId: 'json-view-btn',
        onOpen: (textarea) => { textarea.value = buildThemeJson(false); },
        onCollapse: (textarea, collapsed) => { textarea.value = buildThemeJson(collapsed); }
    });

    // === Snapshot JSON Manual Editor ===
    const snapshotJsonTextarea = $('snapshot-json-edit-textarea');
    const snapshotJsonValidBadge = $('snapshot-json-valid-badge');
    const snapshotJsonSaveBtn = $('snapshot-json-save-btn');
    const snapshotJsonDiscardBtn = $('snapshot-json-discard-btn');

    function validateSnapshotJson() {
        try {
            JSON.parse(snapshotJsonTextarea.value);
            snapshotJsonValidBadge.textContent = 'Valid JSON';
            snapshotJsonValidBadge.style.color = '#22c55e';
            snapshotJsonSaveBtn.disabled = false;
            snapshotJsonSaveBtn.style.opacity = '1';
            return true;
        } catch (e) {
            snapshotJsonValidBadge.textContent = '✗ Invalid JSON';
            snapshotJsonValidBadge.style.color = '#ef4444';
            snapshotJsonSaveBtn.disabled = true;
            snapshotJsonSaveBtn.style.opacity = '0.4';
            return false;
        }
    }

    setupJsonModal({
        modalId: 'snapshot-json-edit-modal', textareaId: 'snapshot-json-edit-textarea',
        collapseId: 'snapshot-json-collapse-btn', closeBtnId: 'snapshot-json-cancel-btn',
        openBtnId: 'snapshot-json-edit-btn',
        onOpen: (textarea) => {
            if (renameIndex === null) return;
            const snapshots = getSnapshots();
            const snap = snapshots[renameIndex];
            if (!snap) return;
            textarea.value = JSON.stringify(normalizeSnapshot(snap), null, 2);
            validateSnapshotJson();
        },
        onCollapse: (textarea, collapsed) => {
            if (!validateSnapshotJson()) return false;
            const parsed = JSON.parse(textarea.value);
            textarea.value = JSON.stringify(parsed, null, collapsed ? 0 : 2);
        }
    });

    if (snapshotJsonTextarea) {
        snapshotJsonTextarea.addEventListener('input', () => {
            validateSnapshotJson();
            updateLineNumbers(snapshotJsonTextarea);
        });
    }

    if (snapshotJsonDiscardBtn) snapshotJsonDiscardBtn.addEventListener('click', () => hideModal('snapshot-json-edit-modal'));

    if (snapshotJsonSaveBtn) {
        snapshotJsonSaveBtn.addEventListener('click', () => {
            if (!validateSnapshotJson() || renameIndex === null) return;
            const snapshots = getSnapshots();
            const edited = JSON.parse(snapshotJsonTextarea.value);
            snapshots[renameIndex] = edited;
            saveSnapshots(snapshots);
            // Update the rename modal fields to reflect any changes
            const g = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
            g('rename-input', edited.name);
            g('rename-desc-input', edited.description);
            g('rename-author-input', edited.author);
            g('rename-version-input', edited.version);
            g('rename-target-input', edited.targetVersion);
            g('rename-repo-input', edited.repositoryUrl);
            g('rename-update-input', edited.updateUrl);
            renderSnapshots();
            showToast('Snapshot updated from JSON!');
            hideModal('snapshot-json-edit-modal');
        });
    }

    // === Save (New Theme) JSON Manual Editor ===
    const saveJsonTextarea = $('save-json-edit-textarea');
    const saveJsonValidBadge = $('save-json-valid-badge');
    const saveJsonSaveBtn = $('save-json-save-btn');
    const saveJsonDiscardBtn = $('save-json-discard-btn');

    function validateSaveJson() {
        try {
            JSON.parse(saveJsonTextarea.value);
            saveJsonValidBadge.textContent = 'Valid JSON';
            saveJsonValidBadge.style.color = '#22c55e';
            saveJsonSaveBtn.disabled = false;
            saveJsonSaveBtn.style.opacity = '1';
            return true;
        } catch (e) {
            saveJsonValidBadge.textContent = '✗ Invalid JSON';
            saveJsonValidBadge.style.color = '#ef4444';
            saveJsonSaveBtn.disabled = true;
            saveJsonSaveBtn.style.opacity = '0.4';
            return false;
        }
    }

    function buildNewThemeJson(collapsed) {
        const metadata = {
            name: (document.getElementById('theme-name-input')?.value || '').trim(),
            description: (document.getElementById('theme-desc-input')?.value || '').trim(),
            author: (document.getElementById('theme-author-input')?.value || '').trim(),
            version: (document.getElementById('theme-version-input')?.value || '').trim() || '1.0.0',
            targetVersion: (document.getElementById('theme-target-input')?.value || '').trim(),
            repositoryUrl: (document.getElementById('theme-repo-input')?.value || '').trim(),
            updateUrl: (document.getElementById('theme-update-input')?.value || '').trim()
        };
        const snapshot = { ...metadata };
        MODES.forEach(mode => {
            snapshot[mode] = normalizeModeData(structuredClone(themeData[mode]), { forExport: true });
        });
        return JSON.stringify(snapshot, null, collapsed ? 0 : 2);
    }

    setupJsonModal({
        modalId: 'save-json-edit-modal', textareaId: 'save-json-edit-textarea',
        collapseId: 'save-json-collapse-btn', closeBtnId: 'save-json-cancel-btn',
        openBtnId: 'save-json-edit-btn',
        onOpen: (textarea) => {
            textarea.value = buildNewThemeJson(false);
            validateSaveJson();
        },
        onCollapse: (textarea, collapsed) => {
            if (!validateSaveJson()) return false;
            const parsed = JSON.parse(textarea.value);
            textarea.value = JSON.stringify(parsed, null, collapsed ? 0 : 2);
        }
    });

    if (saveJsonTextarea) {
        saveJsonTextarea.addEventListener('input', () => {
            validateSaveJson();
            updateLineNumbers(saveJsonTextarea);
        });
    }

    if (saveJsonDiscardBtn) saveJsonDiscardBtn.addEventListener('click', () => hideModal('save-json-edit-modal'));

    if (saveJsonSaveBtn) {
        saveJsonSaveBtn.addEventListener('click', () => {
            if (!validateSaveJson()) return;
            try {
                const newTheme = JSON.parse(saveJsonTextarea.value);
                if (!newTheme.name || !newTheme.name.trim()) {
                    showToast('Theme name is required');
                    return;
                }
                const snapshots = getSnapshots();
                snapshots.unshift(newTheme);
                saveSnapshots(snapshots);
                // Shift existing snapshot refs
                MODES.forEach(m => {
                    if (activeThemeRef[m] && activeThemeRef[m].type === 'snapshot') {
                        activeThemeRef[m].id++;
                    }
                });
                activeThemeRef[getActiveDataMode()] = { type: 'snapshot', id: 0 };
                // Update save modal fields to reflect the saved JSON
                const g = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
                g('theme-name-input', newTheme.name);
                g('theme-desc-input', newTheme.description);
                g('theme-author-input', newTheme.author);
                g('theme-version-input', newTheme.version);
                g('theme-target-input', newTheme.targetVersion);
                g('theme-repo-input', newTheme.repositoryUrl);
                g('theme-update-input', newTheme.updateUrl);
                // Persist metadata for next save
                Storage.set('metadata', {
                    description: newTheme.description || '',
                    author: newTheme.author || '',
                    version: newTheme.version || '1.0.0',
                    targetVersion: newTheme.targetVersion || '',
                    repositoryUrl: newTheme.repositoryUrl || '',
                    updateUrl: newTheme.updateUrl || ''
                });
                renderSnapshots();
                showToast('Theme saved from JSON!');
                hideModal('save-json-edit-modal');
                hideModal('save-modal');
            } catch(e) { console.warn('Theme Pro:', e); }
        });
    }

    // Universal click-outside-to-close for all modals
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });
    });

    // --- Mass Delete Factory ---
    function setupMassDelete({ triggerId, modalId, confirmId, emptyMsg, toastMsg, onConfirm, isEmpty }) {
        const triggerBtn = $(triggerId);
        if (triggerBtn) triggerBtn.onclick = () => {
            if (isEmpty()) return showToast(emptyMsg);
            showModal(modalId);
        };
        const confirmBtn = $(confirmId);
        if (confirmBtn) confirmBtn.onclick = () => {
            onConfirm();
            hideModal(modalId);
            showToast(toastMsg);
        };
    }

    setupMassDelete({
        triggerId: 'delete-all-themes-btn', modalId: 'delete-all-themes-modal',
        confirmId: 'confirm-delete-all-themes-btn',
        emptyMsg: 'No themes to delete', toastMsg: 'Theme Library Cleared!',
        isEmpty: () => getSnapshots().length === 0,
        onConfirm: () => {
            saveSnapshots([]);
            activeThemeRef = { dark: null, oled: null, light: null, her: null };
            renderSnapshots();
        }
    });

    setupMassDelete({
        triggerId: 'delete-all-canvas-btn', modalId: 'delete-all-canvas-modal',
        confirmId: 'confirm-delete-all-canvas-btn',
        emptyMsg: 'No presets to delete', toastMsg: 'Canvas Presets Cleared!',
        isEmpty: () => CANVAS_PRESETS.length === 0,
        onConfirm: () => {
            CANVAS_PRESETS.length = 0;
            Storage.set('canvas', CANVAS_PRESETS);
            syncLibrary();
            activeCanvasRef = { dark: null, oled: null, light: null, her: null };
            MODES.forEach(m => {
                if (themeData[m].canvasEnabled) {
                    themeData[m].canvasEnabled = false;
                    themeData[m].canvasScript = '';
                }
            });
            commitChange({ clearRef: false });
        }
    });

    setupMassDelete({
        triggerId: 'delete-all-css-btn', modalId: 'delete-all-css-modal',
        confirmId: 'confirm-delete-all-css-btn',
        emptyMsg: 'No snippets to delete', toastMsg: 'CSS Snippets Cleared!',
        isEmpty: () => CSS_PRESETS.length === 0,
        onConfirm: () => {
            CSS_PRESETS.length = 0;
            Storage.set('css', CSS_PRESETS);
            syncLibrary();
            activeCssRef = { dark: null, oled: null, light: null, her: null };
            MODES.forEach(m => {
                if (themeData[m].customCssEnabled) {
                    themeData[m].customCssEnabled = false;
                    themeData[m].customCSS = '';
                }
            });
            commitChange({ clearRef: false });
        }
    });

    // --- Duplicate Detection Helpers ---
    function isDuplicate(preset, collection, contentKey) {
        const name = (preset.name || '').trim().toLowerCase();
        const content = (preset[contentKey] || '').trim();
        return collection.some(existing =>
            (existing.name || '').trim().toLowerCase() === name &&
            (existing[contentKey] || '').trim() === content
        );
    }
    const isCanvasDuplicate = (preset) => isDuplicate(preset, CANVAS_PRESETS, 'script');
    const isCssDuplicate = (preset) => isDuplicate(preset, CSS_PRESETS, 'code');

    function isGradientDuplicate(preset) {
        const name = (preset.name || '').trim().toLowerCase();
        const stopsStr = JSON.stringify(preset.stops || []);
        const meshStr = JSON.stringify(preset.meshPoints || []);
        return CUSTOM_GRADIENT_PRESETS.some(existing =>
            (existing.name || '').trim().toLowerCase() === name &&
            JSON.stringify(existing.stops || []) === stopsStr &&
            JSON.stringify(existing.meshPoints || []) === meshStr
        );
    }

    function createPresetImporter({ collection, storageKey, renderFn, label, parseFile }) {
        return async function(files) {
            let importedCount = 0, skippedCount = 0;
            for (const file of files) {
                try {
                    const text = await file.text();
                    const result = parseFile(file, text);
                    importedCount += result.imported;
                    skippedCount += result.skipped;
                } catch (err) {
                    console.error(`${label} import error on`, file.name, err);
                }
            }
            if (importedCount > 0) {
                Storage.set(storageKey, collection);
                syncLibrary();
                renderFn();
                const skippedMsg = skippedCount > 0 ? ` (${skippedCount} duplicate${skippedCount > 1 ? 's' : ''} skipped)` : '';
                showToast(`Imported ${importedCount} ${label}(s)!${skippedMsg}`);
            } else if (skippedCount > 0) {
                showToast(`${label}${skippedCount > 1 ? 's' : ''} already in library \u2014 no duplicates imported.`);
            } else {
                showToast(`Error: No valid ${label.toLowerCase()}s found.`);
            }
        };
    }

    const handleCanvasImport = createPresetImporter({
        collection: CANVAS_PRESETS, storageKey: 'owui_canvas_presets',
        renderFn: renderCanvasPresets, label: 'Animation',
        parseFile(file, text) {
            let imported = 0, skipped = 0;
            if (file.name.endsWith('.json')) {
                const data = JSON.parse(text);
                if (data.isCanvasBackup && Array.isArray(data.canvas_presets)) {
                    data.canvas_presets.forEach(p => {
                        if (isCanvasDuplicate(p)) { skipped++; return; }
                        CANVAS_PRESETS.push(p); imported++;
                    });
                }
            } else if (file.name.endsWith('.js')) {
                const newPreset = { name: file.name.replace('.js', ''), script: text };
                if (isCanvasDuplicate(newPreset)) { skipped++; }
                else { CANVAS_PRESETS.push(newPreset); imported++; }
            }
            return { imported, skipped };
        }
    });

    const handleCssImport = createPresetImporter({
        collection: CSS_PRESETS, storageKey: 'owui_css_presets',
        renderFn: renderCssPresets, label: 'CSS Snippet',
        parseFile(file, text) {
            let imported = 0, skipped = 0;
            if (file.name.endsWith('.json')) {
                const data = JSON.parse(text);
                if (data.isCssBackup && Array.isArray(data.css_presets)) {
                    data.css_presets.forEach(p => {
                        if (isCssDuplicate(p)) { skipped++; return; }
                        CSS_PRESETS.push(p); imported++;
                    });
                }
            } else if (file.name.endsWith('.css')) {
                const newPreset = { name: file.name.replace('.css', ''), code: text };
                if (isCssDuplicate(newPreset)) { skipped++; }
                else { CSS_PRESETS.push(newPreset); imported++; }
            }
            return { imported, skipped };
        }
    });

    const handleGradientImport = createPresetImporter({
        collection: CUSTOM_GRADIENT_PRESETS, storageKey: 'owui_gradient_presets',
        renderFn: renderGradientPresets, label: 'Gradient Preset',
        parseFile(file, text) {
            let imported = 0, skipped = 0;
            if (!file.name.endsWith('.json')) return { imported, skipped };
            const data = JSON.parse(text);
            let presets = [];
            if (data.isGradientBackup && Array.isArray(data.gradient_presets)) {
                presets = data.gradient_presets;
            } else if (Array.isArray(data)) {
                presets = data;
            } else if (data.name && (data.stops || data.meshPoints)) {
                presets = [data];
            }
            presets.forEach(p => {
                if (!p.name || (!p.stops && !p.meshPoints)) return;
                if (isGradientDuplicate(p)) { skipped++; return; }
                CUSTOM_GRADIENT_PRESETS.push(structuredClone(p)); imported++;
            });
            return { imported, skipped };
        }
    });

    const importCanvasBtn = document.getElementById('import-canvas-btn');
    if (importCanvasBtn) {
        importCanvasBtn.onclick = () => {
            const urlInput = document.getElementById('import-canvas-url-input');
            const statusEl = document.getElementById('import-canvas-url-status');
            if (urlInput) urlInput.value = '';
            if (statusEl) { statusEl.style.display = 'none'; statusEl.textContent = ''; }
            showModal('import-canvas-modal');
        };
    }

    // Import Canvas File button inside the import modal
    document.getElementById('import-canvas-file-trigger-btn').onclick = () => triggerFileImport({
        accept: '.json,.js', modalId: 'import-canvas-modal', importFn: handleCanvasImport
    });

    // Load URL button inside the canvas import modal
    document.getElementById('import-canvas-url-load-btn').onclick = () => loadFromUrl({
        urlInputId: 'import-canvas-url-input', statusId: 'import-canvas-url-status',
        loadBtnId: 'import-canvas-url-load-btn', modalId: 'import-canvas-modal',
        fetchMsg: 'Fetching script from URL...', emptyMsg: 'Please enter a URL to a JS or JSON file.',
        defaultName: 'animation.js', defaultExt: '.js', mimeType: 'application/javascript',
        importFn: handleCanvasImport
    });

    // Allow Enter key to trigger canvas URL load
    document.getElementById('import-canvas-url-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('import-canvas-url-load-btn').click();
    });


    const importCssBtn = document.getElementById('import-css-btn');
    if (importCssBtn) {
        importCssBtn.onclick = () => {
            const urlInput = document.getElementById('import-css-url-input');
            const statusEl = document.getElementById('import-css-url-status');
            if (urlInput) urlInput.value = '';
            if (statusEl) { statusEl.style.display = 'none'; statusEl.textContent = ''; }
            showModal('import-css-modal');
        };
    }

    // Import CSS File button inside the import modal
    document.getElementById('import-css-file-trigger-btn').onclick = () => triggerFileImport({
        accept: '.json,.css', modalId: 'import-css-modal', importFn: handleCssImport
    });

    // Load URL button inside the CSS import modal
    document.getElementById('import-css-url-load-btn').onclick = () => loadFromUrl({
        urlInputId: 'import-css-url-input', statusId: 'import-css-url-status',
        loadBtnId: 'import-css-url-load-btn', modalId: 'import-css-modal',
        fetchMsg: 'Fetching CSS from URL...', emptyMsg: 'Please enter a URL to a CSS or JSON file.',
        defaultName: 'snippet.css', defaultExt: '.css', mimeType: 'text/css',
        importFn: handleCssImport
    });

    // Allow Enter key to trigger CSS URL load
    document.getElementById('import-css-url-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('import-css-url-load-btn').click();
    });


    function isThemeDuplicate(newTheme, existingSnapshots) {
        const stableStringify = (val) => {
            if (val === null || val === undefined) return 'null';
            if (typeof val !== 'object') return JSON.stringify(val);
            if (Array.isArray(val)) return '[' + val.map(stableStringify).join(',') + ']';
            return '{' + Object.keys(val).sort().map(k => JSON.stringify(k) + ':' + stableStringify(val[k])).join(',') + '}';
        };
        const normForCompare = (mode) => {
            if (!mode) return null;
            return stableStringify({
                h: mode.h, c: mode.c, l: mode.l,
                overrides: mode.overrides || {},
                customCSS: mode.customCSS || '',
                customCssEnabled: !!mode.customCssEnabled,
                canvasEnabled: !!mode.canvasEnabled,
                canvasScript: mode.canvasScript || '',
                manualOverrides: mode.manualOverrides || '',
                gradientEnabled: !!mode.gradientEnabled,
                gradientType: mode.gradientType || 'linear',
                gradientAngle: mode.gradientAngle ?? 135,
                gradientStops: mode.gradientStops || [],
                gradientIntensity: mode.gradientIntensity ?? 85,
                gradientAnimation: !!mode.gradientAnimation,
                gradientRadialPosX: mode.gradientRadialPosX ?? 50,
                gradientRadialPosY: mode.gradientRadialPosY ?? 50,
                gradientRadialShape: mode.gradientRadialShape || 'ellipse',
                gradientRadialSize: mode.gradientRadialSize || 'farthest-corner',
                gradientMeshPoints: mode.gradientMeshPoints || [],
                gradientMeshBgColor: mode.gradientMeshBgColor || '#0a0a12'
            });
        };
        const newSig = {
            name: (newTheme.name || '').trim().toLowerCase(),
            dark: normForCompare(newTheme.dark),
            light: normForCompare(newTheme.light),
            oled: normForCompare(newTheme.oled),
            her: normForCompare(newTheme.her)
        };
        return existingSnapshots.some(existing => {
            return (existing.name || '').trim().toLowerCase() === newSig.name
                && normForCompare(existing.dark) === newSig.dark
                && normForCompare(existing.light) === newSig.light
                && normForCompare(existing.oled) === newSig.oled
                && normForCompare(existing.her) === newSig.her;
        });
    }

    async function handleFilesImport(files, { skipDuplicateCheck = false } = {}) {
        let snapshots = getSnapshots();
        let importedCount = 0;
        let skippedCount = 0;
        let routedCount = 0;
        
        // Collect results for consolidated summary toast
        const importSummary = [];  // successful imports: "3 Animation(s)"
        const dupSummary = [];     // all-duplicate notices: "Animations"
        
        for (const file of files) {
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                
                if (data.isCanvasBackup && Array.isArray(data.canvas_presets)) {
                    let cCount = 0, cSkipped = 0;
                    data.canvas_presets.forEach(p => {
                        if (isCanvasDuplicate(p)) { cSkipped++; return; }
                        CANVAS_PRESETS.push(p); cCount++;
                    });
                    if (cCount > 0) {
                        Storage.set('canvas', CANVAS_PRESETS);
                        syncLibrary();
                        renderCanvasPresets();
                        const skMsg = cSkipped > 0 ? ` (${cSkipped} dup.)` : '';
                        importSummary.push(`${cCount} Animation${cCount !== 1 ? 's' : ''}${skMsg}`);
                        routedCount++;
                    } else if (cSkipped > 0) {
                        dupSummary.push('Animations');
                        routedCount++;
                    }
                }

                if (data.isCssBackup && Array.isArray(data.css_presets)) {
                    let cCount = 0, cSkipped = 0;
                    data.css_presets.forEach(p => {
                        if (isCssDuplicate(p)) { cSkipped++; return; }
                        CSS_PRESETS.push(p); cCount++;
                    });
                    if (cCount > 0) {
                        Storage.set('css', CSS_PRESETS);
                        syncLibrary();
                        renderCssPresets();
                        const skMsg = cSkipped > 0 ? ` (${cSkipped} dup.)` : '';
                        importSummary.push(`${cCount} CSS Snippet${cCount !== 1 ? 's' : ''}${skMsg}`);
                        routedCount++;
                    } else if (cSkipped > 0) {
                        dupSummary.push('CSS Snippets');
                        routedCount++;
                    }
                }

                if (data.isGradientBackup && Array.isArray(data.gradient_presets)) {
                    let gCount = 0, gSkipped = 0;
                    data.gradient_presets.forEach(p => {
                        if (!p.name || (!p.stops && !p.meshPoints)) return;
                        if (isGradientDuplicate(p)) { gSkipped++; return; }
                        CUSTOM_GRADIENT_PRESETS.push(structuredClone(p));
                        gCount++;
                    });
                    if (gCount > 0) {
                        persistGradientPresets();
                        renderGradientPresets();
                        const skMsg = gSkipped > 0 ? ` (${gSkipped} dup.)` : '';
                        importSummary.push(`${gCount} Gradient Preset${gCount !== 1 ? 's' : ''}${skMsg}`);
                        routedCount++;
                    } else if (gSkipped > 0) {
                        dupSummary.push('Gradient Presets');
                        routedCount++;
                    }
                }
                
                if (data.isLibraryBackup && Array.isArray(data.themes)) {
                    data.themes.reverse().forEach(t => { 
                        ensureAllModes(t);
                        if (t.her.l === 0) t.her.l = 20;
                        MODES.forEach(m => { t[m] = normalizeModeData(t[m]); if (!t[m].paletteEnabled) t[m].paletteEnabled = true; });
                        
                        if (!skipDuplicateCheck && isThemeDuplicate(t, snapshots)) { skippedCount++; return; }
                        snapshots.unshift(t); 
                        importedCount++; 
                    });
                } else {
                    let newTheme = null;
                    if (data.dark && data.light) {
                        // Strip _meta from JSON Viewer
                        delete data._meta;

                        newTheme = { 
                            name: data.name || file.name.replace('.json', '').replace('owui-theme-', '').replace(/_/g, ' '),
                            description: data.description || '',
                            author: data.author || '',
                            version: data.version || '1.0.0',
                            targetVersion: data.targetVersion || '',
                            repositoryUrl: data.repositoryUrl || '',
                            updateUrl: data.updateUrl || '',
                            dark: data.dark, 
                            light: data.light,
                            oled: data.oled || null,
                            her: data.her || null
                        };
                        ensureAllModes(newTheme);
                        MODES.forEach(m => { newTheme[m] = normalizeModeData(newTheme[m]); if (!newTheme[m].paletteEnabled) newTheme[m].paletteEnabled = true; });
                        
                    } else if (data.h !== undefined) {
                        newTheme = migrateLegacyTheme({ ...data, name: file.name.replace('.json', '') });
                    }
                    if (newTheme) {
                        if (!skipDuplicateCheck && isThemeDuplicate(newTheme, snapshots)) {
                            skippedCount++;
                        } else {
                            snapshots.unshift(newTheme); 
                            importedCount++;
                        }
                    }
                }
            } catch (err) { 
                console.error("Import error on", file.name, err); 
            }
        }
        
        if (importedCount > 0) {
            saveSnapshots(snapshots);
            const firstImport = snapshots[0];
            shouldInject = true;
            
            themeData = structuredClone({ 
                dark: firstImport.dark, 
                light: firstImport.light, 
                oled: firstImport.oled,
                her: firstImport.her
            });
            MODES.forEach(m => {
                activeThemeRef[m] = { type: 'snapshot', id: 0 };
            });
            commitChange({ clearRef: false, snapshots: true });
            
            const skMsg = skippedCount > 0 ? ` (${skippedCount} dup.)` : '';
            importSummary.push(`${importedCount} Theme${importedCount !== 1 ? 's' : ''}${skMsg}`);
        } else if (skippedCount > 0) {
            dupSummary.push('Themes');
        }
        
        // Build consolidated summary toast
        if (importSummary.length > 0) {
            const dupNote = dupSummary.length > 0 ? ` | Dupes skipped: ${dupSummary.join(', ')}` : '';
            showToast(`Imported ${importSummary.join(', ')}${dupNote}`);
        } else if (dupSummary.length > 0) {
            showToast(`Already in library — no duplicates imported: ${dupSummary.join(', ')}`);
        } else if (routedCount === 0) { 
            showToast("Error: No valid themes found in file."); 
        }
    }

    // Theme Library Search
    const themeSearchToggle = document.getElementById('theme-search-toggle-btn');
    const themeSearchInput = document.getElementById('theme-search-input');
    let themeSearchOpen = false;
    if (themeSearchToggle && themeSearchInput) {
        themeSearchToggle.onclick = () => {
            themeSearchOpen = !themeSearchOpen;
            if (themeSearchOpen) {
                themeSearchInput.style.width = '140px';
                themeSearchInput.style.padding = '4px 8px 4px 26px';
                themeSearchInput.style.opacity = '1';
                themeSearchInput.style.borderColor = 'var(--border)';
                themeSearchInput.style.background = 'rgba(255,255,255,0.05)';
                themeSearchInput.focus();
            } else {
                themeSearchInput.value = '';
                themeSearchInput.style.width = '0';
                themeSearchInput.style.padding = '0';
                themeSearchInput.style.opacity = '0';
                themeSearchInput.style.borderColor = 'transparent';
                themeSearchInput.style.background = 'transparent';
                renderSnapshots();
            }
        };
        themeSearchInput.addEventListener('input', () => { renderSnapshots(); });
        themeSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                themeSearchToggle.click();
            }
        });
    }

    // Tag Filter Dropdown
    let activeTagFilter = 'all';
    const tagFilterBtn = document.getElementById('tag-filter-toggle-btn');
    const tagFilterDropdown = document.getElementById('tag-filter-dropdown');
    if (tagFilterBtn && tagFilterDropdown) {
        tagFilterBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            tagFilterDropdown.classList.toggle('open');
        });
        tagFilterDropdown.querySelectorAll('.tag-filter-option').forEach(opt => {
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                activeTagFilter = opt.getAttribute('data-filter');
                tagFilterDropdown.querySelectorAll('.tag-filter-option').forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
                tagFilterBtn.classList.toggle('has-filter', activeTagFilter !== 'all');
                tagFilterDropdown.classList.remove('open');
                renderSnapshots();
            });
        });
        document.addEventListener('click', (e) => {
            if (!tagFilterBtn.contains(e.target) && !tagFilterDropdown.contains(e.target)) {
                tagFilterDropdown.classList.remove('open');
            }
        });
    }

    // Gradient Type Filter
    let activeGradientTypeFilter = 'all';
    const gradFilterBtn = document.getElementById('gradient-filter-toggle-btn');
    const gradFilterDropdown = document.getElementById('gradient-filter-dropdown');
    if (gradFilterBtn && gradFilterDropdown) {
        gradFilterBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            gradFilterDropdown.classList.toggle('open');
        });
        gradFilterDropdown.querySelectorAll('.tag-filter-option').forEach(opt => {
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                activeGradientTypeFilter = opt.getAttribute('data-filter');
                gradFilterDropdown.querySelectorAll('.tag-filter-option').forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
                gradFilterBtn.classList.toggle('has-filter', activeGradientTypeFilter !== 'all');
                gradFilterDropdown.classList.remove('open');
                renderGradientPresets();
            });
        });
        document.addEventListener('click', (e) => {
            if (!gradFilterBtn.contains(e.target) && !gradFilterDropdown.contains(e.target)) {
                gradFilterDropdown.classList.remove('open');
            }
        });
    }

    // Sort Toggle
    let activeSort = 'default';
    const sortBtn = document.getElementById('theme-sort-btn');
    if (sortBtn) {
        const sortCycle = ['default', 'asc', 'desc'];
        const sortLabels = { default: 'Default Sort', asc: 'Sort Ascending', desc: 'Sort Descending' };
        sortBtn.addEventListener('click', () => {
            const idx = sortCycle.indexOf(activeSort);
            activeSort = sortCycle[(idx + 1) % sortCycle.length];
            sortBtn.setAttribute('data-sort', activeSort);
            sortBtn.setAttribute('data-tooltip', sortLabels[activeSort]);
            sortBtn.classList.toggle('has-sort', activeSort !== 'default');
            renderSnapshots();
        });
    }

    // CSS Preset Sort Toggle
    let activeCssSort = 'default';
    function setupGallerySort(btnId, sortStateGetter, sortStateSetter, renderFn) {
        const btn = document.getElementById(btnId);
        if (btn) {
            const sortCycle = ['default', 'asc', 'desc'];
            const sortLabels = { default: 'Default Sort', asc: 'Sort Ascending', desc: 'Sort Descending' };
            btn.addEventListener('click', () => {
                const current = sortStateGetter();
                const idx = sortCycle.indexOf(current);
                const next = sortCycle[(idx + 1) % sortCycle.length];
                sortStateSetter(next);
                btn.setAttribute('data-sort', next);
                btn.setAttribute('data-tooltip', sortLabels[next]);
                btn.classList.toggle('has-sort', next !== 'default');
                renderFn();
            });
        }
    }
    setupGallerySort('css-sort-btn', () => activeCssSort, (v) => { activeCssSort = v; }, renderCssPresets);
    let activeCanvasSort = 'default';
    setupGallerySort('canvas-sort-btn', () => activeCanvasSort, (v) => { activeCanvasSort = v; }, renderCanvasPresets);
    let activeGradientSort = 'default';
    setupGallerySort('gradient-sort-btn', () => activeGradientSort, (v) => { activeGradientSort = v; }, renderGradientPresets);

    // CSS Preset Gallery Search
    function setupGallerySearch(toggleId, inputId, renderFn) {
        const toggle = document.getElementById(toggleId);
        const input = document.getElementById(inputId);
        let isOpen = false;
        if (toggle && input) {
            toggle.onclick = () => {
                isOpen = !isOpen;
                if (isOpen) {
                    input.style.width = '140px';
                    input.style.padding = '4px 8px 4px 26px';
                    input.style.opacity = '1';
                    input.style.borderColor = 'var(--border)';
                    input.style.background = 'rgba(255,255,255,0.05)';
                    input.focus();
                } else {
                    input.value = '';
                    input.style.width = '0';
                    input.style.padding = '0';
                    input.style.opacity = '0';
                    input.style.borderColor = 'transparent';
                    input.style.background = 'transparent';
                    renderFn();
                }
            };
            input.addEventListener('input', () => { renderFn(); });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') { e.stopPropagation(); toggle.click(); }
            });
        }
    }
    setupGallerySearch('css-search-toggle-btn', 'css-search-input', renderCssPresets);
    setupGallerySearch('canvas-search-toggle-btn', 'canvas-search-input', renderCanvasPresets);
    setupGallerySearch('gradient-search-toggle-btn', 'gradient-search-input', renderGradientPresets);

    document.getElementById('import-json-btn').onclick = () => {
        const urlInput = document.getElementById('import-url-input');
        const statusEl = document.getElementById('import-url-status');
        if (urlInput) urlInput.value = '';
        if (statusEl) { statusEl.style.display = 'none'; statusEl.textContent = ''; }
        showModal('import-theme-modal');
    };

    // Import File button inside the import modal
    document.getElementById('import-file-trigger-btn').onclick = () => triggerFileImport({
        accept: '.json', modalId: 'import-theme-modal', importFn: handleFilesImport
    });

    // Load URL button inside the import modal
    document.getElementById('import-url-load-btn').onclick = () => loadFromUrl({
        urlInputId: 'import-url-input', statusId: 'import-url-status',
        loadBtnId: 'import-url-load-btn', modalId: 'import-theme-modal',
        fetchMsg: 'Fetching theme from URL...', emptyMsg: 'Please enter a URL to a theme JSON file.',
        defaultName: 'theme.json', defaultExt: '.json', mimeType: 'application/json',
        importFn: (files) => handleFilesImport(files, { skipDuplicateCheck: true })
    });

    // Allow Enter key to trigger URL load
    document.getElementById('import-url-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('import-url-load-btn').click();
        }
    });


    // Drag and Drop Import Logic
    const dropOverlay = document.getElementById('drop-overlay');
    window.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropOverlay.style.display = 'flex';
    });
    window.addEventListener('dragleave', (e) => {
        if (e.target === dropOverlay) dropOverlay.style.display = 'none';
    });
    window.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropOverlay.style.display = 'none';
        const allFiles = Array.from(e.dataTransfer.files);
        if (allFiles.length === 0) return; // Not a file drop (text, link, image drag) — ignore silently
        const files = allFiles.filter(f => f.name.endsWith('.json') || f.name.endsWith('.js') || f.name.endsWith('.css'));
        if (files.length > 0) {
            const jsFiles = files.filter(f => f.name.endsWith('.js'));
            const cssFiles = files.filter(f => f.name.endsWith('.css'));
            const jsonFiles = files.filter(f => f.name.endsWith('.json'));
            if (jsFiles.length > 0) await handleCanvasImport(jsFiles);
            if (cssFiles.length > 0) await handleCssImport(cssFiles);
            if (jsonFiles.length > 0) await handleFilesImport(jsonFiles);
        } else {
            showToast("Error: Only .json, .js, or .css files are supported.");
        }
    });

    window.exportSnapshot = (index) => {
        const snapshots = getSnapshots();
        const s = snapshots[index];
        if (!s) return;
        

        const data = {
            name: s.name,
            description: s.description || '',
            author: s.author || '',
            version: s.version || '1.0.0',
            targetVersion: s.targetVersion || '',
            repositoryUrl: s.repositoryUrl || '',
            updateUrl: s.updateUrl || '',
            dark: cleanMode(s.dark),
            light: cleanMode(s.light),
            oled: cleanMode(s.oled),
            her: cleanMode(s.her)
        };
        const cleanName = s.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const dateStr = new Date().toISOString().split('T')[0];
        downloadFile(data, `owui-theme-${cleanName}-${dateStr}.json`);
    };

    // --- Theme Update System ---
    const MANIFEST_URL = 'https://raw.githubusercontent.com/silentoplayz/theme-designer-pro-presets/main/manifest.json';

    function toRawGitHub(url) {
        if (!url) return url;
        const ghBlob = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
        if (ghBlob) return `https://raw.githubusercontent.com/${ghBlob[1]}/${ghBlob[2]}/${ghBlob[3]}`;
        const ghRaw = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/raw\/(.+)$/);
        if (ghRaw) return `https://raw.githubusercontent.com/${ghRaw[1]}/${ghRaw[2]}/${ghRaw[3]}`;
        return url;
    }

    const semverCompare = (a, b) => {
        const pa = (a || '0.0.0').split('.').map(Number);
        const pb = (b || '0.0.0').split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const diff = (pa[i] || 0) - (pb[i] || 0);
            if (diff !== 0) return diff;
        }
        return 0;
    };

    async function fetchManifest() {
        try {
            const res = await fetch(MANIFEST_URL);
            if (!res.ok) return null;
            const data = await res.json();
            if (data.manifestVersion && data.themes) return data;
            return null;
        } catch { return null; }
    }

    async function checkThemeUpdate(index) {
        const snapshots = getSnapshots();
        const snap = snapshots[index];
        if (!snap || !snap.updateUrl) return null;
        
        try {
            const fetchUrl = toRawGitHub(snap.updateUrl);
            const res = await fetch(fetchUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const remote = await res.json();
            
            if (!remote.dark || !remote.light) throw new Error('Invalid theme format');
            
            const localVer = snap.version || '0.0.0';
            const remoteVer = remote.version || '0.0.0';
            
            if (semverCompare(remoteVer, localVer) > 0) {
                return { index, local: snap, remote, localVersion: localVer, remoteVersion: remoteVer };
            }
            return null; // up to date
        } catch(e) {
            console.error(`Update check failed for "${snap.name}":`, e);
            return { index, error: e.message, local: snap };
        }
    }

    async function checkUpdatesViaManifest(snapshots) {
        const manifest = await fetchManifest();
        if (!manifest) return null; // manifest unavailable, caller should fall back

        // Build a lookup: normalized updateUrl → manifest entry
        const manifestByUrl = new Map();
        for (const [key, entry] of Object.entries(manifest.themes)) {
            const rawUrl = toRawGitHub(entry.updateUrl);
            manifestByUrl.set(rawUrl, entry);
            // Also index the non-raw URL for matching
            manifestByUrl.set(entry.updateUrl, entry);
        }

        const results = [];
        const unmatched = []; // indices not found in manifest

        for (let i = 0; i < snapshots.length; i++) {
            const snap = snapshots[i];
            if (!snap.updateUrl) continue;

            const rawLocal = toRawGitHub(snap.updateUrl);
            const manifestEntry = manifestByUrl.get(rawLocal) || manifestByUrl.get(snap.updateUrl);

            if (!manifestEntry) {
                // Not in manifest — will need per-theme fallback
                unmatched.push(i);
                continue;
            }

            const localVer = snap.version || '0.0.0';
            const remoteVer = manifestEntry.version || '0.0.0';

            if (semverCompare(remoteVer, localVer) > 0) {
                // Update available — but we don't have the full theme data yet.
                // Store the updateUrl so we can fetch it when user clicks "Update".
                results.push({
                    index: i,
                    local: snap,
                    remote: null, // will be fetched on-demand
                    remoteUpdateUrl: manifestEntry.updateUrl,
                    localVersion: localVer,
                    remoteVersion: remoteVer,
                    viaManifest: true
                });
            } else {
                results.push(null); // up to date
            }
        }

        return { results, unmatched };
    }

    // Fetch full theme data on-demand (called when user clicks "Update" on a manifest-checked theme)
    async function fetchThemeData(updateUrl) {
        const fetchUrl = toRawGitHub(updateUrl);
        const res = await fetch(fetchUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const remote = await res.json();
        if (!remote.dark || !remote.light) throw new Error('Invalid theme format');
        return remote;
    }

    window.applyManifestUpdate = async function(index, updateUrl) {
        try {
            showToast('Downloading theme update...');
            const remote = await fetchThemeData(updateUrl);
            applyThemeUpdate(index, remote);
            return true;
        } catch(e) {
            showToast(`Error: ${e.message}`);
            return false;
        }
    };

    // Global "Check for Updates" button
    $('check-updates-btn').addEventListener('click', async () => {
        const btn = $('check-updates-btn');
        const origHTML = btn.innerHTML;
        btn.innerHTML = '<span class="spin" style="font-size: 13px; line-height: 1;">⟳</span> Checking…';
        btn.disabled = true;
        
        const snapshots = getSnapshots();
        const updatable = snapshots.map((s, i) => ({ index: i, snap: s })).filter(x => x.snap.updateUrl);
        
        if (updatable.length === 0) {
            btn.innerHTML = origHTML;
            btn.disabled = false;
            showToast('No themes have an Update URL set.');
            return;
        }
        
        // Try manifest-based checking first (1 fetch instead of N)
        let results = [];
        const manifestResult = await checkUpdatesViaManifest(snapshots);
        
        if (manifestResult) {
            // Manifest available — collect manifest results
            results = manifestResult.results.filter(r => r !== null);
            
            // Fall back to per-theme check for unmatched themes
            if (manifestResult.unmatched.length > 0) {
                const fallbackResults = await Promise.all(
                    manifestResult.unmatched.map(i => checkThemeUpdate(i))
                );
                results = results.concat(fallbackResults.filter(r => r !== null));
            }
        } else {
            // Manifest unavailable — fall back to per-theme checking for all
            const allResults = await Promise.all(updatable.map(x => checkThemeUpdate(x.index)));
            results = allResults.filter(r => r !== null);
        }
        
        btn.innerHTML = origHTML;
        btn.disabled = false;
        
        const updates = results.filter(r => r && !r.error);
        const errors = results.filter(r => r && r.error);
        const upToDate = updatable.length - updates.length - errors.length;
        
        if (updates.length === 0 && errors.length === 0) {
            showToast(`✓ All ${upToDate} theme(s) are up to date!`);
            return;
        }
        
        // Build results list
        let html = '';
        
        if (updates.length > 0) {
            html += `<div style="font-size: 0.7rem; font-weight: 700; color: #10b981; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">Updates Available (${updates.length})</div>`;
            updates.forEach(u => {
                html += `<div style="display:flex; align-items:center; justify-content:space-between; padding: 10px 12px; background: var(--bg-deep); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 8px;">`;
                html += `<div><div style="font-size: 0.78rem; font-weight: 700; color: var(--text-main);">${u.local.name}</div><div style="font-size: 0.65rem; color: var(--text-muted);">v${u.localVersion} → <span style="color:#10b981;">v${u.remoteVersion}</span></div></div>`;
                if (u.viaManifest) {
                    // Manifest-sourced: fetch full data on click
                    html += `<button class="btn btn-primary" style="background:#10b981; padding: 6px 14px; font-size: 0.68rem;" onclick="(async()=>{const ok=await applyManifestUpdate(${u.index},'${u.remoteUpdateUrl}');if(ok){this.innerText='Updated!';this.disabled=true;this.style.opacity='0.5';}})()">Update</button>`;
                } else {
                    // Per-theme: full data already fetched
                    html += `<button class="btn btn-primary" style="background:#10b981; padding: 6px 14px; font-size: 0.68rem;" onclick="applyThemeUpdate(${u.index}, window._pendingBatchUpdates[${u.index}]); this.innerText='Updated!'; this.disabled=true; this.style.opacity='0.5';">Update</button>`;
                }
                html += `</div>`;
            });
            // Store remote data for non-manifest batch buttons
            window._pendingBatchUpdates = {};
            window._pendingBatchIndices = updates.map(u => u.index);
            window._pendingBatchMeta = {};
            updates.forEach(u => {
                if (u.viaManifest) {
                    window._pendingBatchMeta[u.index] = u.remoteUpdateUrl;
                } else {
                    window._pendingBatchUpdates[u.index] = u.remote;
                }
            });
            
            // Show "Update All" button when 2+ updates are available
            const updateAllBtn = $('update-all-btn');
            if (updateAllBtn) {
                updateAllBtn.style.display = updates.length >= 2 ? '' : 'none';
                updateAllBtn.disabled = false;
                updateAllBtn.innerText = 'Update All';
                updateAllBtn.style.opacity = '1';
            }
        }
        
        if (upToDate > 0) {
            html += `<div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 12px; text-align:center;">✓ ${upToDate} theme(s) up to date</div>`;
        }
        
        if (errors.length > 0) {
            html += `<div style="font-size: 0.7rem; font-weight: 700; color: #ef4444; text-transform: uppercase; letter-spacing: 1px; margin: 12px 0 10px;">Errors (${errors.length})</div>`;
            errors.forEach(e => {
                html += `<div style="padding: 8px 12px; background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 10px; margin-bottom: 6px; font-size: 0.72rem;">`;
                html += `<span style="color:var(--text-main); font-weight:600;">${e.local.name}</span> <span style="color:#ef4444;">${e.error}</span>`;
                html += `</div>`;
            });
        }
        
        $('update-results-list').innerHTML = html;
        showModal('update-results-modal');
    });

    window.applyThemeUpdate = function(index, remoteData) {
        const snapshots = getSnapshots();
        if (!snapshots[index]) return;
        
        // Normalize the remote data through the same pipeline as import
        MODES.forEach(m => { if (remoteData[m]) remoteData[m] = normalizeModeData(remoteData[m]); });

        
        ensureAllModes(remoteData);
        delete remoteData._meta;
        
        // Update the snapshot: replace mode data + update metadata from remote
        snapshots[index].dark = remoteData.dark;
        snapshots[index].light = remoteData.light;
        snapshots[index].oled = remoteData.oled;
        snapshots[index].her = remoteData.her;
        snapshots[index].version = remoteData.version || snapshots[index].version;
        if (remoteData.description) snapshots[index].description = remoteData.description;
        if (remoteData.author) snapshots[index].author = remoteData.author;
        if (remoteData.targetVersion) snapshots[index].targetVersion = remoteData.targetVersion;
        // Preserve local name and updateUrl/repositoryUrl
        
        saveSnapshots(snapshots);
        
        // If this theme is currently active in ANY mode, reload it
        let needsInject = false;
        MODES.forEach(m => {
            if (activeThemeRef[m] && activeThemeRef[m].type === 'snapshot' && activeThemeRef[m].id === index) {
                themeData[m] = structuredClone(snapshots[index][m]);
                needsInject = true;
            }
        });
        if (needsInject) {
            commitChange({ clearRef: false, snapshots: true });
        } else {
            pushState();
            renderSnapshots();
        }
    };

    let pendingUpdate = null;
    
    window.checkSingleUpdate = async (index) => {
        showToast('Checking for update...');
        const result = await checkThemeUpdate(index);
        
        if (!result) {
            showToast('✓ Theme is up to date!');
            return;
        }
        if (result.error) {
            showToast(`Error: ${result.error}`);
            return;
        }
        
        // Show single update modal
        pendingUpdate = result;
        const info = $('update-modal-info');
        const details = $('update-modal-details');
        info.innerHTML = `<b>${result.local.name}</b> has an update available.`;
        
        let detailsHtml = `<div style="display:flex; justify-content:space-between; margin-bottom:8px;"><span>Current version</span><span style="color:var(--text-main); font-weight:700;">v${result.localVersion}</span></div>`;
        detailsHtml += `<div style="display:flex; justify-content:space-between; margin-bottom:8px;"><span>Available version</span><span style="color:#10b981; font-weight:700;">v${result.remoteVersion}</span></div>`;
        if (result.remote.author) detailsHtml += `<div style="display:flex; justify-content:space-between;"><span>Author</span><span style="color:var(--text-main);">${result.remote.author}</span></div>`;
        if (result.remote.description) detailsHtml += `<div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border); font-style:italic;">${result.remote.description}</div>`;
        details.innerHTML = detailsHtml;
        
        showModal('update-modal');
    };
    
    $('update-skip-btn').addEventListener('click', () => {
        hideModal('update-modal');
        pendingUpdate = null;
    });
    
    $('update-confirm-btn').addEventListener('click', () => {
        if (pendingUpdate && !pendingUpdate.error) {
            applyThemeUpdate(pendingUpdate.index, pendingUpdate.remote);
            showToast(`Updated "${pendingUpdate.local.name}" to v${pendingUpdate.remoteVersion}!`);
        }
        hideModal('update-modal');
        pendingUpdate = null;
    });

    window.applyAllBatchUpdates = async function() {
        const indices = window._pendingBatchIndices || [];
        if (indices.length === 0) return;
        
        for (const idx of indices) {
            const remote = window._pendingBatchUpdates[idx];
            const manifestUrl = window._pendingBatchMeta[idx];
            if (remote) {
                applyThemeUpdate(idx, remote);
            } else if (manifestUrl) {
                await applyManifestUpdate(idx, manifestUrl);
            }
        }
        
        // Mark all individual Update buttons in the results list as done
        const listEl = $('update-results-list');
        if (listEl) {
            listEl.querySelectorAll('button.btn-primary').forEach(btn => {
                btn.innerText = 'Updated!';
                btn.disabled = true;
                btn.style.opacity = '0.5';
            });
        }
        
        // Disable the Update All button
        const updateAllBtn = $('update-all-btn');
        if (updateAllBtn) {
            updateAllBtn.innerText = 'All Updated!';
            updateAllBtn.disabled = true;
            updateAllBtn.style.opacity = '0.5';
        }
        
        showToast(`Updated ${indices.length} theme(s)!`);
    };

    // App Initialization
    (function() {
            renderCuratedDots();
            
            // Check Her Theme Availability
            async function initHerMode() {
                let currentTheme = localStorage.getItem('theme') || 'dark';
                let hasHerClass = document.documentElement.classList.contains('her');
                let showHer = (currentTheme === 'her' || hasHerClass);
                
                try {
                    let token = localStorage.getItem('token');
                    let headers = { 'Accept': 'application/json' };
                    if (token) {
                        token = token.replace(/^"|"$/g, '');
                        headers['Authorization'] = `Bearer ${token}`;
                    }

                    let baseUrl = window.location.origin;
                    if (!baseUrl || baseUrl.includes('about:')) baseUrl = '';

                    const res = await fetch(baseUrl + '/api/config', { headers });
                    if (res.ok) {
                        const data = await res.json();
                        if (data?.features?.enable_easter_eggs === true) {
                            showHer = true;
                        } else if (currentTheme !== 'her' && !hasHerClass) {
                            showHer = false;
                        }
                    }
                } catch(e) { console.warn('Theme Pro:', e); }
                
                pushState();
                
                const herBtn = document.getElementById('mode-btn-her');
                if (showHer) {
                    if (herBtn) herBtn.style.display = 'flex';
                } else {
                    if (herBtn) herBtn.style.display = 'none';
                    if (activeMode === 'her') {
                        document.querySelector('.mode-btn[data-mode="dark"]').click();
                    }
                }
            }
            initHerMode();

            // Listen for native theme changes
            window.addEventListener('storage', (e) => {
                if (e.key === 'theme' && e.newValue) {
                    let targetMode = e.newValue;
                    if (targetMode === 'oled-dark') targetMode = 'oled';
                    
                    if (targetMode === 'her') {
                        const herBtn = document.getElementById('mode-btn-her');
                        if (herBtn) herBtn.style.display = 'flex';
                    }
                    
                    const modeBtn = document.querySelector(`.mode-btn[data-mode="${targetMode}"]`);
                    if (modeBtn && activeMode !== targetMode) modeBtn.click();
                }
            });

            // Load saved state + Migrate legacy formats gracefully
            try {
                if(localStorage) {
                    const saved = Storage.getRaw('theme');
                    if (saved) {
                        const s = JSON.parse(saved);
                        if (s.dark && s.light) {
                            const { _activeThemeRef, _activeCanvasRef, _activeCssRef, _activeGradientRef, ...pureThemeData } = s;
                            themeData = pureThemeData;
                            if (_activeThemeRef) activeThemeRef = _activeThemeRef;
                            if (_activeCanvasRef) activeCanvasRef = _activeCanvasRef;
                            if (_activeCssRef) activeCssRef = _activeCssRef;
                            if (_activeGradientRef) activeGradientRef = _activeGradientRef;
                            ensureAllModes(themeData);
                            
                            if (!themeData.dark.locks) themeData.dark.locks = {};
                            if (!themeData.light.locks) themeData.light.locks = {};
                            if (!themeData.oled.locks) themeData.oled.locks = {};
                            if (!themeData.her.locks) themeData.her.locks = {};
                            
                            // Migrate legacy overrides and ensure defaults
                            MODES.forEach(m => {
                                if (themeData[m]) {
                                    Object.keys(themeData[m].overrides || {}).forEach(k => themeData[m].locks[k] = true);
                                    if (themeData[m].customCssEnabled === undefined) themeData[m].customCssEnabled = false;
                                    if (themeData[m].autoScope === undefined) themeData[m].autoScope = true;
                                    if (themeData[m].canvasEnabled === undefined) themeData[m].canvasEnabled = false;
                                    if (themeData[m].canvasScript === undefined) themeData[m].canvasScript = "";
                                }
                            });

                        } else if (s.h !== undefined) {
                            const migrated = migrateLegacyTheme(s);
                            MODES.forEach(m => { themeData[m] = migrated[m]; });
                        }
                    }
                    
                    const pTheme = localStorage.getItem('theme');
                    const pDoc = document.documentElement;
                    if (pTheme === 'system' || pDoc.getAttribute('data-theme') === 'system') {
                        const systemBtn = document.querySelector('.mode-btn[data-mode="system"]');
                        if (systemBtn) systemBtn.click();
                    } else if (pTheme === 'oled-dark' || pDoc.getAttribute('data-theme') === 'oled-dark') {
                        document.querySelector('.mode-btn[data-mode="oled"]')?.click();
                    } else if (pTheme === 'her' || pDoc.classList.contains('her') || pDoc.getAttribute('data-theme') === 'her') {
                        const herBtn = document.querySelector('.mode-btn[data-mode="her"]');
                        if (herBtn) herBtn.click();
                    } else if (pTheme === 'light' || pDoc.classList.contains('light') || pDoc.getAttribute('data-theme') === 'light') {
                        document.querySelector('.mode-btn[data-mode="light"]')?.click();
                    } else {
                        document.querySelector('.mode-btn[data-mode="dark"]')?.click();
                    }
                    
                    // Recover Tab State
                    const savedTab = sessionStorage.getItem('owui_theme_tool_tab');
                    if (savedTab) {
                        const targetTab = document.querySelector(`.tab[data-tab="${savedTab}"]`);
                        if (targetTab) targetTab.click();
                    }
                }
            } catch (e) { console.warn('Theme Pro:', e); }

            // Draft Mode: restore from sessionStorage, or honor valve default
            // Must run BEFORE updatePalette() so syncToServer() is gated in draft mode
            const _hasSavedDraft = sessionStorage.getItem('owui_theme_draft_mode');
            if (_hasSavedDraft === '1') {
                setDraftMode(true);
            } else if (window.__THEME_PRO_CONFIG__?.draftModeDefault) {
                setDraftMode(true);
            }

            updatePalette();
            renderSnapshots();
            const draftSwitch = document.getElementById('draft-switch');
            if (draftSwitch) draftSwitch.addEventListener('click', () => {
                if (_draftMode) {
                    publishTheme();  // Draft → Live: sync + toast + set Live
                } else {
                    setDraftMode(true);
                }
            });
            const publishBtn = document.getElementById('draft-publish-btn');
            if (publishBtn) publishBtn.addEventListener('click', publishTheme);
    })();

    // ═══════════════════════════════════════════════════════════════════════
    // VALVE ENFORCEMENT — Admin-controlled feature gating via Valves
    // Reads window.__THEME_PRO_CONFIG__ injected by the Python backend.
    // ═══════════════════════════════════════════════════════════════════════
    (function enforceValves() {
        const cfg = window.__THEME_PRO_CONFIG__;
        if (!cfg) return;

        // ── 0. Theme Inactive badge — visible when valve is OFF ──
        if (!cfg.themeActive) {
            const badge = document.getElementById('inactive-badge');
            if (badge) badge.classList.add('visible');
        }

        // ── 1. Hide tabs for disabled features ──
        const hiddenTabs = [];
        if (!cfg.enableCanvasFx) hiddenTabs.push('canvas');
        if (!cfg.enableCustomCss) hiddenTabs.push('custom');
        if (!cfg.enableGradientBuilder) hiddenTabs.push('bg');

        hiddenTabs.forEach(tabKey => {
            const tabEl = document.querySelector(`.tab[data-tab="${tabKey}"]`);
            if (tabEl) tabEl.style.display = 'none';
        });

        // If the currently active tab was hidden, fall back to Design Studio
        const activeTab = document.querySelector('.tab.active');
        if (activeTab && hiddenTabs.includes(activeTab.dataset.tab)) {
            const fallback = document.querySelector('.tab[data-tab="lch"]');
            if (fallback) fallback.click();
        }

        // ── 2. Canvas FX — suppress via localStorage flag for bootloader ──
        if (!cfg.enableCanvasFx) {
            try {
                localStorage.setItem('owui_theme_valve_no_canvas', 'true');
                // Force-disable in current themeData
                ['dark', 'oled', 'light', 'her'].forEach(m => {
                    if (themeData[m]) themeData[m].canvasEnabled = false;
                });
            } catch (e) { console.warn('Theme Pro Valves:', e); }
        } else {
            try {
                localStorage.removeItem('owui_theme_valve_no_canvas');
            } catch (e) {}
        }

        // ── 3. Restrict URL imports ──
        if (!cfg.enableUrlImport) {
            // Completely disable — override loadFromUrl to show admin message
            const _origLoadFromUrl = loadFromUrl;
            loadFromUrl = function(opts) {
                const statusEl = document.getElementById(opts.statusId);
                if (statusEl) {
                    statusEl.style.display = 'block';
                    statusEl.style.background = 'rgba(239,68,68,0.15)';
                    statusEl.style.color = '#ef4444';
                    statusEl.style.borderRadius = '8px';
                    statusEl.style.padding = '8px 12px';
                    statusEl.style.fontSize = '0.7rem';
                    statusEl.textContent = '⛔ URL imports are disabled by your administrator.';
                }
            };
            // Hide "Load URL" buttons
            ['import-url-load-btn', 'import-css-url-load-btn', 'import-canvas-url-load-btn', 'import-gradient-url-load-btn']
                .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
            // Hide URL input fields
            ['import-url-input', 'import-css-url-input', 'import-canvas-url-input', 'import-gradient-url-input']
                .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        } else if (cfg.allowedImportDomains && cfg.allowedImportDomains.length > 0) {
            // Domain allowlist — wrap loadFromUrl with domain check
            const _origLoadFromUrl = loadFromUrl;
            loadFromUrl = function(opts) {
                const url = (document.getElementById(opts.urlInputId)?.value || '').trim();
                try {
                    const hostname = new URL(url).hostname;
                    const allowed = cfg.allowedImportDomains.some(d =>
                        hostname === d || hostname.endsWith('.' + d)
                    );
                    if (!allowed) {
                        const statusEl = document.getElementById(opts.statusId);
                        if (statusEl) {
                            statusEl.style.display = 'block';
                            statusEl.style.background = 'rgba(239,68,68,0.15)';
                            statusEl.style.color = '#ef4444';
                            statusEl.style.borderRadius = '8px';
                            statusEl.style.padding = '8px 12px';
                            statusEl.style.fontSize = '0.7rem';
                            statusEl.textContent = `⛔ Domain "${hostname}" is not in the allowed list. Allowed: ${cfg.allowedImportDomains.join(', ')}`;
                        }
                        return;
                    }
                } catch (e) { /* let the original handle invalid URL errors */ }
                return _origLoadFromUrl.call(this, opts);
            };
        }

        // ── 4. Auth page theming — force off + hide toggles + overwrite localStorage ──
        if (!cfg.enableAuthPageTheming) {
            // Hide all "Show on Auth Pages" toggle labels in the UI
            ['toggle-theme-auth', 'toggle-custom-auth', 'toggle-canvas-auth', 'toggle-gradient-auth']
                .forEach(id => {
                    const el = document.getElementById(id);
                    if (el) {
                        el.checked = false;
                        const label = el.closest('label');
                        if (label) label.style.display = 'none';
                    }
                });
            // Force *ShowAuth = false in themeData for all modes
            ['dark', 'oled', 'light', 'her'].forEach(m => {
                if (themeData[m]) {
                    themeData[m].themeShowAuth = false;
                    themeData[m].customCssShowAuth = false;
                    themeData[m].canvasShowAuth = false;
                    themeData[m].gradientShowAuth = false;
                }
            });
            // Persist to localStorage so the bootloader also respects this
            commitChange({ clearRef: false, push: false });
        }
    })();

    // ═══════════════════════════════════════════════════════════════════════
    // AI THEME APPLICATION — Apply theme from AI-provided OKLCH values
    // Reads window.__THEME_PRO_APPLY__ injected by apply_theme() method.
    // ═══════════════════════════════════════════════════════════════════════
    (function applyAITheme() {
        const apply = window.__THEME_PRO_APPLY__;
        if (!apply) return;

        const h = apply.h, c = apply.c, l = apply.l;

        // Determine target modes
        const allModes = ['dark', 'oled', 'light', 'her'];
        const targetModes = (apply.mode && apply.mode !== 'all') ? [apply.mode] : allModes;

        // HSL-to-hex helper for gradient generation
        function hslToHex(hue, sat, lit) {
            sat /= 100; lit /= 100;
            const f = n => {
                const k = (n + hue / 30) % 12;
                return lit - sat * Math.min(lit, 1 - lit) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
            };
            const toHex = v => Math.round(v * 255).toString(16).padStart(2, '0');
            return '#' + toHex(f(0)) + toHex(f(8)) + toHex(f(4));
        }

        // Generate a 4-stop gradient from the hue
        function generateGradientStops(hue) {
            return [
                { color: hslToHex(hue, 15, 4), position: 0 },
                { color: hslToHex(hue, 25, 12), position: 33 },
                { color: hslToHex(hue, 20, 7), position: 66 },
                { color: hslToHex(hue, 15, 4), position: 100 },
            ];
        }

        // Apply to targeted modes
        targetModes.forEach(m => {
            const modeL = (m === 'oled') ? 0 : l;
            const src = createDefaultModeData({ h: h, c: c, l: modeL });
            src.paletteEnabled = true;

            // Auto-generate matching gradient
            if (apply.gradient !== false) {
                src.gradientEnabled = true;
                src.gradientType = 'linear';
                src.gradientAngle = 135;
                src.gradientStops = generateGradientStops(h);
                src.gradientIntensity = 100;
            }

            Object.assign(themeData[m], src);
        });

        commitChange({ clearRef: true, push: true });

        // Show confirmation toast
        const desc = apply.description || `H:${h}° C:${c} L:${l}`;
        const modeLabel = (apply.mode && apply.mode !== 'all') ? ` (${apply.mode} mode)` : '';
        const features = apply.gradient !== false ? '🌈 Palette + Gradient' : '🎨 Palette';
        const toast = document.createElement('div');
        toast.innerHTML = `🤖 <strong>${desc}</strong>${modeLabel} — ${features} — Fine-tune below`;
        toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:100001;background:rgba(59,130,246,0.95);color:white;padding:14px 28px;border-radius:12px;font-size:0.8rem;font-weight:600;font-family:Inter,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,0.4);animation:containerShow 0.3s ease;pointer-events:none;display:flex;align-items:center;gap:8px;max-width:90vw;';
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.5s'; }, 4000);
        setTimeout(() => toast.remove(), 4500);
    })();

    // --- Snapshot System ---
    function renderSnapshots() {
        const dm = getActiveDataMode();
        try {
            const container = document.getElementById('snapshot-list');
            const scrollArea = document.getElementById('snapshot-scroll');
            const countWrap = document.getElementById('library-count-wrap');
            const countEl = document.getElementById('library-count');
            
            if (!container || !scrollArea) return;
            
            let snapshots = getSnapshots();
            let needsSave = false;

            snapshots = snapshots.map(s => {
                if (s.h !== undefined) {
                    needsSave = true;
                    return migrateLegacyTheme(s);
                }
                if (!s.oled || !s.her) { needsSave = true; ensureAllModes(s); }
                MODES.forEach(m => {
                    if (s[m]) {
                        if (!s[m].locks) { needsSave = true; s[m].locks = {}; Object.keys(s[m].overrides || {}).forEach(k => s[m].locks[k] = true); }
                        const keysBefore = Object.keys(s[m]).length;
                        s[m] = normalizeModeData(s[m]);
                        if (!s[m].paletteEnabled) s[m].paletteEnabled = true;
                        if (Object.keys(s[m]).length !== keysBefore) needsSave = true;
                    }
                });
                return s;
            });
            if (needsSave) saveSnapshots(snapshots);

            // Search filtering
            const searchInput = document.getElementById('theme-search-input');
            const searchQuery = (searchInput ? searchInput.value : '').trim().toLowerCase();
            let filteredSnapshots = snapshots.map((s, i) => ({ ...s, _origIndex: i }));
            if (searchQuery) {
                filteredSnapshots = filteredSnapshots.filter(s => {
                    const name = (s.name || '').toLowerCase();
                    const author = (s.author || '').toLowerCase();
                    const desc = (s.description || '').toLowerCase();
                    return name.includes(searchQuery) || author.includes(searchQuery) || desc.includes(searchQuery);
                });
            }

            // Tag filtering
            if (typeof activeTagFilter !== 'undefined' && activeTagFilter !== 'all') {
                const modes = MODES;
                filteredSnapshots = filteredSnapshots.filter(s => {
                    switch (activeTagFilter) {
                        case 'css': return modes.some(m => s[m] && s[m].customCSS && s[m].customCssEnabled !== false);
                        case 'canvas': return modes.some(m => s[m] && s[m].canvasEnabled && s[m].canvasScript);
                        case 'overrides': return modes.some(m => s[m] && ((s[m].overrides && Object.keys(s[m].overrides).length > 0) || (s[m].manualOverrides && s[m].manualOverrides.trim())));
                        case 'gradient': return modes.some(m => s[m] && s[m].gradientEnabled && s[m].gradientStops && s[m].gradientStops.length > 0);
                        case 'linked': return !!s.updateUrl;
                        default: return true;
                    }
                });
            }

            // Sorting
            if (typeof activeSort !== 'undefined' && activeSort !== 'default') {
                filteredSnapshots.sort((a, b) => {
                    const nameA = (a.name || '').toLowerCase();
                    const nameB = (b.name || '').toLowerCase();
                    return activeSort === 'asc' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
                });
            }

            const isFiltered = searchQuery || (typeof activeTagFilter !== 'undefined' && activeTagFilter !== 'all');
            if (countEl) countEl.innerText = isFiltered ? filteredSnapshots.length + '/' + snapshots.length : snapshots.length;
            if (countWrap) countWrap.style.display = snapshots.length > 0 ? 'inline' : 'none';
            
            if (snapshots.length === 0) { 
                scrollArea.style.display = 'block';
                container.style.display = 'block';
                container.innerHTML = `<div class="empty-state-lg">Your saved themes will appear here.</div>`;
                return; 
            }

            if (filteredSnapshots.length === 0) {
                scrollArea.style.display = 'block';
                container.style.display = 'block';
                const filterLabels = { css: 'Custom CSS', canvas: 'Canvas FX', gradient: 'Gradient', overrides: 'Overrides', linked: 'Linked' };
                let emptyMsg = 'No themes match';
                if (searchQuery) emptyMsg += ` &ldquo;${searchQuery}&rdquo;`;
                if (typeof activeTagFilter !== 'undefined' && activeTagFilter !== 'all') {
                    emptyMsg += (searchQuery ? ' with' : '') + ` the <strong>${filterLabels[activeTagFilter] || activeTagFilter}</strong> tag`;
                }
                container.innerHTML = `<div class="empty-state-lg">${emptyMsg}</div>`;
                return;
            }
            
            scrollArea.style.display = 'block';
            container.style.display = 'grid';
            
            container.innerHTML = filteredSnapshots.map((s) => {
                const i = s._origIndex;
                const isMatch = s && s[dm] && isModeMatch(s[dm], themeData[dm]);
                const isRef = activeThemeRef[dm] && activeThemeRef[dm].type === 'snapshot' && activeThemeRef[dm].id === i;
                const active = isMatch && isRef;
                
                // Build rich HTML tooltip from metadata + feature detection
                const esc = (str) => (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                let ttHtml = `<div class="tt-row"><span class="tt-name">${esc(s.name)}</span>`;
                if (s.version) ttHtml += `<span class="tt-version">v${esc(s.version)}</span>`;
                ttHtml += `</div>`;
                if (s.author) ttHtml += `<div class="tt-author">by ${esc(s.author)}</div>`;
                if (s.description) ttHtml += `<div class="tt-desc">${esc(s.description)}</div>`;
                // Feature tags — scan all modes for active features
                const modes = MODES;
                const hasCSS = modes.some(m => s[m] && s[m].customCSS && s[m].customCssEnabled !== false);
                const hasCanvas = modes.some(m => s[m] && s[m].canvasEnabled && s[m].canvasScript);
                const hasOverrides = modes.some(m => s[m] && ((s[m].overrides && Object.keys(s[m].overrides).length > 0) || (s[m].manualOverrides && s[m].manualOverrides.trim())));
                const hasGradient = modes.some(m => s[m] && s[m].gradientEnabled && s[m].gradientStops && s[m].gradientStops.length > 0);
                const hasTags = hasCSS || hasCanvas || hasGradient || hasOverrides || s.updateUrl;
                if (hasTags) {
                    ttHtml += `<div class="tt-tags">`;
                    if (hasCSS) ttHtml += `<span class="tt-tag tt-tag-css">Custom CSS</span>`;
                    if (hasCanvas) ttHtml += `<span class="tt-tag tt-tag-canvas">Canvas FX</span>`;
                    if (hasGradient) ttHtml += `<span class="tt-tag tt-tag-gradient">Gradient</span>`;
                    if (hasOverrides) ttHtml += `<span class="tt-tag tt-tag-overrides">Overrides</span>`;
                    if (s.updateUrl) ttHtml += `<span class="tt-tag tt-tag-url">Linked</span>`;
                    ttHtml += `</div>`;
                }
                const tooltipHtml = ttHtml.replace(/"/g, '&quot;');

                return `
                <div class="preset-btn ${active ? 'active-theme' : ''}" onclick="loadSnapshot(${i})" data-tooltip-html="${tooltipHtml}">
                    <div class="snapshot-action edit-snapshot" onclick="event.stopPropagation(); requestRename(${i})" data-tooltip="Edit theme">✎</div>
                    <div class="snapshot-action update-snapshot" onclick="event.stopPropagation(); updateSnapshot(${i})" data-tooltip="Overwrite with current values">💾</div>
                    <div class="snapshot-action delete-snapshot" onclick="event.stopPropagation(); requestDelete(${i})" data-tooltip="Delete theme">×</div>
                    <div class="snapshot-action export-snapshot" onclick="event.stopPropagation(); exportSnapshot(${i})" data-tooltip="Export theme">↓</div>
                    ${s.updateUrl ? '<div class="snapshot-action check-update-snapshot" onclick="event.stopPropagation(); checkSingleUpdate(' + i + ')" data-tooltip="Check for update">⟳</div>' : ''}
                    <div class="preset-dots">${renderTonalRampHTML(s[dm], dm)}</div>
                    <span style="font-size: 10px; width: 100%; overflow: hidden; text-overflow: ellipsis; text-align: center; white-space: nowrap; display: block;">${s.name}${s.version ? ' <span style="opacity:0.5;">v' + s.version + '</span>' : ''}</span>
                    <div class="selected-check">✓</div>
                </div>
            `;}).join('');
            
            updateActiveHighlights();
        } catch(e) { console.error("Render snapshots failed", e); }
    }

    let snapshotToDelete = null;
    window.requestDelete = (index) => {
        const snapshots = getSnapshots();
        snapshotToDelete = index;
        document.getElementById('delete-theme-name').innerText = snapshots[index].name;
        showModal('delete-modal');
    };

    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', () => {
            if (snapshotToDelete === null) return;
            const dm = getActiveDataMode();
            const isActuallyActive = activeThemeRef[dm] && activeThemeRef[dm].type === 'snapshot' && activeThemeRef[dm].id === snapshotToDelete;
            const snapshots = getSnapshots();
            snapshots.splice(snapshotToDelete, 1);
            saveSnapshots(snapshots);
            
            hideModal('delete-modal');
            const deletedIndex = snapshotToDelete;
            snapshotToDelete = null;

            if (isActuallyActive) nuclearReset(true);
            else {
                // Adjust activeThemeRef for ALL modes, not just the current one
                MODES.forEach(m => {
                    if (activeThemeRef[m] && activeThemeRef[m].type === 'snapshot') {
                        if (activeThemeRef[m].id === deletedIndex) {
                            activeThemeRef[m] = null;
                        } else if (activeThemeRef[m].id > deletedIndex) {
                            activeThemeRef[m].id--;
                        }
                    }
                });
                renderSnapshots();
            }
        });
    }

    let snapshotToOverwrite = null;
    window.updateSnapshot = (index) => {
        const snapshots = getSnapshots();
        if (snapshots[index]) {
            snapshotToOverwrite = index;
            document.getElementById('overwrite-theme-name').innerText = snapshots[index].name;
            showModal('overwrite-modal');
        }
    };

    const confirmOverwriteBtn = document.getElementById('confirm-overwrite-btn');
    if (confirmOverwriteBtn) {
        confirmOverwriteBtn.addEventListener('click', () => {
            if (snapshotToOverwrite === null) return;
            const index = snapshotToOverwrite;
            const snapshots = getSnapshots();
            if (snapshots[index]) {
                const cleanData = structuredClone(themeData);
                MODES.forEach(m => { if (cleanData[m]) delete cleanData[m].manualOverridesEnabled; });
                snapshots[index] = {
                    ...snapshots[index],
                    ...cleanData
                };

                saveSnapshots(snapshots);
                activeThemeRef[getActiveDataMode()] = { type: 'snapshot', id: index };
                renderSnapshots();
                showToast('Theme Updated!');
            }
            hideModal('overwrite-modal');
            snapshotToOverwrite = null;
        });
    }

    window.loadSnapshot = (index) => {
        showSyncModal('snapshot', index);
    };

    window.saveSnapshot = () => {
        const input = document.getElementById('theme-name-input');
        input.value = `Theme ${new Date().toLocaleTimeString()}`;
        
        // Pre-populate metadata from last saved values or sensible defaults
        const dm = getActiveDataMode();
        const descInput = document.getElementById('theme-desc-input');
        const authorInput = document.getElementById('theme-author-input');
        const versionInput = document.getElementById('theme-version-input');
        const targetInput = document.getElementById('theme-target-input');
        const repoInput = document.getElementById('theme-repo-input');
        const updateInput = document.getElementById('theme-update-input');
        
        // Try to pull metadata from the last saved snapshot or keep defaults
        const lastMeta = Storage.get('metadata', {});
        if (descInput) descInput.value = lastMeta.description || '';
        if (authorInput) authorInput.value = lastMeta.author || '';
        if (versionInput) versionInput.value = lastMeta.version || '1.0.0';
        if (targetInput) targetInput.value = lastMeta.targetVersion || '';
        if (repoInput) repoInput.value = lastMeta.repositoryUrl || '';
        if (updateInput) updateInput.value = lastMeta.updateUrl || '';
        
        showModal('save-modal');
        setTimeout(() => { input.focus(); input.select(); }, 50);
    };

    const confirmSaveBtn = document.getElementById('confirm-save-btn');
    if (confirmSaveBtn) {
        confirmSaveBtn.addEventListener('click', () => {
            try {
                const nameInput = document.getElementById('theme-name-input');
                const name = nameInput.value.trim();
                if (!name) return;
                
              const snapshots = getSnapshots();
              
              // Collect metadata from the expanded save modal
              const metadata = {
                  description: (document.getElementById('theme-desc-input')?.value || '').trim(),
                  author: (document.getElementById('theme-author-input')?.value || '').trim(),
                  version: (document.getElementById('theme-version-input')?.value || '').trim() || '1.0.0',
                  targetVersion: (document.getElementById('theme-target-input')?.value || '').trim(),
                  repositoryUrl: (document.getElementById('theme-repo-input')?.value || '').trim(),
                  updateUrl: (document.getElementById('theme-update-input')?.value || '').trim()
              };
              
              // Persist metadata for pre-population on next save
              Storage.set('metadata', metadata);
              
              const cleanData = structuredClone(themeData);
              MODES.forEach(m => { if (cleanData[m]) delete cleanData[m].manualOverridesEnabled; });
              const newTheme = {
                  name: name,
                  ...metadata,
                  ...cleanData
              };
              snapshots.unshift(newTheme);
              saveSnapshots(snapshots);
              // Since unshift adds at index 0, all existing snapshot refs shift by +1
              MODES.forEach(m => {
                  if (activeThemeRef[m] && activeThemeRef[m].type === 'snapshot') {
                      activeThemeRef[m].id++;
                  }
              });
              activeThemeRef[getActiveDataMode()] = { type: 'snapshot', id: 0 };
              renderSnapshots();
              hideModal('save-modal');
              showToast("Theme Saved!");
            } catch(e) { console.warn('Theme Pro:', e); }
        });
    }


    // --- Unified Preset CRUD Factory (Canvas & CSS) ---
    function setupPresetCRUD({
        presets,             // in-memory array (CANVAS_PRESETS or CSS_PRESETS)
        storageKey,          // localStorage key
        refMap,              // activeCanvasRef or activeCssRef
        enabledKey,          // 'canvasEnabled' or 'customCssEnabled'
        contentKey,          // 'canvasScript' or 'customCSS'
        editorId,            // 'canvas-fx-editor' or 'custom-css-editor'
        saveModalId,         // 'save-canvas-modal' or 'save-css-modal'
        deleteModalId,       // 'delete-canvas-modal' or 'delete-css-modal'
        renameModalId,       // 'rename-canvas-modal' or 'rename-css-modal'
        nameInputId,         // 'canvas-name-input' or 'css-name-input'
        deleteNameId,        // 'delete-canvas-name' or 'delete-css-name'
        renameInputId,       // 'rename-canvas-input' or 'rename-css-input'
        confirmSaveId,       // 'confirm-save-canvas-btn' or 'confirm-save-css-btn'
        confirmDeleteId,     // 'confirm-delete-canvas-btn' or 'confirm-delete-css-btn'
        confirmRenameId,     // 'confirm-rename-canvas-btn' or 'confirm-rename-css-btn'
        presetDataKey,       // 'script' or 'code' (key in preset object)
        defaultName,         // 'Animation' or 'Snippet'
        exportExt,           // '.js' or '.css'
        exportMime,          // 'text/javascript' or 'text/css'
        exportPrefix,        // 'owui-canvas-' or 'owui-css-'
        renderFn,            // renderCanvasPresets or renderCssPresets (name string)
    }) {
        let itemToDelete = null;
        let renameIndex = null;

        const save = () => {
            const input = $(nameInputId);
            input.value = `${defaultName} ${new Date().toLocaleTimeString()}`;
            showModal(saveModalId);
            setTimeout(() => { input.focus(); input.select(); }, 50);
        };

        const confirmSaveBtn = $(confirmSaveId);
        if (confirmSaveBtn) confirmSaveBtn.addEventListener('click', () => {
            try {
                const name = $(nameInputId).value.trim();
                if (!name) return;
                const content = $(editorId) ? $(editorId).value : "";
                if (!content) return;
                presets.push({ name, [presetDataKey]: content });
                Storage.set(storageKey, presets);
                syncLibrary();
                const dm = getActiveDataMode();
                themeData[dm][enabledKey] = true;
                themeData[dm][contentKey] = content;
                refMap[dm] = presets.length - 1;
                commitChange({ clearRef: false });
                hideModal(saveModalId);
                showToast(`${defaultName} Saved!`);
            } catch(e) { console.warn('Theme Pro:', e); }
        });

        const requestDelete = (index) => {
            itemToDelete = index;
            $(deleteNameId).innerText = presets[index].name;
            showModal(deleteModalId);
        };

        const confirmDeleteBtn = $(confirmDeleteId);
        if (confirmDeleteBtn) confirmDeleteBtn.addEventListener('click', () => {
            if (itemToDelete === null) return;
            presets.splice(itemToDelete, 1);
            Storage.set(storageKey, presets);
            syncLibrary();
            hideModal(deleteModalId);
            let needsInject = false;
            // Adjust refs for ALL modes, not just the current one
            MODES.forEach(m => {
                if (refMap[m] === itemToDelete) {
                    themeData[m][enabledKey] = false;
                    themeData[m][contentKey] = "";
                    refMap[m] = null;
                    needsInject = true;
                } else if (refMap[m] !== null && refMap[m] > itemToDelete) {
                    refMap[m]--;
                }
            });
            if (needsInject) {
                commitChange({ clearRef: false });
            } else {
                window[renderFn]();
                pushState();
            }
            itemToDelete = null;
        });

        const requestRename = (index) => {
            renameIndex = index;
            const input = $(renameInputId);
            input.value = presets[index].name;
            showModal(renameModalId);
            setTimeout(() => input.focus(), 100);
        };

        const confirmRenameBtn = $(confirmRenameId);
        if (confirmRenameBtn) confirmRenameBtn.addEventListener('click', () => {
            const newName = $(renameInputId).value.trim();
            if (newName && renameIndex !== null) {
                presets[renameIndex].name = newName;
                Storage.set(storageKey, presets);
                syncLibrary();
                window[renderFn]();
            }
            hideModal(renameModalId);
        });

        const update = (index) => {
            const content = $(editorId) ? $(editorId).value : "";
            if (!content) return;
            presets[index][presetDataKey] = content;
            Storage.set(storageKey, presets);
            syncLibrary();
            const dm = getActiveDataMode();
            refMap[dm] = index;
            themeData[dm][contentKey] = content;
            commitChange({ clearRef: false });
            showToast(`${defaultName} Overwritten!`);
        };

        const exportItem = (index) => {
            const p = presets[index];
            downloadFile(p[presetDataKey], `${exportPrefix}${p.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}${exportExt}`, exportMime);
            showToast(`${defaultName} exported!`);
        };

        return { save, requestDelete, requestRename, update, export: exportItem };
    }

    // Canvas Presets
    const canvasCRUD = setupPresetCRUD({
        presets: CANVAS_PRESETS, storageKey: 'owui_canvas_presets', refMap: activeCanvasRef,
        enabledKey: 'canvasEnabled', contentKey: 'canvasScript', editorId: 'canvas-fx-editor',
        saveModalId: 'save-canvas-modal', deleteModalId: 'delete-canvas-modal', renameModalId: 'rename-canvas-modal',
        nameInputId: 'canvas-name-input', deleteNameId: 'delete-canvas-name', renameInputId: 'rename-canvas-input',
        confirmSaveId: 'confirm-save-canvas-btn', confirmDeleteId: 'confirm-delete-canvas-btn', confirmRenameId: 'confirm-rename-canvas-btn',
        presetDataKey: 'script', defaultName: 'Animation', exportExt: '.js', exportMime: 'text/javascript',
        exportPrefix: 'owui-canvas-', renderFn: 'renderCanvasPresets',
    });
    window.saveCanvasSnapshot = canvasCRUD.save;
    window.requestCanvasDelete = canvasCRUD.requestDelete;
    window.requestCanvasRename = canvasCRUD.requestRename;
    window.updateCanvasSnapshot = canvasCRUD.update;
    window.exportCanvasSnapshot = canvasCRUD.export;

    // CSS Presets
    const cssCRUD = setupPresetCRUD({
        presets: CSS_PRESETS, storageKey: 'owui_css_presets', refMap: activeCssRef,
        enabledKey: 'customCssEnabled', contentKey: 'customCSS', editorId: 'custom-css-editor',
        saveModalId: 'save-css-modal', deleteModalId: 'delete-css-modal', renameModalId: 'rename-css-modal',
        nameInputId: 'css-name-input', deleteNameId: 'delete-css-name', renameInputId: 'rename-css-input',
        confirmSaveId: 'confirm-save-css-btn', confirmDeleteId: 'confirm-delete-css-btn', confirmRenameId: 'confirm-rename-css-btn',
        presetDataKey: 'code', defaultName: 'Snippet', exportExt: '.css', exportMime: 'text/css',
        exportPrefix: 'owui-css-', renderFn: 'renderCssPresets',
    });
    window.saveCssSnapshot = cssCRUD.save;
    window.requestCssDelete = cssCRUD.requestDelete;
    window.requestCssRename = cssCRUD.requestRename;
    window.updateCssSnapshot = cssCRUD.update;
    window.exportCssSnapshot = cssCRUD.export;
    // Initialize (toolbars and icons already hydrated at L2486-2487)
    setupDelegation();
    commitChange({ clearRef: false, snapshots: true }); // Seed undo history with initial state

    // Forward mousemove events to parent window for Canvas FX mouse tracking.
    // Iframes capture mouse events in their own window — they don't bubble to parent.
    // This bridge ensures Canvas FX animations respond to mouse movement even when
    // the cursor is over this tool's iframe (including transparent empty areas).
    // clientX/clientY are iframe-local, so we offset by the iframe's position in the parent.
    document.addEventListener('mousemove', (e) => {
        try {
            const frame = window.frameElement;
            let ox = 0, oy = 0;
            if (frame) { const r = frame.getBoundingClientRect(); ox = r.left; oy = r.top; }
            window.parent.postMessage({ type: 'owui-canvas-mousemove', x: e.clientX + ox, y: e.clientY + oy }, '*');
        } catch(ex) { console.warn('Theme Pro:', ex); }
    });

</script>
</body>
</html>"""

        # Extract JS body from BOOTLOADER_SCRIPT (strip HTML tags/comment)
        bootloader_js = _re.sub(
            r"^\s*<!--.*?-->\s*<script[^>]*>\s*|\s*</script>\s*$",
            "",
            self.BOOTLOADER_SCRIPT.strip(),
            flags=_re.DOTALL,
        )

        # Build valve config for frontend injection
        valve_config = {
            "themeActive": self.valves.theme_active,
            "enableCanvasFx": self.valves.enable_canvas_fx,
            "enableUrlImport": self.valves.enable_url_import,
            "allowedImportDomains": [
                d.strip()
                for d in self.valves.allowed_import_domains.split(",")
                if d.strip()
            ],
            "enableCustomCss": self.valves.enable_custom_css,
            "enableAuthPageTheming": self.valves.enable_auth_page_theming,
            "enableGradientBuilder": self.valves.enable_gradient_builder,
            "draftModeDefault": self.valves.draft_mode_default,
        }
        config_tag = (
            '<script id="owui-valve-config">'
            f"window.__THEME_PRO_CONFIG__={_json.dumps(valve_config)};"
            "</script>"
        )

        route_base = self._get_route_base()

        final_html = (
            html_content.replace("{VERSION}", VERSION)
            .replace("{BOOTLOADER_SRC}", bootloader_js)
            .replace("{ROUTE_BASE}", route_base)
            .replace("</head>", config_tag + "</head>")
            .strip()
        )

        return final_html

    # -- entry point ---------------------------------------------------------

    _injected = False  # Class-level flag to avoid re-injecting on every event
    _last_theme_active = None  # Track valve state to detect changes
    _last_designer_url = None  # Track URL changes to re-register routes
    _last_enable_canvas_fx = None  # Track Canvas FX valve to broadcast changes
    _sse_clients: list = (
        []
    )  # Active SSE connections — aliased to app.state in _register_route()

    @staticmethod
    def _strip_canvas_from_state(state_str: str) -> str:
        """Strip canvasEnabled/canvasScript/canvasShowAuth from state JSON.

        Used to enforce the Enable Canvas FX valve at the delivery layer
        without modifying the saved state on disk (preserves user presets).
        """
        import json as _json

        try:
            data = _json.loads(state_str)
            for mode in ("dark", "oled", "light", "her"):
                if isinstance(data.get(mode), dict):
                    data[mode]["canvasEnabled"] = False
                    data[mode].pop("canvasScript", None)
                    data[mode].pop("canvasShowAuth", None)
            return _json.dumps(data, separators=(",", ":"))
        except Exception:
            return state_str

    @classmethod
    def _broadcast_update(cls, css="", state=""):
        """Push a theme-update event with inline data to all connected SSE clients."""
        import json

        payload = json.dumps({"css": css, "state": state}, separators=(",", ":"))
        msg = f"event: theme-update\ndata: {payload}\n\n"
        for q in list(cls._sse_clients):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                pass  # Drop if client is backed up

    @classmethod
    def _broadcast_disable(cls):
        """Push a theme-disable event to all SSE clients (strip theme + reload)."""
        msg = "event: theme-disable\ndata: disable\n\n"
        for q in list(cls._sse_clients):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                pass

    async def event(
        self,
        event: dict,
        __event_name__: str = None,
        __app__=None,
        **kwargs,
    ) -> None:
        # Detect if the designer_url valve has changed since last run
        url_changed = (
            Event._last_designer_url is not None
            and Event._last_designer_url != self.valves.designer_url
        )

        # Always register routes (guard prevents duplicates; re-registers on URL change)
        if __app__ is not None:
            self._register_route(__app__)

        # Detect if the theme_active valve has changed since last run
        valve_changed = (
            Event._last_theme_active is not None
            and Event._last_theme_active != self.valves.theme_active
        )

        # Detect if the enable_canvas_fx valve has changed since last run
        canvas_valve_changed = (
            Event._last_enable_canvas_fx is not None
            and Event._last_enable_canvas_fx != self.valves.enable_canvas_fx
        )

        # Inject bootloader + theme CSS on first event, startup, OR valve change.
        # Since POST handler no longer writes to index.html, event() is the sole writer.
        # Always run injection — the while-loop stripping makes it idempotent.
        should_inject = (
            __event_name__ == "system.startup.completed"
            or not Event._injected
            or valve_changed
            or canvas_valve_changed
            or url_changed
        )

        if should_inject:
            if not self.valves.theme_active:
                # Theme toggled OFF: strip CSS + state from index.html, leave CSS file intact.
                # KEEP the bootloader in index.html — it maintains the SSE connection
                # so that when theme is re-enabled, the broadcast reaches all clients.
                # The /theme.css and /state.json endpoints return 204 while inactive,
                # so the bootloader won't apply a stale theme on page loads.
                self._strip_theme_css_from_index()
                # Push disable to all connected clients so they strip theme + reload
                Event._broadcast_disable()
                log.info(
                    "[Theme Pro] Theme is inactive — CSS stripped, clients notified (bootloader retained for SSE)"
                )
            else:
                # Theme is active — strip old bootloader first (URL may have changed), then re-inject
                idx = self._find_index_file()
                if idx and url_changed:
                    try:
                        with Event._get_index_lock():
                            with open(idx, "r", encoding="utf-8") as f:
                                content = f.read()
                            cleaned = self._strip_bootloader(content)
                            if cleaned != content:
                                with open(idx, "w", encoding="utf-8") as f:
                                    f.write(cleaned)
                    except Exception as e:
                        log.warning(
                            "[Theme Pro] Could not strip bootloader for URL change: %s",
                            e,
                        )
                self._inject_bootloader()
                self._inject_theme_css()
                # If theme was just re-enabled, push the saved theme to all SSE clients
                if valve_changed:
                    css = self._load_css() or ""
                    state = self._load_state() or ""
                    Event._broadcast_update(css, state)
                    log.info("[Theme Pro] Theme re-enabled — pushed to SSE clients")
                # If Canvas FX valve changed, re-broadcast state so clients update immediately
                if canvas_valve_changed:
                    css = self._load_css() or ""
                    state = self._load_state() or ""
                    # Strip canvas data from broadcast if Canvas FX is now disabled
                    if not self.valves.enable_canvas_fx:
                        state = self._strip_canvas_from_state(state)
                    Event._broadcast_update(css, state)
                    log.info(
                        "[Theme Pro] Canvas FX valve changed to %s — re-broadcast to SSE clients",
                        self.valves.enable_canvas_fx,
                    )
                log.info("[Theme Pro] Injection tasks completed")

            Event._injected = True

        # Always track the current valve state for next comparison
        Event._last_theme_active = self.valves.theme_active
        Event._last_designer_url = self.valves.designer_url
        Event._last_enable_canvas_fx = self.valves.enable_canvas_fx

