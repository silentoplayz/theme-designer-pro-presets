/**
 * Title: Aetheric Flow
 * Description: 2,000+ energy filaments in a dynamic noise field.
 */
const CONFIG = { particleCount: 2200, noiseScale: 0.003, fieldStrength: 0.12, baseSpeed: 1.2, fadeAmount: 0.06, hueRange: [180, 260], mouseInfluence: 150 };
let canvas, ctx, width, height, particles = [], mouse = { x: -1000, y: -1000 }, zOff = 0;

self.onmessage = (e) => {
    if (e.data.type === 'init') {
        canvas = e.data.canvas; ctx = canvas.getContext('2d');
        width = canvas.width = e.data.width; height = canvas.height = e.data.height;
        for (let i = 0; i < CONFIG.particleCount; i++) particles.push({ x: Math.random() * width, y: Math.random() * height, prevX: 0, prevY: 0, speed: Math.random() * CONFIG.baseSpeed + 0.5, hue: Math.random() * (CONFIG.hueRange[1] - CONFIG.hueRange[0]) + CONFIG.hueRange[0] });
        render();
    } else if (e.data.type === 'mousemove') { mouse.x = e.data.x; mouse.y = e.data.y; }
};

function render() {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0, 0, 0, ${CONFIG.fadeAmount})`;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    zOff += 0.005;
    particles.forEach(p => {
        p.prevX = p.x; p.prevY = p.y;
        let angle = (Math.sin(p.x * CONFIG.noiseScale) + Math.cos(p.y * CONFIG.noiseScale + zOff)) * Math.PI * 2;
        let dx = mouse.x - p.x, dy = mouse.y - p.y, dist = Math.hypot(dx, dy);
        if (dist < CONFIG.mouseInfluence) angle -= (1 - dist / CONFIG.mouseInfluence) * 2;
        p.x += Math.cos(angle) * p.speed; p.y += Math.sin(angle) * p.speed;
        if (p.x < 0 || p.x > width || p.y < 0 || p.y > height) { p.x = p.prevX = Math.random() * width; p.y = p.prevY = Math.random() * height; }
        ctx.beginPath(); ctx.strokeStyle = `hsla(${p.hue}, 80%, 60%, 0.5)`; ctx.moveTo(p.prevX, p.prevY); ctx.lineTo(p.x, p.y); ctx.stroke();
    });
    requestAnimationFrame(render);
}