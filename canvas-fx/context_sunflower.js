/**
 * Title: Context Sunflower
 * Description: A single sunflower that grows from a seed as your chat conversation
 *   grows. Uses the new 'context' message type to track estimated token usage.
 *   The sunflower progresses through stages: soil → sprout → stem & leaves →
 *   bud → bloom → full flower. When context is nearly full, petals droop as
 *   a visual warning. Move your mouse to sway the flower gently in the breeze.
 *
 *   Context-aware: requires the Theme Designer Pro context data channel.
 */

/* ---------- CONFIGURABLE VARIABLES ---------- */
const MAX_TOKENS         = 128000;   // your model's context limit (adjust per model)
const GROWTH_SPEED       = 1;        // multiplier for testing (set to 10–50 for fast preview)
const BG_GRADIENT_TOP    = '#0a0e1a'; // night sky top
const BG_GRADIENT_BOT    = '#1a1205'; // warm earth bottom
const SOIL_COLOR         = '#2a1f0e'; // rich soil
const STEM_COLOR         = '#2d5a1e'; // stem green
const LEAF_COLOR         = '#3a7a2a'; // leaf green
const PETAL_COLOR        = '#ffd700'; // sunflower gold
const CENTER_COLOR       = '#5a3a0a'; // brown center
const STAR_COUNT         = 80;       // background stars
const SWAY_AMOUNT        = 0.03;     // mouse-driven sway
/* --------------------------------------------- */

let canvas, ctx, w, h;
let mouse = { x: -9999, y: -9999 };
let contextRatio = 0;  // 0 to 1
let targetRatio = 0;
let estimatedTokens = 0;
let messageCount = 0;
let time = 0;
let stars = [];

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function initStars() {
	stars = [];
	for (let i = 0; i < STAR_COUNT; i++) {
		stars.push({
			x: Math.random() * w,
			y: Math.random() * h * 0.6,
			size: 0.5 + Math.random() * 1.5,
			twinkleSpeed: 0.02 + Math.random() * 0.04,
			twinklePhase: Math.random() * Math.PI * 2
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
			initStars();
			startAnimation();
			break;
		case 'resize':
			w = e.data.width;
			h = e.data.height;
			canvas.width = w;
			canvas.height = h;
			initStars();
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
			messageCount = e.data.messages || messageCount;
			targetRatio = Math.min(1, (estimatedTokens / MAX_TOKENS) * GROWTH_SPEED);
			break;
	}
};

// Easing function for smooth growth
function easeOutCubic(t) {
	return 1 - Math.pow(1 - t, 3);
}

// Draw a curved stem
function drawStem(baseX, baseY, stemHeight, sway, thickness) {
	ctx.beginPath();
	ctx.moveTo(baseX, baseY);

	const cp1x = baseX + sway * 0.3;
	const cp1y = baseY - stemHeight * 0.4;
	const cp2x = baseX + sway * 0.8;
	const cp2y = baseY - stemHeight * 0.7;
	const topX = baseX + sway;
	const topY = baseY - stemHeight;

	ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, topX, topY);

	ctx.strokeStyle = STEM_COLOR;
	ctx.lineWidth = thickness;
	ctx.lineCap = 'round';
	ctx.stroke();

	return { x: topX, y: topY, cp2x, cp2y };
}

// Draw a leaf on the stem
function drawLeaf(stemBaseX, stemBaseY, stemTop, stemHeight, side, progress, sway) {
	const leafSize = 15 + progress * 25;
	const attachY = stemBaseY - stemHeight * (side === 'left' ? 0.35 : 0.55);
	const attachX = stemBaseX + sway * (attachY - stemBaseY) / (-stemHeight || -1);

	const angle = side === 'left' ? -0.6 - progress * 0.3 : 0.6 + progress * 0.3;
	const tipX = attachX + Math.cos(angle) * leafSize * (side === 'left' ? -1 : 1);
	const tipY = attachY + Math.sin(angle) * leafSize * -0.3;

	ctx.beginPath();
	ctx.moveTo(attachX, attachY);

	const cx1 = attachX + (tipX - attachX) * 0.3;
	const cy1 = attachY - leafSize * 0.4;
	const cx2 = tipX - (tipX - attachX) * 0.2;
	const cy2 = tipY - leafSize * 0.1;
	ctx.bezierCurveTo(cx1, cy1, cx2, cy2, tipX, tipY);

	const cx3 = tipX - (tipX - attachX) * 0.2;
	const cy3 = tipY + leafSize * 0.3;
	const cx4 = attachX + (tipX - attachX) * 0.3;
	const cy4 = attachY + leafSize * 0.15;
	ctx.bezierCurveTo(cx3, cy3, cx4, cy4, attachX, attachY);

	ctx.fillStyle = LEAF_COLOR;
	ctx.globalAlpha = 0.8;
	ctx.fill();
	ctx.globalAlpha = 1;

	// Leaf vein
	ctx.beginPath();
	ctx.moveTo(attachX, attachY);
	ctx.lineTo(tipX, tipY);
	ctx.strokeStyle = '#1e4a15';
	ctx.lineWidth = 1;
	ctx.stroke();
}

// Draw the sunflower head
function drawFlowerHead(cx, cy, radius, petalCount, openProgress, droopAngle) {
	// Petals
	for (let i = 0; i < petalCount; i++) {
		const angle = (i / petalCount) * Math.PI * 2 + Math.sin(time * 0.01 + i) * 0.05;
		const petalLen = radius * (1.6 + Math.sin(i * 2.5) * 0.2) * openProgress;
		const petalWid = radius * 0.35 * openProgress;

		// Droop: petals angle downward as context fills
		const droopOffset = droopAngle * Math.sin(angle) * 0.5;

		const tipX = cx + Math.cos(angle + droopOffset) * petalLen;
		const tipY = cy + Math.sin(angle + droopOffset) * petalLen;

		ctx.beginPath();
		const perpAngle = angle + Math.PI / 2;
		const bx1 = cx + Math.cos(perpAngle) * petalWid * 0.5;
		const by1 = cy + Math.sin(perpAngle) * petalWid * 0.5;
		const bx2 = cx - Math.cos(perpAngle) * petalWid * 0.5;
		const by2 = cy - Math.sin(perpAngle) * petalWid * 0.5;

		ctx.moveTo(bx1, by1);
		ctx.quadraticCurveTo(
			cx + Math.cos(angle + droopOffset) * petalLen * 0.6 + Math.cos(perpAngle) * petalWid * 0.3,
			cy + Math.sin(angle + droopOffset) * petalLen * 0.6 + Math.sin(perpAngle) * petalWid * 0.3,
			tipX, tipY
		);
		ctx.quadraticCurveTo(
			cx + Math.cos(angle + droopOffset) * petalLen * 0.6 - Math.cos(perpAngle) * petalWid * 0.3,
			cy + Math.sin(angle + droopOffset) * petalLen * 0.6 - Math.sin(perpAngle) * petalWid * 0.3,
			bx2, by2
		);

		// Gradient on petals — gold to dark amber
		const hueShift = Math.sin(i * 1.2) * 10;
		ctx.fillStyle = `hsl(${45 + hueShift}, 100%, ${50 + openProgress * 10}%)`;
		ctx.fill();
	}

	// Center disc
	const cGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * openProgress);
	cGrad.addColorStop(0, '#8B6914');
	cGrad.addColorStop(0.5, CENTER_COLOR);
	cGrad.addColorStop(1, '#3a2505');
	ctx.beginPath();
	ctx.arc(cx, cy, radius * openProgress, 0, Math.PI * 2);
	ctx.fillStyle = cGrad;
	ctx.fill();

	// Seeds pattern in center
	if (openProgress > 0.5) {
		const seedAlpha = (openProgress - 0.5) * 2;
		ctx.fillStyle = `rgba(30, 20, 5, ${seedAlpha * 0.6})`;
		const seedCount = 30;
		for (let i = 0; i < seedCount; i++) {
			const seedAngle = (i / seedCount) * Math.PI * 2;
			const rings = 3;
			for (let r = 1; r <= rings; r++) {
				const dist = (r / rings) * radius * 0.7 * openProgress;
				const sx = cx + Math.cos(seedAngle + r * 0.5) * dist;
				const sy = cy + Math.sin(seedAngle + r * 0.5) * dist;
				ctx.beginPath();
				ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
				ctx.fill();
			}
		}
	}
}

// Draw soil/ground
function drawGround(groundY) {
	// Ground gradient
	const gGrad = ctx.createLinearGradient(0, groundY - 20, 0, h);
	gGrad.addColorStop(0, SOIL_COLOR);
	gGrad.addColorStop(0.3, '#1f170a');
	gGrad.addColorStop(1, '#0f0a04');
	ctx.fillStyle = gGrad;
	ctx.fillRect(0, groundY, w, h - groundY);

	// Soil texture bumps
	ctx.fillStyle = 'rgba(60, 45, 20, 0.3)';
	for (let i = 0; i < 20; i++) {
		const bx = (i / 20) * w + Math.sin(i * 3.7) * 30;
		const by = groundY + Math.sin(i * 2.3) * 5;
		ctx.beginPath();
		ctx.ellipse(bx, by, 25 + Math.sin(i) * 10, 6, 0, 0, Math.PI * 2);
		ctx.fill();
	}
}

// Draw a tiny sprout
function drawSprout(x, groundY, progress) {
	const sproutH = progress * 30;
	const curl = Math.sin(time * 0.03) * 3 * progress;

	// Tiny stem
	ctx.beginPath();
	ctx.moveTo(x, groundY);
	ctx.quadraticCurveTo(x + curl, groundY - sproutH * 0.6, x + curl * 0.5, groundY - sproutH);
	ctx.strokeStyle = '#4a8a30';
	ctx.lineWidth = 2;
	ctx.lineCap = 'round';
	ctx.stroke();

	// Two tiny leaves unfurling
	if (progress > 0.3) {
		const leafP = (progress - 0.3) / 0.7;
		const leafSize = leafP * 10;
		const topX = x + curl * 0.5;
		const topY = groundY - sproutH;

		// Left cotyledon
		ctx.beginPath();
		ctx.ellipse(topX - leafSize * 0.6, topY - leafSize * 0.2, leafSize, leafSize * 0.4, -0.5, 0, Math.PI * 2);
		ctx.fillStyle = '#5aaa3a';
		ctx.fill();

		// Right cotyledon
		ctx.beginPath();
		ctx.ellipse(topX + leafSize * 0.6, topY - leafSize * 0.2, leafSize, leafSize * 0.4, 0.5, 0, Math.PI * 2);
		ctx.fill();
	}
}

function startAnimation() {
	function render() {
		if (!ctx) return;
		time++;

		// Smoothly interpolate toward target ratio
		contextRatio += (targetRatio - contextRatio) * 0.01;

		// --- Background ---
		const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
		bgGrad.addColorStop(0, BG_GRADIENT_TOP);
		bgGrad.addColorStop(0.7, BG_GRADIENT_BOT);
		bgGrad.addColorStop(1, SOIL_COLOR);
		ctx.fillStyle = bgGrad;
		ctx.fillRect(0, 0, w, h);

		// Stars (fade as context grows — dawn approaching)
		const starAlpha = Math.max(0, 1 - contextRatio * 1.5);
		if (starAlpha > 0) {
			for (const s of stars) {
				const twinkle = 0.3 + 0.7 * Math.sin(time * s.twinkleSpeed + s.twinklePhase);
				ctx.fillStyle = `rgba(255, 255, 230, ${twinkle * starAlpha * 0.8})`;
				ctx.beginPath();
				ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
				ctx.fill();
			}
		}

		// Dawn glow as context grows (sunrise = approaching limit)
		if (contextRatio > 0.3) {
			const dawnP = (contextRatio - 0.3) / 0.7;
			const dawnGrad = ctx.createRadialGradient(w * 0.7, h * 0.5, 0, w * 0.7, h * 0.5, h * 0.8);
			dawnGrad.addColorStop(0, `rgba(255, ${140 + dawnP * 60}, ${40 + dawnP * 30}, ${dawnP * 0.15})`);
			dawnGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
			ctx.fillStyle = dawnGrad;
			ctx.fillRect(0, 0, w, h);
		}

		// Warning glow when context is nearly full
		if (contextRatio > 0.85) {
			const warnP = (contextRatio - 0.85) / 0.15;
			const pulse = 0.5 + 0.5 * Math.sin(time * 0.05);
			const warnGrad = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.4, h);
			warnGrad.addColorStop(0, `rgba(255, 50, 20, ${warnP * pulse * 0.08})`);
			warnGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
			ctx.fillStyle = warnGrad;
			ctx.fillRect(0, 0, w, h);
		}

		// --- Ground ---
		const groundY = h * 0.78;
		drawGround(groundY);

		// --- Mouse sway ---
		const mouseOffsetX = (mouse.x - w / 2) / (w / 2); // -1 to 1
		const sway = mouseOffsetX * w * SWAY_AMOUNT + Math.sin(time * 0.015) * 5;

		// --- Growth stages ---
		const baseX = w / 2;
		const baseY = groundY;

		// Stage 0: nothing (ratio 0)
		// Stage 1: sprout emerging (0 - 0.08)
		// Stage 2: stem growing (0.08 - 0.3)
		// Stage 3: leaves appearing (0.2 - 0.5)
		// Stage 4: bud forming (0.4 - 0.6)
		// Stage 5: flower opening (0.5 - 0.8)
		// Stage 6: full bloom (0.8 - 1.0)
		// Beyond 0.9: petals start drooping (warning)

		if (contextRatio < 0.01) {
			// Just soil — nothing yet
		} else if (contextRatio < 0.08) {
			// Sprout emerging
			const sproutP = contextRatio / 0.08;
			drawSprout(baseX, baseY, sproutP);
		} else {
			// Full plant from stem onward
			const stemProgress = easeOutCubic(Math.min(1, (contextRatio - 0.08) / 0.3));
			const maxStemH = h * 0.45;
			const stemHeight = 30 + stemProgress * (maxStemH - 30);
			const stemThickness = 3 + stemProgress * 5;

			const top = drawStem(baseX, baseY, stemHeight, sway, stemThickness);

			// Leaves
			if (contextRatio > 0.15) {
				const leafP = Math.min(1, (contextRatio - 0.15) / 0.25);
				drawLeaf(baseX, baseY, top, stemHeight, 'left', leafP, sway);
			}
			if (contextRatio > 0.25) {
				const leafP = Math.min(1, (contextRatio - 0.25) / 0.25);
				drawLeaf(baseX, baseY, top, stemHeight, 'right', leafP, sway);
			}

			// Bud / Flower
			if (contextRatio > 0.4) {
				const budP = Math.min(1, (contextRatio - 0.4) / 0.15);
				const bloomP = contextRatio > 0.55 ? Math.min(1, (contextRatio - 0.55) / 0.3) : 0;
				const flowerRadius = 8 + budP * 12;
				const petalCount = 16;

				// Droop when context is nearly full
				const droop = contextRatio > 0.9 ? (contextRatio - 0.9) / 0.1 * 0.8 : 0;

				drawFlowerHead(top.x, top.y, flowerRadius, petalCount, bloomP > 0 ? bloomP : budP * 0.3, droop);
			}
		}

		// --- Token counter overlay (subtle) ---
		if (estimatedTokens > 0) {
			ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
			ctx.fillRect(w - 175, h - 38, 168, 30);
			ctx.fillStyle = contextRatio > 0.85 ? '#ef4444' : contextRatio > 0.6 ? '#facc15' : '#4ade80';
			ctx.font = '11px monospace';
			ctx.textAlign = 'right';
			ctx.fillText(`~${(estimatedTokens / 1000).toFixed(1)}k / ${(MAX_TOKENS / 1000).toFixed(0)}k tokens`, w - 14, h - 19);
			ctx.textAlign = 'left';

			// Mini progress bar
			ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
			ctx.fillRect(w - 168, h - 14, 155, 4);
			ctx.fillStyle = contextRatio > 0.85 ? '#ef4444' : contextRatio > 0.6 ? '#facc15' : '#4ade80';
			ctx.fillRect(w - 168, h - 14, 155 * Math.min(1, contextRatio), 4);
		}

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}
