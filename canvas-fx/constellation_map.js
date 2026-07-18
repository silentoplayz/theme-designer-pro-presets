/**
 * Title: Constellation Map
 * Description: Randomly placed stars that form connection lines (like constellation patterns)
 *              to nearby stars within a threshold distance. Stars slowly drift across the canvas.
 *              Mouse creates a gravitational pull that attracts nearby stars.
 *              Connection line opacity is based on inter-star distance.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let stars = [];

const STAR_COUNT = 120;
const CONNECTION_DIST = 150;
const MOUSE_RADIUS = 250;
const MOUSE_GRAVITY = 0.015;

// Keep worker alive
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

class Star {
	constructor() {
		this.init();
	}

	init() {
		this.x = Math.random() * width;
		this.y = Math.random() * height;
		this.vx = (Math.random() - 0.5) * 0.2;
		this.vy = (Math.random() - 0.5) * 0.2;
		this.size = 0.8 + Math.random() * 1.8;
		this.brightness = 0.3 + Math.random() * 0.7;
		// Subtle twinkle
		this.twinkleSpeed = 0.02 + Math.random() * 0.03;
		this.twinklePhase = Math.random() * Math.PI * 2;
		this.twinkleAmount = 0.1 + Math.random() * 0.3;
		// Slight color variation (white to pale blue/gold)
		const hueRoll = Math.random();
		if (hueRoll < 0.6) {
			this.color = { r: 220, g: 230, b: 255 }; // pale blue-white
		} else if (hueRoll < 0.8) {
			this.color = { r: 255, g: 240, b: 200 }; // warm white
		} else {
			this.color = { r: 200, g: 220, b: 255 }; // blue
		}
	}

	update(time) {
		// Gravitational pull from mouse
		const dx = mouse.x - this.x;
		const dy = mouse.y - this.y;
		const dist = Math.sqrt(dx * dx + dy * dy);

		if (dist < MOUSE_RADIUS && dist > 5) {
			const force = (1 - dist / MOUSE_RADIUS) * MOUSE_GRAVITY;
			this.vx += (dx / dist) * force;
			this.vy += (dy / dist) * force;
		}

		// Apply velocity with damping
		this.x += this.vx;
		this.y += this.vy;
		this.vx *= 0.995;
		this.vy *= 0.995;

		// Wrap around edges
		if (this.x < -20) this.x = width + 20;
		if (this.x > width + 20) this.x = -20;
		if (this.y < -20) this.y = height + 20;
		if (this.y > height + 20) this.y = -20;

		// Twinkle
		this.currentBrightness =
			this.brightness + Math.sin(time * this.twinkleSpeed + this.twinklePhase) * this.twinkleAmount;
		this.currentBrightness = Math.max(0.1, Math.min(1, this.currentBrightness));
	}

	draw() {
		const { r, g, b } = this.color;
		const alpha = this.currentBrightness * 0.8;

		// Star glow
		ctx.beginPath();
		ctx.arc(this.x, this.y, this.size * 3, 0, Math.PI * 2);
		ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.08})`;
		ctx.fill();

		// Star core
		ctx.beginPath();
		ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
		ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
		ctx.fill();
	}
}

function initStars() {
	stars = [];
	for (let i = 0; i < STAR_COUNT; i++) {
		stars.push(new Star());
	}
}

function drawConnections() {
	for (let i = 0; i < stars.length; i++) {
		// Limit connections per star to avoid visual clutter
		let connections = 0;
		for (let j = i + 1; j < stars.length; j++) {
			if (connections >= 3) break;

			const dx = stars[i].x - stars[j].x;
			const dy = stars[i].y - stars[j].y;
			const dist = Math.sqrt(dx * dx + dy * dy);

			if (dist < CONNECTION_DIST) {
				const opacity = (1 - dist / CONNECTION_DIST) * 0.15;
				ctx.beginPath();
				ctx.moveTo(stars[i].x, stars[i].y);
				ctx.lineTo(stars[j].x, stars[j].y);
				ctx.strokeStyle = `rgba(180, 200, 255, ${opacity})`;
				ctx.lineWidth = 0.5;
				ctx.stroke();
				connections++;
			}
		}
	}
}

function drawMouseConnections() {
	if (mouse.x < -1000) return;

	for (const star of stars) {
		const dx = star.x - mouse.x;
		const dy = star.y - mouse.y;
		const dist = Math.sqrt(dx * dx + dy * dy);

		if (dist < MOUSE_RADIUS * 0.6) {
			const opacity = (1 - dist / (MOUSE_RADIUS * 0.6)) * 0.1;
			ctx.beginPath();
			ctx.moveTo(mouse.x, mouse.y);
			ctx.lineTo(star.x, star.y);
			ctx.strokeStyle = `rgba(160, 200, 255, ${opacity})`;
			ctx.lineWidth = 0.3;
			ctx.stroke();
		}
	}
}

let time = 0;

function startAnimation() {
	function render() {
		if (!ctx) return;
		ctx.clearRect(0, 0, width, height);

		time += 1;

		// Update all stars
		for (const star of stars) {
			star.update(time);
		}

		// Draw constellation lines
		drawConnections();
		drawMouseConnections();

		// Draw stars on top
		for (const star of stars) {
			star.draw();
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
			initStars();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initStars();
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};
