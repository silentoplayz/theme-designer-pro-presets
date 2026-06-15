/**
 * Title: Electric Tendrils
 * Description: Branching electric arcs reach from screen edge anchors toward your
 *   mouse cursor. Bolts fork recursively with configurable depth, render in 3
 *   glow layers, and flash with impact circles. Proximity makes anchors fire
 *   faster. Ambient mini-arcs crackle between anchors.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Anchors --
  anchorCount: 8,                         // Edge anchor points (3-12)
  proximityBoost: true,                   // Fire faster when mouse is close

  // -- Bolt Appearance --
  boltColor: '#00ccff',                   // Primary bolt color
  boltCoreColor: '#ffffff',               // White-hot center color
  boltSegments: 16,                       // Segments per bolt (8-30)
  boltJitter: 22,                         // Random displacement per segment px (5-40)
  boltWidth: 4,                           // Outer glow width (2-8)
  boltCoreWidth: 1.5,                     // Center line width (0.5-3)

  // -- Bolt Behavior --
  boltDuration: 8,                        // Frames a bolt stays visible (3-15)
  boltFrequency: 28,                      // Base frames between bolts per anchor (10-60)

  // -- Forking --
  forkProbability: 0.25,                  // Branch chance at each segment (0-0.5)
  forkMaxDepth: 3,                        // Max branch recursion depth (1-4)
  forkLengthRatio: 0.45,                  // Branch length relative to remaining (0.2-0.7)

  // -- Flash --
  flashRadius: 40,                        // Impact flash circle radius (15-80)
  flashOpacity: 0.3,                      // Impact flash brightness (0.1-0.6)

  // -- Ambient --
  ambientArcs: true,                      // Random mini-arcs between anchors
  ambientArcFrequency: 35,               // Frames between ambient arcs (15-120)
  fieldGlow: true,                        // Background electric field gradient
  fieldGlowColor: '#001a33',             // Field gradient color
  fieldGlowIntensity: 0.04,              // Field gradient opacity (0.01-0.1)
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -1, y: -1 };
let time = 0;
let anchors = [];
let activeBolts = [];
let ambientTimer = 0;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function hexRgb(h) { return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; }
function rand(a, b) { return Math.random() * (b - a) + a; }

function initAnchors() {
  anchors = [];
  const n = CONFIG.anchorCount;
  const perimeter = (width + height) * 2;
  for (let i = 0; i < n; i++) {
    const p = (i / n) * perimeter;
    let x, y;
    if (p < width) { x = p; y = 0; }
    else if (p < width + height) { x = width; y = p - width; }
    else if (p < width * 2 + height) { x = width - (p - width - height); y = height; }
    else { x = 0; y = height - (p - width * 2 - height); }
    anchors.push({ x, y, timer: Math.floor(rand(0, CONFIG.boltFrequency)) });
  }
}

function generateBolt(x0, y0, x1, y1, segments, jitter, depth) {
  const points = [{ x: x0, y: y0 }];
  const forks = [];

  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const bx = x0 + (x1 - x0) * t + (Math.random() - 0.5) * jitter * 2;
    const by = y0 + (y1 - y0) * t + (Math.random() - 0.5) * jitter * 2;
    points.push({ x: bx, y: by });

    // Fork chance
    if (depth < CONFIG.forkMaxDepth && Math.random() < CONFIG.forkProbability && i > 2 && i < segments - 2) {
      const remaining = segments - i;
      const forkSegs = Math.max(3, Math.floor(remaining * CONFIG.forkLengthRatio));
      const angle = Math.atan2(y1 - y0, x1 - x0) + (Math.random() - 0.5) * 1.2;
      const forkLen = Math.hypot(x1 - bx, y1 - by) * CONFIG.forkLengthRatio;
      const fx = bx + Math.cos(angle) * forkLen;
      const fy = by + Math.sin(angle) * forkLen;
      forks.push(generateBolt(bx, by, fx, fy, forkSegs, jitter * 0.7, depth + 1));
    }
  }
  points.push({ x: x1, y: y1 });

  return { points, forks, depth };
}

function drawBoltPath(bolt, alpha) {
  const pts = bolt.points;
  if (pts.length < 2) return;
  const c = hexRgb(CONFIG.boltColor);
  const depthFade = Math.pow(0.6, bolt.depth);

  // Build path once
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);

  // Layer 1: outer glow
  ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha * 0.12 * depthFade})`;
  ctx.lineWidth = CONFIG.boltWidth * 3 * depthFade;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Layer 2: colored core
  ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha * 0.5 * depthFade})`;
  ctx.lineWidth = CONFIG.boltWidth * depthFade;
  ctx.stroke();

  // Layer 3: white-hot center
  const cc = hexRgb(CONFIG.boltCoreColor);
  ctx.strokeStyle = `rgba(${cc[0]},${cc[1]},${cc[2]},${alpha * 0.8 * depthFade})`;
  ctx.lineWidth = CONFIG.boltCoreWidth * depthFade;
  ctx.stroke();

  // Draw forks recursively
  for (const fork of bolt.forks) {
    drawBoltPath(fork, alpha * 0.7);
  }
}

function startAnimation() {
  function render() {
    if (!ctx) return;
    time += 1;

    // -- Clear with slight fade for afterimage --
    ctx.fillStyle = 'rgba(2,2,8,0.25)';
    ctx.fillRect(0, 0, width, height);

    // -- Background field glow toward mouse --
    if (CONFIG.fieldGlow && mouse.x >= 0) {
      const fc = hexRgb(CONFIG.fieldGlowColor);
      const g = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, Math.max(width, height) * 0.6);
      g.addColorStop(0, `rgba(${fc[0]},${fc[1]},${fc[2]},${CONFIG.fieldGlowIntensity})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
    }

    // -- Fire bolts from anchors --
    if (mouse.x >= 0 && mouse.y >= 0) {
      for (const a of anchors) {
        a.timer--;
        let freq = CONFIG.boltFrequency;
        if (CONFIG.proximityBoost) {
          const d = Math.hypot(a.x - mouse.x, a.y - mouse.y);
          const boost = Math.max(0.3, d / Math.max(width, height));
          freq = Math.floor(freq * boost);
        }
        if (a.timer <= 0) {
          a.timer = Math.max(5, freq + Math.floor(rand(-5, 5)));
          const bolt = generateBolt(a.x, a.y, mouse.x + rand(-10, 10), mouse.y + rand(-10, 10),
            CONFIG.boltSegments, CONFIG.boltJitter, 0);
          activeBolts.push({ bolt, life: CONFIG.boltDuration, maxLife: CONFIG.boltDuration,
            anchorX: a.x, anchorY: a.y, targetX: mouse.x, targetY: mouse.y });
        }
      }
    }

    // -- Ambient arcs --
    if (CONFIG.ambientArcs && anchors.length > 1) {
      ambientTimer--;
      if (ambientTimer <= 0) {
        ambientTimer = CONFIG.ambientArcFrequency + Math.floor(rand(-8, 8));
        const i = Math.floor(rand(0, anchors.length));
        let j = (i + 1 + Math.floor(rand(0, 2))) % anchors.length;
        const a1 = anchors[i], a2 = anchors[j];
        const bolt = generateBolt(a1.x, a1.y, a2.x, a2.y, 8, CONFIG.boltJitter * 0.5, 1);
        activeBolts.push({ bolt, life: 4, maxLife: 4, anchorX: a1.x, anchorY: a1.y, targetX: a2.x, targetY: a2.y });
      }
    }

    // -- Draw active bolts --
    const bc = hexRgb(CONFIG.boltColor);
    for (let i = activeBolts.length - 1; i >= 0; i--) {
      const ab = activeBolts[i];
      ab.life--;
      if (ab.life <= 0) { activeBolts.splice(i, 1); continue; }

      const alpha = ab.life / ab.maxLife;

      // Flash at initial frame
      if (ab.life === ab.maxLife - 1) {
        // Anchor flash
        ctx.beginPath();
        ctx.arc(ab.anchorX, ab.anchorY, CONFIG.flashRadius * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${bc[0]},${bc[1]},${bc[2]},${CONFIG.flashOpacity * 0.5})`;
        ctx.fill();
        // Target flash
        ctx.beginPath();
        ctx.arc(ab.targetX, ab.targetY, CONFIG.flashRadius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${bc[0]},${bc[1]},${bc[2]},${CONFIG.flashOpacity})`;
        ctx.fill();
      }

      drawBoltPath(ab.bolt, alpha);
    }

    // -- Anchor point indicators --
    for (const a of anchors) {
      ctx.beginPath();
      ctx.arc(a.x, a.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${bc[0]},${bc[1]},${bc[2]},0.15)`;
      ctx.fill();
    }

    // Cap bolts
    if (activeBolts.length > 50) activeBolts.splice(0, activeBolts.length - 40);

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
      ctx.fillStyle = '#020208'; ctx.fillRect(0, 0, width, height);
      initAnchors();
      startAnimation();
      break;
    case 'resize':
      width = e.data.width; height = e.data.height;
      canvas.width = width; canvas.height = height;
      ctx.fillStyle = '#020208'; ctx.fillRect(0, 0, width, height);
      initAnchors();
      break;
    case 'mousemove':
      mouse.x = e.data.x; mouse.y = e.data.y;
      break;
  }
};
