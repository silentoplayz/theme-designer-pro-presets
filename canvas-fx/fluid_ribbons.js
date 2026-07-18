/**
 * Title: Fluid Ribbons
 * Description: Graceful, flowing silk-like ribbons that trail across the screen in smooth
 *   sine/bezier curves. Ribbons taper from thick centers to thin edges, carry color gradients
 *   along their length, attract toward the mouse cursor, and glow at intersection points.
 *   Uses ring-buffer position history, Float32Array bulk storage, and delta-time animation.
 */

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG = {
	ribbonCount: 10, // Number of independent ribbons
	ribbonLength: 120, // History points per ribbon (ring buffer depth)
	ribbonWidth: 18, // Maximum width at the ribbon's center
	taperAmount: 0.92, // How sharply ribbon tapers at edges (0 = none, 1 = full)
	flowSpeed: 0.6, // Base movement speed (px per frame at 60fps)
	flowAmplitude: 150, // Sine-wave amplitude for vertical undulation (px)
	flowFrequency: 0.008, // Sine-wave frequency (lower = wider waves)
	attractRadius: 280, // Distance within which mouse attracts ribbons (px)
	attractStrength: 0.035, // How strongly ribbons curve toward the cursor
	colorSaturation: 72, // HSL saturation for ribbon color (%)
	colorLightness: 62, // HSL lightness for ribbon color (%)
	intersectionGlow: 0.35, // Glow intensity at ribbon crossings (0-1)
	trailAlpha: 0.06, // Base alpha for the oldest trail points
	glowPasses: 3, // Number of multi-pass glow layers
	glowWidthStep: 4, // Extra width added per glow pass
	glowAlphaDecay: 0.35 // Alpha multiplier per successive glow pass
};

// ─── STATE ─────────────────────────────────────────────────────────────────────
let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let lastTime = 0;
let ribbons = [];

// ─── HEARTBEAT ─────────────────────────────────────────────────────────────────
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

// ─── RIBBON CLASS (pooled, zero-alloc render loop) ─────────────────────────────
class Ribbon {
	constructor(index) {
		this.index = index;
		const len = CONFIG.ribbonLength;

		// Ring buffer for x, y positions — Float32Array for performance
		this.xBuf = new Float32Array(len);
		this.yBuf = new Float32Array(len);
		this.head = 0; // Current write position in ring buffer
		this.filled = 0; // How many slots are filled (up to len)

		// Movement state
		this.x = 0;
		this.y = 0;
		this.vx = 0;
		this.vy = 0;
		this.angle = 0; // Current heading angle
		this.phase = 0; // Sine-wave phase offset
		this.baseHue = 0; // Starting hue for this ribbon

		// Precomputed taper widths — avoids per-frame allocation
		this.taperWidths = new Float32Array(len);
	}

	init(w, h) {
		const len = CONFIG.ribbonLength;
		this.x = Math.random() * w;
		this.y = Math.random() * h;
		this.angle = Math.random() * Math.PI * 2;
		this.phase = Math.random() * Math.PI * 2;
		this.baseHue = (this.index / CONFIG.ribbonCount) * 360 + Math.random() * 40;
		this.vx = Math.cos(this.angle) * CONFIG.flowSpeed;
		this.vy = Math.sin(this.angle) * CONFIG.flowSpeed;
		this.head = 0;
		this.filled = 0;

		// Fill the entire buffer with the starting position
		for (let i = 0; i < len; i++) {
			this.xBuf[i] = this.x;
			this.yBuf[i] = this.y;
		}
		this.filled = 1;

		// Precompute taper widths (bell-curve shape)
		for (let i = 0; i < len; i++) {
			const t = i / (len - 1); // 0 at head, 1 at tail
			const bell = Math.sin(t * Math.PI); // 0→1→0 bell
			const taper = 1 - CONFIG.taperAmount * (1 - bell);
			this.taperWidths[i] = CONFIG.ribbonWidth * taper;
		}
	}

	update(dt) {
		const speed = CONFIG.flowSpeed * dt;

		// Sine-wave undulation perpendicular to heading
		this.phase += CONFIG.flowFrequency * dt * 60;
		const perpAngle = this.angle + Math.PI * 0.5;
		const sineOffset = Math.sin(this.phase) * CONFIG.flowAmplitude * CONFIG.flowFrequency;

		// Base velocity
		this.vx = Math.cos(this.angle) * speed + Math.cos(perpAngle) * sineOffset * dt;
		this.vy = Math.sin(this.angle) * speed + Math.sin(perpAngle) * sineOffset * dt;

		// Mouse attraction
		const dx = mouse.x - this.x;
		const dy = mouse.y - this.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist < CONFIG.attractRadius && dist > 1) {
			const force = CONFIG.attractStrength * (1 - dist / CONFIG.attractRadius);
			this.vx += (dx / dist) * force * dt * 60;
			this.vy += (dy / dist) * force * dt * 60;
		}

		// Slowly drift the heading angle (smooth wandering)
		this.angle += (Math.random() - 0.5) * 0.04 * dt * 60;

		// Apply velocity
		this.x += this.vx;
		this.y += this.vy;

		// Soft edge wrapping with margin
		const margin = 100;
		if (this.x < -margin) this.x = width + margin;
		if (this.x > width + margin) this.x = -margin;
		if (this.y < -margin) this.y = height + margin;
		if (this.y > height + margin) this.y = -margin;

		// Push position into ring buffer
		this.xBuf[this.head] = this.x;
		this.yBuf[this.head] = this.y;
		this.head = (this.head + 1) % CONFIG.ribbonLength;
		if (this.filled < CONFIG.ribbonLength) this.filled++;
	}

	// Get the i-th oldest point (0 = oldest visible, filled-1 = newest/head)
	getPoint(i) {
		const idx = (this.head - this.filled + i + CONFIG.ribbonLength) % CONFIG.ribbonLength;
		return { x: this.xBuf[idx], y: this.yBuf[idx] };
	}

	draw(ctx, pass) {
		if (this.filled < 4) return;

		const count = this.filled;
		const isGlow = pass > 0;
		const extraWidth = isGlow ? pass * CONFIG.glowWidthStep : 0;
		const alphaScale = isGlow ? Math.pow(CONFIG.glowAlphaDecay, pass) : 1;

		// Draw as a sequence of quadratic bezier segments
		for (let i = 1; i < count - 1; i++) {
			const prev = this.getPoint(i - 1);
			const curr = this.getPoint(i);
			const next = this.getPoint(i + 1);

			// Midpoints for smooth bezier connections
			const mx0 = (prev.x + curr.x) * 0.5;
			const my0 = (prev.y + curr.y) * 0.5;
			const mx1 = (curr.x + next.x) * 0.5;
			const my1 = (curr.y + next.y) * 0.5;

			// Age factor: 0 at tail, 1 at head
			const t = i / (count - 1);
			const alpha = (CONFIG.trailAlpha + (1 - CONFIG.trailAlpha) * t) * alphaScale;
			const w = this.taperWidths[Math.min(i, CONFIG.ribbonLength - 1)] + extraWidth;

			// Color gradient along ribbon length
			const hue = (this.baseHue + t * 60) % 360;

			ctx.beginPath();
			ctx.moveTo(mx0, my0);
			ctx.quadraticCurveTo(curr.x, curr.y, mx1, my1);
			ctx.lineWidth = Math.max(0.5, w);
			ctx.strokeStyle = `hsla(${hue}, ${CONFIG.colorSaturation}%, ${CONFIG.colorLightness}%, ${alpha * 0.4})`;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.stroke();
		}
	}
}

// ─── INTERSECTION DETECTION ────────────────────────────────────────────────────
// Lightweight: only check head positions of each ribbon pair for glow
function drawIntersectionGlows(ctx) {
	if (CONFIG.intersectionGlow <= 0) return;

	const checkRadius = CONFIG.ribbonWidth * 2;
	for (let a = 0; a < ribbons.length; a++) {
		for (let b = a + 1; b < ribbons.length; b++) {
			const ra = ribbons[a];
			const rb = ribbons[b];

			// Sample a few points along each ribbon for crossing detection
			const samplesA = Math.min(ra.filled, 30);
			const samplesB = Math.min(rb.filled, 30);
			const stepA = Math.max(1, Math.floor(ra.filled / samplesA));
			const stepB = Math.max(1, Math.floor(rb.filled / samplesB));

			for (let i = 0; i < ra.filled; i += stepA) {
				const pa = ra.getPoint(i);
				for (let j = 0; j < rb.filled; j += stepB) {
					const pb = rb.getPoint(j);
					const dx = pa.x - pb.x;
					const dy = pa.y - pb.y;
					const distSq = dx * dx + dy * dy;
					if (distSq < checkRadius * checkRadius) {
						const dist = Math.sqrt(distSq);
						const intensity = (1 - dist / checkRadius) * CONFIG.intersectionGlow;
						const midX = (pa.x + pb.x) * 0.5;
						const midY = (pa.y + pb.y) * 0.5;
						const hue = (ra.baseHue + rb.baseHue) * 0.5;

						const grad = ctx.createRadialGradient(midX, midY, 0, midX, midY, checkRadius);
						grad.addColorStop(0, `hsla(${hue}, 80%, 80%, ${intensity * 0.5})`);
						grad.addColorStop(1, `hsla(${hue}, 80%, 80%, 0)`);
						ctx.fillStyle = grad;
						ctx.fillRect(midX - checkRadius, midY - checkRadius, checkRadius * 2, checkRadius * 2);
					}
				}
			}
		}
	}
}

// ─── INITIALIZATION ────────────────────────────────────────────────────────────
function initRibbons() {
	ribbons = [];
	for (let i = 0; i < CONFIG.ribbonCount; i++) {
		const r = new Ribbon(i);
		r.init(width, height);
		ribbons.push(r);
	}
}

// ─── MESSAGE HANDLER ───────────────────────────────────────────────────────────
self.onmessage = (e) => {
	switch (e.data.type) {
		case 'init':
			canvas = e.data.canvas;
			ctx = canvas.getContext('2d');
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			initRibbons();
			lastTime = performance.now();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			// Don't reinitialize — ribbons will naturally drift into the new area
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};

// ─── RENDER LOOP ───────────────────────────────────────────────────────────────
function startAnimation() {
	function render(now) {
		if (!ctx) return;

		// Delta time in seconds, capped to prevent spiral-of-death
		const dt = Math.min((now - lastTime) / 16.667, 3);
		lastTime = now;

		// Semi-transparent clear for motion trail effect
		ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
		ctx.fillRect(0, 0, width, height);

		// Update all ribbons
		for (let i = 0; i < ribbons.length; i++) {
			ribbons[i].update(dt);
		}

		// Multi-pass glow rendering (widest/faintest first)
		for (let pass = CONFIG.glowPasses; pass >= 0; pass--) {
			for (let i = 0; i < ribbons.length; i++) {
				ribbons[i].draw(ctx, pass);
			}
		}

		// Intersection glows
		drawIntersectionGlows(ctx);

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}
