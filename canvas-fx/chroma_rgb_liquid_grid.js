/**
 * Title: Chroma RGB Liquid Grid – Cyber-Neon Edition
 * Description: Elastic neon lattice that breathes, ripples and explodes into RGB when touched.
 */

let canvas, ctx, width, height;
let points = [];
let mouse = { x: -5000, y: -5000 };
let tick = 0;
let rgbPhase = 0;                // 0-360° hue rotator
let lastMouse = { x: 0, y: 0 };  // for velocity tracking

const CONFIG = {
    // VISUALS
    gridSpacing: 40,
    crossSize: 3,
    colorIdle: 'rgba(255,255,255,0.15)',
    mouseSize: 140,
    mouseForce: 0.7,
    tension: 0.16,
    friction: 0.86,
    breatheSpeed: 0.025,
    breatheDepth: 3,

    // RGB PARTY
    rgbSpeed: 4,               // hue rotation per frame
    rgbRadius: 180,          // how far the RGB wave travels
    rgbIntensity: 0.8,       // 0-1 saturation of RGB
    trailDecay: 0.92        // mouse-trail fade
};

setInterval(() => self.postMessage({ type: 'heartbeat' }), 1000);

self.onmessage = (e) => {
    switch (e.data.type) {
        case 'init':
            canvas = e.data.canvas;
            ctx = canvas.getContext('2d');
            resize(e.data.width, e.data.height);
            startLoop();
            break;
        case 'resize':
            resize(e.data.width, e.data.height);
            break;
        case 'mousemove':
            lastMouse.x = mouse.x;
            lastMouse.y = mouse.y;
            mouse.x = e.data.x;
            mouse.y = e.data.y;
            break;
    }
};

function resize(w, h) {
    width = w;
    height = h;
    if (canvas) {
        canvas.width = width;
        canvas.height = height;
    }
    initGrid();
}

class Point {
    constructor(x, y) {
        this.ox = x;
        this.oy = y;
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.glow = 0;       // 0-1 RGB glow
    }

    update() {
        // --- forces ---
        let dx = mouse.x - this.x;
        let dy = mouse.y - this.y;
        let dist = Math.hypot(dx, dy);

        // repulsion
        if (dist < CONFIG.mouseSize) {
            let ang = Math.atan2(dy, dx);
            let f = (CONFIG.mouseSize - dist) / CONFIG.mouseSize;
            let push = -f * CONFIG.mouseForce * 25;
            this.vx += Math.cos(ang) * push;
            this.vy += Math.sin(ang) * push;
        }

        // spring back
        let breathe = Math.sin(this.ox * 0.05 + tick) * CONFIG.breatheDepth;
        let dxSpring = this.ox - this.x;
        let dySpring = this.oy - this.y + breathe;
        this.vx += dxSpring * CONFIG.tension;
        this.vy += dySpring * CONFIG.tension;

        // friction
        this.vx *= CONFIG.friction;
        this.vy *= CONFIG.friction;
        this.x += this.vx;
        this.y += this.vy;

        // --- RGB glow ---
        let speed = Math.hypot(this.vx, this.vy);
        let disp = Math.hypot(this.x - this.ox, this.y - this.oy);
        let mouseVel = Math.hypot(mouse.x - lastMouse.x, mouse.y - lastMouse.y);
        let hotRadius = CONFIG.mouseSize + mouseVel * 2;
        let hot = Math.max(0, 1 - dist / hotRadius);
        this.glow = Math.min(1, hot + (speed > 0.3 || disp > 6 ? 0.7 : 0));
        this.glow *= CONFIG.rgbIntensity;
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);

        // --- color logic ---
        let hue = (rgbPhase + (this.x + this.y) * 0.3) % 360;
        let rgb = `hsl(${hue},100%,${50 + this.glow * 40}%)`;
        let base = this.glow > 0.05 ? rgb : CONFIG.colorIdle;

        // --- crosshair ---
        ctx.strokeStyle = base;
        ctx.lineWidth = 1 + this.glow * 2;
        ctx.beginPath();
        let s = CONFIG.crossSize + this.glow * 3;
        ctx.moveTo(-s, 0); ctx.lineTo(s, 0);
        ctx.moveTo(0, -s); ctx.lineTo(0, s);
        ctx.stroke();

        // --- additive glow ---
        if (this.glow) {
            ctx.strokeStyle = `hsl(${hue},100%,70%)`;
            ctx.lineWidth = 1;
            ctx.globalAlpha = this.glow * 0.6;
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
        ctx.restore();
    }
}

function initGrid() {
    points = [];
    for (let x = 0; x < width + CONFIG.gridSpacing; x += CONFIG.gridSpacing)
        for (let y = 0; y < height + CONFIG.gridSpacing; y += CONFIG.gridSpacing)
            points.push(new Point(x, y));
}

function startLoop() {
    function render() {
        if (!ctx) return;
        ctx.clearRect(0, 0, width, height);

        tick += CONFIG.breatheSpeed;
        rgbPhase = (rgbPhase + CONFIG.rgbSpeed) % 360;

        for (let p of points) {
            p.update();
            p.draw();
        }
        requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
}