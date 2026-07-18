/**
 * Title: Wave Interference
 * Description: Multiple circular wave sources creating beautiful constructive
 *   and destructive interference patterns. Waves emanate from fixed points and
 *   the mouse position. Subtle monochrome/blue tones.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let time = 0;
let sources = [];
let imageData;

const NUM_FIXED_SOURCES = 4;
const WAVE_SPEED = 0.04;
const WAVELENGTH = 30;
const PIXEL_STEP = 3; // render every Nth pixel for performance
const DECAY = 0.003; // wave amplitude decay with distance

// Heartbeat to keep worker alive
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

class WaveSource {
	constructor(x, y, frequency, amplitude, phase) {
		this.x = x;
		this.y = y;
		this.frequency = frequency;
		this.amplitude = amplitude;
		this.phase = phase;
		this.isFixed = true;
	}
}

function initSources() {
	sources = [];
	// Place fixed sources at interesting positions
	const positions = [
		{ x: width * 0.2, y: height * 0.3 },
		{ x: width * 0.8, y: height * 0.25 },
		{ x: width * 0.3, y: height * 0.75 },
		{ x: width * 0.75, y: height * 0.7 }
	];

	for (let i = 0; i < NUM_FIXED_SOURCES; i++) {
		const pos = positions[i] || {
			x: Math.random() * width,
			y: Math.random() * height
		};
		sources.push(
			new WaveSource(
				pos.x,
				pos.y,
				0.8 + Math.random() * 0.4, // slight frequency variation
				1.0,
				Math.random() * Math.PI * 2
			)
		);
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
			initSources();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initSources();
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

		time += WAVE_SPEED;
		imageData = ctx.createImageData(width, height);
		const data = imageData.data;

		// Build active source list (fixed + mouse)
		const activeSources = [...sources];
		if (mouse.x > 0 && mouse.y > 0) {
			activeSources.push(new WaveSource(mouse.x, mouse.y, 1.2, 1.5, 0));
		}

		// Calculate wave interference at each pixel
		for (let y = 0; y < height; y += PIXEL_STEP) {
			for (let x = 0; x < width; x += PIXEL_STEP) {
				let totalAmplitude = 0;

				for (const source of activeSources) {
					const dx = x - source.x;
					const dy = y - source.y;
					const dist = Math.sqrt(dx * dx + dy * dy);

					// Wave equation: A * sin(k*r - ω*t + φ) / (1 + decay*r)
					const k = (2 * Math.PI) / WAVELENGTH;
					const wave =
						(source.amplitude * Math.sin(k * dist * source.frequency - time + source.phase)) /
						(1 + DECAY * dist);

					totalAmplitude += wave;
				}

				// Map amplitude to color — blue/cyan monochrome palette
				// Normalize roughly to [-1, 1] range
				const normalized = totalAmplitude / activeSources.length;

				// Color mapping: constructive → bright blue, destructive → dark
				const brightness = (normalized + 1) * 0.5; // 0 to 1
				const b1 = brightness * brightness; // enhance contrast

				// Subtle blue-cyan palette
				const r = Math.floor(b1 * 30);
				const g = Math.floor(b1 * 80 + brightness * 20);
				const b = Math.floor(b1 * 180 + brightness * 40);
				const a = Math.floor(40 + b1 * 60); // subtle alpha

				// Fill the pixel block
				for (let dy = 0; dy < PIXEL_STEP && y + dy < height; dy++) {
					for (let dx = 0; dx < PIXEL_STEP && x + dx < width; dx++) {
						const idx = ((y + dy) * width + (x + dx)) * 4;
						data[idx] = r;
						data[idx + 1] = g;
						data[idx + 2] = b;
						data[idx + 3] = a;
					}
				}
			}
		}

		ctx.putImageData(imageData, 0, 0);
		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}
