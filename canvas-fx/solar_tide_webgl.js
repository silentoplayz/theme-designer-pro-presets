/**
 * Title: Solar Tide (WebGL)
 * Description: A sun and moon follow your local time along an arc in the margin beside the chat, laying a glitter path on a calm sea below, with dawn and dusk glow on the horizon and stars at night.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const PREVIEW_CYCLE = 0;     // seconds for a full day as a preview; 0 follows your real local time (0-600)
const MOTION        = 1;     // speed of the swell and the glitter (0-2)
const REDUCED_SPEED = 0.15;  // share of the motion kept when the viewer asks to reduce motion (0-1)
const WAVE_DETAIL   = 1;     // choppiness of the swell and the glitter path (0-2)
const HORIZON       = 0.3;   // height of the horizon, as a share of the screen (0.15-0.45)
const SUN_SIZE      = 1;     // size of the sun and moon (0.5-2)
const GLITTER       = 1;     // brightness of the light path on the water (0-2)
const SEA_TINT      = 1;     // how strongly the sea is tinted (0-2)
const STARS         = 0.6;   // stars at night, dark themes only (0-1)
const CENTER_CALM   = 0.8;   // how much the sea and glow fade behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const RENDER_SCALE  = 0.6;   // resolution of the scene; it is soft, so 0.6 is plenty (0.3-1)
const MAX_FPS       = 30;    // frame cap; the tide moves slowly (15-60)
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
	'uniform vec3 u_sun;',
	'uniform vec3 u_moon;',
	'uniform vec3 u_src;',
	'uniform vec4 u_sky;',
	'uniform vec3 u_sunCol;',
	'uniform vec3 u_twiCol;',
	'uniform vec3 u_hazeCol;',
	'uniform vec3 u_seaCol;',
	'uniform vec3 u_moonCol;',
	'uniform float u_dark;',
	'uniform vec2 u_col;',
	'float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
	'float noise(vec2 p) {',
	'	vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);',
	'	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
	'}',
	'float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; } return v; }',
	'vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }',
	'void main() {',
	'	vec2 px = gl_FragCoord.xy / u_scale;',
	'	vec2 res = u_res / u_scale;',
	'	float t = u_time, day = u_sky.x, twi = u_sky.y, hy = u_sky.z, wd = ' + WAVE_DETAIL.toFixed(3) + ';',
	'	float band = abs(px.x - u_col.x) / u_col.y;',
	'	float calm = 1.0 - ' + CENTER_CALM.toFixed(3) + ' * (1.0 - smoothstep(0.55, 1.25, band));',
	'	float side = exp(-abs(px.x - u_src.x) / (res.y * 0.45));',
	'	float lift = mix(0.6, 1.0, u_dark);',
	'	vec4 o = vec4(0.0);',
	'	if (px.y >= hy) {',
	'		float g = (px.y - hy) / max(1.0, res.y - hy);',
	'		float ha = exp(-g * 4.5) * (0.08 * day + 0.32 * twi) * (0.25 + 0.75 * side) * mix(0.35, 1.0, calm) * lift;',
	'		o = vec4(mix(u_hazeCol, u_twiCol, clamp(twi * 1.5, 0.0, 1.0)) * ha, ha);',
	'		vec2 cell = floor(px / 9.0);',
	'		float hs = hash(cell);',
	'		float star = step(1.0 - 0.01 * ' + STARS.toFixed(3) + ', hs) * smoothstep(1.6, 0.3, length(px - (cell + 0.5) * 9.0)) * (0.55 + 0.45 * sin(t * 1.3 + hs * 90.0)) * smoothstep(0.15, 0.5, g) * (1.0 - day) * u_dark * calm * 0.8;',
	'		o = over(vec4(vec3(star), star), o);',
	'		float sr = res.y * 0.032 * ' + SUN_SIZE.toFixed(3) + ';',
	'		float sd = length(px - u_sun.xy);',
	'		float sg = exp(-sd / (sr * 4.0)) * 0.5 * u_sun.z * lift;',
	'		float disk = smoothstep(sr + 1.5, sr - 1.5, sd) * u_sun.z * mix(0.8, 1.0, u_dark);',
	'		o = over(vec4(u_sunCol * sg, sg), o);',
	'		o = over(vec4(u_sunCol * disk, disk), o);',
	'		float md = length(px - u_moon.xy);',
	'		float mg = exp(-md / (sr * 3.0)) * 0.22 * u_moon.z * lift;',
	'		float crat = fbm((px - u_moon.xy) / sr * 2.5) * 0.25;',
	'		float mdisk = smoothstep(sr + 1.5, sr - 1.5, md) * u_moon.z * mix(0.7, 0.95, u_dark);',
	'		o = over(vec4(u_moonCol * mg, mg), o);',
	'		o = over(vec4(u_moonCol * (1.0 - crat) * mdisk, mdisk), o);',
	'	} else {',
	'		float depth = (hy - px.y) / max(1.0, hy);',
	'		float waveY = depth * 70.0;',
	'		float wav = sin(waveY * (1.0 + depth) - t * 1.5 + fbm(vec2(px.x / res.y * 8.0, depth * 40.0)) * 5.0 * wd);',
	'		float sa = (mix(0.10, 0.34, depth) + 0.035 * wav * calm) * mix(0.45, 1.0, u_dark) * ' + SEA_TINT.toFixed(3) + ' * mix(0.2, 1.0, calm);',
	'		sa *= smoothstep(0.0, 0.03, depth);',
	'		o = vec4(u_seaCol * sa, sa);',
	'		float rim = exp(-depth * 24.0) * twi * 0.4 * (0.3 + 0.7 * side) * mix(0.3, 1.0, calm) * lift;',
	'		o = over(vec4(u_twiCol * rim, rim), o);',
	'		float width = 10.0 + depth * res.y * 0.2;',
	'		float streak = exp(-pow((px.x - u_src.x) / width, 2.0));',
	'		float shimmer = 0.5 + 0.5 * sin(waveY * 2.2 - t * 3.0 + fbm(vec2(px.x / res.y * 14.0, depth * 60.0)) * 8.0 * wd);',
	'		float ga = streak * smoothstep(0.4, 1.0, shimmer) * u_src.y * (0.6 + twi * 0.6) * calm * ' + GLITTER.toFixed(3) + ' * mix(0.7, 1.0, u_dark);',
	'		vec3 gc = mix(u_sunCol, u_moonCol, u_src.z);',
	'		o = over(vec4(gc * ga, ga), o);',
	'	}',
	'	o = clamp(o, 0.0, 1.0);',
	'	gl_FragColor = vec4(min(o.rgb, vec3(o.a)), o.a);',
	'}',
].join('\n');

let canvas, gl, program, buffer;
const loc = {};
let w = 0, h = 0;
let last = 0, time = 0, clock = 0, hour = 12, recheck = 0, reduced = false, column = null, theme = null;
const sun = new Float32Array(3), moon = new Float32Array(3), src = new Float32Array(3), sky = new Float32Array(4);
const out = { sun: new Float32Array(3), twi: new Float32Array(3), haze: new Float32Array(3), sea: new Float32Array(3), moon: new Float32Array(3) };
// Each role has a night, a day and (for the sun) a low-sun color; the theme replaces them when followed
const base = {
	sunLow: [1, 0.45, 0.2], sunHigh: [1, 0.96, 0.88], twi: [1, 0.5, 0.35], haze: [0.6, 0.8, 1],
	seaNight: [0.01, 0.03, 0.08], seaDay: [0.04, 0.22, 0.3], moon: [0.9, 0.92, 0.98],
};
const pal = { sunLow: [0, 0, 0], sunHigh: [0, 0, 0], twi: [0, 0, 0], haze: [0, 0, 0], seaNight: [0, 0, 0], seaDay: [0, 0, 0], moon: [0, 0, 0], dark: 1 };

function mixInto(o, a, b, k) {
	o[0] = a[0] + (b[0] - a[0]) * k;
	o[1] = a[1] + (b[1] - a[1]) * k;
	o[2] = a[2] + (b[2] - a[2]) * k;
	return o;
}

// Low sun and dusk in accent2, daylight haze in accent3, the sea from accent toward the background
function applyTheme(t) {
	if (t) { theme = t; pal.dark = t.dark === false ? 0 : 1; }
	const dark = pal.dark === 1;
	const r = FOLLOW_THEME && theme && theme.rgb ? theme.rgb : null;
	const k = Object.keys(base);
	for (let i = 0; i < k.length; i++) mixInto(pal[k[i]], base[k[i]], base[k[i]], 0);
	if (r) {
		mixInto(pal.sunLow, r.accent2, r.accent2, 0);
		if (dark) mixInto(pal.sunHigh, r.accent, r.text, 0.6); else mixInto(pal.sunHigh, r.accent, r.accent2, 0.3);
		mixInto(pal.twi, r.accent2, r.accent, 0.2);
		mixInto(pal.haze, r.accent3, r.accent3, 0);
		mixInto(pal.seaNight, r.accent, r.background, dark ? 0.75 : 0.2);
		mixInto(pal.seaDay, r.accent3, r.background, dark ? 0.45 : 0.1);
		if (dark) mixInto(pal.moon, r.text, r.muted, 0.2); else mixInto(pal.moon, r.muted, r.text, 0.3);
	} else if (!dark) {
		mixInto(pal.sunHigh, base.sunLow, base.sunHigh, 0.4);
		mixInto(pal.moon, [0.45, 0.5, 0.6], base.moon, 0);
		mixInto(pal.seaNight, [0.1, 0.2, 0.35], base.moon, 0);
		mixInto(pal.seaDay, [0.1, 0.45, 0.55], base.moon, 0);
	}
}

// Reads the clock twice a minute and advances smoothly in between
function hourNow(dt) {
	if (PREVIEW_CYCLE > 0) return (clock / PREVIEW_CYCLE * 24) % 24;
	recheck -= dt;
	if (recheck <= 0) {
		const d = new Date();
		hour = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
		recheck = 30;
	} else {
		hour = (hour + dt / 3600) % 24;
	}
	return hour;
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
	['u_res', 'u_scale', 'u_time', 'u_sun', 'u_moon', 'u_src', 'u_sky', 'u_sunCol', 'u_twiCol', 'u_hazeCol', 'u_seaCol', 'u_moonCol', 'u_dark', 'u_col'].forEach((name) => {
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

// Sun and moon rise at the outer edge of the wider margin and set beside the chat column
function placeBodies(hour) {
	const left = colX() - colHalf(), right = w - colX() - colHalf();
	const onLeft = left >= right, room = Math.max(left, right, 120);
	const mid = onLeft ? room * 0.5 : w - room * 0.5, half = room * 0.38, dir = onLeft ? 1 : -1;
	const hy = h * HORIZON, arc = (h - hy) * 0.7;
	const sf = (hour - 6) / 12, sunH = Math.sin(sf * Math.PI);
	const mh = hour < 6 ? hour + 24 : hour, mf = (mh - 18) / 12, moonH = Math.sin(Math.min(Math.max(mf, 0), 1) * Math.PI);
	const day = Math.min(1, Math.max(0, (sunH + 0.12) / 0.3));
	sky[0] = day * day * (3 - 2 * day);
	sky[1] = Math.exp(-Math.pow(sunH * 3.2, 2));
	sky[2] = hy;
	sun[0] = mid + dir * half * (Math.min(Math.max(sf, 0), 1) * 2 - 1);
	sun[1] = hy + sunH * arc;
	sun[2] = Math.min(1, Math.max(0, (sunH + 0.05) / 0.12));
	moon[0] = mid + dir * half * (Math.min(Math.max(mf, 0), 1) * 2 - 1);
	moon[1] = hy + moonH * arc;
	moon[2] = mf > 0 && mf < 1 ? Math.min(1, Math.max(0, moonH / 0.1)) * (1 - sky[0]) : 0;
	const useMoon = sky[0] < 0.4 ? 1 : 0;
	src[0] = useMoon ? moon[0] : sun[0];
	src[1] = useMoon ? moon[2] * 0.7 : sun[2];
	src[2] = useMoon;
	mixInto(out.sun, pal.sunLow, pal.sunHigh, sky[0] * (1 - sky[1] * 0.7));
	mixInto(out.sea, pal.seaNight, pal.seaDay, sky[0]);
	mixInto(out.twi, pal.twi, pal.twi, 0);
	mixInto(out.haze, pal.haze, pal.haze, 0);
	mixInto(out.moon, pal.moon, pal.moon, 0);
}

function frame(now) {
	requestAnimationFrame(frame);
	if (!program || gl.isContextLost()) return;
	if (last && now - last < 1000 / MAX_FPS - 2) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	time = (time + dt * MOTION * (reduced ? REDUCED_SPEED : 1)) % 2000;
	clock = (clock + dt) % 86400;
	placeBodies(hourNow(dt));
	gl.uniform2f(loc.u_res, canvas.width, canvas.height);
	gl.uniform1f(loc.u_scale, canvas.width / Math.max(1, w));
	gl.uniform1f(loc.u_time, time);
	gl.uniform3fv(loc.u_sun, sun);
	gl.uniform3fv(loc.u_moon, moon);
	gl.uniform3fv(loc.u_src, src);
	gl.uniform4fv(loc.u_sky, sky);
	gl.uniform3fv(loc.u_sunCol, out.sun);
	gl.uniform3fv(loc.u_twiCol, out.twi);
	gl.uniform3fv(loc.u_hazeCol, out.haze);
	gl.uniform3fv(loc.u_seaCol, out.sea);
	gl.uniform3fv(loc.u_moonCol, out.moon);
	gl.uniform1f(loc.u_dark, pal.dark);
	gl.uniform2f(loc.u_col, colX(), colHalf());
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function start() {
	const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
	gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
	if (!gl) {
		console.warn('Solar Tide: WebGL is not available, so the seascape is not drawn.');
		return;
	}
	canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); program = null; });
	canvas.addEventListener('webglcontextrestored', () => {
		try { setup(); } catch (err) { console.error('Solar Tide:', err.message); }
	});
	try {
		setup();
		requestAnimationFrame(frame);
	} catch (err) {
		console.error('Solar Tide:', err.message);
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
	}
};
