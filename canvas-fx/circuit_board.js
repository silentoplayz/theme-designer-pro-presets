/**
 * Title: Circuit Board
 * Description: Animated circuit board traces drawn in real-time. Lines travel horizontally
 *   and vertically with 90-degree turns. Glowing nodes at junctions/endpoints.
 *   Mouse creates signal pulses that race along nearby traces. Subtle cyan/green palette.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };

const GRID = 20; // grid spacing
const MAX_TRACES = 60;
const MAX_PULSES = 40;
const TRACE_COLOR = 'rgba(0, 180, 160, 0.2)';
const NODE_COLOR = 'rgba(0, 220, 180, 0.5)';
const PULSE_COLOR = 'rgba(0, 255, 200, 0.9)';

let traces = [];
let pulses = [];
let activeTraces = []; // traces currently being drawn
let lastPulseTime = 0;

setInterval(() => {
	self.postMessage({ type: 'heartbeat' });
}, 1000);

self.onmessage = (e) => {
	switch (e.data.type) {
		case 'init':
			canvas = e.data.canvas;
			ctx = canvas.getContext('2d');
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			init();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			traces = [];
			activeTraces = [];
			pulses = [];
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};

function snapToGrid(v) {
	return Math.round(v / GRID) * GRID;
}

function init() {
	traces = [];
	activeTraces = [];
	pulses = [];
}

// A trace is a series of connected segments (polyline on the grid)
function spawnTrace() {
	const startX = snapToGrid(Math.random() * width);
	const startY = snapToGrid(Math.random() * height);
	// Direction: 0=right, 1=down, 2=left, 3=up
	const dir = Math.floor(Math.random() * 4);
	const segmentCount = 3 + Math.floor(Math.random() * 8);

	return {
		points: [{ x: startX, y: startY }],
		targetPoints: generatePath(startX, startY, dir, segmentCount),
		currentSegment: 0,
		progress: 0, // 0-1 along current segment
		speed: 0.02 + Math.random() * 0.03,
		complete: false,
		opacity: 0.15 + Math.random() * 0.15
	};
}

function generatePath(sx, sy, startDir, count) {
	const pts = [{ x: sx, y: sy }];
	let dir = startDir;
	let cx = sx,
		cy = sy;

	for (let i = 0; i < count; i++) {
		const len = (2 + Math.floor(Math.random() * 8)) * GRID;
		const dx = [1, 0, -1, 0][dir];
		const dy = [0, 1, 0, -1][dir];
		cx += dx * len;
		cy += dy * len;
		// Clamp to canvas
		cx = Math.max(0, Math.min(width, cx));
		cy = Math.max(0, Math.min(height, cy));
		pts.push({ x: cx, y: cy });
		// Turn 90 degrees (randomly left or right)
		dir = (dir + (Math.random() < 0.5 ? 1 : 3)) % 4;
	}
	return pts;
}

function spawnPulse(trace) {
	if (trace.targetPoints.length < 2) return;
	return {
		trace: trace,
		segment: 0,
		progress: 0,
		speed: 0.03 + Math.random() * 0.02,
		life: 1.0
	};
}

function startAnimation() {
	let frameCount = 0;

	function render(time) {
		if (!ctx) return;
		frameCount++;

		ctx.clearRect(0, 0, width, height);

		// Spawn new traces periodically
		if (frameCount % 30 === 0 && activeTraces.length < 3 && traces.length < MAX_TRACES) {
			activeTraces.push(spawnTrace());
		}

		// Update and draw active (growing) traces
		for (let i = activeTraces.length - 1; i >= 0; i--) {
			const t = activeTraces[i];

			if (t.currentSegment < t.targetPoints.length - 1) {
				t.progress += t.speed;
				if (t.progress >= 1) {
					t.progress = 0;
					t.currentSegment++;
					// Add completed point
					if (t.currentSegment < t.targetPoints.length) {
						t.points.push({
							x: t.targetPoints[t.currentSegment].x,
							y: t.targetPoints[t.currentSegment].y
						});
					}
				}
			} else {
				t.complete = true;
				traces.push(t);
				activeTraces.splice(i, 1);
			}
		}

		// Remove oldest traces if over limit
		while (traces.length > MAX_TRACES) {
			traces.shift();
		}

		// Draw all completed traces
		for (const t of traces) {
			drawTrace(t);
		}

		// Draw active traces (partially drawn)
		for (const t of activeTraces) {
			drawActiveTrace(t);
		}

		// Mouse pulse spawning — find nearby completed traces
		if (time - lastPulseTime > 300) {
			for (const t of traces) {
				if (pulses.length >= MAX_PULSES) break;
				for (const pt of t.targetPoints) {
					const dx = pt.x - mouse.x;
					const dy = pt.y - mouse.y;
					if (dx * dx + dy * dy < 150 * 150) {
						const p = spawnPulse(t);
						if (p) pulses.push(p);
						lastPulseTime = time;
						break;
					}
				}
			}
		}

		// Update and draw pulses
		for (let i = pulses.length - 1; i >= 0; i--) {
			const p = pulses[i];
			p.progress += p.speed;
			if (p.progress >= 1) {
				p.progress = 0;
				p.segment++;
			}
			p.life -= 0.005;

			if (p.segment >= p.trace.targetPoints.length - 1 || p.life <= 0) {
				pulses.splice(i, 1);
				continue;
			}

			// Interpolate pulse position
			const a = p.trace.targetPoints[p.segment];
			const b = p.trace.targetPoints[p.segment + 1];
			const px = a.x + (b.x - a.x) * p.progress;
			const py = a.y + (b.y - a.y) * p.progress;

			ctx.beginPath();
			ctx.arc(px, py, 3, 0, Math.PI * 2);
			ctx.fillStyle = `rgba(0, 255, 200, ${p.life * 0.8})`;
			ctx.shadowColor = 'rgba(0, 255, 200, 0.6)';
			ctx.shadowBlur = 10;
			ctx.fill();
			ctx.shadowBlur = 0;
		}

		requestAnimationFrame(render);
	}

	requestAnimationFrame(render);
}

function drawTrace(t) {
	if (t.targetPoints.length < 2) return;

	ctx.beginPath();
	ctx.moveTo(t.targetPoints[0].x, t.targetPoints[0].y);
	for (let i = 1; i < t.targetPoints.length; i++) {
		ctx.lineTo(t.targetPoints[i].x, t.targetPoints[i].y);
	}
	ctx.strokeStyle = `rgba(0, 180, 160, ${t.opacity})`;
	ctx.lineWidth = 1.5;
	ctx.stroke();

	// Draw nodes at junctions
	for (let i = 0; i < t.targetPoints.length; i++) {
		const pt = t.targetPoints[i];
		// Glow brighter if mouse is near
		const dx = pt.x - mouse.x;
		const dy = pt.y - mouse.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		const glow = dist < 120 ? 0.6 + (1 - dist / 120) * 0.4 : 0.3;

		ctx.beginPath();
		ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
		ctx.fillStyle = `rgba(0, 220, 180, ${glow * t.opacity * 2})`;
		ctx.fill();
	}
}

function drawActiveTrace(t) {
	if (t.points.length < 1 || t.currentSegment >= t.targetPoints.length - 1) return;

	// Draw completed segments
	ctx.beginPath();
	ctx.moveTo(t.points[0].x, t.points[0].y);
	for (let i = 1; i < t.points.length; i++) {
		ctx.lineTo(t.points[i].x, t.points[i].y);
	}

	// Draw current segment (in progress)
	const a = t.targetPoints[t.currentSegment];
	const b = t.targetPoints[t.currentSegment + 1];
	const cx = a.x + (b.x - a.x) * t.progress;
	const cy = a.y + (b.y - a.y) * t.progress;
	ctx.lineTo(cx, cy);

	ctx.strokeStyle = `rgba(0, 220, 180, ${t.opacity * 1.5})`;
	ctx.lineWidth = 1.5;
	ctx.stroke();

	// Glowing tip
	ctx.beginPath();
	ctx.arc(cx, cy, 3, 0, Math.PI * 2);
	ctx.fillStyle = 'rgba(0, 255, 220, 0.8)';
	ctx.shadowColor = 'rgba(0, 255, 220, 0.6)';
	ctx.shadowBlur = 8;
	ctx.fill();
	ctx.shadowBlur = 0;

	// Draw completed nodes
	for (const pt of t.points) {
		ctx.beginPath();
		ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
		ctx.fillStyle = `rgba(0, 220, 180, ${t.opacity * 2})`;
		ctx.fill();
	}
}
