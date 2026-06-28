/**
 * Title: Touch Garden
 * Description: An interactive garden where you plant flowers by tapping!
 *   Each click/tap plants a flower that grows from a seed. Drag your finger
 *   or mouse to scatter seed particles. Multi-touch plants multiple flowers
 *   at once. Flowers sway gently in the breeze and butterflies occasionally
 *   flutter between them. Perfect for little ones who love to click!
 *
 *   Showcases: click, touchstart, touchmove, mousemove, mousedown, mouseup
 */

/* ---------- CONFIGURABLE VARIABLES ---------- */
const MAX_FLOWERS         = 30;       // max flowers on screen
const GROW_SPEED          = 0.008;    // how fast flowers grow (0-1)
const BREEZE_STRENGTH     = 0.02;     // sway amount
const SEED_PARTICLE_COUNT = 5;        // particles per drag frame
const BUTTERFLY_COUNT     = 4;        // ambient butterflies
const GROUND_Y_RATIO      = 0.85;    // ground position (% of height)
/* --------------------------------------------- */

let canvas, ctx, w, h;
let mouse = { x: -9999, y: -9999 };
let flowers = [];
let seedParticles = [];
let butterflies = [];
let isDragging = false;
let time = 0;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

const PETAL_COLORS = [
	{ h: 340, s: 80, l: 65 }, // pink
	{ h: 270, s: 70, l: 65 }, // purple
	{ h: 45,  s: 90, l: 60 }, // golden
	{ h: 10,  s: 80, l: 60 }, // red-orange
	{ h: 200, s: 70, l: 60 }, // blue
	{ h: 320, s: 75, l: 70 }, // magenta
	{ h: 30,  s: 85, l: 55 }, // orange
	{ h: 170, s: 60, l: 50 }, // teal
];

function createFlower(x, y) {
	const groundY = h * GROUND_Y_RATIO;
	const plantY = Math.max(y, groundY - 20); // plant at ground level or where clicked
	const color = PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)];

	if (flowers.length >= MAX_FLOWERS) {
		flowers.shift(); // remove oldest
	}

	flowers.push({
		x,
		y: Math.min(plantY, groundY),
		growth: 0,
		maxHeight: 40 + Math.random() * 80,
		stemWidth: 2 + Math.random() * 2,
		petalCount: 5 + Math.floor(Math.random() * 4),
		petalSize: 6 + Math.random() * 10,
		color,
		phase: Math.random() * Math.PI * 2,
		swayOffset: (Math.random() - 0.5) * 0.5
	});
}

function createSeedParticles(x, y) {
	for (let i = 0; i < SEED_PARTICLE_COUNT; i++) {
		seedParticles.push({
			x: x + (Math.random() - 0.5) * 20,
			y: y + (Math.random() - 0.5) * 20,
			vx: (Math.random() - 0.5) * 2,
			vy: -1 - Math.random() * 2,
			size: 1.5 + Math.random() * 2,
			alpha: 0.8,
			hue: 80 + Math.random() * 40 // green-yellow
		});
	}
}

function initButterflies() {
	butterflies = [];
	for (let i = 0; i < BUTTERFLY_COUNT; i++) {
		butterflies.push({
			x: Math.random() * w,
			y: h * 0.3 + Math.random() * h * 0.4,
			vx: (Math.random() - 0.5) * 1.5,
			vy: (Math.random() - 0.5) * 0.5,
			wingPhase: Math.random() * Math.PI * 2,
			wingSpeed: 0.1 + Math.random() * 0.1,
			hue: Math.random() * 360,
			size: 4 + Math.random() * 4,
			targetX: Math.random() * w,
			targetY: h * 0.3 + Math.random() * h * 0.3,
			changeTimer: Math.floor(Math.random() * 200)
		});
	}
}

self.onmessage = (e) => {
	switch (e.data.type) {
		case 'init':
			canvas = e.data.canvas;
			ctx = canvas.getContext('2d');
			w = e.data.width;
			h = e.data.height;
			canvas.width = w;
			canvas.height = h;
			initButterflies();
			animate();
			break;
		case 'resize':
			w = e.data.width;
			h = e.data.height;
			canvas.width = w;
			canvas.height = h;
			initButterflies();
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			if (isDragging) {
				createSeedParticles(e.data.x, e.data.y);
			}
			break;
		case 'click':
			createFlower(e.data.x, e.data.y);
			break;
		case 'mousedown':
			isDragging = true;
			break;
		case 'mouseup':
			isDragging = false;
			break;
		case 'touchstart':
			// Plant a flower at each touch point
			if (e.data.touches) {
				for (const t of e.data.touches) {
					createFlower(t.x, t.y);
				}
			}
			break;
		case 'touchmove':
			// Scatter seeds at each moving finger
			if (e.data.touches) {
				for (const t of e.data.touches) {
					createSeedParticles(t.x, t.y);
				}
			}
			break;
	}
};

function drawGround() {
	const groundY = h * GROUND_Y_RATIO;
	const gGrad = ctx.createLinearGradient(0, groundY - 10, 0, h);
	gGrad.addColorStop(0, '#2a5a1e');
	gGrad.addColorStop(0.15, '#1e4515');
	gGrad.addColorStop(1, '#0a1a05');
	ctx.fillStyle = gGrad;
	ctx.fillRect(0, groundY - 5, w, h - groundY + 5);

	// Grass tufts
	ctx.strokeStyle = 'rgba(60, 120, 40, 0.3)';
	ctx.lineWidth = 1;
	for (let i = 0; i < 40; i++) {
		const gx = (i / 40) * w + Math.sin(i * 7.3) * 20;
		const gy = groundY;
		const sway = Math.sin(time * 0.02 + i) * 3;
		ctx.beginPath();
		ctx.moveTo(gx, gy);
		ctx.quadraticCurveTo(gx + sway, gy - 8 - Math.random() * 6, gx + sway * 1.5, gy - 12 - Math.random() * 8);
		ctx.stroke();
	}
}

function drawFlower(f) {
	const growth = Math.min(1, f.growth);
	if (growth <= 0) return;

	const sway = Math.sin(time * BREEZE_STRENGTH + f.phase + f.swayOffset) * 5 * growth;
	const stemH = f.maxHeight * growth;
	const topX = f.x + sway;
	const topY = f.y - stemH;

	// Stem
	ctx.beginPath();
	ctx.moveTo(f.x, f.y);
	ctx.quadraticCurveTo(f.x + sway * 0.5, f.y - stemH * 0.5, topX, topY);
	ctx.strokeStyle = `hsl(120, 40%, ${25 + growth * 15}%)`;
	ctx.lineWidth = f.stemWidth * growth;
	ctx.lineCap = 'round';
	ctx.stroke();

	// Leaves
	if (growth > 0.3) {
		const leafP = Math.min(1, (growth - 0.3) / 0.4);
		const leafY = f.y - stemH * 0.4;
		const leafX = f.x + sway * 0.3;
		const leafSize = 8 * leafP;

		ctx.fillStyle = 'hsl(110, 50%, 35%)';
		ctx.beginPath();
		ctx.ellipse(leafX - leafSize, leafY, leafSize, leafSize * 0.4, -0.4, 0, Math.PI * 2);
		ctx.fill();
		ctx.beginPath();
		ctx.ellipse(leafX + leafSize, leafY - 5, leafSize * 0.8, leafSize * 0.35, 0.4, 0, Math.PI * 2);
		ctx.fill();
	}

	// Petals
	if (growth > 0.5) {
		const petalP = Math.min(1, (growth - 0.5) / 0.4);
		const pr = f.petalSize * petalP;

		for (let i = 0; i < f.petalCount; i++) {
			const angle = (i / f.petalCount) * Math.PI * 2 + Math.sin(time * 0.01 + f.phase) * 0.05;
			const px = topX + Math.cos(angle) * pr;
			const py = topY + Math.sin(angle) * pr;

			ctx.beginPath();
			ctx.ellipse(px, py, pr * 0.6, pr * 0.35, angle, 0, Math.PI * 2);
			ctx.fillStyle = `hsla(${f.color.h}, ${f.color.s}%, ${f.color.l}%, ${0.85 * petalP})`;
			ctx.fill();
		}

		// Center
		ctx.beginPath();
		ctx.arc(topX, topY, pr * 0.3 * petalP, 0, Math.PI * 2);
		ctx.fillStyle = `hsla(45, 90%, 55%, ${petalP})`;
		ctx.fill();
	}

	// Sprouting animation (tiny seed poking out)
	if (growth < 0.15) {
		const sproutP = growth / 0.15;
		ctx.fillStyle = '#4a8a30';
		ctx.beginPath();
		ctx.arc(f.x, f.y - 3 * sproutP, 2, 0, Math.PI * 2);
		ctx.fill();
	}
}

function drawButterfly(b) {
	const wingAngle = Math.sin(time * b.wingSpeed + b.wingPhase) * 0.8;
	const size = b.size;

	ctx.save();
	ctx.translate(b.x, b.y);

	// Body
	ctx.fillStyle = `hsl(${b.hue}, 30%, 25%)`;
	ctx.beginPath();
	ctx.ellipse(0, 0, 1.5, size * 0.5, 0, 0, Math.PI * 2);
	ctx.fill();

	// Wings
	ctx.fillStyle = `hsla(${b.hue}, 80%, 65%, 0.7)`;

	// Left wing
	ctx.save();
	ctx.scale(Math.cos(wingAngle), 1);
	ctx.beginPath();
	ctx.ellipse(-size * 0.5, -size * 0.2, size, size * 0.6, -0.2, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();

	// Right wing
	ctx.save();
	ctx.scale(Math.cos(wingAngle + 0.3), 1);
	ctx.beginPath();
	ctx.ellipse(size * 0.5, -size * 0.2, size, size * 0.6, 0.2, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();

	ctx.restore();
}

function updateButterflies() {
	for (const b of butterflies) {
		b.changeTimer--;
		if (b.changeTimer <= 0) {
			// Pick a new target — maybe near a flower
			if (flowers.length > 0 && Math.random() > 0.3) {
				const f = flowers[Math.floor(Math.random() * flowers.length)];
				b.targetX = f.x + (Math.random() - 0.5) * 60;
				b.targetY = f.y - f.maxHeight * f.growth + (Math.random() - 0.5) * 30;
			} else {
				b.targetX = Math.random() * w;
				b.targetY = h * 0.2 + Math.random() * h * 0.4;
			}
			b.changeTimer = 100 + Math.floor(Math.random() * 200);
		}

		// Move toward target
		const dx = b.targetX - b.x;
		const dy = b.targetY - b.y;
		b.vx += dx * 0.002;
		b.vy += dy * 0.002;
		b.vx *= 0.95;
		b.vy *= 0.95;
		b.x += b.vx;
		b.y += b.vy;

		// Wrap
		if (b.x < -20) b.x = w + 20;
		if (b.x > w + 20) b.x = -20;

		drawButterfly(b);
	}
}

function updateSeedParticles() {
	for (let i = seedParticles.length - 1; i >= 0; i--) {
		const p = seedParticles[i];
		p.x += p.vx;
		p.y += p.vy;
		p.vy += 0.05; // gravity
		p.alpha -= 0.015;

		if (p.alpha <= 0) {
			// When a seed particle lands, sometimes plant a flower
			if (p.y >= h * GROUND_Y_RATIO && Math.random() > 0.85) {
				createFlower(p.x, p.y);
			}
			seedParticles.splice(i, 1);
			continue;
		}

		ctx.fillStyle = `hsla(${p.hue}, 70%, 60%, ${p.alpha})`;
		ctx.beginPath();
		ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
		ctx.fill();
	}
}

function animate() {
	if (!ctx) return;
	time++;

	// Background sky
	const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
	skyGrad.addColorStop(0, '#0a1628');
	skyGrad.addColorStop(0.5, '#162a45');
	skyGrad.addColorStop(0.8, '#1a3520');
	skyGrad.addColorStop(1, '#0a1a05');
	ctx.fillStyle = skyGrad;
	ctx.fillRect(0, 0, w, h);

	// Stars
	ctx.fillStyle = 'rgba(255, 255, 240, 0.5)';
	for (let i = 0; i < 30; i++) {
		const sx = ((i * 137.508) % w);
		const sy = ((i * 89.3) % (h * 0.5));
		const twinkle = 0.3 + 0.7 * Math.sin(time * 0.02 + i * 2.5);
		ctx.globalAlpha = twinkle * 0.4;
		ctx.beginPath();
		ctx.arc(sx, sy, 0.8, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.globalAlpha = 1;

	// Moon
	const moonGrad = ctx.createRadialGradient(w * 0.8, h * 0.12, 0, w * 0.8, h * 0.12, 30);
	moonGrad.addColorStop(0, 'rgba(255, 250, 220, 0.9)');
	moonGrad.addColorStop(0.7, 'rgba(255, 250, 220, 0.2)');
	moonGrad.addColorStop(1, 'rgba(255, 250, 220, 0)');
	ctx.fillStyle = moonGrad;
	ctx.beginPath();
	ctx.arc(w * 0.8, h * 0.12, 30, 0, Math.PI * 2);
	ctx.fill();

	// Ground
	drawGround();

	// Grow flowers
	for (const f of flowers) {
		if (f.growth < 1) f.growth += GROW_SPEED;
		drawFlower(f);
	}

	// Butterflies
	updateButterflies();

	// Seed particles
	updateSeedParticles();

	// Hint text
	if (flowers.length === 0 && seedParticles.length === 0) {
		ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
		ctx.font = '14px sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('Tap anywhere to plant a flower \uD83C\uDF3B', w / 2, h / 2);
		ctx.textAlign = 'left';
	}

	requestAnimationFrame(animate);
}
