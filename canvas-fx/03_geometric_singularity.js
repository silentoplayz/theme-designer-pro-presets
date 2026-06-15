/**
 * Title: Geometric Singularity
 * Description: Recursive 3D wireframe lattice warping toward the mouse.
 */
const CONFIG = { gridDensity: 25, warpStrength: 1.8, rotationSpeed: 0.002, lineColor: '0, 255, 150', perspective: 800 };
let canvas, ctx, width, height, time = 0, mouse = { x: 0, y: 0 };

self.onmessage = (e) => {
    if (e.data.type === 'init') { canvas = e.data.canvas; ctx = canvas.getContext('2d'); width = canvas.width = e.data.width; height = canvas.height = e.data.height; mouse = { x: width/2, y: height/2 }; animate(); }
    else if (e.data.type === 'mousemove') { mouse.x = e.data.x; mouse.y = e.data.y; }
};

function project(x, y, z) {
    let scale = CONFIG.perspective / (CONFIG.perspective + z);
    return { x: x * scale + width / 2, y: y * scale + height / 2 };
}

function animate() {
    ctx.clearRect(0, 0, width, height);
    time += CONFIG.rotationSpeed;
    ctx.lineWidth = 0.6; ctx.strokeStyle = `rgba(${CONFIG.lineColor}, 0.3)`;
    const step = width / CONFIG.gridDensity, size = width * 1.5;
    for (let i = -size; i < size; i += step) {
        ctx.beginPath();
        for (let j = -size; j < size; j += step / 2) {
            let dM = Math.hypot(i - (mouse.x - width/2), j - (mouse.y - height/2));
            let z = Math.sin(i*0.002+time)*100 + Math.cos(j*0.002-time)*100 + (CONFIG.warpStrength*20000/(dM+100));
            let p = project(i, j, z);
            if (j === -size) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
    }
    requestAnimationFrame(animate);
}