/**
 * Title: Context Mushroom Farm
 * Description: A bioluminescent mushroom grow room that sprouts and fills as your
 *   chat conversation grows. Uses the 'context' message type to track token usage.
 *   Stages: mycelium threads → tiny pins → growing caps → full clusters →
 *   bioluminescent glow → spore release at capacity. Move your mouse to stir
 *   floating spores. Includes ambient fog, moisture particles, and glowing fungi.
 *
 *   Context-aware: requires the Theme Designer Pro context data channel.
 */

/* ---------- CONFIGURABLE VARIABLES ---------- */
const MAX_TOKENS         = 128000;   // your model's context limit
const GROWTH_SPEED       = 1;        // multiplier for testing (set to 10–50 for fast preview)
const MUSHROOM_CLUSTERS  = 12;       // number of mushroom clusters
const SPORE_COUNT        = 60;       // ambient spore particles
const FOG_LAYERS         = 3;        // fog layers (more = thicker atmosphere)
const BIOLUM_HUE         = 165;      // bioluminescent hue (165 = cyan-teal)
const BIOLUM_HUE_ALT     = 280;      // alt glow hue (280 = purple)
const MOISTURE_COUNT     = 40;       // tiny moisture droplets
/* --------------------------------------------- */

let canvas, ctx, w, h;
let mouse = { x: -9999, y: -9999 };
let contextRatio = 0;
let targetRatio = 0;
let estimatedTokens = 0;
let time = 0;
let clusters = [];
let spores = [];
let moisture = [];

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

// Seeded random for consistent mushroom placement
function seededRandom(seed) {
	let s = seed;
	return function() {
		s = (s * 16807 + 0) % 2147483647;
		return (s - 1) / 2147483646;
	};
}

function initClusters() {
	clusters = [];
	const rng = seededRandom(42);
	const groundY = h * 0.82;

	for (let i = 0; i < MUSHROOM_CLUSTERS; i++) {
		const clusterX = w * 0.08 + rng() * w * 0.84;
		const mushroomCount = 2 + Math.floor(rng() * 4);
		const isBiolum = rng() > 0.5;
		const hue = isBiolum ? (rng() > 0.5 ? BIOLUM_HUE : BIOLUM_HUE_ALT) : 30;
		const growStart = rng() * 0.3; // stagger growth start
		const mushrooms = [];

		for (let j = 0; j < mushroomCount; j++) {
			mushrooms.push({
				offsetX: (rng() - 0.5) * 60,
				maxHeight: 25 + rng() * 80,
				stemWidth: 3 + rng() * 6,
				capRadius: 10 + rng() * 25,
				capStyle: rng() > 0.6 ? 'round' : 'flat',
				lean: (rng() - 0.5) * 0.3,
				hueShift: (rng() - 0.5) * 20,
				phase: rng() * Math.PI * 2,
				growDelay: rng() * 0.15
			});
		}

		clusters.push({
			x: clusterX,
			y: groundY + (rng() - 0.5) * 10,
			mushrooms,
			isBiolum,
			hue,
			growStart,
			myceliumSeeds: Array.from({ length: 5 + Math.floor(rng() * 6) }, () => ({
				angle: rng() * Math.PI * 2,
				length: 15 + rng() * 40,
				branches: Math.floor(rng() * 3),
				phase: rng() * Math.PI
			}))
		});
	}
}

function initSpores() {
	spores = [];
	for (let i = 0; i < SPORE_COUNT; i++) {
		spores.push({
			x: Math.random() * w,
			y: Math.random() * h * 0.85,
			vx: 0,
			vy: -0.1 - Math.random() * 0.3,
			size: 1 + Math.random() * 2.5,
			alpha: 0.2 + Math.random() * 0.5,
			hue: Math.random() > 0.5 ? BIOLUM_HUE : BIOLUM_HUE_ALT,
			drift: Math.random() * Math.PI * 2
		});
	}
}

function initMoisture() {
	moisture = [];
	for (let i = 0; i < MOISTURE_COUNT; i++) {
		moisture.push({
			x: Math.random() * w,
			y: Math.random() * h,
			speed: 0.2 + Math.random() * 0.5,
			size: 0.5 + Math.random() * 1,
			alpha: 0.1 + Math.random() * 0.2
		});
	}
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
			initClusters();
			initSpores();
			initMoisture();
			startAnimation();
			break;
		case 'resize':
			w = e.data.width;
			h = e.data.height;
			canvas.width = w;
			canvas.height = h;
			initClusters();
			initSpores();
			initMoisture();
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
		case 'context':
			// Prefer exact API token count, fall back to DOM-based estimate
			if (e.data.exactTokens !== undefined) {
				estimatedTokens = e.data.exactTokens;
			} else if (e.data.estimatedTokens !== undefined) {
				estimatedTokens = e.data.estimatedTokens;
			}
			targetRatio = Math.min(1, (estimatedTokens / MAX_TOKENS) * GROWTH_SPEED);
			break;
	}
};

function drawSubstrate(groundY) {
	// Dark substrate base
	const gGrad = ctx.createLinearGradient(0, groundY - 15, 0, h);
	gGrad.addColorStop(0, '#1a1510');
	gGrad.addColorStop(0.15, '#12100c');
	gGrad.addColorStop(1, '#080604');
	ctx.fillStyle = gGrad;
	ctx.fillRect(0, groundY - 5, w, h - groundY + 5);

	// Straw/substrate texture
	const rng = seededRandom(99);
	ctx.strokeStyle = 'rgba(80, 65, 40, 0.15)';
	ctx.lineWidth = 1;
	for (let i = 0; i < 30; i++) {
		const sx = rng() * w;
		const sy = groundY + rng() * (h - groundY) * 0.5;
		const len = 8 + rng() * 20;
		const angle = (rng() - 0.5) * 0.8;
		ctx.beginPath();
		ctx.moveTo(sx, sy);
		ctx.lineTo(sx + Math.cos(angle) * len, sy + Math.sin(angle) * len);
		ctx.stroke();
	}
}

function drawMycelium(cluster, progress) {
	if (progress <= 0) return;
	const p = Math.min(1, progress * 3); // mycelium grows fast

	ctx.strokeStyle = `rgba(220, 215, 200, ${p * 0.25})`;
	ctx.lineWidth = 0.8;

	for (const m of cluster.myceliumSeeds) {
		const len = m.length * p;
		const wobble = Math.sin(time * 0.01 + m.phase) * 3;

		ctx.beginPath();
		ctx.moveTo(cluster.x, cluster.y);
		const ex = cluster.x + Math.cos(m.angle) * len + wobble;
		const ey = cluster.y + Math.sin(m.angle) * len * 0.4 + Math.abs(Math.sin(m.angle)) * 5;
		ctx.quadraticCurveTo(
			cluster.x + Math.cos(m.angle) * len * 0.5 + wobble * 0.5,
			cluster.y + Math.sin(m.angle) * len * 0.2 + 5,
			ex, ey
		);
		ctx.stroke();

		// Branches
		if (p > 0.5 && m.branches > 0) {
			const bp = (p - 0.5) * 2;
			for (let b = 0; b < m.branches; b++) {
				const bStart = 0.4 + b * 0.2;
				const bx = cluster.x + Math.cos(m.angle) * len * bStart;
				const by = cluster.y + Math.sin(m.angle) * len * 0.4 * bStart;
				const bAngle = m.angle + (b % 2 === 0 ? 0.5 : -0.5);
				const bLen = len * 0.3 * bp;
				ctx.beginPath();
				ctx.moveTo(bx, by);
				ctx.lineTo(bx + Math.cos(bAngle) * bLen, by + Math.sin(bAngle) * bLen * 0.4);
				ctx.stroke();
			}
		}
	}
}

function drawMushroom(x, baseY, mush, growthP, isBiolum, baseHue) {
	if (growthP <= 0) return;

	const hue = baseHue + mush.hueShift;
	const stemH = mush.maxHeight * growthP;
	const lean = mush.lean * stemH + Math.sin(time * 0.012 + mush.phase) * 2;
	const topX = x + lean;
	const topY = baseY - stemH;
	const sw = mush.stemWidth * (0.5 + growthP * 0.5);
	const capR = mush.capRadius * Math.min(1, growthP * 1.2);

	// Stem
	ctx.beginPath();
	ctx.moveTo(x - sw / 2, baseY);
	ctx.quadraticCurveTo(x - sw / 3 + lean * 0.3, baseY - stemH * 0.5, topX - sw / 3, topY + capR * 0.3);
	ctx.lineTo(topX + sw / 3, topY + capR * 0.3);
	ctx.quadraticCurveTo(x + sw / 3 + lean * 0.3, baseY - stemH * 0.5, x + sw / 2, baseY);
	ctx.closePath();

	const stemGrad = ctx.createLinearGradient(x, baseY, topX, topY);
	stemGrad.addColorStop(0, isBiolum ? `hsla(${hue}, 20%, 25%, 0.9)` : 'rgba(200, 190, 170, 0.9)');
	stemGrad.addColorStop(1, isBiolum ? `hsla(${hue}, 30%, 35%, 0.9)` : 'rgba(220, 210, 190, 0.9)');
	ctx.fillStyle = stemGrad;
	ctx.fill();

	// Cap
	if (growthP > 0.3) {
		const capP = Math.min(1, (growthP - 0.3) / 0.5);
		const cr = capR * capP;

		if (mush.capStyle === 'round') {
			// Rounded dome cap
			ctx.beginPath();
			ctx.ellipse(topX, topY + cr * 0.15, cr, cr * 0.65, 0, 0, Math.PI * 2);

			const capGrad = ctx.createRadialGradient(topX - cr * 0.2, topY - cr * 0.1, cr * 0.1, topX, topY, cr);
			if (isBiolum) {
				capGrad.addColorStop(0, `hsla(${hue}, 70%, 55%, 0.95)`);
				capGrad.addColorStop(0.7, `hsla(${hue}, 60%, 35%, 0.9)`);
				capGrad.addColorStop(1, `hsla(${hue}, 50%, 20%, 0.85)`);
			} else {
				capGrad.addColorStop(0, `hsl(${hue}, 50%, 55%)`);
				capGrad.addColorStop(0.7, `hsl(${hue}, 45%, 35%)`);
				capGrad.addColorStop(1, `hsl(${hue}, 40%, 20%)`);
			}
			ctx.fillStyle = capGrad;
			ctx.fill();
		} else {
			// Flat/parasol cap
			ctx.beginPath();
			ctx.ellipse(topX, topY + cr * 0.1, cr * 1.1, cr * 0.35, 0, 0, Math.PI);

			const capGrad = ctx.createLinearGradient(topX - cr, topY, topX + cr, topY + cr * 0.3);
			if (isBiolum) {
				capGrad.addColorStop(0, `hsla(${hue}, 65%, 50%, 0.9)`);
				capGrad.addColorStop(1, `hsla(${hue}, 55%, 25%, 0.85)`);
			} else {
				capGrad.addColorStop(0, `hsl(${hue}, 45%, 50%)`);
				capGrad.addColorStop(1, `hsl(${hue}, 40%, 25%)`);
			}
			ctx.fillStyle = capGrad;
			ctx.fill();
		}

		// Gills (underside lines)
		if (capP > 0.5) {
			const gillP = (capP - 0.5) * 2;
			ctx.strokeStyle = isBiolum
				? `hsla(${hue}, 50%, 60%, ${gillP * 0.3})`
				: `rgba(180, 170, 150, ${gillP * 0.2})`;
			ctx.lineWidth = 0.5;
			const gillCount = 6;
			for (let g = 0; g < gillCount; g++) {
				const gx = topX - cr * 0.7 + (g / (gillCount - 1)) * cr * 1.4;
				ctx.beginPath();
				ctx.moveTo(gx, topY + cr * 0.15);
				ctx.lineTo(gx, topY + cr * 0.4);
				ctx.stroke();
			}
		}

		// Bioluminescent glow
		if (isBiolum && growthP > 0.5) {
			const glowP = (growthP - 0.5) * 2;
			const pulse = 0.6 + 0.4 * Math.sin(time * 0.02 + mush.phase);
			const glowR = cr * 2.5 * glowP;
			const glowGrad = ctx.createRadialGradient(topX, topY, 0, topX, topY, glowR);
			glowGrad.addColorStop(0, `hsla(${hue}, 80%, 60%, ${glowP * pulse * 0.2})`);
			glowGrad.addColorStop(0.5, `hsla(${hue}, 70%, 40%, ${glowP * pulse * 0.08})`);
			glowGrad.addColorStop(1, `hsla(${hue}, 60%, 30%, 0)`);
			ctx.fillStyle = glowGrad;
			ctx.beginPath();
			ctx.arc(topX, topY, glowR, 0, Math.PI * 2);
			ctx.fill();
		}

		// Spots on cap (for non-biolum mushrooms)
		if (!isBiolum && capP > 0.7) {
			const spotP = (capP - 0.7) / 0.3;
			ctx.fillStyle = `rgba(255, 250, 230, ${spotP * 0.5})`;
			const spotRng = seededRandom(Math.floor(x * 100 + mush.maxHeight));
			const spotCount = 3 + Math.floor(spotRng() * 4);
			for (let s = 0; s < spotCount; s++) {
				const sa = spotRng() * Math.PI * 2;
				const sd = spotRng() * cr * 0.6;
				const sr = 1.5 + spotRng() * 2.5;
				ctx.beginPath();
				ctx.arc(topX + Math.cos(sa) * sd, topY + Math.sin(sa) * sd * 0.5, sr * spotP, 0, Math.PI * 2);
				ctx.fill();
			}
		}
	}
}

function drawFog(groundY) {
	for (let layer = 0; layer < FOG_LAYERS; layer++) {
		const fogY = groundY - 30 - layer * 40;
		const drift = Math.sin(time * 0.003 + layer * 2) * 50;
		const fogGrad = ctx.createRadialGradient(
			w / 2 + drift, fogY, 0,
			w / 2 + drift, fogY, w * 0.6
		);
		const alpha = 0.03 + contextRatio * 0.03;
		fogGrad.addColorStop(0, `rgba(150, 160, 140, ${alpha})`);
		fogGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
		ctx.fillStyle = fogGrad;
		ctx.fillRect(0, 0, w, h);
	}
}

function updateSpores() {
	const sporeAlpha = contextRatio > 0.6 ? (contextRatio - 0.6) / 0.4 : 0;
	if (sporeAlpha <= 0) return;

	for (const s of spores) {
		// Drift
		s.x += Math.sin(time * 0.01 + s.drift) * 0.3 + s.vx;
		s.y += s.vy;
		s.drift += 0.005;

		// Mouse interaction — spores drift toward cursor
		const dx = mouse.x - s.x;
		const dy = mouse.y - s.y;
		const d2 = dx * dx + dy * dy;
		if (d2 < 20000 && d2 > 1) {
			const dist = Math.sqrt(d2);
			s.vx += (dx / dist) * 0.05;
			s.vy += (dy / dist) * 0.05;
		}
		s.vx *= 0.97;
		s.vy *= 0.97;
		s.vy -= 0.005; // gentle upward float

		// Wrap
		if (s.y < -10) { s.y = h * 0.8; s.x = Math.random() * w; }
		if (s.x < -10) s.x = w + 10;
		if (s.x > w + 10) s.x = -10;

		// Draw
		const pulse = 0.5 + 0.5 * Math.sin(time * 0.03 + s.drift);
		const a = s.alpha * sporeAlpha * pulse;
		ctx.fillStyle = `hsla(${s.hue}, 80%, 70%, ${a})`;
		ctx.beginPath();
		ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
		ctx.fill();

		// Spore glow
		if (a > 0.2) {
			const sg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.size * 4);
			sg.addColorStop(0, `hsla(${s.hue}, 80%, 70%, ${a * 0.3})`);
			sg.addColorStop(1, `hsla(${s.hue}, 80%, 70%, 0)`);
			ctx.fillStyle = sg;
			ctx.beginPath();
			ctx.arc(s.x, s.y, s.size * 4, 0, Math.PI * 2);
			ctx.fill();
		}
	}
}

function updateMoisture() {
	ctx.fillStyle = 'rgba(180, 200, 220, 0.08)';
	for (const m of moisture) {
		m.y += m.speed;
		if (m.y > h) { m.y = -5; m.x = Math.random() * w; }
		ctx.beginPath();
		ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2);
		ctx.fill();
	}
}

function startAnimation() {
	function render() {
		if (!ctx) return;
		time++;

		// Smooth context interpolation
		contextRatio += (targetRatio - contextRatio) * 0.008;

		// --- Background ---
		const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
		bgGrad.addColorStop(0, '#050508');
		bgGrad.addColorStop(0.5, '#0a0a10');
		bgGrad.addColorStop(0.8, '#0f0d0a');
		bgGrad.addColorStop(1, '#080604');
		ctx.fillStyle = bgGrad;
		ctx.fillRect(0, 0, w, h);

		// Ambient bioluminescent glow from all mushrooms
		if (contextRatio > 0.3) {
			const ambP = (contextRatio - 0.3) / 0.7;
			const ambGrad = ctx.createRadialGradient(w * 0.5, h * 0.7, 0, w * 0.5, h * 0.7, h * 0.8);
			ambGrad.addColorStop(0, `hsla(${BIOLUM_HUE}, 60%, 40%, ${ambP * 0.04})`);
			ambGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
			ctx.fillStyle = ambGrad;
			ctx.fillRect(0, 0, w, h);
		}

		// Warning pulse when nearly full
		if (contextRatio > 0.88) {
			const wP = (contextRatio - 0.88) / 0.12;
			const pulse = 0.5 + 0.5 * Math.sin(time * 0.04);
			ctx.fillStyle = `rgba(255, 40, 20, ${wP * pulse * 0.06})`;
			ctx.fillRect(0, 0, w, h);
		}

		const groundY = h * 0.82;

		// Moisture particles (background)
		updateMoisture();

		// --- Substrate ---
		drawSubstrate(groundY);

		// --- Mushroom clusters ---
		// Sort by Y so lower clusters draw on top (depth)
		const sorted = [...clusters].sort((a, b) => a.y - b.y);

		for (const cluster of sorted) {
			const clusterP = Math.max(0, (contextRatio - cluster.growStart) / (1 - cluster.growStart));

			// Mycelium (always draws first)
			if (clusterP > 0) {
				drawMycelium(cluster, clusterP);
			}

			// Individual mushrooms
			for (const mush of cluster.mushrooms) {
				const mushP = Math.max(0, (clusterP - mush.growDelay) / (1 - mush.growDelay));
				if (mushP > 0) {
					drawMushroom(
						cluster.x + mush.offsetX,
						cluster.y,
						mush,
						Math.min(1, mushP),
						cluster.isBiolum,
						cluster.hue
					);
				}
			}
		}

		// Fog (on top of mushrooms)
		drawFog(groundY);

		// Spores (on top of everything)
		updateSpores();

		// --- Token counter (subtle) ---
		if (estimatedTokens > 0) {
			ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
			ctx.fillRect(w - 175, h - 38, 168, 30);
			ctx.fillStyle = contextRatio > 0.85 ? '#ef4444' : contextRatio > 0.6 ? '#facc15' : `hsl(${BIOLUM_HUE}, 70%, 60%)`;
			ctx.font = '11px monospace';
			ctx.textAlign = 'right';
			ctx.fillText(`~${(estimatedTokens / 1000).toFixed(1)}k / ${(MAX_TOKENS / 1000).toFixed(0)}k tokens`, w - 14, h - 19);
			ctx.textAlign = 'left';

			// Mini progress bar
			ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
			ctx.fillRect(w - 168, h - 14, 155, 4);
			const barColor = contextRatio > 0.85 ? '#ef4444' : contextRatio > 0.6 ? '#facc15' : `hsl(${BIOLUM_HUE}, 70%, 50%)`;
			ctx.fillStyle = barColor;
			ctx.fillRect(w - 168, h - 14, 155 * Math.min(1, contextRatio), 4);
		}

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}
