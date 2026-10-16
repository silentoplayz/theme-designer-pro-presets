/**
 * Title: Circuit Board
 * Description: Circuit traces grow along a grid at the sides of the screen, glow at their pads, retire and regrow, and carry signal pulses wherever the cursor passes or taps.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const GRID          = 20;    // grid the traces follow, in px (10-40)
const MAX_TRACES    = 48;    // traces on the board at once (10-80)
const GROW_SPEED    = 120;   // how fast a trace draws itself, in px per second (30-400)
const TRACE_LIFE    = 30;    // average seconds a finished trace stays before it retires (8-120)
const TRACE_ALPHA   = 0.3;   // visibility of finished traces (0.1-0.6)
const PULSE_SPEED   = 180;   // speed of signal pulses, in px per second (60-500)
const MAX_PULSES    = 24;    // signal pulses at once (0-40)
const CURSOR_REACH  = 150;   // how near the cursor must pass a pad to send a pulse, in px (50-300)
const MOTION        = 1;     // overall speed (0.2-2)
const REDUCED_SPEED = 0.3;   // share of the speed kept when the viewer asks to reduce motion (0-1)
const CENTER_CALM   = 0.92;  // how much traces fade behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const TRACE_COLOR   = '#00b4a0';  // finished trace color when not following the theme
const NODE_COLOR    = '#00dcb4';  // pad and growing trace color
const TIP_COLOR     = '#00ffdc';  // growing tip color
const PULSE_COLOR   = '#00ffc8';  // signal pulse color
/* ──────────────────────────────────────────── */

const MAX_PTS = 12;
const DIRS_X = [1, 0, -1, 0], DIRS_Y = [0, 1, 0, -1];
const FREE = 0, GROWING = 1, DONE = 2, FADING = 3;

let canvas, ctx;
let w = 0, h = 0, dpr = 1;
let last = 0, reduced = false, dark = true, spawnWait = 0, pulseWait = 0, column = null, insetL = 0, insetR = 0;
const mouse = { x: -10000, y: -10000, amount: 0, target: 0 };
const col = { trace: TRACE_COLOR, node: NODE_COLOR, tip: TIP_COLOR, pulse: PULSE_COLOR };
let tipSprite = null, pulseSprite = null;
// Trace pool: points, then per-trace state
const tx = new Float32Array(MAX_TRACES * MAX_PTS), ty = new Float32Array(MAX_TRACES * MAX_PTS);
const tn = new Uint8Array(MAX_TRACES), ts = new Uint8Array(MAX_TRACES), tseg = new Uint8Array(MAX_TRACES);
const tprog = new Float32Array(MAX_TRACES), tlife = new Float32Array(MAX_TRACES);
const talpha = new Float32Array(MAX_TRACES), tfade = new Float32Array(MAX_TRACES);
// Pulse pool: trace, segment, progress in px, life
const pt = new Int16Array(MAX_PULSES).fill(-1), pseg = new Uint8Array(MAX_PULSES);
const pprog = new Float32Array(MAX_PULSES), plife = new Float32Array(MAX_PULSES);

// A soft round glow in one color: the color filled, then masked by a radial falloff
function sprite(color, r) {
	const c = new OffscreenCanvas(r * 2, r * 2), g = c.getContext('2d');
	g.fillStyle = color;
	g.fillRect(0, 0, r * 2, r * 2);
	const grad = g.createRadialGradient(r, r, 0, r, r, r);
	grad.addColorStop(0, 'rgba(255,255,255,1)');
	grad.addColorStop(0.2, 'rgba(255,255,255,0.9)');
	grad.addColorStop(0.45, 'rgba(255,255,255,0.25)');
	grad.addColorStop(1, 'rgba(255,255,255,0)');
	g.globalCompositeOperation = 'destination-in';
	g.fillStyle = grad;
	g.fillRect(0, 0, r * 2, r * 2);
	return c;
}

function applyTheme(t) {
	if (t) {
		dark = t.dark !== false;
		if (FOLLOW_THEME && t.colors) {
			col.trace = t.colors.muted;
			col.node = t.colors.accent;
			col.tip = t.colors.accent2;
			col.pulse = t.colors.accent3;
		}
	}
	tipSprite = sprite(col.tip, 12);
	pulseSprite = sprite(col.pulse, 12);
}

// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }

function band(x) {
	const b = Math.abs(x - colX()) / colHalf();
	const s = Math.min(1, Math.max(0, (b - 0.55) / 0.7));
	return 1 - CENTER_CALM * (1 - s * s * (3 - 2 * s));
}

// The chat area's edges as insets from the screen's, so a board laid on resize, before the next layout message, still fits the new width
function setArea(width) { insetL = column ? column.left : 0; insetR = column ? Math.max(0, width - column.right) : 0; }

const snap = (v) => Math.round(v / GRID) * GRID;

// Lays a new trace inside one side's region, turning 90 degrees at each joint and never doubling onto itself
function lay(i) {
	// Inside the chat area, which leaves out the sidebar
	const inner = colHalf() * 0.5, cx = colX(), lo = insetL, hi = w - insetR;
	const left = Math.random() < 0.5;
	let x0 = left ? lo + GRID : cx + inner, x1 = left ? cx - inner : hi - GRID;
	if (x1 - x0 < GRID * 4) { x0 = lo + GRID; x1 = hi - GRID; }
	let x = snap(x0 + Math.random() * (x1 - x0)), y = snap(GRID + Math.random() * (h - GRID * 2));
	let dir = Math.floor(Math.random() * 4);
	const o = i * MAX_PTS, want = 4 + Math.floor(Math.random() * (MAX_PTS - 4));
	tx[o] = x; ty[o] = y;
	let n = 1;
	for (let tries = 0; n < want && tries < want * 3; tries++) {
		const len = (2 + Math.floor(Math.random() * 7)) * GRID;
		let nx = x + DIRS_X[dir] * len, ny = y + DIRS_Y[dir] * len;
		// Bounce off the region's edge rather than pile up along it
		if (nx < x0 || nx > x1 || ny < GRID || ny > h - GRID) { nx = x - DIRS_X[dir] * len; ny = y - DIRS_Y[dir] * len; }
		dir = (dir + (Math.random() < 0.5 ? 1 : 3)) % 4;
		if (nx < x0 || nx > x1 || ny < GRID || ny > h - GRID) continue;
		x = snap(nx); y = snap(ny);
		tx[o + n] = x; ty[o + n] = y;
		n++;
	}
	tn[i] = n;
	tseg[i] = 0;
	tprog[i] = 0;
	tfade[i] = 1;
	talpha[i] = TRACE_ALPHA * (0.6 + Math.random() * 0.4) * band(tx[o]);
	tlife[i] = TRACE_LIFE * (0.6 + Math.random() * 0.8);
	ts[i] = n > 1 ? GROWING : FREE;
}

function segLen(i, s) {
	const o = i * MAX_PTS + s;
	return Math.abs(tx[o + 1] - tx[o]) + Math.abs(ty[o + 1] - ty[o]);
}

// A full board at start and after each resize, its traces at staggered ages so they retire one by one
function seed() {
	ts.fill(FREE);
	pt.fill(-1);
	for (let i = 0; i < Math.floor(MAX_TRACES * 0.7); i++) {
		lay(i);
		if (ts[i] === FREE) continue;
		ts[i] = DONE;
		tseg[i] = tn[i] - 1;
		tlife[i] *= Math.random();
	}
}

// After the chat column moves, traces that now cross it or sit outside the chat area retire and regrow beside it
function clearColumn() {
	const a = colX() - colHalf() * 0.5, b = colX() + colHalf() * 0.5, lo = insetL, hi = w - insetR;
	for (let i = 0; i < MAX_TRACES; i++) {
		if (ts[i] !== DONE && ts[i] !== GROWING) continue;
		for (let k = 0, o = i * MAX_PTS; k < tn[i]; k++) {
			if ((tx[o + k] > a && tx[o + k] < b) || tx[o + k] < lo || tx[o + k] > hi) { ts[i] = FADING; break; }
		}
	}
}

function resize(width, height, ratio) {
	w = width;
	h = height;
	dpr = Math.min(ratio || 1, 2);
	if (!canvas) return;
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	seed();
}

// Sends one pulse down the trace with a pad nearest to (x, y), if any is within reach
function pulseNear(x, y) {
	let best = -1, bestD = CURSOR_REACH * CURSOR_REACH;
	for (let i = 0; i < MAX_TRACES; i++) {
		if (ts[i] !== DONE) continue;
		for (let k = 0, o = i * MAX_PTS; k < tn[i]; k++) {
			const dx = tx[o + k] - x, dy = ty[o + k] - y, d = dx * dx + dy * dy;
			if (d < bestD) { bestD = d; best = i; }
		}
	}
	if (best < 0) return;
	for (let p = 0; p < MAX_PULSES; p++) {
		if (pt[p] >= 0) continue;
		pt[p] = best; pseg[p] = 0; pprog[p] = 0; plife[p] = 1;
		return;
	}
}

function update(dt) {
	const speed = dt * MOTION * (reduced ? REDUCED_SPEED : 1);
	let growing = 0, oldest = -1;
	for (let i = 0; i < MAX_TRACES; i++) {
		if (ts[i] === GROWING) {
			growing++;
			tprog[i] += GROW_SPEED * speed;
			while (ts[i] === GROWING && tprog[i] >= segLen(i, tseg[i])) {
				tprog[i] -= segLen(i, tseg[i]);
				if (++tseg[i] >= tn[i] - 1) ts[i] = DONE;
			}
		} else if (ts[i] === DONE) {
			tlife[i] -= speed;
			if (tlife[i] <= 0) ts[i] = FADING;
			if (oldest < 0 || tlife[i] < tlife[oldest]) oldest = i;
		} else if (ts[i] === FADING) {
			tfade[i] -= speed * 0.4;
			if (tfade[i] <= 0) ts[i] = FREE;
		}
	}
	spawnWait -= speed;
	if (spawnWait <= 0 && growing < 3) {
		spawnWait = 0.4 + Math.random() * 0.6;
		const slot = ts.indexOf(FREE);
		if (slot >= 0) lay(slot);
		else if (oldest >= 0) ts[oldest] = FADING; // a full board retires its oldest trace so a new one can grow
	}
	pulseWait -= dt;
	if (mouse.amount > 0.3 && pulseWait <= 0) {
		pulseWait = 0.25;
		pulseNear(mouse.x, mouse.y);
	}
	for (let p = 0; p < MAX_PULSES; p++) {
		const i = pt[p];
		if (i < 0) continue;
		if (ts[i] === FREE) { pt[p] = -1; continue; }
		pprog[p] += PULSE_SPEED * speed;
		while (pt[p] >= 0 && pprog[p] >= segLen(i, pseg[p])) {
			pprog[p] -= segLen(i, pseg[p]);
			if (++pseg[p] >= tn[i] - 1) pt[p] = -1;
		}
		plife[p] -= speed * 0.15;
		if (plife[p] <= 0) pt[p] = -1;
	}
}

// Path of a trace up to its growth point; returns the tip's position through tip[]
const tip = new Float32Array(2);
function path(i) {
	const o = i * MAX_PTS, s = tseg[i];
	ctx.moveTo(tx[o], ty[o]);
	for (let k = 1; k <= s; k++) ctx.lineTo(tx[o + k], ty[o + k]);
	if (ts[i] === GROWING) {
		const len = segLen(i, s) || 1, f = Math.min(1, tprog[i] / len);
		tip[0] = tx[o + s] + (tx[o + s + 1] - tx[o + s]) * f;
		tip[1] = ty[o + s] + (ty[o + s + 1] - ty[o + s]) * f;
		ctx.lineTo(tip[0], tip[1]);
	}
}

function draw() {
	ctx.clearRect(0, 0, w, h);
	const k = dark ? 1 : 0.8;
	ctx.lineWidth = 1.5;
	ctx.lineJoin = 'round';
	for (let i = 0; i < MAX_TRACES; i++) {
		if (ts[i] === FREE) continue;
		const a = talpha[i] * tfade[i] * k;
		ctx.globalAlpha = ts[i] === GROWING ? Math.min(1, a * 1.8) : a;
		ctx.strokeStyle = ts[i] === GROWING ? col.node : col.trace;
		ctx.beginPath();
		path(i);
		ctx.stroke();
		// Pads at each joint, brighter where the cursor is
		ctx.fillStyle = col.node;
		const o = i * MAX_PTS, end = ts[i] === GROWING ? tseg[i] : tn[i] - 1;
		for (let n = 0; n <= end; n++) {
			const dx = tx[o + n] - mouse.x, dy = ty[o + n] - mouse.y;
			const near = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 120) * mouse.amount;
			ctx.globalAlpha = Math.min(1, a * (1.6 + near * 2.5));
			const r = n === 0 || n === tn[i] - 1 ? 2.5 : 1.75;
			ctx.fillRect(tx[o + n] - r, ty[o + n] - r, r * 2, r * 2);
		}
		if (ts[i] === GROWING) {
			ctx.globalAlpha = Math.min(1, band(tip[0]) * (dark ? 0.9 : 0.7));
			ctx.drawImage(tipSprite, tip[0] - 12, tip[1] - 12);
		}
	}
	for (let p = 0; p < MAX_PULSES; p++) {
		const i = pt[p];
		if (i < 0) continue;
		const o = i * MAX_PTS + pseg[p];
		const f = Math.min(1, pprog[p] / (segLen(i, pseg[p]) || 1));
		const x = tx[o] + (tx[o + 1] - tx[o]) * f, y = ty[o] + (ty[o + 1] - ty[o]) * f;
		ctx.globalAlpha = Math.min(1, plife[p] * 1.5) * tfade[i] * band(x) * (dark ? 0.95 : 0.75);
		ctx.drawImage(pulseSprite, x - 12, y - 12);
	}
	ctx.globalAlpha = 1;
}

function frame(now) {
	requestAnimationFrame(frame);
	if (!ctx) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	mouse.target = Math.max(0, mouse.target - dt * 0.8);
	mouse.amount += (mouse.target - mouse.amount) * Math.min(1, dt * 5);
	update(dt);
	draw();
}

self.onmessage = (e) => {
	const d = e.data;
	switch (d.type) {
		case 'init':
			canvas = d.canvas;
			ctx = canvas.getContext('2d');
			reduced = !!d.reducedMotion;
			column = d.column || null;
			setArea(d.width);
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
		case 'layout':
			column = d.column || null;
			setArea(w);
			if (canvas) clearColumn();
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.target = 1;
			break;
		case 'mousedown':
			// A tap sends a few pulses from the pads around it; one when motion is reduced
			for (let n = reduced ? 1 : 3; n > 0; n--) pulseNear(d.x + (Math.random() - 0.5) * 60, d.y + (Math.random() - 0.5) * 60);
			break;
	}
};
