#!/usr/bin/env node

/**
 * The JavaScript half of golden.py
 *
 * golden.py reads the designer script and the bootloader out of the function
 * file, split into their top-level declarations, and hands them here with the
 * themes to run them on. This loads them into a blank page in headless Chrome
 * (a real canvas and CSS parser, which the color helpers need) and writes
 * what each function returns.
 *
 * Only declarations are loaded: the designer's top-level statements that
 * build the page (event listeners, rendering) are left out, and so are the
 * bootloader's. The designer's declarations run in their own order, each as
 * its own script, so one whose initializer needs the designer page fails
 * alone. The bootloader's are wrapped in a closure as they are in the IIFE,
 * with the four functions enforceTheme calls only for their effect on the
 * live page replaced by no-ops.
 *
 * Usage (golden.py runs it): node golden-harness.js <job.json> <out.json>
 */

const fs = require('fs');

const ORIGIN = 'http://golden.test';

// ── In the page ──

// Loads the designer's declarations, then the bootloader's closure
function load(job) {
  const errors = [];
  window.addEventListener('error', (e) => { errors.push({ message: e.message, line: e.lineno }); });
  const run = (code, label) => {
    const before = errors.length;
    const s = document.createElement('script');
    s.textContent = code;
    document.head.appendChild(s);
    s.remove();
    return errors.length === before ? null : `${label}: ${errors[errors.length - 1].message}`;
  };
  const failed = [];
  run(job.config, 'config');
  const fns = job.designer.filter((d) => d.kind === 'function' || d.kind === 'class');
  const err = run(fns.map((d) => d.code).join('\n'), 'designer functions');
  if (err) throw new Error(err);
  job.designer.filter((d) => !fns.includes(d)).forEach((d) => {
    const e = run(d.code, `${d.names.join(', ')} (function file line ${d.line})`);
    if (e) failed.push({ names: d.names, error: e });
  });
  const vars = job.bootloader.filter((d) => d.kind !== 'function').flatMap((d) => d.names);
  const boot = [
    'window.__boot = (function() {',
    ...job.bootloader.map((d) => d.code),
    ...job.bootStubbed.map((n) => `function ${n}() {}`),
    `return { ${job.bootFunctions.join(', ')}, set: function(o) { ${vars.map((v) => `if ('${v}' in o) ${v} = o.${v};`).join(' ')} } };`,
    '})();'
  ].join('\n');
  const be = run(boot, 'bootloader');
  if (be) throw new Error(be);
  return failed;
}

function attempt(fn) {
  try { return fn(); } catch (e) { return { threw: `${e.name}: ${e.message}` }; }
}

const REFS = { dark: { type: 'snapshot', id: 0 }, oled: { type: 'snapshot', id: 0 }, light: { type: 'snapshot', id: 0 }, her: { type: 'snapshot', id: 0 } };
const HIDDEN = {
  models: { 'model-a': 0, 'model-b': 40 }, folders: ['folder-a'], chat: 60, behind: false, dimming: 50,
  auth: { url: '/api/v1/theme-designer/auth-background?v=1', share: 80 }, pages: { source: 'chat', share: 30 }
};

// One theme file, imported the way the designer imports a file with dark
// and light modes (handleFilesImport), then everything derived from it
function designerTheme(t) {
  const data = structuredClone(t.data);
  delete data._meta;
  const theme = {
    name: data.name || t.file.replace('.json', ''),
    description: data.description || '', author: data.author || '', version: data.version || '1.0.0',
    targetVersion: data.targetVersion || '', repositoryUrl: data.repositoryUrl || '', updateUrl: data.updateUrl || '',
    dark: data.dark, light: data.light, oled: data.oled || null, her: data.her || null
  };
  ensureAllModes(theme);
  MODES.forEach((m) => { theme[m] = normalizeModeData(theme[m]); });
  themeData = structuredClone({ dark: theme.dark, light: theme.light, oled: theme.oled, her: theme.her });

  const sections = generateThemeSections();
  const css = generateCoreCSS();
  const hidden = readHiddenBackgrounds(HIDDEN);
  const state = JSON.stringify({
    ...themeData, _activeThemeRef: REFS, _activeCanvasRef: createNullModeMap(), _activeCssRef: createNullModeMap(),
    _activeGradientRef: createNullModeMap(), ...(hasHiddenBackgrounds(hidden) ? { _hiddenBackgrounds: hidden } : {})
  });
  const modes = {};
  for (const m of MODES) {
    const config = themeData[m];
    const shipped = _shippedVars(config, m);
    const contrast = _contrastPairs(m).map((p) => {
      const fg = _resolveReportColor(shipped.vars[p.fg]), bg = _resolveReportColor(shipped.vars[p.bg]);
      const ratio = fg && bg ? contrastRatio(fg, bg) : NaN;
      return { label: p.label, fg, bg, ratio: isFinite(ratio) ? ratio.toFixed(2) : null, verdict: contrastVerdict(ratio) };
    });
    modes[m] = {
      variables: getVariablesMap(config),
      base: baseScaleVars(shipped.vars, config, m),
      accents: accentVars(config, m),
      shipped: { overridden: shipped.overridden, usingDefaults: shipped.usingDefaults, vars: shipped.vars },
      contrast,
      washedOut: detectWashedOut(m, shipped.vars),
      gradient: buildGradientCss(config, '.scope'),
      canvasSettings: config.canvasScript ? parseSettings(config.canvasScript) : []
    };
  }
  const snapshot = normalizeSnapshot(structuredClone(theme));
  return {
    imported: theme,
    normalizeSnapshot: JSON.stringify(snapshot) === JSON.stringify(theme) ? 'same as imported' : snapshot,
    isThemeDuplicate: isThemeDuplicate(theme, [snapshot]),
    defaultModeData: DEFAULT_MODE_DATA,
    sections, coreCssIsAssembled: css === assembleThemeCss(sections), css, state,
    modes
  };
}

// Theme-independent cases for the designer's sanitizers, validators and
// parsers, with the hostile values the code comments name
function designerUnits(themes) {
  const values = [undefined, null, '', ' ', 0, -1, 1.5, NaN, Infinity, '12', ' 7 ', 'abc', true, false, [], {}, [1], { a: 1 },
    '#fff', '#FFAA00', '#12345', 'rgb(1, 2, 3)', 'rgb(', 'oklch(0.5 0.1 200)', 'var(--x)', 'url(x)', 'image-set(x)',
    'red; } body { color: red', 'a'.repeat(65), '\n', 'color-mix(in srgb, red 50%, transparent)'];
  const each = (fn) => values.map((v) => [v === undefined ? 'undefined' : v, attempt(() => fn(v))]);
  const out = {};
  out._cssTok = each((v) => _cssTok(v, 'FALLBACK'));
  out._cssTok_default = each((v) => _cssTok(v));
  out._toFiniteNumber = each(_toFiniteNumber);
  out._cssNum = each((v) => _cssNum(v, 42));
  out._num = each((v) => _num(v, 0, 100, 50));
  out._accentHex = each(_accentHex);
  out._escAttr = each(_escAttr);
  out._objArr = each(_objArr);
  out.hexToRgba = each((v) => hexToRgba(v, 0.5));
  out.adjustHexIntensity = each((v) => [adjustHexIntensity(v, 50), adjustHexIntensity(v, 150), adjustHexIntensity(v, null)]);
  out._resolveReportColor = each(_resolveReportColor);
  out._resolveReportColor_hexForms = ['#abcd', '#ABCD', '#a1b2c3d4', '#a1b2c3', '#abc', '#abcde', '#a1b2c3d'].map((s) => { const hex = _resolveReportColor(s); return [s, hex, hex ? contrastRatio(hex, '#ffffff').toFixed(2) : null]; });
  out.getEffectiveLightness = each(getEffectiveLightness);
  out._parensBalanced = ['', '()', '(()', ')(', 'a(b)c', '((a)(b))'].map((s) => [s, _parensBalanced(s)]);
  out.parseHex = ['#000000', '#ffffff', '123456', '#abc'].map((s) => [s, parseHex(s)]);
  out.oklchToHex = ['#abc', '#a1b2c3', 'oklch(0.5 0.1 200)', 'oklch(0.98 0 0)', 'rgb(10 20 30)', 'oklch(0.2 0.05 250 / 0.5)'].map((s) => [s, oklchToHex(s)]);
  out.contrastRatio = [['#000000', '#ffffff'], ['#777777', '#888888'], ['#123456', '#fedcba'], ['nope', '#ffffff']].map(([a, b]) => [a, b, contrastRatio(a, b)]);
  out._overrideDecls = ['', '/* c */', '// c', '--a: red', '--a: red; --b: blue', '--a: red !important', '--a: red /* c */',
    '--a: red /* open', '--a: url("data:image/png;base64,xx")', '--a: rgb(1, 2', '--a: [x', '--a: "x;y"; --b: 1',
    'color: red', '--a: { }', '--a:', '--a: /*[OWUI_VARS_END]*/', '--a: /*[FX]*/ red', '--a: 1; color: red; --b: 2', '--a: "unclosed',
    '--a"/*[OWUI_CLEAR_CANVAS_START]*/": red', "--a'/*[OWUI_CLEAR_CANVAS_END]*/':red", '--a\\:b: red', '--ü-x_1: red'].map((s) => [s, _overrideDecls(s)]);
  // A chat theme's custom CSS: what reaches a browser that fetches, spelled every way, and the data: URLs that may stay
  out.chatCssProblem = ['', '#sidebar { color: red }', 'body{background:url(https://evil.test/a.png)}', 'body{background:u\\72l(https://evil.test/b.png)}',
    'body{background-image:image-set("https://evil.test/c.png" 1x)}', '@\\69mport "https://evil.test/d.css";', '@font-face{src:\\75rl(https://evil.test/e.woff)}',
    'body{background:u\\72\r\nl(https://evil.test/f.png)}', 'body{background-image:-webkit-image-set("https://evil.test/g.png" 1x)}',
    'body{--u:"https://evil.test/h.png";background-image:image-set(var(--u) 1x)}', 'body{content:"/*";background:url(https://evil.test/i.png);content:"*/"}',
    'body{background-image:image-set("\\22" 1x, var(--u) 2x)}', 'body{background:url("data:image/png;base64,iVBORw0KGgo=")}', 'body{background:url(data:image/png;base64,iVBORw0KGgo=)}',
    'body{background:url("data:image/svg+xml,%3Csvg/%3E")}', 'body{background-image:image-set("data:image/png;base64,AA" 1x, url("data:image/png;base64,AA") 2x, linear-gradient(red, blue) 3x)}',
    "@font-face{font-family:x;src:url('data:font/woff2;base64,AAAA') format('woff2'), local(Arial)}", '/* url(https://x) @import */ .a{b:c}',
    'a{b:expression(alert(1))}', '</style><script>',
    '.x{--a:\\/*}body{background:url(//h/t1)}', '.x{a:\\"}.y{content:"/*"}body{background:url(//h/t2)}', ".x{a:\\'}.y{content:'/*'}body{background:url(//h/t3)}",
    '.z{a:\\/*}@font-face{font-family:q;src:url(//h/m3)}', 'body{background:url( "data:image/png;base64,AA")}', 'a{b:"open', 'a{b:c} /* open',
    // An unquoted url(data:x and a space is a broken url token, which the browser skips to the next ), so only quoted data: URLs pass
    'a{b:url(data:x /* ) } body{background:url(//h/r1)} */ }', 'a{b:url(data:x\n/* ) } body{background:url(//h/r4)} */ }',
    'a{b:u\\72l(data:x /* ) } body{background:url(//h/r5)} */ }', 'a{b:URL(data:x /* ) } body{background:url(//h/r6)} */ }',
    'a{b:image-set("data:x" 1x)} c{d:url(data:y /* ) } body{background-image:image-set("//h/r7" 1x)} */ }'].map((s) => [s, chatCssProblem(s)]);
  // An install link's import: every theme and CSS snippet it adds, the manual overrides too, and the text as a stylesheet only for a CSS preset
  const linkMode = (customCSS, manualOverrides = '') => ({ customCSS, customCssEnabled: false, manualOverrides, manualOverridesEnabled: false });
  const linkTheme = (css, overrides) => ({ name: 'n', dark: linkMode(css, overrides), light: linkMode('') });
  out.linkedImportProblem = [
    [linkTheme('@import url(https://example.invalid/x.css);'), false], [linkTheme('body{background:u\\72l(//h/a)}'), false],
    [linkTheme('a{b:url(data:x /* ) } body{background:url(//h/b)} */ }'), false], [linkTheme('', '--a: url(https://example.invalid/o.png)'), false],
    [linkTheme('#s{background:url("data:image/png;base64,AA")}', '--a: #123456\n--b: url("data:image/png;base64,AA")'), false],
    [{ ...linkTheme(''), isLibraryBackup: true, themes: [null, { h: 1 }, linkTheme('@import "//h/c";')] }, false],
    [{ ...linkTheme('@import "//h/d";'), isLibraryBackup: true, themes: [linkTheme('')] }, false],
    [{ isCssBackup: true, css_presets: [null, { code: 5 }, { name: 's', code: 'a{b:url(//h/e)}' }] }, false],
    // A dark or light mode that isn't an object: no theme is imported, so there is nothing to refuse (themeFromFile below)
    [{ name: 'a', dark: { customCSS: '@import url(//h/g);', customCssEnabled: true }, light: true }, false],
    [{ name: 'a', dark: { customCSS: '@import url(//h/g);', customCssEnabled: true }, light: 'x' }, false],
    [{ name: 'a', dark: 1, light: { customCSS: '@import url(//h/g);', customCssEnabled: true } }, false],
    [{ name: 'a', dark: { manualOverrides: '--a: url(//h/h)', manualOverridesEnabled: true }, light: true }, false],
    [{ ...linkTheme(''), oled: 'x', her: linkMode('@import "//h/i";') }, false],
    [{ ...linkTheme(''), isLibraryBackup: true, themes: [{ h: 1, dark: linkMode('@import "//h/j";'), light: true }, { ...linkTheme(''), her: true, oled: linkMode('@import "//h/k";') }] }, false],
    ['@import "//h/f";', true], ['@import "//h/f";', false], ['a{b:c}', true], ['not json', false], ['5', true]
  ].map(([v, isCss]) => [v, isCss, linkedImportProblem(typeof v === 'string' ? v : JSON.stringify(v), isCss)]);
  // The one builder behind both the import and the check: a mode that isn't an object is refused, a missing or broken oled or her filled in
  out.themeFromFile = [null, {}, { dark: {}, light: true }, { dark: 'x', light: {} }, { dark: [], light: {} }, { name: 'n', dark: { l: 30 }, light: { l: 90 }, oled: 5, her: 'x' }]
    .map((d) => [structuredClone(d), themeFromFile(d, 'file')]);
  out.themeFromEntry = [null, { h: 10 }, { h: 10, dark: {}, light: true }, { dark: {}, light: true }, { name: 'e', dark: { l: 30 }, light: { l: 90 }, her: { l: 0 } }]
    .map((d) => [structuredClone(d), themeFromEntry(d)]);
  // Every shipped theme and fixture can still be installed by link
  out.linkedImportProblem_shipped = themes.map((t) => [t.file, linkedImportProblem(JSON.stringify(t.data))]).filter(([, p]) => p);
  // Auto-Scope's rewrites: a removed @keyframes leaves a space, and :root or html in a string or url token stays
  out.buildCustomCss = ['body{background:u@keyframes a{}rl(//h/t4)}', 'body{background:url("data:root/../../t6")}', 'body{background:url(data:root/../t7)}',
    ':root { --a: 1 } html.dark a { b: c } @keyframes k { to { x: 1 } }', 'a{content:":root html"} /* :root */ b{c:d}', 'body{background:u\u0001rl(//h/r8)}',
    '#sidebar { /*[FX]*/ background-color: var(--my-side) !important; }'].flatMap((css) =>
    [true, false].map((autoScope) => [css, autoScope, buildCustomCss({ customCSS: css, autoScope }, 'html.dark')]));
  out.extractKeyframes = ['', '@keyframes a { from { x: 1 } to { x: 2 } } .b { c: d }', '/* @keyframes x { */ .a { b: c }',
    '@keyframes open {', '"@keyframes" .a{} @keyframes z{0%{a:b}}', '.a{b:\\"} @keyframes z{to{a:b}} .c{d:e}', '.a{b:\\{} @keyframes y{to{a:b}}'].map((s) => [s, extractKeyframes(s)]);
  out.getDarkestStop = [[], [{ color: '#ffffff' }, { color: '#000000' }], [{ color: 'rgb(0,0,0)' }, { color: '#111111' }], [{ color: 'var(--x)' }]].map((s) => [s, getDarkestStop(s)]);
  out.minifyCss = ['/* c */ .a {\n  color: red;\n}\n\n.b  { x : y; }'].map((s) => [s, minifyCss(s)]);
  out.DEFAULT_MODE_DATA = [DEFAULT_MODE_DATA];
  out.createDefaultModeData = [createDefaultModeData({ l: 0, overrides: { a: 1 } })];
  // The designer page's own colours at every 5 of Lightness, measured: text
  // and muted text need 4.5:1 on the page, its panels and the dialogs, the
  // accent 3:1 there (focus rings, borders) and 4.5:1 on the page where it can
  out.designerChromeColors = MODES.flatMap((m) => Array.from({ length: 21 }, (_, i) => i * 5).map((l) => {
    const c = designerChromeColors(m, _shippedVars(createDefaultModeData({ l }), m).vars);
    const r = (x) => x.toFixed(2);
    const b = c.backgrounds;
    const below = [[c.textMain.ratio, CHROME_TEXT_MIN, 'text'], [c.textMuted.ratio, CHROME_TEXT_MIN, 'muted'], [c.accent.ratio, CHROME_INDICATOR_MIN, 'accent'],
      [c.knob.ratio, CHROME_INDICATOR_MIN, 'switch knob']]
      .filter(([ratio, min]) => !(ratio >= min)).map(([, , name]) => name);
    return [m, l, `page ${b.deep}, panel ${b.panel}, dialog ${b.surface}${b.elevated ? `, raised ${b.elevated}` : ''}, tint ${c.tint}`
      + ` | text ${c.textMain.hex} ${r(c.textMain.ratio)} | muted ${c.textMuted.hex} ${r(c.textMuted.ratio)}`
      + ` | accent ${c.accent.hex} ${r(c.accent.ratio)}, as text ${r(c.accent.textRatio)}, knob ${c.knob.hex} ${r(c.knob.ratio)} | ${below.length ? 'BELOW TARGET: ' + below.join(', ') : 'meets targets'}`];
  }));
  out.generatedAccent = MODES.flatMap((m) => [[m, generatedAccent({ h: 200, c: 30 }, m, 40)], [m, generatedAccent({ h: 'x', c: 30, paletteEnabled: false }, m, -40)]]);
  out.getDefaultColorForStep = MODES.map((m) => [m, steps.map((s) => getDefaultColorForStep(m, s))]);
  out.validateModeData = [
    {}, { h: 999, c: -5, l: '50', gradientAngle: null, gradientAnimationSpeed: 0, surfaceSidebarBlur: 99 },
    { gradientType: 'spiral', gradientRadialShape: 'square', gradientRadialSize: 'huge' },
    { paletteEnabled: 0, customCssEnabled: 'yes', canvasEnabled: 1, customCSS: 5, canvasScript: {}, manualOverrides: [] },
    { accent: '#ABCDEF', accent2: 'red', accent3: '#abc', gradientMeshBgColor: 'url(x)' },
    { overrides: { '--color-gray-50': '#fff', 'color': 'red', '--x': 'url(evil)', '--y': 5, ['--' + 'z'.repeat(70)]: '#000' } },
    { overrides: [], locks: { a: 1, b: 0 } }, { locks: 'x' },
    { gradientStops: [null, 'x', { color: 'url(x)', position: 200 }, { color: '#123456', position: '10' }] },
    { gradientStops: 'x', gradientMeshPoints: [{ color: '#fff', x: -1, y: 500, spread: 'a' }, 7] },
    { gradientStops: Array.from({ length: 40 }, (_, i) => ({ color: '#000000', position: i })) }
  ].map((d) => [structuredClone(d), validateModeData(d)]);
  out.normalizeModeData = [
    null, { oklch: { hue: 10, chroma: 20, lightness: 30 } }, { oklch: {} }, { locks: ['--a', '--b'] },
    { variables: { x: 1 }, h: 5 }, { manualOverrides: '--a: red' }, { manualOverrides: '  ' },
    { manualOverrides: '--a: red', manualOverridesEnabled: false }
  ].map((d) => [structuredClone(d), normalizeModeData(d)]);
  out.sanitizeGradientPreset = [null, {}, { name: 'x' }, { name: 'a'.repeat(130), stops: [{ color: '#fff', position: 5 }] },
    { name: 'm', type: 'mesh', meshPoints: [{ color: 'x(', x: 1, y: 2, spread: 99 }], angle: 'z', speed: 1 },
    { name: 'r', type: 'radial', radialShape: 'circle', radialSize: 'closest-side', stops: [null, { color: '#000' }] }
  ].map((p) => [p, sanitizeGradientPreset(p)]);
  // A preset without a usable name is named by its place, like a code preset
  out.sanitizeGradientPreset_unnamed = [{ stops: [] }, { name: ' ', stops: [] }, { name: 7, stops: [] }, { name: { a: 1 }, meshPoints: [] }, { name: ' n ', stops: [] }]
    .map((p, i) => [p, i, sanitizeGradientPreset(p, i)]);
  out.sanitizeGradientPresets = [null, [null, { name: 'x', stops: [] }], [{ name: 'a', stops: [] }, { stops: [] }, { name: '', meshPoints: [] }]].map((p) => [p, sanitizeGradientPresets(p)]);
  // A Canvas FX or CSS preset from an import or the server: dropped only when it isn't an object or its code isn't text;
  // a missing or unusable name is repaired, a valid preset comes back as it was
  out.sanitizeCodePreset = [null, 'x', [], {}, { name: 7, script: 'a()' }, { name: ' ', script: 'a()' }, { script: 'a()' }, { name: { a: 1 }, script: 'a()' },
    { name: 'n' }, { name: 'n', script: 5 }, { name: 'n', script: 'a()', settings: { speed: 2 } }, { name: 'n', code: '' }, { name: 'n', code: { x: 1 } }]
    .flatMap((p) => ['script', 'code'].map((k) => [p, k, sanitizeCodePreset(p, k, 'Fallback')]));
  out.sanitizeCodePreset_sameObject = [{ name: 'n', script: 'a()', settings: {} }].map((p) => sanitizeCodePreset(p, 'script', 'F') === p);
  out.sanitizeCodePresets = [null, [null, { name: 'n', script: 'a()' }, { name: 'm', script: 1 }, { name: '', script: 'b()' }]].map((p) => [p, sanitizeCodePresets(p, 'script', 'Animation')]);
  // An entry saved before locks existed keeps its overrides locked
  out.sanitizeSnapshotList = [null, [null, { dark: { h: 999 }, light: 'x' }],
    [{ dark: { overrides: { '--color-gray-900': '#101010' } }, light: { overrides: { '--color-gray-50': '#fafafa' }, locks: {} } }]].map((p) => [structuredClone(p), sanitizeSnapshotList(p)]);
  // A theme without Dark fills OLED and Her from its Light, as Selective Sync does
  out.ensureAllModes = [{}, { light: { l: 90 } }, { dark: { l: 20 } }, { dark: { l: 20 }, light: { l: 90 } }, { dark: { l: 20 }, oled: { l: 3 }, her: { l: 4 } }].map((d) => [structuredClone(d), ensureAllModes(d)]);
  out.migrateLegacyTheme = [{ h: 10, c: 20, l: 30, overrides: { '--color-gray-50': '#fff' } }, { h: 1, name: 'n' }, { h: 1, c: '7', l: null }].map((d) => [d, migrateLegacyTheme(d)]);
  out.readHiddenBackgrounds = [null, 'x', HIDDEN, { models: ['a', '', 5], folders: { a: 100, b: 'x', c: -5 }, chat: '50', dimming: null },
    { auth: { url: 'javascript:x' }, pages: { source: 'url', url: 'https://ok/x.png', share: 250 } },
    { pages: { source: 'url', url: 'http://insecure' }, behind: 0 },
    { auth: { url: '/api/v1/old/auth-background?v=1' }, pages: { source: 'url', url: '/api/v1/a/b/page-background?v=2' } },
    { auth: { url: '/api/v1/old/me/auth-background?v=3' }, pages: { source: 'url', url: '/api/v1/old/me/page-background?v=3' } }].map((v) => [v, readHiddenBackgrounds(v)]);
  // A personal designer (scope 'me') never keeps a sign-in page picture
  const config = window.__THEME_PRO_CONFIG__;
  window.__THEME_PRO_CONFIG__ = { ...config, scope: 'me' };
  out.readHiddenBackgrounds_personal = [HIDDEN,
    { pages: { source: 'url', url: '/api/v1/old/me/me/page-background?v=4' } },
    { pages: { source: 'url', url: '/api/v1/theme-designer/page-background?v=5' } },
    { pages: { source: 'url', url: '/api/v1/old/page-background?v=6' } }].map((v) => [v, readHiddenBackgrounds(v)]);
  window.__THEME_PRO_CONFIG__ = config;
  out.hasHiddenBackgrounds = [readHiddenBackgrounds(null), readHiddenBackgrounds(HIDDEN)].map((h) => hasHiddenBackgrounds(h));
  out.authUrlOk = ['', '/x', 'https://a/b', 'http://a', 'https://a/"x', '/' + 'a'.repeat(2050), 5].map((u) => [u, authUrlOk(u)]);
  out._repairSnapshotEntry = [null, [], 'x', { name: 5, version: 1.2, author: {}, updateUrl: Infinity }].map((s) => [s, _repairSnapshotEntry(s)]);
  out._isThemeEntry = [null, [], {}, { h: 5 }, { h: 0 }, { h: '250' }, { h: null }, { h: 5, dark: {}, light: {} }, { h: 5, dark: {} }, { h: 5, dark: {}, light: true }, { dark: {}, light: {} }, { dark: {}, light: null }].map((s) => [s, _isThemeEntry(s)]);
  out._isLegacyTheme = [null, [], {}, { h: 5 }, { h: 0 }, { h: '250' }, { h: null }, { h: 5, dark: {}, light: {} }, { h: 5, dark: {} }, { h: 5, dark: {}, light: true }, { dark: {}, light: {} }, { dark: {}, light: null }].map((s) => [s, _isLegacyTheme(s)]);
  out.toRawGitHub = ['', null, 5, 'https://github.com/a/b/blob/main/x.json', 'https://github.com/a/b/raw/main/x.json',
    'https://gist.github.com/u/abc123', 'https://gist.github.com/u/abc123/raw/x', 'https://example.com/x'].map((u) => [u, toRawGitHub(u)]);
  out.semverCompare = [['1.0.0', '1.0.0'], ['1.2', '1.10'], ['v2.0.0', '1.9.9'], ['1.0.0-beta.1', '1.0.0'], ['1.0.0-alpha', '1.0.0-beta'],
    ['1.0.0-1', '1.0.0-a'], ['1.0.0-a.1', '1.0.0-a'], ['x', '0.0.1'], [null, ''], ['1.0.0+build', '1.0.0']].map(([a, b]) => [a, b, Math.sign(semverCompare(a, b))]);
  out.labelOf = ['COUNT', 'CENTER_CALM', 'followTheme', 'speed', 'a__b'].map((k) => [k, labelOf(k)]);
  out.numberRange = [[60, ''], [0.7, ''], [-2, ''], [0, ''], [2.5, ''], [40, 'speed (5-200)'], [3, '1 to 2'], [8, '0..10']].map(([v, c]) => [v, c, numberRange(v, c)]);
  const script = "// ── Look ──\nconst COUNT = 60;          // how many (10-300)\nconst SPEED = 0.5; // speed\nconst COLOR = '#abc';\nconst ON = true;\nfunction f() {}\nconst AFTER = 1;";
  const cfgScript = "const CONFIG = {\n  // == Motion ==\n  speed: 2, // 1-5\n  glow: '#FF0000',\n  nested: { a: 1 },\n  on: false\n};\n";
  out.parseSettings = [script, cfgScript, "const CFG = { a: 1, b: '#fff', c: true };", '', null].map((s) => [s, parseSettings(s)]);
  out.applySettings = [[script, { COUNT: 90, SPEED: 0.25, COLOR: '#00FF00', ON: false, MISSING: 1 }], [script, { COUNT: 'x', COLOR: 'red' }],
    [cfgScript, { speed: 4, glow: '#00ff00', on: true }], [script, {}]].map(([s, c]) => [c, applySettings(s, c)]);
  out.buildGradientCss = [
    { gradientEnabled: true, gradientStops: [{ color: '#ff0000', position: 'x' }, { color: 'rgb(0, 0, 255)', position: 100 }], gradientAngle: null, gradientIntensity: null },
    { gradientEnabled: true, gradientType: 'radial', gradientRadialShape: 'circle; }', gradientStops: [{ color: '#000', position: 0 }, { color: '#fff', position: 100 }] },
    { gradientEnabled: true, gradientType: 'conic', gradientAnimation: true, gradientAnimationSpeed: 600, gradientStops: [{ color: '#111111', position: 0 }, { color: '#eeeeee', position: 100 }] },
    { gradientEnabled: true, gradientType: 'mesh', gradientMeshBgColor: 'x(', gradientMeshPoints: [{ color: '#f00', x: 'a', y: 5, spread: null }, { color: 'oklch(0.5 0.1 20)', x: 1, y: 2, spread: 3 }] },
    { gradientEnabled: true, gradientType: 'mesh', gradientMeshPoints: [{ color: '#f00' }] },
    { gradientEnabled: false, gradientStops: [{ color: '#000', position: 0 }, { color: '#fff', position: 100 }] }
  ].map((d) => [d, buildGradientCss(d, '.scope')]);
  // generateThemeSections over hostile mode data, as validateModeData leaves it
  const hostile = createDefaultModeData({
    customCSS: '/*[OWUI_VARS_END]*/ :root { --a: 1 } html.dark { --b: 2 } @keyframes k { from { x: 1 } }', customCssEnabled: true, autoScope: true,
    manualOverrides: '--color-gray-900: #010203\n--x: url(a) /* c */\nbad line\n--y: 1; --z: 2', manualOverridesEnabled: true,
    surfacesEnabled: true, surfaceSidebarOpacity: 30, surfaceCardsOpacity: 50, surfaceCardsBlur: 4, surfaceButtonsBlur: 2, surfaceFadeOpacity: 0,
    canvasEnabled: true, canvasScript: 'x', paletteEnabled: false, accent: '#ABCDEF'
  });
  themeData = { dark: hostile, light: createDefaultModeData({ customCSS: ':root { --c: 3 }', customCssEnabled: true, autoScope: false }), oled: createDefaultModeData({ l: 0 }), her: createDefaultModeData() };
  out.generateThemeSections_hostile = generateThemeSections();
  return out;
}

// What the library card match (isModeMatch), the import duplicate check
// (isThemeDuplicate) and Check for Updates (buildUpdateDiffHtml) say about a
// theme that differs from another in one field, in every mode
function themeComparison() {
  // It sets designer globals; put them back so later sections see what they would without it
  const saved = { themeData, syncSourceType, syncSourceId, activeThemeRef };
  let savedSnapshots;
  try {
    const base = normalizeModeData({ h: 200, c: 30, l: 20, gradientStops: [{ color: '#112233', position: 0 }, { color: '#445566', position: 100 }] });
    const theme = (mode) => ({ name: 'Aurora', dark: mode, light: structuredClone(mode), oled: structuredClone(mode), her: structuredClone(mode) });
    const changes = [
      ['nothing', {}], ['h', { h: 30 }], ['paletteEnabled', { paletteEnabled: false }], ['accent', { accent: '#abcdef' }],
      ['overrides', { overrides: { '--color-gray-50': '#ffffff' } }], ['locks', { locks: { '--color-gray-50': true } }],
      ['manualOverrides', { manualOverrides: '--a: red', manualOverridesEnabled: true }], ['manualOverridesEnabled', { manualOverridesEnabled: true }],
      ['customCSS', { customCSS: '.a { b: c }' }], ['customCssEnabled', { customCssEnabled: true }], ['autoScope', { autoScope: false }],
      ['canvasEnabled', { canvasEnabled: true }], ['canvasScript', { canvasScript: 'x' }],
      ['gradientEnabled', { gradientEnabled: true }], ['gradientAnimationSpeed', { gradientAnimationSpeed: 25 }], ['gradientAngle', { gradientAngle: 90 }],
      ['gradientIntensity', { gradientIntensity: 40 }], ['gradientRadialShape', { gradientRadialShape: 'circle' }], ['gradientMeshBgColor', { gradientMeshBgColor: '#000000' }],
      ['a gradient stop color', { gradientStops: [{ color: '#112233', position: 0 }, { color: '#ff0000', position: 100 }] }],
      ['surfacesEnabled', { surfacesEnabled: true }], ['surfaceSidebarOpacity', { surfaceSidebarOpacity: 40 }],
      ['themeShowAuth', { themeShowAuth: false }], ['gradientAuthOnly', { gradientAuthOnly: true }]
    ];
    const sections = (html) => [...new Set([...html.matchAll(/class="update-diff-sub">([^<]*)</g)].map((m) => m[1]))];
    // The property rows of the dark mode's diff: the ones a section shows as differing
    const propRows = (html) => [...html.split('update-diff-section')[1].matchAll(/class="prop-key">([^<]*)<\/td><td>([^<]*)<\/td><td[^>]*>→<\/td><td>([^<]*)</g)]
      .map((m) => `${m[1]}: ${m[2]} → ${m[3]}`);
    const rows = changes.map(([label, change]) => {
      const mode = normalizeModeData({ ...structuredClone(base), ...structuredClone(change) });
      const html = buildUpdateDiffHtml(theme(base), theme(mode));
      return [label, {
        isModeMatch: isModeMatch(base, mode),
        isThemeDuplicate: isThemeDuplicate(theme(mode), [theme(base)]),
        updateDiff: sections(html),
        rows: propRows(html)
      }];
    });
    // A mode as an old file holds it, before normalizeModeData fills in the
    // fields it leaves out, against the same mode normalized
    const raw = { h: 200, c: 30, l: 20, gradientStops: structuredClone(base.gradientStops) };
    rows.push(['nothing, one side not normalized', {
      isModeMatch: isModeMatch(base, raw),
      isThemeDuplicate: isThemeDuplicate(theme(raw), [theme(base)]),
      updateDiff: sections(buildUpdateDiffHtml(theme(base), theme(raw)))
    }]);
    // Apply Library Theme (applySyncToMode), then what the comparison says
    // about the mode it wrote against the source it applied
    const ALL = { syncPalette: true, syncOverrides: true, syncCss: true, syncCanvas: true, syncGradient: true, syncSurfaces: true, syncAuth: true, rebuildLocks: true };
    const applied = (target, source, opts) => attempt(() => {
      themeData = { dark: normalizeModeData(structuredClone(target)), light: createDefaultModeData(), oled: createDefaultModeData(), her: createDefaultModeData() };
      applySyncToMode('dark', structuredClone(source), opts);
      const d = themeData.dark;
      return { differs: modeSectionDiffs(source, d), gradientAnimationSpeed: d.gradientAnimationSpeed, paletteEnabled: d.paletteEnabled, themeShowAuth: d.themeShowAuth };
    });
    const partial = { h: 200, c: 30, l: 20, gradientEnabled: true, gradientStops: structuredClone(base.gradientStops) };
    rows.push(['apply everything: source without gradientAnimationSpeed or themeShowAuth onto speed 15, auth off',
      applied({ ...base, gradientAnimationSpeed: 15, themeShowAuth: false }, partial, ALL)]);
    rows.push(['apply Auth Page Visibility only: palette switched off in the source',
      applied(base, { ...base, paletteEnabled: false }, { syncAuth: true })]);
    // What the Selective Sync badges compare each target with (getSyncSourceData)
    const sourceL = (type, id, target, refs) => attempt(() => {
      syncSourceType = type; syncSourceId = id;
      activeThemeRef = refs;
      const src = getSyncSourceData(target);
      return src ? src.l : null;
    });
    const refsAll = { dark: { type: 'snapshot', id: 0 }, oled: { type: 'snapshot', id: 0 }, light: { type: 'snapshot', id: 0 }, her: { type: 'snapshot', id: 0 } };
    savedSnapshots = Storage.get('snapshots', []);
    Storage.set('snapshots', [{ name: 'No OLED', dark: { ...base, l: 20 }, light: { ...base, l: 90 } }, { name: 'Own OLED', dark: { ...base, l: 20 }, light: { ...base, l: 90 }, oled: { ...base, l: 7 }, her: { ...base, l: 80 } }]);
    themeData = { dark: normalizeModeData({ ...base, l: 20 }), light: createDefaultModeData(), oled: createDefaultModeData({ l: 5 }), her: createDefaultModeData() };
    rows.push(['badge source l: gallery theme without oled, for oled', sourceL('snapshot', 0, 'oled', refsAll)]);
    rows.push(['badge source l: gallery theme without oled, for her', sourceL('snapshot', 0, 'her', refsAll)]);
    rows.push(['badge source l: sync from dark, both modes from a theme with its own oled, for oled', sourceL('active-mode', null, 'oled', { ...refsAll, dark: { type: 'snapshot', id: 1 }, oled: { type: 'snapshot', id: 1 } })]);
    rows.push(['badge source l: sync from dark, for light', sourceL('active-mode', null, 'light', refsAll)]);
    return rows;
  } finally {
    ({ themeData, syncSourceType, syncSourceId, activeThemeRef } = saved);
    if (savedSnapshots !== undefined) Storage.set('snapshots', savedSnapshots);
  }
}

// The bootloader: the CSS enforceTheme puts on a page for a delivered theme
// (cases built by golden.py from what the Python side serves)
function bootloaderCases({ blobs, cases }) {
  const B = window.__boot;
  const out = [];
  for (const c of cases) {
    const css = blobs[c.css], state = blobs[c.state];
    history.replaceState(null, '', c.path);
    localStorage.setItem('theme', c.theme);
    document.getElementById('owui-dev-live-theme')?.remove();
    B.set({ _owuiThemeCss: css, _owuiThemeState: state, _parsedState: null, _personal: !!c.personal, _disabled: false });
    const r = attempt(() => { B.enforceTheme(); return null; });
    const el = document.getElementById('owui-dev-live-theme');
    out.push({ id: c.id, threw: r && r.threw, css: el ? el.textContent : null, dataTheme: document.documentElement.getAttribute('data-theme'), classes: document.documentElement.className });
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.className = '';
  }
  return out;
}

function bootloaderUnits(variables) {
  const B = window.__boot;
  const out = {};
  out.themeToMode = ['dark', 'oled-dark', 'light', 'her', 'nope', ''].map((t) => [t, B.themeToMode(t)]);
  out.bgShare = [null, undefined, '', 0, 50.6, 150, -5, 'x', '30'].map((v) => [v === undefined ? 'undefined' : v, B.bgShare(v)]);
  out.bgShares = [null, ['a', '', 5, 'b'], { a: 50, b: 'x', '': 1 }].map((v) => [v, B.bgShares(v)]);
  out.onOtherPage = ['/', '/c/1', '/c', '/folders/x', '/auth', '/s/abc', '/workspace', '/notes', '/admin/settings', '/cx'].map((p) => {
    history.replaceState(null, '', p);
    return [p, B.onOtherPage()];
  });
  history.replaceState(null, '', '/');
  // The Canvas FX palette payload for each mode of the hostile designer case
  out.buildCanvasTheme = Object.entries(variables).map(([mode, v]) => {
    const config = v.config;
    const hue = Number(config.h) || 0;
    const chroma = config.paletteEnabled === false ? 0 : (Number(config.c) || 0);
    // The page resolves --color-base-* from the --app-base-* the theme sets
    return [mode, B.buildCanvasTheme((name) => v.vars[name.replace('--color-base-', '--app-base-')] || '', B._colorToRgb, mode, hue, chroma, config)];
  });
  return out;
}

// ── Driver ──

(async () => {
  const [jobPath, outPath] = process.argv.slice(2);
  const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.route(ORIGIN + '/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body></body></html>' }));
    await page.goto(ORIGIN + '/');
    const failedDecls = await page.evaluate(load, job.js);
    const notLoaded = failedDecls.filter((f) => f.names.some((n) => job.required.includes(n)));
    if (notLoaded.length) throw new Error('declarations the check needs did not load:\n' + notLoaded.map((f) => f.error).join('\n'));
    const result = { failedDecls };
    // Functions defined here run in the page, where the designer's
    // declarations are globals
    const inPage = (fn, arg) => page.evaluate(`(${fn.toString()})(${JSON.stringify(arg)})`);
    await page.evaluate(`window.attempt = ${attempt.toString()}; window.REFS = ${JSON.stringify(REFS)}; window.HIDDEN = ${JSON.stringify(HIDDEN)};`);
    if (job.phase === 'designer') {
      result.themes = {};
      for (const t of job.themes) result.themes[t.id] = await inPage(designerTheme, t);
      result.units = await inPage(designerUnits, job.themes.map((t) => ({ file: t.file, data: t.data })));
      result.units.themeComparison = await inPage(themeComparison, null);
    } else {
      result.cases = [];
      for (const group of job.groups) result.cases.push(...await inPage(bootloaderCases, group));
      result.units = await inPage(bootloaderUnits, job.variables);
    }
    result.pageErrors = pageErrors;
    fs.writeFileSync(outPath, JSON.stringify(result));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
