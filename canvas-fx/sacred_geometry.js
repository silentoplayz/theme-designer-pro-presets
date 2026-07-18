/**
 * Title: Sacred Geometry
 * Description: Slowly rotating, nested geometric shapes — circles inscribed in
 * squares, inscribed in circles, etc. Uses the golden ratio for sizing. Thin lines
 * with low opacity in white/gold tones. Mouse position shifts the rotation center.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let time = 0;
let lastTime = 0;
let centerX, centerY, baseRadius;

const PHI = (1 + Math.sqrt(5)) / 2; // Golden ratio ≈ 1.618
const LAYERS = 8;
const ROTATION_SPEED = 0.06; // radians per second base

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
			recalcCenter();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			recalcCenter();
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};

function recalcCenter() {
	centerX = width / 2;
	centerY = height / 2;
	baseRadius = Math.min(width, height) * 0.38;
}

/** Draw a regular polygon inscribed in a circle of given radius */
function drawPolygon(cx, cy, radius, sides, rotation) {
	ctx.beginPath();
	for (let i = 0; i <= sides; i++) {
		const angle = ((Math.PI * 2) / sides) * i + rotation;
		const px = cx + radius * Math.cos(angle);
		const py = cy + radius * Math.sin(angle);
		if (i === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	}
	ctx.stroke();
}

/** Draw a circle */
function drawCircle(cx, cy, radius) {
	ctx.beginPath();
	ctx.arc(cx, cy, radius, 0, Math.PI * 2);
	ctx.stroke();
}

/** Draw the Flower of Life pattern (6 circles around center) */
function drawFlowerOfLife(cx, cy, radius, rotation) {
	drawCircle(cx, cy, radius);
	for (let i = 0; i < 6; i++) {
		const angle = (Math.PI / 3) * i + rotation;
		const px = cx + radius * Math.cos(angle);
		const py = cy + radius * Math.sin(angle);
		drawCircle(px, py, radius);
	}
}

/** Draw a Vesica Piscis (two overlapping circles) */
function drawVesicaPiscis(cx, cy, radius, rotation) {
	const offset = radius / 2;
	const dx = Math.cos(rotation) * offset;
	const dy = Math.sin(rotation) * offset;
	drawCircle(cx - dx, cy - dy, radius);
	drawCircle(cx + dx, cy + dy, radius);
}

function startAnimation() {
	lastTime = performance.now() / 1000;

	function render() {
		if (!ctx) return;

		const now = performance.now() / 1000;
		const dt = Math.min(now - lastTime, 0.05);
		lastTime = now;
		time += dt;

		ctx.clearRect(0, 0, width, height);

		// Mouse influence on center — gentle offset
		let drawCX = centerX;
		let drawCY = centerY;
		if (mouse.x > 0 && mouse.y > 0) {
			const maxOffset = 60;
			const dx = (mouse.x - centerX) / width;
			const dy = (mouse.y - centerY) / height;
			drawCX += dx * maxOffset;
			drawCY += dy * maxOffset;
		}

		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';

		// Draw nested layers from outside in, alternating shapes
		for (let i = 0; i < LAYERS; i++) {
			const factor = Math.pow(1 / PHI, i);
			const radius = baseRadius * factor;
			const rotation = time * ROTATION_SPEED * (i % 2 === 0 ? 1 : -1) * (1 + i * 0.3);

			// Breathing pulse
			const breathe = 1 + Math.sin(time * 0.5 + i * 0.7) * 0.02;
			const r = radius * breathe;

			// Alpha fades toward inner layers slightly
			const alpha = 0.08 + (1 - i / LAYERS) * 0.06;

			// Alternate between white and gold tones
			const isGold = i % 3 === 1;
			if (isGold) {
				ctx.strokeStyle = `rgba(220, 190, 120, ${alpha})`;
			} else {
				ctx.strokeStyle = `rgba(220, 225, 235, ${alpha})`;
			}
			ctx.lineWidth = 0.8;

			// Alternate shape types for visual variety
			const shapeType = i % 5;
			switch (shapeType) {
				case 0: // Circle
					drawCircle(drawCX, drawCY, r);
					break;
				case 1: // Square (4-gon)
					drawPolygon(drawCX, drawCY, r, 4, rotation);
					break;
				case 2: // Circle
					drawCircle(drawCX, drawCY, r);
					break;
				case 3: // Hexagon
					drawPolygon(drawCX, drawCY, r, 6, rotation);
					break;
				case 4: // Triangle
					drawPolygon(drawCX, drawCY, r, 3, rotation);
					break;
			}

			// Draw inscribed connecting lines for some layers
			if (i < LAYERS - 1 && i % 2 === 0) {
				const sides = [3, 4, 6][i % 3];
				ctx.strokeStyle = `rgba(200, 200, 220, ${alpha * 0.4})`;
				ctx.lineWidth = 0.4;
				drawPolygon(drawCX, drawCY, r * 0.85, sides, rotation + Math.PI / sides);
			}
		}

		// Flower of Life in the center
		const flowerRadius = baseRadius * Math.pow(1 / PHI, 4);
		ctx.strokeStyle = 'rgba(220, 190, 120, 0.05)';
		ctx.lineWidth = 0.5;
		drawFlowerOfLife(drawCX, drawCY, flowerRadius, time * 0.03);

		// Outer Vesica Piscis
		ctx.strokeStyle = 'rgba(220, 225, 235, 0.04)';
		ctx.lineWidth = 0.6;
		drawVesicaPiscis(drawCX, drawCY, baseRadius * 0.6, time * 0.02);

		// Radial guide lines (very subtle)
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
		ctx.lineWidth = 0.3;
		for (let i = 0; i < 12; i++) {
			const angle = (Math.PI / 6) * i + time * 0.01;
			ctx.beginPath();
			ctx.moveTo(drawCX, drawCY);
			ctx.lineTo(
				drawCX + Math.cos(angle) * baseRadius * 1.1,
				drawCY + Math.sin(angle) * baseRadius * 1.1
			);
			ctx.stroke();
		}

		// Center dot
		ctx.fillStyle = 'rgba(220, 200, 150, 0.12)';
		ctx.beginPath();
		ctx.arc(drawCX, drawCY, 2.5, 0, Math.PI * 2);
		ctx.fill();

		requestAnimationFrame(render);
	}

	requestAnimationFrame(render);
}
