/**
 * Title: Tap Fireworks
 * Description: Tap anywhere to burst a firework in your theme's accent colors, quick taps on one spot build bigger bursts, and small rockets go up beside the chat column while you rest.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const BURST_SIZE    = 70;    // sparks in a tap burst (20-160)
const COMBO_MAX     = 4;     // quick taps on one spot that grow the burst (0-6)
const SPREAD        = 260;   // burst speed, in px per second (60-400)
const GRAVITY       = 70;    // pull on the sparks, in px per second squared (0-250)
const SPARK_LIFE    = 2.6;   // seconds a spark glows (0.8-4)
const GLOW          = 1;     // size of each spark's glow (0.4-2)
const MOTION        = 1;     // overall speed of the show (0.2-2)
const REDUCED_SPEED = 0.3;   // speed kept when the viewer asks to reduce motion (0-1)
const IDLE_EVERY    = 1.9;   // average seconds between resting rockets; 0 turns them off (0-30)
const CENTER_CALM   = 0.7;   // how much bursts soften behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const MAX_SPARKS    = 900;   // hard cap on live sparks (200-2000)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const COLOR_A       = '#ff8f6b';  // first burst color when not following the theme
const COLOR_B       = '#7fb2ff';  // second burst color
const COLOR_C       = '#c89bff';  // third burst color
const SPARK_COLOR   = '#ffd77a';  // glitter color
/* ──────────────────────────────────────────── */

const SPRITE = 32, MAX_ROCKETS = 8, NCOL = 4;
let canvas, ctx, w = 0, h = 0, dpr = 1, last = 0, time = 0, reduced = false, dark = true, column = null;
let calmLut = new Float32Array(1), idleWait = 0.4, lastTap = -10, tapX = 0, tapY = 0, combo = 0;
const sprites = [];
let palette = [COLOR_A, COLOR_B, COLOR_C, SPARK_COLOR];

// Spark pool: kind 0 is a colored star, 1 is glitter that twinkles
const px = new Float32Array(MAX_SPARKS), py = new Float32Array(MAX_SPARKS);
const vx = new Float32Array(MAX_SPARKS), vy = new Float32Array(MAX_SPARKS);
const life = new Float32Array(MAX_SPARKS), span = new Float32Array(MAX_SPARKS);
const sz = new Float32Array(MAX_SPARKS), col = new Uint8Array(MAX_SPARKS), kind = new Uint8Array(MAX_SPARKS);
let count = 0;
// Rocket pool
const rx = new Float32Array(MAX_ROCKETS), ry = new Float32Array(MAX_ROCKETS), rvy = new Float32Array(MAX_ROCKETS);
const rcol = new Uint8Array(MAX_ROCKETS), ron = new Uint8Array(MAX_ROCKETS);
// Bloom pool: the soft swell of light where a burst opens
const bx = new Float32Array(MAX_ROCKETS), by = new Float32Array(MAX_ROCKETS), bage = new Float32Array(MAX_ROCKETS).fill(9);
const bpow = new Float32Array(MAX_ROCKETS), bcol = new Uint8Array(MAX_ROCKETS);
let bnext = 0;

function hexToRgb(hex) {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(c, a, lift) {
	const r = Math.round(c[0] + (255 - c[0]) * lift), g = Math.round(c[1] + (255 - c[1]) * lift), b = Math.round(c[2] + (255 - c[2]) * lift);
	return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

// One soft glow per color, rebuilt on theme change
function buildSprites() {
	for (let i = 0; i < NCOL; i++) {
		const c = hexToRgb(palette[i]);
		const s = sprites[i] || new OffscreenCanvas(SPRITE, SPRITE);
		const g = s.getContext('2d');
		g.clearRect(0, 0, SPRITE, SPRITE);
		const grad = g.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
		if (dark) {
			grad.addColorStop(0, rgba(c, 1, 0.8));
			grad.addColorStop(0.12, rgba(c, 1, 0.45));
			grad.addColorStop(0.3, rgba(c, 0.55, 0.05));
			grad.addColorStop(0.6, rgba(c, 0.14, 0));
		} else {
			grad.addColorStop(0, rgba(c, 1, 0));
			grad.addColorStop(0.22, rgba(c, 0.95, 0));
			grad.addColorStop(0.4, rgba(c, 0.35, 0));
			grad.addColorStop(0.65, rgba(c, 0.06, 0));
		}
		grad.addColorStop(1, rgba(c, 0, 0));
		g.fillStyle = grad;
		g.fillRect(0, 0, SPRITE, SPRITE);
		sprites[i] = s;
	}
}

function applyTheme(t) {
	if (!t) return;
	dark = t.dark !== false;
	if (FOLLOW_THEME && t.colors) {
		const c = t.colors;
		palette = [c.accent, c.accent2, c.accent3, dark ? c.text : c.accent];
	}
	if (ctx) buildSprites();
}

function size(oldW, oldH) {
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	calmBuild();
	if (!oldW) return;
	// Keep the show in place on the resized screen
	const sx = w / oldW, sy = h / oldH;
	for (let i = 0; i < count; i++) { px[i] *= sx; py[i] *= sy; }
	for (let i = 0; i < MAX_ROCKETS; i++) { rx[i] *= sx; ry[i] *= sy; bx[i] *= sx; by[i] *= sy; }
}

// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }

// The calm table, from where the chat column sits; rebuilt on resize and layout
function calmBuild() {
	calmLut = new Float32Array((w >> 2) + 2);
	for (let i = 0; i < calmLut.length; i++) {
		const d = Math.abs(i * 4 - colX()) / colHalf();
		const t = Math.min(1, Math.max(0, (d - 0.55) / 0.7));
		calmLut[i] = 1 - CENTER_CALM * (1 - t * t * (3 - 2 * t));
	}
}

// A spot beside the chat column, on the side with room, inside the chat area so the sidebar can't cover it, kept off its very edge
function besideX() {
	const lo = column ? column.left : 0, hi = column ? column.right : w;
	const left = Math.max(0, colX() - colHalf() - lo), right = Math.max(0, hi - colX() - colHalf());
	if (left + right < 60) return Math.random() < 0.5 ? lo + w * (0.04 + Math.random() * 0.17) : hi - w * (0.04 + Math.random() * 0.17);
	const r = Math.random() * (left + right);
	return Math.max(lo + w * 0.03, Math.min(hi - w * 0.03, r < left ? lo + r * 0.85 : hi - (r - left) * 0.85));
}

function calm(x) {
	const i = x >> 2;
	return calmLut[i < 0 ? 0 : i >= calmLut.length ? calmLut.length - 1 : i];
}

function burst(x, y, power, c, gentle) {
	const n = Math.round(BURST_SIZE * power * (gentle ? 0.4 : 1));
	const speed = SPREAD * (0.6 + 0.4 * power) * (gentle ? 0.45 : 1);
	const ring = Math.random() < 0.3;
	const b = bnext; bnext = (bnext + 1) % MAX_ROCKETS;
	bx[b] = x; by[b] = y; bage[b] = 0; bpow[b] = power * (gentle ? 0.6 : 1); bcol[b] = c;
	for (let i = 0; i < n && count < MAX_SPARKS; i++) {
		const glitter = i % 4 === 3, willow = !glitter && i % 5 === 0;
		const a = (i / n) * 6.2832 + Math.random() * 0.4;
		const v = speed * (ring && !glitter ? 0.92 + Math.random() * 0.08 : 0.45 + Math.random() * 0.55);
		const k = count++;
		px[k] = x; py[k] = y;
		vx[k] = Math.cos(a) * v; vy[k] = Math.sin(a) * v - speed * 0.12;
		span[k] = life[k] = SPARK_LIFE * (glitter ? 0.7 + Math.random() * 0.6 : willow ? 1.8 + Math.random() * 0.6 : 0.6 + Math.random() * 0.5);
		sz[k] = (glitter ? 14 : 22 + power * 8) * GLOW * (0.8 + Math.random() * 0.4);
		col[k] = glitter || willow ? 3 : c;
		kind[k] = glitter ? 1 : willow ? 2 : 0;
	}
}

function launch() {
	for (let i = 0; i < MAX_ROCKETS; i++) {
		if (ron[i]) continue;
		rx[i] = besideX();
		ry[i] = h + 6;
		const rise = h * (0.5 + Math.random() * 0.3);
		rvy[i] = -Math.sqrt(2 * 420 * rise);
		rcol[i] = Math.floor(Math.random() * 3);
		ron[i] = 1;
		return;
	}
}

// Reduced motion: no rockets, only a slow bloom that opens in place
function bloom() {
	burst(besideX(), h * (0.2 + Math.random() * 0.4), 1.4, Math.floor(Math.random() * 3), true);
}

function frame(now) {
	requestAnimationFrame(frame);
	const real = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const dt = real * MOTION * (reduced ? REDUCED_SPEED : 1);
	time += dt;
	ctx.clearRect(0, 0, w, h);

	if (IDLE_EVERY > 0) {
		idleWait -= real;
		if (idleWait <= 0) {
			if (reduced) bloom(); else launch();
			idleWait = IDLE_EVERY * (reduced ? 1.6 : 1) * (0.6 + Math.random() * 0.8);
		}
	}

	const drag = Math.exp(-1.3 * dt), grav = (reduced ? 0.15 : 1) * GRAVITY * dt;
	const op = dark ? 'lighter' : 'source-over', base = dark ? 0.95 : 0.9;
	ctx.globalCompositeOperation = op;

	// Rockets: a bright head with a short fading tail, bursting near the top of the climb
	for (let i = 0; i < MAX_ROCKETS; i++) {
		if (!ron[i]) continue;
		rvy[i] += 420 * dt;
		ry[i] += rvy[i] * dt;
		const s = sprites[rcol[i]], a = base * 0.8 * calm(rx[i]);
		for (let t = 3; t >= 0; t--) {
			ctx.globalAlpha = a * (1 - t * 0.22);
			const d = 14 - t * 2;
			ctx.drawImage(s, rx[i] - d / 2, ry[i] - rvy[i] * t * 0.018 - d / 2, d, d);
		}
		if (rvy[i] > -50) {
			ron[i] = 0;
			burst(rx[i], ry[i], 0.75 + Math.random() * 0.3, rcol[i], false);
		}
	}

	// Blooms swell for a moment, then fade over about a second
	for (let i = 0; i < MAX_ROCKETS; i++) {
		if (bage[i] > 1.4) continue;
		bage[i] += dt;
		const e = bage[i] < 0.12 ? bage[i] / 0.12 : Math.max(0, 1 - (bage[i] - 0.12) / 1.2);
		const d = (90 + 70 * bage[i]) * bpow[i] * GLOW;
		ctx.globalAlpha = (dark ? 0.32 : 0.16) * e * e * calm(bx[i]);
		ctx.drawImage(sprites[bcol[i]], bx[i] - d / 2, by[i] - d / 2, d, d);
	}

	// Sparks: drag, gravity, then a head and a two-step tail along the velocity
	for (let i = 0; i < count; i++) {
		life[i] -= dt;
		if (life[i] <= 0 || py[i] > h + 20) {
			const j = --count;
			px[i] = px[j]; py[i] = py[j]; vx[i] = vx[j]; vy[i] = vy[j];
			life[i] = life[j]; span[i] = span[j]; sz[i] = sz[j]; col[i] = col[j]; kind[i] = kind[j];
			i--;
			continue;
		}
		if (kind[i] === 2) { vx[i] *= drag * drag; vy[i] = vy[i] * drag * drag + grav * 0.5; }
		else { vx[i] *= drag; vy[i] = vy[i] * drag + grav; }
		px[i] += vx[i] * dt; py[i] += vy[i] * dt;
		const f = life[i] / span[i];
		let a = base * Math.pow(f, dark ? 0.6 : 0.45) * calm(px[i]);
		if (kind[i]) a *= (kind[i] === 2 ? 0.6 : 1) * (0.55 + 0.45 * Math.sin(time * (kind[i] === 2 ? 7 : 22) + i * 1.7));
		const s = sprites[col[i]], d = sz[i] * (0.55 + 0.45 * f);
		ctx.globalAlpha = a;
		ctx.drawImage(s, px[i] - d / 2, py[i] - d / 2, d, d);
		if (!kind[i] && !reduced) {
			ctx.globalAlpha = a * 0.45;
			ctx.drawImage(s, px[i] - vx[i] * 0.05 - d * 0.4, py[i] - vy[i] * 0.05 - d * 0.4, d * 0.8, d * 0.8);
			ctx.globalAlpha = a * 0.2;
			ctx.drawImage(s, px[i] - vx[i] * 0.1 - d * 0.3, py[i] - vy[i] * 0.1 - d * 0.3, d * 0.6, d * 0.6);
		}
	}
	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'source-over';
}

function tap(x, y) {
	if (time - lastTap < 0.7 && Math.abs(x - tapX) + Math.abs(y - tapY) < 140) combo = Math.min(COMBO_MAX, combo + 1);
	else combo = 0;
	lastTap = time; tapX = x; tapY = y;
	idleWait = Math.max(idleWait, IDLE_EVERY);
	// Over the chat column (the Send button included) the burst stays small
	const c = calm(x), power = (0.7 + combo * 0.25) * Math.max(0.35, c);
	burst(x, y, power, Math.floor(Math.random() * 3), reduced);
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
		case 'layout':
			column = d.column || null;
			if (canvas) calmBuild();
			break;
		case 'mousedown':
			tap(d.x, d.y);
			break;
	}
};
