/**
 * Title: The Architect (Transparency Optimized)
 * Description: Matrix-style digital rain.
 */
const CONFIG = { fontSize: 16, fontFamily: 'monospace', textColor: '#0f0', fadeAmount: 0.08, dropSpeed: 1, chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*()_+' };
let canvas, ctx, width, height, columns, drops = [];

self.onmessage = (e) => {
    if (e.data.type === 'init') {
        canvas = e.data.canvas; ctx = canvas.getContext('2d');
        resize(e.data.width, e.data.height);
        startAnimation();
    } else if (e.data.type === 'resize') resize(e.data.width, e.data.height);
};

function resize(w, h) {
    width = w; height = h; canvas.width = w; canvas.height = h;
    columns = Math.floor(width / CONFIG.fontSize);
    drops = Array(columns).fill(-100);
}

function startAnimation() {
    function render() {
        if (!ctx) return;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = `rgba(0, 0, 0, ${CONFIG.fadeAmount})`;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
        ctx.font = `${CONFIG.fontSize}px ${CONFIG.fontFamily}`;
        for (let i = 0; i < drops.length; i++) {
            ctx.fillStyle = CONFIG.textColor;
            ctx.fillText(CONFIG.chars.charAt(Math.floor(Math.random() * CONFIG.chars.length)), i * CONFIG.fontSize, drops[i] * CONFIG.fontSize);
            if (drops[i] * CONFIG.fontSize > height && Math.random() > 0.975) drops[i] = 0;
            drops[i] += CONFIG.dropSpeed;
        }
        requestAnimationFrame(render);
    }
    render();
}