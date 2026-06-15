/**
 * Title: Topographic Map
 * Description: Smooth, flowing topographic contour lines over a continuously
 *   evolving terrain. Bilinear-interpolated gradient fills and organic multi-axis
 *   time drift create a fluid, living map feel. Mouse creates a soft hill.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Contour Appearance --
  contourCount: 14,                // Number of contour elevation bands (4-30)
  contourOpacity: 0.55,            // Contour line opacity (0-1)
  contourWidth: 1.0,               // Contour line width in px (0.5-4)
  fillEnabled: true,               // Smooth gradient fill between contour bands
  fillOpacity: 0.18,               // Fill opacity (0-1)

  // -- Color Palette --
  colorPalette: [                  // Colors for elevation bands (low → high)
    '#0a2463', '#1e6091', '#168aad',
    '#34a0a4', '#52b69a', '#76c893',
    '#99d98c', '#b5e48c', '#d9ed92',
    '#f0f3bd', '#fefae0', '#faedcd',
    '#e6ccb2', '#ddb892'
  ],

  // -- Noise / Terrain --
  animationSpeed: 0.0006,          // Time evolution speed (0.0001-0.005)
  noiseScale: 0.0035,              // Spatial noise frequency (0.001-0.02)
  noiseOctaves: 4,                 // Noise detail layers (1-6)
  elevationRange: 1.0,             // Total elevation range scalar (0.5-2.0)

  // -- Sampling --
  gridStep: 6,                     // Grid cell size in px (4-10, higher=faster)

  // -- Mouse Interaction --
  mousePeakRadius: 200,            // Radius of mouse hill in px (50-400)
  mousePeakHeight: 0.4,            // Height of mouse hill (0-1)
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let time = 0;
let cols, rows, grid;
let imageData, pixels;
let paletteRgb;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

// ── Permutation-table gradient noise ──
const PERM = new Uint8Array(512);
(function initPerm() {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let seed = 42;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();

const GRAD_X = new Float32Array([1, -1, 1, -1, 1, 0, -1, 0]);
const GRAD_Y = new Float32Array([1, 1, -1, -1, 0, 1, 0, -1]);

function gradNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const ixa = ix & 255, iya = iy & 255;

  const i00 = PERM[(PERM[ixa] + iya) & 511] & 7;
  const i10 = PERM[(PERM[(ixa + 1) & 255] + iya) & 511] & 7;
  const i01 = PERM[(PERM[ixa] + ((iya + 1) & 255)) & 511] & 7;
  const i11 = PERM[(PERM[(ixa + 1) & 255] + ((iya + 1) & 255)) & 511] & 7;

  const nx0 = (GRAD_X[i00] * fx + GRAD_Y[i00] * fy)
    + sx * ((GRAD_X[i10] * (fx - 1) + GRAD_Y[i10] * fy) - (GRAD_X[i00] * fx + GRAD_Y[i00] * fy));
  const nx1 = (GRAD_X[i01] * fx + GRAD_Y[i01] * (fy - 1))
    + sx * ((GRAD_X[i11] * (fx - 1) + GRAD_Y[i11] * (fy - 1)) - (GRAD_X[i01] * fx + GRAD_Y[i01] * (fy - 1)));
  return (nx0 + sy * (nx1 - nx0)) * 0.5 + 0.5;
}

function fbm(x, y, octaves) {
  let val = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * gradNoise(x * freq, y * freq);
    amp *= 0.5;
    freq *= 2.0;
  }
  return val;
}

function buildPalette() {
  paletteRgb = CONFIG.colorPalette.map(hex => ({
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }));
}

function initGrid() {
  const step = CONFIG.gridStep;
  cols = Math.ceil(width / step) + 2;
  rows = Math.ceil(height / step) + 2;
  grid = new Float32Array(cols * rows);
  imageData = ctx.createImageData(width, height);
  pixels = imageData.data;
  buildPalette();
}

function sampleGrid() {
  const step = CONFIG.gridStep;
  const ns = CONFIG.noiseScale;
  const oct = CONFIG.noiseOctaves;
  const er = CONFIG.elevationRange;
  const mx = mouse.x, my = mouse.y;
  const mpr = CONFIG.mousePeakRadius;
  const mph = CONFIG.mousePeakHeight;
  const mpr2 = mpr * mpr;

  // Organic multi-axis drift — terrain flows, not just shifts
  const tx = time * 0.25;
  const ty = time * 0.18;
  const drift = Math.sin(time * 0.4) * 0.3;

  for (let r = 0; r < rows; r++) {
    const py = r * step;
    const rowOff = r * cols;
    for (let c = 0; c < cols; c++) {
      const px = c * step;
      let elev = fbm(px * ns + tx + drift, py * ns + ty - drift * 0.7, oct) * er;

      const dx = px - mx;
      const dy = py - my;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < mpr2) {
        const f = 1 - Math.sqrt(dist2) / mpr;
        // Smooth cubic falloff instead of quadratic — softer hill
        elev += mph * f * f * (3 - 2 * f);
      }

      grid[rowOff + c] = elev;
    }
  }
}

// ── Bilinear interpolation of grid elevation at any pixel ──
function elevAt(px, py) {
  const step = CONFIG.gridStep;
  const gx = px / step;
  const gy = py / step;
  const c0 = gx | 0;
  const r0 = gy | 0;
  const c1 = Math.min(c0 + 1, cols - 1);
  const r1 = Math.min(r0 + 1, rows - 1);
  const fx = gx - c0;
  const fy = gy - r0;

  const tl = grid[r0 * cols + c0];
  const tr = grid[r0 * cols + c1];
  const bl = grid[r1 * cols + c0];
  const br = grid[r1 * cols + c1];

  return tl + (tr - tl) * fx + (bl - tl) * fy + (tl - tr - bl + br) * fx * fy;
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

function startAnimation() {
  // Precompute a smooth 256-entry color LUT from the palette
  const LUT_R = new Uint8Array(256);
  const LUT_G = new Uint8Array(256);
  const LUT_B = new Uint8Array(256);

  function rebuildLUT() {
    const pal = paletteRgb;
    const n = pal.length;
    for (let i = 0; i < 256; i++) {
      const t = i / 255 * (n - 1);
      const lo = Math.floor(t);
      const hi = Math.min(lo + 1, n - 1);
      const f = t - lo;
      LUT_R[i] = pal[lo].r + (pal[hi].r - pal[lo].r) * f;
      LUT_G[i] = pal[lo].g + (pal[hi].g - pal[lo].g) * f;
      LUT_B[i] = pal[lo].b + (pal[hi].b - pal[lo].b) * f;
    }
  }
  rebuildLUT();

  // Fill sub-sampling: render every Nth pixel for speed, interpolate the rest
  const FILL_STEP = 2;

  function render() {
    if (!ctx) return;
    time += CONFIG.animationSpeed;

    sampleGrid();

    // ── Find min/max ──
    let minE = Infinity, maxE = -Infinity;
    const len = cols * rows;
    for (let i = 0; i < len; i++) {
      const v = grid[i];
      if (v < minE) minE = v;
      if (v > maxE) maxE = v;
    }
    const range = maxE - minE || 1;
    const invRange = 255 / range;
    const step = CONFIG.gridStep;
    const levels = CONFIG.contourCount;

    // ── Smooth gradient fill via bilinear interpolation + color LUT ──
    if (CONFIG.fillEnabled) {
      const fillAlpha = Math.round(CONFIG.fillOpacity * 255);
      const w = width, h = height;

      // Sample every FILL_STEP pixel, write FILL_STEP×FILL_STEP blocks
      for (let y = 0; y < h; y += FILL_STEP) {
        const rowOff = y * w;
        for (let x = 0; x < w; x += FILL_STEP) {
          const elev = elevAt(x, y);
          const ci = Math.max(0, Math.min(255, ((elev - minE) * invRange) | 0));
          const cr = LUT_R[ci], cg = LUT_G[ci], cb = LUT_B[ci];

          // Fill the FILL_STEP×FILL_STEP block
          const xEnd = Math.min(x + FILL_STEP, w);
          const yEnd = Math.min(y + FILL_STEP, h);
          for (let py = y; py < yEnd; py++) {
            const pRowOff = py * w;
            for (let px = x; px < xEnd; px++) {
              const idx = (pRowOff + px) << 2;
              pixels[idx] = cr;
              pixels[idx + 1] = cg;
              pixels[idx + 2] = cb;
              pixels[idx + 3] = fillAlpha;
            }
          }
        }
      }
      ctx.putImageData(imageData, 0, 0);
    } else {
      ctx.clearRect(0, 0, width, height);
    }

    // ── Contour lines ──
    for (let l = 0; l < levels; l++) {
      const threshold = minE + (l + 1) * range / (levels + 1);
      const ci = Math.max(0, Math.min(255, (((l + 1) / (levels + 1)) * 255) | 0));

      ctx.strokeStyle = `rgba(${LUT_R[ci]},${LUT_G[ci]},${LUT_B[ci]},${CONFIG.contourOpacity})`;
      ctx.lineWidth = CONFIG.contourWidth;
      ctx.beginPath();

      for (let r = 0; r < rows - 2; r++) {
        const rowOff = r * cols;
        const nextRowOff = (r + 1) * cols;
        const y = r * step;

        for (let c = 0; c < cols - 2; c++) {
          const tl = grid[rowOff + c];
          const tr = grid[rowOff + c + 1];
          const bl = grid[nextRowOff + c];
          const br = grid[nextRowOff + c + 1];
          const x = c * step;

          const dTL = tl - threshold;
          const dTR = tr - threshold;
          const dBL = bl - threshold;
          const dBR = br - threshold;

          let n = 0;
          let e0x, e0y, e1x, e1y, e2x, e2y, e3x, e3y;

          if (dTL * dTR < 0) {
            const t = dTL / (dTL - dTR);
            if (n === 0) { e0x = x + t * step; e0y = y; }
            else if (n === 1) { e1x = x + t * step; e1y = y; }
            else if (n === 2) { e2x = x + t * step; e2y = y; }
            else { e3x = x + t * step; e3y = y; }
            n++;
          }
          if (dTR * dBR < 0) {
            const t = dTR / (dTR - dBR);
            if (n === 0) { e0x = x + step; e0y = y + t * step; }
            else if (n === 1) { e1x = x + step; e1y = y + t * step; }
            else if (n === 2) { e2x = x + step; e2y = y + t * step; }
            else { e3x = x + step; e3y = y + t * step; }
            n++;
          }
          if (dBL * dBR < 0) {
            const t = dBL / (dBL - dBR);
            if (n === 0) { e0x = x + t * step; e0y = y + step; }
            else if (n === 1) { e1x = x + t * step; e1y = y + step; }
            else if (n === 2) { e2x = x + t * step; e2y = y + step; }
            else { e3x = x + t * step; e3y = y + step; }
            n++;
          }
          if (dTL * dBL < 0) {
            const t = dTL / (dTL - dBL);
            if (n === 0) { e0x = x; e0y = y + t * step; }
            else if (n === 1) { e1x = x; e1y = y + t * step; }
            else if (n === 2) { e2x = x; e2y = y + t * step; }
            else { e3x = x; e3y = y + t * step; }
            n++;
          }

          if (n >= 2) {
            ctx.moveTo(e0x, e0y);
            ctx.lineTo(e1x, e1y);
            if (n === 4) {
              ctx.moveTo(e2x, e2y);
              ctx.lineTo(e3x, e3y);
            }
          }
        }
      }
      ctx.stroke();
    }

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}
