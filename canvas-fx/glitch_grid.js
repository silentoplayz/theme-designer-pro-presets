/**
 * Title: Glitch Grid
 * Description: A subtle grid overlay that occasionally glitches — random cells flash,
 *   scan lines appear and disappear, small sections shift position briefly.
 *   Restrained HUD aesthetic with intermittent interference.
 *   Mouse proximity increases glitch frequency nearby.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };

const CELL_SIZE = 40;
let cols, rows;
let glitches = []; // active glitch effects
let scanLines = []; // horizontal scan line distortions
let shiftBlocks = []; // section shifts

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
			init();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			init();
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};

function init() {
	cols = Math.ceil(width / CELL_SIZE);
	rows = Math.ceil(height / CELL_SIZE);
	glitches = [];
	scanLines = [];
	shiftBlocks = [];
}

// Glitch types
function spawnCellFlash(nearMouse) {
	let col, row;
	if (nearMouse && mouse.x > 0) {
		// Spawn near mouse
		col = Math.floor(mouse.x / CELL_SIZE) + Math.floor((Math.random() - 0.5) * 6);
		row = Math.floor(mouse.y / CELL_SIZE) + Math.floor((Math.random() - 0.5) * 6);
	} else {
		col = Math.floor(Math.random() * cols);
		row = Math.floor(Math.random() * rows);
	}

	col = Math.max(0, Math.min(cols - 1, col));
	row = Math.max(0, Math.min(rows - 1, row));

	const hue = Math.random() < 0.5 ? 180 : 120; // cyan or green
	glitches.push({
		type: 'cell',
		col: col,
		row: row,
		life: 0.3 + Math.random() * 0.5, // seconds
		maxLife: 0.3 + Math.random() * 0.5,
		hue: hue,
		alpha: 0.05 + Math.random() * 0.1
	});
}

function spawnScanLine() {
	scanLines.push({
		y: Math.random() * height,
		speed: (1 + Math.random() * 3) * (Math.random() < 0.5 ? 1 : -1),
		width: 1 + Math.random() * 2,
		life: 0.5 + Math.random() * 1.5,
		alpha: 0.03 + Math.random() * 0.07
	});
}

function spawnShiftBlock(nearMouse) {
	let x, y;
	if (nearMouse && mouse.x > 0) {
		x = mouse.x + (Math.random() - 0.5) * 200;
		y = mouse.y + (Math.random() - 0.5) * 200;
	} else {
		x = Math.random() * width;
		y = Math.random() * height;
	}

	const blockW = CELL_SIZE * (1 + Math.floor(Math.random() * 4));
	const blockH = CELL_SIZE * (1 + Math.floor(Math.random() * 2));

	shiftBlocks.push({
		x: x,
		y: y,
		w: blockW,
		h: blockH,
		shiftX: (Math.random() - 0.5) * 8,
		shiftY: 0,
		life: 0.05 + Math.random() * 0.15, // very brief
		maxLife: 0.05 + Math.random() * 0.15,
		alpha: 0.04 + Math.random() * 0.06
	});
}

function startAnimation() {
	let lastTime = 0;
	let spawnAccum = 0;

	function render(time) {
		if (!ctx) return;
		const dt = lastTime ? (time - lastTime) / 1000 : 0.016;
		lastTime = time;

		ctx.clearRect(0, 0, width, height);

		// === Draw the base grid ===
		ctx.strokeStyle = 'rgba(100, 200, 180, 0.03)';
		ctx.lineWidth = 0.5;

		// Vertical lines
		for (let c = 0; c <= cols; c++) {
			const x = c * CELL_SIZE;
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, height);
			ctx.stroke();
		}
		// Horizontal lines
		for (let r = 0; r <= rows; r++) {
			const y = r * CELL_SIZE;
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(width, y);
			ctx.stroke();
		}

		// === Mouse proximity — glow nearby grid intersections ===
		if (mouse.x > 0 && mouse.y > 0) {
			const mc = Math.floor(mouse.x / CELL_SIZE);
			const mr = Math.floor(mouse.y / CELL_SIZE);
			const range = 3;

			for (let dc = -range; dc <= range; dc++) {
				for (let dr = -range; dr <= range; dr++) {
					const c = mc + dc;
					const r = mr + dr;
					if (c < 0 || c > cols || r < 0 || r > rows) continue;

					const px = c * CELL_SIZE;
					const py = r * CELL_SIZE;
					const dx = px - mouse.x;
					const dy = py - mouse.y;
					const dist = Math.sqrt(dx * dx + dy * dy);
					const maxDist = range * CELL_SIZE;

					if (dist < maxDist) {
						const glow = (1 - dist / maxDist) * 0.12;
						ctx.beginPath();
						ctx.arc(px, py, 2, 0, Math.PI * 2);
						ctx.fillStyle = `rgba(0, 220, 180, ${glow})`;
						ctx.fill();
					}
				}
			}
		}

		// === Spawn glitches ===
		spawnAccum += dt;

		// Mouse proximity increases spawn rate
		const mouseOnScreen = mouse.x > 0 && mouse.x < width && mouse.y > 0 && mouse.y < height;
		const baseRate = 0.15; // seconds between spawns
		const mouseRate = mouseOnScreen ? 0.05 : baseRate;

		if (spawnAccum > mouseRate) {
			spawnAccum = 0;

			// Cell flashes
			if (Math.random() < 0.5) {
				spawnCellFlash(mouseOnScreen && Math.random() < 0.7);
			}

			// Scan lines (less frequent)
			if (Math.random() < 0.15) {
				spawnScanLine();
			}

			// Shift blocks (rare)
			if (Math.random() < 0.1) {
				spawnShiftBlock(mouseOnScreen && Math.random() < 0.6);
			}
		}

		// === Update and draw cell flashes ===
		for (let i = glitches.length - 1; i >= 0; i--) {
			const g = glitches[i];
			g.life -= dt;

			if (g.life <= 0) {
				glitches.splice(i, 1);
				continue;
			}

			const fadeIn = Math.min(1, (g.maxLife - g.life) / 0.05);
			const fadeOut = Math.min(1, g.life / 0.1);
			const fade = fadeIn * fadeOut;

			const x = g.col * CELL_SIZE;
			const y = g.row * CELL_SIZE;

			// Flickering effect
			const flicker = Math.random() < 0.3 ? 0 : 1;

			ctx.fillStyle = `rgba(0, ${g.hue === 180 ? '200, 220' : '220, 150'}, ${g.alpha * fade * flicker})`;
			ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);

			// Cell border highlight
			ctx.strokeStyle = `rgba(0, ${g.hue === 180 ? '220, 240' : '240, 180'}, ${g.alpha * fade * 1.5 * flicker})`;
			ctx.lineWidth = 0.5;
			ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
		}

		// === Update and draw scan lines ===
		for (let i = scanLines.length - 1; i >= 0; i--) {
			const s = scanLines[i];
			s.y += s.speed;
			s.life -= dt;

			if (s.life <= 0 || s.y < -10 || s.y > height + 10) {
				scanLines.splice(i, 1);
				continue;
			}

			// Draw the scan line
			ctx.fillStyle = `rgba(0, 200, 180, ${s.alpha})`;
			ctx.fillRect(0, s.y, width, s.width);

			// Slight chromatic aberration
			ctx.fillStyle = `rgba(200, 0, 100, ${s.alpha * 0.3})`;
			ctx.fillRect(0, s.y - 1, width, 0.5);
			ctx.fillStyle = `rgba(0, 100, 200, ${s.alpha * 0.3})`;
			ctx.fillRect(0, s.y + s.width, width, 0.5);
		}

		// === Update and draw shift blocks ===
		for (let i = shiftBlocks.length - 1; i >= 0; i--) {
			const b = shiftBlocks[i];
			b.life -= dt;

			if (b.life <= 0) {
				shiftBlocks.splice(i, 1);
				continue;
			}

			// Copy and shift a region (simulated with colored overlay)
			const fadeOut = b.life / b.maxLife;

			// Draw a slightly shifted duplicate overlay
			ctx.save();
			ctx.globalAlpha = b.alpha * fadeOut;
			ctx.fillStyle = 'rgba(0, 180, 160, 1)';
			ctx.fillRect(b.x + b.shiftX, b.y + b.shiftY, b.w, b.h);
			ctx.restore();

			// Draw corruption lines within the block
			const lineCount = 2 + Math.floor(Math.random() * 3);
			for (let l = 0; l < lineCount; l++) {
				const ly = b.y + Math.random() * b.h;
				ctx.fillStyle = `rgba(0, 255, 200, ${b.alpha * fadeOut * 0.5})`;
				ctx.fillRect(b.x, ly, b.w, 1);
			}
		}

		// === Occasional full-screen micro-glitch (very rare) ===
		if (Math.random() < 0.002) {
			ctx.fillStyle = 'rgba(0, 200, 180, 0.01)';
			ctx.fillRect(0, 0, width, height);
		}

		requestAnimationFrame(render);
	}

	requestAnimationFrame(render);
}
