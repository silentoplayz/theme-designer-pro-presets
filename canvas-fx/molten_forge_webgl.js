/**
 * Title: Molten Forge (WebGL)
 * Description: Domain-warped lava rivers glow through cracked crust along the screen's sides and floor with rising embers, cooling to faint cracks behind the chat while the cursor stokes the heat and leans the flow.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const FLOW_SPEED    = 1;     // how fast the lava churns; 0 holds it still (0-3)
const REDUCED_SPEED = 0.15;  // share of the flow kept when the viewer asks to reduce motion (0-1)
const NOISE_SCALE   = 2.4;   // lava structure frequency; higher is finer (1-5)
const HEAT          = 1;     // how brightly the lava glows (0-2)
const FORGE_HEIGHT  = 0.3;   // how far the hot floor reaches up the screen, as a share (0-0.6)
const EMBER_AMOUNT  = 1;     // brightness of the rising embers; 0 turns them off (0-2)
const SHIMMER       = 1;     // heat-haze distortion strength (0-2)
const CURSOR_HEAT   = 1;     // how much the cursor stokes and steers the lava (0-2)
const CENTER_CALM   = 0.85;  // how much the lava cools behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const RENDER_SCALE  = 0.5;   // resolution of the lava; it is soft, so half is plenty (0.25-1)
const MAX_FPS       = 30;    // frame cap; lava moves slowly (15-60)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const COLOR_DEEP    = '#7a1600';  // cooling lava when not following the theme
const COLOR_HOT     = '#ff7a0a';  // running lava and cracks
const COLOR_CORE    = '#ffd890';  // white-hot core and embers
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
	'uniform float u_drift;',
	'uniform vec3 u_mouse;',
	'uniform vec3 u_deep;',
	'uniform vec3 u_hot;',
	'uniform vec3 u_core;',
	'uniform vec3 u_rock;',
	'uniform float u_dark;',
	'uniform vec2 u_col;',
	'float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
	'vec2 hash2(vec2 p) { return vec2(hash(p), hash(p + 17.31)); }',
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
	// Two layers of embers rising through cells, each lit cell holding one spark
	'float embers(vec2 p, float t) {',
	'	float acc = 0.0;',
	'	for (int i = 0; i < 2; i++) {',
	'		float fi = float(i);',
	'		vec2 ep = vec2(p.x * (14.0 + fi * 8.0) + sin(t * 0.4 + fi * 2.0 + p.y * 3.0) * 0.4, p.y * 9.0 - t * (0.9 + fi * 0.5));',
	'		vec2 id = floor(ep), f = fract(ep);',
	'		float d = length(f - (0.2 + 0.6 * hash2(id)));',
	'		float tw = 0.6 + 0.4 * sin(t * 1.6 + hash(id) * 40.0);',
	'		acc += smoothstep(0.11, 0.0, d) * tw * step(0.82, hash(id + 2.7)) * (1.2 - fi * 0.4);',
	'	}',
	'	return acc;',
	'}',
	'void main() {',
	'	vec2 px = gl_FragCoord.xy / u_scale;',
	'	vec2 res = u_res / u_scale;',
	'	vec2 p0 = px / res.y;',
	'	float t = u_time;',
	'	float band = abs(px.x - u_col.x) / u_col.y;',
	'	float calm = 1.0 - ' + CENTER_CALM.toFixed(3) + ' * (1.0 - smoothstep(0.55, 1.25, band));',
	'	float side = smoothstep(0.75, 1.6, band);',
	'	float floorHeat = 1.0 - smoothstep(0.0, ' + Math.max(0.05, FORGE_HEIGHT).toFixed(3) + ', px.y / res.y);',
	'	vec2 m = vec2(u_mouse.x, res.y - u_mouse.y);',
	'	float stoke = exp(-length(px - m) / 200.0) * u_mouse.z * ' + CURSOR_HEAT.toFixed(3) + ';',
	'	float mask = clamp(max(side, floorHeat * 0.9) + stoke * 0.7, 0.0, 1.0);',
	'	vec2 p = p0 + (vec2(noise(p0 * 24.0 + t * 2.2), noise(p0 * 24.0 + 9.1 + t * 2.0)) - 0.5) * 0.006 * ' + SHIMMER.toFixed(3) + ' * (0.3 + mask);',
	'	float K = ' + NOISE_SCALE.toFixed(3) + ';',
	'	float q1 = fbm(p * K * 1.15 + vec2(u_drift, -t * 0.02));',
	'	float q2 = fbm(p * K * 1.15 + vec2(4.4, 1.3) - vec2(u_drift * 0.6, 0.0));',
	'	float hgt = fbm(p * K + 2.3 * vec2(q1, q2));',
	'	float channel = 1.0 - smoothstep(0.0, mix(0.018, 0.06, mask), abs(hgt - 0.47 + 0.03 * q1));',
	'	float lake = mix(0.10, 0.30, mask);',
	'	float skin = smoothstep(0.25, 0.75, noise(p * 9.0 + vec2(q1, q2) * 3.0 + t * 0.05));',
	'	float pool = (1.0 - smoothstep(lake - 0.07, lake, hgt)) * mix(0.35, 1.0, skin);',
	'	float heat = max(channel * mix(0.45, 1.0, mask), pool * mask);',
	'	float pulse = 0.85 + 0.15 * sin(t * 0.9 + q1 * 6.0);',
	'	float ridged = 1.0 - abs(2.0 * noise(p * 7.0 + vec2(q2, q1) * 2.0) - 1.0);',
	'	float cracks = pow(ridged, 9.0) * (1.0 - heat) * mix(0.08, 1.0, mask);',
	'	float hm = ' + HEAT.toFixed(3) + ' * (1.0 + stoke * 0.5) * mix(0.8, 1.0, u_dark);',
	'	vec3 lava = mix(mix(u_deep, u_hot, pow(heat, 1.4)), u_core, pow(heat, 6.0) * pulse * 0.55 * u_dark);',
	'	float la = smoothstep(0.0, 0.6, heat) * mix(0.18, 1.0, mask) * calm * min(1.0, hm * pulse) * mix(0.7, 0.92, u_dark);',
	'	float ra = (1.0 - heat) * mask * calm * (0.55 + 0.5 * noise(p * 11.0)) * mix(0.10, 0.30, u_dark);',
	'	float ca = cracks * calm * min(1.0, 0.9 * hm * pulse) * mix(0.7, 1.0, u_dark);',
	'	float ga = heat * mask * calm * 0.25 * hm;',
	'	float ea = embers(p0, t) * max(side, floorHeat * 0.6) * calm * calm * ' + EMBER_AMOUNT.toFixed(3) + ' * smoothstep(1.0, 0.7, px.y / res.y) * mix(0.7, 1.0, u_dark);',
	'	vec4 o = vec4(u_rock * ra, ra);',
	'	o = vec4(u_hot * ga, ga) + o * (1.0 - ga);',
	'	o = vec4(min(lava, vec3(1.0)) * la, la) + o * (1.0 - la);',
	'	o = vec4(u_hot * ca, ca) + o * (1.0 - ca);',
	'	o = vec4(mix(u_hot, u_core, 0.6) * ea, ea) + o * (1.0 - ea);',
	'	o = clamp(o, 0.0, 1.0);',
	'	gl_FragColor = vec4(min(o.rgb, vec3(o.a)), o.a);',
	'}',
].join('\n');

let canvas, gl, program, buffer;
const loc = {};
let w = 0, h = 0;
let last = 0, time = 0, drift = 0, reduced = false, column = null;
const mouse = { x: -10000, y: -10000, amount: 0, target: 0, sx: -10000, sy: -10000, lean: 0 };
const colors = { deep: hexToRgb(COLOR_DEEP), hot: hexToRgb(COLOR_HOT), core: hexToRgb(COLOR_CORE), rock: [0, 0, 0], dark: 1 };

function hexToRgb(hex) {
	const n = parseInt(hex.slice(1), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mix3(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }

// Running lava takes accent, cooling lava accent2, the core leans toward white on dark themes
function applyTheme(t) {
	if (t) colors.dark = t.dark === false ? 0 : 1;
	const dark = colors.dark === 1;
	if (!FOLLOW_THEME || !t || !t.rgb) {
		colors.deep = hexToRgb(COLOR_DEEP);
		colors.hot = dark ? hexToRgb(COLOR_HOT) : mix3(hexToRgb(COLOR_HOT), hexToRgb(COLOR_DEEP), 0.25);
		colors.core = hexToRgb(COLOR_CORE);
		colors.rock = dark ? [0, 0, 0] : [0.35, 0.3, 0.28];
		return;
	}
	colors.deep = dark ? mix3(t.rgb.accent2, [0, 0, 0], 0.4) : t.rgb.accent2;
	colors.hot = t.rgb.accent;
	colors.core = dark ? mix3(t.rgb.accent, [1, 1, 1], 0.6) : t.rgb.accent3;
	colors.rock = dark ? mix3(t.rgb.background, [0, 0, 0], 0.7) : t.rgb.muted;
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
	['u_res', 'u_scale', 'u_time', 'u_drift', 'u_mouse', 'u_deep', 'u_hot', 'u_core', 'u_rock', 'u_dark', 'u_col'].forEach((name) => {
		loc[name] = gl.getUniformLocation(program, name);
	});
	gl.disable(gl.BLEND);
	size();
}

function size() {
	canvas.width = Math.max(1, Math.round(w * RENDER_SCALE));
	canvas.height = Math.max(1, Math.round(h * RENDER_SCALE));
	if (gl && !gl.isContextLost()) gl.viewport(0, 0, canvas.width, canvas.height);
}

function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }

function frame(now) {
	requestAnimationFrame(frame);
	if (!program || gl.isContextLost()) return;
	if (last && now - last < 1000 / MAX_FPS - 2) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const k = dt * FLOW_SPEED * (reduced ? REDUCED_SPEED : 1);
	time = (time + k) % 2000;
	// The cursor leans the flow toward its side of the screen, easing back once it rests
	mouse.target = Math.max(0, mouse.target - dt * 0.4);
	mouse.amount += (mouse.target - mouse.amount) * Math.min(1, dt * 2);
	const want = w ? (mouse.x / w - 0.5) * 2 * mouse.amount * CURSOR_HEAT : 0;
	mouse.lean += (want - mouse.lean) * Math.min(1, dt * 0.8);
	drift = (drift + k * (0.02 + mouse.lean * 0.06)) % 1000;
	const ease = Math.min(1, dt * 4);
	mouse.sx += (mouse.x - mouse.sx) * ease;
	mouse.sy += (mouse.y - mouse.sy) * ease;
	gl.uniform2f(loc.u_res, canvas.width, canvas.height);
	gl.uniform1f(loc.u_scale, canvas.width / Math.max(1, w));
	gl.uniform1f(loc.u_time, time);
	gl.uniform1f(loc.u_drift, drift);
	gl.uniform3f(loc.u_mouse, mouse.sx, mouse.sy, mouse.amount);
	gl.uniform3fv(loc.u_deep, colors.deep);
	gl.uniform3fv(loc.u_hot, colors.hot);
	gl.uniform3fv(loc.u_core, colors.core);
	gl.uniform3fv(loc.u_rock, colors.rock);
	gl.uniform1f(loc.u_dark, colors.dark);
	gl.uniform2f(loc.u_col, colX(), colHalf());
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function start() {
	const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
	gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
	if (!gl) {
		console.warn('Molten Forge: WebGL is not available, so the lava is not drawn.');
		return;
	}
	canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); program = null; });
	canvas.addEventListener('webglcontextrestored', () => {
		try { setup(); } catch (err) { console.error('Molten Forge:', err.message); }
	});
	try {
		setup();
		requestAnimationFrame(frame);
	} catch (err) {
		console.error('Molten Forge:', err.message);
	}
}

self.onmessage = (e) => {
	const d = e.data;
	switch (d.type) {
		case 'init':
			canvas = d.canvas;
			w = d.width;
			h = d.height;
			reduced = !!d.reducedMotion;
			column = d.column || null;
			time = Math.random() * 200;
			applyTheme(d.theme);
			start();
			break;
		case 'resize':
			w = d.width;
			h = d.height;
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
			break;
		case 'mousemove':
			if (mouse.amount < 0.02) { mouse.sx = d.x; mouse.sy = d.y; }
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.target = 1;
			break;
	}
};
