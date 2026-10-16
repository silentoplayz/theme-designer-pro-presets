/**
 * Title: Rose Window (WebGL)
 * Description: A cathedral rose window of mirrored Voronoi glass in your theme's accents glows in the margin beside the chat, lit by a slow sunbeam that the cursor tilts, with dust motes drifting in the light.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const SYMMETRY      = 10;    // how many mirrored wedges the window folds into (4-24)
const CELL_SCALE    = 7;     // density of the glass panes (2-12)
const RING_COUNT    = 3.5;   // how many concentric lead rings cross the window (1-8)
const WINDOW_SIZE   = 0.4;   // window radius as a share of the screen's height; it shrinks to fit the margin (0.2-0.5)
const SHAFT_WIDTH   = 0.16;  // width of the sunbeam (0.05-0.4)
const SHAFT_SPEED   = 0.05;  // how fast the sunbeam sweeps back and forth; 0 holds it (0-0.3)
const REDUCED_SPEED = 0.2;   // share of the motion kept when the viewer asks to reduce motion (0-1)
const SHIMMER       = 1;     // how much the panes brighten and dim on their own (0-2)
const DUST_AMOUNT   = 1;     // brightness of the dust motes in the beam (0-2)
const CURSOR_TILT   = 1;     // how far the cursor tilts the sunbeam (0-2)
const PALETTE_SHIFT = 0;     // rotates the pane colors (0-1)
const CENTER_CALM   = 0.85;  // how much the beam and motes fade behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const RENDER_SCALE  = 1;     // resolution of the window; lower trades crisp lead lines for speed (0.4-1)
const MAX_FPS       = 30;    // frame cap; the light moves slowly (15-60)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
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
	'uniform float u_angle;',
	'uniform vec3 u_win;',
	'uniform vec3 u_c1;',
	'uniform vec3 u_c2;',
	'uniform vec3 u_c3;',
	'uniform vec3 u_lead;',
	'uniform vec3 u_beam;',
	'uniform float u_theme;',
	'uniform float u_dark;',
	'uniform vec2 u_col;',
	'const float WR = 0.42;',
	'float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
	'vec2 hash2(vec2 p) { return vec2(hash(p), hash(p + 17.31)); }',
	'float noise(vec2 p) {',
	'	vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);',
	'	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
	'}',
	'float fbm(vec2 p) { float v = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 4; i++) { v += a * noise(p); p = m * p; a *= 0.5; } return v; }',
	'vec3 voronoi(vec2 p) {',
	'	vec2 i = floor(p), f = fract(p);',
	'	float f1 = 8.0, f2 = 8.0, id = 0.0;',
	'	for (int y = -1; y <= 1; y++) {',
	'		for (int x = -1; x <= 1; x++) {',
	'			vec2 g = vec2(float(x), float(y));',
	'			vec2 r = g + hash2(i + g) - f;',
	'			float d = dot(r, r);',
	'			if (d < f1) { f2 = f1; f1 = d; id = hash(i + g + 3.1); } else if (d < f2) { f2 = d; }',
	'		}',
	'	}',
	'	return vec3(sqrt(f1), sqrt(f2), id);',
	'}',
	// Jewel tones: the artist's cosine palette, or the theme's three accents
	'vec3 pane(float x) {',
	'	vec3 own = pow(vec3(0.5) + vec3(0.5) * cos(6.2831853 * (x + vec3(0.0, 0.33, 0.67))), vec3(1.6)) * 1.2;',
	'	float k = floor(fract(x) * 6.0);',
	'	vec3 th = k < 1.0 ? u_c1 : (k < 2.0 ? mix(u_c1, u_c2, 0.5) : (k < 3.0 ? u_c2 : (k < 4.0 ? mix(u_c2, u_c3, 0.5) : (k < 5.0 ? u_c3 : mix(u_c3, u_c1, 0.5)))));',
	'	th *= 0.7 + 0.45 * fract(x * 7.0);',
	'	return mix(own, th, u_theme);',
	'}',
	'void main() {',
	'	vec2 px = gl_FragCoord.xy / u_scale;',
	'	vec2 res = u_res / u_scale;',
	'	float t = u_time;',
	'	vec2 cen = vec2(u_win.x, res.y - u_win.y);',
	'	vec2 c = (px - cen) / u_win.z * WR;',
	'	float r = length(c);',
	'	float band = abs(px.x - u_col.x) / u_col.y;',
	'	float calm = 1.0 - ' + CENTER_CALM.toFixed(3) + ' * (1.0 - smoothstep(0.55, 1.25, band));',
	'	vec2 sd = vec2(cos(u_angle), sin(u_angle));',
	'	float pc = dot(c, vec2(-sd.y, sd.x));',
	'	float along = dot(c, sd);',
	'	float SW = ' + SHAFT_WIDTH.toFixed(3) + ';',
	'	float shaft = smoothstep(SW, SW * 0.15, abs(pc)) * (0.55 + 0.45 * fbm(vec2(along * 3.0 - t * 0.12, pc * 7.0)));',
	'	vec4 o = vec4(0.0);',
	'	vec3 tint = (u_c1 + u_c2 + u_c3) / 3.0;',
	'	float halo = exp(-max(r - WR, 0.0) * 9.0) * step(WR, r) * mix(0.10, 0.22, u_dark);',
	'	o = vec4(tint * halo, halo);',
	'	float spread = smoothstep(-0.05, 0.1, along) * exp(-max(along, 0.0) * 0.9) * step(WR * 0.98, r);',
	'	float ba = shaft * spread * calm * mix(0.06, 0.15, u_dark);',
	'	o = vec4(u_beam * ba, ba) + o * (1.0 - ba);',
	'	float mote = 0.0;',
	'	vec2 p = px / res.y;',
	'	for (int i = 0; i < 2; i++) {',
	'		float fi = float(i);',
	'		vec2 mp = p * (46.0 + fi * 30.0) + vec2(t * (1.5 + fi) * 0.4, -t * (0.8 + fi * 0.5) * 0.4);',
	'		vec2 mid = floor(mp);',
	'		float md = length(fract(mp) - (0.2 + 0.6 * hash2(mid)));',
	'		mote += smoothstep(0.12, 0.0, md) * step(0.85, hash(mid + 5.1)) * (0.5 + 0.5 * sin(t * 1.5 + hash(mid) * 30.0));',
	'	}',
	'	float ma = mote * shaft * spread * calm * calm * 0.8 * ' + DUST_AMOUNT.toFixed(3) + ' * mix(0.6, 1.0, u_dark);',
	'	if (r < WR * 1.03) {',
	'		float seg = 6.2831853 / ' + SYMMETRY.toFixed(1) + ';',
	'		float wa = mod(atan(c.y, c.x), seg);',
	'		float fa = abs(wa - seg * 0.5);',
	'		vec2 fp = vec2(cos(fa), sin(fa)) * r;',
	'		vec3 v = voronoi(fp * ' + CELL_SCALE.toFixed(2) + ' + 3.7);',
	'		float lead = 1.0 - smoothstep(0.0, 0.09, v.y - v.x);',
	'		float spoke = 1.0 - smoothstep(0.0025, 0.008, min(wa, seg - wa) * r);',
	'		float nr = fract(r * ' + RING_COUNT.toFixed(2) + ' / WR);',
	'		float ring = 1.0 - smoothstep(0.0025, 0.007, min(nr, 1.0 - nr) * WR / ' + RING_COUNT.toFixed(2) + ');',
	'		float hub = 1.0 - smoothstep(0.02, 0.026, r);',
	'		float leadMask = max(max(lead, hub), max(spoke, ring));',
	'		vec3 col = pane(v.z * 5.0 + ' + PALETTE_SHIFT.toFixed(3) + ');',
	'		float tex = 0.75 + 0.45 * noise(fp * 30.0 + v.z * 40.0);',
	'		float lum = 0.55 + 0.25 * ' + SHIMMER.toFixed(3) + ' * sin(t * 0.3 + v.z * 9.0);',
	'		float lit = lum * tex + shaft * 0.9;',
	'		float inside = smoothstep(WR, WR - 0.004, r);',
	'		float ga = clamp(lit * mix(0.6, 0.62, u_dark), 0.0, 0.95) * inside * (1.0 - leadMask);',
	'		vec3 gc = min(col * mix(1.0, 0.75 + 0.6 * lit, u_dark), vec3(1.0));',
	'		o = vec4(gc * ga, ga) + o * (1.0 - ga);',
	'		float rim = smoothstep(0.014, 0.004, abs(r - WR));',
	'		float la = max(leadMask * inside, rim) * mix(0.7, 0.85, u_dark);',
	'		o = vec4(u_lead * la, la) + o * (1.0 - la);',
	'	}',
	'	o = vec4(mix(u_beam, vec3(1.0), 0.4 * u_dark) * ma, ma) + o * (1.0 - ma);',
	'	o = clamp(o, 0.0, 1.0);',
	'	gl_FragColor = vec4(min(o.rgb, vec3(o.a)), o.a);',
	'}',
].join('\n');

let canvas, gl, program, buffer;
const loc = {};
let w = 0, h = 0, dpr = 1;
let last = 0, time = 0, phase = 0, reduced = false, column = null;
const mouse = { x: -10000, y: -10000, amount: 0, target: 0, lean: 0 };
const win = { x: -1, y: 0, r: 0 };
const colors = { c1: [1, 1, 1], c2: [1, 1, 1], c3: [1, 1, 1], lead: [0.02, 0.02, 0.02], beam: [1, 0.9, 0.7], theme: 0, dark: 1 };

function mix3(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }

// Panes in the accents, lead in the theme's darkest tone, the beam a warm white on dark themes
function applyTheme(t) {
	if (t) colors.dark = t.dark === false ? 0 : 1;
	const dark = colors.dark === 1;
	const follow = FOLLOW_THEME && t && t.rgb;
	colors.theme = follow ? 1 : 0;
	if (follow) {
		colors.c1 = t.rgb.accent;
		colors.c2 = t.rgb.accent2;
		colors.c3 = t.rgb.accent3;
	} else {
		colors.c1 = [0.9, 0.55, 0.2];
		colors.c2 = [0.35, 0.2, 0.8];
		colors.c3 = [0.8, 0.15, 0.3];
	}
	colors.lead = follow ? (dark ? mix3(t.rgb.background, [0, 0, 0], 0.8) : t.rgb.text) : (dark ? [0.02, 0.018, 0.016] : [0.15, 0.13, 0.12]);
	colors.beam = dark ? (follow ? mix3(t.rgb.text, t.rgb.accent, 0.2) : [1, 0.9, 0.7]) : (follow ? t.rgb.accent : [0.75, 0.5, 0.2]);
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
	['u_res', 'u_scale', 'u_time', 'u_angle', 'u_win', 'u_c1', 'u_c2', 'u_c3', 'u_lead', 'u_beam', 'u_theme', 'u_dark', 'u_col'].forEach((name) => {
		loc[name] = gl.getUniformLocation(program, name);
	});
	gl.disable(gl.BLEND);
	size();
}

// Lead lines are line art, so the window follows the pixel ratio up to 1.5
function size() {
	const s = RENDER_SCALE * Math.min(dpr, 1.5);
	canvas.width = Math.max(1, Math.round(w * s));
	canvas.height = Math.max(1, Math.round(h * s));
	if (gl && !gl.isContextLost()) gl.viewport(0, 0, canvas.width, canvas.height);
}

function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }

// The window fills the wider margin beside the chat column, cropped by the screen's edge when the margin is narrow
function placeWindow(dt) {
	const left = colX() - colHalf(), right = w - colX() - colHalf();
	const room = Math.max(left, right);
	const r = Math.min(h * WINDOW_SIZE, Math.max(room * 0.85, h * 0.26));
	const x = left >= right ? room - r : w - room + r;
	const k = win.x < 0 ? 1 : Math.min(1, dt * 1.5);
	win.x += (x - win.x) * k;
	win.r += (r - win.r) * k;
	win.y = h * 0.42;
	return left >= right;
}

function frame(now) {
	requestAnimationFrame(frame);
	if (!program || gl.isContextLost()) return;
	if (last && now - last < 1000 / MAX_FPS - 2) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const k = reduced ? REDUCED_SPEED : 1;
	time = (time + dt * k) % 2000;
	phase = (phase + dt * k * SHAFT_SPEED) % 6.2831853;
	mouse.target = Math.max(0, mouse.target - dt * 0.35);
	mouse.amount += (mouse.target - mouse.amount) * Math.min(1, dt * 2);
	const want = w ? (mouse.x / w - 0.5) * mouse.amount * CURSOR_TILT : 0;
	mouse.lean += (want - mouse.lean) * Math.min(1, dt * (reduced ? 0.5 : 1.5));
	const onLeft = placeWindow(dt);
	// The beam falls down and inward from the window, sweeping gently either side of that line
	const base = onLeft ? -1.1 : Math.PI + 1.1;
	const angle = base + (onLeft ? 1 : -1) * (Math.sin(phase) * 0.3) + mouse.lean * 0.9;
	gl.uniform2f(loc.u_res, canvas.width, canvas.height);
	gl.uniform1f(loc.u_scale, canvas.width / Math.max(1, w));
	gl.uniform1f(loc.u_time, time);
	gl.uniform1f(loc.u_angle, angle);
	gl.uniform3f(loc.u_win, win.x, win.y, Math.max(1, win.r));
	gl.uniform3fv(loc.u_c1, colors.c1);
	gl.uniform3fv(loc.u_c2, colors.c2);
	gl.uniform3fv(loc.u_c3, colors.c3);
	gl.uniform3fv(loc.u_lead, colors.lead);
	gl.uniform3fv(loc.u_beam, colors.beam);
	gl.uniform1f(loc.u_theme, colors.theme);
	gl.uniform1f(loc.u_dark, colors.dark);
	gl.uniform2f(loc.u_col, colX(), colHalf());
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function start() {
	const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
	gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
	if (!gl) {
		console.warn('Rose Window: WebGL is not available, so the window is not drawn.');
		return;
	}
	canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); program = null; });
	canvas.addEventListener('webglcontextrestored', () => {
		try { setup(); } catch (err) { console.error('Rose Window:', err.message); }
	});
	try {
		setup();
		requestAnimationFrame(frame);
	} catch (err) {
		console.error('Rose Window:', err.message);
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
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.target = 1;
			break;
	}
};
