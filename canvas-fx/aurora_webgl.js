/**
 * Title: Aurora Borealis (WebGL)
 * Description: Shimmering northern lights — vertical curtains of luminous
 *   color that ripple and dance across a starfield sky. Multiple aurora bands
 *   undulate with sine-wave motion, layered at different heights and speeds.
 *   Colors flow through green → cyan → violet → pink with bright edges where
 *   bands overlap. Mouse X influences wind direction tilting the curtain
 *   ribbons, mouse Y controls aurora intensity and height. Background features
 *   a dark sky gradient with twinkling starfield and a silhouette treeline.
 *
 *   Showcases: WebGL shaders, FBM noise, additive blending, mousemove
 */

/* ────────── CONFIGURABLE ────────── */
var BAND_COUNT        = 5;       // number of aurora curtain bands
var WAVE_SPEED        = 0.25;    // curtain undulation speed
var WAVE_AMPLITUDE    = 0.18;    // horizontal sway amplitude
var AURORA_HEIGHT     = 0.65;    // how far up the sky aurora extends
var AURORA_BRIGHTNESS = 1.6;     // overall glow intensity
var STAR_DENSITY      = 400.0;   // background star grid density
/* ──────────────────────────────────── */

var canvas, gl, program;
var uTime, uRes, uMouse, uConfig;
var startTime = 0;
var mouseNX = 0.5, mouseNY = 0.5;
var w = 0, h = 0;

setInterval(function() { self.postMessage({ type: 'heartbeat' }); }, 1000);

var VERT = 'attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0,1);}';

var FRAG = [
'precision highp float;',
'uniform float u_time;',
'uniform vec2 u_res;',
'uniform vec2 u_mouse;',
'uniform vec4 u_cfg;', // waveSpeed, waveAmp, auroraHeight, brightness
'',
'// ── Noise primitives ──',
'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
'float hash3(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}',
'',
'float noise(vec2 p){',
'  vec2 i=floor(p),f=fract(p);',
'  f=f*f*(3.-2.*f);',
'  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),',
'             mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);',
'}',
'',
'float fbm(vec2 p){',
'  float f=0.,a=.5;',
'  for(int i=0;i<6;i++){f+=a*noise(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(1.7);a*=.48;}',
'  return f;',
'}',
'',
'// ── Starfield ──',
'vec3 stars(vec2 uv,float t){',
'  vec2 id=floor(uv*' + STAR_DENSITY.toFixed(1) + ');',
'  float h=hash(id);',
'  float bright=step(0.975,h);',
'  float twinkle=0.4+0.6*sin(h*314.+t*(1.5+h*2.));',
'  float mag=smoothstep(1.0,0.975,h);',
'  vec3 tint=mix(vec3(0.75,0.82,1.0),vec3(1.0,0.92,0.7),fract(h*7.7));',
'  return tint*bright*twinkle*mag*0.9;',
'}',
'',
'// ── Aurora color palette: green → cyan → violet → pink ──',
'vec3 auroraPalette(float t,float bandId){',
'  // Shift hue per band for variety',
'  float phase=t+bandId*0.35;',
'  vec3 green =vec3(0.15,0.95,0.4);',
'  vec3 cyan  =vec3(0.1,0.85,0.85);',
'  vec3 violet=vec3(0.55,0.15,0.9);',
'  vec3 pink  =vec3(0.9,0.25,0.65);',
'  float s=fract(phase);',
'  if(s<0.25) return mix(green,cyan,s/0.25);',
'  if(s<0.5)  return mix(cyan,violet,(s-0.25)/0.25);',
'  if(s<0.75) return mix(violet,pink,(s-0.5)/0.25);',
'  return mix(pink,green,(s-0.75)/0.25);',
'}',
'',
'// ── Ground silhouette (treeline) ──',
'float treeline(float x){',
'  float h=0.0;',
'  // Layered noise for organic treeline',
'  h+=0.02*sin(x*5.7+1.2);',
'  h+=0.015*sin(x*13.3+3.7);',
'  h+=0.008*sin(x*31.1+0.5);',
'  // Individual tree bumps',
'  float trees=0.012*max(sin(x*47.+2.1),0.0);',
'  trees+=0.009*max(sin(x*63.+5.3),0.0);',
'  trees+=0.006*max(sin(x*97.+1.7),0.0);',
'  return 0.07+h+trees;',
'}',
'',
'void main(){',
'  vec2 uv=gl_FragCoord.xy/u_res;',
'  float aspect=u_res.x/u_res.y;',
'  float t=u_time;',
'  float wSpeed=u_cfg.x;',
'  float wAmp=u_cfg.y;',
'  float aHeight=u_cfg.z;',
'  float aBright=u_cfg.w;',
'',
'  // Mouse influence',
'  float windDir=(u_mouse.x-0.5)*2.0;  // -1 to 1',
'  float intensity=0.4+u_mouse.y*0.6;  // 0.4 to 1.0',
'',
'  // ── Sky gradient: deep navy top → dark blue-black bottom ──',
'  vec3 skyTop=vec3(0.01,0.02,0.06);',
'  vec3 skyBot=vec3(0.015,0.015,0.03);',
'  vec3 col=mix(skyBot,skyTop,uv.y);',
'',
'  // ── Starfield ──',
'  vec2 starUV=vec2(uv.x*aspect,uv.y);',
'  col+=stars(starUV,t);',
'',
'  // ── Aurora bands ──',
'  float auroraBase=0.25;  // aurora starts above horizon',
'  float auroraTop=auroraBase+aHeight;',
'',
'  // Accumulate aurora light additively',
'  vec3 auroraCol=vec3(0.0);',
'',
'  for(int b=0;b<' + BAND_COUNT + ';b++){',
'    float bi=float(b);',
'    float bandSeed=bi*1.7+0.5;',
'',
'    // Vertical position of the band — each at different height',
'    float bandY=auroraBase+aHeight*(0.15+0.7*(bi+0.5)/' + BAND_COUNT.toFixed(1) + ');',
'',
'    // Y-dependent sine undulation — the curtain ribbon',
'    float yNorm=(uv.y-auroraBase)/max(aHeight,0.01);',
'    float wave=sin(yNorm*6.2831*1.5+t*wSpeed*(0.8+bi*0.25)+bandSeed*3.0)*wAmp;',
'    wave+=sin(yNorm*6.2831*3.7-t*wSpeed*0.6+bandSeed*5.0)*wAmp*0.4;',
'    // Wind direction shifts the wave',
'    wave+=windDir*0.15*(0.7+0.3*sin(yNorm*4.+t*0.3));',
'',
'    // Center X of this band',
'    float cx=0.5+(bi-' + ((BAND_COUNT - 1) / 2.0).toFixed(1) + ')*0.13+wave;',
'    // Adjust for aspect ratio',
'    float dx=(uv.x-cx)*aspect;',
'',
'    // Gaussian brightness falloff from center',
'    float bandWidth=0.06+0.03*sin(bi*2.3+t*0.2);',
'    float gauss=exp(-dx*dx/(2.0*bandWidth*bandWidth));',
'',
'    // Vertical fade: strong in middle, fade at top and bottom',
'    float vFade=smoothstep(auroraBase-0.02,auroraBase+0.08,uv.y)',
'              *smoothstep(auroraTop+0.05,auroraTop-0.12,uv.y);',
'    // Extra fade shaped by intensity (mouse Y)',
'    vFade*=intensity;',
'',
'    // FBM turbulence for organic shimmer',
'    vec2 noiseP=vec2(uv.x*3.+bi*1.1,uv.y*6.-t*wSpeed*0.7+bandSeed);',
'    float shimmer=fbm(noiseP);',
'    shimmer=0.3+shimmer*0.7;',
'',
'    // Secondary fine detail shimmer',
'    float fine=fbm(noiseP*3.2+vec2(t*0.1,0.));',
'    shimmer*=0.6+fine*0.4;',
'',
'    // Band brightness',
'    float band=gauss*vFade*shimmer;',
'',
'    // Color shifts along height: green at bottom → cyan → violet at top',
'    float colorT=clamp((uv.y-auroraBase)/max(aHeight,0.01),0.,1.);',
'    vec3 bCol=auroraPalette(colorT,bi);',
'',
'    // Add bright edge where bands are strong (bloom)',
'    float bloom=band*band*2.0;',
'    bCol+=vec3(0.2,0.3,0.15)*bloom;',
'',
'    auroraCol+=bCol*band;',
'  }',
'',
'  // Apply brightness',
'  col+=auroraCol*aBright;',
'',
'  // ── Atmospheric scattering — faint green tint near horizon ──',
'  float horizonGlow=exp(-pow((uv.y-0.2)*4.0,2.0))*0.15*intensity;',
'  col+=vec3(0.08,0.25,0.1)*horizonGlow;',
'  // Wider ambient scatter from aurora',
'  float scatter=exp(-pow((uv.y-0.35)*2.5,2.0))*0.08*intensity;',
'  col+=vec3(0.05,0.15,0.1)*scatter*length(auroraCol)*0.5;',
'',
'  // ── Ground silhouette ──',
'  float tree=treeline(uv.x*aspect);',
'  float ground=smoothstep(tree+0.005,tree-0.003,uv.y);',
'  // Dark silhouette with faint ambient bounce from aurora',
'  vec3 groundCol=vec3(0.005,0.008,0.005)+auroraCol*0.02;',
'  col=mix(col,groundCol,ground);',
'',
'  // ── Vignette ──',
'  vec2 vUV=uv;',
'  float vig=1.-dot(vUV-.5,vUV-.5)*1.4;',
'  col*=max(vig,0.);',
'',
'  // ── Subtle film grain ──',
'  col+=hash3(vec3(gl_FragCoord.xy,fract(t*60.)))*0.012-0.006;',
'',
'  // Tone clamp',
'  col=clamp(col,0.0,1.0);',
'',
'  gl_FragColor=vec4(col,1.);',
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
    uRes = gl.getUniformLocation(program, 'u_res');
    uMouse = gl.getUniformLocation(program, 'u_mouse');
    uConfig = gl.getUniformLocation(program, 'u_cfg');
    startTime = performance.now() / 1000;
}

function render() {
    var t = (performance.now() / 1000 - startTime);
    gl.viewport(0, 0, w, h);
    gl.uniform1f(uTime, t);
    gl.uniform2f(uRes, w, h);
    gl.uniform2f(uMouse, mouseNX, mouseNY);
    gl.uniform4f(uConfig, WAVE_SPEED, WAVE_AMPLITUDE, AURORA_HEIGHT, AURORA_BRIGHTNESS);
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
            gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            if (!gl) {
                var c2 = canvas.getContext('2d');
                c2.fillStyle = '#080818';
                c2.fillRect(0, 0, w, h);
                c2.fillStyle = '#ff4466';
                c2.font = '16px monospace';
                c2.textAlign = 'center';
                c2.fillText('WebGL not available', w / 2, h / 2);
                return;
            }
            try { initGL(); render(); } catch (err) {
                var c2 = canvas.getContext('2d');
                if (c2) {
                    c2.fillStyle = '#080818';
                    c2.fillRect(0, 0, w, h);
                    c2.fillStyle = '#ff4466';
                    c2.font = '12px monospace';
                    c2.textAlign = 'center';
                    c2.fillText('Shader error: ' + err.message, w / 2, h / 2);
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
            mouseNY = 1.0 - (e.data.y / h);
            break;
    }
};
