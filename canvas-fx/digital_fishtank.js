/**
 * Title: Digital Fishtank V2
 * Description: A living aquarium with hungry fish that chase and eat food you
 *   drop from the surface. Move your cursor to the top of the tank to sprinkle
 *   food pellets — fish detect them, race to eat, and do a happy wiggle.
 *   Features bezier-curve fish with stripe patterns, leaf-shaped plants,
 *   aerator bubble streams, decorative rocks, caustic lighting, depth
 *   layering, fish shadows, and an animated water surface.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Fish --
  fishCount: 14,                          // Number of fish (3-30)
  fishMinSize: 14,                        // Smallest fish body length in px
  fishMaxSize: 34,                        // Largest fish body length in px
  fishSpeed: 0.6,                         // Base swim speed multiplier (0.2-2)
  fishChaseSpeed: 1.8,                    // Speed when chasing food (1-4)
  fishPalette: [                          // [body, fin, stripe] color triplets
    ['#ff6b3d', '#ff9a6c', '#ffffff'],    // Clownfish orange + white stripes
    ['#4fc3f7', '#81d4fa', '#1565c0'],    // Neon blue + dark stripes
    ['#ffd54f', '#ffe082', '#ff8f00'],    // Golden + amber stripes
    ['#e57373', '#ef9a9a', '#b71c1c'],    // Red + crimson stripes
    ['#81c784', '#a5d6a7', '#2e7d32'],    // Green + dark green stripes
    ['#ce93d8', '#e1bee7', '#7b1fa2'],    // Purple + deep purple stripes
    ['#4dd0e1', '#80deea', '#00695c'],    // Cyan + teal stripes
    ['#ffb74d', '#ffcc80', '#e65100'],    // Amber + orange stripes
  ],
  fishStripes: true,                      // Draw stripe pattern on fish bodies
  fishUndulation: 0.3,                    // Body wave amplitude (0.1-0.6)
  fishTailSpeed: 5,                       // Tail beat frequency (2-10)
  fishShadows: true,                      // Draw shadow on sand below each fish
  schooling: false,                       // Fish loosely school together

  // -- Food --
  feedingEnabled: true,                   // Enable food dropping from surface
  feedZoneHeight: 0.15,                   // Top fraction of tank that triggers feeding (0.05-0.3)
  foodDropRate: 18,                       // Frames between food drops when feeding (5-60)
  foodSinkSpeed: 0.4,                     // Food sink speed (0.1-1.5)
  foodSize: 3,                            // Food pellet radius in px (2-6)
  foodColor: '#d4a056',                   // Food pellet color
  foodDetectRadius: 200,                  // How far fish can "see" food in px (50-400)
  maxFood: 30,                            // Max food pellets on screen

  // -- Bubbles --
  bubbleCount: 15,                        // Ambient bubble count (0-60)
  bubbleMinSize: 1.5,                     // Min bubble radius in px
  bubbleMaxSize: 5,                       // Max bubble radius in px
  bubbleSpeed: 0.5,                       // Rise speed multiplier (0.2-2)
  bubbleColor: 'rgba(180, 220, 255, 0.25)', // Bubble color
  bubbleShine: true,                      // Show highlight on bubbles
  aeratorCount: 2,                        // Fixed bubble stream sources on bottom (0-5)
  aeratorRate: 12,                        // Frames between aerator bubbles (4-30)

  // -- Plants --
  plantCount: 10,                         // Number of seaweed plants (0-20)
  plantMinHeight: 50,                     // Shortest plant in px
  plantMaxHeight: 150,                    // Tallest plant in px
  plantSegments: 10,                      // Segments per plant (more=smoother)
  plantSwayAmount: 14,                    // Sway displacement in px (0-30)
  plantSwaySpeed: 0.7,                    // Sway speed (0.2-3)
  plantLeafWidth: 6,                      // Leaf width in px (3-12)
  plantColors: ['#2e7d32', '#388e3c', '#43a047', '#1b5e20', '#66bb6a'],

  // -- Water & Lighting --
  waterTopColor: [8, 35, 70],             // RGB for top of tank
  waterBottomColor: [3, 12, 30],          // RGB for bottom of tank
  causticsEnabled: true,                  // Animated light caustics
  causticsSpeed: 0.5,                     // Caustic animation speed (0.2-2)
  lightRaysEnabled: true,                 // Show god-rays from surface
  lightRayCount: 5,                       // Number of light rays (2-10)
  lightRayOpacity: 0.025,                 // Ray opacity (0.01-0.08)
  surfaceRipple: true,                    // Animated wavy surface line

  // -- Environment --
  sandColor: [55, 45, 28],               // RGB for sandy bottom
  sandHeight: 35,                         // Sand strip height in px
  rockCount: 6,                           // Decorative rocks on sand (0-15)
  particleCount: 35,                      // Floating detritus particles (0-100)

  // -- Mouse --
  mouseScatterRadius: 100,               // Fish flee radius in px (below feed zone)
  mouseScatterForce: 2.5,                // Scatter strength (1-10)
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let time = 0;
let allFish = [], bubbles = [], plants = [], particles = [], foodPellets = [];
let rocks = [], aerators = [];
let feedTimer = 0;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function rand(a, b) { return Math.random() * (b - a) + a; }
function hexRgb(h) { return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; }

// ════════════════════════════════════════════
// ██  FOOD PELLET
// ════════════════════════════════════════════
class Food {
  constructor(x) {
    this.x = x + rand(-8, 8);
    this.y = 5;
    this.vy = CONFIG.foodSinkSpeed * rand(0.7, 1.3);
    this.vx = rand(-0.15, 0.15);
    this.r = CONFIG.foodSize * rand(0.7, 1.2);
    this.eaten = false;
    this.phase = rand(0, Math.PI * 2);
    this.color = hexRgb(CONFIG.foodColor);
  }
  update() {
    if (this.eaten) return false;
    this.phase += 0.04;
    this.x += this.vx + Math.sin(this.phase) * 0.12;
    this.y += this.vy;
    this.vy *= 0.999; // slight deceleration
    const floor = height - CONFIG.sandHeight - this.r;
    if (this.y >= floor) { this.y = floor; this.vy = 0; this.vx = 0; }
    return true;
  }
  draw() {
    if (this.eaten) return;
    const c = this.color;
    // Glow
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r * 2.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.06)`;
    ctx.fill();
    // Pellet
    const g = ctx.createRadialGradient(this.x - this.r * 0.3, this.y - this.r * 0.3, 0, this.x, this.y, this.r);
    g.addColorStop(0, `rgba(${Math.min(255,c[0]+50)},${Math.min(255,c[1]+50)},${Math.min(255,c[2]+30)},0.9)`);
    g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0.8)`);
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }
}

// ════════════════════════════════════════════
// ██  FISH
// ════════════════════════════════════════════
class Fish {
  constructor() {
    this.size = rand(CONFIG.fishMinSize, CONFIG.fishMaxSize);
    const palIdx = Math.floor(Math.random() * CONFIG.fishPalette.length);
    const pal = CONFIG.fishPalette[palIdx];
    this.bodyColor = hexRgb(pal[0]);
    this.finColor = hexRgb(pal[1]);
    this.stripeColor = pal[2] ? hexRgb(pal[2]) : this.bodyColor;
    this.x = rand(this.size * 2, width - this.size * 2);
    this.y = rand(50, height - CONFIG.sandHeight - this.size * 2);
    this.angle = rand(-Math.PI, Math.PI);
    this.targetAngle = this.angle;
    this.baseSpeed = rand(0.3, 0.7) * CONFIG.fishSpeed;
    this.speed = this.baseSpeed;
    this.phase = rand(0, Math.PI * 2);
    this.wanderTimer = rand(60, 200);
    this.wanderTarget = { x: this.x, y: this.y };
    this.turnRate = rand(0.025, 0.06);
    this.depth = rand(0, 1); // 0=far, 1=near
    this.depthScale = 0.7 + this.depth * 0.3;
    this.depthAlpha = 0.5 + this.depth * 0.5;
    this.vx = 0; this.vy = 0;
    this.chasing = null; // food target
    this.nibbleTimer = 0; // happy wiggle after eating
    this.stripeCount = Math.floor(rand(2, 4));
  }

  pickWanderTarget() {
    const m = this.size * 2;
    this.wanderTarget.x = rand(m, width - m);
    this.wanderTarget.y = rand(40, height - CONFIG.sandHeight - m - 20);
    this.wanderTimer = rand(100, 300);
  }

  findFood() {
    if (!CONFIG.feedingEnabled || foodPellets.length === 0) return null;
    let best = null, bestD = CONFIG.foodDetectRadius;
    for (const f of foodPellets) {
      if (f.eaten) continue;
      const d = Math.hypot(f.x - this.x, f.y - this.y);
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  }

  update() {
    this.phase += 0.05;
    if (this.nibbleTimer > 0) this.nibbleTimer--;

    // Look for food
    const food = this.findFood();
    if (food && !food.eaten) {
      this.chasing = food;
      this.targetAngle = Math.atan2(food.y - this.y, food.x - this.x);
      this.speed = CONFIG.fishChaseSpeed * this.baseSpeed;
      this.turnRate = 0.08; // turn faster when chasing

      // Eat if close enough
      const ed = Math.hypot(food.x - this.x, food.y - this.y);
      if (ed < this.size * 0.6) {
        food.eaten = true;
        this.chasing = null;
        this.nibbleTimer = 40;
        this.speed = this.baseSpeed;
        this.turnRate = rand(0.025, 0.06);
      }
    } else {
      this.chasing = null;
      this.speed = this.baseSpeed;
      this.turnRate = rand(0.025, 0.06);

      this.wanderTimer--;
      if (this.wanderTimer <= 0) this.pickWanderTarget();
      this.targetAngle = Math.atan2(this.wanderTarget.y - this.y, this.wanderTarget.x - this.x);

      // Schooling
      if (CONFIG.schooling) {
        let cx = 0, cy = 0, n = 0;
        for (const o of allFish) {
          if (o === this) continue;
          if (Math.hypot(o.x - this.x, o.y - this.y) < 100) { cx += o.x; cy += o.y; n++; }
        }
        if (n > 0) {
          const sa = Math.atan2(cy / n - this.y, cx / n - this.x);
          this.targetAngle = this.targetAngle * 0.7 + sa * 0.3;
        }
      }
    }

    // Smooth turn
    let da = this.targetAngle - this.angle;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    this.angle += da * this.turnRate;

    // Mouse scatter (only below feed zone)
    const inFeedZone = mouse.y >= 0 && mouse.y < height * CONFIG.feedZoneHeight;
    if (!inFeedZone) {
      const mdx = this.x - mouse.x, mdy = this.y - mouse.y;
      const md = Math.sqrt(mdx * mdx + mdy * mdy);
      if (md < CONFIG.mouseScatterRadius && md > 0) {
        const f = (1 - md / CONFIG.mouseScatterRadius) * CONFIG.mouseScatterForce;
        this.vx += (mdx / md) * f;
        this.vy += (mdy / md) * f;
      }
    }

    // Nibble wiggle
    const wiggle = this.nibbleTimer > 0 ? Math.sin(this.nibbleTimer * 0.8) * 0.15 : 0;

    this.vx += Math.cos(this.angle + wiggle) * this.speed * 0.15;
    this.vy += Math.sin(this.angle + wiggle) * this.speed * 0.15;
    this.vx *= 0.93; this.vy *= 0.93;
    this.x += this.vx; this.y += this.vy;

    // Boundary
    const m = this.size * 1.5;
    if (this.x < m) { this.x = m; this.vx = Math.abs(this.vx); this.pickWanderTarget(); }
    if (this.x > width - m) { this.x = width - m; this.vx = -Math.abs(this.vx); this.pickWanderTarget(); }
    if (this.y < 15) { this.y = 15; this.vy = Math.abs(this.vy); }
    if (this.y > height - CONFIG.sandHeight - m) { this.y = height - CONFIG.sandHeight - m; this.vy = -Math.abs(this.vy); }
  }

  drawShadow() {
    if (!CONFIG.fishShadows) return;
    const sandY = height - CONFIG.sandHeight + 3;
    const shadowAlpha = Math.max(0.02, 0.06 * (1 - (sandY - this.y) / height));
    const shadowScale = 0.6 + (sandY - this.y) / height * 0.4;
    ctx.beginPath();
    ctx.ellipse(this.x, sandY, this.size * shadowScale, this.size * 0.15, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
    ctx.fill();
  }

  draw() {
    const s = this.size * this.depthScale;
    const swimPhase = Math.sin(this.phase * CONFIG.fishTailSpeed);
    const und = CONFIG.fishUndulation;
    const tailWag = swimPhase * s * und * 0.7;
    const bw1 = Math.sin(this.phase * CONFIG.fishTailSpeed + 1) * s * und * 0.15;
    const bw2 = Math.sin(this.phase * CONFIG.fishTailSpeed + 2) * s * und * 0.08;

    ctx.save();
    ctx.globalAlpha = this.depthAlpha;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // ── Tail ──
    ctx.beginPath();
    ctx.moveTo(-s * 0.4, 0);
    ctx.quadraticCurveTo(-s * 0.7, -s * 0.35 + tailWag * 0.3, -s * 0.95 + tailWag * 0.5, -s * 0.42 + tailWag);
    ctx.lineTo(-s * 0.5, tailWag * 0.15);
    ctx.lineTo(-s * 0.95 + tailWag * 0.5, s * 0.42 + tailWag);
    ctx.quadraticCurveTo(-s * 0.7, s * 0.35 + tailWag * 0.3, -s * 0.4, 0);
    ctx.fillStyle = `rgba(${this.finColor[0]},${this.finColor[1]},${this.finColor[2]},0.65)`;
    ctx.fill();

    // ── Body ──
    ctx.beginPath();
    ctx.moveTo(s * 0.52, 0);
    ctx.bezierCurveTo(s * 0.38, -s * 0.3 + bw2, 0, -s * 0.34 + bw1, -s * 0.35, -s * 0.13 + bw1);
    ctx.lineTo(-s * 0.42, 0);
    ctx.bezierCurveTo(-s * 0.35, s * 0.13 + bw1, 0, s * 0.34 + bw1, s * 0.38, s * 0.3 + bw2);
    ctx.closePath();
    const bc = this.bodyColor;
    const bg = ctx.createLinearGradient(0, -s * 0.3, 0, s * 0.3);
    bg.addColorStop(0, `rgba(${Math.min(255,bc[0]+50)},${Math.min(255,bc[1]+50)},${Math.min(255,bc[2]+50)},0.88)`);
    bg.addColorStop(0.45, `rgba(${bc[0]},${bc[1]},${bc[2]},0.92)`);
    bg.addColorStop(1, `rgba(${Math.max(0,bc[0]-35)},${Math.max(0,bc[1]-35)},${Math.max(0,bc[2]-35)},0.88)`);
    ctx.fillStyle = bg;
    ctx.fill();

    // ── Stripes ──
    if (CONFIG.fishStripes) {
      ctx.save();
      // Clip to body shape (re-draw path)
      ctx.beginPath();
      ctx.moveTo(s * 0.52, 0);
      ctx.bezierCurveTo(s * 0.38, -s * 0.3 + bw2, 0, -s * 0.34 + bw1, -s * 0.35, -s * 0.13 + bw1);
      ctx.lineTo(-s * 0.42, 0);
      ctx.bezierCurveTo(-s * 0.35, s * 0.13 + bw1, 0, s * 0.34 + bw1, s * 0.38, s * 0.3 + bw2);
      ctx.closePath();
      ctx.clip();
      const sc = this.stripeColor;
      ctx.fillStyle = `rgba(${sc[0]},${sc[1]},${sc[2]},0.25)`;
      const stripeW = s * 0.1;
      for (let i = 0; i < this.stripeCount; i++) {
        const sx = s * 0.2 - i * s * 0.25;
        ctx.fillRect(sx - stripeW / 2, -s * 0.5, stripeW, s);
      }
      ctx.restore();
    }

    // ── Dorsal fin ──
    const dw = Math.sin(this.phase * CONFIG.fishTailSpeed + 0.5) * s * und * 0.1;
    ctx.beginPath();
    ctx.moveTo(s * 0.18, -s * 0.28 + bw2);
    ctx.quadraticCurveTo(0, -s * 0.52 + dw, -s * 0.22, -s * 0.26 + bw1);
    ctx.fillStyle = `rgba(${this.finColor[0]},${this.finColor[1]},${this.finColor[2]},0.45)`;
    ctx.fill();

    // ── Pectoral fin ──
    const pp = Math.sin(this.phase * CONFIG.fishTailSpeed * 0.7 + 1);
    ctx.beginPath();
    ctx.moveTo(s * 0.1, s * 0.22);
    ctx.quadraticCurveTo(0, s * 0.44 + pp * s * 0.07, -s * 0.15, s * 0.3);
    ctx.fillStyle = `rgba(${this.finColor[0]},${this.finColor[1]},${this.finColor[2]},0.35)`;
    ctx.fill();

    // ── Eye ──
    const eyeX = s * 0.32, eyeY = -s * 0.05;
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, s * 0.065, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(eyeX + s * 0.02, eyeY, s * 0.035, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(5,5,5,0.95)';
    ctx.fill();
    // Eye glint
    ctx.beginPath();
    ctx.arc(eyeX + s * 0.04, eyeY - s * 0.02, s * 0.015, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fill();

    // ── Mouth (opens when near food) ──
    if (this.chasing) {
      const md = Math.hypot(this.chasing.x - this.x, this.chasing.y - this.y);
      if (md < this.size * 2) {
        const open = Math.sin(this.phase * 12) * 0.5 + 0.5;
        ctx.beginPath();
        ctx.arc(s * 0.5, 0, s * 0.06 * (0.5 + open), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${Math.max(0,bc[0]-60)},${Math.max(0,bc[1]-60)},${Math.max(0,bc[2]-60)},0.6)`;
        ctx.fill();
      }
    }

    // ── Happy flash after eating ──
    if (this.nibbleTimer > 20) {
      const flash = (this.nibbleTimer - 20) / 20;
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.6, s * 0.35, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,200,${flash * 0.12})`;
      ctx.fill();
    }

    ctx.restore();
  }
}

// ════════════════════════════════════════════
// ██  BUBBLE
// ════════════════════════════════════════════
class Bubble {
  constructor(x, y, sizeScale) {
    this.r = rand(CONFIG.bubbleMinSize, CONFIG.bubbleMaxSize) * (sizeScale || 1);
    this.x = x !== undefined ? x + rand(-3, 3) : rand(0, width);
    this.y = y !== undefined ? y : height + rand(0, 20);
    this.speed = rand(0.3, 0.7) * CONFIG.bubbleSpeed;
    this.wobblePhase = rand(0, Math.PI * 2);
    this.wobbleAmp = rand(0.2, 0.6);
  }
  update() {
    this.y -= this.speed;
    this.wobblePhase += 0.03;
    this.x += Math.sin(this.wobblePhase) * this.wobbleAmp;
    // Pop at surface with tiny chance
    return this.y + this.r > -5;
  }
  draw() {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.strokeStyle = CONFIG.bubbleColor;
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.fillStyle = CONFIG.bubbleColor.replace(/[\d.]+\)$/, '0.06)');
    ctx.fill();
    if (CONFIG.bubbleShine && this.r > 2) {
      ctx.beginPath();
      ctx.arc(this.x - this.r * 0.25, this.y - this.r * 0.3, this.r * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fill();
    }
  }
}

// ════════════════════════════════════════════
// ██  PLANT
// ════════════════════════════════════════════
class Plant {
  constructor(x) {
    this.x = x;
    this.baseY = height - CONFIG.sandHeight * 0.5;
    this.h = rand(CONFIG.plantMinHeight, CONFIG.plantMaxHeight);
    this.segs = CONFIG.plantSegments;
    const c = CONFIG.plantColors[Math.floor(Math.random() * CONFIG.plantColors.length)];
    this.color = hexRgb(c);
    this.phase = rand(0, Math.PI * 2);
    this.leafW = CONFIG.plantLeafWidth * rand(0.7, 1.3);
    this.depth = rand(0.4, 1); // depth dimming
  }
  draw() {
    const sway = CONFIG.plantSwayAmount;
    const sp = CONFIG.plantSwaySpeed;
    const segH = this.h / this.segs;
    const c = this.color;

    // Build spine points
    const pts = [{ x: this.x, y: this.baseY }];
    for (let i = 1; i <= this.segs; i++) {
      const t = i / this.segs;
      const swayX = Math.sin(time * sp + this.phase + i * 0.45) * sway * t * t
                   + Math.sin(time * sp * 0.6 + this.phase + i * 0.8) * sway * 0.3 * t;
      pts.push({ x: this.x + swayX, y: this.baseY - i * segH });
    }

    // Draw as filled leaf shape (tapered)
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const t = i / this.segs;
      const w = this.leafW * (1 - t * 0.7) * 0.5; // taper toward tip
      ctx.lineTo(pts[i].x - w, pts[i].y);
    }
    // Tip
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y - 3);
    // Return down the other side
    for (let i = pts.length - 1; i >= 1; i--) {
      const t = i / this.segs;
      const w = this.leafW * (1 - t * 0.7) * 0.5;
      ctx.lineTo(pts[i].x + w, pts[i].y);
    }
    ctx.closePath();

    const alpha = 0.25 * this.depth;
    ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
    ctx.fill();

    // Midrib line
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.strokeStyle = `rgba(${Math.max(0,c[0]-30)},${Math.max(0,c[1]-30)},${Math.max(0,c[2]-20)},${alpha * 0.8})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// ════════════════════════════════════════════
// ██  PARTICLE / ROCK
// ════════════════════════════════════════════
class Particle {
  constructor() { this.reset(); }
  reset() {
    this.x = rand(0, width); this.y = rand(10, height - CONFIG.sandHeight - 10);
    this.size = rand(0.8, 2.2); this.vx = rand(-0.08, 0.08); this.vy = rand(-0.1, 0.04);
    this.phase = rand(0, Math.PI * 2);
  }
  update() {
    this.phase += 0.008;
    this.x += this.vx + Math.sin(this.phase) * 0.04;
    this.y += this.vy;
    if (this.y < -5 || this.y > height - CONFIG.sandHeight || this.x < -5 || this.x > width + 5) this.reset();
  }
  draw() {
    ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(160,190,150,0.1)'; ctx.fill();
  }
}

function makeRock(x) {
  const w = rand(8, 22), h = rand(5, 14);
  const shade = rand(40, 70);
  return { x, y: height - CONFIG.sandHeight + rand(-3, 3), w, h,
    color: `rgba(${shade},${shade - 5},${shade - 15},0.5)`,
    highlight: `rgba(${shade + 30},${shade + 25},${shade + 15},0.2)` };
}

// ════════════════════════════════════════════
// ██  INIT & RENDER
// ════════════════════════════════════════════
function initScene() {
  allFish = []; for (let i = 0; i < CONFIG.fishCount; i++) allFish.push(new Fish());
  bubbles = []; for (let i = 0; i < CONFIG.bubbleCount; i++) { const b = new Bubble(); b.y = rand(10, height); bubbles.push(b); }
  plants = []; for (let i = 0; i < CONFIG.plantCount; i++) plants.push(new Plant(rand(15, width - 15)));
  particles = []; for (let i = 0; i < CONFIG.particleCount; i++) particles.push(new Particle());
  rocks = []; for (let i = 0; i < CONFIG.rockCount; i++) rocks.push(makeRock(rand(10, width - 10)));
  aerators = []; for (let i = 0; i < CONFIG.aeratorCount; i++) aerators.push({ x: width * (i + 1) / (CONFIG.aeratorCount + 1), timer: 0 });
  foodPellets = [];
  feedTimer = 0;
}

function startAnimation() {
  function render() {
    if (!ctx) return;
    time += 0.016;

    // ── Water background ──
    const tc = CONFIG.waterTopColor, wbc = CONFIG.waterBottomColor;
    const wg = ctx.createLinearGradient(0, 0, 0, height);
    wg.addColorStop(0, `rgb(${tc[0]},${tc[1]},${tc[2]})`);
    wg.addColorStop(1, `rgb(${wbc[0]},${wbc[1]},${wbc[2]})`);
    ctx.fillStyle = wg;
    ctx.fillRect(0, 0, width, height);

    // ── Light rays ──
    if (CONFIG.lightRaysEnabled) {
      for (let i = 0; i < CONFIG.lightRayCount; i++) {
        const bx = width * (i + 0.5) / CONFIG.lightRayCount;
        const sw = Math.sin(time * 0.25 + i * 2.1) * 35;
        const sp = 45 + Math.sin(time * 0.18 + i * 1.3) * 18;
        ctx.beginPath();
        ctx.moveTo(bx + sw - 6, 0); ctx.lineTo(bx + sw + 6, 0);
        ctx.lineTo(bx + sp + sw * 0.4, height); ctx.lineTo(bx - sp + sw * 0.4, height);
        ctx.closePath();
        ctx.fillStyle = `rgba(140,210,255,${CONFIG.lightRayOpacity})`;
        ctx.fill();
      }
    }

    // ── Caustics ──
    if (CONFIG.causticsEnabled) {
      const sandTop = height - CONFIG.sandHeight;
      const cs = CONFIG.causticsSpeed;
      for (let x = 0; x < width; x += 10) {
        for (let y = sandTop - 15; y < height; y += 10) {
          const v = Math.sin(x * 0.028 + time * cs) * Math.cos(y * 0.035 + time * cs * 0.65)
                  + Math.sin(x * 0.018 - time * cs * 0.4 + y * 0.012) * 0.5;
          if (v > 0.35) {
            ctx.fillStyle = `rgba(100,200,255,${(v - 0.35) * 0.06})`;
            ctx.fillRect(x, y, 10, 10);
          }
        }
      }
    }

    // ── Sand ──
    const sc = CONFIG.sandColor;
    const sandBase = height - CONFIG.sandHeight;
    const sg = ctx.createLinearGradient(0, sandBase, 0, height);
    sg.addColorStop(0, `rgba(${sc[0]},${sc[1]},${sc[2]},0.65)`);
    sg.addColorStop(0.35, `rgba(${sc[0]},${sc[1]},${sc[2]},0.85)`);
    sg.addColorStop(1, `rgba(${Math.max(0,sc[0]-20)},${Math.max(0,sc[1]-18)},${Math.max(0,sc[2]-12)},0.92)`);
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.moveTo(0, height); ctx.lineTo(0, sandBase);
    for (let x = 0; x <= width; x += 3) {
      ctx.lineTo(x, sandBase + Math.sin(x * 0.02 + time * 0.25) * 3 + Math.sin(x * 0.055 + 0.8) * 1.5);
    }
    ctx.lineTo(width, height); ctx.closePath(); ctx.fill();

    // Sand speckles
    ctx.fillStyle = `rgba(${Math.min(255,sc[0]+25)},${Math.min(255,sc[1]+20)},${Math.min(255,sc[2]+12)},0.12)`;
    for (let i = 0; i < 50; i++) {
      ctx.fillRect((i * 41 + i * i * 11) % width, sandBase + 6 + ((i * 59 + i * 17) % Math.max(1, CONFIG.sandHeight - 8)), rand(1, 2.5), 1);
    }

    // ── Rocks ──
    for (const r of rocks) {
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.w * 0.5, r.h * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = r.color; ctx.fill();
      ctx.beginPath();
      ctx.ellipse(r.x - r.w * 0.1, r.y - r.h * 0.15, r.w * 0.3, r.h * 0.25, -0.3, 0, Math.PI * 2);
      ctx.fillStyle = r.highlight; ctx.fill();
    }

    // ── Plants ──
    plants.sort((a, b) => a.depth - b.depth);
    for (const p of plants) p.draw();

    // ── Particles ──
    for (const p of particles) { p.update(); p.draw(); }

    // ── Food ──
    // Drop food when mouse is in feed zone
    if (CONFIG.feedingEnabled && mouse.x > 0 && mouse.y >= 0 && mouse.y < height * CONFIG.feedZoneHeight) {
      feedTimer++;
      if (feedTimer % CONFIG.foodDropRate === 0 && foodPellets.length < CONFIG.maxFood) {
        foodPellets.push(new Food(mouse.x));
      }
    }
    // Update and draw food
    for (let i = foodPellets.length - 1; i >= 0; i--) {
      if (!foodPellets[i].update() || foodPellets[i].eaten) { foodPellets.splice(i, 1); }
      else { foodPellets[i].draw(); }
    }

    // ── Fish shadows ──
    for (const f of allFish) f.drawShadow();

    // ── Fish ──
    for (const f of allFish) f.update();
    allFish.sort((a, b) => a.depth - b.depth);
    for (const f of allFish) f.draw();

    // ── Bubbles ──
    // Aerator streams
    for (const a of aerators) {
      a.timer++;
      if (a.timer % CONFIG.aeratorRate === 0) {
        bubbles.push(new Bubble(a.x, height - CONFIG.sandHeight - 2, 0.6));
      }
    }
    while (bubbles.length < CONFIG.bubbleCount) bubbles.push(new Bubble());
    for (let i = bubbles.length - 1; i >= 0; i--) {
      if (!bubbles[i].update()) bubbles.splice(i, 1);
      else bubbles[i].draw();
    }
    if (bubbles.length > CONFIG.bubbleCount * 4) bubbles.splice(0, bubbles.length - CONFIG.bubbleCount * 2);

    // ── Surface ripple ──
    if (CONFIG.surfaceRipple) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let x = 0; x <= width; x += 3) {
        const wave = Math.sin(x * 0.015 + time * 1.2) * 2.5
                   + Math.sin(x * 0.04 + time * 0.8) * 1
                   + Math.cos(x * 0.025 - time * 0.6) * 1.5;
        ctx.lineTo(x, 4 + wave);
      }
      ctx.lineTo(width, 0); ctx.closePath();
      ctx.fillStyle = 'rgba(120,200,255,0.07)';
      ctx.fill();
      // Bright line
      ctx.beginPath();
      for (let x = 0; x <= width; x += 2) {
        const wave = Math.sin(x * 0.015 + time * 1.2) * 2.5
                   + Math.sin(x * 0.04 + time * 0.8) * 1
                   + Math.cos(x * 0.025 - time * 0.6) * 1.5;
        if (x === 0) ctx.moveTo(x, 4 + wave); else ctx.lineTo(x, 4 + wave);
      }
      ctx.strokeStyle = 'rgba(180,230,255,0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // ── Feed zone indicator ──
    if (CONFIG.feedingEnabled && mouse.x > 0 && mouse.y >= 0 && mouse.y < height * CONFIG.feedZoneHeight) {
      const zoneH = height * CONFIG.feedZoneHeight;
      const ig = ctx.createLinearGradient(0, 0, 0, zoneH);
      ig.addColorStop(0, 'rgba(255,220,100,0.04)');
      ig.addColorStop(1, 'rgba(255,220,100,0)');
      ctx.fillStyle = ig;
      ctx.fillRect(0, 0, width, zoneH);
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
      initScene(); startAnimation();
      break;
    case 'resize':
      width = e.data.width; height = e.data.height;
      canvas.width = width; canvas.height = height;
      initScene();
      break;
    case 'mousemove':
      mouse.x = e.data.x; mouse.y = e.data.y;
      break;
  }
};
