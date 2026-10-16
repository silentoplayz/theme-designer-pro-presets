/**
 * Title: Voronoi Prism (WebGL)
 * Description: Two layers of drifting stained-glass Voronoi cells tinted with your theme's accents, fading behind the chat, with edges that flare under the cursor.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const CELLS         = 5;     // cells across the screen's height; higher is smaller glass (2-12)
const MOTION        = 1;     // how fast the seeds orbit; 0 holds the glass still (0-3)
const REDUCED_SPEED = 0.15;  // share of the motion kept when the viewer asks to reduce motion (0-1)
const CELL_FILL     = 0.6;   // how strongly the cell glass is tinted (0-1)
const EDGE_WIDTH    = 1.2;   // thickness of the leading between cells (0.4-3)
const EDGE_GLOW     = 0.8;   // brightness of the leading and its glow (0-1.5)
const DEPTH_LAYER   = 0.45;  // strength of the larger, slower layer behind (0-1)
const HUE_DRIFT     = 1;     // how quickly each cell's tint wanders between the accents (0-3)
const CENTER_CALM   = 0.8;   // how much the glass fades behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const FLASHLIGHT    = 1;     // how much the cursor brightens cells and flares edges (0-2)
const FLASH_RADIUS  = 260;   // reach of the cursor's light, in px (80-600)
const RENDER_SCALE  = 0.75;  // resolution of the glass relative to the screen (0.4-1)
const MAX_FPS       = 30;    // frame cap; the glass moves slowly (15-60)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const COLOR_A       = '#5fb8e8';  // first glass tint when not following the theme
const COLOR_B       = '#b06ce0';  // second glass tint
const COLOR_C       = '#e8a24f';  // third glass tint
const EDGE_COLOR    = '#8c95b0';  // leading color
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
	'uniform vec3 u_edge;',
	'uniform vec3 u_core;',
	'uniform float u_dark;',
	'uniform vec2 u_col;',
	'vec2 hash2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }',
	'float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }',
	// x: nearest distance, y: second nearest, z: cell id, w: distance to the seed
	'vec4 voronoi(vec2 p, float t) {',
	'	vec2 ip = floor(p), fp = fract(p);',
	'	float d1 = 8.0, d2 = 8.0, id = 0.0;',
	'	for (int j = -1; j <= 1; j++) {',
	'		for (int i = -1; i <= 1; i++) {',
	'			vec2 nb = vec2(float(i), float(j));',
	'			vec2 o = hash2(ip + nb);',
	'			vec2 orbit = 0.32 * vec2(sin(t * (0.8 + o.x * 0.6) + o.y * 6.2831), cos(t * (0.6 + o.y * 0.8) + o.x * 6.2831));',
	'			vec2 s = nb + 0.5 + (o - 0.5) * 0.5 + orbit - fp;',
	'			float d = dot(s, s);',
	'			if (d < d1) { d2 = d1; d1 = d; id = hash(ip + nb); }',
	'			else if (d < d2) { d2 = d; }',
	'		}',
	'	}',
	'	d1 = sqrt(d1);',
	'	return vec4(d1, sqrt(d2), id, d1);',
	'}',
	// A cyclic blend through the three accents, so each pane's tint wanders smoothly
	'vec3 tint(float h) {',
	'	h = fract(h) * 3.0;',
	'	if (h < 1.0) return mix(u_c1, u_c2, smoothstep(0.0, 1.0, h));',
	'	if (h < 2.0) return mix(u_c2, u_c3, smoothstep(1.0, 2.0, h));',
	'	return mix(u_c3, u_c1, smoothstep(2.0, 3.0, h));',
	'}',
	'void main() {',
	'	vec2 px = gl_FragCoord.xy / u_scale;',
	'	vec2 res = u_res / u_scale;',
	'	float t = u_time;',
	'	vec2 m = vec2(u_mouse.x, res.y - u_mouse.y);',
	'	float flash = u_mouse.z * ' + FLASHLIGHT.toFixed(3) + ' * smoothstep(' + FLASH_RADIUS.toFixed(1) + ', 0.0, length(px - m));',
	'	vec2 uv = px / res.y * ' + CELLS.toFixed(3) + ';',
	'	float ew = 0.022 * ' + EDGE_WIDTH.toFixed(3) + ' * (1.0 + flash * 1.2);',
	// Front layer: tinted panes with faceted shading and glowing leading
	'	vec4 v = voronoi(uv, t);',
	'	float gap = v.y - v.x;',
	'	float lead = 1.0 - smoothstep(ew * 0.4, ew, gap);',
	'	float halo = exp(-gap / (ew * 3.5)) * (1.0 - lead);',
	'	float hue = v.z + t * 0.05 * ' + HUE_DRIFT.toFixed(3) + ';',
	'	vec3 pane = tint(hue);',
	'	float facet = 0.35 + 0.65 * smoothstep(0.75, 0.0, v.w);',
	'	float shimmer = 0.75 + 0.25 * sin(v.z * 17.3 + t * 0.6);',
	'	float paneA = ' + CELL_FILL.toFixed(3) + ' * 0.5 * facet * shimmer * (1.0 + flash * 1.2) * mix(1.5, 1.0, u_dark);',
	'	vec3 leadCol = mix(u_edge, tint(hue + 0.33), 0.5);',
	'	leadCol = mix(leadCol, u_core, flash * 0.6 * u_dark);',
	'	float leadA = ' + EDGE_GLOW.toFixed(3) + ' * (lead * 0.7 + halo * 0.22) * (1.0 + flash * 1.5);',
	// Back layer: larger, slower panes for depth
	'	vec4 b = voronoi(uv * 0.42 + vec2(17.3, 5.1), t * 0.6);',
	'	float gap2 = b.y - b.x;',
	'	float lead2 = 1.0 - smoothstep(ew * 0.3, ew * 0.9, gap2);',
	'	vec3 pane2 = tint(b.z + 0.5 + t * 0.03 * ' + HUE_DRIFT.toFixed(3) + ');',
	'	float back = ' + DEPTH_LAYER.toFixed(3) + ';',
	'	float pane2A = back * 0.22 * (0.5 + 0.5 * smoothstep(0.9, 0.0, b.w));',
	'	float lead2A = back * lead2 * 0.3 * ' + EDGE_GLOW.toFixed(3) + ';',
	// Fade behind the chat column (center and half-width in u_col), gather away from it
	'	float band = abs(px.x - u_col.x) / u_col.y;',
	'	float calm = 1.0 - ' + CENTER_CALM.toFixed(3) + ' * (1.0 - smoothstep(0.55, 1.25, band));',
	'	float edgeBias = 0.65 + 0.35 * smoothstep(0.15, 0.7, length((px - vec2(u_col.x, res.y * 0.5)) / res));',
	'	float k = calm * edgeBias * mix(0.8, 1.0, u_dark);',
	// Premultiplied composite: back layer, panes, then leading on top
	'	vec3 col = pane2 * pane2A + u_edge * lead2A;',
	'	float a = pane2A + lead2A * (1.0 - pane2A);',
	'	col = pane * paneA + col * (1.0 - paneA);',
	'	a = paneA + a * (1.0 - paneA);',
	'	leadA = clamp(leadA, 0.0, 0.9);',
	'	col = leadCol * leadA + col * (1.0 - leadA);',
	'	a = leadA + a * (1.0 - leadA);',
	'	a = clamp(a * k, 0.0, 1.0);',
	'	col *= k;',
	'	gl_FragColor = vec4(min(col, vec3(a)), a);',
	'}',
].join('\n');

let canvas, gl, program, buffer;
let loc = {};
let w = 0, h = 0, dpr = 1;
let last = 0, time = 0, reduced = false, column = null;
const mouse = { x: -10000, y: -10000, amount: 0, target: 0 };
const colors = { c1: hexToRgb(COLOR_A), c2: hexToRgb(COLOR_B), c3: hexToRgb(COLOR_C), edge: hexToRgb(EDGE_COLOR), core: [0.92, 0.95, 1], dark: 1 };

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
	colors.edge = t.rgb.muted;
	colors.core = t.rgb.text;
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
	['u_res', 'u_scale', 'u_time', 'u_mouse', 'u_c1', 'u_c2', 'u_c3', 'u_edge', 'u_core', 'u_dark', 'u_col'].forEach((name) => {
		loc[name] = gl.getUniformLocation(program, name);
	});
	gl.disable(gl.BLEND);
	size();
}

// The leading is line art, so a dense screen gets more pixels, never past full size
// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }

function size() {
	const scale = Math.min(1, RENDER_SCALE * Math.min(dpr, 2));
	canvas.width = Math.max(1, Math.round(w * scale));
	canvas.height = Math.max(1, Math.round(h * scale));
	if (gl && !gl.isContextLost()) gl.viewport(0, 0, canvas.width, canvas.height);
}

function frame(now) {
	requestAnimationFrame(frame);
	if (!program || gl.isContextLost()) return;
	if (last && now - last < 1000 / MAX_FPS - 2) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	time = (time + dt * 0.25 * MOTION * (reduced ? REDUCED_SPEED : 1)) % 3000;
	mouse.target = Math.max(0, mouse.target - dt * 0.35);
	mouse.amount += (mouse.target - mouse.amount) * Math.min(1, dt * (reduced ? 1.5 : 4));
	gl.uniform2f(loc.u_res, canvas.width, canvas.height);
	gl.uniform1f(loc.u_scale, canvas.width / Math.max(1, w));
	gl.uniform1f(loc.u_time, time);
	gl.uniform3f(loc.u_mouse, mouse.x, mouse.y, mouse.amount);
	gl.uniform3fv(loc.u_c1, colors.c1);
	gl.uniform3fv(loc.u_c2, colors.c2);
	gl.uniform3fv(loc.u_c3, colors.c3);
	gl.uniform3fv(loc.u_edge, colors.edge);
	gl.uniform3fv(loc.u_core, colors.core);
	gl.uniform1f(loc.u_dark, colors.dark);
	gl.uniform2f(loc.u_col, colX(), colHalf());
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function start() {
	const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
	gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
	if (!gl) {
		console.warn('Voronoi Prism: WebGL is not available, so the glass is not drawn.');
		return;
	}
	canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); program = null; });
	canvas.addEventListener('webglcontextrestored', () => {
		try { setup(); } catch (err) { console.error('Voronoi Prism:', err.message); }
	});
	try {
		setup();
		requestAnimationFrame(frame);
	} catch (err) {
		console.error('Voronoi Prism:', err.message);
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
			dpr = d.dpr || 1;
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
