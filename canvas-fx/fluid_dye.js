/**
 * Title: Fluid Dye
 * Description: Simplified fluid dynamics — mouse movement injects colored dye and
 *   pushes a velocity field. Dye swirls, disperses, and creates mesmerizing patterns
 *   like ink dropped in water. Features grid-based velocity with diffusion, advection,
 *   and optional vorticity confinement. Rendered via ImageData for per-pixel color.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Dye --
  dyeColors: [                            // Dye injection colors [r,g,b] — cycles through
    [255, 40, 120],                       // Pink
    [40, 180, 255],                       // Cyan
    [255, 200, 40],                       // Gold
    [120, 255, 80],                       // Lime
    [180, 60, 255],                       // Purple
    [255, 120, 40],                       // Orange
  ],
  colorCycleSpeed: 100,                   // Frames between color shifts (30-300)
  dyeIntensity: 3.0,                      // Injection strength (0.5-8)
  dyeRadius: 4,                           // Injection radius in grid cells (2-12)

  // -- Fluid Physics --
  diffusion: 0.0002,                      // Velocity diffusion rate (0-0.001)
  viscosity: 0.997,                       // Damping per frame (0.99-0.9999)
  velocityScale: 25,                      // Mouse push strength (5-60)
  gridResolution: 5,                      // Cell size in px (3-8, lower=sharper)

  // -- Vorticity --
  vorticityEnabled: true,                 // Enhanced curl/swirl behavior
  vorticityStrength: 2.0,                 // Swirl enhancement (0.5-8)

  // -- Dye Fade --
  dyeFade: 0.996,                         // How fast dye fades (0.99-0.9999)

  // -- Rendering --
  pressureIterations: 6,                  // Jacobi pressure solve steps (2-20)
  backgroundColor: [5, 5, 15],            // Background tint [r,g,b]
  glowEnabled: true,                      // Bloom on bright areas
  glowIntensity: 1.2,                     // Bloom strength (0.5-3)
  blendMode: 'additive',                  // 'additive' or 'normal'
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -1, y: -1 };
let prevMouse = { x: -1, y: -1 };
let time = 0;
let cols, rows, size;
let vx, vy, vx0, vy0; // velocity fields
let dr, dg, db, dr0, dg0, db0; // dye density (RGB channels)
let imageData, pixels;
let colorIndex = 0;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function idx(x, y) { return y * cols + x; }

function initFields() {
  size = CONFIG.gridResolution;
  cols = Math.ceil(width / size) + 2;
  rows = Math.ceil(height / size) + 2;
  const n = cols * rows;

  vx = new Float32Array(n); vy = new Float32Array(n);
  vx0 = new Float32Array(n); vy0 = new Float32Array(n);
  dr = new Float32Array(n); dg = new Float32Array(n); db = new Float32Array(n);
  dr0 = new Float32Array(n); dg0 = new Float32Array(n); db0 = new Float32Array(n);

  imageData = ctx.createImageData(width, height);
  pixels = imageData.data;
}

// Diffuse: spread values to neighbors (Gauss-Seidel relaxation)
function diffuse(x, x0, diff) {
  if (diff <= 0) { x.set(x0); return; }
  const a = diff * cols * rows;
  const inv = 1 / (1 + 4 * a);
  for (let iter = 0; iter < CONFIG.pressureIterations; iter++) {
    for (let j = 1; j < rows - 1; j++) {
      for (let i = 1; i < cols - 1; i++) {
        const id = idx(i, j);
        x[id] = (x0[id] + a * (x[id-1] + x[id+1] + x[id-cols] + x[id+cols])) * inv;
      }
    }
  }
}

// Advect: move quantities along velocity field (semi-Lagrangian)
function advect(d, d0, u, v) {
  for (let j = 1; j < rows - 1; j++) {
    for (let i = 1; i < cols - 1; i++) {
      const id = idx(i, j);
      // Trace back
      let x = i - u[id];
      let y = j - v[id];
      // Clamp
      if (x < 0.5) x = 0.5; if (x > cols - 1.5) x = cols - 1.5;
      if (y < 0.5) y = 0.5; if (y > rows - 1.5) y = rows - 1.5;
      // Bilinear interpolation
      const i0 = x | 0, j0 = y | 0;
      const i1 = i0 + 1, j1 = j0 + 1;
      const sx = x - i0, sy = y - j0;
      d[id] = (1-sx) * ((1-sy) * d0[idx(i0,j0)] + sy * d0[idx(i0,j1)])
            +    sx  * ((1-sy) * d0[idx(i1,j0)] + sy * d0[idx(i1,j1)]);
    }
  }
}

// Project: make velocity field divergence-free (mass conservation)
function project() {
  const p = vx0, div = vy0; // reuse buffers
  const hx = 1.0 / cols, hy = 1.0 / rows;

  // Compute divergence
  for (let j = 1; j < rows - 1; j++) {
    for (let i = 1; i < cols - 1; i++) {
      const id = idx(i, j);
      div[id] = -0.5 * (vx[id+1] - vx[id-1] + vy[id+cols] - vy[id-cols]);
      p[id] = 0;
    }
  }

  // Solve pressure (Jacobi)
  for (let iter = 0; iter < CONFIG.pressureIterations; iter++) {
    for (let j = 1; j < rows - 1; j++) {
      for (let i = 1; i < cols - 1; i++) {
        const id = idx(i, j);
        p[id] = (div[id] + p[id-1] + p[id+1] + p[id-cols] + p[id+cols]) * 0.25;
      }
    }
  }

  // Subtract pressure gradient
  for (let j = 1; j < rows - 1; j++) {
    for (let i = 1; i < cols - 1; i++) {
      const id = idx(i, j);
      vx[id] -= 0.5 * (p[id+1] - p[id-1]);
      vy[id] -= 0.5 * (p[id+cols] - p[id-cols]);
    }
  }
}

// Vorticity confinement: amplify existing curls
function addVorticity() {
  if (!CONFIG.vorticityEnabled) return;
  const str = CONFIG.vorticityStrength * 0.0005;

  // Compute curl (ω = dvx/dy - dvy/dx)
  const curl = dr0; // reuse buffer
  for (let j = 1; j < rows - 1; j++) {
    for (let i = 1; i < cols - 1; i++) {
      const id = idx(i, j);
      curl[id] = (vx[id+cols] - vx[id-cols]) - (vy[id+1] - vy[id-1]);
    }
  }

  // Apply confinement force
  for (let j = 2; j < rows - 2; j++) {
    for (let i = 2; i < cols - 2; i++) {
      const id = idx(i, j);
      // Gradient of |curl|
      const dcdx = Math.abs(curl[id+1]) - Math.abs(curl[id-1]);
      const dcdy = Math.abs(curl[id+cols]) - Math.abs(curl[id-cols]);
      const len = Math.sqrt(dcdx * dcdx + dcdy * dcdy) + 0.00001;
      // Normalized curl gradient × curl = confinement force direction
      const nx = dcdx / len, ny = dcdy / len;
      vx[id] += str * (ny * curl[id]);
      vy[id] -= str * (nx * curl[id]);
    }
  }
}

function velocityStep() {
  // Add mouse force
  if (mouse.x >= 0 && prevMouse.x >= 0) {
    const dx = mouse.x - prevMouse.x;
    const dy = mouse.y - prevMouse.y;
    const mx = Math.floor(mouse.x / size);
    const my = Math.floor(mouse.y / size);
    const r = CONFIG.dyeRadius;
    const scale = CONFIG.velocityScale * 0.1;

    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        const gx = mx + i, gy = my + j;
        if (gx < 1 || gx >= cols - 1 || gy < 1 || gy >= rows - 1) continue;
        const d = Math.sqrt(i * i + j * j);
        if (d > r) continue;
        const falloff = 1 - d / r;
        const id2 = idx(gx, gy);
        vx[id2] += dx * scale * falloff;
        vy[id2] += dy * scale * falloff;
      }
    }
  }

  // Diffuse
  vx0.set(vx); vy0.set(vy);
  diffuse(vx, vx0, CONFIG.diffusion);
  diffuse(vy, vy0, CONFIG.diffusion);
  project();

  // Advect
  vx0.set(vx); vy0.set(vy);
  advect(vx, vx0, vx0, vy0);
  advect(vy, vy0, vx0, vy0);
  project();

  // Vorticity
  addVorticity();

  // Damping
  const visc = CONFIG.viscosity;
  for (let i = 0; i < vx.length; i++) { vx[i] *= visc; vy[i] *= visc; }
}

function dyeStep() {
  // Inject dye at mouse
  if (mouse.x >= 0 && prevMouse.x >= 0) {
    const speed = Math.hypot(mouse.x - prevMouse.x, mouse.y - prevMouse.y);
    if (speed > 0.5) {
      const mx = Math.floor(mouse.x / size);
      const my = Math.floor(mouse.y / size);
      const r = CONFIG.dyeRadius;
      const c = CONFIG.dyeColors[colorIndex];
      const intensity = CONFIG.dyeIntensity;

      for (let j = -r; j <= r; j++) {
        for (let i = -r; i <= r; i++) {
          const gx = mx + i, gy = my + j;
          if (gx < 1 || gx >= cols - 1 || gy < 1 || gy >= rows - 1) continue;
          const d = Math.sqrt(i * i + j * j);
          if (d > r) continue;
          const f = (1 - d / r) * intensity * Math.min(1, speed * 0.1);
          const id2 = idx(gx, gy);
          dr[id2] += c[0] * f * 0.004;
          dg[id2] += c[1] * f * 0.004;
          db[id2] += c[2] * f * 0.004;
        }
      }
    }
  }

  // Diffuse dye
  dr0.set(dr); dg0.set(dg); db0.set(db);
  diffuse(dr, dr0, CONFIG.diffusion * 0.5);
  diffuse(dg, dg0, CONFIG.diffusion * 0.5);
  diffuse(db, db0, CONFIG.diffusion * 0.5);

  // Advect dye
  dr0.set(dr); dg0.set(dg); db0.set(db);
  advect(dr, dr0, vx, vy);
  advect(dg, dg0, vx, vy);
  advect(db, db0, vx, vy);

  // Fade
  const fade = CONFIG.dyeFade;
  for (let i = 0; i < dr.length; i++) {
    dr[i] *= fade; dg[i] *= fade; db[i] *= fade;
  }
}

function renderToPixels() {
  const bg = CONFIG.backgroundColor;
  const additive = CONFIG.blendMode === 'additive';
  const glow = CONFIG.glowEnabled ? CONFIG.glowIntensity : 1;

  for (let py = 0; py < height; py++) {
    const gy = (py / size) | 0;
    const fy = py / size - gy;
    const gy1 = Math.min(gy + 1, rows - 1);

    for (let px = 0; px < width; px++) {
      const gx = (px / size) | 0;
      const fx = px / size - gx;
      const gx1 = Math.min(gx + 1, cols - 1);

      // Bilinear interp of dye at this pixel
      const i00 = gy * cols + gx;
      const i10 = gy * cols + gx1;
      const i01 = gy1 * cols + gx;
      const i11 = gy1 * cols + gx1;

      let r = (1-fx)*(1-fy)*dr[i00] + fx*(1-fy)*dr[i10] + (1-fx)*fy*dr[i01] + fx*fy*dr[i11];
      let g = (1-fx)*(1-fy)*dg[i00] + fx*(1-fy)*dg[i10] + (1-fx)*fy*dg[i01] + fx*fy*dg[i11];
      let b = (1-fx)*(1-fy)*db[i00] + fx*(1-fy)*db[i10] + (1-fx)*fy*db[i01] + fx*fy*db[i11];

      // Tonemap
      r = Math.min(1, r * glow);
      g = Math.min(1, g * glow);
      b = Math.min(1, b * glow);

      const pidx = (py * width + px) << 2;
      if (additive) {
        pixels[pidx]     = Math.min(255, bg[0] + r * 255);
        pixels[pidx + 1] = Math.min(255, bg[1] + g * 255);
        pixels[pidx + 2] = Math.min(255, bg[2] + b * 255);
      } else {
        pixels[pidx]     = bg[0] + (255 - bg[0]) * r;
        pixels[pidx + 1] = bg[1] + (255 - bg[1]) * g;
        pixels[pidx + 2] = bg[2] + (255 - bg[2]) * b;
      }
      pixels[pidx + 3] = 255;
    }
  }
}

function startAnimation() {
  function render() {
    if (!ctx) return;
    time++;

    // Color cycling
    if (time % CONFIG.colorCycleSpeed === 0) {
      colorIndex = (colorIndex + 1) % CONFIG.dyeColors.length;
    }

    velocityStep();
    dyeStep();
    renderToPixels();
    ctx.putImageData(imageData, 0, 0);

    prevMouse.x = mouse.x;
    prevMouse.y = mouse.y;

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
      initFields();
      startAnimation();
      break;
    case 'resize':
      width = e.data.width; height = e.data.height;
      canvas.width = width; canvas.height = height;
      initFields();
      break;
    case 'mousemove':
      mouse.x = e.data.x; mouse.y = e.data.y;
      break;
  }
};
