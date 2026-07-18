/**
 * Title: Comet Shower
 * Description: Comets streak diagonally across the sky with glowing heads and
 *   sparkling fading tails. Mouse gravity pulls nearby comets toward the cursor.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Comet Spawning --
  cometFrequency: 600,                    // Average ms between comet spawns
  cometFrequencyVariance: 400,            // ± random ms added to frequency
  maxComets: 15,                          // Maximum simultaneous comets on screen

  // -- Comet Appearance --
  cometSize: 3.5,                         // Head radius in px
  headGlowRadius: 18,                     // Glow halo around comet head in px
  headGlowOpacity: 0.6,                   // Head glow intensity (0-1)
  colorPalette: [                         // Array of comet head/tail colors
    'rgba(100, 180, 255, 1)',             //   Cool blue
    'rgba(255, 160, 80, 1)',              //   Warm orange
    'rgba(180, 120, 255, 1)',             //   Purple
    'rgba(100, 255, 200, 1)',             //   Teal
    'rgba(255, 255, 150, 1)',             //   Pale gold
  ],

  // -- Tail --
  tailLength: 45,                         // Number of trail points stored
  tailFade: 0.92,                         // Opacity decay per trail point (0-1)
  tailWidth: 2.5,                         // Base tail stroke width in px
  sparkleDensity: 0.4,                    // Chance per trail point to emit a sparkle (0-1)
  sparkleSize: 1.8,                       // Sparkle particle radius in px
  sparkleLife: 40,                        // Sparkle lifetime in frames

  // -- Motion --
  minSpeed: 4,                            // Minimum comet travel speed in px/frame
  maxSpeed: 9,                            // Maximum comet travel speed in px/frame
  angle: 225,                             // Travel direction in degrees (0=right, 90=down, 225=upper-right to lower-left)
  angleVariance: 20,                      // ± random degrees of angle spread

  // -- Mouse Interaction --
  mouseGravityRadius: 250,                // Radius of mouse gravity pull in px
  mouseGravityStrength: 3.5,              // Strength of gravitational pull toward mouse
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let comets = [];
let sparkles = [];
let lastSpawnTime = 0;
let nextSpawnDelay = 0;

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

function parseRGBA(str) {
  const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  return { r: 200, g: 200, b: 255 };
}

function spawnComet() {
  const angleRad = (CONFIG.angle + (Math.random() - 0.5) * CONFIG.angleVariance * 2) * Math.PI / 180;
  const speed = CONFIG.minSpeed + Math.random() * (CONFIG.maxSpeed - CONFIG.minSpeed);
  const vx = Math.cos(angleRad) * speed;
  const vy = Math.sin(angleRad) * speed;

  // Spawn from the edge the comet is coming from
  let x, y;
  if (vx < 0) {
    x = width + 50;
  } else {
    x = -50;
  }
  if (vy < 0) {
    y = height + 50;
  } else {
    y = -50;
  }
  // Add randomness along the perpendicular axis
  x += (Math.random() - 0.3) * width * 0.6;
  y += (Math.random() - 0.3) * height * 0.4;

  const colorStr = CONFIG.colorPalette[Math.floor(Math.random() * CONFIG.colorPalette.length)];
  const color = parseRGBA(colorStr);

  comets.push({
    x, y, vx, vy, speed,
    color,
    colorStr,
    trail: [],
  });
}

function startAnimation() {
  function render() {
    if (!ctx) return;
    const now = performance.now();

    ctx.clearRect(0, 0, width, height);

    // Spawn comets
    if (now - lastSpawnTime > nextSpawnDelay && comets.length < CONFIG.maxComets) {
      spawnComet();
      lastSpawnTime = now;
      nextSpawnDelay = CONFIG.cometFrequency + (Math.random() - 0.5) * 2 * CONFIG.cometFrequencyVariance;
    }

    // Update and draw comets
    for (let i = comets.length - 1; i >= 0; i--) {
      const c = comets[i];

      // Mouse gravity
      const dx = mouse.x - c.x;
      const dy = mouse.y - c.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < CONFIG.mouseGravityRadius && dist > 1) {
        const factor = (1 - dist / CONFIG.mouseGravityRadius);
        c.vx += (dx / dist) * CONFIG.mouseGravityStrength * factor * 0.1;
        c.vy += (dy / dist) * CONFIG.mouseGravityStrength * factor * 0.1;
      }

      c.x += c.vx;
      c.y += c.vy;

      // Store trail
      c.trail.unshift({ x: c.x, y: c.y });
      if (c.trail.length > CONFIG.tailLength) c.trail.pop();

      // Remove if off-screen
      const margin = 100;
      if (c.x < -margin || c.x > width + margin || c.y < -margin || c.y > height + margin) {
        comets.splice(i, 1);
        continue;
      }

      // Emit sparkles from trail
      for (let t = 1; t < c.trail.length; t++) {
        if (Math.random() < CONFIG.sparkleDensity * 0.1) {
          sparkles.push({
            x: c.trail[t].x + (Math.random() - 0.5) * 6,
            y: c.trail[t].y + (Math.random() - 0.5) * 6,
            life: CONFIG.sparkleLife,
            maxLife: CONFIG.sparkleLife,
            color: c.color,
          });
        }
      }

      // Draw tail
      if (c.trail.length > 1) {
        for (let t = 1; t < c.trail.length; t++) {
          const alpha = Math.pow(CONFIG.tailFade, t);
          if (alpha < 0.01) break;
          const w = CONFIG.tailWidth * (1 - t / c.trail.length);
          ctx.beginPath();
          ctx.moveTo(c.trail[t - 1].x, c.trail[t - 1].y);
          ctx.lineTo(c.trail[t].x, c.trail[t].y);
          ctx.strokeStyle = `rgba(${c.color.r}, ${c.color.g}, ${c.color.b}, ${alpha})`;
          ctx.lineWidth = Math.max(0.5, w);
          ctx.lineCap = 'round';
          ctx.stroke();
        }
      }

      // Draw head glow
      const headGrad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, CONFIG.headGlowRadius);
      headGrad.addColorStop(0, `rgba(${c.color.r}, ${c.color.g}, ${c.color.b}, ${CONFIG.headGlowOpacity})`);
      headGrad.addColorStop(1, `rgba(${c.color.r}, ${c.color.g}, ${c.color.b}, 0)`);
      ctx.fillStyle = headGrad;
      ctx.beginPath();
      ctx.arc(c.x, c.y, CONFIG.headGlowRadius, 0, Math.PI * 2);
      ctx.fill();

      // Draw head
      ctx.beginPath();
      ctx.arc(c.x, c.y, CONFIG.cometSize, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${Math.min(255, c.color.r + 60)}, ${Math.min(255, c.color.g + 60)}, ${Math.min(255, c.color.b + 60)}, 1)`;
      ctx.fill();
    }

    // Update and draw sparkles
    for (let i = sparkles.length - 1; i >= 0; i--) {
      const s = sparkles[i];
      s.life--;
      if (s.life <= 0) {
        sparkles.splice(i, 1);
        continue;
      }
      const alpha = (s.life / s.maxLife) * 0.8;
      ctx.beginPath();
      ctx.arc(s.x, s.y, CONFIG.sparkleSize * (s.life / s.maxLife), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${s.color.r}, ${s.color.g}, ${s.color.b}, ${alpha})`;
      ctx.fill();
    }

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}
