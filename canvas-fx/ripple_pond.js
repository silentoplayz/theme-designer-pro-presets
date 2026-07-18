/**
 * Title: Ripple Pond
 * Description: Water ripple interference simulation using a 2D wave equation.
 *   Periodic drops create expanding circular ripples that interfere with each other.
 *   Mouse acts as a continuous drop source. Optional rain mode for ambient drops.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Wave Physics --
  dropFrequency: 90,                      // Frames between random drops
  rippleSpeed: 0.4,                       // Wave propagation speed (0-0.5, higher=faster)
  rippleDamping: 0.985,                   // Wave energy decay per frame (0.95-0.999)
  waveHeightMultiplier: 2.5,              // Visual amplitude multiplier (0-10)

  // -- Appearance --
  rippleColor: 'rgba(100, 180, 255, 1)',  // Base ripple highlight color
  rippleWidth: 1,                         // Not used directly — waves are pixel-based
  maxRipples: 15,                         // Max concurrent drop sources
  gridResolution: 4,                      // Pixel step for wave grid (lower=sharper, higher=faster)

  // -- Reflection --
  reflectionEnabled: true,                // Enable bright reflection highlights
  reflectionColor: 'rgba(200, 230, 255, 0.6)', // Reflection highlight color

  // -- Background --
  backgroundTint: 'rgba(10, 20, 40, 0.03)', // Subtle background overlay each frame

  // -- Mouse --
  mouseDropEnabled: true,                 // Mouse acts as a drop source
  mouseDropStrength: 3.0,                 // Mouse drop amplitude (0-10)

  // -- Rain Mode --
  rainMode: false,                        // Continuous random drops everywhere
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let grid, prevGrid;
let cols, rows;
let frameCount = 0;
let lastMouseDrop = 0;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function initGrid() {
  cols = Math.ceil(width / CONFIG.gridResolution) + 1;
  rows = Math.ceil(height / CONFIG.gridResolution) + 1;
  grid = new Float32Array(cols * rows);
  prevGrid = new Float32Array(cols * rows);
}

function addDrop(gx, gy, strength) {
  if (gx < 1 || gx >= cols - 1 || gy < 1 || gy >= rows - 1) return;
  const idx = gy * cols + gx;
  grid[idx] = strength;
}

function addDropAtPixel(px, py, strength) {
  const gx = Math.round(px / CONFIG.gridResolution);
  const gy = Math.round(py / CONFIG.gridResolution);
  // Add a small cluster for a more visible ripple
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = gx + dx;
      const cy = gy + dy;
      if (cx >= 1 && cx < cols - 1 && cy >= 1 && cy < rows - 1) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        grid[cy * cols + cx] += strength * (1 - dist * 0.3);
      }
    }
  }
}

function stepWave() {
  const speed = CONFIG.rippleSpeed;
  const damping = CONFIG.rippleDamping;
  const temp = prevGrid;

  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const idx = y * cols + x;
      const val = (
        grid[idx - 1] +
        grid[idx + 1] +
        grid[(y - 1) * cols + x] +
        grid[(y + 1) * cols + x]
      ) * 0.5 - prevGrid[idx];
      temp[idx] = val * damping;
    }
  }

  prevGrid = grid;
  grid = temp;
}

function parseRgba(str) {
  const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) };
  return { r: 100, g: 180, b: 255 };
}

function startAnimation() {
  const baseColor = parseRgba(CONFIG.rippleColor);
  const reflColor = parseRgba(CONFIG.reflectionColor);

  function render() {
    if (!ctx) return;
    frameCount++;

    // Background
    ctx.fillStyle = CONFIG.backgroundTint;
    ctx.fillRect(0, 0, width, height);
    // Fade slightly to keep it clean
    ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
    ctx.fillRect(0, 0, width, height);

    // Random drops
    if (frameCount % CONFIG.dropFrequency === 0) {
      const gx = Math.floor(Math.random() * (cols - 4)) + 2;
      const gy = Math.floor(Math.random() * (rows - 4)) + 2;
      addDrop(gx, gy, 4);
    }

    // Rain mode
    if (CONFIG.rainMode && frameCount % 12 === 0) {
      const gx = Math.floor(Math.random() * (cols - 4)) + 2;
      const gy = Math.floor(Math.random() * (rows - 4)) + 2;
      addDrop(gx, gy, 2);
    }

    // Mouse drops
    if (CONFIG.mouseDropEnabled && mouse.x > 0 && mouse.y > 0) {
      if (frameCount - lastMouseDrop > 8) {
        addDropAtPixel(mouse.x, mouse.y, CONFIG.mouseDropStrength);
        lastMouseDrop = frameCount;
      }
    }

    // Step physics
    stepWave();

    // Render waves
    const res = CONFIG.gridResolution;
    const mult = CONFIG.waveHeightMultiplier;

    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const val = grid[y * cols + x] * mult;
        if (Math.abs(val) > 0.15) {
          const px = x * res;
          const py = y * res;
          const alpha = Math.min(0.5, Math.abs(val) * 0.08);

          if (val > 0) {
            ctx.fillStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${alpha})`;
          } else {
            ctx.fillStyle = `rgba(${baseColor.r * 0.5 | 0}, ${baseColor.g * 0.5 | 0}, ${baseColor.b}, ${alpha * 0.6})`;
          }
          ctx.fillRect(px, py, res, res);

          // Reflection highlights
          if (CONFIG.reflectionEnabled && val > 1.5) {
            const refAlpha = Math.min(0.3, (val - 1.5) * 0.1);
            ctx.fillStyle = `rgba(${reflColor.r}, ${reflColor.g}, ${reflColor.b}, ${refAlpha})`;
            ctx.fillRect(px, py, res, res);
          }
        }
      }
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
      width = e.data.width;
      height = e.data.height;
      canvas.width = width;
      canvas.height = height;
      initGrid();
      startAnimation();
      break;
    case 'resize':
      width = e.data.width;
      height = e.data.height;
      canvas.width = width;
      canvas.height = height;
      initGrid();
      break;
    case 'mousemove':
      mouse.x = e.data.x;
      mouse.y = e.data.y;
      break;
  }
};
