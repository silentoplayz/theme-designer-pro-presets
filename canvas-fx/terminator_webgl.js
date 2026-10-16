/**
 * Title: Terminator (WebGL)
 * Description: A slowly turning planet beside the chat whose daylight follows your local time, with a warm sunset line, city lights on the night side, drifting clouds, an atmosphere halo and faint stars; moving the cursor across it nudges its spin.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const INTENSITY     = 0.95;  // how strongly the planet shows (0-1)
const SPIN_SPEED    = 0.03;  // how fast the planet turns, in radians per second (0-0.3)
const REDUCED_SPEED = 0.2;   // share of the spin kept when the viewer asks to reduce motion (0-1)
const PREVIEW_CYCLE = 0;     // seconds for one full day as a preview; 0 follows your real local time (0-600)
const GLOBE_SIZE    = 0.3;   // planet radius as a share of the screen height (0.15-0.45)
const CENTER_CALM   = 0.85;  // how much the scene fades behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const STAR_DENSITY  = 0.5;   // faint stars around the planet, dark themes only (0-1)
const CITY_LIGHTS   = 1;     // brightness of the city lights on the night side (0-2)
const CURSOR_SPIN   = 1;     // how much a cursor sweep across the planet turns it (0-3)
const RENDER_SCALE  = 0.75;  // resolution of the scene (0.5-1)
const MAX_FPS       = 30;    // frame cap; the planet turns slowly (15-60)
const FOLLOW_THEME  = true;  // take the colors from the theme's palette
const OCEAN_COLOR   = '#0a2a5c';  // ocean color when not following the theme
const LAND_COLOR    = '#2f6b2a';  // land color
const CITY_COLOR    = '#ffbf59';  // city lights and sunset line
const ATMO_COLOR    = '#4d80ff';  // atmosphere color
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
	'uniform float u_dark;',
	'uniform vec3 u_globe;',
	'uniform vec3 u_sun;',
	'uniform vec4 u_rot;',
	'uniform vec2 u_col;',
	'uniform vec3 u_ocean;',
	'uniform vec3 u_land;',
	'uniform vec3 u_city;',
	'uniform vec3 u_atmo;',
	'float hash2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
	'float hash3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }',
	'float noise3(vec3 p) {',
	'	vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);',
	'	vec2 e = vec2(1.0, 0.0);',
	'	return mix(mix(mix(hash3(i), hash3(i + e.xyy), u.x), mix(hash3(i + e.yxy), hash3(i + e.xxy), u.x), u.y),',
	'		mix(mix(hash3(i + e.yyx), hash3(i + e.xyx), u.x), mix(hash3(i + e.yxx), hash3(i + e.xxx), u.x), u.y), u.z);',
	'}',
	'float fbm3(vec3 p) {',
	'	float v = 0.0, a = 0.5;',
	'	for (int i = 0; i < 5; i++) { v += a * noise3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.4); a *= 0.5; }',
	'	return v;',
	'}',
	'void main() {',
	'	vec2 px = gl_FragCoord.xy / u_scale;',
	'	float band = abs(px.x - u_col.x) / u_col.y;',
	'	float calmSoft = 1.0 - ' + CENTER_CALM.toFixed(3) + ' * (1.0 - smoothstep(0.55, 1.25, band));',
	'	float calmHard = 1.0 - ' + CENTER_CALM.toFixed(3) + ' * (1.0 - smoothstep(0.88, 1.0, band));',
	'	vec2 p = (px - u_globe.xy) / u_globe.z;',
	'	float r = length(p);',
	'	vec3 L = u_sun;',
	'	vec2 cell = floor(px / 70.0);',
	'	vec2 sp = (cell + vec2(hash2(cell), hash2(cell + 7.1))) * 70.0;',
	'	float lit = step(1.0 - ' + STAR_DENSITY.toFixed(3) + ' * 0.5, hash2(cell + 3.3));',
	'	float tw = 0.55 + 0.45 * sin(u_time * (0.5 + hash2(cell + 1.9) * 1.5) + hash2(cell) * 6.283);',
	'	float a = lit * tw * smoothstep(1.8, 0.0, length(px - sp)) * u_dark * calmSoft * smoothstep(1.05, 1.3, r) * 0.7;',
	'	vec3 col = vec3(0.86, 0.9, 1.0) * a;',
	'	float side = 0.3 + 0.7 * clamp(0.5 + dot(p / max(r, 0.001), L.xy) * 0.9 + L.z * 0.4, 0.0, 1.0);',
	'	float ha = exp(-max(r - 1.0, 0.0) * 9.0) * step(1.0, r) * side * mix(0.4, 0.6, u_dark);',
	'	col += u_atmo * ha;',
	'	a += ha;',
	'	if (r < 1.0) {',
	'		vec3 n = vec3(p, sqrt(1.0 - r * r));',
	'		float lam = dot(n, L);',
	'		float day = smoothstep(-0.06, 0.25, lam);',
	'		vec3 nr = vec3(n.x * u_rot.x + n.z * u_rot.y, n.y, n.z * u_rot.x - n.x * u_rot.y);',
	'		vec3 nc = vec3(n.x * u_rot.z + n.z * u_rot.w, n.y, n.z * u_rot.z - n.x * u_rot.w);',
	'		float h = fbm3(nr * 2.3);',
	'		float land = smoothstep(0.47, 0.51, h);',
	'		float ice = smoothstep(0.84, 0.92, abs(n.y) + (h - 0.5) * 0.25);',
	'		vec3 ground = mix(u_land * (0.8 + (h - 0.5) * 2.0), u_land * vec3(1.35, 1.05, 0.7), smoothstep(0.6, 0.72, h));',
	'		vec3 surf = mix(u_ocean * (0.7 + h * 0.6), ground, land);',
	'		surf = mix(surf, vec3(0.9, 0.93, 0.97), ice);',
	'		float cl = smoothstep(0.5, 0.76, fbm3(nc * vec3(2.4, 5.2, 2.4) + 4.0));',
	'		surf = mix(surf, vec3(0.92, 0.94, 0.97), cl * 0.65);',
	'		vec3 planet = surf * (mix(0.4, 0.1, u_dark) + day) + u_atmo * (1.0 - day) * 0.04;',
	'		vec3 hv = normalize(L + vec3(0.0, 0.0, 1.0));',
	'		planet += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, hv), 0.0), 48.0) * (1.0 - land) * (1.0 - cl) * day * 0.45;',
	'		float cities = smoothstep(0.5, 0.6, fbm3(nr * 6.0 + 2.0)) * smoothstep(0.56, 0.8, noise3(nr * 60.0)) * smoothstep(0.5, 0.56, h) * (1.0 - ice) * (1.0 - cl * 0.8);',
	'		planet += u_city * cities * (1.0 - day) * ' + CITY_LIGHTS.toFixed(3) + ' * 1.6;',
	'		planet += u_city * exp(-pow(lam * 5.0, 2.0)) * (0.3 - cl * 0.12);',
	'		float fres = pow(1.0 - n.z, 2.5);',
	'		planet += u_atmo * fres * (0.15 + 0.85 * smoothstep(-0.2, 0.5, lam)) * 0.9;',
	'		float ga = mix(mix(0.8, 0.92, u_dark), 1.0, max(day, fres * 0.6)) * smoothstep(1.0, 1.0 - 1.5 / u_globe.z, r);',
	'		col = planet * ga + col * (1.0 - ga);',
	'		a = ga + a * (1.0 - ga);',
	'	}',
	'	float k = calmHard * ' + INTENSITY.toFixed(3) + ';',
	'	a = clamp(a * k, 0.0, 1.0);',
	'	gl_FragColor = vec4(min(col * k, vec3(a)), a);',
	'}',
].join('\n');

let canvas, gl, program, buffer;
let loc = {};
let w = 0, h = 0, dpr = 1;
let last = 0, time = 0, reduced = false, column = null;
let spin = 0, cloudSpin = 0, spinBoost = 0, hour = 12, clock = 0, hourWait = 0;
const globe = { x: -10000, y: 0, r: 100, tx: 0, ty: 0, tr: 100 };
const sun = { x: 0, y: 0, z: 1 };
const mouse = { x: -10000, y: -10000 };
const colors = { ocean: hexToRgb(OCEAN_COLOR), land: hexToRgb(LAND_COLOR), city: hexToRgb(CITY_COLOR), atmo: hexToRgb(ATMO_COLOR), dark: 1 };

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
	if (!FOLLOW_THEME || !t.rgb) return;
	const ocean = hexToRgb(OCEAN_COLOR), land = hexToRgb(LAND_COLOR);
	colors.ocean = mixRgb(ocean, mixRgb(t.rgb.accent, t.rgb.accent3, 0.5, 0.45), 0.55, 1);
	colors.land = mixRgb(land, mixRgb(t.rgb.muted, t.rgb.accent3, 0.3, 0.6), 0.35, 1);
	colors.city = mixRgb(t.rgb.accent2, [1, 0.85, 0.55], colors.dark ? 0.6 : 0.2, 1);
	colors.atmo = t.rgb.accent3;
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
	['u_res', 'u_scale', 'u_time', 'u_dark', 'u_globe', 'u_sun', 'u_rot', 'u_col', 'u_ocean', 'u_land', 'u_city', 'u_atmo'].forEach((name) => {
		loc[name] = gl.getUniformLocation(program, name);
	});
	gl.disable(gl.BLEND);
	size();
}

function size() {
	const k = Math.min(dpr, 2) * RENDER_SCALE;
	canvas.width = Math.max(1, Math.round(w * k));
	canvas.height = Math.max(1, Math.round(h * k));
	if (gl && !gl.isContextLost()) gl.viewport(0, 0, canvas.width, canvas.height);
	place(true);
}

// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }

// The planet sits in the margin beside the column, inside the chat area so the sidebar never covers it.
// A margin too narrow for the whole planet shows its limb rising past the chat area's right edge instead.
function place(now) {
	const lo = column ? column.left : 0, hi = column ? column.right : w;
	const mL = Math.max(0, colX() - colHalf() - lo), mR = Math.max(0, hi - colX() - colHalf());
	const r0 = GLOBE_SIZE * h, fitL = Math.min(r0, mL / 2.3);
	if (fitL >= r0 * 0.5 && mL >= mR) {
		globe.tr = fitL;
		globe.tx = lo + mL * 0.5;
	} else if (mR >= r0 * 2.3) {
		globe.tr = r0;
		globe.tx = hi - mR * 0.5;
	} else {
		globe.tr = r0;
		globe.tx = hi + r0 - Math.min(2.2 * r0, mR + 0.3 * r0);
	}
	globe.ty = h * 0.58;
	if (now || globe.x < -9000) { globe.x = globe.tx; globe.y = globe.ty; globe.r = globe.tr; }
}

function readHour() {
	if (PREVIEW_CYCLE > 0) return (clock / PREVIEW_CYCLE * 24) % 24;
	const d = new Date();
	return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

function frame(now) {
	requestAnimationFrame(frame);
	if (!program || gl.isContextLost()) return;
	if (last && now - last < 1000 / MAX_FPS - 2) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const pace = reduced ? REDUCED_SPEED : 1;
	time = (time + dt * pace) % 3000;
	clock += dt;
	hourWait -= dt;
	if (hourWait <= 0 || PREVIEW_CYCLE > 0) {
		hour = readHour();
		hourWait = 5;
		const lon = (hour - 12) / 24 * Math.PI * 2;
		const len = Math.hypot(1, 0.25);
		sun.x = Math.sin(lon) / len; sun.y = 0.25 / len; sun.z = Math.cos(lon) / len;
	}
	spinBoost *= Math.exp(-dt * 1.2);
	spin = (spin + (SPIN_SPEED + spinBoost) * pace * dt) % (Math.PI * 2);
	cloudSpin = (cloudSpin + (SPIN_SPEED * 1.35 + spinBoost) * pace * dt) % (Math.PI * 2);
	const ease = Math.min(1, dt * 2);
	globe.x += (globe.tx - globe.x) * ease;
	globe.y += (globe.ty - globe.y) * ease;
	globe.r += (globe.tr - globe.r) * ease;
	gl.uniform2f(loc.u_res, canvas.width, canvas.height);
	gl.uniform1f(loc.u_scale, canvas.width / Math.max(1, w));
	gl.uniform1f(loc.u_time, time);
	gl.uniform1f(loc.u_dark, colors.dark);
	gl.uniform3f(loc.u_globe, globe.x, h - globe.y, globe.r);
	gl.uniform3f(loc.u_sun, sun.x, sun.y, sun.z);
	gl.uniform4f(loc.u_rot, Math.cos(spin), Math.sin(spin), Math.cos(cloudSpin), Math.sin(cloudSpin));
	gl.uniform2f(loc.u_col, colX(), colHalf());
	gl.uniform3fv(loc.u_ocean, colors.ocean);
	gl.uniform3fv(loc.u_land, colors.land);
	gl.uniform3fv(loc.u_city, colors.city);
	gl.uniform3fv(loc.u_atmo, colors.atmo);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function start() {
	const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
	gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
	if (!gl) {
		console.warn('Terminator: WebGL is not available, so the planet is not drawn.');
		return;
	}
	canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); program = null; });
	canvas.addEventListener('webglcontextrestored', () => {
		try { setup(); } catch (err) { console.error('Terminator:', err.message); }
	});
	try {
		setup();
		requestAnimationFrame(frame);
	} catch (err) {
		console.error('Terminator:', err.message);
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
			place(false);
			break;
		case 'mousemove': {
			const dx = mouse.x > -9000 ? d.x - mouse.x : 0;
			mouse.x = d.x;
			mouse.y = d.y;
			if (Math.hypot(d.x - globe.x, d.y - globe.y) < globe.r * 1.3) {
				spinBoost = Math.max(-0.6, Math.min(0.6, spinBoost + dx / globe.r * 0.4 * CURSOR_SPIN));
			}
			break;
		}
	}
};
