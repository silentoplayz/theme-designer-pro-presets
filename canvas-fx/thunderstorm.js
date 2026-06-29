/**
 * Title: Thunderstorm
 * Description: A full-atmosphere thunderstorm viewed from a sheltered vantage
 *   point. Rain falls in dense sheets at three parallax depths, with wind
 *   gusts that periodically shift the rain angle. Lightning cracks illuminate
 *   the entire scene — a bright white flash followed by branching bolt geometry
 *   that forks recursively. Rolling cloud banks drift overhead with volumetric
 *   shading, lit from within by distant heat lightning. Puddle reflections
 *   shimmer along the bottom. Thunder rumble is visualized as a low-frequency
 *   screen shake that decays after each strike. A distant city skyline
 *   silhouette anchors the horizon.
 *
 *   Fully autonomous — click anywhere to trigger a lightning strike.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const RAIN_LAYERS         = 3;        // parallax rain depth layers
const DROPS_PER_LAYER     = [200, 150, 80]; // drops per layer [near, mid, far]
const RAIN_SPEED_BASE     = 12;       // base rain speed
const RAIN_ANGLE_BASE     = 0.15;     // base rain slant (radians)
const WIND_GUST_CHANCE    = 0.003;    // per-frame chance of wind gust
const WIND_GUST_STRENGTH  = 0.4;      // max additional slant from gust
const LIGHTNING_CHANCE     = 0.0015;   // per-frame auto-lightning chance
const LIGHTNING_BRANCHES   = 5;       // max fork depth for bolt geometry
const CLOUD_COUNT         = 6;        // drifting storm clouds
const BUILDING_COUNT      = 18;       // distant skyline buildings
const PUDDLE_REFLECTIONS  = true;     // shimmer along bottom
const SCREEN_SHAKE        = true;     // rumble after lightning
/* ──────────────────────────────────────────── */

let canvas, ctx, w, h;
let rainLayers = [];
let clouds = [];
let buildings = [];
let bolts = [];
let time = 0;
let windAngle = RAIN_ANGLE_BASE;
let windTarget = RAIN_ANGLE_BASE;
let flashAlpha = 0;
let shakeX = 0, shakeY = 0;
let shakeDecay = 0;

const TAU = Math.PI * 2;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

// ── Rain ──

function makeDrop(layer) {
	const depth = 1 - layer / RAIN_LAYERS;
	return {
		x: Math.random() * (w + 100) - 50,
		y: Math.random() * h * 1.2 - h * 0.2,
		speed: (RAIN_SPEED_BASE + Math.random() * 4) * (0.4 + depth * 0.6),
		length: (8 + Math.random() * 12) * (0.3 + depth * 0.7),
		alpha: (0.15 + Math.random() * 0.2) * (0.3 + depth * 0.7),
		width: depth > 0.6 ? 1.5 : 1
	};
}

function initRain() {
	rainLayers = [];
	for (let l = 0; l < RAIN_LAYERS; l++) {
		const drops = [];
		for (let i = 0; i < DROPS_PER_LAYER[l]; i++) drops.push(makeDrop(l));
		rainLayers.push(drops);
	}
}

function drawRain() {
	const cosA = Math.cos(windAngle + Math.PI / 2);
	const sinA = Math.sin(windAngle + Math.PI / 2);

	for (let l = 0; l < rainLayers.length; l++) {
		const drops = rainLayers[l];
		const depth = 1 - l / RAIN_LAYERS;

		for (let i = 0; i < drops.length; i++) {
			const d = drops[i];
			d.x += sinA * d.speed * 0.3;
			d.y += cosA * d.speed;

			if (d.y > h + 20 || d.x < -60 || d.x > w + 60) {
				d.x = Math.random() * (w + 100) - 50;
				d.y = -10 - Math.random() * 30;
			}

			ctx.globalAlpha = d.alpha + flashAlpha * 0.1;
			ctx.strokeStyle = `rgba(180, 200, 220, ${0.4 + depth * 0.3})`;
			ctx.lineWidth = d.width;
			ctx.beginPath();
			ctx.moveTo(d.x, d.y);
			ctx.lineTo(d.x + sinA * d.length, d.y + cosA * d.length);
			ctx.stroke();
		}
	}
}

// ── Lightning bolts ──

function createBolt(x1, y1, x2, y2, depth) {
	if (depth <= 0) return [];

	const segments = [];
	const dx = x2 - x1;
	const dy = y2 - y1;
	const len = Math.sqrt(dx * dx + dy * dy);
	const steps = Math.max(3, Math.floor(len / 20));

	let cx = x1, cy = y1;
	for (let i = 0; i < steps; i++) {
		const t = (i + 1) / steps;
		const nx = x1 + dx * t + (Math.random() - 0.5) * 40 * (depth / LIGHTNING_BRANCHES);
		const ny = y1 + dy * t + (Math.random() - 0.5) * 15;
		segments.push({ x1: cx, y1: cy, x2: nx, y2: ny, alpha: 1, width: depth * 1.5 });
		cx = nx;
		cy = ny;

		// Branch fork
		if (depth > 1 && Math.random() < 0.3) {
			const branchAngle = (Math.random() - 0.5) * 1.2;
			const branchLen = len * (0.2 + Math.random() * 0.3) * (depth / LIGHTNING_BRANCHES);
			const bx = cx + Math.cos(Math.atan2(dy, dx) + branchAngle) * branchLen;
			const by = cy + Math.sin(Math.atan2(dy, dx) + branchAngle) * branchLen;
			segments.push(...createBolt(cx, cy, bx, by, depth - 1));
		}
	}
	return segments;
}

function strikeLightning(x) {
	const strikeX = x !== undefined ? x : Math.random() * w * 0.8 + w * 0.1;
	const segments = createBolt(strikeX, 0, strikeX + (Math.random() - 0.5) * 80, h * 0.75, LIGHTNING_BRANCHES);
	bolts.push({ segments, life: 1, decay: 0.03 + Math.random() * 0.02 });
	flashAlpha = 0.6 + Math.random() * 0.3;

	if (SCREEN_SHAKE) {
		shakeDecay = 1;
	}
}

function drawBolts() {
	for (let i = bolts.length - 1; i >= 0; i--) {
		const bolt = bolts[i];
		bolt.life -= bolt.decay;
		if (bolt.life <= 0) { bolts.splice(i, 1); continue; }

		for (let s = 0; s < bolt.segments.length; s++) {
			const seg = bolt.segments[s];
			// Core (bright white)
			ctx.globalAlpha = bolt.life * 0.9;
			ctx.strokeStyle = `rgba(220, 230, 255, ${bolt.life})`;
			ctx.lineWidth = seg.width;
			ctx.lineCap = 'round';
			ctx.beginPath();
			ctx.moveTo(seg.x1, seg.y1);
			ctx.lineTo(seg.x2, seg.y2);
			ctx.stroke();

			// Glow (wider, dimmer)
			ctx.globalAlpha = bolt.life * 0.25;
			ctx.strokeStyle = `rgba(150, 180, 255, ${bolt.life * 0.5})`;
			ctx.lineWidth = seg.width * 4;
			ctx.beginPath();
			ctx.moveTo(seg.x1, seg.y1);
			ctx.lineTo(seg.x2, seg.y2);
			ctx.stroke();
		}
	}
}

// ── Clouds ──

function makeCloud() {
	return {
		x: Math.random() * (w + 400) - 200,
		y: Math.random() * h * 0.2,
		width: 200 + Math.random() * 300,
		height: 40 + Math.random() * 50,
		speed: 0.1 + Math.random() * 0.2,
		puffs: (() => {
			const n = Math.floor(Math.random() * 5) + 4;
			const arr = [];
			for (let j = 0; j < n; j++) {
				arr.push({
					ox: (Math.random() - 0.5) * 0.9,
					oy: (Math.random() - 0.5) * 0.6,
					r: 0.25 + Math.random() * 0.35,
					lightPhase: Math.random() * TAU
				});
			}
			return arr;
		})()
	};
}

function initClouds() {
	clouds = [];
	for (let i = 0; i < CLOUD_COUNT; i++) clouds.push(makeCloud());
}

function drawClouds() {
	for (let i = 0; i < clouds.length; i++) {
		const c = clouds[i];
		c.x += c.speed;
		if (c.x > w + c.width) c.x = -c.width;

		for (let j = 0; j < c.puffs.length; j++) {
			const p = c.puffs[j];
			const heatFlicker = Math.sin(time * 0.02 + p.lightPhase) > 0.97 ? 0.15 : 0;
			const baseLum = 18 + flashAlpha * 60 + heatFlicker * 40;
			ctx.globalAlpha = 0.5 + flashAlpha * 0.3;
			ctx.fillStyle = `rgb(${baseLum}, ${baseLum + 2}, ${baseLum + 5})`;
			ctx.beginPath();
			ctx.ellipse(
				c.x + p.ox * c.width,
				c.y + p.oy * c.height,
				c.width * p.r * 0.5,
				c.height * p.r,
				0, 0, TAU
			);
			ctx.fill();
		}
	}
}

// ── City skyline ──

function initBuildings() {
	buildings = [];
	for (let i = 0; i < BUILDING_COUNT; i++) {
		const bw = 15 + Math.random() * 35;
		buildings.push({
			x: (i / BUILDING_COUNT) * w + (Math.random() - 0.5) * 20,
			width: bw,
			height: 30 + Math.random() * 80,
			windows: Math.floor(Math.random() * 6) + 2,
			windowFloors: Math.floor(Math.random() * 8) + 3
		});
	}
}

function drawSkyline() {
	const horizonY = h * 0.72;

	for (let i = 0; i < buildings.length; i++) {
		const b = buildings[i];
		const bx = b.x;
		const by = horizonY - b.height;
		const lit = flashAlpha > 0 ? 22 + flashAlpha * 30 : 10;

		ctx.globalAlpha = 0.6 + flashAlpha * 0.3;
		ctx.fillStyle = `rgb(${lit}, ${lit + 1}, ${lit + 3})`;
		ctx.fillRect(bx, by, b.width, b.height);

		// Windows (faint warm glow)
		const winW = b.width / (b.windows * 2 + 1);
		const winH = 2;
		ctx.fillStyle = 'rgba(200, 180, 100, 0.15)';
		for (let wy = 0; wy < b.windowFloors; wy++) {
			for (let wx = 0; wx < b.windows; wx++) {
				if (Math.sin((wx + wy) * 3.7 + i * 2.1) > 0) {
					ctx.fillRect(
						bx + winW + wx * winW * 2,
						by + 4 + wy * (b.height / b.windowFloors),
						winW * 0.8,
						winH
					);
				}
			}
		}
	}

	// Ground plane
	ctx.globalAlpha = 1;
	const groundGrad = ctx.createLinearGradient(0, horizonY, 0, h);
	groundGrad.addColorStop(0, 'rgb(8, 10, 14)');
	groundGrad.addColorStop(1, 'rgb(5, 6, 10)');
	ctx.fillStyle = groundGrad;
	ctx.fillRect(0, horizonY, w, h - horizonY);
}

// ── Puddle reflections ──

function drawPuddles() {
	if (!PUDDLE_REFLECTIONS) return;
	const puddleY = h * 0.85;

	ctx.globalAlpha = 0.04 + flashAlpha * 0.08;
	for (let i = 0; i < 12; i++) {
		const px = (i / 12) * w + Math.sin(i * 5.3) * 40;
		const pw = 40 + Math.sin(i * 3.1) * 20;
		const shimmer = Math.sin(time * 0.02 + i * 2) * 0.02;

		const pGrad = ctx.createRadialGradient(px, puddleY, 0, px, puddleY, pw);
		pGrad.addColorStop(0, `rgba(100, 130, 180, ${0.2 + shimmer + flashAlpha * 0.3})`);
		pGrad.addColorStop(1, 'rgba(100, 130, 180, 0)');
		ctx.fillStyle = pGrad;
		ctx.beginPath();
		ctx.ellipse(px, puddleY, pw, 6, 0, 0, TAU);
		ctx.fill();
	}
}

// ── Init ──

function initAll() {
	initRain();
	initClouds();
	initBuildings();
}

// ── Render ──

function animate() {
	if (!ctx) return;
	time++;

	// Wind gusts
	if (Math.random() < WIND_GUST_CHANCE) {
		windTarget = RAIN_ANGLE_BASE + (Math.random() - 0.3) * WIND_GUST_STRENGTH;
	}
	windAngle += (windTarget - windAngle) * 0.02;
	windTarget += (RAIN_ANGLE_BASE - windTarget) * 0.005;

	// Flash decay
	flashAlpha *= 0.92;
	if (flashAlpha < 0.005) flashAlpha = 0;

	// Screen shake decay
	if (shakeDecay > 0) {
		shakeX = (Math.random() - 0.5) * 6 * shakeDecay;
		shakeY = (Math.random() - 0.5) * 3 * shakeDecay;
		shakeDecay *= 0.93;
		if (shakeDecay < 0.01) { shakeDecay = 0; shakeX = 0; shakeY = 0; }
	}

	ctx.save();
	if (SCREEN_SHAKE) ctx.translate(shakeX, shakeY);

	// Storm sky
	const skyGrad = ctx.createLinearGradient(0, 0, 0, h * 0.7);
	skyGrad.addColorStop(0, `rgb(${8 + flashAlpha * 40}, ${10 + flashAlpha * 42}, ${18 + flashAlpha * 45})`);
	skyGrad.addColorStop(0.5, `rgb(${12 + flashAlpha * 30}, ${14 + flashAlpha * 32}, ${22 + flashAlpha * 35})`);
	skyGrad.addColorStop(1, `rgb(${10 + flashAlpha * 25}, ${12 + flashAlpha * 28}, ${20 + flashAlpha * 30})`);
	ctx.globalAlpha = 1;
	ctx.fillStyle = skyGrad;
	ctx.fillRect(-10, -10, w + 20, h + 20);

	// Flash overlay
	if (flashAlpha > 0.01) {
		ctx.globalAlpha = flashAlpha * 0.3;
		ctx.fillStyle = 'rgba(200, 210, 230, 1)';
		ctx.fillRect(-10, -10, w + 20, h + 20);
	}

	drawClouds();

	if (Math.random() < LIGHTNING_CHANCE) strikeLightning();
	drawBolts();

	drawSkyline();
	drawPuddles();
	drawRain();

	ctx.restore();
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

		case 'click':
			strikeLightning(e.data.x);
			break;

		case 'mousemove':
			windTarget = RAIN_ANGLE_BASE + ((e.data.x / w) - 0.5) * 0.2;
			break;
	}
};
