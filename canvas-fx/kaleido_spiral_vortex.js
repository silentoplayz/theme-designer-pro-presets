/**
 * Title: Kaleido Spiral Vortex
 * Description: A kaleidoscopic vortex of rotating radial wedges with pulsing
 *   scale wobble and smooth hue cycling. A subtle noise overlay adds texture
 *   across the wedge faces.
 */

// ---------- CONFIGURABLE VARIABLES ----------
const FPS            = 60;          // target frames per second (approx)
const ROTATION_SPEED = 0.01;        // radians per frame
const WEDGES         = 12;          // number of radial wedges
const WAVE_SPEED     = 2;           // speed of the scale “wobble”
const WAVE_AMP       = 0.3;         // amplitude of the scale wobble (0–1)
const HUE_BASE       = 30;          // hue step per wedge
const HUE_SPEED      = 180;         // hue shift per second
const SATURATION     = 100;         // HSL saturation %
const LIGHTNESS      = 55;          // HSL lightness %
const NOISE_MIN      = 0.03;        // minimum overlay opacity
const NOISE_RANGE    = 0.02;        // additional overlay range
// ------------------------------------------

let c, ctx, w, h, angle = 0;

self.onmessage = e => {
  if (e.data.type === 'init') {
    c = e.data.canvas;
    ctx = c.getContext('2d');
    w = c.width = e.data.width;
    h = c.height = e.data.height;
    loop();
  }
};

function loop() {
  angle += ROTATION_SPEED;
  
  // Clear to transparency every frame
  ctx.clearRect(0, 0, w, h);

  // draw radial wedges
  for (let i = 0; i < WEDGES; i++) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate((i * 2 * Math.PI) / WEDGES + angle);
    ctx.scale(
      1 + WAVE_AMP * Math.sin(WAVE_SPEED * angle + i),
      1 + WAVE_AMP * Math.cos(WAVE_SPEED * angle + i)
    );
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, w, 0, Math.PI / WEDGES);
    ctx.closePath();
    ctx.fillStyle = `hsl(${(i * HUE_BASE + angle * HUE_SPEED) % 360},${SATURATION}%,${LIGHTNESS}%)`;
    ctx.fill();
    ctx.restore();
  }

  // noisy overlay - using source-atop to ensure the noise only affects 
  // the wedges and does not 'fog' the transparent chat background gap
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = `rgba(255,255,255,${NOISE_MIN + NOISE_RANGE * Math.abs(Math.sin(angle))})`;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  requestAnimationFrame(loop);
}

// Heartbeat — prevents host from terminating idle workers
setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);
