/**
 * Title: Bioluminescent Plankton
 * Description: 30,000 glowing plankton particles that scatter away from your cursor
 *   in panicked swarms, leaving phosphorescent trails. Move your mouse to watch
 *   them flee and reform — like disturbing a bioluminescent bay at night.
 *   Highly interactive: chase them around the screen!
 */

/* ---------- CONFIGURABLE VARIABLES ---------- */
const PLANKTON_COUNT   = 30000;          // number of particles
const MOUSE_RADIUS     = 100;            // pixel radius of mouse influence
const FORCE_FACTOR     = 2000;           // flee-from-mouse strength
const FRICTION         = 0.92;           // velocity damping per frame (0–1)
const JITTER           = 0.1;            // random drift each frame
const TRAIL_FADE       = 0.08;           // lower = longer trails (0–1)
const BASE_HUE         = 140;            // hue of the plankton (140 = cyan-green)
const HUE_RANGE        = 40;             // color variation range
const BRIGHTNESS_BOOST = 1.4;            // glow multiplier near mouse
/* --------------------------------------------- */

let canvas, ctx, w, h;
let N = PLANKTON_COUNT;
let px = new Float32Array(N);
let py = new Float32Array(N);
let vx = new Float32Array(N);
let vy = new Float32Array(N);
let mx = -9999, my = -9999;
let mouseInfluenceR2 = MOUSE_RADIUS * MOUSE_RADIUS;
let time = 0;

// Keep worker alive
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

function initParticles() {
	for (let i = 0; i < N; i++) {
		px[i] = Math.random() * w;
		py[i] = Math.random() * h;
		vx[i] = 0;
		vy[i] = 0;
	}
}

self.onmessage = (e) => {
	switch (e.data.type) {
		case 'init':
			canvas = e.data.canvas;
			ctx = canvas.getContext('2d');
			w = e.data.width;
			h = e.data.height;
			canvas.width = w;
			canvas.height = h;
			initParticles();
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

function startAnimation() {
	function render() {
		if (!ctx) return;
		time++;

		// Fade previous frame for trail effect
		ctx.fillStyle = `rgba(0, 0, 0, ${TRAIL_FADE})`;
		ctx.fillRect(0, 0, w, h);

		for (let i = 0; i < N; i++) {
			const dx = mx - px[i];
			const dy = my - py[i];
			const d2 = dx * dx + dy * dy;

			// Flee from mouse
			if (d2 < mouseInfluenceR2 && d2 > 0) {
				const f = FORCE_FACTOR / d2;
				vx[i] -= dx * f;
				vy[i] -= dy * f;
			}

			// Apply friction and jitter
			vx[i] *= FRICTION;
			vy[i] *= FRICTION;
			vx[i] += (Math.random() - 0.5) * JITTER;
			vy[i] += (Math.random() - 0.5) * JITTER;

			// Move
			px[i] += vx[i];
			py[i] += vy[i];

			// Wrap edges
			if (px[i] < 0) px[i] = w;
			if (px[i] > w) px[i] = 0;
			if (py[i] < 0) py[i] = h;
			if (py[i] > h) py[i] = 0;

			// Color: hue varies by particle index, brightness by velocity
			const speed = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
			const hue = (BASE_HUE + (i % HUE_RANGE) - HUE_RANGE / 2 + 360) % 360;
			const brightness = Math.min(100, 40 + speed * BRIGHTNESS_BOOST * 30);
			const alpha = Math.min(1, 0.3 + speed * 0.5);

			// Draw as 1–2px glowing dot
			ctx.fillStyle = `hsla(${hue}, 100%, ${brightness}%, ${alpha})`;
			ctx.fillRect(Math.floor(px[i]), Math.floor(py[i]), speed > 1.5 ? 2 : 1, speed > 1.5 ? 2 : 1);
		}

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}
