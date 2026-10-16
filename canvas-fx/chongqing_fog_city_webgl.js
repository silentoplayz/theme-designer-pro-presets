/**
 * Title: Chongqing Fog City (WebGL)
 * Description: Layered neon towers of a river city drift past in river mist and mirror onto rippling water, dipping and dimming behind the chat while the cursor turns your head.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const PAN_SPEED       = 1;     // how fast the skyline drifts sideways; 0 holds it still (0-3)
const MOTION          = 1;     // speed of the mist, ripples and window flicker (0-2)
const REDUCED_SPEED   = 0.15;  // share of the motion kept when the viewer asks to reduce motion (0-1)
const FOG_DENSITY     = 1;     // river-mist thickness (0-2)
const NEON_BRIGHTNESS = 1;     // glow of the lit windows and signs (0-2)
const WINDOW_DENSITY  = 0.45;  // share of windows that are lit (0-1)
const CITY_HEIGHT     = 1;     // how tall the towers climb (0.5-1.5)
const WATERLINE       = 0.22;  // height of the river's edge, as a share of the screen (0.1-0.4)
const LOOK_AROUND     = 1;     // how far the layers shift as the cursor moves (0-2)
const CENTER_CALM     = 0.8;   // how much the city dips and dims behind the chat column (0-1)
const BAND_WIDTH      = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const RENDER_SCALE    = 0.75;  // resolution of the scene; windows stay crisp at 0.75 (0.35-1)
const MAX_FPS         = 30;    // frame cap; the city moves slowly (15-60)
const FOLLOW_THEME    = true;  // take the colors from the theme's palette
const COLOR_AMBER     = '#ffb857';  // main window color when not following the theme
const COLOR_CYAN      = '#40e6ff';  // second window color
const COLOR_MAGENTA   = '#ff3d80';  // sign and lantern color
const COLOR_HAZE      = '#8a4a6a';  // fog color, where the neon bleeds into the mist
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
	'uniform float u_pan[5];',
	'uniform vec2 u_look;',
	'uniform vec3 u_c1;',
	'uniform vec3 u_c2;',
	'uniform vec3 u_c3;',
	'uniform vec3 u_haze;',
	'uniform vec3 u_body;',
	'uniform float u_dark;',
	'uniform vec2 u_col;',
	'const float H = ' + WATERLINE.toFixed(3) + ';',
	'float h11(float n) { return fract(sin(mod(n, 1024.0) * 12.9898) * 43758.5453); }',
	'float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
	'float noise(vec2 p) {',
	'	vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);',
	'	return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);',
	'}',
	'float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }',
	'vec3 winColor(float k) { return k < 0.5 ? u_c1 : (k < 0.75 ? u_c2 : (k < 0.92 ? u_c3 : mix(u_c2, vec3(1.0), 0.4))); }',
	'vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }',
	// The skyline at point p (in screen heights), premultiplied; calm dims it, dip lowers it
	'vec4 city(vec2 p, float calm, float fog) {',
	'	vec2 colH = u_col / (u_res.y / u_scale);',
	'	float sy = max(p.y - H, 0.0);',
	'	float g = exp(-sy * 3.5) * (0.14 + 0.10 * fog) * mix(0.55, 1.0, calm) * mix(0.6, 1.0, u_dark);',
	'	vec4 acc = vec4(u_haze * g, g) * step(H, p.y);',
	'	for (int i = 0; i < 5; i++) {',
	'		float fi = float(i), depth = fi / 4.0;',
	'		float scale = mix(6.5, 2.3, depth);',
	'		float off = u_pan[i] + u_look.x * (0.4 + depth * 1.4) + fi * 17.0;',
	'		float wx = p.x * scale + off;',
	'		float ci = floor(wx), f = fract(wx);',
	'		float rnd = h11(ci + fi * 57.0), rw = h11(ci * 1.73 + fi * 23.0);',
	'		float bandB = abs((ci + 0.5 - off) / scale - colH.x) / colH.y;',
	'		float dip = 1.0 - 0.5 * ' + CENTER_CALM.toFixed(3) + ' * (1.0 - smoothstep(0.4, 1.2, bandB));',
	'		float topH = (mix(0.20, 0.30, depth) + rnd * mix(0.12, 0.34, depth)) * ' + CITY_HEIGHT.toFixed(3) + ' * dip;',
	'		float wB = 0.70 + rw * 0.22, edge = (1.0 - wB) * 0.5;',
	'		float aa = scale / (u_res.y / u_scale);',
	'		float inB = smoothstep(edge - aa, edge, f) * smoothstep(1.0 - edge + aa, 1.0 - edge, f) * step(H, p.y) * smoothstep(H + topH + 0.002, H + topH, p.y);',
	'		float lx = (f - edge) / wB, ly = p.y - H;',
	'		float wCols = floor(5.0 + rw * 6.0), rowH = mix(0.011, 0.016, depth);',
	'		vec2 cell = vec2(floor(lx * wCols), floor(ly / rowH));',
	'		vec2 wf = vec2(fract(lx * wCols), fract(ly / rowH));',
	'		float frame = step(0.22, wf.x) * step(wf.x, 0.78) * step(0.3, wf.y) * step(wf.y, 0.78) * step(ly, topH - 0.012);',
	'		float seed = h21(cell + vec2(mod(ci, 1024.0) * 7.0, fi * 11.0));',
	'		float lit = step(mix(0.80, 0.25, ' + WINDOW_DENSITY.toFixed(3) + '), seed);',
	'		float flick = 0.78 + 0.22 * step(0.5, h21(cell + floor(u_time * (0.12 + seed * 0.3))));',
	'		float emit = lit * frame * flick * (0.45 + 0.55 * h21(cell + 3.7)) * (0.35 + depth * 0.65) * ' + NEON_BRIGHTNESS.toFixed(3) + ' * mix(0.75, 1.0, u_dark);',
	'		float sg = step(0.62, rnd) * step(0.5, depth) * step(0.06, lx) * step(lx, 0.12) * step(0.08, ly) * step(ly, topH * 0.7);',
	'		emit = max(emit, sg * (0.55 + 0.35 * sin(u_time * 0.8 + rnd * 20.0)) * ' + NEON_BRIGHTNESS.toFixed(3) + ');',
	'		vec3 wc = sg > 0.5 ? mix(u_c2, u_c3, step(0.8, rnd)) : winColor(h11(cell.x + cell.y * 3.1 + ci));',
	'		float haze = (1.0 - depth) * (0.35 + 0.3 * fog);',
	'		vec3 body = mix(u_body, u_haze, haze * mix(0.6, 0.15, u_dark));',
	'		float rise = mix(smoothstep(-0.02, 0.16 + 0.08 * fog, ly), 1.0, depth * 0.55);',
	'		float ba = mix(mix(0.22, 0.80, depth), mix(0.10, 0.38, depth), 1.0 - u_dark) * inB * calm * mix(0.35, 1.0, rise);',
	'		float we = emit * inB * calm * calm * mix(1.0 - haze * 0.6, 1.0, depth);',
	'		acc = over(vec4(body * ba + wc * we, max(ba, we)), acc);',
	'		if (i == 2) {',
	'			float mist = fbm(vec2(p.x * 2.4 - u_time * 0.04, p.y * 3.2 + u_time * 0.015));',
	'			float ma = smoothstep(0.35, 0.8, mist) * exp(-abs(p.y - H - 0.06) * 6.0) * 0.45 * fog * mix(0.4, 1.0, calm) * step(H, p.y);',
	'			ma *= mix(0.55, 1.0, u_dark);',
	'			acc = over(vec4(u_haze * ma, ma), acc);',
	'		}',
	'	}',
	'	return acc;',
	'}',
	'void main() {',
	'	vec2 px = gl_FragCoord.xy / u_scale;',
	'	vec2 res = u_res / u_scale;',
	'	vec2 p = px / res.y;',
	'	p.y += u_look.y * 0.02;',
	'	float fog = ' + FOG_DENSITY.toFixed(3) + ';',
	'	float band = abs(px.x - u_col.x) / u_col.y;',
	'	float near = 1.0 - smoothstep(0.5, 1.3, band);',
	'	float calm = 1.0 - ' + CENTER_CALM.toFixed(3) + ' * near;',
	'	vec4 col;',
	'	if (p.y >= H) {',
	'		col = city(p, calm, fog);',
	'	} else {',
	'		float d = H - p.y;',
	'		vec2 rp = vec2(p.x + sin(p.y * 42.0 + u_time * 1.6) * 0.004 * (1.0 + d * 3.0) + sin(p.y * 11.0 - u_time * 0.7) * 0.01 * d, H + d * 1.1);',
	'		float glint = smoothstep(0.45, 0.9, noise(vec2(p.x * 40.0, p.y * 150.0 - u_time * 1.2)));',
	'		vec4 refl = city(rp, calm, fog) * exp(-d * 5.0) * mix(0.5, 0.7, u_dark) * (0.6 + 0.8 * glint);',
	'		float wa = mix(0.06, 0.32, u_dark) * smoothstep(0.0, 0.05, d) * mix(0.35, 1.0, calm) * smoothstep(0.0, 0.18, p.y + 0.06);',
	'		col = over(refl, vec4(u_body * wa, wa));',
	'	}',
	'	col.a = clamp(col.a, 0.0, 1.0);',
	'	gl_FragColor = vec4(min(col.rgb, vec3(col.a)), col.a);',
	'}',
].join('\n');

let canvas, gl, program, buffer;
const loc = {};
let w = 0, h = 0, dpr = 1;
let last = 0, time = 0, reduced = false, column = null;
const pans = new Float32Array(5);
const mouse = { x: -10000, y: -10000, amount: 0, target: 0, lx: 0, ly: 0 };
const colors = { c1: hexToRgb(COLOR_AMBER), c2: hexToRgb(COLOR_CYAN), c3: hexToRgb(COLOR_MAGENTA), haze: hexToRgb(COLOR_HAZE), body: [0.02, 0.02, 0.035], dark: 1 };

function hexToRgb(hex) {
	const n = parseInt(hex.slice(1), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mix3(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }

// Windows in the accents, towers in the theme's structure color, fog between muted and accent2
function applyTheme(t) {
	if (t) colors.dark = t.dark === false ? 0 : 1;
	const own = !FOLLOW_THEME || !t || !t.rgb;
	if (own) {
		colors.c1 = hexToRgb(COLOR_AMBER);
		colors.c2 = hexToRgb(COLOR_CYAN);
		colors.c3 = hexToRgb(COLOR_MAGENTA);
		colors.haze = colors.dark ? hexToRgb(COLOR_HAZE) : [0.96, 0.95, 0.96];
		colors.body = colors.dark ? [0.02, 0.02, 0.035] : [0.36, 0.38, 0.44];
		return;
	}
	colors.c1 = t.rgb.accent;
	colors.c2 = t.rgb.accent3;
	colors.c3 = t.rgb.accent2;
	colors.haze = colors.dark ? mix3(t.rgb.muted, t.rgb.accent2, 0.35) : mix3(t.rgb.background, [1, 1, 1], 0.5);
	colors.body = colors.dark ? mix3(t.rgb.background, [0, 0, 0], 0.75) : t.rgb.muted;
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
	['u_res', 'u_scale', 'u_time', 'u_pan', 'u_look', 'u_c1', 'u_c2', 'u_c3', 'u_haze', 'u_body', 'u_dark', 'u_col'].forEach((name) => {
		loc[name] = gl.getUniformLocation(program, name);
	});
	gl.disable(gl.BLEND);
	size();
}

// Window grids are line art, so the scene follows the pixel ratio up to 2
function size() {
	const s = RENDER_SCALE * Math.min(dpr, 2);
	canvas.width = Math.max(1, Math.round(w * s));
	canvas.height = Math.max(1, Math.round(h * s));
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
	const k = reduced ? REDUCED_SPEED : 1;
	time = (time + dt * MOTION * k) % 3000;
	for (let i = 0; i < 5; i++) pans[i] = (pans[i] + dt * PAN_SPEED * k * (0.015 + i * 0.02)) % 1024;
	// The head turn eases toward the cursor, then drifts back once it rests
	mouse.target = Math.max(0, mouse.target - dt * 0.35);
	mouse.amount += (mouse.target - mouse.amount) * Math.min(1, dt * 2);
	const tx = w ? (mouse.x / w - 0.5) * mouse.amount * LOOK_AROUND : 0;
	const ty = h ? (0.5 - mouse.y / h) * mouse.amount * LOOK_AROUND : 0;
	const ease = Math.min(1, dt * (reduced ? 0.6 : 2.5));
	mouse.lx += (tx - mouse.lx) * ease;
	mouse.ly += (ty - mouse.ly) * ease;
	gl.uniform2f(loc.u_res, canvas.width, canvas.height);
	gl.uniform1f(loc.u_scale, canvas.width / Math.max(1, w));
	gl.uniform1f(loc.u_time, time);
	gl.uniform1fv(loc.u_pan, pans);
	gl.uniform2f(loc.u_look, mouse.lx, mouse.ly);
	gl.uniform3fv(loc.u_c1, colors.c1);
	gl.uniform3fv(loc.u_c2, colors.c2);
	gl.uniform3fv(loc.u_c3, colors.c3);
	gl.uniform3fv(loc.u_haze, colors.haze);
	gl.uniform3fv(loc.u_body, colors.body);
	gl.uniform1f(loc.u_dark, colors.dark);
	gl.uniform2f(loc.u_col, colX(), colHalf());
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function start() {
	const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
	gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
	if (!gl) {
		console.warn('Chongqing Fog City: WebGL is not available, so the city is not drawn.');
		return;
	}
	canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); program = null; });
	canvas.addEventListener('webglcontextrestored', () => {
		try { setup(); } catch (err) { console.error('Chongqing Fog City:', err.message); }
	});
	try {
		setup();
		requestAnimationFrame(frame);
	} catch (err) {
		console.error('Chongqing Fog City:', err.message);
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
			for (let i = 0; i < 5; i++) pans[i] = Math.random() * 1024;
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
