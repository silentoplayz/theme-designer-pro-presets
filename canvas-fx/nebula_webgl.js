/**
 * Title: Aether Nebula (WebGL)
 * Description: Domain-warped nebula gas in your theme's accent colors that gathers at the screen's edges, thins behind the chat, parts around the cursor and now and then blooms.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const INTENSITY     = 0.85;  // how strongly the gas shows (0-1)
const MOTION        = 1;     // drift speed; 0 holds the nebula still and stops blooms (0-2)
const CENTER_CALM   = 0.75;  // how much the gas thins behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band around the chat column, in px (300-900)
const GAS_SCALE     = 1.6;   // size of the cloud structures; lower is larger (0.6-4)
const WARP          = 3;     // how swirled the gas is (0-6)
const STAR_DENSITY  = 0.5;   // faint stars behind the gas, dark themes only (0-1)
const CURSOR_PUSH   = 1;     // how far the gas parts around the cursor (0-3)
const BLOOM_EVERY   = 70;    // average seconds between stellar blooms; 0 turns them off (0-300)
const RENDER_SCALE  = 0.5;   // resolution of the gas; it is soft, so half is plenty (0.25-1)
const MAX_FPS       = 30;    // frame cap; the gas moves slowly (15-60)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const COLOR_A       = '#6f8cff';  // gas color when not following the theme
const COLOR_B       = '#a46cf0';  // second gas color
const COLOR_C       = '#4fd2e6';  // highlight and bloom color
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
	'uniform vec3 u_mouse;',
	'uniform vec3 u_c1;',
	'uniform vec3 u_c2;',
	'uniform vec3 u_c3;',
	'uniform float u_dark;',
	'uniform vec4 u_bloom;',
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
	'	vec2 res = u_res / u_scale;',
	'	float t = u_time;',
	'	vec2 m = vec2(u_mouse.x, res.y - u_mouse.y);',
	'	vec2 dm = px - m;',
	'	float md = length(dm);',
	'	vec2 push = u_mouse.z * ' + CURSOR_PUSH.toFixed(3) + ' * dm / (md + 1.0) * exp(-md / 240.0) * 0.08;',
	'	vec2 p = px / res.y * ' + GAS_SCALE.toFixed(3) + ' + push;',
	'	vec2 q = vec2(fbm(p + vec2(0.0, t * 0.012)), fbm(p + vec2(5.2, 1.3) - t * 0.010));',
	'	vec2 r = vec2(fbm(p + ' + WARP.toFixed(3) + ' * q + vec2(1.7, 9.2) + t * 0.015), fbm(p + ' + WARP.toFixed(3) + ' * q + vec2(8.3, 2.8) - t * 0.013));',
	'	float f = fbm(p + ' + WARP.toFixed(3) + ' * r);',
	'	float dens = smoothstep(0.38, 0.95, f) * 0.85 + smoothstep(0.62, 0.95, length(r)) * 0.3;',
	'	vec3 col = mix(u_c1, u_c2, clamp(q.x * 1.4 - 0.2, 0.0, 1.0));',
	'	col = mix(col, u_c3, clamp(r.y * r.y * 1.4, 0.0, 1.0));',
	'	float band = abs(px.x - res.x * 0.5) / ' + BAND_WIDTH.toFixed(1) + ';',
	'	float calm = 1.0 - ' + CENTER_CALM.toFixed(3) + ' * (1.0 - smoothstep(0.55, 1.25, band));',
	'	float edge = 0.7 + 0.3 * smoothstep(0.1, 0.75, length(px / res - 0.5));',
	'	float a = dens * calm * edge * ' + INTENSITY.toFixed(3) + ' * mix(0.65, 0.9, u_dark);',
	'	vec2 cell = floor(px / 90.0);',
	'	vec2 sp = (cell + vec2(hash(cell), hash(cell + 7.1))) * 90.0;',
	'	float lit = step(1.0 - ' + STAR_DENSITY.toFixed(3) + ' * 0.55, hash(cell + 3.3));',
	'	float tw = 0.55 + 0.45 * sin(t * (0.6 + hash(cell + 1.9) * 1.6) + hash(cell) * 6.283);',
	'	float s = lit * tw * smoothstep(2.4, 0.0, length(px - sp)) * u_dark * mix(0.35, 1.0, calm) * 0.8;',
	'	vec2 b = vec2(u_bloom.x, res.y - u_bloom.y);',
	'	float life = u_bloom.z;',
	'	float env = smoothstep(0.0, 2.5, life) * (1.0 - smoothstep(3.5, 10.0, life));',
	'	float ba = u_bloom.w * env * exp(-length(px - b) / 170.0) * (0.35 + 0.65 * smoothstep(0.3, 0.8, f));',
	'	vec3 bloomCol = mix(u_c3, vec3(1.0), 0.35 * u_dark);',
	'	vec3 starCol = mix(vec3(1.0), u_c1, 0.3);',
	'	float outA = clamp(a + s + ba * 0.8, 0.0, 1.0);',
	'	gl_FragColor = vec4(min(col * a + starCol * s + bloomCol * ba * 0.8, vec3(outA)), outA);',
	'}',
].join('\n');

let canvas, gl, program, buffer;
let loc = {};
let w = 0, h = 0;
let last = 0, time = 0;
const mouse = { x: -10000, y: -10000, amount: 0, target: 0 };
const bloom = { x: 0, y: 0, age: 1000, strength: 0, wait: BLOOM_EVERY * 0.5 };
const colors = { c1: hexToRgb(COLOR_A), c2: hexToRgb(COLOR_B), c3: hexToRgb(COLOR_C), dark: 1 };

function hexToRgb(hex) {
	const n = parseInt(hex.slice(1), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function applyTheme(t) {
	if (!t) return;
	colors.dark = t.dark === false ? 0 : 1;
	if (!FOLLOW_THEME || !t.rgb) return;
	colors.c1 = t.rgb.accent;
	colors.c2 = t.rgb.accent2;
	colors.c3 = t.rgb.accent3;
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
	['u_res', 'u_scale', 'u_time', 'u_mouse', 'u_c1', 'u_c2', 'u_c3', 'u_dark', 'u_bloom'].forEach((name) => {
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

// ── Blooms: a slow swell of light in the outer thirds, never over the chat ──
function updateBloom(dt) {
	bloom.age += dt;
	if (BLOOM_EVERY <= 0 || MOTION <= 0 || bloom.age < 10) return;
	bloom.wait -= dt;
	if (bloom.wait > 0) return;
	const side = Math.random() < 0.5 ? 0 : 1;
	bloom.x = side ? w - Math.random() * w * 0.22 : Math.random() * w * 0.22;
	bloom.y = h * (0.15 + Math.random() * 0.7);
	bloom.strength = 0.5 + Math.random() * 0.5;
	bloom.age = 0;
	bloom.wait = BLOOM_EVERY * (0.6 + Math.random() * 0.8);
}

function frame(now) {
	requestAnimationFrame(frame);
	if (!program || gl.isContextLost()) return;
	if (last && now - last < 1000 / MAX_FPS - 2) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	time = (time + dt * MOTION) % 3000;
	mouse.target = Math.max(0, mouse.target - dt * 0.4);
	mouse.amount += (mouse.target - mouse.amount) * Math.min(1, dt * 3);
	updateBloom(dt);
	gl.uniform2f(loc.u_res, canvas.width, canvas.height);
	gl.uniform1f(loc.u_scale, canvas.width / Math.max(1, w));
	gl.uniform1f(loc.u_time, time);
	gl.uniform3f(loc.u_mouse, mouse.x, mouse.y, mouse.amount);
	gl.uniform3fv(loc.u_c1, colors.c1);
	gl.uniform3fv(loc.u_c2, colors.c2);
	gl.uniform3fv(loc.u_c3, colors.c3);
	gl.uniform1f(loc.u_dark, colors.dark);
	gl.uniform4f(loc.u_bloom, bloom.x, bloom.y, bloom.age, bloom.strength);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function start() {
	gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' })
		|| canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
	if (!gl) {
		console.warn('Aether Nebula: WebGL is not available, so the nebula is not drawn.');
		return;
	}
	canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); program = null; });
	canvas.addEventListener('webglcontextrestored', () => {
		try { setup(); } catch (err) { console.error('Aether Nebula:', err.message); }
	});
	try {
		setup();
		requestAnimationFrame(frame);
	} catch (err) {
		console.error('Aether Nebula:', err.message);
	}
}

self.onmessage = (e) => {
	const d = e.data;
	switch (d.type) {
		case 'init':
			canvas = d.canvas;
			w = d.width;
			h = d.height;
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
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.target = 1;
			break;
	}
};
