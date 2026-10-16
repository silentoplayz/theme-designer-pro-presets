/**
 * Title: Voxel Flyover (WebGL)
 * Description: A calm glide over an endless block world of grass, stone, snow, sand and flat water that fades into your theme's background with distance and behind the chat, under a pixel-square sun; the camera leans toward the cursor.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const INTENSITY       = 0.9;    // how strongly the land shows (0-1)
const SPEED           = 4.5;    // forward glide speed, in blocks per second (0-12)
const REDUCED_SPEED   = 0.15;   // share of the speed kept when the viewer asks to reduce motion (0-1)
const MAX_HEIGHT      = 26;     // tallest terrain, in blocks (10-40)
const WATER_LEVEL     = 6;      // sea level, in blocks (0-15)
const TERRAIN_SCALE   = 0.028;  // size of the landforms; smaller is broader (0.01-0.06)
const RENDER_DISTANCE = 200;    // how far you can see, in blocks; distant land is drawn as bigger blocks (80-300)
const CENTER_CALM     = 0.85;   // how much the land fades behind the chat column (0-1)
const BAND_WIDTH      = 520;    // half-width of the calm band when the page has no chat column, in px (300-900)
const CURSOR_LEAN     = 1;      // how far the camera leans toward the cursor (0-2)
const SKY_CLOUDS      = 0.6;    // strength of the blocky clouds in the sky (0-1)
const RENDER_SCALE    = 0.6;    // resolution of the world (0.4-1)
const MAX_FPS         = 30;     // frame cap (15-60)
const FOLLOW_THEME    = true;   // tint the land with the theme's palette
const SUN_COLOR       = '#fff4d1';  // sun color when not following the theme
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
	'uniform vec4 u_cam;',
	'uniform float u_time;',
	'uniform float u_dark;',
	'uniform vec2 u_col;',
	'uniform vec3 u_sun;',
	'uniform vec3 u_sunCol;',
	'uniform vec3 u_grass;',
	'uniform vec3 u_water;',
	'uniform vec3 u_sand;',
	'uniform vec3 u_stone;',
	'uniform vec3 u_cloud;',
	'const float CAM_H = 10.0;',
	'const float MAXH = ' + MAX_HEIGHT.toFixed(2) + ';',
	'const float WATER = ' + WATER_LEVEL.toFixed(2) + ';',
	'const float RD = ' + RENDER_DISTANCE.toFixed(1) + ';',
	'float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
	'float noise(vec2 p) {',
	'	vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);',
	'	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
	'}',
	'float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }',
	'float baseH(vec2 c) {',
	'	vec2 p = c * ' + TERRAIN_SCALE.toFixed(4) + ';',
	'	vec2 q = vec2(fbm(p + vec2(1.7, 9.2)), fbm(p + vec2(5.2, 1.3)));',
	'	return pow(clamp(fbm(p + q * 0.7), 0.0, 1.0), 1.5) * MAXH;',
	'}',
	'float colH(vec2 cell, float L) { return floor(baseH((cell + 0.5) * L) / L) * L; }',
	'void main() {',
	'	vec2 px = gl_FragCoord.xy / u_scale;',
	'	vec2 res = u_res / u_scale;',
	'	vec2 uv = (px - 0.5 * res) / res.y;',
	'	float band = abs(px.x - u_col.x) / u_col.y;',
	'	float calm = 1.0 - ' + CENTER_CALM.toFixed(3) + ' * (1.0 - smoothstep(0.7, 1.3, band));',
	'	vec3 ro = vec3(u_cam.x, baseH(u_cam.xy) + CAM_H, u_cam.y);',
	'	vec3 fwd = normalize(vec3(u_cam.z, -0.24, 1.0));',
	'	vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));',
	'	vec3 up = cross(fwd, right);',
	'	vec3 rd = normalize(uv.x * right + uv.y * up + fwd * 1.4);',
	'	vec3 col = vec3(0.0);',
	'	float a = 0.0;',
	'	vec2 sd2 = abs(px - u_sun.xy);',
	'	float sq = max(sd2.x, sd2.y);',
	'	float sun = smoothstep(u_sun.z + 1.0, u_sun.z - 1.0, sq) + smoothstep(u_sun.z * 3.0, u_sun.z, sq) * 0.18;',
	'	col += u_sunCol * sun; a += sun;',
	'	if (rd.y > 0.0) {',
	'		float cl = fbm(rd.xz / max(rd.y, 0.25) * 2.2 + vec2(u_time * 0.025, 0.0));',
	'		cl = floor(smoothstep(0.55, 0.72, cl) * 3.0) / 3.0 * smoothstep(0.03, 0.3, rd.y) * ' + SKY_CLOUDS.toFixed(3) + ' * mix(0.35, 0.3, u_dark);',
	'		col = u_cloud * cl + col * (1.0 - cl); a = cl + a * (1.0 - cl);',
	'	}',
	'	if (rd.y < 0.0 || ro.y < MAXH + 1.0) {',
	'		vec2 ro2 = ro.xz, rd2 = rd.xz;',
	'		vec2 arr = max(abs(rd2), vec2(1e-4));',
	'		vec2 rs = sign(rd2);',
	'		vec2 rds = rs * arr;',
	'		float L = 1.0;',
	'		vec2 cell = floor(ro2);',
	'		vec2 sd = (cell + (rs * 0.5 + 0.5) - ro2) / rds;',
	'		vec2 dd = 1.0 / arr;',
	'		float H0 = colH(cell, L);',
	'		float tEnter = 0.0, tHit = 0.0, top = 0.0, hitL = 1.0;',
	'		int axis = 0; bool hit = false; bool face = false;',
	'		for (int i = 0; i < 160; i++) {',
	'			float eff = max(H0, WATER);',
	'			float tNext = min(sd.x, sd.y);',
	'			if (ro.y + rd.y * tEnter < eff) { hit = true; face = false; tHit = tEnter; top = H0; hitL = L; break; }',
	'			if (ro.y + rd.y * tNext < eff) { hit = true; face = true; tHit = (eff - ro.y) / rd.y; top = H0; hitL = L; break; }',
	'			if (rd.y > 0.0 && ro.y + rd.y * tEnter > MAXH) break;',
	'			if (sd.x < sd.y) { tEnter = sd.x; sd.x += dd.x * L; cell.x += rs.x; axis = 0; }',
	'			else { tEnter = sd.y; sd.y += dd.y * L; cell.y += rs.y; axis = 1; }',
	'			if (tEnter > RD) break;',
	'			float want = tEnter < 45.0 ? 1.0 : (tEnter < 110.0 ? 2.0 : (tEnter < 220.0 ? 4.0 : 8.0));',
	'			if (want > L) {',
	'				L = want;',
	'				vec2 p2 = ro2 + rd2 * tEnter;',
	'				cell = floor(p2 / L);',
	'				sd = tEnter + ((cell + (rs * 0.5 + 0.5)) * L - p2) / rds;',
	'			}',
	'			H0 = colH(cell, L);',
	'		}',
	'		if (hit) {',
	'			vec3 hp = ro + rd * tHit;',
	'			float shade = (face ? 1.0 : (axis == 0 ? 0.74 : 0.62)) * mix(1.0, 1.25, u_dark);',
	'			vec3 base;',
	'			if (top < WATER) base = u_water;',
	'			else if (!face) base = (top - hp.y < 3.0) ? u_stone * vec3(1.0, 0.86, 0.7) : u_stone;',
	'			else if (top >= MAXH * 0.74) base = vec3(0.93, 0.95, 1.0);',
	'			else if (top <= WATER + 1.5) base = u_sand;',
	'			else base = u_grass * (0.85 + 0.3 * fbm(cell * hitL * 0.015 + 3.3));',
	'			vec2 fc = face ? fract(hp.xz / hitL) : (axis == 0 ? fract(hp.zy / hitL) : fract(hp.xy / hitL));',
	'			float e = min(min(fc.x, 1.0 - fc.x), min(fc.y, 1.0 - fc.y));',
	'			vec3 lit = min(base * shade, vec3(1.0)) * (0.82 + 0.18 * smoothstep(0.0, 0.045, e));',
	'			float la = exp(-tHit * (3.4 / RD)) * mix(0.72, 0.95, u_dark) * u_cam.w;',
	'			col = lit * la + col * (1.0 - la);',
	'			a = la + a * (1.0 - la);',
	'		}',
	'	}',
	'	float k = calm * ' + INTENSITY.toFixed(3) + ';',
	'	a = clamp(a * k, 0.0, 1.0);',
	'	gl_FragColor = vec4(min(col * k, vec3(a)), a);',
	'}',
].join('\n');

const WRAP = 30000;  // the world restarts after this many blocks, through a slow fade, so numbers stay precise

let canvas, gl, program, buffer;
let loc = {};
let w = 0, h = 0;
let last = 0, time = 0, travel = 0, reduced = false, column = null;
const mouse = { x: -10000, amount: 0, lean: 0 };
const colors = {
	grass: [0.34, 0.58, 0.22], water: [0.16, 0.36, 0.62], sand: [0.8, 0.74, 0.48], stone: [0.46, 0.46, 0.49],
	cloud: [1, 1, 1], sun: hexToRgb(SUN_COLOR), dark: 1,
};

function hexToRgb(hex) {
	const n = parseInt(hex.slice(1), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mixRgb(a, b, t) {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// Keeps the block palette readable and leans each material toward a theme role
function applyTheme(t) {
	if (!t) return;
	colors.dark = t.dark === false ? 0 : 1;
	const rgb = FOLLOW_THEME && t.rgb ? t.rgb : null;
	colors.grass = rgb ? mixRgb([0.34, 0.58, 0.22], rgb.accent3, 0.3) : [0.34, 0.58, 0.22];
	colors.water = rgb ? mixRgb([0.16, 0.36, 0.62], rgb.accent, 0.45) : [0.16, 0.36, 0.62];
	colors.sand = rgb ? mixRgb([0.8, 0.74, 0.48], rgb.accent2, 0.2) : [0.8, 0.74, 0.48];
	colors.stone = rgb ? mixRgb([0.46, 0.46, 0.49], rgb.muted, 0.5) : [0.46, 0.46, 0.49];
	colors.cloud = colors.dark ? (rgb ? rgb.text : [1, 1, 1]) : (rgb ? rgb.muted : [0.55, 0.6, 0.68]);
	colors.sun = rgb ? mixRgb(rgb.accent2, colors.dark ? [1, 0.96, 0.82] : [0.95, 0.62, 0.2], 0.55) : hexToRgb(SUN_COLOR);
	if (!colors.dark && !rgb) colors.sun = [0.95, 0.68, 0.25];
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
	['u_res', 'u_scale', 'u_cam', 'u_time', 'u_dark', 'u_col', 'u_sun', 'u_sunCol', 'u_grass', 'u_water', 'u_sand', 'u_stone', 'u_cloud'].forEach((name) => {
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

// The winding path the camera follows, as a function of distance travelled
function pathX(z) { return Math.sin(z * 0.049) * 5 + Math.sin(z * 0.02) * 3; }

function frame(now) {
	requestAnimationFrame(frame);
	if (!program || gl.isContextLost()) return;
	if (last && now - last < 1000 / MAX_FPS - 2) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const pace = reduced ? REDUCED_SPEED : 1;
	time = (time + dt * pace) % 3000;
	travel = (travel + dt * SPEED * pace) % WRAP;
	const fadeLen = Math.max(1, SPEED * 3);
	const fade = Math.min(1, Math.min(travel, WRAP - travel) / fadeLen);
	mouse.amount = Math.max(0, mouse.amount - dt * 0.4);
	const leanTarget = mouse.x > -9000 ? (mouse.x / Math.max(1, w) - 0.5) * 0.3 * CURSOR_LEAN * Math.min(1, mouse.amount * 2) * (reduced ? 0.3 : 1) : 0;
	mouse.lean += (leanTarget - mouse.lean) * Math.min(1, dt * 1.5);
	const px = pathX(travel);
	const turn = (pathX(travel + SPEED * 1.2) - px) * 0.35;
	const lo = column ? column.left : 0, hi = column ? column.right : w;
	const left = colX() - colHalf() - lo, right = hi - colX() - colHalf();
	const sunX = left > right ? lo + Math.max(28, left * 0.5) : hi - Math.max(28, right * 0.5);
	gl.uniform2f(loc.u_res, canvas.width, canvas.height);
	gl.uniform1f(loc.u_scale, canvas.width / Math.max(1, w));
	gl.uniform4f(loc.u_cam, px, travel, turn + mouse.lean, fade);
	gl.uniform1f(loc.u_time, time);
	gl.uniform1f(loc.u_dark, colors.dark);
	gl.uniform2f(loc.u_col, colX(), colHalf());
	gl.uniform3f(loc.u_sun, sunX, h * 0.84, Math.max(10, h * 0.022));
	gl.uniform3fv(loc.u_sunCol, colors.sun);
	gl.uniform3fv(loc.u_grass, colors.grass);
	gl.uniform3fv(loc.u_water, colors.water);
	gl.uniform3fv(loc.u_sand, colors.sand);
	gl.uniform3fv(loc.u_stone, colors.stone);
	gl.uniform3fv(loc.u_cloud, colors.cloud);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function start() {
	const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
	gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
	if (!gl) {
		console.warn('Voxel Flyover: WebGL is not available, so the world is not drawn.');
		return;
	}
	canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); program = null; });
	canvas.addEventListener('webglcontextrestored', () => {
		try { setup(); } catch (err) { console.error('Voxel Flyover:', err.message); }
	});
	try {
		setup();
		requestAnimationFrame(frame);
	} catch (err) {
		console.error('Voxel Flyover:', err.message);
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
			travel = 40;
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
			mouse.amount = 1;
			break;
	}
};
