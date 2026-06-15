/**
 * Title: Kaleidoscope
 * Description: Mesmerizing kaleidoscope pattern with mirrored segments and
 *   interactive mouse-driven seed point control.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Symmetry --
  segmentCount: 8,                 // Mirror segments (4, 6, 8, 12)
  rotationSpeed: 0.003,            // Rotation speed in radians/frame (0.001-0.02)
  reflectionEnabled: true,         // Enable reflection within segments

  // -- Source Pattern --
  sourcePattern: 'mixed',          // Pattern type: 'circles', 'lines', 'mixed'
  patternElementCount: 30,         // Number of pattern elements per segment (10-80)
  patternSpeed: 0.008,             // Element animation speed (0.001-0.05)
  elementSizeRange: [4, 28],       // Min/max element size in px
  lineWidth: 1.5,                  // Stroke width for line elements (0.5-4)

  // -- Colors --
  colorPalette: [                  // Colors cycled across elements
    '#ff006e', '#fb5607', '#ffbe0b',
    '#8338ec', '#3a86ff', '#06d6a0',
    '#118ab2', '#ef476f'
  ],
  backgroundColor: 'rgba(0,0,0,0.08)', // Trail fade color (lower alpha = longer trails)

  // -- Geometry --
  centerRadius: 30,                // Blank zone at center in px (0-100)
  outerFade: 0.85,                 // Fade start as fraction of radius (0.5-1.0)

  // -- Mouse Interaction --
  // Mouse position shifts the pattern seed point for the source drawing
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let time = 0;
let elements = [];
let cx, cy, maxR;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function initElements() {
  cx = width / 2;
  cy = height / 2;
  maxR = Math.min(cx, cy);
  elements = [];
  for (let i = 0; i < CONFIG.patternElementCount; i++) {
    elements.push(createRandomElement(i));
  }
}

function createRandomElement(index) {
  const types = CONFIG.sourcePattern === 'mixed'
    ? ['circle', 'line']
    : [CONFIG.sourcePattern === 'circles' ? 'circle' : 'line'];
  const type = types[index % types.length];
  const colorIdx = index % CONFIG.colorPalette.length;
  const [minS, maxS] = CONFIG.elementSizeRange;
  return {
    type,
    angle: Math.random() * Math.PI * 2,
    radius: CONFIG.centerRadius + Math.random() * (maxR - CONFIG.centerRadius) * 0.8,
    size: minS + Math.random() * (maxS - minS),
    speed: (0.5 + Math.random()) * CONFIG.patternSpeed,
    radiusSpeed: (Math.random() - 0.5) * CONFIG.patternSpeed * 0.5,
    phase: Math.random() * Math.PI * 2,
    color: CONFIG.colorPalette[colorIdx],
    opacity: 0.4 + Math.random() * 0.6,
  };
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
      initElements();
      startAnimation();
      break;
    case 'resize':
      width = e.data.width;
      height = e.data.height;
      canvas.width = width;
      canvas.height = height;
      initElements();
      break;
    case 'mousemove':
      mouse.x = e.data.x;
      mouse.y = e.data.y;
      break;
  }
};

function parseColor(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function startAnimation() {
  function render() {
    if (!ctx) return;
    time += 1;

    // Trail fade
    ctx.fillStyle = CONFIG.backgroundColor;
    ctx.fillRect(0, 0, width, height);

    const segments = CONFIG.segmentCount;
    const sliceAngle = (Math.PI * 2) / segments;
    const rotation = time * CONFIG.rotationSpeed;

    // Mouse-driven seed offset
    let seedX = 0, seedY = 0;
    if (mouse.x > 0 && mouse.y > 0) {
      seedX = (mouse.x - cx) * 0.002;
      seedY = (mouse.y - cy) * 0.002;
    }

    // Update elements
    for (const el of elements) {
      el.angle += el.speed + seedX * 0.05;
      el.radius += el.radiusSpeed;
      el.phase += CONFIG.patternSpeed;

      // Bounce radius
      if (el.radius < CONFIG.centerRadius || el.radius > maxR * 0.85) {
        el.radiusSpeed *= -1;
        el.radius = Math.max(CONFIG.centerRadius, Math.min(maxR * 0.85, el.radius));
      }
    }

    ctx.save();
    ctx.translate(cx, cy);

    for (let s = 0; s < segments; s++) {
      ctx.save();
      ctx.rotate(rotation + s * sliceAngle);

      // Clip to segment
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, maxR, 0, sliceAngle);
      ctx.closePath();
      ctx.clip();

      // Draw elements in this segment
      for (const el of elements) {
        const a = el.angle + seedY * 0.1;
        const px = Math.cos(a) * el.radius;
        const py = Math.sin(a) * el.radius;

        // Fade near edges
        const distRatio = el.radius / maxR;
        let fade = 1;
        if (distRatio > CONFIG.outerFade) {
          fade = 1 - (distRatio - CONFIG.outerFade) / (1 - CONFIG.outerFade);
        }

        const alpha = el.opacity * fade;
        if (alpha <= 0) continue;

        ctx.fillStyle = parseColor(el.color, alpha);
        ctx.strokeStyle = parseColor(el.color, alpha * 0.8);
        ctx.lineWidth = CONFIG.lineWidth;

        if (el.type === 'circle') {
          const pulsedSize = el.size * (0.7 + 0.3 * Math.sin(el.phase));
          ctx.beginPath();
          ctx.arc(px, py, pulsedSize, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const len = el.size * 1.5;
          const la = a + Math.sin(el.phase) * 0.5;
          ctx.beginPath();
          ctx.moveTo(px - Math.cos(la) * len, py - Math.sin(la) * len);
          ctx.lineTo(px + Math.cos(la) * len, py + Math.sin(la) * len);
          ctx.stroke();
        }

        // Reflection
        if (CONFIG.reflectionEnabled) {
          const ry = -py;
          ctx.fillStyle = parseColor(el.color, alpha * 0.5);
          ctx.strokeStyle = parseColor(el.color, alpha * 0.4);
          if (el.type === 'circle') {
            const pulsedSize = el.size * (0.7 + 0.3 * Math.sin(el.phase));
            ctx.beginPath();
            ctx.arc(px, ry, pulsedSize, 0, Math.PI * 2);
            ctx.fill();
          } else {
            const len = el.size * 1.5;
            const la = -a + Math.sin(el.phase) * 0.5;
            ctx.beginPath();
            ctx.moveTo(px - Math.cos(la) * len, ry - Math.sin(la) * len);
            ctx.lineTo(px + Math.cos(la) * len, ry + Math.sin(la) * len);
            ctx.stroke();
          }
        }
      }

      ctx.restore();
    }

    // Center mask
    if (CONFIG.centerRadius > 0) {
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, CONFIG.centerRadius);
      grad.addColorStop(0, 'rgba(0,0,0,0.9)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, CONFIG.centerRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}
