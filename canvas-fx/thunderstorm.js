/**
 * Title: Thunderstorm
 * Description: Slanting rain at three depths under drifting cloud banks, with branching lightning that strikes beside the chat column above a low city skyline; tap to call a strike.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const RAIN_DENSITY    = 1;     // how much rain falls (0-2)
const RAIN_SPEED      = 1;     // fall speed; also slows the clouds (0.2-2)
const REDUCED_SPEED   = 0.25;  // share of the speed kept under reduced motion (0-1)
const WIND            = 0.16;  // base slant of the rain, in radians (0-0.5)
const GUST_STRENGTH   = 0.22;  // extra slant a gust adds (0-0.5)
const CURSOR_WIND     = 1;     // how far the cursor tilts the rain; eases back when it stops (0-2)
const STRIKE_EVERY    = 16;    // average seconds between strikes; 0 for taps only (0-120)
const FLASH_INTENSITY = 0.3;   // how strongly a strike lights the sky near it (0-1)
const BRANCHING       = 0.55;  // how much the bolts fork (0-1)
const CLOUD_COVER     = 1;     // how thick the cloud banks are (0-2)
const SKYLINE_HEIGHT  = 0.13;  // tallest building as a share of the screen height (0-0.2)
const CENTER_CALM     = 0.8;   // how much rain and cloud thin behind the chat column (0-1)
const BAND_WIDTH      = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const FOLLOW_THEME    = true;  // take the colors from the theme's palette
const RAIN_COLOR      = '#9fb4cc';  // rain when not following the theme
const CLOUD_COLOR     = '#3a4152';  // cloud banks
const BOLT_COLOR      = '#bcd0ff';  // lightning glow
const WINDOW_COLOR    = '#e8c27a';  // lit windows in the skyline
/* ──────────────────────────────────────────── */

const MAX_DROPS = 1100, MAX_PTS = 700, MAX_LINES = 36;

let canvas, ctx, w = 0, h = 0, dpr = 1, last = 0, reduced = false, dark = true, column = null;
let pal = { rain: hex(RAIN_COLOR), cloud: hex(CLOUD_COLOR), bolt: hex(BOLT_COLOR), win: hex(WINDOW_COLOR), bg: [26, 24, 38], text: [235, 238, 245] };
let rainStyle = ['', '', ''], boltGlow = '', boltCore = '', boltHot = '';
let cloudSprite, litSprite, flashSprite, skyline, skyW = 0, skyH = 0;

const F = (n) => new Float32Array(n), MAX_PUFFS = 140;
const rx = F(MAX_DROPS), ry = F(MAX_DROPS), rs = F(MAX_DROPS), rl = F(MAX_DROPS);
const cx = F(MAX_PUFFS), cy = F(MAX_PUFFS), cr = F(MAX_PUFFS), cv = F(MAX_PUFFS), ca = F(MAX_PUFFS);
let drops = 0, puffs = 0;

// Bolt geometry: polylines packed in typed arrays, branches queued so each line stays contiguous
const px = F(MAX_PTS), py = F(MAX_PTS), qx = F(MAX_LINES), qy = F(MAX_LINES), qa = F(MAX_LINES), ql = F(MAX_LINES);
const lStart = new Uint16Array(MAX_LINES), lLen = new Uint16Array(MAX_LINES), lDepth = new Uint8Array(MAX_LINES), qd = new Uint8Array(MAX_LINES);
let nPts = 0, nLines = 0, qCount = 0;
const bolt = { age: 99, x: 0, glowAge: 99, glowX: 0, wait: STRIKE_EVERY * 0.4, glowWait: 5, cool: 0 };
let wind = WIND, gust = 0, gustTarget = 0, gustWait = 6;
const mouse = { x: 0, amount: 0 };

function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function rgba(c, a) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a.toFixed(3) + ')'; }
// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }
function band(x) {
	const d = Math.abs(x - colX()) / colHalf();
	const t = Math.min(1, Math.max(0, (d - 0.55) / 0.7));
	return 1 - t * t * (3 - 2 * t);
}
function calm(x) { return 1 - CENTER_CALM * band(x); }
// A spot within a share f of the screen beside the chat column, on the side with room
function edge(f) {
	const left = Math.max(0, colX() - colHalf()), right = Math.max(0, w - colX() - colHalf()), m = w * f;
	if (left + right < 60) return Math.random() < 0.5 ? Math.random() * m : w - Math.random() * m;
	const r = Math.random() * (left + right);
	return r < left ? (r / left) * Math.min(left, m) : w - ((r - left) / right) * Math.min(right, m);
}

function sprite(size, col, a0, a1) {
	const c = new OffscreenCanvas(size, size), g = c.getContext('2d');
	const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
	grad.addColorStop(0, rgba(col, a0));
	grad.addColorStop(0.5, rgba(col, a1));
	grad.addColorStop(1, rgba(col, 0));
	g.fillStyle = grad;
	g.fillRect(0, 0, size, size);
	return c;
}

function applyTheme(t) {
	if (t) {
		dark = t.dark !== false;
		if (FOLLOW_THEME && t.colors) {
			const c = t.colors, m = hex(c.muted), bg = hex(c.background), a3 = hex(c.accent3);
			pal = {
				rain: dark ? mix(m, a3, 0.35) : mix(m, hex(c.text), 0.25),
				cloud: dark ? mix(bg, m, 0.3) : mix(m, hex(c.text), 0.35),
				bolt: dark ? mix(a3, [255, 255, 255], 0.35) : hex(c.accent),
				win: hex(c.accent2), bg: bg, text: hex(c.text),
			};
		}
	}
	buildColors();
}

function buildColors() {
	const k = dark ? 1 : 0.55;
	for (let l = 0; l < 3; l++) rainStyle[l] = rgba(pal.rain, (0.22 + l * 0.17) * k);
	boltGlow = rgba(pal.bolt, dark ? 0.16 : 0.12);
	boltCore = rgba(pal.bolt, dark ? 0.85 : 0.6);
	boltHot = dark ? rgba(mix(pal.bolt, [255, 255, 255], 0.7), 0.95) : rgba(mix(pal.bolt, pal.text, 0.5), 0.75);
	cloudSprite = sprite(128, pal.cloud, dark ? 0.7 : 0.26, dark ? 0.4 : 0.14);
	litSprite = sprite(128, dark ? mix(pal.bolt, pal.cloud, 0.35) : mix(pal.bolt, pal.bg, 0.5), dark ? 0.5 : 0.25, 0.18);
	flashSprite = sprite(256, dark ? pal.bolt : mix(pal.bolt, pal.bg, 0.3), dark ? 0.32 : 0.16, 0.1);
	if (w) buildSkyline();
}

// ── Skyline: drawn once per resize, layout or theme into a cached strip along the bottom fifth ──
function buildSkyline() {
	skyH = Math.max(8, Math.round(h * Math.max(0.03, SKYLINE_HEIGHT) + 8));
	skyW = Math.max(1, w);
	skyline = new OffscreenCanvas(Math.round(skyW * dpr), Math.round(skyH * dpr));
	const g = skyline.getContext('2d');
	g.setTransform(dpr, 0, 0, dpr, 0, 0);
	const body = dark ? mix(pal.bg, [0, 0, 0], 0.5) : mix(pal.cloud, pal.bg, 0.25);
	const back = dark ? mix(pal.bg, pal.cloud, 0.6) : mix(pal.cloud, pal.bg, 0.55);
	for (let row = 0; row < 2; row++) {
		let x = -10 - Math.random() * 30;
		while (x < skyW + 10) {
			const bw = 16 + Math.random() * 44;
			const quiet = band(x + bw / 2);
			const tall = (row ? 0.35 : 0.6) + Math.random() * (row ? 0.65 : 0.4);
			const bh = Math.max(6, (skyH - 8) * tall * (1 - 0.55 * quiet));
			const top = skyH - bh;
			g.globalAlpha = (row ? (dark ? 0.85 : 0.5) : (dark ? 0.55 : 0.3)) * (1 - 0.5 * CENTER_CALM * quiet);
			g.fillStyle = rgba(row ? body : back, 1);
			g.fillRect(x, top, bw, bh);
			if (row && quiet < 0.5) {
				g.fillStyle = rgba(pal.win, 1);
				for (let fy = top + 5; fy < skyH - 4; fy += 6) {
					for (let fx = x + 3; fx < x + bw - 4; fx += 5) {
						if (Math.random() < 0.12) { g.globalAlpha = (dark ? 0.35 : 0.3) * (0.4 + Math.random() * 0.6); g.fillRect(fx, fy, 2, 2); }
					}
				}
			}
			x += bw + (row ? 2 + Math.random() * 10 : -4 + Math.random() * 14);
		}
	}
}

// ── Rain: spawn rejected over the chat column so it stays thin there ──
function spawnX() {
	for (let tries = 0; tries < 4; tries++) {
		const x = Math.random() * (w + 200) - 100;
		if (Math.random() < 1 - 0.85 * CENTER_CALM * band(x)) return x;
	}
	return edge(0.15);
}
function resetDrop(i, anywhere) {
	const z = i % 3;
	rx[i] = spawnX();
	ry[i] = anywhere ? Math.random() * h : -20 - Math.random() * 60;
	rs[i] = (480 + z * 330) * (0.85 + Math.random() * 0.3);
	rl[i] = (7 + z * 6) * (0.8 + Math.random() * 0.4);
}

function size() {
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	drops = Math.min(MAX_DROPS, Math.round(w * h / 2400 * RAIN_DENSITY));
	for (let i = 0; i < drops; i++) resetDrop(i, true);
	puffs = Math.min(MAX_PUFFS, Math.round(w / 24 * CLOUD_COVER));
	const s = Math.max(0.6, Math.min(1.2, h / 900));
	for (let i = 0; i < puffs; i++) {
		cx[i] = Math.random() * (w + 400) - 200;
		cy[i] = h * (Math.pow(Math.random(), 1.6) * 0.2 - 0.01);
		cr[i] = (70 + Math.random() * 110) * s;
		cv[i] = 5 + Math.random() * 9;
		ca[i] = 0.55 + Math.random() * 0.45;
	}
	if (w && h) buildSkyline();
}

// ── Lightning: a mean-reverting walk for the channel, forks queued and tapering ──
function addLine(x0, y0, ang, len, depth) {
	if (nLines >= MAX_LINES || nPts >= MAX_PTS - 4) return;
	const li = nLines++;
	lStart[li] = nPts; lDepth[li] = depth;
	const steps = Math.max(4, Math.min(48, Math.floor(len / 13), MAX_PTS - nPts - 1));
	const seg = len / steps, ca2 = Math.cos(ang), sa2 = Math.sin(ang);
	let off = 0;
	px[nPts] = x0; py[nPts] = y0; nPts++;
	for (let i = 1; i <= steps; i++) {
		off = off * 0.82 + (Math.random() - 0.5) * seg * 1.7;
		const d = i * seg;
		const x = x0 + ca2 * d - sa2 * off, y = y0 + sa2 * d + ca2 * off;
		px[nPts] = x; py[nPts] = y; nPts++;
		const t = i / steps;
		if (depth < 3 && i > 2 && i < steps - 2 && Math.random() < BRANCHING * (depth ? 0.08 : 0.14) * (1.1 - t)) {
			if (qCount >= MAX_LINES) continue;
			qx[qCount] = x; qy[qCount] = y; qd[qCount] = depth + 1;
			qa[qCount] = ang + (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.6);
			ql[qCount++] = len * (1 - t) * (0.3 + Math.random() * 0.35);
		}
	}
	lLen[li] = nPts - lStart[li];
}

// Strikes land outside the calm band, nudged outward when called over the column
function strikeX(x) {
	const mid = colX(), reach = colHalf() * 0.95;
	if (Math.abs(x - mid) < reach) {
		// Toward the nearer side, or the other one when the nearer has no room
		const out = x < mid ? mid - reach : mid + reach;
		x = out < w * 0.04 ? mid + reach : out > w * 0.96 ? mid - reach : out;
	}
	return Math.max(w * 0.04, Math.min(w * 0.96, x));
}

function strike(x) {
	if (reduced || bolt.cool > 0) { glowAt(x); return; }
	const x0 = strikeX(x);
	const top = h * (0.06 + Math.random() * 0.06), bottom = h * (0.84 + Math.random() * 0.08);
	const lean = (x0 < colX() ? -1 : 1) * Math.random() * 0.18;
	nPts = 0; nLines = 0; qCount = 0;
	addLine(x0, top, Math.PI / 2 + lean, bottom - top, 0);
	for (let q = 0; q < qCount; q++) addLine(qx[q], qy[q], qa[q], ql[q], qd[q]);
	bolt.x = x0; bolt.age = 0; bolt.cool = 0.9;
}
function glowAt(x) { bolt.glowX = strikeX(x); bolt.glowAge = 0; }

// A strike flickers twice, then fades over half a second
function boltLight(a) { return a < 0.06 ? 1 : a < 0.12 ? 0.35 : a < 0.2 ? 0.9 : Math.max(0, Math.exp(-(a - 0.2) * 6) - 0.01); }

function drawBolt(light) {
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	for (let pass = 0; pass < 3; pass++) {
		ctx.strokeStyle = pass === 0 ? boltGlow : pass === 1 ? boltCore : boltHot;
		for (let l = 0; l < nLines; l++) {
			const fade = lDepth[l] ? Math.pow(0.55, lDepth[l]) : 1;
			if (pass === 2 && lDepth[l] > 1) continue;
			ctx.globalAlpha = light * fade;
			ctx.lineWidth = (pass === 0 ? 9 : pass === 1 ? 2.6 : 1.1) * (lDepth[l] ? 0.7 / lDepth[l] : 1);
			ctx.beginPath();
			const s = lStart[l], e = s + lLen[l];
			ctx.moveTo(px[s], py[s]);
			for (let i = s + 1; i < e; i++) ctx.lineTo(px[i], py[i]);
			ctx.stroke();
		}
	}
}

function frame(now) {
	requestAnimationFrame(frame);
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	if (!w || !h) return;
	const sp = RAIN_SPEED * (reduced ? REDUCED_SPEED : 1);

	// Wind: base slant, slow gusts, and a cursor tilt that eases back after the cursor stops
	gustWait -= dt;
	if (gustWait <= 0) { gustTarget = reduced ? 0 : (Math.random() - 0.25) * GUST_STRENGTH; gustWait = 5 + Math.random() * 9; }
	if (gustWait < 3) gustTarget *= 1 - Math.min(1, dt * 0.4);
	gust += (gustTarget - gust) * Math.min(1, dt * 0.8);
	mouse.amount = Math.max(0, mouse.amount - dt * 0.25);
	const tilt = (mouse.x / w - 0.5) * 0.35 * CURSOR_WIND * mouse.amount;
	wind += (WIND + gust + tilt - wind) * Math.min(1, dt * 1.5);
	const vx = Math.sin(wind), vy = Math.cos(wind);

	// Strike timers
	bolt.age += dt; bolt.glowAge += dt; bolt.cool -= dt;
	if (STRIKE_EVERY > 0) {
		bolt.wait -= dt;
		if (bolt.wait <= 0) { strike(edge(0.3)); bolt.wait = STRIKE_EVERY * (0.5 + Math.random()); }
	}
	bolt.glowWait -= dt;
	if (bolt.glowWait <= 0) { glowAt(edge(0.25)); bolt.glowWait = 6 + Math.random() * 10; }
	const light = bolt.age < 1.2 ? boltLight(bolt.age) : 0;
	const glow = bolt.glowAge < 3 ? Math.sin(Math.PI * bolt.glowAge / 3) * (reduced ? 0.5 : 0.6) : 0;

	ctx.clearRect(0, 0, w, h);

	// Flash: a soft swell over the sky around the strike, never across the column
	if (light > 0.01 && FLASH_INTENSITY > 0) {
		ctx.globalAlpha = Math.min(1, light * FLASH_INTENSITY * 1.6);
		ctx.drawImage(flashSprite, bolt.x - w * 0.32, -h * 0.35, w * 0.64, h * 0.95);
	}

	// Cloud banks, lit from within near a strike or a distant glow
	const drift = dt * sp * 1.4;
	for (let i = 0; i < puffs; i++) {
		cx[i] += cv[i] * drift;
		if (cx[i] > w + 200) cx[i] -= w + 400;
		const r = cr[i], c = calm(cx[i]);
		ctx.globalAlpha = ca[i] * c;
		ctx.drawImage(cloudSprite, cx[i] - r, cy[i] - r * 0.55, r * 2, r * 1.1);
		let lit = 0;
		if (light > 0.01) lit += light * FLASH_INTENSITY * 2.2 * Math.max(0, 1 - Math.abs(cx[i] - bolt.x) / (w * 0.3));
		if (glow > 0.01) lit += glow * Math.max(0, 1 - Math.abs(cx[i] - bolt.glowX) / 260);
		if (lit > 0.01) {
			ctx.globalAlpha = Math.min(1, lit) * c;
			ctx.drawImage(litSprite, cx[i] - r * 0.8, cy[i] - r * 0.4, r * 1.6, r * 0.8);
		}
	}

	if (light > 0.01) drawBolt(light);

	if (skyline) { ctx.globalAlpha = 1; ctx.drawImage(skyline, 0, h - skyH, skyW, skyH); }

	// Rain, one path per depth layer
	for (let l = 0; l < 3; l++) {
		ctx.strokeStyle = rainStyle[l];
		ctx.lineWidth = l === 2 ? 1.2 : 1;
		ctx.globalAlpha = 1;
		ctx.beginPath();
		for (let i = l; i < drops; i += 3) {
			const v = rs[i] * sp;
			rx[i] += vx * v * dt;
			ry[i] += vy * v * dt;
			if (ry[i] > h + 20) resetDrop(i, false);
			else if (rx[i] > w + 120) rx[i] -= w + 220;
			else if (rx[i] < -120) rx[i] += w + 220;
			const len = rl[i] * (0.6 + 0.4 * sp);
			ctx.moveTo(rx[i], ry[i]);
			ctx.lineTo(rx[i] - vx * len, ry[i] - vy * len);
		}
		ctx.stroke();
	}

	ctx.globalAlpha = 1;
}

self.onmessage = (e) => {
	const d = e.data;
	switch (d.type) {
		case 'init':
			canvas = d.canvas;
			ctx = canvas.getContext('2d');
			w = d.width; h = d.height; dpr = Math.min(d.dpr || 1, 2);
			reduced = !!d.reducedMotion;
			column = d.column || null;
			applyTheme(d.theme);
			size();
			requestAnimationFrame(frame);
			break;
		case 'resize':
			w = d.width; h = d.height; dpr = Math.min(d.dpr || 1, 2);
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
			if (canvas && w && h) buildSkyline();
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.amount = 1;
			break;
		case 'mousedown':
			strike(d.x);
			break;
	}
};
