/**
 * Title: Deep Ocean (WebGL)
 * Description: GPU-accelerated underwater scene looking upward through deep
 *   water toward the surface. Animated caustic light patterns dance across
 *   the scene — bright network patterns formed by focused refracted light,
 *   computed via dual offset Voronoi grids multiplied together. Volumetric
 *   god rays stream down from above, swaying gently with organic flickering.
 *   Tiny marine snow particles drift slowly downward. The palette is deep
 *   oceanic blue-green with bright cyan-white caustic highlights. Mouse
 *   position acts as the light source focus above the water — caustics and
 *   rays intensify near the cursor.
 *
 *   Showcases: WebGL shaders, caustic simulation, god rays, marine snow,
 *     mousemove light source
 */

/* ────────── CONFIGURABLE ────────── */
var CAUSTIC_SCALE     = 3.0;      // caustic cell size (larger = bigger patterns)
var CAUSTIC_SPEED     = 0.35;     // caustic animation speed
var CAUSTIC_INTENSITY = 0.55;     // brightness of caustic highlights
var RAY_COUNT         = 5.0;      // number of volumetric god rays
var RAY_SWAY          = 0.4;      // how much rays sway side-to-side
var DEPTH_COLOR_R     = 0.01;     // deep water color (navy)
var DEPTH_COLOR_G     = 0.03;
var DEPTH_COLOR_B     = 0.08;
var SURFACE_COLOR_R   = 0.12;     // near-surface color (teal-blue)
var SURFACE_COLOR_G   = 0.38;
var SURFACE_COLOR_B   = 0.52;
var PARTICLE_COUNT    = 80.0;     // marine snow particle count
var PARTICLE_SPEED    = 0.08;     // marine snow fall speed
var FOG_STRENGTH      = 0.5;      // depth fog at edges
var VIGNETTE_STRENGTH = 2.2;      // deep-water tunnel vision vignette
var RAY_BRIGHTNESS    = 0.28;     // god ray intensity
/* ──────────────────────────────────── */

var canvas, gl, program;
var uTime, uRes, uMouse, uConfig, uConfig2;
var startTime = 0;
var mouseNX = 0.5, mouseNY = 0.65;
var w = 0, h = 0;

setInterval(function() { self.postMessage({ type: 'heartbeat' }); }, 1000);

/* ── Shaders ── */
var VERT = 'attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0,1);}';

var FRAG = [
'precision highp float;',
'uniform float u_time;',
'uniform vec2 u_res;',
'uniform vec2 u_mouse;',
'uniform vec4 u_cfg;',   // causticScale, causticSpeed, causticIntensity, rayCount
'uniform vec4 u_cfg2;',  // raySway, rayBrightness, particleCount, particleSpeed
'',
'// ── Hash functions ──',
'float hash21(vec2 p) {',
'  p = fract(p * vec2(123.34, 456.21));',
'  p += dot(p, p + 45.32);',
'  return fract(p.x * p.y);',
'}',
'',
'vec2 hash22(vec2 p) {',
'  vec3 a = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));',
'  a += dot(a, a.yzx + 33.33);',
'  return fract((a.xx + a.yz) * a.zy);',
'}',
'',
'float hash31(vec3 p) {',
'  p = fract(p * 0.3183099 + 0.1);',
'  p *= 17.0;',
'  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));',
'}',
'',
'// ── Value noise (2D) ──',
'float vnoise(vec2 p) {',
'  vec2 i = floor(p), f = fract(p);',
'  f = f * f * (3.0 - 2.0 * f);',
'  float a = hash21(i);',
'  float b = hash21(i + vec2(1.0, 0.0));',
'  float c = hash21(i + vec2(0.0, 1.0));',
'  float d = hash21(i + vec2(1.0, 1.0));',
'  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
'}',
'',
'// ── FBM (5 octaves) ──',
'float fbm(vec2 p) {',
'  float f = 0.0, a = 0.5;',
'  for (int i = 0; i < 5; i++) {',
'    f += a * vnoise(p);',
'    p = p * 2.03 + vec2(0.17, -0.13);',
'    a *= 0.48;',
'  }',
'  return f;',
'}',
'',
'// ── Voronoi-like caustic cell distance ──',
'// Returns the minimum distance to cell centers for caustic pattern',
'float voronoiDist(vec2 uv, float t) {',
'  vec2 id = floor(uv);',
'  float minD = 1.0;',
'  for (int y = -1; y <= 1; y++) {',
'    for (int x = -1; x <= 1; x++) {',
'      vec2 neighbor = vec2(float(x), float(y));',
'      vec2 cellId = id + neighbor;',
'      vec2 rnd = hash22(cellId);',
'      // Animate cell centers in smooth loops',
'      vec2 offset = 0.5 + 0.4 * sin(t * 0.8 + rnd * 6.2831);',
'      vec2 cellPos = neighbor + offset - fract(uv);',
'      float d = dot(cellPos, cellPos);',
'      minD = min(minD, d);',
'    }',
'  }',
'  return sqrt(minD);',
'}',
'',
'// ── Caustics: multiply two offset Voronoi grids ──',
'float caustics(vec2 uv, float scale, float speed, float t) {',
'  float t1 = t * speed;',
'  float t2 = t * speed * 0.7;',
'  // Grid 1 — slightly rotated',
'  float c1 = cos(0.3), s1 = sin(0.3);',
'  vec2 uv1 = vec2(uv.x * c1 - uv.y * s1, uv.x * s1 + uv.y * c1) * scale;',
'  float d1 = voronoiDist(uv1 + vec2(t1 * 0.2, t1 * 0.15), t1);',
'  // Grid 2 — different rotation and speed',
'  float c2 = cos(-0.5), s2 = sin(-0.5);',
'  vec2 uv2 = vec2(uv.x * c2 - uv.y * s2, uv.x * s2 + uv.y * c2) * scale * 1.3;',
'  float d2 = voronoiDist(uv2 + vec2(-t2 * 0.18, t2 * 0.12), t2);',
'  // Multiply: product is bright only where BOTH grids have cell edges nearby',
'  float caustic = d1 * d2;',
'  // Sharpen the network pattern',
'  caustic = pow(caustic, 0.6);',
'  // Invert so network lines are bright',
'  caustic = 1.0 - smoothstep(0.0, 0.25, caustic);',
'  return caustic * caustic;',
'}',
'',
'// ── God rays ──',
'float godRays(vec2 uv, float t, float rayCount, float sway, float brightness) {',
'  float rays = 0.0;',
'  for (float i = 0.0; i < 8.0; i++) {',
'    if (i >= rayCount) break;',
'    // Distribute rays across the top',
'    float baseX = (i + 0.5) / rayCount;',
'    // Sway each ray with different phase',
'    float phase = i * 1.618 + 0.5;',
'    float rayX = baseX + sin(t * 0.25 + phase) * sway * 0.1',
'                       + sin(t * 0.13 + phase * 2.3) * sway * 0.05;',
'    // Gaussian cross-section',
'    float dx = uv.x - rayX;',
'    float width = 0.03 + 0.02 * sin(t * 0.3 + i * 2.0);',
'    float ray = exp(-dx * dx / (2.0 * width * width));',
'    // Taper toward the bottom (stronger at top)',
'    ray *= smoothstep(0.0, 0.7, uv.y);',
'    // Fade out gently at the very top',
'    ray *= smoothstep(1.0, 0.85, uv.y);',
'    // Organic flickering via noise',
'    float flicker = 0.7 + 0.3 * vnoise(vec2(i * 3.0, t * 0.5));',
'    ray *= flicker;',
'    rays += ray * brightness;',
'  }',
'  return rays;',
'}',
'',
'// ── Marine snow particles ──',
'float marineSnow(vec2 uv, float t, float count, float speed) {',
'  float particles = 0.0;',
'  for (float i = 0.0; i < 120.0; i++) {',
'    if (i >= count) break;',
'    // Deterministic position from hash',
'    float h1 = hash21(vec2(i, i * 17.3));',
'    float h2 = hash21(vec2(i * 31.7, i * 7.1));',
'    float h3 = hash21(vec2(i * 53.1, i * 11.9));',
'    // Horizontal position with slight drift',
'    float px = h1 + sin(t * 0.1 * (0.5 + h3) + h2 * 6.28) * 0.02;',
'    px = fract(px);',
'    // Vertical: drift downward, wrap around',
'    float py = fract(h2 - t * speed * (0.5 + h3 * 0.5));',
'    // Distance to particle',
'    vec2 diff = uv - vec2(px, py);',
'    diff.x *= u_res.x / u_res.y; // aspect correction',
'    float d = length(diff);',
'    // Size varies per particle',
'    float sz = 0.001 + h3 * 0.0015;',
'    float p = smoothstep(sz, sz * 0.3, d);',
'    // Slight twinkle',
'    p *= 0.5 + 0.5 * sin(t * 2.0 + h1 * 50.0);',
'    particles += p;',
'  }',
'  return clamp(particles, 0.0, 1.0);',
'}',
'',
'void main() {',
'  vec2 uv = gl_FragCoord.xy / u_res;',
'  vec2 p = (2.0 * gl_FragCoord.xy - u_res) / min(u_res.x, u_res.y);',
'  float t = u_time;',
'  float aspect = u_res.x / u_res.y;',
'',
'  // Config unpacking',
'  float cScale = u_cfg.x;',
'  float cSpeed = u_cfg.y;',
'  float cIntensity = u_cfg.z;',
'  float rayCount = u_cfg.w;',
'  float raySway = u_cfg2.x;',
'  float rayBright = u_cfg2.y;',
'  float partCount = u_cfg2.z;',
'  float partSpeed = u_cfg2.w;',
'',
'  // ── Base ocean gradient ──',
'  // Dark navy at bottom edges → deep teal in center → lighter blue-green at top',
'  vec3 depthCol = vec3(' + DEPTH_COLOR_R.toFixed(3) + ', ' + DEPTH_COLOR_G.toFixed(3) + ', ' + DEPTH_COLOR_B.toFixed(3) + ');',
'  vec3 surfCol = vec3(' + SURFACE_COLOR_R.toFixed(3) + ', ' + SURFACE_COLOR_G.toFixed(3) + ', ' + SURFACE_COLOR_B.toFixed(3) + ');',
'  vec3 midCol = vec3(0.02, 0.10, 0.22);',
'',
'  // Vertical gradient: bottom is dark, top is lighter',
'  float vertGrad = uv.y;',
'  vec3 col;',
'  if (vertGrad < 0.4) {',
'    col = mix(depthCol, midCol, vertGrad / 0.4);',
'  } else {',
'    col = mix(midCol, surfCol, (vertGrad - 0.4) / 0.6);',
'  }',
'',
'  // Radial darkening — edges are deeper/darker',
'  float radial = length(p) * 0.5;',
'  col = mix(col, depthCol * 0.6, smoothstep(0.3, 1.5, radial) * ' + FOG_STRENGTH.toFixed(2) + ');',
'',
'  // ── Subtle water volume noise — organic depth variation ──',
'  float waterNoise = fbm(p * 1.5 + vec2(t * 0.03, t * 0.02));',
'  col += vec3(0.01, 0.03, 0.05) * waterNoise;',
'',
'  // Domain-warped color variation for organic feel',
'  float warp1 = fbm(p * 0.8 + t * 0.02);',
'  float warp2 = fbm(p * 0.8 + warp1 * 1.2 + vec2(0.0, t * 0.015));',
'  col += vec3(0.005, 0.02, 0.03) * warp2;',
'',
'  // ── Mouse influence — light source position ──',
'  vec2 lightPos = u_mouse;',
'  float lightDist = length(uv - lightPos);',
'  float lightFocus = exp(-lightDist * lightDist * 3.0);',
'',
'  // Subtle ambient brightening near mouse',
'  col += vec3(0.02, 0.05, 0.06) * lightFocus;',
'',
'  // ── Caustics — multi-scale ──',
'  // Scale 1: large lazy patterns',
'  float c1 = caustics(p + vec2(t * 0.01, 0.0), cScale, cSpeed, t);',
'  // Scale 2: medium detail',
'  float c2 = caustics(p * 1.7 + vec2(-t * 0.008, t * 0.005), cScale * 1.6, cSpeed * 1.2, t + 5.0);',
'  // Scale 3: fine shimmer',
'  float c3 = caustics(p * 3.2 + vec2(t * 0.006, -t * 0.004), cScale * 2.5, cSpeed * 0.8, t + 10.0);',
'',
'  float causticTotal = c1 * 0.55 + c2 * 0.3 + c3 * 0.15;',
'',
'  // Caustics are stronger near the top (closer to surface light)',
'  causticTotal *= smoothstep(0.0, 0.7, uv.y) * 0.7 + 0.3;',
'',
'  // Caustics intensify near mouse (light source)',
'  causticTotal *= 0.6 + lightFocus * 1.5;',
'',
'  // Warm cyan-white caustic highlight color (simulating sunlight)',
'  vec3 causticCol = mix(vec3(0.3, 0.7, 0.8), vec3(0.85, 0.95, 1.0), causticTotal);',
'  col += causticCol * causticTotal * cIntensity;',
'',
'  // ── God rays ──',
'  float rays = godRays(uv, t, rayCount, raySway, rayBright);',
'',
'  // Rays intensify near mouse light source',
'  float mouseRayBoost = 1.0 + lightFocus * 0.8;',
'  rays *= mouseRayBoost;',
'',
'  // Ray color: slightly warm cyan at top, fading to deep blue',
'  vec3 rayCol = mix(vec3(0.15, 0.35, 0.45), vec3(0.4, 0.75, 0.85), uv.y);',
'  col += rayCol * rays;',
'',
'  // ── Marine snow ──',
'  float snow = marineSnow(uv, t, partCount, partSpeed);',
'  // Snow is slightly brighter in god ray areas',
'  float snowBright = 0.4 + rays * 1.5;',
'  col += vec3(0.6, 0.75, 0.8) * snow * snowBright;',
'',
'  // ── Surface shimmer at top edge ──',
'  float surfShimmer = smoothstep(0.85, 1.0, uv.y);',
'  float shimmerNoise = fbm(vec2(p.x * 5.0, t * 0.5)) * 0.5 + 0.5;',
'  col += vec3(0.08, 0.18, 0.22) * surfShimmer * shimmerNoise;',
'',
'  // Bright wavering surface line at the very top',
'  float surfLine = smoothstep(0.96, 1.0, uv.y);',
'  float surfWave = 0.5 + 0.5 * sin(p.x * 8.0 + t * 0.8);',
'  col += vec3(0.1, 0.2, 0.25) * surfLine * surfWave;',
'',
'  // ── Depth fog — edges are hazier/bluer ──',
'  float fog = smoothstep(0.5, 1.8, length(p));',
'  col = mix(col, depthCol * 1.2 + vec3(0.01, 0.02, 0.04), fog * ' + FOG_STRENGTH.toFixed(2) + ');',
'',
'  // ── Vignette (strong — deep-water tunnel vision) ──',
'  float vig = 1.0 - dot(uv - 0.5, uv - 0.5) * ' + VIGNETTE_STRENGTH.toFixed(1) + ';',
'  col *= max(vig, 0.0);',
'',
'  // ── Film grain ──',
'  float grain = hash31(vec3(gl_FragCoord.xy, t * 100.0)) * 0.02;',
'  col += grain;',
'',
'  // Clamp for safety',
'  col = clamp(col, 0.0, 1.0);',
'',
'  gl_FragColor = vec4(col, 1.0);',
'}'
].join('\n');

/* ── GL helpers ── */
function compile(type, src) {
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
    var vs = compile(gl.VERTEX_SHADER, VERT);
    var fs = compile(gl.FRAGMENT_SHADER, FRAG);

    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error('Program link: ' + gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);

    // Fullscreen triangle
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);

    var aPos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // Uniform locations
    uTime = gl.getUniformLocation(program, 'u_time');
    uRes = gl.getUniformLocation(program, 'u_res');
    uMouse = gl.getUniformLocation(program, 'u_mouse');
    uConfig = gl.getUniformLocation(program, 'u_cfg');
    uConfig2 = gl.getUniformLocation(program, 'u_cfg2');

    startTime = performance.now() / 1000;
}

/* ── Render ── */
function render() {
    var t = performance.now() / 1000 - startTime;

    gl.viewport(0, 0, w, h);
    gl.uniform1f(uTime, t);
    gl.uniform2f(uRes, w, h);
    gl.uniform2f(uMouse, mouseNX, mouseNY);
    gl.uniform4f(uConfig, CAUSTIC_SCALE, CAUSTIC_SPEED, CAUSTIC_INTENSITY, RAY_COUNT);
    gl.uniform4f(uConfig2, RAY_SWAY, RAY_BRIGHTNESS, PARTICLE_COUNT, PARTICLE_SPEED);

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
                var ctx2d = canvas.getContext('2d');
                ctx2d.fillStyle = '#010316';
                ctx2d.fillRect(0, 0, w, h);
                ctx2d.fillStyle = '#ff4466';
                ctx2d.font = '16px monospace';
                ctx2d.textAlign = 'center';
                ctx2d.fillText('WebGL not available in this browser', w / 2, h / 2);
                return;
            }

            try {
                initGL();
                render();
            } catch (err) {
                var ctx2d = canvas.getContext('2d');
                if (ctx2d) {
                    ctx2d.fillStyle = '#010316';
                    ctx2d.fillRect(0, 0, w, h);
                    ctx2d.fillStyle = '#ff4466';
                    ctx2d.font = '14px monospace';
                    ctx2d.textAlign = 'center';
                    ctx2d.fillText('Shader error: ' + err.message, w / 2, h / 2);
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
