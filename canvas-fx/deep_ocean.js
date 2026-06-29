/**
 * Title: Deep Ocean
 * Description: A layered deep-sea vista rendered from the seafloor looking up
 *   toward the surface. God-rays pierce down through the water column, caustic
 *   light networks ripple across the sandy floor, bioluminescent jellyfish
 *   pulse at different depths, kelp fronds sway in the current, and tiny
 *   plankton particles drift through the mid-water. A distant whale song
 *   pulse (visual only) occasionally sweeps across the scene. Five distinct
 *   depth layers create true parallax. Mouse interaction gently shifts the
 *   current direction, swaying kelp and drifting jellyfish.
 *
 *   Fully autonomous — no interaction required.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const JELLY_COUNT         = 7;        // bioluminescent jellyfish
const KELP_STRANDS        = 12;       // kelp fronds along the floor
const PLANKTON_COUNT      = 120;      // tiny drifting particles
const RAY_COUNT           = 5;        // volumetric light shafts
const CAUSTIC_SCALE       = 0.008;    // caustic pattern frequency
const CURRENT_SPEED       = 0.3;      // base ocean current speed
const MOUSE_INFLUENCE     = 0.15;     // how much mouse shifts current
const WHALE_PULSE_CHANCE  = 0.001;    // per-frame chance of visual whale pulse
const BG_DEEP             = [4, 8, 22];      // deep water color
const BG_MID              = [8, 28, 58];      // mid water color
const BG_SURFACE          = [15, 55, 95];     // near-surface glow
/* ──────────────────────────────────────────── */

let canvas, ctx, w, h;
let mouse = { x: 0.5, y: 0.5 }; // normalized 0-1
let jellies = [];
let kelp = [];
let plankton = [];
let rays = [];
let whalePulses = [];
let time = 0;

const TAU = Math.PI * 2;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

// ── Jellyfish ──

function makeJelly(forceY) {
	const depth = Math.random(); // 0 = near surface, 1 = deep
	return {
		x: Math.random() * (w + 200) - 100,
		y: forceY !== undefined ? forceY : Math.random() * h * 0.7 + h * 0.05,
		depth,
		size: 12 + (1 - depth) * 18 + Math.random() * 10,
		hue: Math.random() > 0.5 ? 180 + Math.random() * 40 : 270 + Math.random() * 50,
		pulseSpeed: 0.02 + Math.random() * 0.015,
		pulsePhase: Math.random() * TAU,
		driftSpeed: 0.1 + Math.random() * 0.3,
		wobblePhase: Math.random() * TAU,
		tentacleCount: Math.floor(Math.random() * 4) + 5,
		glowIntensity: 0.3 + Math.random() * 0.4
	};
}

function drawJelly(j) {
	const pulse = 0.7 + 0.3 * Math.sin(time * j.pulseSpeed + j.pulsePhase);
	const wobble = Math.sin(time * 0.008 + j.wobblePhase) * 8;
	const cx = j.x + wobble;
	const cy = j.y;
	const sz = j.size * pulse;
	const alpha = (0.3 + j.depth * 0.4) * j.glowIntensity;

	// Glow halo
	ctx.globalAlpha = alpha * 0.2 * pulse;
	const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, sz * 3);
	glow.addColorStop(0, `hsla(${j.hue}, 80%, 70%, 0.5)`);
	glow.addColorStop(1, `hsla(${j.hue}, 80%, 70%, 0)`);
	ctx.fillStyle = glow;
	ctx.beginPath();
	ctx.arc(cx, cy, sz * 3, 0, TAU);
	ctx.fill();

	// Bell (dome shape)
	ctx.globalAlpha = alpha * 0.7;
	ctx.fillStyle = `hsla(${j.hue}, 70%, 65%, 0.6)`;
	ctx.beginPath();
	ctx.ellipse(cx, cy, sz * 0.7, sz * 0.5 * pulse, 0, Math.PI, 0);
	ctx.fill();

	// Inner bell luminance
	ctx.globalAlpha = alpha * 0.4 * pulse;
	ctx.fillStyle = `hsla(${j.hue}, 90%, 80%, 0.5)`;
	ctx.beginPath();
	ctx.ellipse(cx, cy + sz * 0.05, sz * 0.4, sz * 0.25 * pulse, 0, Math.PI, 0);
	ctx.fill();

	// Tentacles
	ctx.globalAlpha = alpha * 0.35;
	ctx.strokeStyle = `hsla(${j.hue}, 60%, 60%, 0.4)`;
	ctx.lineWidth = 1;
	ctx.lineCap = 'round';
	for (let t = 0; t < j.tentacleCount; t++) {
		const tx = cx + ((t / (j.tentacleCount - 1)) - 0.5) * sz * 1.0;
		const tentLen = sz * (1.2 + Math.sin(time * 0.012 + t * 1.3) * 0.4);
		ctx.beginPath();
		ctx.moveTo(tx, cy + sz * 0.1);
		const cp1x = tx + Math.sin(time * 0.015 + t * 2) * 10;
		const cp1y = cy + tentLen * 0.5;
		const cp2x = tx + Math.sin(time * 0.01 + t * 3) * 15;
		const cp2y = cy + tentLen * 0.8;
		const endY = cy + tentLen;
		ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, tx + Math.sin(time * 0.008 + t) * 12, endY);
		ctx.stroke();
	}
}

// ── Kelp ──

function makeKelp(x) {
	const segments = Math.floor(Math.random() * 6) + 8;
	const segArr = [];
	for (let i = 0; i < segments; i++) {
		segArr.push({
			phaseOffset: Math.random() * TAU,
			swayAmount: 3 + Math.random() * 5 + i * 0.8,
			leafSide: Math.random() > 0.5 ? 1 : -1,
			hasLeaf: i > 2 && Math.random() > 0.3
		});
	}
	return {
		x: x,
		baseY: h,
		height: h * (0.15 + Math.random() * 0.25),
		segments: segArr,
		hue: 100 + Math.random() * 30,
		width: 2 + Math.random() * 2
	};
}

function drawKelp(k, currentOffset) {
	const segH = k.height / k.segments.length;
	let prevX = k.x;
	let prevY = k.baseY;

	ctx.lineCap = 'round';

	for (let i = 0; i < k.segments.length; i++) {
		const seg = k.segments[i];
		const progress = i / k.segments.length;
		const sway = Math.sin(time * 0.006 + seg.phaseOffset) * seg.swayAmount
			+ currentOffset * (progress * 30);
		const nx = k.x + sway;
		const ny = k.baseY - segH * (i + 1);
		const thickness = k.width * (1 - progress * 0.5);

		// Stem
		ctx.globalAlpha = 0.6 - progress * 0.2;
		ctx.strokeStyle = `hsl(${k.hue}, 50%, ${25 + progress * 15}%)`;
		ctx.lineWidth = thickness;
		ctx.beginPath();
		ctx.moveTo(prevX, prevY);
		ctx.quadraticCurveTo(prevX + sway * 0.4, (prevY + ny) / 2, nx, ny);
		ctx.stroke();

		// Leaf blade
		if (seg.hasLeaf) {
			const leafLen = 8 + (1 - progress) * 12;
			const leafSway = Math.sin(time * 0.008 + seg.phaseOffset + 1) * 5;
			const lx = nx + seg.leafSide * (leafLen + leafSway);
			const ly = ny + 3;
			ctx.globalAlpha = 0.4;
			ctx.fillStyle = `hsl(${k.hue}, 55%, ${30 + progress * 10}%)`;
			ctx.beginPath();
			ctx.moveTo(nx, ny);
			ctx.quadraticCurveTo(
				nx + seg.leafSide * leafLen * 0.5, ny - 4,
				lx, ly
			);
			ctx.quadraticCurveTo(
				nx + seg.leafSide * leafLen * 0.5, ny + 6,
				nx, ny + 2
			);
			ctx.fill();
		}

		prevX = nx;
		prevY = ny;
	}
}

// ── Plankton ──

function makePlankton() {
	return {
		x: Math.random() * w,
		y: Math.random() * h,
		size: 0.5 + Math.random() * 1.5,
		speed: 0.05 + Math.random() * 0.15,
		drift: Math.random() * TAU,
		alpha: 0.15 + Math.random() * 0.35
	};
}

function resetPlankton(p) {
	p.x = Math.random() * w;
	p.y = -5;
	p.drift = Math.random() * TAU;
}

// ── Light rays ──

function makeRay() {
	return {
		x: Math.random() * w,
		width: 30 + Math.random() * 80,
		speed: 0.1 + Math.random() * 0.2,
		phase: Math.random() * TAU,
		alpha: 0.03 + Math.random() * 0.04
	};
}

// ── Caustics ──

function drawCaustics() {
	const floorY = h * 0.85;
	const floorH = h - floorY;

	ctx.globalAlpha = 0.08;
	for (let x = 0; x < w; x += 4) {
		const n1 = Math.sin((x * CAUSTIC_SCALE + time * 0.003) * 3) *
			Math.cos((x * CAUSTIC_SCALE * 0.7 + time * 0.004) * 5);
		const n2 = Math.sin((x * CAUSTIC_SCALE * 1.3 + time * 0.002) * 4) *
			Math.cos((x * CAUSTIC_SCALE * 0.5 + time * 0.005) * 3);
		const brightness = (n1 + n2 + 2) / 4; // 0 to 1

		if (brightness > 0.55) {
			const intensity = (brightness - 0.55) / 0.45;
			ctx.fillStyle = `rgba(80, 180, 220, ${intensity * 0.5})`;
			const cy = floorY + Math.sin(x * 0.02 + time * 0.001) * 5;
			ctx.fillRect(x, cy, 4 + intensity * 6, 2 + intensity * 3);
		}
	}
}

// ── Whale pulse (visual sonar sweep) ──

function spawnWhalePulse() {
	whalePulses.push({
		x: Math.random() * w,
		y: h * 0.3 + Math.random() * h * 0.3,
		radius: 0,
		maxRadius: Math.max(w, h) * 0.8,
		speed: 2 + Math.random() * 1.5,
		alpha: 0.12
	});
}

function drawWhalePulses() {
	for (let i = whalePulses.length - 1; i >= 0; i--) {
		const p = whalePulses[i];
		p.radius += p.speed;
		p.alpha *= 0.995;
		if (p.radius > p.maxRadius || p.alpha < 0.005) {
			whalePulses.splice(i, 1);
			continue;
		}
		ctx.globalAlpha = p.alpha;
		ctx.strokeStyle = `rgba(60, 140, 200, 0.6)`;
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(p.x, p.y, p.radius, 0, TAU);
		ctx.stroke();
	}
}

// ── Sandy floor ──

function drawFloor() {
	const floorY = h * 0.85;
	const grad = ctx.createLinearGradient(0, floorY - 20, 0, h);
	grad.addColorStop(0, `rgba(${BG_DEEP[0]}, ${BG_DEEP[1]}, ${BG_DEEP[2]}, 0)`);
	grad.addColorStop(0.15, 'rgb(18, 22, 15)');
	grad.addColorStop(0.5, 'rgb(22, 26, 18)');
	grad.addColorStop(1, 'rgb(12, 14, 10)');
	ctx.globalAlpha = 1;
	ctx.fillStyle = grad;
	ctx.fillRect(0, floorY - 20, w, h - floorY + 20);

	// Sandy bumps
	ctx.fillStyle = 'rgba(35, 38, 25, 0.4)';
	for (let i = 0; i < 30; i++) {
		const bx = (i / 30) * w + Math.sin(i * 4.7) * 20;
		const by = floorY + 5 + Math.sin(i * 2.1) * 8;
		ctx.globalAlpha = 0.2 + Math.sin(i * 1.5) * 0.1;
		ctx.beginPath();
		ctx.ellipse(bx, by, 20 + Math.sin(i * 3) * 10, 4, 0, 0, TAU);
		ctx.fill();
	}
}

// ── Init ──

function initAll() {
	jellies = [];
	for (let i = 0; i < JELLY_COUNT; i++) jellies.push(makeJelly());

	kelp = [];
	for (let i = 0; i < KELP_STRANDS; i++) {
		kelp.push(makeKelp(w * 0.05 + (i / KELP_STRANDS) * w * 0.9 + (Math.random() - 0.5) * 40));
	}

	plankton = [];
	for (let i = 0; i < PLANKTON_COUNT; i++) plankton.push(makePlankton());

	rays = [];
	for (let i = 0; i < RAY_COUNT; i++) rays.push(makeRay());

	whalePulses = [];
}

// ── Render ──

function animate() {
	if (!ctx) return;
	time++;

	const currentOffset = (mouse.x - 0.5) * MOUSE_INFLUENCE;

	// Background: deep water gradient
	const grad = ctx.createLinearGradient(0, 0, 0, h);
	grad.addColorStop(0, `rgb(${BG_SURFACE[0]}, ${BG_SURFACE[1]}, ${BG_SURFACE[2]})`);
	grad.addColorStop(0.35, `rgb(${BG_MID[0]}, ${BG_MID[1]}, ${BG_MID[2]})`);
	grad.addColorStop(0.7, `rgb(${BG_DEEP[0]}, ${BG_DEEP[1]}, ${BG_DEEP[2]})`);
	grad.addColorStop(1, 'rgb(2, 4, 12)');
	ctx.globalAlpha = 1;
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, w, h);

	// Surface shimmer (faint light from above)
	ctx.globalAlpha = 0.04 + Math.sin(time * 0.005) * 0.015;
	const shimmer = ctx.createRadialGradient(w * 0.5, -h * 0.1, 0, w * 0.5, -h * 0.1, h * 0.8);
	shimmer.addColorStop(0, 'rgba(80, 160, 200, 0.3)');
	shimmer.addColorStop(1, 'rgba(80, 160, 200, 0)');
	ctx.fillStyle = shimmer;
	ctx.fillRect(0, 0, w, h * 0.5);

	// Light rays
	for (let i = 0; i < rays.length; i++) {
		const r = rays[i];
		const sway = Math.sin(time * 0.003 + r.phase) * 40 + currentOffset * 60;
		const alpha = r.alpha * (0.7 + 0.3 * Math.sin(time * r.speed * 0.02 + r.phase));
		ctx.globalAlpha = alpha;

		const grad2 = ctx.createLinearGradient(0, 0, 0, h * 0.85);
		grad2.addColorStop(0, 'rgba(100, 190, 230, 0.3)');
		grad2.addColorStop(0.5, 'rgba(60, 140, 180, 0.1)');
		grad2.addColorStop(1, 'rgba(60, 140, 180, 0)');
		ctx.fillStyle = grad2;

		ctx.beginPath();
		const topX = r.x + sway;
		const botSpread = r.width * 1.8;
		ctx.moveTo(topX - r.width * 0.3, 0);
		ctx.lineTo(topX + r.width * 0.3, 0);
		ctx.lineTo(topX + botSpread * 0.5 + sway * 0.5, h * 0.85);
		ctx.lineTo(topX - botSpread * 0.5 + sway * 0.5, h * 0.85);
		ctx.closePath();
		ctx.fill();
	}

	// Whale pulse
	if (Math.random() < WHALE_PULSE_CHANCE) spawnWhalePulse();
	drawWhalePulses();

	// Plankton (behind jellyfish)
	ctx.fillStyle = 'rgba(140, 200, 220, 1)';
	for (let i = 0; i < plankton.length; i++) {
		const p = plankton[i];
		p.x += Math.sin(time * 0.005 + p.drift) * p.speed + currentOffset * CURRENT_SPEED;
		p.y += p.speed * 0.5 + Math.cos(time * 0.003 + p.drift) * 0.1;
		if (p.y > h + 5 || p.x < -10 || p.x > w + 10) resetPlankton(p);

		ctx.globalAlpha = p.alpha * (0.5 + 0.5 * Math.sin(time * 0.02 + p.drift));
		ctx.beginPath();
		ctx.arc(p.x, p.y, p.size, 0, TAU);
		ctx.fill();
	}

	// Jellyfish (mid-water)
	for (let i = 0; i < jellies.length; i++) {
		const j = jellies[i];
		j.x += Math.sin(time * 0.003 + j.wobblePhase) * 0.3 + currentOffset * CURRENT_SPEED * (1 - j.depth * 0.5);
		j.y -= j.driftSpeed * 0.15;
		if (j.y < -j.size * 3) {
			j.y = h + j.size * 2;
			j.x = Math.random() * w;
		}
		if (j.x < -100) j.x = w + 50;
		if (j.x > w + 100) j.x = -50;
		drawJelly(j);
	}

	// Sandy floor
	drawFloor();

	// Caustic light on floor
	drawCaustics();

	// Kelp (foreground, rooted in floor)
	for (let i = 0; i < kelp.length; i++) {
		drawKelp(kelp[i], currentOffset);
	}

	ctx.globalAlpha = 1;
	requestAnimationFrame(animate);
}

// ── Message handler ──

self.onmessage = (e) => {
	switch (e.data.type) {
		case 'init':
			canvas = e.data.canvas;
			ctx = canvas.getContext('2d');
			w = e.data.width;
			h = e.data.height;
			canvas.width = w;
			canvas.height = h;
			initAll();
			animate();
			break;

		case 'resize':
			w = e.data.width;
			h = e.data.height;
			canvas.width = w;
			canvas.height = h;
			initAll();
			break;

		case 'mousemove':
			mouse.x = e.data.x / w;
			mouse.y = e.data.y / h;
			break;

		case 'click':
			spawnWhalePulse();
			break;
	}
};
