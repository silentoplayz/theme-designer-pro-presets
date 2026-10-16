/**
 * Title: Matrix Rain
 * Description: Classic digital rain of Latin, katakana or mixed glyphs in your theme's accent, with glowing heads, fading trails, a calm chat column, and faster streams near the cursor.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const CHARSET       = 2;     // glyphs: 0 Latin letters and digits, 1 katakana, 2 mixed (0-2)
const FONT_SIZE     = 16;    // glyph size and column width, in px (10-28)
const SPEED         = 1;     // fall speed; 0 holds the rain still (0-3)
const REDUCED_SPEED = 0.15;  // share of the speed kept when the viewer asks to reduce motion (0-1)
const DENSITY       = 0.8;   // share of columns raining at once (0.1-1)
const TRAIL         = 1;     // trail length (0.3-2)
const BRIGHTNESS    = 0.9;   // overall strength of the glyphs (0.2-1)
const MUTATE        = 1;     // how often trail glyphs flicker to a new symbol (0-3)
const CENTER_CALM   = 0.85;  // how much quieter the rain is behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const CURSOR_BOOST  = 1.5;   // extra speed for columns near the cursor (0-3)
const MIRROR        = true;  // mirror the katakana, as in the film
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const HEAD_COLOR    = '#c8ffd0';  // leading glyph when not following the theme
const TRAIL_COLOR   = '#22e05a';  // trail glyphs
const DIM_COLOR     = '#11803a';  // older trail glyphs
/* ──────────────────────────────────────────── */

const LATIN = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
let KANA = '';
for (let c = 0xff66; c <= 0xff9d; c++) KANA += String.fromCharCode(c);
const GLYPHS = CHARSET === 0 ? LATIN : CHARSET === 1 ? KANA : KANA + '0123456789' + 'ZXCVTHEMRA';
const G = GLYPHS.length;
const MAX_COLS = 400;

let canvas, ctx, atlas;
let w = 0, h = 0, dpr = 1, rows = 0, cols = 0;
let last = 0, reduced = false, dark = true, column = null;
let cw = 1, chh = 1;                  // atlas cell in device px
const mouse = { x: -10000, amount: 0, target: 0 };

const head = new Float32Array(MAX_COLS);   // head position, in rows
const speed = new Float32Array(MAX_COLS);  // rows per second
const len = new Float32Array(MAX_COLS);    // trail length, in rows
const wait = new Float32Array(MAX_COLS);   // seconds before the column rains again
const calmF = new Float32Array(MAX_COLS);  // alpha factor for the chat column
const lastRow = new Int32Array(MAX_COLS);
const glyph = new Uint16Array(MAX_COLS);

let palette = [HEAD_COLOR, TRAIL_COLOR, DIM_COLOR];

function hexToRgb(hex) {
	const n = parseInt(String(hex).slice(1, 7), 16) || 0;
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixHex(a, b, t) {
	const x = hexToRgb(a), y = hexToRgb(b);
	return 'rgb(' + Math.round(x[0] + (y[0] - x[0]) * t) + ',' + Math.round(x[1] + (y[1] - x[1]) * t) + ',' + Math.round(x[2] + (y[2] - x[2]) * t) + ')';
}

function applyTheme(t) {
	if (!t) return;
	dark = t.dark !== false;
	if (FOLLOW_THEME && t.colors) {
		const c = t.colors;
		palette = dark
			? [mixHex(c.accent, c.text, 0.55), c.accent, mixHex(c.accent, c.muted, 0.5)]
			: [mixHex(c.accent, c.text, 0.45), c.accent, mixHex(c.accent, c.muted, 0.25)];
	}
	buildAtlas();
}

// Every glyph pre-rendered in three tones (glowing head, bright trail, dim trail), so the loop only blits
function buildAtlas() {
	if (!ctx) return;
	cw = Math.ceil(FONT_SIZE * dpr);
	chh = cw; // glow stays inside the cell, so clearing a cell leaves nothing behind
	atlas = atlas || new OffscreenCanvas(1, 1);
	atlas.width = cw * G;
	atlas.height = chh * 3;
	const a = atlas.getContext('2d');
	a.clearRect(0, 0, atlas.width, atlas.height);
	a.font = '600 ' + Math.round(FONT_SIZE * 0.92 * dpr) + 'px monospace';
	a.textAlign = 'center';
	a.textBaseline = 'middle';
	for (let tone = 0; tone < 3; tone++) {
		a.fillStyle = palette[tone];
		a.shadowColor = palette[tone];
		a.shadowBlur = tone === 0 ? FONT_SIZE * 0.45 * dpr : 0;
		for (let i = 0; i < G; i++) {
			const ch = GLYPHS[i];
			const cx = i * cw + cw / 2, cy = tone * chh + chh / 2;
			a.save();
			a.beginPath();
			a.rect(i * cw, tone * chh, cw, chh);
			a.clip();
			const flip = MIRROR && ch.charCodeAt(0) > 0xff00;
			a.translate(cx, cy);
			if (flip) a.scale(-1, 1);
			a.fillText(ch, 0, 0);
			if (tone === 0) { a.shadowBlur = 0; a.fillText(ch, 0, 0); a.shadowBlur = FONT_SIZE * 0.45 * dpr; }
			a.restore();
		}
	}
}

// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }

function band(x) {
	const d = Math.abs(x - colX()) / colHalf();
	const s = Math.min(1, Math.max(0, (d - 0.55) / 0.7));
	return 1 - s * s * (3 - 2 * s);
}

// Each rain column's alpha factor, rebuilt on resize and layout
function buildCalm() {
	for (let i = 0; i < cols; i++) calmF[i] = 1 - CENTER_CALM * band((i + 0.5) * FONT_SIZE);
}

function restart(i, first) {
	const b = band((i + 0.5) * FONT_SIZE) * CENTER_CALM;
	speed[i] = 8 + Math.random() * 14;
	len[i] = (12 + Math.random() * 26) * TRAIL;
	head[i] = first ? Math.random() * rows * 1.2 - rows * 0.2 : -Math.random() * 4;
	lastRow[i] = Math.floor(head[i]) - 1;
	glyph[i] = (Math.random() * G) | 0;
	// Fewer streams behind the chat: columns there rest longer between runs
	const rest = (1 - DENSITY) / Math.max(0.1, DENSITY) * 4;
	wait[i] = first && Math.random() > b * 0.8 ? 0 : (0.3 + Math.random() * rest) * (1 + b * 6);
}

function size(nw, nh, ndpr) {
	w = nw;
	h = nh;
	dpr = Math.min(2, ndpr || 1);
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	rows = Math.ceil(h / FONT_SIZE);
	cols = Math.min(MAX_COLS, Math.ceil(w / FONT_SIZE));
	buildAtlas();
	// Seed the columns mid-run, trails already drawn, so the rain looks settled at once
	const base = BRIGHTNESS * (dark ? 1 : 0.9);
	buildCalm();
	for (let i = 0; i < cols; i++) {
		restart(i, true);
		if (wait[i] > 0) continue;
		const top = Math.floor(head[i]);
		for (let n = Math.ceil(len[i]); n >= 0; n--) {
			const r = top - n;
			if (r < 0 || r >= rows) continue;
			blit(n === 0 ? 0 : n < 3 ? 1 : 2, (Math.random() * G) | 0, i * FONT_SIZE, r, base * calmF[i] * Math.exp(-2.5 * n / len[i]));
		}
		lastRow[i] = top;
	}
	ctx.globalAlpha = 1;
}

function blit(tone, g, x, row, alpha) {
	ctx.globalAlpha = alpha;
	ctx.drawImage(atlas, g * cw, tone * chh, cw, chh, x, row * FONT_SIZE, FONT_SIZE, FONT_SIZE);
}

function frame(now) {
	requestAnimationFrame(frame);
	if (!ctx || !atlas) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const pace = SPEED * (reduced ? REDUCED_SPEED : 1);
	mouse.target = Math.max(0, mouse.target - dt * 0.6);
	mouse.amount += (mouse.target - mouse.amount) * Math.min(1, dt * 3);
	const base = BRIGHTNESS * (dark ? 1 : 0.9);
	const fs = FONT_SIZE;

	for (let i = 0; i < cols; i++) {
		const x = i * fs;
		if (wait[i] > 0) {
			wait[i] -= dt * (pace > 0 ? 1 : 0);
			continue;
		}
		const dx = Math.abs(x + fs * 0.5 - mouse.x);
		const boost = reduced ? 1 : 1 + CURSOR_BOOST * mouse.amount * Math.max(0, 1 - dx / 200);
		const v = speed[i] * pace * boost;
		head[i] += v * dt;
		const a = base * calmF[i];

		// Fade this column's strip toward transparency, timed so the trail lasts about `len` rows
		const k = speed[i] / len[i] * 2.5;
		ctx.globalCompositeOperation = 'destination-out';
		ctx.globalAlpha = 1 - Math.exp(-k * pace * boost * dt);
		ctx.fillRect(x, 0, fs, h);
		ctx.globalCompositeOperation = 'source-over';

		const row = Math.floor(head[i]);
		while (lastRow[i] < row) {
			const prev = lastRow[i];
			lastRow[i] = prev + 1;
			// Old head becomes a bright trail glyph; a fresh head glows one row down
			if (prev >= 0 && prev < rows) {
				ctx.clearRect(x, prev * fs, fs, fs);
				blit(1, glyph[i], x, prev, a);
			}
			glyph[i] = (Math.random() * G) | 0;
			const r = prev + 1;
			if (r >= 0 && r < rows) {
				ctx.clearRect(x, r * fs, fs, fs);
				blit(0, glyph[i], x, r, Math.min(1, a * 1.25));
			}
			// Wipe the cell the trail has left, so no faint residue builds up over hours
			const tail = r - Math.ceil(len[i]) - 1;
			if (tail >= 0 && tail < rows) ctx.clearRect(x, tail * fs, fs, fs);
		}

		// Flicker: a glyph in the trail changes, drawn at the brightness the fade has left it
		if (MUTATE > 0 && !reduced && Math.random() < MUTATE * dt * 4) {
			const back = 2 + ((Math.random() * (len[i] - 2)) | 0);
			const r = row - back;
			if (r >= 0 && r < rows) {
				ctx.clearRect(x, r * fs, fs, fs);
				blit(2, (Math.random() * G) | 0, x, r, a * 0.9 * Math.exp(-k * back / speed[i]));
			}
		}

		if (row - len[i] - 2 > rows) restart(i, false);
	}
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
			buildCalm();
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.target = 1;
			break;
		case 'mousedown': {
			// A tap starts a resting stream nearby from the tapped row
			if (reduced) break;
			const c = Math.floor(d.x / FONT_SIZE);
			for (let o = 0; o < 5; o++) {
				const i = c + (o & 1 ? -1 : 1) * ((o + 1) >> 1);
				if (i < 0 || i >= cols || wait[i] <= 0) continue;
				restart(i, false);
				head[i] = Math.floor(d.y / FONT_SIZE);
				lastRow[i] = head[i] - 1;
				wait[i] = 0;
				break;
			}
			break;
		}
	}
};
