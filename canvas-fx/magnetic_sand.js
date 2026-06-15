/**
 * Title: Magnetic Sand
 * Description: Iron filings simulation — hundreds of elongated particles align along
 *   magnetic field lines from your mouse (north pole) and a configurable second pole.
 *   Filings drift toward poles, rotate smoothly, and shimmer with metallic sheen.
 *   Optional field line overlay shows the computed dipole field paths.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Filings --
  filingCount: 1500,                      // Number of iron filings (300-3000)
  filingLength: 6,                        // Filing length in px (3-12)
  filingWidth: 1.2,                       // Filing thickness in px (0.5-2.5)
  filingColor: '#8a8a8a',                 // Base metallic gray
  filingOpacity: 0.7,                     // Filing opacity (0.3-0.95)
  alignSpeed: 0.1,                        // Rotation alignment speed (0.02-0.3)
  attractionStrength: 2,                  // Drift toward poles (0-8)
  attractionDamping: 0.96,                // Movement damping (0.9-0.99)

  // -- Second Pole --
  secondPoleEnabled: true,                // Show a south pole
  secondPoleX: 0.75,                      // X position (fraction 0-1 of width)
  secondPoleY: 0.75,                      // Y position (fraction 0-1 of height)
  secondPoleStrength: 1.0,                // Relative strength vs mouse pole (0.3-3)

  // -- Field Lines --
  fieldLinesEnabled: true,                // Show magnetic field line overlay
  fieldLineCount: 14,                     // Number of field lines (4-24)
  fieldLineColor: '#4488aa',              // Field line color
  fieldLineOpacity: 0.15,                 // Field line opacity (0.05-0.5)

  // -- Visual --
  sheenEnabled: true,                     // Metallic sheen on filings
  surfaceColor: '#f0ebe0',               // Background surface color
  surfaceTexture: true,                   // Subtle noise texture on background
  clusterDensity: 1.5,                    // Clustering near poles (0-4)
  mouseRadius: 300,                       // Mouse influence radius (100-500)
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -1, y: -1 };
let filings = [];
let textureData = null;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function rand(a, b) { return Math.random() * (b - a) + a; }
function hexRgb(h) { return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; }

// Compute magnetic field direction at point (px,py) from two poles
function fieldAngle(px, py, p1x, p1y, p2x, p2y, p2str) {
  let bx = 0, by = 0;

  // North pole (mouse) - field points away
  let dx = px - p1x, dy = py - p1y;
  let d2 = dx * dx + dy * dy + 100; // +100 to avoid singularity
  let d3 = Math.pow(d2, 1.5);
  bx += dx / d3 * 10000;
  by += dy / d3 * 10000;

  // South pole - field points toward
  if (CONFIG.secondPoleEnabled) {
    dx = px - p2x; dy = py - p2y;
    d2 = dx * dx + dy * dy + 100;
    d3 = Math.pow(d2, 1.5);
    bx -= dx / d3 * 10000 * p2str;
    by -= dy / d3 * 10000 * p2str;
  }

  return Math.atan2(by, bx);
}

function fieldStrength(px, py, p1x, p1y, p2x, p2y, p2str) {
  const d1 = Math.hypot(px - p1x, py - p1y) + 10;
  let s = 1000 / (d1 * d1);
  if (CONFIG.secondPoleEnabled) {
    const d2 = Math.hypot(px - p2x, py - p2y) + 10;
    s += (1000 / (d2 * d2)) * p2str;
  }
  return s;
}

class Filing {
  constructor() {
    this.x = rand(10, width - 10);
    this.y = rand(10, height - 10);
    this.angle = rand(0, Math.PI);
    this.vx = 0;
    this.vy = 0;
    this.len = CONFIG.filingLength * rand(0.7, 1.3);
  }

  update(p1x, p1y, p2x, p2y, p2str) {
    if (p1x < 0) return;

    // Target angle from field
    const target = fieldAngle(this.x, this.y, p1x, p1y, p2x, p2y, p2str);

    // Smooth angle alignment (filings align with field, not against)
    let da = target - this.angle;
    // Normalize to [-PI/2, PI/2] since filings are symmetric
    while (da > Math.PI / 2) da -= Math.PI;
    while (da < -Math.PI / 2) da += Math.PI;
    this.angle += da * CONFIG.alignSpeed;

    // Attraction toward poles
    const str = CONFIG.attractionStrength * 0.01;
    let dx = p1x - this.x, dy = p1y - this.y;
    let d = Math.sqrt(dx * dx + dy * dy) + 1;
    if (d < CONFIG.mouseRadius) {
      const f = (1 / (d * d)) * str * 500 * CONFIG.clusterDensity;
      this.vx += (dx / d) * f;
      this.vy += (dy / d) * f;
    }

    if (CONFIG.secondPoleEnabled) {
      dx = p2x - this.x; dy = p2y - this.y;
      d = Math.sqrt(dx * dx + dy * dy) + 1;
      const f = (1 / (d * d)) * str * 500 * p2str * CONFIG.clusterDensity;
      this.vx += (dx / d) * f;
      this.vy += (dy / d) * f;
    }

    this.vx *= CONFIG.attractionDamping;
    this.vy *= CONFIG.attractionDamping;
    this.x += this.vx;
    this.y += this.vy;

    // Boundary
    if (this.x < 5) { this.x = 5; this.vx *= -0.3; }
    if (this.x > width - 5) { this.x = width - 5; this.vx *= -0.3; }
    if (this.y < 5) { this.y = 5; this.vy *= -0.3; }
    if (this.y > height - 5) { this.y = height - 5; this.vy *= -0.3; }
  }

  draw() {
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    const hl = this.len * 0.5;
    const x1 = this.x - cos * hl;
    const y1 = this.y - sin * hl;
    const x2 = this.x + cos * hl;
    const y2 = this.y + sin * hl;

    const c = hexRgb(CONFIG.filingColor);
    if (CONFIG.sheenEnabled) {
      // Metallic sheen: one end brighter based on angle to virtual light
      const lightAngle = Math.atan2(-1, 1); // light from top-right
      const angleDiff = Math.abs(this.angle - lightAngle);
      const sheen = Math.cos(angleDiff) * 0.3;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(this.x, this.y);
      ctx.strokeStyle = `rgba(${Math.min(255, c[0] + sheen * 80)|0},${Math.min(255, c[1] + sheen * 80)|0},${Math.min(255, c[2] + sheen * 80)|0},${CONFIG.filingOpacity})`;
      ctx.lineWidth = CONFIG.filingWidth;
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = `rgba(${Math.max(0, c[0] - sheen * 40)|0},${Math.max(0, c[1] - sheen * 40)|0},${Math.max(0, c[2] - sheen * 40)|0},${CONFIG.filingOpacity})`;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${CONFIG.filingOpacity})`;
      ctx.lineWidth = CONFIG.filingWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }
}

function drawFieldLines(p1x, p1y, p2x, p2y, p2str) {
  if (!CONFIG.fieldLinesEnabled || p1x < 0) return;
  const c = hexRgb(CONFIG.fieldLineColor);
  ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${CONFIG.fieldLineOpacity})`;
  ctx.lineWidth = 0.8;

  const n = CONFIG.fieldLineCount;
  for (let i = 0; i < n; i++) {
    const startAngle = (i / n) * Math.PI * 2;
    let x = p1x + Math.cos(startAngle) * 12;
    let y = p1y + Math.sin(startAngle) * 12;

    ctx.beginPath();
    ctx.moveTo(x, y);

    for (let step = 0; step < 200; step++) {
      const a = fieldAngle(x, y, p1x, p1y, p2x, p2y, p2str);
      x += Math.cos(a) * 4;
      y += Math.sin(a) * 4;

      // Stop if out of bounds or near south pole
      if (x < 0 || x > width || y < 0 || y > height) break;
      if (CONFIG.secondPoleEnabled && Math.hypot(x - p2x, y - p2y) < 15) break;

      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function initFilings() {
  filings = [];
  for (let i = 0; i < CONFIG.filingCount; i++) filings.push(new Filing());
}

function generateTexture() {
  if (!CONFIG.surfaceTexture) return;
  const id = ctx.createImageData(width, height);
  const d = id.data;
  const sc = hexRgb(CONFIG.surfaceColor);
  for (let i = 0; i < d.length; i += 4) {
    const noise = (Math.random() - 0.5) * 12;
    d[i] = Math.max(0, Math.min(255, sc[0] + noise));
    d[i+1] = Math.max(0, Math.min(255, sc[1] + noise));
    d[i+2] = Math.max(0, Math.min(255, sc[2] + noise));
    d[i+3] = 255;
  }
  textureData = id;
}

function startAnimation() {
  const sc = hexRgb(CONFIG.surfaceColor);

  function render() {
    if (!ctx) return;

    // Background
    if (textureData) {
      ctx.putImageData(textureData, 0, 0);
    } else {
      ctx.fillStyle = CONFIG.surfaceColor;
      ctx.fillRect(0, 0, width, height);
    }

    const p1x = mouse.x, p1y = mouse.y;
    const p2x = width * CONFIG.secondPoleX;
    const p2y = height * CONFIG.secondPoleY;
    const p2str = CONFIG.secondPoleStrength;

    // Field lines (behind filings)
    drawFieldLines(p1x, p1y, p2x, p2y, p2str);

    // Pole indicators
    if (CONFIG.secondPoleEnabled) {
      ctx.beginPath();
      ctx.arc(p2x, p2y, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(200,60,60,0.3)';
      ctx.fill();
      ctx.fillStyle = 'rgba(200,60,60,0.6)';
      ctx.font = '10px monospace';
      ctx.fillText('S', p2x - 3, p2y + 4);
    }
    if (p1x >= 0) {
      ctx.beginPath();
      ctx.arc(p1x, p1y, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(60,60,200,0.3)';
      ctx.fill();
      ctx.fillStyle = 'rgba(60,60,200,0.6)';
      ctx.font = '10px monospace';
      ctx.fillText('N', p1x - 3, p1y + 4);
    }

    // Update and draw filings
    for (const f of filings) {
      f.update(p1x, p1y, p2x, p2y, p2str);
      f.draw();
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
      width = e.data.width; height = e.data.height;
      canvas.width = width; canvas.height = height;
      initFilings();
      generateTexture();
      startAnimation();
      break;
    case 'resize':
      width = e.data.width; height = e.data.height;
      canvas.width = width; canvas.height = height;
      initFilings();
      generateTexture();
      break;
    case 'mousemove':
      mouse.x = e.data.x; mouse.y = e.data.y;
      break;
  }
};
