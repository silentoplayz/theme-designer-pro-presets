# Writing a Canvas FX animation

A Canvas FX animation is one JavaScript file that draws a theme's animated background behind Open WebUI. It runs behind a chat people read for hours, so a good one is beautiful in the margins, quiet behind the chat column, follows the theme's colors and costs little.

Start from `templates/animation.js`. It meets every rule on this page and passes Theme Designer Pro's own checks; change what it draws, keep its shape. `examples/ember_dream.js` (2D) and `examples/nebula_webgl.js` (WebGL) are two catalog animations to read for technique.

## Where it runs

An animation you write runs **isolated**: in a Web Worker, inside a sandboxed frame with no origin and a policy that allows no requests. It gets an `OffscreenCanvas` and messages, and nothing else.

- **It can only draw.** `fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, `import()` and every other request fail, and the Launcher refuses a script that names them.
- **There is no page.** `document`, `window`, `localStorage`, `sessionStorage`, `indexedDB` and `alert` don't exist; the Launcher refuses a script that uses them.
- **Nothing you post back is read.** No heartbeat, no `postMessage` to the page.
- **Fonts, images and other files can't be loaded.** Draw everything with canvas calls or WebGL.

## The messages

`self.onmessage` receives these. Handle `init`, `resize` and `theme`, plus whichever others the effect uses, in one `switch (e.data.type)`.

| Type | Payload | When |
|---|---|---|
| `init` | `{ canvas, width, height, dpr, reducedMotion, column, env, theme }` | Once, at start. `width` and `height` in CSS pixels; `dpr` the screen's pixel ratio; `reducedMotion` the viewer's setting; `column` the chat column; `theme` the palette |
| `resize` | `{ width, height, dpr }` | After the window stops resizing, and after a zoom |
| `theme` | `{ mode, dark, hue, chroma, colors, rgb, ramp }` | When the palette changes |
| `motion` | `{ reducedMotion }` | When the viewer turns reduce motion on or off |
| `layout` | `{ column }` | When the chat column moves: the sidebar opening, a resize, a page with or without a chat |
| `mousemove` | `{ x, y }` | At most once per frame |
| `mousedown`, `mouseup` | `{ x, y }` | A press and release, also on a touch's start and end |
| `click` | `{ x, y }` | After a press and release. Every click on the page arrives, the Send button's too, so don't act on it |
| `touchstart`, `touchmove`, `touchend` | `{ touches: [{ x, y }, ...] }` | For multi-touch effects |

`column` is `{ x, width, left, right }` in CSS pixels: the column's center and width, and the left and right edges of the chat area around it, which leave out the sidebar. It is `null` on a page without a chat.

`theme.colors` holds `background`, `surface`, `text`, `muted`, `accent`, `accent2` and `accent3` as `#rrggbb`; `theme.rgb` has the same colors as `[r, g, b]` from 0 to 1 for WebGL. `theme.dark` is false in Light and Her mode. The accents are the ones `create_theme` was given, or generated from the hue.

## The shape

```javascript
/**
 * Title: Lantern Drift
 * Description: One line that claims only what the code does.
 */

/* ────────── CONFIGURABLE VARIABLES ────────── */
const SPEED        = 1;          // overall speed (0-3)
const CENTER_CALM  = 0.85;       // how much it fades behind the chat column (0-1)
const FOLLOW_THEME = true;       // take the colors from the theme
const COLOR_A      = '#7aa2ff';  // first color when not following the theme
// ... at least ten settings, each `const NAME = value; // comment (min-max)`
/* ──────────────────────────────────────────── */
```

- The `Title:` line names the animation on the card.
- The Launcher refuses a script that doesn't open with this header block, has fewer than four settings above its first function, sets its message handler more than once, or never calls `getContext`. Starting from `templates/animation.js` avoids all four.
- The designer turns each constant between the banners into a slider, switch or color picker, with the range from its comment, so the user can tune it later.
- Tabs for indentation, 4 to 14 KB, never over 20 KB. The Launcher refuses anything over 40 KB.

## Color

- With `FOLLOW_THEME`, take `theme.colors` (or `theme.rgb`) from `init` and from every `theme` message. Keep the script's own colors only as the defaults for `FOLLOW_THEME = false`.
- Map roles, not hues: `muted` for structure, the three accents for highlights, `text` sparingly for bright cores, `background` only to fade toward.
- Recolor in place: rebuild cached colors, gradients and sprites on a `theme` message; never restart the scene.
- When `theme.dark` is false, draw with `source-over`, never `'lighter'`, and keep alphas a little lower: light backgrounds show everything.

## Composition

- **Keep the canvas transparent.** `clearRect` every frame, or fade trails with `globalCompositeOperation = 'destination-out'`. Never paint a backdrop: the theme's own background has to show through, and the glass panels sit on it.
- **Keep the chat column calm.** Scale alpha and density by `1 - CENTER_CALM * band(x)`, where `band` is 1 over the column and falls off smoothly beyond it. Center it on `column.x` with a half-width of `column.width / 2 + 56`; without a column, use the screen's center and about 520 px. Rebuild anything cached from it on `layout`.
- **Focal points go in the margins.** A sun, a core or a bloom sits between `column.left` and the column, or the column and `column.right`, so an open sidebar can't cover it, or in the bottom fifth.
- **The cursor starts off screen** (`-10000`) and its effect fades once it stops moving. Influence, don't control.
- **Taps through `mousedown` only**, gently. No full-screen flashes or strobes, and nothing busy over the column.
- **One signature moment** (a shooting star, a lantern lifting off, a strike of lightning) lifts a loop into a scene; keep it rare and in the margins.

## Cost

- Run everything on elapsed time: `const dt = Math.min((now - last) / 1000, 0.1)`. The clamp matters: frames are held while the page is hidden and released together when it returns.
- Allocate nothing per frame: no `new`, `[]`, `{}`, `create*Gradient` or color strings in the loop. Build colors and glows when the theme changes; draw glows as small pre-rendered sprites with `drawImage`; keep particles in typed arrays with a hard cap.
- Size the canvas at `width * dpr`, with `dpr` capped (2 for line art, 1 for soft glows), and `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` when you scale.
- With `reducedMotion`, slow to a drift or hold still, and drop sudden movement; handle `motion` too.

## WebGL

Use WebGL for fields, fluids, nebulae and glass; 2D for particles and shapes.

- `canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts)` with `{ premultipliedAlpha: true, alpha: true, antialias: false, depth: false, powerPreference: 'low-power' }`, and output premultiplied color with an alpha that lets the theme show.
- One fullscreen triangle (`[-1,-1, 3,-1, -1,3]`); set uniforms once per frame. Keep `u_time` bounded (wrap it) so noise keeps its precision.
- Handle `webglcontextlost` (call `preventDefault()`) and rebuild on `webglcontextrestored`. The Launcher refuses WebGL without it.
- Render soft effects at a fraction of the screen with a `RENDER_SCALE` setting (about 0.5).
- Check shader compile and link status and report failures with `console.error`. A canvas that has a WebGL context can't fall back to 2D.

## Checklist before calling `create_theme`

1. Header with `Title:` and a one-line `Description:`.
2. The settings banner with at least ten constants, `FOLLOW_THEME` and `CENTER_CALM` among them.
3. `switch` cases for `init`, `resize` and `theme`; `layout` if it uses the column.
4. No `document`, `window`, storage, `alert` or requests anywhere outside comments.
5. A transparent canvas, a calm column, colors from the theme, a light-mode path.
6. `dt` clamped; nothing allocated in the frame loop.
