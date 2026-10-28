---
name: theme-designer-pro
description: Design a new Open WebUI theme from a description and hand it to the Theme Designer Pro Launcher's create_theme tool, which shows it in the chat as a card the user can preview and apply. Covers choosing the palette and accents, gradients, frosted glass, custom CSS, and writing a new animated Canvas FX background when the catalog has nothing that fits the idea.
---

# Theme Designer Pro: design a theme

This skill turns what someone says about a look ("make my chat a koi pond", "something cozy with lanterns", "a neon city at night") into a complete theme: a palette and accents, a background (a catalog animation, a new animation you write, or a gradient), frosted glass panels and any extra CSS. You pass it all to `create_theme` in one call. The Launcher checks it and shows a card with a live preview; the user presses **Apply** to put it on.

It doesn't apply anything itself, and it can't change Open WebUI's code or layout. A new animation runs isolated: it can draw, but it can't reach the user's account, the page or the network, and the Launcher refuses one that tries.

## When to Use

- "Give me a … theme", "make my chat look like …", "change my theme to …", "a theme for everyone" (admins).
- "Something with a [scene] in the background": lanterns, aquarium, rain on a window, a desert at night, falling sakura, a campfire.
- "Make me a new animation", "design an original theme", "surprise me".
- "Make it warmer / darker / more purple": build it again with new numbers.

Not for: opening the designer to edit by hand (use `open_theme_designer`), or questions about installing Theme Designer Pro.

## Prerequisites

- The **Theme Designer Pro Launcher** tool (2.1.0 or later) turned on in this chat, so `create_theme` is available. If it isn't, tell the user to turn it on from the tools button; don't paste theme code into the chat instead.
- The **Theme Designer Pro** event function on the instance: 1.17.0 or later to apply a theme, 1.18.0 or later to apply one with an animation you wrote. The card tells the user if theirs is too old.

## How to Run

1. Read what the user asked for: the place or mood, colors they named, Dark or Light, one mode or all, just for them or "for everyone".
2. Choose the palette with `references/palette.md`; read it with `read_skill_file` the first time in a chat.
3. Choose the background:
   - **A catalog animation** when one fits: pass a few words in `background` (see Quick Reference).
   - **A new animation** when the idea isn't in the catalog, or the user asks for something new or original. Read `references/canvas-fx.md` and `templates/animation.js`, then write it in `animation_code`, starting from the template.
   - **A gradient** for a still theme: leave both empty, and set `gradient_colors` if the theme has colors of its own.
4. Keep `glass` on when there's an animation or a gradient. Add `custom_css` only for touches glass doesn't cover; read `references/css.md` first.
5. Call `create_theme` once, with everything.
6. If it answers "Not built: …", fix exactly what it names and call it again. After two failed tries, use a catalog animation or a gradient instead and say so.
7. Reply in one or two sentences: what the theme looks like and that **Apply** on the card puts it on. Don't paste the code: the card has **View code**.

## Quick Reference

`create_theme` arguments:

| Argument | Use |
|---|---|
| `name` | Short and evocative: "Lantern Drift", "Honu Lagoon" |
| `description` | One sentence about how it looks |
| `hue`, `chroma`, `lightness` | The palette (`references/palette.md`) |
| `accent`, `accent2`, `accent3` | `#rrggbb`, or empty to generate from the hue |
| `background` | Words for a catalog animation |
| `animation_code` | A whole Canvas FX script you wrote; wins over `background` |
| `glass` | Frosted panels, default on |
| `custom_css` | Extra CSS (`references/css.md`) |
| `gradient`, `gradient_colors` | The still background, when there's no animation |
| `mode` | `all` (default), `dark`, `oled`, `light` or `her` |
| `everyone` | Admins only, when they ask for the instance theme |

Catalog animations, by the words that find them: koi pond, deep ocean with jellyfish, ocean waves, aurora, falling leaves, snow, rain and lightning, thunderstorm, fireflies, embers, lava lamp, starry constellations, galaxy nebula, matrix rain, synthwave sun, neon city in the rain, bubbles, butterflies, fireworks, sandstorm, circuit board, neural network, ink bloom, liquid chrome, stained glass, topographic map, eclipse, mountains at dusk, lava rivers, plasma.

Files in this skill:

| File | What it holds |
|---|---|
| `references/palette.md` | Hue, chroma and lightness, accents, gradients, mood starting points |
| `references/canvas-fx.md` | Writing an animation: the messages, the rules, the isolated runtime |
| `references/css.md` | Open WebUI's elements, the theme's variables, what CSS may do |
| `templates/animation.js` | A complete animation that meets every rule: start here |
| `examples/ember_dream.js`, `examples/nebula_webgl.js` | Two catalog animations to learn from, 2D and WebGL |

## Procedure

Writing a new animation:

1. Read `templates/animation.js` with `read_skill_file`. Read `references/canvas-fx.md` if you haven't in this chat.
2. Decide the scene in one sentence: what moves, where (the margins beside the chat, or the bottom fifth), how it answers the cursor, and one rare signature moment.
3. Copy the template. Change the `Title:` and `Description:` lines to the new scene.
4. Replace the settings between the banners with the scene's own: at least ten, keeping `CENTER_CALM`, `FOLLOW_THEME` and the three fallback colors, each with its `(min-max)` range.
5. Replace what the template draws (its motes, `respawn` and the drawing loop) with the scene. Keep its `band()`, `colX()` and `colHalf()` helpers, the `dt` clamp, the typed arrays, the sprite approach and the whole `self.onmessage` switch.
6. Check it against the checklist at the end of `references/canvas-fx.md`.
7. Pass the whole script, header to last line, as `animation_code`.

## Pitfalls

- **"Not built: … it uses `document`"** (or `window`, storage, `fetch` and the like): the animation runs in an isolated worker. Draw with the canvas you're given; remove the rest.
- **"Not built: … header block", "… settings", "… handler more than once":** the script didn't keep the template's shape. Copy `templates/animation.js` and change only what it draws: keep its header, its settings above the first function, and its one `self.onmessage` switch. Never assign `self.onmessage` inside a case.
- **A backdrop hides the theme.** Filling the canvas with a color covers the palette and the glass. Clear it instead.
- **Busy behind the chat.** Without the calm band the animation fights the text people read. Keep `band(x)` on every alpha.
- **Hard-coded colors.** Read `theme.colors`; the user's accents and Light mode depend on it.
- **Light mode.** `'lighter'` blending vanishes on a light background; use `source-over` when `theme.dark` is false.
- **Cost.** Building gradients, arrays or color strings in the frame loop makes it stutter. Build them once per theme change.
- **Too big.** Keep it under 20 KB; the Launcher refuses anything over 40 KB.
- **Claiming it's applied.** Nothing changes until the user presses **Apply** on the card.

## Verification

The card appears with the theme's name, "(new)" after the animation's title, and a moving thumbnail. If the card says "The animation stopped with an error", the script threw: read the message, fix that line, and call `create_theme` again.
