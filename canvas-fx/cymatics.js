/**
 * Title: Cymatics
 * Description: Chladni plate vibration pattern simulator. Mouse position controls
 *   the vibration frequency modes — X controls horizontal, Y controls vertical.
 *   Sand particles are pushed from vibrating antinodes toward still nodal lines,
 *   forming beautiful geometric patterns: crosses, stars, diamonds, and complex
 *   symmetries. Move the mouse to morph between patterns in real-time.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Particles --
  particleCount: 2500,                    // Number of sand grains (500-5000)
  particleSize: 1.5,                      // Grain size in px (0.8-3)
  particleColor: '#c4a46c',               // Sand grain color
  particleOpacity: 0.7,                   // Grain opacity (0.3-0.95)

  // -- Physics --
  pushForce: 2.0,                         // Antinode push strength (0.5-8)
  pushDamping: 0.94,                      // Particle damping (0.88-0.98)
  transitionSpeed: 0.06,                  // Pattern morph speed (0.01-0.2)

  // -- Frequency Modes --
  modeRangeX: 6,                          // Max horizontal mode number (2-12)
  modeRangeY: 6,                          // Max vertical mode number (2-12)

  // -- Plate Appearance --
  plateColor: [35, 30, 25],               // Surface plate color [r,g,b]
  plateTexture: true,                     // Subtle wood/metal texture
  borderEnabled: true,                    // Show plate border
  borderColor: '#554433',                 // Border color
  borderWidth: 3,                         // Border width (1-6)

  // -- Visual Effects --
  glowEnabled: true,                      // Glow along particle concentrations
  glowColor: '#ffdd88',                   // Glow color
  glowIntensity: 0.15,                    // Glow strength (0.05-0.5)
  vibrationVisible: true,                 // Show jitter at antinodes
  vibrationAmount: 1.5,                   // Jitter displacement (0.3-4)

  // -- Overlay --
  nodalLineHint: true,                    // Faintly show mathematical nodal lines
  nodalLineOpacity: 0.06,                 // Nodal line hint opacity (0.02-0.15)
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -1, y: -1 };
let particles = [];
let currentN = 2, currentM = 3; // active modes (smooth interpolated)
let textureData = null;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function rand(a, b) { return Math.random() * (b - a) + a; }
function hexRgb(h) { return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; }

// Chladni equation: value at (x,y) for modes (n,m)
// Nodes where cos(n*pi*x)*cos(m*pi*y) - cos(m*pi*x)*cos(n*pi*y) = 0
function chladniValue(x, y, n, m) {
  const nx = x * Math.PI;
  const ny = y * Math.PI;
  return Math.cos(n * nx) * Math.cos(m * ny) - Math.cos(m * nx) * Math.cos(n * ny);
}

// Gradient of Chladni function (direction particles are pushed)
function chladniGradient(x, y, n, m) {
  const h = 0.005;
  const dx = chladniValue(x + h, y, n, m) - chladniValue(x - h, y, n, m);
  const dy = chladniValue(x, y + h, n, m) - chladniValue(x, y - h, n, m);
  return { dx: dx / (2 * h), dy: dy / (2 * h) };
}

class SandGrain {
  constructor() {
    this.x = rand(0.02, 0.98);
    this.y = rand(0.02, 0.98);
    this.vx = 0;
    this.vy = 0;
    this.size = CONFIG.particleSize * rand(0.7, 1.3);
  }

  update(n, m) {
    const val = chladniValue(this.x, this.y, n, m);
    const absVal = Math.abs(val);

    // Push from antinodes toward nodes
    // Antinodes have high |val|, nodes have val≈0
    if (absVal > 0.01) {
      const grad = chladniGradient(this.x, this.y, n, m);
      const mag = Math.sqrt(grad.dx * grad.dx + grad.dy * grad.dy) + 0.001;
      // Push along gradient toward zero crossings
      const force = CONFIG.pushForce * 0.0003 * absVal;
      // Push toward nearest node = against gradient of |val|
      const sign = val > 0 ? 1 : -1;
      this.vx -= sign * (grad.dx / mag) * force;
      this.vy -= sign * (grad.dy / mag) * force;
    }

    // Vibration jitter at antinodes
    if (CONFIG.vibrationVisible && absVal > 0.3) {
      const jitter = absVal * CONFIG.vibrationAmount * 0.0005;
      this.vx += (Math.random() - 0.5) * jitter;
      this.vy += (Math.random() - 0.5) * jitter;
    }

    this.vx *= CONFIG.pushDamping;
    this.vy *= CONFIG.pushDamping;
    this.x += this.vx;
    this.y += this.vy;

    // Boundary (stay on plate)
    if (this.x < 0.01) { this.x = 0.01; this.vx *= -0.3; }
    if (this.x > 0.99) { this.x = 0.99; this.vx *= -0.3; }
    if (this.y < 0.01) { this.y = 0.01; this.vy *= -0.3; }
    if (this.y > 0.99) { this.y = 0.99; this.vy *= -0.3; }
  }
}

function generateTexture() {
  if (!CONFIG.plateTexture) return;
  const pc = CONFIG.plateColor;
  const id = ctx.createImageData(width, height);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const noise = (Math.random() - 0.5) * 8;
    d[i] = Math.max(0, Math.min(255, pc[0] + noise));
    d[i+1] = Math.max(0, Math.min(255, pc[1] + noise));
    d[i+2] = Math.max(0, Math.min(255, pc[2] + noise));
    d[i+3] = 255;
  }
  textureData = id;
}

function initParticles() {
  particles = [];
  for (let i = 0; i < CONFIG.particleCount; i++) particles.push(new SandGrain());
}

function startAnimation() {
  const pc = CONFIG.plateColor;
  const sc = hexRgb(CONFIG.particleColor);
  const gc = hexRgb(CONFIG.glowColor);

  function render() {
    if (!ctx) return;

    // -- Smoothly interpolate toward target modes from mouse --
    if (mouse.x >= 0 && mouse.y >= 0) {
      const targetN = 1 + (mouse.x / width) * (CONFIG.modeRangeX - 1);
      const targetM = 1 + (mouse.y / height) * (CONFIG.modeRangeY - 1);
      currentN += (targetN - currentN) * CONFIG.transitionSpeed;
      currentM += (targetM - currentM) * CONFIG.transitionSpeed;
    }

    // -- Background --
    if (textureData) {
      ctx.putImageData(textureData, 0, 0);
    } else {
      ctx.fillStyle = `rgb(${pc[0]},${pc[1]},${pc[2]})`;
      ctx.fillRect(0, 0, width, height);
    }

    // -- Nodal line hints --
    if (CONFIG.nodalLineHint) {
      const step = 3;
      const n = currentN, m = currentM;
      ctx.fillStyle = `rgba(200,200,180,${CONFIG.nodalLineOpacity})`;
      for (let py = 0; py < height; py += step) {
        for (let px = 0; px < width; px += step) {
          const nx = px / width, ny = py / height;
          const v = Math.abs(chladniValue(nx, ny, n, m));
          if (v < 0.08) {
            ctx.fillRect(px, py, step, step);
          }
        }
      }
    }

    // -- Update particles --
    for (const p of particles) p.update(currentN, currentM);

    // -- Glow pass (draw dim glow first) --
    if (CONFIG.glowEnabled) {
      for (const p of particles) {
        const px = p.x * width, py = p.y * height;
        ctx.beginPath();
        ctx.arc(px, py, p.size * 4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${gc[0]},${gc[1]},${gc[2]},${CONFIG.glowIntensity * 0.02})`;
        ctx.fill();
      }
    }

    // -- Draw particles --
    for (const p of particles) {
      const px = p.x * width, py = p.y * height;
      ctx.beginPath();
      ctx.arc(px, py, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${sc[0]},${sc[1]},${sc[2]},${CONFIG.particleOpacity})`;
      ctx.fill();
    }

    // -- Border --
    if (CONFIG.borderEnabled) {
      ctx.strokeStyle = CONFIG.borderColor;
      ctx.lineWidth = CONFIG.borderWidth;
      ctx.strokeRect(0, 0, width, height);
    }

    // -- Mode indicator --
    ctx.fillStyle = 'rgba(200,200,180,0.25)';
    ctx.font = '10px monospace';
    ctx.fillText(`n=${currentN.toFixed(1)} m=${currentM.toFixed(1)}`, 8, height - 8);

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
      initParticles();
      generateTexture();
      startAnimation();
      break;
    case 'resize':
      width = e.data.width; height = e.data.height;
      canvas.width = width; canvas.height = height;
      initParticles();
      generateTexture();
      break;
    case 'mousemove':
      mouse.x = e.data.x; mouse.y = e.data.y;
      break;
  }
};
