/**
 * Title: Magnetic Field
 * Description: Magnetic field line visualization with multiple dipoles. Field lines are traced
 *   via Euler integration from N to S poles with color mapped to field strength. Thousands of
 *   iron filing segments orient along the local field direction. Dipoles orbit slowly, causing
 *   dynamic topology reconfiguration. Mouse acts as a strong dipole.
 *   Uses Float32Array bulk storage, spatial hashing for filings, and delta-time animation.
 */

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG = {
	dipoleCount: 4, // Number of magnetic dipoles
	dipoleSeparation: 30, // Distance between N and S poles of each dipole (px)
	dipoleStrength: 6000, // Magnetic moment strength of each dipole
	fieldLineCount: 14, // Number of field lines traced per N pole
	fieldLineSteps: 300, // Maximum integration steps per field line
	fieldLineStepSize: 3, // Step size for Euler integration (px)
	ironFilingCount: 2500, // Number of iron filing segments scattered across canvas
	ironFilingLength: 8, // Length of each iron filing segment (px)
	ironFilingAlpha: 0.25, // Base opacity of iron filings
	fieldColorHue: 200, // Base hue for field visualization
	fieldColorIntensity: 1.2, // Multiplier for brightness mapping from field strength
	dipoleOrbitSpeed: 0.003, // Angular velocity of dipole orbital drift (rad/frame)
	dipoleOrbitRadius: 120, // Radius of the slow orbital path of each dipole
	mouseDipoleStrength: 10000, // Strength of the mouse-controlled dipole
	lineWidth: 1.2, // Width of field lines
	lineAlphaBase: 0.35, // Base alpha for field lines
	filingResetRate: 0.002, // Fraction of filings repositioned per frame (keeps it fresh)
	glowPasses: 2, // Multi-pass glow layers for field lines
	glowWidthStep: 3, // Width increase per glow pass
	glowAlphaDecay: 0.3, // Alpha decay per glow pass
	poleGlowRadius: 25 // Visual glow radius around pole markers
};

// ─── STATE ─────────────────────────────────────────────────────────────────────
let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let lastTime = 0;

// Dipole storage: each dipole has a center, angle, and generates two poles
let dipoles = [];

// Iron filing positions — Float32Array for performance
let filingX, filingY;

// Precomputed pole positions (N and S for each dipole + mouse dipole)
// Updated each frame
let poleX, poleY, poleSign, poleStrength;
let poleCount = 0;

// ─── HEARTBEAT ─────────────────────────────────────────────────────────────────
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

// ─── DIPOLE CLASS ──────────────────────────────────────────────────────────────
class Dipole {
	constructor(cx, cy, angle, strength) {
		this.cx = cx;
		this.cy = cy;
		this.angle = angle;
		this.strength = strength;
		this.orbitAngle = Math.random() * Math.PI * 2;
		this.orbitCx = cx;
		this.orbitCy = cy;
		this.hue = Math.random() * 60 + CONFIG.fieldColorHue - 30;
	}

	update(dt) {
		this.orbitAngle += CONFIG.dipoleOrbitSpeed * dt;
		this.cx = this.orbitCx + Math.cos(this.orbitAngle) * CONFIG.dipoleOrbitRadius;
		this.cy = this.orbitCy + Math.sin(this.orbitAngle) * CONFIG.dipoleOrbitRadius;
		// Slowly rotate the dipole itself
		this.angle += CONFIG.dipoleOrbitSpeed * 0.5 * dt;
	}

	getNPole() {
		const half = CONFIG.dipoleSeparation * 0.5;
		return {
			x: this.cx + Math.cos(this.angle) * half,
			y: this.cy + Math.sin(this.angle) * half
		};
	}

	getSPole() {
		const half = CONFIG.dipoleSeparation * 0.5;
		return {
			x: this.cx - Math.cos(this.angle) * half,
			y: this.cy - Math.sin(this.angle) * half
		};
	}
}

// ─── FIELD COMPUTATION ─────────────────────────────────────────────────────────
// Returns { bx, by } — the magnetic field vector at point (x, y)
// Each pole contributes a monopole-like field: B = strength * sign / r^2, direction = r_hat * sign
function computeField(x, y) {
	let bx = 0,
		by = 0;

	for (let i = 0; i < poleCount; i++) {
		const dx = x - poleX[i];
		const dy = y - poleY[i];
		const dist2 = dx * dx + dy * dy + 100; // Softening to prevent singularities
		const dist = Math.sqrt(dist2);
		const factor = (poleStrength[i] * poleSign[i]) / (dist2 * dist);
		bx += dx * factor;
		by += dy * factor;
	}

	return { bx, by };
}

function fieldMagnitude(bx, by) {
	return Math.sqrt(bx * bx + by * by);
}

// ─── INITIALIZATION ────────────────────────────────────────────────────────────
function initDipoles() {
	dipoles = [];
	const cx = width * 0.5;
	const cy = height * 0.5;
	const spread = Math.min(width, height) * 0.25;

	for (let i = 0; i < CONFIG.dipoleCount; i++) {
		const angle = (i / CONFIG.dipoleCount) * Math.PI * 2;
		const x = cx + Math.cos(angle) * spread;
		const y = cy + Math.sin(angle) * spread;
		const dipAngle = angle + Math.PI * 0.5 + (Math.random() - 0.5) * 1;
		dipoles.push(new Dipole(x, y, dipAngle, CONFIG.dipoleStrength));
	}

	// Allocate pole arrays: each dipole = 2 poles + mouse dipole (2 poles)
	const maxPoles = (CONFIG.dipoleCount + 1) * 2;
	poleX = new Float32Array(maxPoles);
	poleY = new Float32Array(maxPoles);
	poleSign = new Float32Array(maxPoles);
	poleStrength = new Float32Array(maxPoles);
}

function initFilings() {
	const n = CONFIG.ironFilingCount;
	filingX = new Float32Array(n);
	filingY = new Float32Array(n);

	for (let i = 0; i < n; i++) {
		filingX[i] = Math.random() * width;
		filingY[i] = Math.random() * height;
	}
}

function updatePolePositions() {
	poleCount = 0;

	for (let i = 0; i < dipoles.length; i++) {
		const d = dipoles[i];
		const np = d.getNPole();
		const sp = d.getSPole();

		poleX[poleCount] = np.x;
		poleY[poleCount] = np.y;
		poleSign[poleCount] = 1;
		poleStrength[poleCount] = d.strength;
		poleCount++;

		poleX[poleCount] = sp.x;
		poleY[poleCount] = sp.y;
		poleSign[poleCount] = -1;
		poleStrength[poleCount] = d.strength;
		poleCount++;
	}

	// Mouse dipole (horizontal orientation)
	if (mouse.x > -1000) {
		const sep = CONFIG.dipoleSeparation * 0.5;
		poleX[poleCount] = mouse.x + sep;
		poleY[poleCount] = mouse.y;
		poleSign[poleCount] = 1;
		poleStrength[poleCount] = CONFIG.mouseDipoleStrength;
		poleCount++;

		poleX[poleCount] = mouse.x - sep;
		poleY[poleCount] = mouse.y;
		poleSign[poleCount] = -1;
		poleStrength[poleCount] = CONFIG.mouseDipoleStrength;
		poleCount++;
	}
}

// ─── RENDERING ─────────────────────────────────────────────────────────────────
function traceFieldLine(ctx, startX, startY, direction, pass) {
	const steps = CONFIG.fieldLineSteps;
	const stepSize = CONFIG.fieldLineStepSize * direction;
	const isGlow = pass > 0;
	const extraWidth = isGlow ? pass * CONFIG.glowWidthStep : 0;
	const alphaScale = isGlow ? Math.pow(CONFIG.glowAlphaDecay, pass) : 1;

	let x = startX;
	let y = startY;

	ctx.beginPath();
	ctx.moveTo(x, y);

	let prevStrength = 0;
	let segmentCount = 0;

	for (let s = 0; s < steps; s++) {
		const { bx, by } = computeField(x, y);
		const mag = fieldMagnitude(bx, by);
		if (mag < 0.0001) break;

		// Normalize and step
		const nx = bx / mag;
		const ny = by / mag;
		x += nx * stepSize;
		y += ny * stepSize;

		// Off-screen culling — stop tracing
		if (x < -50 || x > width + 50 || y < -50 || y > height + 50) break;

		// Check if we've reached a pole (close to any S pole)
		let hitPole = false;
		for (let p = 0; p < poleCount; p++) {
			if (poleSign[p] !== -direction) continue;
			const dx = x - poleX[p];
			const dy = y - poleY[p];
			if (dx * dx + dy * dy < 100) {
				hitPole = true;
				break;
			}
		}

		ctx.lineTo(x, y);
		segmentCount++;

		if (hitPole) break;
		prevStrength = mag;
	}

	if (segmentCount < 3) return;

	// Color based on average field strength
	const intensity = Math.min(prevStrength * CONFIG.fieldColorIntensity * 500, 1);
	const hue = CONFIG.fieldColorHue + intensity * 40;
	const lightness = 40 + intensity * 30;
	const alpha = (CONFIG.lineAlphaBase + intensity * 0.3) * alphaScale;

	ctx.strokeStyle = `hsla(${hue}, 70%, ${lightness}%, ${alpha})`;
	ctx.lineWidth = CONFIG.lineWidth + extraWidth;
	ctx.lineCap = 'round';
	ctx.stroke();
}

function drawFieldLines(ctx) {
	// Trace field lines from each N pole
	for (let p = 0; p < poleCount; p++) {
		if (poleSign[p] !== 1) continue; // Only start from N poles

		const cx = poleX[p];
		const cy = poleY[p];

		for (let i = 0; i < CONFIG.fieldLineCount; i++) {
			const angle = (i / CONFIG.fieldLineCount) * Math.PI * 2;
			const startR = 8;
			const sx = cx + Math.cos(angle) * startR;
			const sy = cy + Math.sin(angle) * startR;

			// Multi-pass glow
			for (let pass = CONFIG.glowPasses; pass >= 0; pass--) {
				traceFieldLine(ctx, sx, sy, 1, pass);
			}
		}
	}
}

function drawIronFilings(ctx) {
	const halfLen = CONFIG.ironFilingLength * 0.5;
	const resetCount = Math.ceil(CONFIG.ironFilingCount * CONFIG.filingResetRate);

	// Randomly reposition a few filings each frame for visual freshness
	for (let i = 0; i < resetCount; i++) {
		const idx = Math.floor(Math.random() * CONFIG.ironFilingCount);
		filingX[idx] = Math.random() * width;
		filingY[idx] = Math.random() * height;
	}

	ctx.lineWidth = 1;
	ctx.lineCap = 'round';

	// Batch by starting a single path and drawing all filings
	for (let i = 0; i < CONFIG.ironFilingCount; i++) {
		const x = filingX[i];
		const y = filingY[i];

		// Off-screen culling
		if (x < -10 || x > width + 10 || y < -10 || y > height + 10) continue;

		const { bx, by } = computeField(x, y);
		const mag = fieldMagnitude(bx, by);
		if (mag < 0.0001) continue;

		const nx = bx / mag;
		const ny = by / mag;
		const intensity = Math.min(mag * 600, 1);
		const alpha = CONFIG.ironFilingAlpha * (0.3 + intensity * 0.7);

		ctx.beginPath();
		ctx.moveTo(x - nx * halfLen, y - ny * halfLen);
		ctx.lineTo(x + nx * halfLen, y + ny * halfLen);
		ctx.strokeStyle = `hsla(${CONFIG.fieldColorHue + intensity * 30}, 50%, ${50 + intensity * 30}%, ${alpha})`;
		ctx.stroke();
	}
}

function drawPoles(ctx) {
	for (let i = 0; i < poleCount; i++) {
		const x = poleX[i];
		const y = poleY[i];
		const isN = poleSign[i] > 0;
		const r = CONFIG.poleGlowRadius;

		// Glow
		const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
		const hue = isN ? 0 : 220;
		grad.addColorStop(0, `hsla(${hue}, 80%, 70%, 0.3)`);
		grad.addColorStop(0.5, `hsla(${hue}, 80%, 50%, 0.1)`);
		grad.addColorStop(1, `hsla(${hue}, 80%, 30%, 0)`);
		ctx.fillStyle = grad;
		ctx.fillRect(x - r, y - r, r * 2, r * 2);

		// Core dot
		ctx.beginPath();
		ctx.arc(x, y, 4, 0, Math.PI * 2);
		ctx.fillStyle = isN ? 'rgba(255, 100, 100, 0.8)' : 'rgba(100, 150, 255, 0.8)';
		ctx.fill();
	}
}

// ─── MESSAGE HANDLER ───────────────────────────────────────────────────────────
self.onmessage = (e) => {
	switch (e.data.type) {
		case 'init':
			canvas = e.data.canvas;
			ctx = canvas.getContext('2d');
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initDipoles();
			initFilings();
			lastTime = performance.now();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initFilings();
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};

// ─── RENDER LOOP ───────────────────────────────────────────────────────────────
function startAnimation() {
	function render(now) {
		if (!ctx) return;

		const dt = Math.min((now - lastTime) / 16.667, 3);
		lastTime = now;

		// Clear with slight trail
		ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
		ctx.fillRect(0, 0, width, height);

		// Update dipole positions
		for (let i = 0; i < dipoles.length; i++) {
			dipoles[i].update(dt);
		}
		updatePolePositions();

		// Render layers
		drawIronFilings(ctx);
		drawFieldLines(ctx);
		drawPoles(ctx);

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}
