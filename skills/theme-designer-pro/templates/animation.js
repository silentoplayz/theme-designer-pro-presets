/**
 * Title: Drifting Motes
 * Description: Soft glowing motes in your theme's accents rise through the margins beside the chat, sway on a slow breeze and part around a moving cursor.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const MOTE_COUNT   = 170;       // motes on screen (20-400)
const MOTE_SIZE    = 3.5;       // core radius in px (1-8)
const GLOW_SIZE    = 6;         // glow radius as a multiple of the core (2-10)
const SPEED        = 16;        // rise speed in px per second (2-80)
const SWAY         = 14;        // sideways sway in px (0-60)
const TWINKLE      = 0.5;       // how much each mote pulses (0-1)
const INTENSITY    = 0.9;       // overall brightness (0-1)
const CENTER_CALM  = 0.85;      // how much motes fade behind the chat column (0-1)
const BAND_WIDTH   = 520;       // half-width of the calm band without a chat column, in px (200-900)
const MOUSE_RADIUS = 140;       // how far the cursor pushes motes aside, in px (0-400)
const FOLLOW_THEME = true;      // take the colors from the theme
const COLOR_A      = '#7aa2ff'; // first color when not following the theme
const COLOR_B      = '#c792ea'; // second color when not following the theme
const COLOR_C      = '#89ddff'; // third color when not following the theme
/* ──────────────────────────────────────────── */

let canvas = null, ctx = null, w = 1, h = 1;
let column = null, reduced = false, dark = true;
let palette = [COLOR_A, COLOR_B, COLOR_C];
let sprites = [], spriteSize = 1;
let mouseX = -10000, mouseY = -10000, mouseAmount = 0;
let last = 0, running = false;

// The motes, in typed arrays: position, speed factor, color and phase
const px = new Float32Array(MOTE_COUNT), py = new Float32Array(MOTE_COUNT);
const ps = new Float32Array(MOTE_COUNT), ph = new Float32Array(MOTE_COUNT);
const pc = new Uint8Array(MOTE_COUNT);

// The chat column: its center and the half-width of the calm band around it
function colX() { return column ? column.x : w / 2; }
function colHalf() { return column ? column.width / 2 + 56 : BAND_WIDTH; }
// 1 in the margins, 1 - CENTER_CALM over the column, smooth in between
function band(x) {
	const d = Math.abs(x - colX()) / colHalf();
	const s = Math.min(1, Math.max(0, (d - 0.85) / 0.5));
	return 1 - CENTER_CALM * (1 - s * s * (3 - 2 * s));
}

function rgba(hex, a) {
	const n = parseInt(hex.slice(1), 16);
	return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}

// One small glow per color, rebuilt only when the colors change
function buildSprites() {
	const r = MOTE_SIZE * GLOW_SIZE;
	spriteSize = Math.ceil(r * 2);
	sprites = palette.map(function (color) {
		const s = new OffscreenCanvas(spriteSize, spriteSize), g = s.getContext('2d');
		const grad = g.createRadialGradient(r, r, 0, r, r, r);
		grad.addColorStop(0, rgba(color, 1));
		grad.addColorStop(MOTE_SIZE / r, rgba(color, dark ? 0.9 : 1));
		grad.addColorStop(Math.min(0.9, MOTE_SIZE / r * 2.4), rgba(color, dark ? 0.32 : 0.38));
		grad.addColorStop(1, rgba(color, 0));
		g.fillStyle = grad;
		g.fillRect(0, 0, spriteSize, spriteSize);
		return s;
	});
}

// A new mote, more often in the margins than over the column
function respawn(i, y) {
	let x = Math.random() * w;
	for (let tries = 0; tries < 4 && Math.random() > band(x); tries++) x = Math.random() * w;
	px[i] = x;
	py[i] = y;
	ps[i] = 0.6 + Math.random() * 0.8;
	ph[i] = Math.random() * Math.PI * 2;
	pc[i] = i % 3;
}

function resize(width, height) {
	const oldW = w, oldH = h;
	w = Math.max(1, width);
	h = Math.max(1, height);
	// Soft glows: a pixel ratio of 1 is plenty
	canvas.width = Math.round(w);
	canvas.height = Math.round(h);
	for (let i = 0; i < MOTE_COUNT; i++) { px[i] *= w / oldW; py[i] *= h / oldH; }
}

function applyTheme(t) {
	if (!t) return;
	dark = t.dark !== false;
	if (FOLLOW_THEME && t.colors) palette = [t.colors.accent, t.colors.accent2, t.colors.accent3];
	buildSprites();
}

function frame(now) {
	requestAnimationFrame(frame);
	// Frames are held while the page is hidden: clamp the step
	const dt = Math.min((now - last) / 1000, 0.1);
	last = now;
	const t = now / 1000;
	ctx.clearRect(0, 0, w, h);
	ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
	const speed = reduced ? SPEED * 0.15 : SPEED, sway = reduced ? SWAY * 0.3 : SWAY;
	const half = spriteSize / 2, reach = MOUSE_RADIUS * MOUSE_RADIUS;
	mouseAmount = Math.max(0, mouseAmount - dt * 1.2);
	for (let i = 0; i < MOTE_COUNT; i++) {
		py[i] -= speed * ps[i] * dt;
		if (py[i] < -spriteSize) respawn(i, h + spriteSize);
		const x = px[i] + Math.sin(t * 0.35 * ps[i] + ph[i]) * sway;
		if (mouseAmount > 0) {
			const dx = x - mouseX, dy = py[i] - mouseY, d2 = dx * dx + dy * dy;
			if (d2 < reach && d2 > 1) {
				const d = Math.sqrt(d2), push = (1 - d / MOUSE_RADIUS) * 70 * mouseAmount * dt;
				px[i] += dx / d * push;
				py[i] += dy / d * push;
			}
		}
		const pulse = 1 - TWINKLE * 0.5 * (1 + Math.sin(t * 1.6 * ps[i] + ph[i] * 3));
		ctx.globalAlpha = INTENSITY * (dark ? 1 : 0.85) * pulse * band(x);
		ctx.drawImage(sprites[pc[i]], x - half, py[i] - half);
	}
	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'source-over';
}

self.onmessage = function (e) {
	const d = e.data;
	switch (d.type) {
		case 'init':
			canvas = d.canvas;
			ctx = canvas.getContext('2d');
			column = d.column || null;
			reduced = !!d.reducedMotion;
			w = Math.max(1, d.width); h = Math.max(1, d.height);
			resize(d.width, d.height);
			for (let i = 0; i < MOTE_COUNT; i++) respawn(i, Math.random() * h);
			applyTheme(d.theme);
			if (!sprites.length) buildSprites();
			if (!running) { running = true; requestAnimationFrame(function (now) { last = now; frame(now); }); }
			break;
		case 'resize': if (ctx) resize(d.width, d.height); break;
		case 'theme': applyTheme(d); break;
		case 'motion': reduced = !!d.reducedMotion; break;
		case 'layout': column = d.column || null; break;
		case 'mousemove': mouseX = d.x; mouseY = d.y; mouseAmount = 1; break;
		// A tap parts the motes a little more; mousedown also fires on touch
		case 'mousedown': mouseX = d.x; mouseY = d.y; mouseAmount = 1.6; break;
	}
};
