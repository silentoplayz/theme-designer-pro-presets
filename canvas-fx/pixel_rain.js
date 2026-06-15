/**
 * Title: Pixel Rain
 * Description: Pixel-art style rain with blocky, grid-snapped drops, optional
 *   splash particles, and glowing trails. Mouse creates pixel splash ripples.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Grid --
  pixelSize: 4,                             // Grid snap size in pixels (2-10)

  // -- Drops --
  dropCount: 180,                           // Number of active rain drops (50-500)
  fallSpeed: 3.5,                           // Base fall speed in pixels per frame (1-10)
  fallSpeedVariance: 1.5,                   // Random speed variance added per drop (0-5)
  dropLength: 4,                            // Drop trail length in grid cells (1-10)

  // -- Colors --
  colorPalette: [                           // Array of drop colors — picked randomly
    'rgba(80, 180, 255, 0.9)',              //   Light blue
    'rgba(100, 200, 255, 0.7)',             //   Cyan-ish
    'rgba(60, 140, 220, 0.8)',              //   Steel blue
    'rgba(120, 220, 255, 0.6)',             //   Pale cyan
  ],

  // -- Trail --
  trailFadeSpeed: 0.88,                     // Per-frame opacity retention for trails (0.8-0.98)

  // -- Wind --
  windAngle: 5,                             // Wind slant in degrees (0=straight, -30 to 30)

  // -- Splash --
  splashEnabled: true,                      // Enable splash particles when drops hit bottom
  splashRadius: 3,                          // Splash particle spread in grid cells (1-8)
  splashParticleCount: 4,                   // Number of splash particles per drop (1-8)

  // -- Glow --
  backgroundGlowEnabled: true,              // Subtle ambient glow behind rain
  glowColor: 'rgba(60, 160, 255, 0.015)',   // Ambient glow tint color
  glowRadius: 60,                           // Glow circle radius around drops (20-100)

  // -- Mouse --
  mouseRippleRadius: 100,                   // Mouse splash ripple radius in px
  mouseRippleIntensity: 6,                  // How many splash particles the mouse generates (1-15)
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let drops = [];
let splashes = [];
let trailCanvas, trailCtx;

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
      initTrailBuffer();
      initDrops();
      startAnimation();
      break;
    case 'resize':
      width = e.data.width;
      height = e.data.height;
      canvas.width = width;
      canvas.height = height;
      initTrailBuffer();
      initDrops();
      break;
    case 'mousemove':
      mouse.x = e.data.x;
      mouse.y = e.data.y;
      spawnMouseRipple();
      break;
  }
};

function initTrailBuffer() {
  trailCanvas = new OffscreenCanvas(width, height);
  trailCtx = trailCanvas.getContext('2d');
}

function snap(val) {
  return Math.floor(val / CONFIG.pixelSize) * CONFIG.pixelSize;
}

function randomColor() {
  const palette = CONFIG.colorPalette;
  return palette[Math.floor(Math.random() * palette.length)];
}

function initDrops() {
  drops = [];
  for (let i = 0; i < CONFIG.dropCount; i++) {
    drops.push(createDrop(true));
  }
}

function createDrop(randomY) {
  const windRad = (CONFIG.windAngle * Math.PI) / 180;
  return {
    x: snap(Math.random() * width),
    y: randomY ? snap(Math.random() * height) : snap(-CONFIG.pixelSize * CONFIG.dropLength),
    speed: CONFIG.fallSpeed + Math.random() * CONFIG.fallSpeedVariance,
    color: randomColor(),
    windDx: Math.tan(windRad),
  };
}

function spawnMouseRipple() {
  if (!CONFIG.splashEnabled) return;
  if (mouse.x < 0 || mouse.y < 0) return;

  for (let i = 0; i < CONFIG.mouseRippleIntensity; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.5 + Math.random() * 2;
    splashes.push({
      x: snap(mouse.x),
      y: snap(mouse.y),
      vx: Math.cos(angle) * speed * CONFIG.pixelSize,
      vy: Math.sin(angle) * speed * CONFIG.pixelSize - 1,
      life: 1,
      decay: 0.03 + Math.random() * 0.04,
      color: randomColor(),
    });
  }
}

function startAnimation() {
  function render() {
    if (!ctx) return;

    // Fade the trail buffer
    trailCtx.globalAlpha = CONFIG.trailFadeSpeed;
    trailCtx.globalCompositeOperation = 'source-over';
    trailCtx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    // Use destination-in to fade existing content
    trailCtx.globalCompositeOperation = 'destination-in';
    trailCtx.fillStyle = `rgba(0, 0, 0, ${CONFIG.trailFadeSpeed})`;
    trailCtx.fillRect(0, 0, width, height);
    trailCtx.globalCompositeOperation = 'source-over';
    trailCtx.globalAlpha = 1;

    // Update and draw drops onto trail buffer
    const ps = CONFIG.pixelSize;
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];

      // Draw drop pixel column
      for (let j = 0; j < CONFIG.dropLength; j++) {
        const py = d.y - j * ps;
        if (py < 0 || py >= height) continue;
        const alpha = 1 - j / CONFIG.dropLength;
        trailCtx.globalAlpha = alpha;
        trailCtx.fillStyle = d.color;
        trailCtx.fillRect(snap(d.x), snap(py), ps, ps);
      }
      trailCtx.globalAlpha = 1;

      // Background glow
      if (CONFIG.backgroundGlowEnabled) {
        trailCtx.save();
        trailCtx.globalAlpha = 0.02;
        trailCtx.fillStyle = CONFIG.glowColor;
        trailCtx.beginPath();
        trailCtx.arc(d.x + ps / 2, d.y + ps / 2, CONFIG.glowRadius, 0, Math.PI * 2);
        trailCtx.fill();
        trailCtx.restore();
      }

      // Move
      d.y += d.speed * ps * 0.25;
      d.x += d.windDx * d.speed * 0.5;

      // Reset if off screen
      if (d.y > height + ps * CONFIG.dropLength) {
        if (CONFIG.splashEnabled) {
          spawnSplash(d.x, height);
        }
        Object.assign(d, createDrop(false));
      }
      if (d.x < -ps * 5 || d.x > width + ps * 5) {
        Object.assign(d, createDrop(false));
      }
    }

    // Update splashes
    for (let i = splashes.length - 1; i >= 0; i--) {
      const s = splashes[i];
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.15 * ps * 0.25; // Gravity
      s.life -= s.decay;

      if (s.life <= 0) {
        splashes.splice(i, 1);
        continue;
      }

      trailCtx.globalAlpha = s.life;
      trailCtx.fillStyle = s.color;
      trailCtx.fillRect(snap(s.x), snap(s.y), ps, ps);
    }
    trailCtx.globalAlpha = 1;

    // Composite trail buffer to main canvas
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(trailCanvas, 0, 0);

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}

function spawnSplash(x, y) {
  for (let i = 0; i < CONFIG.splashParticleCount; i++) {
    const angle = -Math.PI * (0.15 + Math.random() * 0.7);
    const speed = 0.5 + Math.random() * CONFIG.splashRadius;
    const ps = CONFIG.pixelSize;
    splashes.push({
      x: snap(x),
      y: snap(y - ps),
      vx: Math.cos(angle) * speed * ps * 0.5,
      vy: Math.sin(angle) * speed * ps * 0.5,
      life: 1,
      decay: 0.04 + Math.random() * 0.05,
      color: randomColor(),
    });
  }
}
