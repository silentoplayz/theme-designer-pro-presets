/**
 * Title: Mycelium Network
 * Description: An organic fungal mycelium that grows outward from seed points,
 *   branching stochastically. Nutrient pulses race along established connections,
 *   mature nodes release spores, and the mouse acts as a nutrient source that
 *   accelerates nearby growth and attracts branching direction.
 */

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CONFIG = {
	seedCount: 4, // number of initial growth origin points
	growthSpeed: 40, // px/s – base tip extension speed
	growthAngleVariance: 0.35, // radians – max random wander per step
	branchProbability: 0.012, // per-frame chance of branching at a tip
	branchAngleRange: 0.8, // radians – max branch fork angle
	maxBranchDepth: 7, // maximum recursive branching depth
	maxSegments: 4000, // hard cap on total hypha segments
	hyphaWidth: 1.5, // px – base strand thickness
	hyphaAlpha: 0.6, // base alpha of hypha strands
	pulseSpeed: 120, // px/s – speed of nutrient pulses
	pulseFrequency: 0.3, // pulses spawned per second per seed
	pulseGlow: 8, // px – glow radius around a pulse dot
	pulseSize: 3, // px – core radius of pulse dot
	nodeGlowRadius: 12, // px – glow at branch intersection nodes
	nodeGlowAlpha: 0.15, // alpha of node glow
	fadeRate: 0.0008, // alpha decay per second for old segments
	sporeCount: 5, // spores per burst
	sporeSpeed: 25, // px/s – spore drift speed
	sporeLifetime: 3.0, // seconds before spore fades
	sporeBurstChance: 0.005, // per-frame chance a mature node bursts
	mouseNutrientRadius: 200, // px – radius of mouse nutrient influence
	mouseGrowthBoost: 2.5, // multiplier for growth speed near mouse
	mouseBranchBoost: 3.0, // multiplier for branch probability near mouse
	baseHue: 80, // HSL hue (80 = yellow-green)
	hueVariance: 30, // random hue offset range
	glowPasses: 2, // additive glow passes for the network
	glowExpand: 4, // px – extra width per glow pass
	glowAlpha: 0.04, // alpha per glow pass
	trailAlpha: 0.03, // motion trail decay alpha
	layerCount: 3, // parallax depth layers
	layerAlphaScale: 0.4 // alpha multiplier for the deepest layer
};

// ─── GLOBALS ─────────────────────────────────────────────────────────────────
let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let lastTime = 0;

// Segment storage: Float32Array columns (x1,y1,x2,y2,age,branchDepth,layer,hue)
const SEG_STRIDE = 8;
let segments = null; // Float32Array
let segCount = 0;

// Active tips: objects with {x,y,angle,depth,layer,hue,active}
let tips = [];
const MAX_TIPS = 500;

// Pulses: {segIndex, t, speed, layer}
let pulses = [];
const MAX_PULSES = 200;

// Spores: Float32Array (x,y,vx,vy,life,maxLife,layer)
const SPORE_STRIDE = 7;
let spores = null;
let sporeCount = 0;
const MAX_SPORES = 300;

// Nodes (branch points): Float32Array (x,y,age,layer)
const NODE_STRIDE = 4;
let nodes = null;
let nodeCount = 0;
const MAX_NODES = 800;

setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

// ─── INIT ────────────────────────────────────────────────────────────────────
function initAll() {
	segments = new Float32Array(CONFIG.maxSegments * SEG_STRIDE);
	segCount = 0;
	tips = [];
	pulses = [];
	spores = new Float32Array(MAX_SPORES * SPORE_STRIDE);
	sporeCount = 0;
	nodes = new Float32Array(MAX_NODES * NODE_STRIDE);
	nodeCount = 0;
	lastTime = 0;

	// Seed points
	for (let i = 0; i < CONFIG.seedCount; i++) {
		const layer = i % CONFIG.layerCount;
		tips.push({
			x: width * 0.2 + Math.random() * width * 0.6,
			y: height * 0.2 + Math.random() * height * 0.6,
			angle: Math.random() * Math.PI * 2,
			depth: 0,
			layer,
			hue: CONFIG.baseHue + (Math.random() - 0.5) * CONFIG.hueVariance,
			active: true
		});
	}
}

// ─── SPATIAL HASH (for node proximity) ──────────────────────────────────────
const CELL_SIZE = 50;
let hashMap = new Map();

function hashKey(x, y) {
	return ((x / CELL_SIZE) | 0) * 100000 + ((y / CELL_SIZE) | 0);
}

function rebuildHash() {
	hashMap.clear();
	for (let i = 0; i < segCount; i++) {
		const off = i * SEG_STRIDE;
		const key = hashKey(segments[off + 2], segments[off + 3]);
		if (!hashMap.has(key)) hashMap.set(key, []);
		hashMap.get(key).push(i);
	}
}

function nearbySegCount(x, y, radius) {
	let count = 0;
	const cells = Math.ceil(radius / CELL_SIZE);
	const cx = (x / CELL_SIZE) | 0;
	const cy = (y / CELL_SIZE) | 0;
	for (let dx = -cells; dx <= cells; dx++) {
		for (let dy = -cells; dy <= cells; dy++) {
			const key = (cx + dx) * 100000 + (cy + dy);
			const bucket = hashMap.get(key);
			if (bucket) count += bucket.length;
		}
	}
	return count;
}

// ─── UPDATE ──────────────────────────────────────────────────────────────────
function update(dt) {
	// Grow tips
	const activeTips = [];
	for (const tip of tips) {
		if (!tip.active) continue;
		if (segCount >= CONFIG.maxSegments) {
			tip.active = false;
			continue;
		}

		// Mouse influence
		const dx = mouse.x - tip.x;
		const dy = mouse.y - tip.y;
		const distMouse = Math.sqrt(dx * dx + dy * dy);
		const mouseInfluence =
			distMouse < CONFIG.mouseNutrientRadius ? 1 - distMouse / CONFIG.mouseNutrientRadius : 0;

		const speed = CONFIG.growthSpeed * (1 + mouseInfluence * (CONFIG.mouseGrowthBoost - 1));

		// Steer toward mouse slightly
		if (mouseInfluence > 0) {
			const toMouse = Math.atan2(dy, dx);
			let angleDiff = toMouse - tip.angle;
			while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
			while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
			tip.angle += angleDiff * 0.1 * mouseInfluence;
		}

		// Wander
		tip.angle += (Math.random() - 0.5) * CONFIG.growthAngleVariance;

		const nx = tip.x + Math.cos(tip.angle) * speed * dt;
		const ny = tip.y + Math.sin(tip.angle) * speed * dt;

		// Cull if off-screen
		if (nx < -50 || nx > width + 50 || ny < -50 || ny > height + 50) {
			tip.active = false;
			continue;
		}

		// Store segment
		const off = segCount * SEG_STRIDE;
		segments[off + 0] = tip.x;
		segments[off + 1] = tip.y;
		segments[off + 2] = nx;
		segments[off + 3] = ny;
		segments[off + 4] = 0; // age
		segments[off + 5] = tip.depth;
		segments[off + 6] = tip.layer;
		segments[off + 7] = tip.hue;
		segCount++;

		tip.x = nx;
		tip.y = ny;

		// Branching
		const branchProb =
			CONFIG.branchProbability * (1 + mouseInfluence * (CONFIG.mouseBranchBoost - 1));
		if (Math.random() < branchProb && tip.depth < CONFIG.maxBranchDepth && tips.length < MAX_TIPS) {
			const branchAngle = tip.angle + (Math.random() - 0.5) * CONFIG.branchAngleRange;
			tips.push({
				x: nx,
				y: ny,
				angle: branchAngle,
				depth: tip.depth + 1,
				layer: tip.layer,
				hue: tip.hue + (Math.random() - 0.5) * 10,
				active: true
			});
			// Store branch node
			if (nodeCount < MAX_NODES) {
				const noff = nodeCount * NODE_STRIDE;
				nodes[noff + 0] = nx;
				nodes[noff + 1] = ny;
				nodes[noff + 2] = 0;
				nodes[noff + 3] = tip.layer;
				nodeCount++;
			}
		}

		activeTips.push(tip);
	}

	// Age segments
	for (let i = 0; i < segCount; i++) {
		segments[i * SEG_STRIDE + 4] += dt;
	}
	for (let i = 0; i < nodeCount; i++) {
		nodes[i * NODE_STRIDE + 2] += dt;
	}

	// Spawn pulses
	if (segCount > 10 && pulses.length < MAX_PULSES) {
		if (Math.random() < CONFIG.pulseFrequency * dt) {
			pulses.push({
				segIndex: Math.floor(Math.random() * segCount),
				t: 0,
				speed: CONFIG.pulseSpeed,
				layer: Math.floor(Math.random() * CONFIG.layerCount)
			});
		}
	}

	// Update pulses
	for (let i = pulses.length - 1; i >= 0; i--) {
		pulses[i].t += CONFIG.pulseSpeed * dt;
		const si = pulses[i].segIndex;
		if (si >= segCount || pulses[i].t > 1) {
			// Move to next segment or remove
			const nextSeg = si + 1;
			if (nextSeg < segCount) {
				pulses[i].segIndex = nextSeg;
				pulses[i].t = 0;
			} else {
				pulses.splice(i, 1);
			}
		}
	}

	// Spore bursts from mature nodes
	for (let i = 0; i < nodeCount; i++) {
		const noff = i * NODE_STRIDE;
		if (nodes[noff + 2] > 5 && Math.random() < CONFIG.sporeBurstChance) {
			for (let s = 0; s < CONFIG.sporeCount && sporeCount < MAX_SPORES; s++) {
				const soff = sporeCount * SPORE_STRIDE;
				const angle = Math.random() * Math.PI * 2;
				spores[soff + 0] = nodes[noff + 0];
				spores[soff + 1] = nodes[noff + 1];
				spores[soff + 2] = Math.cos(angle) * CONFIG.sporeSpeed * (0.5 + Math.random());
				spores[soff + 3] = Math.sin(angle) * CONFIG.sporeSpeed * (0.5 + Math.random());
				spores[soff + 4] = CONFIG.sporeLifetime;
				spores[soff + 5] = CONFIG.sporeLifetime;
				spores[soff + 6] = nodes[noff + 3]; // layer
				sporeCount++;
			}
		}
	}

	// Update spores
	let aliveSpores = 0;
	for (let i = 0; i < sporeCount; i++) {
		const soff = i * SPORE_STRIDE;
		spores[soff + 0] += spores[soff + 2] * dt;
		spores[soff + 1] += spores[soff + 3] * dt;
		spores[soff + 4] -= dt;
		if (spores[soff + 4] > 0) {
			if (aliveSpores !== i) {
				const doff = aliveSpores * SPORE_STRIDE;
				for (let j = 0; j < SPORE_STRIDE; j++) spores[doff + j] = spores[soff + j];
			}
			aliveSpores++;
		}
	}
	sporeCount = aliveSpores;
}

// ─── DRAW ────────────────────────────────────────────────────────────────────
function draw() {
	// Trail overlay
	ctx.fillStyle = `rgba(0,0,0,${CONFIG.trailAlpha})`;
	ctx.fillRect(0, 0, width, height);

	// Draw per layer (back to front)
	for (let layer = CONFIG.layerCount - 1; layer >= 0; layer--) {
		const layerAlpha = 1 - (layer / CONFIG.layerCount) * (1 - CONFIG.layerAlphaScale);

		// Glow passes
		ctx.globalCompositeOperation = 'lighter';
		for (let pass = 0; pass < CONFIG.glowPasses; pass++) {
			const extraW = (pass + 1) * CONFIG.glowExpand;
			const gAlpha = CONFIG.glowAlpha / (pass + 1);
			drawSegments(layer, layerAlpha * gAlpha, CONFIG.hyphaWidth + extraW);
		}

		// Solid pass
		ctx.globalCompositeOperation = 'source-over';
		drawSegments(layer, layerAlpha, CONFIG.hyphaWidth);

		// Nodes
		drawNodes(layer, layerAlpha);

		// Pulses
		drawPulses(layer, layerAlpha);

		// Spores
		drawSpores(layer, layerAlpha);
	}
}

function drawSegments(layer, alphaScale, lineWidth) {
	ctx.lineWidth = lineWidth;
	ctx.lineCap = 'round';

	// Batch by similar hue for fewer style changes
	for (let i = 0; i < segCount; i++) {
		const off = i * SEG_STRIDE;
		if (segments[off + 6] !== layer) continue;

		const age = segments[off + 4];
		const depth = segments[off + 5];
		const hue = segments[off + 7];
		const fade = Math.max(0, 1 - age * CONFIG.fadeRate);
		const depthFade = 1 / (1 + depth * 0.15);
		const alpha = CONFIG.hyphaAlpha * fade * depthFade * alphaScale;

		if (alpha < 0.005) continue;

		ctx.beginPath();
		ctx.moveTo(segments[off + 0], segments[off + 1]);
		ctx.lineTo(segments[off + 2], segments[off + 3]);
		ctx.strokeStyle = `hsla(${hue | 0},70%,60%,${alpha.toFixed(3)})`;
		ctx.stroke();
	}
}

function drawNodes(layer, alphaScale) {
	ctx.globalCompositeOperation = 'lighter';
	for (let i = 0; i < nodeCount; i++) {
		const noff = i * NODE_STRIDE;
		if (nodes[noff + 3] !== layer) continue;

		const alpha = CONFIG.nodeGlowAlpha * alphaScale;
		if (alpha < 0.005) continue;

		ctx.beginPath();
		ctx.arc(nodes[noff + 0], nodes[noff + 1], CONFIG.nodeGlowRadius, 0, Math.PI * 2);
		ctx.fillStyle = `hsla(${CONFIG.baseHue},80%,70%,${alpha.toFixed(3)})`;
		ctx.fill();
	}
	ctx.globalCompositeOperation = 'source-over';
}

function drawPulses(layer, alphaScale) {
	ctx.globalCompositeOperation = 'lighter';
	for (const pulse of pulses) {
		if (pulse.layer !== layer) continue;
		const si = pulse.segIndex;
		if (si >= segCount) continue;
		const off = si * SEG_STRIDE;
		const t = pulse.t;
		const px = segments[off + 0] + (segments[off + 2] - segments[off + 0]) * t;
		const py = segments[off + 1] + (segments[off + 3] - segments[off + 1]) * t;

		// Outer glow
		ctx.beginPath();
		ctx.arc(px, py, CONFIG.pulseGlow, 0, Math.PI * 2);
		ctx.fillStyle = `hsla(${CONFIG.baseHue + 30},90%,80%,${(0.15 * alphaScale).toFixed(3)})`;
		ctx.fill();

		// Core
		ctx.beginPath();
		ctx.arc(px, py, CONFIG.pulseSize, 0, Math.PI * 2);
		ctx.fillStyle = `hsla(${CONFIG.baseHue + 30},90%,90%,${(0.7 * alphaScale).toFixed(3)})`;
		ctx.fill();
	}
	ctx.globalCompositeOperation = 'source-over';
}

function drawSpores(layer, alphaScale) {
	for (let i = 0; i < sporeCount; i++) {
		const soff = i * SPORE_STRIDE;
		if (spores[soff + 6] !== layer) continue;
		const life = spores[soff + 4];
		const maxLife = spores[soff + 5];
		const alpha = (life / maxLife) * 0.5 * alphaScale;
		if (alpha < 0.005) continue;
		const r = 1.5 * (life / maxLife);

		ctx.beginPath();
		ctx.arc(spores[soff + 0], spores[soff + 1], r, 0, Math.PI * 2);
		ctx.fillStyle = `hsla(${CONFIG.baseHue + 40},60%,80%,${alpha.toFixed(3)})`;
		ctx.fill();
	}
}

// ─── ANIMATION LOOP ─────────────────────────────────────────────────────────
function startAnimation() {
	function render(now) {
		if (!ctx) {
			requestAnimationFrame(render);
			return;
		}
		now *= 0.001;
		const dt = lastTime ? Math.min(now - lastTime, 0.05) : 0.016;
		lastTime = now;

		update(dt);
		draw();

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
