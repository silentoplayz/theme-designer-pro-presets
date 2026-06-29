/**
 * Title: Celestial Orrery
 * Description: A luminous astronomical clockwork floating in space. A pulsing golden
 *   star at the center with orbiting gemstone planets leaving glowing trails along
 *   engraved brass orbital rings. Planets with moons, gravitational connection
 *   threads, twinkling background stars, and decorative gear-tooth accents.
 *   Mouse proximity warps orbital speeds; clicks send radial pulse waves.
 */

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG = {
	// Star
	starRadius: 22,
	starGlowRadius: 80,
	starPulseSpeed: 0.8,
	starPulseAmount: 0.15,

	// Planets
	planetCount: 6,
	orbitBaseRadius: 80,
	orbitSpacing: 55,
	planetMinSize: 4,
	planetMaxSize: 9,
	trailLength: 60,
	trailMaxAlpha: 0.5,

	// Moons (indices of planets that have moons)
	moonPlanets: [1, 3],
	moonOrbitRadius: 18,
	moonSize: 2.5,
	moonSpeed: 3.5,

	// Orbital rings
	ringAlpha: 0.12,
	ringDashLength: 6,
	ringGapLength: 8,
	gearRings: [1, 4],        // Which rings get gear teeth
	gearTeethCount: 24,
	gearToothSize: 4,

	// Connection threads
	connectionMaxDist: 200,
	connectionAlpha: 0.08,

	// Background stars
	starFieldCount: 100,
	starFieldMaxSize: 1.8,
	twinkleSpeed: 0.4,

	// Interaction
	mouseInfluenceRadius: 180,
	mouseSpeedBoost: 2.5,
	clickPulseSpeed: 200,
	clickPulseDecay: 0.97,
	clickPulseStrength: 0.8,

	// Colors (HSLA hues for gemstone planets)
	planetHues: [0, 220, 145, 38, 280, 175],   // ruby, sapphire, emerald, amber, amethyst, topaz
	planetSats: [72, 68, 65, 75, 60, 70],
	planetLights: [58, 62, 55, 65, 60, 58],

	// Ring color
	ringHue: 42,
	ringSat: 50,
	ringLight: 55,
};

// ─── STATE ─────────────────────────────────────────────────────────────────────
let canvas, ctx, W, H, cx, cy;
let mouse = { x: -9999, y: -9999 };
let time = 0, lastNow = 0;
let planets = [];
let stars = [];
let pulses = [];

// ─── HEARTBEAT ─────────────────────────────────────────────────────────────────
setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

// ─── UTILITIES ─────────────────────────────────────────────────────────────────
function rand(a, b) { return Math.random() * (b - a) + a; }

// ─── PLANET ────────────────────────────────────────────────────────────────────
class Planet {
	constructor(index) {
		this.index = index;
		this.orbitRadius = CONFIG.orbitBaseRadius + index * CONFIG.orbitSpacing;
		// Keplerian: period proportional to radius^1.5
		this.baseSpeed = 0.4 / Math.pow(this.orbitRadius / CONFIG.orbitBaseRadius, 1.5);
		this.angle = rand(0, Math.PI * 2);
		this.size = CONFIG.planetMinSize + (CONFIG.planetMaxSize - CONFIG.planetMinSize) * rand(0.3, 1);
		this.hue = CONFIG.planetHues[index % CONFIG.planetHues.length];
		this.sat = CONFIG.planetSats[index % CONFIG.planetSats.length];
		this.light = CONFIG.planetLights[index % CONFIG.planetLights.length];

		// Trail ring buffer
		this.trail = new Float32Array(CONFIG.trailLength * 2);
		this.trailHead = 0;
		this.trailFilled = 0;

		// Moon
		this.hasMoon = CONFIG.moonPlanets.includes(index);
		this.moonAngle = rand(0, Math.PI * 2);

		this.x = 0;
		this.y = 0;
	}

	update(dt) {
		// Mouse gravitational influence
		let speedMult = 1;
		const dx = this.x - mouse.x;
		const dy = this.y - mouse.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist < CONFIG.mouseInfluenceRadius && dist > 1) {
			const influence = 1 - dist / CONFIG.mouseInfluenceRadius;
			speedMult = 1 + influence * influence * (CONFIG.mouseSpeedBoost - 1);
		}

		// Pulse disturbances
		for (const p of pulses) {
			const pdx = this.x - p.x;
			const pdy = this.y - p.y;
			const pdist = Math.sqrt(pdx * pdx + pdy * pdy);
			const ringDist = Math.abs(pdist - p.radius);
			if (ringDist < 40) {
				speedMult += p.strength * (1 - ringDist / 40) * 0.8;
			}
		}

		this.angle += this.baseSpeed * speedMult * dt;

		this.x = cx + Math.cos(this.angle) * this.orbitRadius;
		this.y = cy + Math.sin(this.angle) * this.orbitRadius;

		// Push to trail
		const ti = this.trailHead * 2;
		this.trail[ti] = this.x;
		this.trail[ti + 1] = this.y;
		this.trailHead = (this.trailHead + 1) % CONFIG.trailLength;
		if (this.trailFilled < CONFIG.trailLength) this.trailFilled++;

		// Moon
		if (this.hasMoon) {
			this.moonAngle += CONFIG.moonSpeed * dt;
		}
	}

	drawTrail() {
		if (this.trailFilled < 2) return;
		for (let i = 1; i < this.trailFilled; i++) {
			const idx0 = ((this.trailHead - this.trailFilled + i - 1 + CONFIG.trailLength) % CONFIG.trailLength) * 2;
			const idx1 = ((this.trailHead - this.trailFilled + i + CONFIG.trailLength) % CONFIG.trailLength) * 2;
			const t = i / this.trailFilled;
			const alpha = t * t * CONFIG.trailMaxAlpha;
			const width = t * this.size * 0.6;

			ctx.beginPath();
			ctx.moveTo(this.trail[idx0], this.trail[idx0 + 1]);
			ctx.lineTo(this.trail[idx1], this.trail[idx1 + 1]);
			ctx.strokeStyle = `hsla(${this.hue}, ${this.sat}%, ${this.light}%, ${alpha})`;
			ctx.lineWidth = Math.max(0.5, width);
			ctx.lineCap = 'round';
			ctx.stroke();
		}
	}

	drawPlanet() {
		const s = this.size;

		// Outer glow
		const glow = ctx.createRadialGradient(this.x, this.y, s * 0.5, this.x, this.y, s * 3);
		glow.addColorStop(0, `hsla(${this.hue}, ${this.sat}%, ${this.light}%, 0.25)`);
		glow.addColorStop(1, `hsla(${this.hue}, ${this.sat}%, ${this.light}%, 0)`);
		ctx.beginPath();
		ctx.arc(this.x, this.y, s * 3, 0, Math.PI * 2);
		ctx.fillStyle = glow;
		ctx.fill();

		// Planet body
		const grad = ctx.createRadialGradient(
			this.x - s * 0.3, this.y - s * 0.3, s * 0.1,
			this.x, this.y, s
		);
		grad.addColorStop(0, `hsla(${this.hue}, ${this.sat - 10}%, ${Math.min(90, this.light + 25)}%, 0.95)`);
		grad.addColorStop(0.6, `hsla(${this.hue}, ${this.sat}%, ${this.light}%, 0.9)`);
		grad.addColorStop(1, `hsla(${this.hue}, ${this.sat + 10}%, ${Math.max(20, this.light - 20)}%, 0.8)`);
		ctx.beginPath();
		ctx.arc(this.x, this.y, s, 0, Math.PI * 2);
		ctx.fillStyle = grad;
		ctx.fill();

		// Specular highlight
		ctx.beginPath();
		ctx.arc(this.x - s * 0.25, this.y - s * 0.25, s * 0.35, 0, Math.PI * 2);
		ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
		ctx.fill();

		// Moon
		if (this.hasMoon) {
			const mx = this.x + Math.cos(this.moonAngle) * CONFIG.moonOrbitRadius;
			const my = this.y + Math.sin(this.moonAngle) * CONFIG.moonOrbitRadius;
			const ms = CONFIG.moonSize;

			// Moon orbit ring
			ctx.beginPath();
			ctx.arc(this.x, this.y, CONFIG.moonOrbitRadius, 0, Math.PI * 2);
			ctx.strokeStyle = `hsla(${this.hue}, 20%, 60%, 0.06)`;
			ctx.lineWidth = 0.5;
			ctx.stroke();

			// Moon glow
			const mg = ctx.createRadialGradient(mx, my, 0, mx, my, ms * 3);
			mg.addColorStop(0, `hsla(${this.hue}, 30%, 80%, 0.2)`);
			mg.addColorStop(1, `hsla(${this.hue}, 30%, 80%, 0)`);
			ctx.beginPath();
			ctx.arc(mx, my, ms * 3, 0, Math.PI * 2);
			ctx.fillStyle = mg;
			ctx.fill();

			// Moon body
			ctx.beginPath();
			ctx.arc(mx, my, ms, 0, Math.PI * 2);
			ctx.fillStyle = `hsla(${this.hue}, 25%, 75%, 0.85)`;
			ctx.fill();
		}
	}
}

// ─── BACKGROUND STAR ───────────────────────────────────────────────────────────
class Star {
	constructor() {
		this.x = rand(0, W || 800);
		this.y = rand(0, H || 600);
		this.size = rand(0.3, CONFIG.starFieldMaxSize);
		this.phase = rand(0, Math.PI * 2);
		this.speed = rand(0.2, CONFIG.twinkleSpeed);
		this.baseAlpha = rand(0.1, 0.4);
	}

	draw(t) {
		const alpha = this.baseAlpha + Math.sin(t * this.speed + this.phase) * this.baseAlpha * 0.6;
		if (alpha <= 0) return;
		ctx.beginPath();
		ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
		ctx.fillStyle = `rgba(220, 230, 255, ${alpha})`;
		ctx.fill();
	}
}

// ─── CLICK PULSE ───────────────────────────────────────────────────────────────
class Pulse {
	constructor(x, y) {
		this.x = x;
		this.y = y;
		this.radius = 0;
		this.strength = CONFIG.clickPulseStrength;
	}

	update(dt) {
		this.radius += CONFIG.clickPulseSpeed * dt;
		this.strength *= CONFIG.clickPulseDecay;
		return this.strength > 0.01;
	}

	draw() {
		if (this.strength < 0.01) return;
		ctx.beginPath();
		ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
		ctx.strokeStyle = `rgba(255, 220, 150, ${this.strength * 0.3})`;
		ctx.lineWidth = 2;
		ctx.stroke();
	}
}

// ─── DRAWING HELPERS ───────────────────────────────────────────────────────────

function drawStar() {
	const pulse = 1 + Math.sin(time * CONFIG.starPulseSpeed) * CONFIG.starPulseAmount;
	const r = CONFIG.starRadius * pulse;
	const gr = CONFIG.starGlowRadius * pulse;

	// Outermost corona
	const g3 = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, gr * 1.3);
	g3.addColorStop(0, 'rgba(255, 200, 100, 0.06)');
	g3.addColorStop(0.5, 'rgba(255, 180, 60, 0.02)');
	g3.addColorStop(1, 'rgba(255, 160, 40, 0)');
	ctx.beginPath();
	ctx.arc(cx, cy, gr * 1.3, 0, Math.PI * 2);
	ctx.fillStyle = g3;
	ctx.fill();

	// Mid glow
	const g2 = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, gr);
	g2.addColorStop(0, 'rgba(255, 230, 160, 0.3)');
	g2.addColorStop(0.4, 'rgba(255, 200, 100, 0.1)');
	g2.addColorStop(1, 'rgba(255, 180, 60, 0)');
	ctx.beginPath();
	ctx.arc(cx, cy, gr, 0, Math.PI * 2);
	ctx.fillStyle = g2;
	ctx.fill();

	// Core
	const g1 = ctx.createRadialGradient(cx - r * 0.15, cy - r * 0.15, r * 0.1, cx, cy, r);
	g1.addColorStop(0, 'rgba(255, 255, 240, 0.95)');
	g1.addColorStop(0.5, 'rgba(255, 220, 140, 0.85)');
	g1.addColorStop(0.85, 'rgba(255, 180, 80, 0.6)');
	g1.addColorStop(1, 'rgba(255, 150, 50, 0.2)');
	ctx.beginPath();
	ctx.arc(cx, cy, r, 0, Math.PI * 2);
	ctx.fillStyle = g1;
	ctx.fill();
}

function drawOrbitalRing(radius, index) {
	const isGear = CONFIG.gearRings.includes(index);
	const h = CONFIG.ringHue;
	const s = CONFIG.ringSat;
	const l = CONFIG.ringLight;

	// Dashed ring
	ctx.beginPath();
	ctx.arc(cx, cy, radius, 0, Math.PI * 2);
	ctx.setLineDash([CONFIG.ringDashLength, CONFIG.ringGapLength]);
	ctx.strokeStyle = `hsla(${h}, ${s}%, ${l}%, ${CONFIG.ringAlpha})`;
	ctx.lineWidth = 1;
	ctx.stroke();
	ctx.setLineDash([]);

	// Gear teeth
	if (isGear) {
		const teeth = CONFIG.gearTeethCount;
		const ts = CONFIG.gearToothSize;
		// Rotate gear slowly based on time
		const gearAngle = time * 0.1 * (index % 2 === 0 ? 1 : -1);
		for (let i = 0; i < teeth; i++) {
			const a = gearAngle + (i / teeth) * Math.PI * 2;
			const outerR = radius + ts;
			const innerR = radius;
			const halfTooth = (Math.PI / teeth) * 0.3;

			ctx.beginPath();
			ctx.moveTo(
				cx + Math.cos(a - halfTooth) * innerR,
				cy + Math.sin(a - halfTooth) * innerR
			);
			ctx.lineTo(
				cx + Math.cos(a - halfTooth * 0.6) * outerR,
				cy + Math.sin(a - halfTooth * 0.6) * outerR
			);
			ctx.lineTo(
				cx + Math.cos(a + halfTooth * 0.6) * outerR,
				cy + Math.sin(a + halfTooth * 0.6) * outerR
			);
			ctx.lineTo(
				cx + Math.cos(a + halfTooth) * innerR,
				cy + Math.sin(a + halfTooth) * innerR
			);
			ctx.closePath();
			ctx.fillStyle = `hsla(${h}, ${s}%, ${l}%, ${CONFIG.ringAlpha * 0.6})`;
			ctx.fill();
		}
	}
}

function drawConnections() {
	const maxDist = CONFIG.connectionMaxDist;
	const maxDistSq = maxDist * maxDist;

	for (let i = 0; i < planets.length; i++) {
		for (let j = i + 1; j < planets.length; j++) {
			const a = planets[i];
			const b = planets[j];
			const dx = a.x - b.x;
			const dy = a.y - b.y;
			const distSq = dx * dx + dy * dy;

			if (distSq < maxDistSq) {
				const dist = Math.sqrt(distSq);
				const t = 1 - dist / maxDist;
				const alpha = t * t * CONFIG.connectionAlpha;
				// Shimmer
				const shimmer = 0.5 + 0.5 * Math.sin(time * 2 + i * 1.7 + j * 2.3);
				const finalAlpha = alpha * shimmer;

				if (finalAlpha > 0.003) {
					const midHue = (a.hue + b.hue) / 2;
					ctx.beginPath();
					ctx.moveTo(a.x, a.y);
					ctx.lineTo(b.x, b.y);
					ctx.strokeStyle = `hsla(${midHue}, 50%, 70%, ${finalAlpha})`;
					ctx.lineWidth = t * 1.5;
					ctx.stroke();
				}
			}
		}
	}
}

// ─── INITIALIZATION ────────────────────────────────────────────────────────────
function initScene() {
	cx = W / 2;
	cy = H / 2;

	planets = [];
	for (let i = 0; i < CONFIG.planetCount; i++) {
		planets.push(new Planet(i));
	}

	stars = [];
	for (let i = 0; i < CONFIG.starFieldCount; i++) {
		stars.push(new Star());
	}

	pulses = [];
}

// ─── RENDER ────────────────────────────────────────────────────────────────────
function startAnimation() {
	function render(now) {
		if (!ctx) return;

		const dt = Math.min((now - lastNow) / 1000, 0.1);
		lastNow = now;
		time += dt;

		ctx.clearRect(0, 0, W, H);

		// Background stars
		for (const s of stars) {
			s.draw(time);
		}

		// Orbital rings
		for (let i = 0; i < planets.length; i++) {
			drawOrbitalRing(planets[i].orbitRadius, i);
		}

		// Update planets
		for (const p of planets) {
			p.update(dt);
		}

		// Connection threads
		drawConnections();

		// Planet trails (behind planets)
		for (const p of planets) {
			p.drawTrail();
		}

		// Central star (drawn after trails so it glows on top)
		drawStar();

		// Planets (on top of everything)
		for (const p of planets) {
			p.drawPlanet();
		}

		// Click pulses
		for (let i = pulses.length - 1; i >= 0; i--) {
			if (!pulses[i].update(dt)) {
				pulses.splice(i, 1);
			} else {
				pulses[i].draw();
			}
		}

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}

function spawnPulse(x, y) {
	if (pulses.length < 5) {
		pulses.push(new Pulse(x, y));
	}
}

// ─── MESSAGE HANDLER ───────────────────────────────────────────────────────────
self.onmessage = (e) => {
	switch (e.data.type) {
		case 'init':
			canvas = e.data.canvas;
			ctx = canvas.getContext('2d');
			W = e.data.width;
			H = e.data.height;
			canvas.width = W;
			canvas.height = H;
			lastNow = performance.now();
			initScene();
			startAnimation();
			break;
		case 'resize':
			W = e.data.width;
			H = e.data.height;
			canvas.width = W;
			canvas.height = H;
			cx = W / 2;
			cy = H / 2;
			// Recalculate star positions
			for (const s of stars) {
				s.x = rand(0, W);
				s.y = rand(0, H);
			}
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
		case 'click':
			spawnPulse(e.data.x, e.data.y);
			break;
		case 'mousedown':
			break;
		case 'mouseup':
			break;
		case 'touchstart':
			if (e.data.touches && e.data.touches.length > 0) {
				spawnPulse(e.data.touches[0].x, e.data.touches[0].y);
			}
			break;
		case 'touchmove':
			if (e.data.touches && e.data.touches.length > 0) {
				mouse.x = e.data.touches[0].x;
				mouse.y = e.data.touches[0].y;
			}
			break;
		case 'touchend':
			break;
		case 'context':
			break;
	}
};
