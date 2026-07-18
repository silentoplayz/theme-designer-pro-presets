/**
 * Title: Nebula (WebGL)
 * Description: GPU-accelerated cosmic nebula using WebGL fragment shaders
 *   in a Worker. Demonstrates that Canvas FX scripts can use WebGL — not
 *   just the 2D canvas API. Renders multi-octave domain-warped fractal
 *   noise through a color palette, creating flowing organic nebula patterns
 *   that 2D canvas simply cannot produce at this quality/performance.
 *   Mouse position acts as a gravity lens distorting the nebula field.
 *
 *   This is the first Canvas FX script to use WebGL.
 *
 *   Showcases: WebGL in OffscreenCanvas Worker, GLSL shaders, mousemove
 */

/* ────────── CONFIGURABLE ────────── */
var SPEED           = 0.12;      // animation speed
var WARP_INTENSITY  = 1.4;       // domain warp strength (higher = more organic)
var NOISE_OCTAVES   = 6;         // FBM detail level (2-8, higher = finer detail)
var MOUSE_STRENGTH  = 0.12;     // mouse distortion intensity
var VIGNETTE        = 1.4;       // edge darkening (0 = none)
var BRIGHTNESS      = 1.1;       // overall brightness multiplier
var PALETTE_SPEED   = 0.08;      // color palette drift speed
/* ──────────────────────────────────── */

var canvas, gl, program;
var uTime, uResolution, uMouse, uConfig;
var startTime = 0;
var mouseNX = 0.5, mouseNY = 0.5; // normalized 0-1
var w = 0, h = 0;

setInterval(function() { self.postMessage({ type: 'heartbeat' }); }, 1000);

/* ── Shaders ── */
var VERT_SRC = [
    'attribute vec2 a_pos;',
    'void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }'
].join('\n');

var FRAG_SRC = [
    'precision highp float;',
    '',
    'uniform float u_time;',
    'uniform vec2 u_resolution;',
    'uniform vec2 u_mouse;',
    'uniform vec4 u_config;', // x=warpIntensity, y=vignette, z=brightness, w=paletteSpeed
    '',
    '// ── Hash-based 3D noise ──',
    'float hash(vec3 p) {',
    '    p = fract(p * 0.3183099 + 0.1);',
    '    p *= 17.0;',
    '    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));',
    '}',
    '',
    'float noise(vec3 x) {',
    '    vec3 i = floor(x);',
    '    vec3 f = fract(x);',
    '    f = f * f * (3.0 - 2.0 * f);',
    '    return mix(',
    '        mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),',
    '            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),',
    '        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),',
    '            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),',
    '        f.z);',
    '}',
    '',
    '// ── Fractal Brownian Motion ──',
    'float fbm(vec3 p) {',
    '    float f = 0.0, a = 0.5;',
    '    for (int i = 0; i < ' + NOISE_OCTAVES + '; i++) {',
    '        f += a * noise(p);',
    '        p = p * 2.01 + vec3(0.13, -0.27, 0.05);', // slight offset prevents axis alignment
    '        a *= 0.49;',
    '    }',
    '    return f;',
    '}',
    '',
    '// ── Iq color palette (a + b * cos(2π(c*t + d))) ──',
    'vec3 palette(float t) {',
    '    vec3 a = vec3(0.5, 0.5, 0.5);',
    '    vec3 b = vec3(0.5, 0.5, 0.5);',
    '    vec3 c = vec3(1.0, 1.0, 1.0);',
    '    vec3 d = vec3(0.263, 0.416, 0.557);', // deep space palette
    '    return a + b * cos(6.28318 * (c * t + d));',
    '}',
    '',
    'void main() {',
    '    vec2 uv = gl_FragCoord.xy / u_resolution;',
    '    float aspect = u_resolution.x / u_resolution.y;',
    '    vec2 p = (2.0 * gl_FragCoord.xy - u_resolution) / min(u_resolution.x, u_resolution.y);',
    '',
    '    float t = u_time;',
    '    float warp = u_config.x;',
    '',
    '    // Mouse gravity lens',
    '    vec2 mp = (2.0 * u_mouse * u_resolution - u_resolution) / min(u_resolution.x, u_resolution.y);',
    '    float md = length(p - mp);',
    '    p += (mp - p) * ' + MOUSE_STRENGTH.toFixed(3) + ' / (1.0 + md * md * 3.0);',
    '',
    '    // Domain warping — three passes for deep organic structure',
    '    vec3 q = vec3(p * 1.2, t);',
    '    float f1 = fbm(q);',
    '    float f2 = fbm(q + vec3(f1 * warp, f1 * warp * 0.7, 0.3));',
    '    float f3 = fbm(q + vec3(f2 * warp * 1.2, f2 * warp * 0.9, f1 * 0.4 + t * 0.3));',
    '',
    '    // Color from palette — drift over time',
    '    vec3 col = palette(f3 * 0.7 + t * u_config.w);',
    '',
    '    // Add subtle highlight veins',
    '    float vein = smoothstep(0.48, 0.52, f2) * 0.3;',
    '    col += vec3(vein * 0.6, vein * 0.8, vein);',
    '',
    '    // Brightness',
    '    col *= u_config.z;',
    '',
    '    // Depth fade toward edges',
    '    float fade = 1.0 - smoothstep(0.6, 2.2, length(p));',
    '    col *= mix(1.0, fade, 0.6);',
    '',
    '    // Vignette',
    '    float vig = 1.0 - dot(uv - 0.5, uv - 0.5) * u_config.y;',
    '    col *= max(vig, 0.0);',
    '',
    '    // Subtle film grain',
    '    float grain = hash(vec3(gl_FragCoord.xy, t * 100.0)) * 0.03;',
    '    col += grain;',
    '',
    '    gl_FragColor = vec4(col, 1.0);',
    '}'
].join('\n');

/* ── GL helpers ── */
function compileShader(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        var err = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new Error('Shader compile: ' + err);
    }
    return s;
}

function initGL() {
    var vs = compileShader(gl.VERTEX_SHADER, VERT_SRC);
    var fs = compileShader(gl.FRAGMENT_SHADER, FRAG_SRC);

    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error('Program link: ' + gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);

    // Fullscreen triangle (covers viewport with a single triangle — no quad seam)
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);

    var aPos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // Uniform locations
    uTime = gl.getUniformLocation(program, 'u_time');
    uResolution = gl.getUniformLocation(program, 'u_resolution');
    uMouse = gl.getUniformLocation(program, 'u_mouse');
    uConfig = gl.getUniformLocation(program, 'u_config');

    startTime = performance.now() / 1000;
}

/* ── Render ── */
function render() {
    var t = (performance.now() / 1000 - startTime) * SPEED;

    gl.viewport(0, 0, w, h);
    gl.uniform1f(uTime, t);
    gl.uniform2f(uResolution, w, h);
    gl.uniform2f(uMouse, mouseNX, mouseNY);
    gl.uniform4f(uConfig, WARP_INTENSITY, VIGNETTE, BRIGHTNESS, PALETTE_SPEED);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    requestAnimationFrame(render);
}

/* ── Message handler ── */
self.onmessage = function(e) {
    switch (e.data.type) {
        case 'init':
            canvas = e.data.canvas;
            w = e.data.width;
            h = e.data.height;
            canvas.width = w;
            canvas.height = h;

            // Try WebGL2 first, then WebGL1
            gl = canvas.getContext('webgl2');
            if (!gl) gl = canvas.getContext('webgl');
            if (!gl) {
                // Ultimate fallback: 2D message
                var ctx2d = canvas.getContext('2d');
                ctx2d.fillStyle = '#0a0a1a';
                ctx2d.fillRect(0, 0, w, h);
                ctx2d.fillStyle = '#ff4466';
                ctx2d.font = '16px monospace';
                ctx2d.textAlign = 'center';
                ctx2d.fillText('WebGL not available in this browser', w/2, h/2);
                return;
            }

            try {
                initGL();
                render();
            } catch(err) {
                // Shader compile error fallback
                var ctx2d = canvas.getContext('2d');
                if (ctx2d) {
                    ctx2d.fillStyle = '#0a0a1a';
                    ctx2d.fillRect(0, 0, w, h);
                    ctx2d.fillStyle = '#ff4466';
                    ctx2d.font = '14px monospace';
                    ctx2d.textAlign = 'center';
                    ctx2d.fillText('WebGL error: ' + err.message, w/2, h/2);
                }
            }
            break;

        case 'resize':
            w = e.data.width;
            h = e.data.height;
            canvas.width = w;
            canvas.height = h;
            break;

        case 'mousemove':
            mouseNX = e.data.x / w;
            mouseNY = 1.0 - (e.data.y / h); // flip Y for GL coordinates
            break;
    }
};
