/**
 * Title: Tactical Liquid Grid
 * Description: An interactive grid of crosshairs that behaves like an elastic fabric.
 */

let canvas, ctx, width, height;
let points =[];
let mouse = { x: -5000, y: -5000 };

const CONFIG = { spacing: 40, friction: 0.85, ease: 0.1, mouseDist: 150, mouseForce: 50, color: 'rgba(255, 255, 255, 0.15)', activeColor: '#00ffff' };

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

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
    initGrid();
}

class Point {
    constructor(x, y) { this.originX = x; this.originY = y; this.x = x; this.y = y; this.vx = 0; this.vy = 0; }
    update() {
        const dx = mouse.x - this.x, dy = mouse.y - this.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < CONFIG.mouseDist) {
            const angle = Math.atan2(dy, dx);
            const force = (CONFIG.mouseDist - dist) / CONFIG.mouseDist;
            this.vx -= Math.cos(angle) * force * CONFIG.mouseForce;
            this.vy -= Math.sin(angle) * force * CONFIG.mouseForce;
        }
        this.vx += (this.originX - this.x) * CONFIG.ease;
        this.vy += (this.originY - this.y) * CONFIG.ease;
        this.vx *= CONFIG.friction; this.vy *= CONFIG.friction;
        this.x += this.vx; this.y += this.vy;
    }
    draw() {
        const speed = Math.abs(this.vx) + Math.abs(this.vy);
        ctx.strokeStyle = speed > 0.5 ? CONFIG.activeColor : CONFIG.color;
        ctx.lineWidth = speed > 0.5 ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(this.x - 3, this.y); ctx.lineTo(this.x + 3, this.y);
        ctx.moveTo(this.x, this.y - 3); ctx.lineTo(this.x, this.y + 3);
        ctx.stroke();
    }
}

function initGrid() {
    points =[];
    for (let x = 0; x <= width + CONFIG.spacing; x += CONFIG.spacing) {
        for (let y = 0; y <= height + CONFIG.spacing; y += CONFIG.spacing) {
            points.push(new Point(x, y));
        }
    }
}

function startAnimation() {
    function render() {
        if (!ctx) return;
        ctx.clearRect(0, 0, width, height);
        for (let i = 0; i < points.length; i++) { points[i].update(); points[i].draw(); }
        requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
}