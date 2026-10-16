/**
 * Title: Koi Pond (WebGL)
 * Description: A clear pond seen from above, tinted by your theme, where koi glide along its edges under lily pads and caustic light, follow a nearby cursor, scatter from a tap's ripple and now and then kiss the surface.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const FISH_COUNT       = 5;      // number of koi (1-9)
const FISH_SIZE        = 46;     // koi half-length in px, tail not counted (24-90)
const SPEED            = 1;      // pace of the koi and the water; 0 holds the pond still (0-2)
const REDUCED_SPEED    = 0.3;    // share of the pace kept when the viewer asks to reduce motion (0-1)
const CENTER_CALM      = 0.8;    // how much the water, light and koi quiet down behind the chat column (0-1)
const BAND_WIDTH       = 520;    // half-width of the calm band when the page has no chat column, in px (300-900)
const WATER_TINT       = 0.6;    // strength of the water wash over the theme background (0-1)
const CAUSTICS         = 0.6;    // brightness of the dancing light webs (0-1)
const REFRACTION       = 1;      // how much the surface wobbles everything below it (0-2)
const CURIOSITY        = 1;      // how far koi notice and follow the cursor (0-2)
const STARTLE          = 1;      // how hard a tap's ripple scatters nearby koi; 0 turns taps off (0-2)
const KISS_EVERY       = 10;     // average seconds between surface kisses; 0 turns them off (0-60)
const LILY_PADS        = 4;      // lily pads floating in the corners (0-6)
const RENDER_SCALE     = 0.7;    // resolution of the pond; koi edges stay crisp from about 0.6 (0.4-1)
const MAX_FPS          = 30;     // frame cap; koi move slowly (15-60)
const FOLLOW_THEME     = true;   // tint the water from the theme's palette
const KOI_FOLLOW_THEME = false;  // also color the koi patches from the theme's accents
const WATER_DEEP       = '#0b3940';  // deep water when not following the theme
const WATER_SHALLOW    = '#2b8a83';  // shallow water when not following the theme
const KOI_CREAM        = '#f3ebdd';  // koi base color
const KOI_ORANGE       = '#f26a1b';  // koi patch color
/* ──────────────────────────────────────────── */


const N = Math.max(1, Math.min(9, Math.round(FISH_COUNT)));
const P = Math.max(0, Math.min(6, Math.round(LILY_PADS)));
const RN = 6;
const VARIETY = [0, 1, 2, 0, 3, 4, 0, 1, 2]; // orange-cream, kohaku, ogon, sanke, tancho
const PADS = [0.06, 0.15, 0.95, 0.86, 0.93, 0.11, 0.08, 0.9, 0.03, 0.55, 0.97, 0.47];
const n3 = (v) => v.toFixed(3);

const VERT = 'attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }';

const FRAG = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res, u_col;
uniform float u_scale, u_time, u_dark;
uniform vec4 u_fa[${N}], u_fb[${N}], u_rip[${RN}], u_pad[${Math.max(1, P)}];
uniform vec3 u_c[9]; // deep, shallow, light, shadow, pad, cream, orange, red, gold
const float FL = ${n3(FISH_SIZE)};
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; } return v; }
vec2 rot(vec2 p, float a) { return vec2(cos(a) * p.x + sin(a) * p.y, cos(a) * p.y - sin(a) * p.x); }
vec4 over(vec4 d, vec3 c, float a) { a = clamp(a, 0.0, 1.0); return vec4(c * a + d.rgb * (1.0 - a), a + d.a * (1.0 - a)); }
float ell(vec2 p, vec2 c, vec2 r, float a, float e) { return smoothstep(1.0 + e, 1.0 - e, length(rot(p - c, a) / r)); }
float caustic(vec2 uv, float t) {
	vec2 p = mod(uv * 6.2832, 6.2832) - 250.0, i = p; float c = 1.0;
	for (int n = 0; n < 5; n++) {
		float s = t * (1.0 - 3.5 / float(n + 1));
		i = p + vec2(cos(s - i.x) + sin(s + i.y), sin(s - i.y) + cos(s + i.x));
		c += 1.0 / length(p / vec2(sin(i.x + s), cos(i.y + s)) / 200.0);
	}
	return pow(abs(1.17 - pow(c / 5.0, 1.4)), 8.0);
}
// A koi in body units (nose +1, tail tips -1.9): returns the body, fins go to fin
float koi(vec2 p, vec4 a, vec4 b, float e, out vec2 l, out float sh, out float fin) {
	l = rot(p - a.xy, a.z) / FL; sh = 0.0; fin = 0.0;
	if (l.x > 1.2 || l.x < -2.1 || abs(l.y) > 1.0) return 0.0;
	float g = fract(b.w), y = abs(l.y - sin(l.x * 2.6 + a.w) * 0.17 * g * (0.15 + smoothstep(0.7, -1.7, l.x)) - b.z * l.x * l.x * 0.12);
	float u = l.x > 0.25 ? (l.x - 0.25) / 0.8 : (0.25 - l.x) / 1.25, k = sqrt(max(0.0, 1.0 - u * u));
	float bw = l.x > 0.25 ? 0.33 * k : 0.05 + 0.28 * k;
	float body = smoothstep(e, -e, y - bw) * step(u, 1.0);
	sh = clamp(1.0 - y / max(bw, 0.02), 0.0, 1.0);
	float tail = ell(vec2(l.x, y), vec2(-1.4, 0.16), vec2(0.5, 0.17), -0.36 - 0.1 * g, e * 4.0) * (0.45 + 0.55 * smoothstep(-2.0, -1.1, l.x)) * (0.85 + 0.15 * sin(atan(y, l.x + 0.9) * 26.0));
	float pec = ell(vec2(l.x, abs(l.y)), vec2(0.22, 0.36), vec2(0.21, 0.085), -0.55 - 0.3 * sin(a.w * 0.5), e * 4.0);
	fin = max(tail, pec * 0.85) * (1.0 - body);
	return body;
}
float petal(float a, float r) { return r * (0.5 + 0.5 * pow(abs(cos(a * 4.0)), 0.7)); }
float pad(vec2 d, vec4 pd, float e) {
	vec2 q = rot(d, pd.w);
	return smoothstep(pd.z + e, pd.z - e, length(q)) * (q.x > 0.0 ? smoothstep(-e, e, abs(q.y) - q.x * 0.3) : 1.0);
}
void main() {
	vec2 px = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_scale, res = u_res / u_scale;
	float t = u_time, ep = 1.0 / u_scale, dk = u_dark;
	float band = 1.0 - smoothstep(0.45, 1.2, abs(px.x - u_col.x) / u_col.y);
	// Ripples: a travelling wave packet that bends the view and catches the light
	vec2 off = vec2(0.0); float rl = 0.0;
	for (int i = 0; i < ${RN}; i++) {
		vec4 r = u_rip[i];
		if (r.z >= 0.0) {
			vec2 d = px - r.xy; float x = length(d) - r.z * 90.0, wd = 10.0 + r.z * 14.0;
			float env = r.w * exp(-r.z * 1.2 - x * x / (wd * wd)) * smoothstep(0.0, 0.25, r.z);
			off += normalize(d + 0.001) * sin(x * 0.18) * env * 4.0; rl += cos(x * 0.18) * env;
		}
	}
	vec2 q = px + off;
	vec2 wq = q + (vec2(noise(q * 0.011 + t * 0.21), noise(q * 0.011 + 7.3 - t * 0.17)) - 0.5) * ${n3(9 * REFRACTION)};
	float bed = fbm(wq * 0.0032 + 3.1);
	vec3 wc = mix(u_c[1], u_c[0], smoothstep(0.3, 0.72, bed));
	float wa = ${n3(WATER_TINT)} * (0.3 + 0.62 * bed) * (1.0 - ${n3(CENTER_CALM)} * band) * (0.78 + 0.32 * smoothstep(0.2, 0.75, length(px / res - 0.5))) * mix(1.3, 0.75, dk);
	vec4 O = vec4(wc * wa, wa);
	vec2 l; float sh, fin;
	for (int i = 0; i < ${N}; i++) {
		vec4 a = u_fa[i], b = u_fb[i];
		float s = koi(wq - vec2(9.0, 13.0) * (1.0 + b.x * 1.4), a, b, (5.0 + b.x * 12.0) / FL, l, sh, fin);
		O = over(O, u_c[3], (s + fin * 0.4) * b.y * (0.34 - b.x * 0.16) * mix(0.75, 1.0, dk));
		float body = koi(wq, a, b, (ep * 0.8 + b.x * 5.0) / FL, l, sh, fin);
		if (body + fin > 0.003) {
			float v = floor(b.w); vec2 pc = l * vec2(1.0, 2.3) + float(i) * 7.31;
			float n = noise(pc * 1.6) * 0.65 + noise(pc * 3.7) * 0.35, m = smoothstep(0.47, 0.53, n);
			vec3 base = u_c[5], pat = u_c[6];
			if (v == 1.0 || v == 3.0) { pat = u_c[7]; m = smoothstep(0.42, 0.48, n); }
			if (v == 2.0) { base = u_c[8]; pat = mix(u_c[8], u_c[6], 0.6); }
			if (v == 4.0) { pat = u_c[7]; m = smoothstep(0.22, 0.17, length(l - vec2(0.55, 0.0))); }
			vec3 fc = mix(base, pat, m * smoothstep(1.0, 0.8, l.x));
			if (v == 3.0) fc = mix(fc, vec3(0.07), smoothstep(0.66, 0.74, noise(pc * 2.2 + 9.1) * 0.6 + noise(pc.yx * 4.3) * 0.4) * step(l.x, 0.7));
			fc = fc * (0.72 + 0.34 * sqrt(sh)) + vec3(1.0, 0.95, 0.85) * pow(sh, 6.0) * (v == 2.0 ? 0.26 : 0.16) * (1.0 - b.x);
			fc = mix(fc, vec3(0.08), smoothstep(0.055, 0.03, length(vec2(l.x - 0.76, abs(l.y) - 0.16))) * 0.8);
			float fo = fin * mix(0.6, 0.8, dk), fa = body + fo;
			fc = mix((fc * body + mix(mix(base, pat, 0.6), vec3(1.0), 0.35) * fo) / max(fa, 0.001), wc, b.x * 0.5);
			O = over(O, fc, fa * b.y * (1.0 - b.x * 0.45));
		}
	}
	O = over(O, u_c[2], caustic(wq / 340.0 + bed * 0.3, t * 0.35) * ${n3(CAUSTICS)} * (1.0 - ${n3(CENTER_CALM * 0.75)} * band) * mix(0.7, 0.55, dk) * (0.6 + 0.6 * bed));
	O = over(O, rl > 0.0 ? u_c[2] : u_c[3], abs(rl) * (rl > 0.0 ? mix(0.3, 0.45, dk) : mix(0.22, 0.15, dk)));
	// Lily pads float on the surface, above the refraction; the first one carries a flower
	for (int i = 0; i < ${P}; i++) {
		vec4 pd = u_pad[i]; vec2 d = px + off * 0.4 - pd.xy; float r = length(d) / pd.z;
		O = over(O, u_c[3], pad(d - vec2(7.0, 10.0), pd, 7.0) * mix(0.16, 0.26, dk));
		O = over(O, u_c[4] * (0.82 + 0.3 * r) + 0.07 * smoothstep(0.9, 1.0, cos(atan(d.y, d.x) * 13.0 - pd.w * 13.0)) * smoothstep(0.15, 0.4, r), pad(d, pd, ep) * mix(0.85, 0.92, dk));
		if (i == 0) {
			vec2 g = d + vec2(0.3, 0.2) * pd.z; float rf = pd.z * 0.5, rb = length(g), ab = atan(g.y, g.x) + pd.w;
			float p1 = petal(ab, rf), p2 = petal(ab + 0.2, rf * 0.7);
			vec3 fc = mix(vec3(0.96, 0.62, 0.76), vec3(1.0, 0.97, 0.96), smoothstep(rf, rf * 0.3, rb)) * (0.86 + 0.14 * step(p2, rb + 0.5));
			O = over(O, mix(fc, vec3(1.0, 0.8, 0.25), smoothstep(rf * 0.24, rf * 0.14, rb)), smoothstep(max(p1, p2) + ep, max(p1, p2) - ep, rb));
		}
	}
	gl_FragColor = vec4(min(O.rgb, vec3(O.a)), O.a);
}`;

let canvas, gl, program;
const loc = {};
let w = 0, h = 0, last = 0, time = 0, reduced = false, dark = 1, kissWait = KISS_EVERY * 0.6, column = null;
const mouse = { x: -10000, y: -10000, amount: 0 };
const arr = (n) => new Float32Array(n || N);
const fx = arr(), fy = arr(), fang = arr(), fspd = arr(), fph = arr(), fdep = arr();
const fbend = arr(), fdart = arr(), ftx = arr(), fty = arr(), ftime = arr();
const FA = arr(N * 4), FB = arr(N * 4), RP = arr(RN * 4).fill(-1), PD = arr(Math.max(1, P) * 4), COL = arr(27);
const WHITE = [1, 1, 1], BLACK = [0, 0, 0];

const hexToRgb = (hex) => [16, 8, 0].map((s) => ((parseInt(hex.slice(1), 16) >> s) & 255) / 255);
// put mixes a and b into color slot k of COL; slot(k) reads one back
function put(k, a, b, m) { for (let i = 0; i < 3; i++) COL[k * 3 + i] = a[i] + (b[i] - a[i]) * m; }
const slot = (k) => COL.slice(k * 3, k * 3 + 3);
function put4(a, i, x, y, z, v) { a[i * 4] = x; a[i * 4 + 1] = y; a[i * 4 + 2] = z; a[i * 4 + 3] = v; }

// The theme tints the water; the koi keep their natural colors unless KOI_FOLLOW_THEME
function applyTheme(t) {
	dark = t && t.dark === false ? 0 : 1;
	const c = FOLLOW_THEME && t && t.rgb, k = KOI_FOLLOW_THEME && t && t.rgb, shal = hexToRgb(WATER_SHALLOW);
	if (!dark) {
		put(0, c ? c.background : WHITE, c ? c.accent3 : shal, 0.6);
		put(1, c ? c.background : WHITE, c ? c.accent3 : shal, 0.3);
		put(2, WHITE, WHITE, 0);
	} else if (c) {
		put(0, c.background, BLACK, 0.5); put(0, slot(0), c.accent3, 0.2);
		put(1, c.surface, c.accent3, 0.4); put(2, c.accent3, WHITE, 0.6);
	} else {
		put(0, hexToRgb(WATER_DEEP), WHITE, 0); put(1, shal, WHITE, 0); put(2, shal, WHITE, 0.65);
	}
	put(3, slot(0), BLACK, dark ? 0.7 : 0.65);
	put(4, dark ? [0.13, 0.33, 0.18] : [0.36, 0.6, 0.33], slot(0), 0.15);
	put(5, k ? k.accent : hexToRgb(KOI_CREAM), k ? WHITE : [0.86, 0.74, 0.58], k ? 0.82 : dark ? 0 : 0.2);
	put(6, k ? k.accent : hexToRgb(KOI_ORANGE), WHITE, 0);
	put(7, k ? k.accent2 : [0.85, 0.2, 0.1], WHITE, 0);
	put(8, k ? k.accent3 : [0.96, 0.68, 0.22], WHITE, 0);
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
	gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
	['u_res', 'u_col', 'u_scale', 'u_time', 'u_dark', 'u_fa', 'u_fb', 'u_rip', 'u_pad', 'u_c'].forEach((name) => {
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

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }
const inColumn = (x) => (1 - smooth(0.5, 0.85, Math.abs(x - colX()) / colHalf())) * CENTER_CALM;

// A random x beside the chat column on one side (-1 left, 1 right), inside the chat area so the sidebar can't cover it
function sideX(side) {
	const lo = column ? column.left : 0, hi = column ? column.right : w;
	const cx = colX(), room = side < 0 ? cx - lo : hi - cx, inner = Math.min(colHalf() * 0.85, room * 0.62);
	return cx + side * (inner + Math.random() * Math.max(10, room - FISH_SIZE * 1.6 - inner));
}

// ── Koi: wander targets sit beside the chat column; a koi crossing it dives and fades ──
function pickTarget(i) {
	const m = FISH_SIZE * 1.6;
	ftx[i] = sideX((fx[i] < colX() ? -1 : 1) * (Math.random() < 0.08 ? -1 : 1));
	fty[i] = m + Math.random() * Math.max(1, h - 2 * m);
	ftime[i] = 10 + Math.random() * 14;
}

function seedFish() {
	for (let i = 0; i < N; i++) {
		fx[i] = sideX(i % 2 ? 1 : -1);
		fy[i] = h * (0.12 + 0.76 * ((i * 0.37 + Math.random() * 0.2) % 1));
		fang[i] = Math.random() * 6.283;
		fspd[i] = FISH_SIZE * 0.8;
		fph[i] = Math.random() * 12.5;
		pickTarget(i);
	}
}

// Cruise speed is about one half-length per second; dt is already scaled by SPEED
function updateFish(dt) {
	const m = FISH_SIZE, reach = 280 * CURIOSITY, lure = mouse.amount > 0.25 && reach > 0;
	for (let i = 0; i < N; i++) {
		let dx = ftx[i] - fx[i], dy = fty[i] - fy[i], dist = Math.hypot(dx, dy) || 1, slow = 1;
		if (dist < m * 1.8 || (ftime[i] -= dt) <= 0) pickTarget(i);
		if (lure && fdart[i] < 0.2) {
			const mx = mouse.x - fx[i], my = mouse.y - fy[i], md = Math.hypot(mx, my) || 1;
			if (md < reach) { dx = mx; dy = my; dist = md; slow = 0.15 + 0.85 * smooth(m * 1.2, m * 4, md); }
		}
		let sx = dx / dist, sy = dy / dist;
		for (let j = 0; j < N; j++) {
			const ox = fx[i] - fx[j], oy = fy[i] - fy[j], od = Math.hypot(ox, oy) || 1, push = (1 - od / (m * 2.6)) * 1.6 / od;
			if (j !== i && push > 0) { sx += ox * push; sy += oy * push; }
		}
		sx += fx[i] < m ? 1.5 : fx[i] > w - m ? -1.5 : 0;
		sy += fy[i] < m ? 1.5 : fy[i] > h - m ? -1.5 : 0;
		let diff = Math.atan2(sy, sx) - fang[i];
		diff -= Math.round(diff / 6.2832) * 6.2832;
		const turn = 0.9 + fdart[i] * 4;
		const omega = clamp(diff * 1.4, -turn, turn) + Math.sin(time * 0.37 + i * 1.7) * 0.12;
		fang[i] = (fang[i] + omega * dt) % 6.2832;
		fbend[i] += (clamp(omega, -2, 2) - fbend[i]) * Math.min(1, dt * 3);
		const col = inColumn(fx[i]);
		const want = m * ((0.8 + 0.3 * Math.sin(time * 0.19 + i * 2.3)) * slow * (1 + col * 0.6) + fdart[i] * 3.5 * STARTLE);
		fspd[i] += (want - fspd[i]) * Math.min(1, dt * (fdart[i] > 0.1 ? 5 : 0.9));
		fx[i] = clamp(fx[i] + Math.cos(fang[i]) * fspd[i] * dt, -m, w + m);
		fy[i] = clamp(fy[i] + Math.sin(fang[i]) * fspd[i] * dt, -m, h + m);
		fph[i] = (fph[i] + dt * (2.4 + fspd[i] / m * 2.6)) % 12.5664;
		fdart[i] = Math.max(0, fdart[i] - dt * 0.8);
		fdep[i] += (Math.min(1, (i * 0.37) % 0.3 + col * 0.75 + fdart[i] * 0.3) - fdep[i]) * Math.min(1, dt * 0.9);
		put4(FA, i, fx[i], fy[i], fang[i], fph[i]);
		put4(FB, i, fdep[i], 1 - col * 0.55, fbend[i], VARIETY[i] + Math.min(0.99, 0.3 + fspd[i] / m * 0.35 + Math.abs(fbend[i]) * 0.2));
	}
}

function addRipple(x, y, strength) {
	let k = 0;
	for (let i = 1; i < RN; i++) if (RP[k * 4 + 2] >= 0 && (RP[i * 4 + 2] < 0 || RP[i * 4 + 2] > RP[k * 4 + 2])) k = i;
	put4(RP, k, x, y, 0, strength);
}

// A tap scatters the koi within reach away from it; they dive a little as they dart
function startle(x, y) {
	const m = FISH_SIZE;
	for (let i = 0; i < N; i++) {
		const dx = fx[i] - x, dy = fy[i] - y, d = Math.hypot(dx, dy) || 1;
		if (d > 320) continue;
		fdart[i] = Math.max(fdart[i], 1 - d / 400);
		ftx[i] = clamp(fx[i] + dx / d * m * 7, m, w - m);
		fty[i] = clamp(fy[i] + dy / d * m * 7, m, h - m);
		ftime[i] = 4;
	}
}

function updateWater(dt) {
	for (let i = 2; i < RN * 4; i += 4) if (RP[i] >= 0) RP[i] = RP[i] + dt > 4 ? -1 : RP[i] + dt;
	if (KISS_EVERY > 0 && !reduced && (kissWait -= dt) <= 0) {
		kissWait = KISS_EVERY * (0.6 + Math.random() * 0.8);
		const i = Math.floor(Math.random() * N);
		if (inColumn(fx[i]) < 0.15 && fdep[i] < 0.5) addRipple(fx[i] + Math.cos(fang[i]) * FISH_SIZE, fy[i] + Math.sin(fang[i]) * FISH_SIZE, 0.45);
	}
	for (let i = 0; i < P; i++) {
		put4(PD, i, w * PADS[i * 2] + Math.sin(time * 0.07 + i * 2.1) * 7, h * PADS[i * 2 + 1] + Math.cos(time * 0.05 + i) * 5, 36 + ((i * 37) % 22), i * 1.9 + Math.sin(time * 0.03 + i) * 0.25);
	}
}

function frame(now) {
	requestAnimationFrame(frame);
	if (!program || gl.isContextLost()) return;
	if (last && now - last < 1000 / MAX_FPS - 2) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	const sdt = dt * SPEED * (reduced ? REDUCED_SPEED : 1);
	time = (time + sdt) % 2513.27; // 800 pi keeps the koi and pad sines seamless
	mouse.amount = Math.max(0, mouse.amount - dt * 0.45);
	updateFish(sdt);
	updateWater(sdt);
	gl.uniform2f(loc.u_res, canvas.width, canvas.height);
	gl.uniform2f(loc.u_col, colX(), colHalf());
	gl.uniform1f(loc.u_scale, canvas.width / Math.max(1, w));
	gl.uniform1f(loc.u_time, time);
	gl.uniform1f(loc.u_dark, dark);
	gl.uniform4fv(loc.u_fa, FA);
	gl.uniform4fv(loc.u_fb, FB);
	gl.uniform4fv(loc.u_rip, RP);
	gl.uniform4fv(loc.u_pad, PD);
	gl.uniform3fv(loc.u_c, COL);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function start() {
	const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
	gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
	if (!gl) {
		console.warn('Koi Pond: WebGL is not available, so the pond is not drawn.');
		return;
	}
	canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); program = null; });
	canvas.addEventListener('webglcontextrestored', () => {
		try { setup(); } catch (err) { console.error('Koi Pond:', err.message); }
	});
	try {
		setup();
		requestAnimationFrame(frame);
	} catch (err) {
		console.error('Koi Pond:', err.message);
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
			seedFish();
			updateWater(0);
			start();
			break;
		case 'resize':
			w = d.width;
			h = d.height;
			for (let i = 0; i < N; i++) {
				fx[i] = clamp(fx[i], 0, w);
				fy[i] = clamp(fy[i], 0, h);
				pickTarget(i);
			}
			if (canvas) size();
			break;
		case 'theme':
			applyTheme(d);
			break;
		case 'motion':
			reduced = !!d.reducedMotion;
			if (reduced) { RP.fill(-1); fdart.fill(0); }
			break;
		case 'layout':
			column = d.column || null;
			for (let i = 0; i < N; i++) pickTarget(i);
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.amount = 1;
			break;
		case 'mousedown':
			if (reduced || STARTLE <= 0 || SPEED <= 0) break;
			addRipple(d.x, d.y, Math.min(1, 0.5 + STARTLE * 0.5));
			startle(d.x, d.y);
			break;
	}
};
