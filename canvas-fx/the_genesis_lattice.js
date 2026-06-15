/**
 * Title: The Genesis Lattice
 * Description: An emergent cellular automaton rendered as a breathing, 3D interconnected fabric.
 */

const CONFIG = {
    cellSize: 22,               // Scale of the grid
    tickRate: 6,                // How many frames between logic updates (lower = faster evolution)
    lerpSpeed: 0.12,            // How smoothly cells fade in and out
    aliveColor:[0, 255, 180],  // RGB: Cyan/Mint
    deadColor: [70, 0, 150],    // RGB: Deep Indigo/Purple
    waveAmplitude: 15,          // Height of the 3D breathing effect
    waveSpeed: 0.02,            // Speed of the breathing
    density: 0.15               // Initial random life density
};

let canvas, ctx, width, height;
let cols, rows, totalCells;
let grid = [];
let nextGrid = [];
let visuals = [];
let drawPoints =[];

let time = 0;
let targetMouse = { x: -1000, y: -1000, active: false };
let currentMouse = { x: 0, y: 0 };
let ticks = 0;

self.onmessage = (e) => {
    switch (e.data.type) {
        case 'init':
            canvas = e.data.canvas;
            ctx = canvas.getContext('2d');
            resize(e.data.width, e.data.height);
            // Default center mouse
            targetMouse.x = width / 2; targetMouse.y = height / 2;
            currentMouse.x = width / 2; currentMouse.y = height / 2;
            startAnimation();
            break;
        case 'resize': resize(e.data.width, e.data.height); break;
        case 'mousemove': 
            targetMouse.x = e.data.x; targetMouse.y = e.data.y; 
            targetMouse.active = true;
            break;
    }
};

function resize(w, h) {
    width = w; height = h;
    if (canvas) { canvas.width = width; canvas.height = height; }
    
    // Add extra columns/rows to bleed off the edges of the screen
    cols = Math.floor(width / CONFIG.cellSize) + 4;
    rows = Math.floor(height / CONFIG.cellSize) + 4;
    totalCells = cols * rows;
    
    initGrid();
}

function initGrid() {
    grid = new Uint8Array(totalCells);
    nextGrid = new Uint8Array(totalCells);
    visuals = new Float32Array(totalCells);
    drawPoints = new Array(totalCells);

    // Seed initial random life
    for (let i = 0; i < totalCells; i++) {
        let isAlive = Math.random() < CONFIG.density ? 1 : 0;
        grid[i] = isAlive;
        visuals[i] = isAlive; // Start visuals matched so it doesn't all fade in at once
    }
}

function seedBurst(centerX, centerY, radius, probability) {
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            if (Math.random() < probability) {
                let nx = (centerX + dx + cols) % cols;
                let ny = (centerY + dy + rows) % rows;
                grid[ny * cols + nx] = 1;
            }
        }
    }
}

function updateLogic() {
    let population = 0;

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            let idx = y * cols + x;
            let alive = grid[idx];
            let neighbors = 0;

            // Count 8 surrounding neighbors with screen wrapping
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    let nx = (x + dx + cols) % cols;
                    let ny = (y + dy + rows) % rows;
                    neighbors += grid[ny * cols + nx];
                }
            }

            // Conway's Rules: Birth on 3, Survive on 2 or 3
            if (alive && (neighbors === 2 || neighbors === 3)) {
                nextGrid[idx] = 1;
                population++;
            } else if (!alive && neighbors === 3) {
                nextGrid[idx] = 1;
                population++;
            } else {
                nextGrid[idx] = 0;
            }
        }
    }

    // Swap buffers efficiently
    let temp = grid;
    grid = nextGrid;
    nextGrid = temp;

    // Failsafe: If the ecosystem dies out, seed a new colony
    if (population < totalCells * 0.02) {
        seedBurst(Math.floor(Math.random() * cols), Math.floor(Math.random() * rows), 6, 0.4);
    }
}

function startAnimation() {
    function render() {
        if (!ctx) return;
        ctx.clearRect(0, 0, width, height); // Native transparency safe

        time += CONFIG.waveSpeed;
        ticks++;

        // Smooth mouse for parallax
        if (targetMouse.active) {
            currentMouse.x += (targetMouse.x - currentMouse.x) * 0.08;
            currentMouse.y += (targetMouse.y - currentMouse.y) * 0.08;
        }

        // 1. UPDATE LOGIC ENGINE
        if (ticks % CONFIG.tickRate === 0) {
            updateLogic();
        }

        // Interactive Mouse Seeding
        if (targetMouse.active) {
            let offsetX = (width - cols * CONFIG.cellSize) / 2;
            let offsetY = (height - rows * CONFIG.cellSize) / 2;
            let gridX = Math.floor((targetMouse.x - offsetX) / CONFIG.cellSize);
            let gridY = Math.floor((targetMouse.y - offsetY) / CONFIG.cellSize);
            
            if (gridX >= 0 && gridX < cols && gridY >= 0 && gridY < rows) {
                if (Math.random() > 0.5) grid[gridY * cols + gridX] = 1; // Inject life
            }
        }

        let cx = width / 2;
        let cy = height / 2;

        // 2. PRE-COMPUTE 3D DISPLACEMENT POINTS & SMOOTH VISUALS
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                let idx = y * cols + x;
                
                // Lerp the visual scale towards the actual logic state
                visuals[idx] += (grid[idx] - visuals[idx]) * CONFIG.lerpSpeed;
                
                // Base 2D position (Centered)
                let px = x * CONFIG.cellSize + (width - cols * CONFIG.cellSize) / 2;
                let py = y * CONFIG.cellSize + (height - rows * CONFIG.cellSize) / 2;

                // 3D Radial Sine Wave Displacement
                let dist = Math.sqrt(Math.pow(px - cx, 2) + Math.pow(py - cy, 2));
                let waveZ = Math.sin(dist * 0.008 - time) * CONFIG.waveAmplitude;

                // Mouse Parallax Perspective Shift
                let pXOffset = (currentMouse.x - cx) * 0.08 * ((y - rows/2) / rows);
                let pYOffset = (currentMouse.y - cy) * 0.08 * ((x - cols/2) / cols);

                drawPoints[idx] = { 
                    x: px + pXOffset, 
                    y: py + waveZ + pYOffset,
                    v: visuals[idx] 
                };
            }
        }

        ctx.lineWidth = 1.2;

        // 3. DRAW STRUCTURAL BONDS (Underneath)
        for (let y = 0; y < rows - 1; y++) {
            for (let x = 0; x < cols - 1; x++) {
                let idx = y * cols + x;
                let p1 = drawPoints[idx];

                if (p1.v > 0.05) {
                    let rIdx = y * cols + (x + 1);       // Right neighbor
                    let bIdx = (y + 1) * cols + x;       // Bottom neighbor
                    let drIdx = (y + 1) * cols + (x + 1); // Bottom-Right Diagonal neighbor
                    
                    let pR = drawPoints[rIdx];
                    let pB = drawPoints[bIdx];
                    let pDR = drawPoints[drIdx];

                    ctx.beginPath();
                    let drawn = false;

                    if (pR.v > 0.05) { ctx.moveTo(p1.x, p1.y); ctx.lineTo(pR.x, pR.y); drawn = true; }
                    if (pB.v > 0.05) { ctx.moveTo(p1.x, p1.y); ctx.lineTo(pB.x, pB.y); drawn = true; }
                    // Add diagonal structural bonds for a "webbed" look
                    if (pDR.v > 0.05) { ctx.moveTo(p1.x, p1.y); ctx.lineTo(pDR.x, pDR.y); drawn = true; }

                    if (drawn) {
                        ctx.strokeStyle = `rgba(${CONFIG.aliveColor.join(',')}, ${p1.v * 0.3})`;
                        ctx.stroke();
                    }
                }
            }
        }

        // 4. DRAW LIVING NODES (On top)
        for (let i = 0; i < totalCells; i++) {
            let p = drawPoints[i];
            if (p.v > 0.05) {
                // Color interpolation: Alive = Cyan, Dying = Purple
                let r = Math.floor(CONFIG.deadColor[0] + (CONFIG.aliveColor[0] - CONFIG.deadColor[0]) * p.v);
                let g = Math.floor(CONFIG.deadColor[1] + (CONFIG.aliveColor[1] - CONFIG.deadColor[1]) * p.v);
                let b = Math.floor(CONFIG.deadColor[2] + (CONFIG.aliveColor[2] - CONFIG.deadColor[2]) * p.v);

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.v * (CONFIG.cellSize * 0.35), 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${p.v * 0.9})`;
                ctx.fill();
            }
        }

        requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
}

// Reset mouse tracking if user leaves canvas area
let mouseTimeout;
self.addEventListener('message', (e) => {
    if (e.data.type === 'mousemove') {
        clearTimeout(mouseTimeout);
        mouseTimeout = setTimeout(() => { targetMouse.active = false; }, 2000);
    }
});