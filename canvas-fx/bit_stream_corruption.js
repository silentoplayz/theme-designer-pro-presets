/**
 * Title: Bit-Stream Corruption
 * Description: A chaotic storm of digital artifacts and ASCII bits that scramble near the cursor.
 */

const CONFIG = {
    bitCount: 150,
    color: 'rgba(255, 255, 0, 0.4)',
    glitchColor: 'rgba(255, 255, 255, 0.8)',
    chars: ['0', '1', 'X', '_', '|', '§', 'Δ'],
    fontSize: 12,
    noiseForce: 0.5
};

let canvas, ctx, w, h;
let bits = [];
let mouse = { x: -5000, y: -5000 };

self.onmessage = (e) => {
    if (e.data.type === 'init') {
        canvas = e.data.canvas; ctx = canvas.getContext('2d');
        resize(e.data.width, e.data.height);
        render();
    } else if (e.data.type === 'resize') {
        resize(e.data.width, e.data.height);
    } else if (e.data.type === 'mousemove') {
        mouse.x = e.data.x; mouse.y = e.data.y;
    }
};

function resize(width, height) {
    w = width; h = height;
    if (canvas) { canvas.width = w; canvas.height = h; }
    bits = [];
    for (let i = 0; i < CONFIG.bitCount; i++) {
        bits.push({
            x: Math.random() * w, y: Math.random() * h,
            char: CONFIG.chars[Math.floor(Math.random() * CONFIG.chars.length)],
            vx: (Math.random() - 0.5) * 4,
            vy: (Math.random() - 0.5) * 4,
            life: Math.random() * 100
        });
    }
}

function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.font = `${CONFIG.fontSize}px 'JetBrains Mono', monospace`;

    for (let b of bits) {
        let dx = mouse.x - b.x; let dy = mouse.y - b.y;
        let dist = Math.hypot(dx, dy);

        // Glitch Logic: Scramble positions near mouse
        if (dist < 200) {
            b.x += (Math.random() - 0.5) * 15;
            b.y += (Math.random() - 0.5) * 15;
            ctx.fillStyle = CONFIG.glitchColor;
        } else {
            b.x += b.vx; b.y += b.vy;
            ctx.fillStyle = CONFIG.color;
        }

        // Digital drift
        if (Math.random() > 0.98) b.char = CONFIG.chars[Math.floor(Math.random() * CONFIG.chars.length)];

        // Screen Wrap
        if (b.x < 0) b.x = w; if (b.x > w) b.x = 0;
        if (b.y < 0) b.y = h; if (b.y > h) b.y = 0;

        ctx.fillText(b.char, b.x, b.y);
    }
    requestAnimationFrame(render);
}