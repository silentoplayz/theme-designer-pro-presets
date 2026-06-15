/**
 * Title: The Architect
 * Description: Optimized Matrix-style digital rain. Best used with dark themes.
 */

const CONFIG = {
    fontSize: 16,
    fontFamily: 'monospace',
    textColor: '#0f0',           // Classic Matrix Green
    headColor: '#fff',           // Color of the leading character
    fadeAmount: 0.08,            // Alpha for erasing trails to transparency
    dropSpeed: 1,
    chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*()_+'
};

let canvas, ctx, width, height;
let columns = 0;
let drops =[];

self.onmessage = (e) => {
    switch (e.data.type) {
        case 'init':
            canvas = e.data.canvas;
            ctx = canvas.getContext('2d');
            resize(e.data.width, e.data.height);
            startAnimation();
            break;
        case 'resize': resize(e.data.width, e.data.height); break;
    }
};

function resize(w, h) {
    width = w; height = h;
    if (canvas) { canvas.width = width; canvas.height = height; }
    
    // Recalculate columns based on new width
    columns = Math.floor(width / CONFIG.fontSize);
    drops =[];
    for (let i = 0; i < columns; i++) {
        // Start them offscreen randomly to prevent uniform falling
        drops[i] = Math.random() * -100; 
    }
}

function startAnimation() {
    function render() {
        if (!ctx) return;

        // Use destination-out to erase previous frames into transparency for the trail effect
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = `rgba(0, 0, 0, ${CONFIG.fadeAmount})`;
        ctx.fillRect(0, 0, width, height);

        // Switch back to normal drawing for the text
        ctx.globalCompositeOperation = 'source-over';
        ctx.font = `${CONFIG.fontSize}px ${CONFIG.fontFamily}`;

        for (let i = 0; i < drops.length; i++) {
            const text = CONFIG.chars.charAt(Math.floor(Math.random() * CONFIG.chars.length));
            const x = i * CONFIG.fontSize;
            const y = drops[i] * CONFIG.fontSize;

            // Draw the "tail" text
            ctx.fillStyle = CONFIG.textColor;
            ctx.fillText(text, x, y);

            // Send the drop back to the top randomly after it crosses the bottom
            if (y > height && Math.random() > 0.975) {
                drops[i] = 0;
            }

            drops[i] += CONFIG.dropSpeed;
        }
        
        // Slightly slow down the rain loop to make it readable
        setTimeout(() => requestAnimationFrame(render), 30);
    }
    requestAnimationFrame(render);
}