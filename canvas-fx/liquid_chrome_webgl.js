/**
 * Title: Liquid Chrome (WebGL)
 * Description: A domain-warped pool of liquid chrome tinted by your theme that gathers at the screen's edges and corners, leaves the chat clear and leans toward the cursor.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const INTENSITY     = 0.8;   // how strongly the chrome shows (0-1)
const MOTION        = 1;     // flow speed; 0 freezes the surface (0-3)
const REDUCED_SPEED = 0.15;  // share of the flow kept when the viewer asks to reduce motion (0-1)
const POOL_SIZE     = 0.38;  // how far the chrome reaches in from the edges (0.1-0.8)
const SCALE         = 1.6;   // size of the ripples; lower is larger (0.6-4)
const WARP          = 1.4;   // how swirled the liquid is (0-3)
const BUMP          = 0.9;   // depth of the surface relief (0.2-2)
const REFLECTIVITY  = 0.8;   // strength of the reflected highlights (0-1)
const IRIDESCENCE   = 0.7;   // how much the accents shimmer through the metal (0-1)
const CENTER_CALM   = 0.9;   // how much the chrome fades behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band around the chat column, in px (300-900)
const MOUSE_PULL    = 1;     // how far the liquid leans toward the cursor (0-2)
const RENDER_SCALE  = 0.5;   // resolution of the surface; it is soft, so half is plenty (0.25-1)
const MAX_FPS       = 30;    // frame cap; the liquid moves slowly (15-60)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const CHROME_COLOR  = '#9aa3b5';  // base metal color when not following the theme
const COLOR_A       = '#7fa8ff';  // first shimmer color
const COLOR_B       = '#c58cf0';  // second shimmer color
const COLOR_C       = '#f2f4ff';  // highlight color
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
	'uniform vec3 u_metal;',
	'uniform vec3 u_c1;',
	'uniform vec3 u_c2;',
	'uniform vec3 u_hi;',
	'uniform float u_dark;',
	'float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
	'float noise(vec2 p) {',
	'	vec2 i = floor(p), f = fract(p);',
	'	vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);',
	'	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
	'}',
	'float fbm(vec2 p) {',
	'	float v = 0.0, a = 0.5;',
	'	mat2 m = mat2(1.6, 1.2, -1.2, 1.6);',
	'	for (int i = 0; i < 4; i++) { v += a * noise(p); p = m * p; a *= 0.5; }',
	'	return v;',
	'}',
	'void main() {',
	'	vec2 px = gl_FragCoord.xy / u_scale;',
	'	vec2 res = u_res / u_scale;',
	'	float t = u_time;',
	'	vec2 m = vec2(u_mouse.x, res.y - u_mouse.y);',
	'	vec2 dm = m - px;',
	'	float near = u_mouse.z * exp(-dot(dm, dm) / 52000.0);',
	'	vec2 p = (px + dm * near * 0.18 * ' + MOUSE_PULL.toFixed(3) + ') / res.y * ' + SCALE.toFixed(3) + ';',
	'	vec2 q = vec2(fbm(p + vec2(0.0, t * 0.11)), fbm(p + vec2(5.2, 1.3) - t * 0.09));',
	'	vec2 w = p + ' + WARP.toFixed(3) + ' * q + vec2(t * 0.05, -t * 0.04);',
	'	float e = 0.02;',
	'	float f = fbm(w);',
	'	float fx = fbm(w + vec2(e, 0.0));',
	'	float fy = fbm(w + vec2(0.0, e));',
	'	vec3 n = normalize(vec3((f - fx) / e * 0.15 * ' + BUMP.toFixed(3) + ', (f - fy) / e * 0.15 * ' + BUMP.toFixed(3) + ', 0.2));',
	// A fake studio environment: dark floor, a hard wavy horizon, a bright sky, one key light and contour streaks
	'	float env = n.y * 0.8 + n.x * 0.3;',
	'	float sky = smoothstep(-0.03, 0.03, env + 0.12 * sin(n.x * 4.0 + t * 0.3));',
	'	float lum = mix(0.08 + 0.25 * smoothstep(-1.0, 0.0, env), 0.5 + 0.5 * smoothstep(0.0, 0.9, env), sky);',
	'	float streak = pow(0.5 + 0.5 * cos(f * 18.0 + env * 4.0), 10.0) * 0.45;',
	'	float spec = (pow(max(dot(n, normalize(vec3(0.35, 0.55, 1.0))), 0.0), 48.0) + streak) * ' + REFLECTIVITY.toFixed(3) + ';',
	'	vec3 shimmer = mix(u_c1, u_c2, smoothstep(0.25, 0.75, q.x + 0.3 * sin(t * 0.2 + f * 6.0)));',
	'	vec3 metal = mix(u_metal, shimmer, ' + IRIDESCENCE.toFixed(3) + ' * (0.4 + 0.6 * (1.0 - sky)));',
	// The pool lies along the left and right edges and bulges into the corners; the surface ripples its shoreline
	'	vec2 r = abs(px - res * 0.5) / (res * 0.5);',
	'	float edge = r.x + 0.3 * r.y * r.y * r.y;',
	'	float shore = 1.0 - ' + POOL_SIZE.toFixed(3) + ' + (f - 0.5) * 0.5 - near * 0.2 * ' + MOUSE_PULL.toFixed(3) + ';',
	'	float pool = smoothstep(shore, shore + 0.05, edge);',
	'	float rim = smoothstep(shore - 0.01, shore + 0.02, edge) * (1.0 - smoothstep(shore + 0.02, shore + 0.06, edge));',
	'	float band = abs(px.x - res.x * 0.5) / ' + BAND_WIDTH.toFixed(1) + ';',
	'	float calm = 1.0 - ' + CENTER_CALM.toFixed(3) + ' * (1.0 - smoothstep(0.55, 1.25, band));',
	'	float k = calm * ' + INTENSITY.toFixed(3) + ';',
	'	vec3 col;',
	'	float a;',
	'	if (u_dark > 0.5) {',
	// On dark themes the metal glows: brightness becomes light
	'		col = metal * lum + mix(u_hi, shimmer, 0.3) * (spec * pool + rim * 0.4);',
	'		a = pool * (0.1 + 0.6 * lum + spec * 0.8) + rim * 0.3;',
	'	} else {',
	// On light themes the metal is ink: its shadowed side darkens, highlights let the page through
	'		col = mix(metal, shimmer, 0.55) * 0.7;',
	'		a = pool * (0.04 + 0.7 * pow(1.0 - lum, 1.3)) * (1.0 - min(spec, 1.0) * 0.85) + rim * 0.3;',
	'	}',
	'	a = clamp(a * k, 0.0, 0.95);',
	'	gl_FragColor = vec4(min(col * a, vec3(a)), a);',
	'}',
].join('\n');

let canvas, gl, program, buffer;
let loc = {};
let w = 0, h = 0;
let last = 0, time = 0, reduced = false;
const mouse = { x: -10000, y: -10000, amount: 0, target: 0 };
const colors = { metal: hexToRgb(CHROME_COLOR), c1: hexToRgb(COLOR_A), c2: hexToRgb(COLOR_B), hi: hexToRgb(COLOR_C), dark: 1 };

function hexToRgb(hex) {
	const n = parseInt(hex.slice(1), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function applyTheme(t) {
	if (!t) return;
	colors.dark = t.dark === false ? 0 : 1;
	if (!FOLLOW_THEME || !t.rgb) return;
	colors.metal = t.rgb.muted;
	colors.c1 = t.rgb.accent;
	colors.c2 = t.rgb.accent2;
	colors.hi = colors.dark ? t.rgb.text : t.rgb.accent3;
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
	['u_res', 'u_scale', 'u_time', 'u_mouse', 'u_metal', 'u_c1', 'u_c2', 'u_hi', 'u_dark'].forEach((name) => {
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

function frame(now) {
	requestAnimationFrame(frame);
	if (!program || gl.isContextLost()) return;
	if (last && now - last < 1000 / MAX_FPS - 2) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	time = (time + dt * 0.2 * MOTION * (reduced ? REDUCED_SPEED : 1)) % 2000;
	mouse.target = Math.max(0, mouse.target - dt * 0.35);
	mouse.amount += (mouse.target - mouse.amount) * Math.min(1, dt * (reduced ? 1 : 2.5));
	gl.uniform2f(loc.u_res, canvas.width, canvas.height);
	gl.uniform1f(loc.u_scale, canvas.width / Math.max(1, w));
	gl.uniform1f(loc.u_time, time);
	gl.uniform3f(loc.u_mouse, mouse.x, mouse.y, mouse.amount);
	gl.uniform3fv(loc.u_metal, colors.metal);
	gl.uniform3fv(loc.u_c1, colors.c1);
	gl.uniform3fv(loc.u_c2, colors.c2);
	gl.uniform3fv(loc.u_hi, colors.hi);
	gl.uniform1f(loc.u_dark, colors.dark);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function start() {
	const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
	gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
	if (!gl) {
		console.warn('Liquid Chrome: WebGL is not available, so the chrome is not drawn.');
		return;
	}
	canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); program = null; });
	canvas.addEventListener('webglcontextrestored', () => {
		try { setup(); } catch (err) { console.error('Liquid Chrome:', err.message); }
	});
	try {
		setup();
		requestAnimationFrame(frame);
	} catch (err) {
		console.error('Liquid Chrome:', err.message);
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
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.target = 1;
			break;
	}
};
