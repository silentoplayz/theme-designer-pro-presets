/**
 * Title: Gravity Wells
 * Description: Multiple gravity wells pull orbiting particles into swirling
 *   paths. Particles trail behind them, transfer between wells when they
 *   gain enough velocity, and the mouse can act as an additional gravity source.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Wells --
  wellCount: 4,                           // Number of gravity wells (2-8 recommended)
  wellStrength: 800,                      // Gravitational pull constant (higher = stronger)
  wellColor: 'rgba(100, 180, 255, 0.8)',  // Color of well center glow
  wellGlowRadius: 60,                     // Radius of the well glow effect in px

  // -- Particles --
  particleCount: 300,                     // Total orbiting particles
  particleColor: 'rgba(0, 220, 255, 0.9)', // Base particle color
  particleSize: 2,                        // Particle radius in px

  // -- Trails --
  trailLength: 20,                        // Number of past positions stored (longer = longer tail)
  trailOpacity: 0.4,                      // Starting opacity of the trail (fades to 0)

  // -- Physics --
  orbitDamping: 0.998,                    // Velocity damping per frame (0.99-1.0, lower = more friction)
  escapeVelocityThreshold: 12,            // Speed above which particles can escape a well
  backgroundFadeRate: 0.08,               // Background fade alpha per frame (0-1, lower = longer trails)

  // -- Mouse Interaction --
  mouseWellEnabled: true,                 // Whether the mouse acts as a gravity well
  mouseWellStrength: 1200,                // Gravitational strength of the mouse well
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let wells = [];
let particles = [];

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function parseRGBA(str) {
  const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
  return { r: 0, g: 220, b: 255, a: 0.9 };
}

class Well {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 0.3;
    this.vy = (Math.random() - 0.5) * 0.3;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    if (this.x < 80 || this.x > width - 80) this.vx *= -1;
    if (this.y < 80 || this.y > height - 80) this.vy *= -1;
  }

  draw(ctx) {
    const col = parseRGBA(CONFIG.wellColor);
    const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, CONFIG.wellGlowRadius);
    grad.addColorStop(0, `rgba(${col.r}, ${col.g}, ${col.b}, ${col.a})`);
    grad.addColorStop(0.4, `rgba(${col.r}, ${col.g}, ${col.b}, ${col.a * 0.3})`);
    grad.addColorStop(1, `rgba(${col.r}, ${col.g}, ${col.b}, 0)`);
    ctx.beginPath();
    ctx.arc(this.x, this.y, CONFIG.wellGlowRadius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }
}

class GravParticle {
  constructor() {
    this.x = Math.random() * (width || 800);
    this.y = Math.random() * (height || 600);
    this.vx = (Math.random() - 0.5) * 4;
    this.vy = (Math.random() - 0.5) * 4;
    this.trail = [];
    this.hueOffset = Math.random() * 40 - 20;
  }

  update(allWells) {
    for (const well of allWells) {
      const dx = well.x - this.x;
      const dy = well.y - this.y;
      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq);
      if (dist < 5) continue;

      const strength = well.strength || CONFIG.wellStrength;
      const force = strength / (distSq + 500);
      this.vx += (dx / dist) * force;
      this.vy += (dy / dist) * force;
    }

    this.vx *= CONFIG.orbitDamping;
    this.vy *= CONFIG.orbitDamping;

    this.x += this.vx;
    this.y += this.vy;

    // Trail
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > CONFIG.trailLength) {
      this.trail.shift();
    }

    // Wrap around
    if (this.x < -50) this.x = width + 50;
    if (this.x > width + 50) this.x = -50;
    if (this.y < -50) this.y = height + 50;
    if (this.y > height + 50) this.y = -50;
  }

  draw(ctx, color) {
    // Draw trail
    if (this.trail.length > 1) {
      ctx.beginPath();
      ctx.moveTo(this.trail[0].x, this.trail[0].y);
      for (let i = 1; i < this.trail.length; i++) {
        ctx.lineTo(this.trail[i].x, this.trail[i].y);
      }
      ctx.strokeStyle = `rgba(${Math.min(255, color.r + this.hueOffset)}, ${color.g}, ${color.b}, ${CONFIG.trailOpacity})`;
      ctx.lineWidth = CONFIG.particleSize * 0.6;
      ctx.stroke();
    }

    // Draw particle
    ctx.beginPath();
    ctx.arc(this.x, this.y, CONFIG.particleSize, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${Math.min(255, color.r + this.hueOffset)}, ${color.g}, ${color.b}, ${color.a})`;
    ctx.fill();
  }
}

function initSimulation() {
  wells = [];
  particles = [];

  const margin = 120;
  for (let i = 0; i < CONFIG.wellCount; i++) {
    const x = margin + Math.random() * (width - margin * 2);
    const y = margin + Math.random() * (height - margin * 2);
    wells.push(new Well(x, y));
  }

  for (let i = 0; i < CONFIG.particleCount; i++) {
    const p = new GravParticle();
    p.x = Math.random() * width;
    p.y = Math.random() * height;
    // Give initial orbital velocity around nearest well
    let nearestWell = wells[0];
    let nearestDist = Infinity;
    for (const w of wells) {
      const d = Math.hypot(w.x - p.x, w.y - p.y);
      if (d < nearestDist) { nearestDist = d; nearestWell = w; }
    }
    const angle = Math.atan2(p.y - nearestWell.y, p.x - nearestWell.x) + Math.PI / 2;
    const speed = 1.5 + Math.random() * 2.5;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    particles.push(p);
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
      initSimulation();
      startAnimation();
      break;
    case 'resize':
      width = e.data.width;
      height = e.data.height;
      canvas.width = width;
      canvas.height = height;
      initSimulation();
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

    // Fade background
    ctx.fillStyle = `rgba(0, 0, 0, ${CONFIG.backgroundFadeRate})`;
    ctx.fillRect(0, 0, width, height);

    // Build active wells list
    const activeWells = [...wells];
    if (CONFIG.mouseWellEnabled && mouse.x > -1000) {
      activeWells.push({
        x: mouse.x,
        y: mouse.y,
        strength: CONFIG.mouseWellStrength
      });
    }

    // Update and draw wells
    for (const well of wells) {
      well.update();
      well.draw(ctx);
    }

    // Mouse well glow
    if (CONFIG.mouseWellEnabled && mouse.x > -1000) {
      const col = parseRGBA(CONFIG.wellColor);
      const grad = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, CONFIG.wellGlowRadius * 0.7);
      grad.addColorStop(0, `rgba(${Math.min(255, col.r + 50)}, ${Math.min(255, col.g + 50)}, ${col.b}, 0.6)`);
      grad.addColorStop(1, `rgba(${col.r}, ${col.g}, ${col.b}, 0)`);
      ctx.beginPath();
      ctx.arc(mouse.x, mouse.y, CONFIG.wellGlowRadius * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Update and draw particles
    for (const p of particles) {
      p.update(activeWells);
      p.draw(ctx, color);
    }

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}
