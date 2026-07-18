/**
 * Title: Wireframe City
 * Description: A procedurally generated wireframe cityscape rendered in slight
 *   perspective view. Buildings pulse with flickering windows, flying light
 *   streaks arc between structures, and a radar-like scanning beam sweeps
 *   across the scene. Depth fog fades distant buildings. Mouse acts as a
 *   spotlight and scan-beam origin. Uses typed arrays, spatial bucketing,
 *   delta-time animation, off-screen culling, and batched draw calls.
 */

/* ───────────────────── CONFIG ───────────────────── */
const CONFIG = {
	buildingCount: 120, // total buildings to generate
	minHeight: 40, // minimum building height (px)
	maxHeight: 260, // maximum building height (px)
	minWidth: 18, // minimum building footprint width (px)
	maxWidth: 50, // maximum building footprint width (px)
	buildingSpacing: 6, // gap between adjacent buildings (px)
	perspectiveAngle: 0.25, // perspective skew factor (0 = flat, 1 = extreme)
	wireframeColor: '0,220,255', // RGB string for building edges
	wireframeAlpha: 0.45, // base alpha for wireframe lines
	windowFlickerRate: 0.003, // probability per window per frame to toggle
	windowLightColor: '0,255,200', // RGB string for lit windows
	windowLightAlpha: 0.6, // alpha for lit window rectangles
	windowRows: 5, // max window rows per building face
	windowCols: 3, // max window cols per building face
	trafficCount: 8, // number of flying light streaks
	trafficSpeed: 180, // streak speed (px/s)
	trafficTrailLength: 60, // trail length behind streak (px)
	trafficColor: '255,100,255', // RGB for traffic streaks
	trafficAlpha: 0.7, // alpha for traffic streaks
	scanBeamAngle: 0, // initial scan beam angle (radians)
	scanBeamSpeed: 0.4, // scan beam rotation speed (rad/s)
	scanBeamAlpha: 0.08, // alpha of the scan beam wedge
	scanBeamArc: 0.35, // half-angle of the scan wedge (radians)
	scanBeamRadius: 900, // max reach of the scan beam (px)
	scanBeamColor: '0,255,180', // RGB for the scan beam
	depthFogStart: 0.3, // depth ratio where fog begins (0-1)
	depthFogEnd: 1.0, // depth ratio where objects become invisible
	spotlightRadius: 200, // radius of the mouse spotlight (px)
	spotlightIntensity: 0.5, // additional alpha added under spotlight
	gridColor: '0,200,220', // RGB for the ground grid
	gridAlpha: 0.07, // alpha for the ground grid lines
	gridSpacing: 40, // ground grid cell size (px)
	glowPasses: 3, // number of glow blur passes
	glowAlpha: 0.15 // alpha per glow pass
};

/* ───────────────────── STATE ───────────────────── */
let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let lastTime = 0;

// Building data — packed in typed arrays for performance
let buildingX; // Float32Array — x position of building center
let buildingY; // Float32Array — y base (ground line)
let buildingW; // Float32Array — footprint width
let buildingH; // Float32Array — height
let buildingDepth; // Float32Array — 0-1 depth for fog
let windowStates; // Uint8Array — flattened window on/off states
let buildingCount = 0;
const MAX_WINDOWS_PER_BUILDING = 30; // windowRows * windowCols * 2 faces

// Traffic streaks — object pool
let trafficPool = [];

// Scan beam
let scanAngle = CONFIG.scanBeamAngle;

// Glow layer
let glowCanvas, glowCtx;

/* ───────────────────── HELPERS ───────────────────── */
function rand(min, max) {
	return min + Math.random() * (max - min);
}
function randInt(min, max) {
	return (min + Math.random() * (max - min)) | 0;
}
function lerp(a, b, t) {
	return a + (b - a) * t;
}
function clamp(v, lo, hi) {
	return v < lo ? lo : v > hi ? hi : v;
}

/* ───────────────────── INIT ───────────────────── */
function initBuildings() {
	buildingCount = CONFIG.buildingCount;
	buildingX = new Float32Array(buildingCount);
	buildingY = new Float32Array(buildingCount);
	buildingW = new Float32Array(buildingCount);
	buildingH = new Float32Array(buildingCount);
	buildingDepth = new Float32Array(buildingCount);
	windowStates = new Uint8Array(buildingCount * MAX_WINDOWS_PER_BUILDING);

	// Lay buildings across width, randomly assign depth rows
	const depthRows = 4;
	for (let i = 0; i < buildingCount; i++) {
		const row = randInt(0, depthRows);
		const depth = row / (depthRows - 1); // 0 = front, 1 = back
		buildingDepth[i] = depth;
		const w = rand(CONFIG.minWidth, CONFIG.maxWidth) * (1 - depth * 0.4);
		const h = rand(CONFIG.minHeight, CONFIG.maxHeight) * (1 - depth * 0.3);
		buildingW[i] = w;
		buildingH[i] = h;
		buildingX[i] = rand(-50, width + 50);
		// Ground line shifts up with depth (perspective)
		const groundY = height * 0.75 - depth * height * 0.25;
		buildingY[i] = groundY;

		// Init windows randomly
		const wCount = CONFIG.windowCols * CONFIG.windowRows * 2;
		const base = i * MAX_WINDOWS_PER_BUILDING;
		for (let j = 0; j < wCount; j++) {
			windowStates[base + j] = Math.random() < 0.3 ? 1 : 0;
		}
	}

	// Sort by depth (back-to-front) so nearer buildings draw on top
	const indices = Array.from({ length: buildingCount }, (_, i) => i);
	indices.sort((a, b) => buildingDepth[b] - buildingDepth[a]);
	const sortArrays = (src) => {
		const tmp = new Float32Array(buildingCount);
		for (let i = 0; i < buildingCount; i++) tmp[i] = src[indices[i]];
		src.set(tmp);
	};
	sortArrays(buildingX);
	sortArrays(buildingY);
	sortArrays(buildingW);
	sortArrays(buildingH);
	sortArrays(buildingDepth);
	// Also sort window states
	const tmpW = new Uint8Array(buildingCount * MAX_WINDOWS_PER_BUILDING);
	for (let i = 0; i < buildingCount; i++) {
		const srcBase = indices[i] * MAX_WINDOWS_PER_BUILDING;
		const dstBase = i * MAX_WINDOWS_PER_BUILDING;
		for (let j = 0; j < MAX_WINDOWS_PER_BUILDING; j++) {
			tmpW[dstBase + j] = windowStates[srcBase + j];
		}
	}
	windowStates = tmpW;
}

function initTraffic() {
	trafficPool.length = 0;
	for (let i = 0; i < CONFIG.trafficCount; i++) {
		trafficPool.push(spawnTraffic());
	}
}

function spawnTraffic() {
	const startX = rand(-100, width + 100);
	const endX = rand(-100, width + 100);
	const y = rand(height * 0.15, height * 0.55);
	const depth = rand(0.1, 0.9);
	return {
		x: startX,
		y: y,
		startX: startX,
		endX: endX,
		startY: y,
		endY: y + rand(-60, 60),
		depth: depth,
		t: 0,
		speed: CONFIG.trafficSpeed * rand(0.6, 1.4),
		active: true,
		trail: new Float32Array(CONFIG.trafficTrailLength * 2), // x,y pairs
		trailLen: 0
	};
}

function initGlow() {
	glowCanvas = new OffscreenCanvas(width >> 1, height >> 1);
	glowCtx = glowCanvas.getContext('2d');
}

/* ───────────────────── UPDATE ───────────────────── */
function updateWindows() {
	const rate = CONFIG.windowFlickerRate;
	const total = buildingCount * MAX_WINDOWS_PER_BUILDING;
	for (let i = 0; i < total; i++) {
		if (Math.random() < rate) {
			windowStates[i] = windowStates[i] ? 0 : 1;
		}
	}
}

function updateTraffic(dt) {
	for (let i = 0; i < trafficPool.length; i++) {
		const t = trafficPool[i];
		const dist = Math.hypot(t.endX - t.startX, t.endY - t.startY);
		const duration = dist / t.speed;
		t.t += dt / duration;
		t.x = lerp(t.startX, t.endX, clamp(t.t, 0, 1));
		t.y = lerp(t.startY, t.endY, clamp(t.t, 0, 1));

		// Push to trail
		if (t.trailLen < CONFIG.trafficTrailLength) {
			t.trail[t.trailLen * 2] = t.x;
			t.trail[t.trailLen * 2 + 1] = t.y;
			t.trailLen++;
		} else {
			// Shift trail
			t.trail.copyWithin(0, 2);
			t.trail[(t.trailLen - 1) * 2] = t.x;
			t.trail[(t.trailLen - 1) * 2 + 1] = t.y;
		}

		if (t.t >= 1) {
			// Respawn
			const spawned = spawnTraffic();
			Object.assign(t, spawned);
		}
	}
}

/* ───────────────────── DRAW ───────────────────── */
function drawGrid() {
	const gs = CONFIG.gridSpacing;
	ctx.strokeStyle = `rgba(${CONFIG.gridColor},${CONFIG.gridAlpha})`;
	ctx.lineWidth = 0.5;
	ctx.beginPath();
	// Horizontal lines fanning out with perspective
	for (let y = height * 0.5; y <= height; y += gs) {
		ctx.moveTo(0, y);
		ctx.lineTo(width, y);
	}
	// Vertical lines converging to vanishing point
	const vanishX = width * 0.5;
	const vanishY = height * 0.3;
	const bottom = height;
	for (let x = 0; x <= width; x += gs) {
		ctx.moveTo(x, bottom);
		const t = 0.6;
		ctx.lineTo(lerp(x, vanishX, t), lerp(bottom, vanishY, t));
	}
	ctx.stroke();
}

function drawBuildings() {
	const pa = CONFIG.perspectiveAngle;
	const spotR = CONFIG.spotlightRadius;
	const spotI = CONFIG.spotlightIntensity;

	for (let i = 0; i < buildingCount; i++) {
		const bx = buildingX[i];
		const by = buildingY[i];
		const bw = buildingW[i];
		const bh = buildingH[i];
		const depth = buildingDepth[i];

		// Off-screen culling
		if (bx + bw < -20 || bx - bw > width + 20) continue;

		// Depth fog
		const fogT = clamp(
			(depth - CONFIG.depthFogStart) / (CONFIG.depthFogEnd - CONFIG.depthFogStart),
			0,
			1
		);
		const alphaScale = 1 - fogT * 0.85;
		if (alphaScale < 0.02) continue;

		// Spotlight boost
		const dx = bx - mouse.x;
		const dy = by - bh * 0.5 - mouse.y;
		const distToMouse = Math.sqrt(dx * dx + dy * dy);
		const spotBoost = distToMouse < spotR ? (1 - distToMouse / spotR) * spotI : 0;

		const alpha = clamp(CONFIG.wireframeAlpha * alphaScale + spotBoost, 0, 1);

		// Perspective offset for top edges
		const topOffset = bw * pa * (1 - depth * 0.5);

		// Front face
		const flx = bx - bw * 0.5;
		const frx = bx + bw * 0.5;
		const fty = by - bh;
		const fby = by;

		// Top face (perspective receding right)
		const trx = frx + topOffset;
		const tty = fty - topOffset * 0.3;

		ctx.strokeStyle = `rgba(${CONFIG.wireframeColor},${alpha.toFixed(3)})`;
		ctx.lineWidth = 1 + (1 - depth) * 0.5;

		// Draw front face
		ctx.beginPath();
		ctx.moveTo(flx, fby);
		ctx.lineTo(flx, fty);
		ctx.lineTo(frx, fty);
		ctx.lineTo(frx, fby);
		ctx.closePath();
		ctx.stroke();

		// Draw top face
		ctx.beginPath();
		ctx.moveTo(flx, fty);
		ctx.lineTo(flx + topOffset, tty);
		ctx.lineTo(trx, tty);
		ctx.lineTo(frx, fty);
		ctx.closePath();
		ctx.stroke();

		// Draw right side face
		ctx.beginPath();
		ctx.moveTo(frx, fty);
		ctx.lineTo(trx, tty);
		ctx.lineTo(trx, tty + bh);
		ctx.lineTo(frx, fby);
		ctx.closePath();
		ctx.stroke();

		// Windows on front face
		const wRows = Math.min(CONFIG.windowRows, Math.floor(bh / 20));
		const wCols = Math.min(CONFIG.windowCols, Math.floor(bw / 12));
		const winW = (bw / (wCols + 1)) * 0.5;
		const winH = (bh / (wRows + 1)) * 0.4;
		const base = i * MAX_WINDOWS_PER_BUILDING;
		const winAlpha = clamp(CONFIG.windowLightAlpha * alphaScale + spotBoost * 0.5, 0, 1);

		for (let r = 0; r < wRows; r++) {
			for (let c = 0; c < wCols; c++) {
				const idx = base + r * wCols + c;
				if (!windowStates[idx]) continue;
				const wx = flx + (c + 1) * (bw / (wCols + 1)) - winW * 0.5;
				const wy = fty + (r + 1) * (bh / (wRows + 1)) - winH * 0.5;
				ctx.fillStyle = `rgba(${CONFIG.windowLightColor},${winAlpha.toFixed(3)})`;
				ctx.fillRect(wx, wy, winW, winH);
			}
		}

		// Windows on right side face
		for (let r = 0; r < wRows; r++) {
			for (let c = 0; c < wCols; c++) {
				const idx = base + CONFIG.windowRows * CONFIG.windowCols + r * wCols + c;
				if (!windowStates[idx]) continue;
				const sideW = topOffset * 0.8;
				if (sideW < 4) continue;
				const swCols = Math.min(wCols, Math.floor(sideW / 8));
				if (c >= swCols) continue;
				const wx = frx + (c + 1) * (topOffset / (swCols + 1));
				const ryOffset = -((c + 1) * (topOffset / (swCols + 1))) * 0.3;
				const wy = fty + ryOffset + (r + 1) * (bh / (wRows + 1)) - winH * 0.5;
				ctx.fillStyle = `rgba(${CONFIG.windowLightColor},${(winAlpha * 0.7).toFixed(3)})`;
				ctx.fillRect(wx, wy, winW * 0.7, winH);
			}
		}
	}
}

function drawTraffic() {
	for (let i = 0; i < trafficPool.length; i++) {
		const t = trafficPool[i];
		if (t.trailLen < 2) continue;

		ctx.lineWidth = 2;
		for (let j = 1; j < t.trailLen; j++) {
			const a = (j / t.trailLen) * CONFIG.trafficAlpha;
			ctx.strokeStyle = `rgba(${CONFIG.trafficColor},${a.toFixed(3)})`;
			ctx.beginPath();
			ctx.moveTo(t.trail[(j - 1) * 2], t.trail[(j - 1) * 2 + 1]);
			ctx.lineTo(t.trail[j * 2], t.trail[j * 2 + 1]);
			ctx.stroke();
		}

		// Bright head
		ctx.fillStyle = `rgba(${CONFIG.trafficColor},${CONFIG.trafficAlpha})`;
		ctx.beginPath();
		ctx.arc(t.x, t.y, 3, 0, Math.PI * 2);
		ctx.fill();
	}
}

function drawScanBeam(dt) {
	scanAngle += CONFIG.scanBeamSpeed * dt;
	if (scanAngle > Math.PI * 2) scanAngle -= Math.PI * 2;

	const cx = mouse.x > -1000 ? mouse.x : width * 0.5;
	const cy = mouse.y > -1000 ? mouse.y : height * 0.4;
	const r = CONFIG.scanBeamRadius;
	const arc = CONFIG.scanBeamArc;

	// Draw wedge
	const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
	grad.addColorStop(0, `rgba(${CONFIG.scanBeamColor},${CONFIG.scanBeamAlpha * 2})`);
	grad.addColorStop(0.5, `rgba(${CONFIG.scanBeamColor},${CONFIG.scanBeamAlpha})`);
	grad.addColorStop(1, `rgba(${CONFIG.scanBeamColor},0)`);

	ctx.fillStyle = grad;
	ctx.beginPath();
	ctx.moveTo(cx, cy);
	ctx.arc(cx, cy, r, scanAngle - arc, scanAngle + arc);
	ctx.closePath();
	ctx.fill();

	// Leading edge line
	ctx.strokeStyle = `rgba(${CONFIG.scanBeamColor},${CONFIG.scanBeamAlpha * 4})`;
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	ctx.moveTo(cx, cy);
	ctx.lineTo(cx + Math.cos(scanAngle) * r, cy + Math.sin(scanAngle) * r);
	ctx.stroke();
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

	function render(now) {
		if (!ctx) return;
		const dt = Math.min((now - lastTime) / 1000, 0.05); // cap delta time
		lastTime = now;

		ctx.clearRect(0, 0, width, height);

		// Layer 1: Ground grid
		drawGrid();

		// Layer 2: Scan beam (behind buildings)
		drawScanBeam(dt);

		// Layer 3: Buildings with windows
		updateWindows();
		drawBuildings();

		// Layer 4: Traffic streaks
		updateTraffic(dt);
		drawTraffic();

		// Layer 5: Glow post-process
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
			initBuildings();
			initTraffic();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initGlow();
			initBuildings();
			initTraffic();
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};
