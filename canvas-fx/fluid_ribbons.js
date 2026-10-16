/**
 * Title: Fluid Ribbons
 * Description: Twisting silk ribbons in the theme's accent colors wander the outer thirds of the screen, glow softly where they cross, lean toward a moving cursor and fade to a whisper over the chat column.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const RIBBONS        = 10;    // number of ribbons (2-16)
const LENGTH         = 80;    // points along each ribbon (20-160)
const SPACING        = 7;     // distance between points, in px; with LENGTH, sets how long a ribbon is (3-14)
const WIDTH          = 22;    // widest a ribbon gets, in px (4-48)
const TWIST          = 1;     // how much the ribbons twist as they travel (0-2)
const SPEED          = 70;    // travel speed, in px per second (10-200)
const WANDER         = 1;     // how often each ribbon picks a new place to head for (0.2-3)
const ATTRACT        = 1;     // how strongly ribbons lean toward a moving cursor (0-3)
const ATTRACT_RADIUS = 280;   // reach of the cursor's pull, in px (100-500)
const GLOW           = 0.6;   // brightness of the glow where ribbons cross (0-1)
const CENTER_CALM    = 0.8;   // how much the ribbons fade over the chat column (0-1)
const BAND_WIDTH     = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const FOLLOW_THEME   = true;  // take the colors from the theme's palette
const COLOR_A        = '#7aa2ff'; // first ribbon color when not following the theme
const COLOR_B        = '#e07ad0'; // second ribbon color
const COLOR_C        = '#5fe0c8'; // third ribbon color
/* ──────────────────────────────────────────── */

const MAXR = 16, N = Math.min(160, Math.max(20, LENGTH)), BANDS = 8, MAXGLOW = 14, TAU = Math.PI * 2;
const F = (n) => new Float32Array(n);
const px = F(MAXR * N), py = F(MAXR * N), head = new Uint16Array(MAXR), fill = new Uint16Array(MAXR);
const rx = F(MAXR), ry = F(MAXR), ang = F(MAXR), tx = F(MAXR), ty = F(MAXR), tWait = F(MAXR), ph = F(MAXR), trav = F(MAXR), side = new Uint8Array(MAXR);
const lx = F(N + 1), ly = F(N + 1), qx = F(N + 1), qy = F(N + 1), cx = F(N + 1), cy = F(N + 1);
const COUNT = Math.min(MAXR, Math.max(2, RIBBONS));

let canvas, ctx, w = 0, h = 0, dpr = 1, last = 0, reduced = false, dark = true, mask = null, glowSprite = null, column = null;
const mouse = { x: -10000, y: -10000, amount: 0 };
const col = { band: [], sheen: [] };

function rgbOf(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function css(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a === undefined ? 1 : a) + ')'; }
// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }
function band(x) { const t = Math.min(1, Math.max(0, (Math.abs(x - colX()) / colHalf() - 0.55) / 0.7)); return 1 - t * t * (3 - 2 * t); }
// A random x in one side's outer zone, between the screen's edge and the column; a side with no room hands over to the other
function sideX(s) {
	const pad = w * 0.03, inner = colHalf() * 0.64, left = colX() - inner - pad, right = w - pad - colX() - inner;
	if (s ? right < 60 && left > right : left < 60 && right > left) s = 1 - s;
	const room = Math.max(0, s ? right : left) * Math.random();
	return s ? w - pad - room : pad + room;
}

function applyTheme(t) {
	if (t) dark = t.dark !== false;
	const th = FOLLOW_THEME && t && t.colors ? t.colors : null;
	const text = rgbOf(th ? th.text : dark ? '#f4f2fa' : '#1c222b');
	let cs = (th ? [th.accent, th.accent2, th.accent3] : [COLOR_A, COLOR_B, COLOR_C]).map(rgbOf);
	if (!th && !dark) cs = cs.map((c) => mix(c, text, 0.35));
	// Each ribbon blends from its color into the next along its length, in BANDS layered steps
	for (let r = 0; r < MAXR; r++) {
		const a = cs[r % 3], b = cs[(r + 1) % 3];
		for (let k = 0; k < BANDS; k++) col.band[r * BANDS + k] = css(mix(a, b, k / (BANDS - 1)));
		col.sheen[r] = css(mix(b, text, dark ? 0.6 : 0.25));
	}
	const g = new OffscreenCanvas(64, 64), gc = g.getContext('2d'), gr = gc.createRadialGradient(32, 32, 0, 32, 32, 32);
	const gcol = dark ? mix(cs[0], text, 0.6) : cs[0];
	gr.addColorStop(0, css(gcol, 1));
	gr.addColorStop(0.35, css(gcol, 0.35));
	gr.addColorStop(1, css(gcol, 0));
	gc.fillStyle = gr;
	gc.fillRect(0, 0, 64, 64);
	glowSprite = g;
}

function size() {
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.lineJoin = ctx.lineCap = 'round';
	buildMask();
}

// The calm mask and the wander targets, rebuilt on resize and layout
function buildMask() {
	mask = ctx.createLinearGradient(0, 0, w, 0);
	for (let i = 0; i <= 24; i++) mask.addColorStop(i / 24, 'rgba(0,0,0,' + (CENTER_CALM * band((w * i) / 24)).toFixed(3) + ')');
	for (let r = 0; r < COUNT; r++) pick(r);
}

// A new place to head for, in this ribbon's outer third; now and then across the column
function pick(r) {
	tx[r] = sideX(Math.random() < 0.12 ? 1 - side[r] : side[r]);
	ty[r] = h * (0.06 + Math.random() * 0.88);
	tWait[r] = (5 + Math.random() * 6) / WANDER;
}

function seed() {
	for (let r = 0; r < COUNT; r++) {
		side[r] = r % 2;
		rx[r] = sideX(side[r]);
		ry[r] = h * (0.1 + Math.random() * 0.8);
		ang[r] = Math.random() * TAU;
		ph[r] = Math.random() * TAU;
		head[r] = fill[r] = 0;
		trav[r] = 0;
		pick(r);
	}
}

function update(r, dt) {
	tWait[r] -= dt;
	if (tWait[r] <= 0 || Math.hypot(tx[r] - rx[r], ty[r] - ry[r]) < 160) pick(r);
	let gx = tx[r], gy = ty[r];
	const mdx = mouse.x - rx[r], mdy = mouse.y - ry[r], md = Math.hypot(mdx, mdy);
	if (md < ATTRACT_RADIUS && mouse.amount > 0 && !reduced) {
		const k = Math.min(1, ATTRACT * mouse.amount * (1 - md / ATTRACT_RADIUS) * 2);
		gx += (mouse.x - gx) * k;
		gy += (mouse.y - gy) * k;
	}
	let d = Math.atan2(gy - ry[r], gx - rx[r]) - ang[r];
	d -= TAU * Math.round(d / TAU);
	ph[r] += dt * 0.7;
	ang[r] += Math.max(-0.6 * dt, Math.min(0.6 * dt, d)) + Math.sin(ph[r]) * 0.22 * dt;
	const step = SPEED * dt;
	rx[r] += Math.cos(ang[r]) * step;
	ry[r] += Math.sin(ang[r]) * step;
	// Points are laid down by distance travelled, so a ribbon's length does not depend on the frame rate
	trav[r] += step;
	if (trav[r] >= SPACING || !fill[r]) {
		trav[r] = 0;
		px[r * N + head[r]] = rx[r];
		py[r * N + head[r]] = ry[r];
		head[r] = (head[r] + 1) % N;
		if (fill[r] < N) fill[r]++;
	}
}

// Builds the ribbon's two edges into lx/ly and qx/qy, oldest point first, the live head last
function edges(r) {
	const n = fill[r], o = r * N;
	for (let k = 0; k < n; k++) {
		const i = (head[r] - n + k + N) % N;
		cx[k] = px[o + i];
		cy[k] = py[o + i];
	}
	cx[n] = rx[r];
	cy[n] = ry[r];
	for (let k = 0; k <= n; k++) {
		const a = Math.max(0, k - 1), b = Math.min(n, k + 1);
		let nx = -(cy[b] - cy[a]), ny = cx[b] - cx[a];
		const l = Math.hypot(nx, ny) || 1;
		nx /= l;
		ny /= l;
		const t = k / n, taper = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.7);
		const twist = 1 - TWIST * 0.4 * (1 - Math.abs(Math.cos(ph[r] * 1.3 + k * 0.09)));
		const hw = (WIDTH / 2) * taper * Math.max(0.15, twist);
		lx[k] = cx[k] + nx * hw;
		ly[k] = cy[k] + ny * hw;
		qx[k] = cx[k] - nx * hw;
		qy[k] = cy[k] - ny * hw;
	}
	return n;
}

function drawRibbon(r) {
	const n = edges(r);
	if (n < 4) return;
	// Layered from the tail: each band covers the ribbon from its start to the head, so the
	// alpha and color build toward the head with no seams between bands
	const A = (dark ? 0.12 : 0.13) * (8 / BANDS);
	for (let b = 0; b < BANDS; b++) {
		const s0 = Math.floor((b * n) / BANDS), s1 = n;
		ctx.beginPath();
		ctx.moveTo(lx[s0], ly[s0]);
		for (let k = s0 + 1; k <= s1; k++) ctx.lineTo(lx[k], ly[k]);
		for (let k = s1; k >= s0; k--) ctx.lineTo(qx[k], qy[k]);
		ctx.closePath();
		ctx.fillStyle = col.band[r * BANDS + b];
		ctx.globalAlpha = A;
		ctx.fill();
	}
	// A fine sheen down the newer half of the ribbon
	ctx.beginPath();
	ctx.moveTo(cx[n >> 1], cy[n >> 1]);
	for (let k = (n >> 1) + 1; k <= n; k++) ctx.lineTo(cx[k], cy[k]);
	ctx.strokeStyle = col.sheen[r];
	ctx.lineWidth = 1;
	ctx.globalAlpha = dark ? 0.4 : 0.3;
	ctx.stroke();
}

// Soft glows where two ribbons cross, sampled sparsely and capped
function drawGlows() {
	if (GLOW <= 0) return;
	ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
	let shown = 0;
	const near = WIDTH * 0.8, stepA = Math.max(2, N >> 4);
	for (let a = 0; a < COUNT && shown < MAXGLOW; a++) {
		for (let b = a + 1; b < COUNT && shown < MAXGLOW; b++) {
			const na = fill[a], nb = fill[b];
			for (let i = na - 1; i >= 0 && shown < MAXGLOW; i -= stepA) {
				const ia = a * N + ((head[a] - na + i + N) % N), x0 = px[ia], y0 = py[ia];
				for (let j = nb - 1; j >= 0; j -= stepA) {
					const ib = b * N + ((head[b] - nb + j + N) % N), dx = x0 - px[ib], dy = y0 - py[ib];
					if (dx * dx + dy * dy > near * near) continue;
					const s = WIDTH * 2.4, k = (i / na) * (j / nb);
					ctx.globalAlpha = GLOW * k * (dark ? 0.55 : 0.3);
					ctx.drawImage(glowSprite, (x0 + px[ib]) / 2 - s, (y0 + py[ib]) / 2 - s, s * 2, s * 2);
					shown++;
					break;
				}
			}
		}
	}
	ctx.globalCompositeOperation = 'source-over';
}

function frame(now) {
	requestAnimationFrame(frame);
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const sdt = dt * (reduced ? 0.15 : 1);
	mouse.amount = Math.max(0, mouse.amount - dt * 0.6);
	if (sdt > 0) for (let r = 0; r < COUNT; r++) update(r, sdt);
	ctx.clearRect(0, 0, w, h);
	for (let r = 0; r < COUNT; r++) drawRibbon(r);
	drawGlows();
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
			dpr = Math.min(d.dpr || 1, 2);
			reduced = !!d.reducedMotion;
			column = d.column || null;
			applyTheme(d.theme);
			seed();
			size();
			// Run the ribbons ahead so they start at full length
			for (let s = 0; s < (N * SPACING * 30) / SPEED; s++) for (let r = 0; r < COUNT; r++) update(r, 1 / 30);
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
			if (canvas) buildMask();
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.amount = 1;
			break;
	}
};
