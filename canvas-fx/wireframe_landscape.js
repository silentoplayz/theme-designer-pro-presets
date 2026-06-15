/**
 * Title: Wireframe Landscape
 * Description: Retro 3D wireframe terrain that scrolls toward the viewer with
 *   perspective projection. Mouse shifts terrain frequency interactively.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Grid Geometry --
  gridCols: 60,                    // Number of grid columns (20-120)
  gridRows: 40,                    // Number of grid rows / depth slices (15-80)
  cellSize: 20,                    // Base cell size before perspective (10-40)

  // -- Wireframe Appearance --
  wireframeColor: '#00e5ff',       // Base wireframe line color
  wireframeOpacity: 0.6,           // Base wireframe opacity (0-1)
  wireframeWidth: 1.0,             // Line width in px (0.5-3)

  // -- Terrain --
  scrollSpeed: 0.8,                // Forward scroll speed (0.1-3.0)
  terrainHeight: 80,               // Maximum terrain displacement in px (20-200)
  terrainFrequency: 0.06,          // Noise spatial frequency (0.02-0.15)
  terrainOctaves: 3,               // Noise octave layers (1-5)

  // -- Visual Effects --
  horizonFadeEnabled: true,        // Fade rows near the horizon
  highlightColor: '#ffffff',       // Color for peak highlights
  highlightThreshold: 0.7,         // Height fraction to trigger highlight (0-1)

  // -- Camera / Projection --
  perspectiveAmount: 400,          // Perspective focal length (200-800)
  cameraHeight: 120,               // Camera height above terrain (50-300)

  // -- Mouse Interaction --
  // Mouse X shifts terrain frequency, Mouse Y shifts terrain height
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let scrollOffset = 0;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

// ── Value noise ──
function hash(x, y) {
  let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x, y, octaves) {
  let v = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * smoothNoise(x * freq, y * freq);
    amp *= 0.5;
    freq *= 2;
  }
  return v;
}

function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
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

function startAnimation() {
  function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    scrollOffset += CONFIG.scrollSpeed * 0.02;

    // Mouse modulation
    let freqMod = 0;
    let heightMod = 0;
    if (mouse.x > 0 && mouse.y > 0) {
      freqMod = ((mouse.x / width) - 0.5) * 0.04;
      heightMod = ((mouse.y / height) - 0.5) * -60;
    }

    const freq = CONFIG.terrainFrequency + freqMod;
    const tHeight = CONFIG.terrainHeight + heightMod;
    const cols = CONFIG.gridCols;
    const rows = CONFIG.gridRows;
    const cSize = CONFIG.cellSize;
    const persp = CONFIG.perspectiveAmount;
    const camH = CONFIG.cameraHeight;
    const vanishY = height * 0.35;
    const baseX = width / 2;

    // Project 3D grid point to 2D
    function project(col, row, elev) {
      const worldX = (col - cols / 2) * cSize;
      const worldZ = (row + 1) * cSize;
      const worldY = -elev - camH;
      const scale = persp / (worldZ + persp);
      return {
        x: baseX + worldX * scale,
        y: vanishY - worldY * scale,
        scale: scale,
      };
    }

    // Compute elevation grid
    const grid = [];
    for (let r = 0; r < rows; r++) {
      grid[r] = [];
      for (let c = 0; c <= cols; c++) {
        const nx = c * freq;
        const nz = (r + scrollOffset) * freq;
        const elev = fbm(nx, nz, CONFIG.terrainOctaves) * tHeight;
        grid[r][c] = elev;
      }
    }

    // Draw from back (far) to front
    for (let r = rows - 1; r >= 0; r--) {
      const rowFade = CONFIG.horizonFadeEnabled
        ? Math.min(1, (rows - r) / (rows * 0.3))
        : 1;
      const alpha = CONFIG.wireframeOpacity * rowFade;
      if (alpha <= 0.01) continue;

      ctx.lineWidth = CONFIG.wireframeWidth;

      // Draw horizontal line (across columns)
      ctx.beginPath();
      for (let c = 0; c <= cols; c++) {
        const p = project(c, r, grid[r][c]);
        if (c === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = hexToRgba(CONFIG.wireframeColor, alpha);
      ctx.stroke();

      // Draw vertical lines (depth direction)
      if (r < rows - 1) {
        for (let c = 0; c <= cols; c += 2) {
          const p1 = project(c, r, grid[r][c]);
          const p2 = project(c, r + 1, grid[r + 1][c]);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = hexToRgba(CONFIG.wireframeColor, alpha * 0.5);
          ctx.stroke();
        }
      }

      // Highlight peaks
      for (let c = 0; c <= cols; c++) {
        const normH = grid[r][c] / tHeight;
        if (normH > CONFIG.highlightThreshold) {
          const p = project(c, r, grid[r][c]);
          const intensity = (normH - CONFIG.highlightThreshold) / (1 - CONFIG.highlightThreshold);
          ctx.fillStyle = hexToRgba(CONFIG.highlightColor, intensity * alpha * 0.6);
          ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
        }
      }
    }

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}
