/**
 * Title: Bubble Pop
 * Description: Iridescent bubbles rise from the bottom of the screen.
 *   Click or tap them to pop them with a satisfying particle burst!
 *   Bubbles wobble, shimmer, and have realistic reflections. Popping
 *   creates chain reactions when bubbles are near each other. Score
 *   fades in as you pop more. Touch-friendly with generous hit zones.
 *
 *   Showcases: click, touchstart (multi-pop), mousemove (bubble flee)
 */

/* ---------- CONFIGURABLE VARIABLES ---------- */
const MAX_BUBBLES         = 20;       // max simultaneous bubbles
const SPAWN_RATE          = 80;       // frames between spawns
const BUBBLE_MIN_R        = 12;       // min radius
const BUBBLE_MAX_R        = 35;       // max radius
const RISE_SPEED          = 0.5;      // base rise speed
const POP_PARTICLES       = 16;       // particles per pop
const CHAIN_RADIUS        = 60;       // chain reaction radius
const FLEE_STRENGTH       = 0.4;      // how much bubbles flee from cursor
/* --------------------------------------------- */

let canvas, ctx, w, h;
let mouse = { x: -9999, y: -9999 };
let bubbles = [];
let popFx = [];
let score = 0;
let scoreAlpha = 0;
let frameCount = 0;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function createBubble() {
	if (bubbles.length >= MAX_BUBBLES) return;
	const r = BUBBLE_MIN_R + Math.random() * (BUBBLE_MAX_R - BUBBLE_MIN_R);
	bubbles.push({
		x: r + Math.random() * (w - r * 2),
		y: h + r + Math.random() * 50,
		r,
		vx: (Math.random() - 0.5) * 0.5,
		vy: -(RISE_SPEED + Math.random() * 0.5) * (40 / (r + 10)),
		hue: Math.random() * 360,
		wobblePhase: Math.random() * Math.PI * 2,
		wobbleSpeed: 0.02 + Math.random() * 0.02,
		shimmerPhase: Math.random() * Math.PI * 2,
		alpha: 0, // fade in
		alive: true
	});
}

function popBubble(bubble, fromChain) {
	if (!bubble.alive) return;
	bubble.alive = false;
	score++;
	scoreAlpha = 1;

	// Pop particles
	const hue = bubble.hue;
	for (let i = 0; i < POP_PARTICLES; i++) {
		const angle = (i / POP_PARTICLES) * Math.PI * 2;
		const speed = 1.5 + Math.random() * 3;
		popFx.push({
			x: bubble.x,
			y: bubble.y,
			vx: Math.cos(angle) * speed + (Math.random() - 0.5),
			vy: Math.sin(angle) * speed + (Math.random() - 0.5),
			size: 2 + Math.random() * 3,
			hue: hue + (Math.random() - 0.5) * 60,
			alpha: 0.9,
			decay: 0.015 + Math.random() * 0.02,
			iridescent: Math.random() > 0.5
		});
	}

	// Shiny ring
	popFx.push({
		x: bubble.x,
		y: bubble.y,
		vx: 0, vy: 0,
		size: bubble.r,
		hue,
		alpha: 0.5,
		decay: 0.03,
		isRing: true,
		ringRadius: bubble.r
	});

	// Chain reaction
	if (!fromChain) {
		for (const other of bubbles) {
			if (!other.alive || other === bubble) continue;
			const dx = other.x - bubble.x;
			const dy = other.y - bubble.y;
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist < CHAIN_RADIUS + other.r) {
				setTimeout(() => popBubble(other, true), 80 + Math.random() * 120);
			}
		}
	}
}

function tryPop(x, y) {
	// Check from top (smallest z-order) to bottom
	for (let i = bubbles.length - 1; i >= 0; i--) {
		const b = bubbles[i];
		if (!b.alive) continue;
		const dx = b.x - x;
		const dy = b.y - y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		const hitZone = b.r * 1.3; // generous hit zone
		if (dist < hitZone) {
			popBubble(b, false);
			return true;
		}
	}
	return false;
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
			animate();
			break;
		case 'resize':
			w = e.data.width;
			h = e.data.height;
			canvas.width = w;
			canvas.height = h;
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
		case 'click':
			tryPop(e.data.x, e.data.y);
			break;
		case 'touchstart':
			// Multi-touch: try to pop at each finger
			if (e.data.touches) {
				for (const t of e.data.touches) {
					tryPop(t.x, t.y);
				}
			}
			break;
	}
};

function drawBubble(b) {
	if (b.alpha <= 0) return;
	const t = frameCount;

	ctx.save();
	ctx.globalAlpha = b.alpha * 0.85;

	// Iridescent gradient
	const shimmer = Math.sin(t * 0.03 + b.shimmerPhase) * 30;
	const baseHue = (b.hue + shimmer + t * 0.2) % 360;

	const gradient = ctx.createRadialGradient(
		b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.1,
		b.x, b.y, b.r
	);
	gradient.addColorStop(0, `hsla(${baseHue}, 80%, 85%, 0.3)`);
	gradient.addColorStop(0.4, `hsla(${baseHue + 40}, 60%, 70%, 0.15)`);
	gradient.addColorStop(0.8, `hsla(${baseHue + 80}, 50%, 60%, 0.08)`);
	gradient.addColorStop(1, `hsla(${baseHue + 120}, 40%, 50%, 0.02)`);

	ctx.beginPath();
	ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
	ctx.fillStyle = gradient;
	ctx.fill();

	// Outline
	ctx.strokeStyle = `hsla(${baseHue}, 60%, 75%, ${0.25 * b.alpha})`;
	ctx.lineWidth = 1;
	ctx.stroke();

	// Highlight reflection
	ctx.beginPath();
	ctx.ellipse(
		b.x - b.r * 0.25,
		b.y - b.r * 0.3,
		b.r * 0.3,
		b.r * 0.15,
		-0.5,
		0, Math.PI * 2
	);
	ctx.fillStyle = `hsla(0, 0%, 100%, ${0.3 * b.alpha})`;
	ctx.fill();

	// Secondary reflection
	ctx.beginPath();
	ctx.arc(b.x + b.r * 0.15, b.y + b.r * 0.2, b.r * 0.08, 0, Math.PI * 2);
	ctx.fillStyle = `hsla(0, 0%, 100%, ${0.15 * b.alpha})`;
	ctx.fill();

	ctx.restore();
}

function drawPopFx() {
	for (let i = popFx.length - 1; i >= 0; i--) {
		const p = popFx[i];
		p.x += p.vx;
		p.y += p.vy;
		if (!p.isRing) p.vy += 0.03;
		p.alpha -= p.decay;

		if (p.alpha <= 0) {
			popFx.splice(i, 1);
			continue;
		}

		if (p.isRing) {
			p.ringRadius += 2;
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.ringRadius, 0, Math.PI * 2);
			ctx.strokeStyle = `hsla(${p.hue}, 70%, 75%, ${p.alpha})`;
			ctx.lineWidth = 1.5;
			ctx.stroke();
		} else {
			const h = p.iridescent ? (p.hue + frameCount * 3) % 360 : p.hue;
			ctx.fillStyle = `hsla(${h}, 80%, 70%, ${p.alpha})`;
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.size * p.alpha, 0, Math.PI * 2);
			ctx.fill();
		}
	}
}

function animate() {
	if (!ctx) return;
	frameCount++;

	// Background
	ctx.fillStyle = 'rgba(8, 10, 20, 0.12)';
	ctx.fillRect(0, 0, w, h);

	// Spawn bubbles
	if (frameCount % SPAWN_RATE === 0) {
		createBubble();
	}

	// Update bubbles
	for (let i = bubbles.length - 1; i >= 0; i--) {
		const b = bubbles[i];

		if (!b.alive) {
			bubbles.splice(i, 1);
			continue;
		}

		// Fade in
		if (b.alpha < 1) b.alpha = Math.min(1, b.alpha + 0.02);

		// Wobble
		b.x += Math.sin(frameCount * b.wobbleSpeed + b.wobblePhase) * 0.5;
		b.x += b.vx;
		b.y += b.vy;

		// Flee from mouse
		const dx = b.x - mouse.x;
		const dy = b.y - mouse.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist < b.r * 3 && dist > 0) {
			const force = FLEE_STRENGTH * (1 - dist / (b.r * 3));
			b.x += (dx / dist) * force;
			b.y += (dy / dist) * force;
		}

		// Remove if off screen
		if (b.y + b.r < -20 || b.x < -b.r * 2 || b.x > w + b.r * 2) {
			bubbles.splice(i, 1);
			continue;
		}

		drawBubble(b);
	}

	// Pop effects
	drawPopFx();

	// Score display
	if (score > 0) {
		if (scoreAlpha > 0.3) scoreAlpha -= 0.005;
		ctx.save();
		ctx.globalAlpha = scoreAlpha;
		ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
		ctx.font = 'bold 20px sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('\uD83D\uDCAB ' + score, w / 2, 40);
		ctx.textAlign = 'left';
		ctx.restore();
	}

	// Hint text
	if (bubbles.length === 0 && popFx.length === 0 && score === 0) {
		ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
		ctx.font = '14px sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('Wait for bubbles, then pop them! \uD83E\uDEE7', w / 2, h / 2);
		ctx.textAlign = 'left';
	}

	requestAnimationFrame(animate);
}
