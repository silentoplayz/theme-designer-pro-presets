/**
 * Title: Ocean Waves
 * Description: Layered horizontal wave patterns at different depths, creating an
 *   ocean surface viewed from below. Each layer rolls at its own speed and
 *   frequency, with a lit crest line tracing the swell. Foam bubbles drift up
 *   through the water column and soft caustic patches wander across the scene.
 *   Deep blues and teals with varying opacity.
 *
 *   Move your mouse to push a swell through the waves — nearer layers react
 *   more strongly. Fully autonomous otherwise; no interaction required.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
/* ── Motion ── */
const TIME_SCALE           = 1.0;      // global speed; 0.5 = languid, 2 = choppy
const NUM_LAYERS           = 5;        // wave layers, back to front (1–12 sensible)

/* ── Wave shape ── */
const LAYER_TOP            = 0.25;     // topmost layer's Y, as a fraction of height
const LAYER_SPAN           = 0.55;     // vertical spread of all layers (fraction of height)
const AMPLITUDE_BACK       = 15;       // wave height of the deepest layer, px
const AMPLITUDE_FRONT      = 40;       // wave height of the nearest layer, px
const FREQUENCY_BACK       = 0.007;    // wavelength of deep layers; higher = tighter
const FREQUENCY_FRONT      = 0.003;    // wavelength of near layers
const SPEED_BACK           = 0.020;    // scroll speed of deep layers
const SPEED_FRONT          = 0.008;    // scroll speed of near layers
const HARMONIC_FREQ_MULT   = 2.3;      // 2nd wave frequency, relative to primary
const HARMONIC_AMP_MULT    = 0.3;      // 2nd wave height, relative to primary
const HARMONIC_SPEED_MULT  = 1.5;      // 2nd wave speed, relative to primary
const RIPPLE_FREQ_MULT     = 4.7;      // fine surface chop frequency
const RIPPLE_AMP_MULT      = 0.08;     // fine surface chop height
const RIPPLE_SPEED_MULT    = 0.7;      // fine surface chop speed

/* ── Color (HSL — shift the hues for a sunset or arctic ocean) ── */
const HUE_DEEP             = 200;      // hue of the deepest layer
const HUE_SHALLOW          = 220;      // hue of the nearest layer
const SATURATION           = 70;       // wave saturation, %
const LIGHTNESS_DEEP       = 15;       // lightness of the deepest layer, %
const LIGHTNESS_SHALLOW    = 35;       // lightness of the nearest layer, %
const ALPHA_DEEP           = 0.08;     // opacity of the deepest layer
const ALPHA_SHALLOW        = 0.20;     // opacity of the nearest layer

/* ── Crest highlight ── */
const HIGHLIGHT_HUE_SHIFT  = -10;      // crest hue offset from its layer
const HIGHLIGHT_SATURATION = 60;       // crest saturation, %
const HIGHLIGHT_LIGHTNESS  = 15;       // crest lightness added to its layer, %
const HIGHLIGHT_ALPHA_MULT = 0.5;      // crest opacity, relative to its layer
const HIGHLIGHT_WIDTH      = 1.5;      // crest line thickness, px; 0 disables

/* ── Mouse swell ── */
const MOUSE_RADIUS         = 250;      // reach of the swell, px
const MOUSE_SWELL          = 40;       // swell height, px; 0 disables interaction
const MOUSE_DEPTH_FALLOFF  = 0.5;      // 0 = all layers react equally, 1 = front only

/* ── Foam bubbles ── */
const BUBBLE_COUNT         = 30;       // 0 disables bubbles
const BUBBLE_COLOR         = [150, 200, 220];  // RGB
const BUBBLE_RADIUS        = [0.5, 2.0];       // [min, max] px
const BUBBLE_OPACITY       = [0.03, 0.09];     // [min, max]
const BUBBLE_RISE          = [0.1, 0.4];       // [min, max] upward speed, px/frame
const BUBBLE_DRIFT         = 0.3;      // horizontal wander, px/frame
const BUBBLE_LIFETIME      = [0.001, 0.004];   // [min, max] fade rate per frame
const BUBBLE_BAND          = [0.2, 0.8];       // spawn band, as fractions of height

/* ── Caustic light patches ── */
const CAUSTIC_COUNT        = 6;        // 0 disables caustics
const CAUSTIC_COLOR        = [120, 200, 220];  // RGB
const CAUSTIC_Y            = 0.4;      // vertical center, as a fraction of height
const CAUSTIC_RADIUS       = 60;       // patch size, px
const CAUSTIC_RADIUS_VARY  = 20;       // how much the size breathes, px
const CAUSTIC_SWAY         = [80, 60]; // [horizontal, vertical] wander, px
const CAUSTIC_ALPHA        = 0.015;    // base brightness
const CAUSTIC_ALPHA_VARY   = 0.01;     // how much the brightness pulses
const CAUSTIC_DRIFT        = 1.0;      // caustic movement speed multiplier

/* ── Performance ── */
const WAVE_STEP            = 4;        // px between wave sample points; raise to lighten
/* ──────────────────────────────────────────── */

const TAU = Math.PI * 2;
// Every other knob degrades gracefully at 0; this one would spin the sample loop forever.
const STEP = Math.max(1, WAVE_STEP);

let canvas, ctx, width, height;
let mouse = { x: -9999, y: -9999 };
let time = 0;
let layers = [];
let bubbles = [];

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function lerp(a, b, t) { return a + (b - a) * t; }
function randIn(range) { return range[0] + Math.random() * (range[1] - range[0]); }

// ── Wave layers ──

class WaveLayer {
	constructor(index, total) {
		this.phase = Math.random() * TAU;
		this.recalc(index, total);
	}

	recalc(index, total) {
		// Sized for the widest the canvas can be between resizes, +1 for the x=0 point
		this.points = new Float64Array((Math.ceil(width / STEP) + 2) * 2);
		// t: 0 = deepest/back, 1 = shallowest/front
		const t = total > 1 ? index / (total - 1) : 0;
		this.depth = t;
		this.yBase = height * (LAYER_TOP + t * LAYER_SPAN);
		this.amplitude = lerp(AMPLITUDE_BACK, AMPLITUDE_FRONT, t);
		this.frequency = lerp(FREQUENCY_BACK, FREQUENCY_FRONT, t);
		this.speed = lerp(SPEED_BACK, SPEED_FRONT, t);
		this.secondaryFreq = this.frequency * HARMONIC_FREQ_MULT;
		this.secondaryAmp = this.amplitude * HARMONIC_AMP_MULT;

		const hue = lerp(HUE_DEEP, HUE_SHALLOW, t);
		const lightness = lerp(LIGHTNESS_DEEP, LIGHTNESS_SHALLOW, t);
		const alpha = lerp(ALPHA_DEEP, ALPHA_SHALLOW, t);
		this.color = `hsla(${hue}, ${SATURATION}%, ${lightness}%, ${alpha})`;
		this.highlightColor = `hsla(${hue + HIGHLIGHT_HUE_SHIFT}, ${HIGHLIGHT_SATURATION}%, ` +
			`${lightness + HIGHLIGHT_LIGHTNESS}%, ${alpha * HIGHLIGHT_ALPHA_MULT})`;
	}

	getY(x, t, mouseInfluence) {
		let y = this.yBase + Math.sin(x * this.frequency + t * this.speed + this.phase) * this.amplitude;
		y += Math.sin(x * this.secondaryFreq + t * this.speed * HARMONIC_SPEED_MULT + this.phase * 2) *
			this.secondaryAmp;
		y += Math.sin(x * this.frequency * RIPPLE_FREQ_MULT + t * this.speed * RIPPLE_SPEED_MULT) *
			this.amplitude * RIPPLE_AMP_MULT;
		return y + mouseInfluence;
	}

	getMouseInfluence(x) {
		if (MOUSE_SWELL === 0) return 0;
		const dx = x - mouse.x;
		const dy = this.yBase - mouse.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist >= MOUSE_RADIUS) return 0;
		const strength = 1 - dist / MOUSE_RADIUS;
		return -strength * strength * MOUSE_SWELL * (1 - this.depth * MOUSE_DEPTH_FALLOFF);
	}

	draw(ctx, t) {
		// Sample once into a reused buffer: the fill and the crest stroke trace the
		// same curve, and each sample costs several sin() plus a sqrt for the swell.
		const pts = this.points;
		let n = 0;
		for (let x = 0; x <= width; x += STEP) {
			pts[n++] = x;
			pts[n++] = this.getY(x, t, this.getMouseInfluence(x));
		}

		ctx.beginPath();
		ctx.moveTo(0, height);
		for (let i = 0; i < n; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
		ctx.lineTo(width, height);
		ctx.closePath();
		ctx.fillStyle = this.color;
		ctx.fill();

		if (HIGHLIGHT_WIDTH <= 0) return;
		ctx.beginPath();
		ctx.moveTo(pts[0], pts[1]);
		for (let i = 2; i < n; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
		ctx.strokeStyle = this.highlightColor;
		ctx.lineWidth = HIGHLIGHT_WIDTH;
		ctx.stroke();
	}
}

// ── Foam bubbles ──

class Bubble {
	constructor() { this.reset(); }

	reset() {
		this.x = Math.random() * (width || 800);
		this.y = (height || 600) * randIn(BUBBLE_BAND);
		this.radius = randIn(BUBBLE_RADIUS);
		this.opacity = randIn(BUBBLE_OPACITY);
		this.vx = (Math.random() - 0.5) * BUBBLE_DRIFT;
		this.vy = -randIn(BUBBLE_RISE);
		this.life = 1;
		this.decay = randIn(BUBBLE_LIFETIME);
	}

	update(frames) {
		this.x += this.vx * frames;
		this.y += this.vy * frames;
		this.life -= this.decay * frames;
		if (this.life <= 0 || this.y < 0) this.reset();
	}

	draw(ctx) {
		ctx.beginPath();
		ctx.arc(this.x, this.y, this.radius, 0, TAU);
		ctx.fillStyle = `rgba(${BUBBLE_COLOR[0]}, ${BUBBLE_COLOR[1]}, ${BUBBLE_COLOR[2]}, ` +
			`${this.opacity * this.life})`;
		ctx.fill();
	}
}

// ── Caustics ──

function drawCaustics(t) {
	const [cr, cg, cb] = CAUSTIC_COLOR;
	for (let i = 0; i < CAUSTIC_COUNT; i++) {
		const d = t * CAUSTIC_DRIFT;
		const cx = width * (0.15 + 0.7 * (i / CAUSTIC_COUNT)) + Math.sin(d * 0.003 + i * 1.5) * CAUSTIC_SWAY[0];
		const cy = height * CAUSTIC_Y + Math.cos(d * 0.004 + i * 2.1) * CAUSTIC_SWAY[1];
		const r = CAUSTIC_RADIUS + Math.sin(d * 0.005 + i) * CAUSTIC_RADIUS_VARY;
		if (r <= 0) continue;
		const alpha = CAUSTIC_ALPHA + CAUSTIC_ALPHA_VARY * Math.sin(d * 0.006 + i * 3);
		const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
		grad.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${Math.max(0, alpha)})`);
		grad.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, TAU);
		ctx.fillStyle = grad;
		ctx.fill();
	}
}

function initAll() {
	layers = [];
	for (let i = 0; i < NUM_LAYERS; i++) layers.push(new WaveLayer(i, NUM_LAYERS));
	bubbles = [];
	for (let i = 0; i < BUBBLE_COUNT; i++) bubbles.push(new Bubble());
}

let lastTime = 0;
function render(timestamp) {
	if (!ctx) return;
	// Delta-based so the swell runs at the same pace on 60Hz and 144Hz displays.
	// One unit of `time` = one frame at 60fps, which is what the wave maths expects.
	const dt = lastTime ? Math.min((timestamp - lastTime) / 1000, 0.1) : 1 / 60;
	lastTime = timestamp;
	const frames = dt * 60 * TIME_SCALE;
	time += frames;

	ctx.clearRect(0, 0, width, height);

	for (let i = 0; i < layers.length; i++) layers[i].draw(ctx, time);

	for (let i = 0; i < bubbles.length; i++) {
		bubbles[i].update(frames);
		bubbles[i].draw(ctx);
	}

	drawCaustics(time);

	ctx.globalAlpha = 1;
	requestAnimationFrame(render);
}

self.onmessage = (e) => {
	switch (e.data.type) {
		case 'init':
			canvas = e.data.canvas;
			ctx = canvas.getContext('2d');
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initAll();
			requestAnimationFrame(render);
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			for (let i = 0; i < layers.length; i++) layers[i].recalc(i, NUM_LAYERS);
			for (let i = 0; i < bubbles.length; i++) bubbles[i].reset();
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};
