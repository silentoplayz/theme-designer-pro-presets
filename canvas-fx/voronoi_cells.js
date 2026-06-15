/**
 * Title: Voronoi Cells
 * Description: Animated Voronoi diagram where seed points drift slowly. Cell edges
 * are drawn with subtle glowing lines. Mouse acts as an additional seed point.
 * Colors use very subtle edge highlights against a transparent background.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let seeds = [];
let lastTime = 0;

const NUM_SEEDS = 30;
const EDGE_RESOLUTION = 4; // pixel step for edge detection (higher = faster, coarser)

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
			initSeeds();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};

function initSeeds() {
	seeds = [];
	for (let i = 0; i < NUM_SEEDS; i++) {
		seeds.push({
			x: Math.random() * width,
			y: Math.random() * height,
			vx: (Math.random() - 0.5) * 20,
			vy: (Math.random() - 0.5) * 20,
			hue: 200 + Math.random() * 40 // subtle blue range
		});
	}
}

/** Find the index of the closest seed to point (px, py) */
function closestSeed(px, py, allSeeds) {
	let minDist = Infinity;
	let minIdx = 0;
	for (let i = 0; i < allSeeds.length; i++) {
		const dx = px - allSeeds[i].x;
		const dy = py - allSeeds[i].y;
		const d = dx * dx + dy * dy;
		if (d < minDist) {
			minDist = d;
			minIdx = i;
		}
	}
	return minIdx;
}

/**
 * Find Voronoi edges by scanning pixels and detecting where the nearest seed changes.
 * Returns an array of edge pixel positions.
 */
function findEdges(allSeeds) {
	const edges = [];
	const step = EDGE_RESOLUTION;
	const cols = Math.ceil(width / step);
	const rows = Math.ceil(height / step);

	// Build a grid of nearest-seed indices
	const grid = new Int16Array(cols * rows);
	for (let gy = 0; gy < rows; gy++) {
		for (let gx = 0; gx < cols; gx++) {
			const px = gx * step + step / 2;
			const py = gy * step + step / 2;
			grid[gy * cols + gx] = closestSeed(px, py, allSeeds);
		}
	}

	// Detect edges — pixels where neighbor has a different nearest seed
	for (let gy = 0; gy < rows; gy++) {
		for (let gx = 0; gx < cols; gx++) {
			const idx = grid[gy * cols + gx];
			let isEdge = false;

			// Check right neighbor
			if (gx < cols - 1 && grid[gy * cols + gx + 1] !== idx) isEdge = true;
			// Check bottom neighbor
			if (!isEdge && gy < rows - 1 && grid[(gy + 1) * cols + gx] !== idx) isEdge = true;
			// Check diagonal
			if (!isEdge && gx < cols - 1 && gy < rows - 1 && grid[(gy + 1) * cols + gx + 1] !== idx)
				isEdge = true;

			if (isEdge) {
				edges.push({
					x: gx * step + step / 2,
					y: gy * step + step / 2,
					seedIdx: idx
				});
			}
		}
	}

	return edges;
}

function startAnimation() {
	lastTime = performance.now() / 1000;

	function render() {
		if (!ctx) return;

		const now = performance.now() / 1000;
		const dt = Math.min(now - lastTime, 0.05);
		lastTime = now;

		ctx.clearRect(0, 0, width, height);

		// Update seed positions
		for (const seed of seeds) {
			seed.x += seed.vx * dt;
			seed.y += seed.vy * dt;

			// Bounce off edges
			if (seed.x < 0 || seed.x > width) {
				seed.vx *= -1;
				seed.x = Math.max(0, Math.min(width, seed.x));
			}
			if (seed.y < 0 || seed.y > height) {
				seed.vy *= -1;
				seed.y = Math.max(0, Math.min(height, seed.y));
			}
		}

		// Build active seed list (including mouse as extra seed)
		const allSeeds = [...seeds];
		const mouseActive = mouse.x > 0 && mouse.x < width && mouse.y > 0 && mouse.y < height;
		if (mouseActive) {
			allSeeds.push({ x: mouse.x, y: mouse.y, hue: 50 });
		}

		// Find and draw edges
		const edges = findEdges(allSeeds);

		for (const edge of edges) {
			const seed = allSeeds[edge.seedIdx];
			const dist = Math.hypot(edge.x - seed.x, edge.y - seed.y);
			const maxDist = Math.min(width, height) * 0.3;

			// Brightness based on distance from seed (closer to seed center = dimmer edge)
			const brightness = Math.min(1, dist / maxDist);

			// Mouse proximity makes edges brighter
			let mouseGlow = 0;
			if (mouseActive) {
				const md = Math.hypot(edge.x - mouse.x, edge.y - mouse.y);
				if (md < 200) {
					mouseGlow = (1 - md / 200) * 0.15;
				}
			}

			const alpha = 0.06 * brightness + mouseGlow;
			const size = EDGE_RESOLUTION * 0.9;

			ctx.fillStyle = `rgba(160, 200, 255, ${alpha})`;
			ctx.fillRect(edge.x - size / 2, edge.y - size / 2, size, size);
		}

		// Draw subtle seed points
		for (let i = 0; i < allSeeds.length; i++) {
			const seed = allSeeds[i];
			const isMouseSeed = mouseActive && i === allSeeds.length - 1;
			const alpha = isMouseSeed ? 0.2 : 0.08;
			const radius = isMouseSeed ? 3 : 1.5;

			ctx.beginPath();
			ctx.arc(seed.x, seed.y, radius, 0, Math.PI * 2);
			ctx.fillStyle = `rgba(180, 210, 255, ${alpha})`;
			ctx.fill();
		}

		requestAnimationFrame(render);
	}

	requestAnimationFrame(render);
}
