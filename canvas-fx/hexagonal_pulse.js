/**
 * Title: Hexagonal Pulse
 * Description: A grid of hexagons that pulse with a ripple effect emanating from
 * the mouse position. Each hex glows with a subtle accent color that fades with
 * distance from the ripple origin. Clean, geometric feel.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };

// Hex grid config
const HEX_RADIUS = 28;
const HEX_GAP = 4;
const RIPPLE_SPEED = 180; // pixels per second
const RIPPLE_LIFETIME = 3.0; // seconds
const MAX_RIPPLES = 5;

let hexagons = [];
let ripples = [];
let lastTime = 0;
let lastClickTime = 0;

// Keep worker alive
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

self.onmessage = (e) => {
	switch (e.data.type) {
		case 'init':
			canvas = e.data.canvas;
			ctx = canvas.getContext('2d');
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			buildGrid();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			buildGrid();
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			// Spawn ripples on movement (throttled)
			const now = performance.now() / 1000;
			if (now - lastClickTime > 0.6) {
				lastClickTime = now;
				ripples.push({ x: mouse.x, y: mouse.y, time: now, radius: 0 });
				if (ripples.length > MAX_RIPPLES) ripples.shift();
			}
			break;
	}
};

function buildGrid() {
	hexagons = [];
	const hexW = (HEX_RADIUS + HEX_GAP) * Math.sqrt(3);
	const hexH = (HEX_RADIUS + HEX_GAP) * 1.5;
	const cols = Math.ceil(width / hexW) + 2;
	const rows = Math.ceil(height / hexH) + 2;

	for (let row = -1; row < rows; row++) {
		for (let col = -1; col < cols; col++) {
			const offsetX = (row % 2) * (hexW / 2);
			hexagons.push({
				x: col * hexW + offsetX,
				y: row * hexH,
				pulse: 0
			});
		}
	}
}

function hexPath(cx, cy, r) {
	ctx.beginPath();
	for (let i = 0; i < 6; i++) {
		const angle = (Math.PI / 3) * i - Math.PI / 6;
		const px = cx + r * Math.cos(angle);
		const py = cy + r * Math.sin(angle);
		if (i === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	}
	ctx.closePath();
}

function startAnimation() {
	lastTime = performance.now() / 1000;

	function render() {
		if (!ctx) return;

		const now = performance.now() / 1000;
		const dt = Math.min(now - lastTime, 0.05);
		lastTime = now;

		ctx.clearRect(0, 0, width, height);

		// Update ripples
		for (let i = ripples.length - 1; i >= 0; i--) {
			const r = ripples[i];
			r.radius += RIPPLE_SPEED * dt;
			if (now - r.time > RIPPLE_LIFETIME) {
				ripples.splice(i, 1);
			}
		}

		// Calculate mouse distance influence for ambient glow
		const mouseInfluenceRadius = 250;

		for (let i = 0; i < hexagons.length; i++) {
			const hex = hexagons[i];
			let pulseIntensity = 0;

			// Ripple influence
			for (let j = 0; j < ripples.length; j++) {
				const rip = ripples[j];
				const dist = Math.hypot(hex.x - rip.x, hex.y - rip.y);
				const rippleAge = now - rip.time;
				const rippleFront = rip.radius;
				const ringWidth = 80;
				const distFromFront = Math.abs(dist - rippleFront);

				if (distFromFront < ringWidth) {
					const ringFade = 1 - distFromFront / ringWidth;
					const ageFade = 1 - rippleAge / RIPPLE_LIFETIME;
					pulseIntensity = Math.max(pulseIntensity, ringFade * ageFade);
				}
			}

			// Ambient mouse proximity glow
			const mouseDist = Math.hypot(hex.x - mouse.x, hex.y - mouse.y);
			if (mouseDist < mouseInfluenceRadius) {
				const proximity = 1 - mouseDist / mouseInfluenceRadius;
				pulseIntensity = Math.max(pulseIntensity, proximity * 0.3);
			}

			// Smooth the pulse
			hex.pulse += (pulseIntensity - hex.pulse) * 0.15;

			// Draw hexagon
			const scale = 1 + hex.pulse * 0.12;
			const drawRadius = HEX_RADIUS * scale;

			// Base hex outline
			const baseAlpha = 0.06 + hex.pulse * 0.25;
			hexPath(hex.x, hex.y, drawRadius);
			ctx.strokeStyle = `rgba(255, 255, 255, ${baseAlpha})`;
			ctx.lineWidth = 1;
			ctx.stroke();

			// Pulse fill with accent color (subtle cyan-blue)
			if (hex.pulse > 0.01) {
				hexPath(hex.x, hex.y, drawRadius);
				const fillAlpha = hex.pulse * 0.1;
				ctx.fillStyle = `rgba(100, 180, 255, ${fillAlpha})`;
				ctx.fill();

				// Inner glow ring
				hexPath(hex.x, hex.y, drawRadius * 0.7);
				ctx.strokeStyle = `rgba(140, 200, 255, ${hex.pulse * 0.15})`;
				ctx.lineWidth = 0.5;
				ctx.stroke();
			}
		}

		requestAnimationFrame(render);
	}

	requestAnimationFrame(render);
}
