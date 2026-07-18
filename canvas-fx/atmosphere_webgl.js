/**
 * Title: Atmosphere (WebGL)
 * Description: A GPU-shaded sky that tracks your real local time of day. The
 *   whole atmosphere is computed analytically in a fragment shader from the
 *   current hour: pre-dawn navy warms into a pink-orange sunrise, climbs to
 *   bright midday blue, burns through a golden dusk, then deepens to a starry
 *   night with a moon. The sun and moon ride real arcs across the sky, drifting
 *   fbm clouds catch their colour, stars twinkle in and fade with daylight, and
 *   a hill silhouette anchors the horizon. Always changing, no interaction needed.
 *
 *   Combines WebGL fragment shaders with time-awareness. The Worker reads the
 *   system clock directly (native Date), so it's fully autonomous — no context
 *   or DOM channel required. Reports as Background Worker + WebGL.
 *
 *   Showcases: WebGL shaders, time-of-day awareness (native Date)
 */

/* ---------- CONFIGURABLE VARIABLES ---------- */
var PREVIEW_CYCLE = 0;   // seconds for one full 24h cycle (preview). 0 = real local time
var CLOUD_AMOUNT  = 1.0;  // 0 = clear sky, 1 = normal, 2 = overcast
var STAR_DENSITY  = 1.0;  // multiplier on how many stars appear at night
/* -------------------------------------------- */

var canvas, gl, program;
var uTime, uRes, uHour, uCfg;
var startTime = 0;
var w = 0, h = 0;

setInterval(function() { self.postMessage({ type: 'heartbeat' }); }, 1000);

var VERT = 'attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0,1);}';

var FRAG = [
'precision highp float;',
'uniform float u_time;',
'uniform vec2  u_res;',
'uniform float u_hour;',   // 0..24 local time (fractional)
'uniform vec4  u_cfg;',    // x = cloudAmount, y = starDensity
'',
'const float PI = 3.14159265;',
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
'void main(){',
'  vec2 st = gl_FragCoord.xy / u_res;',
'  float aspect = u_res.x / u_res.y;',
'  vec2 asp = vec2(aspect, 1.0);',
'  float hour = u_hour;',
'  float t = u_time;',
'  float cloudAmt = u_cfg.x;',
'  float starDen  = u_cfg.y;',
'',
'  // ── Sun geometry: 6h at east horizon, 12h at zenith, 18h at west horizon ──',
'  float sunAng = (hour - 6.0) / 12.0 * PI;',
'  float sunH = sin(sunAng);',                    // >0 day, <0 night
'  float sunFrac = clamp((hour - 6.0) / 12.0, 0.0, 1.0);',
'  vec2 sunPos = vec2(mix(0.08, 0.92, sunFrac), 0.32 + sunH*0.60);',
'',
'  float day = smoothstep(-0.12, 0.18, sunH);',   // 0 night .. 1 day
'  float twilight = exp(-pow(sunH*3.5, 2.0));',    // peaks at sunrise/sunset',
'',
'  // ── Sky palette by phase ──',
'  vec3 nightZen = vec3(0.015,0.03,0.08), nightHor = vec3(0.05,0.06,0.14);',
'  vec3 dayZen   = vec3(0.20,0.45,0.85),  dayHor   = vec3(0.65,0.82,1.00);',
'  vec3 zen = mix(nightZen, dayZen, day);',
'  vec3 hor = mix(nightHor, dayHor, day);',
'  vec3 twiHor = vec3(0.95,0.45,0.32);',           // orange-pink
'  vec3 twiZen = vec3(0.28,0.16,0.38);',           // purple
'  hor = mix(hor, twiHor, twilight*0.85);',
'  zen = mix(zen, twiZen, twilight*0.55);',
'',
'  float grad = smoothstep(0.0, 1.0, st.y);',
'  vec3 sky = mix(hor, zen, pow(grad, 0.9));',
'',
'  // Warm glow banked over the sun position near the horizon',
'  float sunGlowX = exp(-pow((st.x - sunPos.x)*2.0, 2.0));',
'  sky += twiHor * sunGlowX * twilight * (1.0 - grad) * 1.1;',
'',
'  // ── Stars (night only, above the horizon) ──',
'  vec2 sg = st * vec2(aspect, 1.0) * 90.0;',
'  vec2 sgi = floor(sg);',
'  float hs = hash(sgi);',
'  float thresh = 0.985 - starDen*0.015;',
'  float star = 0.0;',
'  if(hs > thresh){',
'    vec2 sgf = fract(sg) - 0.5;',
'    float tw = 0.5 + 0.5*sin(t*2.0 + hs*100.0);',
'    star = smoothstep(0.16, 0.0, length(sgf)) * tw;',
'  }',
'  sky += vec3(star) * (1.0 - day) * smoothstep(0.30, 0.55, st.y);',
'',
'  // ── Drifting clouds (fbm), tinted by the sky ──',
'  float cl = fbm(vec2(st.x*aspect*3.0 + t*0.02, st.y*3.0));',
'  cl = smoothstep(0.55, 0.92, cl) * smoothstep(0.26, 0.62, st.y) * cloudAmt * (0.35 + 0.65*day);',
'  vec3 cloudCol = mix(vec3(0.55,0.58,0.68), vec3(1.0,0.96,0.92), day);',
'  cloudCol = mix(cloudCol, twiHor, twilight*0.6);',
'  sky = mix(sky, cloudCol, clamp(cl, 0.0, 0.85));',
'',
'  // ── Sun disk + glow ──',
'  float sd = length((st - sunPos) * asp);',
'  if(sunH > -0.2){',
'    vec3 sunCol = mix(vec3(1.0,0.5,0.2), vec3(1.0,0.98,0.9), day);',
'    float disk = smoothstep(0.045, 0.030, sd);',
'    float glow = exp(-sd*6.0)*0.6 + exp(-sd*2.0)*0.22;',
'    float vis = smoothstep(-0.15, 0.05, sunH);',
'    sky += sunCol * (disk*1.5 + glow) * vis;',
'  }',
'',
'  // ── Moon (night): rides its own arc from dusk to dawn ──',
'  float mh = (hour < 6.0) ? hour + 24.0 : hour;',    // 18..30 window
'  float moonFrac = clamp((mh - 18.0)/12.0, 0.0, 1.0);',
'  float moonAng = moonFrac * PI;',
'  float moonH = sin(moonAng);',
'  vec2 moonPos = vec2(mix(0.10, 0.90, moonFrac), 0.32 + moonH*0.58);',
'  float mdd = length((st - moonPos) * asp);',
'  if(moonH > -0.1 && day < 0.6){',
'    float mdisk = smoothstep(0.052, 0.036, mdd);',
'    float mglow = exp(-mdd*7.0)*0.35;',
'    float crat = fbm((st - moonPos)*asp*38.0)*0.16;',
'    vec3 moonCol = vec3(0.92,0.93,0.86) - crat;',
'    float mvis = smoothstep(-0.05, 0.15, moonH) * (1.0 - day);',
'    sky += moonCol * (mdisk + mglow) * mvis;',
'  }',
'',
'  // ── Hill silhouette anchoring the horizon ──',
'  float ridge = 0.28 + 0.05*sin(st.x*aspect*3.0 + 1.0) + 0.05*fbm(vec2(st.x*aspect*2.5, 7.3));',
'  float ground = smoothstep(ridge + 0.004, ridge - 0.004, st.y);',
'  vec3 groundCol = mix(vec3(0.015,0.02,0.04), vec3(0.05,0.07,0.08), day*0.6);',
'  sky = mix(sky, groundCol, ground);',
'',
'  // ── Vignette ──',
'  vec2 vv = st - 0.5;',
'  sky *= 1.0 - dot(vv, vv)*0.30;',
'',
'  gl_FragColor = vec4(sky, 1.0);',
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

    uTime = gl.getUniformLocation(program, 'u_time');
    uRes  = gl.getUniformLocation(program, 'u_res');
    uHour = gl.getUniformLocation(program, 'u_hour');
    uCfg  = gl.getUniformLocation(program, 'u_cfg');
    startTime = performance.now() / 1000;
}

function currentHour() {
    if (PREVIEW_CYCLE > 0) {
        // Fast-forward a full day for previewing dawn/dusk/night
        return ((performance.now() / 1000) / PREVIEW_CYCLE * 24.0) % 24.0;
    }
    var d = new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

function render() {
    var t = performance.now() / 1000 - startTime;
    gl.viewport(0, 0, w, h);
    gl.uniform1f(uTime, t);
    gl.uniform2f(uRes, w, h);
    gl.uniform1f(uHour, currentHour());
    gl.uniform4f(uCfg, CLOUD_AMOUNT, STAR_DENSITY, 0.0, 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(render);
}

function fallbackMessage(msg) {
    var c = canvas.getContext('2d');
    if (!c) return;
    c.fillStyle = '#0a0e1a'; c.fillRect(0, 0, w, h);
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
    }
};
