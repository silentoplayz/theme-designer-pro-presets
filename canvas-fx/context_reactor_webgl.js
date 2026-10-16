/**
 * Title: Context Reactor (WebGL)
 * Description: A plasma core in the lower corner that heats with your conversation's context fill, idles dim on a new chat and throws warm warning flares past 85%.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const MAX_TOKENS    = 128000; // your model's context limit, in tokens (4000-2000000)
const GROWTH_SPEED  = 1;      // multiplies the fill, for previewing; 1 is true to the chat (1-50)
const SMOOTHING     = 1.2;    // how quickly the core eases toward a new fill, per second (0.1-5)
const TURBULENCE    = 1.4;    // how violently the plasma swirls when the context is full (0.2-3)
const MOTION        = 1;      // speed of the plasma; 0 holds it still (0-2)
const REDUCED_SPEED = 0.15;   // share of the motion kept when the viewer asks to reduce motion (0-1)
const CORE_X        = 0.84;   // horizontal position of the core, as a share of the width (0-1)
const CORE_Y        = 0.8;    // vertical position of the core, as a share of the height (0-1)
const CORE_SIZE     = 0.42;   // reach of the plasma, as a share of the screen's height (0.15-0.9)
const INTENSITY     = 0.9;    // overall brightness of the reactor (0-1)
const CENTER_CALM   = 0.85;   // how much the plasma fades behind the chat column (0-1)
const BAND_WIDTH    = 520;    // half-width of the calm band around the chat column, in px (300-900)
const CURSOR_GLOW   = 0.6;    // soft plasma bloom that follows the cursor and fades when it stops (0-1)
const RENDER_SCALE  = 0.5;    // resolution of the plasma; it is soft, so half is plenty (0.25-1)
const MAX_FPS       = 30;     // frame cap (15-60)
const FOLLOW_THEME  = true;   // take the colors from the theme's palette
const COLOR_COOL    = '#1f6be6';  // idle plasma color when not following the theme
const COLOR_WARM    = '#ff9a26';  // half-full plasma color
const COLOR_HOT     = '#ff2a3d';  // warning flare color
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
	'uniform float u_ctx;',
	'uniform vec3 u_mouse;',
	'uniform vec3 u_cool;',
	'uniform vec3 u_warm;',
	'uniform vec3 u_hot;',
	'uniform vec3 u_core;',
	'uniform float u_dark;',
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
	'	float ctx = u_ctx;',
	'	float reach = res.y * ' + CORE_SIZE.toFixed(3) + ' * (0.75 + 0.45 * ctx);',
	// On narrow screens the core slides outward so it stays clear of the chat column
	'	float cx = ' + CORE_X.toFixed(3) + ' * res.x;',
	'	cx = cx > res.x * 0.5 ? min(max(cx, res.x * 0.5 + ' + (BAND_WIDTH * 0.85).toFixed(1) + '), res.x - reach * 0.3) : max(min(cx, res.x * 0.5 - ' + (BAND_WIDTH * 0.85).toFixed(1) + '), reach * 0.3);',
	'	vec2 c = vec2(cx, (1.0 - ' + CORE_Y.toFixed(3) + ') * res.y);',
	'	vec2 rel = (px - c) / reach;',
	'	float d = length(rel);',
	// Domain-warped plasma that swirls harder as the context fills, flowing outward from the core
	'	float warpK = mix(0.15, ' + TURBULENCE.toFixed(3) + ', ctx);',
	'	float spin = t * 0.12 + 0.5 / (d + 0.35) * (0.6 + ctx);',
	'	vec2 p = mat2(cos(spin), sin(spin), -sin(spin), cos(spin)) * rel * 1.6;',
	'	vec2 q = vec2(fbm(p + vec2(0.0, t * 0.1)), fbm(p + vec2(5.2, 1.3) - t * 0.1));',
	'	float n = fbm((p + warpK * q) * 1.5);',
	'	float fall = exp(-d * 1.9);',
	'	float energy = (n * (1.3 + ctx * 0.6) + ctx * 0.12) * fall;',
	'	float fil = pow(max(n, 0.0), 3.0) * (0.5 + ctx) * exp(-d * 1.1);',
	// Heat ramp: cool, then warm at half, then hot as it nears full
	'	vec3 heat = mix(u_cool, u_warm, smoothstep(0.0, 0.5, ctx));',
	'	heat = mix(heat, u_hot, smoothstep(0.5, 1.0, ctx));',
	'	vec3 col = heat * (energy + fil * 0.8);',
	// The core itself, brighter and quicker to pulse with context
	'	float pulse = 0.7 + 0.3 * sin(t * mix(0.6, 3.2, ctx) * 2.0);',
	'	float core = smoothstep(0.38, 0.0, d) * (0.45 + ctx * 0.55) * pulse;',
	'	vec3 coreCol = mix(mix(u_warm, u_hot, ctx), u_core, 0.45 * u_dark);',
	'	col += coreCol * core * 0.7;',
	// A containment ring that wobbles with the plasma and brightens as it heats
	'	float ring = exp(-abs(d - 0.3 - (n - 0.5) * 0.06) * 60.0) * (0.6 + 0.4 * ctx);',
	'	col += mix(heat, coreCol, 0.4) * ring * 0.45;',
	// Warning flares past 85%, licking outward in the warm color
	'	float warn = smoothstep(0.85, 1.0, ctx);',
	'	float flare = smoothstep(0.5, 0.0, abs(fbm(rel * 2.5 + t * 0.3) - 0.5)) * exp(-d * 1.6);',
	'	col += u_hot * warn * flare * (0.55 + 0.45 * sin(t * 4.0 + n * 10.0)) * 0.7;',
	// A soft bloom where the cursor last moved
	'	vec2 m = vec2(u_mouse.x, res.y - u_mouse.y);',
	'	float bloom = u_mouse.z * ' + CURSOR_GLOW.toFixed(3) + ' * exp(-length(px - m) / 110.0) * 0.35;',
	'	col += mix(u_warm, u_cool, ctx) * bloom;',
	// Dim when idle, full when the context is full; quiet behind the chat column
	'	float band = abs(px.x - res.x * 0.5) / ' + BAND_WIDTH.toFixed(1) + ';',
	'	float calm = 1.0 - ' + CENTER_CALM.toFixed(3) + ' * (1.0 - smoothstep(0.55, 1.25, band));',
	'	col *= mix(0.35, 1.25, ctx) * 1.6 * calm * ' + INTENSITY.toFixed(3) + ';',
	'	float a;',
	'	if (u_dark > 0.5) {',
	'		a = clamp(max(col.r, max(col.g, col.b)) * 1.1, 0.0, 0.95);',
	'	} else {',
	// On light themes the plasma reads as colored ink rather than light
	'		float lum = max(col.r, max(col.g, col.b));',
	'		a = (1.0 - exp(-lum * 2.4)) * 0.6;',
	'		col = mix(heat, coreCol, min(1.0, core + ring)) * 0.85 * a;',
	'	}',
	'	gl_FragColor = vec4(min(col, vec3(a)), a);',
	'}',
].join('\n');

let canvas, gl, program, buffer;
let loc = {};
let w = 0, h = 0;
let last = 0, time = 0, reduced = false;
let target = 0, fill = 0;
const mouse = { x: -10000, y: -10000, amount: 0, target: 0 };
const colors = { cool: hexToRgb(COLOR_COOL), warm: hexToRgb(COLOR_WARM), hot: hexToRgb(COLOR_HOT), core: [1, 0.96, 0.9], dark: 1 };

function hexToRgb(hex) {
	const n = parseInt(hex.slice(1), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// The warning hue leans toward a warm orange-red whatever the theme, darker on light themes so it reads on white
function applyTheme(t) {
	if (!t) return;
	colors.dark = t.dark === false ? 0 : 1;
	if (!FOLLOW_THEME || !t.rgb) return;
	const warmth = colors.dark ? [1, 0.38, 0.22] : [0.82, 0.24, 0.1];
	colors.cool = t.rgb.accent3;
	colors.warm = t.rgb.accent2;
	colors.hot = [0, 1, 2].map((i) => t.rgb.accent2[i] * 0.3 + warmth[i] * 0.7);
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
	['u_res', 'u_scale', 'u_time', 'u_ctx', 'u_mouse', 'u_cool', 'u_warm', 'u_hot', 'u_core', 'u_dark'].forEach((name) => {
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
	time = (time + dt * MOTION * (reduced ? REDUCED_SPEED : 1)) % 2000;
	fill += (target - fill) * (1 - Math.exp(-dt * SMOOTHING));
	mouse.target = Math.max(0, mouse.target - dt * 0.4);
	mouse.amount += (mouse.target - mouse.amount) * Math.min(1, dt * (reduced ? 1 : 3));
	gl.uniform2f(loc.u_res, canvas.width, canvas.height);
	gl.uniform1f(loc.u_scale, canvas.width / Math.max(1, w));
	gl.uniform1f(loc.u_time, time);
	gl.uniform1f(loc.u_ctx, fill);
	gl.uniform3f(loc.u_mouse, mouse.x, mouse.y, mouse.amount);
	gl.uniform3fv(loc.u_cool, colors.cool);
	gl.uniform3fv(loc.u_warm, colors.warm);
	gl.uniform3fv(loc.u_hot, colors.hot);
	gl.uniform3fv(loc.u_core, colors.core);
	gl.uniform1f(loc.u_dark, colors.dark);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function start() {
	const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
	gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
	if (!gl) {
		console.warn('Context Reactor: WebGL is not available, so the reactor is not drawn.');
		return;
	}
	canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); program = null; });
	canvas.addEventListener('webglcontextrestored', () => {
		try { setup(); } catch (err) { console.error('Context Reactor:', err.message); }
	});
	try {
		setup();
		requestAnimationFrame(frame);
	} catch (err) {
		console.error('Context Reactor:', err.message);
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
		case 'context': {
			// Prefer the exact count; a new, empty chat cools the core back to idle
			const tokens = d.exactTokens != null ? d.exactTokens : (d.estimatedTokens || 0);
			target = d.messages === 0 ? 0 : Math.min(1, (tokens / MAX_TOKENS) * GROWTH_SPEED);
			break;
		}
	}
};
