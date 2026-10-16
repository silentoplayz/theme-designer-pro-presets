/**
 * Title: Ocean Waves
 * Description: Layered translucent swells in your theme's colors roll across the lower screen with lit crests, rising bubbles and drifting caustic light, thin behind the chat and lift under the cursor.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const TIME_SCALE      = 1;     // wave speed; 0.5 is languid, 2 is choppy, 0 holds still (0-3)
const REDUCED_SPEED   = 0.2;   // share of the speed kept when the viewer asks to reduce motion (0-1)
const NUM_LAYERS      = 5;     // wave layers, back to front (1-10)
const LAYER_TOP       = 0.6;   // height of the deepest layer, as a share of the screen (0.1-0.8)
const LAYER_SPAN      = 0.3;   // vertical spread of the layers, as a share of the screen (0.1-0.8)
const AMPLITUDE_BACK  = 15;    // wave height of the deepest layer, in px (0-60)
const AMPLITUDE_FRONT = 40;    // wave height of the nearest layer, in px (0-100)
const WAVE_LENGTH     = 1;     // length of the swells; higher is longer (0.4-3)
const OPACITY         = 1;     // strength of the water (0.2-2)
const CREST_WIDTH     = 1.5;   // thickness of the lit crest line, in px; 0 turns it off (0-4)
const CENTER_CALM     = 0.7;   // how much the water thins behind the chat column (0-1)
const BAND_WIDTH      = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const MOUSE_SWELL     = 40;    // height of the swell under the cursor, in px; 0 turns it off (0-100)
const MOUSE_RADIUS    = 250;   // reach of the swell, in px (80-500)
const BUBBLES         = 30;    // rising foam bubbles; 0 turns them off (0-120)
const CAUSTICS        = 6;     // drifting patches of caustic light; 0 turns them off (0-12)
const WAVE_STEP       = 4;     // px between wave samples; raise to lighten the load (2-12)
const FOLLOW_THEME    = true;  // take the colors from the theme's palette
const HUE_DEEP        = 200;   // hue of the deepest layer when not following the theme (0-360)
const HUE_SHALLOW     = 220;   // hue of the nearest layer when not following the theme (0-360)
/* ──────────────────────────────────────────── */

const TAU = Math.PI * 2;
const STEP = Math.max(2, WAVE_STEP);
const L = Math.max(1, Math.min(10, Math.round(NUM_LAYERS)));
const NB = Math.max(0, Math.min(120, Math.round(BUBBLES)));
const NC = Math.max(0, Math.min(12, Math.round(CAUSTICS)));

let canvas, ctx;
let w = 0, h = 0, dpr = 1;
let last = 0, time = 0, reduced = false, dark = true, theme = null, column = null;
const mouse = { x: -10000, y: -10000, amount: 0, target: 0 };

// Per-layer wave traits
const yBase = new Float32Array(L), amp = new Float32Array(L), freq = new Float32Array(L);
const speed = new Float32Array(L), phase = new Float32Array(L), depth = new Float32Array(L);
let pts = new Float32Array(2);
const fills = [], crests = [];
let calmMask = null;
// Bubbles
const bx = new Float32Array(NB), by = new Float32Array(NB), br = new Float32Array(NB);
const bvx = new Float32Array(NB), bvy = new Float32Array(NB), bop = new Float32Array(NB);
const blife = new Float32Array(NB), bdecay = new Float32Array(NB);
let bubbleSprite = null, causticSprite = null;

for (let i = 0; i < L; i++) phase[i] = Math.random() * TAU;

function lerp(a, b, t) { return a + (b - a) * t; }

function hexToRgb(hex) {
	const n = parseInt(String(hex).slice(1, 7), 16) || 0;
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, t) {
	return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];
}

function hsl(hue, s, l) {
	s /= 100; l /= 100;
	const k = (n) => (n + hue / 30) % 12;
	const a = s * Math.min(l, 1 - l);
	const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
	return [f(0), f(8), f(4)];
}

function rgba(c, a) {
	return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + Math.max(0, a).toFixed(3) + ')';
}

// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }

function band(x) {
	const d = Math.abs(x - colX()) / colHalf();
	const s = Math.min(1, Math.max(0, (d - 0.35) / 1.0)); // a wide, slow falloff, so the water has no visible seam
	return 1 - s * s * (3 - 2 * s);
}

function sprite(c) {
	const s = new OffscreenCanvas(128, 128);
	const g = s.getContext('2d');
	const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
	for (let k = 0; k <= 8; k++) grad.addColorStop(k / 8, rgba(c, Math.exp(-k * k / 14) * (1 - k / 8)));
	g.fillStyle = grad;
	g.fillRect(0, 0, 128, 128);
	return s;
}

// Colors, cached gradients and sprites; rebuilt on theme change, resize and layout only
function build() {
	if (!ctx || !w) return;
	const c = FOLLOW_THEME && theme && theme.colors ? theme.colors : null;
	let back, front, crestTint, foam, glow;
	if (c) {
		const a = hexToRgb(c.accent), a3 = hexToRgb(c.accent3), bg = hexToRgb(c.background), tx = hexToRgb(c.text);
		back = dark ? mix(a3, bg, 0.45) : mix(a3, bg, 0.2);
		front = dark ? mix(a, a3, 0.3) : a;
		crestTint = dark ? tx : mix(a, tx, 0.35);
		foam = dark ? mix(a3, tx, 0.5) : a3;
		glow = dark ? mix(a3, tx, 0.3) : [255, 255, 255];
	} else {
		back = hsl(HUE_DEEP, 70, dark ? 15 : 40);
		front = hsl(HUE_SHALLOW, 70, dark ? 35 : 45);
		crestTint = dark ? hsl(HUE_SHALLOW - 10, 60, 70) : hsl(HUE_SHALLOW, 70, 30);
		foam = [150, 200, 220];
		glow = dark ? [120, 200, 220] : [255, 255, 255];
	}
	const a0 = (dark ? 0.08 : 0.05) * OPACITY, a1 = (dark ? 0.2 : 0.13) * OPACITY;
	for (let i = 0; i < L; i++) {
		const t = depth[i];
		const col = mix(back, front, t);
		const alpha = lerp(a0, a1, t);
		const crest = mix(col, crestTint, dark ? 0.4 : 0.5);
		const crestA = alpha * (dark ? 0.6 : 1.4) * 1.5;
		fills[i] = rgba(col, alpha);
		crests[i] = rgba(crest, Math.min(1, crestA));
	}
	// One mask thins everything behind the chat in a single pass, which bands far less than per-layer gradients
	calmMask = ctx.createLinearGradient(0, 0, w, 0);
	for (let s = 0; s <= 48; s++) calmMask.addColorStop(s / 48, 'rgba(0,0,0,' + (CENTER_CALM * band((s / 48) * w)).toFixed(3) + ')');
	bubbleSprite = sprite(foam);
	causticSprite = sprite(glow);
}

function resetBubble(i) {
	bx[i] = Math.random() * w;
	by[i] = h * (0.35 + Math.random() * 0.6);
	br[i] = 0.5 + Math.random() * 1.5;
	bop[i] = (0.03 + Math.random() * 0.06) * (dark ? 2.5 : 2);
	bvx[i] = (Math.random() - 0.5) * 18;
	bvy[i] = -(6 + Math.random() * 18);
	blife[i] = 1;
	bdecay[i] = 0.06 + Math.random() * 0.18;
}

function size(nw, nh, ndpr) {
	w = nw;
	h = nh;
	dpr = Math.min(2, ndpr || 1);
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.lineJoin = 'round';
	pts = new Float32Array(Math.ceil(w / STEP) + 2);
	for (let i = 0; i < L; i++) {
		const t = L > 1 ? i / (L - 1) : 0;
		depth[i] = t;
		yBase[i] = h * (LAYER_TOP + t * LAYER_SPAN);
		amp[i] = lerp(AMPLITUDE_BACK, AMPLITUDE_FRONT, t);
		freq[i] = lerp(0.007, 0.003, t) / WAVE_LENGTH;
		speed[i] = lerp(0.02, 0.008, t);
	}
	for (let i = 0; i < NB; i++) { resetBubble(i); blife[i] = Math.random(); }
	build();
}

function drawLayer(i, t) {
	const f = freq[i], a = amp[i], sp = speed[i], ph = phase[i], yb = yBase[i];
	const swell = MOUSE_SWELL * mouse.amount * (1 - depth[i] * 0.5) * (reduced ? 0.4 : 1);
	const dy = yb - mouse.y;
	const near = swell > 0.5 && Math.abs(dy) < MOUSE_RADIUS;
	const r2 = MOUSE_RADIUS * MOUSE_RADIUS;
	let n = 0;
	// Sample once into a reused buffer: the fill and the crest trace the same curve
	for (let x = 0; x <= w + STEP; x += STEP) {
		let y = yb + Math.sin(x * f + t * sp + ph) * a
			+ Math.sin(x * f * 2.3 + t * sp * 1.5 + ph * 2) * a * 0.3
			+ Math.sin(x * f * 4.7 + t * sp * 0.7) * a * 0.08;
		if (near) {
			const dx = x - mouse.x, d2 = dx * dx + dy * dy;
			if (d2 < r2) { const s = 1 - Math.sqrt(d2) / MOUSE_RADIUS; y -= s * s * swell; }
		}
		pts[n++] = y;
	}
	ctx.beginPath();
	ctx.moveTo(0, h);
	for (let k = 0; k < n; k++) ctx.lineTo(k * STEP, pts[k]);
	ctx.lineTo((n - 1) * STEP, h);
	ctx.closePath();
	ctx.fillStyle = fills[i];
	ctx.fill();
	if (CREST_WIDTH <= 0) return;
	ctx.beginPath();
	ctx.moveTo(0, pts[0]);
	for (let k = 1; k < n; k++) ctx.lineTo(k * STEP, pts[k]);
	ctx.strokeStyle = crests[i];
	ctx.lineWidth = CREST_WIDTH;
	ctx.stroke();
}

function frame(now) {
	requestAnimationFrame(frame);
	if (!ctx || !bubbleSprite) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const pace = TIME_SCALE * (reduced ? REDUCED_SPEED : 1);
	time += dt * 60 * pace; // one unit is one frame at 60 fps, which the wave constants expect
	mouse.target = Math.max(0, mouse.target - dt * 0.6);
	mouse.amount += (mouse.target - mouse.amount) * Math.min(1, dt * 2.5);

	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'source-over';
	ctx.clearRect(0, 0, w, h);
	for (let i = 0; i < L; i++) drawLayer(i, time);

	ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
	for (let i = 0; i < NB; i++) {
		bx[i] += bvx[i] * dt * pace;
		by[i] += bvy[i] * dt * pace;
		blife[i] -= bdecay[i] * dt * pace;
		if (blife[i] <= 0 || by[i] < h * 0.2) resetBubble(i);
		const a = bop[i] * blife[i] * Math.min(1, (1 - blife[i]) * 8);
		if (a < 0.003) continue;
		const s = br[i] * 4;
		ctx.globalAlpha = Math.min(1, a * 3);
		ctx.drawImage(bubbleSprite, bx[i] - s * 0.5, by[i] - s * 0.5, s, s);
	}

	for (let i = 0; i < NC; i++) {
		const cx = w * (0.08 + 0.84 * ((i + 0.5) / NC)) + Math.sin(time * 0.003 + i * 1.5) * 80;
		const cy = h * (LAYER_TOP + LAYER_SPAN * 0.35) + Math.cos(time * 0.004 + i * 2.1) * 60;
		const r = 60 + Math.sin(time * 0.005 + i) * 20;
		const a = (0.015 + 0.01 * Math.sin(time * 0.006 + i * 3)) * (dark ? 3 : 8);
		if (a <= 0.002) continue;
		ctx.globalAlpha = Math.min(1, a);
		ctx.drawImage(causticSprite, cx - r, cy - r, r * 2, r * 2);
	}
	ctx.globalAlpha = 1;
	if (CENTER_CALM > 0) {
		ctx.globalCompositeOperation = 'destination-out';
		ctx.fillStyle = calmMask;
		ctx.fillRect(0, 0, w, h);
	}
	ctx.globalCompositeOperation = 'source-over';
}

self.onmessage = (e) => {
	const d = e.data;
	switch (d.type) {
		case 'init':
			canvas = d.canvas;
			ctx = canvas.getContext('2d');
			reduced = !!d.reducedMotion;
			column = d.column || null;
			theme = d.theme || null;
			dark = !theme || theme.dark !== false;
			size(d.width, d.height, d.dpr);
			requestAnimationFrame(frame);
			break;
		case 'resize':
			if (ctx) size(d.width, d.height, d.dpr);
			break;
		case 'theme':
			theme = d;
			dark = d.dark !== false;
			build();
			break;
		case 'motion':
			reduced = !!d.reducedMotion;
			break;
		case 'layout':
			column = d.column || null;
			build();
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.target = 1;
			break;
	}
};
