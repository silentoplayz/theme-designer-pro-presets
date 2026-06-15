/**
 * Title: Bioluminescence
 * Description: Deep sea bioluminescent flashes and drifting organisms. Soft glowing
 *   creatures pulse and drift through dark water, trailing tentacles. Mouse presence
 *   attracts nearby organisms with a gentle pull.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
	// -- Organisms --
	organismCount: 35,                        // Number of floating organisms (10-80)
	organismSizeMin: 3,                       // Minimum organism body radius in px (1-10)
	organismSizeMax: 12,                      // Maximum organism body radius in px (5-25)
	driftSpeed: 18,                           // Base drift speed in px/s (5-60)
	jitter: 0.4,                              // Organic motion jitter strength (0-2)

	// -- Flashing --
	flashFrequency: 0.08,                     // Probability per frame of an organism flashing (0-0.3)
	flashDuration: 60,                        // Flash duration in frames (20-120)
	flashMaxRadius: 60,                       // Maximum glow radius during a flash in px (20-150)
	flashColorPalette: [                      // Colors organisms can flash — array of rgba strings
		'rgba(0, 255, 200, 1)',                 //   cyan-green
		'rgba(80, 180, 255, 1)',                //   sky blue
		'rgba(150, 80, 255, 1)',                //   purple
		'rgba(0, 255, 120, 1)',                 //   green
		'rgba(255, 120, 200, 1)',               //   pink
	],

	// -- Ambient Glow --
	ambientGlowOpacity: 0.12,                // Resting glow opacity around each organism (0-0.4)
	pulseRate: 0.02,                          // Speed of the ambient breathing pulse (0.005-0.1)

	// -- Tentacles --
	tentacleEnabled: true,                    // Draw trailing tentacles behind organisms
	tentacleLength: 8,                        // Number of tentacle segments (3-20)
	tentacleOpacity: 0.25,                    // Base opacity of tentacle strands (0-1)
	tentacleWidth: 1.5,                       // Width of tentacle lines in px (0.5-4)

	// -- Mouse Interaction --
	mouseAttractionRadius: 250,               // Distance at which mouse attracts organisms in px (50-500)
	mouseAttractionForce: 40,                 // Strength of mouse pull in px/s (5-100)

	// -- Environment --
	backgroundTint: 'rgba(0, 5, 20, 0.08)',  // Subtle background overlay color per frame
	particleCount: 60,                        // Tiny ambient deep-sea particles (0-200)
	particleAlpha: 0.15,                      // Alpha of ambient particles (0-0.5)
	particleSize: 1.5,                        // Size of ambient particles in px (0.5-3)
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let organisms = [];
let particles = [];
let frameCount = 0;

setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

// ─── ORGANISM CLASS ─────────────────────────────────────────────────────────
function createOrganism(x, y) {
	const size = CONFIG.organismSizeMin +
		Math.random() * (CONFIG.organismSizeMax - CONFIG.organismSizeMin);
	const colorIndex = Math.floor(Math.random() * CONFIG.flashColorPalette.length);
	return {
		x: x !== undefined ? x : Math.random() * width,
		y: y !== undefined ? y : Math.random() * height,
		vx: (Math.random() - 0.5) * CONFIG.driftSpeed,
		vy: (Math.random() - 0.5) * CONFIG.driftSpeed * 0.5 - CONFIG.driftSpeed * 0.3,
		size,
		baseSize: size,
		colorIndex,
		flashTimer: 0,
		flashColor: null,
		phaseOffset: Math.random() * Math.PI * 2,
		trail: [],        // tentacle history positions
		angle: Math.random() * Math.PI * 2,
		angularVel: (Math.random() - 0.5) * 0.02,
	};
}

function createParticle() {
	return {
		x: Math.random() * width,
		y: Math.random() * height,
		vx: (Math.random() - 0.5) * 4,
		vy: -Math.random() * 3 - 1,
		alpha: Math.random() * CONFIG.particleAlpha,
		size: Math.random() * CONFIG.particleSize + 0.5,
	};
}

// ─── INIT ────────────────────────────────────────────────────────────────────
function initAll() {
	organisms = [];
	particles = [];
	for (let i = 0; i < CONFIG.organismCount; i++) {
		organisms.push(createOrganism());
	}
	for (let i = 0; i < CONFIG.particleCount; i++) {
		particles.push(createParticle());
	}
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function parseRgba(str) {
	const m = str.match(/[\d.]+/g);
	if (!m || m.length < 3) return [255, 255, 255, 1];
	return [+m[0], +m[1], +m[2], m[3] !== undefined ? +m[3] : 1];
}

// ─── UPDATE ──────────────────────────────────────────────────────────────────
function updateOrganisms() {
	for (const org of organisms) {
		// Organic jitter
		org.vx += (Math.random() - 0.5) * CONFIG.jitter;
		org.vy += (Math.random() - 0.5) * CONFIG.jitter;

		// Gentle upward drift bias
		org.vy -= 0.05;

		// Mouse attraction
		const dx = mouse.x - org.x;
		const dy = mouse.y - org.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist < CONFIG.mouseAttractionRadius && dist > 1) {
			const force = (1 - dist / CONFIG.mouseAttractionRadius) * CONFIG.mouseAttractionForce;
			org.vx += (dx / dist) * force * 0.016;
			org.vy += (dy / dist) * force * 0.016;
		}

		// Damping
		org.vx *= 0.98;
		org.vy *= 0.98;

		// Speed limit
		const speed = Math.sqrt(org.vx * org.vx + org.vy * org.vy);
		const maxSpeed = CONFIG.driftSpeed * 2;
		if (speed > maxSpeed) {
			org.vx = (org.vx / speed) * maxSpeed;
			org.vy = (org.vy / speed) * maxSpeed;
		}

		org.x += org.vx * 0.016;
		org.y += org.vy * 0.016;

		// Wrap around
		if (org.x < -50) org.x = width + 50;
		if (org.x > width + 50) org.x = -50;
		if (org.y < -50) org.y = height + 50;
		if (org.y > height + 50) org.y = -50;

		// Tentacle trail
		if (CONFIG.tentacleEnabled) {
			org.trail.unshift({ x: org.x, y: org.y });
			while (org.trail.length > CONFIG.tentacleLength + 1) {
				org.trail.pop();
			}
		}

		// Flash trigger
		if (org.flashTimer <= 0 && Math.random() < CONFIG.flashFrequency * 0.016) {
			org.flashTimer = CONFIG.flashDuration;
			org.flashColor = CONFIG.flashColorPalette[
				Math.floor(Math.random() * CONFIG.flashColorPalette.length)
			];
		}
		if (org.flashTimer > 0) org.flashTimer--;

		// Rotation
		org.angle += org.angularVel;
	}
}

function updateParticles() {
	for (const p of particles) {
		p.x += p.vx * 0.016;
		p.y += p.vy * 0.016;
		if (p.y < -10) { p.y = height + 10; p.x = Math.random() * width; }
		if (p.x < -10) p.x = width + 10;
		if (p.x > width + 10) p.x = -10;
	}
}

// ─── DRAW ────────────────────────────────────────────────────────────────────
function drawParticles() {
	for (const p of particles) {
		ctx.beginPath();
		ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
		ctx.fillStyle = `rgba(100, 180, 255, ${p.alpha})`;
		ctx.fill();
	}
}

function drawOrganisms() {
	for (const org of organisms) {
		const pulse = Math.sin(frameCount * CONFIG.pulseRate + org.phaseOffset) * 0.3 + 0.7;
		const isFlashing = org.flashTimer > 0;
		const flashProgress = isFlashing ? org.flashTimer / CONFIG.flashDuration : 0;
		const flashIntensity = Math.sin(flashProgress * Math.PI); // peaks mid-flash

		// Pick base color
		const colorStr = isFlashing ? org.flashColor :
			CONFIG.flashColorPalette[org.colorIndex];
		const rgba = parseRgba(colorStr);

		// Draw tentacles
		if (CONFIG.tentacleEnabled && org.trail.length > 1) {
			for (let i = 1; i < org.trail.length; i++) {
				const t = 1 - i / org.trail.length;
				const alpha = t * CONFIG.tentacleOpacity * pulse;
				ctx.beginPath();
				ctx.moveTo(org.trail[i - 1].x, org.trail[i - 1].y);
				ctx.lineTo(org.trail[i].x, org.trail[i].y);
				ctx.strokeStyle = `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${alpha.toFixed(3)})`;
				ctx.lineWidth = CONFIG.tentacleWidth * t;
				ctx.stroke();
			}
		}

		// Outer glow (ambient or flash)
		const glowRadius = isFlashing
			? org.size * 2 + flashIntensity * CONFIG.flashMaxRadius
			: org.size * 3 * pulse;
		const glowAlpha = isFlashing
			? flashIntensity * 0.5
			: CONFIG.ambientGlowOpacity * pulse;

		const grad = ctx.createRadialGradient(org.x, org.y, 0, org.x, org.y, glowRadius);
		grad.addColorStop(0, `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${glowAlpha.toFixed(3)})`);
		grad.addColorStop(0.4, `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${(glowAlpha * 0.3).toFixed(3)})`);
		grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
		ctx.fillStyle = grad;
		ctx.beginPath();
		ctx.arc(org.x, org.y, glowRadius, 0, Math.PI * 2);
		ctx.fill();

		// Body
		const bodyAlpha = 0.6 + pulse * 0.4;
		const bodySize = org.size * (0.9 + pulse * 0.1);

		// Soft body shape (slightly elliptical)
		ctx.save();
		ctx.translate(org.x, org.y);
		ctx.rotate(org.angle);
		ctx.scale(1, 0.75);
		ctx.beginPath();
		ctx.arc(0, 0, bodySize, 0, Math.PI * 2);
		ctx.fillStyle = `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${(bodyAlpha * 0.4).toFixed(3)})`;
		ctx.fill();

		// Inner nucleus
		ctx.beginPath();
		ctx.arc(0, 0, bodySize * 0.4, 0, Math.PI * 2);
		ctx.fillStyle = `rgba(${Math.min(255, rgba[0] + 80)}, ${Math.min(255, rgba[1] + 80)}, ${Math.min(255, rgba[2] + 80)}, ${(bodyAlpha * 0.8).toFixed(3)})`;
		ctx.fill();
		ctx.restore();

		// Flash burst ring
		if (isFlashing && flashIntensity > 0.1) {
			ctx.beginPath();
			ctx.arc(org.x, org.y, org.size + flashIntensity * CONFIG.flashMaxRadius * 0.3, 0, Math.PI * 2);
			ctx.strokeStyle = `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${(flashIntensity * 0.3).toFixed(3)})`;
			ctx.lineWidth = 1;
			ctx.stroke();
		}
	}
}

// ─── ANIMATION LOOP ─────────────────────────────────────────────────────────
function startAnimation() {
	function render() {
		if (!ctx) return;
		frameCount++;

		// Dark water background overlay (creates trail effect)
		ctx.fillStyle = CONFIG.backgroundTint;
		ctx.fillRect(0, 0, width, height);

		updateOrganisms();
		updateParticles();

		drawParticles();

		// Additive glow pass
		ctx.globalCompositeOperation = 'lighter';
		drawOrganisms();
		ctx.globalCompositeOperation = 'source-over';

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}

// ─── MESSAGE HANDLER ─────────────────────────────────────────────────────────
self.onmessage = (e) => {
	switch (e.data.type) {
		case 'init':
			canvas = e.data.canvas;
			ctx = canvas.getContext('2d');
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initAll();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initAll();
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};
