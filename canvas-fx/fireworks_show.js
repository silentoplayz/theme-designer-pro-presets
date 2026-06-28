/**
 * Title: Fireworks Show
 * Description: An interactive fireworks display! Fireworks launch automatically from the
 *   bottom and explode in colorful bursts. Move your mouse around to launch fireworks
 *   toward the cursor — move fast to create a dazzling barrage! Features three burst
 *   types: spherical, ring, and crackle/glitter with realistic gravity and fading trails.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Auto-Launch --
  autoLaunchMinMs: 1000,                  // Minimum ms between auto launches
  autoLaunchMaxMs: 3000,                  // Maximum ms between auto launches
  maxRockets: 8,                          // Max simultaneous rockets in flight
  maxParticles: 600,                      // Max explosion particles on screen
  maxSmoke: 200,                          // Max smoke particles on screen

  // -- Rocket --
  rocketSpeed: 6,                         // Base upward speed of rockets
  rocketSpeedVariance: 3,                 // ± random speed added
  rocketTrailLength: 12,                  // Number of trail dots behind rocket
  rocketSize: 3,                          // Rocket head radius
  rocketGlowRadius: 15,                   // Glow halo around rocket head
  rocketSparkRate: 0.6,                   // Chance per frame to emit a trail spark

  // -- Explosion --
  burstParticlesMin: 60,                  // Min particles in a standard burst
  burstParticlesMax: 100,                 // Max particles in a standard burst
  ringParticles: 36,                      // Particles in a ring burst
  crackleParticles: 50,                   // Particles in crackle/glitter burst
  burstSpeedMin: 1.5,                     // Min initial particle speed
  burstSpeedMax: 6,                       // Max initial particle speed
  particleGravity: 0.04,                  // Gravity acceleration per frame
  particleLifeMin: 60,                    // Min particle lifetime in frames
  particleLifeMax: 120,                   // Max particle lifetime in frames
  particleTrailLength: 5,                 // Trail points per particle
  particleFriction: 0.985,               // Speed decay per frame (closer to 1 = less friction)
  crackleFlickerRate: 0.3,               // Chance per frame for crackle particles to flicker
  crackleLifeMultiplier: 1.8,            // Crackle particles live longer

  // -- Smoke --
  smokePerExplosion: 8,                   // Smoke particles spawned per explosion
  smokeLife: 80,                          // Smoke lifetime in frames
  smokeSize: 15,                          // Max smoke particle radius
  smokeDrift: 0.3,                        // Smoke horizontal drift speed

  // -- Mouse Interaction --
  mouseTriggerDistance: 50,               // px mouse must move to trigger a launch
  mouseCooldownMs: 200,                   // Min ms between mouse-triggered launches

  // -- Color Palettes --
  palettes: [
    ['#FFD700', '#FFA500', '#FF6347'],                      // Gold / Orange / Tomato
    ['#FF1744', '#FF5252', '#FF8A80'],                      // Reds
    ['#448AFF', '#2979FF', '#82B1FF'],                      // Blues
    ['#00E676', '#69F0AE', '#B9F6CA'],                      // Greens
    ['#D500F9', '#E040FB', '#EA80FC'],                      // Purples
    ['#FF4081', '#FF80AB', '#F48FB1'],                      // Pinks
    ['#ECEFF1', '#CFD8DC', '#B0BEC5'],                      // Silver
    ['#FFD700', '#FF1744', '#448AFF', '#00E676', '#D500F9'], // Multi-color
    ['#FF6347', '#FFD700', '#ECEFF1'],                      // Fire + Silver
    ['#82B1FF', '#EA80FC', '#B9F6CA', '#FFD700'],           // Pastel Multi
  ],
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let lastMouse = { x: -5000, y: -5000 };
let lastMouseLaunchTime = 0;
let rockets = [];
let particles = [];
let smokeParticles = [];
let lastAutoLaunch = 0;
let nextAutoDelay = 0;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function rand(a, b) { return Math.random() * (b - a) + a; }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
function dist(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function pickPalette() {
  return CONFIG.palettes[Math.floor(Math.random() * CONFIG.palettes.length)];
}

function pickColor(palette) {
  const hex = palette[Math.floor(Math.random() * palette.length)];
  return hexToRgb(hex);
}

// ─── Rocket ────────────────────────────────────────────────
function launchRocket(targetX, targetY) {
  if (rockets.length >= CONFIG.maxRockets) return;

  const startX = rand(width * 0.1, width * 0.9);
  const startY = height + 10;
  const dx = targetX - startX;
  const dy = targetY - startY;
  const d = Math.sqrt(dx * dx + dy * dy);
  const speed = CONFIG.rocketSpeed + rand(0, CONFIG.rocketSpeedVariance);
  const palette = pickPalette();
  const headColor = pickColor(palette);

  // Determine burst type: 0 = standard, 1 = ring, 2 = crackle
  const burstType = Math.random() < 0.5 ? 0 : (Math.random() < 0.5 ? 1 : 2);

  rockets.push({
    x: startX,
    y: startY,
    vx: (dx / d) * speed,
    vy: (dy / d) * speed,
    targetY,
    trail: [],
    palette,
    headColor,
    burstType,
    sparkTimer: 0,
  });
}

function updateRockets(now) {
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];

    r.x += r.vx;
    r.y += r.vy;

    // Store trail
    r.trail.unshift({ x: r.x, y: r.y });
    if (r.trail.length > CONFIG.rocketTrailLength) r.trail.pop();

    // Decelerate as approaching target (simulate fuse burning out)
    const distToTarget = Math.abs(r.y - r.targetY);

    // Explode when near target or slowed down
    if (r.y <= r.targetY || distToTarget < 10) {
      explode(r.x, r.y, r.palette, r.burstType);
      spawnSmoke(r.x, r.y);
      rockets.splice(i, 1);
      continue;
    }

    // Off-screen safety
    if (r.y < -100 || r.x < -100 || r.x > width + 100) {
      rockets.splice(i, 1);
      continue;
    }
  }
}

function drawRockets() {
  for (const r of rockets) {
    // Draw trail sparks
    for (let t = 0; t < r.trail.length; t++) {
      const alpha = 1 - t / r.trail.length;
      const size = CONFIG.rocketSize * (1 - t / r.trail.length) * 0.8;
      if (size < 0.3) continue;

      // Jitter for sparkle effect
      const jx = r.trail[t].x + rand(-2, 2);
      const jy = r.trail[t].y + rand(-1, 3);

      ctx.beginPath();
      ctx.arc(jx, jy, size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r.headColor.r}, ${r.headColor.g}, ${r.headColor.b}, ${alpha * 0.7})`;
      ctx.fill();
    }

    // Draw rocket head glow
    const glow = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, CONFIG.rocketGlowRadius);
    glow.addColorStop(0, `rgba(255, 255, 220, 0.8)`);
    glow.addColorStop(0.3, `rgba(${r.headColor.r}, ${r.headColor.g}, ${r.headColor.b}, 0.4)`);
    glow.addColorStop(1, `rgba(${r.headColor.r}, ${r.headColor.g}, ${r.headColor.b}, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(r.x, r.y, CONFIG.rocketGlowRadius, 0, Math.PI * 2);
    ctx.fill();

    // Draw rocket head
    ctx.beginPath();
    ctx.arc(r.x, r.y, CONFIG.rocketSize, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 240, 1)`;
    ctx.fill();
  }
}

// ─── Explosion ─────────────────────────────────────────────
function explode(x, y, palette, burstType) {
  switch (burstType) {
    case 0: burstStandard(x, y, palette); break;
    case 1: burstRing(x, y, palette); break;
    case 2: burstCrackle(x, y, palette); break;
  }
}

function burstStandard(x, y, palette) {
  const count = randInt(CONFIG.burstParticlesMin, CONFIG.burstParticlesMax);
  for (let i = 0; i < count && particles.length < CONFIG.maxParticles; i++) {
    const angle = rand(0, Math.PI * 2);
    const speed = rand(CONFIG.burstSpeedMin, CONFIG.burstSpeedMax);
    const color = pickColor(palette);
    const life = randInt(CONFIG.particleLifeMin, CONFIG.particleLifeMax);
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      life,
      maxLife: life,
      trail: [],
      type: 'standard',
    });
  }
}

function burstRing(x, y, palette) {
  const count = CONFIG.ringParticles;
  const speed = rand(3, 5);
  for (let i = 0; i < count && particles.length < CONFIG.maxParticles; i++) {
    const angle = (i / count) * Math.PI * 2;
    const color = pickColor(palette);
    const life = randInt(CONFIG.particleLifeMin, CONFIG.particleLifeMax);
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      life,
      maxLife: life,
      trail: [],
      type: 'ring',
    });
  }

  // Add a few inner particles for depth
  for (let i = 0; i < 15 && particles.length < CONFIG.maxParticles; i++) {
    const angle = rand(0, Math.PI * 2);
    const spd = rand(1, 2.5);
    const color = pickColor(palette);
    const life = randInt(CONFIG.particleLifeMin * 0.6, CONFIG.particleLifeMax * 0.6);
    particles.push({
      x, y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      color,
      life,
      maxLife: life,
      trail: [],
      type: 'standard',
    });
  }
}

function burstCrackle(x, y, palette) {
  const count = CONFIG.crackleParticles;
  for (let i = 0; i < count && particles.length < CONFIG.maxParticles; i++) {
    const angle = rand(0, Math.PI * 2);
    const speed = rand(CONFIG.burstSpeedMin * 0.8, CONFIG.burstSpeedMax * 0.7);
    const color = pickColor(palette);
    const life = randInt(
      CONFIG.particleLifeMin * CONFIG.crackleLifeMultiplier,
      CONFIG.particleLifeMax * CONFIG.crackleLifeMultiplier
    );
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      life,
      maxLife: life,
      trail: [],
      type: 'crackle',
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life--;

    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }

    // Store trail
    p.trail.unshift({ x: p.x, y: p.y });
    if (p.trail.length > CONFIG.particleTrailLength) p.trail.pop();

    // Physics
    p.vy += CONFIG.particleGravity;
    p.vx *= CONFIG.particleFriction;
    p.vy *= CONFIG.particleFriction;
    p.x += p.vx;
    p.y += p.vy;
  }
}

function drawParticles() {
  for (const p of particles) {
    const lifeRatio = p.life / p.maxLife;
    const { r, g, b } = p.color;

    // Crackle flicker effect
    if (p.type === 'crackle' && Math.random() < CONFIG.crackleFlickerRate) {
      // Skip drawing this frame for twinkle effect
      if (Math.random() < 0.4) continue;
    }

    // Draw trail
    for (let t = 0; t < p.trail.length; t++) {
      const trailAlpha = lifeRatio * (1 - t / p.trail.length) * 0.4;
      if (trailAlpha < 0.01) break;
      const trailSize = (2.5 - t * 0.4) * lifeRatio;
      if (trailSize < 0.2) break;
      ctx.beginPath();
      ctx.arc(p.trail[t].x, p.trail[t].y, trailSize, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${trailAlpha})`;
      ctx.fill();
    }

    // Draw particle with glow
    const size = p.type === 'crackle'
      ? rand(1, 3) * lifeRatio
      : 2.5 * lifeRatio;
    const alpha = p.type === 'crackle'
      ? lifeRatio * rand(0.5, 1)
      : lifeRatio;

    // Outer glow
    if (size > 0.5) {
      const glowSize = size * 3;
      const glowGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowSize);
      glowGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha * 0.3})`);
      glowGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, glowSize, 0, Math.PI * 2);
      ctx.fill();
    }

    // Core
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.5, size), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${Math.min(255, r + 40)}, ${Math.min(255, g + 40)}, ${Math.min(255, b + 40)}, ${alpha})`;
    ctx.fill();
  }
}

// ─── Smoke ─────────────────────────────────────────────────
function spawnSmoke(x, y) {
  for (let i = 0; i < CONFIG.smokePerExplosion && smokeParticles.length < CONFIG.maxSmoke; i++) {
    smokeParticles.push({
      x: x + rand(-20, 20),
      y: y + rand(-20, 20),
      vx: rand(-CONFIG.smokeDrift, CONFIG.smokeDrift),
      vy: rand(-0.5, -0.1),
      size: rand(5, CONFIG.smokeSize),
      life: CONFIG.smokeLife + randInt(-15, 15),
      maxLife: CONFIG.smokeLife,
    });
  }
}

function updateSmoke() {
  for (let i = smokeParticles.length - 1; i >= 0; i--) {
    const s = smokeParticles[i];
    s.life--;
    if (s.life <= 0) {
      smokeParticles.splice(i, 1);
      continue;
    }
    s.x += s.vx;
    s.y += s.vy;
    s.size += 0.1; // Expand slowly
  }
}

function drawSmoke() {
  for (const s of smokeParticles) {
    const alpha = (s.life / s.maxLife) * 0.08;
    if (alpha < 0.005) continue;
    const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.size);
    grad.addColorStop(0, `rgba(180, 180, 180, ${alpha})`);
    grad.addColorStop(1, `rgba(100, 100, 100, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── Main Loop ─────────────────────────────────────────────
function startAnimation() {
  lastAutoLaunch = performance.now();
  nextAutoDelay = rand(CONFIG.autoLaunchMinMs, CONFIG.autoLaunchMaxMs);

  function render() {
    if (!ctx) return;
    const now = performance.now();

    ctx.clearRect(0, 0, width, height);

    // Auto-launch fireworks
    if (now - lastAutoLaunch > nextAutoDelay) {
      const targetX = rand(width * 0.1, width * 0.9);
      const targetY = rand(height * 0.1, height * 0.5);
      launchRocket(targetX, targetY);
      lastAutoLaunch = now;
      nextAutoDelay = rand(CONFIG.autoLaunchMinMs, CONFIG.autoLaunchMaxMs);
    }

    // Mouse-triggered launches
    if (mouse.x > 0 && mouse.y > 0) {
      const mouseDist = dist(mouse.x, mouse.y, lastMouse.x, lastMouse.y);
      if (mouseDist > CONFIG.mouseTriggerDistance && now - lastMouseLaunchTime > CONFIG.mouseCooldownMs) {
        launchRocket(mouse.x, mouse.y);
        lastMouse.x = mouse.x;
        lastMouse.y = mouse.y;
        lastMouseLaunchTime = now;
      }
    }

    // Update
    updateRockets(now);
    updateParticles();
    updateSmoke();

    // Draw (back to front: smoke → particles → rockets)
    drawSmoke();
    drawParticles();
    drawRockets();

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}

// ─── Worker Message Handler ────────────────────────────────
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
      break;
    case 'mousemove':
      mouse.x = e.data.x;
      mouse.y = e.data.y;
      break;
  }
};
