/**
 * Title: CRT Monitor
 * Description: CRT monitor effect with scanlines, vignette, subtle flicker,
 *   phosphor glow, chromatic aberration, and curvature. Mouse position creates
 *   a magnetic distortion ripple.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Scanlines --
  scanlineSpacing: 3,                       // Pixels between each scanline (2-8)
  scanlineOpacity: 0.12,                    // Scanline darkness (0-0.5)
  scanlineColor: 'rgba(0, 0, 0, 1)',        // Scanline color (usually black)
  scanlineScrollSpeed: 0.3,                 // Slow downward scroll of scanlines (0-2)

  // -- Flicker --
  flickerIntensity: 0.03,                   // Brightness flicker amount (0-0.15)
  flickerSpeed: 8,                          // Flicker oscillation speed (1-30)

  // -- Vignette --
  vignetteStrength: 0.6,                    // How dark the edges get (0-1)
  vignetteColor: 'rgba(0, 0, 0, 1)',        // Vignette tint color
  vignetteRadius: 0.75,                     // Inner clear radius as fraction of screen (0.3-1)

  // -- CRT Curvature --
  curvatureAmount: 0.03,                    // Barrel distortion strength (0-0.1, 0 = flat)

  // -- Noise / Static --
  staticNoiseAmount: 0.04,                  // Amount of random noise grain (0-0.2)
  noiseGrainSize: 2,                        // Size of noise grain pixels (1-4)

  // -- Phosphor Glow --
  phosphorGlowColor: 'rgba(0, 255, 80, 0.03)', // Subtle green phosphor tint
  phosphorGlowBlur: 4,                     // Phosphor bloom blur radius (0-10)

  // -- Chromatic Aberration --
  chromaticAberrationOffset: 1.5,           // RGB channel split in pixels (0-5)

  // -- Mouse Distortion --
  mouseDistortionRadius: 120,               // Radius of mouse magnetic effect in px
  mouseDistortionStrength: 8,               // Intensity of magnetic warp (0-20)
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let time = 0;
let noiseImageData = null;

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
      generateNoise();
      startAnimation();
      break;
    case 'resize':
      width = e.data.width;
      height = e.data.height;
      canvas.width = width;
      canvas.height = height;
      generateNoise();
      break;
    case 'mousemove':
      mouse.x = e.data.x;
      mouse.y = e.data.y;
      break;
  }
};

function generateNoise() {
  const grain = CONFIG.noiseGrainSize;
  const nw = Math.ceil(width / grain);
  const nh = Math.ceil(height / grain);
  noiseImageData = { width: nw, height: nh, grain };
}

function startAnimation() {
  function render(timestamp) {
    if (!ctx) return;
    time = timestamp * 0.001;

    ctx.clearRect(0, 0, width, height);

    // -- Flicker --
    const flicker = 1 + Math.sin(time * CONFIG.flickerSpeed * Math.PI) * CONFIG.flickerIntensity
      + Math.sin(time * CONFIG.flickerSpeed * 2.7) * CONFIG.flickerIntensity * 0.3;

    // -- Phosphor glow base --
    ctx.save();
    ctx.globalAlpha = flicker;
    ctx.fillStyle = CONFIG.phosphorGlowColor;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    // -- Static noise --
    drawNoise();

    // -- Mouse magnetic distortion --
    drawMouseDistortion();

    // -- Scanlines --
    drawScanlines();

    // -- Chromatic aberration fringe --
    drawChromaticAberration();

    // -- Vignette --
    drawVignette();

    // -- Screen curvature overlay --
    drawCurvature();

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}

function drawScanlines() {
  const spacing = CONFIG.scanlineSpacing;
  const scrollOffset = (time * CONFIG.scanlineScrollSpeed * 60) % spacing;

  ctx.save();
  ctx.fillStyle = CONFIG.scanlineColor;
  ctx.globalAlpha = CONFIG.scanlineOpacity;

  for (let y = -spacing + scrollOffset; y < height; y += spacing) {
    ctx.fillRect(0, y, width, 1);
  }
  ctx.restore();
}

function drawNoise() {
  if (CONFIG.staticNoiseAmount <= 0) return;

  const grain = CONFIG.noiseGrainSize;
  const cols = Math.ceil(width / grain);
  const rows = Math.ceil(height / grain);

  ctx.save();
  ctx.globalAlpha = CONFIG.staticNoiseAmount;

  // Draw a sparse scattering of noise pixels for performance
  const count = Math.floor(cols * rows * 0.08);
  for (let i = 0; i < count; i++) {
    const x = Math.floor(Math.random() * cols) * grain;
    const y = Math.floor(Math.random() * rows) * grain;
    const brightness = Math.floor(Math.random() * 255);
    ctx.fillStyle = `rgb(${brightness},${brightness},${brightness})`;
    ctx.fillRect(x, y, grain, grain);
  }
  ctx.restore();
}

function drawVignette() {
  const cx = width / 2;
  const cy = height / 2;
  const maxDim = Math.max(width, height);
  const innerR = maxDim * CONFIG.vignetteRadius * 0.5;
  const outerR = maxDim * 0.85;

  const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, CONFIG.vignetteColor);

  ctx.save();
  ctx.globalAlpha = CONFIG.vignetteStrength;
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function drawCurvature() {
  if (CONFIG.curvatureAmount <= 0) return;

  // Darken edges to simulate barrel distortion
  const c = CONFIG.curvatureAmount;
  ctx.save();
  ctx.globalAlpha = c * 5;

  // Top and bottom curves
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(width / 2, height * c * 2, width, 0);
  ctx.lineTo(width, 0);
  ctx.lineTo(0, 0);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, height);
  ctx.quadraticCurveTo(width / 2, height - height * c * 2, width, height);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.fill();

  // Left and right curves
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(width * c * 2, height / 2, 0, height);
  ctx.lineTo(0, height);
  ctx.lineTo(0, 0);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(width, 0);
  ctx.quadraticCurveTo(width - width * c * 2, height / 2, width, height);
  ctx.lineTo(width, height);
  ctx.lineTo(width, 0);
  ctx.fill();

  ctx.restore();
}

function drawChromaticAberration() {
  const offset = CONFIG.chromaticAberrationOffset;
  if (offset <= 0) return;

  // Subtle colored edge fringe
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.globalCompositeOperation = 'screen';

  // Red shift left
  ctx.fillStyle = 'rgba(255, 0, 0, 1)';
  ctx.fillRect(-offset, 0, width, height);

  // Blue shift right
  ctx.fillStyle = 'rgba(0, 0, 255, 1)';
  ctx.fillRect(offset, 0, width, height);

  ctx.restore();
}

function drawMouseDistortion() {
  if (mouse.x < 0 || mouse.y < 0) return;
  const r = CONFIG.mouseDistortionRadius;
  const strength = CONFIG.mouseDistortionStrength;
  if (strength <= 0) return;

  ctx.save();
  ctx.globalAlpha = 0.08;

  // Draw concentric distortion rings
  const ringCount = 5;
  for (let i = 0; i < ringCount; i++) {
    const t = (i + time * 2) % ringCount;
    const ringR = (t / ringCount) * r;
    const alpha = (1 - t / ringCount) * 0.15 * (strength / 10);

    ctx.globalAlpha = alpha;
    ctx.strokeStyle = CONFIG.phosphorGlowColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, ringR, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Scanline bend near mouse
  ctx.globalAlpha = 0.05 * (strength / 10);
  ctx.fillStyle = 'rgba(255,255,255,1)';
  const bandH = strength * 0.5;
  ctx.fillRect(0, mouse.y - bandH, width, bandH * 2);

  ctx.restore();
}
