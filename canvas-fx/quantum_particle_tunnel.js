/**
 * Title: Quantum Particle Tunnel
 * Description: A mesmerizing particle system that simulates quantum tunneling with probabilistic paths, 
 *              featuring real-time mouse interaction, particle trails, and dynamic color shifts
 */

let canvas, ctx, width, height;
let mouse = { x: -1000, y: -1000 };
let particles = [];
let time = 0;

// Quantum tunneling probability matrix
const tunnelMatrix = [
    [0.1, 0.3, 0.6],
    [0.2, 0.5, 0.3],
    [0.4, 0.1, 0.5]
];

class Particle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 2;
        this.vy = (Math.random() - 0.5) * 2;
        this.size = Math.random() * 3 + 1;
        this.color = `hsl(${Math.random() * 360}, 100%, 60%)`;
        this.life = 100;
        this.tunnelProbability = Math.random();
        this.quantumState = Math.floor(Math.random() * 3);
    }

    update() {
        // Quantum tunneling effect
        if (Math.random() < 0.02 * this.tunnelProbability) {
            this.x = Math.random() * width;
            this.y = Math.random() * height;
        }

        // Mouse interaction with quantum probability
        const dx = mouse.x - this.x;
        const dy = mouse.y - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < 100) {
            const force = (100 - distance) / 100;
            this.vx += dx * force * 0.01;
            this.vy += dy * force * 0.01;
        }

        // Apply velocity
        this.x += this.vx;
        this.y += this.vy;

        // Boundary check with quantum tunneling
        if (this.x < 0) this.x = width;
        if (this.x > width) this.x = 0;
        if (this.y < 0) this.y = height;
        if (this.y > height) this.y = 0;

        // Dampening
        this.vx *= 0.98;
        this.vy *= 0.98;

        // Life cycle
        this.life--;
    }

    draw() {
        ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        
        // Quantum glow effect
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size * 2, 0, Math.PI * 2);
        ctx.fillStyle = this.color.replace('60%', '80%').replace('100%', '40%');
        ctx.globalAlpha = 0.3;
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

self.onmessage = (e) => {
    switch (e.data.type) {
        case 'init':
            canvas = e.data.canvas;
            ctx = canvas.getContext('2d');
            resize(e.data.width, e.data.height);
            render();
            break;
        case 'resize':
            resize(e.data.width, e.data.height);
            break;
        case 'mousemove':
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
    
    // Reset particles on resize
    particles = [];
    for (let i = 0; i < 150; i++) {
        particles.push(new Particle(
            Math.random() * width,
            Math.random() * height
        ));
    }
}

function render() {
    if (!ctx) return;

    // Quantum background with transparency
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';

    // Quantum field visualization
    time += 0.01;
    const fieldSize = 50;
    for (let x = 0; x < width; x += fieldSize) {
        for (let y = 0; y < height; y += fieldSize) {
            const value = Math.sin(x * 0.01 + time) * Math.cos(y * 0.01 + time);
            const alpha = Math.abs(value) * 0.1;
            
            ctx.globalAlpha = alpha;
            ctx.fillStyle = `hsl(${(time * 20 + x + y) % 360}, 100%, 50%)`;
            ctx.fillRect(x, y, fieldSize, fieldSize);
        }
    }
    ctx.globalAlpha = 1;

    // Update and draw particles
    for (let i = 0; i < particles.length; i++) {
        particles[i].update();
        particles[i].draw();
        
        // Remove dead particles
        if (particles[i].life <= 0) {
            particles[i] = new Particle(
                Math.random() * width,
                Math.random() * height
            );
        }
    }

    requestAnimationFrame(render);
}