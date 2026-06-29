# Canvas FX

JavaScript animation scripts that run behind the Open WebUI interface via OffscreenCanvas in a Web Worker. Each file is a standalone `.js` script.

## Importing

- **File**: Canvas FX tab → Import → Import File → select a `.js` file
- **URL**: Canvas FX tab → Import → paste a raw URL → Load URL
- **Drag & drop**: Drag any `.js` file onto the Theme Designer Pro interface
- **Bulk**: Import `bundles/canvas-fx-all.json` or `bundles/everything.json` for all at once

## Configurable Scripts

Scripts with a `CONFIG` block at the top include tunable properties — colors, speeds, particle counts, physics constants, and more. Edit the values directly in the Canvas FX editor and click Apply.

## Web Worker API

All scripts must follow this contract:

```javascript
self.onmessage = (e) => {
  switch (e.data.type) {
    case 'init':      // { canvas: OffscreenCanvas, width, height }
    case 'resize':    // { width, height }
    case 'mousemove': // { x, y }
    case 'click':     // { x, y }
    case 'mousedown': // { x, y }
    case 'mouseup':   // { x, y }
    case 'touchstart':// { x, y }
    case 'touchmove': // { x, y }
    case 'touchend':  // { }
    case 'context':   // { theme, mode } — sent on theme/mode change
  }
};

// Heartbeat to prevent worker termination
setInterval(() => { self.postMessage({ type: 'heartbeat' }); }, 1000);

// Use requestAnimationFrame for the render loop
// NO DOM access (no document, window, alert, localStorage)
```
