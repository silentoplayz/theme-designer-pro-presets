/**
 * Title: Fractal Tree
 * Description: An animated recursive fractal tree with natural sway, seasonal
 *   color modes, growth animation, falling leaf particles, and mouse-driven
 *   wind interaction. Uses typed arrays for branch and leaf data, delta-time
 *   animation, off-screen culling, multi-pass glow, and motion trails.
 */

/* ───────────────────── CONFIG ───────────────────── */
const CONFIG = {
	maxDepth: 11, // max recursion depth for branching
	trunkLength: 140, // initial trunk segment length (px)
	branchRatio: 0.72, // child length as fraction of parent
	branchAngle: 0.45, // base branching angle (radians)
	branchAngleVariance: 0.15, // random variance added per branch (radians)
	swayAmplitude: 0.04, // max sway rotation (radians)
	swayFrequency: 1.2, // sway oscillation speed (Hz)
	swayDamping: 0.78, // sway amplitude multiplier per depth level
	trunkWidth: 14, // width of the trunk at base (px)
	widthRatio: 0.68, // child width as fraction of parent
	trunkColor: '100,70,40', // RGB for trunk base
	tipColor: '30,160,60', // RGB for branch tips (summer)
	leafCount: 3, // leaves spawned per terminal branch
	leafSize: 4, // radius of leaf particles (px)
	leafFallChance: 0.0004, // probability per frame per leaf to detach
	leafFallSpeed: 40, // falling speed (px/s)
	leafDriftSpeed: 20, // horizontal drift while falling (px/s)
	season: 'summer', // 'summer' | 'autumn' | 'winter' | 'spring'
	growthDuration: 180, // frames to grow from sapling to full size
	mouseWindRadius: 200, // radius of mouse wind influence (px)
	mouseWindForce: 0.6, // max wind angle from mouse proximity (radians)
	glowPasses: 2, // number of glow post-process passes
	glowAlpha: 0.1, // alpha per glow pass
	trailAlpha: 0.12 // motion trail opacity
};

/* ───────────────────── SEASON PALETTES ───────────────────── */
const SEASON_PALETTES = {
	summer: { tip: '30,160,60', leaf: '50,180,70', leafAlt: '30,140,50' },
	autumn: { tip: '200,100,20', leaf: '220,120,30', leafAlt: '180,40,20' },
	winter: { tip: '140,140,160', leaf: '200,210,230', leafAlt: '180,190,210' },
	spring: { tip: '220,140,180', leaf: '240,170,200', leafAlt: '255,200,220' }
};

/* ───────────────────── STATE ───────────────────── */
let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let lastTime = 0;
let growthFrame = 0;

// Branch pool — pre-allocated
const MAX_BRANCHES = 4096;
let branchX0 = new Float32Array(MAX_BRANCHES); // start x
let branchY0 = new Float32Array(MAX_BRANCHES); // start y
let branchX1 = new Float32Array(MAX_BRANCHES); // end x
let branchY1 = new Float32Array(MAX_BRANCHES); // end y
let branchAngle = new Float32Array(MAX_BRANCHES); // base angle
let branchWidth = new Float32Array(MAX_BRANCHES); // line width
let branchDepth = new Uint8Array(MAX_BRANCHES); // recursion depth
let branchLen = new Float32Array(MAX_BRANCHES); // segment length
let branchSway = new Float32Array(MAX_BRANCHES); // sway phase offset
let branchParent = new Int16Array(MAX_BRANCHES); // parent index (-1 for root)
let branchCount = 0;

// Leaf pool
const MAX_LEAVES = 2048;
let leafX = new Float32Array(MAX_LEAVES);
let leafY = new Float32Array(MAX_LEAVES);
let leafHomeX = new Float32Array(MAX_LEAVES);
let leafHomeY = new Float32Array(MAX_LEAVES);
let leafFalling = new Uint8Array(MAX_LEAVES); // 0 = attached, 1 = falling
let leafDriftX = new Float32Array(MAX_LEAVES); // drift direction
let leafColor = new Uint8Array(MAX_LEAVES); // 0 or 1 for palette variation
let leafAlpha = new Float32Array(MAX_LEAVES);
let leafBranch = new Int16Array(MAX_LEAVES); // which branch this leaf belongs to
let leafCount = 0;

// Glow offscreen
let glowCanvas, glowCtx;

/* ───────────────────── HELPERS ───────────────────── */
function rand(a, b) {
	return a + Math.random() * (b - a);
}
function clamp(v, lo, hi) {
	return v < lo ? lo : v > hi ? hi : v;
}
function lerpColor(c1, c2, t) {
	const p1 = c1.split(',').map(Number);
	const p2 = c2.split(',').map(Number);
	const r = (p1[0] + (p2[0] - p1[0]) * t) | 0;
	const g = (p1[1] + (p2[1] - p1[1]) * t) | 0;
	const b = (p1[2] + (p2[2] - p1[2]) * t) | 0;
	return `${r},${g},${b}`;
}

/* ───────────────────── TREE GENERATION ───────────────────── */
function generateTree() {
	branchCount = 0;
	leafCount = 0;

	const baseX = width * 0.5;
	const baseY = height * 0.88;

	function addBranch(x0, y0, angle, len, w, depth, parent) {
		if (depth > CONFIG.maxDepth || branchCount >= MAX_BRANCHES) return;
		if (len < 3) return;

		const idx = branchCount++;
		branchX0[idx] = x0;
		branchY0[idx] = y0;
		branchAngle[idx] = angle;
		branchLen[idx] = len;
		branchWidth[idx] = w;
		branchDepth[idx] = depth;
		branchSway[idx] = rand(0, Math.PI * 2);
		branchParent[idx] = parent;

		// Compute end position (will be updated in render for sway)
		const x1 = x0 + Math.cos(angle) * len;
		const y1 = y0 + Math.sin(angle) * len;
		branchX1[idx] = x1;
		branchY1[idx] = y1;

		if (depth >= CONFIG.maxDepth - 1 || len < 8) {
			// Terminal — add leaves
			if (CONFIG.season !== 'winter') {
				for (let l = 0; l < CONFIG.leafCount && leafCount < MAX_LEAVES; l++) {
					const li = leafCount++;
					leafHomeX[li] = x1 + rand(-6, 6);
					leafHomeY[li] = y1 + rand(-6, 6);
					leafX[li] = leafHomeX[li];
					leafY[li] = leafHomeY[li];
					leafFalling[li] = 0;
					leafDriftX[li] = rand(-1, 1);
					leafColor[li] = Math.random() < 0.5 ? 0 : 1;
					leafAlpha[li] = rand(0.4, 0.8);
					leafBranch[li] = idx;
				}
			}
		}

		// Recurse
		const childLen = len * CONFIG.branchRatio;
		const childW = w * CONFIG.widthRatio;
		const variance1 = rand(-CONFIG.branchAngleVariance, CONFIG.branchAngleVariance);
		const variance2 = rand(-CONFIG.branchAngleVariance, CONFIG.branchAngleVariance);

		addBranch(x1, y1, angle - CONFIG.branchAngle + variance1, childLen, childW, depth + 1, idx);
		addBranch(x1, y1, angle + CONFIG.branchAngle + variance2, childLen, childW, depth + 1, idx);

		// Extra branch occasionally
		if (depth > 2 && Math.random() < 0.2) {
			const variance3 = rand(-CONFIG.branchAngleVariance * 2, CONFIG.branchAngleVariance * 2);
			addBranch(x1, y1, angle + variance3, childLen * 0.8, childW * 0.9, depth + 1, idx);
		}
	}

	addBranch(baseX, baseY, -Math.PI / 2, CONFIG.trunkLength, CONFIG.trunkWidth, 0, -1);
}

function initGlow() {
	glowCanvas = new OffscreenCanvas(width >> 1, height >> 1);
	glowCtx = glowCanvas.getContext('2d');
}

/* ───────────────────── UPDATE ───────────────────── */
function updateBranches(time, dt) {
	const growthScale = clamp(growthFrame / CONFIG.growthDuration, 0, 1);
	const baseX = width * 0.5;
	const baseY = height * 0.88;

	for (let i = 0; i < branchCount; i++) {
		const depth = branchDepth[i];
		const parent = branchParent[i];

		// Update start position from parent's end
		if (parent >= 0) {
			branchX0[i] = branchX1[parent];
			branchY0[i] = branchY1[parent];
		} else {
			branchX0[i] = baseX;
			branchY0[i] = baseY;
		}

		// Sway
		const swayDamp = Math.pow(CONFIG.swayDamping, depth);
		const sway =
			Math.sin(time * CONFIG.swayFrequency * Math.PI * 2 + branchSway[i]) *
			CONFIG.swayAmplitude *
			swayDamp;

		// Mouse wind
		let windAngle = 0;
		const mx = branchX0[i] - mouse.x;
		const my = branchY0[i] - mouse.y;
		const md = Math.sqrt(mx * mx + my * my);
		if (md < CONFIG.mouseWindRadius && md > 1) {
			const windStr = (1 - md / CONFIG.mouseWindRadius) * CONFIG.mouseWindForce;
			// Push away from mouse
			windAngle = (mx > 0 ? 1 : -1) * windStr * (depth / CONFIG.maxDepth);
		}

		const angle = branchAngle[i] + sway + windAngle;
		const len = branchLen[i] * growthScale;

		branchX1[i] = branchX0[i] + Math.cos(angle) * len;
		branchY1[i] = branchY0[i] + Math.sin(angle) * len;
	}
}

function updateLeaves(dt) {
	for (let i = 0; i < leafCount; i++) {
		if (leafFalling[i]) {
			// Fall
			leafY[i] += CONFIG.leafFallSpeed * dt;
			leafX[i] += leafDriftX[i] * CONFIG.leafDriftSpeed * dt;
			leafDriftX[i] += rand(-0.5, 0.5) * dt; // wobble
			leafAlpha[i] -= 0.15 * dt;

			// Reset if off screen or faded
			if (leafY[i] > height + 20 || leafAlpha[i] <= 0) {
				leafFalling[i] = 0;
				const bi = leafBranch[i];
				if (bi >= 0 && bi < branchCount) {
					leafHomeX[i] = branchX1[bi] + rand(-6, 6);
					leafHomeY[i] = branchY1[bi] + rand(-6, 6);
				}
				leafX[i] = leafHomeX[i];
				leafY[i] = leafHomeY[i];
				leafAlpha[i] = rand(0.4, 0.8);
				leafDriftX[i] = rand(-1, 1);
			}
		} else {
			// Update home position from branch
			const bi = leafBranch[i];
			if (bi >= 0 && bi < branchCount) {
				leafHomeX[i] = branchX1[bi] + (leafHomeX[i] - branchX1[bi]) * 0.5;
				leafHomeY[i] = branchY1[bi] + (leafHomeY[i] - branchY1[bi]) * 0.5;
			}
			leafX[i] = leafHomeX[i] + rand(-1.5, 1.5);
			leafY[i] = leafHomeY[i] + rand(-1.5, 1.5);

			// Chance to detach
			if (Math.random() < CONFIG.leafFallChance) {
				leafFalling[i] = 1;
			}
		}
	}
}

/* ───────────────────── DRAW ───────────────────── */
function drawBranches() {
	const palette = SEASON_PALETTES[CONFIG.season] || SEASON_PALETTES.summer;
	const growthScale = clamp(growthFrame / CONFIG.growthDuration, 0, 1);

	ctx.lineCap = 'round';

	// Batch by depth for fewer style changes
	for (let d = 0; d <= CONFIG.maxDepth; d++) {
		const t = d / CONFIG.maxDepth;
		const color = lerpColor(CONFIG.trunkColor, palette.tip, t);
		const alpha = clamp(0.6 + (1 - t) * 0.4, 0, 1);
		ctx.strokeStyle = `rgba(${color},${alpha.toFixed(3)})`;

		ctx.beginPath();
		for (let i = 0; i < branchCount; i++) {
			if (branchDepth[i] !== d) continue;
			const w = branchWidth[i] * growthScale;
			if (w < 0.3) continue;

			// Off-screen culling
			const minX = Math.min(branchX0[i], branchX1[i]);
			const maxX = Math.max(branchX0[i], branchX1[i]);
			const minY = Math.min(branchY0[i], branchY1[i]);
			const maxY = Math.max(branchY0[i], branchY1[i]);
			if (maxX < -20 || minX > width + 20 || maxY < -20 || minY > height + 20) continue;

			ctx.lineWidth = w;
			ctx.moveTo(branchX0[i], branchY0[i]);
			ctx.lineTo(branchX1[i], branchY1[i]);
		}
		ctx.stroke();
	}
}

function drawLeaves() {
	if (CONFIG.season === 'winter') return;
	const palette = SEASON_PALETTES[CONFIG.season] || SEASON_PALETTES.summer;
	const size = CONFIG.leafSize;

	ctx.beginPath();
	const colors = [palette.leaf, palette.leafAlt];

	for (let c = 0; c < 2; c++) {
		ctx.fillStyle = `rgba(${colors[c]},0.6)`;
		ctx.beginPath();
		for (let i = 0; i < leafCount; i++) {
			if (leafColor[i] !== c) continue;
			if (leafX[i] < -20 || leafX[i] > width + 20 || leafY[i] < -20 || leafY[i] > height + 20)
				continue;
			const a = leafAlpha[i];
			if (a < 0.02) continue;
			ctx.moveTo(leafX[i] + size, leafY[i]);
			ctx.arc(leafX[i], leafY[i], size * a, 0, Math.PI * 2);
		}
		ctx.fill();
	}
}

function drawGlow() {
	if (!glowCtx) return;
	const gw = glowCanvas.width;
	const gh = glowCanvas.height;
	glowCtx.clearRect(0, 0, gw, gh);
	glowCtx.drawImage(canvas, 0, 0, gw, gh);

	for (let p = 0; p < CONFIG.glowPasses; p++) {
		ctx.save();
		ctx.globalAlpha = CONFIG.glowAlpha;
		ctx.globalCompositeOperation = 'lighter';
		ctx.drawImage(glowCanvas, 0, 0, width, height);
		ctx.restore();
	}
}

/* ───────────────────── ANIMATION ───────────────────── */
function startAnimation() {
	lastTime = performance.now();
	growthFrame = 0;

	function render(now) {
		if (!ctx) return;
		const dt = Math.min((now - lastTime) / 1000, 0.05);
		lastTime = now;
		const time = now / 1000;

		if (growthFrame < CONFIG.growthDuration) growthFrame++;

		// Motion trail layer
		ctx.fillStyle = `rgba(0,0,0,${CONFIG.trailAlpha})`;
		ctx.fillRect(0, 0, width, height);

		// Update
		updateBranches(time, dt);
		updateLeaves(dt);

		// Draw layers
		drawBranches();
		drawLeaves();

		// Glow pass
		drawGlow();

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}

/* ───────────────────── HEARTBEAT ───────────────────── */
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

/* ───────────────────── MESSAGES ───────────────────── */
self.onmessage = (e) => {
	switch (e.data.type) {
		case 'init':
			canvas = e.data.canvas;
			ctx = canvas.getContext('2d');
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initGlow();
			generateTree();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initGlow();
			generateTree();
			growthFrame = CONFIG.growthDuration; // skip growth on resize
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};
