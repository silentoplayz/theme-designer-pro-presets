/**
 * Title: DNA Double Helix
 * Description: A rotating double-helix DNA strand rendered in 3D perspective with
 *   base-pair rungs, phosphate backbone nodes, and ambient bio-glow particles.
 *   Mouse Y modulates rotation speed; mouse X shifts the helix horizontally.
 */

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CONFIG = {
	helixRadius: 80, // px – radius of each helical strand
	helixPitch: 300, // px – vertical distance per full 360° turn
	basePairCount: 60, // number of base-pair rungs visible
	basePairWidth: 3, // px – thickness of each rung bar
	basePairGap: 6, // px – gap in the centre of each rung
	rotationSpeed: 0.4, // radians/s – base rotation speed
	verticalScroll: 30, // px/s – upward scroll speed of the helix
	depthFade: 0.55, // 0-1 – alpha multiplier for furthest depth
	backboneNodeRadius: 4, // px – radius of phosphate backbone spheres
	backboneNodeCount: 120, // total backbone nodes per strand
	glowParticleCount: 90, // ambient glow particles floating around
	glowParticleRadius: 2.5, // px – max radius of glow particles
	glowParticleAlpha: 0.35, // base alpha of glow particles
	glowParticleDrift: 20, // px/s – max drift speed
	perspectiveScale: 0.4, // depth scale factor (0 = flat, 1 = extreme)
	strandWidth: 2.5, // px – width of the backbone line
	strandAlpha: 0.85, // base alpha of backbone strands
	glowPasses: 3, // number of additive glow blur passes
	glowExpand: 6, // px expansion per glow pass
	glowAlpha: 0.07, // alpha per glow pass
	trailAlpha: 0.12, // motion trail overlay alpha (lower = longer trails)
	colors: {
		a: '#ff4466', // Adenine
		t: '#4488ff', // Thymine
		g: '#44dd88', // Guanine
		c: '#ffcc44', // Cytosine
		strand1: '#88ccff', // strand 1 backbone colour
		strand2: '#ff88cc', // strand 2 backbone colour
		glow: '#66ddff' // ambient glow particle colour
	}
};

// ─── GLOBALS ─────────────────────────────────────────────────────────────────
let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let lastTime = 0;
let phase = 0; // current rotation phase in radians
let scrollOffset = 0; // vertical scroll accumulator

// Typed arrays for glow particles (x, y, z, vx, vy, radius, hueShift)
const GLOW_STRIDE = 7;
let glowData = null; // Float32Array

// Base pair sequence cache
let basePairSequence = null; // Uint8Array: 0=AT, 1=TA, 2=GC, 3=CG

// Heartbeat
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function hexToRgb(hex) {
	const v = parseInt(hex.slice(1), 16);
	return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function lerpColor(r, g, b, a) {
	return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

function seededRandom(i) {
	let x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
	return x - Math.floor(x);
}

// ─── INIT ────────────────────────────────────────────────────────────────────
function initGlowParticles() {
	const count = CONFIG.glowParticleCount;
	glowData = new Float32Array(count * GLOW_STRIDE);
	for (let i = 0; i < count; i++) {
		const off = i * GLOW_STRIDE;
		glowData[off + 0] = Math.random() * width; // x
		glowData[off + 1] = Math.random() * height; // y
		glowData[off + 2] = Math.random(); // z (0=far, 1=near)
		glowData[off + 3] = (Math.random() - 0.5) * CONFIG.glowParticleDrift; // vx
		glowData[off + 4] = (Math.random() - 0.5) * CONFIG.glowParticleDrift; // vy
		glowData[off + 5] = Math.random() * CONFIG.glowParticleRadius; // radius
		glowData[off + 6] = Math.random() * 60 - 30; // hue shift
	}
}

function initBasePairs() {
	basePairSequence = new Uint8Array(CONFIG.basePairCount);
	for (let i = 0; i < CONFIG.basePairCount; i++) {
		basePairSequence[i] = Math.floor(Math.random() * 4);
	}
}

function initAll() {
	initGlowParticles();
	initBasePairs();
	lastTime = 0;
}

// ─── BASE PAIR COLORS ───────────────────────────────────────────────────────
const pairMap = [
	{ left: 'a', right: 't' },
	{ left: 't', right: 'a' },
	{ left: 'g', right: 'c' },
	{ left: 'c', right: 'g' }
];

const colorCache = {};
function getRgb(key) {
	if (!colorCache[key]) colorCache[key] = hexToRgb(CONFIG.colors[key]);
	return colorCache[key];
}

// ─── RENDER ──────────────────────────────────────────────────────────────────
function startAnimation() {
	function render(now) {
		if (!ctx) {
			requestAnimationFrame(render);
			return;
		}
		now *= 0.001; // ms → s
		const dt = lastTime ? Math.min(now - lastTime, 0.05) : 0.016;
		lastTime = now;

		// Mouse influence
		const mouseNormY =
			mouse.y >= 0 && mouse.y <= height
				? (mouse.y / height - 0.5) * 2 // -1 to 1
				: 0;
		const mouseShiftX =
			mouse.x >= 0 && mouse.x <= width ? (mouse.x / width - 0.5) * width * 0.3 : 0;

		const effectiveRotSpeed = CONFIG.rotationSpeed * (1 + mouseNormY * 1.5);
		phase += effectiveRotSpeed * dt;
		scrollOffset += CONFIG.verticalScroll * dt;

		// ── Motion trail (semi-transparent overlay instead of full clear) ──
		ctx.fillStyle = `rgba(0,0,0,${CONFIG.trailAlpha})`;
		ctx.fillRect(0, 0, width, height);

		const cx = width / 2 + mouseShiftX;
		const cy = height / 2;

		// ── Draw ambient glow particles ──
		updateAndDrawGlow(dt);

		// ── Collect all helix elements, sort by depth, then draw ──
		const elements = buildHelixElements(cx, cy);
		elements.sort((a, b) => a.z - b.z); // painter's order: far first

		// Pass 1: glow (additive)
		ctx.globalCompositeOperation = 'lighter';
		for (let pass = 0; pass < CONFIG.glowPasses; pass++) {
			const expand = (pass + 1) * CONFIG.glowExpand;
			const alpha = CONFIG.glowAlpha / (pass + 1);
			for (const el of elements) {
				drawElementGlow(el, expand, alpha);
			}
		}

		// Pass 2: solid
		ctx.globalCompositeOperation = 'source-over';
		for (const el of elements) {
			drawElement(el);
		}

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}

// ─── BUILD HELIX ELEMENTS ───────────────────────────────────────────────────
function buildHelixElements(cx, cy) {
	const elements = [];
	const {
		helixRadius,
		helixPitch,
		basePairCount,
		basePairGap,
		backboneNodeRadius,
		perspectiveScale,
		depthFade,
		strandWidth,
		strandAlpha
	} = CONFIG;
	const spacing = helixPitch / basePairCount;

	for (let i = 0; i < basePairCount; i++) {
		const vertPos = i * spacing - (scrollOffset % helixPitch);
		const y = cy + vertPos - (basePairCount * spacing) / 2;

		// Skip off-screen
		if (y < -60 || y > height + 60) continue;

		const angle = phase + (i / basePairCount) * Math.PI * 2;
		const cosA = Math.cos(angle);
		const sinA = Math.sin(angle);

		// Strand 1 and Strand 2 positions (offset by π)
		const x1 = cx + cosA * helixRadius;
		const z1 = sinA; // -1 to 1 normalised depth
		const x2 = cx - cosA * helixRadius;
		const z2 = -sinA;

		const scale1 = 1 + z1 * perspectiveScale;
		const scale2 = 1 + z2 * perspectiveScale;
		const alpha1 = strandAlpha * (1 - (1 - depthFade) * (1 - (z1 + 1) / 2));
		const alpha2 = strandAlpha * (1 - (1 - depthFade) * (1 - (z2 + 1) / 2));

		// Base pair rung
		const pair = pairMap[basePairSequence[i % basePairSequence.length]];
		const leftRgb = getRgb(pair.left);
		const rightRgb = getRgb(pair.right);
		const avgZ = (z1 + z2) / 2;
		const rungAlpha = strandAlpha * (1 - (1 - depthFade) * (1 - (avgZ + 1) / 2));

		// Push rung (two halves)
		elements.push({
			type: 'rung',
			x1,
			y,
			x2,
			y2: y,
			gap: basePairGap * ((scale1 + scale2) / 2),
			width: CONFIG.basePairWidth * ((scale1 + scale2) / 2),
			leftColor: leftRgb,
			rightColor: rightRgb,
			alpha: rungAlpha * 0.8,
			z: avgZ
		});

		// Backbone nodes
		elements.push({
			type: 'node',
			x: x1,
			y,
			r: backboneNodeRadius * scale1,
			color: getRgb(CONFIG.colors.strand1.replace('#', '').length ? 'strand1' : 'a'),
			colorHex: CONFIG.colors.strand1,
			alpha: alpha1,
			z: z1
		});
		elements.push({
			type: 'node',
			x: x2,
			y,
			r: backboneNodeRadius * scale2,
			color: hexToRgb(CONFIG.colors.strand2),
			colorHex: CONFIG.colors.strand2,
			alpha: alpha2,
			z: z2
		});
	}

	return elements;
}

function drawElementGlow(el, expand, alpha) {
	const a = el.alpha * alpha;
	if (a < 0.005) return;

	if (el.type === 'node') {
		ctx.beginPath();
		ctx.arc(el.x, el.y, el.r + expand, 0, Math.PI * 2);
		ctx.fillStyle = lerpColor(el.color[0], el.color[1], el.color[2], a);
		ctx.fill();
	} else if (el.type === 'rung') {
		const midX = (el.x1 + el.x2) / 2;
		ctx.lineWidth = el.width + expand;
		ctx.lineCap = 'round';
		// Left half
		ctx.beginPath();
		ctx.moveTo(el.x1, el.y);
		ctx.lineTo(midX - el.gap / 2, el.y);
		ctx.strokeStyle = lerpColor(el.leftColor[0], el.leftColor[1], el.leftColor[2], a);
		ctx.stroke();
		// Right half
		ctx.beginPath();
		ctx.moveTo(midX + el.gap / 2, el.y);
		ctx.lineTo(el.x2, el.y);
		ctx.strokeStyle = lerpColor(el.rightColor[0], el.rightColor[1], el.rightColor[2], a);
		ctx.stroke();
	}
}

function drawElement(el) {
	if (el.type === 'node') {
		// Phosphate backbone sphere
		const r = el.r;
		const col = el.color;
		ctx.beginPath();
		ctx.arc(el.x, el.y, r, 0, Math.PI * 2);
		ctx.fillStyle = lerpColor(col[0], col[1], col[2], el.alpha);
		ctx.fill();
		// Highlight
		ctx.beginPath();
		ctx.arc(el.x - r * 0.25, el.y - r * 0.25, r * 0.4, 0, Math.PI * 2);
		ctx.fillStyle = lerpColor(255, 255, 255, el.alpha * 0.4);
		ctx.fill();
	} else if (el.type === 'rung') {
		const midX = (el.x1 + el.x2) / 2;
		ctx.lineWidth = el.width;
		ctx.lineCap = 'round';
		// Left half
		ctx.beginPath();
		ctx.moveTo(el.x1, el.y);
		ctx.lineTo(midX - el.gap / 2, el.y);
		ctx.strokeStyle = lerpColor(el.leftColor[0], el.leftColor[1], el.leftColor[2], el.alpha);
		ctx.stroke();
		// Right half
		ctx.beginPath();
		ctx.moveTo(midX + el.gap / 2, el.y);
		ctx.lineTo(el.x2, el.y);
		ctx.strokeStyle = lerpColor(el.rightColor[0], el.rightColor[1], el.rightColor[2], el.alpha);
		ctx.stroke();
	}
}

// ─── GLOW PARTICLES ─────────────────────────────────────────────────────────
function updateAndDrawGlow(dt) {
	const count = CONFIG.glowParticleCount;
	const rgb = hexToRgb(CONFIG.colors.glow);

	ctx.globalCompositeOperation = 'lighter';
	for (let i = 0; i < count; i++) {
		const off = i * GLOW_STRIDE;
		let x = glowData[off + 0];
		let y = glowData[off + 1];
		const z = glowData[off + 2];
		const vx = glowData[off + 3];
		const vy = glowData[off + 4];
		const r = glowData[off + 5];
		const hueShift = glowData[off + 6];

		x += vx * dt;
		y += vy * dt;

		// Wrap
		if (x < -20) x += width + 40;
		if (x > width + 20) x -= width + 40;
		if (y < -20) y += height + 40;
		if (y > height + 20) y -= height + 40;

		glowData[off + 0] = x;
		glowData[off + 1] = y;

		const alpha = CONFIG.glowParticleAlpha * (0.3 + z * 0.7);
		const scaledR = r * (0.5 + z * 0.5);

		// Soft glow circle
		ctx.beginPath();
		ctx.arc(x, y, scaledR * 3, 0, Math.PI * 2);
		ctx.fillStyle = lerpColor(rgb[0], rgb[1], rgb[2], alpha * 0.15);
		ctx.fill();

		ctx.beginPath();
		ctx.arc(x, y, scaledR, 0, Math.PI * 2);
		ctx.fillStyle = lerpColor(rgb[0], rgb[1], rgb[2], alpha);
		ctx.fill();
	}
	ctx.globalCompositeOperation = 'source-over';
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
