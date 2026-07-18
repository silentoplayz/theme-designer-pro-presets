/**
 * Title: Sandstorm
 * Description: Desert sandstorm with particles blowing horizontally through
 *   turbulent gusts. Mouse creates a calm shelter zone where particles deflect
 *   away. Very atmospheric with layered sand colors and variable opacity.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Particle Count & Size --
  particleCount: 350,                      // Total number of sand particles
  minParticleSize: 1,                      // Smallest particle radius in px
  maxParticleSize: 3.5,                    // Largest particle radius in px

  // -- Sand Colors --
  colorPalette: [                          // Array of sand particle colors (RGBA)
    'rgba(210, 180, 130, 1)',              //   Light tan
    'rgba(190, 155, 100, 1)',              //   Warm sand
    'rgba(170, 140, 90, 1)',               //   Dark sand
    'rgba(220, 195, 155, 1)',              //   Pale cream
    'rgba(160, 130, 80, 1)',               //   Deep ochre
    'rgba(230, 210, 170, 1)',              //   Bleached bone
  ],
  minOpacity: 0.25,                        // Minimum particle opacity (0-1)
  maxOpacity: 0.85,                        // Maximum particle opacity (0-1)

  // -- Wind --
  windSpeed: 5,                            // Base horizontal wind speed in px/frame
  windDirection: 0,                        // Wind angle in degrees (0 = left-to-right)
  turbulence: 2.5,                         // Vertical random turbulence amplitude in px
  turbulenceFrequency: 0.04,               // How fast turbulence oscillates

  // -- Gusts --
  gustFrequency: 3000,                     // Average ms between wind gusts
  gustFrequencyVariance: 2000,             // ± random ms added to gust timing
  gustStrength: 3.5,                       // Speed multiplier during a gust
  gustDuration: 800,                       // How long a gust lasts in ms
  gustRampUp: 200,                         // Ms to ramp up to full gust strength

  // -- Visual Atmosphere --
  hazeOpacity: 0.04,                       // Background haze overlay opacity (0-1)
  hazeColor: 'rgba(200, 175, 130, 1)',     // Color of the atmospheric haze

  // -- Mouse Interaction --
  mouseShelterRadius: 180,                 // Radius of the calm shelter zone in px
  mouseShelterStrength: 6,                 // How hard particles are deflected from mouse
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let particles = [];
let time = 0;
let gustActive = false;
let gustFactor = 0;
let lastGustTime = 0;
let nextGustDelay = 0;
let gustStartTime = 0;

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
      initParticles();
      startAnimation();
      break;
    case 'resize':
      width = e.data.width;
      height = e.data.height;
      canvas.width = width;
      canvas.height = height;
      initParticles();
      break;
    case 'mousemove':
      mouse.x = e.data.x;
      mouse.y = e.data.y;
      break;
  }
};

function parseRGBA(str) {
  const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  return { r: 200, g: 180, b: 130 };
}

function initParticles() {
  particles = [];
  const windRad = CONFIG.windDirection * Math.PI / 180;

  for (let i = 0; i < CONFIG.particleCount; i++) {
    particles.push(createParticle(true, windRad));
  }
}

function createParticle(randomPos, windRad) {
  const colorStr = CONFIG.colorPalette[Math.floor(Math.random() * CONFIG.colorPalette.length)];
  const color = parseRGBA(colorStr);
  const size = CONFIG.minParticleSize + Math.random() * (CONFIG.maxParticleSize - CONFIG.minParticleSize);
  const opacity = CONFIG.minOpacity + Math.random() * (CONFIG.maxOpacity - CONFIG.minOpacity);
  // Smaller particles move slower (depth illusion)
  const depthFactor = 0.4 + (size / CONFIG.maxParticleSize) * 0.6;

  let x, y;
  if (randomPos) {
    x = Math.random() * width;
    y = Math.random() * height;
  } else {
    // Spawn from upwind edge
    const wx = Math.cos(windRad);
    if (wx >= 0) {
      x = -size * 2;
    } else {
      x = width + size * 2;
    }
    y = Math.random() * height;
  }

  return {
    x, y, size, color, opacity, depthFactor,
    turbPhase: Math.random() * Math.PI * 2,
    vx: 0, vy: 0,
  };
}

function startAnimation() {
  const windRad = CONFIG.windDirection * Math.PI / 180;
  const windDirX = Math.cos(windRad);
  const windDirY = Math.sin(windRad);

  function render() {
    if (!ctx) return;
    const now = performance.now();
    time++;

    ctx.clearRect(0, 0, width, height);

    // Background haze
    ctx.save();
    ctx.globalAlpha = CONFIG.hazeOpacity;
    ctx.fillStyle = CONFIG.hazeColor;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    // Gust logic
    if (!gustActive) {
      if (now - lastGustTime > nextGustDelay) {
        gustActive = true;
        gustStartTime = now;
        lastGustTime = now;
      }
    } else {
      const elapsed = now - gustStartTime;
      if (elapsed >= CONFIG.gustDuration) {
        gustActive = false;
        gustFactor = 0;
        nextGustDelay = CONFIG.gustFrequency + (Math.random() - 0.5) * 2 * CONFIG.gustFrequencyVariance;
      } else if (elapsed < CONFIG.gustRampUp) {
        gustFactor = (elapsed / CONFIG.gustRampUp) * (CONFIG.gustStrength - 1);
      } else {
        const fadeStart = CONFIG.gustDuration * 0.6;
        if (elapsed > fadeStart) {
          gustFactor = (CONFIG.gustStrength - 1) * (1 - (elapsed - fadeStart) / (CONFIG.gustDuration - fadeStart));
        } else {
          gustFactor = CONFIG.gustStrength - 1;
        }
      }
    }

    const currentSpeedMult = 1 + gustFactor;

    // Update and draw particles
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];

      // Turbulence
      p.turbPhase += CONFIG.turbulenceFrequency;
      const turbX = Math.sin(p.turbPhase * 1.3 + i) * CONFIG.turbulence * 0.3;
      const turbY = Math.sin(p.turbPhase + i * 0.7) * CONFIG.turbulence;

      // Wind force
      const windForce = CONFIG.windSpeed * p.depthFactor * currentSpeedMult;
      p.vx = windDirX * windForce + turbX;
      p.vy = windDirY * windForce + turbY;

      // Mouse shelter — deflect particles
      const dx = p.x - mouse.x;
      const dy = p.y - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < CONFIG.mouseShelterRadius && dist > 1) {
        const factor = Math.pow(1 - dist / CONFIG.mouseShelterRadius, 2);
        const nx = dx / dist;
        const ny = dy / dist;
        p.vx += nx * CONFIG.mouseShelterStrength * factor;
        p.vy += ny * CONFIG.mouseShelterStrength * factor;
      }

      p.x += p.vx;
      p.y += p.vy;

      // Recycle particles that leave the screen
      const margin = CONFIG.maxParticleSize * 3;
      if (p.x > width + margin || p.x < -margin ||
          p.y > height + margin || p.y < -margin) {
        const fresh = createParticle(false, windRad);
        particles[i] = fresh;
        continue;
      }

      // Draw particle
      ctx.globalAlpha = p.opacity;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${p.color.r}, ${p.color.g}, ${p.color.b})`;
      ctx.fill();
    }

    // Draw haze streaks during gusts for visual emphasis
    if (gustFactor > 0.5) {
      const streakAlpha = Math.min(0.06, gustFactor * 0.02);
      ctx.save();
      ctx.globalAlpha = streakAlpha;
      ctx.strokeStyle = CONFIG.hazeColor;
      ctx.lineWidth = 1;
      for (let s = 0; s < 8; s++) {
        const sy = Math.random() * height;
        const sx = Math.random() * width * 0.3;
        const sl = 80 + Math.random() * 200;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + sl * windDirX, sy + sl * windDirY);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.globalAlpha = 1;
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}
