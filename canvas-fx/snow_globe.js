/**
 * Title: Snow Globe
 * Description: Gentle snowfall with drifting flakes, shimmer sparkles,
 *   bottom-edge accumulation, and a mouse-driven swirl wind effect.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Flake Appearance --
  flakeCount: 180,                        // Total number of snowflakes
  minFlakeSize: 1.5,                      // Smallest flake radius in px
  maxFlakeSize: 5,                        // Largest flake radius in px
  flakeColor: 'rgba(255, 255, 255, 1)',   // Base flake color
  flakeOpacity: 0.85,                     // Global flake opacity (0-1)
  shimmerChance: 0.02,                    // Per-frame chance a flake sparkles (0-1)
  shimmerGlowRadius: 12,                  // Glow radius when a flake shimmers in px
  shimmerColor: 'rgba(200, 230, 255, 0.9)', // Color of the shimmer glow

  // -- Motion --
  gravity: 0.35,                          // Downward acceleration per frame
  windDirection: 1,                       // Horizontal wind bias (-1 left, 1 right)
  windStrength: 0.4,                      // Base horizontal wind force
  driftRandomness: 0.6,                   // Per-frame random horizontal jitter
  speed: 1.0,                             // Global speed multiplier

  // -- Accumulation --
  accumulationHeight: 18,                 // Max snow buildup height at bottom in px
  accumulationRate: 0.012,                // How fast snow accumulates (0-1)

  // -- Mouse Interaction --
  mouseRadius: 160,                       // Radius of mouse swirl influence in px
  mouseSwirl: 3.5,                        // Tangential swirl force strength
  mouseRepel: 1.2,                        // Radial push-away force strength
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let flakes = [];
let accumulation = 0;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

self.onmessage = (e) => {
  switch (e.data.type) {
    case 'init':
      canvas = e.data.canvas;
      ctx = canvas.getContext('2d');
      width = e.data.width;
      height = e.data.height;
      canvas.width = width;
      canvas.height = height;
      initFlakes();
      startAnimation();
      break;
    case 'resize':
      width = e.data.width;
      height = e.data.height;
      canvas.width = width;
      canvas.height = height;
      initFlakes();
      accumulation = 0;
      break;
    case 'mousemove':
      mouse.x = e.data.x;
      mouse.y = e.data.y;
      break;
  }
};

function initFlakes() {
  flakes = [];
  for (let i = 0; i < CONFIG.flakeCount; i++) {
    flakes.push(createFlake(true));
  }
}

function createFlake(randomY) {
  const size = CONFIG.minFlakeSize + Math.random() * (CONFIG.maxFlakeSize - CONFIG.minFlakeSize);
  return {
    x: Math.random() * width,
    y: randomY ? Math.random() * height : -size * 2,
    size,
    vx: 0,
    vy: 0.5 + Math.random() * 1.5,
    wobblePhase: Math.random() * Math.PI * 2,
    wobbleSpeed: 0.01 + Math.random() * 0.03,
    opacity: 0.4 + Math.random() * 0.6,
  };
}

function startAnimation() {
  function render() {
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const floorY = height - accumulation;

    // Update and draw flakes
    for (let i = 0; i < flakes.length; i++) {
      const f = flakes[i];

      // Wobble drift
      f.wobblePhase += f.wobbleSpeed * CONFIG.speed;
      const wobble = Math.sin(f.wobblePhase) * CONFIG.driftRandomness;

      // Wind
      f.vx += (CONFIG.windDirection * CONFIG.windStrength + wobble) * 0.02 * CONFIG.speed;
      f.vy += CONFIG.gravity * 0.02 * CONFIG.speed;

      // Mouse swirl
      const dx = f.x - mouse.x;
      const dy = f.y - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < CONFIG.mouseRadius && dist > 1) {
        const factor = 1 - dist / CONFIG.mouseRadius;
        const nx = dx / dist;
        const ny = dy / dist;
        // Tangential swirl
        f.vx += (-ny * CONFIG.mouseSwirl * factor) * 0.1;
        f.vy += (nx * CONFIG.mouseSwirl * factor) * 0.1;
        // Radial repel
        f.vx += nx * CONFIG.mouseRepel * factor * 0.1;
        f.vy += ny * CONFIG.mouseRepel * factor * 0.1;
      }

      // Damping
      f.vx *= 0.96;
      f.vy *= 0.98;

      // Clamp terminal velocity
      f.vy = Math.min(f.vy, 3 * CONFIG.speed);

      f.x += f.vx;
      f.y += f.vy;

      // Reached bottom — recycle and add to accumulation
      if (f.y >= floorY) {
        accumulation = Math.min(accumulation + CONFIG.accumulationRate * f.size, CONFIG.accumulationHeight);
        flakes[i] = createFlake(false);
        continue;
      }

      // Wrap horizontally
      if (f.x < -10) f.x = width + 10;
      if (f.x > width + 10) f.x = -10;

      // Draw flake
      const alpha = f.opacity * CONFIG.flakeOpacity;

      // Shimmer check
      const isShimmering = Math.random() < CONFIG.shimmerChance;
      if (isShimmering) {
        ctx.save();
        ctx.shadowBlur = CONFIG.shimmerGlowRadius;
        ctx.shadowColor = CONFIG.shimmerColor;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.size * 1.3, 0, Math.PI * 2);
        ctx.fillStyle = CONFIG.shimmerColor;
        ctx.globalAlpha = alpha;
        ctx.fill();
        ctx.restore();
      }

      ctx.beginPath();
      ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
      ctx.fillStyle = CONFIG.flakeColor;
      ctx.globalAlpha = alpha;
      ctx.fill();
    }

    // Draw accumulation mound
    if (accumulation > 0.5) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = 'rgba(240, 245, 255, 0.6)';
      ctx.beginPath();
      ctx.moveTo(0, height);
      const segments = 24;
      for (let i = 0; i <= segments; i++) {
        const sx = (i / segments) * width;
        const waveOffset = Math.sin(i * 0.8) * accumulation * 0.2;
        ctx.lineTo(sx, height - accumulation + waveOffset);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}
