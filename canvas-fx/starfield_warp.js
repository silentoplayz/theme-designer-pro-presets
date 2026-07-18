/**
 * Title: Starfield Warp
 * Description: A classic starfield effect where stars fly toward the viewer from the center.
 *              Stars have trails and speed up when the mouse is near them.
 *              Deep space feel with white/blue stars of varying sizes.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let stars = [];
const STAR_COUNT = 280;
const BASE_SPEED = 0.4;
const MAX_SPEED = 2.5;
const TRAIL_LENGTH = 0.6;

// Keep worker alive
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

class Star {
	constructor() {
		this.reset();
	}

	reset() {
		// Place star at random position in 3D space, projected from center
		this.x = (Math.random() - 0.5) * width * 2;
		this.y = (Math.random() - 0.5) * height * 2;
		this.z = Math.random() * 1500 + 500;
		this.pz = this.z; // previous z for trail
		this.size = Math.random() * 1.8 + 0.4;
		// Color: white to pale blue
		const blue = Math.random();
		if (blue < 0.3) {
			this.color = { r: 180, g: 200, b: 255 }; // blue-ish
		} else if (blue < 0.5) {
			this.color = { r: 200, g: 220, b: 255 }; // light blue
		} else {
			this.color = { r: 240, g: 245, b: 255 }; // near white
		}
	}

	update(speed) {
		this.pz = this.z;
		this.z -= speed;
		if (this.z <= 1) {
			this.reset();
			this.z = 1500;
			this.pz = this.z;
		}
	}

	draw() {
		const cx = width / 2;
		const cy = height / 2;

		// Current projected position
		const sx = (this.x / this.z) * cx + cx;
		const sy = (this.y / this.z) * cy + cy;

		// Previous projected position (for trail)
		const px = (this.x / this.pz) * cx + cx;
		const py = (this.y / this.pz) * cy + cy;

		// Size scales with proximity
		const r = Math.max(0.3, (1 - this.z / 1500) * this.size * 2.5);

		// Brightness scales with proximity
		const brightness = Math.min(1, (1 - this.z / 1500) * 1.5);
		const alpha = brightness * 0.85;

		const { r: cr, g: cg, b: cb } = this.color;

		// Draw trail
		if (Math.abs(sx - px) > 0.5 || Math.abs(sy - py) > 0.5) {
			ctx.beginPath();
			ctx.moveTo(px, py);
			ctx.lineTo(sx, sy);
			ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${alpha * TRAIL_LENGTH})`;
			ctx.lineWidth = r * 0.6;
			ctx.stroke();
		}

		// Draw star point
		ctx.beginPath();
		ctx.arc(sx, sy, r, 0, Math.PI * 2);
		ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${alpha})`;
		ctx.fill();

		// Glow for close stars
		if (brightness > 0.6) {
			ctx.beginPath();
			ctx.arc(sx, sy, r * 2.5, 0, Math.PI * 2);
			ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${alpha * 0.15})`;
			ctx.fill();
		}

		return { sx, sy };
	}
}

function initStars() {
	stars = [];
	for (let i = 0; i < STAR_COUNT; i++) {
		stars.push(new Star());
	}
}

function startAnimation() {
	function render() {
		if (!ctx) return;
		// Slight fade for persistence effect
		ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
		ctx.fillRect(0, 0, width, height);

		const cx = width / 2;
		const cy = height / 2;

		for (const star of stars) {
			// Project current position to check mouse distance
			const sx = (star.x / star.z) * cx + cx;
			const sy = (star.y / star.z) * cy + cy;

			const dx = mouse.x - sx;
			const dy = mouse.y - sy;
			const dist = Math.sqrt(dx * dx + dy * dy);

			// Speed up stars near mouse
			const mouseInfluence = Math.max(0, 1 - dist / 250);
			const speed = BASE_SPEED + mouseInfluence * (MAX_SPEED - BASE_SPEED);

			star.update(speed * 8);
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
			ctx.fillStyle = '#000';
			ctx.fillRect(0, 0, width, height);
			initStars();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			ctx.fillStyle = '#000';
			ctx.fillRect(0, 0, width, height);
			initStars();
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};
