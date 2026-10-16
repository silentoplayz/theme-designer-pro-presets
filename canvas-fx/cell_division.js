/**
 * Title: Cell Division
 * Description: Translucent cells in the theme's accent colors grow, pinch in two and jostle in the outer thirds of the screen, keeping clear of the chat column, shying from the cursor and dividing when tapped.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const CELL_COUNT   = 32;     // most cells alive at once; the oldest fades away to make room (4-60)
const START_CELLS  = 14;     // cells at the start, at staggered ages (1-30)
const CELL_SIZE    = 34;     // radius of a full-grown cell, in px (12-60)
const CYCLE        = 16;     // average seconds from birth to division (4-60)
const SPEED        = 1;      // speed of growth, division and drift; 0 holds still (0-2)
const DRIFT        = 1;      // how much the cells wander (0-3)
const CURSOR_PUSH  = 1;      // how strongly cells shy from a moving cursor (0-3)
const MEMBRANE     = 1.6;    // membrane line width, in px (0.5-4)
const GLOW         = 1;      // strength of the cytoplasm glow (0-2)
const CENTER_CALM  = 0.8;    // how strongly cells avoid and fade over the chat column (0-1)
const BAND_WIDTH   = 520;    // half-width of the calm band around the chat column, in px (300-900)
const FOLLOW_THEME = true;   // take the colors from the theme's palette
const COLOR_A      = '#64c8b4'; // first lineage color when not following the theme
const COLOR_B      = '#5aa0dc'; // second lineage color
const COLOR_C      = '#a08cf0'; // third lineage color
/* ──────────────────────────────────────────── */

const MAX = 60, TAU = Math.PI * 2;
const F = (n) => new Float32Array(n);
const x = F(MAX), y = F(MAX), vx = F(MAX), vy = F(MAX), age = F(MAX), cyc = F(MAX), ang = F(MAX), ph = F(MAX);
const div = F(MAX), die = F(MAX), born = F(MAX), alive = new Uint8Array(MAX), hue = new Uint8Array(MAX);

let canvas, ctx, w = 0, h = 0, dpr = 1, last = 0, reduced = false, dark = true, clock = 0;
const mouse = { x: -10000, y: -10000, amount: 0 };
const col = { line: [], nuc: [], glow: [], plate: '' };

function rgbOf(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function css(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a === undefined ? 1 : a) + ')'; }
function band(px) { const t = Math.min(1, Math.max(0, (Math.abs(px - w / 2) / BAND_WIDTH - 0.55) / 0.7)); return 1 - t * t * (3 - 2 * t); }

// A soft cytoplasm disc with a brighter rim, drawn once per color
function sprite(c) {
	const s = new OffscreenCanvas(96, 96), g = s.getContext('2d'), gr = g.createRadialGradient(48, 48, 0, 48, 48, 48);
	gr.addColorStop(0, css(c, 0.35));
	gr.addColorStop(0.7, css(c, 0.55));
	gr.addColorStop(0.86, css(c, 0.8));
	gr.addColorStop(1, css(c, 0));
	g.fillStyle = gr;
	g.fillRect(0, 0, 96, 96);
	return s;
}

function applyTheme(t) {
	if (t) dark = t.dark !== false;
	const th = FOLLOW_THEME && t && t.colors ? t.colors : null;
	const text = rgbOf(th ? th.text : dark ? '#eef2f6' : '#1c222b');
	let cs = (th ? [th.accent, th.accent2, th.accent3] : [COLOR_A, COLOR_B, COLOR_C]).map(rgbOf);
	if (!th && !dark) cs = cs.map((c) => mix(c, text, 0.35));
	for (let i = 0; i < 3; i++) {
		col.line[i] = css(cs[i]);
		col.nuc[i] = css(mix(cs[i], text, dark ? 0.35 : 0.3));
		col.glow[i] = sprite(cs[i]);
	}
	col.plate = css(text);
}

function size() {
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	for (let i = 0; i < MAX; i++) {
		x[i] = Math.min(Math.max(x[i], CELL_SIZE), w - CELL_SIZE);
		y[i] = Math.min(Math.max(y[i], CELL_SIZE), h - CELL_SIZE);
	}
}

function add(px, py, a, c) {
	for (let i = 0; i < MAX; i++) {
		if (alive[i]) continue;
		alive[i] = 1;
		x[i] = px;
		y[i] = py;
		vx[i] = vy[i] = div[i] = die[i] = 0;
		age[i] = a;
		cyc[i] = CYCLE * (0.75 + Math.random() * 0.5);
		ang[i] = Math.random() * Math.PI;
		ph[i] = Math.random() * TAU;
		born[i] = clock - a;
		hue[i] = c;
		return i;
	}
	return -1;
}

function seed() {
	alive.fill(0);
	for (let k = 0; k < Math.min(START_CELLS, CELL_COUNT, MAX); k++) {
		const side = k % 2, px = side ? w - (0.04 + Math.random() * 0.26) * w : (0.04 + Math.random() * 0.26) * w;
		add(px, h * (0.1 + Math.random() * 0.8), Math.random() * CYCLE, k % 3);
	}
}

function radius(i) { const g = Math.min(1, age[i] / cyc[i]); return CELL_SIZE * (0.7 + 0.3 * g * (2 - g)); }

function update(dt) {
	let n = 0, waiting = false, dying = false, oldest = -1;
	for (let i = 0; i < MAX; i++) {
		if (!alive[i]) continue;
		n++;
		if (die[i] > 0) dying = true;
		if (div[i] > 0) n++;
		if (die[i] === 0 && div[i] === 0 && (oldest < 0 || born[i] < born[oldest])) oldest = i;
	}
	const cap = Math.min(CELL_COUNT, MAX), push = CURSOR_PUSH * mouse.amount * (reduced ? 0 : 1);
	for (let i = 0; i < MAX; i++) {
		if (!alive[i]) continue;
		if (die[i] > 0) {
			die[i] += dt / 4;
			if (die[i] >= 1) alive[i] = 0;
			continue;
		}
		age[i] += dt;
		if (div[i] > 0) {
			div[i] += dt / 3;
			if (div[i] >= 1) finish(i);
		} else if (age[i] >= cyc[i]) {
			if (n < cap) { div[i] = 0.001; n++; } else { waiting = true; age[i] = cyc[i]; }
		}
		vx[i] += (Math.random() - 0.5) * DRIFT * 40 * dt;
		vy[i] += (Math.random() - 0.5) * DRIFT * 40 * dt;
		const b = band(x[i]);
		if (b > 0) vx[i] += (x[i] < w / 2 ? -1 : 1) * b * CENTER_CALM * 30 * dt;
		const dx = x[i] - mouse.x, dy = y[i] - mouse.y, d2 = dx * dx + dy * dy;
		if (push > 0 && d2 < 32400 && d2 > 1) {
			const d = Math.sqrt(d2), f = (1 - d / 180) * push * 160 * dt;
			vx[i] += (dx / d) * f;
			vy[i] += (dy / d) * f;
		}
		const damp = Math.exp(-dt * 1.5);
		vx[i] *= damp;
		vy[i] *= damp;
		x[i] += vx[i] * dt;
		y[i] += vy[i] * dt;
		const r = radius(i) * (1 + 0.5 * div[i]);
		if (x[i] < r) { x[i] = r; vx[i] = Math.abs(vx[i]) * 0.5; }
		if (x[i] > w - r) { x[i] = w - r; vx[i] = -Math.abs(vx[i]) * 0.5; }
		if (y[i] < r) { y[i] = r; vy[i] = Math.abs(vy[i]) * 0.5; }
		if (y[i] > h - r) { y[i] = h - r; vy[i] = -Math.abs(vy[i]) * 0.5; }
	}
	// At the cap, the oldest cell fades away so a waiting cell can divide
	if (waiting && !dying && oldest >= 0) die[oldest] = 0.001;
	for (let i = 0; i < MAX; i++) {
		if (!alive[i] || die[i] > 0) continue;
		const ri = radius(i) * (1 + 0.5 * div[i]);
		for (let j = i + 1; j < MAX; j++) {
			if (!alive[j] || die[j] > 0) continue;
			const dx = x[j] - x[i], dy = y[j] - y[i], d2 = dx * dx + dy * dy, m = ri + radius(j) * (1 + 0.5 * div[j]);
			if (d2 >= m * m || d2 < 0.01) continue;
			const d = Math.sqrt(d2), o = (m - d) * 0.25, nx = dx / d, ny = dy / d;
			x[i] -= nx * o; y[i] -= ny * o; x[j] += nx * o; y[j] += ny * o;
			vx[i] -= nx * 6; vy[i] -= ny * 6; vx[j] += nx * 6; vy[j] += ny * 6;
		}
	}
}

// The mother becomes one daughter in place and the other takes a free slot
function finish(i) {
	const r = CELL_SIZE * 0.7, ux = Math.cos(ang[i]), uy = Math.sin(ang[i]), s = r * 0.85;
	const j = add(x[i] + ux * s, y[i] + uy * s, 0, hue[i]);
	x[i] -= ux * s;
	y[i] -= uy * s;
	age[i] = div[i] = 0;
	born[i] = clock;
	cyc[i] = CYCLE * (0.75 + Math.random() * 0.5);
	ang[i] = Math.random() * Math.PI;
	if (j >= 0) { vx[j] = ux * 12; vy[j] = uy * 12; ang[j] = Math.random() * Math.PI; }
	vx[i] = -ux * 12;
	vy[i] = -uy * 12;
}

function cell(i) {
	const c = hue[i], fade = 1 - die[i], calm = 1 - CENTER_CALM * band(x[i]);
	const a = calm * fade * (dark ? 1 : 0.8), wob = Math.sin(clock * 0.9 + ph[i]) * 1.2;
	const p = div[i], q = p > 0.35 ? (p - 0.35) / 0.65 : 0, e = q * q * (3 - 2 * q);
	const r0 = radius(i) * (1 - die[i] * 0.3), rd = r0 + (CELL_SIZE * 0.7 - r0) * e;
	const d = e * CELL_SIZE * 1.2, ux = Math.cos(ang[i]), uy = Math.sin(ang[i]);
	const ax = x[i] - (ux * d) / 2 + wob, ay = y[i] - (uy * d) / 2, bx = x[i] + (ux * d) / 2 + wob, by = y[i] + (uy * d) / 2;
	const R = rd * 1.08, two = d > 0.5;

	ctx.globalAlpha = a * GLOW * (dark ? 0.38 : 0.22);
	ctx.drawImage(col.glow[c], ax - R, ay - R, R * 2, R * 2);
	if (two) ctx.drawImage(col.glow[c], bx - R, by - R, R * 2, R * 2);

	// Membrane: one circle, or two that pinch at the cleavage furrow
	ctx.globalAlpha = a * (dark ? 0.7 : 0.6);
	ctx.strokeStyle = col.line[c];
	ctx.lineWidth = MEMBRANE;
	ctx.beginPath();
	if (two && d < rd * 2) {
		const th = Math.acos(d / (2 * rd)), an = ang[i];
		ctx.arc(ax, ay, rd, an + th, an + TAU - th);
		ctx.arc(bx, by, rd, an + Math.PI + th, an + Math.PI + TAU - th);
		ctx.closePath();
	} else {
		ctx.arc(ax, ay, rd, 0, TAU);
		if (two) { ctx.moveTo(bx + rd, by); ctx.arc(bx, by, rd, 0, TAU); }
	}
	ctx.stroke();

	// Organelles drifting slowly through the cytoplasm
	ctx.fillStyle = col.line[c];
	ctx.globalAlpha = a * (dark ? 0.45 : 0.4);
	ctx.beginPath();
	for (let k = 0; k < 6; k++) {
		const o = ph[i] + k * 1.7 + clock * (k % 2 ? 0.25 : -0.18), rr = rd * (0.48 + 0.12 * (k % 3));
		const ox = (k % 2 && two ? bx : ax) + Math.cos(o) * rr, oy = (k % 2 && two ? by : ay) + Math.sin(o) * rr;
		ctx.moveTo(ox + 1.3, oy);
		ctx.arc(ox, oy, 1.3, 0, TAU);
	}
	ctx.fill();

	// Nucleus, or the chromosomes lining up across the middle before the split
	ctx.fillStyle = col.nuc[c];
	ctx.globalAlpha = a * (dark ? 0.6 : 0.5);
	if (p > 0 && p < 0.35) {
		const k = p / 0.35, len = r0 * 0.45 * k, nr = r0 * 0.3 * (1 - k);
		if (nr > 0.5) { ctx.beginPath(); ctx.arc(ax, ay, nr, 0, TAU); ctx.fill(); }
		ctx.strokeStyle = col.nuc[c];
		ctx.lineWidth = 3;
		ctx.lineCap = 'round';
		ctx.beginPath();
		ctx.moveTo(x[i] + wob - uy * len, y[i] + ux * len);
		ctx.lineTo(x[i] + wob + uy * len, y[i] - ux * len);
		ctx.stroke();
		return;
	}
	const nr = rd * 0.3 * (p > 0 ? Math.min(1, e * 1.5) : 1);
	ctx.beginPath();
	ctx.arc(ax, ay, nr, 0, TAU);
	if (two) { ctx.moveTo(bx + nr, by); ctx.arc(bx, by, nr, 0, TAU); }
	ctx.fill();
	ctx.fillStyle = col.plate;
	ctx.globalAlpha = a * (dark ? 0.35 : 0.25);
	ctx.beginPath();
	ctx.arc(ax + nr * 0.3, ay - nr * 0.25, nr * 0.28, 0, TAU);
	ctx.fill();
}

function frame(now) {
	requestAnimationFrame(frame);
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const sdt = dt * SPEED * (reduced ? 0.2 : 1);
	clock += sdt;
	mouse.amount = Math.max(0, mouse.amount - dt * 0.7);
	if (sdt > 0) update(sdt);
	ctx.clearRect(0, 0, w, h);
	for (let i = 0; i < MAX; i++) if (alive[i]) cell(i);
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
			applyTheme(d.theme);
			size();
			seed();
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
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.amount = 1;
			break;
		case 'mousedown': {
			// A tap near a cell starts its division early, when there is room
			if (reduced) break;
			let best = -1, bd = 25600;
			for (let i = 0; i < MAX; i++) {
				if (!alive[i] || div[i] > 0 || die[i] > 0) continue;
				const dd = (x[i] - d.x) ** 2 + (y[i] - d.y) ** 2;
				if (dd < bd) { bd = dd; best = i; }
			}
			if (best >= 0) age[best] = Math.max(age[best], cyc[best]);
			break;
		}
	}
};
