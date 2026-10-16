/**
 * Title: Falling Leaves
 * Description: Autumn leaves tinted toward your theme's colors tumble down the sides of the screen on a gentle breeze, thin out behind the chat, and lift in an updraft while the cursor moves.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const LEAF_COUNT    = 46;    // leaves in the air (8-150)
const LEAF_SIZE     = 34;    // average leaf length, in px (8-60)
const FALL_SPEED    = 45;    // falling speed, in px per second (10-150)
const SWAY          = 30;    // side-to-side drift, in px per second (0-80)
const TUMBLE        = 1;     // how much leaves flip and spin (0-2)
const BREEZE        = 1;     // strength of the slow passing gusts (0-3)
const UPDRAFT       = 1;     // how hard a moving cursor lifts nearby leaves (0-3)
const OPACITY       = 0.85;  // leaf strength (0.15-1)
const THEME_TINT    = 0.3;   // how far the autumn hues turn toward the theme's colors (0-1)
const MOTION        = 1;     // overall speed (0.2-2)
const REDUCED_SPEED = 0.25;  // speed kept when the viewer asks to reduce motion (0-1)
const CENTER_CALM   = 0.8;   // how much the leaves thin out behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band around the chat column, in px (300-900)
const FOLLOW_THEME  = true;  // tint the leaves with the theme's palette
const COLOR_A       = '#c8782a';  // amber leaf
const COLOR_B       = '#b4462a';  // rust leaf
const COLOR_C       = '#d2a632';  // gold leaf
const COLOR_D       = '#828c34';  // olive leaf
/* ──────────────────────────────────────────── */

const NS = 3, NC = 4, SP = 64, N = LEAF_COUNT;
let canvas, ctx, w = 0, h = 0, dpr = 1, last = 0, time = 0, reduced = false, dark = true;
let calmLut = new Float32Array(1), tints = null;
const sprites = [];
const mouse = { x: -10000, y: -10000, energy: 0 };
const AUTUMN = [COLOR_A, COLOR_B, COLOR_C, COLOR_D];

const lx = new Float32Array(N), ly = new Float32Array(N), lvx = new Float32Array(N), lvy = new Float32Array(N);
const lrot = new Float32Array(N), lspin = new Float32Array(N), lbase = new Float32Array(N), ltum = new Float32Array(N), ltsp = new Float32Array(N);
const lsz = new Float32Array(N), lph = new Float32Array(N), lop = new Float32Array(N), lspr = new Uint8Array(N);

function rgb(hex) {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hsl(c) {
	const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
	if (!d) return [0, 0, l];
	const hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return [hh * 60, d / (1 - Math.abs(2 * l - 1)), l];
}
function fromHsl(hh, sat, l) {
	const k = (n) => (n + hh / 30) % 12, a = sat * Math.min(l, 1 - l);
	const f = (n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
	return [f(0), f(8), f(4)];
}
// Turns an autumn hue part of the way toward a theme hue, keeping it rich, never muddy
function tint(leaf, theme) {
	const a = hsl(leaf), b = hsl(theme);
	let d = ((b[0] - a[0] + 540) % 360) - 180;
	if (b[1] < 0.12) d = 0;
	const lim = 70 * THEME_TINT, hh = (a[0] + Math.max(-lim, Math.min(lim, d * THEME_TINT)) + 360) % 360;
	const l = dark ? Math.max(0.5, a[2]) : Math.min(0.42, a[2]);
	return fromHsl(hh, Math.max(0.5, a[1]), l);
}
function css(c, a, m) { return 'rgba(' + Math.min(255, Math.round(c[0] * m)) + ',' + Math.min(255, Math.round(c[1] * m)) + ',' + Math.min(255, Math.round(c[2] * m)) + ',' + a + ')'; }

function leafPath(g, shape, s) {
	g.beginPath();
	if (shape === 0) {
		g.moveTo(0, -s);
		g.quadraticCurveTo(s * 0.62, -s * 0.3, s * 0.38, s * 0.35);
		g.quadraticCurveTo(s * 0.1, s * 0.75, 0, s * 0.8);
		g.quadraticCurveTo(-s * 0.1, s * 0.75, -s * 0.38, s * 0.35);
		g.quadraticCurveTo(-s * 0.62, -s * 0.3, 0, -s);
	} else if (shape === 1) {
		g.moveTo(0, -s * 0.9);
		g.bezierCurveTo(s * 0.85, -s * 0.6, s * 0.55, s * 0.3, 0, s * 0.75);
		g.bezierCurveTo(-s * 0.55, s * 0.3, -s * 0.85, -s * 0.6, 0, -s * 0.9);
	} else {
		const p = [0, -1, 0.16, -0.6, 0.48, -0.82, 0.4, -0.36, 0.86, -0.32, 0.62, 0.02, 0.78, 0.3, 0.3, 0.26, 0.14, 0.6, 0, 0.5];
		g.moveTo(0, -s);
		for (let i = 2; i < p.length; i += 2) g.lineTo(p[i] * s, p[i + 1] * s);
		for (let i = p.length - 4; i >= 0; i -= 2) g.lineTo(-p[i] * s, p[i + 1] * s);
	}
	g.closePath();
}

// One sprite per shape and tone, drawn at twice the size, rebuilt on theme change
function buildSprites() {
	const theme = tints || AUTUMN;
	for (let c = 0; c < NC; c++) {
		const col = tint(rgb(AUTUMN[c]), rgb(FOLLOW_THEME && tints ? theme[c] : AUTUMN[c]));
		const m = 1;
		for (let s = 0; s < NS; s++) {
			const k = c * NS + s, sp = sprites[k] || new OffscreenCanvas(SP, SP), g = sp.getContext('2d');
			g.setTransform(1, 0, 0, 1, 0, 0);
			g.clearRect(0, 0, SP, SP);
			g.setTransform(2, 0, 0, 2, SP / 2, SP / 2);
			const r = 14;
			leafPath(g, s, r);
			const grad = g.createLinearGradient(-r * 0.6, -r, r * 0.6, r);
			grad.addColorStop(0, css(col, 1, m * 1.15));
			grad.addColorStop(1, css(col, 1, m * 0.8));
			g.fillStyle = grad;
			g.fill();
			g.strokeStyle = css(col, 0.8, m * 0.6);
			g.lineWidth = 0.7;
			g.stroke();
			g.beginPath();
			g.moveTo(0, -r * 0.75); g.lineTo(0, r * 0.95);
			g.moveTo(0, -r * 0.2); g.lineTo(r * 0.3, -r * 0.45);
			g.moveTo(0, -r * 0.2); g.lineTo(-r * 0.3, -r * 0.45);
			g.moveTo(0, r * 0.2); g.lineTo(r * 0.32, -r * 0.02);
			g.moveTo(0, r * 0.2); g.lineTo(-r * 0.32, -r * 0.02);
			g.strokeStyle = css(col, 0.55, m * 0.55);
			g.lineWidth = 0.6;
			g.stroke();
			sprites[k] = sp;
		}
	}
}

function applyTheme(t) {
	if (!t) return;
	dark = t.dark !== false;
	if (FOLLOW_THEME && t.colors) tints = [t.colors.accent, t.colors.accent2, t.colors.accent3, t.colors.muted];
	if (ctx) buildSprites();
}

function calm(x) {
	const i = x >> 2;
	return calmLut[i < 0 ? 0 : i >= calmLut.length ? calmLut.length - 1 : i];
}

function spawn(i, anywhere) {
	let x = Math.random() * w;
	for (let k = 0; k < 3 && Math.random() > calm(x); k++) x = Math.random() * w;
	lx[i] = x;
	ly[i] = anywhere ? Math.random() * h : -20 - Math.random() * 60;
	lvx[i] = 0; lvy[i] = FALL_SPEED * 0.5;
	lsz[i] = LEAF_SIZE * (0.6 + Math.random() * 0.8);
	lrot[i] = Math.random() * 6.283;
	lbase[i] = lspin[i] = (Math.random() - 0.5) * 1.6;
	ltum[i] = Math.random() * 6.283;
	ltsp[i] = 0.8 + Math.random() * 1.6;
	lph[i] = Math.random() * 6.283;
	lop[i] = 0.6 + Math.random() * 0.4;
	lspr[i] = Math.floor(Math.random() * NC * NS);
}

function size(oldW, oldH) {
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	calmLut = new Float32Array((w >> 2) + 2);
	for (let i = 0; i < calmLut.length; i++) {
		const t = Math.min(1, Math.max(0, (Math.abs(i * 4 - w / 2) / BAND_WIDTH - 0.55) / 0.7));
		calmLut[i] = 1 - CENTER_CALM * (1 - t * t * (3 - 2 * t));
	}
	if (oldW) for (let i = 0; i < N; i++) { lx[i] *= w / oldW; ly[i] *= h / oldH; }
	else for (let i = 0; i < N; i++) spawn(i, true);
}

function frame(now) {
	requestAnimationFrame(frame);
	const real = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const dt = real * MOTION * (reduced ? REDUCED_SPEED : 1);
	time += dt;
	mouse.energy *= Math.exp(-real * 2);
	ctx.clearRect(0, 0, w, h);

	const breeze = BREEZE * 22 * (Math.sin(time * 0.13) + 0.6 * Math.sin(time * 0.37 + 1.3));
	const lift = UPDRAFT * mouse.energy, base = OPACITY * (dark ? 1 : 0.9), ease = Math.min(1, dt * 1.5);
	const tumble = reduced ? 0 : TUMBLE;
	for (let i = 0; i < N; i++) {
		let tx = Math.sin(time * 0.7 + lph[i]) * SWAY + breeze, ty = FALL_SPEED * (0.7 + 0.3 * Math.sin(time * 1.3 + lph[i] * 2));
		let spin = lbase[i];
		// The updraft only blows while the cursor moves, so a parked cursor leaves the leaves alone
		if (lift > 0.02) {
			const dx = lx[i] - mouse.x, dy = ly[i] - mouse.y, dd = dx * dx + dy * dy;
			if (dd < 32400 && dd > 1) {
				const dist = Math.sqrt(dd), s = (1 - dist / 180) * lift;
				ty -= s * 220; tx += (dx / dist) * s * 120;
				spin += Math.sign(lbase[i] || 1) * s * 4;
			}
		}
		lvx[i] += (tx - lvx[i]) * ease;
		lvy[i] += (ty - lvy[i]) * ease;
		lspin[i] += (spin - lspin[i]) * ease;
		lx[i] += lvx[i] * dt; ly[i] += lvy[i] * dt;
		lrot[i] += lspin[i] * TUMBLE * dt;
		ltum[i] += ltsp[i] * tumble * dt;
		if (ly[i] > h + 30 || lx[i] < -60 || lx[i] > w + 60 || ly[i] < -120) { spawn(i, false); continue; }

		const c = calm(lx[i]);
		ctx.globalAlpha = base * lop[i] * c;
		const flip = 0.25 + 0.75 * Math.abs(Math.cos(ltum[i])), k = lsz[i] / 56;
		const cs = Math.cos(lrot[i]), sn = Math.sin(lrot[i]);
		ctx.setTransform(dpr * cs * k * flip, dpr * sn * k * flip, -dpr * sn * k, dpr * cs * k, dpr * lx[i], dpr * ly[i]);
		ctx.drawImage(sprites[lspr[i]], -SP / 2, -SP / 2);
	}
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.globalAlpha = 1;
}

self.onmessage = (e) => {
	const d = e.data;
	switch (d.type) {
		case 'init':
			canvas = d.canvas;
			ctx = canvas.getContext('2d');
			w = d.width; h = d.height; dpr = Math.min(d.dpr || 1, 2);
			reduced = !!d.reducedMotion;
			applyTheme(d.theme);
			buildSprites();
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
		case 'mousemove':
			if (mouse.x > -9000) mouse.energy = Math.min(1, mouse.energy + Math.hypot(d.x - mouse.x, d.y - mouse.y) / 80);
			mouse.x = d.x; mouse.y = d.y;
			break;
	}
};
