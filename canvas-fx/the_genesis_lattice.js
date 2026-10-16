/**
 * Title: The Genesis Lattice
 * Description: Conway's Game of Life drawn as a breathing 3D mesh of glowing nodes and bonds in the theme's accent colors, dense at the screen's edges and faint over the chat column; the cursor sows new life and tilts the mesh.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const CELL_SIZE    = 22;     // spacing of the lattice, in px (12-48)
const TICK         = 0.12;   // seconds between generations (0.04-1)
const FADE         = 7;      // how quickly nodes fade in and out (1-20)
const DENSITY      = 0.3;    // share of cells alive at the start, at the edges (0.05-0.5)
const WAVE         = 15;     // height of the breathing wave, in px (0-40)
const WAVE_SPEED   = 1.2;    // speed of the breathing wave (0-4)
const PARALLAX     = 1;      // how far the mesh tilts toward the cursor (0-3)
const NODE_SIZE    = 0.32;   // node radius as a share of the spacing (0.1-0.5)
const FABRIC       = 1;      // strength of the faint mesh of empty cells (0-2)
const RESEED_EVERY = 5;      // seconds between fresh colonies beside the chat column; 0 turns them off (0-120)
const CENTER_CALM  = 0.8;    // how much the mesh thins and fades over the chat column (0-1)
const BAND_WIDTH   = 520;    // half-width of the calm band when the page has no chat column, in px (300-900)
const FOLLOW_THEME = true;   // take the colors from the theme's palette
const COLOR_ALIVE  = '#00ffb4'; // color of a living node when not following the theme
const COLOR_DYING  = '#7a3cf0'; // color a node fades through as it dies
/* ──────────────────────────────────────────── */

const K = 5, TAU = Math.PI * 2;
let cols = 0, rows = 0, total = 0, ox = 0, oy = 0;
let grid = new Uint8Array(0), next = new Uint8Array(0), vis = new Float32Array(0), calmOf = new Float32Array(0);
let dist = new Float32Array(0), ptX = new Float32Array(0), ptY = new Float32Array(0);
let canvas, ctx, mask = null, w = 0, h = 0, dpr = 1, last = 0, reduced = false, dark = true, time = 0, acc = 0, reseed = 0, column = null;
const mouse = { x: -10000, y: -10000, amount: 0, px: 0, py: 0 };
const col = { node: [], bond: [], fabric: '' };

function rgbOf(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function css(c) { return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; }
// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }
function band(x) { const t = Math.min(1, Math.max(0, (Math.abs(x - colX()) / colHalf() - 0.55) / 0.7)); return 1 - t * t * (3 - 2 * t); }

// K color steps from dying to alive, for nodes and for the bonds between them
function applyTheme(t) {
	if (t) dark = t.dark !== false;
	const th = FOLLOW_THEME && t && t.colors ? t.colors : null;
	let alive = rgbOf(th ? th.accent : COLOR_ALIVE), dying = rgbOf(th ? th.accent2 : COLOR_DYING);
	const muted = rgbOf(th ? th.muted : dark ? '#7a7890' : '#6b7480');
	if (!th && !dark) { alive = mix(alive, [20, 30, 40], 0.45); dying = mix(dying, [20, 30, 40], 0.3); }
	for (let k = 0; k < K; k++) {
		const c = mix(dying, alive, k / (K - 1));
		col.node[k] = css(c);
		col.bond[k] = css(mix(c, muted, 0.35));
	}
	col.fabric = css(mix(muted, alive, 0.3));
}

function size() {
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	// The lattice covers the screen plus at most one cell past each edge; life wraps around it
	cols = Math.ceil(w / CELL_SIZE) + 2;
	rows = Math.ceil(h / CELL_SIZE) + 2;
	total = cols * rows;
	ox = (w - (cols - 1) * CELL_SIZE) / 2;
	oy = (h - (rows - 1) * CELL_SIZE) / 2;
	grid = new Uint8Array(total);
	next = new Uint8Array(total);
	vis = new Float32Array(total);
	calmOf = new Float32Array(total);
	dist = new Float32Array(total);
	ptX = new Float32Array(total);
	ptY = new Float32Array(total);
	calmBuild();
	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			const i = y * cols + x, bx = ox + x * CELL_SIZE, by = oy + y * CELL_SIZE;
			dist[i] = Math.hypot(bx - w / 2, by - h / 2) * 0.008;
			grid[i] = vis[i] = Math.random() < DENSITY * (0.25 + 0.75 * calmOf[i]) ? 1 : 0;
		}
	}
}

// The fabric's erase mask and each cell's calm, from where the chat column sits; rebuilt on layout
function calmBuild() {
	mask = ctx.createLinearGradient(0, 0, w, 0);
	for (let i = 0; i <= 24; i++) mask.addColorStop(i / 24, 'rgba(0,0,0,' + (CENTER_CALM * band((w * i) / 24)).toFixed(3) + ')');
	for (let x = 0; x < cols; x++) {
		const c = 1 - CENTER_CALM * band(ox + x * CELL_SIZE);
		for (let y = 0; y < rows; y++) calmOf[y * cols + x] = c;
	}
}

function burst(cx, cy, r, p) {
	for (let dy = -r; dy <= r; dy++) {
		for (let dx = -r; dx <= r; dx++) {
			if (Math.random() >= p) continue;
			grid[((cy + dy + rows) % rows) * cols + ((cx + dx + cols) % cols)] = 1;
		}
	}
}

// A fresh colony beside the chat column, on the side with room
function outerBurst() {
	const lc = Math.floor((colX() - colHalf() - ox) / CELL_SIZE), rc = Math.ceil((colX() + colHalf() - ox) / CELL_SIZE);
	const left = Math.max(0, lc - 2), right = Math.max(0, cols - 3 - rc), y = Math.floor(Math.random() * rows);
	if (left + right < 4) {
		const e = Math.floor(Math.random() * cols * 0.28);
		burst(Math.random() < 0.5 ? e + 2 : cols - 3 - e, y, 6, 0.4);
		return;
	}
	const r = Math.floor(Math.random() * (left + right));
	burst(r < left ? 2 + r : cols - 3 - (r - left), y, 6, 0.4);
}

// One generation: birth on 3, survival on 2 or 3; the column thins a little each step
function step() {
	let pop = 0;
	for (let y = 0; y < rows; y++) {
		const up = (y ? y - 1 : rows - 1) * cols, mid = y * cols, dn = (y < rows - 1 ? y + 1 : 0) * cols;
		for (let x = 0; x < cols; x++) {
			const l = x ? x - 1 : cols - 1, r = x < cols - 1 ? x + 1 : 0;
			const n = grid[up + l] + grid[up + x] + grid[up + r] + grid[mid + l] + grid[mid + r] + grid[dn + l] + grid[dn + x] + grid[dn + r];
			const i = mid + x;
			let v = n === 3 || (n === 2 && grid[i]) ? 1 : 0;
			if (v && Math.random() < (1 - calmOf[i]) * 0.08) v = 0;
			next[i] = v;
			pop += v;
		}
	}
	const t = grid;
	grid = next;
	next = t;
	if (pop < total * 0.05) outerBurst();
}

// The cell under a screen point, undoing the tilt and the wave
function cellAt(sx, sy) {
	let gx = Math.round((sx - ox) / CELL_SIZE), gy = Math.round((sy - oy) / CELL_SIZE);
	if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) return -1;
	const i = gy * cols + gx;
	gx = Math.round((sx - (ptX[i] - (ox + gx * CELL_SIZE)) - ox) / CELL_SIZE);
	gy = Math.round((sy - (ptY[i] - (oy + gy * CELL_SIZE)) - oy) / CELL_SIZE);
	return gx < 0 || gy < 0 || gx >= cols || gy >= rows ? -1 : gy * cols + gx;
}

function frame(now) {
	requestAnimationFrame(frame);
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const sdt = dt * (reduced ? 0.2 : 1);
	time = (time + sdt * WAVE_SPEED) % (TAU * 100);
	mouse.amount = Math.max(0, mouse.amount - dt * 0.5);
	// The tilt follows a moving cursor and settles back to level once it rests
	const tx = mouse.amount > 0 ? mouse.x - w / 2 : 0, ty = mouse.amount > 0 ? mouse.y - h / 2 : 0, ease = Math.min(1, dt * (mouse.amount > 0 ? 3 : 0.8));
	mouse.px += (tx - mouse.px) * ease;
	mouse.py += (ty - mouse.py) * ease;

	acc += sdt;
	if (acc >= TICK) {
		acc = Math.min(acc - TICK, TICK);
		if (mouse.amount > 0.5 && !reduced) {
			const c = cellAt(mouse.x, mouse.y);
			if (c >= 0) { grid[c] = 1; grid[(c + 1) % total] = Math.random() < 0.5 ? 1 : 0; grid[(c + cols) % total] = Math.random() < 0.5 ? 1 : 0; }
		}
		step();
	}
	if (RESEED_EVERY > 0 && (reseed += sdt) >= RESEED_EVERY) { reseed = 0; outerBurst(); }

	const f = 1 - Math.exp(-FADE * dt * (reduced ? 0.5 : 1)), par = 0.08 * PARALLAX;
	for (let y = 0; y < rows; y++) {
		const tiltX = mouse.px * par * ((y - rows / 2) / rows);
		for (let x = 0; x < cols; x++) {
			const i = y * cols + x;
			vis[i] += (grid[i] - vis[i]) * f;
			ptX[i] = ox + x * CELL_SIZE + tiltX;
			ptY[i] = oy + y * CELL_SIZE + Math.sin(dist[i] - time) * WAVE + mouse.py * par * ((x - cols / 2) / cols);
		}
	}

	ctx.clearRect(0, 0, w, h);
	const la = dark ? 1 : 0.75;
	// The empty lattice as a faint breathing fabric, erased over the column before life is drawn
	if (FABRIC > 0) {
		ctx.beginPath();
		for (let y = 0; y < rows; y++) {
			ctx.moveTo(ptX[y * cols], ptY[y * cols]);
			for (let x = 1; x < cols; x++) ctx.lineTo(ptX[y * cols + x], ptY[y * cols + x]);
		}
		for (let x = 0; x < cols; x++) {
			ctx.moveTo(ptX[x], ptY[x]);
			for (let y = 1; y < rows; y++) ctx.lineTo(ptX[y * cols + x], ptY[y * cols + x]);
		}
		ctx.strokeStyle = col.fabric;
		ctx.lineWidth = 1;
		ctx.globalAlpha = Math.min(1, FABRIC * (dark ? 0.09 : 0.08));
		ctx.stroke();
		ctx.globalCompositeOperation = 'destination-out';
		ctx.globalAlpha = 1;
		ctx.fillStyle = mask;
		ctx.fillRect(0, 0, w, h);
		ctx.globalCompositeOperation = 'source-over';
	}
	// Bonds, one path per color step: right, down and diagonal neighbors that are both alive
	ctx.lineWidth = 1;
	for (let k = 0; k < K; k++) {
		ctx.beginPath();
		for (let y = 0; y < rows - 1; y++) {
			for (let x = 0; x < cols - 1; x++) {
				const i = y * cols + x, v = vis[i] * calmOf[i];
				if (vis[i] < 0.05 || Math.min(K - 1, (v * K) | 0) !== k) continue;
				const r = i + 1, b = i + cols, d = b + 1;
				if (vis[r] > 0.05) { ctx.moveTo(ptX[i], ptY[i]); ctx.lineTo(ptX[r], ptY[r]); }
				if (vis[b] > 0.05) { ctx.moveTo(ptX[i], ptY[i]); ctx.lineTo(ptX[b], ptY[b]); }
				if (vis[d] > 0.05) { ctx.moveTo(ptX[i], ptY[i]); ctx.lineTo(ptX[d], ptY[d]); }
			}
		}
		ctx.strokeStyle = col.bond[k];
		ctx.globalAlpha = ((k + 0.5) / K) * 0.32 * la;
		ctx.stroke();
	}
	// Nodes on top, one path per color step
	const nr = CELL_SIZE * NODE_SIZE;
	for (let k = 0; k < K; k++) {
		ctx.beginPath();
		for (let i = 0; i < total; i++) {
			const v = vis[i];
			if (v < 0.05 || Math.min(K - 1, (v * calmOf[i] * K) | 0) !== k) continue;
			const r = Math.max(0.6, v * nr * (0.55 + 0.45 * calmOf[i]));
			ctx.moveTo(ptX[i] + r, ptY[i]);
			ctx.arc(ptX[i], ptY[i], r, 0, TAU);
		}
		ctx.fillStyle = col.node[k];
		ctx.globalAlpha = (0.15 + 0.75 * ((k + 0.5) / K)) * la;
		ctx.fill();
	}
	ctx.globalAlpha = 1;
}

self.onmessage = (e) => {
	const d = e.data;
	switch (d.type) {
		case 'init':
			canvas = d.canvas;
			ctx = canvas.getContext('2d');
			w = d.width;
			h = d.height;
			dpr = Math.min(d.dpr || 1, 2);
			reduced = !!d.reducedMotion;
			column = d.column || null;
			applyTheme(d.theme);
			size();
			requestAnimationFrame(frame);
			break;
		case 'resize':
			w = d.width;
			h = d.height;
			dpr = Math.min(d.dpr || 1, 2);
			if (canvas) size();
			break;
		case 'theme':
			applyTheme(d);
			break;
		case 'motion':
			reduced = !!d.reducedMotion;
			break;
		case 'layout':
			column = d.column || null;
			if (canvas) calmBuild();
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.amount = 1;
			break;
		case 'mousedown': {
			// A tap sows a small colony where it lands
			const c = cellAt(d.x, d.y);
			if (c >= 0) burst(c % cols, (c / cols) | 0, 3, 0.45);
			break;
		}
	}
};
