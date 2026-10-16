/**
 * Title: Tactical Liquid Grid
 * Description: A field of crosshairs that the cursor shoves aside like elastic fabric, lighting up in your theme's accents as they spring back, faded behind the chat.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const SPACING       = 36;    // distance between crosshairs, in px (20-80)
const CROSS_SIZE    = 4;     // half-length of each crosshair arm, in px (2-8)
const GRID_ALPHA    = 1;     // visibility of the resting grid (0-1)
const ACTIVE_ALPHA  = 0.9;   // visibility of crosshairs while they move (0-1)
const MOUSE_RADIUS  = 150;   // reach of the cursor's shove, in px (60-300)
const MOUSE_FORCE   = 1;     // strength of the shove (0-3)
const SPRING        = 0.1;   // how firmly crosshairs return home (0.02-0.3)
const FRICTION      = 0.85;  // how much motion each step keeps; lower settles faster (0.7-0.95)
const MOTION        = 1;     // speed of the fabric; 0 freezes it (0-2)
const REDUCED_FORCE = 0.25;  // share of the shove kept when the viewer asks to reduce motion (0-1)
const CENTER_CALM   = 0.85;  // how much the grid fades behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const COLOR_CYCLE   = false; // moving crosshairs drift through all three accents instead of one
const CYCLE_SPEED   = 0.4;   // how fast the accents travel across the moving crosshairs (0-2)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const GRID_COLOR    = '#c8ccd8';  // resting crosshair color when not following the theme
const ACTIVE_COLOR  = '#00e5ff';  // moving crosshair color
const ACTIVE_COLOR2 = '#7a6cff';  // second accent for the color cycle
const ACTIVE_COLOR3 = '#ff5fb0';  // third accent for the color cycle
/* ──────────────────────────────────────────── */

// Alpha steps for the resting grid (one path each), and the springs' fixed rate, whatever the display's refresh
const LEVELS = 5;
const STEP = 1 / 60;

let canvas, ctx;
let w = 0, h = 0, dpr = 1;
let last = 0, acc = 0, phase = 0, reduced = false, dark = true, dirty = true, column = null;
let count = 0;
let ox, oy, px, py, vx, vy, lvl, calm;
const mouse = { x: -10000, y: -10000, amount: 0, target: 0 };
const palette = { grid: GRID_COLOR, accents: [ACTIVE_COLOR, ACTIVE_COLOR2, ACTIVE_COLOR3] };
const restAlpha = new Float32Array(LEVELS);

function applyTheme(t) {
	if (t) {
		dark = t.dark !== false;
		if (FOLLOW_THEME && t.colors) {
			palette.grid = t.colors.muted;
			palette.accents[0] = t.colors.accent;
			palette.accents[1] = t.colors.accent2;
			palette.accents[2] = t.colors.accent3;
		}
	}
	// Light backgrounds show everything, so the resting grid steps down there
	const top = GRID_ALPHA * (dark ? 0.5 : 0.48);
	for (let i = 0; i < LEVELS; i++) restAlpha[i] = top * (0.25 + 0.75 * i / (LEVELS - 1));
	dirty = true;
}

// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }

function band(x) {
	const b = Math.abs(x - colX()) / colHalf();
	const s = Math.min(1, Math.max(0, (b - 0.55) / 0.7));
	return 1 - CENTER_CALM * (1 - s * s * (3 - 2 * s));
}

function resize(width, height, ratio) {
	w = width;
	h = height;
	dpr = Math.min(ratio || 1, 2);
	if (!canvas) return;
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	const cols = Math.ceil(w / SPACING) + 1, rows = Math.ceil(h / SPACING) + 1;
	count = cols * rows;
	ox = new Float32Array(count); oy = new Float32Array(count);
	px = new Float32Array(count); py = new Float32Array(count);
	vx = new Float32Array(count); vy = new Float32Array(count);
	calm = new Float32Array(count); lvl = new Uint8Array(count);
	// Whole pixels plus a half at dpr 1, so the 1 px arms land crisp on the pixel grid
	const snap = dpr < 1.5 ? 0.5 : 0;
	const offX = Math.round((w - (cols - 1) * SPACING) / 2) + snap, offY = Math.round((h - (rows - 1) * SPACING) / 2) + snap;
	let i = 0;
	for (let c = 0; c < cols; c++) {
		for (let r = 0; r < rows; r++, i++) {
			ox[i] = px[i] = offX + c * SPACING;
			oy[i] = py[i] = offY + r * SPACING;
		}
	}
	calmBuild();
}

// Each point's calm and resting alpha step, from where the chat column sits; rebuilt on layout
function calmBuild() {
	for (let i = 0; i < count; i++) {
		calm[i] = band(ox[i]);
		lvl[i] = Math.round(((calm[i] - (1 - CENTER_CALM)) / Math.max(0.001, CENTER_CALM)) * (LEVELS - 1));
	}
	dirty = true;
}

// One fixed spring step; returns whether anything is still moving
function step() {
	const r2 = MOUSE_RADIUS * MOUSE_RADIUS;
	const force = MOUSE_FORCE * 50 * mouse.amount * (reduced ? REDUCED_FORCE : 1);
	let moving = false;
	for (let i = 0; i < count; i++) {
		let ax = vx[i], ay = vy[i];
		const dx = px[i] - mouse.x, dy = py[i] - mouse.y;
		const d2 = dx * dx + dy * dy;
		if (force > 0.01 && d2 < r2 && d2 > 0.01) {
			const d = Math.sqrt(d2);
			const f = ((MOUSE_RADIUS - d) / MOUSE_RADIUS) * force / d;
			ax += dx * f;
			ay += dy * f;
		}
		const hx = ox[i] - px[i], hy = oy[i] - py[i];
		if (ax === 0 && ay === 0 && hx === 0 && hy === 0) continue;
		ax = (ax + hx * SPRING) * FRICTION;
		ay = (ay + hy * SPRING) * FRICTION;
		px[i] += ax;
		py[i] += ay;
		// Settle exactly home once the motion is invisible, so a still grid costs nothing
		if (Math.abs(ax) + Math.abs(ay) < 0.004 && Math.abs(hx) + Math.abs(hy) < 0.02 && force <= 0.01) {
			px[i] = ox[i]; py[i] = oy[i]; ax = 0; ay = 0;
		} else moving = true;
		vx[i] = ax;
		vy[i] = ay;
	}
	return moving;
}

function activity(i) {
	const s = Math.abs(vx[i]) + Math.abs(vy[i]);
	const disp = Math.abs(px[i] - ox[i]) + Math.abs(py[i] - oy[i]);
	return Math.min(1, s * 0.15 + disp * 0.03);
}

function cross(i, s) {
	ctx.moveTo(px[i] - s, py[i]); ctx.lineTo(px[i] + s, py[i]);
	ctx.moveTo(px[i], py[i] - s); ctx.lineTo(px[i], py[i] + s);
}

// The accent a moving crosshair shows: one accent, or a slow wave through all three
function accentOf(i) {
	if (!COLOR_CYCLE) return 0;
	const v = phase + (ox[i] + oy[i]) * 0.004;
	return Math.floor(v - Math.floor(v / 3) * 3);
}

function draw() {
	ctx.clearRect(0, 0, w, h);
	ctx.globalCompositeOperation = 'source-over';
	// Resting crosshairs, one path per alpha step
	ctx.lineWidth = 1;
	ctx.strokeStyle = palette.grid;
	for (let l = 0; l < LEVELS; l++) {
		ctx.globalAlpha = restAlpha[l];
		ctx.beginPath();
		for (let i = 0; i < count; i++) if (lvl[i] === l && activity(i) < 0.08) cross(i, CROSS_SIZE);
		ctx.stroke();
	}
	// Moving crosshairs, bucketed by accent and brightness
	ctx.lineWidth = 1.5;
	const peak = ACTIVE_ALPHA * (dark ? 1 : 0.85);
	for (let a = 0; a < (COLOR_CYCLE ? 3 : 1); a++) {
		ctx.strokeStyle = palette.accents[a];
		for (let b = 0; b < 3; b++) {
			ctx.globalAlpha = peak * (b + 1) / 3;
			ctx.beginPath();
			for (let i = 0; i < count; i++) {
				const act = activity(i);
				if (act < 0.08 || accentOf(i) !== a) continue;
				if (Math.min(2, Math.floor(act * calm[i] * 3)) !== b) continue;
				cross(i, CROSS_SIZE + act * 2);
			}
			ctx.stroke();
		}
	}
	ctx.globalAlpha = 1;
}

function frame(now) {
	requestAnimationFrame(frame);
	if (!ctx) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	mouse.target = Math.max(0, mouse.target - dt * 0.6);
	mouse.amount += (mouse.target - mouse.amount) * Math.min(1, dt * 6);
	if (COLOR_CYCLE) phase = (phase + dt * CYCLE_SPEED * (reduced ? 0.25 : 1)) % 3;
	acc += dt * MOTION;
	let moving = false, n = 0;
	while (acc >= STEP && n < 8) {
		moving = step() || moving;
		acc -= STEP;
		n++;
	}
	if (n === 8) acc = 0;
	if (moving || dirty) {
		draw();
		dirty = moving;
	}
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
			if (canvas) calmBuild();
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.target = 1;
			break;
	}
};
