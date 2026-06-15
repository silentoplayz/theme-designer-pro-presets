/**
 * Title: Synthwave Grid
 * Description: 80s synthwave perspective grid receding toward a horizon with
 *   optional retro sun and neon glow. Mouse Y position adjusts horizon height.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Grid Appearance --
  lineColor: 'rgba(255, 0, 200, 0.6)',     // Color of grid lines
  lineOpacity: 0.6,                         // Overall grid line opacity (0-1)
  lineWidth: 1.2,                           // Grid line thickness in pixels
  horizontalLineCount: 20,                  // Number of horizontal receding lines
  verticalLineCount: 24,                    // Number of vertical lines across the grid

  // -- Motion --
  gridSpeed: 0.8,                           // Speed of the grid scrolling toward the viewer (0.1-3)

  // -- Perspective --
  horizonPosition: 0.4,                     // Default horizon Y position (0=top, 1=bottom)
  perspectiveIntensity: 1.4,                // How aggressively lines converge (0.5-3)

  // -- Glow --
  glowAmount: 12,                           // Neon glow blur radius in pixels (0-30)
  glowColor: 'rgba(255, 0, 200, 0.4)',      // Glow color around grid lines

  // -- Sun --
  sunEnabled: true,                         // Whether to draw the retro sun (true/false)
  sunColor: '#ff6a00',                      // Sun primary color
  sunSize: 80,                              // Sun radius in pixels (20-200)
  sunStripes: 7,                            // Number of horizontal cutout stripes on the sun

  // -- Sky / Background --
  skyGradientColors: [                      // Gradient stops from top to horizon
    'rgba(10, 0, 40, 1)',                   //   Deep space purple
    'rgba(40, 0, 80, 1)',                   //   Mid purple
    'rgba(120, 0, 60, 1)',                  //   Warm magenta
    'rgba(255, 100, 0, 0.6)'               //   Horizon orange glow
  ],

  // -- Mouse --
  mouseInfluence: 0.3,                      // How much mouse Y adjusts horizon (0=none, 1=full)
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let scrollOffset = 0;

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

function startAnimation() {
  let lastTime = 0;

  function render(time) {
    if (!ctx) return;
    const dt = lastTime ? (time - lastTime) / 16.67 : 1;
    lastTime = time;

    // Calculate horizon Y — influenced by mouse
    let horizonY = CONFIG.horizonPosition * height;
    if (mouse.y > 0 && mouse.y < height) {
      const mouseNorm = mouse.y / height;
      horizonY = horizonY + (mouseNorm - CONFIG.horizonPosition) * height * CONFIG.mouseInfluence;
    }
    horizonY = Math.max(height * 0.1, Math.min(height * 0.9, horizonY));

    // Clear
    ctx.clearRect(0, 0, width, height);

    // -- Sky gradient --
    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
    const colors = CONFIG.skyGradientColors;
    for (let i = 0; i < colors.length; i++) {
      skyGrad.addColorStop(i / (colors.length - 1), colors[i]);
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, horizonY);

    // -- Ground gradient --
    const groundGrad = ctx.createLinearGradient(0, horizonY, 0, height);
    groundGrad.addColorStop(0, 'rgba(20, 0, 40, 1)');
    groundGrad.addColorStop(1, 'rgba(5, 0, 15, 1)');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, horizonY, width, height - horizonY);

    // -- Sun --
    if (CONFIG.sunEnabled) {
      drawSun(horizonY);
    }

    // -- Grid --
    ctx.save();
    if (CONFIG.glowAmount > 0) {
      ctx.shadowBlur = CONFIG.glowAmount;
      ctx.shadowColor = CONFIG.glowColor;
    }
    ctx.strokeStyle = CONFIG.lineColor;
    ctx.lineWidth = CONFIG.lineWidth;
    ctx.globalAlpha = CONFIG.lineOpacity;

    // Vertical lines (converging at vanishing point)
    const vanishX = width / 2;
    const totalV = CONFIG.verticalLineCount;
    for (let i = 0; i <= totalV; i++) {
      const t = i / totalV;
      const bottomX = t * width;
      ctx.beginPath();
      ctx.moveTo(vanishX, horizonY);
      ctx.lineTo(bottomX, height);
      ctx.stroke();
    }

    // Horizontal lines (receding with perspective)
    scrollOffset += CONFIG.gridSpeed * dt * 0.02;
    if (scrollOffset > 1) scrollOffset -= 1;

    const totalH = CONFIG.horizontalLineCount;
    for (let i = 0; i < totalH; i++) {
      const rawT = (i / totalH + scrollOffset) % 1;
      // Apply perspective compression — lines bunch up near horizon
      const t = Math.pow(rawT, CONFIG.perspectiveIntensity);
      const y = horizonY + t * (height - horizonY);

      // Fade lines near horizon
      const fade = Math.pow(rawT, 0.5);
      ctx.globalAlpha = CONFIG.lineOpacity * fade;

      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    ctx.restore();

    requestAnimationFrame(render);
  }

  function drawSun(horizonY) {
    const cx = width / 2;
    const cy = horizonY;
    const r = CONFIG.sunSize;

    // Sun gradient
    const sunGrad = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    sunGrad.addColorStop(0, CONFIG.sunColor);
    sunGrad.addColorStop(1, 'rgba(255, 0, 100, 0.8)');

    ctx.save();

    // Clip to upper half (above horizon)
    ctx.beginPath();
    ctx.rect(0, 0, width, horizonY);
    ctx.clip();

    // Draw sun circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = sunGrad;

    // Sun glow
    ctx.shadowBlur = 40;
    ctx.shadowColor = CONFIG.sunColor;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Stripe cutouts
    ctx.globalCompositeOperation = 'destination-out';
    const stripeCount = CONFIG.sunStripes;
    const stripeRegion = r * 0.8; // Bottom 80% of sun has stripes
    for (let i = 0; i < stripeCount; i++) {
      const t = (i + 1) / (stripeCount + 1);
      const stripeY = cy - r + r * 0.2 + t * stripeRegion;
      const stripeH = 2 + i * 1.2;
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fillRect(cx - r - 5, stripeY, r * 2 + 10, stripeH);
    }

    ctx.restore();
  }

  requestAnimationFrame(render);
}
