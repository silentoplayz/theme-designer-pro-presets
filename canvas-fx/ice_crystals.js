/**
 * Title: Ice Crystals
 * Description: Hexagonal crystal growth with 6-fold symmetry, prismatic highlights, and mouse-warmth melting.
 */
const CONFIG = {
	maxCrystals: 8,
	growthSpeed: 0.8,
	branchProb: 0.3,
	branchAngle: Math.PI / 3,
	maxDepth: 4,
	symmetry: 6,
	color: 'rgba(180,220,255,',
	prismIntensity: 0.6,
	meltRadius: 120,
	meltSpeed: 0.02,
	regrowDelay: 90,
	edgeFrost: 40,
	seedInterval: 200
};
let canvas,
	ctx,
	W,
	H,
	mouse = { x: -5e3, y: -5e3 },
	crystals = [],
	time = 0;
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1e3);
self.onmessage = (e) => {
	switch (e.data.type) {
		case 'init':
			canvas = e.data.canvas;
			ctx = canvas.getContext('2d');
			W = e.data.width;
			H = e.data.height;
			canvas.width = W;
			canvas.height = H;
			startAnim();
			break;
		case 'resize':
			W = e.data.width;
			H = e.data.height;
			canvas.width = W;
			canvas.height = H;
			crystals = [];
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};
class Crystal {
	constructor(x, y) {
		this.x = x;
		this.y = y;
		this.segs = [];
		this.queue = [{ x, y, angle: 0, depth: 0, len: 0, maxLen: 20 + Math.random() * 30 }];
		for (let i = 1; i < CONFIG.symmetry; i++)
			this.queue.push({
				x,
				y,
				angle: ((Math.PI * 2) / CONFIG.symmetry) * i,
				depth: 0,
				len: 0,
				maxLen: 20 + Math.random() * 30
			});
		this.melted = 0;
		this.meltTimer = 0;
	}
	grow(dt) {
		if (this.melted > 0) {
			this.meltTimer++;
			if (this.meltTimer > CONFIG.regrowDelay) this.melted = Math.max(0, this.melted - 0.01 * dt);
			return;
		}
		let newQ = [];
		for (let q of this.queue) {
			if (q.len < q.maxLen) {
				q.len += CONFIG.growthSpeed * dt;
				let ex = q.x + Math.cos(q.angle) * q.len,
					ey = q.y + Math.sin(q.angle) * q.len;
				this.segs.push({
					x1: q.x,
					y1: q.y,
					x2: ex,
					y2: ey,
					d: q.depth,
					hue: ((q.angle * 180) / Math.PI + time * 0.5) % 360
				});
				if (q.len >= q.maxLen && q.depth < CONFIG.maxDepth && Math.random() < CONFIG.branchProb) {
					let a1 = q.angle + CONFIG.branchAngle * (0.8 + Math.random() * 0.4),
						a2 = q.angle - CONFIG.branchAngle * (0.8 + Math.random() * 0.4);
					let ml = q.maxLen * 0.65;
					newQ.push({ x: ex, y: ey, angle: a1, depth: q.depth + 1, len: 0, maxLen: ml });
					newQ.push({ x: ex, y: ey, angle: a2, depth: q.depth + 1, len: 0, maxLen: ml });
				} else if (q.len < q.maxLen) {
					newQ.push(q);
				}
			}
		}
		this.queue = newQ;
	}
	draw() {
		let s = 1 - this.melted;
		for (let seg of this.segs) {
			let a = Math.max(0.05, (0.6 - seg.d * 0.1) * s);
			ctx.strokeStyle =
				CONFIG.prismIntensity > 0
					? `hsla(${seg.hue},70%,80%,${a * CONFIG.prismIntensity})`
					: CONFIG.color + a + ')';
			ctx.lineWidth = Math.max(0.5, (3 - seg.d * 0.5) * s);
			ctx.beginPath();
			ctx.moveTo(seg.x1, seg.y1);
			ctx.lineTo(seg.x2, seg.y2);
			ctx.stroke();
		}
	}
	melt(amt) {
		this.melted = Math.min(1, this.melted + amt);
		this.meltTimer = 0;
	}
}
function drawFrost() {
	ctx.globalAlpha = 0.08;
	let g = ctx.createLinearGradient(0, 0, CONFIG.edgeFrost, 0);
	g.addColorStop(0, 'rgba(200,230,255,0.4)');
	g.addColorStop(1, 'transparent');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, CONFIG.edgeFrost, H);
	let g2 = ctx.createLinearGradient(W, 0, W - CONFIG.edgeFrost, 0);
	g2.addColorStop(0, 'rgba(200,230,255,0.4)');
	g2.addColorStop(1, 'transparent');
	ctx.fillStyle = g2;
	ctx.fillRect(W - CONFIG.edgeFrost, 0, CONFIG.edgeFrost, H);
	let g3 = ctx.createLinearGradient(0, 0, 0, CONFIG.edgeFrost);
	g3.addColorStop(0, 'rgba(200,230,255,0.4)');
	g3.addColorStop(1, 'transparent');
	ctx.fillStyle = g3;
	ctx.fillRect(0, 0, W, CONFIG.edgeFrost);
	ctx.globalAlpha = 1;
}
function startAnim() {
	let last = performance.now();
	function render(now) {
		if (!ctx) return;
		let dt = Math.min((now - last) / 16.67, 3);
		last = now;
		time++;
		ctx.clearRect(0, 0, W, H);
		if (time % CONFIG.seedInterval === 0 && crystals.length < CONFIG.maxCrystals) {
			crystals.push(new Crystal(Math.random() * W, Math.random() * H));
		}
		for (let c of crystals) {
			let dx = c.x - mouse.x,
				dy = c.y - mouse.y,
				d = Math.sqrt(dx * dx + dy * dy);
			if (d < CONFIG.meltRadius) c.melt(CONFIG.meltSpeed * dt * (1 - d / CONFIG.meltRadius));
			c.grow(dt);
			c.draw();
		}
		drawFrost();
		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}
