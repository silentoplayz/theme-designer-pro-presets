/* Theme Designer Pro site: the page's own palette.
   Loaded in <head> before the stylesheet paints, so a visitor's chosen hue
   shows on first paint. Every site color is derived in site.css from --h and
   --c, the same hue and chroma the designer works in. */
(function () {
  'use strict';

  var KEY = 'tdp-site-palette';
  var DEFAULT = { h: 265, c: 24 };
  var root = document.documentElement;

  function clamp(v, lo, hi, fallback) {
    v = Number(v);
    return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
  }

  function read() {
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved) return { h: clamp(saved.h, 0, 360, DEFAULT.h), c: clamp(saved.c, 0, 80, DEFAULT.c) };
    } catch (e) {}
    return { h: DEFAULT.h, c: DEFAULT.c };
  }

  // Site neutrals keep a lower chroma than the designer would, so text stays
  // readable at any setting; the accent carries the color.
  function apply(p) {
    root.style.setProperty('--h', String(p.h));
    root.style.setProperty('--c', String(Math.min(p.c, 50) / 1000));
  }

  var current = read();
  apply(current);

  window.TDPSite = {
    DEFAULT: DEFAULT,
    get: function () { return { h: current.h, c: current.c }; },
    set: function (p, persist) {
      current = { h: clamp(p.h, 0, 360, current.h), c: clamp(p.c, 0, 80, current.c) };
      apply(current);
      if (persist !== false) {
        try { localStorage.setItem(KEY, JSON.stringify(current)); } catch (e) {}
      }
      document.dispatchEvent(new CustomEvent('tdp-palette', { detail: current }));
    },
    reset: function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
      this.set(DEFAULT, false);
    },
  };
})();
