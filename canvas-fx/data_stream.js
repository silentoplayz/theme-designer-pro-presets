/**
 * Title: Data Stream
 * Description: Packets of light in your theme's accents stream along faint horizontal lanes like network traffic, dim behind the chat, swirl around the cursor and ping out from a tap.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const LANE_GAP      = 14;    // distance between lanes, in px (8-40)
const PACKETS       = 280;   // most packets on screen at once (40-400)
const SPAWN_RATE    = 34;    // new packets per second (2-60)
const SPEED         = 1;     // travel speed; 0 holds the traffic still (0-3)
const REDUCED_SPEED = 0.15;  // share of the speed kept when the viewer asks to reduce motion (0-1)
const RIGHTWARD     = 0.7;   // share of lanes flowing left to right (0-1)
const BRIGHTNESS    = 1;     // strength of the packets (0.2-1.5)
const LANE_LINES    = 0.5;   // strength of the faint lane lines (0-1)
const CENTER_CALM   = 0.8;   // how much the traffic dims behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const VORTEX        = 1;     // how strongly packets swirl around the cursor (0-3)
const VORTEX_RADIUS = 180;   // reach of the swirl, in px (60-400)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const COLOR_A       = '#3cb4dc';  // first packet color when not following the theme
const COLOR_B       = '#3c7cdc';  // second packet color
const COLOR_C       = '#62d8f2';  // third packet color
const LINE_COLOR    = '#1e6e96';  // lane lines
/* ──────────────────────────────────────────── */

const MAX = 400;
const CAP = Math.max(1, Math.min(MAX, Math.round(PACKETS)));
const TONES = 3;
const MAX_LANES = 256;

let canvas, ctx;
let w = 0, h = 0, dpr = 1, laneCount = 1;
let last = 0, reduced = false, dark = true, spawnAcc = 0, count = 0, column = null;
const mouse = { x: -10000, y: -10000, amount: 0, target: 0 };

// Packet pool
const px = new Float32Array(MAX), py = new Float32Array(MAX), baseY = new Float32Array(MAX);
const pw = new Float32Array(MAX), ph = new Float32Array(MAX);
const vx = new Float32Array(MAX), vy = new Float32Array(MAX), ox = new Float32Array(MAX);
const pa = new Float32Array(MAX), boost = new Float32Array(MAX);
const tone = new Uint8Array(MAX);
// Lanes
const laneY = new Float32Array(MAX_LANES), laneV = new Float32Array(MAX_LANES), laneDepth = new Float32Array(MAX_LANES);

let colors = { tones: [COLOR_A, COLOR_B, COLOR_C].map(hexToRgb), line: hexToRgb(LINE_COLOR) };
const sprites = [];   // [tone * 2 + (leftward ? 1 : 0)]
let laneStyle = null;

function hexToRgb(hex) {
	const n = parseInt(String(hex).slice(1, 7), 16) || 0;
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(c, a) {
	return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')';
}

// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }

function calm(x) {
	const d = Math.abs(x - colX()) / colHalf();
	const s = Math.min(1, Math.max(0, (d - 0.55) / 0.7));
	return 1 - CENTER_CALM * (1 - s * s * (3 - 2 * s));
}

function applyTheme(t) {
	if (!t) return;
	dark = t.dark !== false;
	if (FOLLOW_THEME && t.colors) {
		const c = t.colors;
		colors = { tones: [hexToRgb(c.accent), hexToRgb(c.accent3), hexToRgb(c.accent2)], line: hexToRgb(c.muted) };
	}
	build();
}

// Packet sprites (a bright head, a fading tail, a soft halo) and the lane-line gradient, rebuilt on theme, resize and layout
function build() {
	if (!ctx || !w) return;
	for (let k = 0; k < TONES; k++) {
		const c = colors.tones[k];
		for (let dir = 0; dir < 2; dir++) {
			const sp = sprites[k * 2 + dir] || new OffscreenCanvas(96, 16);
			const g = sp.getContext('2d');
			g.clearRect(0, 0, 96, 16);
			const head = dir ? 0 : 96;
			const body = g.createLinearGradient(96 - head, 0, head, 0);
			body.addColorStop(0, rgba(c, 0));
			body.addColorStop(0.45, rgba(c, 0.5));
			body.addColorStop(0.97, rgba(c, 1));
			body.addColorStop(1, rgba(c, 0.6));
			g.fillStyle = body;
			g.globalAlpha = dark ? 0.25 : 0.14;
			g.fillRect(0, 2, 96, 12);
			g.globalAlpha = 1;
			g.fillRect(0, 6, 96, 4);
			sprites[k * 2 + dir] = sp;
		}
	}
	const lg = ctx.createLinearGradient(0, 0, w, 0);
	const la = LANE_LINES * (dark ? 0.09 : 0.08);
	for (let s = 0; s <= 16; s++) lg.addColorStop(s / 16, rgba(colors.line, la * calm((s / 16) * w)));
	laneStyle = lg;
}

function spawn(atX, lane, dirSign, bright) {
	if (count >= CAP) return;
	const i = count++;
	const l = lane >= 0 ? lane : (Math.random() * laneCount) | 0;
	const dir = dirSign || (laneV[l] > 0 ? 1 : -1);
	const depth = laneDepth[l];
	pw[i] = (10 + Math.random() * 44) * (0.6 + depth * 0.6);
	ph[i] = (1.4 + Math.random() * 1.8) * (0.7 + depth * 0.5);
	baseY[i] = laneY[l];
	py[i] = laneY[l] + (Math.random() - 0.5) * LANE_GAP * 0.35;
	vx[i] = Math.abs(laneV[l]) * dir * (0.7 + Math.random() * 0.6);
	vy[i] = 0;
	ox[i] = 0;
	px[i] = atX !== undefined ? atX : dir > 0 ? -pw[i] : w + pw[i];
	pa[i] = (0.5 + Math.random() * 0.5) * (0.55 + depth * 0.45);
	boost[i] = bright ? 1 : 0;
	tone[i] = (Math.random() * TONES) | 0;
}

function kill(i) {
	const j = --count;
	if (i === j) return;
	px[i] = px[j]; py[i] = py[j]; baseY[i] = baseY[j]; pw[i] = pw[j]; ph[i] = ph[j];
	vx[i] = vx[j]; vy[i] = vy[j]; ox[i] = ox[j]; pa[i] = pa[j]; boost[i] = boost[j]; tone[i] = tone[j];
}

function layout() {
	laneCount = Math.max(1, Math.min(MAX_LANES, Math.floor(h / LANE_GAP)));
	for (let l = 0; l < laneCount; l++) {
		laneY[l] = (l + 0.5) * (h / laneCount);
		laneDepth[l] = Math.random();
		laneV[l] = (30 + Math.random() * 150) * (0.5 + laneDepth[l] * 0.7) * (Math.random() < RIGHTWARD ? 1 : -1);
	}
	count = 0;
	for (let k = 0; k < CAP * 0.6; k++) spawn(Math.random() * w, -1, 0, false);
}

function size(nw, nh, ndpr) {
	w = nw;
	h = nh;
	dpr = Math.min(2, ndpr || 1);
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	layout();
	build();
}

function frame(now) {
	requestAnimationFrame(frame);
	if (!ctx || !laneStyle) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const pace = SPEED * (reduced ? REDUCED_SPEED : 1);
	mouse.target = Math.max(0, mouse.target - dt * 0.6);
	mouse.amount += (mouse.target - mouse.amount) * Math.min(1, dt * 3);

	spawnAcc += SPAWN_RATE * dt * Math.min(1, pace);
	while (spawnAcc >= 1) { spawn(undefined, -1, 0, false); spawnAcc--; }

	const swirl = VORTEX * mouse.amount * (reduced ? 0.3 : 1) * 260;
	const r = VORTEX_RADIUS;
	const spring = Math.min(1, dt * 4);
	for (let i = count - 1; i >= 0; i--) {
		const dx = px[i] - mouse.x, dy = py[i] - mouse.y;
		const d2 = dx * dx + dy * dy;
		if (swirl > 0 && d2 < r * r && d2 > 1) {
			// Swirl: push along the tangent; the extra speed relaxes back, so packets never stall or reverse for good
			const d = Math.sqrt(d2);
			const f = (1 - d / r) * swirl * dt;
			vy[i] += dx / d * f;
			ox[i] -= dy / d * f * 0.5;
		}
		vy[i] += (baseY[i] - py[i]) * 6 * dt;
		vy[i] *= 1 - spring * 0.5;
		ox[i] *= 1 - spring * 0.4;
		boost[i] = Math.max(0, boost[i] - dt * 0.6);
		px[i] += (vx[i] + ox[i]) * pace * dt;
		py[i] += vy[i] * dt;
		if ((vx[i] > 0 && px[i] > w + pw[i] + 10) || (vx[i] < 0 && px[i] < -pw[i] - 10) || py[i] < -40 || py[i] > h + 40) kill(i);
	}

	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'source-over';
	ctx.clearRect(0, 0, w, h);

	if (LANE_LINES > 0) {
		ctx.strokeStyle = laneStyle;
		ctx.lineWidth = dpr > 1 ? 0.5 : 1;
		ctx.beginPath();
		for (let l = 0; l < laneCount; l++) {
			ctx.moveTo(0, laneY[l]);
			ctx.lineTo(w, laneY[l]);
		}
		ctx.stroke();
	}

	ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
	const base = BRIGHTNESS * (dark ? 1 : 1.3);
	for (let i = 0; i < count; i++) {
		const len = pw[i], hh = ph[i] * 4;
		const a = Math.min(1, (pa[i] + boost[i]) * base * calm(px[i] + len * 0.5));
		if (a < 0.01) continue;
		ctx.globalAlpha = a;
		ctx.drawImage(sprites[tone[i] * 2 + (vx[i] < 0 ? 1 : 0)], px[i], py[i] - hh * 0.5, len, hh);
	}
	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'source-over';
}

self.onmessage = (e) => {
	const d = e.data;
	switch (d.type) {
		case 'init':
			canvas = d.canvas;
			ctx = canvas.getContext('2d');
			reduced = !!d.reducedMotion;
			column = d.column || null;
			if (d.theme) applyTheme(d.theme);
			size(d.width, d.height, d.dpr);
			requestAnimationFrame(frame);
			break;
		case 'resize':
			if (ctx) size(d.width, d.height, d.dpr);
			break;
		case 'theme':
			applyTheme(d);
			break;
		case 'motion':
			reduced = !!d.reducedMotion;
			break;
		case 'layout':
			column = d.column || null;
			build();
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.target = 1;
			break;
		case 'mousedown': {
			// A tap pings its lane: two bright packets leave the tap point in opposite directions
			if (reduced || !w) break;
			const l = Math.max(0, Math.min(laneCount - 1, Math.floor(d.y / (h / laneCount))));
			spawn(d.x, l, 1, true);
			spawn(d.x, l, -1, true);
			break;
		}
	}
};
