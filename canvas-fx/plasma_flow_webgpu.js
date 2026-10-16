/**
 * Title: Plasma Flow (WebGPU)
 * Description: Domain-warped plasma currents in your theme's accent colors, drawn with a WebGPU shader (soft drifting color blobs where WebGPU is missing), that thin behind the chat and bend toward the cursor with a fading glow.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const FLOW_SPEED    = 0.15;  // how fast the plasma currents drift (0-0.6)
const WARP          = 4;     // domain-warp strength; higher is more turbulent (0-8)
const MOUSE_GLOW    = 0.6;   // brightness of the light that follows the cursor (0-1.5)
const CURSOR_PULL   = 1;     // how far the currents bend toward the cursor (0-2)
const DIM           = 0.85;  // overall strength, so it reads as a background (0-1)
const REDUCED_SPEED = 0.15;  // share of the flow kept when the viewer asks to reduce motion (0-1)
const CENTER_CALM   = 0.8;   // how much the plasma thins behind the chat column (0-1)
const BAND_WIDTH    = 520;   // half-width of the calm band when the page has no chat column, in px (300-900)
const RENDER_SCALE  = 0.5;   // resolution of the plasma; it is soft, so half is plenty (0.25-1)
const MAX_FPS       = 30;    // frame cap; the currents move slowly (15-60)
const FOLLOW_THEME  = true;  // blend the theme's three accents; off cycles a rainbow palette
/* ──────────────────────────────────────────── */

const WGSL = `
struct U { a : vec4f, b : vec4f, c : vec4f, c1 : vec4f, c2 : vec4f, c3 : vec4f };
@group(0) @binding(0) var<uniform> u : U;
@vertex fn vs(@builtin(vertex_index) i : u32) -> @builtin(position) vec4f {
	var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
	return vec4f(p[i], 0.0, 1.0);
}
fn hash(p0 : vec2f) -> f32 { var p = fract(p0 * vec2f(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
fn noise(p : vec2f) -> f32 {
	let i = floor(p); let f = fract(p); let w = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), w.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), w.x), w.y);
}
fn fbm(p0 : vec2f) -> f32 {
	var p = p0; var v = 0.0; var a = 0.5;
	let m = mat2x2f(1.6, 1.2, -1.2, 1.6);
	for (var i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
	return v;
}
fn pal(t : f32) -> vec3f { return 0.5 + 0.5 * cos(6.28318 * (vec3f(t) + vec3f(0.0, 0.33, 0.67))); }
fn accents(t : f32) -> vec3f {
	let w = 0.5 + 0.5 * cos(6.28318 * (vec3f(t) - vec3f(0.0, 0.3333, 0.6667)));
	let k = w * w;
	return (u.c1.rgb * k.x + u.c2.rgb * k.y + u.c3.rgb * k.z) / (k.x + k.y + k.z);
}
@fragment fn fs(@builtin(position) frag : vec4f) -> @location(0) vec4f {
	let px = frag.xy / u.a.z;
	let res = u.a.xy / u.a.z;
	let s = min(res.x, res.y);
	let p = (px - 0.5 * res) / s;
	let m = (u.b.xy - 0.5 * res) / s;
	let pull = (m - p) * u.b.z * ${(CURSOR_PULL * 0.35).toFixed(4)} * exp(-length(p - m) * 2.0);
	let t = u.a.w * ${FLOW_SPEED.toFixed(4)};
	let q = vec2f(fbm(p + vec2f(0.0, t)), fbm(p + vec2f(5.2, 1.3 - t)));
	let r = vec2f(fbm(p + ${WARP.toFixed(3)} * q + vec2f(1.7, 9.2) + pull), fbm(p + ${WARP.toFixed(3)} * q + vec2f(8.3, 2.8) - pull));
	let f = fbm(p + ${WARP.toFixed(3)} * r);
	var col = select(pal(f + t), accents(f * 1.3 + q.x * 0.4 + t), u.c.z > 0.5);
	col = min(col * mix(0.95, 0.55 + 0.75 * f, u.b.w), vec3f(1.0));
	let band = abs(px.x - u.c.x) / u.c.y;
	let calm = 1.0 - ${CENTER_CALM.toFixed(3)} * (1.0 - smoothstep(0.6, 1.25, band));
	let md = length(p - m);
	let g = exp(-md * 5.0) * u.b.z * ${MOUSE_GLOW.toFixed(3)};
	var a = (0.1 + 0.9 * smoothstep(0.25, 0.75, f)) * mix(0.68, 0.85, u.b.w) * calm;
	let ga = g * mix(0.3, 0.55, u.b.w) * mix(0.35, 1.0, calm);
	var rgb = col * a + u.c3.rgb * ga;
	a = clamp((a + ga) * ${DIM.toFixed(3)}, 0.0, 1.0);
	return vec4f(min(rgb * ${DIM.toFixed(3)}, vec3f(a)), a);
}`;

let canvas = null, w = 0, h = 0;
let last = 0, time = 0, reduced = false, column = null, started = false;
const mouse = { x: -10000, y: -10000, amount: 0, target: 0 };
const pal = { c1: hexToRgb('#7a8cff'), c2: hexToRgb('#c46cf0'), c3: hexToRgb('#4fd2e6'), dark: 1, follow: FOLLOW_THEME ? 1 : 0 };

// WebGPU state
let device = null, context = null, pipeline = null, bindGroup = null, uBuf = null, format = null, rebuilds = 0;
const uData = new Float32Array(24);
const attachment = { view: null, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' };
const passDesc = { colorAttachments: [attachment] };
const cmds = [null];

// Canvas 2D fallback state
let ctx = null, blob = [], glow = null, mask = null;

function hexToRgb(hex) {
	const n = parseInt(hex.slice(1), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function applyTheme(t) {
	if (!t) return;
	pal.dark = t.dark === false ? 0 : 1;
	if (FOLLOW_THEME && t.rgb) { pal.c1 = t.rgb.accent; pal.c2 = t.rgb.accent2; pal.c3 = t.rgb.accent3; }
	if (ctx) buildSprites();
}

// The chat column's center and the calm band's half-width
function colX() { return column ? column.x : w * 0.5; }
function colHalf() { return column ? column.width * 0.5 + 56 : BAND_WIDTH; }

function size() {
	canvas.width = Math.max(1, Math.round(w * RENDER_SCALE));
	canvas.height = Math.max(1, Math.round(h * RENDER_SCALE));
	if (ctx) { ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0); buildMask(); }
}

/* ── WebGPU: everything that can fail happens before the canvas is touched ── */
async function buildGPU() {
	if (!navigator.gpu) throw new Error('WebGPU is not available');
	const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
	if (!adapter) throw new Error('no GPU adapter');
	const dev = await adapter.requestDevice();
	format = navigator.gpu.getPreferredCanvasFormat();
	const module = dev.createShaderModule({ code: WGSL });
	const info = await module.getCompilationInfo();
	const errs = info.messages.filter((m) => m.type === 'error');
	if (errs.length) throw new Error('shader: ' + errs.map((m) => m.lineNum + ': ' + m.message).join('; '));
	pipeline = await dev.createRenderPipelineAsync({
		layout: 'auto',
		vertex: { module, entryPoint: 'vs' },
		fragment: { module, entryPoint: 'fs', targets: [{ format }] },
		primitive: { topology: 'triangle-list' },
	});
	uBuf = dev.createBuffer({ size: uData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	bindGroup = dev.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uBuf } }] });
	dev.addEventListener('uncapturederror', (e) => console.error('Plasma Flow:', e.error.message));
	// A lost device is rebuilt on the same context; a canvas that holds a WebGPU context can't switch to 2D
	dev.lost.then((lost) => {
		if (device !== dev) return;
		device = null;
		if (lost.reason === 'destroyed' || rebuilds >= 3) return;
		rebuilds++;
		buildGPU().catch((err) => console.error('Plasma Flow: could not rebuild WebGPU:', err.message));
	});
	if (!context) context = canvas.getContext('webgpu');
	if (!context) throw new Error('no WebGPU canvas context');
	context.configure({ device: dev, format, alphaMode: 'premultiplied' });
	device = dev;
}

function drawGPU() {
	uData[0] = canvas.width; uData[1] = canvas.height; uData[2] = canvas.width / Math.max(1, w); uData[3] = time;
	uData[4] = mouse.x; uData[5] = mouse.y; uData[6] = mouse.amount; uData[7] = pal.dark;
	uData[8] = colX(); uData[9] = colHalf(); uData[10] = pal.follow;
	uData.set(pal.c1, 12); uData.set(pal.c2, 16); uData.set(pal.c3, 20);
	device.queue.writeBuffer(uBuf, 0, uData);
	attachment.view = context.getCurrentTexture().createView();
	const encoder = device.createCommandEncoder();
	const pass = encoder.beginRenderPass(passDesc);
	pass.setPipeline(pipeline);
	pass.setBindGroup(0, bindGroup);
	pass.draw(3);
	pass.end();
	cmds[0] = encoder.finish();
	device.queue.submit(cmds);
}

/* ── Canvas 2D fallback: soft color blobs on slow drifting paths ── */
function sprite(rgb, alpha) {
	const s = 128, c = new OffscreenCanvas(s, s), g = c.getContext('2d');
	const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
	const col = Math.round(rgb[0] * 255) + ',' + Math.round(rgb[1] * 255) + ',' + Math.round(rgb[2] * 255);
	grad.addColorStop(0, 'rgba(' + col + ',' + alpha + ')');
	grad.addColorStop(0.5, 'rgba(' + col + ',' + alpha * 0.4 + ')');
	grad.addColorStop(1, 'rgba(' + col + ',0)');
	g.fillStyle = grad;
	g.fillRect(0, 0, s, s);
	return c;
}

function buildSprites() {
	const a = (pal.dark ? 0.45 : 0.28) * DIM;
	blob = [sprite(pal.c1, a), sprite(pal.c2, a), sprite(pal.c3, a)];
	glow = sprite(pal.c3, (pal.dark ? 0.4 : 0.25) * MOUSE_GLOW);
}

// One row of the calm band, stretched over the screen with destination-out
function buildMask() {
	const n = Math.max(2, Math.ceil(w / 4));
	mask = new OffscreenCanvas(n, 1);
	const m = mask.getContext('2d'), img = m.createImageData(n, 1);
	for (let i = 0; i < n; i++) {
		const b = Math.abs(i * 4 - colX()) / colHalf();
		const t = Math.min(1, Math.max(0, (b - 0.6) / 0.65));
		img.data[i * 4 + 3] = Math.round(255 * CENTER_CALM * (1 - t * t * (3 - 2 * t)));
	}
	m.putImageData(img, 0, 0);
}

function draw2D() {
	ctx.clearRect(0, 0, w, h);
	ctx.globalCompositeOperation = pal.dark ? 'lighter' : 'source-over';
	// Blobs wander in the chat area's margins beside the column, three a side
	const t = time * FLOW_SPEED * 3, r = Math.max(w, h) * 0.26;
	const lo = column ? column.left : 0, hi = column ? column.right : w;
	const le = Math.max(colX() - colHalf(), lo + w * 0.12), re = Math.min(colX() + colHalf(), hi - w * 0.12);
	for (let i = 0; i < 6; i++) {
		const sx = 0.5 + 0.5 * Math.sin(t * (0.5 + i * 0.13) + i * 2.1);
		const x = i % 2 ? re + (hi - re) * sx : lo + (le - lo) * sx;
		const y = h * (0.5 + 0.42 * Math.cos(t * (0.4 + i * 0.11) + i * 1.3));
		ctx.drawImage(blob[i % 3], x - r, y - r, r * 2, r * 2);
	}
	if (mouse.amount > 0.01) {
		ctx.globalAlpha = mouse.amount;
		ctx.drawImage(glow, mouse.x - 160, mouse.y - 160, 320, 320);
		ctx.globalAlpha = 1;
	}
	ctx.globalCompositeOperation = 'destination-out';
	ctx.drawImage(mask, 0, 0, w, h);
	ctx.globalCompositeOperation = 'source-over';
}

function start2D() {
	ctx = canvas.getContext('2d');
	if (!ctx) return;
	buildSprites();
	size();
	requestAnimationFrame(frame);
}

function frame(now) {
	requestAnimationFrame(frame);
	if (last && now - last < 1000 / MAX_FPS - 2) return;
	const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
	last = now;
	time = (time + dt * (reduced ? REDUCED_SPEED : 1)) % 3000;
	mouse.target = Math.max(0, mouse.target - dt * 0.4);
	mouse.amount += (mouse.target - mouse.amount) * Math.min(1, dt * (reduced ? 1 : 3));
	if (device && pipeline) drawGPU();
	else if (ctx) draw2D();
}

function start() {
	if (started) return;
	started = true;
	buildGPU().then(() => {
		size();
		requestAnimationFrame(frame);
	}).catch((err) => {
		if (context) { console.error('Plasma Flow:', err.message); return; }
		if (err.message.indexOf('shader') === 0) console.error('Plasma Flow:', err.message);
		start2D();
	});
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
			if (device || ctx) size();
			break;
		case 'theme':
			applyTheme(d);
			break;
		case 'motion':
			reduced = !!d.reducedMotion;
			break;
		case 'layout':
			column = d.column || null;
			if (ctx) buildMask();
			break;
		case 'mousemove':
			mouse.x = d.x;
			mouse.y = d.y;
			mouse.target = 1;
			break;
	}
};
