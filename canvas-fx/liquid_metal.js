// =========================================================================
// Configurable Parameters
// =========================================================================
const CFG = {
  // Visuals
  GRADIENT_TOP: '#fff',           // top of fill gradient
  GRADIENT_MID: '#888',           // mid-point of fill gradient
  GRADIENT_BOTTOM: '#000',        // bottom of fill gradient
  POINT_COUNT: 24,                // number of points (np)
  POINT_MIN_R: 20,                // min random radius (unused in logic, kept for compatibility)
  POINT_MAX_R: 60,                // max random radius (unused in logic, kept for compatibility)
  SMOOTHING: 0.08,                 // lerp factor for point movement
  WAVE_AMPLITUDE: 20,              // sin wave height offset
  WAVE_FREQ: 0.5,                  // sin wave frequency per point
  TIME_SPEED: 0.01,                // delta-t per frame
};

// =========================================================================
// Worker
// =========================================================================
let c, ctx, w, h, t = 0, rid = 0, pts = [];

function rand(a, b) { return a + (b - a) * Math.random(); }

onmessage = e => {
  if (e.data.type === 'init') {
    c = e.data.canvas;
    ctx = c.getContext('2d');
    w = c.width = e.data.width;
    h = c.height = e.data.height;
    for (let i = 0; i < CFG.POINT_COUNT; i++) {
      pts.push({ x: rand(0, w), y: rand(0, h), r: rand(CFG.POINT_MIN_R, CFG.POINT_MAX_R) });
    }
    draw();
  }
  if (e.data.type === 'resize') {
    w = c.width = e.data.width;
    h = c.height = e.data.height;
  }
  if (e.data.type === 'mousemove') {
    pts[0].x = e.data.x;
    pts[0].y = e.data.y;
  }
};

function draw() {
  rid = requestAnimationFrame(draw);
  t += CFG.TIME_SPEED;

  // Clear the canvas to transparency instead of filling with a solid color
  ctx.clearRect(0, 0, w, h);

  // Smooth follow
  for (let i = 1; i < CFG.POINT_COUNT; i++) {
    let p = pts[i], prev = pts[i - 1];
    p.x += (prev.x - p.x) * CFG.SMOOTHING;
    p.y += (prev.y - p.y) * CFG.SMOOTHING;
  }

  // Draw filled wave
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let i = 0; i < CFG.POINT_COUNT; i++) {
    let p = pts[i], y = p.y + Math.sin(t + i * CFG.WAVE_FREQ) * CFG.WAVE_AMPLITUDE;
    ctx.lineTo(p.x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();

  let g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, CFG.GRADIENT_TOP);
  g.addColorStop(0.5, CFG.GRADIENT_MID);
  g.addColorStop(1, CFG.GRADIENT_BOTTOM);
  ctx.fillStyle = g;
  ctx.fill();
}

// Heartbeat — prevents host from terminating idle workers
setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);
