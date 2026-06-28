/**
 * Title: Stress Test — Particle Inferno
 * Description: A brutal CPU stress test that pushes Canvas FX to its absolute
 *   limits. Renders 100,000 particles with real-time physics, per-particle
 *   velocity-to-heat color mapping, additive blending, and a multi-pass glow
 *   bloom. Particles are violently attracted to the cursor, creating a molten
 *   vortex that heats up on impact. A live FPS HUD shows how your system copes.
 *
 *   Move your mouse to pull the inferno toward you. If FPS stays above 30,
 *   your machine wins.
 */

/* ============ STRESS INTENSITY KNOBS ============ */
const PARTICLE_COUNT    = 100000;   // 100k (raise to 200k+ for extreme)
const PARTICLE_SIZE     = 3;        // px size of each particle
const ENABLE_BLOOM      = true;     // multi-pass box blur bloom (VERY expensive)
const BLOOM_PASSES      = 2;        // blur iterations per frame
const BLOOM_RADIUS      = 3;        // blur kernel radius
const ENABLE_HEAT_COLOR = true;     // per-particle velocity → color mapping
const MOUSE_FORCE       = 6000;     // attraction strength toward cursor
const MOUSE_RADIUS      = 280;      // pixel radius of mouse influence
const GRAVITY           = 0.015;    // downward pull
const FRICTION          = 0.965;    // velocity damping (lower = more drag)
const JITTER            = 0.25;     // random turbulence per frame
const BOUNCE            = 0.5;      // wall bounce energy retention
const TRAIL_OPACITY     = 0.06;     // trail fade per frame (lower = longer trails)
/* ================================================ */

let canvas, ctx, w, h;
let N = PARTICLE_COUNT;
let px, py, vx, vy, heat;
let mx = -9999, my = -9999;
let mouseR2 = MOUSE_RADIUS * MOUSE_RADIUS;
let time = 0;
let lastTime = 0;
let fps = 0;
let frameCount = 0;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function initParticles() {
	px   = new Float32Array(N);
	py   = new Float32Array(N);
	vx   = new Float32Array(N);
	vy   = new Float32Array(N);
	heat = new Float32Array(N);

	for (let i = 0; i < N; i++) {
		px[i] = Math.random() * w;
		py[i] = Math.random() * h;
		vx[i] = (Math.random() - 0.5) * 2;
		vy[i] = (Math.random() - 0.5) * 2;
		heat[i] = Math.random() * 0.2;
	}
}

// Pre-compute a palette LUT (256 entries) to avoid per-particle branching
const PALETTE = new Array(256);
(function buildPalette() {
	for (let i = 0; i < 256; i++) {
		const t = i / 255;
		let r, g, b;
		if (t < 0.25) {
			// Dark red → bright red
			const s = t / 0.25;
			r = 80 + s * 175; g = 0; b = 0;
		} else if (t < 0.5) {
			// Red → orange
			const s = (t - 0.25) / 0.25;
			r = 255; g = s * 160; b = 0;
		} else if (t < 0.75) {
			// Orange → yellow
			const s = (t - 0.5) / 0.25;
			r = 255; g = 160 + s * 95; b = s * 40;
		} else {
			// Yellow → white-hot
			const s = (t - 0.75) / 0.25;
			r = 255; g = 255; b = 40 + s * 215;
		}
		PALETTE[i] = `rgb(${r | 0},${g | 0},${b | 0})`;
	}
})();

function heatToColor(t) {
	return PALETTE[Math.min(255, Math.max(0, (t * 255) | 0))];
}

self.onmessage = (e) => {
	switch (e.data.type) {
		case 'init':
			canvas = e.data.canvas;
			ctx = canvas.getContext('2d', { willReadFrequently: ENABLE_BLOOM });
			w = e.data.width;
			h = e.data.height;
			canvas.width = w;
			canvas.height = h;
			initParticles();
			lastTime = performance.now();
			startAnimation();
			break;
		case 'resize':
			w = e.data.width;
			h = e.data.height;
			canvas.width = w;
			canvas.height = h;
			initParticles();
			break;
		case 'mousemove':
			mx = e.data.x;
			my = e.data.y;
			break;
	}
};

// Separable box blur for bloom (operates on ImageData.data)
function boxBlurH(src, dst, w, h, r) {
	const iarr = 1 / (r + r + 1);
	for (let y = 0; y < h; y++) {
		const rowStart = y * w * 4;
		const rowEnd = rowStart + w * 4;
		let ri = rowStart, li = rowStart, idx = rowStart;
		let rA = src[ri], gA = src[ri + 1], bA = src[ri + 2];
		for (let j = 0; j < r; j++) { rA += src[ri]; gA += src[ri + 1]; bA += src[ri + 2]; }
		for (let j = 0; j <= r; j++) {
			ri = Math.min(ri + 4, rowEnd - 4);
			rA += src[ri] - src[li]; gA += src[ri + 1] - src[li + 1]; bA += src[ri + 2] - src[li + 2];
			dst[idx] = (rA * iarr) | 0; dst[idx + 1] = (gA * iarr) | 0; dst[idx + 2] = (bA * iarr) | 0; dst[idx + 3] = 255;
			idx += 4;
		}
		for (let j = r + 1; j < w - r; j++) {
			ri += 4; li += 4;
			rA += src[ri] - src[li]; gA += src[ri + 1] - src[li + 1]; bA += src[ri + 2] - src[li + 2];
			dst[idx] = (rA * iarr) | 0; dst[idx + 1] = (gA * iarr) | 0; dst[idx + 2] = (bA * iarr) | 0; dst[idx + 3] = 255;
			idx += 4;
		}
		for (let j = w - r; j < w; j++) {
			li += 4;
			rA += src[ri] - src[li]; gA += src[ri + 1] - src[li + 1]; bA += src[ri + 2] - src[li + 2];
			dst[idx] = (rA * iarr) | 0; dst[idx + 1] = (gA * iarr) | 0; dst[idx + 2] = (bA * iarr) | 0; dst[idx + 3] = 255;
			idx += 4;
		}
	}
}

function boxBlurV(src, dst, w, h, r) {
	const iarr = 1 / (r + r + 1);
	const stride = w * 4;
	const totalLen = w * h * 4;
	for (let x = 0; x < w; x++) {
		const col = x * 4;
		let ti = col, bi = col, idx = col;
		let rA = src[ti], gA = src[ti + 1], bA = src[ti + 2];
		for (let j = 0; j < r; j++) { rA += src[ti]; gA += src[ti + 1]; bA += src[ti + 2]; }
		for (let j = 0; j <= r; j++) {
			ti = Math.min(ti + stride, totalLen - stride + col);
			rA += src[ti] - src[bi]; gA += src[ti + 1] - src[bi + 1]; bA += src[ti + 2] - src[bi + 2];
			dst[idx] = (rA * iarr) | 0; dst[idx + 1] = (gA * iarr) | 0; dst[idx + 2] = (bA * iarr) | 0; dst[idx + 3] = 255;
			idx += stride;
		}
		for (let j = r + 1; j < h - r; j++) {
			ti += stride; bi += stride;
			rA += src[ti] - src[bi]; gA += src[ti + 1] - src[bi + 1]; bA += src[ti + 2] - src[bi + 2];
			dst[idx] = (rA * iarr) | 0; dst[idx + 1] = (gA * iarr) | 0; dst[idx + 2] = (bA * iarr) | 0; dst[idx + 3] = 255;
			idx += stride;
		}
		for (let j = h - r; j < h; j++) {
			bi += stride;
			rA += src[ti] - src[bi]; gA += src[ti + 1] - src[bi + 1]; bA += src[ti + 2] - src[bi + 2];
			dst[idx] = (rA * iarr) | 0; dst[idx + 1] = (gA * iarr) | 0; dst[idx + 2] = (bA * iarr) | 0; dst[idx + 3] = 255;
			idx += stride;
		}
	}
}

function startAnimation() {
	let tempBuf = ENABLE_BLOOM ? new Uint8ClampedArray(w * h * 4) : null;

	function render() {
		if (!ctx) return;
		time++;
		frameCount++;

		const now = performance.now();
		if (now - lastTime >= 1000) {
			fps = frameCount;
			frameCount = 0;
			lastTime = now;
		}

		// --- Phase 1: Fade previous frame (trail persistence) ---
		ctx.fillStyle = `rgba(0, 0, 0, ${TRAIL_OPACITY})`;
		ctx.fillRect(0, 0, w, h);

		// --- Phase 2: Physics + draw (100k fillRect calls = brutal) ---
		ctx.globalCompositeOperation = 'lighter'; // additive blending

		for (let i = 0; i < N; i++) {
			// Mouse attraction
			const dx = mx - px[i];
			const dy = my - py[i];
			const d2 = dx * dx + dy * dy;

			if (d2 < mouseR2 && d2 > 1) {
				const dist = Math.sqrt(d2);
				const f = MOUSE_FORCE / (d2 + 100);
				vx[i] += (dx / dist) * f;
				vy[i] += (dy / dist) * f;
				heat[i] = Math.min(1, heat[i] + 0.04);
			}

			vy[i] += GRAVITY;
			vx[i] += (Math.random() - 0.5) * JITTER;
			vy[i] += (Math.random() - 0.5) * JITTER;
			vx[i] *= FRICTION;
			vy[i] *= FRICTION;
			px[i] += vx[i];
			py[i] += vy[i];

			// Velocity-based heat
			if (ENABLE_HEAT_COLOR) {
				const speed = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
				heat[i] = Math.min(1, heat[i] + speed * 0.006);
			}
			heat[i] *= 0.993;

			// Wall bounce
			if (px[i] < 0)  { px[i] = 0;     vx[i] *= -BOUNCE; heat[i] = Math.min(1, heat[i] + 0.08); }
			if (px[i] >= w)  { px[i] = w - 1; vx[i] *= -BOUNCE; heat[i] = Math.min(1, heat[i] + 0.08); }
			if (py[i] < 0)  { py[i] = 0;     vy[i] *= -BOUNCE; heat[i] = Math.min(1, heat[i] + 0.08); }
			if (py[i] >= h)  { py[i] = h - 1; vy[i] *= -BOUNCE; heat[i] = Math.min(1, heat[i] + 0.08); }

			// Draw — each particle is a fillRect call (100k per frame!)
			ctx.fillStyle = ENABLE_HEAT_COLOR ? heatToColor(heat[i]) : '#ff8c28';
			ctx.fillRect((px[i] + 0.5) | 0, (py[i] + 0.5) | 0, PARTICLE_SIZE, PARTICLE_SIZE);
		}

		ctx.globalCompositeOperation = 'source-over';

		// --- Phase 3: Bloom post-process ---
		if (ENABLE_BLOOM) {
			if (!tempBuf || tempBuf.length !== w * h * 4) {
				tempBuf = new Uint8ClampedArray(w * h * 4);
			}
			const img = ctx.getImageData(0, 0, w, h);
			const src = img.data;
			const tmp = tempBuf;
			for (let pass = 0; pass < BLOOM_PASSES; pass++) {
				boxBlurH(src, tmp, w, h, BLOOM_RADIUS);
				boxBlurV(tmp, src, w, h, BLOOM_RADIUS);
			}
			ctx.putImageData(img, 0, 0);
		}

		// --- Phase 4: HUD overlay ---
		ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
		ctx.fillRect(8, 8, 260, 94);
		ctx.strokeStyle = 'rgba(255,255,255,0.1)';
		ctx.strokeRect(8, 8, 260, 94);
		ctx.fillStyle = fps >= 50 ? '#4ade80' : fps >= 30 ? '#facc15' : '#ef4444';
		ctx.font = 'bold 28px monospace';
		ctx.fillText(`${fps} FPS`, 18, 42);
		ctx.fillStyle = '#d4d4d8';
		ctx.font = '13px monospace';
		ctx.fillText(`${(N / 1000).toFixed(0)}k particles × ${PARTICLE_SIZE}px`, 18, 62);
		ctx.fillText(`bloom: ${ENABLE_BLOOM ? `ON ×${BLOOM_PASSES} r${BLOOM_RADIUS}` : 'OFF'} | heat: ${ENABLE_HEAT_COLOR ? 'ON' : 'OFF'}`, 18, 78);
		ctx.fillText(`mouse: (${mx | 0}, ${my | 0})`, 18, 94);

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}
