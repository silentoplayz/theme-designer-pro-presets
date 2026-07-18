/**
 * Title: Blueprint Grid
 * Description: Animated technical blueprint with dimension lines, measurement
 *   annotations, scan line effect, and interactive crosshair targeting.
 *   Mouse creates a crosshair target point with live measurements.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Grid --
  gridSize: 20,                    // Minor grid cell size in px (10-50)
  majorGridInterval: 5,            // Major line every N minor cells (2-10)
  gridColor: 'rgba(30,100,200,0.12)',  // Minor grid line color
  majorGridColor: 'rgba(30,100,200,0.25)', // Major grid line color
  gridOpacity: 1.0,                // Overall grid opacity multiplier (0-1)

  // -- Dimension Lines --
  dimensionLineEnabled: true,      // Show animated dimension lines
  dimensionColor: 'rgba(100,180,255,0.5)', // Dimension line/arrow color
  measurementDensity: 6,           // Number of dimension annotations visible (2-15)

  // -- Annotations --
  annotationEnabled: true,         // Show text annotations
  annotationColor: 'rgba(100,200,255,0.7)', // Annotation text color
  annotationFontSize: 10,          // Font size in px (8-16)

  // -- Scan Line --
  scanLineEnabled: true,           // Enable horizontal scan line sweep
  scanLineSpeed: 1.5,              // Scan line speed (0.5-5.0)
  scanLineColor: 'rgba(0,180,255,0.15)', // Scan line glow color

  // -- Crosshair --
  crosshairEnabled: true,          // Show center crosshair
  crosshairColor: 'rgba(0,200,255,0.4)', // Crosshair line color

  // -- Mouse Interaction --
  // Mouse creates a crosshair target point with coordinate readout
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let time = 0;
let dimensions = [];

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

function initDimensions() {
  dimensions = [];
  for (let i = 0; i < CONFIG.measurementDensity; i++) {
    dimensions.push(createDimension(i));
  }
}

function createDimension(index) {
  const isHoriz = Math.random() > 0.5;
  const gs = CONFIG.gridSize * CONFIG.majorGridInterval;
  const snap = (v) => Math.round(v / gs) * gs;
  if (isHoriz) {
    const y = snap(80 + Math.random() * (height - 160));
    const x1 = snap(40 + Math.random() * (width * 0.3));
    const x2 = snap(x1 + 100 + Math.random() * (width * 0.4));
    return { type: 'h', x1, x2, y, age: Math.random() * 200, lifespan: 300 + Math.random() * 400 };
  } else {
    const x = snap(80 + Math.random() * (width - 160));
    const y1 = snap(40 + Math.random() * (height * 0.3));
    const y2 = snap(y1 + 100 + Math.random() * (height * 0.4));
    return { type: 'v', x, y1, y2, age: Math.random() * 200, lifespan: 300 + Math.random() * 400 };
  }
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
      initDimensions();
      startAnimation();
      break;
    case 'resize':
      width = e.data.width;
      height = e.data.height;
      canvas.width = width;
      canvas.height = height;
      initDimensions();
      break;
    case 'mousemove':
      mouse.x = e.data.x;
      mouse.y = e.data.y;
      break;
  }
};

function startAnimation() {
  let scanY = 0;

  function render() {
    if (!ctx) return;
    time += 1;
    ctx.clearRect(0, 0, width, height);

    const gs = CONFIG.gridSize;
    const major = CONFIG.majorGridInterval;
    const opacity = CONFIG.gridOpacity;

    // ── Minor grid ──
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = CONFIG.gridColor;
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    for (let x = 0; x <= width; x += gs) {
      if ((x / gs) % major === 0) continue;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y <= height; y += gs) {
      if ((y / gs) % major === 0) continue;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    // ── Major grid ──
    ctx.lineWidth = 1;
    ctx.strokeStyle = CONFIG.majorGridColor;
    ctx.beginPath();
    for (let x = 0; x <= width; x += gs * major) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y <= height; y += gs * major) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    // ── Dimension lines ──
    if (CONFIG.dimensionLineEnabled) {
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);

      for (let i = 0; i < dimensions.length; i++) {
        const d = dimensions[i];
        d.age += 1;

        // Fade in/out
        let alpha = 1;
        if (d.age < 30) alpha = d.age / 30;
        else if (d.age > d.lifespan - 30) alpha = (d.lifespan - d.age) / 30;
        if (d.age > d.lifespan) {
          dimensions[i] = createDimension(i);
          continue;
        }
        alpha = Math.max(0, Math.min(1, alpha));

        ctx.strokeStyle = CONFIG.dimensionColor;
        ctx.globalAlpha = alpha;

        if (d.type === 'h') {
          const offset = 8;
          // Horizontal dimension line
          ctx.beginPath();
          ctx.moveTo(d.x1, d.y);
          ctx.lineTo(d.x2, d.y);
          ctx.stroke();
          // Tick marks
          ctx.beginPath();
          ctx.moveTo(d.x1, d.y - offset);
          ctx.lineTo(d.x1, d.y + offset);
          ctx.moveTo(d.x2, d.y - offset);
          ctx.lineTo(d.x2, d.y + offset);
          ctx.stroke();
          // Label
          if (CONFIG.annotationEnabled) {
            const dist = Math.abs(d.x2 - d.x1);
            const label = `${(dist / gs).toFixed(1)} u`;
            ctx.fillStyle = CONFIG.annotationColor;
            ctx.font = `${CONFIG.annotationFontSize}px monospace`;
            ctx.textAlign = 'center';
            ctx.fillText(label, (d.x1 + d.x2) / 2, d.y - 10);
          }
        } else {
          const offset = 8;
          ctx.beginPath();
          ctx.moveTo(d.x, d.y1);
          ctx.lineTo(d.x, d.y2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(d.x - offset, d.y1);
          ctx.lineTo(d.x + offset, d.y1);
          ctx.moveTo(d.x - offset, d.y2);
          ctx.lineTo(d.x + offset, d.y2);
          ctx.stroke();
          if (CONFIG.annotationEnabled) {
            const dist = Math.abs(d.y2 - d.y1);
            const label = `${(dist / gs).toFixed(1)} u`;
            ctx.save();
            ctx.fillStyle = CONFIG.annotationColor;
            ctx.font = `${CONFIG.annotationFontSize}px monospace`;
            ctx.textAlign = 'center';
            ctx.translate(d.x - 12, (d.y1 + d.y2) / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(label, 0, 0);
            ctx.restore();
          }
        }
        ctx.globalAlpha = 1.0;
      }
      ctx.setLineDash([]);
    }

    // ── Coordinate labels along edges ──
    if (CONFIG.annotationEnabled) {
      ctx.fillStyle = CONFIG.annotationColor;
      ctx.font = `${CONFIG.annotationFontSize - 1}px monospace`;
      ctx.globalAlpha = 0.4;
      ctx.textAlign = 'center';
      for (let x = gs * major; x < width; x += gs * major) {
        ctx.fillText(`${(x / gs).toFixed(0)}`, x, 12);
      }
      ctx.textAlign = 'left';
      for (let y = gs * major; y < height; y += gs * major) {
        ctx.fillText(`${(y / gs).toFixed(0)}`, 4, y - 3);
      }
      ctx.globalAlpha = 1.0;
    }

    // ── Scan line ──
    if (CONFIG.scanLineEnabled) {
      scanY = (scanY + CONFIG.scanLineSpeed) % height;
      const grad = ctx.createLinearGradient(0, scanY - 40, 0, scanY + 40);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.5, CONFIG.scanLineColor);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, scanY - 40, width, 80);
    }

    // ── Center crosshair ──
    if (CONFIG.crosshairEnabled) {
      const cx = width / 2, cy = height / 2;
      ctx.strokeStyle = CONFIG.crosshairColor;
      ctx.lineWidth = 0.5;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(cx, 0); ctx.lineTo(cx, height);
      ctx.moveTo(0, cy); ctx.lineTo(width, cy);
      ctx.stroke();
      ctx.setLineDash([]);

      // Small reticle
      const rSize = 12;
      ctx.strokeStyle = CONFIG.crosshairColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, rSize, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ── Mouse target crosshair ──
    if (mouse.x > 0 && mouse.y > 0) {
      const mx = mouse.x, my = mouse.y;

      // Crosshair lines
      ctx.strokeStyle = 'rgba(255,100,100,0.5)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(mx, 0); ctx.lineTo(mx, height);
      ctx.moveTo(0, my); ctx.lineTo(width, my);
      ctx.stroke();
      ctx.setLineDash([]);

      // Target reticle
      ctx.strokeStyle = 'rgba(255,100,100,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(mx, my, 8, 0, Math.PI * 2);
      ctx.stroke();

      // Coordinate readout
      ctx.fillStyle = 'rgba(255,150,150,0.8)';
      ctx.font = `${CONFIG.annotationFontSize}px monospace`;
      ctx.textAlign = 'left';
      const coordLabel = `(${(mx / gs).toFixed(1)}, ${(my / gs).toFixed(1)})`;
      ctx.fillText(coordLabel, mx + 14, my - 10);

      // Distance from center
      const dx = mx - width / 2, dy = my - height / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      ctx.fillStyle = 'rgba(255,150,150,0.5)';
      ctx.fillText(`Δ ${(dist / gs).toFixed(1)}u`, mx + 14, my + 4);
    }

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}
