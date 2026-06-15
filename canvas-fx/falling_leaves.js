/**
 * Title: Falling Leaves
 * Description: Leaves of various sizes and muted autumn colors (amber, rust, gold, olive)
 *   tumble and spiral downward with realistic rotation and swaying. They drift horizontally.
 *   Mouse creates an updraft that blows nearby leaves upward.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let leaves = [];
let time = 0;

const MAX_LEAVES = 50;

// Autumn palette — muted, warm tones
const LEAF_COLORS = [
	{ fill: [200, 120, 40], stroke: [170, 90, 30] }, // Amber
	{ fill: [180, 70, 40], stroke: [150, 50, 30] }, // Rust
	{ fill: [210, 170, 50], stroke: [180, 140, 40] }, // Gold
	{ fill: [130, 140, 50], stroke: [100, 110, 40] }, // Olive
	{ fill: [190, 90, 35], stroke: [160, 65, 25] }, // Burnt orange
	{ fill: [160, 50, 35], stroke: [130, 35, 25] } // Deep rust
];

// Keep worker alive
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

class Leaf {
	constructor() {
		this.reset(true);
	}

	reset(randomY = false) {
		this.x = Math.random() * (width || 800);
		this.y = randomY ? Math.random() * (height || 600) : -20 - Math.random() * 80;
		this.size = 4 + Math.random() * 10;
		this.rotation = Math.random() * Math.PI * 2;
		this.rotationSpeed = (Math.random() - 0.5) * 0.03;
		this.vx = (Math.random() - 0.5) * 0.5;
		this.vy = 0.3 + Math.random() * 0.8;
		// Sway parameters — sinusoidal horizontal drift
		this.swayAmplitude = 0.3 + Math.random() * 0.8;
		this.swayFrequency = 0.01 + Math.random() * 0.02;
		this.swayPhase = Math.random() * Math.PI * 2;
		// Tumble — 3D rotation effect via scale modulation
		this.tumblePhase = Math.random() * Math.PI * 2;
		this.tumbleSpeed = 0.015 + Math.random() * 0.025;
		// Visual
		const palette = LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)];
		this.fillColor = palette.fill;
		this.strokeColor = palette.stroke;
		this.opacity = 0.12 + Math.random() * 0.18;
		// Leaf shape variant
		this.shapeType = Math.floor(Math.random() * 3); // 0: simple, 1: pointed, 2: round
		this.stemLength = this.size * (0.4 + Math.random() * 0.3);
	}

	update(t) {
		// Horizontal sway
		const sway = Math.sin(t * this.swayFrequency + this.swayPhase) * this.swayAmplitude;
		this.vx += (sway - this.vx) * 0.02;

		// Mouse updraft effect
		const dx = this.x - mouse.x;
		const dy = this.y - mouse.y;
		const distSq = dx * dx + dy * dy;
		const updraftRadius = 180;
		if (distSq < updraftRadius * updraftRadius && distSq > 0) {
			const dist = Math.sqrt(distSq);
			const strength = 1 - dist / updraftRadius;
			// Blow upward and outward
			this.vy -= strength * 0.4;
			this.vx += (dx / dist) * strength * 0.3;
			// Spin faster near mouse
			this.rotationSpeed += strength * 0.005 * Math.sign(this.rotationSpeed);
		}

		// Gravity
		this.vy += 0.005;
		// Terminal velocity
		this.vy = Math.min(this.vy, 2);
		this.vx *= 0.995;

		this.x += this.vx;
		this.y += this.vy;

		// Rotation and tumble
		this.rotation += this.rotationSpeed;
		this.tumblePhase += this.tumbleSpeed;

		// Off-screen reset
		if (this.y > (height || 600) + 30 || this.x < -50 || this.x > (width || 800) + 50) {
			this.reset(false);
		}
	}

	draw(ctx) {
		const s = this.size;
		// 3D tumble effect — scale X by cosine to simulate rotation in depth
		const tumbleScale = 0.3 + 0.7 * Math.abs(Math.cos(this.tumblePhase));

		ctx.save();
		ctx.translate(this.x, this.y);
		ctx.rotate(this.rotation);
		ctx.scale(tumbleScale, 1);

		const [fr, fg, fb] = this.fillColor;
		const [sr, sg, sb] = this.strokeColor;

		// Draw leaf body
		ctx.beginPath();
		if (this.shapeType === 0) {
			// Simple oval leaf
			ctx.ellipse(0, 0, s * 0.5, s, 0, 0, Math.PI * 2);
		} else if (this.shapeType === 1) {
			// Pointed leaf
			ctx.moveTo(0, -s);
			ctx.quadraticCurveTo(s * 0.6, -s * 0.3, s * 0.4, s * 0.3);
			ctx.quadraticCurveTo(0, s * 0.8, 0, s);
			ctx.quadraticCurveTo(0, s * 0.8, -s * 0.4, s * 0.3);
			ctx.quadraticCurveTo(-s * 0.6, -s * 0.3, 0, -s);
		} else {
			// Round maple-ish leaf
			ctx.moveTo(0, -s * 0.9);
			ctx.bezierCurveTo(s * 0.8, -s * 0.6, s * 0.5, s * 0.2, s * 0.3, s * 0.5);
			ctx.quadraticCurveTo(0, s * 0.9, -s * 0.3, s * 0.5);
			ctx.bezierCurveTo(-s * 0.5, s * 0.2, -s * 0.8, -s * 0.6, 0, -s * 0.9);
		}
		ctx.closePath();
		ctx.fillStyle = `rgba(${fr}, ${fg}, ${fb}, ${this.opacity})`;
		ctx.fill();
		ctx.strokeStyle = `rgba(${sr}, ${sg}, ${sb}, ${this.opacity * 0.6})`;
		ctx.lineWidth = 0.5;
		ctx.stroke();

		// Center vein
		ctx.beginPath();
		ctx.moveTo(0, -s * 0.7);
		ctx.lineTo(0, s * 0.6);
		ctx.strokeStyle = `rgba(${sr}, ${sg}, ${sb}, ${this.opacity * 0.4})`;
		ctx.lineWidth = 0.4;
		ctx.stroke();

		// Stem
		ctx.beginPath();
		ctx.moveTo(0, s * 0.6);
		ctx.lineTo(0, s * 0.6 + this.stemLength);
		ctx.strokeStyle = `rgba(${sr}, ${sg}, ${sb}, ${this.opacity * 0.5})`;
		ctx.lineWidth = 0.6;
		ctx.stroke();

		ctx.restore();
	}
}

function initLeaves() {
	leaves = [];
	for (let i = 0; i < MAX_LEAVES; i++) {
		leaves.push(new Leaf());
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
			initLeaves();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initLeaves();
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

		for (const leaf of leaves) {
			leaf.update(time);
			leaf.draw(ctx);
		}

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}
