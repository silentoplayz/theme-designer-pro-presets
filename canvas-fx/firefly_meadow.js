/**
 * Title: Firefly Meadow
 * Description: Fireflies blink in short bursts over swaying grass and ground mist under a crescent moon; now and then one flashes a J-shaped mating arc, a tap sends the nearest one on its own, and the cursor turns the breeze.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const FIREFLY_COUNT  = 60;    // fireflies drifting over the meadow (5-120)
const DRIFT_SPEED    = 1;     // how fast the fireflies wander and the grass sways (0-3)
const REDUCED_SPEED  = 0.3;   // share of the motion kept under reduced motion (0-1)
const FLASH_LENGTH   = 0.14;  // how long a flash lasts, in seconds (0.05-0.6)
const DARK_MIN       = 1.5;   // shortest pause between flashes, in seconds (0.5-6)
const DARK_MAX       = 4.5;   // longest pause between flashes, in seconds (1-12)
const ARC_EVERY      = 8;     // average seconds between J-shaped mating arcs; 0 turns them off (0-60)
const GRASS_DENSITY  = 1;     // how thick the grass grows (0-2)
const GRASS_HEIGHT   = 0.15;  // tallest blades as a share of the screen height (0.05-0.2)
const WIND           = 0.5;   // strength of the breeze (0-2)
const CURSOR_WIND    = 0.5;   // how far the cursor turns the breeze; settles when it stops (0-2)
const MIST           = 0.5;   // ground mist along the grass line (0-1)
const MOON_PHASE     = 0.22;  // 0 new, 0.5 full (0-1)
const CENTER_CALM    = 0.8;   // how much everything thins behind the chat column (0-1)
const BAND_WIDTH     = 520;   // half-width of the calm band, in px (300-900)
const FOLLOW_THEME   = true;  // draw in the theme's colors
/* ──────────────────────────────────────────── */

const DEFAULT = { background: '#0b1018', surface: '#121a24', text: '#eef0e6', muted: '#7d8a99', accent: '#7fbf4d', accent2: '#ffd35c', accent3: '#3f7f57' };
const MAX_FLIES = 120, MAX_BLADES = 900, MAX_STARS = 140, TRAIL = 28, TAU = Math.PI * 2;
const F = (n) => new Float32Array(n);

let canvas, ctx, w = 0, h = 0, dpr = 1, last = 0, reduced = false, dark = true, colors = DEFAULT;
let grassStyle = [], flySprite = [], coreStyle = [], groundCache, mistSprite, moonSprite, moonGlow, starStyle = '#fff', trailStyle = '#fff';
let time = 0, wind = 0;
const fx = F(MAX_FLIES), fy = F(MAX_FLIES), fpx = F(MAX_FLIES), fpy = F(MAX_FLIES), fsz = F(MAX_FLIES);
const ftimer = F(MAX_FLIES), fdark = F(MAX_FLIES), fshade = new Uint8Array(MAX_FLIES);
let flies = 0;
const bx = F(MAX_BLADES), by = F(MAX_BLADES), bh = F(MAX_BLADES), bph = F(MAX_BLADES), bsp = F(MAX_BLADES), bsw = F(MAX_BLADES), blean = F(MAX_BLADES);
const groupStart = new Uint16Array(25);
const stx = F(MAX_STARS), sty = F(MAX_STARS), sts = F(MAX_STARS);
let starCount = 0;
// The J arc: one firefly at a time follows a curve whose control point dips below it, so it drops and then sweeps up
const arc = { fly: -1, t: 0, x0: 0, y0: 0, cx: 0, cy: 0, x1: 0, y1: 0, wait: ARC_EVERY * 0.5, fade: 0 };
const tx = F(TRAIL), ty = F(TRAIL);
let trailHead = 0, trailLen = 0;
const mouse = { x: 0, amount: 0 };

function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function rgba(c, a) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a.toFixed(3) + ')'; }
function band(x) {
	const t = Math.min(1, Math.max(0, (Math.abs(x - w / 2) / BAND_WIDTH - 0.55) / 0.7));
	return 1 - t * t * (3 - 2 * t);
}
function calm(x) { return 1 - CENTER_CALM * band(x); }
function sideX() {
	for (let i = 0; i < 6; i++) { const x = Math.random() * w; if (Math.random() < calm(x)) return x; }
	return Math.random() < 0.5 ? Math.random() * w * 0.2 : w - Math.random() * w * 0.2;
}

function sprite(size, col, a0, a1) {
	const c = new OffscreenCanvas(size, size), g = c.getContext('2d'), r = size / 2;
	const grad = g.createRadialGradient(r, r, 0, r, r, r);
	grad.addColorStop(0, rgba(col, a0));
	grad.addColorStop(0.3, rgba(col, a1));
	grad.addColorStop(1, rgba(col, 0));
	g.fillStyle = grad;
	g.fillRect(0, 0, size, size);
	return c;
}

// ── Palette: precomputed ramps, rebuilt on theme change only ──
function applyTheme(t) {
	if (t) dark = t.dark !== false;
	colors = FOLLOW_THEME && t && t.colors ? t.colors : DEFAULT;
	const surface = hex(colors.surface), text = hex(colors.text), muted = hex(colors.muted);
	const a1 = hex(colors.accent), a2 = hex(colors.accent2), a3 = hex(colors.accent3), bg = hex(colors.background);
	const base = dark ? surface : mix(muted, text, 0.2);
	const amount = dark ? [0.14, 0.24, 0.36] : [0.3, 0.42, 0.55];
	for (let l = 0; l < 3; l++) for (let k = 0; k < 8; k++) {
		grassStyle[l * 8 + k] = rgba(mix(base, mix(a3, a1, k / 7), amount[l]), dark ? 0.45 + l * 0.22 : 0.22 + l * 0.14);
	}
	for (let k = 0; k < 8; k++) {
		const c = mix(a1, a2, 0.35 + k / 11);
		flySprite[k] = sprite(64, dark ? mix(c, [255, 255, 255], 0.15) : mix(c, text, 0.1), dark ? 0.9 : 0.75, dark ? 0.35 : 0.28);
		coreStyle[k] = rgba(dark ? mix(c, text, 0.55) : mix(c, text, 0.35), 1);
	}
	starStyle = rgba(dark ? text : muted, 1);
	trailStyle = rgba(dark ? mix(a2, text, 0.4) : mix(a2, text, 0.3), 1);
	mistSprite = sprite(128, dark ? muted : mix(muted, bg, 0.3), dark ? 0.35 : 0.25, 0.18);
	moonGlow = sprite(128, dark ? text : muted, dark ? 0.2 : 0.1, dark ? 0.06 : 0.03);
	moonSprite = new OffscreenCanvas(48, 48);
	const g = moonSprite.getContext('2d');
	g.fillStyle = rgba(dark ? text : muted, dark ? 0.9 : 0.7);
	g.beginPath(); g.arc(24, 24, 18, 0, TAU); g.fill();
	g.globalCompositeOperation = 'destination-out';
	const off = 36 * Math.min(1, Math.abs(MOON_PHASE - 0.5) * 2);
	g.beginPath(); g.arc(24 + (MOON_PHASE < 0.5 ? -1 : 1) * (36 - off), 23, 18.5, 0, TAU);
	g.fill();
	if (w) buildGround();
}

// Ground shade, cached: a soft band at the foot of the grass
function buildGround() {
	const gh = Math.max(1, Math.round(h * 0.12));
	groundCache = new OffscreenCanvas(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(gh / 2)));
	const g = groundCache.getContext('2d');
	const grad = g.createLinearGradient(0, 0, 0, groundCache.height);
	const c = dark ? mix(hex(colors.background), [0, 0, 0], 0.5) : mix(hex(colors.muted), hex(colors.accent3), 0.3);
	grad.addColorStop(0, rgba(c, 0));
	grad.addColorStop(1, rgba(c, dark ? 0.6 : 0.16));
	g.fillStyle = grad;
	g.fillRect(0, 0, groundCache.width, groundCache.height);
}

function resetFly(i) {
	fx[i] = sideX();
	fy[i] = h * (0.5 + Math.random() * 0.45);
	fpx[i] = Math.random() * TAU; fpy[i] = Math.random() * TAU;
	fsz[i] = 0.8 + Math.random() * 0.6;
	fdark[i] = DARK_MIN + Math.random() * (DARK_MAX - DARK_MIN);
	ftimer[i] = Math.random() * fdark[i];
	fshade[i] = Math.floor(Math.random() * 8);
}

function size() {
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	flies = Math.min(MAX_FLIES, Math.round(FIREFLY_COUNT * Math.max(0.5, w / 1440)));
	for (let i = 0; i < flies; i++) resetFly(i);
	// Blades grouped by layer and shade so each group strokes as one path
	const per = Math.min(Math.floor(MAX_BLADES / 24), Math.round(w / 1440 * 12 * GRASS_DENSITY));
	let n = 0;
	for (let l = 0; l < 3; l++) for (let k = 0; k < 8; k++) {
		groupStart[l * 8 + k] = n;
		for (let j = 0; j < per; j++, n++) {
			const x = sideX(), q = 1 - 0.65 * CENTER_CALM * band(x);
			bx[n] = x;
			by[n] = h + 2 - (2 - l) * h * 0.012;
			bh[n] = h * GRASS_HEIGHT * (0.35 + Math.random() * 0.65) * (0.6 + l * 0.2) * q;
			bph[n] = Math.random() * TAU; bsp[n] = 0.5 + Math.random() * 0.5; bsw[n] = 4 + Math.random() * 8;
			blean[n] = (Math.random() - 0.5) * 0.7 * bh[n];
		}
	}
	groupStart[24] = n;
	starCount = Math.min(MAX_STARS, Math.round(w * h / 12000));
	for (let i = 0; i < starCount; i++) {
		stx[i] = Math.random() * w; sty[i] = Math.random() * h * 0.5;
		sts[i] = (0.3 + Math.random() * 0.7) * calm(stx[i]);
	}
	arc.fly = -1;
	buildGround();
}

// Starts a J arc for firefly i, heading away from the chat column
function startArc(i) {
	if (i < 0 || reduced) return;
	const dir = fx[i] < w / 2 ? -1 : 1, s = Math.min(1, h / 900);
	arc.fly = i; arc.t = 0; arc.fade = 1;
	arc.x0 = fx[i]; arc.y0 = fy[i];
	arc.cx = fx[i] + dir * 50 * s; arc.cy = fy[i] + 120 * s;
	arc.x1 = fx[i] + dir * 120 * s; arc.y1 = fy[i] - 70 * s;
	trailLen = 0;
}

function frame(now) {
	requestAnimationFrame(frame);
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	if (!w || !h) return;
	const motion = DRIFT_SPEED * (reduced ? REDUCED_SPEED : 1);
	time = (time + dt * motion) % 10000;
	mouse.amount = Math.max(0, mouse.amount - dt * 0.3);
	const target = Math.sin(time * 0.21) * 0.6 * WIND + (mouse.x / w - 0.5) * 2 * CURSOR_WIND * mouse.amount;
	wind += (target - wind) * Math.min(1, dt * 1.2);
	ctx.clearRect(0, 0, w, h);
	ctx.globalCompositeOperation = 'source-over';

	// Stars and moon, dark themes only for the stars
	if (dark) {
		ctx.fillStyle = starStyle;
		for (let i = 0; i < starCount; i++) {
			ctx.globalAlpha = sts[i] * (0.35 + 0.3 * Math.sin(now / 1000 * (0.4 + (i % 7) * 0.15) + i));
			ctx.fillRect(stx[i], sty[i], 1.2, 1.2);
		}
	}
	const mx = w * 0.84, my = h * 0.17;
	ctx.globalAlpha = 1;
	ctx.drawImage(moonGlow, mx - 110, my - 110, 220, 220);
	ctx.drawImage(moonSprite, mx - 24, my - 24, 48, 48);

	ctx.globalAlpha = 1;
	if (groundCache) ctx.drawImage(groundCache, 0, h - h * 0.12, w, h * 0.12);

	// Grass, far to near, mist after the far layers
	ctx.lineCap = 'round';
	for (let l = 0; l < 3; l++) {
		ctx.lineWidth = 1 + l * 0.5;
		const lw = wind * (0.5 + l * 0.25);
		for (let k = 0; k < 8; k++) {
			const g = l * 8 + k, end = groupStart[g + 1];
			if (end === groupStart[g]) continue;
			ctx.strokeStyle = grassStyle[g];
			ctx.beginPath();
			for (let i = groupStart[g]; i < end; i++) {
				const sway = (Math.sin(time * bsp[i] + bph[i]) * 0.6 + lw) * bsw[i];
				ctx.moveTo(bx[i], by[i]);
				ctx.quadraticCurveTo(bx[i] + blean[i] * 0.15 + sway * 0.3, by[i] - bh[i] * 0.55, bx[i] + blean[i] + sway, by[i] - bh[i] + Math.abs(blean[i]) * 0.3);
			}
			ctx.stroke();
		}
		if (l === 1 && MIST > 0) {
			const breathe = 0.6 + 0.4 * Math.sin(time * 0.15);
			for (let m = 0; m < 9; m++) {
				const x = ((m / 9) * (w + 400) + time * 6 * (m % 2 ? 1 : -0.6)) % (w + 400) - 200;
				ctx.globalAlpha = MIST * breathe * calm(x) * (dark ? 0.9 : 0.7);
				ctx.drawImage(mistSprite, x - 180, h * 0.86 - 30 + (m % 3) * 12, 360, 70);
			}
			ctx.globalAlpha = 1;
		}
	}

	// Fireflies: wandering, blinking with a quick rise and a slower fade
	const glowOp = dark ? 'lighter' : 'source-over';
	const flash = FLASH_LENGTH * (reduced ? 4 : 1);
	for (let i = 0; i < flies; i++) {
		if (i !== arc.fly) {
			fpx[i] += dt * motion * (0.3 + (i % 5) * 0.06);
			fpy[i] += dt * motion * (0.25 + (i % 3) * 0.07);
			fx[i] += (Math.cos(fpx[i]) * 18 + wind * 6) * dt * motion;
			fy[i] += Math.sin(fpy[i]) * 10 * dt * motion;
			if (fx[i] < -30) fx[i] = w + 30; else if (fx[i] > w + 30) fx[i] = -30;
			if (fy[i] < h * 0.45) fy[i] += 8 * dt; else if (fy[i] > h * 0.97) fy[i] -= 8 * dt;
		}
		ftimer[i] += dt;
		if (ftimer[i] > fdark[i] + flash) { ftimer[i] = 0; fdark[i] = DARK_MIN + Math.random() * (DARK_MAX - DARK_MIN); }
		const ft = (ftimer[i] - fdark[i]) / flash;
		let b = ft < 0 ? 0 : ft < 0.3 ? ft / 0.3 : 1 - (ft - 0.3) / 0.7;
		if (i === arc.fly) b = Math.max(b, arc.t < 0.85 ? 1 : 0);
		const c = calm(fx[i]), s = fsz[i];
		ctx.globalCompositeOperation = glowOp;
		ctx.globalAlpha = (0.1 + b * 0.9) * c;
		const r = 22 * s * (0.45 + b * 0.55);
		ctx.drawImage(flySprite[fshade[i]], fx[i] - r, fy[i] - r, r * 2, r * 2);
		ctx.globalCompositeOperation = 'source-over';
		ctx.globalAlpha = (0.12 + b * 0.85) * c;
		ctx.fillStyle = coreStyle[fshade[i]];
		ctx.fillRect(fx[i] - s, fy[i] - s, s * 2, s * 2);
	}

	// The J arc and its fading streak of light
	if (ARC_EVERY > 0 && !reduced && arc.fly < 0) {
		arc.wait -= dt;
		if (arc.wait <= 0) {
			arc.wait = ARC_EVERY * (0.5 + Math.random());
			let pick = -1;
			for (let tries = 0; tries < 8 && pick < 0; tries++) { const i = Math.floor(Math.random() * flies); if (band(fx[i]) < 0.3) pick = i; }
			startArc(pick);
		}
	}
	if (arc.fly >= 0) {
		const i = arc.fly;
		arc.t += dt / 1.1;
		const u = Math.min(1, arc.t), v = 1 - u;
		fx[i] = v * v * arc.x0 + 2 * v * u * arc.cx + u * u * arc.x1;
		fy[i] = v * v * arc.y0 + 2 * v * u * arc.cy + u * u * arc.y1;
		if (arc.t < 0.85) { tx[trailHead] = fx[i]; ty[trailHead] = fy[i]; trailHead = (trailHead + 1) % TRAIL; trailLen = Math.min(TRAIL, trailLen + 1); }
		else arc.fade = Math.max(0, arc.fade - dt * 1.6);
		if (arc.t >= 1 && arc.fade <= 0) { arc.fly = -1; trailLen = 0; }
	}
	if (trailLen > 1) {
		ctx.strokeStyle = trailStyle;
		ctx.lineWidth = 2;
		const c = calm(arc.x0) * arc.fade * (dark ? 0.8 : 0.6);
		for (let k = 1; k < trailLen; k++) {
			const a = (trailHead - trailLen + k - 1 + TRAIL) % TRAIL, b = (a + 1) % TRAIL;
			ctx.globalAlpha = c * (k / trailLen);
			ctx.beginPath();
			ctx.moveTo(tx[a], ty[a]);
			ctx.lineTo(tx[b], ty[b]);
			ctx.stroke();
		}
	}
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
			size();
			requestAnimationFrame(frame);
			break;
		case 'resize':
			w = d.width; h = d.height; dpr = Math.min(d.dpr || 1, 2);
			if (canvas) size();
			break;
		case 'theme':
			applyTheme(d);
			break;
		case 'motion':
			reduced = !!d.reducedMotion;
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.amount = 1;
			break;
		case 'mousedown': {
			// A tap sends the nearest firefly outside the chat column on a J arc
			if (arc.fly >= 0) break;
			let best = -1, bd = 1e12;
			for (let i = 0; i < flies; i++) {
				if (band(fx[i]) > 0.3) continue;
				const dx = fx[i] - d.x, dy = fy[i] - d.y, dd = dx * dx + dy * dy;
				if (dd < bd) { bd = dd; best = i; }
			}
			startArc(best);
			break;
		}
	}
};
