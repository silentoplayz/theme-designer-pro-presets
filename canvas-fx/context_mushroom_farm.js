/**
 * Title: Context Mushroom Farm
 * Description: A grow bed along the bottom of the screen where mycelium spreads, pins rise and glowing caps open as the chat's context fills, with spores that drift toward the cursor and a token badge in the corner.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const MAX_TOKENS    = 128000; // your model's context limit, in tokens (4000-2000000)
const GROWTH_SPEED  = 1;      // multiplies the fill, for previewing growth (1-50)
const PREVIEW_RATIO = 0;      // fill shown until the first chat context arrives (0-1)
const CLUSTERS      = 12;     // mushroom clusters along the bed (4-24)
const GROW_HEIGHT   = 0.18;   // share of the screen's height the farm may fill (0.1-0.25)
const SPORES        = 60;     // spores in the air at full growth (0-150)
const MOTION        = 1;      // speed of sway and spores; 0 holds still (0-2)
const CURSOR_PULL   = 1;      // how strongly spores drift toward the cursor (0-3)
const CENTER_CALM   = 0.7;    // how much the farm shrinks and fades behind the chat column (0-1)
const BAND_WIDTH    = 520;    // half-width of the calm band around the chat column, in px (300-900)
const SHOW_BADGE    = true;   // show the token count in the bottom-right corner
const FOLLOW_THEME  = true;   // take the colors from the theme's palette
const COLOR_GLOW    = '#3fe0c0'; // first glowing cap color when not following the theme
const COLOR_GLOW_2  = '#b06cf0'; // second glowing cap color
const COLOR_GLOW_3  = '#6fa8ff'; // third glowing cap color
const COLOR_CAP     = '#b07a52'; // plain cap color
const COLOR_STEM    = '#d8cfbf'; // stem and mycelium color
/* ──────────────────────────────────────────── */

// Stages by context fill: 0 a seeded bed with resting mycelium and glowing pins;
// 0-0.25 mycelium spreads; 0.05-1 stems rise cluster by cluster; 0.3-0.8 caps open;
// 0.5-1 caps glow; 0.55-1 spores fill the air; 0.9-1 caps droop, the context is nearly full.

const MAXM = 120, MAXT = 240, MAXS = 200;
const F = (n) => new Float32Array(n);
const mX = F(MAXM), mY = F(MAXM), mH = F(MAXM), mW = F(MAXM), mR = F(MAXM), mLean = F(MAXM), mPh = F(MAXM), mDelay = F(MAXM), mA = F(MAXM);
const mCl = new Uint8Array(MAXM), mCol = new Uint8Array(MAXM), mRound = new Uint8Array(MAXM), mPin = new Uint8Array(MAXM);
const cX = F(24), cY = F(24), cStart = F(24), cA = F(24);
const tCl = new Uint8Array(MAXT), tDX = F(MAXT), tDY = F(MAXT), tPh = F(MAXT);
const sX = F(MAXS), sY = F(MAXS), sVX = F(MAXS), sVY = F(MAXS), sLife = F(MAXS), sMax = F(MAXS), sSize = F(MAXS), sCol = new Uint8Array(MAXS);

let canvas, ctx, w = 0, h = 0, dpr = 1, last = 0, reduced = false, dark = true;
let mCount = 0, tCount = 0, nCl = 0, groundY = 0, seed = 1, time = 0, emitAcc = 0;
let ratio = 0, target = 0, tokens = 0, shown = -1, badgeText = '', live = false;
let bedPath = null, bedFill = null;
const mouse = { x: -10000, y: -10000, amount: 0 };
const col = { glow: [], cap: [], hi: [], shade: [], spore: [], bed: [0, 0, 0] };

function rgbOf(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function css(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a === undefined ? 1 : a) + ')'; }
function rand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
// 1 over the chat column, falling smoothly to 0 beyond the calm band
function band(x) { const t = clamp01((Math.abs(x - w / 2) / BAND_WIDTH - 0.55) / 0.7); return 1 - t * t * (3 - 2 * t); }
function glowMode(on) { ctx.globalCompositeOperation = on && dark ? 'lighter' : 'source-over'; }

function sprite(c) {
	const s = new OffscreenCanvas(64, 64), g = s.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
	gr.addColorStop(0, css(c, 1));
	gr.addColorStop(0.3, css(c, 0.4));
	gr.addColorStop(1, css(c, 0));
	g.fillStyle = gr;
	g.fillRect(0, 0, 64, 64);
	return s;
}

function applyTheme(t) {
	if (t) dark = t.dark !== false;
	const th = FOLLOW_THEME && t && t.colors ? t.colors : null;
	const bg = rgbOf(th ? th.background : dark ? '#16141f' : '#f4f6f9');
	const text = rgbOf(th ? th.text : dark ? '#ece8f2' : '#1c222b');
	const muted = rgbOf(th ? th.muted : dark ? '#8a8494' : '#6b7480');
	let g = th ? [th.accent, th.accent2, th.accent3].map(rgbOf) : [COLOR_GLOW, COLOR_GLOW_2, COLOR_GLOW_3].map(rgbOf);
	if (!th && !dark) g = g.map((c) => mix(c, text, 0.35));
	const caps = [g[0], g[1], g[2], th ? mix(muted, g[1], 0.3) : rgbOf(COLOR_CAP)];
	for (let i = 0; i < 4; i++) {
		const c = caps[i];
		col.cap[i] = css(dark ? mix(c, bg, 0.2) : c);
		col.hi[i] = css(mix(c, dark ? text : bg, 0.5));
		col.shade[i] = css(mix(c, dark ? bg : text, dark ? 0.6 : 0.4));
		col.glow[i] = sprite(i < 3 ? (dark ? mix(c, text, 0.15) : c) : muted);
		if (i < 3) col.spore[i] = sprite(dark ? mix(c, text, 0.35) : c);
	}
	const stem = th ? muted : rgbOf(COLOR_STEM);
	col.stem = css(th ? mix(stem, text, dark ? 0.55 : 0.25) : dark ? stem : mix(stem, text, 0.55));
	col.spot = css(dark ? text : bg);
	col.bed = muted;
	col.panel = css(rgbOf(th ? th.surface : dark ? '#22202f' : '#e9edf2'), dark ? 0.78 : 0.85);
	col.text = css(text);
	col.label = css(muted);
	col.track = css(muted, 0.25);
	col.bar = css(g[0]);
	col.warn = dark ? '#facc15' : '#b45309';
	col.alert = dark ? '#f87171' : '#dc2626';
	if (ctx && groundY) buildBed();
}

function buildBed() {
	bedPath = new Path2D();
	bedPath.moveTo(0, h);
	for (let x = 0; x <= w + 40; x += 40) bedPath.lineTo(x, groundY - 4 + Math.sin(x * 0.013) * 3 + Math.sin(x * 0.041) * 1.5);
	bedPath.lineTo(w, h);
	const a = dark ? 0.22 : 0.16;
	bedFill = ctx.createLinearGradient(0, 0, w, 0);
	bedFill.addColorStop(0, css(col.bed, a));
	bedFill.addColorStop(0.5, css(col.bed, a * (1 - CENTER_CALM * 0.6)));
	bedFill.addColorStop(1, css(col.bed, a));
}

function build() {
	seed = 42;
	groundY = h - Math.max(14, Math.min(30, h * 0.032));
	const topLimit = h * (1 - GROW_HEIGHT), k = Math.max(0.7, Math.min(1.2, h / 900));
	const right = w * 0.97 - (SHOW_BADGE ? 170 : 0), mid = w * 0.5, half = Math.min(mid - w * 0.03, right - mid);
	nCl = Math.min(24, CLUSTERS);
	mCount = tCount = 0;
	for (let i = 0; i < nCl; i++) {
		// Even spacing with jitter, pushed toward the outer thirds
		const s = ((i + 0.2 + rand() * 0.6) / nCl) * 2 - 1;
		const x = mid + Math.sign(s) * Math.pow(Math.abs(s), 0.75) * (s < 0 ? mid - w * 0.03 : half);
		const b = band(x), scale = 1 - 0.5 * CENTER_CALM * b;
		cX[i] = x;
		cY[i] = groundY + 1 + rand() * 6;
		cStart[i] = rand() * 0.3;
		cA[i] = 1 - CENTER_CALM * b;
		const c = rand() > 0.35 ? Math.floor(rand() * 3) : 3, n = 2 + Math.floor(rand() * 4);
		for (let j = 0; j < n && mCount < MAXM; j++, mCount++) {
			const r = (8 + rand() * 15) * scale * k;
			mX[mCount] = x + (rand() - 0.5) * 56 * scale;
			mY[mCount] = cY[i] + (rand() - 0.5) * 4;
			mR[mCount] = r;
			mH[mCount] = Math.max(8, groundY - topLimit - r * 0.7) * (0.3 + rand() * 0.7) * scale;
			mW[mCount] = (2.5 + rand() * 4.5) * scale * k;
			mRound[mCount] = rand() > 0.45 ? 1 : 0;
			mLean[mCount] = (rand() - 0.5) * 0.3;
			mPh[mCount] = rand() * 6.283;
			mDelay[mCount] = j === 0 ? 0 : rand() * 0.25;
			mA[mCount] = cA[i];
			mCl[mCount] = i;
			mCol[mCount] = c;
			mPin[mCount] = j < 3 ? 3 - j : 0;
		}
		const nt = 5 + Math.floor(rand() * 6);
		for (let j = 0; j < nt && tCount < MAXT; j++, tCount++) {
			const an = -0.25 + rand() * 3.64, l = (18 + rand() * 40) * scale;
			tCl[tCount] = i;
			tDX[tCount] = Math.cos(an) * l;
			tDY[tCount] = Math.sin(an) * l * 0.3;
			tPh[tCount] = rand() * 6.283;
		}
	}
	sLife.fill(0);
	buildBed();
}

function size() {
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	build();
}

// Eased growth of one mushroom; the first three of each cluster rest as pins at zero
function growth(m) {
	const c = mCl[m], g = clamp01((clamp01((ratio - cStart[c]) / (1 - cStart[c])) - mDelay[m]) / (1 - mDelay[m]));
	return Math.max(mPin[m] * 0.06, 1 - (1 - g) * (1 - g));
}

function spawn(m, burst) {
	const g = growth(m);
	if (g <= 0) return;
	for (let i = 0; i < MAXS; i++) {
		if (sLife[i] > 0) continue;
		sX[i] = mX[m] + mLean[m] * mH[m] * g + (Math.random() - 0.5) * mR[m];
		sY[i] = mY[m] - mH[m] * g;
		sVX[i] = (Math.random() - 0.5) * (burst ? 40 : 8);
		sVY[i] = -(12 + Math.random() * 18) * (burst ? 1.8 : 1);
		sMax[i] = sLife[i] = 6 + Math.random() * 7;
		sSize[i] = 3 + Math.random() * 5;
		sCol[i] = mCol[m] < 3 ? mCol[m] : Math.floor(Math.random() * 3);
		return;
	}
}

function drawMushroom(m, sway, droop) {
	const g = growth(m), x = mX[m], y = mY[m], sh = mH[m] * g, c = mCol[m], a = mA[m] * (dark ? 0.9 : 0.8);
	const lean = mLean[m] * sh + Math.sin(time * 0.8 + mPh[m]) * 1.5 * sway * g, tx = x + lean, ty = y - sh, sw = mW[m] * (0.5 + g * 0.5);
	const pulse = 0.75 + 0.25 * Math.sin(time * 1.3 + mPh[m]);
	ctx.globalAlpha = a;
	ctx.fillStyle = col.stem;
	ctx.beginPath();
	ctx.moveTo(x - sw / 2, y);
	ctx.quadraticCurveTo(x - sw / 3 + lean * 0.3, y - sh * 0.5, tx - sw / 3, ty);
	ctx.lineTo(tx + sw / 3, ty);
	ctx.quadraticCurveTo(x + sw / 3 + lean * 0.3, y - sh * 0.5, x + sw / 2, y);
	ctx.fill();
	// A pin is a small glowing button; a cap opens, then lights up from g = 0.5
	const open = clamp01((g - 0.3) / 0.5), pin = open <= 0, r = pin ? 1.8 + mR[m] * g : mR[m] * (0.3 + 0.7 * open);
	const tilt = (mLean[m] + (lean > 0 ? 0.25 : -0.25) * droop) * 0.9, cy = ty + r * 0.15 * droop;
	const k = c < 3 ? Math.max(0.85 * (1 - open * 2.5), (g - 0.5) * 2) : 0;
	if (k > 0) {
		const near = Math.max(0, 1 - Math.hypot(mouse.x - tx, mouse.y - cy) / 160) * mouse.amount, R = r * (pin ? 5 : 3.2);
		glowMode(true);
		ctx.globalAlpha = a * k * pulse * (1 + near * 0.8) * (dark ? 0.46 : 0.22);
		ctx.drawImage(col.glow[c], tx - R, cy - R, R * 2, R * 2);
		glowMode(false);
		ctx.globalAlpha = a;
	}
	ctx.fillStyle = col.cap[c];
	if (pin) {
		ctx.beginPath();
		ctx.ellipse(tx, ty, r, r * 0.8, 0, 0, 6.283);
		ctx.fill();
		return;
	}
	const fy = mRound[m] ? 0.62 : 0.36, fx = mRound[m] ? 1 : 1.12;
	ctx.beginPath();
	ctx.ellipse(tx, cy, r * fx, r * fy, tilt, Math.PI, 6.283);
	ctx.fill();
	ctx.fillStyle = col.shade[c];
	ctx.beginPath();
	ctx.ellipse(tx, cy, r * fx * 0.96, r * 0.16, tilt, 0, Math.PI);
	ctx.fill();
	ctx.globalAlpha = a * 0.55;
	ctx.fillStyle = col.hi[c];
	ctx.beginPath();
	ctx.ellipse(tx - r * 0.25, cy - r * fy * 0.55, r * 0.42, r * fy * 0.3, tilt - 0.2, 0, 6.283);
	ctx.fill();
	if (c === 3 && open > 0.6) {
		ctx.globalAlpha = mA[m] * (open - 0.6) * 1.6;
		ctx.fillStyle = col.spot;
		ctx.beginPath();
		for (let s = 0; s < 4; s++) {
			const an = mPh[m] + s * 2.1, d = (0.2 + 0.12 * s) * r;
			const px = tx + Math.cos(an) * d, py = cy - r * fy * (0.25 + 0.35 * Math.abs(Math.sin(an)));
			ctx.moveTo(px + 1.6, py);
			ctx.arc(px, py, 1.6, 0, 6.283);
		}
		ctx.fill();
	}
}

function drawBadge() {
	const t = Math.round(tokens / 100);
	if (t !== shown) {
		shown = t;
		badgeText = (tokens >= 1000 ? (tokens / 1000).toFixed(1) + 'k' : String(Math.round(tokens))) + ' / ' + Math.round(MAX_TOKENS / 1000) + 'k';
	}
	const bw = 172, x = w - bw - 14, y = h - 52;
	ctx.globalAlpha = 1;
	ctx.fillStyle = col.panel;
	ctx.beginPath();
	ctx.roundRect(x, y, bw, 38, 8);
	ctx.fill();
	ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
	ctx.textAlign = 'left';
	ctx.fillStyle = col.label;
	ctx.fillText('Context', x + 12, y + 17);
	ctx.font = '11px ui-monospace, monospace';
	ctx.textAlign = 'right';
	ctx.fillStyle = col.text;
	ctx.fillText(badgeText, x + bw - 12, y + 17);
	ctx.fillStyle = col.track;
	ctx.fillRect(x + 12, y + 25, bw - 24, 4);
	ctx.fillStyle = ratio > 0.9 ? col.alert : ratio > 0.7 ? col.warn : col.bar;
	ctx.fillRect(x + 12, y + 25, (bw - 24) * clamp01(ratio), 4);
}

function frame(now) {
	requestAnimationFrame(frame);
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const speed = MOTION * (reduced ? 0.15 : 1), mdt = dt * speed;
	time = (time + mdt) % 6283;
	ratio += (target - ratio) * Math.min(1, dt * (target < ratio ? 1.2 : 0.5));
	mouse.amount = Math.max(0, mouse.amount - dt * 0.6);
	ctx.clearRect(0, 0, w, h);

	// Fog and the farm's ambient glow, low and in the outer thirds
	for (let k = 0; k < 2; k++) {
		const fx = w * (k ? 0.82 : 0.18) + Math.sin(time * 0.05 + k * 2) * 40, fw = w * 0.42;
		ctx.globalAlpha = (dark ? 0.12 : 0.08) + ratio * 0.06;
		ctx.drawImage(col.glow[3], fx - fw / 2, groundY - 70, fw, 120);
		if (ratio > 0.3) {
			glowMode(true);
			ctx.globalAlpha = (ratio - 0.3) * (dark ? 0.16 : 0.08);
			ctx.drawImage(col.glow[k], fx - fw / 2, groundY - 110, fw, 180);
			glowMode(false);
		}
	}

	// The bed and the mycelium threading through it
	ctx.globalAlpha = 1;
	ctx.fillStyle = bedFill;
	ctx.fill(bedPath);
	ctx.strokeStyle = col.stem;
	const myc = Math.max(0.3, Math.min(1, ratio * 4));
	ctx.lineWidth = 0.8;
	for (let c = 0; c < nCl; c++) {
		ctx.globalAlpha = cA[c] * (dark ? 0.28 : 0.22) * (0.6 + 0.4 * myc);
		ctx.beginPath();
		for (let i = 0; i < tCount; i++) {
			if (tCl[i] !== c) continue;
			const dx = tDX[i] * myc, dy = tDY[i] * myc;
			ctx.moveTo(cX[c], cY[c]);
			ctx.quadraticCurveTo(cX[c] + dx * 0.5, cY[c] + dy * 0.2 + 4, cX[c] + dx + Math.sin(time * 0.6 + tPh[i]) * 2, cY[c] + dy + 3);
		}
		ctx.stroke();
	}

	const droop = clamp01((ratio - 0.9) / 0.1);
	for (let i = 0; i < mCount; i++) drawMushroom(i, speed, droop);

	// Spores rise from the caps and drift toward a moving cursor
	if (speed > 0 && mCount) {
		emitAcc += dt * SPORES * (0.08 + 0.92 * clamp01((ratio - 0.55) / 0.45)) / 9;
		while (emitAcc >= 1) { emitAcc -= 1; spawn(Math.floor(Math.random() * mCount), false); }
	}
	glowMode(true);
	const pull = reduced ? 0 : CURSOR_PULL * mouse.amount * 60, damp = Math.exp(-mdt * 0.8);
	for (let i = 0; i < MAXS; i++) {
		if (sLife[i] <= 0) continue;
		sLife[i] -= mdt;
		const dx = mouse.x - sX[i], dy = mouse.y - sY[i], d2 = dx * dx + dy * dy;
		if (pull > 0 && d2 < 40000 && d2 > 1) { const d = Math.sqrt(d2); sVX[i] += (dx / d) * pull * mdt; sVY[i] += (dy / d) * pull * mdt; }
		sVX[i] *= damp;
		sVY[i] = -14 + (sVY[i] + 14) * damp;
		sX[i] += (sVX[i] + Math.sin(time * 0.9 + i) * 6) * mdt;
		sY[i] += sVY[i] * mdt;
		const s = sSize[i];
		ctx.globalAlpha = Math.sin(Math.PI * sLife[i] / sMax[i]) * (dark ? 0.75 : 0.5) * (1 - CENTER_CALM * band(sX[i]));
		ctx.drawImage(col.spore[sCol[i]], sX[i] - s, sY[i] - s, s * 2, s * 2);
	}
	glowMode(false);

	if (SHOW_BADGE && (tokens > 0 || live)) drawBadge();
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
			if (PREVIEW_RATIO > 0) { ratio = target = PREVIEW_RATIO; tokens = (PREVIEW_RATIO * MAX_TOKENS) / GROWTH_SPEED; }
			applyTheme(d.theme);
			size();
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
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.amount = 1;
			break;
		case 'mousedown': {
			// A tap shakes a gentle puff of spores from the nearest cluster
			if (reduced || !mCount) break;
			let best = 0;
			for (let i = 1; i < mCount; i++) if (Math.abs(mX[i] - d.x) < Math.abs(mX[best] - d.x)) best = i;
			for (let k = 0; k < 5 + ratio * 10; k++) spawn(best, true);
			break;
		}
		case 'context': {
			// Exact tokens when the engine has them, else the estimate; a new chat empties the farm
			live = true;
			if (d.messages === 0) { tokens = target = 0; break; }
			const t = typeof d.exactTokens === 'number' ? d.exactTokens : d.estimatedTokens;
			if (typeof t === 'number') { tokens = t; target = Math.min(1, (t / MAX_TOKENS) * GROWTH_SPEED); }
			break;
		}
	}
};
