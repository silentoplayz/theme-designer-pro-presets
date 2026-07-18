/**
 * Title: Tap Fireworks
 * Description: Click or tap anywhere to launch a firework burst! Each click
 *   spawns a colorful explosion with trails, sparkles, and gravity. Multiple
 *   fireworks can exist simultaneously. Hold mousedown to charge up a bigger
 *   burst. Works on both desktop (click) and mobile (touch/multi-touch).
 *
 *   Showcases: click, mousedown, mouseup, touchstart, touchend
 */

/* ---------- CONFIGURABLE VARIABLES ---------- */
const PARTICLES_PER_BURST = 60;      // particles per firework
const CHARGE_MAX_MS       = 1500;    // max hold time for bigger burst
const GRAVITY             = 0.06;    // downward acceleration
const FRICTION            = 0.985;   // velocity decay per frame
const TRAIL_LENGTH        = 6;       // past positions to draw as trail
const SPARKLE_COUNT       = 20;      // tiny sparkles per burst
const BG_FADE             = 0.08;    // background fade speed (lower = longer trails)
/* --------------------------------------------- */

let canvas, ctx, w, h;
let fireworks = [];
let chargeStart = 0;
let chargeX = 0, chargeY = 0;
let isCharging = false;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function randomHue() { return Math.floor(Math.random() * 360); }

function createBurst(x, y, power) {
	const hue = randomHue();
	const count = Math.floor(PARTICLES_PER_BURST * power);
	const sparkles = Math.floor(SPARKLE_COUNT * power);
	const particles = [];

	for (let i = 0; i < count; i++) {
		const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
		const speed = (1.5 + Math.random() * 3) * power;
		const hueShift = (Math.random() - 0.5) * 60;
		particles.push({
			x, y,
			vx: Math.cos(angle) * speed,
			vy: Math.sin(angle) * speed,
			hue: hue + hueShift,
			alpha: 1,
			size: 2 + Math.random() * 2 * power,
			decay: 0.008 + Math.random() * 0.008,
			trail: [],
			isSparkle: false
		});
	}

	// Add sparkles (tiny fast particles)
	for (let i = 0; i < sparkles; i++) {
		const angle = Math.random() * Math.PI * 2;
		const speed = (3 + Math.random() * 4) * power;
		particles.push({
			x, y,
			vx: Math.cos(angle) * speed,
			vy: Math.sin(angle) * speed,
			hue: 45 + Math.random() * 15, // golden sparkles
			alpha: 1,
			size: 1 + Math.random(),
			decay: 0.015 + Math.random() * 0.015,
			trail: [],
			isSparkle: true
		});
	}

	fireworks.push(...particles);
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
			animate();
			break;
		case 'resize':
			w = e.data.width;
			h = e.data.height;
			canvas.width = w;
			canvas.height = h;
			break;
		case 'click':
			// Quick tap = small burst (if not charging)
			if (!isCharging) {
				createBurst(e.data.x, e.data.y, 0.7);
			}
			break;
		case 'mousedown':
			// Start charging
			isCharging = true;
			chargeStart = Date.now();
			chargeX = e.data.x;
			chargeY = e.data.y;
			break;
		case 'mouseup': {
			// Release = launch with charge power
			if (isCharging) {
				const held = Math.min(Date.now() - chargeStart, CHARGE_MAX_MS);
				const power = 0.5 + (held / CHARGE_MAX_MS) * 1.5;
				createBurst(e.data.x, e.data.y, power);
				isCharging = false;
			}
			break;
		}
		case 'touchstart':
			// Multi-touch: launch a burst at each finger
			if (e.data.touches) {
				for (const t of e.data.touches) {
					createBurst(t.x, t.y, 0.8);
				}
			}
			break;
		case 'mousemove':
			// Update charge position while holding
			if (isCharging) {
				chargeX = e.data.x;
				chargeY = e.data.y;
			}
			break;
	}
};

function animate() {
	if (!ctx) return;

	// Fade background
	ctx.fillStyle = `rgba(5, 5, 15, ${BG_FADE})`;
	ctx.fillRect(0, 0, w, h);

	// Draw charge indicator
	if (isCharging) {
		const held = Math.min(Date.now() - chargeStart, CHARGE_MAX_MS);
		const ratio = held / CHARGE_MAX_MS;
		const radius = 10 + ratio * 40;
		const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.01);

		// Pulsing ring
		ctx.beginPath();
		ctx.arc(chargeX, chargeY, radius, 0, Math.PI * 2);
		ctx.strokeStyle = `hsla(${45 + ratio * 300}, 100%, 70%, ${0.3 + pulse * 0.4})`;
		ctx.lineWidth = 2 + ratio * 3;
		ctx.stroke();

		// Progress arc
		ctx.beginPath();
		ctx.arc(chargeX, chargeY, radius + 5, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
		ctx.strokeStyle = `hsla(${45 + ratio * 300}, 100%, 80%, 0.8)`;
		ctx.lineWidth = 3;
		ctx.stroke();

		// Center glow
		const glow = ctx.createRadialGradient(chargeX, chargeY, 0, chargeX, chargeY, radius);
		glow.addColorStop(0, `hsla(${45 + ratio * 300}, 100%, 80%, ${ratio * 0.2})`);
		glow.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
		ctx.fillStyle = glow;
		ctx.beginPath();
		ctx.arc(chargeX, chargeY, radius, 0, Math.PI * 2);
		ctx.fill();
	}

	// Update and draw particles
	for (let i = fireworks.length - 1; i >= 0; i--) {
		const p = fireworks[i];

		// Save trail
		p.trail.push({ x: p.x, y: p.y });
		if (p.trail.length > TRAIL_LENGTH) p.trail.shift();

		// Physics
		p.vy += GRAVITY;
		p.vx *= FRICTION;
		p.vy *= FRICTION;
		p.x += p.vx;
		p.y += p.vy;
		p.alpha -= p.decay;

		if (p.alpha <= 0) {
			fireworks.splice(i, 1);
			continue;
		}

		// Draw trail
		if (!p.isSparkle && p.trail.length > 1) {
			ctx.beginPath();
			ctx.moveTo(p.trail[0].x, p.trail[0].y);
			for (let t = 1; t < p.trail.length; t++) {
				ctx.lineTo(p.trail[t].x, p.trail[t].y);
			}
			ctx.lineTo(p.x, p.y);
			ctx.strokeStyle = `hsla(${p.hue}, 100%, 60%, ${p.alpha * 0.3})`;
			ctx.lineWidth = p.size * 0.5;
			ctx.stroke();
		}

		// Draw particle
		ctx.beginPath();
		ctx.arc(p.x, p.y, p.size * p.alpha, 0, Math.PI * 2);
		ctx.fillStyle = p.isSparkle
			? `hsla(${p.hue}, 100%, 90%, ${p.alpha})`
			: `hsla(${p.hue}, 100%, 65%, ${p.alpha})`;
		ctx.fill();

		// Glow
		if (!p.isSparkle && p.alpha > 0.5) {
			const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3);
			g.addColorStop(0, `hsla(${p.hue}, 100%, 70%, ${p.alpha * 0.15})`);
			g.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	// Hint text when idle
	if (fireworks.length === 0 && !isCharging) {
		ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
		ctx.font = '14px sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('Click or tap anywhere \u2728', w / 2, h / 2);
		ctx.textAlign = 'left';
	}

	requestAnimationFrame(animate);
}
