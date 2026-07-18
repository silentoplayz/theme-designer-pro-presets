/**
 * Title: Context Reactor (WebGL)
 * Description: A GPU-shaded plasma core that charges up with your conversation.
 *   When the chat is empty the reactor idles — a cool, dim, slow-drifting blue
 *   nebula. As context fills, it heats through amber into a turbulent red core:
 *   the domain-warped noise grows more violent, the central glow brightens and
 *   pulses faster, and filaments flare outward. Past ~85% of the context limit
 *   it throws red warning flares. Mouse proximity adds a soft plasma bloom.
 *
 *   Combines two Theme Designer Pro capabilities that are usually separate:
 *   real-time GPU fragment shaders AND the context data channel. Fully
 *   autonomous in the background Worker (no DOM), so it reports as
 *   Background Worker + WebGL + Context.
 *
 *   Context-aware: requires the Theme Designer Pro context data channel.
 *   Showcases: WebGL shaders, context data channel, mousemove
 */

/* ---------- CONFIGURABLE VARIABLES ---------- */
var MAX_TOKENS       = 128000;  // your model's context limit (adjust per model)
var GROWTH_SPEED     = 1;       // multiplier for testing (set to 10-50 for fast preview)
var SMOOTHING        = 0.02;    // how quickly the reactor eases toward the new level (0-1)
var TURBULENCE       = 1.4;     // peak domain-warp chaos when context is full
var ANIMATION_SPEED  = 1.0;     // overall time scale
/* -------------------------------------------- */

var canvas, gl, program;
var uTime, uRes, uCtx, uMouse, uCfg;
var startTime = 0;
var w = 0, h = 0;
var mouseNX = 0.5, mouseNY = 0.5;

// Context state
var estimatedTokens = 0;
var targetRatio = 0;   // where the reactor is heading (0-1)
var ctxRatio = 0;      // smoothed value actually rendered (0-1)

setInterval(function() { self.postMessage({ type: 'heartbeat' }); }, 1000);

var VERT = 'attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0,1);}';

var FRAG = [
'precision highp float;',
'uniform float u_time;',
'uniform vec2  u_res;',
'uniform float u_ctx;',    // smoothed context ratio 0-1
'uniform vec2  u_mouse;',
'uniform vec4  u_cfg;',    // x = turbulence
'',
'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }',
'',
'float vnoise(vec2 p){',
'  vec2 i = floor(p), f = fract(p);',
'  vec2 u = f*f*(3.0-2.0*f);',
'  float a = hash(i);',
'  float b = hash(i + vec2(1.0,0.0));',
'  float c = hash(i + vec2(0.0,1.0));',
'  float d = hash(i + vec2(1.0,1.0));',
'  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);',
'}',
'',
'float fbm(vec2 p){',
'  float s = 0.0, amp = 0.5;',
'  for(int i=0;i<5;i++){ s += amp*vnoise(p); p *= 2.02; amp *= 0.5; }',
'  return s;',
'}',
'',
'// Domain warp: distort the sampling space by two fbm fields',
'vec2 warp(vec2 p, float t, float k){',
'  vec2 q = vec2(fbm(p + vec2(0.0, t*0.10)), fbm(p + vec2(5.2, 1.3 - t*0.10)));',
'  return p + k*q;',
'}',
'',
'void main(){',
'  vec2 uv = (2.0*gl_FragCoord.xy - u_res) / min(u_res.x, u_res.y);',
'  float t = u_time;',
'  float ctx = u_ctx;',
'  float turb = u_cfg.x;',
'',
'  // ── Domain-warped nebula field; warp strength scales with context ──',
'  float warpK = mix(0.15, turb, ctx);',
'  vec2 p = uv * 1.5 + vec2(t*0.05, 0.0);',
'  vec2 wp = warp(p, t, warpK);',
'  float n = fbm(wp * 1.5);',
'',
'  // ── Energy: brighter and denser as context fills ──',
'  float energy = n * (0.4 + ctx*1.4) + ctx*0.12;',
'',
'  // ── Heat map: cool blue → amber → hot red ──',
'  vec3 cool = vec3(0.12, 0.42, 0.90);',
'  vec3 warm = vec3(1.00, 0.60, 0.15);',
'  vec3 hot  = vec3(1.00, 0.16, 0.24);',
'  vec3 baseCol = mix(cool, warm, smoothstep(0.0, 0.5, ctx));',
'  baseCol = mix(baseCol, hot, smoothstep(0.5, 1.0, ctx));',
'',
'  vec3 col = baseCol * energy;',
'  // Filaments: brighten where the field peaks',
'  col += baseCol * pow(max(n, 0.0), 3.0) * (0.5 + ctx);',
'',
'  // ── Central reactor core — brighter and faster-pulsing with context ──',
'  float d = length(uv);',
'  float pulseSpeed = mix(0.6, 3.2, ctx);',
'  float pulse = 0.7 + 0.3*sin(t*pulseSpeed);',
'  float core = smoothstep(1.25, 0.0, d) * (0.15 + ctx*0.85) * pulse;',
'  col += mix(warm, hot, ctx) * core * 0.5;',
'',
'  // ── Warning flares past ~85% ──',
'  float warn = smoothstep(0.85, 1.0, ctx);',
'  if(warn > 0.0){',
'    float flare = smoothstep(0.55, 0.0, abs(fbm(uv*3.0 + t*0.6) - 0.5));',
'    col += vec3(0.75, 0.04, 0.06) * warn * flare * (0.5 + 0.5*sin(t*8.0 + n*10.0));',
'  }',
'',
'  // ── Mouse plasma bloom ──',
'  vec2 mp = (2.0*u_mouse*u_res - u_res) / min(u_res.x, u_res.y);',
'  float md = length(uv - mp);',
'  col += mix(warm, cool, ctx) * smoothstep(0.45, 0.0, md) * 0.25;',
'',
'  // ── Overall level: dim when idle, bright when full ──',
'  col *= mix(0.35, 1.25, ctx);',
'',
'  // ── Vignette + grain ──',
'  vec2 vUV = gl_FragCoord.xy / u_res;',
'  float vig = 1.0 - dot(vUV-0.5, vUV-0.5)*1.3;',
'  col *= max(vig, 0.0);',
'  col += (hash(gl_FragCoord.xy + t) - 0.5) * 0.025;',
'  col = max(col, vec3(0.01, 0.012, 0.02));',
'',
'  gl_FragColor = vec4(col, 1.0);',
'}'
].join('\n');

/* ── GL setup ── */
function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(s));
    }
    return s;
}

function initGL() {
    var vs = compile(gl.VERTEX_SHADER, VERT);
    var fs = compile(gl.FRAGMENT_SHADER, FRAG);
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    var a = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);

    uTime  = gl.getUniformLocation(program, 'u_time');
    uRes   = gl.getUniformLocation(program, 'u_res');
    uCtx   = gl.getUniformLocation(program, 'u_ctx');
    uMouse = gl.getUniformLocation(program, 'u_mouse');
    uCfg   = gl.getUniformLocation(program, 'u_cfg');
    startTime = performance.now() / 1000;
}

function render() {
    // Ease the rendered ratio toward the target for smooth heating/cooling
    ctxRatio += (targetRatio - ctxRatio) * SMOOTHING;

    var t = (performance.now() / 1000 - startTime) * ANIMATION_SPEED;
    gl.viewport(0, 0, w, h);
    gl.uniform1f(uTime, t);
    gl.uniform2f(uRes, w, h);
    gl.uniform1f(uCtx, ctxRatio);
    gl.uniform2f(uMouse, mouseNX, mouseNY);
    gl.uniform4f(uCfg, TURBULENCE, 0.0, 0.0, 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(render);
}

function fallbackMessage(msg) {
    var c = canvas.getContext('2d');
    if (!c) return;
    c.fillStyle = '#050510'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ff4466'; c.font = '13px monospace';
    c.textAlign = 'center';
    c.fillText(msg, w / 2, h / 2);
}

/* ── Message handler ── */
self.onmessage = function(e) {
    switch (e.data.type) {
        case 'init':
            canvas = e.data.canvas;
            w = e.data.width; h = e.data.height;
            canvas.width = w; canvas.height = h;
            gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            if (!gl) { fallbackMessage('WebGL not available'); return; }
            try { initGL(); render(); }
            catch (err) { fallbackMessage('Shader: ' + err.message); }
            break;

        case 'resize':
            w = e.data.width; h = e.data.height;
            if (canvas) { canvas.width = w; canvas.height = h; }
            break;

        case 'mousemove':
            mouseNX = e.data.x / w;
            mouseNY = 1.0 - (e.data.y / h);
            break;

        case 'context':
            // Prefer the exact token count from the socket channel; fall back
            // to the DOM observer's estimate.
            if (e.data.exactTokens !== undefined) {
                estimatedTokens = e.data.exactTokens;
            } else if (e.data.estimatedTokens !== undefined) {
                estimatedTokens = e.data.estimatedTokens;
            }
            targetRatio = Math.min(1, (estimatedTokens / MAX_TOKENS) * GROWTH_SPEED);
            break;
    }
};
