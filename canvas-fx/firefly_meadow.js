/**
 * Title: Firefly Meadow
 * Description: Softly glowing firefly particles drifting with organic, non-linear
 *   movement. They pulse brighter occasionally with warm yellow/green glow.
 *   Mouse creates a gentle attraction zone that fireflies investigate.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let fireflies = [];
let time = 0;

const MAX_FIREFLIES = 60;

// Keep worker alive
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

class Firefly {
	constructor() {
		this.x = Math.random() * (width || 800);
		this.y = Math.random() * (height || 600);
		this.vx = 0;
		this.vy = 0;
		this.radius = 1.5 + Math.random() * 2;
		this.baseGlow = 0.08 + Math.random() * 0.12;
		this.glow = this.baseGlow;
		this.glowTarget = this.baseGlow;
		this.pulseTimer = Math.random() * 400;
		this.pulseInterval = 200 + Math.random() * 500;
		// Organic movement: use angular wandering
		this.angle = Math.random() * Math.PI * 2;
		this.angularVelocity = 0;
		this.speed = 0.2 + Math.random() * 0.4;
		// Color warmth — yellow to green spectrum
		this.hue = 50 + Math.random() * 80; // 50 (yellow) to 130 (green)
		this.saturation = 70 + Math.random() * 30;
		// Phase offset for individual timing
		this.phase = Math.random() * Math.PI * 2;
	}

	update(t) {
		// Organic angular wandering (like a random walk in angle space)
		this.angularVelocity += (Math.random() - 0.5) * 0.08;
		this.angularVelocity *= 0.92; // dampen
		this.angle += this.angularVelocity;

		// Gentle sinusoidal modulation of speed
		const speedMod = 0.7 + 0.3 * Math.sin(t * 0.005 + this.phase);
		const targetVx = Math.cos(this.angle) * this.speed * speedMod;
		const targetVy = Math.sin(this.angle) * this.speed * speedMod;

		// Smooth velocity transition
		this.vx += (targetVx - this.vx) * 0.05;
		this.vy += (targetVy - this.vy) * 0.05;

		// Mouse attraction — gentle investigation behavior
		const dx = mouse.x - this.x;
		const dy = mouse.y - this.y;
		const distSq = dx * dx + dy * dy;
		const attractRadius = 200;
		if (distSq < attractRadius * attractRadius && distSq > 400) {
			const dist = Math.sqrt(distSq);
			const force = 0.15 * (1 - dist / attractRadius);
			this.vx += (dx / dist) * force;
			this.vy += (dy / dist) * force;
		}
		// Very close to mouse — shy away slightly
		if (distSq < 400 && distSq > 0) {
			const dist = Math.sqrt(distSq);
			this.vx -= (dx / dist) * 0.3;
			this.vy -= (dy / dist) * 0.3;
		}

		this.x += this.vx;
		this.y += this.vy;

		// Wrap around edges with padding
		const pad = 30;
		if (this.x < -pad) this.x = width + pad;
		if (this.x > width + pad) this.x = -pad;
		if (this.y < -pad) this.y = height + pad;
		if (this.y > height + pad) this.y = -pad;

		// Pulsing glow
		this.pulseTimer++;
		if (this.pulseTimer > this.pulseInterval) {
			this.pulseTimer = 0;
			this.pulseInterval = 200 + Math.random() * 500;
			this.glowTarget = this.baseGlow + 0.2 + Math.random() * 0.3;
		}
		// Smooth glow transition
		this.glow += (this.glowTarget - this.glow) * 0.03;
		// Decay glow back to base
		this.glowTarget += (this.baseGlow - this.glowTarget) * 0.01;
	}

	draw(ctx) {
		const r = this.radius;
		const g = this.glow;

		// Outer soft glow (large radius, very transparent)
		const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r * 12);
		gradient.addColorStop(0, `hsla(${this.hue}, ${this.saturation}%, 70%, ${g * 0.6})`);
		gradient.addColorStop(0.3, `hsla(${this.hue}, ${this.saturation}%, 60%, ${g * 0.25})`);
		gradient.addColorStop(1, `hsla(${this.hue}, ${this.saturation}%, 50%, 0)`);
		ctx.beginPath();
		ctx.arc(this.x, this.y, r * 12, 0, Math.PI * 2);
		ctx.fillStyle = gradient;
		ctx.fill();

		// Inner bright core
		const coreGrad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r * 2);
		coreGrad.addColorStop(0, `hsla(${this.hue}, ${this.saturation}%, 90%, ${g * 1.5})`);
		coreGrad.addColorStop(1, `hsla(${this.hue}, ${this.saturation}%, 70%, 0)`);
		ctx.beginPath();
		ctx.arc(this.x, this.y, r * 2, 0, Math.PI * 2);
		ctx.fillStyle = coreGrad;
		ctx.fill();
	}
}

function initFireflies() {
	fireflies = [];
	for (let i = 0; i < MAX_FIREFLIES; i++) {
		fireflies.push(new Firefly());
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
			initFireflies();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initFireflies();
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
		// Slight trail for dreamy effect
		ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
		ctx.fillRect(0, 0, width, height);

		time++;
		for (const ff of fireflies) {
			ff.update(time);
			ff.draw(ctx);
		}

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}
