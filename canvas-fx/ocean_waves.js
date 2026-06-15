/**
 * Title: Ocean Waves
 * Description: Layered horizontal wave patterns at different depths, creating an
 *   ocean surface viewed from below. Deep blues and teals with varying opacity.
 *   Mouse position creates a swell/disturbance in the nearest wave layer.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let time = 0;
let layers = [];

const NUM_LAYERS = 5;

// Keep worker alive
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

class WaveLayer {
	constructor(index, total) {
		// Depth: 0 = deepest/back, total-1 = shallowest/front
		this.depth = index / (total - 1); // 0..1
		this.yBase = 0;
		this.amplitude = 0;
		this.frequency = 0;
		this.speed = 0;
		this.phase = Math.random() * Math.PI * 2;
		this.secondaryFreq = 0;
		this.secondaryAmp = 0;
		this.recalc(index, total);
	}

	recalc(index, total) {
		// Position layers from top ~30% to bottom ~80% of screen
		const t = index / (total - 1);
		this.yBase = height * (0.25 + t * 0.55);
		this.amplitude = 15 + t * 25;
		this.frequency = 0.003 + (1 - t) * 0.004;
		this.speed = 0.008 + (1 - t) * 0.012;
		this.secondaryFreq = this.frequency * 2.3;
		this.secondaryAmp = this.amplitude * 0.3;
		// Color — deep layers are darker and more blue, shallow are lighter and teal
		const hue = 200 + t * 20; // 200 (deep blue) to 220 (teal-ish)
		const lightness = 15 + t * 20;
		const alpha = 0.08 + t * 0.12;
		this.color = `hsla(${hue}, 70%, ${lightness}%, ${alpha})`;
		this.highlightColor = `hsla(${hue - 10}, 60%, ${lightness + 15}%, ${alpha * 0.5})`;
	}

	getY(x, t, mouseInfluence) {
		// Primary wave
		let y =
			this.yBase + Math.sin(x * this.frequency + t * this.speed + this.phase) * this.amplitude;
		// Secondary harmonic
		y +=
			Math.sin(x * this.secondaryFreq + t * this.speed * 1.5 + this.phase * 2) * this.secondaryAmp;
		// Tertiary ripple for realism
		y += Math.sin(x * this.frequency * 4.7 + t * this.speed * 0.7) * this.amplitude * 0.08;
		// Mouse swell disturbance
		y += mouseInfluence;
		return y;
	}

	getMouseInfluence(x) {
		const dx = x - mouse.x;
		const dy = this.yBase - mouse.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		const influenceRadius = 250;
		if (dist < influenceRadius) {
			const strength = 1 - dist / influenceRadius;
			// Push wave away from mouse — creates a swell
			return -strength * strength * 40 * (1 - this.depth * 0.5);
		}
		return 0;
	}

	draw(ctx, t) {
		const step = 4; // pixel step for performance
		ctx.beginPath();
		ctx.moveTo(0, height);

		for (let x = 0; x <= width; x += step) {
			const mi = this.getMouseInfluence(x);
			const y = this.getY(x, t, mi);
			ctx.lineTo(x, y);
		}

		ctx.lineTo(width, height);
		ctx.closePath();
		ctx.fillStyle = this.color;
		ctx.fill();

		// Draw highlight line along the wave crest
		ctx.beginPath();
		for (let x = 0; x <= width; x += step) {
			const mi = this.getMouseInfluence(x);
			const y = this.getY(x, t, mi);
			if (x === 0) {
				ctx.moveTo(x, y);
			} else {
				ctx.lineTo(x, y);
			}
		}
		ctx.strokeStyle = this.highlightColor;
		ctx.lineWidth = 1.5;
		ctx.stroke();
	}
}

// Foam/bubble particles for surface detail
class Bubble {
	constructor() {
		this.reset();
	}

	reset() {
		this.x = Math.random() * (width || 800);
		this.y = (height || 600) * (0.2 + Math.random() * 0.6);
		this.radius = 0.5 + Math.random() * 1.5;
		this.opacity = 0.03 + Math.random() * 0.06;
		this.vx = (Math.random() - 0.5) * 0.3;
		this.vy = -0.1 - Math.random() * 0.3;
		this.life = 1;
		this.decay = 0.001 + Math.random() * 0.003;
	}

	update() {
		this.x += this.vx;
		this.y += this.vy;
		this.life -= this.decay;
		if (this.life <= 0 || this.y < 0) {
			this.reset();
		}
	}

	draw(ctx) {
		ctx.beginPath();
		ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
		ctx.fillStyle = `rgba(150, 200, 220, ${this.opacity * this.life})`;
		ctx.fill();
	}
}

let bubbles = [];
const MAX_BUBBLES = 30;

function initLayers() {
	layers = [];
	for (let i = 0; i < NUM_LAYERS; i++) {
		layers.push(new WaveLayer(i, NUM_LAYERS));
	}
	bubbles = [];
	for (let i = 0; i < MAX_BUBBLES; i++) {
		bubbles.push(new Bubble());
	}
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
			initLayers();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			// Recalculate layer positions
			for (let i = 0; i < layers.length; i++) {
				layers[i].recalc(i, NUM_LAYERS);
			}
			bubbles.forEach((b) => b.reset());
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};

function startAnimation() {
	function render() {
		if (!ctx) return;
		ctx.clearRect(0, 0, width, height);

		time++;

		// Draw layers back to front (deep first)
		for (const layer of layers) {
			layer.draw(ctx, time);
		}

		// Draw bubbles
		for (const b of bubbles) {
			b.update();
			b.draw(ctx);
		}

		// Subtle caustic light pattern overlay
		drawCaustics(time);

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}

function drawCaustics(t) {
	// Very subtle shifting light patches
	const count = 6;
	for (let i = 0; i < count; i++) {
		const cx = width * (0.15 + 0.7 * (i / count)) + Math.sin(t * 0.003 + i * 1.5) * 80;
		const cy = height * 0.4 + Math.cos(t * 0.004 + i * 2.1) * 60;
		const r = 60 + Math.sin(t * 0.005 + i) * 20;
		const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
		const alpha = 0.015 + 0.01 * Math.sin(t * 0.006 + i * 3);
		grad.addColorStop(0, `rgba(120, 200, 220, ${alpha})`);
		grad.addColorStop(1, 'rgba(120, 200, 220, 0)');
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fillStyle = grad;
		ctx.fill();
	}
}
