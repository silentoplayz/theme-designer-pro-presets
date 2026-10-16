/**
 * Title: Snow Globe
 * Description: Snow in three depths drifts down the sides of the screen on a slow breeze, a few large flakes turn as crystals and glint, a moving cursor swirls the flakes, and a thin drift settles along the bottom edge.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const FLAKE_COUNT   = 170;   // snowflakes in the air (30-500)
const FLAKE_SIZE    = 1;     // size of the flakes (0.5-2)
const FALL_SPEED    = 55;    // falling speed of a mid-depth flake, in px per second (10-160)
const BREEZE        = 1;     // strength of the slow sideways breeze (0-3)
const CRYSTALS      = 0.4;   // share of near flakes drawn as six-armed crystals (0-1)
const GLINTS        = 1;     // how often flakes catch the light (0-3)
const SWIRL         = 1;     // how strongly a moving cursor swirls the snow (0-3)
const DRIFT_HEIGHT  = 6;     // tallest the drift along the bottom grows, in px; 0 turns it off (0-12)
const OPACITY       = 0.85;  // flake strength (0.2-1)
const MOTION        = 1;     // overall speed (0.2-2)
const REDUCED_SPEED = 0.25;  // speed kept when the viewer asks to reduce motion (0-1)
const CENTER_CALM   = 0.75;  // how much the snow thins behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band around the chat column, in px (300-900)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const SNOW_COLOR    = '#f2f6ff';  // flake color when not following the theme
const GLINT_COLOR   = '#bfe0ff';  // glint color when not following the theme
/* ──────────────────────────────────────────── */

const N = FLAKE_COUNT, COL = 8;
let canvas, ctx, w = 0, h = 0, dpr = 1, last = 0, time = 0, reduced = false, dark = true;
let calmLut = new Float32Array(1), drift = new Float32Array(1), cap = new Float32Array(1);
let snowHex = SNOW_COLOR, glintHex = GLINT_COLOR, dot = null, crystal = null, glow = null, driftFill = '#fff', driftEdge = '#fff';
const mouse = { x: -10000, y: -10000, energy: 0 };

const fx = new Float32Array(N), fy = new Float32Array(N), fvx = new Float32Array(N), fvy = new Float32Array(N);
const fsz = new Float32Array(N), fspd = new Float32Array(N), fph = new Float32Array(N), fop = new Float32Array(N);
const frot = new Float32Array(N), fglint = new Float32Array(N), fkind = new Uint8Array(N);

function rgb(hex) {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
function blend(a, b, k) { return [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)]; }

function buildSprites() {
	const s = rgb(snowHex), g = rgb(glintHex);
	dot = dot || new OffscreenCanvas(32, 32);
	let c = dot.getContext('2d');
	c.clearRect(0, 0, 32, 32);
	let grad = c.createRadialGradient(16, 16, 0, 16, 16, 16);
	grad.addColorStop(0, rgba(s, 1)); grad.addColorStop(0.35, rgba(s, 0.85)); grad.addColorStop(0.6, rgba(s, 0.2)); grad.addColorStop(1, rgba(s, 0));
	c.fillStyle = grad; c.fillRect(0, 0, 32, 32);

	crystal = crystal || new OffscreenCanvas(48, 48);
	c = crystal.getContext('2d');
	c.setTransform(1, 0, 0, 1, 0, 0);
	c.clearRect(0, 0, 48, 48);
	c.setTransform(1, 0, 0, 1, 24, 24);
	c.strokeStyle = rgba(s, 0.95);
	c.lineWidth = 2;
	c.lineCap = 'round';
	c.beginPath();
	for (let i = 0; i < 6; i++) {
		const a = i * 1.0472, ca = Math.cos(a), sa = Math.sin(a);
		c.moveTo(0, 0); c.lineTo(ca * 20, sa * 20);
		for (let k = 0; k < 2; k++) {
			const r = 9 + k * 6, l = 6 - k * 2, bx = ca * r, by = sa * r;
			c.moveTo(bx, by); c.lineTo(bx + Math.cos(a + 0.8) * l, by + Math.sin(a + 0.8) * l);
			c.moveTo(bx, by); c.lineTo(bx + Math.cos(a - 0.8) * l, by + Math.sin(a - 0.8) * l);
		}
	}
	c.stroke();

	glow = glow || new OffscreenCanvas(32, 32);
	c = glow.getContext('2d');
	c.clearRect(0, 0, 32, 32);
	grad = c.createRadialGradient(16, 16, 0, 16, 16, 16);
	grad.addColorStop(0, rgba(blend(g, [255, 255, 255], dark ? 0.6 : 0), 1)); grad.addColorStop(0.2, rgba(g, 0.6)); grad.addColorStop(1, rgba(g, 0));
	c.fillStyle = grad; c.fillRect(0, 0, 32, 32);

	driftFill = rgba(s, dark ? 0.6 : 0.4);
	driftEdge = rgba(blend(s, [255, 255, 255], dark ? 0.6 : 0), dark ? 0.7 : 0.5);
}

function applyTheme(t) {
	if (!t) return;
	dark = t.dark !== false;
	if (FOLLOW_THEME && t.colors) {
		const c = t.colors;
		// Dark themes: snow from the text color with a cool accent cast. Light themes: a soft muted blue-gray that shows on white.
		snowHex = dark ? hex(blend(rgb(c.text), rgb(c.accent3), 0.15)) : hex(blend(rgb(c.muted), rgb(c.accent3), 0.35));
		glintHex = c.accent3;
	}
	if (ctx) buildSprites();
}
function hex(c) { return '#' + ((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1); }

function calm(x) {
	const i = x >> 2;
	return calmLut[i < 0 ? 0 : i >= calmLut.length ? calmLut.length - 1 : i];
}

// Three depths: far flakes are small and slow, near ones large, quick and sometimes crystals
function spawn(i, anywhere) {
	let x = Math.random() * w;
	for (let k = 0; k < 3 && Math.random() > calm(x); k++) x = Math.random() * w;
	const depth = Math.random(), near = depth > 0.82;
	fx[i] = x;
	fy[i] = anywhere ? Math.random() * h : -10 - Math.random() * 40;
	fsz[i] = (depth < 0.45 ? 2.2 + Math.random() * 1.6 : near ? 6 + Math.random() * 4 : 3.8 + Math.random() * 2.4) * FLAKE_SIZE;
	fspd[i] = FALL_SPEED * (depth < 0.45 ? 0.5 : near ? 1.5 : 1) * (0.85 + Math.random() * 0.3);
	fop[i] = depth < 0.45 ? 0.45 : near ? 0.95 : 0.7;
	fvx[i] = 0; fvy[i] = fspd[i];
	fph[i] = Math.random() * 6.283;
	frot[i] = Math.random() * 6.283;
	fglint[i] = 0;
	fkind[i] = near && Math.random() < CRYSTALS ? 1 : 0;
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
	// The drift starts settled, lower behind the chat column so the message box stays clear
	const n = Math.ceil(w / COL) + 2;
	drift = new Float32Array(n); cap = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const x = i * COL;
		cap[i] = DRIFT_HEIGHT * (0.3 + 0.7 * (calm(x) - 1 + CENTER_CALM) / Math.max(0.01, CENTER_CALM)) * (0.75 + 0.25 * Math.sin(x * 0.013) * Math.sin(x * 0.0051 + 1));
		drift[i] = cap[i] * 0.9;
	}
	if (oldW) for (let i = 0; i < N; i++) { fx[i] *= w / oldW; fy[i] *= h / oldH; }
	else for (let i = 0; i < N; i++) spawn(i, true);
}

function land(x, s) {
	const c = Math.round(x / COL);
	for (let k = -1; k <= 1; k++) {
		const j = c + k;
		if (j < 0 || j >= drift.length) continue;
		drift[j] += s * 0.12 * (k ? 0.5 : 1) * Math.max(0, 1 - drift[j] / Math.max(0.01, cap[j]));
	}
}

function frame(now) {
	requestAnimationFrame(frame);
	const real = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const dt = real * MOTION * (reduced ? REDUCED_SPEED : 1);
	time += dt;
	mouse.energy *= Math.exp(-real * 1.8);
	ctx.clearRect(0, 0, w, h);

	const breeze = BREEZE * 16 * (Math.sin(time * 0.11) + 0.5 * Math.sin(time * 0.29 + 2)), swirl = SWIRL * mouse.energy;
	const base = OPACITY * (dark ? 1 : 0.95), ease = Math.min(1, dt * 2), glintRate = reduced ? 0 : GLINTS * 0.02 * real;
	if (dark) ctx.globalCompositeOperation = 'lighter';
	for (let i = 0; i < N; i++) {
		let tx = breeze * (fspd[i] / FALL_SPEED) + Math.sin(time * 0.9 + fph[i]) * 10, ty = fspd[i];
		if (swirl > 0.02) {
			const dx = fx[i] - mouse.x, dy = fy[i] - mouse.y, dd = dx * dx + dy * dy;
			if (dd < 28900 && dd > 1) {
				const dist = Math.sqrt(dd), f = (1 - dist / 170) * swirl * 260, nx = dx / dist, ny = dy / dist;
				tx += (-ny * 1.2 + nx * 0.5) * f; ty += (nx * 1.2 + ny * 0.5) * f;
			}
		}
		fvx[i] += (tx - fvx[i]) * ease; fvy[i] += (ty - fvy[i]) * ease;
		fx[i] += fvx[i] * dt; fy[i] += fvy[i] * dt;
		if (fx[i] < -12) fx[i] += w + 24; else if (fx[i] > w + 12) fx[i] -= w + 24;
		const j = Math.round(fx[i] / COL), floor = h - (j >= 0 && j < drift.length ? drift[j] : 0);
		if (fy[i] >= floor) { if (DRIFT_HEIGHT > 0) land(fx[i], fsz[i]); spawn(i, false); continue; }
		if (fy[i] < -60) fy[i] = -10;

		const c = calm(fx[i]);
		const a = base * fop[i] * c;
		if (fglint[i] > 0) fglint[i] = Math.max(0, fglint[i] - dt * 1.6);
		else if (fsz[i] > 3.5 * FLAKE_SIZE && Math.random() < glintRate) fglint[i] = 1;
		if (fglint[i] > 0) {
			const e = Math.sin(fglint[i] * 3.1416), d = fsz[i] * 4;
			ctx.globalAlpha = a * e * 0.9;
			ctx.drawImage(glow, fx[i] - d / 2, fy[i] - d / 2, d, d);
		}
		ctx.globalAlpha = a;
		if (fkind[i]) {
			frot[i] += dt * 0.5;
			const d = fsz[i] * 3, k = d / 48, cs = Math.cos(frot[i]) * k, sn = Math.sin(frot[i]) * k;
			ctx.setTransform(dpr * cs, dpr * sn, -dpr * sn, dpr * cs, dpr * fx[i], dpr * fy[i]);
			ctx.drawImage(crystal, -24, -24);
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		} else {
			const d = fsz[i] * 1.8;
			ctx.drawImage(dot, fx[i] - d / 2, fy[i] - d / 2, d, d);
		}
	}
	ctx.globalCompositeOperation = 'source-over';
	ctx.globalAlpha = 1;

	// The drift melts slowly as it fills, so it stays a low living edge rather than a band
	if (DRIFT_HEIGHT > 0) {
		const n = drift.length;
		for (let i = 0; i < n; i++) drift[i] = Math.max(0, drift[i] - dt * 0.03 * (0.3 + drift[i] / Math.max(0.01, cap[i])));
		ctx.beginPath();
		ctx.moveTo(0, h);
		ctx.lineTo(0, h - drift[0]);
		for (let i = 1; i < n - 1; i++) {
			const x0 = i * COL, mx = x0 + COL / 2;
			ctx.quadraticCurveTo(x0, h - drift[i], mx, h - (drift[i] + drift[i + 1]) / 2);
		}
		ctx.lineTo(w, h);
		ctx.closePath();
		ctx.fillStyle = driftFill;
		ctx.fill();
		ctx.beginPath();
		ctx.moveTo(0, h - drift[0]);
		for (let i = 1; i < n - 1; i++) {
			const x0 = i * COL, mx = x0 + COL / 2;
			ctx.quadraticCurveTo(x0, h - drift[i], mx, h - (drift[i] + drift[i + 1]) / 2);
		}
		ctx.strokeStyle = driftEdge;
		ctx.lineWidth = 1;
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
