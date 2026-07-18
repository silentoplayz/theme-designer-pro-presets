/**
 * Title: Hyperspace Warp Drive
 * Description: A 3D starfield with speed lines. Move the mouse to steer the warp tunnel!
 */

const CONFIG = {
    starCount: 600,
    baseSpeed: 2.5,       // Forward speed
    fov: 300,             // Field of view (stretches the Z axis)
    starColor: '255, 255, 255', // RGB components (must be comma separated for opacity logic)
    tailLength: 1.5       // Multiplier for the speed line trails
};

let canvas, ctx, width, height;
let stars =[];
let mouse = { x: 0, y: 0 };
let centerX, centerY;

self.onmessage = (e) => {
    switch (e.data.type) {
        case 'init':
            canvas = e.data.canvas;
            ctx = canvas.getContext('2d');
            resize(e.data.width, e.data.height);
            mouse = { x: width / 2, y: height / 2 };
            startAnimation();
            break;
        case 'resize': resize(e.data.width, e.data.height); break;
        case 'mousemove': mouse.x = e.data.x; mouse.y = e.data.y; break;
    }
};

function resize(w, h) {
    width = w; height = h;
    centerX = width / 2; centerY = height / 2;
    if (canvas) { canvas.width = width; canvas.height = height; }
    initStars();
}

class Star {
    constructor() {
        this.reset();
        this.z = Math.random() * width; 
    }
    reset() {
        this.x = (Math.random() - 0.5) * width * 2;
        this.y = (Math.random() - 0.5) * height * 2;
        this.z = width; 
        this.pz = this.z;
    }
    update() {
        this.pz = this.z; 
        this.z -= CONFIG.baseSpeed;
        if (this.z < 1) this.reset();
    }
    draw() {
        let targetX = centerX + (mouse.x - centerX) * 0.3;
        let targetY = centerY + (mouse.y - centerY) * 0.3;

        let px = (this.x / this.pz) * CONFIG.fov + targetX;
        let py = (this.y / this.pz) * CONFIG.fov + targetY;
        let nx = (this.x / this.z) * CONFIG.fov + targetX;
        let ny = (this.y / this.z) * CONFIG.fov + targetY;

        let opacity = 1 - (this.z / width);

        ctx.beginPath();
        ctx.moveTo(px, py);
        
        let tailX = nx + (nx - px) * CONFIG.tailLength;
        let tailY = ny + (ny - py) * CONFIG.tailLength;
        ctx.lineTo(tailX, tailY);
        
        // Respecting the starColor from config while applying dynamic opacity
        ctx.strokeStyle = `rgba(${CONFIG.starColor}, ${opacity})`;
        ctx.lineWidth = (1 - (this.z / width)) * 2.5; 
        ctx.stroke();
    }
}

function initStars() {
    stars =[];
    for (let i = 0; i < CONFIG.starCount; i++) {
        stars.push(new Star());
    }
}

function startAnimation() {
    function render() {
        if (!ctx) return;
        
        // ClearRect is the gold standard for transparency. 
        // It ensures the Chat Background Image set in Open WebUI is fully visible.
        ctx.clearRect(0, 0, width, height);
        
        for (let i = 0; i < stars.length; i++) {
            stars[i].update();
            stars[i].draw();
        }
        requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
}

// Heartbeat — prevents host from terminating idle workers
setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);
