/**
 * Title: Matrix Rain
 * Description: Classic Matrix digital rain with columns of falling katakana, numbers,
 *   and latin characters. Green phosphor glow, brighter leading characters.
 *   Mouse proximity accelerates nearby columns.
 */

let canvas, ctx, width, height;
let mouse = { x: -5000, y: -5000 };

// Column state
let columns = [];
const FONT_SIZE = 14;
const CHAR_POOL =
	'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン' +
	'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Heartbeat to keep worker alive
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
			initColumns();
			startAnimation();
			break;
		case 'resize':
			width = e.data.width;
			height = e.data.height;
			canvas.width = width;
			canvas.height = height;
			initColumns();
			break;
		case 'mousemove':
			mouse.x = e.data.x;
			mouse.y = e.data.y;
			break;
	}
};

function initColumns() {
	const count = Math.ceil(width / FONT_SIZE);
	columns = [];
	for (let i = 0; i < count; i++) {
		columns.push({
			x: i * FONT_SIZE,
			y: Math.random() * height * -1, // start above screen
			speed: 0.3 + Math.random() * 0.7, // base speed multiplier
			chars: generateChars(Math.ceil(height / FONT_SIZE) + 10),
			length: 8 + Math.floor(Math.random() * 20), // visible trail length
			offset: 0 // fractional y offset for smooth scrolling
		});
	}
}

function generateChars(count) {
	const chars = [];
	for (let i = 0; i < count; i++) {
		chars.push(CHAR_POOL[Math.floor(Math.random() * CHAR_POOL.length)]);
	}
	return chars;
}

function randomChar() {
	return CHAR_POOL[Math.floor(Math.random() * CHAR_POOL.length)];
}

function startAnimation() {
	let lastTime = 0;

	function render(time) {
		if (!ctx) return;
		const dt = lastTime ? (time - lastTime) / 16.67 : 1; // normalize to ~60fps
		lastTime = time;

		// Fade the canvas instead of clearing — creates the trail effect
		ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
		ctx.fillRect(0, 0, width, height);

		ctx.font = `${FONT_SIZE}px monospace`;

		for (let i = 0; i < columns.length; i++) {
			const col = columns[i];

			// Mouse proximity check — speed boost for nearby columns
			const dx = col.x - mouse.x;
			const dist = Math.abs(dx);
			const mouseBoost = dist < 200 ? 1 + (1 - dist / 200) * 2.5 : 1;

			// Advance the column
			col.offset += col.speed * mouseBoost * dt;

			// When we've moved a full character height, shift everything
			if (col.offset >= FONT_SIZE) {
				col.offset -= FONT_SIZE;
				col.y += FONT_SIZE;

				// Randomly mutate a character in the trail
				const mutateIdx = Math.floor(Math.random() * col.chars.length);
				col.chars[mutateIdx] = randomChar();
			}

			// Calculate the head position (in cell units)
			const headRow = Math.floor(col.y / FONT_SIZE);

			// Draw visible characters
			for (let j = 0; j < col.length; j++) {
				const row = headRow - j;
				const py = row * FONT_SIZE + col.offset;

				// Skip if off-screen
				if (py < -FONT_SIZE || py > height + FONT_SIZE) continue;

				const charIdx = Math.abs(row) % col.chars.length;
				const ch = col.chars[charIdx];

				if (j === 0) {
					// Leading character — bright white-green
					ctx.fillStyle = 'rgba(180, 255, 180, 0.95)';
					ctx.shadowColor = 'rgba(0, 255, 70, 0.8)';
					ctx.shadowBlur = 12;
				} else if (j === 1) {
					// Second char — still bright
					ctx.fillStyle = 'rgba(0, 255, 70, 0.7)';
					ctx.shadowColor = 'rgba(0, 255, 70, 0.4)';
					ctx.shadowBlur = 6;
				} else {
					// Trail — fades out
					const fade = 1 - j / col.length;
					const alpha = fade * 0.4;
					ctx.fillStyle = `rgba(0, 200, 50, ${alpha})`;
					ctx.shadowBlur = 0;
				}

				ctx.fillText(ch, col.x, py);
			}

			// Reset shadow after each column
			ctx.shadowBlur = 0;

			// Reset column when it's fully off the bottom
			if ((headRow - col.length) * FONT_SIZE > height) {
				col.y = Math.random() * -height * 0.5 - FONT_SIZE * col.length;
				col.speed = 0.3 + Math.random() * 0.7;
				col.length = 8 + Math.floor(Math.random() * 20);
				col.chars = generateChars(Math.ceil(height / FONT_SIZE) + 10);
			}
		}

		requestAnimationFrame(render);
	}

	requestAnimationFrame(render);
}
