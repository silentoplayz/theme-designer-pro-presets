/**
 * Title: Total Eclipse (WebGL)
 * Description: A black moon beside the chat wreathed in a slowly flowing corona with a thin red chromosphere and faint stars; now and then a diamond-ring flare lights its outer rim, and the cursor gently parallaxes the scene.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const INTENSITY         = 0.9;   // how strongly the eclipse shows (0-1)
const MOTION            = 1;     // how fast the corona flows; 0 holds it still and stops flares (0-2)
const REDUCED_SPEED     = 0.15;  // share of the flow kept when the viewer asks to reduce motion (0-1)
const MOON_SIZE         = 0.12;  // moon radius as a share of the screen height (0.06-0.2)
const CORONA_FALLOFF    = 3.2;   // how quickly the corona fades with distance; higher is tighter (1.5-6)
const CORONA_BRIGHTNESS = 1;     // overall corona strength (0.3-2)
const STAR_DENSITY      = 0.5;   // faint stars in the sky, dark themes only (0-1)
const FLARE_EVERY       = 26;    // average seconds between diamond-ring flares; 0 turns them off (0-120)
const PARALLAX          = 1;     // how far the cursor shifts the scene (0-3)
const CENTER_CALM       = 0.85;  // how much the corona fades behind the chat column (0-1)
const BAND_WIDTH        = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const RENDER_SCALE      = 0.6;   // resolution of the scene; the corona is soft (0.4-1)
const MAX_FPS           = 30;    // frame cap; the corona flows slowly (15-60)
const FOLLOW_THEME      = true;  // take the colors from the theme's palette
const CORONA_COLOR      = '#eef0ff';  // corona color when not following the theme
const RIM_COLOR         = '#ff5a47';  // chromosphere rim color
/* ──────────────────────────────────────────── */

const VERT = 'attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }';

const FRAG = [
	'#ifdef GL_FRAGMENT_PRECISION_HIGH',
	'precision highp float;',
	'#else',
	'precision mediump float;',
	'#endif',
	'uniform vec2 u_res;',
	'uniform float u_scale;',
	'uniform float u_time;',
	'uniform float u_dark;',
	'uniform vec4 u_moon;',
	'uniform vec2 u_par;',
	'uniform vec2 u_flare;',
	'uniform vec2 u_col;',
	'uniform vec3 u_cor;',
	'uniform vec3 u_core;',
	'uniform vec3 u_rim;',
	'uniform vec3 u_disc;',
	'float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
	'float noise(vec2 p) {',
	'	vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);',
	'	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
	'}',
	'float fbm(vec2 p) {',
	'	float v = 0.0, a = 0.5;',
	'	mat2 m = mat2(1.6, 1.2, -1.2, 1.6);',
	'	for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }',
	'	return v;',
	'}',
	'void main() {',
	'	vec2 px = gl_FragCoord.xy / u_scale;',
	'	float H = u_res.y / u_scale;',
	'	float t = u_time;',
	'	float band = abs(px.x - u_col.x) / u_col.y;',
	'	float calmSoft = 1.0 - ' + CENTER_CALM.toFixed(3) + ' * (1.0 - smoothstep(0.5, 1.2, band));',
	'	float calmHard = 1.0 - ' + CENTER_CALM.toFixed(3) + ' * (1.0 - smoothstep(0.88, 1.0, band));',
	'	vec2 c = (px - u_moon.xy - u_par) / H;',
	'	float r = length(c);',
	'	vec2 dir = c / max(r, 0.0001);',
	'	float R = u_moon.z;',
	'	vec2 sq = px - u_par * 0.4;',
	'	vec2 cell = floor(sq / 80.0);',
	'	vec2 sp = (cell + vec2(hash(cell), hash(cell + 7.1))) * 80.0;',
	'	float sh = hash(cell + 3.3);',
	'	float s = step(1.0 - ' + STAR_DENSITY.toFixed(3) + ' * 0.5, sh) * (0.55 + 0.45 * sin(t * (1.0 + sh * 3.0) + sh * 40.0));',
	'	s *= smoothstep(1.8, 0.0, length(sq - sp)) * smoothstep(R * 1.3, R * 2.2, r) * u_dark * 0.7;',
	'	float rr = max(r - R, 0.0);',
	'	float breath = 0.9 + 0.1 * sin(t * 0.35);',
	'	float st1 = fbm(dir * 2.6 + vec2(rr * 2.2 - t * 0.05, t * 0.02));',
	'	float st2 = fbm(dir * 4.2 - vec2(rr * 3.0 + t * 0.03, 7.0));',
	'	float cor = (pow(st1, 2.6) * 1.6 + pow(st2, 3.2) * 1.0) * exp(-rr * ' + CORONA_FALLOFF.toFixed(3) + ' / (R / 0.17)) * breath * ' + CORONA_BRIGHTNESS.toFixed(3) + ';',
	'	cor *= mix(0.85, 1.0, u_dark);',
	'	float core = exp(-rr / R * 3.7) * mix(0.55, 0.85, u_dark);',
	'	float rim = exp(-abs(r - R) / R * 27.0) * mix(0.55, 0.8, u_dark);',
	'	vec3 col = vec3(0.88, 0.92, 1.0) * s + u_cor * cor + u_core * core + u_rim * rim;',
	'	float a = s + cor + core + rim;',
	'	col *= calmSoft;',
	'	a *= calmSoft;',
	'	float inside = smoothstep(R + 1.2 / H, R - 1.2 / H, r);',
	'	float disc = inside * mix(1.0, 0.62, u_dark) * calmHard;',
	'	col = u_disc * disc + col * (1.0 - inside);',
	'	a = disc + a * (1.0 - inside);',
	'	vec2 fd = c - vec2(cos(u_flare.x), sin(u_flare.x)) * R;',
	'	float fl = u_flare.y * calmSoft;',
	'	float fe = fl * (exp(-length(fd) * 46.0) * 2.0 + exp(-length(fd) * 9.0) * 0.3);',
	'	fe += fl * (exp(-abs(fd.y) * 180.0) * exp(-abs(fd.x) * 18.0) + exp(-abs(fd.x) * 180.0) * exp(-abs(fd.y) * 18.0)) * 0.8;',
	'	col += u_core * fe;',
	'	a += fe;',
	'	a = clamp(a * ' + INTENSITY.toFixed(3) + ', 0.0, 1.0);',
	'	gl_FragColor = vec4(min(col * ' + INTENSITY.toFixed(3) + ', vec3(a)), a);',
	'}',
].join('\n');

let canvas, gl, program, buffer;
let loc = {};
let w = 0, h = 0, dpr = 1;
let last = 0, time = 0, reduced = false, column = null;
const moon = { x: -10000, y: 0, r: 0.1, tx: 0, ty: 0, tr: 0.1, side: -1 };
const mouse = { x: -10000, y: -10000, amount: 0, target: 0, px: 0, py: 0 };
const flare = { age: 1000, angle: 3, wait: FLARE_EVERY * 0.35 };
const colors = { cor: hexToRgb(CORONA_COLOR), core: [1, 0.98, 0.93], rim: hexToRgb(RIM_COLOR), disc: [0.01, 0.01, 0.015], dark: 1 };

function hexToRgb(hex) {
	const n = parseInt(hex.slice(1), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mixRgb(a, b, t) {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function applyTheme(t) {
	if (!t) return;
	colors.dark = t.dark === false ? 0 : 1;
	const rgb = FOLLOW_THEME && t.rgb ? t.rgb : null;
	if (colors.dark) {
		colors.cor = rgb ? mixRgb(rgb.text, rgb.accent3, 0.35) : hexToRgb(CORONA_COLOR);
		colors.core = rgb ? mixRgb(rgb.text, [1, 1, 1], 0.6) : [1, 0.98, 0.93];
		colors.rim = rgb ? mixRgb(rgb.accent2, [1, 0.35, 0.28], 0.4) : hexToRgb(RIM_COLOR);
		colors.disc = rgb ? mixRgb(rgb.background, [0, 0, 0], 0.7) : [0.01, 0.01, 0.015];
	} else {
		colors.cor = rgb ? rgb.accent : mixRgb(hexToRgb(CORONA_COLOR), [0.1, 0.12, 0.2], 0.7);
		colors.core = rgb ? mixRgb(rgb.accent, rgb.text, 0.35) : [0.25, 0.27, 0.35];
		colors.rim = rgb ? rgb.accent2 : hexToRgb(RIM_COLOR);
		colors.disc = rgb ? rgb.text : [0.1, 0.11, 0.14];
	}
}

function compile(type, source) {
	const shader = gl.createShader(type);
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
	return shader;
}

function setup() {
	program = gl.createProgram();
	gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
	gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
	gl.bindAttribLocation(program, 0, 'a_pos');
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
	gl.useProgram(program);
	buffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
	['u_res', 'u_scale', 'u_time', 'u_dark', 'u_moon', 'u_par', 'u_flare', 'u_col', 'u_cor', 'u_core', 'u_rim', 'u_disc'].forEach((name) => {
		loc[name] = gl.getUniformLocation(program, name);
	});
	gl.disable(gl.BLEND);
	size();
}

function size() {
	const k = Math.min(dpr, 2) * RENDER_SCALE;
	canvas.width = Math.max(1, Math.round(w * k));
	canvas.height = Math.max(1, Math.round(h * k));
	if (gl && !gl.isContextLost()) gl.viewport(0, 0, canvas.width, canvas.height);
	place(true);
}

// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }

// The moon hangs in the margin beside the column, inside the chat area so the sidebar never covers it.
// A margin too narrow for the whole moon shows it rising past the chat area's right edge instead.
function place(now) {
	const lo = column ? column.left : 0, hi = column ? column.right : w;
	const mL = Math.max(0, colX() - colHalf() - lo), mR = Math.max(0, hi - colX() - colHalf());
	const r0 = MOON_SIZE * h, fitL = Math.min(r0, mL / 2.6);
	if (fitL >= r0 * 0.5 && mL >= mR) {
		moon.side = -1;
		moon.tr = fitL;
		moon.tx = lo + mL * 0.5;
	} else {
		moon.side = 1;
		moon.tr = r0;
		moon.tx = mR >= 2.6 * r0 ? hi - mR * 0.5 : hi + r0 - (mR + 0.6 * r0);
	}
	moon.tr /= Math.max(1, h);
	moon.ty = h * 0.42;
	if (now || moon.x < -9000) { moon.x = moon.tx; moon.y = moon.ty; moon.r = moon.tr; }
}

function updateFlare(dt) {
	flare.age += dt;
	if (FLARE_EVERY <= 0 || MOTION <= 0 || reduced) return;
	flare.wait -= dt;
	if (flare.wait > 0) return;
	flare.age = 0;
	flare.angle = Math.PI * 0.5 - moon.side * 0.7 + (Math.random() - 0.5) * 1.0;
	flare.wait = FLARE_EVERY * (0.6 + Math.random() * 0.8);
}

// Rises over a second, holds, and fades back into totality
function flareLevel() {
	const a = flare.age;
	if (a < 1) return a * a * (3 - 2 * a);
	if (a < 1.8) return 1;
	return Math.max(0, 1 - (a - 1.8) / 1.8);
}

function frame(now) {
	requestAnimationFrame(frame);
	if (!program || gl.isContextLost()) return;
	if (last && now - last < 1000 / MAX_FPS - 2) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	time = (time + dt * MOTION * (reduced ? REDUCED_SPEED : 1)) % 3000;
	updateFlare(dt);
	mouse.target = Math.max(0, mouse.target - dt * 0.35);
	mouse.amount += (mouse.target - mouse.amount) * Math.min(1, dt * 2);
	const k = PARALLAX * mouse.amount * h * 0.03 * (reduced ? 0.3 : 1);
	mouse.px += ((mouse.x / Math.max(1, w) - 0.5) * k - mouse.px) * Math.min(1, dt * 3);
	mouse.py += ((0.5 - mouse.y / Math.max(1, h)) * k - mouse.py) * Math.min(1, dt * 3);
	const ease = Math.min(1, dt * 2);
	moon.x += (moon.tx - moon.x) * ease;
	moon.y += (moon.ty - moon.y) * ease;
	moon.r += (moon.tr - moon.r) * ease;
	gl.uniform2f(loc.u_res, canvas.width, canvas.height);
	gl.uniform1f(loc.u_scale, canvas.width / Math.max(1, w));
	gl.uniform1f(loc.u_time, time);
	gl.uniform1f(loc.u_dark, colors.dark);
	gl.uniform4f(loc.u_moon, moon.x, h - moon.y, moon.r, 0);
	gl.uniform2f(loc.u_par, mouse.px, mouse.py);
	gl.uniform2f(loc.u_flare, flare.angle, flareLevel() * (reduced ? 0 : 1));
	gl.uniform2f(loc.u_col, colX(), colHalf());
	gl.uniform3fv(loc.u_cor, colors.cor);
	gl.uniform3fv(loc.u_core, colors.core);
	gl.uniform3fv(loc.u_rim, colors.rim);
	gl.uniform3fv(loc.u_disc, colors.disc);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function start() {
	const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
	gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
	if (!gl) {
		console.warn('Total Eclipse: WebGL is not available, so the eclipse is not drawn.');
		return;
	}
	canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); program = null; });
	canvas.addEventListener('webglcontextrestored', () => {
		try { setup(); } catch (err) { console.error('Total Eclipse:', err.message); }
	});
	try {
		setup();
		requestAnimationFrame(frame);
	} catch (err) {
		console.error('Total Eclipse:', err.message);
	}
}

self.onmessage = (e) => {
	const d = e.data;
	switch (d.type) {
		case 'init':
			canvas = d.canvas;
			w = d.width;
			h = d.height;
			dpr = d.dpr || 1;
			reduced = !!d.reducedMotion;
			column = d.column || null;
			applyTheme(d.theme);
			start();
			break;
		case 'resize':
			w = d.width;
			h = d.height;
			dpr = d.dpr || dpr;
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
			place(false);
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.target = 1;
			break;
	}
};
