/**
 * Title: Diagnostic HUD
 * Description: Full-featured debug/diagnostic Canvas FX overlay. Reports the
 *   health of all 10 message channels, live FPS + frame timing, canvas info,
 *   execution mode, input tracking, context data from DOM observer and fetch
 *   interceptor, environment capabilities, and a scrolling event log.
 *   Green = working, Amber = stale, Red = not received.
 */

// ═══════════════════════════════════════════════════════════
// ██  CONFIGURATION — Tweak these values to customize!   ██
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // -- Appearance --
  bgColor: 'rgba(8, 12, 20, 0.82)',       // Panel background
  borderColor: 'rgba(0, 255, 136, 0.25)',  // Panel border color
  fontFamily: 'monospace',                 // Font family
  fontSize: 11,                            // Base font size (px)
  lineHeight: 17,                          // Line height (px)
  padding: 18,                             // Panel padding (px)
  panelRadius: 10,                         // Panel corner radius (px)
  panelMaxWidth: 520,                      // Max panel width (px)

  // -- Colors --
  colorOk: '#00ff88',                      // Status OK (green)
  colorWarn: '#ffaa00',                    // Status stale/warning (amber)
  colorError: '#ff4455',                   // Status not received (red)
  colorLabel: 'rgba(255,255,255,0.45)',    // Label text color
  colorValue: '#e8e8e8',                   // Value text color
  colorHeader: '#00ddff',                  // Section header color
  colorDim: 'rgba(255,255,255,0.18)',      // Separator/dim text
  colorAccent: '#8866ff',                  // Accent (context)

  // -- Event Log --
  maxLogEntries: 8,                        // Max visible log entries
  logStaleMs: 5000,                        // Time before "stale" (ms)

  // -- Performance --
  fpsHistorySize: 60,                      // FPS graph bar count
};
// ═══════════════════════════════════════════════════════════

let canvas, ctx, W, H;
let frameCount = 0;
let fps = 0;
let fpsHistory = [];
let lastFpsTime = performance.now();
let lastFrameTime = performance.now();
let frameTimes = [];
let mouse = { x: -1, y: -1 };
let startTime = performance.now();
let totalEventsReceived = 0;
let eventsPerSec = 0;
let eventCountWindow = [];

// Track all 10 message types — categorized by expected firing behavior:
//   'oneshot'    — fires once (init). Green forever once received.
//   'continuous' — fires constantly while active (mousemove, touchmove). Stale after 5s.
//   'ondemand'   — fires on user action or system event. Stale after 60s.
const MESSAGE_TYPES = [
  'init', 'resize', 'mousemove', 'click',
  'mousedown', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'context'
];
const EVENT_CATEGORY = {
  init: 'oneshot',
  resize: 'ondemand',
  mousemove: 'continuous',
  click: 'ondemand',
  mousedown: 'ondemand',
  mouseup: 'ondemand',
  touchstart: 'ondemand',
  touchmove: 'continuous',
  touchend: 'ondemand',
  context: 'ondemand',
};

const stats = {};
MESSAGE_TYPES.forEach(t => {
  stats[t] = { count: 0, lastTime: 0 };
});

// Context data
let ctxDOM = { messages: null, chars: null, estimatedTokens: null, lastTime: 0 };
let ctxAPI = { exactTokens: null, promptTokens: null, completionTokens: null, source: 'socket', lastTime: 0 };

// Scrolling event log
const eventLog = [];

function logEvent(type, detail) {
  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
  eventLog.unshift({ time: elapsed, type, detail, timestamp: performance.now() });
  if (eventLog.length > CONFIG.maxLogEntries + 2) eventLog.length = CONFIG.maxLogEntries;
}

// Execution mode detection
const isWorker = typeof WorkerGlobalScope !== 'undefined';

// Capability checks
const caps = {
  offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
  requestAnimationFrame: typeof requestAnimationFrame === 'function',
  performanceNow: typeof performance !== 'undefined' && typeof performance.now === 'function',
};

// Heartbeat
setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

self.onmessage = (e) => {
  const { type } = e.data;
  const now = performance.now();
  totalEventsReceived++;
  eventCountWindow.push(now);

  if (stats[type] !== undefined) {
    stats[type].count++;
    stats[type].lastTime = now;
  }

  switch (type) {
    case 'init':
      canvas = e.data.canvas;
      ctx = canvas.getContext('2d');
      W = e.data.width;
      H = e.data.height;
      canvas.width = W;
      canvas.height = H;
      startTime = now;
      logEvent('init', `canvas ${W}×${H}`);
      startAnimation();
      break;

    case 'resize':
      W = e.data.width;
      H = e.data.height;
      canvas.width = W;
      canvas.height = H;
      logEvent('resize', `→ ${W}×${H}`);
      break;

    case 'mousemove':
      mouse.x = e.data.x;
      mouse.y = e.data.y;
      break;

    case 'click':
      logEvent('click', `(${e.data.x|0}, ${e.data.y|0})`);
      break;

    case 'mousedown':
      logEvent('mousedown', `(${e.data.x|0}, ${e.data.y|0})`);
      break;

    case 'mouseup':
      logEvent('mouseup', `(${e.data.x|0}, ${e.data.y|0})`);
      break;

    case 'touchstart': {
      const n = e.data.touches?.length || 0;
      logEvent('touchstart', `${n} point${n !== 1 ? 's' : ''}`);
      break;
    }

    case 'touchmove':
      break;

    case 'touchend': {
      const n = e.data.touches?.length || 0;
      logEvent('touchend', `${n} point${n !== 1 ? 's' : ''}`);
      break;
    }

    case 'context':
      if (e.data.exactTokens !== undefined) {
        ctxAPI.exactTokens = e.data.exactTokens;
        ctxAPI.promptTokens = e.data.promptTokens;
        ctxAPI.completionTokens = e.data.completionTokens;
        ctxAPI.source = e.data.source;
        ctxAPI.lastTime = now;
        logEvent('context', `API: ${e.data.exactTokens} total tok`);
      } else {
        ctxDOM.messages = e.data.messages;
        ctxDOM.chars = e.data.chars;
        ctxDOM.estimatedTokens = e.data.estimatedTokens;
        ctxDOM.lastTime = now;
        logEvent('context', `DOM: ~${e.data.estimatedTokens} tok, ${e.data.messages} msg`);
      }
      break;
  }
};

function startAnimation() {
  function render() {
    if (!ctx) return;
    const now = performance.now();
    const dt = now - lastFrameTime;
    lastFrameTime = now;

    // Frame time tracking
    frameTimes.push(dt);
    if (frameTimes.length > 120) frameTimes.shift();
    const avgFrame = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    const maxFrame = Math.max(...frameTimes.slice(-60));

    // FPS
    frameCount++;
    if (now - lastFpsTime >= 1000) {
      fps = frameCount;
      frameCount = 0;
      lastFpsTime = now;
      fpsHistory.push(fps);
      if (fpsHistory.length > CONFIG.fpsHistorySize) fpsHistory.shift();
    }

    // Events/sec
    eventCountWindow = eventCountWindow.filter(t => now - t < 1000);
    eventsPerSec = eventCountWindow.length;

    ctx.clearRect(0, 0, W, H);

    const uptime = ((now - startTime) / 1000);
    const p = CONFIG.padding;
    const lh = CONFIG.lineHeight;
    const fs = CONFIG.fontSize;
    const colW = CONFIG.panelMaxWidth;

    // ── Subtle animated background ──
    drawBackground(ctx, now);

    // ═══ Calculate panel dimensions ═══
    let lineCount = 0;
    lineCount += 2;  // Title + separator
    lineCount += 1;  // "SYSTEM" header
    lineCount += 5;  // system rows
    lineCount += 1;  // FPS graph
    lineCount += 3;  // graph height in lines
    lineCount += 2;  // separator + "CHANNELS" header
    lineCount += MESSAGE_TYPES.length;
    lineCount += 2;  // separator + "INPUT" header
    lineCount += 2;  // mouse + total events
    lineCount += 2;  // separator + "CONTEXT" header
    lineCount += 5;  // context rows
    lineCount += 2;  // separator + "LOG" header
    lineCount += Math.max(1, Math.min(eventLog.length, CONFIG.maxLogEntries));
    lineCount += 1;  // bottom padding

    const panelW = Math.min(colW, W - 40);
    const panelH = lineCount * lh + p * 2;
    const panelX = (W - panelW) / 2;
    const panelY = Math.max(20, (H - panelH) / 2);

    // ── Panel bg ──
    ctx.save();
    ctx.fillStyle = CONFIG.bgColor;
    roundedRect(ctx, panelX, panelY, panelW, panelH, CONFIG.panelRadius);
    ctx.fill();
    // Border glow
    ctx.shadowColor = CONFIG.colorOk;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = CONFIG.borderColor;
    ctx.lineWidth = 1;
    roundedRect(ctx, panelX, panelY, panelW, panelH, CONFIG.panelRadius);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();

    // ── Content rendering ──
    const lx = panelX + p;           // Left text x
    const rx = panelX + panelW - p;  // Right text x
    const cx = panelX + panelW / 2;  // Center x
    let y = panelY + p;

    // ── TITLE ──
    ctx.font = `bold ${fs + 3}px ${CONFIG.fontFamily}`;
    ctx.fillStyle = CONFIG.colorHeader;
    ctx.textAlign = 'center';
    ctx.fillText('◈  CANVAS FX — DIAGNOSTIC HUD  ◈', cx, y + fs + 2);
    y += lh;
    sep(y); y += lh;

    // ── SYSTEM ──
    sectionHeader('SYSTEM', y); y += lh;
    kv(y, 'UPTIME', formatUptime(uptime)); y += lh;
    kv(y, 'FPS', `${fps}`, fpsColor(fps)); y += lh;
    kv(y, 'FRAME AVG', `${avgFrame.toFixed(1)}ms`, avgFrame < 18 ? CONFIG.colorOk : avgFrame < 33 ? CONFIG.colorWarn : CONFIG.colorError); y += lh;
    kv(y, 'FRAME MAX', `${maxFrame.toFixed(1)}ms`, maxFrame < 20 ? CONFIG.colorOk : maxFrame < 50 ? CONFIG.colorWarn : CONFIG.colorError); y += lh;
    kv(y, 'EXEC MODE', isWorker ? 'Worker (OffscreenCanvas)' : 'Main Thread (Fallback)', isWorker ? CONFIG.colorOk : CONFIG.colorWarn); y += lh;

    // ── FPS Graph ──
    const graphH = lh * 3;
    const graphY = y + 2;
    const graphW = panelW - p * 2;
    drawFpsGraph(ctx, lx, graphY, graphW, graphH, fpsHistory);
    y += graphH + lh;

    // ── CHANNELS ──
    sep(y); y += lh;
    sectionHeader('MESSAGE CHANNELS', y);
    // Right-aligned column headers
    ctx.textAlign = 'right';
    ctx.fillStyle = CONFIG.colorDim;
    ctx.font = `${fs - 2}px ${CONFIG.fontFamily}`;
    ctx.fillText('COUNT      LAST', rx, y);
    y += lh;

    for (const t of MESSAGE_TYPES) {
      const s = stats[t];
      const statusColor = getStatusColor(s, now, t);
      const icon = getStatusIcon(s, now, t);
      const age = s.lastTime ? fmtAge(now - s.lastTime) : '  never';

      ctx.font = `${fs}px ${CONFIG.fontFamily}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = statusColor;
      ctx.fillText(`${icon}  ${t}`, lx, y);

      ctx.textAlign = 'right';
      ctx.fillStyle = CONFIG.colorValue;
      ctx.fillText(`${pad(s.count, 6)}   ${age.padStart(7)}`, rx, y);
      y += lh;
    }

    // ── INPUT ──
    sep(y); y += lh;
    sectionHeader('INPUT & THROUGHPUT', y); y += lh;
    kv(y, 'MOUSE', mouse.x >= 0 ? `(${mouse.x|0}, ${mouse.y|0})` : 'No data', mouse.x >= 0 ? CONFIG.colorValue : CONFIG.colorDim); y += lh;
    kv(y, 'EVENTS/SEC', `${eventsPerSec}`, eventsPerSec > 0 ? CONFIG.colorValue : CONFIG.colorDim);
    // Right side: total events
    ctx.textAlign = 'right';
    ctx.fillStyle = CONFIG.colorDim;
    ctx.font = `${fs - 1}px ${CONFIG.fontFamily}`;
    ctx.fillText(`total: ${totalEventsReceived}`, rx, y);
    y += lh;

    // ── CONTEXT ──
    sep(y); y += lh;
    sectionHeader('CONTEXT DATA', y); y += lh;

    // DOM Observer
    ctx.font = `bold ${fs - 1}px ${CONFIG.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('DOM Observer', lx, y);
    ctx.textAlign = 'right';
    const domAge = ctxDOM.lastTime ? fmtAge(now - ctxDOM.lastTime) + ' ago' : 'never';
    ctx.fillStyle = ctxDOM.lastTime ? CONFIG.colorDim : CONFIG.colorError;
    ctx.fillText(domAge, rx, y);
    y += lh;

    kv(y, '  MESSAGES', ctxDOM.messages != null ? `${ctxDOM.messages}` : '—', ctxDOM.messages != null ? CONFIG.colorValue : CONFIG.colorDim); y += lh;
    kv(y, '  CHARS / EST TOKENS', ctxDOM.chars != null ? `${ctxDOM.chars.toLocaleString()} / ~${ctxDOM.estimatedTokens}` : '—', ctxDOM.estimatedTokens != null ? CONFIG.colorValue : CONFIG.colorDim); y += lh;

    // Socket Interceptor
    ctx.font = `bold ${fs - 1}px ${CONFIG.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('Socket Interceptor', lx, y);
    ctx.textAlign = 'right';
    const apiAge = ctxAPI.lastTime ? fmtAge(now - ctxAPI.lastTime) + ' ago' : 'never';
    ctx.fillStyle = ctxAPI.lastTime ? CONFIG.colorDim : CONFIG.colorDim;
    ctx.fillText(apiAge, rx, y);
    y += lh;

    kv(y, '  EXACT TOKENS', ctxAPI.exactTokens != null ? `${ctxAPI.exactTokens} (P:${ctxAPI.promptTokens} C:${ctxAPI.completionTokens})` : '—', ctxAPI.exactTokens != null ? CONFIG.colorOk : CONFIG.colorDim); y += lh;

    // ── EVENT LOG ──
    sep(y); y += lh;
    sectionHeader('EVENT LOG', y); y += lh;

    if (eventLog.length === 0) {
      ctx.font = `${fs - 1}px ${CONFIG.fontFamily}`;
      ctx.fillStyle = CONFIG.colorDim;
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for events…', cx, y);
      y += lh;
    } else {
      for (let i = 0; i < Math.min(eventLog.length, CONFIG.maxLogEntries); i++) {
        const entry = eventLog[i];
        const age = (now - entry.timestamp) / 1000;
        const alpha = Math.max(0.25, 1 - age / 12);

        ctx.globalAlpha = alpha;
        ctx.font = `${fs - 1}px ${CONFIG.fontFamily}`;
        ctx.textAlign = 'left';
        ctx.fillStyle = CONFIG.colorDim;
        ctx.fillText(`${entry.time}s`, lx, y);
        ctx.fillStyle = getTypeColor(entry.type);
        ctx.fillText(entry.type, lx + 58, y);
        ctx.fillStyle = CONFIG.colorValue;
        ctx.font = `${fs - 1}px ${CONFIG.fontFamily}`;
        ctx.fillText(entry.detail, lx + 148, y);
        ctx.globalAlpha = 1;
        y += lh;
      }
    }

    // ── Mouse crosshair ──
    if (mouse.x >= 0 && mouse.y >= 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 255, 136, 0.15)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(mouse.x, 0); ctx.lineTo(mouse.x, H);
      ctx.moveTo(0, mouse.y); ctx.lineTo(W, mouse.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = CONFIG.colorOk;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(mouse.x, mouse.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    requestAnimationFrame(render);
  }

  // ── Scoped helpers (use closure over ctx, lx, rx, etc.) ──
  const lx = () => panelX_ref + CONFIG.padding;
  const rx = () => panelX_ref + panelW_ref - CONFIG.padding;
  let panelX_ref, panelW_ref;

  function kv(y, label, value, valueColor) {
    ctx.font = `${CONFIG.fontSize}px ${CONFIG.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = CONFIG.colorLabel;
    const _lx = (W - Math.min(CONFIG.panelMaxWidth, W - 40)) / 2 + CONFIG.padding;
    const _rx = _lx + Math.min(CONFIG.panelMaxWidth, W - 40) - CONFIG.padding * 2;
    ctx.fillText(label, _lx, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = valueColor || CONFIG.colorValue;
    ctx.fillText(value, _rx, y);
  }

  function sectionHeader(text, y) {
    const _cx = W / 2;
    ctx.font = `bold ${CONFIG.fontSize}px ${CONFIG.fontFamily}`;
    ctx.fillStyle = CONFIG.colorHeader;
    ctx.textAlign = 'center';
    ctx.fillText(`── ${text} ──`, _cx, y);
  }

  function sep(y) {
    const pw = Math.min(CONFIG.panelMaxWidth, W - 40);
    const px = (W - pw) / 2;
    ctx.strokeStyle = CONFIG.colorDim;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(px + CONFIG.padding, y + 5);
    ctx.lineTo(px + pw - CONFIG.padding, y + 5);
    ctx.stroke();
  }

  requestAnimationFrame(render);
}

// ═══ Drawing Helpers ═══

function drawBackground(ctx, now) {
  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.strokeStyle = CONFIG.colorOk;
  ctx.lineWidth = 0.5;
  const gs = 50;
  const offset = (now * 0.008) % gs;
  ctx.beginPath();
  for (let x = -gs + offset; x < W + gs; x += gs) {
    ctx.moveTo(x, 0); ctx.lineTo(x, H);
  }
  for (let y = -gs + offset; y < H + gs; y += gs) {
    ctx.moveTo(0, y); ctx.lineTo(W, y);
  }
  ctx.stroke();
  ctx.restore();

  // Scan line
  const scanY = (now * 0.04) % H;
  const g = ctx.createLinearGradient(0, scanY - 40, 0, scanY + 40);
  g.addColorStop(0, 'rgba(0,255,136,0)');
  g.addColorStop(0.5, 'rgba(0,255,136,0.03)');
  g.addColorStop(1, 'rgba(0,255,136,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, scanY - 40, W, 80);
}

function drawFpsGraph(ctx, x, y, w, h, history) {
  if (history.length === 0) return;
  const barW = Math.max(2, (w / CONFIG.fpsHistorySize) - 1);
  const maxFps = 72;

  ctx.save();
  // Graph background
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  roundedRect(ctx, x, y, w, h, 4);
  ctx.fill();

  // 60fps target line
  const target60Y = y + h - (60 / maxFps) * h;
  ctx.strokeStyle = 'rgba(0,255,136,0.15)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x, target60Y);
  ctx.lineTo(x + w, target60Y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(0,255,136,0.12)';
  ctx.font = `${CONFIG.fontSize - 3}px ${CONFIG.fontFamily}`;
  ctx.textAlign = 'left';
  ctx.fillText('60', x + 2, target60Y - 2);

  // Bars
  for (let i = 0; i < history.length; i++) {
    const val = Math.min(history[i], maxFps);
    const barH = (val / maxFps) * h;
    const bx = x + w - (history.length - i) * (barW + 1);
    const by = y + h - barH;

    if (val >= 55) ctx.fillStyle = 'rgba(0,255,136,0.5)';
    else if (val >= 30) ctx.fillStyle = 'rgba(255,170,0,0.5)';
    else ctx.fillStyle = 'rgba(255,68,85,0.5)';

    ctx.fillRect(bx, by, barW, barH);
  }

  // Label
  ctx.textAlign = 'right';
  ctx.fillStyle = CONFIG.colorDim;
  ctx.font = `${CONFIG.fontSize - 2}px ${CONFIG.fontFamily}`;
  ctx.fillText('FPS HISTORY (60s)', x + w - 2, y + CONFIG.fontSize - 2);
  ctx.restore();
}

function getStaleMs(type) {
  const cat = EVENT_CATEGORY[type];
  if (cat === 'oneshot') return Infinity;   // Never stale once received
  if (cat === 'continuous') return 5000;    // Stale after 5s of no input
  return 60000;                             // On-demand: stale after 60s
}

function getStatusColor(stat, now, type) {
  if (stat.count === 0) return CONFIG.colorError;
  if (now - stat.lastTime > getStaleMs(type)) return CONFIG.colorWarn;
  return CONFIG.colorOk;
}

function getStatusIcon(stat, now, type) {
  if (stat.count === 0) return '✗';
  if (now - stat.lastTime > getStaleMs(type)) return '◌';
  return '✓';
}

function getTypeColor(type) {
  const colors = {
    init: '#00ddff', resize: '#00ddff',
    mousemove: '#88ff88', click: '#ff8844',
    mousedown: '#ff6666', mouseup: '#66ff66',
    touchstart: '#ffaa00', touchmove: '#ffcc44', touchend: '#ff8800',
    context: '#cc88ff',
  };
  return colors[type] || CONFIG.colorValue;
}

function fpsColor(v) {
  if (v >= 55) return CONFIG.colorOk;
  if (v >= 30) return CONFIG.colorWarn;
  return CONFIG.colorError;
}

function fmtAge(ms) {
  if (ms < 1000) return `${ms|0}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatUptime(sec) {
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(0);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ${s}s`;
}

function pad(n, w) { return String(n).padStart(w); }

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
