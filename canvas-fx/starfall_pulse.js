/**
 * Title: Starfall Pulse
 * Description: Interactive floating embers that react to the user.
 */

const CONFIG = {
    particleCount: 120,
    minSize: 1,
    maxSize: 4,
    baseColor: '255, 200, 100', // Embers (Gold)
    riseSpeed: 0.8,
    swayAmount: 1.5,
    reactionRadius: 150
};

let canvas, ctx, width, height;
let particles = [];
let mouse = { x: -1000, y: -1000 };

self.onmessage = (e) => {
    switch (e.data.type) {
        case 'init':
            canvas = e.data.canvas;
            ctx = canvas.getContext('2d');
            resize(e.data.width, e.data.height);
            startAnimation();
            break;
        case 'resize': resize(e.data.width, e.data.height); break;
        case 'mousemove': mouse.x = e.data.x; mouse.y = e.data.y; break;
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
            size: Math.random() * (CONFIG.maxSize - CONFIG.minSize) + CONFIG.minSize,
            speed: Math.random() * CONFIG.riseSpeed + 0.2,
            offset: Math.random() * Math.PI * 2
        });
    }
}

function startAnimation() {
    function render() {
        if (!ctx) return;
        ctx.clearRect(0, 0, width, height);

        particles.forEach(p => {
            // Float up and sway
            p.y -= p.speed;
            p.x += Math.sin(p.y * 0.01 + p.offset) * (CONFIG.swayAmount * 0.5);

            // Interaction
            let dx = mouse.x - p.x;
            let dy = mouse.y - p.y;
            let dist = Math.sqrt(dx * dx + dy * dy);
            let scale = 1;
            let alpha = 0.3;

            if (dist < CONFIG.reactionRadius) {
                let factor = 1 - (dist / CONFIG.reactionRadius);
                scale = 1 + factor * 2;
                alpha = 0.3 + factor * 0.6;
            }

            // Recycle to bottom
            if (p.y < -20) {
                p.y = height + 20;
                p.x = Math.random() * width;
            }

            ctx.fillStyle = `rgba(${CONFIG.baseColor}, ${alpha})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * scale, 0, Math.PI * 2);
            ctx.fill();
            
            // Add a small soft glow to scaled particles
            if (scale > 1.2) {
                ctx.shadowBlur = 10;
                ctx.shadowColor = `rgba(${CONFIG.baseColor}, ${alpha})`;
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        });

        requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
}