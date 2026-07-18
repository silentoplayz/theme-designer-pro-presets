/**
 * Title: Isometric Terrain
 * Description: An isometric grid of diamond-shaped tiles that undulate like rolling
 * hills using sine waves. Height is represented by shade/opacity. Mouse creates a
 * wave disturbance. Uses a subtle monochrome palette.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let time = 0;
let lastTime = 0;
let cols, rows;

const TILE_WIDTH = 40;
const TILE_HEIGHT = 20;
const WAVE_AMPLITUDE = 12;
const WAVE_FREQUENCY = 0.08;
const WAVE_SPEED = 0.8;
const MOUSE_WAVE_RADIUS = 250;
const MOUSE_WAVE_AMP = 18;

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
			recalcGrid();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			recalcGrid();
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};

function recalcGrid() {
	// Extra tiles beyond screen edges to prevent pop-in
	cols = Math.ceil(width / (TILE_WIDTH / 2)) + 4;
	rows = Math.ceil(height / (TILE_HEIGHT / 2)) + 8;
}

/**
 * Convert grid coordinates to isometric screen coordinates.
 * The grid origin is offset so tiles fill the screen.
 */
function gridToIso(gx, gy) {
	const halfW = TILE_WIDTH / 2;
	const halfH = TILE_HEIGHT / 2;
	return {
		x: (gx - gy) * halfW + width / 2,
		y: (gx + gy) * halfH - (rows * halfH) / 2 + height / 2
	};
}

/**
 * Calculate the height offset for a tile at grid position (gx, gy).
 * Combines multiple sine waves for organic terrain, plus mouse disturbance.
 */
function getHeight(gx, gy) {
	// Layered sine waves for natural undulation
	let h = 0;
	h += Math.sin(gx * WAVE_FREQUENCY + time * WAVE_SPEED) * WAVE_AMPLITUDE;
	h += Math.sin(gy * WAVE_FREQUENCY * 1.3 + time * WAVE_SPEED * 0.7) * WAVE_AMPLITUDE * 0.6;
	h += Math.sin((gx + gy) * WAVE_FREQUENCY * 0.5 + time * WAVE_SPEED * 1.2) * WAVE_AMPLITUDE * 0.4;

	// Mouse wave disturbance
	const iso = gridToIso(gx, gy);
	const mouseDist = Math.hypot(iso.x - mouse.x, iso.y - mouse.y);
	if (mouseDist < MOUSE_WAVE_RADIUS) {
		const influence = 1 - mouseDist / MOUSE_WAVE_RADIUS;
		const mouseWave = Math.sin(mouseDist * 0.04 - time * 3) * influence;
		h += mouseWave * MOUSE_WAVE_AMP;
	}

	return h;
}

/** Draw an isometric diamond tile */
function drawTile(cx, cy, heightOffset, brightness) {
	const halfW = TILE_WIDTH / 2;
	const halfH = TILE_HEIGHT / 2;
	const y = cy - heightOffset;

	// Top face of the tile
	ctx.beginPath();
	ctx.moveTo(cx, y - halfH); // top
	ctx.lineTo(cx + halfW, y); // right
	ctx.lineTo(cx, y + halfH); // bottom
	ctx.lineTo(cx - halfW, y); // left
	ctx.closePath();

	// Fill with height-based brightness
	const gray = Math.floor(180 + brightness * 60);
	const alpha = 0.03 + brightness * 0.06;
	ctx.fillStyle = `rgba(${gray}, ${gray}, ${Math.floor(gray * 1.05)}, ${alpha})`;
	ctx.fill();

	// Stroke
	const strokeAlpha = 0.04 + brightness * 0.05;
	ctx.strokeStyle = `rgba(200, 205, 215, ${strokeAlpha})`;
	ctx.lineWidth = 0.6;
	ctx.stroke();
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

		// Track min/max height for normalization
		let minH = Infinity;
		let maxH = -Infinity;

		// Pre-compute heights
		const heights = [];
		for (let gy = 0; gy < rows; gy++) {
			heights[gy] = [];
			for (let gx = 0; gx < cols; gx++) {
				const h = getHeight(gx - cols / 2, gy - rows / 2);
				heights[gy][gx] = h;
				if (h < minH) minH = h;
				if (h > maxH) maxH = h;
			}
		}

		const heightRange = maxH - minH || 1;

		// Draw tiles back to front (painter's algorithm via row order)
		for (let gy = 0; gy < rows; gy++) {
			for (let gx = 0; gx < cols; gx++) {
				const adjustedGx = gx - cols / 2;
				const adjustedGy = gy - rows / 2;
				const iso = gridToIso(adjustedGx, adjustedGy);
				const h = heights[gy][gx];

				// Normalize brightness 0-1
				const brightness = (h - minH) / heightRange;

				// Only draw tiles that are potentially visible
				if (
					iso.x > -TILE_WIDTH &&
					iso.x < width + TILE_WIDTH &&
					iso.y - h > -TILE_HEIGHT * 3 &&
					iso.y - h < height + TILE_HEIGHT * 3
				) {
					drawTile(iso.x, iso.y, h, brightness);
				}
			}
		}

		// Subtle mouse indicator glow
		if (mouse.x > 0 && mouse.y > 0) {
			const gradient = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 100);
			gradient.addColorStop(0, 'rgba(200, 210, 230, 0.03)');
			gradient.addColorStop(1, 'rgba(200, 210, 230, 0)');
			ctx.fillStyle = gradient;
			ctx.fillRect(mouse.x - 100, mouse.y - 100, 200, 200);
		}

		requestAnimationFrame(render);
	}

	requestAnimationFrame(render);
}
