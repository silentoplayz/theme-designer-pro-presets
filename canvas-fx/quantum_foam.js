/**
 * Title: Quantum Foam
 * Description: A dense field of 2500 particles that bloom and fade across the
 *   full color spectrum, evoking quantum vacuum fluctuations. Particles spawn at
 *   random positions, grow outward, and dissolve into transparency.
 */
// QuantumFoam – transparency-optimized
// ------------------------------------------------------------------
// CONFIGURATION CONSTANTS
// ------------------------------------------------------------------
const PARTICLE_COUNT   = 2500; 
const MIN_RADIUS       = 0.5;  
const MAX_RADIUS       = 2;    
const GROWTH_SPEED     = 1.003;
const MIN_LIFE_DECAY   = 0.01; 
const MAX_LIFE_DECAY   = 0.02; 
const TRAIL_OPACITY    = 0.1;  // Controls how fast trails erase to transparency
const HUE_RANGE        = 360;   
const SATURATION       = '80%';
const LIGHTNESS        = '60%';
// ------------------------------------------------------------------

let c, ctx, w, h, foam = [];

self.onmessage = e => {
  if (e.data.type === 'init') {
    c = e.data.canvas;
    ctx = c.getContext('2d');
    w = c.width = e.data.width;
    h = c.height = e.data.height;

    foam = Array.from({ length: PARTICLE_COUNT }, _ => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * (MAX_RADIUS - MIN_RADIUS) + MIN_RADIUS,
      life: 1,
      decay: Math.random() * (MAX_LIFE_DECAY - MIN_LIFE_DECAY) + MIN_LIFE_DECAY,
      hue: Math.random() * HUE_RANGE
    }));
    animate();
  }

  if (e.data.type === 'resize') {
    w = c.width = e.data.width;
    h = c.height = e.data.height;
  }
};

function resetParticle(f) {
  f.x = Math.random() * w;
  f.y = Math.random() * h;
  f.r = MIN_RADIUS;
  f.life = 1;
  f.decay = Math.random() * (MAX_LIFE_DECAY - MIN_LIFE_DECAY) + MIN_LIFE_DECAY;
  f.hue = Math.random() * HUE_RANGE;
}

function animate() {
  // 1. Erase a portion of the previous frame to transparency
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = `rgba(0,0,0,${TRAIL_OPACITY})`;
  ctx.fillRect(0, 0, w, h);

  // 2. Switch back to normal drawing mode for particles
  ctx.globalCompositeOperation = 'source-over';

  for (let i = 0; i < foam.length; i++) {
    const f = foam[i];
    f.life -= f.decay;
    f.r *= GROWTH_SPEED;

    if (f.life <= 0) {
      resetParticle(f);
    }

    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${f.hue},${SATURATION},${LIGHTNESS},${f.life})`;
    ctx.fill();
  }

  requestAnimationFrame(animate);
}

// Heartbeat — prevents host from terminating idle workers
setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);
