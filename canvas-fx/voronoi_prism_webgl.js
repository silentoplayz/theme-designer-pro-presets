/**
 * Title: Voronoi Prism (WebGL)
 * Description: A crystalline mosaic of animated Voronoi cells with glowing
 *   prismatic edges. Each cell slowly drifts and morphs as its seed point
 *   orbits in Lissajous curves, creating a living stained-glass window effect.
 *   Cell interiors have faceted gem gradients that shift hue over time. Edges
 *   glow with bright neon light — white-blue cores with colored bloom. A second
 *   larger-scale Voronoi layer adds depth at 40% opacity. Mouse proximity
 *   acts as a flashlight on crystal, pulsing nearby cells brighter and flaring
 *   their edges.
 *
 *   Showcases: WebGL shaders, Voronoi distance fields, mousemove
 */

/* ────────── CONFIGURABLE ────────── */
var CELL_COUNT       = 6.0;     // grid size (NxN seed points per unit)
var ANIMATION_SPEED  = 0.25;    // seed orbit speed
var EDGE_WIDTH       = 1.8;     // edge thickness multiplier (1.0 = thin, 3.0 = thick)
var EDGE_BRIGHTNESS  = 2.5;     // edge glow intensity
var CELL_SATURATION  = 0.65;    // cell interior color saturation (0-1)
var MOUSE_RADIUS     = 0.35;    // mouse flashlight influence radius
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
'uniform vec4 u_cfg;', // edgeWidth, edgeBright, cellSat, mouseRadius
'',
'// ── Hash functions ──',
'vec2 hash2(vec2 p){',
'  p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));',
'  return fract(sin(p)*43758.5453);',
'}',
'',
'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
'float hash3(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}',
'',
'// ── OKLCH-inspired perceptual hue-to-RGB ──',
'// Attempt perceptually uniform colors: convert hue + saturation to RGB',
'// via a curated palette that avoids the harsh neon of raw HSV',
'vec3 oklchColor(float hue, float sat, float light){',
'  // Six curated anchor colors for smooth perceptual interpolation',
'  vec3 c0=vec3(0.90,0.25,0.30); // red-coral',
'  vec3 c1=vec3(0.95,0.60,0.20); // amber',
'  vec3 c2=vec3(0.45,0.85,0.30); // green',
'  vec3 c3=vec3(0.20,0.75,0.85); // teal',
'  vec3 c4=vec3(0.35,0.40,0.95); // blue-violet',
'  vec3 c5=vec3(0.80,0.30,0.75); // magenta',
'  float h=fract(hue)*6.0;',
'  vec3 col;',
'  if(h<1.0) col=mix(c0,c1,h);',
'  else if(h<2.0) col=mix(c1,c2,h-1.0);',
'  else if(h<3.0) col=mix(c2,c3,h-2.0);',
'  else if(h<4.0) col=mix(c3,c4,h-3.0);',
'  else if(h<5.0) col=mix(c4,c5,h-4.0);',
'  else col=mix(c5,c0,h-5.0);',
'  // Apply saturation (desaturate toward luminance)',
'  float lum=dot(col,vec3(0.2126,0.7152,0.0722));',
'  col=mix(vec3(lum),col,sat);',
'  return col*light;',
'}',
'',
'// ── Voronoi with animated seeds ──',
'// Returns: x = dist to nearest, y = dist to 2nd nearest,',
'//          z = cell hash, w = dist to nearest seed from pixel',
'vec4 voronoi(vec2 uv, float scale, float t, float speed){',
'  vec2 p=uv*scale;',
'  vec2 ip=floor(p);',
'  vec2 fp=fract(p);',
'  float d1=10.0, d2=10.0;',
'  float cellId=0.0;',
'  vec2 nearestSeed=vec2(0.0);',
'  for(int j=-1;j<=1;j++){',
'    for(int i=-1;i<=1;i++){',
'      vec2 nb=vec2(float(i),float(j));',
'      vec2 o=hash2(ip+nb);',
'      // Lissajous orbit: each seed has unique freq from its hash',
'      float hx=hash(ip+nb+0.5);',
'      float hy=hash(ip+nb+1.7);',
'      vec2 anim=vec2(',
'        sin(t*speed*(0.8+hx*0.6)+hx*6.2831)*0.35,',
'        cos(t*speed*(0.6+hy*0.8)+hy*6.2831)*0.35',
'      );',
'      vec2 seedPos=nb+o+anim-fp;',
'      float d=dot(seedPos,seedPos);',
'      if(d<d1){',
'        d2=d1; d1=d;',
'        cellId=hash(ip+nb);',
'        nearestSeed=seedPos;',
'      } else if(d<d2){',
'        d2=d;',
'      }',
'    }',
'  }',
'  return vec4(sqrt(d1),sqrt(d2),cellId,length(nearestSeed));',
'}',
'',
'void main(){',
'  vec2 uv=(2.0*gl_FragCoord.xy-u_res)/min(u_res.x,u_res.y);',
'  float t=u_time;',
'  float edgeW=u_cfg.x;',
'  float edgeB=u_cfg.y;',
'  float cellSat=u_cfg.z;',
'  float mRad=u_cfg.w;',
'',
'  // ── Mouse position in UV space ──',
'  vec2 mp=(2.0*u_mouse*u_res-u_res)/min(u_res.x,u_res.y);',
'  float mDist=length(uv-mp);',
'  float mInfluence=smoothstep(mRad,0.0,mDist);',
'',
'  // ── Primary Voronoi layer ──',
'  vec4 v1=voronoi(uv,' + CELL_COUNT.toFixed(1) + ',t,1.0);',
'  float dist1=v1.x;',
'  float dist2=v1.y;',
'  float cId1=v1.z;',
'  float seedDist1=v1.w;',
'',
'  // ── Edge detection ──',
'  // Edge factor: thin where d2-d1 is small',
'  float edgeDelta=dist2-dist1;',
'  float edgeBase=0.02*edgeW;',
'  float edgeFade=0.06*edgeW;',
'  // Mouse flares edges wider',
'  float edgeFlare=1.0+mInfluence*2.5;',
'  float edge=1.0-smoothstep(edgeBase*edgeFlare,edgeFade*edgeFlare,edgeDelta);',
'',
'  // ── Cell interior color ──',
'  // Hue from cell hash + slow time rotation',
'  float hue=cId1+t*0.04;',
'  float cellLight=0.35+0.15*sin(cId1*17.3+t*0.3);',
'  vec3 cellCol=oklchColor(hue,cellSat,cellLight);',
'',
'  // Faceted gem gradient: brighter near center, darker near edge',
'  float facet=smoothstep(0.7,0.0,seedDist1)*0.6+0.4;',
'  cellCol*=facet;',
'',
'  // Subtle inner glow (soft light reflecting inward from edges)',
'  float innerGlow=smoothstep(0.35,0.08,edgeDelta)*0.2;',
'  vec3 innerGlowCol=oklchColor(hue+0.15,0.8,0.7);',
'  cellCol+=innerGlowCol*innerGlow;',
'',
'  // ── Mouse flashlight on cell interiors ──',
'  cellCol*=1.0+mInfluence*1.8;',
'',
'  // ── Edge glow color ──',
'  // White-blue core with colored bloom falloff',
'  vec3 edgeCoreCol=vec3(0.85,0.92,1.0); // white-blue',
'  vec3 edgeBloomCol=oklchColor(hue+0.3,0.9,1.0);',
'  float coreVsBloom=smoothstep(0.0,edgeFade*0.5,edgeDelta);',
'  vec3 edgeCol=mix(edgeCoreCol,edgeBloomCol,coreVsBloom);',
'  edgeCol*=edgeB*(1.0+mInfluence*2.0);',
'',
'  // ── Compose primary layer ──',
'  vec3 layer1=mix(cellCol,edgeCol,edge);',
'',
'  // ── Secondary Voronoi layer (larger scale, for depth) ──',
'  vec4 v2=voronoi(uv,' + (CELL_COUNT * 0.4).toFixed(1) + ',t*0.7,0.6);',
'  float edgeDelta2=v2.y-v2.x;',
'  float edge2=1.0-smoothstep(0.03*edgeW,0.09*edgeW,edgeDelta2);',
'  float hue2=v2.z+t*0.025;',
'  vec3 cell2=oklchColor(hue2,cellSat*0.7,0.25);',
'  float facet2=smoothstep(0.8,0.0,v2.w)*0.5+0.5;',
'  cell2*=facet2;',
'  vec3 edgeCol2=vec3(0.6,0.75,0.95)*edgeB*0.5;',
'  vec3 layer2=mix(cell2,edgeCol2,edge2);',
'',
'  // ── Blend layers ──',
'  vec3 col=layer1+layer2*0.4;',
'',
'  // ── Dark background base ──',
'  // The cell colors already sit on near-black; ensure minimum darkness',
'  col=max(col,vec3(0.01,0.012,0.02));',
'',
'  // ── Vignette ──',
'  vec2 vUV=gl_FragCoord.xy/u_res;',
'  float vig=1.0-dot(vUV-0.5,vUV-0.5)*1.4;',
'  col*=max(vig,0.0);',
'',
'  // ── Film grain ──',
'  col+=hash3(vec3(gl_FragCoord.xy,t*100.0))*0.02-0.01;',
'',
'  gl_FragColor=vec4(col,1.0);',
'}',
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
    var t = (performance.now() / 1000 - startTime) * ANIMATION_SPEED;
    gl.viewport(0, 0, w, h);
    gl.uniform1f(uTime, t);
    gl.uniform2f(uRes, w, h);
    gl.uniform2f(uMouse, mouseNX, mouseNY);
    gl.uniform4f(uCfg, EDGE_WIDTH, EDGE_BRIGHTNESS, CELL_SATURATION, MOUSE_RADIUS);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(render);
}

/* ── Message handler ── */
self.onmessage = function(e) {
    switch (e.data.type) {
        case 'init':
            canvas = e.data.canvas;
            w = e.data.width; h = e.data.height;
            canvas.width = w; canvas.height = h;
            gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            if (!gl) {
                var c = canvas.getContext('2d');
                c.fillStyle = '#050510'; c.fillRect(0, 0, w, h);
                c.fillStyle = '#ff4466'; c.font = '16px monospace';
                c.textAlign = 'center';
                c.fillText('WebGL not available', w / 2, h / 2);
                return;
            }
            try { initGL(); render(); }
            catch (err) {
                var c = canvas.getContext('2d');
                if (c) {
                    c.fillStyle = '#050510'; c.fillRect(0, 0, w, h);
                    c.fillStyle = '#ff4466'; c.font = '12px monospace';
                    c.textAlign = 'center';
                    c.fillText('Shader: ' + err.message, w / 2, h / 2);
                }
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
