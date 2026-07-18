/**
 * Title: Liquid Chrome (WebGL)
 * Description: A flowing metallic liquid surface rendered with GPU shaders.
 *   Multiple layers of warped noise create a convincing reflective chrome
 *   membrane that ripples and morphs organically. Mouse interaction creates
 *   a deep gravity well that pulls the liquid surface toward the cursor,
 *   revealing iridescent prismatic reflections underneath.
 *
 *   Showcases: WebGL shaders, metallic rendering, mousemove
 */

/* ────────── CONFIGURABLE ────────── */
var SPEED           = 0.15;     // flow speed
var SCALE           = 1.8;      // noise zoom level (lower = bigger features)
var WARP_DEPTH      = 3;        // domain warp passes (1-4, higher = more complex)
var REFLECTIVITY    = 0.7;      // chrome reflection intensity
var IRIDESCENCE     = 0.5;      // rainbow refraction amount
var MOUSE_PULL      = 0.25;     // mouse gravity well strength
var MOUSE_RADIUS    = 0.3;      // mouse influence radius
var EDGE_LIGHT      = 1.3;      // rim/edge lighting intensity
/* ──────────────────────────────────── */

var canvas, gl, program;
var uTime, uRes, uMouse, uCfg;
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
'uniform vec4 u_cfg;', // reflectivity, iridescence, mousePull, edgeLight
'',
'// ── Noise foundation ──',
'vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}',
'vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}',
'vec4 perm(vec4 x){return mod289(((x*34.)+1.)*x);}',
'',
'float snoise(vec3 v){',
'  vec3 C=vec3(1./6.,1./3.,0.);',
'  vec3 i=floor(v+dot(v,C.yyy));',
'  vec3 x0=v-i+dot(i,C.xxx);',
'  vec3 g=step(x0.yzx,x0.xyz);',
'  vec3 l=1.-g;',
'  vec3 i1=min(g,l.zxy);',
'  vec3 i2=max(g,l.zxy);',
'  vec3 x1=x0-i1+C.x;',
'  vec3 x2=x0-i2+C.y;',
'  vec3 x3=x0-.5;',
'  i=mod289(i);',
'  vec4 p=perm(perm(perm(',
'    i.z+vec4(0,i1.z,i2.z,1))',
'    +i.y+vec4(0,i1.y,i2.y,1))',
'    +i.x+vec4(0,i1.x,i2.x,1));',
'  vec4 j=p-49.*floor(p*(1./49.));',
'  vec4 x_=floor(j*(1./7.));',
'  vec4 y_=floor(j-7.*x_);',
'  vec4 ox=(x_*2.+.5)/7.-1.;',
'  vec4 oy=(y_*2.+.5)/7.-1.;',
'  vec4 dg=vec4(dot(vec3(ox.x,oy.x,0),x0),dot(vec3(ox.y,oy.y,0),x1),',
'               dot(vec3(ox.z,oy.z,0),x2),dot(vec3(ox.w,oy.w,0),x3));',
'  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);',
'  m=m*m;',
'  return 42.*dot(m*m,dg);',
'}',
'',
'float fbm(vec3 p){',
'  float f=0.,a=.5;',
'  for(int i=0;i<6;i++){f+=a*snoise(p);p*=2.02;a*=.48;}',
'  return f;',
'}',
'',
'// ── Iridescent palette ──',
'vec3 iridescent(float t,float iri){',
'  vec3 a=vec3(.5);vec3 b=vec3(.5);',
'  vec3 c=vec3(1.);vec3 d=vec3(.0,.33,.67);',
'  vec3 base=a+b*cos(6.28318*(c*t+d));',
'  return mix(vec3(dot(base,vec3(.299,.587,.114))),base,iri);',
'}',
'',
'// ── Chrome reflection model ──',
'vec3 chromeReflect(vec2 p,float t,float nDot,float refl){',
'  // Fake environment map — gradient sky + ground',
'  float envY=nDot*.8+.1;',
'  vec3 sky=mix(vec3(.05,.05,.12),vec3(.2,.25,.35),smoothstep(0.,.8,envY));',
'  vec3 ground=mix(vec3(.08,.06,.05),vec3(.15,.12,.1),smoothstep(-.5,0.,envY));',
'  vec3 env=mix(ground,sky,smoothstep(-.1,.1,envY));',
'  // Bright highlights',
'  float highlight=pow(max(nDot,0.),12.)*.8;',
'  env+=vec3(highlight);',
'  return env*refl;',
'}',
'',
'void main(){',
'  vec2 uv=(2.*gl_FragCoord.xy-u_res)/min(u_res.x,u_res.y);',
'  float t=u_time;',
'  float refl=u_cfg.x;',
'  float iri=u_cfg.y;',
'  float mPull=u_cfg.z;',
'  float eLit=u_cfg.w;',
'',
'  // ── Mouse gravity well ──',
'  vec2 mp=(2.*u_mouse*u_res-u_res)/min(u_res.x,u_res.y);',
'  float md=length(uv-mp);',
'  float mInfl=mPull/(1.+md*md/('+MOUSE_RADIUS.toFixed(2)+'*'+MOUSE_RADIUS.toFixed(2)+'));',
'  vec2 p=uv+(mp-uv)*mInfl;',
'',
'  // ── Multi-pass domain warping for organic flow ──',
'  vec3 q=vec3(p*' + SCALE.toFixed(1) + ',t);',
'  float n1=fbm(q);',
'  float n2=fbm(q+vec3(n1*1.4,n1*0.9,0.3));',
'  float n3=fbm(q+vec3(n2*1.2,-n2*1.1,n1*0.5+t*0.15));',
'',
'  // ── Surface normal estimation (for lighting) ──',
'  float eps=0.008;',
'  float nR=fbm(vec3((p.x+eps)*' + SCALE.toFixed(1) + ',p.y*' + SCALE.toFixed(1) + ',t)',
'           +vec3(n2*1.2,-n2*1.1,n1*0.5+t*0.15));',
'  float nU=fbm(vec3(p.x*' + SCALE.toFixed(1) + ',(p.y+eps)*' + SCALE.toFixed(1) + ',t)',
'           +vec3(n2*1.2,-n2*1.1,n1*0.5+t*0.15));',
'  vec3 normal=normalize(vec3((n3-nR)/eps,(n3-nU)/eps,1.));',
'',
'  // ── Lighting ──',
'  vec3 lightDir=normalize(vec3(0.4,0.6,1.0));',
'  float nDot=dot(normal,lightDir);',
'  float diffuse=max(nDot,0.)*0.3;',
'',
'  // Specular',
'  vec3 viewDir=vec3(0.,0.,1.);',
'  vec3 halfDir=normalize(lightDir+viewDir);',
'  float spec=pow(max(dot(normal,halfDir),0.),64.)*1.2;',
'',
'  // Rim/edge lighting',
'  float rim=pow(1.-max(dot(normal,viewDir),0.),3.)*eLit;',
'',
'  // ── Color composition ──',
'  // Base chrome reflection',
'  vec3 chrome=chromeReflect(p,t,nDot,refl);',
'',
'  // Iridescent layer — prismatic refraction from surface curvature',
'  float curvature=n3*0.5+0.5;',
'  vec3 prism=iridescent(curvature+t*0.05,iri);',
'',
'  // Combine',
'  vec3 col=chrome+prism*0.35;',
'  col+=vec3(spec)*vec3(1.,0.97,0.9);',
'  col+=vec3(rim)*mix(vec3(0.2,0.25,0.4),prism*0.4,iri);',
'  col+=diffuse*vec3(0.1,0.1,0.15);',
'',
'  // Depth — subtle darkening of valleys',
'  float depth=smoothstep(-0.3,0.5,n3);',
'  col*=0.6+depth*0.5;',
'',
'  // ── Mouse proximity glow ──',
'  float mouseGlow=exp(-md*md*4.)*0.15;',
'  col+=prism*mouseGlow;',
'',
'  // ── Vignette ──',
'  vec2 vUV=gl_FragCoord.xy/u_res;',
'  float vig=1.-dot(vUV-.5,vUV-.5)*1.3;',
'  col*=max(vig,0.);',
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
    uCfg = gl.getUniformLocation(program, 'u_cfg');
    startTime = performance.now() / 1000;
}

function render() {
    var t = (performance.now() / 1000 - startTime) * SPEED;
    gl.viewport(0, 0, w, h);
    gl.uniform1f(uTime, t);
    gl.uniform2f(uRes, w, h);
    gl.uniform2f(uMouse, mouseNX, mouseNY);
    gl.uniform4f(uCfg, REFLECTIVITY, IRIDESCENCE, MOUSE_PULL, EDGE_LIGHT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(render);
}

self.onmessage = function(e) {
    switch (e.data.type) {
        case 'init':
            canvas = e.data.canvas;
            w = e.data.width; h = e.data.height;
            canvas.width = w; canvas.height = h;
            gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            if (!gl) {
                var c = canvas.getContext('2d');
                c.fillStyle = '#0a0a1a'; c.fillRect(0,0,w,h);
                c.fillStyle = '#ff4466'; c.font = '16px monospace';
                c.textAlign = 'center';
                c.fillText('WebGL not available', w/2, h/2);
                return;
            }
            try { initGL(); render(); }
            catch(err) {
                var c = canvas.getContext('2d');
                if(c){c.fillStyle='#0a0a1a';c.fillRect(0,0,w,h);
                c.fillStyle='#ff4466';c.font='12px monospace';c.textAlign='center';
                c.fillText('Shader: '+err.message,w/2,h/2);}
            }
            break;
        case 'resize':
            w = e.data.width; h = e.data.height;
            canvas.width = w; canvas.height = h;
            break;
        case 'mousemove':
            mouseNX = e.data.x / w;
            mouseNY = 1.0 - (e.data.y / h);
            break;
    }
};
