/**
 * Title: Bubble Pop
 * Description: Iridescent bubbles in your theme's colors rise along the sides of the screen and drift away from a moving cursor; tap one to pop it, and its close neighbors pop after it.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const MAX_BUBBLES   = 22;    // bubbles on screen at most (4-60)
const SPAWN_EVERY   = 1.3;   // average seconds between new bubbles (0.3-6)
const MIN_RADIUS    = 12;    // smallest bubble radius, in px (6-40)
const MAX_RADIUS    = 46;    // largest bubble radius, in px (12-90)
const RISE_SPEED    = 34;    // rising speed of a mid-sized bubble, in px per second (8-120)
const WOBBLE        = 1;     // how much bubbles sway and squash (0-2)
const SHIMMER       = 1;     // how fast the rainbow film turns (0-3)
const OPACITY       = 0.8;   // bubble strength (0.2-1)
const FLEE          = 1;     // how far bubbles drift from a moving cursor (0-3)
const CHAIN_RADIUS  = 60;    // neighbors this close also pop, in px; 0 turns chains off (0-160)
const DROPLETS      = 12;    // droplets thrown by a pop (0-30)
const MOTION        = 1;     // overall speed (0.2-2)
const REDUCED_SPEED = 0.25;  // speed kept when the viewer asks to reduce motion (0-1)
const CENTER_CALM   = 0.75;  // how much bubbles fade and thin behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band around the chat column, in px (300-900)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const COLOR_A       = '#7fd8ff';  // film color when not following the theme
const COLOR_B       = '#d69bff';  // second film color
const COLOR_C       = '#8affc8';  // third film color
/* ──────────────────────────────────────────── */

const S = 128, R = 58, MAX_DROPS = 240, MAX_RINGS = 16;
let canvas, ctx, w = 0, h = 0, dpr = 1, last = 0, time = 0, reduced = false, dark = true, spawnWait = 0;
let calmLut = new Float32Array(1), hexes = [COLOR_A, COLOR_B, COLOR_C];
let body = null, shine = null;
const dots = [];
const mouse = { x: -10000, y: -10000, energy: 0 };

// Bubble pool
const bxs = new Float32Array(MAX_BUBBLES), bys = new Float32Array(MAX_BUBBLES), br = new Float32Array(MAX_BUBBLES);
const bvx = new Float32Array(MAX_BUBBLES), bph = new Float32Array(MAX_BUBBLES), bage = new Float32Array(MAX_BUBBLES);
const btimer = new Float32Array(MAX_BUBBLES), bon = new Uint8Array(MAX_BUBBLES);
// Droplets and rings
const dx = new Float32Array(MAX_DROPS), dy = new Float32Array(MAX_DROPS), dvx = new Float32Array(MAX_DROPS), dvy = new Float32Array(MAX_DROPS);
const dlife = new Float32Array(MAX_DROPS), dcol = new Uint8Array(MAX_DROPS);
let dcount = 0;
const rx = new Float32Array(MAX_RINGS), ry = new Float32Array(MAX_RINGS), rr = new Float32Array(MAX_RINGS), rage = new Float32Array(MAX_RINGS).fill(9), rrot = new Float32Array(MAX_RINGS);
let rnext = 0;

function rgb(hex) {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

// The film and rim (turned per bubble) and the fixed highlight, rebuilt per theme
function buildSprites() {
	const c = hexes.map(rgb);
	body = body || new OffscreenCanvas(S, S);
	let g = body.getContext('2d');
	g.clearRect(0, 0, S, S);
	const film = g.createRadialGradient(S / 2, S / 2, R * 0.2, S / 2, S / 2, R);
	film.addColorStop(0, rgba(c[1], 0));
	film.addColorStop(0.6, rgba(c[1], dark ? 0.07 : 0.05));
	film.addColorStop(0.88, rgba(c[0], dark ? 0.24 : 0.18));
	film.addColorStop(1, rgba(c[2], dark ? 0.42 : 0.34));
	g.fillStyle = film;
	g.beginPath(); g.arc(S / 2, S / 2, R, 0, 6.2832); g.fill();
	const rim = g.createConicGradient ? g.createConicGradient(0, S / 2, S / 2) : g.createLinearGradient(0, 0, S, S);
	const a = dark ? 0.95 : 0.8;
	rim.addColorStop(0, rgba(c[0], a)); rim.addColorStop(0.33, rgba(c[1], a * 0.6));
	rim.addColorStop(0.66, rgba(c[2], a)); rim.addColorStop(1, rgba(c[0], a));
	g.strokeStyle = rim;
	g.lineWidth = 3;
	g.beginPath(); g.arc(S / 2, S / 2, R - 1, 0, 6.2832); g.stroke();

	shine = shine || new OffscreenCanvas(S, S);
	g = shine.getContext('2d');
	g.clearRect(0, 0, S, S);
	const hl = g.createRadialGradient(S * 0.36, S * 0.33, 0, S * 0.36, S * 0.33, R * 0.42);
	hl.addColorStop(0, 'rgba(255,255,255,' + (dark ? 0.75 : 0.95) + ')');
	hl.addColorStop(0.5, 'rgba(255,255,255,' + (dark ? 0.22 : 0.4) + ')');
	hl.addColorStop(1, 'rgba(255,255,255,0)');
	g.fillStyle = hl;
	g.beginPath(); g.ellipse(S * 0.36, S * 0.33, R * 0.42, R * 0.24, -0.6, 0, 6.2832); g.fill();
	g.fillStyle = 'rgba(255,255,255,' + (dark ? 0.35 : 0.6) + ')';
	g.beginPath(); g.arc(S * 0.63, S * 0.7, R * 0.07, 0, 6.2832); g.fill();

	for (let i = 0; i < 3; i++) {
		const d = dots[i] || new OffscreenCanvas(16, 16), dg = d.getContext('2d');
		dg.clearRect(0, 0, 16, 16);
		const grad = dg.createRadialGradient(8, 8, 0, 8, 8, 8);
		grad.addColorStop(0, rgba(c[i], 1)); grad.addColorStop(0.35, rgba(c[i], 0.7)); grad.addColorStop(1, rgba(c[i], 0));
		dg.fillStyle = grad; dg.fillRect(0, 0, 16, 16);
		dots[i] = d;
	}
}

function applyTheme(t) {
	if (!t) return;
	dark = t.dark !== false;
	if (FOLLOW_THEME && t.colors) hexes = [t.colors.accent, t.colors.accent2, t.colors.accent3];
	if (ctx) buildSprites();
}

function calm(x) {
	const i = x >> 2;
	return calmLut[i < 0 ? 0 : i >= calmLut.length ? calmLut.length - 1 : i];
}

function spawn(scatter) {
	for (let i = 0; i < MAX_BUBBLES; i++) {
		if (bon[i]) continue;
		let x = Math.random() * w;
		for (let k = 0; k < 3 && Math.random() > calm(x); k++) x = Math.random() * w;
		br[i] = MIN_RADIUS + Math.pow(Math.random(), 1.6) * (MAX_RADIUS - MIN_RADIUS);
		bxs[i] = x;
		bys[i] = scatter ? h * (0.15 + Math.random() * 0.85) : h + br[i] + 4;
		bvx[i] = 0; bph[i] = Math.random() * 6.283; bage[i] = scatter ? 1 : 0; btimer[i] = 0; bon[i] = 1;
		return;
	}
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
	if (oldW) for (let i = 0; i < MAX_BUBBLES; i++) { bxs[i] *= w / oldW; bys[i] *= h / oldH; }
	else for (let i = 0; i < MAX_BUBBLES * 0.5; i++) spawn(true);
}

function pop(i) {
	bon[i] = 0;
	const x = bxs[i], y = bys[i], r = br[i];
	const k = rnext; rnext = (rnext + 1) % MAX_RINGS;
	rx[k] = x; ry[k] = y; rr[k] = r; rage[k] = 0; rrot[k] = bph[i];
	if (!reduced) {
		for (let j = 0; j < DROPLETS && dcount < MAX_DROPS; j++) {
			const n = dcount++, a = (j / DROPLETS) * 6.283 + Math.random() * 0.5, v = 50 + Math.random() * 90;
			dx[n] = x + Math.cos(a) * r * 0.8; dy[n] = y + Math.sin(a) * r * 0.8;
			dvx[n] = Math.cos(a) * v; dvy[n] = Math.sin(a) * v - 20;
			dlife[n] = 0.5 + Math.random() * 0.4; dcol[n] = j % 3;
		}
	}
	if (CHAIN_RADIUS > 0) {
		for (let j = 0; j < MAX_BUBBLES; j++) {
			if (!bon[j] || btimer[j] > 0) continue;
			const ddx = bxs[j] - x, ddy = bys[j] - y, lim = CHAIN_RADIUS + r + br[j];
			if (ddx * ddx + ddy * ddy < lim * lim) btimer[j] = 0.08 + Math.random() * 0.14;
		}
	}
}

function frame(now) {
	requestAnimationFrame(frame);
	const real = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const dt = real * MOTION * (reduced ? REDUCED_SPEED : 1);
	time += dt;
	mouse.energy *= Math.exp(-real * 2);
	ctx.clearRect(0, 0, w, h);

	spawnWait -= dt;
	if (spawnWait <= 0) { spawn(false); spawnWait = SPAWN_EVERY * (0.5 + Math.random()); }

	const base = OPACITY * (dark ? 1 : 0.85), drag = Math.exp(-2 * dt), flee = FLEE * mouse.energy * 160;
	for (let i = 0; i < MAX_BUBBLES; i++) {
		if (!bon[i]) continue;
		if (btimer[i] > 0) { btimer[i] -= real; if (btimer[i] <= 0) { pop(i); continue; } }
		const r = br[i];
		bage[i] += dt;
		bys[i] -= RISE_SPEED * (0.6 + 16 / r) * 0.75 * dt;
		if (flee > 1) {
			const ddx = bxs[i] - mouse.x, ddy = bys[i] - mouse.y, dd = ddx * ddx + ddy * ddy, lim = r * 4 + 40;
			if (dd < lim * lim && dd > 1) bvx[i] += (ddx / Math.sqrt(dd)) * (1 - Math.sqrt(dd) / lim) * flee * dt * 6;
		}
		bvx[i] *= drag;
		bxs[i] += (bvx[i] + Math.sin(time * 0.9 + bph[i]) * 14 * WOBBLE) * dt;
		if (bys[i] < -r - 10 || bxs[i] < -r * 2 || bxs[i] > w + r * 2) { bon[i] = 0; continue; }
		const fadeTop = Math.min(1, (bys[i] + r) / (h * 0.15));
		ctx.globalAlpha = base * Math.min(1, bage[i] / 0.8) * fadeTop * calm(bxs[i]);
		const sq = WOBBLE * 0.05 * Math.sin(time * 2.6 + bph[i] * 2), d = r / R;
		const rot = time * 0.6 * SHIMMER + bph[i], cs = Math.cos(rot) * d, sn = Math.sin(rot) * d;
		ctx.setTransform(dpr * cs * (1 + sq), dpr * sn * (1 - sq), -dpr * sn * (1 + sq), dpr * cs * (1 - sq), dpr * bxs[i], dpr * bys[i]);
		ctx.drawImage(body, -S / 2, -S / 2);
		ctx.setTransform(dpr * d * (1 + sq), 0, 0, dpr * d * (1 - sq), dpr * bxs[i], dpr * bys[i]);
		ctx.drawImage(shine, -S / 2, -S / 2);
	}

	// Pop rings: the rim flings outward and thins away
	for (let k = 0; k < MAX_RINGS; k++) {
		if (rage[k] > 0.4) continue;
		rage[k] += reduced ? real * 0.5 : real;
		const f = rage[k] / 0.4, d = (rr[k] * (1 + f * 0.6)) / R;
		ctx.globalAlpha = base * (1 - f) * (1 - f) * calm(rx[k]);
		const cs = Math.cos(rrot[k]) * d, sn = Math.sin(rrot[k]) * d;
		ctx.setTransform(dpr * cs, dpr * sn, -dpr * sn, dpr * cs, dpr * rx[k], dpr * ry[k]);
		ctx.drawImage(body, -S / 2, -S / 2);
	}
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

	// Droplets
	const ddrag = Math.exp(-3 * real);
	for (let n = 0; n < dcount; n++) {
		dlife[n] -= real;
		if (dlife[n] <= 0) {
			const j = --dcount;
			dx[n] = dx[j]; dy[n] = dy[j]; dvx[n] = dvx[j]; dvy[n] = dvy[j]; dlife[n] = dlife[j]; dcol[n] = dcol[j];
			n--;
			continue;
		}
		dvx[n] *= ddrag; dvy[n] = dvy[n] * ddrag + 160 * real;
		dx[n] += dvx[n] * real; dy[n] += dvy[n] * real;
		ctx.globalAlpha = base * Math.min(1, dlife[n] * 2.5) * calm(dx[n]);
		ctx.drawImage(dots[dcol[n]], dx[n] - 3.5, dy[n] - 3.5, 7, 7);
	}
	ctx.globalAlpha = 1;
}

function tap(x, y) {
	let best = -1, bestR = 1e9;
	for (let i = 0; i < MAX_BUBBLES; i++) {
		if (!bon[i]) continue;
		const ddx = bxs[i] - x, ddy = bys[i] - y, lim = br[i] * 1.3;
		if (ddx * ddx + ddy * ddy < lim * lim && br[i] < bestR) { best = i; bestR = br[i]; }
	}
	if (best >= 0) pop(best);
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
			if (mouse.x > -9000) mouse.energy = Math.min(1, mouse.energy + Math.hypot(d.x - mouse.x, d.y - mouse.y) / 60);
			mouse.x = d.x; mouse.y = d.y;
			break;
		case 'mousedown':
			tap(d.x, d.y);
			break;
	}
};
