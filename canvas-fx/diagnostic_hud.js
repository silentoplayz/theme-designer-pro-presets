/**
 * Title: Diagnostic HUD
 * Description: A small developer panel docked in a corner that shows every runtime message channel with its count and age, frame timing, canvas size and pixel ratio, theme, reduced motion, context data and a short event log.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const CORNER        = 1;     // where the panel docks: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right (0-3)
const PANEL_WIDTH   = 230;   // widest the panel gets, in px; it narrows to stay clear of the chat column (180-320)
const MARGIN        = 12;    // gap between the panel and the screen's edge, in px (0-48)
const BAND_WIDTH    = 470;   // half-width of the chat column the panel stays clear of, in px (300-900)
const FONT_SIZE     = 10;    // text size, in px (9-13)
const LOG_ROWS      = 5;     // event log lines; fewer show when the screen is short (0-10)
const REFRESH_HZ    = 4;     // how often the text updates per second (1-30)
const STALE_SECONDS = 60;    // seconds before an on-demand channel shows as stale (5-300)
const PANEL_OPACITY = 0.86;  // panel background opacity (0.3-1)
const MOTION        = 1;     // speed of the arrival pulses and tap ripples; 0 turns them off (0-2)
const CENTER_CALM   = 0.7;   // how much the cursor marker and tap ripple fade over the chat column (0-1)
const CURSOR_MARKER = true;  // draw a small crosshair with coordinates at the cursor
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const COLOR_OK      = '#00e68a'; // received recently, when not following the theme
const COLOR_WARN    = '#ffaa00'; // stale
const COLOR_ERROR   = '#ff4d5e'; // never received
const COLOR_HEADER  = '#00ccee'; // section headers
/* ──────────────────────────────────────────── */

// Channels in the runtime's protocol, and how fast each goes stale:
// 0 once (init never goes stale), 1 continuous (5 s), 2 on demand (STALE_SECONDS)
const CH = ['init', 'resize', 'theme', 'motion', 'mousemove', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchmove', 'touchend', 'context'];
const KIND = [0, 2, 2, 2, 1, 2, 2, 2, 2, 1, 2, 2];
const count = new Float64Array(CH.length), lastAt = new Float64Array(CH.length), pulse = new Float32Array(CH.length);
const frames = new Float32Array(120), fpsHist = new Float32Array(48);
const log = [];
for (let i = 0; i < 10; i++) log.push({ t: '', type: '', detail: '', at: 0 });
const isWorker = typeof WorkerGlobalScope !== 'undefined';
const FONT = FONT_SIZE + 'px ui-monospace, SFMono-Regular, Menlo, monospace', BOLD = '600 ' + FONT;
const LH = Math.round(FONT_SIZE * 1.45);

let canvas, ctx, panel, pctx, w = 0, h = 0, dpr = 1, last = 0, start = 0, reduced = false, dark = true, themeMode = 'none', themeHue = 0;
let fi = 0, fpsCount = 0, fpsAt = 0, fps = 0, hi = 0, evCount = 0, evRate = 0, logHead = 0, logLen = 0, paintedAt = -1e9;
let px = 0, py = 0, pw = 0, ph = 0, compact = false, rows = 0, dotX = 0, dotY = 0;
let ctxDom = null, ctxApi = null;
const mouse = { x: -10000, y: -10000, at: -1e9 };
const tap = { x: 0, y: 0, age: 9 };
const c = {};

function rgbOf(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function css(v, a) { return 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + a + ')'; }
function band(x) { const t = Math.min(1, Math.max(0, (Math.abs(x - w / 2) / 520 - 0.55) / 0.7)); return 1 - t * t * (3 - 2 * t); }

function applyTheme(t) {
	if (t) {
		dark = t.dark !== false;
		const m = t.mode || '?', tone = dark ? 'dark' : 'light';
		themeMode = m === tone ? m : m + ' (' + tone + ')';
		themeHue = t.hue || 0;
	}
	const th = FOLLOW_THEME && t && t.colors ? t.colors : null;
	c.panel = css(rgbOf(th ? th.surface : dark ? '#080c14' : '#f2f4f7'), PANEL_OPACITY);
	c.border = css(rgbOf(th ? th.muted : dark ? '#3a4a5a' : '#9aa4b0'), 0.35);
	c.label = th ? th.muted : dark ? '#8894a4' : '#5b6572';
	c.value = th ? th.text : dark ? '#e8e8e8' : '#1c222b';
	c.dim = css(rgbOf(c.label), 0.45);
	c.header = th ? th.accent : dark ? COLOR_HEADER : '#0b7fa0';
	c.cursor = th ? th.accent3 : c.header;
	c.ok = th ? (dark ? '#4ade80' : '#15803d') : dark ? COLOR_OK : '#0f8a52';
	c.warn = th ? (dark ? '#fbbf24' : '#b45309') : dark ? COLOR_WARN : '#b46a00';
	c.error = th ? (dark ? '#f87171' : '#dc2626') : dark ? COLOR_ERROR : '#d02a3a';
	paintedAt = -1e9;
}

// Dock in the chosen corner, inside the space beside the chat column
function layout() {
	const gap = w / 2 - BAND_WIDTH - MARGIN;
	// Too little room for the panel: a slim strip of status dots in the edge's gap instead
	compact = gap < 160;
	const edge = compact ? 4 : MARGIN;
	pw = compact ? Math.min(28, w / 2 - BAND_WIDTH - 8) : Math.min(PANEL_WIDTH, gap);
	if (pw < 14) pw = 0;
	const fixed = 72 + LH * (11 + CH.length);
	rows = compact ? 0 : Math.max(0, Math.min(LOG_ROWS, Math.floor((h - MARGIN * 2 - fixed - LH - 8) / LH)));
	ph = compact ? 30 + CH.length * 18 : Math.min(h - MARGIN * 2, fixed + (rows ? LH * (rows + 1) + 8 : 0));
	px = CORNER % 2 ? w - edge - pw : edge;
	py = CORNER > 1 ? h - edge - ph : edge;
	panel = new OffscreenCanvas(Math.max(1, Math.ceil(pw * dpr)), Math.max(1, Math.ceil(ph * dpr)));
	pctx = panel.getContext('2d');
	pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	paintedAt = -1e9;
}

function size() {
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	layout();
}

function status(i, now) {
	if (!count[i]) return c.error;
	const stale = KIND[i] === 0 ? Infinity : KIND[i] === 1 ? 5000 : STALE_SECONDS * 1000;
	return now - lastAt[i] > stale ? c.warn : c.ok;
}

function age(ms) { return ms < 1000 ? (ms | 0) + 'ms' : ms < 60000 ? (ms / 1000).toFixed(1) + 's' : ms < 3600000 ? (ms / 60000).toFixed(1) + 'm' : (ms / 3600000).toFixed(1) + 'h'; }

function addLog(type, detail, now) {
	const e = log[logHead];
	e.t = ((now - start) / 1000).toFixed(1);
	e.type = type;
	e.detail = detail;
	e.at = now;
	logHead = (logHead + 1) % log.length;
	logLen = Math.min(log.length, logLen + 1);
}

function row(g, y, label, value, color) {
	g.textAlign = 'left';
	g.fillStyle = c.label;
	g.fillText(label, 12, y);
	g.textAlign = 'right';
	g.fillStyle = color || c.value;
	g.fillText(value, pw - 12, y);
}

function header(g, y, text) {
	g.strokeStyle = c.border;
	g.beginPath();
	g.moveTo(12, y - LH + 3);
	g.lineTo(pw - 12, y - LH + 3);
	g.stroke();
	g.font = BOLD;
	g.textAlign = 'left';
	g.fillStyle = c.header;
	g.fillText(text, 12, y + 2);
	g.font = FONT;
}

// The text layer, repainted REFRESH_HZ times a second into its own canvas
function paint(now) {
	const g = pctx;
	g.clearRect(0, 0, pw, ph);
	g.fillStyle = c.panel;
	g.strokeStyle = c.border;
	g.lineWidth = 1;
	g.beginPath();
	g.roundRect(0.5, 0.5, pw - 1, ph - 1, compact ? 9 : 8);
	g.fill();
	g.stroke();
	g.font = FONT;
	g.textBaseline = 'alphabetic';
	if (compact) {
		g.textAlign = 'center';
		g.fillStyle = fps >= 50 ? c.ok : fps >= 30 ? c.warn : c.error;
		g.fillText(String(fps), pw / 2, 17);
		dotX = px + pw / 2;
		dotY = py + 30;
		return;
	}
	let avg = 0, max = 0;
	for (let i = 0; i < frames.length; i++) { avg += frames[i]; if (frames[i] > max) max = frames[i]; }
	avg /= frames.length;
	let y = 16 + 4;
	g.font = BOLD;
	g.textAlign = 'left';
	g.fillStyle = c.value;
	g.fillText('Canvas FX HUD', 12, y);
	g.textAlign = 'right';
	g.fillStyle = fps >= 50 ? c.ok : fps >= 30 ? c.warn : c.error;
	g.fillText(fps + ' fps', pw - 12, y);
	g.font = FONT;
	y += LH;
	row(g, y, 'frame avg/max', avg.toFixed(1) + ' / ' + max.toFixed(0) + ' ms', max < 34 ? c.value : c.warn);
	// FPS history, one bar a second, the newest on the right
	const gx = 12, gw = pw - 24, gy = y + 6, gh = 20, bw = gw / fpsHist.length;
	g.fillStyle = c.dim;
	g.fillRect(gx, gy + gh * (1 - 60 / 72), gw, 1);
	for (let i = 0; i < fpsHist.length; i++) {
		const v = fpsHist[(hi + i) % fpsHist.length];
		if (!v) continue;
		g.fillStyle = v >= 50 ? c.ok : v >= 30 ? c.warn : c.error;
		g.globalAlpha = 0.55;
		const bh = (Math.min(v, 72) / 72) * gh;
		g.fillRect(gx + i * bw, gy + gh - bh, Math.max(1, bw - 1), bh);
	}
	g.globalAlpha = 1;
	y += 26 + LH;
	header(g, y, 'runtime');
	y += LH;
	row(g, y, 'mode', isWorker ? 'worker' : 'main thread', isWorker ? c.value : c.warn);
	y += LH;
	row(g, y, 'canvas', w + '×' + h + ' @' + dpr + 'x');
	y += LH;
	row(g, y, 'theme', themeMode + (themeMode === 'none' ? '' : ' · ' + Math.round(themeHue) + '°'));
	y += LH;
	row(g, y, 'reduced motion', reduced ? 'on' : 'off', reduced ? c.warn : c.value);
	y += LH + 8;
	header(g, y, 'channels');
	g.textAlign = 'right';
	g.fillStyle = c.dim;
	g.fillText('count   last', pw - 12, y + 2);
	dotX = px + 16;
	dotY = py + y + LH - FONT_SIZE * 0.35;
	for (let i = 0; i < CH.length; i++) {
		y += LH;
		g.textAlign = 'left';
		g.fillStyle = count[i] ? c.value : c.label;
		g.fillText(CH[i], 26, y);
		g.textAlign = 'right';
		g.fillStyle = c.value;
		g.fillText(String(count[i]), pw - 62, y);
		g.fillStyle = c.label;
		g.fillText(count[i] ? age(now - lastAt[i]) : '—', pw - 12, y);
	}
	y += LH + 8;
	header(g, y, 'input & context');
	y += LH;
	row(g, y, 'cursor · events/s', (mouse.x > -10000 ? (mouse.x | 0) + ',' + (mouse.y | 0) : '—') + ' · ' + evRate);
	y += LH;
	row(g, y, 'messages · chars', ctxDom ? ctxDom.messages + ' · ' + ctxDom.chars : '—');
	y += LH;
	row(g, y, 'est · exact tokens', (ctxDom ? '~' + ctxDom.estimatedTokens : '—') + ' · ' + (ctxApi ? ctxApi.exactTokens : '—'), ctxApi ? c.ok : c.value);
	if (!rows) return;
	y += LH + 8;
	header(g, y, 'log');
	for (let k = 0; k < rows; k++) {
		y += LH;
		if (k >= logLen) {
			if (!k) { g.textAlign = 'left'; g.fillStyle = c.dim; g.fillText('waiting for events…', 12, y); }
			break;
		}
		const e = log[(logHead - 1 - k + log.length) % log.length];
		g.globalAlpha = Math.max(0.35, 1 - (now - e.at) / 15000);
		g.textAlign = 'left';
		g.fillStyle = c.label;
		g.fillText(e.t, 12, y);
		g.fillStyle = c.header;
		g.fillText(e.type, 52, y);
		g.fillStyle = c.value;
		g.fillText(e.detail, 124, y);
		g.globalAlpha = 1;
	}
}

function frame(now) {
	requestAnimationFrame(frame);
	const dtMs = last ? now - last : 16.7;
	const dt = Math.min(dtMs / 1000, 0.1);
	last = now;
	frames[fi] = dtMs;
	fi = (fi + 1) % frames.length;
	fpsCount++;
	if (now - fpsAt >= 1000) {
		fps = fpsCount;
		fpsHist[hi] = fps;
		hi = (hi + 1) % fpsHist.length;
		evRate = evCount;
		fpsCount = evCount = 0;
		fpsAt = now;
	}
	if (now - paintedAt >= 1000 / REFRESH_HZ) { paintedAt = now; if (pw) paint(now); }
	ctx.clearRect(0, 0, w, h);
	if (!pw) return;
	ctx.globalAlpha = 1;
	ctx.drawImage(panel, px, py, pw, ph);

	// Live status dots, each with a ring that pulses when its message arrives
	const step = compact ? 18 : LH, anim = reduced ? 0 : MOTION;
	for (let i = 0; i < CH.length; i++) {
		const y = dotY + i * step;
		ctx.fillStyle = ctx.strokeStyle = status(i, now);
		ctx.beginPath();
		ctx.arc(dotX, y, 3, 0, 6.283);
		ctx.fill();
		if (pulse[i] > 0.01 && anim > 0) {
			pulse[i] = Math.max(0, pulse[i] - dt * 2 * anim);
			ctx.globalAlpha = pulse[i];
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.arc(dotX, y, 3 + (1 - pulse[i]) * 5, 0, 6.283);
			ctx.stroke();
			ctx.globalAlpha = 1;
		}
	}

	// Cursor marker and tap ripple, fading once the cursor rests
	if (CURSOR_MARKER) {
		const a = Math.max(0, 1 - (now - mouse.at) / 1500) * (1 - CENTER_CALM * band(mouse.x));
		if (a > 0.01) {
			ctx.globalAlpha = a * (dark ? 0.6 : 0.5);
			ctx.strokeStyle = ctx.fillStyle = c.cursor;
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(mouse.x - 12, mouse.y); ctx.lineTo(mouse.x - 4, mouse.y);
			ctx.moveTo(mouse.x + 4, mouse.y); ctx.lineTo(mouse.x + 12, mouse.y);
			ctx.moveTo(mouse.x, mouse.y - 12); ctx.lineTo(mouse.x, mouse.y - 4);
			ctx.moveTo(mouse.x, mouse.y + 4); ctx.lineTo(mouse.x, mouse.y + 12);
			ctx.stroke();
		}
		if (tap.age < 1 && anim > 0) {
			tap.age += dt * 1.6 * anim;
			ctx.globalAlpha = (1 - tap.age) * 0.6 * (1 - CENTER_CALM * band(tap.x));
			ctx.strokeStyle = c.cursor;
			ctx.beginPath();
			ctx.arc(tap.x, tap.y, 4 + tap.age * 22, 0, 6.283);
			ctx.stroke();
		}
		ctx.globalAlpha = 1;
	}
}

self.onmessage = (e) => {
	const d = e.data, now = performance.now(), i = CH.indexOf(d.type);
	evCount++;
	if (i >= 0) { count[i]++; lastAt[i] = now; pulse[i] = 1; }
	switch (d.type) {
		case 'init':
			canvas = d.canvas;
			ctx = canvas.getContext('2d');
			w = d.width;
			h = d.height;
			dpr = Math.min(d.dpr || 1, 2);
			reduced = !!d.reducedMotion;
			start = fpsAt = now;
			applyTheme(d.theme);
			size();
			addLog('init', w + '×' + h + ' @' + dpr + 'x' + (reduced ? ' rm' : ''), now);
			requestAnimationFrame(frame);
			break;
		case 'resize':
			w = d.width;
			h = d.height;
			dpr = Math.min(d.dpr || 1, 2);
			if (canvas) size();
			addLog('resize', w + '×' + h + ' @' + (d.dpr || 1) + 'x', now);
			break;
		case 'theme':
			applyTheme(d);
			addLog('theme', themeMode, now);
			break;
		case 'motion':
			reduced = !!d.reducedMotion;
			addLog('motion', reduced ? 'reduced' : 'full', now);
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.at = now;
			break;
		case 'mousedown':
			tap.x = d.x;
			tap.y = d.y;
			tap.age = 0;
			addLog('mousedown', (d.x | 0) + ',' + (d.y | 0), now);
			break;
		case 'mouseup':
		case 'click':
			addLog(d.type, (d.x | 0) + ',' + (d.y | 0), now);
			break;
		case 'touchstart':
		case 'touchend':
			addLog(d.type, (d.touches ? d.touches.length : 0) + ' pts', now);
			break;
		case 'context':
			if (typeof d.exactTokens === 'number') ctxApi = { exactTokens: d.exactTokens };
			if (typeof d.estimatedTokens === 'number') ctxDom = { messages: d.messages, chars: d.chars, estimatedTokens: d.estimatedTokens };
			addLog('context', typeof d.exactTokens === 'number' ? d.exactTokens + ' tok' : '~' + d.estimatedTokens + ' tok', now);
			break;
	}
};
