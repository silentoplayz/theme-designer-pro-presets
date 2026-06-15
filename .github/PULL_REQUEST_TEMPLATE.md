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

### Canvas FX
- [ ] Web Worker compatible — no `document`, `window`, `localStorage`, or `alert`
- [ ] Handles `init`, `resize`, and `mousemove` messages
- [ ] Includes heartbeat (`self.postMessage({ type: 'heartbeat' })`)
- [ ] Uses `requestAnimationFrame` for the render loop
- [ ] Has a JSDoc header with `Title` and `Description`
- [ ] Performs well — no visible lag on mid-range hardware

### Themes
- [ ] Valid JSON exported from Theme Designer Pro
- [ ] Includes `dark` and `light` mode configurations at minimum
- [ ] Tested on desktop and mobile viewports

### CSS Presets
- [ ] Valid CSS that doesn't break core Open WebUI layout
- [ ] Uses CSS custom properties where appropriate

### Gradients
- [ ] Placed in the correct subdirectory (`still`/`animated` + `linear`/`radial`/`mesh`)
- [ ] Has a descriptive `name` field (not a timestamp)

## Notes

<!-- Any additional context, screenshots, or related issues -->
