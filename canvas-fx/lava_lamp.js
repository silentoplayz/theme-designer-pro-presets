/**
 * Title: Lava Lamp
 * Description: Soft blobs in your theme's colors warm at the bottom, rise, cool and sink again like a lava lamp, glowing where they meet, thinning behind the chat and drifting toward the cursor.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const BLOB_COUNT    = 12;    // number of blobs (3-30)
const BLOB_SIZE     = 1;     // size of the blobs (0.5-2)
const SPEED         = 1;     // how fast the blobs rise and sink; 0 holds them still (0-3)
const REDUCED_SPEED = 0.15;  // share of the speed kept when the viewer asks to reduce motion (0-1)
const INTENSITY     = 1;     // strength of the blobs (0.2-2)
const LIGHT_ALPHA   = 0.4;   // blob strength on light themes, so dark text stays readable (0.1-1)
const CENTER_CALM   = 0.7;   // how much the blobs fade behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const CURSOR_PULL   = 1;     // how strongly blobs drift toward the cursor (0-3)
const CURSOR_RADIUS = 260;   // reach of the cursor, in px (100-500)
const RENDER_SCALE  = 0.5;   // resolution of the blobs; they are soft, so half is plenty (0.25-1)
const MAX_FPS       = 30;    // frame cap; the blobs move slowly (15-60)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const COLOR_A       = '#b41e14';  // first blob color when not following the theme
const COLOR_B       = '#d8500e';  // second blob color
const COLOR_C       = '#a01450';  // third blob color
/* ──────────────────────────────────────────── */

const MAX = 30;
const N = Math.max(3, Math.min(MAX, Math.round(BLOB_COUNT)));
const TONES = 6;

let canvas, ctx;
let w = 0, h = 0, scale = RENDER_SCALE;
let last = 0, time = 0, reduced = false, dark = true, column = null;
const mouse = { x: -10000, y: -10000, amount: 0, target: 0 };

const bx = new Float32Array(N), by = new Float32Array(N), vx = new Float32Array(N), vy = new Float32Array(N);
const home = new Float32Array(N), rad = new Float32Array(N), temp = new Float32Array(N), rate = new Float32Array(N);
const alpha = new Float32Array(N), phase = new Float32Array(N), pulse = new Float32Array(N);
const tone = new Uint8Array(N);

let base = [COLOR_A, COLOR_B, COLOR_C].map(hexToRgb);
const sprites = [];

function hexToRgb(hex) {
	const n = parseInt(String(hex).slice(1, 7), 16) || 0;
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, t) {
	return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }

function calm(x) {
	const d = Math.abs(x - colX()) / colHalf();
	const s = Math.min(1, Math.max(0, (d - 0.55) / 0.7));
	return 1 - CENTER_CALM * (1 - s * s * (3 - 2 * s));
}

// A blob's home in px: 0.3-0.7 maps across the chat column; the rest beside it, shared between
// the two sides by the room each has inside the chat area
function homeX(v) {
	const lo = column ? column.left : 0, hi = column ? column.right : w;
	const a = Math.min(hi, Math.max(lo, colX() - colHalf() * 0.55)), b = Math.min(hi, Math.max(a, colX() + colHalf() * 0.55));
	if (v >= 0.3 && v < 0.7) return a + (v - 0.3) / 0.4 * (b - a);
	const x = (v < 0.3 ? v / 0.6 : 0.5 + (v - 0.7) / 0.6) * (a - lo + hi - b);
	return x < a - lo ? lo + x : b + (x - (a - lo));
}

function applyTheme(t) {
	if (!t) return;
	dark = t.dark !== false;
	if (FOLLOW_THEME && t.colors) base = [hexToRgb(t.colors.accent), hexToRgb(t.colors.accent2), hexToRgb(t.colors.accent3)];
	build();
}

// One soft sprite per tone; blobs keep their tone, so a theme change recolors them in place
function build() {
	const [a, b, c] = base;
	const tones = [a, b, c, mix(a, b, 0.5), mix(b, c, 0.5), mix(a, c, 0.5)];
	for (let k = 0; k < TONES; k++) {
		const col = tones[k];
		const sp = sprites[k] || new OffscreenCanvas(128, 128);
		const g = sp.getContext('2d');
		g.clearRect(0, 0, 128, 128);
		const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
		const rgb = col[0] + ',' + col[1] + ',' + col[2];
		// A full body with a soft rim reads as a blob of wax, and keeps the falloff short enough not to band
		gr.addColorStop(0, 'rgba(' + rgb + ',1)');
		gr.addColorStop(0.4, 'rgba(' + rgb + ',0.92)');
		gr.addColorStop(0.62, 'rgba(' + rgb + ',0.55)');
		gr.addColorStop(0.8, 'rgba(' + rgb + ',0.16)');
		gr.addColorStop(1, 'rgba(' + rgb + ',0)');
		g.fillStyle = gr;
		g.fillRect(0, 0, 128, 128);
		sprites[k] = sp;
	}
}

function seed() {
	for (let i = 0; i < N; i++) {
		// Most blobs live beside the chat column; a few wander through it
		const r = Math.random();
		home[i] = r < 0.4 ? Math.random() * 0.3 : r < 0.8 ? 0.7 + Math.random() * 0.3 : 0.3 + Math.random() * 0.4;
		bx[i] = homeX(home[i]);
		by[i] = Math.random() * h;
		vx[i] = vy[i] = 0;
		rad[i] = (60 + Math.random() * 100) * BLOB_SIZE;
		temp[i] = Math.random();
		rate[i] = 0.05 + Math.random() * 0.07;
		alpha[i] = 0.24 + Math.random() * 0.2;
		phase[i] = Math.random() * Math.PI * 2;
		pulse[i] = 0.3 + Math.random() * 0.6;
		tone[i] = (Math.random() * TONES) | 0;
	}
}

function size(nw, nh) {
	// Keep the blobs on a resize: scale their positions instead of re-rolling them
	if (w && h) for (let i = 0; i < N; i++) { bx[i] *= nw / w; by[i] *= nh / h; }
	w = nw;
	h = nh;
	scale = Math.max(0.25, Math.min(1, RENDER_SCALE));
	canvas.width = Math.max(1, Math.round(w * scale));
	canvas.height = Math.max(1, Math.round(h * scale));
	ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

function frame(now) {
	requestAnimationFrame(frame);
	if (!ctx) return;
	if (last && now - last < 1000 / MAX_FPS - 2) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const pace = SPEED * (reduced ? REDUCED_SPEED : 1);
	time += dt * pace;
	mouse.target = Math.max(0, mouse.target - dt * 0.5);
	mouse.amount += (mouse.target - mouse.amount) * Math.min(1, dt * 2);
	const pull = CURSOR_PULL * mouse.amount * 60;
	const relax = Math.min(1, dt * 0.6);

	for (let i = 0; i < N; i++) {
		// Heat at the bottom, cool at the top: warm blobs rise, cool ones sink
		const heat = by[i] > h * 0.75 ? 1 : by[i] < h * 0.3 ? -1 : 0;
		temp[i] = Math.min(1, Math.max(0, temp[i] + heat * rate[i] * dt * pace));
		let tx = (homeX(home[i]) - bx[i]) * 0.05 + Math.sin(time * 0.4 + phase[i]) * 10;
		let ty = -(temp[i] - 0.45) * 70;
		// Drift toward the cursor while it moves, at a capped speed, and let go once it rests
		const dx = mouse.x - bx[i], dy = mouse.y - by[i], d2 = dx * dx + dy * dy;
		if (pull > 0 && d2 < CURSOR_RADIUS * CURSOR_RADIUS && d2 > 400) {
			const d = Math.sqrt(d2), f = pull * (1 - d / CURSOR_RADIUS);
			tx += dx / d * f;
			ty += dy / d * f;
		}
		vx[i] += (tx - vx[i]) * relax;
		vy[i] += (ty - vy[i]) * relax;
		bx[i] += vx[i] * dt * pace;
		by[i] += vy[i] * dt * pace;
		if (by[i] < -rad[i]) temp[i] = Math.min(temp[i], 0.2);
		if (by[i] > h + rad[i]) temp[i] = Math.max(temp[i], 0.8);
	}

	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'source-over';
	ctx.clearRect(0, 0, w, h);
	ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
	const k = INTENSITY * (dark ? 1 : LIGHT_ALPHA * 1.5); // source-over on light needs a little more than the dark glow
	// The heat at the base of the lamp: a low glow in each bottom corner
	ctx.globalAlpha = Math.min(1, 0.22 * k);
	ctx.drawImage(sprites[0], -w * 0.15, h * 0.8, w * 0.45, h * 0.45);
	ctx.drawImage(sprites[1], w * 0.7, h * 0.8, w * 0.45, h * 0.45);
	for (let i = 0; i < N; i++) {
		const r = (rad[i] + Math.sin(time * pulse[i] + phase[i]) * 18 * BLOB_SIZE) * 2.2;
		const stretch = 1 + Math.min(0.35, Math.abs(vy[i]) / 120); // wax stretches as it moves
		const a = alpha[i] * k * calm(bx[i]);
		if (a < 0.004) continue;
		ctx.globalAlpha = Math.min(1, a);
		ctx.drawImage(sprites[tone[i]], bx[i] - r * 0.5 / stretch, by[i] - r * 0.5 * stretch, r / stretch, r * stretch);
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
			w = d.width;
			h = d.height;
			seed();
			size(d.width, d.height);
			applyTheme(d.theme || {});
			requestAnimationFrame(frame);
			break;
		case 'resize':
			if (ctx) size(d.width, d.height);
			break;
		case 'theme':
			applyTheme(d);
			break;
		case 'motion':
			reduced = !!d.reducedMotion;
			break;
		case 'layout':
			column = d.column || null;
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.target = 1;
			break;
		case 'mousedown':
			// A tap warms the blobs nearby, so they start to rise
			for (let i = 0; i < N; i++) {
				const dx = bx[i] - d.x, dy = by[i] - d.y;
				if (dx * dx + dy * dy < 220 * 220) temp[i] = Math.min(1, temp[i] + (reduced ? 0.1 : 0.35));
			}
			break;
	}
};
