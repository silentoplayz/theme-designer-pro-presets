/**
 * Title: Cosmic Dust
 * Description: Thousands of tiny dust-like particles drifting very slowly in random directions
 *              with extremely subtle colors (near-white with very low opacity). Creates a living,
 *              breathing cosmic dust cloud effect. Mouse creates a gentle wind that pushes particles.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let particles = [];
let time = 0;

const PARTICLE_COUNT = 1800;
const MOUSE_RADIUS = 180;
const WIND_FORCE = 0.3;

// Keep worker alive
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

// Pre-allocate typed arrays for performance with large particle counts
let posX, posY, velX, velY, sizes, opacities, colorR, colorG, colorB, phases;

function initParticles() {
	posX = new Float32Array(PARTICLE_COUNT);
	posY = new Float32Array(PARTICLE_COUNT);
	velX = new Float32Array(PARTICLE_COUNT);
	velY = new Float32Array(PARTICLE_COUNT);
	sizes = new Float32Array(PARTICLE_COUNT);
	opacities = new Float32Array(PARTICLE_COUNT);
	colorR = new Uint8Array(PARTICLE_COUNT);
	colorG = new Uint8Array(PARTICLE_COUNT);
	colorB = new Uint8Array(PARTICLE_COUNT);
	phases = new Float32Array(PARTICLE_COUNT);

	for (let i = 0; i < PARTICLE_COUNT; i++) {
		posX[i] = Math.random() * width;
		posY[i] = Math.random() * height;
		velX[i] = (Math.random() - 0.5) * 0.08;
		velY[i] = (Math.random() - 0.5) * 0.06;
		sizes[i] = 0.3 + Math.random() * 1.0;
		phases[i] = Math.random() * Math.PI * 2;

		// Near-white with extremely subtle color tinting
		const tint = Math.random();
		if (tint < 0.4) {
			// Pure near-white
			colorR[i] = 230 + Math.floor(Math.random() * 25);
			colorG[i] = 230 + Math.floor(Math.random() * 25);
			colorB[i] = 235 + Math.floor(Math.random() * 20);
			opacities[i] = 0.03 + Math.random() * 0.06;
		} else if (tint < 0.6) {
			// Slightly warm white
			colorR[i] = 240 + Math.floor(Math.random() * 15);
			colorG[i] = 225 + Math.floor(Math.random() * 20);
			colorB[i] = 210 + Math.floor(Math.random() * 20);
			opacities[i] = 0.02 + Math.random() * 0.05;
		} else if (tint < 0.8) {
			// Slightly cool white
			colorR[i] = 210 + Math.floor(Math.random() * 20);
			colorG[i] = 220 + Math.floor(Math.random() * 20);
			colorB[i] = 240 + Math.floor(Math.random() * 15);
			opacities[i] = 0.02 + Math.random() * 0.05;
		} else {
			// Faint lavender
			colorR[i] = 220 + Math.floor(Math.random() * 20);
			colorG[i] = 210 + Math.floor(Math.random() * 20);
			colorB[i] = 240 + Math.floor(Math.random() * 15);
			opacities[i] = 0.02 + Math.random() * 0.04;
		}
	}
}

function startAnimation() {
	// Cached previous mouse for wind direction
	let prevMouseX = mouse.x;
	let prevMouseY = mouse.y;

	function render() {
		if (!ctx) return;
		ctx.clearRect(0, 0, width, height);

		time += 1;

		// Calculate mouse movement direction for wind effect
		const mouseMoveDX = mouse.x - prevMouseX;
		const mouseMoveDY = mouse.y - prevMouseY;
		prevMouseX = mouse.x;
		prevMouseY = mouse.y;

		// Batch draw for performance — group by similar opacity ranges
		for (let i = 0; i < PARTICLE_COUNT; i++) {
			// Subtle breathing via sine wave
			const breathe = Math.sin(time * 0.008 + phases[i]) * 0.3;

			// Apply velocity
			posX[i] += velX[i] + breathe * 0.02;
			posY[i] += velY[i] + breathe * 0.015;

			// Mouse wind push effect
			const dx = posX[i] - mouse.x;
			const dy = posY[i] - mouse.y;
			const dist = Math.sqrt(dx * dx + dy * dy);

			if (dist < MOUSE_RADIUS && dist > 0) {
				const force = (1 - dist / MOUSE_RADIUS) * WIND_FORCE;
				// Push away from mouse
				velX[i] += (dx / dist) * force * 0.05;
				velY[i] += (dy / dist) * force * 0.05;
				// Also add directional wind from mouse movement
				velX[i] += mouseMoveDX * 0.002 * force;
				velY[i] += mouseMoveDY * 0.002 * force;
			}

			// Dampen velocity to prevent runaway
			velX[i] *= 0.998;
			velY[i] *= 0.998;

			// Speed limit
			const speed = Math.sqrt(velX[i] * velX[i] + velY[i] * velY[i]);
			if (speed > 0.5) {
				velX[i] = (velX[i] / speed) * 0.5;
				velY[i] = (velY[i] / speed) * 0.5;
			}

			// Wrap around edges seamlessly
			if (posX[i] < -5) posX[i] = width + 5;
			if (posX[i] > width + 5) posX[i] = -5;
			if (posY[i] < -5) posY[i] = height + 5;
			if (posY[i] > height + 5) posY[i] = -5;

			// Draw particle
			const alpha = opacities[i] * (0.7 + breathe * 0.3);
			const size = sizes[i];

			ctx.beginPath();
			ctx.arc(posX[i], posY[i], size, 0, Math.PI * 2);
			ctx.fillStyle = `rgba(${colorR[i]}, ${colorG[i]}, ${colorB[i]}, ${alpha})`;
			ctx.fill();
		}

		// Occasional brighter "glint" particles (draw a few sparkles)
		const glintCount = 8;
		for (let i = 0; i < glintCount; i++) {
			const idx = Math.floor((time * 7 + i * 231) % PARTICLE_COUNT);
			const glintPhase = Math.sin(time * 0.05 + idx);
			if (glintPhase > 0.95) {
				const glintAlpha = (glintPhase - 0.95) * 2.0; // 0 to 0.1
				ctx.beginPath();
				ctx.arc(posX[idx], posY[idx], sizes[idx] * 2, 0, Math.PI * 2);
				ctx.fillStyle = `rgba(255, 255, 255, ${glintAlpha})`;
				ctx.fill();
			}
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
			initParticles();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initParticles();
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};
