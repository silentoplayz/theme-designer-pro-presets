/**
 * Title: Firefly Meadow
 * Description: A nighttime meadow scene teeming with life. Layered grass
 *   silhouettes sway in a gentle breeze at three depth levels. Fireflies
 *   drift with species-accurate flash patterns — short bursts separated by
 *   long dark intervals, each with a unique rhythm. A crescent moon hangs
 *   in the sky casting faint light, stars twinkle overhead, and a ground
 *   mist layer hugs the grass line, thickening and thinning with a slow
 *   breath-like rhythm. Occasionally a firefly traces a long J-shaped mating
 *   flight arc. Mouse position shifts the wind direction, bending the grass.
 *
 *   Fully autonomous — no interaction required. Follows your theme's
 *   colors when the designer sends them.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const FOLLOW_THEME        = true;     // Draw in the theme's colors when the designer sends them (true/false)
const FIREFLY_COUNT       = 35;       // drifting fireflies
const STAR_COUNT          = 140;      // sky stars
const GRASS_BLADES_NEAR   = 80;       // foreground grass density
const GRASS_BLADES_MID    = 60;       // midground
const GRASS_BLADES_FAR    = 40;       // background
const FLASH_DURATION      = 0.12;     // flash on-time (seconds)
const DARK_INTERVAL_MIN   = 1.5;      // min seconds between flashes
const DARK_INTERVAL_MAX   = 4.0;      // max seconds between flashes
const MIST_OPACITY        = 0.12;     // ground mist max opacity
const WIND_BASE           = 0.3;      // base wind strength
const MOUSE_WIND          = 0.4;      // mouse-driven wind influence
const MOON_PHASE          = 0.25;     // 0=new, 0.5=full, 0.25=crescent
/* ──────────────────────────────────────────── */

let canvas, ctx, w, h;
let mouse = { x: 0.5 };
let stars = [];
let fireflies = [];
let grassLayers = [];
let time = 0;
let palette = null;

const TAU = Math.PI * 2;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

// ── Stars ──

function initStars() {
	stars = [];
	for (let i = 0; i < STAR_COUNT; i++) {
		stars.push({
			x: Math.random() * w,
			y: Math.random() * h * 0.55,
			size: 0.3 + Math.random() * 1.2,
			twinkleSpeed: 0.01 + Math.random() * 0.025,
			phase: Math.random() * TAU
		});
	}
}

function drawStars() {
	for (let i = 0; i < stars.length; i++) {
		const s = stars[i];
		const brightness = 0.3 + 0.7 * Math.sin(time * s.twinkleSpeed + s.phase);
		ctx.globalAlpha = palette ? brightness * 0.7 * palette.starAlpha : brightness * 0.7;
		ctx.fillStyle = palette ? palette.star : '#e8e4d8';
		ctx.beginPath();
		ctx.arc(s.x, s.y, s.size, 0, TAU);
		ctx.fill();
	}
}

// ── Moon ──

function drawMoon() {
	const mx = w * 0.78;
	const my = h * 0.15;
	const r = 16;

	// Moonlight glow
	ctx.globalAlpha = 0.06;
	const glow = ctx.createRadialGradient(mx, my, 0, mx, my, r * 8);
	const glowRgb = palette ? palette.moonGlow : '200, 210, 230';
	glow.addColorStop(0, `rgba(${glowRgb}, 0.5)`);
	glow.addColorStop(1, `rgba(${glowRgb}, 0)`);
	ctx.fillStyle = glow;
	ctx.beginPath();
	ctx.arc(mx, my, r * 8, 0, TAU);
	ctx.fill();

	// Moon disc
	ctx.globalAlpha = 0.85;
	ctx.fillStyle = palette ? palette.moonDisc : '#d8dce8';
	ctx.beginPath();
	ctx.arc(mx, my, r, 0, TAU);
	ctx.fill();

	// Crescent shadow
	const shadowOffset = r * (1 - MOON_PHASE * 2);
	ctx.fillStyle = palette ? palette.moonShadow : '#0a0e18';
	ctx.beginPath();
	ctx.arc(mx + shadowOffset, my - 1, r * 0.88, 0, TAU);
	ctx.fill();
}

// ── Grass ──

function makeGrassBlade(x, baseY, layer) {
	const heightMult = layer === 0 ? 0.6 : layer === 1 ? 0.8 : 1.0;
	return {
		x,
		baseY,
		height: (25 + Math.random() * 40) * heightMult,
		width: 1 + Math.random() * 2 * heightMult,
		swayPhase: Math.random() * TAU,
		swaySpeed: 0.008 + Math.random() * 0.006,
		swayAmount: 8 + Math.random() * 12,
		hue: 90 + Math.random() * 30,
		lightness: layer === 0 ? 8 : layer === 1 ? 12 : 18
	};
}

function initGrass() {
	grassLayers = [];
	const counts = [GRASS_BLADES_FAR, GRASS_BLADES_MID, GRASS_BLADES_NEAR];
	const baseYs = [h * 0.68, h * 0.78, h * 0.88];

	for (let layer = 0; layer < 3; layer++) {
		const blades = [];
		for (let i = 0; i < counts[layer]; i++) {
			const x = Math.random() * (w + 40) - 20;
			blades.push(makeGrassBlade(x, baseYs[layer] + Math.random() * (h - baseYs[layer]), layer));
		}
		grassLayers.push(blades);
	}
}

function drawGrassLayer(blades, layer, windOffset) {
	const layerAlpha = layer === 0 ? 0.4 : layer === 1 ? 0.6 : 0.8;

	for (let i = 0; i < blades.length; i++) {
		const b = blades[i];
		const windSway = Math.sin(time * b.swaySpeed + b.swayPhase) * b.swayAmount;
		const totalSway = windSway + windOffset * b.swayAmount * 0.5;

		ctx.globalAlpha = palette ? layerAlpha * palette.grassAlpha : layerAlpha;
		ctx.strokeStyle = palette ? palette.grass[layer][shadeIndex(b.hue, 90, 30)] : `hsl(${b.hue}, 40%, ${b.lightness}%)`;
		ctx.lineWidth = b.width;
		ctx.lineCap = 'round';
		ctx.beginPath();
		ctx.moveTo(b.x, b.baseY);
		ctx.quadraticCurveTo(
			b.x + totalSway * 0.6, b.baseY - b.height * 0.6,
			b.x + totalSway, b.baseY - b.height
		);
		ctx.stroke();
	}
}

// ── Fireflies ──

function makeFirefly() {
	return {
		x: Math.random() * w,
		y: h * 0.45 + Math.random() * h * 0.45,
		vx: (Math.random() - 0.5) * 0.5,
		vy: (Math.random() - 0.5) * 0.3,
		size: 2 + Math.random() * 2,
		hue: 50 + Math.random() * 20,
		flashTimer: 0,
		darkInterval: DARK_INTERVAL_MIN + Math.random() * (DARK_INTERVAL_MAX - DARK_INTERVAL_MIN),
		isFlashing: false,
		flashProgress: 0,
		wobblePhaseX: Math.random() * TAU,
		wobblePhaseY: Math.random() * TAU,
		wobbleSpeedX: 0.008 + Math.random() * 0.01,
		wobbleSpeedY: 0.006 + Math.random() * 0.008
	};
}

function updateAndDrawFireflies(dt) {
	for (let i = 0; i < fireflies.length; i++) {
		const f = fireflies[i];

		// Drift with gentle wobble
		f.x += Math.sin(time * f.wobbleSpeedX + f.wobblePhaseX) * 0.4 + f.vx;
		f.y += Math.sin(time * f.wobbleSpeedY + f.wobblePhaseY) * 0.25 + f.vy;

		// Wrap around edges
		if (f.x < -20) f.x = w + 20;
		if (f.x > w + 20) f.x = -20;
		if (f.y < h * 0.3) f.vy += 0.01;
		if (f.y > h * 0.95) f.vy -= 0.01;
		f.vy *= 0.99;
		f.vx *= 0.99;

		// Flash timing (species-accurate: short flash, long dark)
		f.flashTimer += dt;
		if (!f.isFlashing) {
			if (f.flashTimer >= f.darkInterval) {
				f.isFlashing = true;
				f.flashTimer = 0;
				f.flashProgress = 0;
			}
		} else {
			f.flashProgress = f.flashTimer / FLASH_DURATION;
			if (f.flashProgress >= 1) {
				f.isFlashing = false;
				f.flashTimer = 0;
				f.darkInterval = DARK_INTERVAL_MIN + Math.random() * (DARK_INTERVAL_MAX - DARK_INTERVAL_MIN);
			}
		}

		// Brightness: quick rise, slower fade
		let brightness = 0;
		if (f.isFlashing) {
			const t = f.flashProgress;
			brightness = t < 0.3 ? t / 0.3 : 1 - ((t - 0.3) / 0.7);
			brightness = Math.max(0, brightness);
		}

		const fly = palette ? palette.fly[shadeIndex(f.hue, 50, 20)] : null;

		// Flash glow halo
		if (brightness > 0.05) {
			ctx.globalAlpha = brightness * 0.15;
			const glow = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.size * 12);
			glow.addColorStop(0, fly ? `rgba(${fly.join(', ')}, 0.6)` : `hsla(${f.hue}, 100%, 75%, 0.6)`);
			glow.addColorStop(1, fly ? `rgba(${fly.join(', ')}, 0)` : `hsla(${f.hue}, 100%, 75%, 0)`);
			ctx.fillStyle = glow;
			ctx.beginPath();
			ctx.arc(f.x, f.y, f.size * 12, 0, TAU);
			ctx.fill();
		}

		// Core dot (always faintly visible + bright on flash)
		ctx.globalAlpha = 0.03 + brightness * 0.85;
		ctx.fillStyle = fly ? rgbStr(mixRgb(fly, palette.flyTip, brightness * 0.5)) : `hsl(${f.hue}, 100%, ${50 + brightness * 30}%)`;
		ctx.beginPath();
		ctx.arc(f.x, f.y, f.size * (0.5 + brightness * 0.5), 0, TAU);
		ctx.fill();
	}
}

// ── Ground mist ──

function drawMist() {
	const mistY = h * 0.75;
	const breathe = 0.6 + 0.4 * Math.sin(time * 0.003);
	const alpha = MIST_OPACITY * breathe;

	for (let layer = 0; layer < 3; layer++) {
		const ly = mistY + layer * 25;
		const drift = Math.sin(time * 0.002 + layer * 2) * 30;

		ctx.globalAlpha = alpha * (1 - layer * 0.3);
		const grad = ctx.createLinearGradient(0, ly - 30, 0, ly + 40);
		const mistRgb = palette ? palette.mist : '180, 190, 210';
		grad.addColorStop(0, `rgba(${mistRgb}, 0)`);
		grad.addColorStop(0.4, `rgba(${mistRgb}, ${0.5 * breathe})`);
		grad.addColorStop(1, `rgba(${mistRgb}, 0)`);
		ctx.fillStyle = grad;

		for (let x = -50; x < w + 50; x += 40) {
			const wobble = Math.sin(x * 0.01 + time * 0.002 + layer) * 15;
			ctx.beginPath();
			ctx.ellipse(x + drift, ly + wobble, 60, 18 + Math.sin(x * 0.03 + time * 0.004) * 6, 0, 0, TAU);
			ctx.fill();
		}
	}
}

// ── Ground ──

function drawGround() {
	const groundY = h * 0.88;
	const grad = ctx.createLinearGradient(0, groundY - 15, 0, h);
	grad.addColorStop(0, palette ? palette.ground[0] : 'rgba(8, 12, 6, 0)');
	grad.addColorStop(0.2, palette ? palette.ground[1] : 'rgb(8, 12, 6)');
	grad.addColorStop(1, palette ? palette.ground[2] : 'rgb(4, 6, 3)');
	ctx.globalAlpha = 1;
	ctx.fillStyle = grad;
	ctx.fillRect(0, groundY - 15, w, h - groundY + 15);
}

// ── Theme ──

function hexRgb(hex) {
	const n = parseInt(String(hex).slice(1, 7), 16) || 0;
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixRgb(a, b, t) {
	return [
		Math.round(a[0] + (b[0] - a[0]) * t),
		Math.round(a[1] + (b[1] - a[1]) * t),
		Math.round(a[2] + (b[2] - a[2]) * t)
	];
}

function rgbStr(c) {
	return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

// Maps a blade or firefly hue onto one of 8 palette shades
function shadeIndex(hue, min, range) {
	return Math.max(0, Math.min(7, Math.floor((hue - min) / range * 8)));
}

function applyTheme(t) {
	if (!FOLLOW_THEME || !t || !t.colors) return;
	const c = t.colors;
	const ramp = t.ramp || {};
	const dark = t.dark !== false;
	const bg = hexRgb(c.background);
	const surface = hexRgb(c.surface);
	const text = hexRgb(c.text);
	const muted = hexRgb(c.muted);
	const accent = hexRgb(c.accent);
	const accent2 = hexRgb(c.accent2);
	const accent3 = hexRgb(c.accent3);
	const moon = dark ? text : muted;

	// Grass blends from the surface toward the accents, nearer layers stronger
	const grassMix = dark ? [0.12, 0.2, 0.3] : [0.25, 0.4, 0.55];
	const grass = [];
	for (let layer = 0; layer < 3; layer++) {
		const shades = [];
		for (let k = 0; k < 8; k++) shades.push(rgbStr(mixRgb(surface, mixRgb(accent3, accent, k / 7), grassMix[layer])));
		grass.push(shades);
	}

	const fly = [];
	for (let k = 0; k < 8; k++) fly.push(mixRgb(accent, accent2, k / 7));

	const groundTop = dark ? bg : surface;
	const groundBottom = hexRgb(dark ? (ramp['950'] || c.background) : (ramp['200'] || c.surface));

	palette = {
		sky: [rgbStr(bg), rgbStr(mixRgb(bg, surface, 0.5)), rgbStr(surface)],
		wash: muted.join(', '),
		star: rgbStr(dark ? text : muted),
		starAlpha: dark ? 1 : 0.6,
		moonGlow: moon.join(', '),
		moonDisc: rgbStr(moon),
		moonShadow: rgbStr(mixRgb(bg, surface, 0.2)),
		grass,
		grassAlpha: dark ? 1 : 0.6,
		fly,
		flyTip: text,
		mist: (dark ? muted : bg).join(', '),
		ground: [`rgba(${groundTop.join(', ')}, 0)`, rgbStr(groundTop), rgbStr(groundBottom)]
	};
}

// ── Init ──

function initAll() {
	initStars();
	initGrass();
	fireflies = [];
	for (let i = 0; i < FIREFLY_COUNT; i++) fireflies.push(makeFirefly());
}

// ── Render ──

let lastTime = 0;

function animate(timestamp) {
	if (!ctx) return;
	const dt = lastTime ? (timestamp - lastTime) / 1000 : 0.016;
	lastTime = timestamp;
	time++;

	const windOffset = (mouse.x - 0.5) * MOUSE_WIND + Math.sin(time * 0.003) * WIND_BASE;

	// Night sky
	const skyGrad = ctx.createLinearGradient(0, 0, 0, h * 0.75);
	skyGrad.addColorStop(0, palette ? palette.sky[0] : '#060810');
	skyGrad.addColorStop(0.5, palette ? palette.sky[1] : '#0a0e1a');
	skyGrad.addColorStop(1, palette ? palette.sky[2] : '#0e1520');
	ctx.globalAlpha = 1;
	ctx.fillStyle = skyGrad;
	ctx.fillRect(0, 0, w, h);

	// Ambient moonlight wash
	ctx.globalAlpha = 0.02;
	const moonGlow = ctx.createRadialGradient(w * 0.78, h * 0.15, 0, w * 0.78, h * 0.15, h * 0.9);
	const washRgb = palette ? palette.wash : '140, 160, 200';
	moonGlow.addColorStop(0, `rgba(${washRgb}, 0.3)`);
	moonGlow.addColorStop(1, `rgba(${washRgb}, 0)`);
	ctx.fillStyle = moonGlow;
	ctx.fillRect(0, 0, w, h);

	drawStars();
	drawMoon();

	// Grass back-to-front with mist sandwiched
	drawGrassLayer(grassLayers[0], 0, windOffset * 0.4);
	drawGrassLayer(grassLayers[1], 1, windOffset * 0.7);
	drawMist();
	updateAndDrawFireflies(dt);
	drawGrassLayer(grassLayers[2], 2, windOffset);
	drawGround();

	ctx.globalAlpha = 1;
	requestAnimationFrame(animate);
}

// ── Message handler ──

self.onmessage = (e) => {
	switch (e.data.type) {
		case 'init':
			canvas = e.data.canvas;
			ctx = canvas.getContext('2d');
			w = e.data.width;
			h = e.data.height;
			canvas.width = w;
			canvas.height = h;
			applyTheme(e.data.theme);
			initAll();
			requestAnimationFrame(animate);
			break;

		case 'theme':
			applyTheme(e.data);
			break;

		case 'resize':
			w = e.data.width;
			h = e.data.height;
			canvas.width = w;
			canvas.height = h;
			initAll();
			break;

		case 'mousemove':
			mouse.x = e.data.x / w;
			break;
	}
};
