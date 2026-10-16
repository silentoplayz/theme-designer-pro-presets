/**
 * Title: Parallax Vista (WebGL)
 * Description: Layered dusk mountain ranges open into a valley behind the chat, a soft sun glows beside it, mist pools in the folds and fireflies drift past, every layer shifting by its depth as the cursor moves.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const PARALLAX      = 1;     // strength of the cursor depth effect; 0 holds the layers still (0-2)
const DRIFT         = 0.01;  // idle sideways drift of the ranges (0-0.05)
const REDUCED_SPEED = 0.15;  // share of the drift kept when the viewer asks to reduce motion (0-1)
const FIREFLIES     = 0.6;   // brightness of the drifting fireflies; 0 turns them off (0-1.5)
const STARS         = 0.6;   // faint stars over the ranges, dark themes only (0-1)
const SUN_GLOW      = 1;     // brightness of the sun and the horizon glow (0-2)
const MIST          = 1;     // how much mist pools above each range (0-2)
const VALLEY        = 0.55;  // how deeply the ranges part behind the chat column (0-1)
const RANGE_HEIGHT  = 1;     // how tall the ranges rise (0.6-1.5)
const CENTER_CALM   = 0.7;   // how much the scene fades behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const RENDER_SCALE  = 0.6;   // resolution of the scene; ridges are soft, so 0.6 is plenty (0.3-1)
const MAX_FPS       = 30;    // frame cap; the vista moves slowly (15-60)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const COLOR_GLOW    = '#fa9457';  // apricot horizon glow when not following the theme
const COLOR_SUN     = '#ffd9a0';  // sun disk
const COLOR_FAR     = '#8a82b0';  // hazy far ranges
const COLOR_NEAR    = '#0b0d1c';  // near silhouettes
const COLOR_FLY     = '#ffcc73';  // fireflies
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
	'uniform float u_drift[5];',
	'uniform vec2 u_look;',
	'uniform vec2 u_sun;',
	'uniform vec3 u_glow;',
	'uniform vec3 u_disk;',
	'uniform vec3 u_far;',
	'uniform vec3 u_near;',
	'uniform vec3 u_mist;',
	'uniform vec3 u_fly;',
	'uniform float u_dark;',
	'uniform vec2 u_col;',
	'float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
	'float noise(vec2 p) {',
	'	vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);',
	'	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
	'}',
	'float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }',
	'vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }',
	'float fireflies(vec2 p, float t) {',
	'	vec2 g = p * 7.0, gi = floor(g), gf = fract(g);',
	'	float sum = 0.0;',
	'	for (int j = -1; j <= 1; j++) {',
	'		for (int i = -1; i <= 1; i++) {',
	'			vec2 o = vec2(float(i), float(j)), id = gi + o;',
	'			float r = hash(id);',
	'			vec2 cp = o + vec2(hash(id + 1.7), hash(id + 3.3));',
	'			cp += vec2(cos(t * 0.4 + r * 6.28) * 0.15, sin(t * 0.6 + r * 6.28) * 0.35);',
	'			float tw = 0.5 + 0.5 * sin(t * 1.5 + r * 25.0);',
	'			sum += smoothstep(0.07, 0.0, length(gf - cp)) * tw * step(0.45, r);',
	'		}',
	'	}',
	'	return sum;',
	'}',
	'void main() {',
	'	vec2 px = gl_FragCoord.xy / u_scale;',
	'	vec2 res = u_res / u_scale;',
	'	vec2 st = px / res;',
	'	float aspect = res.x / res.y;',
	'	float t = u_time;',
	'	float band = abs(px.x - u_col.x) / u_col.y;',
	'	float near = 1.0 - smoothstep(0.5, 1.3, band);',
	'	float calm = 1.0 - ' + CENTER_CALM.toFixed(3) + ' * near;',
	'	vec2 sun = vec2(u_sun.x, res.y - u_sun.y);',
	'	float sunSide = exp(-abs(px.x - sun.x) / (res.y * 0.6));',
	'	float sg = ' + SUN_GLOW.toFixed(3) + ' * mix(0.6, 1.0, u_dark);',
	'	float hg = exp(-pow((st.y - 0.36) * 5.0, 2.0)) * (0.2 + 0.8 * sunSide) * 0.32 * sg * mix(0.5, 1.0, calm);',
	'	vec4 o = vec4(u_glow * hg, hg);',
	'	vec2 sgd = px * vec2(1.0, 1.0) / 1.5;',
	'	vec2 cell = floor(sgd / 6.0);',
	'	float hs = hash(cell);',
	'	float star = step(1.0 - 0.012 * ' + STARS.toFixed(3) + ', hs) * smoothstep(1.4, 0.2, length(sgd - (cell + 0.5) * 6.0)) * (0.55 + 0.45 * sin(t * 1.2 + hs * 80.0)) * smoothstep(0.5, 0.8, st.y) * u_dark * calm * 0.8;',
	'	o = over(vec4(vec3(star), star), o);',
	'	float sd = length(px - sun);',
	'	float sr = res.y * 0.045;',
	'	float glow = exp(-sd / (res.y * 0.16)) * 0.45 * sg;',
	'	float disk = smoothstep(sr + 1.5, sr - 1.5, sd) * mix(0.75, 1.0, u_dark) * min(1.0, sg);',
	'	o = over(vec4(u_glow * glow, glow), o);',
	'	o = over(vec4(u_disk * disk, disk), o);',
	'	for (int k = 0; k < 5; k++) {',
	'		float fk = float(k) / 4.0;',
	'		float baseY = mix(0.40, 0.11, fk) * ' + RANGE_HEIGHT.toFixed(3) + ';',
	'		float amp = mix(0.03, 0.13, fk) * ' + RANGE_HEIGHT.toFixed(3) + ';',
	'		float freq = mix(2.2, 1.3, fk);',
	'		float rx = st.x * aspect + u_look.x * mix(0.015, 0.14, fk) + u_drift[k];',
	'		float dip = 1.0 - ' + VALLEY.toFixed(3) + ' * near * mix(0.45, 0.7, fk);',
	'		float ridge = baseY * dip + u_look.y * mix(0.004, 0.03, fk) + (fbm(vec2(rx * freq, 7.0 * fk)) * 2.0 - 1.0) * amp * mix(1.0, 0.6, near);',
	'		float below = smoothstep(ridge + 0.002, ridge - 0.002, st.y);',
	'		float mist = smoothstep(ridge + 0.07, ridge, st.y) * (1.0 - below) * 0.22 * (1.0 - fk * 0.7) * ' + MIST.toFixed(3) + ' * mix(0.5, 1.0, calm);',
	'		o = over(vec4(u_mist * mist, mist), o);',
	'		float la = below * mix(mix(0.12, 0.42, fk), mix(0.28, 0.92, fk), u_dark) * mix(calm, 1.0, 0.25);',
	'		vec3 lc = mix(u_far, u_near, fk * fk);',
	'		lc = mix(lc, u_glow, (1.0 - fk) * 0.25 * sunSide);',
	'		o = over(vec4(lc * la, la), o);',
	'	}',
	'	vec2 fuv = st * vec2(aspect, 1.0) + u_look * 0.9;',
	'	float ff = fireflies(fuv, t) * ' + FIREFLIES.toFixed(3) + ' * smoothstep(0.6, 0.15, st.y) * calm * calm * mix(0.7, 1.0, u_dark);',
	'	o = over(vec4(u_fly * ff, ff), o);',
	'	o = clamp(o, 0.0, 1.0);',
	'	gl_FragColor = vec4(min(o.rgb, vec3(o.a)), o.a);',
	'}',
].join('\n');

let canvas, gl, program, buffer;
const loc = {};
let w = 0, h = 0;
let last = 0, time = 0, reduced = false, column = null;
const drifts = new Float32Array(5);
const mouse = { x: -10000, y: -10000, amount: 0, target: 0, lx: 0, ly: 0 };
const sun = { x: -1, y: 0 };
const colors = {};

function hexToRgb(hex) {
	const n = parseInt(hex.slice(1), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mix3(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }

// Glow and sun from accent2, far ranges from muted and accent, near ranges from the background's shadow
function applyTheme(t) {
	if (t) colors.dark = t.dark === false ? 0 : 1;
	if (colors.dark === undefined) colors.dark = 1;
	const dark = colors.dark === 1;
	if (!FOLLOW_THEME || !t || !t.rgb) {
		colors.glow = hexToRgb(COLOR_GLOW);
		colors.disk = dark ? hexToRgb(COLOR_SUN) : hexToRgb(COLOR_GLOW);
		colors.far = hexToRgb(COLOR_FAR);
		colors.near = dark ? hexToRgb(COLOR_NEAR) : mix3(hexToRgb(COLOR_FAR), hexToRgb(COLOR_NEAR), 0.5);
		colors.mist = dark ? [0.8, 0.75, 0.86] : [1, 1, 1];
		colors.fly = hexToRgb(COLOR_FLY);
		return;
	}
	const r = t.rgb;
	colors.glow = r.accent2;
	colors.disk = dark ? mix3(r.accent2, r.text, 0.55) : r.accent2;
	colors.far = mix3(r.muted, r.accent, 0.35);
	colors.near = dark ? mix3(r.background, [0, 0, 0], 0.7) : mix3(r.muted, r.text, 0.35);
	colors.mist = dark ? mix3(r.muted, r.text, 0.4) : [1, 1, 1];
	colors.fly = dark ? mix3(r.accent3, r.text, 0.3) : r.accent3;
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
	['u_res', 'u_scale', 'u_time', 'u_drift', 'u_look', 'u_sun', 'u_glow', 'u_disk', 'u_far', 'u_near', 'u_mist', 'u_fly', 'u_dark', 'u_col'].forEach((name) => {
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

// The sun sits in the middle of the wider margin beside the chat column
function sunTargetX() {
	const lo = column ? column.left : 0, hi = column ? column.right : w;
	const left = colX() - colHalf() - lo, right = hi - colX() - colHalf();
	return left >= right ? lo + Math.max(left * 0.5, h * 0.08) : hi - Math.max(right * 0.5, h * 0.08);
}

function frame(now) {
	requestAnimationFrame(frame);
	if (!program || gl.isContextLost()) return;
	if (last && now - last < 1000 / MAX_FPS - 2) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const k = reduced ? REDUCED_SPEED : 1;
	time = (time + dt * k) % 3000;
	for (let i = 0; i < 5; i++) drifts[i] = (drifts[i] + dt * k * DRIFT * (0.3 + i * 0.175)) % 1000;
	// Layers lean toward the cursor, then settle back once it rests
	mouse.target = Math.max(0, mouse.target - dt * 0.3);
	mouse.amount += (mouse.target - mouse.amount) * Math.min(1, dt * 2);
	const tx = w ? (mouse.x / w - 0.5) * mouse.amount * PARALLAX : 0;
	const ty = h ? (0.5 - mouse.y / h) * mouse.amount * PARALLAX : 0;
	const ease = Math.min(1, dt * (reduced ? 0.5 : 2.5));
	mouse.lx += (tx - mouse.lx) * ease;
	mouse.ly += (ty - mouse.ly) * ease;
	const sx = sunTargetX();
	sun.x = sun.x < 0 ? sx : sun.x + (sx - sun.x) * Math.min(1, dt * 1.5);
	sun.y = h * 0.6;
	gl.uniform2f(loc.u_res, canvas.width, canvas.height);
	gl.uniform1f(loc.u_scale, canvas.width / Math.max(1, w));
	gl.uniform1f(loc.u_time, time);
	gl.uniform1fv(loc.u_drift, drifts);
	gl.uniform2f(loc.u_look, mouse.lx, mouse.ly);
	gl.uniform2f(loc.u_sun, sun.x, sun.y);
	gl.uniform3fv(loc.u_glow, colors.glow);
	gl.uniform3fv(loc.u_disk, colors.disk);
	gl.uniform3fv(loc.u_far, colors.far);
	gl.uniform3fv(loc.u_near, colors.near);
	gl.uniform3fv(loc.u_mist, colors.mist);
	gl.uniform3fv(loc.u_fly, colors.fly);
	gl.uniform1f(loc.u_dark, colors.dark);
	gl.uniform2f(loc.u_col, colX(), colHalf());
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function start() {
	const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
	gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
	if (!gl) {
		console.warn('Parallax Vista: WebGL is not available, so the vista is not drawn.');
		return;
	}
	canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); program = null; });
	canvas.addEventListener('webglcontextrestored', () => {
		try { setup(); } catch (err) { console.error('Parallax Vista:', err.message); }
	});
	try {
		setup();
		requestAnimationFrame(frame);
	} catch (err) {
		console.error('Parallax Vista:', err.message);
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
			for (let i = 0; i < 5; i++) drifts[i] = Math.random() * 100;
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
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.target = 1;
			break;
	}
};
