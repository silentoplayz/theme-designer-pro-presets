/**
 * Title: Butterfly Garden
 * Description: Butterflies with wings in your theme's colors flutter along the sides of the screen leaving sparkle trails, flowers sway along the bottom edge, and a moving cursor draws the nearest butterflies after it.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const BUTTERFLIES   = 14;    // butterflies in the garden (2-40)
const BUTTERFLY_SIZE = 20;  // wing length, in px (8-36)
const FLIGHT_SPEED  = 55;    // cruising speed, in px per second (15-150)
const FLAP_SPEED    = 7;     // wing beats per second (2-14)
const SPARKLES      = 1;     // how many sparkles trail each butterfly (0-3)
const FLOWERS       = 18;    // flowers along the bottom edge (0-40)
const POLLEN        = 22;    // drifting pollen motes (0-60)
const ATTRACT       = 1;     // how strongly a moving cursor draws butterflies (0-3)
const MOTION        = 1;     // overall speed (0.2-2)
const REDUCED_SPEED = 0.25;  // speed kept when the viewer asks to reduce motion (0-1)
const CENTER_CALM   = 0.75;  // how much the garden fades and keeps clear of the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const COLOR_A       = '#ff7fb0';  // first wing color when not following the theme
const COLOR_B       = '#9b8cff';  // second wing color
const COLOR_C       = '#ffc861';  // third wing color
const STEM_COLOR    = '#5f8f62';  // flower stem color
/* ──────────────────────────────────────────── */

const U = 44, MAX_SPARK = 220, NV = 3;
let canvas, ctx, w = 0, h = 0, dpr = 1, last = 0, time = 0, reduced = false, dark = true, column = null;
let calmLut = new Float32Array(1), hexes = [COLOR_A, COLOR_B, COLOR_C, STEM_COLOR], stemStyle = STEM_COLOR;
const wings = [], stars = [], blooms = [];
let body = null, mote = null;
const mouse = { x: -10000, y: -10000, energy: 0 };

const NB = BUTTERFLIES;
const fx = new Float32Array(NB), fy = new Float32Array(NB), fvx = new Float32Array(NB), fvy = new Float32Array(NB);
const fwa = new Float32Array(NB), fph = new Float32Array(NB), fsz = new Float32Array(NB), fside = new Float32Array(NB), ftimer = new Float32Array(NB);
const fcol = new Uint8Array(NB);
const sx = new Float32Array(MAX_SPARK), sy = new Float32Array(MAX_SPARK), svy = new Float32Array(MAX_SPARK), slife = new Float32Array(MAX_SPARK), scol = new Uint8Array(MAX_SPARK);
let scount = 0;
const gx = new Float32Array(40), gh = new Float32Array(40), gph = new Float32Array(40), gsz = new Float32Array(40), gcol = new Uint8Array(40);
const px = new Float32Array(60), py = new Float32Array(60), pph = new Float32Array(60);

function rgb(hex) {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(c, a, k) {
	k = k || 0; // k > 0 lifts toward white, k < 0 darkens
	const f = (v) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k));
	return 'rgba(' + f(c[0]) + ',' + f(c[1]) + ',' + f(c[2]) + ',' + a + ')';
}
function sprite(wd, ht) { const s = new OffscreenCanvas(wd, ht); return [s, s.getContext('2d')]; }

function wingPath(g, ww, wh, upper) {
	const y = upper ? -0.05 * wh : 0.03 * wh;
	g.beginPath();
	g.moveTo(0, y);
	if (upper) {
		g.bezierCurveTo(0.4 * ww, y - 0.75 * wh, 1.05 * ww, y - 0.65 * wh, ww, y - 0.1 * wh);
		g.bezierCurveTo(0.9 * ww, y + 0.22 * wh, 0.3 * ww, y + 0.15 * wh, 0, y);
	} else {
		g.bezierCurveTo(0.5 * ww, y + 0.6 * wh, 0.95 * ww, y + 0.75 * wh, 0.72 * ww, y + 0.2 * wh);
		g.bezierCurveTo(0.4 * ww, y - 0.05 * wh, 0.15 * ww, y - 0.05 * wh, 0, y);
	}
	g.closePath();
}

// Right-hand wing pair per color pairing, drawn once at twice the size for crisp edges
function buildSprites() {
	const c = hexes.map(rgb);
	for (let v = 0; v < NV; v++) {
		const a = c[v], b = c[(v + 1) % 3];
		const [s, g] = sprite(U * 2.4, U * 4.4);
		g.scale(2, 2);
		g.translate(1, U * 1.2);
		for (let k = 0; k < 2; k++) {
			const upper = k === 1, ww = upper ? U : U * 0.74, wh = upper ? U * 1.3 : U * 1.0;
			wingPath(g, ww, wh, upper);
			const grad = g.createLinearGradient(0, 0, ww, upper ? -wh * 0.4 : wh * 0.4);
			grad.addColorStop(0, rgba(a, 0.95, dark ? 0.1 : -0.1));
			grad.addColorStop(0.6, rgba(b, 0.9, dark ? 0.2 : 0));
			grad.addColorStop(1, rgba(b, 0.85, dark ? 0.45 : 0.15));
			g.fillStyle = grad;
			g.fill();
			// Dark edge band with pale spots, then veins: the pattern that says butterfly
			g.save();
			g.clip();
			g.strokeStyle = rgba(a, 0.85, -0.6);
			g.lineWidth = upper ? 4.5 : 3.5;
			g.stroke();
			g.fillStyle = rgba(b, 0.9, 0.8);
			for (let i = 0; i < 4; i++) {
				const t = 0.3 + i * 0.2;
				g.beginPath();
				g.arc(ww * (upper ? 0.35 + t * 0.6 : 0.3 + t * 0.4), upper ? -wh * (0.62 - t * 0.45) : wh * (0.45 + t * 0.1), 1.1, 0, 6.2832);
				g.fill();
			}
			g.strokeStyle = rgba(a, 0.3, -0.5);
			g.lineWidth = 0.6;
			for (let i = 0; i < 3; i++) {
				g.beginPath();
				g.moveTo(0, upper ? -0.05 * wh : 0.03 * wh);
				g.lineTo(ww * (0.55 + i * 0.15), upper ? -wh * (0.55 - i * 0.2) : wh * (0.5 - i * 0.12));
				g.stroke();
			}
			g.restore();
		}
		wings[v] = s;

		const [st, sg] = sprite(24, 24);
		const sgr = sg.createRadialGradient(12, 12, 0, 12, 12, 12);
		sgr.addColorStop(0, rgba(a, 1, dark ? 0.7 : 0)); sgr.addColorStop(0.25, rgba(a, 0.5, dark ? 0.2 : 0)); sgr.addColorStop(1, rgba(a, 0, 0));
		sg.fillStyle = sgr; sg.fillRect(0, 0, 24, 24);
		sg.fillStyle = rgba(a, 0.9, dark ? 0.8 : -0.1);
		sg.beginPath(); sg.moveTo(12, 2); sg.lineTo(13.2, 10.8); sg.lineTo(22, 12); sg.lineTo(13.2, 13.2); sg.lineTo(12, 22); sg.lineTo(10.8, 13.2); sg.lineTo(2, 12); sg.lineTo(10.8, 10.8); sg.fill();
		stars[v] = st;

		const [fl, fg] = sprite(48, 48);
		fg.translate(24, 24);
		fg.fillStyle = rgba(a, dark ? 0.9 : 0.85, dark ? 0.15 : 0);
		for (let i = 0; i < 6; i++) { fg.rotate(1.0472); fg.beginPath(); fg.ellipse(0, -11, 6, 11, 0, 0, 6.2832); fg.fill(); }
		fg.fillStyle = rgba(c[(v + 2) % 3], 1, dark ? 0.5 : -0.2);
		fg.beginPath(); fg.arc(0, 0, 5.5, 0, 6.2832); fg.fill();
		blooms[v] = fl;
	}
	let g;
	[body, g] = sprite(16, U * 2.4);
	g.translate(8, U * 1.2);
	g.fillStyle = rgba(c[0], 0.95, -0.7);
	g.beginPath(); g.ellipse(0, 0, 2.6, U * 0.55, 0, 0, 6.2832); g.fill();
	g.strokeStyle = g.fillStyle; g.lineWidth = 1.2;
	g.beginPath(); g.moveTo(-1, -U * 0.5); g.quadraticCurveTo(-5, -U * 0.8, -6, -U * 1.0); g.moveTo(1, -U * 0.5); g.quadraticCurveTo(5, -U * 0.8, 6, -U * 1.0); g.stroke();
	[mote, g] = sprite(12, 12);
	const mg = g.createRadialGradient(6, 6, 0, 6, 6, 6);
	mg.addColorStop(0, rgba(c[2], 1, dark ? 0.6 : 0)); mg.addColorStop(1, rgba(c[2], 0, 0));
	g.fillStyle = mg; g.fillRect(0, 0, 12, 12);
	stemStyle = rgba(rgb(hexes[3]), dark ? 0.55 : 0.6);
}

function applyTheme(t) {
	if (!t) return;
	dark = t.dark !== false;
	if (FOLLOW_THEME && t.colors) hexes = [t.colors.accent, t.colors.accent2, t.colors.accent3, t.colors.muted];
	if (ctx) buildSprites();
}

// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }

// Fade per 4 px across the screen, rebuilt on resize and layout
function buildCalm() {
	calmLut = new Float32Array((w >> 2) + 2);
	const cx = colX(), half = colHalf();
	for (let i = 0; i < calmLut.length; i++) {
		const t = Math.min(1, Math.max(0, (Math.abs(i * 4 - cx) / half - 0.55) / 0.7));
		calmLut[i] = 1 - CENTER_CALM * (1 - t * t * (3 - 2 * t));
	}
}

function calm(x) {
	const i = x >> 2;
	return calmLut[i < 0 ? 0 : i >= calmLut.length ? calmLut.length - 1 : i];
}
// A spot on one side of the chat column, at most reach of the screen wide
function sideX(right, reach) {
	const edge = colX() + (right ? 1 : -1) * colHalf() * 0.55;
	const z = Math.max(40, Math.min(w * reach, right ? w - edge : edge));
	return right ? w - Math.random() * z : Math.random() * z;
}

function size() {
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	buildCalm();
	for (let i = 0; i < NB; i++) {
		fside[i] = i % 2; fx[i] = sideX(fside[i], 0.3); fy[i] = h * (0.1 + Math.random() * 0.7);
		fvx[i] = fvy[i] = 0; fwa[i] = Math.random() * 6.283; fph[i] = Math.random() * 6.283;
		fsz[i] = BUTTERFLY_SIZE * (0.75 + Math.random() * 0.5); fcol[i] = i % NV; ftimer[i] = Math.random() * 0.2;
	}
	for (let i = 0; i < FLOWERS; i++) {
		let x = Math.random() * w;
		for (let k = 0; k < 4 && Math.random() > calm(x) * calm(x); k++) x = Math.random() * w;
		gx[i] = x; gh[i] = 18 + Math.random() * Math.min(70, h * 0.12); gph[i] = Math.random() * 6.283;
		gsz[i] = 16 + Math.random() * 10; gcol[i] = Math.floor(Math.random() * NV);
	}
	for (let i = 0; i < POLLEN; i++) { px[i] = sideX(i % 2, 0.35); py[i] = Math.random() * h; pph[i] = Math.random() * 6.283; }
	scount = 0;
}

function frame(now) {
	requestAnimationFrame(frame);
	const real = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const dt = real * MOTION * (reduced ? REDUCED_SPEED : 1);
	time += dt;
	mouse.energy *= Math.exp(-real * 1.2);
	ctx.clearRect(0, 0, w, h);
	const base = dark ? 0.9 : 0.85;

	// Flowers: one stroke for every stem, then the blooms
	ctx.strokeStyle = stemStyle;
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	for (let i = 0; i < FLOWERS; i++) {
		const s = Math.sin(time * 0.8 + gph[i]) * gh[i] * 0.08;
		ctx.moveTo(gx[i], h + 2);
		ctx.quadraticCurveTo(gx[i] + s, h - gh[i] * 0.5, gx[i] + s * 0.6, h - gh[i]);
	}
	ctx.stroke();
	for (let i = 0; i < FLOWERS; i++) {
		const s = Math.sin(time * 0.8 + gph[i]) * gh[i] * 0.08, d = gsz[i];
		ctx.globalAlpha = base * 0.85 * calm(gx[i]);
		ctx.drawImage(blooms[gcol[i]], gx[i] + s * 0.6 - d / 2, h - gh[i] - d / 2, d, d);
	}

	if (dark) ctx.globalCompositeOperation = 'lighter';
	for (let i = 0; i < POLLEN; i++) {
		py[i] -= 9 * dt;
		px[i] += Math.sin(time * 0.5 + pph[i]) * 8 * dt;
		if (py[i] < -8) { py[i] = h + 8; px[i] = sideX(i % 2, 0.35); }
		ctx.globalAlpha = (dark ? 0.5 : 0.4) * (0.6 + 0.4 * Math.sin(time * 2 + pph[i])) * calm(px[i]);
		ctx.drawImage(mote, px[i] - 4, py[i] - 4, 8, 8);
	}
	// Sparkle trails
	for (let i = 0; i < scount; i++) {
		slife[i] -= dt;
		if (slife[i] <= 0) {
			const j = --scount;
			sx[i] = sx[j]; sy[i] = sy[j]; svy[i] = svy[j]; slife[i] = slife[j]; scol[i] = scol[j];
			i--;
			continue;
		}
		sy[i] += svy[i] * dt;
		const f = slife[i] / 0.9, d = 4 + 8 * f;
		ctx.globalAlpha = (dark ? 0.85 : 0.6) * f * calm(sx[i]);
		ctx.drawImage(stars[scol[i]], sx[i] - d / 2, sy[i] - d / 2, d, d);
	}
	ctx.globalCompositeOperation = 'source-over';

	// Butterflies: wander, keep to their side of the screen, follow a moving cursor
	const pull = ATTRACT * mouse.energy, maxV = FLIGHT_SPEED * 2.2;
	for (let i = 0; i < NB; i++) {
		fwa[i] += (Math.random() - 0.5) * 6 * dt;
		let ax = (Math.cos(fwa[i]) * FLIGHT_SPEED - fvx[i]) * 1.2, ay = (Math.sin(fwa[i]) * FLIGHT_SPEED * 0.7 - fvy[i]) * 1.2;
		const c = calm(fx[i]);
		ax += (fside[i] ? 1 : -1) * (1 - c) * 160;
		if (fy[i] < h * 0.08) ay += 80; else if (fy[i] > h * 0.88) ay -= 80;
		if (fx[i] < 20) ax += 80; else if (fx[i] > w - 20) ax -= 80;
		ay += Math.sin(time * 2.2 + fph[i]) * 40;
		if (pull > 0.02) {
			const dx = mouse.x - fx[i], dy = mouse.y - fy[i], dd = dx * dx + dy * dy;
			if (dd < 62500 && dd > 400) { const dist = Math.sqrt(dd); ax += dx / dist * 220 * pull; ay += dy / dist * 220 * pull; }
		}
		fvx[i] += ax * dt; fvy[i] += ay * dt;
		const sp = Math.hypot(fvx[i], fvy[i]);
		if (sp > maxV) { fvx[i] *= maxV / sp; fvy[i] *= maxV / sp; }
		fx[i] += fvx[i] * dt; fy[i] += fvy[i] * dt;
		if (Math.abs(fx[i] - colX()) < w * 0.1 && mouse.energy < 0.05) fside[i] = fx[i] > colX() ? 1 : 0;

		ftimer[i] -= dt;
		if (SPARKLES > 0 && ftimer[i] <= 0 && scount < MAX_SPARK) {
			const k = scount++;
			sx[k] = fx[i] + (Math.random() - 0.5) * 6; sy[k] = fy[i] + fsz[i] * 0.3; svy[k] = 8 + Math.random() * 12;
			slife[k] = 0.9; scol[k] = fcol[i];
			ftimer[i] = 0.12 / SPARKLES;
		}

		fph[i] += FLAP_SPEED * 6.283 * dt * (1 + pull * 0.4);
		const open = 0.18 + 0.82 * Math.abs(Math.sin(fph[i] * 0.5));
		const k = fsz[i] / U, rot = Math.max(-0.4, Math.min(0.4, fvx[i] / maxV * 0.6));
		const cs = Math.cos(rot), sn = Math.sin(rot), X = dpr * fx[i], Y = dpr * fy[i];
		ctx.globalAlpha = base * Math.max(0.3, c);
		const wsp = wings[fcol[i]], ow = k * 0.5 * open, oh = k * 0.5;
		ctx.setTransform(dpr * cs * ow, dpr * sn * ow, -dpr * sn * oh, dpr * cs * oh, X, Y);
		ctx.drawImage(wsp, -2, -U * 2.4);
		ctx.setTransform(-dpr * cs * ow, -dpr * sn * ow, -dpr * sn * oh, dpr * cs * oh, X, Y);
		ctx.drawImage(wsp, -2, -U * 2.4);
		ctx.setTransform(dpr * cs * k, dpr * sn * k, -dpr * sn * k, dpr * cs * k, X, Y);
		ctx.drawImage(body, -8, -U * 1.2);
	}
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
			buildSprites();
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
			if (!canvas) break;
			buildCalm();
			for (let i = 0; i < NB; i++) fside[i] = fx[i] > colX() ? 1 : 0;
			break;
		case 'mousemove':
			if (mouse.x > -9000) mouse.energy = Math.min(1, mouse.energy + Math.hypot(d.x - mouse.x, d.y - mouse.y) / 80);
			mouse.x = d.x; mouse.y = d.y;
			break;
	}
};
