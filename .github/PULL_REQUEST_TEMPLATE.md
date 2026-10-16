## Description

<!-- Brief description of what this PR adds or changes -->

## Preset Type

<!-- Check all that apply -->

- [ ] Canvas FX animation (`canvas-fx/*.js`)
- [ ] CSS preset (`css-presets/*.css`)
- [ ] Theme (`themes/*.json`)
- [ ] Gradient (`gradients/**/*.json`)
- [ ] Other (scripts, docs, schemas, etc.)

## Checklist

### All Presets
- [ ] Files are in the correct directory with `lowercase_with_underscores` naming
- [ ] Ran `node scripts/validate.js` locally — no errors

### Canvas FX (the [house standard](canvas-fx/README.md))
- [ ] Runs in the worker: no `document`, `window`, `localStorage` or `alert`, and no heartbeat
- [ ] Handles `init`, `resize`, `theme`, `motion`, `layout` and the pointer messages it uses; taps through `mousedown` only
- [ ] Follows the theme, keeps the canvas transparent and the chat column calm
- [ ] Elapsed-time motion, nothing allocated per frame, pixel ratio and reduced motion handled
- [ ] A header with `Title` and a one-line `Description`, and at least 10 settings with `(min-max)` ranges
- [ ] Checked with `tests/canvas-fx/harness.js`: no errors or flags

### Themes
- [ ] Valid JSON exported from Theme Designer Pro, every mode designed
- [ ] Custom CSS styles the rounded `#message-input-container`, never `#chat-input-container`
- [ ] `version` raised on any change to an existing theme
- [ ] Tested on desktop and mobile viewports

### CSS Presets
- [ ] Valid CSS that doesn't break core Open WebUI layout
- [ ] Uses CSS custom properties where appropriate

### Gradients
- [ ] Placed in the correct subdirectory (`still`/`animated` + `linear`/`radial`/`mesh`)
- [ ] Has a descriptive `name` field (not a timestamp)

## Notes

<!-- Any additional context, screenshots, or related issues -->
