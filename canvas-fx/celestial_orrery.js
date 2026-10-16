/**
 * Title: Celestial Orrery
 * Description: A brass orrery in a corner of the screen: gemstone planets with fading trails circle a pulsing star on engraved rings and turning gears, speed up near the cursor, and ride a pulse wave from the star on each tap.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const ORRERY_X      = 0.97;  // horizontal position of the star, as a share of the width (0-1)
const ORRERY_Y      = 0.8;   // vertical position of the star, as a share of the height (0-1)
const ORRERY_SIZE   = 0.6;   // largest orbit as a share of the smaller screen side; shrinks to stay clear of the chat (0.2-1)
const PLANETS       = 6;     // gemstone planets (2-8)
const ORBIT_SPEED   = 1;     // how fast the planets circle (0-3)
const REDUCED_SPEED = 0.2;   // share of the speed kept under reduced motion (0-1)
const TRAIL_LENGTH  = 40;    // length of the planet trails, in samples (0-80)
const STAR_FIELD    = 90;    // faint background stars, dark themes only (0-300)
const CURSOR_BOOST  = 1.5;   // how much planets near the cursor speed up; fades once it stops (0-4)
const PULSE         = 0.8;   // strength of the pulse wave a tap sends out from the star (0-2)
const GEARS         = true;  // gear teeth on two of the rings
const CENTER_CALM   = 0.8;   // how much the background stars thin behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const FOLLOW_THEME  = true;  // take ring, star and gem colors from the theme
const BRASS_COLOR   = '#c9a45c';  // rings and gears when not following the theme
const STAR_COLOR    = '#ffd890';  // central star
/* ──────────────────────────────────────────── */

const MAX_P = 8, MAX_TRAIL = 80, MAX_STARS = 300, MAX_PULSES = 5, TAU = Math.PI * 2, CHUNKS = 4;
const GEMS = ['#e0475b', '#4a7fe0', '#3fbf7f', '#f0a93a', '#a46cf0', '#3fc7c0', '#e070b8', '#9ad35a'];
const DASH = [5, 7], NO_DASH = [];
const F = (n) => new Float32Array(n);

let canvas, ctx, w = 0, h = 0, dpr = 1, last = 0, reduced = false, dark = true, theme = null, column = null;
let ox = 0, oy = 0, R = 200, fade = 1, time = 0;
let ringCache, coreSprite, coronaSprite, gemSprite = [], glowSprite = [], trailStyle = [], gearStyle = '', threadStyle = '', pulseStyle = '', starStyle = '', moonStyle = '';
const orbit = F(MAX_P), angle = F(MAX_P), speed = F(MAX_P), size = F(MAX_P), px = F(MAX_P), py = F(MAX_P), moonA = F(MAX_P);
const trail = F(MAX_P * MAX_TRAIL * 2), trailHead = new Uint8Array(MAX_P), trailFill = new Uint8Array(MAX_P);
let trailClock = 0;
const sx = F(MAX_STARS), sy = F(MAX_STARS), sa = F(MAX_STARS), sb = F(MAX_STARS), sph = F(MAX_STARS);
let stars = 0;
const pr = F(MAX_PULSES), pstr = F(MAX_PULSES);
let pulseHead = 0;
const mouse = { x: -10000, y: -10000, amount: 0 };

function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function rgba(c, a) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a.toFixed(3) + ')'; }
// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }

function band(x) {
	const t = Math.min(1, Math.max(0, (Math.abs(x - colX()) / colHalf() - 0.55) / 0.7));
	return 1 - t * t * (3 - 2 * t);
}

function radial(size, stops) {
	const c = new OffscreenCanvas(size, size), g = c.getContext('2d'), r = size / 2;
	const grad = g.createRadialGradient(r * 0.8, r * 0.8, 0, r, r, r);
	for (let i = 0; i < stops.length; i += 2) grad.addColorStop(stops[i], stops[i + 1]);
	g.fillStyle = grad;
	g.fillRect(0, 0, size, size);
	return c;
}

// Colors and sprites, rebuilt on theme change, resize and layout
function build() {
	const c = FOLLOW_THEME && theme && theme.colors ? theme.colors : null;
	const brass = c ? mix(hex(c.muted), hex(BRASS_COLOR), 0.3) : hex(BRASS_COLOR);
	const star = c ? mix(hex(STAR_COLOR), hex(c.accent2), 0.35) : hex(STAR_COLOR);
	const k = dark ? 1 : 0.7;
	const pick = c ? [c.accent, c.accent2, c.accent3] : null;
	for (let i = 0; i < MAX_P; i++) {
		let gem = hex(GEMS[i]);
		if (pick) gem = i < 3 ? hex(pick[i]) : mix(hex(pick[i % 3]), hex(pick[(i + 1) % 3]), 0.5);
		if (!dark) gem = mix(gem, c ? hex(c.text) : [30, 30, 40], 0.2);
		const s = 32;
		gemSprite[i] = radial(s, [0, rgba(mix(gem, [255, 255, 255], 0.55), 1), 0.45, rgba(gem, 1), 0.92, rgba(mix(gem, [0, 0, 0], 0.35), 1), 1, rgba(mix(gem, [0, 0, 0], 0.35), 0)]);
		glowSprite[i] = radial(64, [0, rgba(gem, 0.45 * k), 0.4, rgba(gem, 0.15 * k), 1, rgba(gem, 0)]);
		trailStyle[i] = rgba(gem, 1);
	}
	coreSprite = radial(64, [0, rgba(mix(star, [255, 255, 255], 0.75), 1), 0.5, rgba(star, 0.95), 0.85, rgba(mix(star, [255, 120, 40], 0.3), 0.6), 1, rgba(star, 0)]);
	coronaSprite = radial(128, [0, rgba(star, 0.45 * k), 0.3, rgba(star, 0.14 * k), 1, rgba(star, 0)]);
	gearStyle = rgba(brass, dark ? 0.35 : 0.5);
	threadStyle = rgba(mix(brass, star, 0.5), 1);
	pulseStyle = rgba(star, 1);
	starStyle = rgba(c ? hex(c.text) : [220, 230, 255], 1);
	moonStyle = rgba(c ? mix(hex(c.text), hex(c.muted), dark ? 0.2 : 0.6) : [220, 220, 230], 1);
	if (!w) return;
	// Engraved rings, cached: a double hairline with a dashed track between
	const box = Math.ceil((R + 20) * 2);
	ringCache = new OffscreenCanvas(Math.round(box * dpr), Math.round(box * dpr));
	const g = ringCache.getContext('2d');
	g.setTransform(dpr, 0, 0, dpr, box / 2 * dpr - ox * dpr, box / 2 * dpr - oy * dpr);
	const plate = g.createRadialGradient(ox, oy, R * 0.2, ox, oy, R + 14);
	plate.addColorStop(0, rgba(brass, dark ? 0.07 : 0.06));
	plate.addColorStop(1, rgba(brass, dark ? 0.02 : 0.015));
	g.fillStyle = plate;
	g.beginPath(); g.arc(ox, oy, R + 14, 0, TAU); g.fill();
	g.strokeStyle = rgba(brass, dark ? 0.3 : 0.5);
	for (let i = 0; i < PLANETS; i++) {
		g.lineWidth = 0.6;
		g.setLineDash(NO_DASH);
		g.beginPath(); g.arc(ox, oy, orbit[i] - 3, 0, TAU); g.stroke();
		g.beginPath(); g.arc(ox, oy, orbit[i] + 3, 0, TAU); g.stroke();
		g.lineWidth = 1;
		g.setLineDash(DASH);
		g.beginPath(); g.arc(ox, oy, orbit[i], 0, TAU); g.stroke();
	}
	g.setLineDash(NO_DASH);
	g.lineWidth = 1.2;
	g.beginPath(); g.arc(ox, oy, R + 14, 0, TAU); g.stroke();
}

// Room between a star at x and the chat column's edge
function room(x) { const cx = colX(), e = colHalf() - 36; return x >= cx ? x - (cx + e) : (cx - e) - x; }

// Places the orrery so its outer ring stays clear of the chat column, on the far side when its own side is cramped and the far side roomier
// (the column sits centered in the chat area, so both sides often measure the same; then it stays put)
function place() {
	// Measured across the chat area, which leaves out the sidebar
	const lo = column ? column.left : 0, aw = (column ? column.right : w) - lo;
	ox = lo + aw * ORRERY_X; oy = h * ORRERY_Y;
	let clear = room(ox);
	const flip = room(lo + aw * (1 - ORRERY_X));
	if (clear - 16 < ORRERY_SIZE * Math.min(w, h) * 0.3 && flip > clear + 1) { ox = lo + aw * (1 - ORRERY_X); clear = flip; }
	R = Math.max(70, Math.min(ORRERY_SIZE * Math.min(w, h) * 0.5, clear - 16));
	fade = clear - 16 >= 70 ? 1 : 0.6;
	const n = Math.min(MAX_P, PLANETS);
	for (let i = 0; i < n; i++) {
		orbit[i] = R * (0.3 + 0.7 * i / Math.max(1, n - 1));
		speed[i] = 0.55 / Math.pow(orbit[i] / orbit[0], 1.5);
		size[i] = Math.max(2.5, R / 220 * (4.5 + (i * 7 % 5)));
		angle[i] = Math.random() * TAU;
		moonA[i] = Math.random() * TAU;
		trailFill[i] = 0; trailHead[i] = 0;
	}
}

// Background stars thin behind the chat column, recomputed on resize and layout
function thinStars() { for (let i = 0; i < stars; i++) sa[i] = sb[i] * (1 - CENTER_CALM * band(sx[i])); }

function resize() {
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	place();
	stars = Math.min(MAX_STARS, Math.round(STAR_FIELD * Math.max(0.5, w * h / (1440 * 900))));
	for (let i = 0; i < stars; i++) {
		sx[i] = Math.random() * w; sy[i] = Math.random() * h;
		sb[i] = 0.15 + Math.random() * 0.35;
		sph[i] = Math.random() * TAU;
	}
	thinStars();
	pstr.fill(0);
	build();
}

function frame(now) {
	requestAnimationFrame(frame);
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	if (!w || !h) return;
	const motion = ORBIT_SPEED * (reduced ? REDUCED_SPEED : 1);
	time = (time + dt * (reduced ? REDUCED_SPEED : 1)) % 10000;
	ctx.clearRect(0, 0, w, h);
	ctx.globalCompositeOperation = 'source-over';
	const n = Math.min(MAX_P, PLANETS);

	// Background stars
	if (dark) {
		ctx.fillStyle = starStyle;
		for (let i = 0; i < stars; i++) {
			ctx.globalAlpha = sa[i] * (0.6 + 0.4 * Math.sin(time * 0.8 + sph[i]));
			ctx.fillRect(sx[i], sy[i], 1.2, 1.2);
		}
	}

	ctx.globalAlpha = fade;
	const box = ringCache.width / dpr;
	ctx.drawImage(ringCache, ox - box / 2, oy - box / 2, box, box);

	// Gear teeth on rings 1 and 4, turning slowly in opposite directions
	if (GEARS) {
		ctx.fillStyle = gearStyle;
		ctx.beginPath();
		for (let gi = 1; gi < n; gi += 3) {
			const r = orbit[gi] + 3, teeth = Math.round(r / 3.5), turn = time * 0.08 * (gi % 2 ? -1 : 1), half = Math.PI / teeth * 0.5;
			for (let t = 0; t < teeth; t++) {
				const a = turn + t / teeth * TAU;
				ctx.moveTo(ox + Math.cos(a - half) * r, oy + Math.sin(a - half) * r);
				ctx.lineTo(ox + Math.cos(a - half * 0.55) * (r + 3), oy + Math.sin(a - half * 0.55) * (r + 3));
				ctx.lineTo(ox + Math.cos(a + half * 0.55) * (r + 3), oy + Math.sin(a + half * 0.55) * (r + 3));
				ctx.lineTo(ox + Math.cos(a + half) * r, oy + Math.sin(a + half) * r);
			}
		}
		ctx.fill();
	}

	// Pulses travel out from the star and fade by time
	mouse.amount = Math.max(0, mouse.amount - dt * 0.5);
	for (let k = 0; k < MAX_PULSES; k++) {
		if (pstr[k] <= 0.01) continue;
		pr[k] += 160 * dt * (reduced ? 0.4 : 1);
		pstr[k] *= Math.exp(-dt * 1.6);
		if (pr[k] > R * 1.4) pstr[k] = 0;
		ctx.strokeStyle = pulseStyle;
		ctx.lineWidth = 1.5;
		ctx.globalAlpha = pstr[k] * 0.45 * fade;
		ctx.beginPath(); ctx.arc(ox, oy, pr[k], 0, TAU); ctx.stroke();
	}

	// Planets: Kepler-ish speeds, a cursor boost and a lift as a pulse passes
	trailClock += dt;
	const sample = trailClock >= 1 / 20;
	if (sample) trailClock = 0;
	const hood = 180, hood2 = hood * hood;
	for (let i = 0; i < n; i++) {
		let m = 1;
		const dx = px[i] - mouse.x, dy = py[i] - mouse.y, dd = dx * dx + dy * dy;
		if (dd < hood2) { const f = 1 - Math.sqrt(dd) / hood; m += f * f * CURSOR_BOOST * mouse.amount; }
		for (let k = 0; k < MAX_PULSES; k++) {
			if (pstr[k] <= 0.01) continue;
			const ring = Math.abs(orbit[i] - pr[k]);
			if (ring < 40) m += pstr[k] * (1 - ring / 40) * 2 * PULSE;
		}
		angle[i] = (angle[i] + speed[i] * m * motion * dt) % TAU;
		px[i] = ox + Math.cos(angle[i]) * orbit[i];
		py[i] = oy + Math.sin(angle[i]) * orbit[i];
		moonA[i] += 2.5 * motion * dt;
		if (sample && TRAIL_LENGTH > 0) {
			const base = i * MAX_TRAIL * 2, hd = trailHead[i];
			trail[base + hd * 2] = px[i]; trail[base + hd * 2 + 1] = py[i];
			trailHead[i] = (hd + 1) % TRAIL_LENGTH;
			if (trailFill[i] < TRAIL_LENGTH) trailFill[i]++;
		}
	}

	// Threads between neighbouring planets that come close
	ctx.strokeStyle = threadStyle;
	ctx.lineWidth = 0.8;
	for (let i = 0; i < n - 1; i++) {
		const dx = px[i] - px[i + 1], dy = py[i] - py[i + 1], d = Math.sqrt(dx * dx + dy * dy), lim = R * 0.45;
		if (d > lim) continue;
		ctx.globalAlpha = (1 - d / lim) * (dark ? 0.35 : 0.3) * fade;
		ctx.beginPath(); ctx.moveTo(px[i], py[i]); ctx.lineTo(px[i + 1], py[i + 1]); ctx.stroke();
	}

	// Trails in a few chunks, brighter and wider toward the planet
	ctx.lineCap = 'round';
	for (let i = 0; i < n; i++) {
		const fill = trailFill[i];
		if (fill < 2) continue;
		const base = i * MAX_TRAIL * 2, start = trailHead[i] - fill + TRAIL_LENGTH;
		ctx.strokeStyle = trailStyle[i];
		for (let c = 0; c < CHUNKS; c++) {
			const a = Math.floor(fill * c / CHUNKS), b = Math.floor(fill * (c + 1) / CHUNKS);
			const t = (c + 1) / CHUNKS;
			ctx.globalAlpha = t * t * (dark ? 0.7 : 0.55) * fade;
			ctx.lineWidth = size[i] * (0.25 + 0.5 * t);
			ctx.beginPath();
			for (let j = a; j <= Math.min(b, fill - 1); j++) {
				const q = base + ((start + j) % TRAIL_LENGTH) * 2;
				if (j === a) ctx.moveTo(trail[q], trail[q + 1]); else ctx.lineTo(trail[q], trail[q + 1]);
			}
			if (c === CHUNKS - 1) ctx.lineTo(px[i], py[i]);
			ctx.stroke();
		}
	}

	// The star: corona and core, breathing slowly
	const breathe = 1 + (reduced ? 0 : Math.sin(time * 0.8) * 0.08);
	const cr = R * 0.12 * breathe, gr = R * 0.5 * breathe;
	ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
	ctx.globalAlpha = fade;
	ctx.drawImage(coronaSprite, ox - gr, oy - gr, gr * 2, gr * 2);
	ctx.globalCompositeOperation = 'source-over';
	ctx.drawImage(coreSprite, ox - cr, oy - cr, cr * 2, cr * 2);

	// Planets with glow, and moons on two of them
	for (let i = 0; i < n; i++) {
		const s = size[i];
		ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
		ctx.globalAlpha = fade;
		ctx.drawImage(glowSprite[i], px[i] - s * 3.5, py[i] - s * 3.5, s * 7, s * 7);
		ctx.globalCompositeOperation = 'source-over';
		ctx.drawImage(gemSprite[i], px[i] - s, py[i] - s, s * 2, s * 2);
		if (i === 1 || i === 3) {
			const mr = s * 2.6, mx = px[i] + Math.cos(moonA[i]) * mr, my = py[i] + Math.sin(moonA[i]) * mr;
			ctx.fillStyle = moonStyle;
			ctx.globalAlpha = 0.85 * fade;
			ctx.beginPath(); ctx.arc(mx, my, Math.max(1.2, s * 0.3), 0, TAU); ctx.fill();
		}
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
			theme = d.theme || null;
			dark = !theme || theme.dark !== false;
			resize();
			requestAnimationFrame(frame);
			break;
		case 'resize':
			w = d.width; h = d.height; dpr = Math.min(d.dpr || 1, 2);
			if (canvas) resize();
			break;
		case 'theme':
			theme = d;
			dark = d.dark !== false;
			if (canvas) build();
			break;
		case 'motion':
			reduced = !!d.reducedMotion;
			break;
		case 'layout':
			column = d.column || null;
			if (!canvas) break;
			place();
			thinStars();
			build();
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.amount = 1;
			break;
		case 'mousedown':
			// One pulse per tap, always sent out from the star so nothing flashes over the chat
			if (PULSE > 0) { pr[pulseHead] = R * 0.1; pstr[pulseHead] = 1; pulseHead = (pulseHead + 1) % MAX_PULSES; }
			break;
	}
};
