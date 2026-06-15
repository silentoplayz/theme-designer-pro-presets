/**
 * Title: Retro Sun
 * Description: Synthwave sunset with a glowing semi-circle sun, animated horizontal
 *   stripe cutouts, twinkling stars, and a rich gradient sky. Mouse proximity
 *   intensifies the sun's glow.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Sun --
  sunColorTop: '#ff6ec7',                 // Top gradient color of the sun
  sunColorBottom: '#ffb347',              // Bottom gradient color of the sun
  sunRadius: 120,                         // Sun radius in pixels
  sunPositionY: 0.55,                     // Sun vertical position (0=top, 1=bottom)
  glowIntensity: 1.2,                     // Base glow brightness (0-3)
  glowPulseSpeed: 0.8,                    // Glow pulse animation speed (0-5)

  // -- Stripes --
  stripeCount: 8,                         // Number of horizontal stripe cutouts
  stripeSpacing: 6,                       // Spacing between stripes in pixels
  stripeWidth: 4,                         // Width of each stripe in pixels
  stripeScrollSpeed: 0.3,                 // Speed stripes scroll upward

  // -- Horizon --
  horizonEnabled: true,                   // Show a horizon line
  horizonColor: '#ff6ec7',                // Horizon line color

  // -- Background --
  bgGradientTop: '#0a001a',              // Sky gradient top color (deep purple/black)
  bgGradientBottom: '#1a0033',           // Sky gradient bottom color

  // -- Stars --
  starCount: 80,                          // Number of twinkling stars
  starColor: 'rgba(255, 255, 255, 0.8)', // Star color

  // -- Mouse --
  mouseGlowRadius: 300,                  // Mouse influence radius for glow boost
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let stars = [];
let time = 0;
let stripeOffset = 0;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function initStars() {
  stars = [];
  const sunY = height * CONFIG.sunPositionY;
  for (let i = 0; i < CONFIG.starCount; i++) {
    stars.push({
      x: Math.random() * width,
      y: Math.random() * sunY * 0.9,
      size: Math.random() * 1.8 + 0.5,
      twinkleSpeed: Math.random() * 0.03 + 0.01,
      twinkleOffset: Math.random() * Math.PI * 2,
    });
  }
}

function startAnimation() {
  function render() {
    if (!ctx) return;
    time += 0.016;
    stripeOffset = (stripeOffset + CONFIG.stripeScrollSpeed) % (CONFIG.stripeSpacing + CONFIG.stripeWidth);

    const sunY = height * CONFIG.sunPositionY;
    const sunX = width / 2;

    // -- Background gradient --
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, CONFIG.bgGradientTop);
    bgGrad.addColorStop(0.6, CONFIG.bgGradientBottom);
    bgGrad.addColorStop(1, '#000000');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // -- Stars --
    for (const star of stars) {
      const twinkle = 0.3 + 0.7 * Math.abs(Math.sin(time * star.twinkleSpeed * 60 + star.twinkleOffset));
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fillStyle = CONFIG.starColor.replace(/[\d.]+\)$/, (twinkle * 0.8).toFixed(2) + ')');
      ctx.fill();
    }

    // -- Sun glow (behind sun) --
    const dx = mouse.x - sunX;
    const dy = mouse.y - sunY;
    const mouseDist = Math.sqrt(dx * dx + dy * dy);
    const mouseBoost = Math.max(0, 1 - mouseDist / CONFIG.mouseGlowRadius) * 0.6;
    const pulse = Math.sin(time * CONFIG.glowPulseSpeed) * 0.15 + 0.85;
    const glowAlpha = CONFIG.glowIntensity * pulse * 0.15 + mouseBoost * 0.1;

    const topRgb = hexToRgb(CONFIG.sunColorTop);
    for (let i = 3; i >= 1; i--) {
      const r = CONFIG.sunRadius * (1 + i * 0.8);
      const glow = ctx.createRadialGradient(sunX, sunY, CONFIG.sunRadius * 0.5, sunX, sunY, r);
      glow.addColorStop(0, `rgba(${topRgb.r}, ${topRgb.g}, ${topRgb.b}, ${glowAlpha * (0.4 / i)})`);
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
    }

    // -- Sun body (semi-circle above horizon) --
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, sunY);
    ctx.clip();

    const sunGrad = ctx.createLinearGradient(sunX, sunY - CONFIG.sunRadius, sunX, sunY + CONFIG.sunRadius * 0.3);
    sunGrad.addColorStop(0, CONFIG.sunColorTop);
    sunGrad.addColorStop(1, CONFIG.sunColorBottom);
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(sunX, sunY, CONFIG.sunRadius, 0, Math.PI * 2);
    ctx.fill();

    // -- Stripe cutouts on sun --
    ctx.globalCompositeOperation = 'destination-out';
    const stripeStart = sunY - CONFIG.sunRadius;
    const stripeEnd = sunY;
    for (let y = stripeStart + stripeOffset; y < stripeEnd; y += CONFIG.stripeSpacing + CONFIG.stripeWidth) {
      if (y > stripeStart + CONFIG.sunRadius * 0.3) {
        ctx.fillStyle = 'rgba(0, 0, 0, 1)';
        ctx.fillRect(sunX - CONFIG.sunRadius - 10, y, CONFIG.sunRadius * 2 + 20, CONFIG.stripeWidth);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // -- Horizon line --
    if (CONFIG.horizonEnabled) {
      ctx.strokeStyle = CONFIG.horizonColor;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(0, sunY);
      ctx.lineTo(width, sunY);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // -- Ground reflection glow --
    const groundGrad = ctx.createLinearGradient(0, sunY, 0, height);
    const bottomRgb = hexToRgb(CONFIG.sunColorBottom);
    groundGrad.addColorStop(0, `rgba(${bottomRgb.r}, ${bottomRgb.g}, ${bottomRgb.b}, 0.08)`);
    groundGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, sunY, width, height - sunY);

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
      initStars();
      startAnimation();
      break;
    case 'resize':
      width = e.data.width;
      height = e.data.height;
      canvas.width = width;
      canvas.height = height;
      initStars();
      break;
    case 'mousemove':
      mouse.x = e.data.x;
      mouse.y = e.data.y;
      break;
  }
};
