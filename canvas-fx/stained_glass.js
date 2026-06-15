/**
 * Title: Stained Glass
 * Description: Animated stained glass mosaic with Voronoi cells, glowing
 *   lead joints, color shifting, and refraction shimmer. Mouse creates a
 *   radial light glow on the glass surface.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Cell Layout --
  cellCount: 80,                   // Number of Voronoi cells (20-200)

  // -- Colors --
  cellColors: [                    // Palette for glass cell fills
    '#c2185b', '#e65100', '#f9a825',
    '#2e7d32', '#0277bd', '#4a148c',
    '#ad1457', '#00695c', '#283593',
    '#bf360c', '#1565c0', '#6a1b9a'
  ],
  cellOpacity: 0.45,               // Base cell fill opacity (0-1)

  // -- Lead Joints --
  leadColor: '#1a1a2e',            // Lead line color (dark for contrast)
  leadWidth: 2.5,                  // Lead line width in px (1-6)

  // -- Glow Effect --
  glowEnabled: true,               // Enable glow on lead joints
  glowColor: 'rgba(255,220,150,0.4)', // Warm glow color for joints
  glowIntensity: 8,                // Glow blur radius in px (2-20)

  // -- Animation --
  colorShiftSpeed: 0.003,          // Speed of color cycling (0.001-0.02)
  colorShiftAmount: 0.3,           // How much hue shifts (0-1)

  // -- Shimmer --
  refractionShimmer: true,         // Enable light refraction shimmer
  shimmerSpeed: 0.015,             // Shimmer oscillation speed (0.005-0.05)
  shimmerIntensity: 0.2,           // Shimmer brightness variation (0-0.5)

  // -- Mouse Interaction --
  mouseGlowRadius: 200,            // Radius of mouse light glow in px (50-400)
  mouseGlowColor: 'rgba(255,255,220,0.35)', // Color of mouse spotlight
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let time = 0;
let seeds = [];
let cellColorIndices = [];

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function initSeeds() {
  seeds = [];
  cellColorIndices = [];
  for (let i = 0; i < CONFIG.cellCount; i++) {
    seeds.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
    });
    cellColorIndices.push(Math.floor(Math.random() * CONFIG.cellColors.length));
  }
}

function hexToHSL(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h, s, l };
}

function hslToRgba(h, s, l, a) {
  h = ((h % 1) + 1) % 1;
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
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
      initSeeds();
      startAnimation();
      break;
    case 'resize':
      width = e.data.width;
      height = e.data.height;
      canvas.width = width;
      canvas.height = height;
      initSeeds();
      break;
    case 'mousemove':
      mouse.x = e.data.x;
      mouse.y = e.data.y;
      break;
  }
};

function startAnimation() {
  const step = 5; // Pixel sampling step for Voronoi

  function render() {
    if (!ctx) return;
    time += 1;
    ctx.clearRect(0, 0, width, height);

    // Move seeds slightly
    for (const s of seeds) {
      s.x += s.vx;
      s.y += s.vy;
      if (s.x < 0 || s.x > width) s.vx *= -1;
      if (s.y < 0 || s.y > height) s.vy *= -1;
      s.x = Math.max(0, Math.min(width, s.x));
      s.y = Math.max(0, Math.min(height, s.y));
    }

    // Build Voronoi via pixel assignment (sampled)
    const sampledCols = Math.ceil(width / step);
    const sampledRows = Math.ceil(height / step);
    const cellMap = new Int16Array(sampledCols * sampledRows);

    for (let sy = 0; sy < sampledRows; sy++) {
      for (let sx = 0; sx < sampledCols; sx++) {
        const px = sx * step, py = sy * step;
        let minD = Infinity, closest = 0;
        for (let i = 0; i < seeds.length; i++) {
          const dx = px - seeds[i].x, dy = py - seeds[i].y;
          const d = dx * dx + dy * dy;
          if (d < minD) { minD = d; closest = i; }
        }
        cellMap[sy * sampledCols + sx] = closest;
      }
    }

    // Draw filled cells
    for (let i = 0; i < seeds.length; i++) {
      const baseColor = CONFIG.cellColors[cellColorIndices[i]];
      const hsl = hexToHSL(baseColor);
      const hueShift = Math.sin(time * CONFIG.colorShiftSpeed + i * 0.5) * CONFIG.colorShiftAmount;
      let shimmerBoost = 0;
      if (CONFIG.refractionShimmer) {
        shimmerBoost = Math.sin(time * CONFIG.shimmerSpeed + i * 1.7) * CONFIG.shimmerIntensity;
      }
      const fillColor = hslToRgba(
        hsl.h + hueShift,
        hsl.s,
        Math.min(1, hsl.l + shimmerBoost),
        CONFIG.cellOpacity
      );
      ctx.fillStyle = fillColor;

      // Draw sampled blocks for this cell
      for (let sy = 0; sy < sampledRows; sy++) {
        let runStart = -1;
        for (let sx = 0; sx <= sampledCols; sx++) {
          const isCurrent = sx < sampledCols && cellMap[sy * sampledCols + sx] === i;
          if (isCurrent && runStart < 0) {
            runStart = sx;
          } else if (!isCurrent && runStart >= 0) {
            ctx.fillRect(runStart * step, sy * step, (sx - runStart) * step, step);
            runStart = -1;
          }
        }
      }
    }

    // Draw lead joints (cell boundaries)
    if (CONFIG.glowEnabled) {
      ctx.shadowColor = CONFIG.glowColor;
      ctx.shadowBlur = CONFIG.glowIntensity;
    }
    ctx.strokeStyle = CONFIG.leadColor;
    ctx.lineWidth = CONFIG.leadWidth;

    for (let sy = 0; sy < sampledRows - 1; sy++) {
      for (let sx = 0; sx < sampledCols - 1; sx++) {
        const c = cellMap[sy * sampledCols + sx];
        const cr = cellMap[sy * sampledCols + sx + 1];
        const cb = cellMap[(sy + 1) * sampledCols + sx];
        const px = sx * step, py = sy * step;
        if (c !== cr) {
          ctx.beginPath();
          ctx.moveTo(px + step, py);
          ctx.lineTo(px + step, py + step);
          ctx.stroke();
        }
        if (c !== cb) {
          ctx.beginPath();
          ctx.moveTo(px, py + step);
          ctx.lineTo(px + step, py + step);
          ctx.stroke();
        }
      }
    }
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // Mouse glow spotlight
    if (mouse.x > 0 && mouse.y > 0) {
      const grad = ctx.createRadialGradient(
        mouse.x, mouse.y, 0,
        mouse.x, mouse.y, CONFIG.mouseGlowRadius
      );
      grad.addColorStop(0, CONFIG.mouseGlowColor);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(
        mouse.x - CONFIG.mouseGlowRadius,
        mouse.y - CONFIG.mouseGlowRadius,
        CONFIG.mouseGlowRadius * 2,
        CONFIG.mouseGlowRadius * 2
      );
    }

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}
