/**
 * Title: Cell Division
 * Description: Mitosis-like cells that grow, develop a cleavage furrow, and divide
 *   into daughter cells. Features nucleus, membrane, cytoplasm, collision detection,
 *   and mouse repulsion.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Cell Population --
  initialCells: 4,                        // Starting number of cells
  maxCells: 40,                           // Maximum cells before oldest die off
  divisionTime: 400,                      // Frames until a cell divides

  // -- Cell Appearance --
  cellMinRadius: 18,                      // Minimum cell radius in px
  cellMaxRadius: 35,                      // Maximum cell radius (at division time)
  membraneColor: 'rgba(100, 200, 180, 0.4)',  // Cell membrane stroke color
  membraneWidth: 2,                       // Membrane stroke width in px
  nucleusColor: 'rgba(80, 160, 220, 0.5)',    // Nucleus fill color
  nucleusSizeRatio: 0.3,                  // Nucleus radius as fraction of cell radius (0-1)
  cytoplasmColor: 'rgba(120, 220, 200, 0.08)', // Inner cell fill color

  // -- Animation --
  divisionSpeed: 1.0,                     // Division animation speed multiplier (0-3)
  jiggleAmount: 0.5,                      // Random cell movement jitter in px

  // -- Mouse Interaction --
  mouseRepelRadius: 150,                  // Mouse repulsion radius in px
  mouseRepelForce: 5,                     // Mouse repulsion strength (0-15)
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let cells = [];

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

class Cell {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 0.5;
    this.vy = (Math.random() - 0.5) * 0.5;
    this.age = 0;
    this.dividing = false;
    this.divideProgress = 0;
    this.divideAngle = Math.random() * Math.PI;
    this.wobble = Math.random() * Math.PI * 2;
  }

  get radius() {
    const growth = Math.min(1, this.age / (CONFIG.divisionTime * 0.7));
    return CONFIG.cellMinRadius + (CONFIG.cellMaxRadius - CONFIG.cellMinRadius) * growth;
  }

  update() {
    this.age += CONFIG.divisionSpeed;
    this.wobble += 0.02;

    // Start dividing
    if (!this.dividing && this.age >= CONFIG.divisionTime * 0.8) {
      this.dividing = true;
    }

    if (this.dividing) {
      this.divideProgress = Math.min(1, this.divideProgress + 0.008 * CONFIG.divisionSpeed);
    }

    // Jiggle
    this.vx += (Math.random() - 0.5) * CONFIG.jiggleAmount * 0.1;
    this.vy += (Math.random() - 0.5) * CONFIG.jiggleAmount * 0.1;

    // Mouse repulsion
    const dx = this.x - mouse.x;
    const dy = this.y - mouse.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < CONFIG.mouseRepelRadius && dist > 0) {
      const force = (1 - dist / CONFIG.mouseRepelRadius) * CONFIG.mouseRepelForce * 0.1;
      this.vx += (dx / dist) * force;
      this.vy += (dy / dist) * force;
    }

    // Damping
    this.vx *= 0.95;
    this.vy *= 0.95;
    this.x += this.vx;
    this.y += this.vy;

    // Boundary
    const r = this.radius;
    if (this.x < r) { this.x = r; this.vx *= -0.5; }
    if (this.x > width - r) { this.x = width - r; this.vx *= -0.5; }
    if (this.y < r) { this.y = r; this.vy *= -0.5; }
    if (this.y > height - r) { this.y = height - r; this.vy *= -0.5; }
  }

  draw() {
    const r = this.radius;
    const wobX = Math.sin(this.wobble) * 1.5;
    const wobY = Math.cos(this.wobble * 1.3) * 1.5;

    if (this.dividing && this.divideProgress > 0) {
      // Draw two separating daughter cells
      const sep = this.divideProgress * r * 1.2;
      const cos = Math.cos(this.divideAngle);
      const sin = Math.sin(this.divideAngle);
      const r1 = r * (0.6 + 0.4 * this.divideProgress);
      const r2 = r * (0.6 + 0.4 * this.divideProgress);

      for (let side = -1; side <= 1; side += 2) {
        const cx = this.x + cos * sep * side * 0.5 + wobX;
        const cy = this.y + sin * sep * side * 0.5 + wobY;
        const cr = side === -1 ? r1 : r2;

        // Cytoplasm
        ctx.beginPath();
        ctx.arc(cx, cy, cr * 0.95, 0, Math.PI * 2);
        ctx.fillStyle = CONFIG.cytoplasmColor;
        ctx.fill();

        // Membrane
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, Math.PI * 2);
        ctx.strokeStyle = CONFIG.membraneColor;
        ctx.lineWidth = CONFIG.membraneWidth;
        ctx.stroke();

        // Nucleus
        ctx.beginPath();
        ctx.arc(cx, cy, cr * CONFIG.nucleusSizeRatio, 0, Math.PI * 2);
        ctx.fillStyle = CONFIG.nucleusColor;
        ctx.fill();
      }

      // Cleavage furrow line
      if (this.divideProgress < 0.8) {
        const furrLen = r * (1 - this.divideProgress) * 0.8;
        ctx.beginPath();
        ctx.moveTo(this.x - sin * furrLen, this.y + cos * furrLen);
        ctx.lineTo(this.x + sin * furrLen, this.y - cos * furrLen);
        ctx.strokeStyle = CONFIG.membraneColor;
        ctx.lineWidth = CONFIG.membraneWidth * 0.5;
        ctx.stroke();
      }
    } else {
      // Normal cell
      const cx = this.x + wobX;
      const cy = this.y + wobY;

      // Cytoplasm
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.95, 0, Math.PI * 2);
      ctx.fillStyle = CONFIG.cytoplasmColor;
      ctx.fill();

      // Membrane
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = CONFIG.membraneColor;
      ctx.lineWidth = CONFIG.membraneWidth;
      ctx.stroke();

      // Nucleus
      ctx.beginPath();
      ctx.arc(cx, cy, r * CONFIG.nucleusSizeRatio, 0, Math.PI * 2);
      ctx.fillStyle = CONFIG.nucleusColor;
      ctx.fill();
    }
  }

  shouldDivide() {
    return this.dividing && this.divideProgress >= 1;
  }

  createDaughters() {
    const sep = this.radius * 0.7;
    const cos = Math.cos(this.divideAngle);
    const sin = Math.sin(this.divideAngle);
    const d1 = new Cell(this.x + cos * sep, this.y + sin * sep);
    const d2 = new Cell(this.x - cos * sep, this.y - sin * sep);
    d1.vx = cos * 0.5;
    d1.vy = sin * 0.5;
    d2.vx = -cos * 0.5;
    d2.vy = -sin * 0.5;
    return [d1, d2];
  }
}

function collide(cells) {
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i], b = cells[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDist = a.radius + b.radius;
      if (dist < minDist && dist > 0) {
        const overlap = (minDist - dist) * 0.5;
        const nx = dx / dist;
        const ny = dy / dist;
        a.x -= nx * overlap * 0.5;
        a.y -= ny * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.y += ny * overlap * 0.5;
        a.vx -= nx * 0.2;
        a.vy -= ny * 0.2;
        b.vx += nx * 0.2;
        b.vy += ny * 0.2;
      }
    }
  }
}

function initCells() {
  cells = [];
  for (let i = 0; i < CONFIG.initialCells; i++) {
    cells.push(new Cell(
      Math.random() * (width - 100) + 50,
      Math.random() * (height - 100) + 50,
    ));
  }
}

function startAnimation() {
  function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    // Update and collect new divisions
    const newCells = [];
    const toRemove = [];
    for (let i = 0; i < cells.length; i++) {
      cells[i].update();
      if (cells[i].shouldDivide()) {
        if (cells.length + newCells.length < CONFIG.maxCells) {
          newCells.push(...cells[i].createDaughters());
        }
        toRemove.push(i);
      }
    }

    // Remove divided cells
    for (let i = toRemove.length - 1; i >= 0; i--) {
      cells.splice(toRemove[i], 1);
    }
    cells.push(...newCells);

    // Trim excess
    while (cells.length > CONFIG.maxCells) {
      cells.shift();
    }

    collide(cells);

    // Draw
    for (const cell of cells) {
      cell.draw();
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
      initCells();
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
