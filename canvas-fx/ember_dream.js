/**
 * Title: Ember Dream
 * Description: Campfire embers rise from the bottom of the screen in your theme's colors, cool as they climb, thin out behind the chat, scatter when the cursor sweeps past and burst from a tap.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const EMBER_COUNT   = 150;   // embers in the air at once (30-400)
const RISE_SPEED    = 42;    // average climb, in px per second (10-120)
const RISE_HEIGHT   = 0.55;  // how far up the screen embers climb before burning out (0.2-1)
const SWAY          = 18;    // side-to-side drift, in px per second (0-60)
const EMBER_SIZE    = 1;     // size of each ember and its glow (0.5-2)
const WISPS         = 5;     // faint flame wisps along the bottom edge (0-12)
const GLOW_POOLS    = 3;     // warm pools of firelight along the bottom (0-6)
const WIND          = 1;     // how hard a moving cursor scatters embers (0-3)
const BURST_SIZE    = 24;    // embers thrown by a tap; 0 turns taps off (0-60)
const MOTION        = 1;     // overall speed (0.2-2)
const REDUCED_SPEED = 0.25;  // speed kept when the viewer asks to reduce motion (0-1)
const CENTER_CALM   = 0.8;   // how much the embers thin out behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const COLOR_HOT     = '#ffd98a';  // fresh ember color when not following the theme
const COLOR_WARM    = '#ff8c3a';  // ember color halfway up
const COLOR_COOL    = '#d4442a';  // dying ember and wisp color
const FIRE_WARMTH   = 0.3;   // how far theme colors lean toward firelight (0-1)
/* ──────────────────────────────────────────── */

const MAX_BURST = 150, ES = 32, GS = 128;
let canvas, ctx, w = 0, h = 0, dpr = 1, last = 0, time = 0, reduced = false, dark = true, column = null;
let calmLut = new Float32Array(1), hexes = [COLOR_HOT, COLOR_WARM, COLOR_COOL];
const emberSprites = [], mouse = { x: -10000, y: -10000, energy: 0 };
let glowSprite = null, wispSprite = null;

// Ember pool
const ex = new Float32Array(EMBER_COUNT), ey = new Float32Array(EMBER_COUNT), evx = new Float32Array(EMBER_COUNT);
const ey0 = new Float32Array(EMBER_COUNT), erise = new Float32Array(EMBER_COUNT), espd = new Float32Array(EMBER_COUNT);
const esz = new Float32Array(EMBER_COUNT), eph = new Float32Array(EMBER_COUNT), eage = new Float32Array(EMBER_COUNT);
// Burst pool
const bx = new Float32Array(MAX_BURST), by = new Float32Array(MAX_BURST), bvx = new Float32Array(MAX_BURST), bvy = new Float32Array(MAX_BURST);
const blife = new Float32Array(MAX_BURST), bsz = new Float32Array(MAX_BURST);
let bcount = 0;
// Wisps and pools
const wx = new Float32Array(12), wy = new Float32Array(12), wage = new Float32Array(12), wspan = new Float32Array(12), wsc = new Float32Array(12), wph = new Float32Array(12);
const px = new Float32Array(6), pph = new Float32Array(6);

function rgb(hex) {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(c, a, lift) {
	return 'rgba(' + Math.round(c[0] + (255 - c[0]) * lift) + ',' + Math.round(c[1] + (255 - c[1]) * lift) + ',' + Math.round(c[2] + (255 - c[2]) * lift) + ',' + a + ')';
}
// Leans a theme color toward its firelight default, so embers still read as embers
function mix(a, b) {
	const x = rgb(a), y = rgb(b), k = FIRE_WARMTH;
	return '#' + ((1 << 24) | (Math.round(x[0] + (y[0] - x[0]) * k) << 16) | (Math.round(x[1] + (y[1] - x[1]) * k) << 8) | Math.round(x[2] + (y[2] - x[2]) * k)).toString(16).slice(1);
}
function radial(size, stops) {
	const s = new OffscreenCanvas(size, size), g = s.getContext('2d'), r = size / 2;
	const grad = g.createRadialGradient(r, r, 0, r, r, r);
	for (let i = 0; i < stops.length; i += 2) grad.addColorStop(stops[i], stops[i + 1]);
	g.fillStyle = grad;
	g.fillRect(0, 0, size, size);
	return s;
}

// Sprites: one glowing ember per heat stage, a pool of firelight and a soft flame tongue
function buildSprites() {
	for (let i = 0; i < 3; i++) {
		const c = rgb(hexes[i]);
		emberSprites[i] = dark
			? radial(ES, [0, rgba(c, 1, 0.75 - i * 0.25), 0.07, rgba(c, 1, 0.35 - i * 0.12), 0.18, rgba(c, 0.7, 0), 0.4, rgba(c, 0.22, 0), 0.7, rgba(c, 0.05, 0), 1, rgba(c, 0, 0)])
			: radial(ES, [0, rgba(c, 1, 0), 0.16, rgba(c, 0.95, 0), 0.3, rgba(c, 0.35, 0), 0.6, rgba(c, 0.06, 0), 1, rgba(c, 0, 0)]);
	}
	const warm = rgb(hexes[1]), cool = rgb(hexes[2]);
	glowSprite = radial(GS, [0, rgba(warm, 1, 0), 0.4, rgba(warm, 0.45, 0), 1, rgba(warm, 0, 0)]);
	wispSprite = new OffscreenCanvas(64, 192);
	const g = wispSprite.getContext('2d');
	const grad = g.createLinearGradient(0, 192, 0, 0);
	grad.addColorStop(0, rgba(cool, 1, 0));
	grad.addColorStop(0.45, rgba(warm, 0.8, 0));
	grad.addColorStop(1, rgba(rgb(hexes[0]), 0, 0));
	g.fillStyle = grad;
	g.globalAlpha = 0.12;
	for (let k = 0; k < 9; k++) {
		const s = 1 - k * 0.08;
		g.beginPath();
		g.moveTo(32 - 30 * s, 192);
		g.bezierCurveTo(32 - 32 * s, 120, 32 - 6 * s, 80, 32 + 4 * s, 192 - 188 * s);
		g.bezierCurveTo(32 + 14 * s, 90, 32 + 32 * s, 130, 32 + 30 * s, 192);
		g.fill();
	}
}

function applyTheme(t) {
	if (!t) return;
	dark = t.dark !== false;
	if (FOLLOW_THEME && t.colors) hexes = [mix(t.colors.accent, COLOR_HOT), mix(t.colors.accent2, COLOR_WARM), mix(t.colors.accent3, COLOR_COOL)];
	if (ctx) buildSprites();
}

// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }

// Density and alpha factor across the screen, rebuilt on resize and layout
function buildCalm() {
	calmLut = new Float32Array((w >> 2) + 2);
	const cx = colX(), half = colHalf();
	for (let i = 0; i < calmLut.length; i++) {
		const t = Math.min(1, Math.max(0, (Math.abs(i * 4 - cx) / half - 0.55) / 0.7));
		calmLut[i] = 1 - CENTER_CALM * (1 - t * t * (3 - 2 * t));
	}
}

function calm(x) {
	const i = x >> 2;
	return calmLut[i < 0 ? 0 : i >= calmLut.length ? calmLut.length - 1 : i];
}

// Spawn in the bottom fifth, less often behind the chat column
function spawn(i, scatter) {
	let x = Math.random() * w;
	for (let k = 0; k < 3 && Math.random() > calm(x); k++) x = Math.random() * w;
	ex[i] = x;
	ey0[i] = h * (0.82 + Math.random() * 0.2);
	erise[i] = h * RISE_HEIGHT * (0.35 + Math.random() * 0.65);
	ey[i] = scatter ? ey0[i] - erise[i] * Math.random() : ey0[i];
	evx[i] = 0;
	espd[i] = RISE_SPEED * (0.6 + Math.random() * 0.8);
	esz[i] = (22 + Math.random() * 24) * EMBER_SIZE;
	eph[i] = Math.random() * 6.283;
	eage[i] = scatter ? 2 : 0;
}

function size(oldW, oldH) {
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	buildCalm();
	if (oldW) {
		const sx = w / oldW, sy = h / oldH;
		for (let i = 0; i < EMBER_COUNT; i++) { ex[i] *= sx; ey[i] *= sy; ey0[i] *= sy; erise[i] *= sy; }
		for (let i = 0; i < bcount; i++) { bx[i] *= sx; by[i] *= sy; }
	} else {
		for (let i = 0; i < EMBER_COUNT; i++) spawn(i, true);
	}
	for (let i = 0; i < 12; i++) resetWisp(i, true);
	for (let i = 0; i < 6; i++) { const side = i % 2; px[i] = side ? w * (0.86 + Math.random() * 0.12) : w * (0.02 + Math.random() * 0.12); pph[i] = Math.random() * 6.283; }
}

// Wisps rise beside the chat column, on either side by the room each has
function resetWisp(i, scatter) {
	const pad = w * 0.03, left = Math.max(0, colX() - colHalf() * 0.6 - pad), right = Math.max(0, w - pad - colX() - colHalf() * 0.6);
	const r = Math.random() * (left + right);
	wx[i] = left + right < 40 ? Math.random() * w : r < left ? pad + r : w - pad - (r - left);
	wy[i] = h + 30 + Math.random() * 40;
	wspan[i] = 5 + Math.random() * 5;
	wage[i] = scatter ? Math.random() * wspan[i] : 0;
	wsc[i] = 0.6 + Math.random() * 0.7;
	wph[i] = Math.random() * 6.283;
}

function burst(x, y) {
	const n = Math.round(BURST_SIZE * Math.max(0.3, calm(x)));
	for (let k = 0; k < n && bcount < MAX_BURST; k++) {
		const i = bcount++, a = Math.random() * 6.283, v = 40 + Math.random() * 110;
		bx[i] = x; by[i] = y;
		bvx[i] = Math.cos(a) * v; bvy[i] = Math.sin(a) * v - 50;
		blife[i] = 1.2 + Math.random() * 1.2;
		bsz[i] = (20 + Math.random() * 16) * EMBER_SIZE;
	}
}

function frame(now) {
	requestAnimationFrame(frame);
	const real = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const dt = real * MOTION * (reduced ? REDUCED_SPEED : 1);
	time += dt;
	mouse.energy *= Math.exp(-real * 2.5);
	ctx.clearRect(0, 0, w, h);
	const lit = dark ? 1 : 0.9;

	// Firelight pools and wisps along the bottom
	ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
	for (let i = 0; i < GLOW_POOLS; i++) {
		const d = 420 + 60 * Math.sin(time * 0.4 + pph[i]);
		ctx.globalAlpha = (dark ? 0.13 : 0.05) * (0.75 + 0.25 * Math.sin(time * 0.9 + pph[i] * 3));
		ctx.drawImage(glowSprite, px[i] - d / 2, h - d * 0.32, d, d);
	}
	for (let i = 0; i < WISPS; i++) {
		wage[i] += dt;
		if (wage[i] > wspan[i]) resetWisp(i, false);
		const f = wage[i] / wspan[i], s = wsc[i];
		ctx.globalAlpha = (dark ? 0.15 : 0.06) * Math.sin(f * 3.1416) * calm(wx[i]);
		const fl = 1 + 0.12 * Math.sin(time * 5 + wph[i]), sk = 0.18 * Math.sin(time * 0.7 + wph[i]);
		ctx.setTransform(dpr * s * fl, 0, dpr * sk * s, dpr * s * (1 - f * 0.3), dpr * wx[i], dpr * (wy[i] - f * 90));
		ctx.drawImage(wispSprite, -32, -192);
	}
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

	// Embers: climb, sway, cool through three colors and burn out
	const drag = Math.exp(-1.6 * dt), wind = WIND * mouse.energy * 900;
	for (let i = 0; i < EMBER_COUNT; i++) {
		eage[i] += dt;
		ey[i] -= espd[i] * dt;
		const r = (ey0[i] - ey[i]) / erise[i];
		if (r >= 1) { spawn(i, false); continue; }
		if (wind > 1) {
			const dx = ex[i] - mouse.x, dy = ey[i] - mouse.y, dd = dx * dx + dy * dy;
			if (dd < 32400 && dd > 1) {
				const dist = Math.sqrt(dd);
				evx[i] += (dx / dist) * (1 - dist / 180) * wind * dt;
				ey[i] -= (1 - dist / 180) * wind * 0.15 * dt;
			}
		}
		evx[i] *= drag;
		ex[i] += (evx[i] + Math.sin(time * 0.8 + eph[i]) * SWAY) * dt;
		if (ex[i] < -20) ex[i] += w + 40; else if (ex[i] > w + 20) ex[i] -= w + 40;
		const a = Math.min(1, eage[i] / 0.8) * (1 - r * r) * (0.7 + 0.3 * Math.sin(time * 3 + eph[i] * 5)) * calm(ex[i]) * lit;
		if (a < 0.02) continue;
		const d = esz[i] * (1 - r * 0.5);
		ctx.globalAlpha = a;
		ctx.drawImage(emberSprites[r < 0.3 ? 0 : r < 0.65 ? 1 : 2], ex[i] - d / 2, ey[i] - d / 2, d, d);
	}

	// Tap bursts
	const grav = 60 * dt;
	for (let i = 0; i < bcount; i++) {
		blife[i] -= dt;
		if (blife[i] <= 0) {
			const j = --bcount;
			bx[i] = bx[j]; by[i] = by[j]; bvx[i] = bvx[j]; bvy[i] = bvy[j]; blife[i] = blife[j]; bsz[i] = bsz[j];
			i--;
			continue;
		}
		bvx[i] *= drag; bvy[i] = bvy[i] * drag + grav;
		bx[i] += bvx[i] * dt; by[i] += bvy[i] * dt;
		const f = Math.min(1, blife[i] / 1.2);
		ctx.globalAlpha = f * lit * Math.max(0.35, calm(bx[i]));
		const d = bsz[i] * (0.6 + 0.4 * f);
		ctx.drawImage(emberSprites[f > 0.6 ? 0 : 1], bx[i] - d / 2, by[i] - d / 2, d, d);
	}
	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'source-over';
}

function move(x, y) {
	if (mouse.x > -9000) mouse.energy = Math.min(1, mouse.energy + Math.hypot(x - mouse.x, y - mouse.y) / 60);
	mouse.x = x; mouse.y = y;
}

self.onmessage = (e) => {
	const d = e.data;
	switch (d.type) {
		case 'init':
			canvas = d.canvas;
			ctx = canvas.getContext('2d');
			w = d.width; h = d.height; dpr = Math.min(d.dpr || 1, 1);
			reduced = !!d.reducedMotion;
			column = d.column || null;
			applyTheme(d.theme);
			buildSprites();
			size(0, 0);
			requestAnimationFrame(frame);
			break;
		case 'resize': {
			const ow = w, oh = h;
			w = d.width; h = d.height; dpr = Math.min(d.dpr || 1, 1);
			if (canvas) size(ow, oh);
			break;
		}
		case 'theme':
			applyTheme(d);
			break;
		case 'motion':
			reduced = !!d.reducedMotion;
			break;
		case 'layout':
			column = d.column || null;
			if (canvas) buildCalm();
			break;
		case 'mousemove':
			move(d.x, d.y);
			break;
		case 'touchmove':
			if (d.touches && d.touches.length) move(d.touches[0].x, d.touches[0].y);
			break;
		case 'mousedown':
			if (!reduced && BURST_SIZE > 0) burst(d.x, d.y);
			break;
	}
};
