/**
 * Title: Topographic Map
 * Description: Contour lines and soft elevation fills over slowly flowing terrain in your theme's colors, fading behind the chat column; the cursor raises a gentle hill that settles once it stops.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const CONTOURS        = 14;      // contour levels (4-30)
const CONTOUR_OPACITY = 0.5;     // contour line opacity (0-1)
const LINE_WIDTH      = 1;       // contour line width, in px (0.5-3)
const FILL_OPACITY    = 0.16;    // elevation fill opacity; 0 draws lines only (0-0.5)
const MOTION          = 1;       // how fast the terrain flows; 0 holds it still (0-3)
const REDUCED_SPEED   = 0.15;    // share of the flow kept under reduced motion (0-1)
const NOISE_SCALE     = 0.0035;  // terrain feature size; lower is broader (0.001-0.01)
const OCTAVES         = 4;       // terrain detail layers (1-5)
const GRID_STEP       = 8;       // sampling cell, in px; larger is cheaper and smoother (5-14)
const MAX_FPS         = 20;      // redraws per second; the terrain moves slowly (10-60)
const HILL_RADIUS     = 200;     // radius of the cursor's hill, in px (0-400)
const HILL_HEIGHT     = 0.35;    // height of the cursor's hill (0-1)
const CENTER_CALM     = 0.8;     // how much lines and fills fade behind the chat column (0-1)
const BAND_WIDTH      = 520;     // half-width of the calm band, in px (300-900)
const FOLLOW_THEME    = true;    // draw in the theme's colors
const PALETTE         = ['#0a2463', '#1e6091', '#168aad', '#34a0a4', '#52b69a', '#76c893', '#99d98c', '#d9ed92', '#f0f3bd'];  // low to high when not following the theme
/* ──────────────────────────────────────────── */

let canvas, ctx, w = 0, h = 0, dpr = 1, last = 0, drawn = 0, reduced = false, dark = true;
let cols = 1, rows = 1, grid = new Float32Array(1), calmCol = new Float32Array(1);
let fillCanvas, fillCtx, imageData, pixels;
let palette = PALETTE, alphaScale = 1, lutDirty = true, levelStyle = [];
let time = 0, minE = 0, maxE = 1;
const LUT = new Uint8Array(256 * 3);
const mouse = { x: -10000, y: -10000, amount: 0, hill: 0 };

// ── Gradient noise from a seeded permutation table ──
const PERM = new Uint8Array(512);
(function () {
	const p = new Uint8Array(256);
	for (let i = 0; i < 256; i++) p[i] = i;
	let seed = 42;
	for (let i = 255; i > 0; i--) {
		seed = (seed * 16807) % 2147483647;
		const j = seed % (i + 1), t = p[i];
		p[i] = p[j]; p[j] = t;
	}
	for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();
const GX = new Float32Array([1, -1, 1, -1, 1, 0, -1, 0]), GY = new Float32Array([1, 1, -1, -1, 0, 1, 0, -1]);

function noise(x, y) {
	const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
	const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10), sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
	const a = ix & 255, b = iy & 255, a1 = (a + 1) & 255, b1 = (b + 1) & 255;
	const g00 = PERM[PERM[a] + b] & 7, g10 = PERM[PERM[a1] + b] & 7, g01 = PERM[PERM[a] + b1] & 7, g11 = PERM[PERM[a1] + b1] & 7;
	const n00 = GX[g00] * fx + GY[g00] * fy, n10 = GX[g10] * (fx - 1) + GY[g10] * fy;
	const n01 = GX[g01] * fx + GY[g01] * (fy - 1), n11 = GX[g11] * (fx - 1) + GY[g11] * (fy - 1);
	const nx0 = n00 + sx * (n10 - n00), nx1 = n01 + sx * (n11 - n01);
	return (nx0 + sy * (nx1 - nx0)) * 0.5 + 0.5;
}

function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

// Low to high: a quiet base, the three accents, then the text color at the peaks
function applyTheme(t) {
	if (!t) return;
	dark = t.dark !== false;
	alphaScale = dark ? 1 : 0.75;
	if (FOLLOW_THEME && t.colors) {
		const c = t.colors;
		palette = [dark ? c.surface : c.muted, c.accent3, c.accent, c.accent2, c.text];
	}
	lutDirty = true;
}

// The color LUT and one column-fading stroke style per contour level
function rebuildLUT() {
	lutDirty = false;
	const pal = palette.map(hex), n = pal.length;
	for (let i = 0; i < 256; i++) {
		const t = i / 255 * (n - 1), lo = Math.floor(t), hi = Math.min(lo + 1, n - 1), f = t - lo;
		for (let k = 0; k < 3; k++) LUT[i * 3 + k] = pal[lo][k] + (pal[hi][k] - pal[lo][k]) * f;
	}
	const a = CONTOUR_OPACITY * alphaScale, k = 1 - CENTER_CALM, i0 = BAND_WIDTH * 0.55 / Math.max(1, w), o0 = BAND_WIDTH * 1.25 / Math.max(1, w);
	for (let l = 0; l < CONTOURS; l++) {
		const ci = Math.round((l + 1) / (CONTOURS + 1) * 255) * 3;
		const rgb = LUT[ci] + ',' + LUT[ci + 1] + ',' + LUT[ci + 2] + ',';
		const g = ctx.createLinearGradient(0, 0, Math.max(1, w), 0);
		g.addColorStop(0, 'rgba(' + rgb + a + ')');
		g.addColorStop(Math.max(0, 0.5 - o0), 'rgba(' + rgb + a + ')');
		g.addColorStop(Math.max(0, 0.5 - i0), 'rgba(' + rgb + a * k + ')');
		g.addColorStop(Math.min(1, 0.5 + i0), 'rgba(' + rgb + a * k + ')');
		g.addColorStop(Math.min(1, 0.5 + o0), 'rgba(' + rgb + a + ')');
		g.addColorStop(1, 'rgba(' + rgb + a + ')');
		levelStyle[l] = g;
	}
}

function size() {
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	cols = Math.max(2, Math.ceil(w / GRID_STEP) + 2);
	rows = Math.max(2, Math.ceil(h / GRID_STEP) + 2);
	grid = new Float32Array(cols * rows);
	calmCol = new Float32Array(cols);
	for (let c = 0; c < cols; c++) {
		const d = Math.abs(c * GRID_STEP - w / 2) / BAND_WIDTH, t = Math.min(1, Math.max(0, (d - 0.55) / 0.7));
		calmCol[c] = 1 - CENTER_CALM * (1 - t * t * (3 - 2 * t));
	}
	// The fill lives at one pixel per grid cell and is scaled up smoothly when drawn
	fillCanvas = new OffscreenCanvas(cols, rows);
	fillCtx = fillCanvas.getContext('2d');
	imageData = fillCtx.createImageData(cols, rows);
	pixels = imageData.data;
	lutDirty = true;
	drawn = 0;
}

function sample() {
	const tx = time * 0.25, ty = time * 0.18, drift = Math.sin(time * 0.4) * 0.3;
	const r2 = HILL_RADIUS * HILL_RADIUS, hill = HILL_HEIGHT * mouse.hill;
	let lo = Infinity, hi = -Infinity;
	for (let r = 0; r < rows; r++) {
		const py = r * GRID_STEP, off = r * cols;
		for (let c = 0; c < cols; c++) {
			const px = c * GRID_STEP;
			let x = px * NOISE_SCALE + tx + drift, y = py * NOISE_SCALE + ty - drift * 0.7, e = 0, amp = 0.5;
			for (let o = 0; o < OCTAVES; o++) { e += amp * noise(x, y); x *= 2; y *= 2; amp *= 0.5; }
			if (hill > 0.001) {
				const dx = px - mouse.x, dy = py - mouse.y, d2 = dx * dx + dy * dy;
				if (d2 < r2) { const f = 1 - Math.sqrt(d2) / HILL_RADIUS; e += hill * f * f * (3 - 2 * f); }
			}
			grid[off + c] = e;
			if (e < lo) lo = e;
			if (e > hi) hi = e;
		}
	}
	// Ease the range so contours do not jump when the hill rises
	if (!drawn) { minE = lo; maxE = hi; }
	minE += (lo - minE) * 0.2;
	maxE += (hi - maxE) * 0.2;
}

function drawFill() {
	const inv = 255 / (maxE - minE || 1), a = FILL_OPACITY * alphaScale * 255;
	for (let r = 0; r < rows; r++) {
		const off = r * cols;
		for (let c = 0; c < cols; c++) {
			const ci = Math.max(0, Math.min(255, ((grid[off + c] - minE) * inv) | 0)) * 3, p = (off + c) << 2;
			pixels[p] = LUT[ci]; pixels[p + 1] = LUT[ci + 1]; pixels[p + 2] = LUT[ci + 2];
			pixels[p + 3] = a * calmCol[c];
		}
	}
	fillCtx.putImageData(imageData, 0, 0);
	ctx.imageSmoothingEnabled = true;
	ctx.drawImage(fillCanvas, 0, 0, cols, rows, 0, 0, cols * GRID_STEP, rows * GRID_STEP);
}

// Marching squares, one path per level, saddles resolved by the cell's centre value
function drawContours() {
	const s = GRID_STEP, range = maxE - minE || 1;
	ctx.lineWidth = LINE_WIDTH;
	ctx.lineJoin = 'round';
	for (let l = 0; l < CONTOURS; l++) {
		const thr = minE + (l + 1) * range / (CONTOURS + 1);
		ctx.strokeStyle = levelStyle[l];
		ctx.beginPath();
		for (let r = 0; r < rows - 1; r++) {
			const o0 = r * cols, o1 = o0 + cols, y = r * s;
			for (let c = 0; c < cols - 1; c++) {
				const a = grid[o0 + c] - thr, b = grid[o0 + c + 1] - thr, d = grid[o1 + c + 1] - thr, e = grid[o1 + c] - thr;
				const code = (a > 0 ? 8 : 0) | (b > 0 ? 4 : 0) | (d > 0 ? 2 : 0) | (e > 0 ? 1 : 0);
				if (code === 0 || code === 15) continue;
				const x = c * s;
				const tX = x + a / (a - b) * s, rY = y + b / (b - d) * s, bX = x + e / (e - d) * s, lY = y + a / (a - e) * s;
				switch (code) {
					case 1: case 14: ctx.moveTo(x, lY); ctx.lineTo(bX, y + s); break;
					case 2: case 13: ctx.moveTo(bX, y + s); ctx.lineTo(x + s, rY); break;
					case 3: case 12: ctx.moveTo(x, lY); ctx.lineTo(x + s, rY); break;
					case 4: case 11: ctx.moveTo(tX, y); ctx.lineTo(x + s, rY); break;
					case 6: case 9: ctx.moveTo(tX, y); ctx.lineTo(bX, y + s); break;
					case 7: case 8: ctx.moveTo(x, lY); ctx.lineTo(tX, y); break;
					case 5: case 10: {
						const centre = (a + b + d + e) * 0.25;
						if ((centre > 0) === (a > 0)) {
							ctx.moveTo(tX, y); ctx.lineTo(x + s, rY);
							ctx.moveTo(x, lY); ctx.lineTo(bX, y + s);
						} else {
							ctx.moveTo(x, lY); ctx.lineTo(tX, y);
							ctx.moveTo(bX, y + s); ctx.lineTo(x + s, rY);
						}
						break;
					}
				}
			}
		}
		ctx.stroke();
	}
}

function frame(now) {
	requestAnimationFrame(frame);
	if (!w || !h) return;
	if (drawn && now - last < 1000 / MAX_FPS - 2) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	time = (time + dt * 0.36 * MOTION * (reduced ? REDUCED_SPEED : 1)) % 2000;
	mouse.amount = Math.max(0, mouse.amount - dt * 0.4);
	mouse.hill += (mouse.amount - mouse.hill) * Math.min(1, dt * (reduced ? 0.8 : 3));
	if (lutDirty) rebuildLUT();
	sample();
	ctx.clearRect(0, 0, w, h);
	if (FILL_OPACITY > 0) drawFill();
	drawContours();
	drawn++;
}

self.onmessage = (e) => {
	const d = e.data;
	switch (d.type) {
		case 'init':
			canvas = d.canvas;
			ctx = canvas.getContext('2d');
			w = d.width; h = d.height; dpr = Math.min(d.dpr || 1, 2);
			reduced = !!d.reducedMotion;
			applyTheme(d.theme);
			size();
			requestAnimationFrame(frame);
			break;
		case 'resize':
			w = d.width; h = d.height; dpr = Math.min(d.dpr || 1, 2);
			if (canvas) size();
			break;
		case 'theme':
			applyTheme(d);
			break;
		case 'motion':
			reduced = !!d.reducedMotion;
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.amount = 1;
			break;
	}
};
