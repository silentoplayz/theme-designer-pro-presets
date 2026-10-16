/**
 * Title: Iridescent Liquid Glass (WebGL)
 * Description: Domain-warped veins of thin-film glass in your theme's accents fold slowly at the screen's edges, thin behind the chat, brighten under the cursor and ripple where you tap.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const INTENSITY     = 0.85;  // how strongly the glass shows (0-1)
const FLOW_SPEED    = 0.16;  // how fast the glass churns; 0 holds it still (0-0.6)
const REDUCED_SPEED = 0.15;  // share of the flow kept when the viewer asks to reduce motion (0-1)
const WARP_AMOUNT   = 3.2;   // strength of the domain warp; higher folds more veins (0-6)
const GLASS_SCALE   = 2.8;   // size of the pools and veins; lower is larger (1-5)
const IRIDESCENCE   = 1;     // how far the color shifts across the surface (0-1.5)
const POINTER_LIGHT = 1;     // brightness of the light that follows the cursor (0-2)
const RIPPLE        = 1;     // strength of the ripple a tap sends through the glass (0-2)
const CENTER_CALM   = 0.8;   // how much the glass thins behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const RENDER_SCALE  = 0.5;   // resolution of the glass; it is soft, so half is plenty (0.25-1)
const MAX_FPS       = 30;    // frame cap; the glass flows slowly (15-60)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const COLOR_A       = '#2fd0c8';  // oil-slick teal when not following the theme
const COLOR_B       = '#8a5cf0';  // violet
const COLOR_C       = '#f06aa8';  // rose
/* ──────────────────────────────────────────── */

const MAX_RIPPLES = 6;

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
	'uniform vec3 u_ripples[' + MAX_RIPPLES + '];',
	'uniform vec3 u_c1;',
	'uniform vec3 u_c2;',
	'uniform vec3 u_c3;',
	'uniform float u_dark;',
	'uniform vec2 u_col;',
	'float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
	'float noise(vec2 p) {',
	'	vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);',
	'	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
	'}',
	'float fbm(vec2 p) {',
	'	float v = 0.0, a = 0.5;',
	'	for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.02 + vec2(37.1, 11.7); a *= 0.5; }',
	'	return v;',
	'}',
	// Thin film: a smooth loop through the three accents
	'vec3 film(float t) {',
	'	t = fract(t) * 3.0;',
	'	float k = smoothstep(0.0, 1.0, fract(t));',
	'	vec3 c = t < 1.0 ? mix(u_c1, u_c2, k) : (t < 2.0 ? mix(u_c2, u_c3, k) : mix(u_c3, u_c1, k));',
	'	return clamp(mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.45), 0.0, 1.0);',
	'}',
	'void main() {',
	'	vec2 px = gl_FragCoord.xy / u_scale;',
	'	vec2 res = u_res / u_scale;',
	'	vec2 uv = (px - 0.5 * res) / res.y;',
	'	float t = u_time;',
	'	float band = abs(px.x - u_col.x) / u_col.y;',
	'	float calm = 1.0 - ' + CENTER_CALM.toFixed(3) + ' * (1.0 - smoothstep(0.55, 1.25, band));',
	'	vec2 disp = vec2(0.0);',
	'	float ringLit = 0.0;',
	'	for (int i = 0; i < ' + MAX_RIPPLES + '; i++) {',
	'		float age = u_ripples[i].z;',
	'		if (age < 0.0) continue;',
	'		vec2 rc = (vec2(u_ripples[i].x, res.y - u_ripples[i].y) - 0.5 * res) / res.y;',
	'		vec2 to = uv - rc;',
	'		float dr = length(to);',
	'		float ring = dr - age * 0.32;',
	'		float env = exp(-age * 0.9) * exp(-ring * ring * 60.0) * smoothstep(0.0, 0.3, age);',
	'		disp += to / (dr + 1e-4) * sin(ring * 40.0) * env * 0.04 * ' + RIPPLE.toFixed(3) + ';',
	'		ringLit += env;',
	'	}',
	'	vec2 p = uv * ' + GLASS_SCALE.toFixed(3) + ' + disp;',
	'	vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, -t * 0.8)));',
	'	vec2 r = vec2(fbm(p + ' + WARP_AMOUNT.toFixed(3) + ' * q + vec2(1.7, 9.2) + t * 0.5), fbm(p + ' + WARP_AMOUNT.toFixed(3) + ' * q + vec2(8.3, 2.8) - t * 0.4));',
	'	float f = fbm(p + ' + WARP_AMOUNT.toFixed(3) + ' * r);',
	'	float sheet = 0.35 + 0.65 * smoothstep(0.25, 0.7, f);',
	'	float vein = clamp(exp(-abs(f - 0.50) * 22.0) + 0.7 * exp(-abs(f - 0.63) * 30.0), 0.0, 1.0);',
	'	float depth = f + 0.35 * length(r) - 0.2 * length(q);',
	'	float hue = depth * 2.6 * ' + IRIDESCENCE.toFixed(3) + ' + 0.12 * t;',
	'	vec3 col = film(hue);',
	'	vec3 vcol = film(hue + 0.33);',
	'	float shine = pow(vein, 4.0) * smoothstep(0.5, 1.0, length(r));',
	'	vec2 m = (vec2(u_mouse.x, res.y - u_mouse.y) - 0.5 * res) / res.y;',
	'	float glow = exp(-length(uv - m) * 4.0) * u_mouse.z * ' + POINTER_LIGHT.toFixed(3) + ';',
	'	float edge = 0.5 + 0.5 * smoothstep(0.1, 0.7, length(px / res - 0.5));',
	'	float shape = calm * edge * ' + INTENSITY.toFixed(3) + ';',
	'	float lift = 1.0 + glow * 1.2 + ringLit * 0.8 * ' + RIPPLE.toFixed(3) + ';',
	'	float ba = sheet * mix(0.2, 0.24, u_dark) * shape * min(lift, 1.5);',
	'	float va = vein * mix(0.62, 0.75, u_dark) * shape * min(lift, 1.4);',
	'	float sa = shine * mix(0.0, 0.55, u_dark) * shape * lift;',
	'	vec4 o = vec4(col * mix(0.95, 0.75, u_dark) * ba, ba);',
	'	o = vec4(vcol * mix(0.8, 1.0, u_dark) * va, va) + o * (1.0 - va);',
	'	o = vec4(mix(vcol, vec3(1.0), 0.7) * sa, sa) + o * (1.0 - sa);',
	'	o = clamp(o, 0.0, 1.0);',
	'	gl_FragColor = vec4(min(o.rgb, vec3(o.a)), o.a);',
	'}',
].join('\n');

let canvas, gl, program, buffer;
const loc = {};
let w = 0, h = 0;
let last = 0, time = 0, reduced = false, column = null, rippleHead = 0;
const mouse = { x: -10000, y: -10000, amount: 0, target: 0, sx: -10000, sy: -10000 };
const ripples = new Float32Array(MAX_RIPPLES * 3).fill(-1);
const colors = { c1: hexToRgb(COLOR_A), c2: hexToRgb(COLOR_B), c3: hexToRgb(COLOR_C), dark: 1 };

function hexToRgb(hex) {
	const n = parseInt(hex.slice(1), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function applyTheme(t) {
	if (!t) return;
	colors.dark = t.dark === false ? 0 : 1;
	if (!FOLLOW_THEME || !t.rgb) return;
	colors.c1 = t.rgb.accent3;
	colors.c2 = t.rgb.accent;
	colors.c3 = t.rgb.accent2;
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
	['u_res', 'u_scale', 'u_time', 'u_mouse', 'u_ripples', 'u_c1', 'u_c2', 'u_c3', 'u_dark', 'u_col'].forEach((name) => {
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

// A tap drops one ripple into a fixed ring of six; reduced motion skips them
function addRipple(x, y) {
	if (reduced || RIPPLE <= 0) return;
	ripples[rippleHead * 3] = x;
	ripples[rippleHead * 3 + 1] = y;
	ripples[rippleHead * 3 + 2] = 0;
	rippleHead = (rippleHead + 1) % MAX_RIPPLES;
}

function frame(now) {
	requestAnimationFrame(frame);
	if (!program || gl.isContextLost()) return;
	if (last && now - last < 1000 / MAX_FPS - 2) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	time = (time + dt * FLOW_SPEED * (reduced ? REDUCED_SPEED : 1)) % 1000;
	mouse.target = Math.max(0, mouse.target - dt * 0.5);
	mouse.amount += (mouse.target - mouse.amount) * Math.min(1, dt * 3);
	const ease = Math.min(1, dt * 6);
	mouse.sx += (mouse.x - mouse.sx) * ease;
	mouse.sy += (mouse.y - mouse.sy) * ease;
	for (let i = 0; i < MAX_RIPPLES; i++) {
		const a = i * 3 + 2;
		if (ripples[a] >= 0) ripples[a] = ripples[a] + dt > 5 ? -1 : ripples[a] + dt;
	}
	gl.uniform2f(loc.u_res, canvas.width, canvas.height);
	gl.uniform1f(loc.u_scale, canvas.width / Math.max(1, w));
	gl.uniform1f(loc.u_time, time);
	gl.uniform3f(loc.u_mouse, mouse.sx, mouse.sy, mouse.amount);
	gl.uniform3fv(loc.u_ripples, ripples);
	gl.uniform3fv(loc.u_c1, colors.c1);
	gl.uniform3fv(loc.u_c2, colors.c2);
	gl.uniform3fv(loc.u_c3, colors.c3);
	gl.uniform1f(loc.u_dark, colors.dark);
	gl.uniform2f(loc.u_col, colX(), colHalf());
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function start() {
	const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
	gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
	if (!gl) {
		console.warn('Iridescent Liquid Glass: WebGL is not available, so the glass is not drawn.');
		return;
	}
	canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); program = null; });
	canvas.addEventListener('webglcontextrestored', () => {
		try { setup(); } catch (err) { console.error('Iridescent Liquid Glass:', err.message); }
	});
	try {
		setup();
		requestAnimationFrame(frame);
	} catch (err) {
		console.error('Iridescent Liquid Glass:', err.message);
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
			time = Math.random() * 100;
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
		case 'mousedown':
			addRipple(d.x, d.y);
			break;
	}
};
