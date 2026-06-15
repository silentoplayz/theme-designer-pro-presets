/**
 * Title: Galaxy Forge
 * Description: A spiral galaxy with thousands of orbiting stars. Mouse creates a
 *   gravitational well that warps star orbits, pulling tidal streams. Stars have
 *   color variation by distance, orbital trails, and a pulsing central core.
 *   Move the mouse to sculpt the galaxy in real-time.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Stars --
  starCount: 2200,                        // Total stars (500-5000)
  starMinSize: 0.5,                       // Smallest star radius (0.3-2)
  starMaxSize: 2.5,                       // Largest star radius (1.5-5)
  starGlow: true,                         // Soft glow on bright stars
  trailEnabled: true,                     // Stars leave brief orbital trails
  trailLength: 4,                         // Trail persistence (2-8)
  trailOpacity: 0.08,                     // Trail opacity (0.02-0.2)

  // -- Galaxy Structure --
  armCount: 3,                            // Number of spiral arms (2-6)
  armSpread: 0.35,                        // How tightly wound (0.1-1, lower=tighter)
  armWidth: 0.45,                         // Angular spread of each arm (0.1-0.8)
  rotationSpeed: 0.0018,                  // Base orbital speed (0.0005-0.005)

  // -- Core --
  coreRadius: 45,                         // Central bright region radius (20-80)
  coreColor: '#ffe0a0',                   // Core glow color
  corePulseSpeed: 0.8,                    // Core brightness pulse (0-3)

  // -- Dust & Nebula --
  dustLanes: true,                        // Dark bands between arms
  dustOpacity: 0.2,                       // Dust lane darkness (0.05-0.5)
  nebulaEnabled: true,                    // Colored nebula patches
  nebulaColors: ['#331155', '#113355', '#553311', '#115533'],

  // -- Mouse Gravity --
  mouseGravityStrength: 4,                // Pull force (0.5-15)
  mouseGravityRadius: 250,               // Influence radius in px (80-500)

  // -- Background --
  backgroundColor: '#030308',             // Deep space color
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -1, y: -1 };
let time = 0;
let stars = [];
let cx, cy;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function rand(a, b) { return Math.random() * (b - a) + a; }
function hexRgb(h) { return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; }

function initStars() {
  cx = width / 2;
  cy = height / 2;
  stars = [];
  const maxR = Math.min(width, height) * 0.42;

  for (let i = 0; i < CONFIG.starCount; i++) {
    // Distribute in spiral arms with some scatter
    const arm = Math.floor(rand(0, CONFIG.armCount));
    const armAngle = (arm / CONFIG.armCount) * Math.PI * 2;
    const dist = Math.pow(Math.random(), 0.6) * maxR; // more stars near center
    const spiralAngle = armAngle + dist * CONFIG.armSpread * 0.03;
    const scatter = (Math.random() - 0.5) * CONFIG.armWidth * 2;
    const angle = spiralAngle + scatter;

    const x = cx + Math.cos(angle) * dist;
    const y = cy + Math.sin(angle) * dist;

    // Color by distance — blue-white near core, amber/red at edges
    const distNorm = dist / maxR;
    let r, g, b;
    if (distNorm < 0.3) {
      r = 200 + rand(30, 55); g = 210 + rand(20, 45); b = 240 + rand(10, 15);
    } else if (distNorm < 0.6) {
      r = 240 + rand(0, 15); g = 220 + rand(0, 30); b = 180 + rand(0, 50);
    } else {
      r = 220 + rand(0, 35); g = 160 + rand(0, 60); b = 100 + rand(0, 60);
    }

    stars.push({
      x, y,
      ox: x, oy: y, // original position for trail
      dist,
      angle,
      orbitSpeed: (1 / (dist + 20)) * CONFIG.rotationSpeed * 60 * rand(0.8, 1.2),
      size: rand(CONFIG.starMinSize, CONFIG.starMaxSize) * (1 - distNorm * 0.4),
      color: [Math.min(255, r), Math.min(255, g), Math.min(255, b)],
      brightness: rand(0.5, 1),
    });
  }
}

function startAnimation() {
  const coreRgb = hexRgb(CONFIG.coreColor);
  const bgRgb = hexRgb(CONFIG.backgroundColor);

  function render() {
    if (!ctx) return;
    time += 0.016;

    // -- Background with trail fade --
    if (CONFIG.trailEnabled) {
      ctx.fillStyle = `rgba(${bgRgb[0]},${bgRgb[1]},${bgRgb[2]},${CONFIG.trailOpacity})`;
      ctx.fillRect(0, 0, width, height);
    } else {
      ctx.fillStyle = CONFIG.backgroundColor;
      ctx.fillRect(0, 0, width, height);
    }

    // -- Nebula clouds --
    if (CONFIG.nebulaEnabled) {
      for (let i = 0; i < CONFIG.nebulaColors.length; i++) {
        const nc = hexRgb(CONFIG.nebulaColors[i]);
        const na = 0.6 + i * 1.2;
        const nx = cx + Math.cos(na + time * 0.03) * 120;
        const ny = cy + Math.sin(na * 1.3 + time * 0.02) * 100;
        const ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, 100);
        ng.addColorStop(0, `rgba(${nc[0]},${nc[1]},${nc[2]},0.02)`);
        ng.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = ng;
        ctx.fillRect(nx - 100, ny - 100, 200, 200);
      }
    }

    // -- Dust lanes --
    if (CONFIG.dustLanes) {
      const maxR = Math.min(width, height) * 0.42;
      for (let arm = 0; arm < CONFIG.armCount; arm++) {
        const baseAngle = (arm + 0.5) / CONFIG.armCount * Math.PI * 2;
        for (let d = 20; d < maxR; d += 15) {
          const angle = baseAngle + d * CONFIG.armSpread * 0.03 + time * CONFIG.rotationSpeed * 8;
          const dx = cx + Math.cos(angle) * d;
          const dy = cy + Math.sin(angle) * d;
          ctx.beginPath();
          ctx.arc(dx, dy, 12 + d * 0.04, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(0,0,0,${CONFIG.dustOpacity * 0.04})`;
          ctx.fill();
        }
      }
    }

    // -- Update and draw stars --
    const mActive = mouse.x >= 0 && mouse.y >= 0;
    const mgr = CONFIG.mouseGravityRadius;
    const mgs = CONFIG.mouseGravityStrength;

    for (const s of stars) {
      // Orbital rotation around center
      s.angle += s.orbitSpeed;
      s.x = cx + Math.cos(s.angle) * s.dist;
      s.y = cy + Math.sin(s.angle) * s.dist;

      // Mouse gravity pull
      if (mActive) {
        const dx = mouse.x - s.x;
        const dy = mouse.y - s.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < mgr && d > 5) {
          const force = (1 - d / mgr) * mgs * 0.5;
          s.x += (dx / d) * force;
          s.y += (dy / d) * force;
        }
      }

      // Draw star
      const c = s.color;
      const alpha = s.brightness * (0.6 + Math.sin(time * 3 + s.angle * 5) * 0.1);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
      ctx.fill();

      // Star glow
      if (CONFIG.starGlow && s.size > 1.5) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size * 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha * 0.04})`;
        ctx.fill();
      }
    }

    // -- Core glow --
    const corePulse = 0.8 + Math.sin(time * CONFIG.corePulseSpeed * 3) * 0.2;
    for (let i = 3; i >= 0; i--) {
      const r = CONFIG.coreRadius * (0.3 + i * 0.6) * corePulse;
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      cg.addColorStop(0, `rgba(${coreRgb[0]},${coreRgb[1]},${coreRgb[2]},${0.08 / (i + 1)})`);
      cg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Bright core center
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,240,${0.5 * corePulse})`;
    ctx.fill();

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
      initStars();
      startAnimation();
      break;
    case 'resize':
      width = e.data.width; height = e.data.height;
      canvas.width = width; canvas.height = height;
      initStars();
      break;
    case 'mousemove':
      mouse.x = e.data.x; mouse.y = e.data.y;
      break;
  }
};
