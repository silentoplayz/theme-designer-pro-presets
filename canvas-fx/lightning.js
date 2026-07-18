/**
 * Title: Lightning
 * Description: Dramatic lightning bolts that fork and flash against a dark sky.
 *   Mouse click area triggers a targeted bolt. Background flashes and rumble glow
 *   create an immersive storm atmosphere.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Bolt Appearance --
  boltColor: 'rgba(180, 200, 255, 0.95)',   // Main bolt stroke color
  boltWidth: 2.5,                            // Base stroke width of the main bolt in px
  boltSegments: 12,                          // Number of jagged segments per bolt
  boltJagOffset: 35,                         // Max horizontal offset per segment in px
  boltGlowColor: 'rgba(140, 170, 255, 0.5)',// Glow halo around bolts
  boltGlowWidth: 10,                         // Glow blur radius in px

  // -- Forking --
  forkProbability: 0.35,                     // Chance each segment spawns a fork (0-1)
  maxForkDepth: 3,                           // Maximum recursive fork depth
  forkLengthFactor: 0.55,                    // Fork length relative to remaining bolt (0-1)
  forkWidthDecay: 0.6,                       // Stroke width multiplier per fork depth

  // -- Flash --
  flashBrightness: 0.35,                     // Peak screen-flash opacity (0-1)
  flashDuration: 350,                        // Flash fade-out duration in ms
  backgroundFlashColor: 'rgba(200, 215, 255, 1)', // Color of the full-screen flash

  // -- Timing --
  boltFrequency: 2200,                       // Average ms between auto bolts
  boltFrequencyVariance: 1500,               // ± random ms added to frequency
  boltLifetime: 180,                         // How long a bolt stays visible in ms

  // -- Rumble --
  rumbleGlowColor: 'rgba(100, 120, 180, 0.08)', // Subtle ambient storm glow at horizon
  rumbleGlowHeight: 0.25,                       // Fraction of canvas height for rumble glow

  // -- Mouse Interaction --
  mouseClickBolt: true,                      // Whether mouse area triggers targeted bolts
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let bolts = [];
let flashAlpha = 0;
let flashStart = 0;
let lastBoltTime = 0;
let nextBoltDelay = 0;

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
      nextBoltDelay = CONFIG.boltFrequency;
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
    case 'mousedown':
    case 'click':
      if (CONFIG.mouseClickBolt) {
        spawnBolt(e.data.x || mouse.x, 0, e.data.x || mouse.x, e.data.y || mouse.y);
      }
      break;
  }
};

function generateBoltPath(x1, y1, x2, y2, segments, depth) {
  const points = [{ x: x1, y: y1 }];
  const dx = x2 - x1;
  const dy = y2 - y1;

  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const px = x1 + dx * t + (Math.random() - 0.5) * CONFIG.boltJagOffset * 2;
    const py = y1 + dy * t + (Math.random() - 0.5) * CONFIG.boltJagOffset * 0.5;
    points.push({ x: px, y: py });
  }
  points.push({ x: x2, y: y2 });

  // Generate forks
  const forks = [];
  if (depth < CONFIG.maxForkDepth) {
    for (let i = 2; i < points.length - 1; i++) {
      if (Math.random() < CONFIG.forkProbability) {
        const p = points[i];
        const remainLen = Math.sqrt(
          (x2 - p.x) ** 2 + (y2 - p.y) ** 2
        ) * CONFIG.forkLengthFactor;
        const angle = Math.atan2(y2 - y1, x2 - x1) + (Math.random() - 0.5) * 1.2;
        const fx = p.x + Math.cos(angle) * remainLen;
        const fy = p.y + Math.sin(angle) * remainLen;
        const forkSegs = Math.max(3, Math.floor(segments * 0.5));
        forks.push(generateBoltPath(p.x, p.y, fx, fy, forkSegs, depth + 1));
      }
    }
  }

  return { points, forks, depth };
}

function spawnBolt(x1, y1, x2, y2) {
  const path = generateBoltPath(
    x1 || Math.random() * width, y1 || 0,
    x2 || (x1 + (Math.random() - 0.5) * width * 0.4),
    y2 || height * (0.5 + Math.random() * 0.5),
    CONFIG.boltSegments, 0
  );
  bolts.push({ path, born: performance.now() });

  // Trigger flash
  flashAlpha = CONFIG.flashBrightness;
  flashStart = performance.now();
}

function drawBoltPath(boltPath, alpha) {
  const w = CONFIG.boltWidth * Math.pow(CONFIG.forkWidthDecay, boltPath.depth);

  // Glow
  ctx.save();
  ctx.strokeStyle = CONFIG.boltGlowColor;
  ctx.lineWidth = w + CONFIG.boltGlowWidth;
  ctx.globalAlpha = alpha * 0.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(boltPath.points[0].x, boltPath.points[0].y);
  for (let i = 1; i < boltPath.points.length; i++) {
    ctx.lineTo(boltPath.points[i].x, boltPath.points[i].y);
  }
  ctx.stroke();
  ctx.restore();

  // Core
  ctx.save();
  ctx.strokeStyle = CONFIG.boltColor;
  ctx.lineWidth = w;
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(boltPath.points[0].x, boltPath.points[0].y);
  for (let i = 1; i < boltPath.points.length; i++) {
    ctx.lineTo(boltPath.points[i].x, boltPath.points[i].y);
  }
  ctx.stroke();
  ctx.restore();

  // Inner bright core
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = Math.max(1, w * 0.35);
  ctx.globalAlpha = alpha * 0.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(boltPath.points[0].x, boltPath.points[0].y);
  for (let i = 1; i < boltPath.points.length; i++) {
    ctx.lineTo(boltPath.points[i].x, boltPath.points[i].y);
  }
  ctx.stroke();
  ctx.restore();

  // Draw forks recursively
  for (const fork of boltPath.forks) {
    drawBoltPath(fork, alpha * 0.75);
  }
}

function startAnimation() {
  function render() {
    if (!ctx) return;
    const now = performance.now();

    ctx.clearRect(0, 0, width, height);

    // Rumble glow at bottom
    const rumbleGrad = ctx.createLinearGradient(0, height * (1 - CONFIG.rumbleGlowHeight), 0, height);
    rumbleGrad.addColorStop(0, 'transparent');
    rumbleGrad.addColorStop(1, CONFIG.rumbleGlowColor);
    ctx.fillStyle = rumbleGrad;
    ctx.fillRect(0, height * (1 - CONFIG.rumbleGlowHeight), width, height * CONFIG.rumbleGlowHeight);

    // Auto-spawn bolts
    if (now - lastBoltTime > nextBoltDelay) {
      const startX = Math.random() * width;
      spawnBolt(startX, 0, startX + (Math.random() - 0.5) * width * 0.3, height * (0.4 + Math.random() * 0.6));
      lastBoltTime = now;
      nextBoltDelay = CONFIG.boltFrequency + (Math.random() - 0.5) * 2 * CONFIG.boltFrequencyVariance;
    }

    // Draw active bolts
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      const age = now - b.born;
      if (age > CONFIG.boltLifetime) {
        bolts.splice(i, 1);
        continue;
      }
      const alpha = 1 - age / CONFIG.boltLifetime;
      drawBoltPath(b.path, alpha);
    }

    // Screen flash overlay
    if (flashAlpha > 0.001) {
      const elapsed = now - flashStart;
      const currentFlash = flashAlpha * Math.max(0, 1 - elapsed / CONFIG.flashDuration);
      if (currentFlash > 0.001) {
        ctx.save();
        ctx.globalAlpha = currentFlash;
        ctx.fillStyle = CONFIG.backgroundFlashColor;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      } else {
        flashAlpha = 0;
      }
    }

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}
