/**
 * Title: Plasma Field
 * Description: Classic plasma effect using overlapping sine functions to create
 *   flowing, colorful plasma patterns. Rich but subtle color palette that slowly
 *   evolves. Mouse position warps the plasma field locally.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let time = 0;
let imageData;

const PIXEL_STEP = 2; // render every Nth pixel for performance
const TIME_SPEED = 0.008;
const MOUSE_WARP_RADIUS = 200;
const MOUSE_WARP_STRENGTH = 40;

// Heartbeat to keep worker alive
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

// Precompute a color palette for the plasma
const PALETTE_SIZE = 256;
const palette = new Array(PALETTE_SIZE);

function buildPalette() {
	for (let i = 0; i < PALETTE_SIZE; i++) {
		const t = i / PALETTE_SIZE;

		// Multi-layered sine color generation for rich, evolving hues
		const r = Math.floor(
			128 + 64 * Math.sin(Math.PI * 2 * t * 1.0 + 0.0) + 32 * Math.sin(Math.PI * 2 * t * 2.5 + 1.2)
		);
		const g = Math.floor(
			80 + 50 * Math.sin(Math.PI * 2 * t * 1.3 + 2.0) + 30 * Math.sin(Math.PI * 2 * t * 3.0 + 0.8)
		);
		const b = Math.floor(
			140 + 80 * Math.sin(Math.PI * 2 * t * 0.8 + 4.0) + 40 * Math.sin(Math.PI * 2 * t * 1.8 + 2.5)
		);

		palette[i] = {
			r: Math.max(0, Math.min(255, r)),
			g: Math.max(0, Math.min(255, g)),
			b: Math.max(0, Math.min(255, b))
		};
	}
}

// Precompute sine lookup table for performance
const SIN_TABLE_SIZE = 4096;
const sinTable = new Float32Array(SIN_TABLE_SIZE);
function buildSinTable() {
	for (let i = 0; i < SIN_TABLE_SIZE; i++) {
		sinTable[i] = Math.sin((i / SIN_TABLE_SIZE) * Math.PI * 2);
	}
}

function fastSin(x) {
	// Normalize to [0, SIN_TABLE_SIZE)
	const idx = ((x % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
	return sinTable[Math.floor((idx / (Math.PI * 2)) * SIN_TABLE_SIZE) % SIN_TABLE_SIZE];
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
			buildPalette();
			buildSinTable();
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

function startAnimation() {
	function render() {
		if (!ctx) return;

		time += TIME_SPEED;
		imageData = ctx.createImageData(width, height);
		const data = imageData.data;

		const cx = width * 0.5;
		const cy = height * 0.5;
		const hasMouse = mouse.x > 0 && mouse.y > 0;

		for (let y = 0; y < height; y += PIXEL_STEP) {
			for (let x = 0; x < width; x += PIXEL_STEP) {
				// Normalized coordinates
				let px = x;
				let py = y;

				// Mouse warp — distort coordinates near mouse
				if (hasMouse) {
					const mdx = x - mouse.x;
					const mdy = y - mouse.y;
					const mDist = Math.sqrt(mdx * mdx + mdy * mdy);
					if (mDist < MOUSE_WARP_RADIUS && mDist > 1) {
						const warpFactor = 1 - mDist / MOUSE_WARP_RADIUS;
						const warpAmount = warpFactor * warpFactor * MOUSE_WARP_STRENGTH;
						px += fastSin(mdy * 0.05 + time * 3) * warpAmount;
						py += fastSin(mdx * 0.05 + time * 3) * warpAmount;
					}
				}

				// Classic plasma: sum of several sine functions
				const scale = 0.01;
				const sx = px * scale;
				const sy = py * scale;

				// Layer 1: horizontal waves
				let v = fastSin(sx * 10 + time);

				// Layer 2: vertical waves
				v += fastSin(sy * 8 + time * 1.3);

				// Layer 3: diagonal waves
				v += fastSin((sx + sy) * 6 + time * 0.7);

				// Layer 4: circular ripple from center
				const dx = px - cx;
				const dy = py - cy;
				const dist = Math.sqrt(dx * dx + dy * dy) * scale;
				v += fastSin(dist * 8 - time * 2);

				// Layer 5: secondary circular ripple (offset)
				const dx2 = px - cx * 0.6;
				const dy2 = py - cy * 1.3;
				const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) * scale;
				v += fastSin(dist2 * 6 + time * 1.5);

				// Layer 6: complex interference
				v += fastSin(sx * 4 * fastSin(time * 0.5) + sy * 5 * fastSin(time * 0.3));

				// Normalize v from [-6, 6] to [0, 1]
				v = (v + 6) / 12;

				// Shift palette over time for evolving colors
				const paletteIdx =
					Math.floor(((((v + time * 0.1) % 1) + 1) % 1) * PALETTE_SIZE) % PALETTE_SIZE;
				const color = palette[paletteIdx];

				// Apply subtle alpha
				const alpha = 50 + Math.floor(v * 40);

				// Fill the pixel block
				for (let dy2 = 0; dy2 < PIXEL_STEP && y + dy2 < height; dy2++) {
					for (let dx2 = 0; dx2 < PIXEL_STEP && x + dx2 < width; dx2++) {
						const idx = ((y + dy2) * width + (x + dx2)) * 4;
						data[idx] = color.r;
						data[idx + 1] = color.g;
						data[idx + 2] = color.b;
						data[idx + 3] = alpha;
					}
				}
			}
		}

		ctx.putImageData(imageData, 0, 0);
		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}
