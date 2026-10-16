/**
 * Title: Retro Sun
 * Description: A synthwave sun with scrolling stripe cutouts sets low in an outer third over a perspective grid that rolls toward you, under calm twinkling stars; the glow swells when the cursor comes near.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const SUN_X         = 0.8;   // where the sun sits, as a share of the width (0-1)
const SUN_SIZE      = 0.16;  // sun radius as a share of the smaller screen side (0.06-0.3)
const HORIZON       = 0.8;   // height of the horizon, as a share of the screen (0.6-0.9)
const STRIPES       = 7;     // stripe cutouts across the sun's lower half (0-14)
const STRIPE_SPEED  = 6;     // how fast the stripes drift down, in px per second (0-30)
const GRID_SPEED    = 0.35;  // how fast the grid rolls toward you (0-2)
const GRID_LINES    = 22;    // vertical grid lines (6-40)
const STAR_COUNT    = 110;   // stars in the sky (0-300)
const GLOW          = 1;     // strength of the sun's glow and the horizon haze (0-2)
const PULSE_SPEED   = 0.5;   // speed of the glow's slow breathing (0-3)
const CURSOR_GLOW   = 1;     // how much the glow swells near the cursor (0-2)
const REDUCED_SPEED = 0.15;  // share of the motion kept under reduced motion (0-1)
const CENTER_CALM   = 0.8;   // how much the grid and stars fade behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const FOLLOW_THEME  = true;  // take the colors from the theme's accents
const SUN_TOP       = '#ff6ec7';  // sun's upper color when not following the theme
const SUN_BOTTOM    = '#ffb347';  // sun's lower color
const GRID_COLOR    = '#b45cff';  // grid and horizon
/* ──────────────────────────────────────────── */

const MAX_STARS = 300, TAU = Math.PI * 2;

let canvas, ctx, w = 0, h = 0, dpr = 1, last = 0, reduced = false, dark = true, column = null;
let top = hex(SUN_TOP), bottom = hex(SUN_BOTTOM), grid = hex(GRID_COLOR), star = [255, 255, 255];
let sunBody, sunCut, sunG, glowSprite, hazeSprite, gridStyle, horizonStyle, starStyle;
let sunR = 100, sunX = 0, horizonY = 0, stripePhase = 0, gridPhase = 0, pulseT = 0;
const sx = new Float32Array(MAX_STARS), sy = new Float32Array(MAX_STARS), ss = new Float32Array(MAX_STARS);
const sp = new Float32Array(MAX_STARS), sph = new Float32Array(MAX_STARS), sa = new Float32Array(MAX_STARS);
let stars = 0;
const mouse = { x: -10000, y: -10000, amount: 0, boost: 0 };

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
function calm(x) { return 1 - CENTER_CALM * band(x); }

function applyTheme(t) {
	if (!t) return;
	dark = t.dark !== false;
	if (FOLLOW_THEME && t.colors) {
		top = hex(t.colors.accent2);
		bottom = mix(hex(t.colors.accent), hex(t.colors.accent2), 0.2);
		grid = hex(t.colors.accent3);
		star = dark ? mix(hex(t.colors.text), [255, 255, 255], 0.5) : hex(t.colors.muted);
	} else star = dark ? [255, 255, 255] : [90, 90, 120];
	if (w) build();
}

// A soft radial sprite in one color
function sprite(size, col, a0, a1) {
	const c = new OffscreenCanvas(size, size), g = c.getContext('2d'), r = size / 2;
	const grad = g.createRadialGradient(r, r, 0, r, r, r);
	grad.addColorStop(0, rgba(col, a0));
	grad.addColorStop(0.4, rgba(col, a1));
	grad.addColorStop(1, rgba(col, 0));
	g.fillStyle = grad;
	g.fillRect(0, 0, size, size);
	return c;
}

// A horizontal gradient that fades a stroke over the chat column
function columnFade(col, a) {
	const g = ctx.createLinearGradient(0, 0, w, 0), k = 1 - CENTER_CALM, c = colX() / w, b = colHalf() / w;
	const at = (u) => Math.min(1, Math.max(0, u));
	g.addColorStop(0, rgba(col, a));
	g.addColorStop(at(c - b * 1.25), rgba(col, a));
	g.addColorStop(at(c - b * 0.55), rgba(col, a * k));
	g.addColorStop(at(c + b * 0.55), rgba(col, a * k));
	g.addColorStop(at(c + b * 1.25), rgba(col, a));
	g.addColorStop(1, rgba(col, a));
	return g;
}

// Caches rebuilt on resize, layout and theme change: the sun body, its glow and the grid styles
function build() {
	sunR = Math.max(40, Math.min(w, h) * SUN_SIZE);
	horizonY = Math.round(h * HORIZON);
	// The sun sits just past the calm band on its preferred side, or the other side when that one has no room, inside the chat area
	const L = column ? column.left : 0, R = column ? column.right : w, pref = L + (R - L) * SUN_X;
	// Too big for either margin, it shrinks to fit the wider one rather than sitting on the column
	if (column) {
		const room = Math.max(colX() - colHalf() - L, R - colX() - colHalf());
		sunR = Math.max(24, Math.min(sunR, room / 2.4));
	}
	const lo = L + sunR * 1.1, hi = R - sunR * 1.1, off = colHalf() + sunR * 0.2;
	const right = Math.max(pref, colX() + off), left = Math.min(pref, colX() - off);
	const first = SUN_X > 0.5 ? right : left, other = SUN_X > 0.5 ? left : right;
	sunX = Math.abs(SUN_X - 0.5) <= 0.05 ? pref : first >= lo && first <= hi ? first : other >= lo && other <= hi ? other : first;
	sunX = Math.max(lo, Math.min(hi, sunX));
	const s = Math.ceil(sunR * 2 * dpr) + 4;
	sunBody = new OffscreenCanvas(s, s);
	const g = sunBody.getContext('2d');
	g.setTransform(dpr, 0, 0, dpr, 2, 2);
	const grad = g.createLinearGradient(0, 0, 0, sunR * 2);
	grad.addColorStop(0, rgba(mix(top, [255, 255, 255], dark ? 0.15 : 0), 1));
	grad.addColorStop(0.55, rgba(mix(top, bottom, 0.6), 1));
	grad.addColorStop(1, rgba(bottom, 1));
	g.fillStyle = grad;
	g.beginPath();
	g.arc(sunR, sunR, sunR, 0, TAU);
	g.fill();
	sunCut = new OffscreenCanvas(s, s);
	sunG = sunCut.getContext('2d');
	const a = dark ? 1 : 0.4;
	glowSprite = sprite(256, mix(top, bottom, 0.4), 0.7 * a, 0.22 * a);
	hazeSprite = sprite(256, top, 0.55 * a, 0.22 * a);
	gridStyle = columnFade(grid, dark ? 0.55 : 0.45);
	horizonStyle = columnFade(mix(top, grid, 0.3), dark ? 0.85 : 0.7);
	starStyle = rgba(star, 1);
}

function size() {
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	build();
	stars = Math.min(MAX_STARS, Math.round(STAR_COUNT * Math.max(0.5, w * h / (1440 * 900))));
	for (let i = 0; i < stars; i++) {
		sx[i] = Math.random() * w;
		sy[i] = Math.pow(Math.random(), 1.2) * horizonY * 0.92;
		ss[i] = Math.random() < 0.15 ? 2 : 1;
		sp[i] = 0.5 + Math.random() * 1.5;
		sph[i] = Math.random() * TAU;
		sa[i] = (0.35 + Math.random() * 0.65) * calm(sx[i]);
	}
}

function frame(now) {
	requestAnimationFrame(frame);
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	if (!w || !h) return;
	const motion = reduced ? REDUCED_SPEED : 1;
	stripePhase = (stripePhase + STRIPE_SPEED * motion * dt) % 1000;
	gridPhase = (gridPhase + GRID_SPEED * motion * dt) % 1;
	pulseT = (pulseT + PULSE_SPEED * motion * dt) % 1000;
	ctx.clearRect(0, 0, w, h);
	ctx.globalCompositeOperation = 'source-over';

	// Stars, dimmer near the horizon and behind the column
	ctx.fillStyle = starStyle;
	const starA = dark ? 0.8 : 0.35;
	for (let i = 0; i < stars; i++) {
		const tw = 0.45 + 0.55 * Math.abs(Math.sin(now / 1000 * sp[i] * (reduced ? 0.25 : 1) + sph[i]));
		ctx.globalAlpha = starA * sa[i] * tw * (1 - sy[i] / horizonY * 0.7);
		ctx.fillRect(sx[i], sy[i], ss[i], ss[i]);
	}

	// Glow and haze, swelling a little when the cursor lingers near the sun
	mouse.amount = Math.max(0, mouse.amount - dt * 0.5);
	const dx = mouse.x - sunX, dy = mouse.y - horizonY;
	const near = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / (sunR * 3)) * mouse.amount * CURSOR_GLOW;
	mouse.boost += (near - mouse.boost) * Math.min(1, dt * 2);
	const pulse = 0.85 + 0.15 * Math.sin(pulseT * TAU / 4);
	ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
	ctx.globalAlpha = Math.min(1, GLOW * pulse * 0.7 + mouse.boost * 0.35);
	const gr = sunR * 3.6;
	ctx.drawImage(glowSprite, sunX - gr, horizonY - sunR * 0.4 - gr, gr * 2, gr * 2);
	ctx.globalAlpha = Math.min(1, GLOW * 0.55);
	ctx.drawImage(hazeSprite, sunX - w * 0.25, horizonY - h * 0.08, w * 0.5, h * 0.16);
	ctx.globalCompositeOperation = 'source-over';

	// Sun: the cached body, with stripes cut out of its lower half each frame
	const s = sunCut.width;
	sunG.setTransform(1, 0, 0, 1, 0, 0);
	sunG.globalCompositeOperation = 'source-over';
	sunG.clearRect(0, 0, s, s);
	sunG.drawImage(sunBody, 0, 0);
	if (STRIPES > 0) {
		sunG.globalCompositeOperation = 'destination-out';
		sunG.fillStyle = '#000';
		const gap = sunR * 0.8 / STRIPES;
		for (let k = -1; k < STRIPES; k++) {
			const y = sunR * 0.6 + k * gap + (stripePhase % gap);
			const t = (y - sunR * 0.55) / (sunR * 0.8);
			if (t <= 0) continue;
			const thick = gap * (0.1 + 0.5 * t);
			sunG.fillRect(0, (y - thick / 2) * dpr + 2, s, thick * dpr);
		}
	}
	const lift = sunR * 0.35;
	ctx.save();
	ctx.beginPath();
	ctx.rect(sunX - sunR - 2, horizonY - sunR * 2, sunR * 2 + 4, sunR * 2);
	ctx.clip();
	ctx.globalAlpha = dark ? 0.95 : 0.8;
	ctx.drawImage(sunCut, sunX - sunR - 2 / dpr, horizonY - sunR - lift - 2 / dpr, s / dpr, s / dpr);
	ctx.restore();

	// Horizon line
	ctx.globalAlpha = 1;
	ctx.strokeStyle = horizonStyle;
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	ctx.moveTo(0, horizonY);
	ctx.lineTo(w, horizonY);
	ctx.stroke();

	// Grid: lines from a vanishing point under the sun, rows rolling toward the viewer
	const depth = h - horizonY;
	ctx.strokeStyle = gridStyle;
	ctx.lineWidth = 1;
	ctx.globalAlpha = 0.8;
	ctx.beginPath();
	const spread = w * 2.4;
	for (let i = 0; i <= GRID_LINES; i++) {
		const bx = sunX + (i / GRID_LINES - 0.5) * spread;
		ctx.moveTo(sunX + (bx - sunX) * 0.04, horizonY);
		ctx.lineTo(bx, h);
	}
	ctx.stroke();
	for (let r = 0; r < 12; r++) {
		const z = (r + 1 - gridPhase) / 12;
		const y = horizonY + depth * z * z;
		ctx.globalAlpha = Math.min(1, z * 1.6) * 0.85;
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(w, y);
		ctx.stroke();
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
			column = d.column || null;
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
		case 'layout':
			column = d.column || null;
			if (canvas) size();
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.amount = 1;
			break;
	}
};
