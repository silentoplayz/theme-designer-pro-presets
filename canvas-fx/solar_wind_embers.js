/**
 * Title: Solar Wind Embers
 * Description: Floating amber particles that drift upward and react to the sun (mouse).
 */

const CONFIG = {
    particleCount: 80,
    minSize: 1,
    maxSize: 4,
    baseColor: 'rgba(255, 180, 50, 0.2)',
    glowColor: 'rgba(255, 255, 200, 0.5)',
    driftSpeed: 0.4,
    mouseRadius: 200
};

let canvas, ctx, width, height;
let particles = [];
let mouse = { x: -5000, y: -5000 };

setInterval(() => self.postMessage({ type: 'heartbeat' }), 1000);

self.onmessage = (e) => {
    if (e.data.type === 'init') {
        canvas = e.data.canvas;
        ctx = canvas.getContext('2d');
        resize(e.data.width, e.data.height);
        render();
    } else if (e.data.type === 'resize') {
        resize(e.data.width, e.data.height);
    } else if (e.data.type === 'mousemove') {
        mouse.x = e.data.x;
        mouse.y = e.data.y;
    }
};

function resize(w, h) {
    width = w; height = h;
    if (canvas) { canvas.width = width; canvas.height = height; }
    initParticles();
}

function initParticles() {
    particles = [];
    for (let i = 0; i < CONFIG.particleCount; i++) {
        particles.push({
            x: Math.random() * width,
            y: Math.random() * height,
            vx: (Math.random() - 0.5) * 0.5,
            vy: -(Math.random() * CONFIG.driftSpeed + 0.2),
            size: Math.random() * (CONFIG.maxSize - CONFIG.minSize) + CONFIG.minSize,
            angle: Math.random() * Math.PI * 2
        });
    }
}

function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    for (let p of particles) {
        p.y += p.vy;
        p.x += p.vx + Math.sin(p.angle) * 0.2;
        p.angle += 0.01;

        // Screen wrap
        if (p.y < -10) p.y = height + 10;
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;

        // Mouse reaction
        let dx = mouse.x - p.x;
        let dy = mouse.y - p.y;
        let dist = Math.hypot(dx, dy);
        
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        
        if (dist < CONFIG.mouseRadius) {
            ctx.fillStyle = CONFIG.glowColor;
            p.x -= dx * 0.01;
            p.y -= dy * 0.01;
        } else {
            ctx.fillStyle = CONFIG.baseColor;
        }
        
        ctx.fill();
    }

    requestAnimationFrame(render);
}