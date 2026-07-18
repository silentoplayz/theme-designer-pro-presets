/**
 * Title: VHS Static
 * Description: Authentic VHS tracking effect with rolling tracking bars, random static
 *   noise, horizontal jitter, chromatic aberration, scanlines, and mouse-proximity
 *   distortion amplification.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Static Noise --
  staticDensity: 0.03,                    // Fraction of pixels that get static (0-1)
  staticColor: 'rgba(255, 255, 255, 0.1)', // Base static noise color
  noiseGrainSize: 2,                      // Size of noise grain pixels
  noiseOpacity: 0.08,                     // Overall noise layer opacity (0-1)

  // -- Tracking Bars --
  trackingBarHeight: 30,                  // Height of rolling tracking bar in px
  trackingBarSpeed: 1.5,                  // Scroll speed of tracking bar (px/frame)
  trackingBarOpacity: 0.15,              // Tracking bar opacity (0-1)
  trackingBarColor: 'rgba(255, 255, 255, 0.2)', // Tracking bar fill color

  // -- Distortion --
  colorBleedAmount: 3,                    // Chromatic aberration offset in px
  horizontalJitter: 2,                    // Max horizontal shift in px

  // -- Scanlines --
  scanlineEnabled: true,                  // Show CRT-style scanlines
  scanlineSpacing: 3,                     // Pixels between scanlines

  // -- Overall --
  overallIntensity: 0.7,                  // Master intensity multiplier (0-1)

  // -- Mouse --
  mouseDistortRadius: 200,               // Mouse influence radius for distortion boost
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let trackingY = 0;
let time = 0;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function startAnimation() {
  function render() {
    if (!ctx) return;
    time += 0.016;
    ctx.clearRect(0, 0, width, height);

    const intensity = CONFIG.overallIntensity;

    // -- Tracking bar --
    trackingY = (trackingY + CONFIG.trackingBarSpeed) % (height + CONFIG.trackingBarHeight * 2);
    const barY = trackingY - CONFIG.trackingBarHeight;

    ctx.fillStyle = CONFIG.trackingBarColor;
    ctx.globalAlpha = CONFIG.trackingBarOpacity * intensity;
    ctx.fillRect(0, barY, width, CONFIG.trackingBarHeight);

    // Bright edge lines on tracking bar
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.globalAlpha = CONFIG.trackingBarOpacity * intensity * 0.8;
    ctx.fillRect(0, barY, width, 1);
    ctx.fillRect(0, barY + CONFIG.trackingBarHeight - 1, width, 1);
    ctx.globalAlpha = 1;

    // -- Horizontal jitter near tracking bar --
    const jitterZone = CONFIG.trackingBarHeight * 3;
    for (let y = Math.max(0, barY - jitterZone); y < Math.min(height, barY + CONFIG.trackingBarHeight + jitterZone); y += 2) {
      const distToBar = Math.abs(y - (barY + CONFIG.trackingBarHeight / 2));
      const jitterAmount = Math.max(0, 1 - distToBar / jitterZone);
      if (jitterAmount > 0.1) {
        const shift = (Math.random() - 0.5) * CONFIG.horizontalJitter * jitterAmount * intensity * 4;
        if (Math.abs(shift) > 0.5) {
          ctx.globalAlpha = 0.05 * intensity;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.fillRect(shift > 0 ? 0 : width + shift, y, Math.abs(shift), 2);
          ctx.globalAlpha = 1;
        }
      }
    }

    // -- Chromatic aberration / color bleed --
    if (CONFIG.colorBleedAmount > 0) {
      const bleed = CONFIG.colorBleedAmount * intensity;
      // Red channel shift
      ctx.globalAlpha = 0.02 * intensity;
      ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
      for (let y = 0; y < height; y += 8) {
        if (Math.random() < 0.3) {
          const shift = (Math.random() - 0.5) * bleed * 2;
          ctx.fillRect(shift, y, width, 1);
        }
      }
      // Cyan channel shift
      ctx.fillStyle = 'rgba(0, 255, 255, 0.5)';
      for (let y = 0; y < height; y += 8) {
        if (Math.random() < 0.3) {
          const shift = (Math.random() - 0.5) * bleed * 2;
          ctx.fillRect(-shift, y, width, 1);
        }
      }
      ctx.globalAlpha = 1;
    }

    // -- Static noise --
    const grainSize = CONFIG.noiseGrainSize;
    const cols = Math.ceil(width / grainSize);
    const rows = Math.ceil(height / grainSize);
    const totalPixels = cols * rows;
    const staticCount = Math.floor(totalPixels * CONFIG.staticDensity * intensity);

    ctx.globalAlpha = CONFIG.noiseOpacity * intensity;
    for (let i = 0; i < staticCount; i++) {
      const x = Math.floor(Math.random() * cols) * grainSize;
      const y = Math.floor(Math.random() * rows) * grainSize;
      const brightness = Math.floor(Math.random() * 200 + 55);
      ctx.fillStyle = `rgba(${brightness}, ${brightness}, ${brightness}, 0.6)`;
      ctx.fillRect(x, y, grainSize, grainSize);
    }
    ctx.globalAlpha = 1;

    // -- Mouse proximity distortion --
    if (mouse.x > 0 && mouse.y > 0) {
      const mRadius = CONFIG.mouseDistortRadius;
      // Extra noise burst near mouse
      ctx.globalAlpha = 0.06 * intensity;
      for (let i = 0; i < 40; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * mRadius;
        const px = mouse.x + Math.cos(angle) * dist;
        const py = mouse.y + Math.sin(angle) * dist;
        const falloff = 1 - dist / mRadius;
        const brightness = Math.floor(Math.random() * 255);
        ctx.fillStyle = `rgba(${brightness}, ${brightness}, ${brightness}, ${falloff * 0.5})`;
        ctx.fillRect(px, py, grainSize * 2, grainSize);
      }
      ctx.globalAlpha = 1;

      // Horizontal tear near mouse
      const tearCount = 3;
      for (let i = 0; i < tearCount; i++) {
        const tearY = mouse.y + (Math.random() - 0.5) * mRadius * 0.6;
        if (tearY > 0 && tearY < height) {
          const tearShift = (Math.random() - 0.5) * CONFIG.horizontalJitter * 6 * intensity;
          ctx.globalAlpha = 0.04 * intensity;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.fillRect(tearShift, tearY, width, 1);
          ctx.globalAlpha = 1;
        }
      }
    }

    // -- Scanlines --
    if (CONFIG.scanlineEnabled) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
      ctx.globalAlpha = intensity * 0.5;
      for (let y = 0; y < height; y += CONFIG.scanlineSpacing) {
        ctx.fillRect(0, y, width, 1);
      }
      ctx.globalAlpha = 1;
    }

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
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
      startAnimation();
      break;
    case 'resize':
      width = e.data.width;
      height = e.data.height;
      canvas.width = width;
      canvas.height = height;
      break;
    case 'mousemove':
      mouse.x = e.data.x;
      mouse.y = e.data.y;
      break;
  }
};
