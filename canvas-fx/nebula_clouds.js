/**
 * Title: Nebula Clouds
 * Description: Soft, slowly drifting colored cloud formations using layered circles with very low
 *              opacity and large radii. Colors are deep purples, blues, and pinks.
 *              Mouse proximity causes nearby clouds to gently disperse.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let clouds = [];
let time = 0;

const CLOUD_COUNT = 45;
const MOUSE_RADIUS = 200;
const MOUSE_FORCE = 0.8;

// Keep worker alive
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

// Nebula palette: deep purples, blues, pinks
const NEBULA_COLORS = [
	{ r: 80, g: 40, b: 160 }, // deep purple
	{ r: 40, g: 60, b: 180 }, // deep blue
	{ r: 160, g: 50, b: 120 }, // magenta-pink
	{ r: 60, g: 30, b: 140 }, // violet
	{ r: 100, g: 60, b: 200 }, // lavender
	{ r: 30, g: 80, b: 160 }, // royal blue
	{ r: 180, g: 60, b: 160 }, // hot pink
	{ r: 50, g: 50, b: 120 } // dark indigo
];

class Cloud {
	constructor() {
		this.reset(true);
	}

	reset(initial = false) {
		this.x = Math.random() * width;
		this.y = Math.random() * height;
		this.radius = 80 + Math.random() * 200;
		this.baseRadius = this.radius;
		this.vx = (Math.random() - 0.5) * 0.15;
		this.vy = (Math.random() - 0.5) * 0.1;
		this.color = NEBULA_COLORS[Math.floor(Math.random() * NEBULA_COLORS.length)];
		this.opacity = 0.015 + Math.random() * 0.03;
		this.phase = Math.random() * Math.PI * 2;
		this.pulseSpeed = 0.005 + Math.random() * 0.01;
		this.layers = 2 + Math.floor(Math.random() * 3); // 2-4 sub-layers
		// Dispersion offset from mouse interaction
		this.offsetX = 0;
		this.offsetY = 0;
	}

	update() {
		// Gentle drift
		this.x += this.vx;
		this.y += this.vy;

		// Breathing pulse
		this.radius = this.baseRadius + Math.sin(time * this.pulseSpeed + this.phase) * 15;

		// Wrap around edges with buffer
		const buffer = this.radius * 2;
		if (this.x < -buffer) this.x = width + buffer;
		if (this.x > width + buffer) this.x = -buffer;
		if (this.y < -buffer) this.y = height + buffer;
		if (this.y > height + buffer) this.y = -buffer;

		// Mouse dispersal
		const dx = this.x + this.offsetX - mouse.x;
		const dy = this.y + this.offsetY - mouse.y;
		const dist = Math.sqrt(dx * dx + dy * dy);

		if (dist < MOUSE_RADIUS && dist > 0) {
			const force = (1 - dist / MOUSE_RADIUS) * MOUSE_FORCE;
			this.offsetX += (dx / dist) * force;
			this.offsetY += (dy / dist) * force;
		}

		// Smoothly return offset to zero
		this.offsetX *= 0.97;
		this.offsetY *= 0.97;
	}

	draw() {
		const drawX = this.x + this.offsetX;
		const drawY = this.y + this.offsetY;
		const { r, g, b } = this.color;

		// Draw multiple concentric layers for soft cloud effect
		for (let i = this.layers; i >= 0; i--) {
			const layerRadius = this.radius * (0.4 + i * 0.25);
			const layerOpacity = this.opacity * (1 - i * 0.2);

			const gradient = ctx.createRadialGradient(drawX, drawY, 0, drawX, drawY, layerRadius);
			gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${layerOpacity})`);
			gradient.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, ${layerOpacity * 0.6})`);
			gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

			ctx.beginPath();
			ctx.arc(drawX, drawY, layerRadius, 0, Math.PI * 2);
			ctx.fillStyle = gradient;
			ctx.fill();
		}
	}
}

function initClouds() {
	clouds = [];
	for (let i = 0; i < CLOUD_COUNT; i++) {
		clouds.push(new Cloud());
	}
}

function startAnimation() {
	function render() {
		if (!ctx) return;
		ctx.clearRect(0, 0, width, height);

		time += 1;

		// Sort by radius for depth ordering (smaller = further back)
		clouds.sort((a, b) => a.baseRadius - b.baseRadius);

		for (const cloud of clouds) {
			cloud.update();
			cloud.draw();
		}

		requestAnimationFrame(render);
	}
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
			initClouds();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initClouds();
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};
