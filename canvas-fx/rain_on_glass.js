/**
 * Title: Rain on Glass
 * Description: Raindrops falling with realistic physics — acceleration, subtle streaks,
 *   occasional pausing and merging. Larger drops fall slower. Mouse position creates
 *   a wind effect that angles the rain.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };
let drops = [];
let streaks = [];

const MAX_DROPS = 180;
const MAX_STREAKS = 40;

// Keep worker alive
setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

class Raindrop {
	constructor() {
		this.reset(true);
	}

	reset(randomY = false) {
		this.x = Math.random() * width;
		this.y = randomY ? Math.random() * height : -10 - Math.random() * 60;
		this.radius = 1 + Math.random() * 2.5;
		this.vy = 0.5 + Math.random() * 1.5;
		this.vx = 0;
		this.acceleration = 0.02 + Math.random() * 0.04;
		this.maxSpeed = 3 + Math.random() * 4;
		this.opacity = 0.15 + Math.random() * 0.25;
		this.paused = false;
		this.pauseTimer = 0;
		this.pauseThreshold = 200 + Math.random() * 600;
		this.streakLength = 0;
		// Larger drops are slower
		if (this.radius > 2) {
			this.maxSpeed *= 0.6;
			this.acceleration *= 0.7;
			this.opacity += 0.05;
		}
	}

	update(windX) {
		// Chance to pause briefly (simulates surface tension on glass)
		this.pauseTimer++;
		if (!this.paused && this.pauseTimer > this.pauseThreshold && Math.random() < 0.003) {
			this.paused = true;
			this.pauseTimer = 0;
			this.pauseThreshold = 40 + Math.random() * 120;
		}
		if (this.paused) {
			this.pauseTimer++;
			if (this.pauseTimer > this.pauseThreshold) {
				this.paused = false;
				this.pauseTimer = 0;
				this.pauseThreshold = 200 + Math.random() * 600;
			}
			// Even when paused, slight wind drift
			this.x += windX * 0.1;
			this.streakLength *= 0.9;
			return;
		}

		// Accelerate
		this.vy = Math.min(this.vy + this.acceleration, this.maxSpeed);
		this.vx += (windX - this.vx) * 0.02;

		this.x += this.vx;
		this.y += this.vy;

		// Streak length proportional to speed
		this.streakLength = this.vy * 3;

		// Off-screen reset
		if (this.y > height + 20 || this.x < -20 || this.x > width + 20) {
			this.reset(false);
		}
	}

	draw(ctx) {
		// Draw streak behind the drop
		if (this.streakLength > 1) {
			ctx.beginPath();
			ctx.moveTo(this.x, this.y);
			ctx.lineTo(this.x - this.vx * 2, this.y - this.streakLength);
			ctx.strokeStyle = `rgba(180, 210, 240, ${this.opacity * 0.3})`;
			ctx.lineWidth = this.radius * 0.5;
			ctx.stroke();
		}

		// Draw the drop itself — slightly elongated when moving fast
		ctx.beginPath();
		const stretch = 1 + this.vy * 0.08;
		ctx.save();
		ctx.translate(this.x, this.y);
		ctx.scale(1, stretch);
		ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
		ctx.restore();
		ctx.fillStyle = `rgba(180, 210, 240, ${this.opacity})`;
		ctx.fill();

		// Tiny highlight on top of drop for glass refraction look
		ctx.beginPath();
		ctx.arc(
			this.x - this.radius * 0.3,
			this.y - this.radius * 0.3,
			this.radius * 0.35,
			0,
			Math.PI * 2
		);
		ctx.fillStyle = `rgba(220, 240, 255, ${this.opacity * 0.5})`;
		ctx.fill();
	}
}

// Residual streak left behind by fast drops
class Streak {
	constructor(x, y, len) {
		this.x = x;
		this.y = y;
		this.length = len;
		this.opacity = 0.08;
		this.life = 1;
		this.decay = 0.003 + Math.random() * 0.005;
	}

	update() {
		this.life -= this.decay;
		this.opacity = 0.08 * this.life;
	}

	draw(ctx) {
		if (this.life <= 0) return;
		ctx.beginPath();
		ctx.moveTo(this.x, this.y);
		ctx.lineTo(this.x, this.y + this.length);
		ctx.strokeStyle = `rgba(180, 210, 240, ${this.opacity})`;
		ctx.lineWidth = 0.5;
		ctx.stroke();
	}
}

function initDrops() {
	drops = [];
	streaks = [];
	for (let i = 0; i < MAX_DROPS; i++) {
		drops.push(new Raindrop());
	}
}

function getWind() {
	// Wind based on mouse X position relative to center
	const centerX = width / 2;
	const dx = mouse.x - centerX;
	// Normalize to -1..1, scale for effect
	return (dx / centerX) * 1.5;
}

self.onmessage = (e) => {
	switch (e.data.type) {
		case 'init':
			canvas = e.data.canvas;
			ctx = canvas.getContext('2d');
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initDrops();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initDrops();
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};

function startAnimation() {
	function render() {
		if (!ctx) return;
		ctx.clearRect(0, 0, width, height);

		const wind = getWind();

		// Check for merging — nearby drops absorb smaller ones
		for (let i = 0; i < drops.length; i++) {
			for (let j = i + 1; j < drops.length; j++) {
				const dx = drops[i].x - drops[j].x;
				const dy = drops[i].y - drops[j].y;
				const dist = Math.sqrt(dx * dx + dy * dy);
				const mergeThresh = drops[i].radius + drops[j].radius;
				if (dist < mergeThresh) {
					// Merge: bigger drop absorbs smaller
					if (drops[i].radius >= drops[j].radius) {
						drops[i].radius = Math.min(drops[i].radius + drops[j].radius * 0.3, 4);
						drops[i].vy = Math.max(drops[i].vy, drops[j].vy);
						drops[j].reset(false);
					} else {
						drops[j].radius = Math.min(drops[j].radius + drops[i].radius * 0.3, 4);
						drops[j].vy = Math.max(drops[i].vy, drops[j].vy);
						drops[i].reset(false);
					}
					break;
				}
			}
		}

		// Occasional residual streaks
		if (Math.random() < 0.02 && streaks.length < MAX_STREAKS) {
			const d = drops[Math.floor(Math.random() * drops.length)];
			if (d.vy > 3) {
				streaks.push(new Streak(d.x, d.y, d.streakLength * 2));
			}
		}

		// Update and draw streaks
		for (let i = streaks.length - 1; i >= 0; i--) {
			streaks[i].update();
			streaks[i].draw(ctx);
			if (streaks[i].life <= 0) {
				streaks.splice(i, 1);
			}
		}

		// Update and draw drops
		for (const drop of drops) {
			drop.update(wind);
			drop.draw(ctx);
		}

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);
}
