/**
 * Title: Ink Bloom
 * Description: Ink-drop-like blooms that slowly expand and diffuse at random
 *   locations, fading out as they grow. Deep, rich colors (indigo, crimson,
 *   emerald) with low opacity. Mouse position influences where new blooms appear.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let blooms = [];
let time = 0;
let lastBloomTime = 0;

const MAX_BLOOMS = 25;
const BLOOM_INTERVAL = 80; // frames between new blooms
const MOUSE_BLOOM_CHANCE = 0.4; // chance a bloom spawns near mouse

// Heartbeat to keep worker alive
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

// Deep, rich color palette
const COLORS = [
	{ r: 40, g: 20, b: 120 }, // deep indigo
	{ r: 150, g: 15, b: 30 }, // crimson
	{ r: 10, g: 100, b: 60 }, // emerald
	{ r: 80, g: 10, b: 110 }, // dark violet
	{ r: 20, g: 60, b: 120 }, // navy blue
	{ r: 120, g: 30, b: 80 }, // plum
	{ r: 10, g: 80, b: 90 } // teal
];

class Bloom {
	constructor(x, y) {
		this.x = x;
		this.y = y;
		this.radius = 2;
		this.maxRadius = 80 + Math.random() * 160;
		this.growthRate = 0.3 + Math.random() * 0.5;
		this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
		this.alpha = 0.08 + Math.random() * 0.05;
		this.maxAlpha = this.alpha;
		this.alive = true;
		this.age = 0;
		this.rotation = Math.random() * Math.PI * 2;
		this.rotationSpeed = (Math.random() - 0.5) * 0.002;
		// Slight organic drift
		this.driftX = (Math.random() - 0.5) * 0.15;
		this.driftY = (Math.random() - 0.5) * 0.15;
		// Number of tendrils for the ink bloom shape
		this.tendrils = 5 + Math.floor(Math.random() * 4);
		this.tendrilPhases = [];
		this.tendrilAmps = [];
		for (let i = 0; i < this.tendrils; i++) {
			this.tendrilPhases.push(Math.random() * Math.PI * 2);
			this.tendrilAmps.push(0.15 + Math.random() * 0.25);
		}
	}

	update() {
		this.age++;
		this.radius += this.growthRate * (1 - this.radius / this.maxRadius);
		this.rotation += this.rotationSpeed;
		this.x += this.driftX;
		this.y += this.driftY;

		// Fade as bloom approaches max size
		const progress = this.radius / this.maxRadius;
		if (progress > 0.5) {
			this.alpha = this.maxAlpha * (1 - (progress - 0.5) * 2);
		}

		if (this.alpha <= 0.001 || this.radius >= this.maxRadius * 0.98) {
			this.alive = false;
		}
	}

	draw() {
		const { r, g, b } = this.color;

		ctx.save();
		ctx.translate(this.x, this.y);
		ctx.rotate(this.rotation);

		// Draw multiple concentric bloom layers for depth
		for (let layer = 0; layer < 4; layer++) {
			const layerScale = 0.4 + layer * 0.2;
			const layerAlpha = this.alpha * (1 - layer * 0.2);
			const rad = this.radius * layerScale;

			if (layerAlpha <= 0) continue;

			// Organic ink shape using overlapping radial gradients with offset
			const offsetX = Math.sin(this.age * 0.02 + layer) * rad * 0.1;
			const offsetY = Math.cos(this.age * 0.02 + layer * 1.5) * rad * 0.1;

			const gradient = ctx.createRadialGradient(offsetX, offsetY, 0, offsetX, offsetY, rad);
			gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${layerAlpha})`);
			gradient.addColorStop(0.3, `rgba(${r}, ${g}, ${b}, ${layerAlpha * 0.7})`);
			gradient.addColorStop(0.6, `rgba(${r}, ${g}, ${b}, ${layerAlpha * 0.3})`);
			gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

			// Draw an organic, ink-like shape
			ctx.beginPath();
			const steps = 60;
			for (let i = 0; i <= steps; i++) {
				const angle = (i / steps) * Math.PI * 2;
				let r2 = rad;
				// Add tendril distortion
				for (let t = 0; t < this.tendrils; t++) {
					r2 +=
						Math.sin(angle * (t + 2) + this.tendrilPhases[t] + this.age * 0.008) *
						rad *
						this.tendrilAmps[t] *
						layerScale;
				}
				const px = Math.cos(angle) * r2;
				const py = Math.sin(angle) * r2;
				if (i === 0) {
					ctx.moveTo(px, py);
				} else {
					ctx.lineTo(px, py);
				}
			}
			ctx.closePath();
			ctx.fillStyle = gradient;
			ctx.fill();
		}

		ctx.restore();
	}
}

function spawnBloom() {
	let x, y;
	const nearMouse = mouse.x > 0 && mouse.y > 0 && Math.random() < MOUSE_BLOOM_CHANCE;

	if (nearMouse) {
		// Spawn near mouse with some scatter
		x = mouse.x + (Math.random() - 0.5) * 200;
		y = mouse.y + (Math.random() - 0.5) * 200;
	} else {
		x = Math.random() * width;
		y = Math.random() * height;
	}

	blooms.push(new Bloom(x, y));
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
			blooms = [];
			// Seed initial blooms
			for (let i = 0; i < 5; i++) {
				spawnBloom();
			}
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
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

		// Slow fade for trailing ink effect
		ctx.fillStyle = 'rgba(0, 0, 0, 0.015)';
		ctx.fillRect(0, 0, width, height);

		time++;

		// Spawn new blooms periodically
		if (time - lastBloomTime > BLOOM_INTERVAL && blooms.length < MAX_BLOOMS) {
			spawnBloom();
			lastBloomTime = time;
		}

		// Update and draw blooms
		for (const bloom of blooms) {
			bloom.update();
			bloom.draw();
		}

		// Remove dead blooms
		blooms = blooms.filter((b) => b.alive);

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}
