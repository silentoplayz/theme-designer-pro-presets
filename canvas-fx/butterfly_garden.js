/**
 * Title: Butterfly Garden
 * Description: A magical garden with colorful butterflies that flutter around.
 *   Move your mouse near butterflies to attract them into a gentle, playful swarm.
 *   Features realistic wing-flapping, sparkle trails, floating pollen, and tiny flowers.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let time = 0;
let butterflies = [];
let sparkles = [];
let flowers = [];
let pollen = [];

const CONFIG = {
	butterflyCount: 25,
	sparkleCount: 40,
	flowerCount: 18,
	pollenCount: 30,
	attractRadius: 200,
	attractForce: 0.08,
	wanderSpeed: 0.8,
	wingFlapSpeed: 6,
	sparkleTrailLife: 40,
	sparkleTrailInterval: 4,
	wingColors: [
		{ h1: 320, h2: 280, name: 'pink-purple' },
		{ h1: 270, h2: 240, name: 'purple-blue' },
		{ h1: 200, h2: 260, name: 'blue-violet' },
		{ h1: 30, h2: 50, name: 'orange-yellow' },
		{ h1: 340, h2: 20, name: 'rose-coral' },
		{ h1: 50, h2: 80, name: 'gold-lime' },
		{ h1: 180, h2: 220, name: 'teal-blue' },
		{ h1: 290, h2: 330, name: 'violet-pink' },
	],
	flowerColors: [
		'#ff6b9d', '#c084fc', '#60a5fa', '#fbbf24',
		'#fb923c', '#f472b6', '#a78bfa', '#34d399',
	],
};

setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

function rand(a, b) { return Math.random() * (b - a) + a; }
function lerp(a, b, t) { return a + (b - a) * t; }
function dist(x1, y1, x2, y2) {
	const dx = x2 - x1, dy = y2 - y1;
	return Math.sqrt(dx * dx + dy * dy);
}

// ─── Sparkle Trail Particle ────────────────────────────────────────
class SparkleTrail {
	constructor(x, y, hue) {
		this.x = x + rand(-3, 3);
		this.y = y + rand(-3, 3);
		this.vx = rand(-0.3, 0.3);
		this.vy = rand(-0.6, -0.1);
		this.life = CONFIG.sparkleTrailLife;
		this.maxLife = this.life;
		this.size = rand(1, 2.5);
		this.hue = hue + rand(-20, 20);
	}

	update() {
		this.x += this.vx;
		this.y += this.vy;
		this.vy -= 0.005;
		this.life--;
	}

	draw(ctx) {
		const alpha = (this.life / this.maxLife) * 0.6;
		if (alpha <= 0) return;
		const s = this.size * (this.life / this.maxLife);
		ctx.save();
		ctx.globalAlpha = alpha;
		ctx.fillStyle = `hsla(${this.hue}, 90%, 80%, 1)`;
		ctx.shadowColor = `hsla(${this.hue}, 100%, 85%, 0.8)`;
		ctx.shadowBlur = 6;
		// Tiny star shape
		ctx.beginPath();
		for (let i = 0; i < 4; i++) {
			const a = (i / 4) * Math.PI * 2 - Math.PI / 4;
			const ox = Math.cos(a) * s;
			const oy = Math.sin(a) * s;
			if (i === 0) ctx.moveTo(this.x + ox, this.y + oy);
			else ctx.lineTo(this.x + ox, this.y + oy);
			const midA = a + Math.PI / 4;
			ctx.lineTo(this.x + Math.cos(midA) * s * 0.35, this.y + Math.sin(midA) * s * 0.35);
		}
		ctx.closePath();
		ctx.fill();
		ctx.restore();
	}

	get alive() { return this.life > 0; }
}

// ─── Floating Pollen / Sparkle ─────────────────────────────────────
class Pollen {
	constructor() { this.reset(); }

	reset() {
		this.x = rand(0, width || 800);
		this.y = rand(0, height || 600);
		this.vy = rand(-0.4, -0.1);
		this.vx = rand(-0.2, 0.2);
		this.size = rand(1, 3);
		this.alpha = rand(0.15, 0.5);
		this.phase = rand(0, Math.PI * 2);
		this.drift = rand(0.3, 0.8);
		this.hue = rand(40, 70); // warm golden
	}

	update() {
		this.x += this.vx + Math.sin(time * 0.5 + this.phase) * this.drift * 0.3;
		this.y += this.vy;
		if (this.y < -10) { this.y = height + 10; this.x = rand(0, width); }
		if (this.x < -10) this.x = width + 10;
		if (this.x > width + 10) this.x = -10;
	}

	draw(ctx) {
		const pulse = 0.7 + 0.3 * Math.sin(time * 2 + this.phase);
		ctx.save();
		ctx.globalAlpha = this.alpha * pulse;
		const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.size * 2);
		grad.addColorStop(0, `hsla(${this.hue}, 100%, 90%, 1)`);
		grad.addColorStop(1, `hsla(${this.hue}, 100%, 80%, 0)`);
		ctx.fillStyle = grad;
		ctx.beginPath();
		ctx.arc(this.x, this.y, this.size * 2, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	}
}

// ─── Ground Flower ─────────────────────────────────────────────────
class Flower {
	constructor() {
		this.x = rand(20, (width || 800) - 20);
		this.y = (height || 600) - rand(5, 40);
		this.petalCount = Math.floor(rand(5, 8));
		this.petalSize = rand(5, 10);
		this.color = CONFIG.flowerColors[Math.floor(rand(0, CONFIG.flowerColors.length))];
		this.centerColor = `hsl(${rand(40, 60)}, 100%, 65%)`;
		this.stemHeight = rand(15, 35);
		this.phase = rand(0, Math.PI * 2);
		this.alpha = rand(0.4, 0.7);
	}

	draw(ctx) {
		const sway = Math.sin(time * 0.5 + this.phase) * 3;
		ctx.save();
		ctx.globalAlpha = this.alpha;

		// Stem
		ctx.strokeStyle = 'hsla(120, 50%, 35%, 0.6)';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo(this.x, this.y);
		ctx.quadraticCurveTo(this.x + sway, this.y - this.stemHeight * 0.5, this.x + sway * 0.5, this.y - this.stemHeight);
		ctx.stroke();

		const fx = this.x + sway * 0.5;
		const fy = this.y - this.stemHeight;

		// Petals
		for (let i = 0; i < this.petalCount; i++) {
			const angle = (i / this.petalCount) * Math.PI * 2;
			const px = fx + Math.cos(angle) * this.petalSize * 0.7;
			const py = fy + Math.sin(angle) * this.petalSize * 0.7;
			ctx.beginPath();
			ctx.arc(px, py, this.petalSize * 0.45, 0, Math.PI * 2);
			ctx.fillStyle = this.color;
			ctx.fill();
		}

		// Center
		ctx.beginPath();
		ctx.arc(fx, fy, this.petalSize * 0.3, 0, Math.PI * 2);
		ctx.fillStyle = this.centerColor;
		ctx.fill();

		ctx.restore();
	}
}

// ─── Butterfly ─────────────────────────────────────────────────────
class Butterfly {
	constructor() {
		this.x = rand(50, (width || 800) - 50);
		this.y = rand(50, (height || 600) - 100);
		this.vx = rand(-0.5, 0.5);
		this.vy = rand(-0.5, 0.5);
		this.size = rand(10, 18);
		this.angle = rand(0, Math.PI * 2);
		this.angularVel = 0;
		this.flapPhase = rand(0, Math.PI * 2);
		this.flapSpeed = rand(CONFIG.wingFlapSpeed * 0.8, CONFIG.wingFlapSpeed * 1.2);
		this.wanderAngle = rand(0, Math.PI * 2);
		this.wanderVel = 0;
		this.palette = CONFIG.wingColors[Math.floor(rand(0, CONFIG.wingColors.length))];
		this.lightness = rand(55, 75);
		this.sparkleTimer = 0;
		this.bobPhase = rand(0, Math.PI * 2);
		this.bobAmount = rand(0.3, 0.8);
		// Flight direction for perspective
		this.heading = rand(0, Math.PI * 2);
	}

	update() {
		const dx = mouse.x - this.x;
		const dy = mouse.y - this.y;
		const d = Math.sqrt(dx * dx + dy * dy);

		// Attraction to mouse
		if (d < CONFIG.attractRadius && d > 20) {
			const force = CONFIG.attractForce * (1 - d / CONFIG.attractRadius);
			this.vx += (dx / d) * force;
			this.vy += (dy / d) * force;
			// Flap faster near mouse (excited)
			this.flapPhase += 0.02;
		} else if (d <= 20 && d > 0) {
			// Too close — gentle repel
			this.vx -= (dx / d) * 0.1;
			this.vy -= (dy / d) * 0.1;
		}

		// Random wandering
		this.wanderVel += rand(-0.06, 0.06);
		this.wanderVel *= 0.9;
		this.wanderAngle += this.wanderVel;
		const wx = Math.cos(this.wanderAngle) * CONFIG.wanderSpeed * 0.3;
		const wy = Math.sin(this.wanderAngle) * CONFIG.wanderSpeed * 0.3;
		this.vx += (wx - this.vx) * 0.02;
		this.vy += (wy - this.vy) * 0.02;

		// Vertical bob
		this.vy += Math.sin(time * 1.5 + this.bobPhase) * 0.02 * this.bobAmount;

		// Speed limit
		const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
		const maxSpeed = 2.5;
		if (speed > maxSpeed) {
			this.vx = (this.vx / speed) * maxSpeed;
			this.vy = (this.vy / speed) * maxSpeed;
		}

		// Damping
		this.vx *= 0.98;
		this.vy *= 0.98;

		this.x += this.vx;
		this.y += this.vy;

		// Update heading based on velocity
		if (speed > 0.2) {
			const targetHeading = Math.atan2(this.vy, this.vx);
			let diff = targetHeading - this.heading;
			while (diff > Math.PI) diff -= Math.PI * 2;
			while (diff < -Math.PI) diff += Math.PI * 2;
			this.heading += diff * 0.08;
		}

		// Soft boundary
		const margin = 40;
		if (this.x < margin) this.vx += 0.1;
		if (this.x > width - margin) this.vx -= 0.1;
		if (this.y < margin) this.vy += 0.1;
		if (this.y > height - margin - 40) this.vy -= 0.1;

		// Wrap if way off screen
		if (this.x < -80) this.x = width + 40;
		if (this.x > width + 80) this.x = -40;
		if (this.y < -80) this.y = height + 40;
		if (this.y > height + 80) this.y = -40;

		// Flap
		this.flapPhase += this.flapSpeed * 0.016;

		// Sparkle trail
		this.sparkleTimer++;
		if (this.sparkleTimer >= CONFIG.sparkleTrailInterval) {
			this.sparkleTimer = 0;
			sparkles.push(new SparkleTrail(this.x, this.y, this.palette.h1));
		}
	}

	draw(ctx) {
		const flap = Math.sin(this.flapPhase);
		// Perspective: wings appear narrower when heading horizontally
		const perspX = Math.cos(this.heading);
		const perspScale = 0.3 + 0.7 * Math.abs(Math.sin(this.heading));

		ctx.save();
		ctx.translate(this.x, this.y);
		// Tilt body slightly in direction of movement
		ctx.rotate(this.heading * 0.15);

		// === Draw Wings ===
		const wingSpan = this.size;
		// Flap creates a scale along the x-axis for each wing
		const flapScale = flap; // -1 to 1

		// Upper wings (larger)
		this.drawWing(ctx, -1, wingSpan * 1.0, wingSpan * 1.3, flapScale, perspScale, true);
		this.drawWing(ctx, 1, wingSpan * 1.0, wingSpan * 1.3, flapScale, perspScale, true);

		// Lower wings (smaller, slightly behind)
		this.drawWing(ctx, -1, wingSpan * 0.65, wingSpan * 0.85, flapScale * 0.8, perspScale, false);
		this.drawWing(ctx, 1, wingSpan * 0.65, wingSpan * 0.85, flapScale * 0.8, perspScale, false);

		// === Body ===
		ctx.beginPath();
		ctx.ellipse(0, 0, 1.5, this.size * 0.35, 0, 0, Math.PI * 2);
		ctx.fillStyle = `hsla(${this.palette.h1}, 30%, 20%, 0.9)`;
		ctx.fill();

		// === Antennae ===
		const antLen = this.size * 0.45;
		ctx.strokeStyle = `hsla(${this.palette.h1}, 30%, 25%, 0.7)`;
		ctx.lineWidth = 0.8;
		for (const side of [-1, 1]) {
			const wave = Math.sin(time * 3 + this.flapPhase + side) * 2;
			ctx.beginPath();
			ctx.moveTo(0, -this.size * 0.25);
			ctx.quadraticCurveTo(
				side * antLen * 0.5 + wave, -this.size * 0.25 - antLen * 0.6,
				side * antLen * 0.6 + wave, -this.size * 0.25 - antLen
			);
			ctx.stroke();
			// Antenna tip
			ctx.beginPath();
			ctx.arc(side * antLen * 0.6 + wave, -this.size * 0.25 - antLen, 1.2, 0, Math.PI * 2);
			ctx.fillStyle = `hsla(${this.palette.h1}, 40%, 30%, 0.7)`;
			ctx.fill();
		}

		ctx.restore();
	}

	drawWing(ctx, side, ww, wh, flapScale, perspScale, isUpper) {
		// side: -1 = left, 1 = right
		const wingWidth = ww * Math.abs(flapScale) * (side === 1 ? perspScale : (2 - perspScale) * 0.5 + 0.5);
		const wingHeight = wh;
		const yOff = isUpper ? -wingHeight * 0.15 : wingHeight * 0.15;

		ctx.save();
		ctx.globalAlpha = 0.55 + 0.3 * Math.abs(flapScale);

		// Wing shape using bezier curves
		ctx.beginPath();
		ctx.moveTo(0, yOff);
		if (isUpper) {
			ctx.bezierCurveTo(
				side * wingWidth * 0.4, yOff - wingHeight * 0.7,
				side * wingWidth * 1.0, yOff - wingHeight * 0.6,
				side * wingWidth, yOff - wingHeight * 0.1
			);
			ctx.bezierCurveTo(
				side * wingWidth * 0.9, yOff + wingHeight * 0.2,
				side * wingWidth * 0.3, yOff + wingHeight * 0.15,
				0, yOff
			);
		} else {
			ctx.bezierCurveTo(
				side * wingWidth * 0.5, yOff + wingHeight * 0.6,
				side * wingWidth * 0.95, yOff + wingHeight * 0.7,
				side * wingWidth * 0.7, yOff + wingHeight * 0.2
			);
			ctx.bezierCurveTo(
				side * wingWidth * 0.4, yOff - wingHeight * 0.05,
				side * wingWidth * 0.15, yOff - wingHeight * 0.05,
				0, yOff
			);
		}
		ctx.closePath();

		// Gradient fill
		const gx1 = 0, gy1 = yOff;
		const gx2 = side * wingWidth, gy2 = yOff;
		const grad = ctx.createLinearGradient(gx1, gy1, gx2, gy2);
		const h1 = this.palette.h1, h2 = this.palette.h2;
		const L = this.lightness;
		grad.addColorStop(0, `hsla(${h1}, 85%, ${L}%, 0.9)`);
		grad.addColorStop(0.4, `hsla(${lerp(h1, h2, 0.4)}, 90%, ${L + 5}%, 0.85)`);
		grad.addColorStop(0.7, `hsla(${h2}, 80%, ${L + 10}%, 0.75)`);
		grad.addColorStop(1, `hsla(${h2}, 70%, ${L + 15}%, 0.5)`);
		ctx.fillStyle = grad;
		ctx.fill();

		// Wing vein pattern — subtle inner line
		ctx.strokeStyle = `hsla(${h1}, 50%, ${L - 15}%, 0.2)`;
		ctx.lineWidth = 0.5;
		ctx.beginPath();
		ctx.moveTo(0, yOff);
		ctx.lineTo(side * wingWidth * 0.6, yOff + (isUpper ? -wingHeight * 0.35 : wingHeight * 0.35));
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(0, yOff);
		ctx.lineTo(side * wingWidth * 0.7, yOff + (isUpper ? -wingHeight * 0.1 : wingHeight * 0.15));
		ctx.stroke();

		// Spot decorations on upper wings
		if (isUpper) {
			const sx = side * wingWidth * 0.55;
			const sy = yOff - wingHeight * 0.3;
			const spotR = wingWidth * 0.12;
			const spotGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, spotR);
			spotGrad.addColorStop(0, `hsla(${h2 + 30}, 90%, 90%, 0.6)`);
			spotGrad.addColorStop(1, `hsla(${h2}, 80%, 70%, 0)`);
			ctx.beginPath();
			ctx.arc(sx, sy, spotR, 0, Math.PI * 2);
			ctx.fillStyle = spotGrad;
			ctx.fill();
		}

		// Wing edge glow
		ctx.strokeStyle = `hsla(${h1}, 70%, ${L + 20}%, 0.15)`;
		ctx.lineWidth = 1;
		ctx.stroke();

		ctx.restore();
	}
}

// ─── Scene Init ────────────────────────────────────────────────────
function initScene() {
	butterflies = [];
	sparkles = [];
	flowers = [];
	pollen = [];

	for (let i = 0; i < CONFIG.butterflyCount; i++) {
		butterflies.push(new Butterfly());
	}
	for (let i = 0; i < CONFIG.flowerCount; i++) {
		flowers.push(new Flower());
	}
	for (let i = 0; i < CONFIG.pollenCount; i++) {
		pollen.push(new Pollen());
	}
}

// ─── Render Loop ───────────────────────────────────────────────────
function startAnimation() {
	function render() {
		if (!ctx) return;
		time += 0.016;
		ctx.clearRect(0, 0, width, height);

		// Draw flowers (background layer)
		for (const f of flowers) {
			f.draw(ctx);
		}

		// Update and draw pollen
		for (const p of pollen) {
			p.update();
			p.draw(ctx);
		}

		// Update and draw sparkle trails
		for (let i = sparkles.length - 1; i >= 0; i--) {
			sparkles[i].update();
			sparkles[i].draw(ctx);
			if (!sparkles[i].alive) sparkles.splice(i, 1);
		}

		// Cap sparkles to prevent memory issues
		if (sparkles.length > 300) {
			sparkles.splice(0, sparkles.length - 300);
		}

		// Update and draw butterflies
		for (const b of butterflies) {
			b.update();
			b.draw(ctx);
		}

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}

// ─── Worker Message Handler ────────────────────────────────────────
self.onmessage = (e) => {
	switch (e.data.type) {
		case 'init':
			canvas = e.data.canvas;
			ctx = canvas.getContext('2d');
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initScene();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initScene();
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};
