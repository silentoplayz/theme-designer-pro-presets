/**
 * Title: Lava Lamp
 * Description: Large, soft, amorphous blobs that slowly rise, merge, split,
 *   and sink like a lava lamp. Warm colors (deep reds, oranges, magentas)
 *   with very low opacity and heavy blur. Mouse attracts nearby blobs.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let blobs = [];
let time = 0;

const BLOB_COUNT = 12;
const MOUSE_ATTRACT_RADIUS = 250;
const MOUSE_ATTRACT_STRENGTH = 0.4;

// Heartbeat to keep worker alive
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

// Warm color palette: deep reds, oranges, magentas
const COLORS = [
	{ r: 180, g: 30, b: 20 }, // deep red
	{ r: 200, g: 60, b: 10 }, // burnt orange
	{ r: 160, g: 20, b: 80 }, // magenta
	{ r: 220, g: 80, b: 20 }, // orange
	{ r: 140, g: 10, b: 50 }, // dark crimson
	{ r: 190, g: 40, b: 60 } // rose red
];

class Blob {
	constructor() {
		this.reset();
	}

	reset() {
		this.x = Math.random() * width;
		this.y = Math.random() * height;
		this.radius = 60 + Math.random() * 100;
		this.baseRadius = this.radius;
		this.vx = (Math.random() - 0.5) * 0.3;
		this.vy = -0.2 - Math.random() * 0.5; // drift upward
		this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
		this.phase = Math.random() * Math.PI * 2;
		this.pulseSpeed = 0.005 + Math.random() * 0.01;
		this.wobbleAmpX = 0.3 + Math.random() * 0.5;
		this.wobbleAmpY = 0.2 + Math.random() * 0.3;
		this.wobbleFreqX = 0.008 + Math.random() * 0.006;
		this.wobbleFreqY = 0.006 + Math.random() * 0.008;
		this.alpha = 0.04 + Math.random() * 0.06;
	}

	update() {
		// Slow organic drift
		this.x += this.vx + Math.sin(time * this.wobbleFreqX + this.phase) * this.wobbleAmpX;
		this.y += this.vy + Math.cos(time * this.wobbleFreqY + this.phase) * this.wobbleAmpY;

		// Pulsing radius
		this.radius = this.baseRadius + Math.sin(time * this.pulseSpeed + this.phase) * 20;

		// Mouse attraction
		const dx = mouse.x - this.x;
		const dy = mouse.y - this.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist < MOUSE_ATTRACT_RADIUS && dist > 1) {
			const force = (1 - dist / MOUSE_ATTRACT_RADIUS) * MOUSE_ATTRACT_STRENGTH;
			this.x += (dx / dist) * force;
			this.y += (dy / dist) * force;
		}

		// Wrap around vertically — blobs that rise off top reappear at bottom
		if (this.y + this.radius < -50) {
			this.y = height + this.radius + 50;
			this.x = Math.random() * width;
		}
		// Occasionally sink back down (some blobs drift downward)
		if (this.y - this.radius > height + 100) {
			this.y = -this.radius - 50;
			this.x = Math.random() * width;
		}

		// Soft horizontal bounds
		if (this.x < -this.radius * 2) this.x = width + this.radius;
		if (this.x > width + this.radius * 2) this.x = -this.radius;
	}

	draw() {
		const { r, g, b } = this.color;

		// Draw multiple layered radial gradients for a soft, blurred look
		for (let layer = 0; layer < 3; layer++) {
			const layerScale = 1 + layer * 0.4;
			const layerAlpha = this.alpha / (layer + 1);
			const rad = this.radius * layerScale;

			const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, rad);
			gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${layerAlpha})`);
			gradient.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, ${layerAlpha * 0.6})`);
			gradient.addColorStop(0.7, `rgba(${r}, ${g}, ${b}, ${layerAlpha * 0.2})`);
			gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

			ctx.beginPath();
			ctx.arc(this.x, this.y, rad, 0, Math.PI * 2);
			ctx.fillStyle = gradient;
			ctx.fill();
		}
	}
}

function initBlobs() {
	blobs = [];
	for (let i = 0; i < BLOB_COUNT; i++) {
		blobs.push(new Blob());
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
			initBlobs();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initBlobs();
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

		// Soft fade instead of full clear for trailing effect
		ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
		ctx.fillRect(0, 0, width, height);

		time++;

		// Update and draw blobs
		for (const blob of blobs) {
			blob.update();
		}
		for (const blob of blobs) {
			blob.draw();
		}

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}
