/**
 * Title: Fog Drift
 * Description: Layered rolling fog and mist that drifts across the canvas with
 *   organic turbulence. Mouse pushes fog away, creating a parting-mist effect.
 *   Extremely atmospheric.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Fog Layers --
  layerCount: 6,                           // Number of independent fog layers
  fogColor: '180, 190, 210',               // RGB base fog color (no alpha — added dynamically)
  minOpacity: 0.03,                        // Minimum layer opacity (0-1)
  maxOpacity: 0.14,                        // Maximum layer opacity (0-1)

  // -- Layer Geometry --
  layerHeight: 0.45,                       // Layer height as fraction of canvas height (0-1)
  verticalSpread: 0.7,                     // How much layers spread vertically (0-1)
  verticalOffset: 0.3,                     // Base vertical position (0 = top, 1 = bottom)
  density: 5,                              // Number of fog blobs per layer

  // -- Motion --
  driftSpeed: 0.4,                         // Base horizontal drift speed
  driftSpeedVariance: 0.3,                 // ± random speed variation between layers
  turbulence: 0.35,                        // Perlin-like vertical turbulence intensity
  turbulenceSpeed: 0.003,                  // How fast turbulence oscillates
  speed: 1.0,                              // Global speed multiplier

  // -- Appearance --
  blobMinWidth: 0.3,                       // Minimum blob width as fraction of canvas width
  blobMaxWidth: 0.7,                       // Maximum blob width as fraction of canvas width
  blurRadius: 60,                          // Gaussian blur radius for softness in px

  // -- Mouse Interaction --
  mouseClearRadius: 200,                   // Radius where mouse pushes fog away in px
  mouseClearStrength: 0.9,                 // How much fog is cleared at center (0-1)
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let layers = [];
let time = 0;

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
      initLayers();
      startAnimation();
      break;
    case 'resize':
      width = e.data.width;
      height = e.data.height;
      canvas.width = width;
      canvas.height = height;
      initLayers();
      break;
    case 'mousemove':
      mouse.x = e.data.x;
      mouse.y = e.data.y;
      break;
  }
};

function initLayers() {
  layers = [];
  for (let i = 0; i < CONFIG.layerCount; i++) {
    const t = i / Math.max(1, CONFIG.layerCount - 1);
    const opacity = CONFIG.minOpacity + (CONFIG.maxOpacity - CONFIG.minOpacity) * (0.5 + Math.random() * 0.5);
    const baseY = (CONFIG.verticalOffset + t * CONFIG.verticalSpread) * height;
    const layerH = CONFIG.layerHeight * height;
    const driftDir = i % 2 === 0 ? 1 : -1;
    const driftSpd = (CONFIG.driftSpeed + (Math.random() - 0.5) * CONFIG.driftSpeedVariance * 2) * driftDir;

    const blobs = [];
    for (let j = 0; j < CONFIG.density; j++) {
      blobs.push({
        xOffset: Math.random() * width * 2 - width * 0.5,
        yOffset: (Math.random() - 0.5) * layerH * 0.5,
        blobWidth: (CONFIG.blobMinWidth + Math.random() * (CONFIG.blobMaxWidth - CONFIG.blobMinWidth)) * width,
        blobHeight: layerH * (0.5 + Math.random() * 0.5),
        turbPhase: Math.random() * Math.PI * 2,
        turbAmp: CONFIG.turbulence * layerH * (0.3 + Math.random() * 0.7),
      });
    }

    layers.push({
      baseY,
      opacity,
      driftSpeed: driftSpd,
      blobs,
      xScroll: Math.random() * width,
    });
  }
}

function startAnimation() {
  function render() {
    if (!ctx) return;
    time += CONFIG.speed;

    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];

      layer.xScroll += layer.driftSpeed * CONFIG.speed;

      // Wrap scroll
      if (layer.xScroll > width * 2) layer.xScroll -= width * 3;
      if (layer.xScroll < -width) layer.xScroll += width * 3;

      for (const blob of layer.blobs) {
        const turbY = Math.sin(time * CONFIG.turbulenceSpeed + blob.turbPhase) * blob.turbAmp;
        const bx = blob.xOffset + layer.xScroll;
        const by = layer.baseY + blob.yOffset + turbY;

        // Wrap the blob horizontally
        const wrappedX = ((bx % (width + blob.blobWidth)) + width + blob.blobWidth) % (width + blob.blobWidth) - blob.blobWidth * 0.5;

        // Mouse interaction — reduce opacity near mouse
        let alphaMultiplier = 1;
        const dx = wrappedX + blob.blobWidth * 0.5 - mouse.x;
        const dy = by - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CONFIG.mouseClearRadius + blob.blobWidth * 0.3) {
          const clearDist = CONFIG.mouseClearRadius + blob.blobWidth * 0.3;
          const factor = Math.max(0, 1 - dist / clearDist);
          alphaMultiplier = 1 - factor * CONFIG.mouseClearStrength;
        }

        const finalAlpha = layer.opacity * alphaMultiplier;
        if (finalAlpha < 0.002) continue;

        // Draw fog blob as a radial gradient ellipse
        ctx.save();
        ctx.globalAlpha = finalAlpha;
        ctx.filter = `blur(${CONFIG.blurRadius}px)`;

        const grad = ctx.createRadialGradient(
          wrappedX + blob.blobWidth * 0.5, by, 0,
          wrappedX + blob.blobWidth * 0.5, by, blob.blobWidth * 0.5
        );
        grad.addColorStop(0, `rgba(${CONFIG.fogColor}, 1)`);
        grad.addColorStop(0.5, `rgba(${CONFIG.fogColor}, 0.6)`);
        grad.addColorStop(1, `rgba(${CONFIG.fogColor}, 0)`);

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(
          wrappedX + blob.blobWidth * 0.5,
          by,
          blob.blobWidth * 0.5,
          blob.blobHeight * 0.5,
          0, 0, Math.PI * 2
        );
        ctx.fill();
        ctx.restore();
      }
    }

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}
