/**
 * Title: Thunderhead (WebGL)
 * Description: Domain-warped storm clouds with silver edges churn across the top of the screen over slanted rain; lightning now and then tears down beside the chat column, sometimes twice, and sweeping the cursor sideways gusts the wind.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const INTENSITY     = 0.85;  // how strongly the storm shows (0-1)
const CLOUD_SCALE   = 2.1;   // size of the billows; higher is smaller (1-4)
const WIND_SPEED    = 0.06;  // how fast the clouds drift (0-0.3)
const REDUCED_SPEED = 0.15;  // share of the drift kept when the viewer asks to reduce motion; lightning stops (0-1)
const RAIN_OPACITY  = 0.1;   // how visible the rain is (0-0.4)
const RAIN_SPEED    = 1.6;   // how fast the rain falls (0-4)
const STRIKE_MIN    = 6;     // fewest seconds between lightning strikes (2-30)
const STRIKE_MAX    = 16;    // most seconds between lightning strikes; 0 turns lightning off (0-60)
const DOUBLE_CHANCE = 0.35;  // chance of a quick second strike (0-1)
const BOLT_LENGTH   = 0.55;  // how far a bolt reaches down, as a share of the screen height (0.2-0.9)
const CURSOR_WIND   = 1;     // how much a sideways cursor sweep gusts the wind (0-2)
const CENTER_CALM   = 0.7;   // how much the storm thins behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const RENDER_SCALE  = 0.5;   // resolution of the clouds; they are soft, so half is plenty (0.25-1)
const MAX_FPS       = 30;    // frame cap (15-60)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const CLOUD_COLOR   = '#5c6478';  // cloud body when not following the theme
const SILVER_COLOR  = '#a8b2c8';  // moonlit cloud edges
const BOLT_COLOR    = '#dce6ff';  // lightning
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
	'uniform float u_wind;',
	'uniform float u_dark;',
	'uniform vec4 u_flash;',
	'uniform vec2 u_col;',
	'uniform vec3 u_cloud;',
	'uniform vec3 u_silver;',
	'uniform vec3 u_bolt;',
	'float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
	'float noise(vec2 p) {',
	'	vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);',
	'	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
	'}',
	'float fbm4(vec2 p) {',
	'	float v = 0.0, a = 0.5;',
	'	mat2 m = mat2(1.6, 1.2, -1.2, 1.6);',
	'	for (int i = 0; i < 4; i++) { v += a * noise(p); p = m * p; a *= 0.5; }',
	'	return v;',
	'}',
	'float fbm(vec2 p) {',
	'	float v = 0.0, a = 0.5;',
	'	mat2 m = mat2(1.6, 1.2, -1.2, 1.6);',
	'	for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }',
	'	return v;',
	'}',
	'float bolt(vec2 p, vec4 fl) {',
	'	float on = smoothstep(0.35, 0.7, fl.z);',
	'	if (on < 0.01) return 0.0;',
	'	float len = ' + BOLT_LENGTH.toFixed(3) + ';',
	'	float seg = clamp((fl.y - p.y) / len, 0.0, 1.0);',
	'	float xo = (noise(vec2(p.y * 7.0, fl.w * 57.0)) - 0.5) * 0.22 * seg + (noise(vec2(p.y * 23.0, fl.w * 91.0)) - 0.5) * 0.07 * seg;',
	'	float d = abs(p.x - fl.x - xo);',
	'	float inY = step(fl.y - len * (0.75 + 0.25 * fl.w), p.y) * step(p.y, fl.y);',
	'	return (exp(-d * 260.0) + exp(-d * 26.0) * 0.22) * inY * on * (1.0 - seg * 0.5);',
	'}',
	'float rain(vec2 p, float t, float nx) {',
	'	vec2 rp = vec2(p.x * nx + p.y * 6.0, p.y * 1.4 + t);',
	'	vec2 id = vec2(floor(rp.x), 0.0);',
	'	float y = fract(rp.y + hash(id) * 13.7);',
	'	float s = smoothstep(0.55, 0.95, y) * smoothstep(1.0, 0.97, y);',
	'	return s * smoothstep(0.35, 0.0, abs(fract(rp.x) - 0.5)) * step(0.4, hash(id + 7.3));',
	'}',
	'void main() {',
	'	vec2 px = gl_FragCoord.xy / u_scale;',
	'	float H = u_res.y / u_scale;',
	'	vec2 p = px / H;',
	'	float t = u_time;',
	'	float band = abs(px.x - u_col.x) / u_col.y;',
	'	float calm = 1.0 - ' + CENTER_CALM.toFixed(3) + ' * (1.0 - smoothstep(0.8, 1.35, band));',
	'	float K = ' + CLOUD_SCALE.toFixed(3) + ';',
	'	vec2 pc = vec2(p.x - u_wind * 0.5, p.y);',
	'	vec2 q = vec2(fbm4(pc * K + vec2(u_wind, 0.0)), fbm4(pc * K + vec2(5.2, 1.3)));',
	'	vec2 r = vec2(fbm4(pc * K + 2.6 * q + vec2(1.7, 9.2) - u_wind * 0.3), fbm4(pc * K + 2.6 * q + vec2(8.3, 2.8)));',
	'	float f = fbm(pc * K + 2.2 * r + vec2(0.0, t * 0.015));',
	'	float side = smoothstep(0.85, 1.5, band);',
	'	float shape = f * (0.55 + 0.75 * smoothstep(0.05, 0.9, p.y)) * (0.75 + 0.6 * side);',
	'	float cloud = smoothstep(0.34, 0.74, shape);',
	'	float f2 = fbm(pc * K + 2.2 * r + vec2(-0.05, 0.09) * K + vec2(0.0, t * 0.015));',
	'	float rimLit = clamp((f - f2) * 5.0, 0.0, 1.0);',
	'	vec3 ccol = mix(u_cloud * 0.6, u_cloud, smoothstep(0.3, 0.75, f));',
	'	ccol = mix(ccol, u_silver, rimLit * mix(0.55, 0.85, u_dark));',
	'	float ca = cloud * mix(0.5, 0.9, u_dark);',
	'	vec3 col = ccol * ca + u_silver * rimLit * smoothstep(0.5, 0.8, f) * cloud * 0.2 * u_dark;',
	'	float a = ca;',
	'	float glow = u_flash.z * exp(-length(p - u_flash.xy) * 2.8);',
	'	float e = glow * (0.15 + 1.4 * cloud * f) * mix(0.35, 0.9, u_dark);',
	'	float b = bolt(p, u_flash) * mix(0.8, 1.4, u_dark);',
	'	float rn = (rain(p, t * ' + RAIN_SPEED.toFixed(3) + ', 70.0) + rain(p + vec2(3.1, 0.0), t * ' + RAIN_SPEED.toFixed(3) + ' * 1.35, 110.0) * 0.6)',
	'		* ' + RAIN_OPACITY.toFixed(3) + ' * (1.0 + 3.0 * glow) * mix(0.75, 1.0, u_dark) * (1.0 - smoothstep(0.6, 1.0, cloud) * 0.5);',
	'	rn *= 1.0 - ' + CENTER_CALM.toFixed(3) + ' * (1.0 - smoothstep(0.8, 1.4, band));',
	'	col = (col + u_bolt * (e + b)) * calm + mix(u_cloud, u_silver, u_dark) * rn;',
	'	a = (a + (e + b) * mix(1.0, 0.7, u_dark)) * calm + rn;',
	'	float k = ' + INTENSITY.toFixed(3) + ';',
	'	a = clamp(a * k, 0.0, 1.0);',
	'	gl_FragColor = vec4(min(col * k, vec3(a)), a);',
	'}',
].join('\n');

let canvas, gl, program, buffer;
let loc = {};
let w = 0, h = 0;
let last = 0, time = 0, wind = 0, reduced = false, column = null;
const mouse = { x: -10000, amount: 0, gust: 1 };
const storm = { wait: 3, age: 100, second: -1, x: 0, y: 0.7, seed: 0.3 };
const colors = { cloud: hexToRgb(CLOUD_COLOR), silver: hexToRgb(SILVER_COLOR), bolt: hexToRgb(BOLT_COLOR), dark: 1 };

function hexToRgb(hex) {
	const n = parseInt(hex.slice(1), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mixRgb(a, b, t, k) {
	return [(a[0] + (b[0] - a[0]) * t) * k, (a[1] + (b[1] - a[1]) * t) * k, (a[2] + (b[2] - a[2]) * t) * k];
}

function applyTheme(t) {
	if (!t) return;
	colors.dark = t.dark === false ? 0 : 1;
	const rgb = FOLLOW_THEME && t.rgb ? t.rgb : null;
	if (colors.dark) {
		colors.cloud = rgb ? mixRgb(rgb.muted, rgb.text, 0.1, 0.8) : hexToRgb(CLOUD_COLOR);
		colors.silver = rgb ? mixRgb(rgb.muted, rgb.text, 0.55, 1) : hexToRgb(SILVER_COLOR);
		colors.bolt = rgb ? mixRgb(rgb.text, rgb.accent3, 0.3, 1) : hexToRgb(BOLT_COLOR);
	} else {
		colors.cloud = rgb ? mixRgb(rgb.muted, rgb.text, 0.15, 1) : mixRgb(hexToRgb(CLOUD_COLOR), [0.2, 0.22, 0.28], 0.3, 1);
		colors.silver = rgb ? mixRgb(rgb.muted, rgb.surface, 0.45, 1) : hexToRgb(SILVER_COLOR);
		colors.bolt = rgb ? rgb.accent : [0.25, 0.4, 0.75];
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
	['u_res', 'u_scale', 'u_time', 'u_wind', 'u_dark', 'u_flash', 'u_col', 'u_cloud', 'u_silver', 'u_bolt'].forEach((name) => {
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

// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }

// ── Lightning: strikes land in the chat area's margins beside the column, never over it or the sidebar ──
function updateStorm(dt) {
	storm.age += dt;
	if (storm.second > 0) {
		storm.second -= dt;
		if (storm.second <= 0) { storm.age = 0; storm.seed = Math.random(); storm.x += (Math.random() - 0.5) * 0.05; }
	}
	if (STRIKE_MAX <= 0 || reduced) return;
	storm.wait -= dt;
	if (storm.wait > 0) return;
	storm.wait = STRIKE_MIN + Math.random() * Math.max(0, STRIKE_MAX - STRIKE_MIN);
	const lo = column ? column.left : 0, hi = column ? column.right : w;
	const left = Math.max(0, colX() - colHalf() - lo), right = Math.max(0, hi - colX() - colHalf());
	if (left + right < 60) return;
	const r = Math.random() * (left + right);
	const x = r < left ? lo + left * (0.2 + 0.6 * (r / left)) : hi - right * (0.2 + 0.6 * ((r - left) / right));
	storm.x = x / h;
	storm.y = 0.68 + Math.random() * 0.22;
	storm.seed = Math.random();
	storm.age = 0;
	storm.second = Math.random() < DOUBLE_CHANCE ? 0.25 + Math.random() * 0.2 : -1;
}

function frame(now) {
	requestAnimationFrame(frame);
	if (!program || gl.isContextLost()) return;
	if (last && now - last < 1000 / MAX_FPS - 2) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const pace = reduced ? REDUCED_SPEED : 1;
	time = (time + dt * pace) % 3000;
	mouse.amount = Math.max(0, mouse.amount - dt * 0.5);
	const target = 1 + (mouse.gust - 1) * Math.min(1, mouse.amount * 2);
	wind = (wind + dt * WIND_SPEED * pace * target) % 3000;
	updateStorm(dt);
	const flash = storm.age < 1.5 ? Math.exp(-storm.age * 4.5) * Math.min(1, storm.age * 30) : 0;
	gl.uniform2f(loc.u_res, canvas.width, canvas.height);
	gl.uniform1f(loc.u_scale, canvas.width / Math.max(1, w));
	gl.uniform1f(loc.u_time, time);
	gl.uniform1f(loc.u_wind, wind);
	gl.uniform1f(loc.u_dark, colors.dark);
	gl.uniform4f(loc.u_flash, storm.x, storm.y, reduced ? 0 : flash, storm.seed);
	gl.uniform2f(loc.u_col, colX(), colHalf());
	gl.uniform3fv(loc.u_cloud, colors.cloud);
	gl.uniform3fv(loc.u_silver, colors.silver);
	gl.uniform3fv(loc.u_bolt, colors.bolt);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function start() {
	const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
	gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
	if (!gl) {
		console.warn('Thunderhead: WebGL is not available, so the storm is not drawn.');
		return;
	}
	canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); program = null; });
	canvas.addEventListener('webglcontextrestored', () => {
		try { setup(); } catch (err) { console.error('Thunderhead:', err.message); }
	});
	try {
		setup();
		requestAnimationFrame(frame);
	} catch (err) {
		console.error('Thunderhead:', err.message);
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
			// A sideways sweep sets the gust: right blows harder, left eases it
			if (mouse.x > -9000 && Math.abs(d.x - mouse.x) > 2) {
				mouse.gust = Math.max(0.2, 1 + (d.x / Math.max(1, w) - 0.5) * 2.4 * CURSOR_WIND);
				mouse.amount = 1;
			}
			mouse.x = d.x;
			break;
	}
};
