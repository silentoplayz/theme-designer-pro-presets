/*
  HypnoSpiral – Web-Worker edition
  Name: HypnoSpiral
  Description: A slowly fading, hypnotic spiral made of concentric coloured rings that rotate and drift outward.
  All behaviour is controlled by the CONFIG block below – tweak only there.
*/

// =========================================================================
// CONFIG ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
const CONFIG = {
  TRAIL_ALPHA: 0.04,      // Controls fade speed to transparency (0.01 - 0.1)
  RING_SPACING: 4,        // px between rings
  RING_THICKNESS: 15,     // divisor for ring radius → stroke thickness
  ROTATION_SPEED: 0.02,   // rad/frame
  HUE_SHIFT: 2,           // hue += HUE_SHIFT per frame
  HUE_RANGE: 360,        // 360 = full spectrum
  SATURATION: '90%',       // CSS saturation string
  LIGHTNESS: '60%',        // CSS lightness string
};
// =========================================================================

let c, ctx, w, h, t = 0, frames = 0;

self.onmessage = e => {
  if (e.data.type === 'init') {
    c = e.data.canvas;
    ctx = c.getContext('2d');
    w = c.width = e.data.width;
    h = c.height = e.data.height;
    animate();
  }
  if (e.data.type === 'resize') {
    w = c.width = e.data.width;
    h = c.height = e.data.height;
  }
};

function animate() {
  // 1. Erase previous frame into transparency instead of layering black paint
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = `rgba(0, 0, 0, ${CONFIG.TRAIL_ALPHA})`;
  ctx.fillRect(0, 0, w, h);

  // 2. Set back to normal drawing mode
  ctx.globalCompositeOperation = 'source-over';

  const cx = w / 2;
  const cy = h / 2;
  const rMax = Math.hypot(cx, cy);

  for (let r = 1; r < rMax; r += CONFIG.RING_SPACING) {
    const a = r * 0.04 + t;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    ctx.strokeStyle = `hsl(${(frames * CONFIG.HUE_SHIFT + r / 4) % CONFIG.HUE_RANGE},${CONFIG.SATURATION},${CONFIG.LIGHTNESS})`;
    ctx.beginPath();
    ctx.arc(x, y, r / CONFIG.RING_THICKNESS, 0, Math.PI * 2);
    ctx.stroke();
  }

  t += CONFIG.ROTATION_SPEED;
  frames++;
  requestAnimationFrame(animate);
}