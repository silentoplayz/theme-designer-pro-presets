/**
 * Title: Aetheric Flow
 * Description: Silky filaments in your theme's colors stream through a slowly shifting noise field, leave fading trails, thin out behind the chat and curl around a moving cursor.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const FILAMENTS     = 900;   // filaments in the field (200-2500)
const SPEED         = 48;    // filament speed, in px per second (10-150)
const FIELD_SCALE   = 0.0022; // size of the flow's swirls; lower is broader (0.0008-0.006)
const FIELD_DRIFT   = 0.06;  // how fast the field itself shifts (0-0.3)
const TURBULENCE    = 0.35;  // fine detail mixed into the flow (0-1)
const TRAIL_FADE    = 0.75;  // how fast trails fade, per second; lower is longer (0.2-3)
const LINE_WIDTH    = 1;     // filament thickness, in px (0.5-2.5)
const OPACITY       = 0.5;   // filament strength (0.1-1)
const CURSOR_CURL   = 1;     // how strongly a moving cursor bends the flow (0-3)
const MOTION        = 1;     // overall speed (0.2-2)
const REDUCED_SPEED = 0.2;   // speed kept when the viewer asks to reduce motion (0-1)
const CENTER_CALM   = 0.8;   // how much the filaments fade behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const COLOR_A       = '#5fd4e8';  // first filament color when not following the theme
const COLOR_B       = '#7a8cff';  // second filament color
const COLOR_C       = '#b48cff';  // third filament color
const COLOR_D       = '#6c7a99';  // quiet structure color
/* ──────────────────────────────────────────── */

const NC = 4, NT = 4, NB = NC * NT;
let canvas, ctx, w = 0, h = 0, dpr = 1, last = 0, time = 0, reduced = false, dark = true, fadeDebt = 0, column = null;
let calmLut = new Float32Array(1), hexes = [COLOR_A, COLOR_B, COLOR_C, COLOR_D];
const styles = new Array(NB).fill('#000');
const mouse = { x: -10000, y: -10000, energy: 0 };

const fx = new Float32Array(FILAMENTS), fy = new Float32Array(FILAMENTS), ox = new Float32Array(FILAMENTS), oy = new Float32Array(FILAMENTS);
const fspd = new Float32Array(FILAMENTS), fage = new Float32Array(FILAMENTS), flife = new Float32Array(FILAMENTS);
const fcol = new Uint8Array(FILAMENTS), bucket = new Uint8Array(FILAMENTS);
const counts = new Uint16Array(NB), starts = new Uint16Array(NB), order = new Uint16Array(FILAMENTS);

// Smooth value noise from a fixed table
const perm = new Uint8Array(512), vals = new Float32Array(256);
for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = Math.random(); }
for (let i = 255; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)), t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
function noise(x, y) {
	const xf = Math.floor(x), yf = Math.floor(y), ix = xf & 255, iy = yf & 255;
	let u = x - xf, v = y - yf;
	u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
	const a = vals[perm[ix + perm[iy]]], b = vals[perm[ix + 1 + perm[iy]]];
	const c = vals[perm[ix + perm[iy + 1]]], d = vals[perm[ix + 1 + perm[iy + 1]]];
	return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function rgb(hex) {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// One stroke style per color and calm tier, built at theme change
function buildStyles() {
	const minC = 1 - CENTER_CALM, base = OPACITY * (dark ? 1 : 0.85);
	for (let c = 0; c < NC; c++) {
		const v = rgb(hexes[c]);
		for (let t = 0; t < NT; t++) {
			const a = base * (minC + (1 - minC) * t / (NT - 1)) * (c === 3 ? 0.7 : 1);
			styles[c * NT + t] = 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + a.toFixed(3) + ')';
		}
	}
}

function applyTheme(t) {
	if (!t) return;
	dark = t.dark !== false;
	if (FOLLOW_THEME && t.colors) hexes = [t.colors.accent, t.colors.accent2, t.colors.accent3, t.colors.muted];
	buildStyles();
}

// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }

// Fade per 4 px across the screen, rebuilt on resize and layout
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

// Respawn away from the chat column more often than over it
function spawn(i) {
	let x = Math.random() * w;
	for (let k = 0; k < 2 && Math.random() > calm(x); k++) x = Math.random() * w;
	fx[i] = ox[i] = x;
	fy[i] = oy[i] = Math.random() * h;
	fspd[i] = SPEED * (0.55 + Math.random() * 0.9);
	fage[i] = 0;
	flife[i] = 4 + Math.random() * 8;
	const r = Math.random();
	fcol[i] = r < 0.34 ? 0 : r < 0.6 ? 1 : r < 0.84 ? 2 : 3;
}

function size(oldW, oldH) {
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	buildCalm();
	if (oldW) {
		// Keep the flow where it was, scaled to the new size
		const sx = w / oldW, sy = h / oldH;
		for (let i = 0; i < FILAMENTS; i++) { fx[i] *= sx; fy[i] *= sy; ox[i] = fx[i]; oy[i] = fy[i]; }
	} else {
		for (let i = 0; i < FILAMENTS; i++) { spawn(i); fage[i] = Math.random() * flife[i]; }
	}
}

function frame(now) {
	requestAnimationFrame(frame);
	const real = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const dt = real * MOTION * (reduced ? REDUCED_SPEED : 1);
	time += dt;
	mouse.energy *= Math.exp(-real * 1.5);

	// Fade the trails toward transparent. Small fades pile up until they are large
	// enough not to round away, so no faint ghost lines are left behind.
	fadeDebt += 1 - Math.exp(-real * TRAIL_FADE * (reduced ? 0.3 : 1));
	if (fadeDebt >= 0.1) {
		ctx.globalCompositeOperation = 'destination-out';
		ctx.globalAlpha = Math.min(1, fadeDebt);
		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, w, h);
		ctx.globalAlpha = 1;
		fadeDebt = 0;
	}
	ctx.globalCompositeOperation = 'source-over';

	const tx = time * FIELD_DRIFT, curl = CURSOR_CURL * mouse.energy;
	counts.fill(0);
	for (let i = 0; i < FILAMENTS; i++) {
		fage[i] += dt;
		const x = fx[i], y = fy[i];
		if (fage[i] > flife[i] || x < -10 || x > w + 10 || y < -10 || y > h + 10) { spawn(i); bucket[i] = 255; continue; }
		const sx = x * FIELD_SCALE, sy = y * FIELD_SCALE;
		let n = noise(sx + tx, sy - tx * 0.7);
		if (TURBULENCE > 0) n += TURBULENCE * (noise(sx * 2.7 - tx, sy * 2.7 + 31.7) - 0.5);
		let ang = n * 12.566;
		if (curl > 0.01) {
			const dx = x - mouse.x, dy = y - mouse.y, dd = dx * dx + dy * dy;
			if (dd < 40000) ang += (1 - Math.sqrt(dd) / 200) * 2.2 * curl;
		}
		ox[i] = x; oy[i] = y;
		fx[i] = x + Math.cos(ang) * fspd[i] * dt;
		fy[i] = y + Math.sin(ang) * fspd[i] * dt;
		const c = calm(x), t = Math.round((c - 1 + CENTER_CALM) / Math.max(0.001, CENTER_CALM) * (NT - 1));
		// Fade each filament in and out over its life so none pops
		const f = fage[i] / flife[i], tier = (f < 0.08 || f > 0.92) ? Math.max(0, t - 1) : t;
		const b = fcol[i] * NT + tier;
		bucket[i] = b;
		counts[b]++;
	}

	// Counting sort into buckets, then one stroke per color and tier
	let s = 0;
	for (let b = 0; b < NB; b++) { starts[b] = s; s += counts[b]; }
	for (let i = 0; i < FILAMENTS; i++) { const b = bucket[i]; if (b !== 255) order[starts[b]++] = i; }
	ctx.lineWidth = LINE_WIDTH;
	ctx.lineCap = 'round';
	let k = 0;
	for (let b = 0; b < NB; b++) {
		const n = counts[b];
		if (!n) continue;
		ctx.strokeStyle = styles[b];
		ctx.beginPath();
		for (let j = 0; j < n; j++, k++) {
			const i = order[k];
			ctx.moveTo(ox[i], oy[i]);
			ctx.lineTo(fx[i], fy[i]);
		}
		ctx.stroke();
	}
}

self.onmessage = (e) => {
	const d = e.data;
	switch (d.type) {
		case 'init':
			canvas = d.canvas;
			ctx = canvas.getContext('2d');
			w = d.width; h = d.height; dpr = Math.min(d.dpr || 1, 2);
			reduced = !!d.reducedMotion;
			column = d.column || null;
			applyTheme(d.theme);
			buildStyles();
			size(0, 0);
			requestAnimationFrame(frame);
			break;
		case 'resize': {
			const ow = w, oh = h;
			w = d.width; h = d.height; dpr = Math.min(d.dpr || 1, 2);
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
			if (mouse.x > -9000) mouse.energy = Math.min(1, mouse.energy + Math.hypot(d.x - mouse.x, d.y - mouse.y) / 80);
			mouse.x = d.x; mouse.y = d.y;
			break;
	}
};
