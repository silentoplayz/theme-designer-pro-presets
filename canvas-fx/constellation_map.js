/**
 * Title: Constellation Map
 * Description: Drifting, twinkling stars in your theme's colors link into faint constellations, thin behind the chat, lean gently toward the cursor and light up where you tap.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const STAR_COUNT     = 120;   // number of stars (40-300)
const STAR_SIZE      = 1;     // size of the stars (0.5-2)
const LINK_DIST      = 150;   // longest constellation line, in px (60-260)
const LINK_ALPHA     = 0.3;   // strength of the constellation lines (0-1)
const MAX_LINKS      = 3;     // lines each star may start (1-6)
const DRIFT          = 1;     // drift speed of the stars; 0 holds them still (0-3)
const REDUCED_SPEED  = 0.2;   // share of the drift kept when the viewer asks to reduce motion (0-1)
const TWINKLE        = 1;     // how much the stars twinkle (0-2)
const CENTER_CALM    = 0.7;   // how much the stars and lines fade behind the chat column (0-1)
const BAND_WIDTH     = 520;   // half-width of the calm band around the chat column, in px (300-900)
const CURSOR_GRAVITY = 1;     // how strongly nearby stars lean toward the cursor (0-3)
const CURSOR_RADIUS  = 250;   // reach of the cursor, in px (100-400)
const MAX_PULL       = 40;    // top speed the cursor can give a star, in px per second (5-120)
const TAP_GLOW       = 1;     // how brightly a tap lights the nearby stars; 0 turns it off (0-2)
const FOLLOW_THEME   = true;  // take the colors from the theme's palette
const STAR_COLOR     = '#dce6ff';  // most stars when not following the theme
const WARM_COLOR     = '#fff0c8';  // warm stars
const BLUE_COLOR     = '#a8c4ff';  // blue stars
const LINE_COLOR     = '#b4c8ff';  // constellation lines
const CURSOR_COLOR   = '#a0c8ff';  // lines to the cursor
/* ──────────────────────────────────────────── */

const MAX_STARS = 300;
const N = Math.max(1, Math.min(MAX_STARS, Math.round(STAR_COUNT)));
const LEVELS = 6;              // line alphas are batched into this many strokes
const CAP = N * 6;             // segments per batch
const SPRITE = 64;             // star sprite size in device px

let canvas, ctx;
let w = 0, h = 0, dpr = 1;
let last = 0, time = 0, reduced = false, dark = true;
const mouse = { x: -10000, y: -10000, amount: 0, target: 0 };
const tap = { x: -10000, y: -10000, age: 10 };

const sx = new Float32Array(N), sy = new Float32Array(N);
const vx = new Float32Array(N), vy = new Float32Array(N);
const bx = new Float32Array(N), by = new Float32Array(N);
const size = new Float32Array(N), bright = new Float32Array(N);
const twRate = new Float32Array(N), twPhase = new Float32Array(N), twAmt = new Float32Array(N);
const tone = new Uint8Array(N);
const lum = new Float32Array(N);       // brightness this frame, calm included
const segs = new Float32Array(2 * LEVELS * CAP * 4);
const segN = new Int32Array(2 * LEVELS);

let colors = { stars: [STAR_COLOR, WARM_COLOR, BLUE_COLOR].map(hexToRgb), line: hexToRgb(LINE_COLOR), cursor: hexToRgb(CURSOR_COLOR) };
const sprites = [];
const styles = [];                      // [batch] -> stroke color string

function hexToRgb(hex) {
	const n = parseInt(String(hex).slice(1, 7), 16) || 0;
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(c, a) {
	return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')';
}

function calm(x) {
	const d = Math.abs(x - w * 0.5) / BAND_WIDTH;
	const s = Math.min(1, Math.max(0, (d - 0.55) / 0.7));
	return 1 - CENTER_CALM * (1 - s * s * (3 - 2 * s));
}

function applyTheme(t) {
	if (!t) return;
	dark = t.dark !== false;
	if (FOLLOW_THEME && t.colors) {
		const c = t.colors;
		colors = {
			// Pale text-colored stars on dark; on light, gray dots would read as dust, so the accents lead
			stars: dark ? [hexToRgb(c.text), hexToRgb(c.accent2), hexToRgb(c.accent)] : [hexToRgb(c.accent), hexToRgb(c.accent2), hexToRgb(c.accent3)],
			line: hexToRgb(dark ? c.text : c.muted),
			cursor: hexToRgb(c.accent),
		};
	}
	build();
}

// Star sprites and line colors, rebuilt on theme change only
function build() {
	for (let k = 0; k < 3; k++) {
		const c = colors.stars[k];
		const sp = sprites[k] || new OffscreenCanvas(SPRITE, SPRITE);
		const g = sp.getContext('2d');
		g.clearRect(0, 0, SPRITE, SPRITE);
		const r = SPRITE / 2;
		const grad = g.createRadialGradient(r, r, 0, r, r, r);
		grad.addColorStop(0, rgba(c, 1));
		grad.addColorStop(0.09, rgba(c, 1));
		grad.addColorStop(0.15, rgba(c, dark ? 0.45 : 0.3));
		grad.addColorStop(0.4, rgba(c, dark ? 0.12 : 0.04));
		grad.addColorStop(1, rgba(c, 0));
		g.fillStyle = grad;
		g.fillRect(0, 0, SPRITE, SPRITE);
		sprites[k] = sp;
	}
	const top = LINK_ALPHA * (dark ? 1.3 : 1.9);
	for (let b = 0; b < LEVELS; b++) {
		styles[b] = rgba(colors.line, top * (b + 1) / LEVELS);
		styles[LEVELS + b] = rgba(colors.cursor, (dark ? 0.45 : 0.4) * (b + 1) / LEVELS);
	}
}

function seed() {
	for (let i = 0; i < N; i++) {
		sx[i] = Math.random() * w;
		sy[i] = Math.random() * h;
		const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 6;
		bx[i] = vx[i] = Math.cos(a) * s;
		by[i] = vy[i] = Math.sin(a) * s;
		size[i] = 0.8 + Math.random() * 1.8;
		bright[i] = 0.35 + Math.random() * 0.65;
		twRate[i] = 0.8 + Math.random() * 2;
		twPhase[i] = Math.random() * Math.PI * 2;
		twAmt[i] = 0.1 + Math.random() * 0.3;
		const roll = Math.random();
		tone[i] = roll < 0.6 ? 0 : roll < 0.8 ? 1 : 2;
	}
}

function size2d(nw, nh, ndpr) {
	// Keep the sky on a resize: scale the stars to the new size instead of re-rolling them
	if (w && h) {
		for (let i = 0; i < N; i++) { sx[i] *= nw / w; sy[i] *= nh / h; }
	}
	w = nw;
	h = nh;
	dpr = Math.min(2, ndpr || 1);
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function addSeg(batch, x1, y1, x2, y2) {
	const n = segN[batch];
	if (n >= CAP) return;
	const o = (batch * CAP + n) * 4;
	segs[o] = x1; segs[o + 1] = y1; segs[o + 2] = x2; segs[o + 3] = y2;
	segN[batch] = n + 1;
}

function update(dt) {
	const speed = DRIFT * (reduced ? REDUCED_SPEED : 1);
	const pull = CURSOR_GRAVITY * mouse.amount * 90;
	const r2 = CURSOR_RADIUS * CURSOR_RADIUS;
	const relax = Math.min(1, dt * 0.8);
	const tw = TWINKLE * (reduced ? 0.4 : 1);
	tap.age += dt;
	const glow = TAP_GLOW * (reduced ? 0.4 : 1) * Math.min(1, tap.age * 6) * Math.max(0, 1 - tap.age / 1.8);
	for (let i = 0; i < N; i++) {
		const dx = mouse.x - sx[i], dy = mouse.y - sy[i];
		const d2 = dx * dx + dy * dy;
		if (pull > 0 && d2 < r2 && d2 > 1) {
			const d = Math.sqrt(d2);
			// Pull toward the cursor, easing to a gentle push inside 45 px so stars hover instead of piling up
			const f = pull * (1 - d / CURSOR_RADIUS) * (d < 45 ? (d - 45) / 45 : 1);
			vx[i] += dx / d * f * dt;
			vy[i] += dy / d * f * dt;
			const ex = vx[i] - bx[i], ey = vy[i] - by[i];
			const e = Math.sqrt(ex * ex + ey * ey);
			if (e > MAX_PULL) { vx[i] = bx[i] + ex / e * MAX_PULL; vy[i] = by[i] + ey / e * MAX_PULL; }
		}
		vx[i] += (bx[i] - vx[i]) * relax;
		vy[i] += (by[i] - vy[i]) * relax;
		sx[i] += vx[i] * dt * speed;
		sy[i] += vy[i] * dt * speed;
		if (sx[i] < -20) sx[i] += w + 40; else if (sx[i] > w + 20) sx[i] -= w + 40;
		if (sy[i] < -20) sy[i] += h + 40; else if (sy[i] > h + 20) sy[i] -= h + 40;
		let b = bright[i] + Math.sin(time * twRate[i] + twPhase[i]) * twAmt[i] * tw;
		if (glow > 0) {
			const tx = sx[i] - tap.x, ty = sy[i] - tap.y;
			b += glow * 0.8 * Math.max(0, 1 - Math.sqrt(tx * tx + ty * ty) / 200);
		}
		lum[i] = Math.max(0.08, Math.min(1, b)) * calm(sx[i]);
	}
}

function frame(now) {
	requestAnimationFrame(frame);
	if (!ctx) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	time += dt * (reduced ? REDUCED_SPEED : 1);
	mouse.target = Math.max(0, mouse.target - dt * 0.5);
	mouse.amount += (mouse.target - mouse.amount) * Math.min(1, dt * 3);
	update(dt);

	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'source-over';
	ctx.clearRect(0, 0, w, h);

	// Gather the lines into a few alpha batches, then stroke each batch once
	segN.fill(0);
	const link2 = LINK_DIST * LINK_DIST;
	for (let i = 0; i < N; i++) {
		let links = 0;
		for (let j = i + 1; j < N && links < MAX_LINKS; j++) {
			const dx = sx[i] - sx[j], dy = sy[i] - sy[j];
			const d2 = dx * dx + dy * dy;
			if (d2 >= link2) continue;
			links++;
			const a = (1 - Math.sqrt(d2) / LINK_DIST) * Math.min(lum[i], lum[j]) * 1.4;
			const b = Math.min(LEVELS - 1, (a * LEVELS) | 0);
			if (a > 0.06) addSeg(b, sx[i], sy[i], sx[j], sy[j]);
		}
	}
	if (mouse.amount > 0.02) {
		const r = CURSOR_RADIUS * 0.6;
		for (let i = 0; i < N; i++) {
			const dx = sx[i] - mouse.x, dy = sy[i] - mouse.y;
			const d2 = dx * dx + dy * dy;
			if (d2 >= r * r) continue;
			const a = (1 - Math.sqrt(d2) / r) * mouse.amount * calm(sx[i]);
			const b = Math.min(LEVELS - 1, (a * LEVELS) | 0);
			if (a > 0.06) addSeg(LEVELS + b, mouse.x, mouse.y, sx[i], sy[i]);
		}
	}
	ctx.lineWidth = dpr > 1 ? 0.7 : 0.8;
	for (let b = 0; b < LEVELS * 2; b++) {
		const n = segN[b];
		if (!n) continue;
		ctx.strokeStyle = styles[b];
		ctx.beginPath();
		for (let k = 0; k < n; k++) {
			const o = (b * CAP + k) * 4;
			ctx.moveTo(segs[o], segs[o + 1]);
			ctx.lineTo(segs[o + 2], segs[o + 3]);
		}
		ctx.stroke();
	}

	// Stars on top, as sprites
	ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
	const starA = dark ? 1 : 0.95;
	const grow = STAR_SIZE * (dark ? 12 : 15);
	for (let i = 0; i < N; i++) {
		const s = size[i] * grow;
		ctx.globalAlpha = lum[i] * starA;
		ctx.drawImage(sprites[tone[i]], sx[i] - s * 0.5, sy[i] - s * 0.5, s, s);
	}
	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'source-over';
}

self.onmessage = (e) => {
	const d = e.data;
	switch (d.type) {
		case 'init':
			canvas = d.canvas;
			ctx = canvas.getContext('2d');
			reduced = !!d.reducedMotion;
			size2d(d.width, d.height, d.dpr);
			seed();
			applyTheme(d.theme || {});
			requestAnimationFrame(frame);
			break;
		case 'resize':
			if (ctx) size2d(d.width, d.height, d.dpr);
			break;
		case 'theme':
			applyTheme(d);
			break;
		case 'motion':
			reduced = !!d.reducedMotion;
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.target = reduced ? 0.3 : 1;
			break;
		case 'mousedown':
			tap.x = d.x;
			tap.y = d.y;
			tap.age = 0;
			break;
	}
};
