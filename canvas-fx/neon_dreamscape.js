/**
 * Title: Neon Dreamscape
 * Description: Paint persistent glowing neon tube trails by moving your mouse.
 *   Trails pulse with light, slowly fade leaving ghost impressions, and cast an
 *   ambient fog glow. Mouse speed affects stroke width. Color cycles through a
 *   configurable palette. Cyberpunk neon sign energy.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Trail Color --
  trailColor: '#ff00ff',                  // Primary neon color (when not cycling)
  colorCycle: true,                       // Cycle through palette over time
  colorPalette: [                         // Colors to cycle through
    '#ff00ff', '#00ffff', '#ff3366',
    '#33ff99', '#ff9900', '#6633ff',
  ],
  colorCycleSpeed: 0.4,                   // Palette cycle speed (0.1-3)

  // -- Glow Rendering --
  glowRadius: 28,                         // Outer aura size in px (10-60)
  glowIntensity: 1.4,                     // Glow brightness multiplier (0.5-3)
  coreWidth: 2.5,                         // Bright center line width in px (1-6)

  // -- Trail Behavior --
  trailFadeSpeed: 0.006,                  // How fast trails disappear (0.001-0.05)
  trailGhostOpacity: 0.02,               // Minimum opacity of faded trails (0-0.1)
  maxTrailPoints: 600,                    // Max points stored per active trail

  // -- Pulse & Flicker --
  pulseSpeed: 1.2,                        // Brightness pulse frequency (0-5)
  pulseAmount: 0.18,                      // Pulse amplitude (0-0.5)
  flickerEnabled: true,                   // Random brightness drops
  flickerIntensity: 0.35,                 // Flicker depth (0-0.8)

  // -- Ambient --
  ambientFog: true,                       // Background fog tinted by neon
  fogColor: '#1a0030',                    // Fog base tint
  fogOpacity: 0.025,                      // Fog density per frame (0.005-0.1)
  speedWidthEffect: 1.0,                  // Speed \u2192 width mapping (0-2, 0=constant width)
  backgroundColor: '#050510',             // Deep background color
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -1, y: -1 };
let prevMouse = { x: -1, y: -1 };
let time = 0;
let trails = []; // array of completed trails
let activeTrail = null; // currently being drawn
let isDrawing = false;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function getCurrentColor() {
  if (!CONFIG.colorCycle) return hexToRgb(CONFIG.trailColor);
  const pal = CONFIG.colorPalette;
  const t = (time * CONFIG.colorCycleSpeed) % pal.length;
  const i0 = Math.floor(t) % pal.length;
  const i1 = (i0 + 1) % pal.length;
  const f = t - Math.floor(t);
  const c0 = hexToRgb(pal[i0]), c1 = hexToRgb(pal[i1]);
  return [
    c0[0] + (c1[0] - c0[0]) * f,
    c0[1] + (c1[1] - c0[1]) * f,
    c0[2] + (c1[2] - c0[2]) * f,
  ];
}

class Trail {
  constructor() {
    this.points = []; // {x, y, color, width}
    this.opacity = 1;
    this.birthTime = time;
  }

  addPoint(x, y, color, w) {
    this.points.push({ x, y, color, width: w });
    if (this.points.length > CONFIG.maxTrailPoints) this.points.shift();
  }

  draw(globalFlicker) {
    if (this.points.length < 2) return;
    const pts = this.points;
    const pulse = 1 + Math.sin(time * CONFIG.pulseSpeed * 6 + this.birthTime * 3) * CONFIG.pulseAmount;
    const alpha = this.opacity * pulse * globalFlicker;
    if (alpha < 0.001) return;

    // Pass 1: Outer aura glow
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const gr = CONFIG.glowRadius * CONFIG.glowIntensity;

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      if (i < pts.length - 1) {
        const mx = (pts[i].x + pts[i + 1].x) * 0.5;
        const my = (pts[i].y + pts[i + 1].y) * 0.5;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      } else {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
    }

    // Outer glow (widest, dimmest)
    const c = pts[Math.floor(pts.length / 2)].color;
    ctx.strokeStyle = `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${alpha * 0.06})`;
    ctx.lineWidth = gr;
    ctx.stroke();

    // Mid glow
    ctx.strokeStyle = `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${alpha * 0.15})`;
    ctx.lineWidth = gr * 0.45;
    ctx.stroke();

    // Colored core
    ctx.strokeStyle = `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${alpha * 0.6})`;
    ctx.lineWidth = CONFIG.coreWidth * 2.5;
    ctx.stroke();

    // White-hot center
    ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.7})`;
    ctx.lineWidth = CONFIG.coreWidth;
    ctx.stroke();
  }
}

function startAnimation() {
  const bgRgb = hexToRgb(CONFIG.backgroundColor);
  const fogRgb = hexToRgb(CONFIG.fogColor);

  function render() {
    if (!ctx) return;
    time += 0.016;

    // -- Background fade (creates trail persistence) --
    ctx.fillStyle = `rgba(${bgRgb[0]},${bgRgb[1]},${bgRgb[2]},${CONFIG.trailFadeSpeed * 3})`;
    ctx.fillRect(0, 0, width, height);

    // -- Ambient fog --
    if (CONFIG.ambientFog) {
      ctx.fillStyle = `rgba(${fogRgb[0]},${fogRgb[1]},${fogRgb[2]},${CONFIG.fogOpacity})`;
      ctx.fillRect(0, 0, width, height);

      // Fog glow around active trail tip
      if (activeTrail && activeTrail.points.length > 0) {
        const tip = activeTrail.points[activeTrail.points.length - 1];
        const c = tip.color;
        const fogGlow = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 120);
        fogGlow.addColorStop(0, `rgba(${c[0]|0},${c[1]|0},${c[2]|0},0.03)`);
        fogGlow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = fogGlow;
        ctx.fillRect(tip.x - 120, tip.y - 120, 240, 240);
      }
    }

    // -- Flicker calculation --
    let flicker = 1;
    if (CONFIG.flickerEnabled) {
      if (Math.random() < 0.06) {
        flicker = 1 - CONFIG.flickerIntensity * Math.random();
      }
    }

    // -- Detect drawing --
    const mouseValid = mouse.x >= 0 && mouse.y >= 0 && mouse.x <= width && mouse.y <= height;
    const moved = mouseValid && (Math.abs(mouse.x - prevMouse.x) > 0.5 || Math.abs(mouse.y - prevMouse.y) > 0.5);

    if (moved) {
      const dx = mouse.x - prevMouse.x;
      const dy = mouse.y - prevMouse.y;
      const speed = Math.sqrt(dx * dx + dy * dy);

      // Width inversely proportional to speed
      const maxW = CONFIG.coreWidth * 4;
      const minW = CONFIG.coreWidth * 0.8;
      const speedFactor = Math.min(1, speed / 30) * CONFIG.speedWidthEffect;
      const w = maxW - (maxW - minW) * speedFactor;

      if (!isDrawing) {
        // Start new trail
        activeTrail = new Trail();
        isDrawing = true;
      }

      const color = getCurrentColor();
      activeTrail.addPoint(mouse.x, mouse.y, color, w);
    } else if (isDrawing && !moved) {
      // Mouse stopped — finalize trail
      if (activeTrail && activeTrail.points.length > 1) {
        trails.push(activeTrail);
      }
      activeTrail = null;
      isDrawing = false;
    }

    prevMouse.x = mouse.x;
    prevMouse.y = mouse.y;

    // -- Fade and draw old trails --
    for (let i = trails.length - 1; i >= 0; i--) {
      trails[i].opacity -= CONFIG.trailFadeSpeed * 0.3;
      if (trails[i].opacity <= CONFIG.trailGhostOpacity) {
        trails[i].opacity = CONFIG.trailGhostOpacity;
        // Remove truly dead trails
        if (trails[i].opacity < 0.005) {
          trails.splice(i, 1);
          continue;
        }
      }
      trails[i].draw(flicker);
    }

    // -- Draw active trail --
    if (activeTrail) {
      activeTrail.draw(flicker);
    }

    // -- Trim old trails to prevent memory buildup --
    if (trails.length > 40) {
      trails.splice(0, trails.length - 30);
    }

    requestAnimationFrame(render);
  }

  // Initial background fill
  ctx.fillStyle = CONFIG.backgroundColor;
  ctx.fillRect(0, 0, width, height);

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
      ctx.fillStyle = CONFIG.backgroundColor;
      ctx.fillRect(0, 0, width, height);
      break;
    case 'mousemove':
      mouse.x = e.data.x;
      mouse.y = e.data.y;
      break;
  }
};
