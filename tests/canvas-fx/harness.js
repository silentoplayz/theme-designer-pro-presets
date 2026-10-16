// Runs one Canvas FX script the way Theme Designer Pro does (a worker with an
// OffscreenCanvas) and screenshots it through a fixed sequence of messages,
// telling it where the chat column is, as the engine does.
// Usage: node tests/canvas-fx/harness.js canvas-fx/<script>.js <outdir>
// Needs playwright-core (npm install --no-save playwright-core@1.56.1) and Google Chrome.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const [scriptPath, outDir] = process.argv.slice(2);
const script = fs.readFileSync(scriptPath, 'utf8');
fs.mkdirSync(outDir, { recursive: true });

// Palettes shaped like the engine's theme payload (buildCanvasTheme)
const rgbOf = (hex) => [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) / 2.55) / 100);
function payload(mode, dark, hue, colors, ramp) {
	const rgb = {};
	Object.keys(colors).forEach((k) => { rgb[k] = rgbOf(colors[k]); });
	return { type: 'theme', mode, dark, hue, chroma: 0.03, colors, rgb, ramp };
}
const THEMES = {
	dark: payload('dark', true, 265,
		{ background: '#1a1826', surface: '#22202f', text: '#e6e4f0', muted: '#8a8799', accent: '#a99cf5', accent2: '#e294d9', accent3: '#78b3f2' },
		{ 50: '#f5f4fa', 100: '#e6e4f0', 200: '#cfccdc', 300: '#b2aec4', 400: '#8a8799', 500: '#6d6a7d', 600: '#55526a', 700: '#433f56', 800: '#2d2a3c', 850: '#22202f', 900: '#1a1826', 950: '#100f18' }),
	light: payload('light', false, 220,
		{ background: '#f4f6f9', surface: '#e9edf2', text: '#1c222b', muted: '#6b7480', accent: '#3f73b8', accent2: '#6a5fb4', accent3: '#2f8c8a' },
		{ 50: '#f4f6f9', 100: '#e9edf2', 200: '#d5dbe3', 300: '#b8c1cc', 400: '#939ca8', 500: '#6b7480', 600: '#535b66', 700: '#3f4650', 800: '#2b3038', 850: '#22272e', 900: '#1c222b', 950: '#12161c' }),
};

const PAGE = `<!doctype html><html><head><style>
html, body { margin: 0; height: 100%; overflow: hidden; }
#bg { position: fixed; inset: 0; }
canvas { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; }
</style></head><body><div id="bg"></div><canvas id="c"></canvas></body></html>`;

// Counts frames and times each callback, out of the script's sight
const PRELUDE = `(function () {
	var raf = self.requestAnimationFrame.bind(self), frames = 0, busy = 0;
	self.requestAnimationFrame = function (cb) {
		return raf(function (t) { var s = performance.now(); frames++; cb(t); busy += performance.now() - s; });
	};
	self.addEventListener('message', function (e) {
		if (!e.data || e.data.type !== 'harness-stats') return;
		e.stopImmediatePropagation();
		postMessage({ type: 'harness-stats', frames: frames, busy: busy });
		frames = 0; busy = 0;
	});
})();`;

(async () => {
	const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	const errors = [];
	page.on('pageerror', (e) => errors.push('page: ' + e.message));
	page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`console ${m.type()}: ${m.text()}`); });
	page.on('worker', (w) => w.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`worker ${m.type()}: ${m.text()}`); }));
	await page.setContent(PAGE);
	// Where the chat column sits in each stage: the sidebar open at first, then moved
	const COLUMNS = {
		'1-dark': { x: 850, width: 928 }, '2-dark-interact': { x: 850, width: 928 },
		'3-dark-shifted': { x: 1000, width: 700 }, '4-light': { x: 850, width: 928 },
		'5-light-resized': { x: 630, width: 716 }, '6-light-dpr2-reduced': { x: 850, width: 928 },
	};
	await page.evaluate(({ src, prelude, theme, column }) => {
		document.getElementById('bg').style.background = theme.colors.background;
		const worker = new Worker(URL.createObjectURL(new Blob([prelude, src], { type: 'application/javascript' })));
		worker.onerror = (e) => console.error('worker error: ' + e.message + ' at line ' + e.lineno);
		worker.onmessage = (e) => { if (e.data && e.data.type === 'harness-stats') window.__stats = e.data; };
		const off = document.getElementById('c').transferControlToOffscreen();
		worker.postMessage({ type: 'init', canvas: off, width: innerWidth, height: innerHeight, dpr: 1, reducedMotion: false, column,
			env: { authToken: '', baseUrl: location.origin, locale: 'en-US', timezone: 'UTC' }, theme }, [off]);
		window.__w = worker;
	}, { src: script, prelude: PRELUDE, theme: THEMES.dark, column: COLUMNS['1-dark'] });

	const send = (msg) => page.evaluate((m) => window.__w.postMessage(m), msg);
	const shot = (name) => page.screenshot({ path: path.join(outDir, name + '.png') });
	const stats = async () => {
		await page.evaluate(() => { window.__stats = null; window.__w.postMessage({ type: 'harness-stats' }); });
		await page.waitForFunction(() => window.__stats, null, { timeout: 3000 }).catch(() => {});
		return page.evaluate(() => window.__stats);
	};
	const wait = (ms) => page.waitForTimeout(ms);

	await wait(1000);
	await stats();
	await wait(4000);
	const s1 = await stats();
	await shot('1-dark');

	for (let i = 0; i <= 30; i++) {
		await send({ type: 'mousemove', x: 1100 + i * 6, y: 250 + i * 8 });
		await wait(33);
	}
	await send({ type: 'mousedown', x: 1200, y: 420 });
	await send({ type: 'mouseup', x: 1200, y: 420 });
	await send({ type: 'click', x: 1200, y: 420 });
	await wait(1200);
	await shot('2-dark-interact');

	await send({ type: 'layout', column: COLUMNS['3-dark-shifted'] });
	await wait(2500);
	await shot('3-dark-shifted');

	await send({ type: 'layout', column: COLUMNS['4-light'] });
	await page.evaluate((t) => { document.getElementById('bg').style.background = t.colors.background; window.__w.postMessage(t); }, THEMES.light);
	await wait(3000);
	await shot('4-light');

	await page.setViewportSize({ width: 1000, height: 700 });
	await send({ type: 'resize', width: 1000, height: 700, dpr: 1 });
	await send({ type: 'layout', column: COLUMNS['5-light-resized'] });
	await wait(2500);
	await shot('5-light-resized');

	await page.setViewportSize({ width: 1440, height: 900 });
	await send({ type: 'resize', width: 1440, height: 900, dpr: 2 });
	await send({ type: 'layout', column: COLUMNS['6-light-dpr2-reduced'] });
	await send({ type: 'motion', reducedMotion: true });
	await wait(2500);
	const s2 = await stats();
	await shot('6-light-dpr2-reduced');

	const perFrame = (s) => (s && s.frames ? +(s.busy / s.frames).toFixed(2) : null);
	const summary = {
		script: path.basename(scriptPath),
		bytes: Buffer.byteLength(script),
		fps: s1 ? +(s1.frames / 4).toFixed(1) : null,
		msPerFrame: perFrame(s1),
		msPerFrameAtDpr2: perFrame(s2),
		errors,
		columns: COLUMNS,
	};
	fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
	console.log(JSON.stringify(summary));
	await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
