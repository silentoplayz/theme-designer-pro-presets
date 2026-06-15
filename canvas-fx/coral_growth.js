/**
 * Title: Coral Growth
 * Description: Fractal branching coral structures that slowly grow from seed points.
 *   Features recursive branching with configurable angles, natural sway, line tapering,
 *   and mouse wind effect. Multiple colonies grow simultaneously.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Branch Geometry --
  branchAngle: 25,                        // Branch spread angle in degrees (10-60)
  branchLength: 40,                       // Base branch length in pixels
  reductionRatio: 0.72,                   // Each sub-branch is this fraction of parent (0.5-0.9)
  maxDepth: 7,                            // Maximum recursion depth (4-10)

  // -- Growth --
  growthSpeed: 0.8,                       // Growth animation speed (0.1-3)
  growthPoints: 4,                        // Number of coral colonies

  // -- Appearance --
  colors: [                               // Color palette for branches (cycled by depth)
    'rgba(255, 120, 150, 0.5)',           // Pink
    'rgba(255, 180, 100, 0.4)',           // Coral orange
    'rgba(200, 100, 180, 0.45)',          // Mauve
    'rgba(100, 200, 200, 0.4)',           // Teal
    'rgba(255, 150, 120, 0.45)',          // Salmon
  ],
  lineWidth: 3,                           // Base line width in px (tapers with depth)
  lineTaper: true,                        // Taper line width with depth

  // -- Motion --
  swayAmount: 3,                          // Sway displacement in px (0-15)
  swaySpeed: 0.8,                         // Sway animation speed (0-3)
  fadeOldBranches: true,                  // Older branches fade slightly

  // -- Mouse --
  mouseWindStrength: 6,                   // Wind bending strength from mouse (0-15)
  mouseWindRadius: 250,                   // Mouse influence radius in px
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let colonies = [];
let time = 0;
let growthProgress = 0;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function initColonies() {
  colonies = [];
  for (let i = 0; i < CONFIG.growthPoints; i++) {
    colonies.push({
      x: width * (0.15 + 0.7 * (i / Math.max(1, CONFIG.growthPoints - 1))),
      y: height - 10,
      angle: -Math.PI / 2 + (Math.random() - 0.5) * 0.3,
      seed: Math.random() * 1000,
    });
  }
  growthProgress = 0;
}

function drawBranch(x, y, angle, length, depth, maxVisibleDepth, seed) {
  if (depth > CONFIG.maxDepth || depth > maxVisibleDepth) return;
  if (length < 2) return;

  const angleRad = CONFIG.branchAngle * Math.PI / 180;

  // Sway
  const swayOffset = Math.sin(time * CONFIG.swaySpeed + seed + depth * 0.7) * CONFIG.swayAmount * (depth / CONFIG.maxDepth);

  // Mouse wind
  let windOffset = 0;
  const dx = x - mouse.x;
  const dy = y - mouse.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < CONFIG.mouseWindRadius && dist > 0) {
    const force = (1 - dist / CONFIG.mouseWindRadius) * CONFIG.mouseWindStrength;
    windOffset = (dx / dist) * force * (depth / CONFIG.maxDepth);
  }

  const endX = x + Math.cos(angle) * length + swayOffset + windOffset;
  const endY = y + Math.sin(angle) * length;

  // Line width
  let lw = CONFIG.lineWidth;
  if (CONFIG.lineTaper) {
    lw = CONFIG.lineWidth * (1 - depth / (CONFIG.maxDepth + 1)) * 0.8 + 0.5;
  }

  // Color
  const colorIdx = depth % CONFIG.colors.length;
  let color = CONFIG.colors[colorIdx];

  // Fade old branches
  if (CONFIG.fadeOldBranches && depth < maxVisibleDepth - 2) {
    color = color.replace(/[\d.]+\)$/, (0.2 + depth * 0.03).toFixed(2) + ')');
  }

  // Growth progress within this depth
  const depthProgress = maxVisibleDepth - depth;
  const branchGrowth = Math.min(1, depthProgress);
  const actualEndX = x + (endX - x) * branchGrowth;
  const actualEndY = y + (endY - y) * branchGrowth;

  // Draw
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(actualEndX, actualEndY);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Node glow at tip for growing branches
  if (Math.abs(depthProgress - 1) < 0.5 && branchGrowth > 0.5) {
    ctx.beginPath();
    ctx.arc(actualEndX, actualEndY, lw * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = color.replace(/[\d.]+\)$/, '0.3)');
    ctx.fill();
  }

  if (branchGrowth >= 1) {
    const newLength = length * CONFIG.reductionRatio;
    // Left branch
    drawBranch(actualEndX, actualEndY, angle - angleRad + (Math.random() - 0.5) * 0.15, newLength, depth + 1, maxVisibleDepth, seed + 1);
    // Right branch
    drawBranch(actualEndX, actualEndY, angle + angleRad + (Math.random() - 0.5) * 0.15, newLength, depth + 1, maxVisibleDepth, seed + 2);
    // Occasional center branch
    if (Math.sin(seed * 7 + depth * 3) > 0.5) {
      drawBranch(actualEndX, actualEndY, angle + (Math.random() - 0.5) * 0.2, newLength * 0.8, depth + 1, maxVisibleDepth, seed + 3);
    }
  }
}

function startAnimation() {
  function render() {
    if (!ctx) return;
    time += 0.016;
    growthProgress += CONFIG.growthSpeed * 0.01;

    ctx.clearRect(0, 0, width, height);

    const maxVisible = Math.min(CONFIG.maxDepth, growthProgress * 1.5);

    for (const colony of colonies) {
      drawBranch(
        colony.x,
        colony.y,
        colony.angle,
        CONFIG.branchLength,
        0,
        maxVisible,
        colony.seed,
      );
    }

    // Reset growth cycle when fully grown
    if (growthProgress > CONFIG.maxDepth * 1.5) {
      growthProgress = CONFIG.maxDepth * 1.5;
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
      initColonies();
      startAnimation();
      break;
    case 'resize':
      width = e.data.width;
      height = e.data.height;
      canvas.width = width;
      canvas.height = height;
      initColonies();
      break;
    case 'mousemove':
      mouse.x = e.data.x;
      mouse.y = e.data.y;
      break;
  }
};
