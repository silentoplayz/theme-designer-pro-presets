/**
 * Title: Living Sky
 * Description: A procedural time-aware landscape that reflects the actual
 *   time of day. Dawn paints the sky pink, midday goes bright blue, dusk
 *   fades to amber, and night reveals stars with occasional shooting stars.
 *   A silhouetted mountain range spans the bottom, clouds drift across, and
 *   the sun/moon arcs overhead tracking real local time. Always different,
 *   always beautiful — no interaction required.
 *
 *   Uses native Date access in the Worker — fully autonomous.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const CLOUD_COUNT         = 8;        // number of drifting clouds
const CLOUD_SPEED         = 0.15;     // cloud drift speed
const STAR_COUNT          = 200;      // stars visible at night
const SHOOTING_STAR_CHANCE = 0.002;   // per-frame chance of a shooting star
const MOUNTAIN_LAYERS     = 3;        // parallax mountain layers
const TERRAIN_HEIGHT      = 0.3;      // terrain height as fraction of viewport
const SUN_MOON_RADIUS     = 18;       // radius of sun/moon circle
const SHOW_TIME_LABEL     = true;     // subtle time display in corner
const TIME_LABEL_FONT     = '500 11px "Inter", system-ui, sans-serif';
/* ──────────────────────────────────────────── */

let canvas, ctx, w, h;
let stars = [];
let clouds = [];
let mountains = []; // array of arrays of points per layer
let shootingStars = [];

const TAU = Math.PI * 2;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

// ── Sky color palette by time ──
// Each entry: [hour, topR, topG, topB, botR, botG, botB]
const SKY_STOPS = [
	[0,   8,  10,  28,  12,  15,  35],   // midnight
	[4,   8,  10,  28,  15,  18,  40],   // pre-dawn
	[5.5, 25,  20,  50,  80,  50,  70],  // early dawn
	[6.5, 60,  80, 140, 220, 140, 100],  // dawn
	[7.5, 80, 140, 210, 250, 190, 130],  // sunrise
	[9,  100, 170, 240, 180, 210, 240],  // morning
	[12, 80,  150, 230, 160, 200, 240],  // noon
	[16, 90,  155, 225, 170, 200, 235],  // afternoon
	[18, 100, 120, 180, 240, 160, 100],  // pre-sunset
	[19, 60,   60, 120, 230, 110,  70],  // sunset
	[20, 30,   30,  80, 120,  60,  60],  // dusk
	[21, 12,   15,  45,  25,  20,  50],  // twilight
	[24,  8,   10,  28,  12,  15,  35],  // midnight wrap
];

function lerpColor(stops, hour) {
	let a = stops[0], b = stops[stops.length - 1];
	for (let i = 0; i < stops.length - 1; i++) {
		if (hour >= stops[i][0] && hour < stops[i + 1][0]) {
			a = stops[i];
			b = stops[i + 1];
			break;
		}
	}
	const t = (hour - a[0]) / (b[0] - a[0] || 1);
	const lerp = (x, y) => Math.round(x + (y - x) * t);
	return {
		topR: lerp(a[1], b[1]), topG: lerp(a[2], b[2]), topB: lerp(a[3], b[3]),
		botR: lerp(a[4], b[4]), botG: lerp(a[5], b[5]), botB: lerp(a[6], b[6])
	};
}

// ── Stars ──
function initStars() {
	stars = [];
	for (let i = 0; i < STAR_COUNT; i++) {
		stars.push({
			x: Math.random() * w,
			y: Math.random() * h * 0.7,
			r: Math.random() * 1.2 + 0.3,
			twinkleSpeed: Math.random() * 2 + 1,
			twinkleOffset: Math.random() * TAU
		});
	}
}

function drawStars(alpha, time) {
	if (alpha <= 0) return;
	ctx.fillStyle = 'white';
	for (let i = 0; i < stars.length; i++) {
		const s = stars[i];
		const twinkle = 0.5 + 0.5 * Math.sin(time * s.twinkleSpeed + s.twinkleOffset);
		ctx.globalAlpha = alpha * twinkle * 0.8;
		ctx.beginPath();
		ctx.arc(s.x, s.y, s.r, 0, TAU);
		ctx.fill();
	}
}

// ── Shooting stars ──
function spawnShootingStar() {
	shootingStars.push({
		x: Math.random() * w * 0.8 + w * 0.1,
		y: Math.random() * h * 0.3,
		vx: (Math.random() * 4 + 3) * (Math.random() > 0.5 ? 1 : -1),
		vy: Math.random() * 2 + 1.5,
		life: 1,
		decay: Math.random() * 0.02 + 0.015,
		length: Math.random() * 40 + 20
	});
}

function updateAndDrawShootingStars(nightAlpha) {
	if (nightAlpha <= 0) return;
	ctx.lineCap = 'round';
	for (let i = shootingStars.length - 1; i >= 0; i--) {
		const s = shootingStars[i];
		s.x += s.vx;
		s.y += s.vy;
		s.life -= s.decay;
		if (s.life <= 0) { shootingStars.splice(i, 1); continue; }
		ctx.globalAlpha = nightAlpha * s.life * 0.7;
		ctx.strokeStyle = 'white';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo(s.x, s.y);
		ctx.lineTo(s.x - s.vx * s.length / 5, s.y - s.vy * s.length / 5);
		ctx.stroke();
	}
}

// ── Clouds ──
function initClouds() {
	clouds = [];
	for (let i = 0; i < CLOUD_COUNT; i++) {
		clouds.push(makeCloud(Math.random() * (w + 400) - 200));
	}
}

function makeCloud(startX) {
	return {
		x: startX,
		y: Math.random() * h * 0.35 + h * 0.05,
		width: Math.random() * 180 + 80,
		height: Math.random() * 30 + 15,
		speed: (Math.random() * 0.5 + 0.2) * CLOUD_SPEED,
		opacity: Math.random() * 0.3 + 0.1,
		puffs: (() => {
			const n = Math.floor(Math.random() * 4) + 3;
			const arr = [];
			for (let j = 0; j < n; j++) {
				arr.push({
					ox: (Math.random() - 0.5) * 0.8,
					oy: (Math.random() - 0.5) * 0.5,
					r: Math.random() * 0.4 + 0.3
				});
			}
			return arr;
		})()
	};
}

function drawClouds(brightness) {
	for (let i = 0; i < clouds.length; i++) {
		const c = clouds[i];
		c.x += c.speed;
		if (c.x > w + c.width) { c.x = -c.width - 50; c.y = Math.random() * h * 0.35 + h * 0.05; }

		const lum = Math.round(200 * brightness + 55);
		ctx.fillStyle = `rgb(${lum}, ${lum}, ${lum})`;

		for (let j = 0; j < c.puffs.length; j++) {
			const p = c.puffs[j];
			ctx.globalAlpha = c.opacity * brightness;
			ctx.beginPath();
			ctx.ellipse(
				c.x + p.ox * c.width,
				c.y + p.oy * c.height,
				c.width * p.r * 0.5,
				c.height * p.r,
				0, 0, TAU
			);
			ctx.fill();
		}
	}
}

// ── Mountains ──
function initMountains() {
	mountains = [];
	for (let layer = 0; layer < MOUNTAIN_LAYERS; layer++) {
		const pts = [];
		const segments = 20 + layer * 5;
		const baseY = h - (h * TERRAIN_HEIGHT) * (1 - layer / MOUNTAIN_LAYERS * 0.6);
		const amplitude = h * TERRAIN_HEIGHT * (0.5 - layer * 0.12);

		pts.push({ x: -10, y: h + 10 });
		for (let i = 0; i <= segments; i++) {
			const x = (i / segments) * (w + 20) - 10;
			const noise = Math.sin(i * 0.8 + layer * 3) * 0.5
				+ Math.sin(i * 1.7 + layer * 7) * 0.3
				+ Math.sin(i * 3.1 + layer * 11) * 0.2;
			const y = baseY - amplitude * (noise * 0.5 + 0.5);
			pts.push({ x, y });
		}
		pts.push({ x: w + 10, y: h + 10 });

		mountains.push(pts);
	}
}

function drawMountains(skyColor) {
	for (let layer = 0; layer < mountains.length; layer++) {
		const pts = mountains[layer];
		const darkness = 0.3 + layer * 0.25;
		const r = Math.round(skyColor.botR * (1 - darkness));
		const g = Math.round(skyColor.botG * (1 - darkness));
		const b = Math.round(skyColor.botB * (1 - darkness));
		ctx.globalAlpha = 1;
		ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
		ctx.beginPath();
		ctx.moveTo(pts[0].x, pts[0].y);
		for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
		ctx.closePath();
		ctx.fill();
	}
}

// ── Sun / Moon ──
function drawCelestialBody(hour, skyColor) {
	// Sun visible ~6am–7pm, Moon visible ~7pm–6am
	const sunAngle = ((hour - 6) / 13) * Math.PI; // 6am=0, 7pm=π
	const moonAngle = ((hour < 7 ? hour + 24 : hour) - 19) / 11 * Math.PI; // 7pm=0, 6am=π

	const horizonY = h * (1 - TERRAIN_HEIGHT * 0.6);

	// Sun
	if (hour >= 5.5 && hour <= 19.5) {
		const t = Math.max(0, Math.min(1, (hour - 5.5) / 1)); // fade in
		const t2 = Math.max(0, Math.min(1, (19.5 - hour) / 1)); // fade out
		const vis = Math.min(t, t2);
		const sx = w * 0.1 + (w * 0.8) * (sunAngle / Math.PI);
		const sy = horizonY - Math.sin(sunAngle) * h * 0.45;

		// Glow
		ctx.globalAlpha = vis * 0.15;
		const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, SUN_MOON_RADIUS * 6);
		glow.addColorStop(0, 'rgba(255, 220, 100, 0.8)');
		glow.addColorStop(1, 'rgba(255, 220, 100, 0)');
		ctx.fillStyle = glow;
		ctx.beginPath();
		ctx.arc(sx, sy, SUN_MOON_RADIUS * 6, 0, TAU);
		ctx.fill();

		// Disc
		ctx.globalAlpha = vis * 0.9;
		ctx.fillStyle = '#ffe082';
		ctx.beginPath();
		ctx.arc(sx, sy, SUN_MOON_RADIUS, 0, TAU);
		ctx.fill();
	}

	// Moon
	if (hour >= 19 || hour <= 7) {
		const adjustedHour = hour < 7 ? hour + 24 : hour;
		const t = Math.max(0, Math.min(1, (adjustedHour - 19) / 1.5));
		const t2 = Math.max(0, Math.min(1, (31 - adjustedHour) / 1.5));
		const vis = Math.min(t, t2);
		const mx = w * 0.1 + (w * 0.8) * (moonAngle / Math.PI);
		const my = horizonY - Math.sin(moonAngle) * h * 0.4;

		// Glow
		ctx.globalAlpha = vis * 0.08;
		const glow = ctx.createRadialGradient(mx, my, 0, mx, my, SUN_MOON_RADIUS * 5);
		glow.addColorStop(0, 'rgba(200, 220, 255, 0.6)');
		glow.addColorStop(1, 'rgba(200, 220, 255, 0)');
		ctx.fillStyle = glow;
		ctx.beginPath();
		ctx.arc(mx, my, SUN_MOON_RADIUS * 5, 0, TAU);
		ctx.fill();

		// Disc
		ctx.globalAlpha = vis * 0.85;
		ctx.fillStyle = '#d4dff0';
		ctx.beginPath();
		ctx.arc(mx, my, SUN_MOON_RADIUS * 0.85, 0, TAU);
		ctx.fill();

		// Crescent shadow
		ctx.globalAlpha = vis * 0.85;
		ctx.fillStyle = `rgb(${skyColor.topR}, ${skyColor.topG}, ${skyColor.topB})`;
		ctx.beginPath();
		ctx.arc(mx + SUN_MOON_RADIUS * 0.35, my - SUN_MOON_RADIUS * 0.1,
			SUN_MOON_RADIUS * 0.7, 0, TAU);
		ctx.fill();
	}
}

// ── Main render ──
function animate() {
	if (!ctx) return;

	const now = new Date();
	const hour = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
	const timeSec = performance.now() / 1000;

	// Sky gradient
	const sky = lerpColor(SKY_STOPS, hour);
	const grad = ctx.createLinearGradient(0, 0, 0, h * 0.7);
	grad.addColorStop(0, `rgb(${sky.topR}, ${sky.topG}, ${sky.topB})`);
	grad.addColorStop(1, `rgb(${sky.botR}, ${sky.botG}, ${sky.botB})`);
	ctx.globalAlpha = 1;
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, w, h);

	// Fill below horizon with darkest mountain color
	const darkness = 0.3 + (MOUNTAIN_LAYERS - 1) * 0.25;
	ctx.fillStyle = `rgb(${Math.round(sky.botR * (1 - darkness))}, ${Math.round(sky.botG * (1 - darkness))}, ${Math.round(sky.botB * (1 - darkness))})`;
	ctx.fillRect(0, h * (1 - TERRAIN_HEIGHT * 0.4), w, h * TERRAIN_HEIGHT * 0.4);

	// Night alpha (for stars and shooting stars)
	let nightAlpha = 0;
	if (hour < 5) nightAlpha = 1;
	else if (hour < 7) nightAlpha = (7 - hour) / 2;
	else if (hour > 20) nightAlpha = (hour - 20) / 1.5;
	else if (hour > 19) nightAlpha = (hour - 19) * 0.3;
	nightAlpha = Math.max(0, Math.min(1, nightAlpha));

	// Stars
	drawStars(nightAlpha, timeSec);

	// Shooting stars
	if (nightAlpha > 0.3 && Math.random() < SHOOTING_STAR_CHANCE) spawnShootingStar();
	updateAndDrawShootingStars(nightAlpha);

	// Sun / Moon
	drawCelestialBody(hour, sky);

	// Clouds
	const cloudBrightness = Math.max(0.15, Math.min(1, 1 - nightAlpha * 0.7));
	drawClouds(cloudBrightness);

	// Mountains (foreground)
	drawMountains(sky);

	// Time label
	if (SHOW_TIME_LABEL) {
		ctx.globalAlpha = 0.2;
		ctx.fillStyle = 'white';
		ctx.font = TIME_LABEL_FONT;
		ctx.textAlign = 'right';
		ctx.textBaseline = 'bottom';
		const h12 = now.getHours() % 12 || 12;
		const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
		const pad = (n) => n < 10 ? '0' + n : '' + n;
		ctx.fillText(
			h12 + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()) + ' ' + ampm,
			w - 14, h - 12
		);
		ctx.globalAlpha = 1;
	}

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
			initStars();
			initClouds();
			initMountains();
			animate();
			break;

		case 'resize':
			w = e.data.width;
			h = e.data.height;
			canvas.width = w;
			canvas.height = h;
			initStars();
			initClouds();
			initMountains();
			break;
	}
};
