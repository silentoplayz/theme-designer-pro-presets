/**
 * Title: Data Stream
 * Description: Horizontal streams of flowing data represented as small rectangles of varying
 *   lengths zipping across the screen. Like watching network traffic visualized.
 *   Dim blue/cyan palette. Mouse creates a vortex that curves nearby streams.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };

const MAX_PARTICLES = 200;
const VORTEX_RADIUS = 180;
const VORTEX_STRENGTH = 3;

let particles = [];
let lanes = [];

setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

self.onmessage = (e) => {
	switch (e.data.type) {
		case 'init':
			canvas = e.data.canvas;
			ctx = canvas.getContext('2d');
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			init();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			init();
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};

function init() {
	particles = [];
	// Create lanes at various y positions
	const laneCount = Math.floor(height / 12);
	lanes = [];
	for (let i = 0; i < laneCount; i++) {
		lanes.push({
			y: (i + 0.5) * (height / laneCount),
			baseSpeed: 0.5 + Math.random() * 2.5,
			direction: Math.random() < 0.7 ? 1 : -1 // mostly left-to-right
		});
	}

	// Pre-populate some particles
	for (let i = 0; i < MAX_PARTICLES * 0.6; i++) {
		spawnParticle(true);
	}
}

function spawnParticle(randomX) {
	if (particles.length >= MAX_PARTICLES) return;

	const lane = lanes[Math.floor(Math.random() * lanes.length)];
	const pWidth = 4 + Math.random() * 30; // rectangle width
	const pHeight = 1.5 + Math.random() * 2.5;

	// Color variation in blue/cyan spectrum
	const hue = 190 + Math.random() * 30; // 190-220 range (blue to cyan)
	const sat = 60 + Math.random() * 40;
	const light = 40 + Math.random() * 20;
	const alpha = 0.1 + Math.random() * 0.25;

	let x;
	if (randomX) {
		x = Math.random() * width;
	} else {
		x = lane.direction > 0 ? -pWidth : width + pWidth;
	}

	particles.push({
		x: x,
		y: lane.y + (Math.random() - 0.5) * 6, // slight y jitter within lane
		baseY: lane.y,
		w: pWidth,
		h: pHeight,
		vx: lane.baseSpeed * lane.direction * (0.7 + Math.random() * 0.6),
		vy: 0,
		color: `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`,
		glowColor: `hsla(${hue}, ${sat}%, ${light + 20}%, ${alpha * 0.6})`,
		alpha: alpha
	});
}

function startAnimation() {
	function render(time) {
		if (!ctx) return;

		ctx.clearRect(0, 0, width, height);

		// Spawn new particles
		if (particles.length < MAX_PARTICLES && Math.random() < 0.3) {
			spawnParticle(false);
		}

		// Update and draw particles
		for (let i = particles.length - 1; i >= 0; i--) {
			const p = particles[i];

			// Vortex effect from mouse
			const dx = p.x - mouse.x;
			const dy = p.y - mouse.y;
			const dist = Math.sqrt(dx * dx + dy * dy);

			if (dist < VORTEX_RADIUS && dist > 1) {
				const force = (1 - dist / VORTEX_RADIUS) * VORTEX_STRENGTH;
				// Perpendicular force (creates swirl) + slight attraction
				const angle = Math.atan2(dy, dx);
				const perpX = -Math.sin(angle) * force;
				const perpY = Math.cos(angle) * force;
				p.vy += perpY * 0.1;
				p.vx += perpX * 0.05;
			}

			// Return to base Y (spring force)
			const yDiff = p.baseY - p.y;
			p.vy += yDiff * 0.01;
			p.vy *= 0.92; // damping

			// Move
			p.x += p.vx;
			p.y += p.vy;

			// Remove if off-screen
			if (
				(p.vx > 0 && p.x > width + p.w + 10) ||
				(p.vx < 0 && p.x < -p.w - 10) ||
				p.y < -50 ||
				p.y > height + 50
			) {
				particles.splice(i, 1);
				continue;
			}

			// Draw the data packet
			// Subtle glow
			ctx.shadowColor = p.glowColor;
			ctx.shadowBlur = 4;
			ctx.fillStyle = p.color;
			ctx.fillRect(p.x, p.y - p.h / 2, p.w, p.h);
			ctx.shadowBlur = 0;
		}

		// Draw faint lane lines for depth
		ctx.strokeStyle = 'rgba(0, 100, 140, 0.03)';
		ctx.lineWidth = 0.5;
		for (const lane of lanes) {
			ctx.beginPath();
			ctx.moveTo(0, lane.y);
			ctx.lineTo(width, lane.y);
			ctx.stroke();
		}

		requestAnimationFrame(render);
	}

	requestAnimationFrame(render);
}
