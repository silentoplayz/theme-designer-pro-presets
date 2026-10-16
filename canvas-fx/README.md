# Canvas FX

Animated backgrounds that run behind Open WebUI through Theme Designer Pro. Each file is one standalone script. The engine runs it in a Web Worker with an `OffscreenCanvas`, or on the page itself when the browser can't.

These scripts live behind a chat that people read for hours. Every one in this folder follows the house standard below: it takes its colors from the theme, stays quiet behind the chat column, and costs little when nobody is looking.

## Importing

- **File:** Canvas FX tab > Import > Import File, then pick a `.js` file
- **URL:** Canvas FX tab > Import, paste a raw URL, then Load URL
- **Drag and drop:** drop a `.js` file on the designer
- **All at once:** import `bundles/canvas-fx-all.json` or `bundles/everything.json`

Each script's settings show under the editor as sliders, switches and color pickers, read from the constants at its top.

## What a script receives

The engine sends messages to `self.onmessage`. A script handles `init` and `resize`, and whichever others it uses.

| Type | Payload | When |
|---|---|---|
| `init` | `{ canvas, width, height, dpr, reducedMotion, env, theme }` | Once, at start. `width` and `height` are in CSS pixels. `dpr` is the screen's pixel ratio, `reducedMotion` whether the viewer asked their system to reduce motion, `theme` the palette (below). |
| `resize` | `{ width, height, dpr }` | 150 ms after the window stops resizing, and after a zoom |
| `theme` | `{ mode, dark, hue, chroma, colors, rgb, ramp }` | When the palette changes while the script runs |
| `motion` | `{ reducedMotion }` | When the viewer turns reduce motion on or off |
| `mousemove` | `{ x, y }` | At most once per frame |
| `mousedown`, `mouseup` | `{ x, y }` | On a press and release, and on a touch's start and end |
| `click` | `{ x, y }` | On a click. Also fires after a `mousedown` and `mouseup` |
| `touchstart`, `touchmove`, `touchend` | `{ touches: [{ x, y }, ...] }` | For multi-touch effects |
| `context` | `{ messages, chars, estimatedTokens }` or `{ exactTokens, ... }` | At most every 2 s while the chat changes |

`theme.colors` holds `background`, `surface`, `text`, `muted`, `accent`, `accent2` and `accent3` as `#rrggbb`, and `theme.rgb` the same colors as `[r, g, b]` from 0 to 1, ready for a WebGL uniform. `theme.dark` is false in Light and Her.

The engine listens to nothing a script posts back, so a script needs no heartbeat.

## The house standard

### Shape

- A header comment with `Title:` and a one-line `Description:` that claims only what the code does.
- The settings block, framed by the `CONFIGURABLE VARIABLES` banner, one constant per line with a short comment and its range as `(min-max)`. At least ten settings, including `FOLLOW_THEME`, `CENTER_CALM` and a motion or speed setting.
- One `self.onmessage` switch. No `document`, `window` or `localStorage` in the code, so the script runs in the worker. Tabs for indentation, 4 to 14 KB, never over 20 KB.

### Color

- Keep the script's own colors as the defaults for `FOLLOW_THEME = false`, and take `theme.colors` or `theme.rgb` when it is true, from `init` and from every `theme` message.
- Map roles, not hues: `muted` for structure, the three accents for highlights, `text` sparingly for bright cores, `background` only to fade toward.
- Recolor in place. Rebuild cached colors, gradients and sprites on a theme change; never restart the scene.
- When `theme.dark` is false, draw with `source-over`, never `'lighter'`, and keep alphas lower, since light backgrounds show everything.

### Composition

- Keep the canvas transparent. Clear each frame, or fade trails with `globalCompositeOperation = 'destination-out'`. Never paint a backdrop: the theme's own background shows through.
- Keep the chat column calm. Open WebUI's messages and input sit in a column up to 928 px wide near the middle of the screen. Scale alpha and density there by `1 - CENTER_CALM * band(x)`, where `band` falls off smoothly about 520 px either side of center. Put focal points (a sun, a core, a bloom) in the outer thirds or the bottom fifth.
- Start the cursor off screen and let its effect fade once it stops moving.
- Every click on the page reaches the script, the Send button's included. Answer taps through `mousedown` alone, which also fires on touch, so one tap never acts twice, and keep the answer gentle.
- No full-screen flashes or strobes, and no noise over the column.

### Cost

- Drive everything by elapsed time: `dt = Math.min((now - last) / 1000, 0.1)`. The clamp matters, because the engine holds a script's frames while its page is hidden or covered and releases them when it returns.
- Allocate nothing per frame: no `new`, no `[]` or `{}`, no `create*Gradient`, no color strings built in the loop. Precompute colors at theme changes and glows as small sprites drawn with `drawImage`. Pool particles in typed arrays with a hard cap.
- Size the canvas at `width * dpr`, with `dpr` capped (2 for line art, 1 for soft effects), and `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`. Soft shader effects render at a fraction of the screen with a `RENDER_SCALE` setting, and slow ones cap their frame rate with `MAX_FPS`.
- With `reducedMotion`, slow down to a drift or hold still, and drop sudden movement.

### WebGL

- Ask for `webgl2`, then `webgl`, with `premultipliedAlpha: true` and `antialias: false`, and output premultiplied color with an alpha that lets the theme show.
- One fullscreen triangle; set uniforms only per frame. Keep `u_time` bounded so noise keeps its precision.
- Handle `webglcontextlost` (call `preventDefault`) and rebuild on `webglcontextrestored`.
- Report shader errors with `console.error`. A canvas that holds a WebGL context can't fall back to 2D.

[`nebula_webgl.js`](nebula_webgl.js) follows every point and is the reference to copy. The designer's Docs tab has the full protocol and a minimal template.

## Context-aware scripts

Files starting with `context_` grow with the conversation through the `context` message. Prefer `exactTokens` when it arrives, fall back to `estimatedTokens`, ease toward each new value instead of jumping, and return to the empty state when `messages` drops to 0 on a new chat. They must still look finished at zero.
