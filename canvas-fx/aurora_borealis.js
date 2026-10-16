/**
 * Title: Aurora Borealis
 * Description: Soft aurora ribbons with rising light rays in your theme's colors sway across the top of the screen, thin behind the chat and bow away from the cursor.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const INTENSITY     = 0.85;  // how brightly the ribbons glow (0-1.5)
const MOTION        = 1;     // sway speed; 0 holds the aurora still (0-3)
const REDUCED_SPEED = 0.2;   // share of the sway kept when the viewer asks to reduce motion (0-1)
const RIBBON_COUNT  = 5;     // number of aurora ribbons (1-8)
const TOP           = 0.1;   // height of the first ribbon, as a share of the screen (0-0.4)
const SPREAD        = 0.07;  // vertical gap between ribbons, as a share of the screen (0.02-0.15)
const RAYS          = 1;     // brightness of the light rays rising from each ribbon; 0 turns them off (0-2)
const CENTER_CALM   = 0.7;   // how much the aurora thins behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band around the chat column, in px (300-900)
const CURSOR_PUSH   = 1;     // how far the ribbons bow away from the cursor (0-3)
const PUSH_RADIUS   = 220;   // reach of the cursor's push, in px (80-400)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const COLOR_A       = '#32dc82';  // first ribbon when not following the theme
const COLOR_B       = '#1ec8b4';  // second ribbon
const COLOR_C       = '#50b4dc';  // third ribbon
const COLOR_D       = '#8250dc';  // fourth ribbon
const COLOR_E       = '#3cf0a0';  // fifth ribbon
/* ──────────────────────────────────────────── */

const SEGMENTS = 64;
const MAX_RIBBONS = 8;
const RAYS_PER = 36;
const SOFT = 1 / 6; // the haze renders at a sixth of the screen and is scaled up, which blurs it for free

let canvas, ctx, haze, hctx;
let w = 0, h = 0, dpr = 1;
let last = 0, time = 0, reduced = false, dark = true;
const mouse = { x: -10000, y: -10000, amount: 0, target: 0 };

// Per-ribbon traits, rolled once so a resize rescales instead of re-rolling
const ampF = new Float32Array(MAX_RIBBONS);
const freqF = new Float32Array(MAX_RIBBONS);
const speed = new Float32Array(MAX_RIBBONS);
const thickF = new Float32Array(MAX_RIBBONS);
const opacity = new Float32Array(MAX_RIBBONS);
const phase = new Float32Array(MAX_RIBBONS);
const bow = new Float32Array(MAX_RIBBONS);
const rayX = new Float32Array(MAX_RIBBONS * RAYS_PER);
const rayPhase = new Float32Array(MAX_RIBBONS * RAYS_PER);
const rayRate = new Float32Array(MAX_RIBBONS * RAYS_PER);
const rayLen = new Float32Array(MAX_RIBBONS * RAYS_PER);
const rayW = new Float32Array(MAX_RIBBONS * RAYS_PER);
const ys = new Float32Array(SEGMENTS + 1);

let palette = [COLOR_A, COLOR_B, COLOR_C, COLOR_D, COLOR_E].map(hexToRgb);
const grads = [];
const raySprites = [];
const count = Math.max(1, Math.min(MAX_RIBBONS, Math.round(RIBBON_COUNT)));

function hexToRgb(hex) {
	const n = parseInt(String(hex).slice(1, 7), 16) || 0;
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, t) {
	return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

function rgba(c, a) {
	return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')';
}

// Alpha across the screen: fades at the sides and thins behind the chat column
function shade(x) {
	const edge = Math.min(1, x / 90, (w - x) / 90);
	const d = Math.abs(x - w * 0.5) / BAND_WIDTH;
	const s = Math.min(1, Math.max(0, (d - 0.55) / 0.7));
	const band = 1 - s * s * (3 - 2 * s);
	return Math.max(0, edge) * (1 - CENTER_CALM * band);
}

function applyTheme(t) {
	if (!t) return;
	dark = t.dark !== false;
	if (FOLLOW_THEME && t.colors) {
		const c = t.colors, a = hexToRgb(c.accent), a2 = hexToRgb(c.accent2), a3 = hexToRgb(c.accent3);
		palette = [a, a3, mix(a, a2, 0.5), a2, mix(a, hexToRgb(c.text), 0.25)];
	}
}

function roll() {
	for (let i = 0; i < MAX_RIBBONS; i++) {
		ampF[i] = 0.035 + Math.random() * 0.045;
		freqF[i] = 1.6 + Math.random() * 1.8;
		speed[i] = 0.35 + Math.random() * 0.3;
		thickF[i] = 0.04 + Math.random() * 0.04;
		opacity[i] = 0.75 + Math.random() * 0.5;
		phase[i] = Math.random() * Math.PI * 2;
		for (let j = 0; j < RAYS_PER; j++) {
			const k = i * RAYS_PER + j;
			rayX[k] = (j + 0.2 + Math.random() * 0.6) / RAYS_PER;
			rayPhase[k] = Math.random() * Math.PI * 2;
			rayRate[k] = 0.4 + Math.random() * 1.1;
			rayLen[k] = 0.5 + Math.random() * 0.9;
			rayW[k] = 6 + Math.random() * 16;
		}
	}
}

// Rebuilt on theme change and resize only: one horizontal gradient and one ray sprite per ribbon
function build() {
	if (!ctx || !w) return;
	for (let i = 0; i < count; i++) {
		const c = palette[i % palette.length];
		const g = hctx.createLinearGradient(0, 0, w, 0);
		for (let s = 0; s <= 24; s++) g.addColorStop(s / 24, rgba(c, shade((s / 24) * w)));
		grads[i] = g;
		const sp = raySprites[i] || new OffscreenCanvas(16, 128);
		const sc = sp.getContext('2d');
		sc.globalCompositeOperation = 'source-over';
		sc.clearRect(0, 0, 16, 128);
		const v = sc.createLinearGradient(0, 0, 0, 128);
		v.addColorStop(0, rgba(c, 0));
		v.addColorStop(0.75, rgba(c, 0.55));
		v.addColorStop(1, rgba(c, 1));
		const hz = sc.createLinearGradient(0, 0, 16, 0);
		hz.addColorStop(0, 'rgba(0,0,0,0)');
		hz.addColorStop(0.5, 'rgba(0,0,0,1)');
		hz.addColorStop(1, 'rgba(0,0,0,0)');
		sc.fillStyle = v;
		sc.fillRect(0, 0, 16, 128);
		sc.globalCompositeOperation = 'destination-in';
		sc.fillStyle = hz;
		sc.fillRect(0, 0, 16, 128);
		raySprites[i] = sp;
	}
}

function size() {
	dpr = 1; // soft glow: full resolution would only cost more
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	haze = haze || new OffscreenCanvas(1, 1);
	haze.width = Math.max(1, Math.ceil(w * SOFT));
	haze.height = Math.max(1, Math.ceil(h * SOFT));
	hctx = haze.getContext('2d');
	hctx.setTransform(SOFT, 0, 0, SOFT, 0, 0);
	hctx.filter = 'blur(' + Math.max(1, h * 0.014 * SOFT).toFixed(1) + 'px)';
	hctx.lineCap = ctx.lineCap = 'round';
	hctx.lineJoin = ctx.lineJoin = 'round';
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	build();
}

function waveY(i, x, base, amp, freq, t) {
	const u = x / w * freq;
	return base + (Math.sin(u * 2.4 + t * speed[i] + phase[i])
		+ Math.sin(u * 4.1 + t * speed[i] * 0.6 + phase[i] * 2.3) * 0.5
		+ Math.sin(u * 1.2 - t * speed[i] * 1.3) * 0.3) * amp;
}

function drawRibbon(i, t, dt) {
	const base = h * (TOP + i * SPREAD);
	const amp = h * ampF[i];
	const freq = freqF[i];
	const thick = h * thickF[i];
	const a = opacity[i] * INTENSITY * (dark ? 0.075 : 0.08);
	const segW = (w + 80) / SEGMENTS;

	// Bow away from the cursor: the whole ribbon bends, so it never tears
	const yAtCursor = waveY(i, mouse.x, base, amp, freq, t);
	const gap = yAtCursor - mouse.y;
	const near = Math.max(0, 1 - Math.abs(gap) / (PUSH_RADIUS + thick * 0.5));
	const goal = (gap < 0 ? -1 : 1) * near * near * CURSOR_PUSH * mouse.amount * 70;
	bow[i] += (goal - bow[i]) * Math.min(1, dt * 4);
	const r2 = 1 / (2 * PUSH_RADIUS * PUSH_RADIUS);

	for (let s = 0; s <= SEGMENTS; s++) {
		const x = -40 + s * segW;
		const dx = x - mouse.x;
		ys[s] = waveY(i, x, base, amp, freq, t) + bow[i] * Math.exp(-dx * dx * r2);
	}

	// Soft body in the low-resolution haze layer: stacked widths make a smooth falloff
	hctx.strokeStyle = grads[i];
	hctx.beginPath();
	hctx.moveTo(-40, ys[0]);
	for (let s = 1; s <= SEGMENTS; s++) hctx.lineTo(-40 + s * segW, ys[s]);
	hctx.globalAlpha = Math.min(1, a * 2.2);
	hctx.lineWidth = thick * 2.2;
	hctx.stroke();
	hctx.globalAlpha = Math.min(1, a * 3.5);
	hctx.lineWidth = thick * 0.9;
	hctx.stroke();

	// Crisp lower edge at full resolution
	ctx.strokeStyle = grads[i];
	ctx.beginPath();
	ctx.moveTo(-40, ys[0] + thick * 0.2);
	for (let s = 1; s <= SEGMENTS; s++) ctx.lineTo(-40 + s * segW, ys[s] + thick * 0.2);
	ctx.globalAlpha = Math.min(1, a * 5);
	ctx.lineWidth = 1.5;
	ctx.stroke();

	if (RAYS <= 0) return;
	const sprite = raySprites[i];
	const rayA = RAYS * opacity[i] * INTENSITY * (dark ? 0.3 : 0.2);
	for (let j = 0; j < RAYS_PER; j++) {
		const k = i * RAYS_PER + j;
		const x = rayX[k] * w;
		const f = (x + 40) / segW;
		const s0 = f | 0;
		const y = ys[s0] + (ys[Math.min(SEGMENTS, s0 + 1)] - ys[s0]) * (f - s0);
		const pulse = 0.5 + 0.5 * Math.sin(time * rayRate[k] + rayPhase[k]);
		const al = rayA * pulse * pulse * shade(x);
		if (al < 0.004) continue;
		const len = thick * 3.2 * rayLen[k];
		ctx.globalAlpha = Math.min(1, al);
		ctx.drawImage(sprite, x - rayW[k] * 0.5, y - len + thick * 0.25, rayW[k], len);
	}
}

function frame(now) {
	requestAnimationFrame(frame);
	if (!ctx) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	time += dt * MOTION * (reduced ? REDUCED_SPEED : 1);
	mouse.target = Math.max(0, mouse.target - dt * 0.5);
	mouse.amount += (mouse.target - mouse.amount) * Math.min(1, dt * 3);

	const mode = dark ? 'lighter' : 'source-over';
	hctx.globalAlpha = 1;
	hctx.globalCompositeOperation = 'source-over';
	hctx.clearRect(0, 0, w, h);
	hctx.globalCompositeOperation = mode;
	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'source-over';
	ctx.clearRect(0, 0, w, h);
	ctx.globalCompositeOperation = mode;
	for (let i = 0; i < count; i++) drawRibbon(i, time, dt);
	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'destination-over';
	ctx.drawImage(haze, 0, 0, haze.width / SOFT, haze.height / SOFT);
	ctx.globalCompositeOperation = 'source-over';
}

self.onmessage = (e) => {
	const d = e.data;
	switch (d.type) {
		case 'init':
			canvas = d.canvas;
			ctx = canvas.getContext('2d');
			w = d.width;
			h = d.height;
			reduced = !!d.reducedMotion;
			applyTheme(d.theme);
			roll();
			size();
			requestAnimationFrame(frame);
			break;
		case 'resize':
			w = d.width;
			h = d.height;
			if (ctx) size();
			break;
		case 'theme':
			applyTheme(d);
			build();
			break;
		case 'motion':
			reduced = !!d.reducedMotion;
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.target = reduced ? 0.4 : 1;
			break;
	}
};
