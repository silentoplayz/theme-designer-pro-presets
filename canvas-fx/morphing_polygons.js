/**
 * Title: Morphing Polygons
 * Description: Several large semi-transparent polygons that slowly morph between
 * different shapes (triangle → square → pentagon → hexagon → circle) using vertex
 * interpolation. They drift lazily and overlap with blend effects. Mouse proximity
 * speeds up the morphing.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let polygons = [];
let lastTime = 0;

// Shape definitions — number of vertices for each stage
const SHAPES = [3, 4, 5, 6, 12]; // triangle, square, pentagon, hexagon, ~circle
const MAX_VERTICES = 12; // Normalize all shapes to this vertex count
const NUM_POLYGONS = 6;
const BASE_MORPH_SPEED = 0.08; // Morphs per second
const MOUSE_INFLUENCE = 300;

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
			initPolygons();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			// Reposition polygons within new bounds
			for (const p of polygons) {
				p.x = Math.min(p.x, width);
				p.y = Math.min(p.y, height);
			}
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};

/**
 * Generate normalized vertices for a regular polygon with `sides` vertices,
 * upsampled to MAX_VERTICES points for smooth interpolation.
 */
function generateShape(sides) {
	const points = [];
	for (let i = 0; i < MAX_VERTICES; i++) {
		// Map each of the MAX_VERTICES points to a position on the polygon
		const t = i / MAX_VERTICES;
		const angle = t * Math.PI * 2 - Math.PI / 2;

		// For a regular polygon with `sides`, find the radius at this angle
		const sectorAngle = (Math.PI * 2) / sides;
		const localAngle = ((angle % sectorAngle) + sectorAngle) % sectorAngle;
		const halfSector = sectorAngle / 2;
		const r = Math.cos(halfSector) / Math.cos(localAngle - halfSector);

		points.push({
			x: Math.cos(angle) * r,
			y: Math.sin(angle) * r
		});
	}
	return points;
}

// Pre-generate all shape vertices
const shapeVertices = SHAPES.map((s) => generateShape(s));

function initPolygons() {
	polygons = [];
	const colors = [
		[120, 160, 255],
		[180, 120, 255],
		[100, 220, 200],
		[255, 150, 120],
		[200, 200, 100],
		[150, 180, 220]
	];

	for (let i = 0; i < NUM_POLYGONS; i++) {
		const radius = 80 + Math.random() * 120;
		polygons.push({
			x: Math.random() * width,
			y: Math.random() * height,
			vx: (Math.random() - 0.5) * 15,
			vy: (Math.random() - 0.5) * 15,
			radius,
			rotation: Math.random() * Math.PI * 2,
			rotationSpeed: (Math.random() - 0.5) * 0.15,
			shapeIndex: Math.floor(Math.random() * SHAPES.length),
			morphProgress: 0,
			color: colors[i % colors.length],
			opacity: 0.04 + Math.random() * 0.06
		});
	}
}

function lerp(a, b, t) {
	return a + (b - a) * t;
}

function lerpPoint(a, b, t) {
	return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

// Smooth easing
function easeInOut(t) {
	return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function startAnimation() {
	lastTime = performance.now() / 1000;

	function render() {
		if (!ctx) return;

		const now = performance.now() / 1000;
		const dt = Math.min(now - lastTime, 0.05);
		lastTime = now;

		ctx.clearRect(0, 0, width, height);

		// Use lighter composite for overlapping glow
		ctx.globalCompositeOperation = 'lighter';

		for (const poly of polygons) {
			// Mouse distance for speed boost
			const mouseDist = Math.hypot(poly.x - mouse.x, poly.y - mouse.y);
			const mouseBoost =
				mouseDist < MOUSE_INFLUENCE ? 1 + (1 - mouseDist / MOUSE_INFLUENCE) * 4 : 1;

			// Advance morph
			poly.morphProgress += BASE_MORPH_SPEED * mouseBoost * dt;

			if (poly.morphProgress >= 1) {
				poly.morphProgress -= 1;
				poly.shapeIndex = (poly.shapeIndex + 1) % SHAPES.length;
			}

			// Drift movement
			poly.x += poly.vx * dt;
			poly.y += poly.vy * dt;
			poly.rotation += poly.rotationSpeed * dt;

			// Wrap around edges with padding
			const pad = poly.radius * 1.5;
			if (poly.x < -pad) poly.x = width + pad;
			if (poly.x > width + pad) poly.x = -pad;
			if (poly.y < -pad) poly.y = height + pad;
			if (poly.y > height + pad) poly.y = -pad;

			// Get current and next shape vertices
			const currentShape = shapeVertices[poly.shapeIndex];
			const nextShape = shapeVertices[(poly.shapeIndex + 1) % SHAPES.length];
			const t = easeInOut(poly.morphProgress);

			// Draw interpolated shape
			ctx.save();
			ctx.translate(poly.x, poly.y);
			ctx.rotate(poly.rotation);

			ctx.beginPath();
			for (let i = 0; i < MAX_VERTICES; i++) {
				const pt = lerpPoint(currentShape[i], nextShape[i], t);
				const px = pt.x * poly.radius;
				const py = pt.y * poly.radius;
				if (i === 0) ctx.moveTo(px, py);
				else ctx.lineTo(px, py);
			}
			ctx.closePath();

			// Fill
			const [r, g, b] = poly.color;
			ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${poly.opacity})`;
			ctx.fill();

			// Stroke
			ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${poly.opacity * 2.5})`;
			ctx.lineWidth = 1.2;
			ctx.stroke();

			ctx.restore();
		}

		// Reset composite
		ctx.globalCompositeOperation = 'source-over';

		requestAnimationFrame(render);
	}

	requestAnimationFrame(render);
}
