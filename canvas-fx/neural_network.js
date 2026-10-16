/**
 * Title: Neural Network
 * Description: Layers of drifting nodes linked by faint connections, with pulses of light that travel between them and set off cascades, sent by the cursor and by a tap.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const LAYERS        = 6;     // layers of nodes across the screen (3-9)
const NODE_RADIUS   = 4;     // size of a node, in px (2-8)
const LINK_ALPHA    = 0.26;  // visibility of the connections (0.05-0.5)
const MAX_PULSES    = 80;    // pulses in flight at once (10-150)
const PULSE_SPEED   = 0.9;   // how fast pulses travel, in connections per second (0.2-3)
const FIRE_EVERY    = 0.6;   // average seconds between spontaneous firings; 0 turns them off (0-10)
const CASCADE       = 0.35;  // chance an arriving pulse fires onward along each link (0-0.8)
const DRIFT         = 18;    // how far nodes wander from their place, in px (0-60)
const MOTION        = 1;     // overall speed (0.2-2)
const REDUCED_SPEED = 0.3;   // share of the speed kept when the viewer asks to reduce motion (0-1)
const CURSOR_REACH  = 200;   // how near the cursor must come to wake a node, in px (60-400)
const CENTER_CALM   = 0.8;   // how much the network fades behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const LINK_COLOR    = '#64a0ff';  // connection color when not following the theme
const NODE_COLOR    = '#78b4ff';  // node and pulse color
const GLOW_COLOR    = '#64b4ff';  // halo around energized nodes
const CORE_COLOR    = '#c8e6ff';  // bright center of energized nodes
/* ──────────────────────────────────────────── */

const MAX_NODES = 90, MAX_LINKS = 300;

let canvas, ctx;
let w = 0, h = 0, dpr = 1;
let last = 0, reduced = false, dark = true, fireWait = 1, wakeWait = 0, column = null;
let nodeCount = 0, linkCount = 0, firstOfLast = 0, inputs = 1;
const mouse = { x: -10000, y: -10000, amount: 0, target: 0 };
const col = { link: LINK_COLOR, node: NODE_COLOR, glow: GLOW_COLOR, core: CORE_COLOR };
let pulseSprite = null, haloSprite = null;
// Nodes: position, home, wander target, phase, energy, calm
const nx = new Float32Array(MAX_NODES), ny = new Float32Array(MAX_NODES);
const hx = new Float32Array(MAX_NODES), hy = new Float32Array(MAX_NODES);
const gx = new Float32Array(MAX_NODES), gy = new Float32Array(MAX_NODES);
const wait = new Float32Array(MAX_NODES), energy = new Float32Array(MAX_NODES), ncalm = new Float32Array(MAX_NODES);
// Links: from, to, weight; outgoing links of a node are contiguous (start index and count)
const lf = new Int16Array(MAX_LINKS), lt = new Int16Array(MAX_LINKS), lw = new Float32Array(MAX_LINKS), lc = new Float32Array(MAX_LINKS);
const outStart = new Int16Array(MAX_NODES), outCount = new Uint8Array(MAX_NODES);
// Pulses: link, progress 0-1, speed, brightness
const pl = new Int16Array(MAX_PULSES).fill(-1), pp = new Float32Array(MAX_PULSES);
const ps = new Float32Array(MAX_PULSES), pb = new Float32Array(MAX_PULSES);

// A soft round glow in one color: the color filled, then masked by a radial falloff
function sprite(color, r) {
	const c = new OffscreenCanvas(r * 2, r * 2), g = c.getContext('2d');
	g.fillStyle = color;
	g.fillRect(0, 0, r * 2, r * 2);
	const grad = g.createRadialGradient(r, r, 0, r, r, r);
	grad.addColorStop(0, 'rgba(255,255,255,1)');
	grad.addColorStop(0.2, 'rgba(255,255,255,0.8)');
	grad.addColorStop(0.5, 'rgba(255,255,255,0.2)');
	grad.addColorStop(1, 'rgba(255,255,255,0)');
	g.globalCompositeOperation = 'destination-in';
	g.fillStyle = grad;
	g.fillRect(0, 0, r * 2, r * 2);
	return c;
}

// Links take the muted color, nodes and pulses the accent, halos accent2, cores the text color
function applyTheme(t) {
	if (t) {
		dark = t.dark !== false;
		if (FOLLOW_THEME && t.colors) {
			col.link = t.colors.muted;
			col.node = t.colors.accent;
			col.glow = t.colors.accent2;
			col.core = dark ? t.colors.text : t.colors.accent3;
		}
	}
	pulseSprite = sprite(col.node, 12);
	haloSprite = sprite(col.glow, 16);
}

// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }

function band(x) {
	const b = Math.abs(x - colX()) / colHalf();
	const s = Math.min(1, Math.max(0, (b - 0.55) / 0.7));
	return 1 - CENTER_CALM * (1 - s * s * (3 - 2 * s));
}

function build() {
	nodeCount = linkCount = 0;
	pl.fill(-1);
	const layers = Math.max(2, Math.min(9, LAYERS));
	let prevStart = 0, prevCount = 0;
	// Free space left and right of the calm band inside the chat area, each at least an eighth of the screen wide (reaching into the band's fade when short)
	const lo = column ? column.left : 0, hi = column ? column.right : w;
	const m = w * 0.05, room = Math.max(80, w * 0.125), l0 = lo + m, l1 = Math.max(l0 + room, colX() - colHalf()), r1 = hi - m, r0 = Math.min(r1 - room, colX() + colHalf());
	for (let l = 0; l < layers; l++) {
		const edge = l === 0 || l === layers - 1;
		const count = Math.min(MAX_NODES - nodeCount, edge ? 3 + Math.floor(Math.random() * 3) : 5 + Math.floor(Math.random() * 5));
		const start = nodeCount;
		// Layers gather on either side of the chat column; long faint links bridge it from a middle layer
		const u = l / (layers - 1);
		const x = u < 0.5 ? l0 + (l1 - l0) * u * 1.7 : u > 0.5 ? r1 - (r1 - r0) * (1 - u) * 1.7 : colX();
		for (let n = 0; n < count; n++) {
			const i = nodeCount++;
			hx[i] = gx[i] = nx[i] = x + (Math.random() - 0.5) * 30;
			hy[i] = gy[i] = ny[i] = (h / (count + 1)) * (n + 1) + (Math.random() - 0.5) * 20;
			wait[i] = Math.random() * 10;
			energy[i] = 0;
			ncalm[i] = band(x);
		}
		// Sparse wiring from the previous layer: one to three links per node, to its neighbours across
		for (let p = prevStart; p < prevStart + prevCount && l > 0; p++) {
			outStart[p] = linkCount;
			const links = 1 + Math.floor(Math.random() * Math.min(3, count));
			const across = ((p - prevStart) / Math.max(1, prevCount - 1)) * (count - 1);
			const first = Math.round(across - (links - 1) / 2 + (Math.random() - 0.5) * 1.5);
			for (let k = 0; k < links && linkCount < MAX_LINKS; k++) {
				lf[linkCount] = p;
				lt[linkCount] = start + Math.min(count - 1, Math.max(0, first + k));
				lw[linkCount] = 0.3 + Math.random() * 0.7;
				lc[linkCount] = Math.min(ncalm[p], ncalm[lt[linkCount]], band((hx[p] + hx[lt[linkCount]]) / 2));
				linkCount++;
			}
			outCount[p] = linkCount - outStart[p];
		}
		if (l === 0) inputs = count;
		prevStart = start;
		prevCount = count;
	}
	firstOfLast = prevStart;
	for (let p = prevStart; p < nodeCount; p++) outCount[p] = 0;
}

function resize(width, height, ratio) {
	w = width;
	h = height;
	dpr = Math.min(ratio || 1, 2);
	if (!canvas) return;
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	build();
}

function fire(node, brightness, chance) {
	energy[node] = Math.min(1, energy[node] + 0.4 * brightness);
	for (let k = outStart[node], end = k + outCount[node]; k < end; k++) {
		if (Math.random() >= chance) continue;
		for (let p = 0; p < MAX_PULSES; p++) {
			if (pl[p] >= 0) continue;
			pl[p] = k; pp[p] = 0; ps[p] = PULSE_SPEED * (0.7 + Math.random() * 0.6); pb[p] = brightness;
			break;
		}
	}
}

function nearest(x, y, reach) {
	let best = -1, bestD = reach * reach;
	for (let i = 0; i < nodeCount; i++) {
		const dx = nx[i] - x, dy = ny[i] - y, d = dx * dx + dy * dy;
		if (d < bestD) { bestD = d; best = i; }
	}
	return best;
}

function update(dt) {
	const speed = dt * MOTION * (reduced ? REDUCED_SPEED : 1);
	const ease = 1 - Math.exp(-speed * 0.6);
	for (let i = 0; i < nodeCount; i++) {
		// Each node picks a new spot near home now and then, so the network slowly reorganizes
		wait[i] -= speed;
		if (wait[i] <= 0) {
			wait[i] = 6 + Math.random() * 10;
			gx[i] = hx[i] + (Math.random() - 0.5) * 2 * DRIFT;
			gy[i] = hy[i] + (Math.random() - 0.5) * 2 * DRIFT;
		}
		nx[i] += (gx[i] - nx[i]) * ease;
		ny[i] += (gy[i] - ny[i]) * ease;
		energy[i] *= Math.exp(-dt * 1.8);
	}
	if (FIRE_EVERY > 0) {
		fireWait -= speed;
		if (fireWait <= 0) {
			fireWait = FIRE_EVERY * (0.5 + Math.random());
			fire(Math.floor(Math.random() * inputs), 0.6 + Math.random() * 0.4, 0.5);
		}
	}
	// A moving cursor wakes the nearest node; a resting one does not
	wakeWait -= dt;
	if (mouse.amount > 0.4 && wakeWait <= 0) {
		wakeWait = 0.35;
		const n = nearest(mouse.x, mouse.y, CURSOR_REACH);
		if (n >= 0) fire(n, 0.6, 0.5);
	}
	for (let p = 0; p < MAX_PULSES; p++) {
		const k = pl[p];
		if (k < 0) continue;
		pp[p] += ps[p] * speed;
		if (pp[p] < 1) continue;
		pl[p] = -1;
		const to = lt[k];
		energy[to] = Math.min(1, energy[to] + 0.35 * pb[p]);
		if (pb[p] > 0.25 && to < firstOfLast) fire(to, pb[p] * 0.7, reduced ? CASCADE * 0.4 : CASCADE);
	}
}

function draw() {
	ctx.clearRect(0, 0, w, h);
	const k = dark ? 1 : 0.8;
	for (let i = 0; i < linkCount; i++) {
		const a = lf[i], b = lt[i];
		const calm = lc[i];
		ctx.globalAlpha = Math.min(1, (LINK_ALPHA * (0.5 + lw[i] * 0.5) + Math.max(energy[a], energy[b]) * 0.18) * calm * k);
		ctx.strokeStyle = col.link;
		ctx.lineWidth = 1 + lw[i] * 0.5;
		ctx.beginPath();
		ctx.moveTo(nx[a], ny[a]);
		ctx.lineTo(nx[b], ny[b]);
		ctx.stroke();
	}
	for (let p = 0; p < MAX_PULSES; p++) {
		const l = pl[p];
		if (l < 0) continue;
		const a = lf[l], b = lt[l], f = pp[p];
		const x = nx[a] + (nx[b] - nx[a]) * f, y = ny[a] + (ny[b] - ny[a]) * f;
		ctx.globalAlpha = Math.min(1, (0.4 + pb[p] * 0.6) * band(x) * k * Math.min(1, f * 6, (1 - f) * 6));
		ctx.drawImage(pulseSprite, x - 12, y - 12);
	}
	for (let i = 0; i < nodeCount; i++) {
		const e = energy[i], c = ncalm[i] * k;
		// Every node keeps a faint halo at rest, which swells when it fires
		ctx.globalAlpha = Math.min(1, (0.22 + e * 0.6) * c);
		ctx.drawImage(haloSprite, nx[i] - 16, ny[i] - 16);
		ctx.globalAlpha = Math.min(1, (0.55 + e * 0.45) * c);
		ctx.fillStyle = col.node;
		ctx.beginPath();
		ctx.arc(nx[i], ny[i], NODE_RADIUS, 0, 6.2832);
		ctx.fill();
		if (e > 0.1) {
			ctx.globalAlpha = Math.min(1, e * 0.8 * c);
			ctx.fillStyle = col.core;
			ctx.beginPath();
			ctx.arc(nx[i], ny[i], NODE_RADIUS * 0.5, 0, 6.2832);
			ctx.fill();
		}
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
			if (canvas) build();
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.target = 1;
			break;
		case 'mousedown': {
			// A tap fires the nearest node down every link; a single soft pulse when motion is reduced
			const n = nearest(d.x, d.y, CURSOR_REACH * 1.3);
			if (n >= 0) fire(n, reduced ? 0.5 : 1, reduced ? 0.4 : 1);
			break;
		}
	}
};
