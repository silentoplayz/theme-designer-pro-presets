/**
 * Title: Sandstorm
 * Description: Sand grains stream sideways at varied depths over low dunes, thickening as soft gust waves roll through; the sand thins behind the chat and parts around the cursor.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const GRAIN_COUNT    = 800;   // sand grains on a 1440 px wide screen (100-1500)
const WIND_SPEED     = 240;   // base wind, in px per second (40-600)
const REDUCED_SPEED  = 0.2;   // share of the wind kept under reduced motion (0-1)
const TURBULENCE     = 1;     // how much the grains bob up and down (0-3)
const GUST_EVERY     = 6;     // average seconds between gust waves; 0 turns them off (0-30)
const GUST_STRENGTH  = 1.4;   // how much a gust speeds and thickens the sand (0-4)
const HAZE           = 0.5;   // dust haze carried by the gusts (0-1)
const DUNE_HEIGHT    = 0.11;  // height of the dunes as a share of the screen; 0 hides them (0-0.2)
const LOW_WEIGHT     = 0.6;   // how much the sand gathers toward the ground (0-1)
const SHELTER        = 150;   // radius of the calm pocket around the cursor, in px (0-400)
const THEME_TINT     = 0.35;  // how far the sand leans toward the theme's colors (0-1)
const CENTER_CALM    = 0.8;   // how much the sand thins behind the chat column (0-1)
const BAND_WIDTH     = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const FOLLOW_THEME   = true;  // tint the sand with the theme's palette
const SAND_PALE      = '#e6cf9e';  // palest sand
const SAND_DEEP      = '#a87f4a';  // deepest sand
/* ──────────────────────────────────────────── */

const MAX_GRAINS = 1500, SHADES = 4, MAX_STREAKS = 24, TAU = Math.PI * 2;
const F = (n) => new Float32Array(n);

let canvas, ctx, w = 0, h = 0, last = 0, reduced = false, dark = true, column = null;
let pale = hex(SAND_PALE), deep = hex(SAND_DEEP), tint = null;
let grainSprite = [], hazeSprite, duneCache;
const gx = F(MAX_GRAINS), gy = F(MAX_GRAINS), gz = F(MAX_GRAINS), gs = F(MAX_GRAINS), gph = F(MAX_GRAINS), ga = F(MAX_GRAINS);
const gshade = new Uint8Array(MAX_GRAINS);
let grains = 0;
const kx = F(MAX_STREAKS), ky = F(MAX_STREAKS), kl = F(MAX_STREAKS), klife = F(MAX_STREAKS);
// Two gust waves can roll across at once: centre, width, strength and age
const wave = { x: F(2), width: F(2), power: F(2), age: F(2), wait: 2 };
const mouse = { x: -10000, y: -10000, amount: 0 };
let alphaScale = 1;

function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function rgba(c, a) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a.toFixed(3) + ')'; }
// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }
function band(x) {
	const t = Math.min(1, Math.max(0, (Math.abs(x - colX()) / colHalf() - 0.55) / 0.7));
	return 1 - t * t * (3 - 2 * t);
}

function sprite(size, col, a0, a1) {
	const c = new OffscreenCanvas(size, size), g = c.getContext('2d'), r = size / 2;
	const grad = g.createRadialGradient(r, r, 0, r, r, r);
	grad.addColorStop(0, rgba(col, a0));
	grad.addColorStop(0.45, rgba(col, a1));
	grad.addColorStop(1, rgba(col, 0));
	g.fillStyle = grad;
	g.fillRect(0, 0, size, size);
	return c;
}

function applyTheme(t) {
	if (t) {
		dark = t.dark !== false;
		tint = FOLLOW_THEME && t.colors ? t.colors : null;
	}
	let p = pale, d = deep;
	if (tint) {
		p = mix(p, hex(dark ? tint.text : tint.muted), THEME_TINT * 0.6);
		d = mix(d, hex(tint.accent2), THEME_TINT * 0.6);
	}
	if (!dark) { d = mix(d, [70, 45, 20], 0.45); p = mix(p, d, 0.65); }
	alphaScale = dark ? 1 : 1.3;
	for (let k = 0; k < SHADES; k++) grainSprite[k] = sprite(16, mix(p, d, k / (SHADES - 1)), 1, 0.9);
	hazeSprite = sprite(128, mix(p, d, 0.4), dark ? 0.4 : 0.26, dark ? 0.18 : 0.1);
	if (w) buildDunes(p, d);
}

// Ground, cached and rebuilt on layout: low dust over two soft dune ridges, both quieter behind the column
function buildDunes(p, d) {
	const ch = Math.max(2, Math.round(h * 0.32)), dh = Math.round(h * DUNE_HEIGHT);
	duneCache = new OffscreenCanvas(Math.max(1, Math.round(w)), ch);
	const g = duneCache.getContext('2d');
	let grad = g.createLinearGradient(0, 0, 0, ch);
	grad.addColorStop(0, rgba(p, 0));
	grad.addColorStop(1, rgba(mix(p, d, 0.5), dark ? 0.16 : 0.12));
	g.fillStyle = grad;
	g.fillRect(0, 0, w, ch);
	g.globalCompositeOperation = 'destination-out';
	grad = g.createLinearGradient(0, 0, w, 0);
	const cut = rgba([0, 0, 0], CENTER_CALM * 0.8), none = 'rgba(0,0,0,0)', m = colX() / w, i0 = colHalf() * 0.55 / w, o0 = colHalf() * 1.25 / w;
	const at = (u) => Math.min(1, Math.max(0, u));
	grad.addColorStop(at(m - o0), none);
	grad.addColorStop(at(m - i0), cut);
	grad.addColorStop(at(m + i0), cut);
	grad.addColorStop(at(m + o0), none);
	g.fillStyle = grad;
	g.fillRect(0, 0, w, ch);
	g.globalCompositeOperation = 'source-over';
	g.translate(0, ch - dh - 1);
	for (let l = 0; l < 2 && dh > 0; l++) {
		grad = g.createLinearGradient(0, 0, 0, dh);
		const c = mix(d, dark ? [0, 0, 0] : d, l ? 0.35 : 0.1);
		grad.addColorStop(0, rgba(c, (dark ? 0.32 : 0.22) + l * 0.12));
		grad.addColorStop(1, rgba(c, (dark ? 0.12 : 0.08) + l * 0.08));
		g.fillStyle = grad;
		g.beginPath();
		g.moveTo(0, dh + 1);
		const seed = l * 3.1 + Math.random() * 6;
		for (let x = 0; x <= w; x += 8) {
			const u = x / (420 - l * 120) + seed;
			const ridge = 0.5 + 0.35 * Math.sin(u) + 0.15 * Math.sin(u * 2.7 + 1.3);
			const sag = 1 - 0.75 * CENTER_CALM * band(x);
			g.lineTo(x, dh - dh * (l ? 0.55 : 0.95) * ridge * sag);
		}
		g.lineTo(w, dh + 1);
		g.closePath();
		g.fill();
	}
}

// Grains weigh toward the ground; nearer grains are larger, faster and brighter
function resetGrain(i, anywhere) {
	const z = Math.random();
	gz[i] = 0.35 + z * 0.65;
	gs[i] = 0.5 + z * z * 1.5;
	gx[i] = anywhere ? Math.random() * w : -10 - Math.random() * 60;
	gy[i] = h * (1 - Math.pow(Math.random(), 1 + LOW_WEIGHT * 1.6) * 1.02);
	gph[i] = Math.random() * TAU;
	ga[i] = 0.35 + Math.random() * 0.5;
	gshade[i] = Math.floor(Math.random() * SHADES);
}

function size() {
	canvas.width = Math.max(1, Math.round(w));
	canvas.height = Math.max(1, Math.round(h));
	grains = Math.min(MAX_GRAINS, Math.round(GRAIN_COUNT * Math.max(0.4, w / 1440) * Math.max(0.6, h / 900)));
	for (let i = 0; i < grains; i++) resetGrain(i, true);
	klife.fill(0);
	applyTheme(null);
}

function frame(now) {
	requestAnimationFrame(frame);
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	if (!w || !h) return;
	const motion = reduced ? REDUCED_SPEED : 1;
	const t = now / 1000;

	// Gust waves: born upwind, rolling faster than the sand, swelling then fading
	if (GUST_EVERY > 0 && !reduced) {
		wave.wait -= dt;
		if (wave.wait <= 0) {
			const k = wave.age[0] > wave.age[1] ? 0 : 1;
			wave.x[k] = -w * 0.3; wave.width[k] = w * (0.18 + Math.random() * 0.15);
			wave.power[k] = GUST_STRENGTH * (0.6 + Math.random() * 0.4); wave.age[k] = 0;
			wave.wait = GUST_EVERY * (0.6 + Math.random() * 0.8);
		}
	}
	for (let k = 0; k < 2; k++) {
		wave.age[k] += dt;
		wave.x[k] += WIND_SPEED * 1.5 * motion * dt;
		if (wave.x[k] > w * 1.4) wave.power[k] = 0;
	}

	ctx.clearRect(0, 0, w, h);
	ctx.globalCompositeOperation = 'source-over';

	// Haze carried by each wave, kept low and out of the column
	for (let k = 0; k < 2; k++) {
		const pw = wave.power[k] * Math.min(1, wave.age[k] / 1.5);
		if (pw < 0.02 || HAZE <= 0) continue;
		const x = wave.x[k];
		ctx.globalAlpha = Math.min(1, pw * HAZE * 0.9) * (1 - CENTER_CALM * band(x));
		ctx.drawImage(hazeSprite, x - wave.width[k] * 1.4, h * 0.45, wave.width[k] * 2.8, h * 0.65);
	}

	if (duneCache) { ctx.globalAlpha = 1; ctx.drawImage(duneCache, 0, h - duneCache.height); }

	// Grains
	mouse.amount = Math.max(0, mouse.amount - dt * 0.6);
	const shelter = SHELTER * mouse.amount, sh2 = shelter * shelter;
	const wx0 = wave.x[0], wx1 = wave.x[1], ww0 = 1 / Math.max(1, wave.width[0]), ww1 = 1 / Math.max(1, wave.width[1]);
	const p0 = wave.power[0] * Math.min(1, wave.age[0] / 1.5), p1 = wave.power[1] * Math.min(1, wave.age[1] / 1.5);
	for (let i = 0; i < grains; i++) {
		const d0 = (gx[i] - wx0) * ww0, d1 = (gx[i] - wx1) * ww1;
		const gust = p0 * Math.exp(-d0 * d0) + p1 * Math.exp(-d1 * d1);
		const v = WIND_SPEED * gz[i] * (1 + gust) * motion;
		gx[i] += v * dt;
		gy[i] += Math.sin(t * (1.3 + gz[i]) * motion + gph[i]) * 22 * TURBULENCE * gz[i] * motion * dt;
		if (sh2 > 0) {
			const dx = gx[i] - mouse.x, dy = gy[i] - mouse.y, dd = dx * dx + dy * dy;
			if (dd < sh2 && dd > 1) {
				const dist = Math.sqrt(dd), f = (1 - dist / shelter) * (1 - dist / shelter);
				gx[i] += dx / dist * f * 160 * dt;
				gy[i] += dy / dist * f * 260 * dt;
			}
		}
		if (gx[i] > w + 20 || gy[i] < -20 || gy[i] > h + 20) { resetGrain(i, false); continue; }
		const r = gs[i], len = r * 1.5 + v * 0.045;
		ctx.globalAlpha = Math.min(1, ga[i] * (0.6 + 0.4 * gz[i]) * (0.75 + gust * 0.5) * alphaScale) * (1 - CENTER_CALM * 0.9 * band(gx[i]));
		const th = dark ? r * 0.7 : r * 0.95;
		ctx.drawImage(grainSprite[gshade[i]], gx[i] - len, gy[i] - th, len * 2, th * 2);
	}

	// Streaks inside strong gusts, out to the sides
	for (let s = 0; s < MAX_STREAKS; s++) {
		if (klife[s] <= 0) {
			const k = p0 > p1 ? 0 : 1, pw = Math.max(p0, p1);
			if (reduced || pw < 0.6 || Math.random() > pw * dt * 3) continue;
			kx[s] = wave.x[k] + (Math.random() - 0.5) * wave.width[k];
			ky[s] = h * (0.35 + Math.random() * 0.6);
			kl[s] = 60 + Math.random() * 160;
			klife[s] = 1;
		}
		klife[s] -= dt * 1.4;
		kx[s] += WIND_SPEED * 2.2 * motion * dt;
		ctx.globalAlpha = Math.max(0, Math.sin(klife[s] * Math.PI)) * (1 - CENTER_CALM * band(kx[s]));
		ctx.drawImage(hazeSprite, kx[s] - kl[s], ky[s] - 3, kl[s], 6);
	}
	ctx.globalAlpha = 1;
}

self.onmessage = (e) => {
	const d = e.data;
	switch (d.type) {
		case 'init':
			canvas = d.canvas;
			ctx = canvas.getContext('2d');
			w = d.width; h = d.height;
			reduced = !!d.reducedMotion;
			column = d.column || null;
			applyTheme(d.theme);
			size();
			requestAnimationFrame(frame);
			break;
		case 'resize':
			w = d.width; h = d.height;
			if (canvas) size();
			break;
		case 'theme':
			applyTheme(d);
			break;
		case 'motion':
			reduced = !!d.reducedMotion;
			break;
		case 'layout':
			column = d.column || null;
			if (canvas) applyTheme(null);
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.amount = 1;
			break;
	}
};
