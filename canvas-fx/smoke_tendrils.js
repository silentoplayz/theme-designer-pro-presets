/**
 * Title: Smoke Tendrils
 * Description: Organic rising smoke tendrils with Perlin-like turbulence,
 *   wind drift, and mouse-driven disturbance. Particles rise from the
 *   bottom, swirl through turbulence fields, and fade as they ascend.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Tendril Layout --
  tendrilCount: 6,                        // Number of smoke tendril sources across the bottom
  particlesPerTendril: 80,                // Active particles per tendril (total = count × this)

  // -- Particle Appearance --
  particleSizeMin: 2,                     // Minimum particle radius in px
  particleSizeMax: 8,                     // Maximum particle radius in px
  particleColor: 'rgba(200, 200, 220, 1)', // Base smoke color (alpha managed per-particle)
  particleOpacity: 0.35,                  // Starting opacity for new particles (0-1)
  fadeRate: 0.003,                        // Opacity lost per frame (higher = faster fade)

  // -- Motion --
  riseSpeed: 1.2,                         // Base upward speed in px/frame
  spreadRate: 0.4,                        // Horizontal drift magnitude per frame
  turbulenceFrequency: 0.008,             // Noise sample frequency (lower = smoother swirls)
  turbulenceAmplitude: 2.5,               // Strength of turbulence displacement in px

  // -- Wind --
  windSpeed: 0.3,                         // Constant horizontal wind in px/frame
  windDirection: 1,                       // 1 = rightward, -1 = leftward

  // -- Origin --
  originYFraction: 0.95,                  // Spawn Y as fraction of canvas height (0=top, 1=bottom)

  // -- Mouse Interaction --
  mouseTurbulenceRadius: 160,             // Radius of mouse disturbance in px
  mouseTurbulenceStrength: 4.0,           // Displacement force from mouse proximity
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let tendrils = [];
let frameCount = 0;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

// --- Simple hash-based noise (no imports needed) ---
function hash(x, y) {
  let h = (x * 374761393 + y * 668265263 + 1013904223) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h & 0x7fffffff) / 0x7fffffff; // 0-1
}

function smoothNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function noise2D(x, y) {
  return smoothNoise(x, y) * 2 - 1; // -1 to 1
}

function parseRGBA(str) {
  const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  return { r: 200, g: 200, b: 220 };
}

class Particle {
  constructor(originX, originY) {
    this.reset(originX, originY);
  }

  reset(originX, originY) {
    this.x = originX + (Math.random() - 0.5) * 20;
    this.y = originY + (Math.random() - 0.5) * 10;
    this.vx = 0;
    this.vy = 0;
    this.size = CONFIG.particleSizeMin + Math.random() * (CONFIG.particleSizeMax - CONFIG.particleSizeMin);
    this.opacity = CONFIG.particleOpacity * (0.6 + Math.random() * 0.4);
    this.life = 1;
    this.seed = Math.random() * 1000;
  }

  update(originX, originY) {
    const freq = CONFIG.turbulenceFrequency;
    const amp = CONFIG.turbulenceAmplitude;

    const nx = noise2D(this.x * freq + this.seed, this.y * freq + frameCount * 0.01);
    const ny = noise2D(this.x * freq + 100 + this.seed, this.y * freq + frameCount * 0.01 + 100);

    this.vx += nx * amp * 0.1 + CONFIG.windSpeed * CONFIG.windDirection * 0.05;
    this.vy -= CONFIG.riseSpeed * 0.05;
    this.vx += (Math.random() - 0.5) * CONFIG.spreadRate * 0.3;

    // Mouse turbulence
    const dx = this.x - mouse.x;
    const dy = this.y - mouse.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < CONFIG.mouseTurbulenceRadius && dist > 1) {
      const force = (1 - dist / CONFIG.mouseTurbulenceRadius) * CONFIG.mouseTurbulenceStrength;
      this.vx += (dx / dist) * force * 0.1;
      this.vy += (dy / dist) * force * 0.1;
    }

    this.vx *= 0.96;
    this.vy *= 0.96;

    this.x += this.vx;
    this.y += this.vy;

    this.opacity -= CONFIG.fadeRate;
    this.size += 0.02;

    if (this.opacity <= 0 || this.y < -50) {
      this.reset(originX, originY);
    }
  }

  draw(ctx, color) {
    if (this.opacity <= 0) return;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${this.opacity})`;
    ctx.fill();
  }
}

function initTendrils() {
  tendrils = [];
  const originY = height * CONFIG.originYFraction;
  const spacing = width / (CONFIG.tendrilCount + 1);

  for (let t = 0; t < CONFIG.tendrilCount; t++) {
    const originX = spacing * (t + 1);
    const particles = [];
    for (let p = 0; p < CONFIG.particlesPerTendril; p++) {
      const particle = new Particle(originX, originY);
      particle.opacity = CONFIG.particleOpacity * Math.random();
      particle.y = originY - Math.random() * height;
      particles.push(particle);
    }
    tendrils.push({ originX, particles });
  }
}

self.onmessage = (e) => {
  switch (e.data.type) {
    case 'init':
      canvas = e.data.canvas;
      ctx = canvas.getContext('2d');
      width = e.data.width;
      height = e.data.height;
      canvas.width = width;
      canvas.height = height;
      initTendrils();
      startAnimation();
      break;
    case 'resize':
      width = e.data.width;
      height = e.data.height;
      canvas.width = width;
      canvas.height = height;
      initTendrils();
      break;
    case 'mousemove':
      mouse.x = e.data.x;
      mouse.y = e.data.y;
      break;
  }
};

function startAnimation() {
  const color = parseRGBA(CONFIG.particleColor);

  function render() {
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'lighter';

    const originY = height * CONFIG.originYFraction;

    for (const tendril of tendrils) {
      for (const particle of tendril.particles) {
        particle.update(tendril.originX, originY);
        particle.draw(ctx, color);
      }
    }

    ctx.globalCompositeOperation = 'source-over';

    frameCount++;
    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}
