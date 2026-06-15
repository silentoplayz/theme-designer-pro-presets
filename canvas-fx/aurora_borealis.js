/**
 * Title: Aurora Borealis
 * Description: Flowing, undulating aurora-like ribbons of light with green, teal, and purple hues.
 *              Ribbons sway gently using sine waves and respond subtly to mouse position
 *              by shifting their flow direction.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let time = 0;
let ribbons = [];

// Keep worker alive
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

const RIBBON_COUNT = 5;

// Aurora color palette: greens, teals, purples
const PALETTE = [
	{ r: 50, g: 220, b: 130 }, // green
	{ r: 30, g: 200, b: 180 }, // teal
	{ r: 80, g: 180, b: 220 }, // cyan-teal
	{ r: 130, g: 80, b: 220 }, // purple
	{ r: 60, g: 240, b: 160 } // bright green
];

class Ribbon {
	constructor(index) {
		this.index = index;
		this.color = PALETTE[index % PALETTE.length];
		this.yBase = 0;
		this.amplitude = 0;
		this.frequency = 0;
		this.speed = 0;
		this.thickness = 0;
		this.phase = Math.random() * Math.PI * 2;
		this.opacity = 0;
		this.recalculate();
	}

	recalculate() {
		// Position ribbon in upper-to-middle area
		this.yBase = height * (0.15 + this.index * 0.12);
		this.amplitude = height * (0.04 + Math.random() * 0.06);
		this.frequency = 0.002 + Math.random() * 0.002;
		this.speed = 0.008 + Math.random() * 0.006;
		this.thickness = height * (0.06 + Math.random() * 0.08);
		this.opacity = 0.04 + Math.random() * 0.04;
	}

	draw(t) {
		const { r, g, b } = this.color;
		const segments = 80;
		const segWidth = (width + 40) / segments;

		// Mouse influence: shift the ribbon horizontally and vertically
		const mouseFractionX = mouse.x > -1000 ? mouse.x / width - 0.5 : 0;
		const mouseFractionY = mouse.y > -1000 ? mouse.y / height - 0.5 : 0;
		const mouseShiftX = mouseFractionX * 30;
		const mouseShiftY = mouseFractionY * 15;

		// Draw multiple layers for glow
		for (let layer = 0; layer < 3; layer++) {
			const layerOpacity = this.opacity * (1 - layer * 0.3);
			const layerThickness = this.thickness * (1 + layer * 0.8);

			ctx.beginPath();

			for (let i = 0; i <= segments; i++) {
				const x = -20 + i * segWidth;
				const xNorm = x / width;

				// Composite sine wave for organic motion
				const wave1 = Math.sin(x * this.frequency + t * this.speed + this.phase);
				const wave2 =
					Math.sin(x * this.frequency * 1.7 + t * this.speed * 0.6 + this.phase * 2.3) * 0.5;
				const wave3 = Math.sin(x * this.frequency * 0.5 + t * this.speed * 1.3) * 0.3;

				const y =
					this.yBase +
					(wave1 + wave2 + wave3) * this.amplitude +
					mouseShiftY * (1 - Math.abs(xNorm - 0.5) * 1.5) +
					Math.sin(xNorm * Math.PI) * mouseShiftX;

				if (i === 0) {
					ctx.moveTo(x, y);
				} else {
					ctx.lineTo(x, y);
				}
			}

			// Create a gradient stroke that fades at edges
			const grad = ctx.createLinearGradient(0, 0, width, 0);
			grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
			grad.addColorStop(0.15, `rgba(${r}, ${g}, ${b}, ${layerOpacity})`);
			grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${layerOpacity * 1.2})`);
			grad.addColorStop(0.85, `rgba(${r}, ${g}, ${b}, ${layerOpacity})`);
			grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

			ctx.strokeStyle = grad;
			ctx.lineWidth = layerThickness;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.stroke();
		}
	}
}

function initRibbons() {
	ribbons = [];
	for (let i = 0; i < RIBBON_COUNT; i++) {
		ribbons.push(new Ribbon(i));
	}
}

function startAnimation() {
	function render() {
		if (!ctx) return;
		ctx.clearRect(0, 0, width, height);

		time += 1;

		// Draw ribbons back to front
		for (const ribbon of ribbons) {
			ribbon.draw(time);
		}

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
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
			initRibbons();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			for (const ribbon of ribbons) {
				ribbon.recalculate();
			}
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};
