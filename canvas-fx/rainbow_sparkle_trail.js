/**
 * Title: Rainbow Sparkle Trail
 * Description: A magical rainbow sparkle trail that follows your mouse! Every
 *   movement creates a burst of colorful, glittery star-shaped particles that
 *   twirl, shrink, and fade. The faster you move, the more sparkles appear.
 *   Perfect for little ones who love chasing magic around the screen.
 */

/* ---------- CONFIGURABLE VARIABLES ---------- */
const MAX_SPARKLES      = 600;    // max particles alive at once
const SPAWN_RATE        = 8;      // sparkles spawned per frame while moving
const GRAVITY           = 0.04;   // gentle downward pull
const SPARKLE_SIZE_MIN  = 3;      // minimum star size
const SPARKLE_SIZE_MAX  = 10;     // maximum star size
const SPARKLE_LIFETIME  = 90;     // frames before a sparkle fades out
const SPIN_SPEED        = 0.08;   // rotation speed of star shapes
const SPREAD            = 40;     // pixel radius of spawn spread from cursor
const DRIFT_SPEED       = 0.6;    // lateral drift of particles
const RAINBOW_SPEED     = 3;      // how fast the hue cycles (degrees per frame)
/* --------------------------------------------- */

let canvas, ctx, w, h;
let sparkles = [];
let mouse = { x: -999, y: -999, px: -999, py: -999 };
let hueOffset = 0;
let time = 0;

setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

class Sparkle {
	constructor(x, y, hue) {
		this.x = x + (Math.random() - 0.5) * SPREAD;
		this.y = y + (Math.random() - 0.5) * SPREAD;
		this.vx = (Math.random() - 0.5) * DRIFT_SPEED * 2;
		this.vy = -(Math.random() * 1.5 + 0.5);
		this.size = SPARKLE_SIZE_MIN + Math.random() * (SPARKLE_SIZE_MAX - SPARKLE_SIZE_MIN);
		this.rotation = Math.random() * Math.PI * 2;
		this.spinDir = Math.random() > 0.5 ? 1 : -1;
		this.hue = hue + (Math.random() - 0.5) * 30;
		this.life = SPARKLE_LIFETIME;
		this.maxLife = SPARKLE_LIFETIME;
		this.points = Math.random() > 0.5 ? 5 : 4; // 4 or 5 pointed stars
	}

	update() {
		this.life--;
		this.vy += GRAVITY;
		this.vx *= 0.99;
		this.x += this.vx;
		this.y += this.vy;
		this.rotation += SPIN_SPEED * this.spinDir;
		return this.life > 0;
	}

	draw(ctx) {
		const progress = 1 - this.life / this.maxLife;
		const alpha = Math.max(0, 1 - progress * progress);
		const scale = this.size * (1 - progress * 0.6);
		if (scale < 0.5) return;

		ctx.save();
		ctx.translate(this.x, this.y);
		ctx.rotate(this.rotation);
		ctx.globalAlpha = alpha;

		// Outer glow
		ctx.shadowColor = `hsl(${this.hue}, 100%, 70%)`;
		ctx.shadowBlur = scale * 3;

		// Draw star shape
		ctx.beginPath();
		const pts = this.points;
		for (let i = 0; i < pts * 2; i++) {
			const r = i % 2 === 0 ? scale : scale * 0.4;
			const angle = (i * Math.PI) / pts - Math.PI / 2;
			if (i === 0) ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
			else ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
		}
		ctx.closePath();
		ctx.fillStyle = `hsl(${this.hue}, 100%, ${70 + progress * 20}%)`;
		ctx.fill();

		ctx.shadowBlur = 0;
		ctx.globalAlpha = 1;
		ctx.restore();
	}
}

self.onmessage = (e) => {
	switch (e.data.type) {
		case 'init':
			canvas = e.data.canvas;
			ctx = canvas.getContext('2d');
			w = e.data.width;
			h = e.data.height;
			canvas.width = w;
			canvas.height = h;
			startAnimation();
			break;
		case 'resize':
			w = e.data.width;
			h = e.data.height;
			canvas.width = w;
			canvas.height = h;
			break;
		case 'mousemove':
			mouse.px = mouse.x;
			mouse.py = mouse.y;
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};

function startAnimation() {
	function render() {
		if (!ctx) return;
		time++;
		hueOffset = (hueOffset + RAINBOW_SPEED) % 360;

		// Fade to black with slight trail
		ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
		ctx.fillRect(0, 0, w, h);

		// Spawn sparkles if mouse is moving
		const dx = mouse.x - mouse.px;
		const dy = mouse.y - mouse.py;
		const speed = Math.sqrt(dx * dx + dy * dy);

		if (speed > 1 && mouse.x > 0 && mouse.y > 0) {
			const count = Math.min(SPAWN_RATE, Math.floor(speed / 2) + 2);
			for (let i = 0; i < count && sparkles.length < MAX_SPARKLES; i++) {
				const hue = (hueOffset + i * (360 / count)) % 360;
				sparkles.push(new Sparkle(mouse.x, mouse.y, hue));
			}
		}

		// Also spawn a gentle ambient sparkle occasionally
		if (time % 6 === 0 && sparkles.length < MAX_SPARKLES) {
			sparkles.push(new Sparkle(
				Math.random() * w,
				Math.random() * h,
				hueOffset + Math.random() * 120
			));
		}

		// Update and draw
		sparkles = sparkles.filter(s => s.update());
		for (const s of sparkles) {
			s.draw(ctx);
		}

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}
