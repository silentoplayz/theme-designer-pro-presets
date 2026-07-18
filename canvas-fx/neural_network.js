/**
 * Title: Neural Network
 * Description: Visualization of connected nodes in layers with pulses of light traveling
 *   along connections. Nodes glow when activated. The network slowly reorganizes.
 *   Mouse adds energy to the nearest node, triggering cascading activations.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };

let layers = [];
let connections = [];
let pulses = [];

const LAYER_COUNT = 5;
const NODE_RADIUS = 4;
const MAX_PULSES = 80;
const REORGANIZE_SPEED = 0.002;

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
			initNetwork();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initNetwork();
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};

function initNetwork() {
	layers = [];
	connections = [];
	pulses = [];

	// Create layers with varying node counts
	const nodeCounts = [];
	for (let l = 0; l < LAYER_COUNT; l++) {
		if (l === 0 || l === LAYER_COUNT - 1) {
			nodeCounts.push(3 + Math.floor(Math.random() * 3));
		} else {
			nodeCounts.push(5 + Math.floor(Math.random() * 5));
		}
	}

	const layerSpacing = width / (LAYER_COUNT + 1);

	for (let l = 0; l < LAYER_COUNT; l++) {
		const layer = [];
		const count = nodeCounts[l];
		const nodeSpacing = height / (count + 1);
		const baseX = layerSpacing * (l + 1);

		for (let n = 0; n < count; n++) {
			const baseY = nodeSpacing * (n + 1);
			layer.push({
				x: baseX,
				y: baseY,
				targetX: baseX + (Math.random() - 0.5) * 30,
				targetY: baseY + (Math.random() - 0.5) * 20,
				energy: 0, // 0-1 glow intensity
				layer: l,
				index: n,
				driftPhase: Math.random() * Math.PI * 2
			});
		}
		layers.push(layer);
	}

	// Create connections between adjacent layers (not fully connected — sparse)
	for (let l = 0; l < LAYER_COUNT - 1; l++) {
		const fromLayer = layers[l];
		const toLayer = layers[l + 1];

		for (const from of fromLayer) {
			// Connect to 1-3 nodes in the next layer
			const connectCount = 1 + Math.floor(Math.random() * Math.min(3, toLayer.length));
			const targets = shuffleArray([...toLayer]).slice(0, connectCount);

			for (const to of targets) {
				connections.push({
					from: from,
					to: to,
					weight: 0.3 + Math.random() * 0.7,
					opacity: 0.06 + Math.random() * 0.08
				});
			}
		}
	}
}

function shuffleArray(arr) {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

function spawnPulse(connection) {
	if (pulses.length >= MAX_PULSES) return;
	pulses.push({
		conn: connection,
		progress: 0,
		speed: 0.008 + Math.random() * 0.012,
		brightness: 0.4 + Math.random() * 0.6
	});
}

function startAnimation() {
	let lastMouseActivation = 0;
	let spontaneousTimer = 0;

	function render(time) {
		if (!ctx) return;

		ctx.clearRect(0, 0, width, height);

		// Slow reorganization — nodes drift toward new targets
		for (const layer of layers) {
			for (const node of layer) {
				// Gentle sine-based drift
				node.driftPhase += REORGANIZE_SPEED;
				const drift = Math.sin(node.driftPhase) * 15;
				const driftY = Math.cos(node.driftPhase * 0.7) * 10;

				node.x += (node.targetX + drift - node.x) * 0.01;
				node.y += (node.targetY + driftY - node.y) * 0.01;

				// Decay energy
				node.energy *= 0.97;
			}
		}

		// Mouse interaction — energize nearest node
		if (time - lastMouseActivation > 200) {
			let nearest = null;
			let nearestDist = Infinity;

			for (const layer of layers) {
				for (const node of layer) {
					const dx = node.x - mouse.x;
					const dy = node.y - mouse.y;
					const dist = dx * dx + dy * dy;
					if (dist < nearestDist) {
						nearestDist = dist;
						nearest = node;
					}
				}
			}

			if (nearest && nearestDist < 200 * 200) {
				nearest.energy = Math.min(1, nearest.energy + 0.5);
				// Fire pulses along outgoing connections
				for (const conn of connections) {
					if (conn.from === nearest && Math.random() < 0.6) {
						spawnPulse(conn);
					}
				}
				lastMouseActivation = time;
			}
		}

		// Spontaneous firing
		spontaneousTimer++;
		if (spontaneousTimer > 60) {
			spontaneousTimer = 0;
			// Pick a random input node to fire
			const inputLayer = layers[0];
			const node = inputLayer[Math.floor(Math.random() * inputLayer.length)];
			node.energy = Math.min(1, node.energy + 0.3);

			for (const conn of connections) {
				if (conn.from === node && Math.random() < 0.4) {
					spawnPulse(conn);
				}
			}
		}

		// Draw connections
		for (const conn of connections) {
			ctx.beginPath();
			ctx.moveTo(conn.from.x, conn.from.y);
			ctx.lineTo(conn.to.x, conn.to.y);

			// Brighter if either node is energized
			const energyBoost = Math.max(conn.from.energy, conn.to.energy) * 0.2;
			ctx.strokeStyle = `rgba(100, 160, 255, ${conn.opacity + energyBoost})`;
			ctx.lineWidth = 0.8 + conn.weight * 0.5;
			ctx.stroke();
		}

		// Update and draw pulses
		for (let i = pulses.length - 1; i >= 0; i--) {
			const p = pulses[i];
			p.progress += p.speed;

			if (p.progress >= 1) {
				// Pulse arrived — energize target node and cascade
				p.conn.to.energy = Math.min(1, p.conn.to.energy + 0.3 * p.brightness);

				// Cascade: fire from the target node (with diminishing probability)
				if (p.brightness > 0.2) {
					for (const conn of connections) {
						if (conn.from === p.conn.to && Math.random() < 0.35) {
							if (pulses.length < MAX_PULSES) {
								pulses.push({
									conn: conn,
									progress: 0,
									speed: 0.008 + Math.random() * 0.012,
									brightness: p.brightness * 0.7
								});
							}
						}
					}
				}

				pulses.splice(i, 1);
				continue;
			}

			// Interpolate position
			const px = p.conn.from.x + (p.conn.to.x - p.conn.from.x) * p.progress;
			const py = p.conn.from.y + (p.conn.to.y - p.conn.from.y) * p.progress;

			ctx.beginPath();
			ctx.arc(px, py, 2.5, 0, Math.PI * 2);
			ctx.fillStyle = `rgba(140, 200, 255, ${p.brightness * 0.7})`;
			ctx.shadowColor = `rgba(100, 180, 255, ${p.brightness * 0.5})`;
			ctx.shadowBlur = 8;
			ctx.fill();
			ctx.shadowBlur = 0;
		}

		// Draw nodes
		for (const layer of layers) {
			for (const node of layer) {
				const glow = node.energy;

				// Outer glow
				if (glow > 0.05) {
					ctx.beginPath();
					ctx.arc(node.x, node.y, NODE_RADIUS + 6, 0, Math.PI * 2);
					ctx.fillStyle = `rgba(100, 180, 255, ${glow * 0.15})`;
					ctx.fill();
				}

				// Node body
				ctx.beginPath();
				ctx.arc(node.x, node.y, NODE_RADIUS, 0, Math.PI * 2);
				const baseAlpha = 0.15 + glow * 0.6;
				ctx.fillStyle = `rgba(120, 180, 255, ${baseAlpha})`;
				ctx.fill();

				// Bright center when energized
				if (glow > 0.1) {
					ctx.beginPath();
					ctx.arc(node.x, node.y, NODE_RADIUS * 0.5, 0, Math.PI * 2);
					ctx.fillStyle = `rgba(200, 230, 255, ${glow * 0.5})`;
					ctx.shadowColor = `rgba(120, 200, 255, ${glow * 0.4})`;
					ctx.shadowBlur = 10;
					ctx.fill();
					ctx.shadowBlur = 0;
				}
			}
		}

		requestAnimationFrame(render);
	}

	requestAnimationFrame(render);
}
