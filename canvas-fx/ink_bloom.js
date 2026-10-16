/**
 * Title: Ink Bloom
 * Description: Drops of ink in the theme's accent colors bloom and diffuse in the outer thirds of the screen with soft tide-line edges, fading out over the chat column; the cursor stirs them and a tap lets a drop fall.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const MAX_BLOOMS   = 22;     // most blooms at once (4-40)
const BLOOM_EVERY  = 1.4;    // seconds between new drops (0.3-6)
const BLOOM_SIZE   = 170;    // average full-grown radius, in px (60-320)
const GROWTH       = 1;      // how fast a drop spreads; 0 holds the ink still (0-3)
const INK_STRENGTH = 1;      // how dense the ink is (0.2-2)
const TIDE_LINE    = 1;      // darkness of the ring where the ink's edge dries (0-2)
const TENDRILS     = 1;      // how ragged the edges are (0-2)
const CURSOR_BLOOM = 0.35;   // share of drops that fall near a moving cursor (0-1)
const CENTER_CALM  = 0.85;   // how much the ink fades over the chat column (0-1)
const BAND_WIDTH   = 520;    // half-width of the calm band around the chat column, in px (300-900)
const RENDER_SCALE = 0.75;   // resolution of the ink; it is soft, so less is fine (0.5-1)
const MAX_FPS      = 30;     // frame cap; the ink moves slowly (15-60)
const FOLLOW_THEME = true;   // take the colors from the theme's palette
const COLOR_A      = '#3a2ab0'; // first ink when not following the theme
const COLOR_B      = '#b01e3a'; // second ink
const COLOR_C      = '#0e8a5c'; // third ink
const COLOR_D      = '#8a2a7a'; // fourth ink
/* ──────────────────────────────────────────── */

const MAXB = 40, STEPS = 48, HARM = 6, TAU = Math.PI * 2;
const F = (n) => new Float32Array(n);
const bx = F(MAXB), by = F(MAXB), br = F(MAXB), bmax = F(MAXB), brate = F(MAXB), bage = F(MAXB), brot = F(MAXB), bspin = F(MAXB);
const bvx = F(MAXB), bvy = F(MAXB), bu = F(MAXB), bstr = F(MAXB), alive = new Uint8Array(MAXB);
const tPh = F(MAXB * HARM), tAmp = F(MAXB * HARM), prof = F(STEPS);
const LAYER_SCALE = [1, 0.76, 0.52, 0.26], LAYER_ALPHA = [0.4, 0.3, 0.35, 0.5], LAYER_RAG = [1.4, 1, 0.75, 0.5];

let canvas, ctx, w = 0, h = 0, dpr = 1, scale = 1, last = 0, reduced = false, dark = true, wait = 0, mask = null;
const mouse = { x: -10000, y: -10000, amount: 0 };
const ink = { fill: [], halo: [] };

function rgbOf(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function css(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a === undefined ? 1 : a) + ')'; }
function band(x) { const t = Math.min(1, Math.max(0, (Math.abs(x - w / 2) / BAND_WIDTH - 0.55) / 0.7)); return 1 - t * t * (3 - 2 * t); }

function sprite(c) {
	const s = new OffscreenCanvas(64, 64), g = s.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
	gr.addColorStop(0, css(c, 0.8));
	gr.addColorStop(0.5, css(c, 0.35));
	gr.addColorStop(1, css(c, 0));
	g.fillStyle = gr;
	g.fillRect(0, 0, 64, 64);
	return s;
}

// Ink on a dark page is a glowing dye; on a light page it is darker than the accent, as real ink is
function applyTheme(t) {
	if (t) dark = t.dark !== false;
	const th = FOLLOW_THEME && t && t.colors ? t.colors : null;
	const text = rgbOf(th ? th.text : dark ? '#f2f0f8' : '#1c222b');
	let cs = (th ? [th.accent, th.accent2, th.accent3] : [COLOR_A, COLOR_B, COLOR_C, COLOR_D]).map(rgbOf);
	cs = cs.map((c) => (dark ? (th ? c : mix(c, text, 0.3)) : mix(c, text, th ? 0.15 : 0.1)));
	ink.fill = cs.map((c) => css(c));
	ink.halo = cs.map(sprite);
}

function size() {
	scale = RENDER_SCALE * Math.min(dpr, 1);
	canvas.width = Math.max(1, Math.round(w * scale));
	canvas.height = Math.max(1, Math.round(h * scale));
	ctx.setTransform(scale, 0, 0, scale, 0, 0);
	// A horizontal mask that erases ink over the chat column, built once per size
	mask = ctx.createLinearGradient(0, 0, w, 0);
	for (let i = 0; i <= 24; i++) mask.addColorStop(i / 24, 'rgba(0,0,0,' + (CENTER_CALM * band((w * i) / 24)).toFixed(3) + ')');
}

function spawn(x, y, big) {
	for (let i = 0; i < MAXB; i++) {
		if (alive[i]) continue;
		alive[i] = 1;
		bx[i] = x;
		by[i] = y;
		br[i] = 3;
		bmax[i] = BLOOM_SIZE * (0.5 + Math.random() * 0.9) * (big ? 0.8 : 1) * (1 - 0.4 * band(x));
		brate[i] = 30 + Math.random() * 30;
		bage[i] = 0;
		brot[i] = Math.random() * TAU;
		bspin[i] = (Math.random() - 0.5) * 0.06;
		bvx[i] = (Math.random() - 0.5) * 4;
		bvy[i] = (Math.random() - 0.5) * 4;
		bu[i] = Math.random();
		bstr[i] = 0.75 + Math.random() * 0.5;
		for (let k = 0; k < HARM; k++) { tPh[i * HARM + k] = Math.random() * TAU; tAmp[i * HARM + k] = (0.02 + Math.random() * 0.06) * (k < 2 ? 1.4 : 1); }
		return;
	}
}

function spawnSomewhere() {
	if (mouse.amount > 0.3 && Math.random() < CURSOR_BLOOM) {
		spawn(mouse.x + (Math.random() - 0.5) * 220, mouse.y + (Math.random() - 0.5) * 220, false);
		return;
	}
	// Outer thirds, weighted toward the edges
	const e = Math.pow(Math.random(), 1.4) * w * 0.32;
	spawn(Math.random() < 0.5 ? e : w - e, h * (0.06 + Math.random() * 0.88), false);
}

function drawBloom(i) {
	const p = br[i] / bmax[i];
	const life = (p < 0.1 ? p / 0.1 : p > 0.5 ? 1 - (p - 0.5) / 0.48 : 1) * bstr[i] * INK_STRENGTH;
	if (life <= 0) return;
	const c = Math.min(ink.fill.length - 1, Math.floor(bu[i] * ink.fill.length));
	const base = life * (dark ? 0.3 : 0.3), t = bage[i] * 0.12;
	for (let s = 0; s < STEPS; s++) {
		const a = (s / STEPS) * TAU;
		let v = 1;
		for (let k = 0; k < HARM; k++) v += Math.sin(a * (k + 2) + tPh[i * HARM + k] + t * (k % 2 ? 1 : -1)) * tAmp[i * HARM + k] * TENDRILS;
		prof[s] = v - 1;
	}
	const R = br[i] * 1.25;
	ctx.globalAlpha = base * (dark ? 0.9 : 0.4);
	ctx.drawImage(ink.halo[c], bx[i] - R, by[i] - R, R * 2, R * 2);
	ctx.fillStyle = ink.fill[c];
	ctx.strokeStyle = ink.fill[c];
	for (let l = 0; l < 4; l++) {
		const rad = br[i] * LAYER_SCALE[l], rot = brot[i] + l * 0.9, shift = l * 7, rag = LAYER_RAG[l];
		ctx.beginPath();
		// A smooth closed curve through the midpoints of the profile's points
		let qx = 0, qy = 0;
		for (let s = 0; s <= STEPS + 1; s++) {
			const k = s % STEPS, a = (k / STEPS) * TAU + rot, r = rad * (1 + prof[(k + shift) % STEPS] * rag);
			const px = bx[i] + Math.cos(a) * r, py = by[i] + Math.sin(a) * r;
			if (s === 1) ctx.moveTo((qx + px) / 2, (qy + py) / 2);
			else if (s > 1) ctx.quadraticCurveTo(qx, qy, (qx + px) / 2, (qy + py) / 2);
			qx = px;
			qy = py;
		}
		ctx.globalAlpha = base * LAYER_ALPHA[l];
		ctx.fill();
		if (l === 0 && TIDE_LINE > 0) {
			ctx.globalAlpha = Math.min(1, base * 2 * TIDE_LINE);
			ctx.lineWidth = 1.6;
			ctx.stroke();
		}
	}
}

function frame(now) {
	requestAnimationFrame(frame);
	if (last && now - last < 1000 / MAX_FPS - 2) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const g = dt * GROWTH * (reduced ? 0.2 : 1);
	mouse.amount = Math.max(0, mouse.amount - dt * 0.5);
	if (g > 0) {
		wait -= g;
		let n = 0;
		for (let i = 0; i < MAXB; i++) n += alive[i];
		if (wait <= 0 && n < Math.min(MAX_BLOOMS, MAXB)) { spawnSomewhere(); wait = BLOOM_EVERY * (0.6 + Math.random() * 0.8); }
	}
	ctx.globalCompositeOperation = 'source-over';
	ctx.clearRect(0, 0, w, h);
	const stir = reduced ? 0 : mouse.amount;
	for (let i = 0; i < MAXB; i++) {
		if (!alive[i]) continue;
		if (g > 0) {
			br[i] += brate[i] * (1 - br[i] / bmax[i]) * g;
			bage[i] += g;
			brot[i] += bspin[i] * g;
			// A moving cursor stirs the water and nudges the ink away
			const dx = bx[i] - mouse.x, dy = by[i] - mouse.y, d2 = dx * dx + dy * dy, reach = br[i] + 120;
			if (stir > 0 && d2 < reach * reach && d2 > 1) { const d = Math.sqrt(d2); bvx[i] += (dx / d) * stir * 30 * dt; bvy[i] += (dy / d) * stir * 30 * dt; }
			const damp = Math.exp(-dt * 0.8);
			bvx[i] *= damp;
			bvy[i] *= damp;
			bx[i] += bvx[i] * g;
			by[i] += bvy[i] * g;
			if (br[i] >= bmax[i] * 0.98) { alive[i] = 0; continue; }
		}
		drawBloom(i);
	}
	if (CENTER_CALM > 0) {
		ctx.globalCompositeOperation = 'destination-out';
		ctx.globalAlpha = 1;
		ctx.fillStyle = mask;
		ctx.fillRect(0, 0, w, h);
		ctx.globalCompositeOperation = 'source-over';
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
			dpr = d.dpr || 1;
			reduced = !!d.reducedMotion;
			applyTheme(d.theme);
			size();
			// Start with a few drops already spreading, at different stages
			for (let k = 0; k < 6; k++) {
				spawnSomewhere();
				const i = k;
				br[i] = bmax[i] * (0.15 + Math.random() * 0.6);
				bage[i] = Math.random() * 10;
			}
			requestAnimationFrame(frame);
			break;
		case 'resize':
			w = d.width;
			h = d.height;
			dpr = d.dpr || 1;
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
		case 'mousedown':
			// A tap lets one drop fall where it landed
			spawn(d.x, d.y, true);
			break;
	}
};
