/**
 * Title: Pendulum Waves
 * Description: A row of pendulums with incrementally different lengths
 *   creates mesmerizing wave patterns as they swing in and out of phase.
 *   Optional trailing arcs show the bob paths. Mouse drags the nearest pendulum.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Pendulum Array --
  pendulumCount: 24,                      // Number of pendulums in the row (12-40 look great)
  lengthRatioStart: 0.25,                 // Length of shortest pendulum as fraction of canvas height
  lengthIncrement: 0.015,                 // Length increase per pendulum (fraction of height)

  // -- Bob Appearance --
  bobSize: 8,                             // Bob circle radius in px
  bobColor: 'rgba(0, 230, 180, 1)',       // Bob fill color
  stringColor: 'rgba(180, 180, 200, 0.5)', // Pendulum string/rod color
  stringWidth: 1.5,                       // String stroke width in px

  // -- Motion --
  swingAmplitude: 0.7,                    // Max swing angle in radians (0.5-1.2 recommended)
  speedMultiplier: 1.0,                   // Global speed multiplier (0.5 = half speed)
  phaseOffset: 0,                         // Starting phase offset in radians
  gravity: 9.81,                          // Gravity constant (affects period calculation)

  // -- Trails --
  trailEnabled: true,                     // Whether to draw trailing arcs behind bobs
  trailColor: 'rgba(0, 230, 180, 0.15)', // Trail arc color
  trailOpacity: 0.15,                     // Trail opacity (0-1)
  trailLength: 40,                        // Number of past positions to draw (10-80)

  // -- Mouse Interaction --
  mouseInteractionRadius: 120,            // Radius within which mouse affects pendulums (px)
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000, down: false };
let pendulums = [];
let time = 0;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function parseRGBA(str) {
  const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
  return { r: 0, g: 230, b: 180, a: 1 };
}

class Pendulum {
  constructor(anchorX, anchorY, length, index) {
    this.anchorX = anchorX;
    this.anchorY = anchorY;
    this.length = length;
    this.index = index;
    this.trail = [];
    // Each pendulum has slightly different period via length
    this.period = 2 * Math.PI * Math.sqrt(length / (CONFIG.gravity * 50));
  }

  getAngle(t) {
    const omega = (2 * Math.PI) / this.period;
    return CONFIG.swingAmplitude * Math.sin(omega * t + CONFIG.phaseOffset);
  }

  getBobPos(t) {
    const angle = this.getAngle(t);
    return {
      x: this.anchorX + Math.sin(angle) * this.length,
      y: this.anchorY + Math.cos(angle) * this.length,
    };
  }

  update(t) {
    const pos = this.getBobPos(t);

    // Mouse interaction — push the bob away
    const dx = pos.x - mouse.x;
    const dy = pos.y - mouse.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < CONFIG.mouseInteractionRadius && dist > 1) {
      const pushForce = (1 - dist / CONFIG.mouseInteractionRadius) * 15;
      pos.x += (dx / dist) * pushForce;
      pos.y += (dy / dist) * pushForce;
    }

    this.trail.push({ x: pos.x, y: pos.y });
    if (this.trail.length > CONFIG.trailLength) {
      this.trail.shift();
    }

    this.bobX = pos.x;
    this.bobY = pos.y;
  }

  draw(ctx) {
    const bobCol = parseRGBA(CONFIG.bobColor);
    const strCol = parseRGBA(CONFIG.stringColor);
    const trailCol = parseRGBA(CONFIG.trailColor);

    // Draw trail
    if (CONFIG.trailEnabled && this.trail.length > 1) {
      for (let i = 1; i < this.trail.length; i++) {
        const alpha = (i / this.trail.length) * CONFIG.trailOpacity;
        ctx.beginPath();
        ctx.arc(this.trail[i].x, this.trail[i].y, CONFIG.bobSize * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${trailCol.r}, ${trailCol.g}, ${trailCol.b}, ${alpha})`;
        ctx.fill();
      }
    }

    // Draw string
    ctx.beginPath();
    ctx.moveTo(this.anchorX, this.anchorY);
    ctx.lineTo(this.bobX, this.bobY);
    ctx.strokeStyle = `rgba(${strCol.r}, ${strCol.g}, ${strCol.b}, ${strCol.a})`;
    ctx.lineWidth = CONFIG.stringWidth;
    ctx.stroke();

    // Draw bob with glow
    const grad = ctx.createRadialGradient(this.bobX, this.bobY, 0, this.bobX, this.bobY, CONFIG.bobSize * 2);
    grad.addColorStop(0, `rgba(${bobCol.r}, ${bobCol.g}, ${bobCol.b}, 0.3)`);
    grad.addColorStop(1, `rgba(${bobCol.r}, ${bobCol.g}, ${bobCol.b}, 0)`);
    ctx.beginPath();
    ctx.arc(this.bobX, this.bobY, CONFIG.bobSize * 2, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(this.bobX, this.bobY, CONFIG.bobSize, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${bobCol.r}, ${bobCol.g}, ${bobCol.b}, ${bobCol.a})`;
    ctx.fill();

    // Highlight
    ctx.beginPath();
    ctx.arc(this.bobX - CONFIG.bobSize * 0.25, this.bobY - CONFIG.bobSize * 0.25, CONFIG.bobSize * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, 0.3)`;
    ctx.fill();
  }
}

function initPendulums() {
  pendulums = [];
  const spacing = width / (CONFIG.pendulumCount + 1);
  const anchorY = height * 0.08;

  for (let i = 0; i < CONFIG.pendulumCount; i++) {
    const anchorX = spacing * (i + 1);
    const lengthFrac = CONFIG.lengthRatioStart + CONFIG.lengthIncrement * i;
    const length = lengthFrac * height;
    pendulums.push(new Pendulum(anchorX, anchorY, length, i));
  }
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
      initPendulums();
      startAnimation();
      break;
    case 'resize':
      width = e.data.width;
      height = e.data.height;
      canvas.width = width;
      canvas.height = height;
      initPendulums();
      break;
    case 'mousemove':
      mouse.x = e.data.x;
      mouse.y = e.data.y;
      break;
  }
};

function startAnimation() {
  function render() {
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // Draw anchor bar
    const anchorY = height * 0.08;
    ctx.beginPath();
    ctx.moveTo(0, anchorY);
    ctx.lineTo(width, anchorY);
    ctx.strokeStyle = 'rgba(100, 100, 120, 0.3)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Connecting line between all bobs
    if (pendulums.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pendulums[0].bobX, pendulums[0].bobY);
      for (let i = 1; i < pendulums.length; i++) {
        ctx.lineTo(pendulums[i].bobX, pendulums[i].bobY);
      }
      ctx.strokeStyle = 'rgba(0, 230, 180, 0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    for (const p of pendulums) {
      p.update(time);
      p.draw(ctx);
    }

    time += 0.016 * CONFIG.speedMultiplier;
    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}
