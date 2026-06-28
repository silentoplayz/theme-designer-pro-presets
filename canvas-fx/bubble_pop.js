/**
 * Title: Bubble Pop
 * Description: Colorful translucent bubbles float upward, wobbling gently.
 *   Move your mouse near them and they POP into a shower of tiny sparkle
 *   fragments! New bubbles continuously rise from the bottom. Each bubble
 *   has a shiny highlight and rainbow-tinted surface. Super satisfying
 *   and interactive — perfect for kids who love to "pop" things.
 */

/* ---------- CONFIGURABLE VARIABLES ---------- */
const MAX_BUBBLES       = 45;      // max bubbles on screen
const BUBBLE_SIZE_MIN   = 18;      // minimum bubble radius
const BUBBLE_SIZE_MAX   = 50;      // maximum bubble radius
const RISE_SPEED_MIN    = 0.3;     // minimum upward speed
const RISE_SPEED_MAX    = 1.2;     // maximum upward speed
const WOBBLE_AMOUNT     = 0.6;     // horizontal wobble strength
const POP_RADIUS        = 80;      // mouse proximity to pop a bubble (pixels)
const FRAGMENT_COUNT    = 12;      // sparkle fragments per pop
const FRAGMENT_LIFETIME = 40;      // frames fragments live
const SPAWN_INTERVAL    = 20;      // frames between new bubbles
/* --------------------------------------------- */

let canvas, ctx, w, h;
let bubbles = [];
let fragments = [];
let mouse = { x: -9999, y: -9999 };
let time = 0;
let spawnTimer = 0;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

class Bubble {
	constructor() {
		this.radius = BUBBLE_SIZE_MIN + Math.random() * (BUBBLE_SIZE_MAX - BUBBLE_SIZE_MIN);
		this.x = this.radius + Math.random() * ((w || 800) - this.radius * 2);
		this.y = (h || 600) + this.radius + Math.random() * 100;
		this.speed = RISE_SPEED_MIN + Math.random() * (RISE_SPEED_MAX - RISE_SPEED_MIN);
		this.wobblePhase = Math.random() * Math.PI * 2;
		this.wobbleFreq = 0.015 + Math.random() * 0.02;
		this.hue = Math.random() * 360;
		this.popScale = 1;
		this.alive = true;
	}

	update() {
		this.y -= this.speed;
		this.wobblePhase += this.wobbleFreq;
		this.x += Math.sin(this.wobblePhase) * WOBBLE_AMOUNT;

		// Check mouse proximity for pop
		const dx = mouse.x - this.x;
		const dy = mouse.y - this.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist < POP_RADIUS + this.radius * 0.5) {
			this.pop();
			return false;
		}

		// Off screen
		if (this.y < -this.radius * 2) return false;

		return true;
	}

	pop() {
		// Create sparkle fragments
		for (let i = 0; i < FRAGMENT_COUNT; i++) {
			const angle = (i / FRAGMENT_COUNT) * Math.PI * 2 + Math.random() * 0.5;
			const speed = 2 + Math.random() * 4;
			fragments.push({
				x: this.x,
				y: this.y,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed - 1,
				size: 2 + Math.random() * 4,
				hue: this.hue + (Math.random() - 0.5) * 60,
				life: FRAGMENT_LIFETIME,
				maxLife: FRAGMENT_LIFETIME
			});
		}
	}

	draw(ctx) {
		const r = this.radius;
		const x = this.x;
		const y = this.y;

		// Main bubble body (translucent)
		const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
		grad.addColorStop(0, `hsla(${this.hue}, 80%, 85%, 0.25)`);
		grad.addColorStop(0.5, `hsla(${this.hue}, 70%, 70%, 0.15)`);
		grad.addColorStop(0.85, `hsla(${this.hue}, 60%, 60%, 0.12)`);
		grad.addColorStop(1, `hsla(${this.hue}, 50%, 50%, 0.08)`);

		ctx.beginPath();
		ctx.arc(x, y, r, 0, Math.PI * 2);
		ctx.fillStyle = grad;
		ctx.fill();

		// Rim/edge highlight
		ctx.beginPath();
		ctx.arc(x, y, r, 0, Math.PI * 2);
		ctx.strokeStyle = `hsla(${this.hue}, 80%, 80%, 0.25)`;
		ctx.lineWidth = 1.5;
		ctx.stroke();

		// Shine highlight (top-left)
		const shineGrad = ctx.createRadialGradient(
			x - r * 0.35, y - r * 0.35, r * 0.05,
			x - r * 0.2, y - r * 0.2, r * 0.45
		);
		shineGrad.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
		shineGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
		ctx.beginPath();
		ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.45, 0, Math.PI * 2);
		ctx.fillStyle = shineGrad;
		ctx.fill();

		// Small secondary shine
		ctx.beginPath();
		ctx.arc(x + r * 0.3, y + r * 0.2, r * 0.1, 0, Math.PI * 2);
		ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
		ctx.fill();
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
			// Seed some initial bubbles
			for (let i = 0; i < 15; i++) {
				const b = new Bubble();
				b.y = Math.random() * h;
				bubbles.push(b);
			}
			startAnimation();
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
	}
};

function startAnimation() {
	function render() {
		if (!ctx) return;
		time++;

		// Clear with slight transparency for a dreamy trail on fragments
		ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
		ctx.fillRect(0, 0, w, h);

		// Spawn new bubbles
		spawnTimer++;
		if (spawnTimer >= SPAWN_INTERVAL && bubbles.length < MAX_BUBBLES) {
			spawnTimer = 0;
			bubbles.push(new Bubble());
		}

		// Update and draw bubbles
		bubbles = bubbles.filter(b => b.update());
		for (const b of bubbles) {
			b.draw(ctx);
		}

		// Update and draw fragments
		fragments = fragments.filter(f => {
			f.life--;
			f.vy += 0.12; // gravity
			f.vx *= 0.97;
			f.x += f.vx;
			f.y += f.vy;
			return f.life > 0;
		});

		for (const f of fragments) {
			const progress = 1 - f.life / f.maxLife;
			const alpha = 1 - progress;
			const size = f.size * (1 - progress * 0.5);

			ctx.save();
			ctx.translate(f.x, f.y);
			ctx.rotate(progress * Math.PI * 3);

			// Glowing fragment
			ctx.shadowColor = `hsl(${f.hue}, 100%, 70%)`;
			ctx.shadowBlur = size * 2;
			ctx.fillStyle = `hsla(${f.hue}, 100%, 75%, ${alpha})`;
			ctx.fillRect(-size / 2, -size / 2, size, size);

			ctx.shadowBlur = 0;
			ctx.restore();
		}

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}
