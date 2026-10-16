/**
 * Title: Glitch Grid
 * Description: A faint HUD grid with drafting measurements at its edges, where cells, scan lines and blocks glitch now and then in the outer thirds, away from the chat.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const CELL_SIZE     = 40;    // size of a grid cell, in px (20-80)
const GRID_ALPHA    = 0.1;   // visibility of the grid lines (0.03-0.15)
const GLITCH_RATE   = 1;     // how often glitches appear; 0 turns them off (0-3)
const GLITCH_ALPHA  = 0.12;  // peak visibility of a glitched cell (0.03-0.25)
const SCAN_LINES    = true;  // short scan lines sweep the outer thirds
const SHIFT_BLOCKS  = true;  // blocks of the grid briefly slip sideways
const ANNOTATIONS   = true;  // coordinate ticks and labels along the edges
const DIMENSIONS    = 4;     // drafting dimension lines fading in and out at the sides (0-8)
const SECTORS       = 4;     // faint bracketed sector blocks at the sides (0-6)
const MOTION        = 1;     // speed of scan lines and fades (0.2-2)
const CENTER_CALM   = 0.7;   // how much the grid fades behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band around the chat column, in px (300-900)
const CURSOR_GLOW   = 0.6;   // how brightly intersections near the cursor glow (0-1)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const GRID_COLOR    = '#64c8b4';  // grid and label color without the theme
const GLITCH_COLOR  = '#00dcb4';  // glitched cell color
const GLITCH_COLOR2 = '#00c8dc';  // second glitch color
const SCAN_COLOR    = '#c80064';  // scan line fringe color
/* ──────────────────────────────────────────── */

const MAX_CELLS = 24, MAX_SCANS = 4, MAX_BLOCKS = 3, MAX_DIMS = 8;
const DASH = [4, 3], SOLID = [];

let canvas, ctx, cache, cctx;
let w = 0, h = 0, dpr = 1;
let last = 0, reduced = false, dark = true, spawnWait = 0.5;
let zone = 0; // width of each outer glitch zone
const mouse = { x: -10000, y: -10000, amount: 0, target: 0 };
const col = { grid: GRID_COLOR, a: GLITCH_COLOR, b: GLITCH_COLOR2, scan: SCAN_COLOR, font: '10px monospace' };
// Six floats per slot: x, y, life, maxLife, then alpha+color, alpha+speed or width+shift
const cells = new Float32Array(MAX_CELLS * 6);
const scans = new Float32Array(MAX_SCANS * 6);
const blocks = new Float32Array(MAX_BLOCKS * 6);
const sectors = new Float32Array(24); // x, y, width, height of up to six sector marks
const dims = [];
for (let i = 0; i < MAX_DIMS; i++) dims.push({ horiz: true, a: 0, b: 0, at: 0, age: 0, life: 0, label: '' });

function applyTheme(t) {
	if (t) {
		dark = t.dark !== false;
		if (FOLLOW_THEME && t.colors) {
			col.grid = t.colors.muted;
			col.a = t.colors.accent;
			col.b = t.colors.accent3;
			col.scan = t.colors.accent2;
		}
	}
	buildCache();
}

function band(x) {
	const b = Math.abs(x - w / 2) / BAND_WIDTH;
	const s = Math.min(1, Math.max(0, (b - 0.55) / 0.7));
	return 1 - CENTER_CALM * (1 - s * s * (3 - 2 * s));
}

function resize(width, height, ratio) {
	w = width;
	h = height;
	dpr = Math.min(ratio || 1, 2);
	zone = Math.max(CELL_SIZE * 2, Math.min(w / 3, w / 2 - BAND_WIDTH * 0.6));
	if (!canvas) return;
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	cache = new OffscreenCanvas(canvas.width, canvas.height);
	cctx = cache.getContext('2d');
	cells.fill(0); scans.fill(0); blocks.fill(0);
	for (let i = 0; i < MAX_DIMS; i++) dims[i].life = 0;
	for (let i = 0; i < 6; i++) {
		const cw = 2 + Math.floor(Math.random() * 2), ch = 1 + Math.floor(Math.random() * 2);
		const span = Math.max(1, Math.floor(zone / CELL_SIZE) - cw);
		const c = i % 2 ? Math.floor(Math.random() * span) : Math.floor(w / CELL_SIZE) - cw - Math.floor(Math.random() * span);
		sectors[i * 4] = c * CELL_SIZE;
		sectors[i * 4 + 1] = (1 + Math.floor(Math.random() * Math.max(1, Math.floor(h / CELL_SIZE) - ch - 2))) * CELL_SIZE;
		sectors[i * 4 + 2] = cw * CELL_SIZE;
		sectors[i * 4 + 3] = ch * CELL_SIZE;
	}
	buildCache();
}

// The still grid, sectors and edge labels, drawn into a cache on resize or theme
function buildCache() {
	if (!cctx) return;
	const g = cctx;
	g.setTransform(1, 0, 0, 1, 0, 0);
	g.clearRect(0, 0, cache.width, cache.height);
	g.setTransform(dpr, 0, 0, dpr, 0, 0);
	const a = GRID_ALPHA, off = dpr < 1.5 ? 0.5 : 0, major = CELL_SIZE * 4;
	g.strokeStyle = col.grid;
	g.lineWidth = 1;
	// Minor lines, then every fourth line stronger, like a drafting sheet
	for (let pass = 0; pass < 2; pass++) {
		const step = pass ? major : CELL_SIZE;
		g.globalAlpha = pass ? Math.min(0.15, a * 1.5) : a;
		g.beginPath();
		for (let x = 0; x <= w; x += step) { g.moveTo(x + off, 0); g.lineTo(x + off, h); }
		for (let y = 0; y <= h; y += step) { g.moveTo(0, y + off); g.lineTo(w, y + off); }
		g.stroke();
	}
	// Sector marks: shaded cells with corner brackets, laid out at resize
	g.fillStyle = g.strokeStyle = col.a;
	for (let i = 0; i < SECTORS && i < 6; i++) {
		const x = sectors[i * 4] + off, y = sectors[i * 4 + 1] + off, bw = sectors[i * 4 + 2], bh = sectors[i * 4 + 3];
		g.globalAlpha = 0.08;
		g.fillRect(x, y, bw, bh);
		g.globalAlpha = 0.3;
		g.beginPath();
		g.moveTo(x - 4, y + 6); g.lineTo(x - 4, y - 4); g.lineTo(x + 6, y - 4);
		g.moveTo(x + bw + 4, y + bh - 6); g.lineTo(x + bw + 4, y + bh + 4); g.lineTo(x + bw - 6, y + bh + 4);
		g.stroke();
	}
	if (ANNOTATIONS) {
		g.fillStyle = g.strokeStyle = col.grid;
		g.font = col.font;
		g.globalAlpha = Math.min(0.5, a * 5);
		g.beginPath();
		for (let x = major; x < w; x += major) {
			if (Math.abs(x - w / 2) < w / 2 - zone) continue;
			g.moveTo(x + off, 0); g.lineTo(x + off, 6);
			g.textAlign = 'center';
			g.fillText(String(x / CELL_SIZE), x, 17);
		}
		for (let y = major; y < h; y += major) {
			g.moveTo(0, y + off); g.lineTo(6, y + off);
			g.moveTo(w, y + off); g.lineTo(w - 6, y + off);
			g.textAlign = 'left';
			g.fillText(String(y / CELL_SIZE), 9, y - 3);
			g.textAlign = 'right';
			g.fillText(String(y / CELL_SIZE), w - 9, y - 3);
		}
		g.stroke();
	}
	// Fade the cache behind the chat column
	g.globalAlpha = 1;
	g.globalCompositeOperation = 'destination-in';
	const mask = g.createLinearGradient(0, 0, w, 0);
	for (let i = 0; i <= 16; i++) mask.addColorStop(i / 16, 'rgba(0,0,0,' + band((i / 16) * w).toFixed(3) + ')');
	g.fillStyle = mask;
	g.fillRect(0, 0, w, h);
	g.globalCompositeOperation = 'source-over';
}

// A random x inside one of the two outer zones
function zoneX() {
	const x = Math.random() * zone;
	return Math.random() < 0.5 ? x : w - x;
}

function free(pool, n) {
	for (let i = 0; i < n; i++) if (pool[i * 6 + 2] <= 0) return i * 6;
	return -1;
}

function spawn() {
	const near = mouse.amount > 0.2 && (mouse.x < zone || mouse.x > w - zone);
	let k = free(cells, MAX_CELLS);
	if (k >= 0) {
		const x = near && Math.random() < 0.6 ? mouse.x + (Math.random() - 0.5) * 240 : zoneX();
		const y = near && Math.random() < 0.6 ? mouse.y + (Math.random() - 0.5) * 240 : Math.random() * h;
		cells[k] = Math.floor(Math.min(w - 1, Math.max(0, x)) / CELL_SIZE) * CELL_SIZE;
		cells[k + 1] = Math.floor(Math.min(h - 1, Math.max(0, y)) / CELL_SIZE) * CELL_SIZE;
		cells[k + 2] = cells[k + 3] = 0.6 + Math.random() * 0.9;
		cells[k + 4] = GLITCH_ALPHA * (0.4 + Math.random() * 0.6);
		cells[k + 5] = Math.random() < 0.5 ? 0 : 1;
	}
	if (SCAN_LINES && Math.random() < 0.12 && (k = free(scans, MAX_SCANS)) >= 0) {
		scans[k] = Math.random() < 0.5 ? 0 : 1;
		scans[k + 1] = Math.random() * h;
		scans[k + 2] = scans[k + 3] = 1.2 + Math.random() * 1.6;
		scans[k + 4] = 0.05 + Math.random() * 0.07;
		scans[k + 5] = (40 + Math.random() * 90) * (Math.random() < 0.5 ? 1 : -1);
	}
	if (SHIFT_BLOCKS && Math.random() < 0.06 && (k = free(blocks, MAX_BLOCKS)) >= 0) {
		const n = 1 + Math.floor(Math.random() * 3);
		blocks[k] = Math.floor(Math.min(zoneX(), w - n * CELL_SIZE) / CELL_SIZE) * CELL_SIZE;
		blocks[k + 1] = Math.floor((Math.random() * h) / CELL_SIZE) * CELL_SIZE;
		blocks[k + 2] = blocks[k + 3] = 0.35 + Math.random() * 0.4;
		blocks[k + 4] = n;
		blocks[k + 5] = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 5);
	}
}

// Dimension lines in the outer zones, snapped to the major grid
function placeDim(d) {
	const major = CELL_SIZE * 4, snap = (v) => Math.round(v / major) * major;
	const inZone = (len) => snap(major * 0.5 + Math.random() * Math.max(0, zone - len - major));
	d.horiz = Math.random() < 0.5;
	if (d.horiz) {
		const span = Math.max(major, snap(zone * (0.4 + Math.random() * 0.4)));
		d.a = Math.random() < 0.5 ? inZone(span) : w - inZone(span) - span;
		d.b = d.a + span;
		d.at = snap(major + Math.random() * Math.max(0, h - major * 2));
	} else {
		d.at = Math.random() < 0.5 ? inZone(0) : w - inZone(0);
		d.a = snap(major * 0.5 + Math.random() * h * 0.4);
		d.b = Math.min(h - major * 0.5, d.a + snap(h * (0.2 + Math.random() * 0.3)));
	}
	for (let i = 0; i < MAX_DIMS; i++) {
		const o = dims[i];
		if (o !== d && o.life > 0 && o.horiz === d.horiz && Math.abs(o.at - d.at) < major) { d.life = 0; return; }
	}
	d.label = ((d.b - d.a) / CELL_SIZE).toFixed(1) + ' u';
	d.age = 0;
	d.life = 12 + Math.random() * 14;
}

function drawDims(dt) {
	ctx.strokeStyle = col.grid;
	ctx.fillStyle = col.grid;
	ctx.font = col.font;
	ctx.textAlign = 'center';
	ctx.lineWidth = 1;
	const peak = dark ? 0.32 : 0.28;
	for (let i = 0; i < DIMENSIONS && i < MAX_DIMS; i++) {
		const d = dims[i];
		d.age += dt * MOTION * (reduced ? 0.4 : 1);
		if (d.age >= d.life) { placeDim(d); d.age = -Math.random() * 4; }
		if (d.age < 0 || d.life <= 0) continue;
		const fade = Math.min(1, d.age / 2, (d.life - d.age) / 2);
		const mid = d.horiz ? (d.a + d.b) / 2 : d.at;
		ctx.globalAlpha = peak * fade * band(mid);
		ctx.setLineDash(DASH);
		ctx.beginPath();
		if (d.horiz) { ctx.moveTo(d.a, d.at); ctx.lineTo(d.b, d.at); } else { ctx.moveTo(d.at, d.a); ctx.lineTo(d.at, d.b); }
		ctx.stroke();
		ctx.setLineDash(SOLID);
		ctx.beginPath();
		for (let e = 0; e < 2; e++) {
			const v = e ? d.b : d.a;
			if (d.horiz) { ctx.moveTo(v, d.at - 7); ctx.lineTo(v, d.at + 7); } else { ctx.moveTo(d.at - 7, v); ctx.lineTo(d.at + 7, v); }
		}
		ctx.stroke();
		if (d.horiz) ctx.fillText(d.label, mid, d.at - 9);
		else ctx.fillText(d.label, d.at + (d.at < w / 2 ? 22 : -22), (d.a + d.b) / 2);
	}
}

// Ages a pooled glitch and returns its fade: a smooth rise and fall, never a flicker
function age(pool, k, dt, rise, fall) {
	pool[k + 2] -= dt * MOTION;
	const t = 1 - pool[k + 2] / pool[k + 3];
	return Math.min(1, t / rise, (1 - t) / fall);
}

function frame(now) {
	requestAnimationFrame(frame);
	if (!ctx) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	mouse.target = Math.max(0, mouse.target - dt * 0.7);
	mouse.amount += (mouse.target - mouse.amount) * Math.min(1, dt * 5);
	ctx.clearRect(0, 0, w, h);
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.drawImage(cache, 0, 0);
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	if (DIMENSIONS > 0) drawDims(dt);
	const lightK = dark ? 1 : 0.8;

	// Intersections near the cursor glow, fading once it stops
	if (CURSOR_GLOW > 0 && mouse.amount > 0.01) {
		ctx.fillStyle = col.a;
		const range = CELL_SIZE * 3;
		const c0 = Math.max(0, Math.floor((mouse.x - range) / CELL_SIZE)), c1 = Math.floor((mouse.x + range) / CELL_SIZE);
		const r0 = Math.max(0, Math.floor((mouse.y - range) / CELL_SIZE)), r1 = Math.floor((mouse.y + range) / CELL_SIZE);
		for (let c = c0; c <= c1; c++) {
			for (let r = r0; r <= r1; r++) {
				const x = c * CELL_SIZE, y = r * CELL_SIZE;
				const dist = Math.hypot(x - mouse.x, y - mouse.y);
				if (dist >= range) continue;
				ctx.globalAlpha = (1 - dist / range) * 0.7 * CURSOR_GLOW * mouse.amount * band(x) * lightK;
				ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
			}
		}
	}

	if (!reduced && GLITCH_RATE > 0) {
		spawnWait -= dt * GLITCH_RATE * MOTION * (mouse.amount > 0.2 ? 2 : 1);
		if (spawnWait <= 0) { spawn(); spawnWait = 0.25 + Math.random() * 0.35; }
	}
	// Glitched cells
	ctx.lineWidth = 1;
	for (let k = 0; k < MAX_CELLS * 6; k += 6) {
		if (cells[k + 2] <= 0) continue;
		const fade = age(cells, k, dt, 0.2, 0.45);
		if (fade <= 0) continue;
		const a = cells[k + 4] * fade * band(cells[k] + CELL_SIZE / 2) * lightK;
		ctx.fillStyle = ctx.strokeStyle = cells[k + 5] ? col.b : col.a;
		ctx.globalAlpha = a;
		ctx.fillRect(cells[k] + 1, cells[k + 1] + 1, CELL_SIZE - 2, CELL_SIZE - 2);
		ctx.globalAlpha = Math.min(1, a * 1.6);
		ctx.strokeRect(cells[k] + 1.5, cells[k + 1] + 1.5, CELL_SIZE - 3, CELL_SIZE - 3);
	}
	// Scan lines: short sweeps in one outer zone, with a colored fringe
	for (let k = 0; k < MAX_SCANS * 6; k += 6) {
		if (scans[k + 2] <= 0) continue;
		scans[k + 1] += scans[k + 5] * dt * MOTION;
		const fade = age(scans, k, dt, 0.2, 0.3);
		if (fade <= 0 || scans[k + 1] < 0 || scans[k + 1] > h) { scans[k + 2] = 0; continue; }
		const x0 = scans[k] ? w - zone : 0, y = scans[k + 1];
		ctx.globalAlpha = scans[k + 4] * fade * lightK;
		ctx.fillStyle = col.a;
		ctx.fillRect(x0, y, zone, 1.5);
		ctx.globalAlpha *= 0.5;
		ctx.fillStyle = col.scan;
		ctx.fillRect(x0, y - 1.5, zone, 1);
		ctx.fillStyle = col.b;
		ctx.fillRect(x0, y + 2, zone, 1);
	}
	// Shifted blocks slip sideways and settle back
	for (let k = 0; k < MAX_BLOCKS * 6; k += 6) {
		if (blocks[k + 2] <= 0) continue;
		blocks[k + 2] -= dt * MOTION;
		const t = Math.max(0, blocks[k + 2] / blocks[k + 3]);
		const bw = blocks[k + 4] * CELL_SIZE;
		const sx = blocks[k] + blocks[k + 5] * t;
		ctx.globalAlpha = 0.07 * t * band(blocks[k]) * lightK;
		ctx.fillStyle = col.a;
		ctx.fillRect(sx, blocks[k + 1], bw, CELL_SIZE);
		ctx.globalAlpha = 0.25 * t * band(blocks[k]) * lightK;
		ctx.fillRect(sx, blocks[k + 1] + CELL_SIZE * 0.3, bw, 1);
		ctx.fillRect(sx, blocks[k + 1] + CELL_SIZE * 0.7, bw, 1);
	}
	ctx.globalAlpha = 1;
}

self.onmessage = (e) => {
	const d = e.data;
	switch (d.type) {
		case 'init':
			canvas = d.canvas;
			ctx = canvas.getContext('2d');
			reduced = !!d.reducedMotion;
			applyTheme(d.theme);
			resize(d.width, d.height, d.dpr);
			requestAnimationFrame(frame);
			break;
		case 'resize':
			resize(d.width, d.height, d.dpr);
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
			mouse.target = 1;
			break;
	}
};
