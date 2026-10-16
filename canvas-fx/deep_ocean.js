/**
 * Title: Deep Ocean
 * Description: A seafloor in your theme's colors, with light shafts, glowing jellyfish, plankton, swaying kelp and caustics on the sand, kept to the sides of the chat; the cursor stirs the current and a tap sends a sonar ring.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const JELLY_COUNT   = 7;     // glowing jellyfish (0-16)
const KELP_STRANDS  = 12;    // kelp fronds along the floor (0-24)
const PLANKTON      = 120;   // tiny drifting particles (0-300)
const RAY_COUNT     = 5;     // shafts of light from the surface (0-10)
const CURRENT       = 1;     // speed of the whole scene; 0 holds it still (0-3)
const REDUCED_SPEED = 0.2;   // share of the speed kept when the viewer asks to reduce motion (0-1)
const MOUSE_CURRENT = 1;     // how strongly the cursor stirs the current and nudges the jellies (0-3)
const PULSE_EVERY   = 45;    // average seconds between distant sonar rings; 0 turns them off (0-300)
const WATER_TINT    = 1;     // strength of the light glow from the surface (0-2)
const CAUSTICS      = 1;     // strength of the caustic light on the sand (0-2)
const FLOOR_HEIGHT  = 0.15;  // height of the sandy floor, as a share of the screen (0.05-0.3)
const CENTER_CALM   = 0.75;  // how much the scene fades behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const WATER_COLOR   = '#3c96c8';  // surface glow and light shafts when not following the theme
const JELLY_A       = '#5ee0f0';  // first jellyfish color
const JELLY_B       = '#b27cf0';  // second jellyfish color
const KELP_COLOR    = '#3a6e28';  // kelp
const SAND_COLOR    = '#2a2e1e';  // sandy floor
/* ──────────────────────────────────────────── */

const TAU = Math.PI * 2;
const NJ = Math.min(16, JELLY_COUNT | 0), NK = Math.min(24, KELP_STRANDS | 0), NP = Math.min(300, PLANKTON | 0), NR = Math.min(10, RAY_COUNT | 0);
const SEGS = 12, TW = 160, TH = 80, RINGS = 4;

let canvas, ctx;
let w = 0, h = 0, dpr = 1, floorY = 0;
let last = 0, T = 0, reduced = false, dark = true, theme = null, nextPulse = PULSE_EVERY * 0.5, column = null;
const mouse = { x: -10000, y: -10000, amount: 0, target: 0 };

// Pools
const jx = new Float32Array(NJ), jy = new Float32Array(NJ), jsz = new Float32Array(NJ), jdepth = new Float32Array(NJ);
const jvx = new Float32Array(NJ), jrise = new Float32Array(NJ), jphase = new Float32Array(NJ), jtone = new Uint8Array(NJ), jtent = new Uint8Array(NJ);
const ppx = new Float32Array(NP), ppy = new Float32Array(NP), pps = new Float32Array(NP), ppd = new Float32Array(NP), ppa = new Float32Array(NP);
const rx = new Float32Array(NR), rw = new Float32Array(NR), rph = new Float32Array(NR), ra = new Float32Array(NR);
const kx = new Float32Array(NK), kh = new Float32Array(NK), kw = new Float32Array(NK), kph = new Float32Array(NK), kleaf = new Int8Array(NK * SEGS);
const kpx = new Float32Array(SEGS + 1), kpy = new Float32Array(SEGS + 1);
const ringX = new Float32Array(RINGS), ringY = new Float32Array(RINGS), ringR = new Float32Array(RINGS), ringA = new Float32Array(RINGS);

// Cached colors, gradients and sprites (rebuilt on theme change and resize)
const C = {};
let tint, rayGrad, calmMask, ringStyle, floorImg, caustic, glows = [];
let causticField = null;

function hexToRgb(hex) { const n = parseInt(String(hex).slice(1, 7), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) { return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * t)); }
function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')'; }
// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }

// Room beside the chat column on one side, at most reach of the screen wide
function room(right, reach) { const e = colX() + (right ? 1 : -1) * colHalf() * 0.5; return Math.max(40, Math.min(w * reach, right ? w - e : e)); }
// A spot in the outer thirds, or nearer the edge when the chat column leaves less room
function side() { return Math.random() < 0.5 ? Math.random() * room(false, 0.3) : w - Math.random() * room(true, 0.3); }
function band(x) { const d = Math.abs(x - colX()) / colHalf(), s = Math.min(1, Math.max(0, (d - 0.5) / 0.8)); return 1 - s * s * (3 - 2 * s); }

function palette() {
	const c = FOLLOW_THEME && theme && theme.colors ? theme.colors : null;
	if (c) {
		const a = hexToRgb(c.accent), a2 = hexToRgb(c.accent2), a3 = hexToRgb(c.accent3), tx = hexToRgb(c.text), mu = hexToRgb(c.muted), bg = hexToRgb(c.background);
		return { water: a3, ray: dark ? mix(a3, tx, 0.3) : a3, jelly: [a3, a2], core: dark ? tx : a, kelp: dark ? mix(mix(a3, mu, 0.5), bg, 0.3) : mix(a3, tx, 0.35), sand: dark ? mix(mu, bg, 0.6) : mix(mu, bg, 0.3), light: dark ? mix(a3, tx, 0.4) : bg, mote: dark ? mix(a3, tx, 0.5) : a3 };
	}
	const water = hexToRgb(WATER_COLOR);
	return { water, ray: mix(water, [255, 255, 255], 0.25), jelly: [hexToRgb(JELLY_A), hexToRgb(JELLY_B)], core: [220, 250, 255], kelp: hexToRgb(KELP_COLOR), sand: hexToRgb(SAND_COLOR), light: [80, 180, 220], mote: [140, 200, 220] };
}

function glowSprite(c) {
	const s = new OffscreenCanvas(64, 64), g = s.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
	gr.addColorStop(0, rgba(c, 0.6)); gr.addColorStop(0.4, rgba(c, 0.18)); gr.addColorStop(1, rgba(c, 0));
	g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
	return s;
}

// Wrapping cell-edge field for the caustic network, computed once
function buildField() {
	causticField = new Float32Array(TW * TH);
	const N = 11, sx = [], sy = [];
	for (let i = 0; i < N; i++) { sx.push(Math.random() * TW); sy.push(Math.random() * TH); }
	for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
		let f1 = 1e9, f2 = 1e9;
		for (let i = 0; i < N; i++) {
			// A periodic warp curves the cell edges like real caustics and keeps the tile seamless
			let dx = Math.abs(x + Math.sin(y / TH * TAU * 2) * 5 - sx[i]), dy = Math.abs(y + Math.sin(x / TW * TAU * 3) * 4 - sy[i]);
			if (dx > TW) dx -= TW;
			if (dx > TW / 2) dx = TW - dx;
			if (dy > TH / 2) dy = TH - dy;
			const d = Math.sqrt(dx * dx + dy * dy);
			if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
		}
		const e = Math.max(0, 1 - (f2 - f1) / 9);
		const v = y / TH; // fades in from the top of the floor, so the tile needs no mask
		causticField[y * TW + x] = e * e * e * Math.min(1, v * 3) * (1 - v * 0.3);
	}
}

// The calm band's mask, rebuilt on resize, theme and layout
function buildMask() {
	calmMask = ctx.createLinearGradient(0, 0, w, 0);
	for (let s = 0; s <= 40; s++) calmMask.addColorStop(s / 40, 'rgba(0,0,0,' + (CENTER_CALM * band((s / 40) * w)).toFixed(3) + ')');
}

// Light shafts and kelp stand beside the chat column, placed again when it moves
function placeSides() {
	const L = room(false, 0.31), R = room(true, 0.31);
	for (let i = 0; i < NR; i++) rx[i] = side();
	for (let i = 0; i < NK; i++) {
		const f = (i + 0.5) / NK;
		kx[i] = (f < 0.5 ? f * 2 * L : w - (1 - f) * 2 * R) + (Math.random() - 0.5) * 30;
	}
}

function build() {
	if (!ctx || !w) return;
	const p = palette();
	if (!causticField) buildField();
	const fh = h - floorY;
	tint = ctx.createLinearGradient(0, 0, 0, h * 0.7);
	tint.addColorStop(0, rgba(p.water, (dark ? 0.14 : 0.09) * WATER_TINT));
	tint.addColorStop(1, rgba(p.water, 0));
	rayGrad = ctx.createLinearGradient(0, 0, 0, floorY);
	rayGrad.addColorStop(0, rgba(p.ray, 0.5)); rayGrad.addColorStop(0.5, rgba(p.ray, 0.16)); rayGrad.addColorStop(1, rgba(p.ray, 0));
	buildMask();
	ringStyle = rgba(p.water, dark ? 0.6 : 0.5);
	glows = [glowSprite(p.jelly[0]), glowSprite(p.jelly[1])];
	C.bell = p.jelly.map((c) => rgba(c, dark ? 0.45 : 0.4));
	C.inner = p.jelly.map((c) => rgba(mix(c, p.core, 0.5), dark ? 0.5 : 0.35));
	C.tent = p.jelly.map((c) => rgba(c, dark ? 0.35 : 0.3));
	C.kelp = rgba(p.kelp, dark ? 0.8 : 0.55);
	C.leaf = rgba(mix(p.kelp, p.light, 0.15), dark ? 0.55 : 0.4);
	C.mote = rgba(p.mote, 1);
	// Floor (sand and soft dunes) and the caustic tile, pre-rendered once
	floorImg = new OffscreenCanvas(Math.ceil(w * dpr), Math.ceil((fh + 60) * dpr));
	const g = floorImg.getContext('2d');
	g.scale(dpr, dpr);
	const fg = g.createLinearGradient(0, 0, 0, fh + 60);
	fg.addColorStop(0, rgba(p.sand, 0)); fg.addColorStop(0.4, rgba(p.sand, dark ? 0.6 : 0.4)); fg.addColorStop(1, rgba(p.sand, dark ? 0.75 : 0.55));
	g.fillStyle = fg; g.fillRect(0, 0, w, fh + 60);
	g.fillStyle = rgba(mix(p.sand, p.light, 0.25), dark ? 0.25 : 0.2);
	for (let i = 0; i < 34; i++) {
		g.beginPath();
		g.ellipse((i / 34) * w + Math.sin(i * 4.7) * 20, 66 + Math.sin(i * 2.1) * 8, 22 + Math.sin(i * 3) * 10, 4, 0, 0, TAU);
		g.fill();
	}
	caustic = new OffscreenCanvas(TW, TH);
	const cg = caustic.getContext('2d'), img = cg.createImageData(TW, TH);
	for (let i = 0; i < TW * TH; i++) { img.data[i * 4] = p.light[0]; img.data[i * 4 + 1] = p.light[1]; img.data[i * 4 + 2] = p.light[2]; img.data[i * 4 + 3] = causticField[i] * 255; }
	cg.putImageData(img, 0, 0);
}

function spawnJelly(i, anywhere) {
	jdepth[i] = Math.random();
	jsz[i] = 12 + (1 - jdepth[i]) * 16 + Math.random() * 8;
	jx[i] = side();
	jy[i] = anywhere ? h * (0.08 + Math.random() * 0.6) : floorY + jsz[i] * 3;
	jvx[i] = 0;
	jrise[i] = 1.5 + Math.random() * 3.5;
	jphase[i] = Math.random() * TAU;
	jtone[i] = Math.random() < 0.5 ? 0 : 1;
	jtent[i] = 5 + ((Math.random() * 4) | 0);
}

function seed() {
	for (let i = 0; i < NJ; i++) spawnJelly(i, true);
	for (let i = 0; i < NP; i++) { ppx[i] = Math.random() * w; ppy[i] = Math.random() * h; pps[i] = 0.05 + Math.random() * 0.15; ppd[i] = Math.random() * TAU; ppa[i] = 0.15 + Math.random() * 0.35; }
	for (let i = 0; i < NR; i++) { rw[i] = 30 + Math.random() * 70; rph[i] = Math.random() * TAU; ra[i] = 0.04 + Math.random() * 0.05; }
	placeSides();
	for (let i = 0; i < NK; i++) {
		kh[i] = 0.18 + Math.random() * 0.22;
		kw[i] = 2 + Math.random() * 2.5;
		kph[i] = Math.random() * TAU;
		for (let s = 0; s < SEGS; s++) kleaf[i * SEGS + s] = s > 1 && Math.random() > 0.25 ? (s & 1 ? 1 : -1) : 0;
	}
}

function size(nw, nh, ndpr) {
	const sx = w ? nw / w : 1, sy = h ? nh / h : 1, had = w > 0;
	w = nw; h = nh;
	dpr = Math.min(2, ndpr || 1);
	floorY = h * (1 - FLOOR_HEIGHT);
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.lineCap = 'round';
	if (!had) seed();
	else {
		// Keep the scene on a resize: move everything with the screen instead of re-rolling it
		for (let i = 0; i < NJ; i++) { jx[i] *= sx; jy[i] *= sy; }
		for (let i = 0; i < NP; i++) { ppx[i] *= sx; ppy[i] *= sy; }
		for (let i = 0; i < NR; i++) rx[i] *= sx;
		for (let i = 0; i < NK; i++) kx[i] *= sx;
	}
	build();
}

function drawJelly(i, t) {
	const pulse = 0.75 + 0.25 * Math.sin(t * 0.03 + jphase[i]);
	const cx = jx[i] + Math.sin(t * 0.008 + jphase[i]) * 8, cy = jy[i], sz = jsz[i] * pulse, k = jtone[i];
	const a = (0.55 + (1 - jdepth[i]) * 0.45);
	ctx.globalAlpha = a * (0.6 + 0.4 * pulse);
	ctx.drawImage(glows[k], cx - sz * 3, cy - sz * 3, sz * 6, sz * 6);
	ctx.globalAlpha = a;
	ctx.fillStyle = C.bell[k];
	ctx.beginPath();
	ctx.ellipse(cx, cy, sz * 0.7, sz * 0.5 * pulse + 2, 0, Math.PI, 0);
	ctx.fill();
	ctx.fillStyle = C.inner[k];
	ctx.beginPath();
	ctx.ellipse(cx, cy + sz * 0.05, sz * 0.4, sz * 0.25 * pulse + 1, 0, Math.PI, 0);
	ctx.fill();
	ctx.strokeStyle = C.tent[k];
	ctx.lineWidth = 1;
	ctx.beginPath();
	const n = jtent[i];
	for (let s = 0; s < n; s++) {
		const tx = cx + (s / (n - 1) - 0.5) * sz, len = sz * (1.4 + Math.sin(t * 0.012 + s * 1.3) * 0.4);
		ctx.moveTo(tx, cy + 1);
		ctx.bezierCurveTo(tx + Math.sin(t * 0.015 + s * 2) * 8, cy + len * 0.5, tx + Math.sin(t * 0.01 + s * 3) * 12, cy + len * 0.8, tx + Math.sin(t * 0.008 + s) * 10, cy + len);
	}
	ctx.stroke();
}

// A frond bends as one wave, so it curves instead of zigzagging
function drawKelp(i, t, cur) {
	const segH = h * kh[i] / SEGS;
	kpx[0] = kx[i]; kpy[0] = h + 4;
	for (let s = 1; s <= SEGS; s++) {
		const prog = s / SEGS;
		kpx[s] = kx[i] + Math.sin(t * 0.012 + kph[i] - s * 0.45) * (2 + s * 1.6) + cur * prog * prog * 200;
		kpy[s] = h + 4 - segH * s;
	}
	for (let half = 0; half < 2; half++) {
		const a = half ? SEGS >> 1 : 0, b = half ? SEGS : SEGS >> 1;
		ctx.lineWidth = kw[i] * (half ? 0.65 : 1);
		ctx.beginPath();
		ctx.moveTo(kpx[a], kpy[a]);
		for (let s = a + 1; s <= b; s++) ctx.quadraticCurveTo(kpx[s - 1], kpy[s - 1], (kpx[s - 1] + kpx[s]) * 0.5, (kpy[s - 1] + kpy[s]) * 0.5);
		ctx.lineTo(kpx[b], kpy[b]);
		ctx.stroke();
	}
	ctx.beginPath();
	for (let s = 1; s < SEGS; s++) {
		const sd = kleaf[i * SEGS + s];
		if (!sd) continue;
		const x = kpx[s], y = kpy[s], len = (10 + (1 - s / SEGS) * 14) * (0.8 + 0.2 * Math.sin(t * 0.016 + kph[i] + s));
		ctx.moveTo(x, y);
		ctx.quadraticCurveTo(x + sd * len * 0.5, y - 7, x + sd * len, y - 4);
		ctx.quadraticCurveTo(x + sd * len * 0.5, y + 3, x, y + 2);
	}
	ctx.fill();
}

function ring(x, y) {
	let k = 0;
	for (let i = 1; i < RINGS; i++) if (ringA[i] < ringA[k]) k = i;
	ringX[k] = x; ringY[k] = y; ringR[k] = 0; ringA[k] = 0.14;
}

function frame(now) {
	requestAnimationFrame(frame);
	if (!ctx || !caustic) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const pace = CURRENT * (reduced ? REDUCED_SPEED : 1), f = dt * 60 * pace;
	T += f;
	const t = T;
	mouse.target = Math.max(0, mouse.target - dt * 0.5);
	mouse.amount += (mouse.target - mouse.amount) * Math.min(1, dt * 2);
	const cur = (Math.min(w, Math.max(0, mouse.x)) / w - 0.5) * 0.15 * MOUSE_CURRENT * mouse.amount;

	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'source-over';
	ctx.clearRect(0, 0, w, h);
	ctx.fillStyle = tint;
	ctx.fillRect(0, 0, w, h * 0.7);
	const glow = dark ? 'lighter' : 'source-over';
	ctx.globalCompositeOperation = glow;

	// Light shafts, in the outer thirds
	ctx.fillStyle = rayGrad;
	for (let i = 0; i < NR; i++) {
		const sway = Math.sin(t * 0.003 + rph[i]) * 40 + cur * 300, top = rx[i] + sway, half = rw[i] * 0.9;
		ctx.globalAlpha = ra[i] * (0.7 + 0.3 * Math.sin(t * 0.004 + rph[i])) * (dark ? 1.4 : 1);
		ctx.beginPath();
		ctx.moveTo(top - rw[i] * 0.3, 0); ctx.lineTo(top + rw[i] * 0.3, 0);
		ctx.lineTo(top + half + sway * 0.5, floorY); ctx.lineTo(top - half + sway * 0.5, floorY);
		ctx.fill();
	}

	// Sonar rings: rare and distant, or from a tap
	if (PULSE_EVERY > 0 && !reduced && pace > 0) {
		nextPulse -= dt;
		if (nextPulse <= 0) { ring(side(), h * (0.3 + Math.random() * 0.3)); nextPulse = PULSE_EVERY * (0.6 + Math.random() * 0.8); }
	}
	ctx.strokeStyle = ringStyle;
	ctx.lineWidth = 1.5;
	for (let i = 0; i < RINGS; i++) {
		if (ringA[i] < 0.004) continue;
		ringR[i] += 150 * dt * pace;
		ringA[i] *= Math.exp(-0.35 * dt * pace);
		if (ringR[i] > Math.max(w, h)) { ringA[i] = 0; continue; }
		ctx.globalAlpha = ringA[i] * Math.min(1, ringR[i] / 40);
		ctx.beginPath();
		ctx.arc(ringX[i], ringY[i], ringR[i], 0, TAU);
		ctx.stroke();
	}

	// Plankton
	ctx.fillStyle = C.mote;
	for (let i = 0; i < NP; i++) {
		ppx[i] += (Math.sin(t * 0.005 + ppd[i]) * pps[i] + cur * 6) * f;
		ppy[i] += (pps[i] * 0.5 + Math.cos(t * 0.003 + ppd[i]) * 0.1) * f;
		if (ppy[i] > h + 5 || ppx[i] < -10 || ppx[i] > w + 10) { ppx[i] = Math.random() * w; ppy[i] = -5; }
		ctx.globalAlpha = ppa[i] * (0.5 + 0.5 * Math.sin(t * 0.02 + ppd[i])) * (dark ? 1 : 0.8);
		ctx.fillRect(ppx[i] - 1, ppy[i] - 1, 2, 2);
	}

	// Jellyfish rise slowly and ease away from the cursor
	ctx.globalCompositeOperation = 'source-over';
	for (let i = 0; i < NJ; i++) {
		const dx = jx[i] - mouse.x, dy = jy[i] - mouse.y, d2 = dx * dx + dy * dy;
		if (d2 < 32400 && d2 > 1) jvx[i] += dx / Math.sqrt(d2) * 30 * MOUSE_CURRENT * mouse.amount * dt;
		jvx[i] *= 1 - Math.min(1, dt * 0.8);
		jx[i] += (Math.sin(t * 0.003 + jphase[i]) * 0.3 + cur * 5 * (1 - jdepth[i] * 0.5)) * f + jvx[i] * dt * pace;
		jy[i] -= jrise[i] * dt * pace;
		if (jy[i] < -jsz[i] * 3) spawnJelly(i, false);
		if (jx[i] < -100) jx[i] = w + 50; else if (jx[i] > w + 100) jx[i] = -50;
		drawJelly(i, t);
	}

	// Floor and its caustic network: two scales of one tile slide past each other
	ctx.globalAlpha = 1;
	ctx.drawImage(floorImg, 0, floorY - 60, w, h - floorY + 60);
	if (CAUSTICS > 0) {
		ctx.globalCompositeOperation = glow;
		ctx.globalAlpha = Math.min(1, CAUSTICS * (dark ? 0.15 : 0.55));
		for (let k = 0; k < 2; k++) {
			const tw = TW * (k ? 2.3 : 1.6), off = k ? (t * 0.25) % tw : tw - (t * 0.18) % tw;
			for (let x = -off; x < w; x += tw) ctx.drawImage(caustic, x, floorY, tw, h - floorY);
		}
		ctx.globalCompositeOperation = 'source-over';
	}

	// Kelp in front, in the outer thirds
	ctx.globalAlpha = 1;
	ctx.strokeStyle = C.kelp;
	ctx.fillStyle = C.leaf;
	for (let i = 0; i < NK; i++) drawKelp(i, t, cur);

	// One pass thins everything behind the chat column
	if (CENTER_CALM > 0) {
		ctx.globalCompositeOperation = 'destination-out';
		ctx.fillStyle = calmMask;
		ctx.fillRect(0, 0, w, h);
	}
	ctx.globalCompositeOperation = 'source-over';
	ctx.globalAlpha = 1;
}

self.onmessage = (e) => {
	const d = e.data;
	switch (d.type) {
		case 'init':
			canvas = d.canvas;
			ctx = canvas.getContext('2d');
			reduced = !!d.reducedMotion;
			column = d.column || null;
			theme = d.theme || null;
			dark = !theme || theme.dark !== false;
			size(d.width, d.height, d.dpr);
			requestAnimationFrame(frame);
			break;
		case 'resize':
			if (ctx) size(d.width, d.height, d.dpr);
			break;
		case 'theme':
			theme = d;
			dark = d.dark !== false;
			build();
			break;
		case 'motion':
			reduced = !!d.reducedMotion;
			break;
		case 'layout':
			column = d.column || null;
			if (!ctx || !w) break;
			placeSides();
			buildMask();
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.target = 1;
			break;
		case 'mousedown':
			if (!reduced) ring(d.x, d.y);
			break;
	}
};
