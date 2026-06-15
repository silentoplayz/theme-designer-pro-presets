/**
 * Title: Particle Vortex
 * Description: Particles orbiting a central point in spiral/vortex patterns.
 *   Different rings at different speeds. Mouse becomes a secondary gravitational
 *   center, creating figure-8 or chaotic orbital patterns. Warm white/gold particles.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let particles = [];
let time = 0;
let center = { x: 0, y: 0 };

const PARTICLE_COUNT = 200;
const CENTER_GRAVITY = 0.0003;
const MOUSE_GRAVITY = 0.00015;
const DAMPING = 0.9995;
const TRAIL_ALPHA = 0.04;

// Heartbeat to keep worker alive
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

// Warm white/gold color palette
const COLORS = [
	{ r: 255, g: 240, b: 200 }, // warm white
	{ r: 255, g: 215, b: 100 }, // gold
	{ r: 255, g: 200, b: 130 }, // light amber
	{ r: 255, g: 230, b: 160 }, // pale gold
	{ r: 240, g: 200, b: 180 }, // warm beige
	{ r: 255, g: 180, b: 80 } // deep gold
];

class Particle {
	constructor(ringIndex, totalRings) {
		this.ringIndex = ringIndex;
		this.totalRings = totalRings;
		this.reset();
	}

	reset() {
		// Distribute in rings around center
		const ringRadius = 50 + (this.ringIndex / this.totalRings) * Math.min(width, height) * 0.4;
		const angle = Math.random() * Math.PI * 2;

		this.x = center.x + Math.cos(angle) * ringRadius;
		this.y = center.y + Math.sin(angle) * ringRadius;

		// Tangential velocity for orbiting (perpendicular to radius)
		const speed = 0.8 + (1 - this.ringIndex / this.totalRings) * 1.5;
		this.vx = -Math.sin(angle) * speed;
		this.vy = Math.cos(angle) * speed;

		this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
		this.size = 1 + Math.random() * 2;
		this.alpha = 0.3 + Math.random() * 0.5;
		this.trail = [];
		this.maxTrail = 8 + Math.floor(Math.random() * 8);
	}

	update() {
		// Store trail position
		this.trail.push({ x: this.x, y: this.y });
		if (this.trail.length > this.maxTrail) {
			this.trail.shift();
		}

		// Gravitational pull toward center
		let dx = center.x - this.x;
		let dy = center.y - this.y;
		let dist = Math.sqrt(dx * dx + dy * dy);
		if (dist > 1) {
			const force = CENTER_GRAVITY * dist;
			this.vx += (dx / dist) * force;
			this.vy += (dy / dist) * force;
		}

		// Mouse as secondary gravitational center
		if (mouse.x > 0 && mouse.y > 0) {
			dx = mouse.x - this.x;
			dy = mouse.y - this.y;
			dist = Math.sqrt(dx * dx + dy * dy);
			if (dist > 5 && dist < 400) {
				const force = MOUSE_GRAVITY * dist;
				this.vx += (dx / dist) * force;
				this.vy += (dy / dist) * force;
			}
		}

		// Apply velocity with damping
		this.vx *= DAMPING;
		this.vy *= DAMPING;
		this.x += this.vx;
		this.y += this.vy;

		// Soft boundary — if particle escapes too far, gently pull back
		const maxDist = Math.max(width, height) * 0.6;
		const distFromCenter = Math.sqrt((this.x - center.x) ** 2 + (this.y - center.y) ** 2);
		if (distFromCenter > maxDist) {
			this.x += (center.x - this.x) * 0.01;
			this.y += (center.y - this.y) * 0.01;
		}
	}

	draw() {
		const { r, g, b } = this.color;

		// Draw trail
		for (let i = 0; i < this.trail.length; i++) {
			const t = this.trail[i];
			const trailAlpha = (i / this.trail.length) * this.alpha * 0.3;
			const trailSize = this.size * (i / this.trail.length) * 0.6;
			ctx.beginPath();
			ctx.arc(t.x, t.y, trailSize, 0, Math.PI * 2);
			ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${trailAlpha})`;
			ctx.fill();
		}

		// Draw particle with glow
		// Outer glow
		const glowGrad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.size * 4);
		glowGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${this.alpha * 0.3})`);
		glowGrad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${this.alpha * 0.1})`);
		glowGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
		ctx.beginPath();
		ctx.arc(this.x, this.y, this.size * 4, 0, Math.PI * 2);
		ctx.fillStyle = glowGrad;
		ctx.fill();

		// Core
		ctx.beginPath();
		ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
		ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${this.alpha})`;
		ctx.fill();
	}
}

function initParticles() {
	center.x = width / 2;
	center.y = height / 2;
	particles = [];

	const rings = 5;
	const perRing = Math.floor(PARTICLE_COUNT / rings);

	for (let ring = 0; ring < rings; ring++) {
		for (let i = 0; i < perRing; i++) {
			particles.push(new Particle(ring, rings));
		}
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
			initParticles();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initParticles();
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

		// Semi-transparent overlay for motion trails
		ctx.fillStyle = `rgba(0, 0, 0, ${TRAIL_ALPHA})`;
		ctx.fillRect(0, 0, width, height);

		time++;

		// Update and draw all particles
		for (const p of particles) {
			p.update();
		}
		for (const p of particles) {
			p.draw();
		}

		// Draw subtle center glow
		const centerGlow = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, 60);
		centerGlow.addColorStop(0, 'rgba(255, 220, 150, 0.06)');
		centerGlow.addColorStop(0.5, 'rgba(255, 200, 100, 0.02)');
		centerGlow.addColorStop(1, 'rgba(255, 180, 80, 0)');
		ctx.beginPath();
		ctx.arc(center.x, center.y, 60, 0, Math.PI * 2);
		ctx.fillStyle = centerGlow;
		ctx.fill();

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}
