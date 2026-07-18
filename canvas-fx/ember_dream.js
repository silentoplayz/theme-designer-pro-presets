/**
 * Title: Ember Dream
 * Description: A warm, hypnotic field of drifting embers and ghostly flame wisps
 *   rising through the screen like a campfire viewed in a trance. Features pooled
 *   glowing particles with pulsing halos, translucent bezier flame shapes that
 *   morph as they rise, ambient glow pools, and a subtle heat shimmer. Mouse
 *   creates a wind-dispersal effect; clicks burst new embers outward.
 */

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG = {
	// Embers
	emberCount: 180,
	emberMinCore: 1,
	emberMaxCore: 3.5,
	emberMinGlow: 8,
	emberMaxGlow: 18,
	emberRiseSpeed: 0.3,
	emberRiseVariance: 0.2,
	emberSwayAmount: 30,
	emberSwaySpeed: 0.5,
	emberPulseSpeed: 1.2,
	emberPulseAmount: 0.4,
	emberFadeInZone: 0.15,      // Bottom 15% of screen: embers fade in
	emberFadeOutZone: 0.1,      // Top 10%: embers fade out
	emberSpawnSpread: 1.2,      // Horizontal spawn spread (1 = screen width)

	// Flame wisps
	wispCount: 10,
	wispMinAlpha: 0.025,
	wispMaxAlpha: 0.065,
	wispRiseSpeed: 0.15,
	wispWidth: 60,
	wispHeight: 200,
	wispSwayAmount: 40,
	wispControlPoints: 5,
	wispFlickerSpeed: 0.8,

	// Glow pools
	glowPoolCount: 4,
	glowPoolRadius: 200,
	glowPoolAlpha: 0.035,
	glowPoolDriftSpeed: 0.1,

	// Heat shimmer
	shimmerEnabled: true,
	shimmerAlpha: 0.015,
	shimmerWaveCount: 8,
	shimmerSpeed: 0.6,

	// Interaction
	windRadius: 160,
	windStrength: 2.5,
	burstCount: 25,
	burstSpeed: 3,
	burstDecay: 0.96,

	// Colors (HSLA)
	coreColor: [42, 100, 95],       // Near-white yellow
	glowColorHot: [30, 100, 60],    // Orange
	glowColorCool: [8, 90, 40],     // Deep red-orange
	wispColorTop: [45, 100, 65],    // Bright yellow
	wispColorMid: [25, 95, 50],     // Orange
	wispColorBase: [5, 85, 30],     // Deep crimson
	glowPoolColor: [20, 90, 45],    // Warm amber-orange
};

// ─── STATE ─────────────────────────────────────────────────────────────────────
let canvas, ctx, W, H;
let mouse = { x: -9999, y: -9999 };
let time = 0, lastNow = 0;

// Ember pool — flat arrays for performance
let emberX, emberY, emberVx, emberVy;
let emberCoreSize, emberGlowSize, emberPhase, emberSpeed, emberAlpha;
let emberHue, emberLife, emberMaxLife;
let emberActive;

// Wisps
let wisps = [];

// Glow pools
let glowPools = [];

// Burst embers (separate short-lived pool)
let bursts = [];

// ─── HEARTBEAT ─────────────────────────────────────────────────────────────────
setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

// ─── UTILITIES ─────────────────────────────────────────────────────────────────
function rand(a, b) { return Math.random() * (b - a) + a; }
function lerp(a, b, t) { return a + (b - a) * t; }

// ─── EMBER POOL ────────────────────────────────────────────────────────────────
function initEmberPool() {
	const n = CONFIG.emberCount;
	emberX = new Float32Array(n);
	emberY = new Float32Array(n);
	emberVx = new Float32Array(n);
	emberVy = new Float32Array(n);
	emberCoreSize = new Float32Array(n);
	emberGlowSize = new Float32Array(n);
	emberPhase = new Float32Array(n);
	emberSpeed = new Float32Array(n);
	emberAlpha = new Float32Array(n);
	emberHue = new Float32Array(n);
	emberLife = new Float32Array(n);
	emberMaxLife = new Float32Array(n);
	emberActive = new Uint8Array(n);

	for (let i = 0; i < n; i++) {
		resetEmber(i, true);
	}
}

function resetEmber(i, scatter) {
	const w = W || 800;
	const h = H || 600;
	emberX[i] = rand(w * (1 - CONFIG.emberSpawnSpread) / 2, w * (1 + CONFIG.emberSpawnSpread) / 2);
	emberY[i] = scatter ? rand(0, h) : rand(h * 0.85, h * 1.05);
	emberVx[i] = rand(-0.2, 0.2);
	emberVy[i] = -(CONFIG.emberRiseSpeed + rand(0, CONFIG.emberRiseVariance));
	emberCoreSize[i] = rand(CONFIG.emberMinCore, CONFIG.emberMaxCore);
	emberGlowSize[i] = rand(CONFIG.emberMinGlow, CONFIG.emberMaxGlow);
	emberPhase[i] = rand(0, Math.PI * 2);
	emberSpeed[i] = rand(0.7, 1.3);
	emberHue[i] = rand(8, 42); // Red-orange to yellow
	emberLife[i] = 0;
	emberMaxLife[i] = rand(6, 14); // Seconds
	emberActive[i] = 1;
}

function updateEmbers(dt) {
	const n = CONFIG.emberCount;
	const fadeInY = H * (1 - CONFIG.emberFadeInZone);
	const fadeOutY = H * CONFIG.emberFadeOutZone;

	for (let i = 0; i < n; i++) {
		if (!emberActive[i]) {
			resetEmber(i, false);
			continue;
		}

		emberLife[i] += dt;
		if (emberLife[i] > emberMaxLife[i] || emberY[i] < -20) {
			resetEmber(i, false);
			continue;
		}

		// Phase for pulsing
		emberPhase[i] += CONFIG.emberPulseSpeed * dt * emberSpeed[i];

		// Sway
		const sway = Math.sin(time * CONFIG.emberSwaySpeed + emberPhase[i]) * CONFIG.emberSwayAmount * 0.01;
		emberVx[i] += sway * dt;

		// Wind from mouse
		const dx = emberX[i] - mouse.x;
		const dy = emberY[i] - mouse.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist < CONFIG.windRadius && dist > 1) {
			const force = (1 - dist / CONFIG.windRadius) * CONFIG.windStrength;
			emberVx[i] += (dx / dist) * force * dt;
		}

		// Apply velocity
		emberX[i] += emberVx[i];
		emberY[i] += emberVy[i] * emberSpeed[i];

		// Dampen horizontal drift
		emberVx[i] *= 0.98;

		// Wrap horizontally
		if (emberX[i] < -20) emberX[i] = W + 20;
		if (emberX[i] > W + 20) emberX[i] = -20;

		// Calculate display alpha
		const lifeFrac = emberLife[i] / emberMaxLife[i];
		let alpha = 1;
		if (lifeFrac < 0.1) alpha = lifeFrac / 0.1;         // Fade in
		if (lifeFrac > 0.8) alpha = (1 - lifeFrac) / 0.2;   // Fade out
		// Spatial fade
		if (emberY[i] > fadeInY) alpha *= (H - emberY[i]) / (H * CONFIG.emberFadeInZone);
		if (emberY[i] < fadeOutY) alpha *= emberY[i] / (H * CONFIG.emberFadeOutZone);
		// Pulse
		alpha *= 1 + Math.sin(emberPhase[i]) * CONFIG.emberPulseAmount;
		emberAlpha[i] = Math.max(0, Math.min(1, alpha));
	}
}

function drawEmbers() {
	const n = CONFIG.emberCount;
	for (let i = 0; i < n; i++) {
		if (!emberActive[i] || emberAlpha[i] < 0.01) continue;

		const x = emberX[i];
		const y = emberY[i];
		const a = emberAlpha[i];
		const core = emberCoreSize[i];
		const glow = emberGlowSize[i];
		const hue = emberHue[i];

		// Glow halo
		const g = ctx.createRadialGradient(x, y, core * 0.5, x, y, glow);
		const hotA = a * 0.3;
		const coolA = 0;
		g.addColorStop(0, `hsla(${hue}, 100%, 70%, ${hotA})`);
		g.addColorStop(0.3, `hsla(${Math.max(5, hue - 15)}, 95%, 50%, ${hotA * 0.6})`);
		g.addColorStop(1, `hsla(${Math.max(0, hue - 25)}, 90%, 35%, ${coolA})`);
		ctx.beginPath();
		ctx.arc(x, y, glow, 0, Math.PI * 2);
		ctx.fillStyle = g;
		ctx.fill();

		// Bright core
		const cg = ctx.createRadialGradient(x, y, 0, x, y, core);
		cg.addColorStop(0, `hsla(45, 100%, 95%, ${a * 0.9})`);
		cg.addColorStop(1, `hsla(${hue}, 100%, 70%, ${a * 0.4})`);
		ctx.beginPath();
		ctx.arc(x, y, core, 0, Math.PI * 2);
		ctx.fillStyle = cg;
		ctx.fill();
	}
}

// ─── FLAME WISPS ───────────────────────────────────────────────────────────────
class Wisp {
	constructor() {
		this.reset();
	}

	reset() {
		const w = W || 800;
		const h = H || 600;
		this.x = rand(w * 0.1, w * 0.9);
		this.y = rand(h * 0.5, h * 1.1);
		this.width = CONFIG.wispWidth * rand(0.5, 1.5);
		this.height = CONFIG.wispHeight * rand(0.6, 1.4);
		this.alpha = rand(CONFIG.wispMinAlpha, CONFIG.wispMaxAlpha);
		this.phase = rand(0, Math.PI * 2);
		this.speed = rand(0.6, 1.4);
		this.swayPhase = rand(0, Math.PI * 2);
	}

	update(dt) {
		this.y -= CONFIG.wispRiseSpeed * this.speed * dt * 60;
		this.phase += CONFIG.wispFlickerSpeed * dt;
		this.swayPhase += 0.3 * dt;

		// Thin as it rises
		this.width *= (1 - 0.001 * dt * 60);
		this.height *= (1 - 0.0005 * dt * 60);

		if (this.y + this.height < -50 || this.alpha < 0.005) {
			this.reset();
		}
	}

	draw() {
		const cp = CONFIG.wispControlPoints;
		const x = this.x + Math.sin(this.swayPhase) * CONFIG.wispSwayAmount;
		const baseY = this.y;
		const h = this.height;
		const w = this.width;

		// Build a flickering flame shape with bezier curves
		ctx.beginPath();

		// Left side (bottom to top)
		ctx.moveTo(x, baseY);
		for (let i = 1; i < cp; i++) {
			const t = i / cp;
			const py = baseY - h * t;
			const widthAtT = w * 0.5 * (1 - t * t); // Parabolic taper
			const flicker = Math.sin(this.phase * 3 + i * 1.7) * w * 0.08 * (1 - t);
			const px = x - widthAtT + flicker;
			ctx.lineTo(px, py);
		}

		// Tip
		const tipFlicker = Math.sin(this.phase * 5) * w * 0.05;
		ctx.lineTo(x + tipFlicker, baseY - h);

		// Right side (top to bottom)
		for (let i = cp - 1; i >= 1; i--) {
			const t = i / cp;
			const py = baseY - h * t;
			const widthAtT = w * 0.5 * (1 - t * t);
			const flicker = Math.sin(this.phase * 3.3 + i * 2.1 + 1) * w * 0.08 * (1 - t);
			const px = x + widthAtT + flicker;
			ctx.lineTo(px, py);
		}

		ctx.closePath();

		// Gradient fill: red at base → orange mid → yellow tip
		const grad = ctx.createLinearGradient(x, baseY, x, baseY - h);
		const a = this.alpha;
		const bc = CONFIG.wispColorBase;
		const mc = CONFIG.wispColorMid;
		const tc = CONFIG.wispColorTop;
		grad.addColorStop(0, `hsla(${bc[0]}, ${bc[1]}%, ${bc[2]}%, ${a})`);
		grad.addColorStop(0.4, `hsla(${mc[0]}, ${mc[1]}%, ${mc[2]}%, ${a * 0.8})`);
		grad.addColorStop(0.7, `hsla(${tc[0]}, ${tc[1]}%, ${tc[2]}%, ${a * 0.5})`);
		grad.addColorStop(1, `hsla(${tc[0]}, ${tc[1]}%, ${tc[2]}%, 0)`);
		ctx.fillStyle = grad;
		ctx.fill();
	}
}

// ─── GLOW POOLS ────────────────────────────────────────────────────────────────
class GlowPool {
	constructor() {
		this.x = rand(0, W || 800);
		this.y = rand((H || 600) * 0.4, (H || 600) * 0.9);
		this.radius = CONFIG.glowPoolRadius * rand(0.7, 1.3);
		this.phase = rand(0, Math.PI * 2);
		this.driftX = rand(-1, 1) * CONFIG.glowPoolDriftSpeed;
		this.driftY = rand(-0.5, -0.1) * CONFIG.glowPoolDriftSpeed;
	}

	update(dt) {
		this.x += this.driftX * dt * 60;
		this.y += this.driftY * dt * 60;
		this.phase += 0.2 * dt;

		// Wrap
		if (this.x < -this.radius) this.x = W + this.radius;
		if (this.x > W + this.radius) this.x = -this.radius;
		if (this.y < -this.radius) {
			this.y = H * rand(0.6, 0.95);
			this.x = rand(0, W);
		}
	}

	draw() {
		const pulse = 1 + Math.sin(this.phase) * 0.3;
		const r = this.radius * pulse;
		const a = CONFIG.glowPoolAlpha * (0.7 + Math.sin(this.phase * 0.7) * 0.3);
		const c = CONFIG.glowPoolColor;

		const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r);
		g.addColorStop(0, `hsla(${c[0]}, ${c[1]}%, ${c[2]}%, ${a})`);
		g.addColorStop(0.5, `hsla(${c[0]}, ${c[1]}%, ${c[2]}%, ${a * 0.4})`);
		g.addColorStop(1, `hsla(${c[0]}, ${c[1]}%, ${c[2]}%, 0)`);
		ctx.beginPath();
		ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
		ctx.fillStyle = g;
		ctx.fill();
	}
}

// ─── BURST EMBER ───────────────────────────────────────────────────────────────
class BurstEmber {
	constructor(x, y) {
		const angle = rand(0, Math.PI * 2);
		const speed = rand(1, CONFIG.burstSpeed);
		this.x = x;
		this.y = y;
		this.vx = Math.cos(angle) * speed;
		this.vy = Math.sin(angle) * speed - rand(0.5, 1.5); // Bias upward
		this.size = rand(1.5, 4);
		this.hue = rand(15, 50);
		this.life = 1;
		this.decay = CONFIG.burstDecay;
	}

	update(dt) {
		this.x += this.vx * dt * 60;
		this.y += this.vy * dt * 60;
		this.vy += 0.02 * dt * 60; // Gentle gravity
		this.life *= this.decay;
		this.vx *= 0.99;
		this.vy *= 0.99;
		return this.life > 0.01;
	}

	draw() {
		const a = this.life;
		// Glow
		const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.size * 5);
		g.addColorStop(0, `hsla(${this.hue}, 100%, 70%, ${a * 0.4})`);
		g.addColorStop(1, `hsla(${this.hue}, 90%, 40%, 0)`);
		ctx.beginPath();
		ctx.arc(this.x, this.y, this.size * 5, 0, Math.PI * 2);
		ctx.fillStyle = g;
		ctx.fill();

		// Core
		ctx.beginPath();
		ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
		ctx.fillStyle = `hsla(45, 100%, 90%, ${a * 0.9})`;
		ctx.fill();
	}
}

// ─── HEAT SHIMMER ──────────────────────────────────────────────────────────────
function drawHeatShimmer() {
	if (!CONFIG.shimmerEnabled) return;
	const zoneTop = H * 0.65;
	const alpha = CONFIG.shimmerAlpha;

	for (let i = 0; i < CONFIG.shimmerWaveCount; i++) {
		const y = zoneTop + (H - zoneTop) * (i / CONFIG.shimmerWaveCount);
		const waveOffset = Math.sin(time * CONFIG.shimmerSpeed + i * 1.2) * 20;

		ctx.beginPath();
		for (let x = 0; x <= W; x += 4) {
			const wy = y + Math.sin(x * 0.01 + time * CONFIG.shimmerSpeed * 2 + i) * 3 + waveOffset;
			if (x === 0) ctx.moveTo(x, wy);
			else ctx.lineTo(x, wy);
		}
		ctx.strokeStyle = `hsla(25, 80%, 50%, ${alpha * (1 - (i / CONFIG.shimmerWaveCount) * 0.5)})`;
		ctx.lineWidth = rand(15, 30);
		ctx.stroke();
	}
}

// ─── INITIALIZATION ────────────────────────────────────────────────────────────
function initScene() {
	initEmberPool();

	wisps = [];
	for (let i = 0; i < CONFIG.wispCount; i++) {
		wisps.push(new Wisp());
	}

	glowPools = [];
	for (let i = 0; i < CONFIG.glowPoolCount; i++) {
		glowPools.push(new GlowPool());
	}

	bursts = [];
}

function spawnBurst(x, y) {
	for (let i = 0; i < CONFIG.burstCount; i++) {
		bursts.push(new BurstEmber(x, y));
	}
	// Cap burst pool
	if (bursts.length > 150) {
		bursts.splice(0, bursts.length - 100);
	}
}

// ─── RENDER ────────────────────────────────────────────────────────────────────
function startAnimation() {
	function render(now) {
		if (!ctx) return;

		const dt = Math.min((now - lastNow) / 1000, 0.1);
		lastNow = now;
		time += dt;

		ctx.clearRect(0, 0, W, H);

		// Layer 1: Heat shimmer (very bottom)
		drawHeatShimmer();

		// Layer 2: Glow pools (warm ambient light)
		for (const pool of glowPools) {
			pool.update(dt);
			pool.draw();
		}

		// Layer 3: Flame wisps (ghostly, behind embers)
		for (const wisp of wisps) {
			wisp.update(dt);
			wisp.draw();
		}

		// Layer 4: Embers (main attraction)
		updateEmbers(dt);
		drawEmbers();

		// Layer 5: Burst embers (on top)
		for (let i = bursts.length - 1; i >= 0; i--) {
			if (!bursts[i].update(dt)) {
				bursts.splice(i, 1);
			} else {
				bursts[i].draw();
			}
		}

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
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
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
		case 'click':
			spawnBurst(e.data.x, e.data.y);
			break;
		case 'mousedown':
			break;
		case 'mouseup':
			break;
		case 'touchstart':
			if (e.data.touches && e.data.touches.length > 0) {
				spawnBurst(e.data.touches[0].x, e.data.touches[0].y);
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
