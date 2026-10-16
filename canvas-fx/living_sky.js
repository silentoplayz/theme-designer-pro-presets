/**
 * Title: Living Sky
 * Description: Follows your local time: the sun or a phase-correct moon rides an arc in an outer third over layered mountains, with horizon glow, drifting clouds, night stars and a theme tint.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const PREVIEW_CYCLE  = 0;     // seconds per preview day; 0 follows the clock (0-600)
const THEME_TINT     = 0.35;  // how far the sky leans toward the theme (0-1)
const ARC_X          = 0.84;  // where the sun and moon ride, share of the width (0-1)
const BODY_SIZE      = 22;    // sun and moon radius, in px (10-50)
const CLOUD_AMOUNT   = 1;     // how many clouds drift by (0-2)
const CLOUD_SPEED    = 10;    // cloud drift, in px per second (0-60)
const REDUCED_SPEED  = 0.2;   // drift kept under reduced motion (0-1)
const STAR_DENSITY   = 1;     // night stars, dark themes only (0-2)
const SHOOTING_EVERY = 45;    // average seconds between shooting stars; 0 off (0-300)
const TERRAIN_HEIGHT = 0.17;  // mountain height, share of the screen (0.05-0.2)
const PARALLAX       = 10;    // mountain shift with the cursor, in px (0-40)
const GLOW           = 1;     // horizon and zenith glow (0-2)
const CENTER_CALM    = 0.8;   // how much the sky quiets behind the chat (0-1)
const BAND_WIDTH     = 520;   // half-width of the calm band, in px (300-900)
const FOLLOW_THEME   = true;  // lean the palette toward the theme
/* ──────────────────────────────────────────── */

const MAX_STARS = 260, MAX_CLOUDS = 12, PUFFS = 6, TAU = Math.PI * 2;

let canvas, ctx, w = 0, h = 0, last = 0, reduced = false, dark = true;
let theme = null, hour = 12, clock = 0, refreshAt = 0, elapsed = 0;
let glowCache, glowG, sunSprite, moonSprite, moonHalo, haloSprite, twiSprite, cloudSprite, layers = [], layerG = [];
let starStyle = '', day = 1, twilight = 0, night = 0;
const F = (n) => new Float32Array(n);
const sx = F(MAX_STARS), sy = F(MAX_STARS), sp = F(MAX_STARS), sph = F(MAX_STARS);
const cx = F(MAX_CLOUDS), cy = F(MAX_CLOUDS), cs = F(MAX_CLOUDS), cv = F(MAX_CLOUDS);
const pox = F(MAX_CLOUDS * PUFFS), poy = F(MAX_CLOUDS * PUFFS), pr = F(MAX_CLOUDS * PUFFS);
let stars = 0, clouds = 0;
const shoot = { age: 9, x: 0, y: 0, vx: 0, vy: 120, wait: 20 };
const mouse = { x: 0, amount: 0, off: 0 };

// Atmosphere colors (0-1) for the analytic sky model
const NIGHT_ZEN = [0.015, 0.03, 0.08], NIGHT_HOR = [0.05, 0.06, 0.14];
const DAY_ZEN = [0.2, 0.45, 0.85], DAY_HOR = [0.65, 0.82, 1];
const TWI_ZEN = [0.28, 0.16, 0.38], TWI_HOR = [0.95, 0.45, 0.32];

function hex(c) { const n = parseInt(c.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function rgba(c, a) { return 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + a.toFixed(3) + ')'; }
function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function band(x) { return 1 - smooth(0.55, 1.25, Math.abs(x - w / 2) / BAND_WIDTH); }
function calm(x) { return 1 - CENTER_CALM * band(x); }
function ridge(v) { const r = 1 - Math.abs(Math.sin(v)); return r * r; }

function sprite(size, col, a0, a1, disc) {
	const c = new OffscreenCanvas(size, size), g = c.getContext('2d'), r = size / 2;
	const grad = g.createRadialGradient(r, r, 0, r, r, r);
	grad.addColorStop(0, rgba(col, a0));
	grad.addColorStop(disc ? 0.86 : 0.35, rgba(col, a1));
	grad.addColorStop(1, rgba(col, 0));
	g.fillStyle = grad;
	g.fillRect(0, 0, size, size);
	return c;
}

function currentHour() {
	if (PREVIEW_CYCLE) return (elapsed / PREVIEW_CYCLE * 24 + 6) % 24;
	const d = new Date();
	return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

// Moon phase: 0 new, 0.5 full
function moonPhase() {
	return (Date.now() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000 % 29.530588 / 29.530588;
}

// ── Palette: rebuilt as the hour moves on, and on theme or size changes ──
function refresh() {
	const sunH = Math.sin((hour - 6) / 12 * Math.PI);
	day = smooth(-0.12, 0.18, sunH);
	twilight = Math.exp(-Math.pow(sunH * 3.5, 2));
	night = 1 - smooth(-0.2, 0.05, sunH);
	let zen = mix(mix(NIGHT_ZEN, DAY_ZEN, day), TWI_ZEN, twilight * 0.55);
	let hor = mix(mix(NIGHT_HOR, DAY_HOR, day), TWI_HOR, twilight * 0.85);
	let cloud = mix(mix([0.55, 0.58, 0.68], [1, 0.96, 0.92], day), TWI_HOR, twilight * 0.6);
	let sun = mix([1, 0.5, 0.2], [1, 0.88, 0.6], day);
	let ink = dark ? [0.02, 0.02, 0.04] : [0.15, 0.17, 0.2];
	if (FOLLOW_THEME && theme && theme.colors) {
		const c = theme.colors, k = THEME_TINT;
		zen = mix(zen, hex(c.accent3), k);
		hor = mix(hor, hex(c.accent), k * 0.8);
		cloud = mix(cloud, hex(dark ? c.text : c.muted), k);
		sun = mix(sun, hex(c.accent2), k * 0.4);
		ink = mix(hex(c.background), dark ? [0, 0, 0] : hex(c.text), dark ? 0.55 : 0.7);
	}
	const a = dark ? 1 : 0.6;
	sunSprite = sprite(64, dark ? mix(sun, [1, 1, 1], 0.2) : mix(sun, [1, 0.55, 0.15], 0.45), 1, 0.95, true);
	haloSprite = sprite(128, sun, 0.6 * a, 0.16 * a);
	moonHalo = sprite(64, dark ? [0.75, 0.82, 1] : [0.45, 0.5, 0.62], 0.4 * a, 0.1 * a);
	twiSprite = sprite(128, TWI_HOR, 0.55 * a, 0.2 * a);
	cloudSprite = sprite(96, dark ? cloud : mix(hor, ink, 0.3), (dark ? 0.32 : 0.16) * (0.4 + 0.6 * day + 0.4 * twilight), dark ? 0.12 : 0.06);
	starStyle = rgba(mix([1, 1, 1], hor, 0.25), 1);
	buildMoon();

	// Horizon and zenith glow, at quarter size since it is soft
	const gw = glowCache.width, gh = glowCache.height;
	glowG.globalCompositeOperation = 'source-over';
	glowG.clearRect(0, 0, gw, gh);
	const ga = GLOW * (dark ? 0.42 : 0.24);
	const hy = gh * (1 - TERRAIN_HEIGHT * 0.45);
	let grad = glowG.createLinearGradient(0, hy, 0, gh * 0.35);
	grad.addColorStop(0, rgba(hor, Math.min(1, ga)));
	grad.addColorStop(0.3, rgba(hor, Math.min(1, ga * 0.5)));
	grad.addColorStop(1, rgba(hor, 0));
	glowG.fillStyle = grad;
	glowG.fillRect(0, gh * 0.35, gw, gh * 0.65);
	grad = glowG.createLinearGradient(0, 0, 0, gh * 0.28);
	grad.addColorStop(0, rgba(zen, Math.min(1, ga * (0.4 + 0.5 * day))));
	grad.addColorStop(1, rgba(zen, 0));
	glowG.fillStyle = grad;
	glowG.fillRect(0, 0, gw, gh * 0.28);
	glowG.globalCompositeOperation = 'destination-out';
	grad = glowG.createLinearGradient(0, 0, gw, 0);
	const s = gw / Math.max(1, w), mid = gw / 2;
	const inner = BAND_WIDTH * 0.55 * s, outer = BAND_WIDTH * 1.25 * s;
	const cut = rgba([0, 0, 0], CENTER_CALM * 0.75), none = 'rgba(0,0,0,0)';
	grad.addColorStop(Math.max(0, (mid - outer) / gw), none);
	grad.addColorStop(Math.max(0, (mid - inner) / gw), cut);
	grad.addColorStop(Math.min(1, (mid + inner) / gw), cut);
	grad.addColorStop(Math.min(1, (mid + outer) / gw), none);
	glowG.fillStyle = grad;
	glowG.fillRect(0, 0, gw, gh);

	// Mountains: three ridges, hazier toward the back, lower behind the column
	for (let l = 0; l < 3; l++) {
		const g = layerG[l], lw = layers[l].width;
		g.clearRect(0, 0, lw, h);
		const depth = l / 2;
		g.fillStyle = rgba(mix(hor, ink, dark ? 0.55 + depth * 0.4 : 0.35 + depth * 0.4), 1);
		g.globalAlpha = dark ? 0.7 + depth * 0.3 : 0.22 + depth * 0.2;
		const top = h * TERRAIN_HEIGHT * (1 - depth * 0.45);
		g.beginPath();
		g.moveTo(0, h);
		for (let x = 0; x <= lw; x += 6) {
			const u = x / (230 - l * 50) + l * 7.3;
			const n = ridge(u) * 0.6 + ridge(u * 2.2 + 1.7) * 0.3 + ridge(u * 4.7 + 3) * 0.1;
			const env = 0.55 + 0.45 * Math.sin(x / 410 + l * 2.1);
			const sag = 1 - 0.7 * CENTER_CALM * band(x - PARALLAX * 2);
			g.lineTo(x, h - top * (0.4 + 1.1 * n * env) * sag);
		}
		g.lineTo(lw, h);
		g.closePath();
		g.fill();
	}
}

function buildMoon() {
	const size = 64, r = 26, m = 32;
	moonSprite = new OffscreenCanvas(size, size);
	const g = moonSprite.getContext('2d');
	const lit = dark ? [0.93, 0.93, 0.88] : [0.55, 0.58, 0.65];
	g.fillStyle = rgba(lit, 0.16);
	g.beginPath(); g.arc(m, m, r, 0, TAU); g.fill();
	const p = moonPhase(), off = r * 2 * Math.min(1, Math.abs(p - 0.5) * 2);
	const lc = new OffscreenCanvas(size, size), lg = lc.getContext('2d');
	lg.fillStyle = rgba(lit, 0.95);
	lg.beginPath(); lg.arc(m, m, r, 0, TAU); lg.fill();
	lg.globalCompositeOperation = 'destination-out';
	lg.beginPath(); lg.arc(m + (p < 0.5 ? -1 : 1) * (r * 2 - off), m, r * 1.02, 0, TAU); lg.fill();
	g.drawImage(lc, 0, 0);
}

function size() {
	const px = (v) => Math.max(1, Math.round(v));
	canvas.width = px(w);
	canvas.height = px(h);
	glowCache = new OffscreenCanvas(px(w / 4), px(h / 4));
	glowG = glowCache.getContext('2d');
	for (let l = 0; l < 3; l++) {
		layers[l] = new OffscreenCanvas(px(w + PARALLAX * 4), px(h));
		layerG[l] = layers[l].getContext('2d');
	}
	stars = Math.min(MAX_STARS, Math.round(w * h / 6000 * STAR_DENSITY));
	for (let i = 0; i < stars; i++) {
		sx[i] = Math.random() * w; sy[i] = Math.pow(Math.random(), 1.3) * h * 0.72;
		sp[i] = 0.4 + Math.random() * 1.4; sph[i] = Math.random() * TAU;
	}
	clouds = Math.min(MAX_CLOUDS, Math.round(7 * CLOUD_AMOUNT * Math.max(0.6, w / 1440)));
	for (let i = 0; i < clouds; i++) {
		cx[i] = Math.random() * (w + 600) - 300; cy[i] = h * (0.06 + Math.random() * 0.34);
		cs[i] = 0.6 + Math.random() * 0.8; cv[i] = 0.6 + Math.random() * 0.8;
		for (let j = 0; j < PUFFS; j++) {
			const k = i * PUFFS + j, q = j / (PUFFS - 1), hump = Math.sin(q * Math.PI);
			pox[k] = (q - 0.5) * 180 + (Math.random() - 0.5) * 40;
			poy[k] = (Math.random() - 0.5) * 18 - hump * 14;
			pr[k] = 34 + Math.random() * 26 + hump * 22;
		}
	}
	refresh();
}

function body(f, haloA, halo, hr, disc, dr, discA) {
	const hz = h * (1 - TERRAIN_HEIGHT * 0.55);
	const x = ARC_X * w + (f - 0.5) * 2 * Math.min(w * 0.11, 180);
	const y = hz - Math.sin(Math.min(1, Math.max(0, f)) * Math.PI) * (hz - h * 0.12);
	ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
	ctx.globalAlpha = haloA;
	ctx.drawImage(halo, x - hr, y - hr, hr * 2, hr * 2);
	ctx.globalCompositeOperation = 'source-over';
	ctx.globalAlpha = discA;
	ctx.drawImage(disc, x - dr, y - dr, dr * 2, dr * 2);
	return x;
}

function frame(now) {
	requestAnimationFrame(frame);
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	if (!w || !h) return;
	const motion = reduced ? REDUCED_SPEED : 1;
	elapsed += dt * motion;
	clock -= dt;
	if (clock <= 0) {
		const step = PREVIEW_CYCLE ? 0.05 : 1;
		clock = step; hour = currentHour(); refreshAt -= step;
		if (refreshAt <= 0) { refresh(); refreshAt = PREVIEW_CYCLE ? 0.25 : 60; }
	}
	const t = now / 1000;
	ctx.clearRect(0, 0, w, h);
	ctx.globalCompositeOperation = 'source-over';
	ctx.globalAlpha = 1;
	ctx.drawImage(glowCache, 0, 0, w, h);

	const horizon = h * (1 - TERRAIN_HEIGHT * 0.55);

	// Stars, dark themes only, fading with daylight
	if (dark && night > 0.02) {
		ctx.fillStyle = starStyle;
		for (let i = 0; i < stars; i++) {
			const tw = 0.55 + 0.45 * Math.sin(t * sp[i] * (reduced ? 0.3 : 1) + sph[i]);
			ctx.globalAlpha = night * tw * 0.75 * calm(sx[i]) * (1 - sy[i] / h);
			ctx.fillRect(sx[i], sy[i], i % 8 ? 1 : 2, i % 8 ? 1 : 2);
		}
		if (SHOOTING_EVERY > 0 && !reduced) {
			shoot.wait -= dt;
			if (shoot.wait <= 0 && night > 0.6) {
				const side = Math.random() < 0.5 ? -1 : 1;
				shoot.x = w / 2 + side * (BAND_WIDTH + Math.random() * w * 0.2); shoot.y = h * (0.05 + Math.random() * 0.25);
				shoot.vx = side * (260 + Math.random() * 200); shoot.vy = 120;
				shoot.age = 0; shoot.wait = SHOOTING_EVERY * (0.5 + Math.random());
			}
			if (shoot.age < 0.9) {
				shoot.age += dt;
				shoot.x += shoot.vx * dt; shoot.y += shoot.vy * dt;
				ctx.globalAlpha = Math.sin(Math.PI * shoot.age / 0.9) * 0.7 * night * calm(shoot.x);
				ctx.strokeStyle = starStyle;
				ctx.beginPath(); ctx.moveTo(shoot.x, shoot.y); ctx.lineTo(shoot.x - shoot.vx * 0.12, shoot.y - shoot.vy * 0.12); ctx.stroke();
			}
		}
	}

	// Sun, or the moon at night, on an arc inside the outer third
	const sunF = (hour - 6) / 12, moonF = ((hour < 12 ? hour + 24 : hour) - 18) / 12;
	const sunVis = smooth(-0.04, 0.04, sunF) * smooth(1.04, 0.96, sunF);
	const moonVis = smooth(-0.04, 0.06, moonF) * smooth(1.04, 0.94, moonF) * (1 - day * 0.8);
	if (sunVis > 0) {
		const x = body(sunF, sunVis * (0.6 + 0.4 * twilight), haloSprite, BODY_SIZE * 10, sunSprite, BODY_SIZE, sunVis * (dark ? 0.95 : 0.85));
		ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
		ctx.globalAlpha = twilight * sunVis;
		ctx.drawImage(twiSprite, x - w * 0.22, horizon - h * 0.12, w * 0.44, h * 0.24);
		ctx.globalCompositeOperation = 'source-over';
	}
	if (moonVis > 0) body(moonF, moonVis * 0.6, moonHalo, BODY_SIZE * 4.5, moonSprite, BODY_SIZE * 1.1, moonVis);

	// Clouds: sprite puffs, thinner over the column
	const drift = CLOUD_SPEED * motion * dt;
	for (let i = 0; i < clouds; i++) {
		cx[i] += drift * cv[i];
		if (cx[i] > w + 300) { cx[i] = -300; cy[i] = h * (0.06 + Math.random() * 0.34); }
		const s = cs[i];
		for (let j = 0; j < PUFFS; j++) {
			const k = i * PUFFS + j, x = cx[i] + pox[k] * s, r = pr[k] * s;
			ctx.globalAlpha = calm(x);
			ctx.drawImage(cloudSprite, x - r * 1.3, cy[i] + poy[k] * s - r * 0.7, r * 2.6, r * 1.4);
		}
	}

	// Mountains, with a parallax that settles when the cursor stops
	mouse.amount = Math.max(0, mouse.amount - dt * 0.35);
	const target = (mouse.x / Math.max(1, w) - 0.5) * 2 * mouse.amount * (reduced ? 0.3 : 1);
	mouse.off += (target - mouse.off) * Math.min(1, dt * 2);
	ctx.globalAlpha = 1;
	for (let l = 0; l < 3; l++) ctx.drawImage(layers[l], -PARALLAX * 2 - mouse.off * PARALLAX * (0.4 + l * 0.6), 0);
}

self.onmessage = (e) => {
	const d = e.data;
	switch (d.type) {
		case 'init':
			canvas = d.canvas;
			ctx = canvas.getContext('2d');
			w = d.width; h = d.height;
			reduced = !!d.reducedMotion;
			theme = d.theme;
			dark = !theme || theme.dark !== false;
			hour = currentHour();
			size();
			requestAnimationFrame(frame);
			break;
		case 'resize':
			w = d.width; h = d.height;
			if (canvas) size();
			break;
		case 'theme':
			theme = d;
			dark = d.dark !== false;
			if (glowCache) refresh();
			break;
		case 'motion':
			reduced = !!d.reducedMotion;
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.amount = 1;
			break;
	}
};
