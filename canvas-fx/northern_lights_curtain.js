/**
 * Title: Northern Lights Curtain
 * Description: Vertical curtains of shimmering aurora light that sway horizontally.
 *   Layered vertical bands with colors shifting between green, cyan, and magenta.
 *   They shimmer with varying brightness. Mouse position pushes curtains aside.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let time = 0;
let curtains = [];
let shimmerPoints = [];

const NUM_CURTAINS = 8;
const SHIMMER_POINTS = 25;

// Keep worker alive
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

class AuroraCurtain {
	constructor(index, total) {
		this.index = index;
		this.total = total;
		// Base X position spread across the screen
		this.baseX = 0;
		this.recalc();
		// Sway parameters
		this.swayPhase = Math.random() * Math.PI * 2;
		this.swaySpeed = 0.003 + Math.random() * 0.004;
		this.swayAmplitude = 30 + Math.random() * 50;
		// Secondary sway for organic movement
		this.sway2Phase = Math.random() * Math.PI * 2;
		this.sway2Speed = 0.007 + Math.random() * 0.005;
		this.sway2Amplitude = 10 + Math.random() * 20;
		// Color cycling
		this.colorPhase = (index / total) * Math.PI * 2;
		this.colorSpeed = 0.002 + Math.random() * 0.003;
		// Brightness
		this.baseBrightness = 0.06 + Math.random() * 0.06;
		this.brightness = this.baseBrightness;
		this.brightTarget = this.baseBrightness;
		this.shimmerTimer = Math.random() * 200;
		// Width of this curtain band
		this.bandWidth = 40 + Math.random() * 60;
		// Vertical extent — most curtains don't reach the bottom
		this.topY = 0;
		this.bottomFraction = 0.4 + Math.random() * 0.45; // extends 40-85% down
		// Number of control points for the curtain shape
		this.numPoints = 12 + Math.floor(Math.random() * 6);
	}

	recalc() {
		const spacing = (width || 800) / (this.total + 1);
		this.baseX = spacing * (this.index + 1);
	}

	getSwayOffset(y, t) {
		// Sway increases toward the bottom (curtain drapes from top)
		const yFactor = y / (height || 600);
		const sway1 = Math.sin(t * this.swaySpeed + this.swayPhase + y * 0.003) * this.swayAmplitude;
		const sway2 = Math.sin(t * this.sway2Speed + this.sway2Phase + y * 0.005) * this.sway2Amplitude;
		return (sway1 + sway2) * yFactor;
	}

	getMousePush(x, y) {
		const dx = x - mouse.x;
		const dy = y - mouse.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		const pushRadius = 200;
		if (dist < pushRadius && dist > 0) {
			const strength = 1 - dist / pushRadius;
			return (dx / dist) * strength * strength * 80;
		}
		return 0;
	}

	update(t) {
		// Shimmer — occasional brightness pulse
		this.shimmerTimer++;
		if (this.shimmerTimer > 100 + Math.random() * 200) {
			this.shimmerTimer = 0;
			this.brightTarget = this.baseBrightness + 0.04 + Math.random() * 0.08;
		}
		this.brightness += (this.brightTarget - this.brightness) * 0.02;
		this.brightTarget += (this.baseBrightness - this.brightTarget) * 0.005;
	}

	draw(ctx, t) {
		const bottomY = height * this.bottomFraction;
		const step = bottomY / this.numPoints;

		// Aurora colors: cycle between green (120), cyan (180), magenta (300)
		const colorT = t * this.colorSpeed + this.colorPhase;
		// Use sine to smoothly cycle through 3 hue anchors
		const hueBase = this.getAuroraHue(colorT);

		// Build left and right edges of the curtain
		const leftPoints = [];
		const rightPoints = [];

		for (let i = 0; i <= this.numPoints; i++) {
			const y = this.topY + i * step;
			const sway = this.getSwayOffset(y, t);
			const push = this.getMousePush(this.baseX + sway, y);
			const x = this.baseX + sway + push;

			// Width varies along height for organic shape
			const widthMod = 0.6 + 0.4 * Math.sin(i * 0.8 + t * 0.005);
			const halfW = (this.bandWidth * widthMod) / 2;

			leftPoints.push({ x: x - halfW, y });
			rightPoints.push({ x: x + halfW, y });
		}

		// Draw curtain as a filled shape with gradient
		ctx.beginPath();
		// Left edge (top to bottom)
		ctx.moveTo(leftPoints[0].x, leftPoints[0].y);
		for (let i = 1; i < leftPoints.length; i++) {
			const prev = leftPoints[i - 1];
			const curr = leftPoints[i];
			const cpx = (prev.x + curr.x) / 2;
			const cpy = (prev.y + curr.y) / 2;
			ctx.quadraticCurveTo(prev.x, prev.y, cpx, cpy);
		}
		ctx.lineTo(leftPoints[leftPoints.length - 1].x, leftPoints[leftPoints.length - 1].y);

		// Right edge (bottom to top)
		for (let i = rightPoints.length - 1; i >= 0; i--) {
			const curr = rightPoints[i];
			const next = i > 0 ? rightPoints[i - 1] : rightPoints[0];
			const cpx = (curr.x + next.x) / 2;
			const cpy = (curr.y + next.y) / 2;
			ctx.quadraticCurveTo(curr.x, curr.y, cpx, cpy);
		}
		ctx.closePath();

		// Vertical gradient — bright at top, fading out at bottom
		const midX = this.baseX + this.getSwayOffset(bottomY / 2, t);
		const grad = ctx.createLinearGradient(midX, this.topY, midX, bottomY);
		const alpha = this.brightness;
		const hue1 = hueBase;
		const hue2 = hueBase + 30;
		grad.addColorStop(0, `hsla(${hue1}, 80%, 65%, ${alpha * 1.2})`);
		grad.addColorStop(0.3, `hsla(${hue1}, 70%, 55%, ${alpha})`);
		grad.addColorStop(0.6, `hsla(${hue2}, 60%, 45%, ${alpha * 0.6})`);
		grad.addColorStop(1, `hsla(${hue2}, 50%, 35%, 0)`);

		ctx.fillStyle = grad;
		ctx.fill();

		// Inner glow line for shimmer
		ctx.beginPath();
		for (let i = 0; i <= this.numPoints; i++) {
			const y = this.topY + i * step;
			const sway = this.getSwayOffset(y, t);
			const push = this.getMousePush(this.baseX + sway, y);
			const x = this.baseX + sway + push;
			if (i === 0) {
				ctx.moveTo(x, y);
			} else {
				const prevY = this.topY + (i - 1) * step;
				const prevSway = this.getSwayOffset(prevY, t);
				const prevPush = this.getMousePush(this.baseX + prevSway, prevY);
				const prevX = this.baseX + prevSway + prevPush;
				ctx.quadraticCurveTo(prevX, prevY, (prevX + x) / 2, (prevY + y) / 2);
			}
		}
		ctx.strokeStyle = `hsla(${hue1}, 90%, 75%, ${alpha * 0.5})`;
		ctx.lineWidth = 1.5;
		ctx.stroke();
	}

	getAuroraHue(t) {
		// Cycle between green (120), cyan (180), magenta (300)
		const hues = [120, 180, 300, 120];
		const idx = ((t % (Math.PI * 2)) / (Math.PI * 2)) * 3;
		const i = Math.floor(idx) % 3;
		const frac = idx - Math.floor(idx);
		return hues[i] + (hues[i + 1] - hues[i]) * frac;
	}
}

class ShimmerPoint {
	constructor() {
		this.reset();
	}

	reset() {
		this.x = Math.random() * (width || 800);
		this.y = Math.random() * (height || 600) * 0.6;
		this.radius = 1 + Math.random() * 2;
		this.opacity = 0;
		this.maxOpacity = 0.05 + Math.random() * 0.1;
		this.fadeIn = true;
		this.speed = 0.002 + Math.random() * 0.004;
	}

	update() {
		if (this.fadeIn) {
			this.opacity += this.speed;
			if (this.opacity >= this.maxOpacity) {
				this.fadeIn = false;
			}
		} else {
			this.opacity -= this.speed;
			if (this.opacity <= 0) {
				this.reset();
			}
		}
	}

	draw(ctx) {
		if (this.opacity <= 0) return;
		const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius * 4);
		grad.addColorStop(0, `rgba(200, 255, 220, ${this.opacity})`);
		grad.addColorStop(1, 'rgba(200, 255, 220, 0)');
		ctx.beginPath();
		ctx.arc(this.x, this.y, this.radius * 4, 0, Math.PI * 2);
		ctx.fillStyle = grad;
		ctx.fill();
	}
}

function initCurtains() {
	curtains = [];
	for (let i = 0; i < NUM_CURTAINS; i++) {
		curtains.push(new AuroraCurtain(i, NUM_CURTAINS));
	}
	shimmerPoints = [];
	for (let i = 0; i < SHIMMER_POINTS; i++) {
		shimmerPoints.push(new ShimmerPoint());
	}
}

self.onmessage = (e) => {
	switch (e.data.type) {
		case 'init':
			canvas = e.data.canvas;
			ctx = canvas.getContext('2d');
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initCurtains();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			for (const c of curtains) {
				c.recalc();
			}
			shimmerPoints.forEach((s) => s.reset());
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
		ctx.clearRect(0, 0, width, height);

		time++;

		// Draw curtains
		for (const curtain of curtains) {
			curtain.update(time);
			curtain.draw(ctx, time);
		}

		// Draw shimmer points (star-like sparkles in the aurora)
		for (const sp of shimmerPoints) {
			sp.update();
			sp.draw(ctx);
		}

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}
