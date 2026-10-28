# Choosing the palette

Theme Designer Pro builds every gray in Open WebUI (backgrounds, panels, borders, text) from three numbers in the OKLCH color space, so a theme's whole look follows from `hue`, `chroma` and `lightness`. Accents are separate colors for links, focus rings, highlights and the animation.

## The three numbers

| `create_theme` argument | Range | What it does |
|---|---|---|
| `hue` | 0 to 360 | The color the grays lean toward. 0 red, 25 orange, 50 yellow, 90 chartreuse, 120 green, 165 teal, 200 cyan, 220 blue, 260 indigo, 290 purple, 330 pink. |
| `chroma` | 0 to 60 | How strongly the grays lean, in thousandths of OKLCH chroma. 0 to 4 is neutral gray; 6 to 12 a quiet tint; 14 to 28 clearly colored; 30 to 60 vivid, which suits a bold or playful theme and tires the eye on a theme for long work. |
| `lightness` | 5 to 30 | How light Dark mode is. 20 matches Open WebUI's own dark grays; 12 to 16 is a deep, rich dark; 5 to 10 is near black; 22 to 30 a softer, lighter dark. |

OLED mode takes the same hue and chroma at lightness 0, true black. Light and Her modes take the same hue at 60% of the chroma, at Open WebUI's own light grays, so one set of numbers makes all four modes. Use `mode` when the user asks for one mode only.

## Accents

Without `accent`, the theme's accent is generated from the hue: lightness 0.74 on Dark and OLED, 0.56 on Light and Her, colorfulness from the chroma. `accent2` and `accent3` are generated 40° either side. That's a calm, matching set.

Set them yourself when the theme has colors of its own: a sunset's coral and gold, a cyberpunk magenta and cyan, autumn's rust and amber. Give `#rrggbb` values that read on the Dark background (lightness around 0.65 to 0.8); the Launcher darkens them for Light mode itself. Animations draw with all three accents, so three distinct colors make a livelier animation; three close colors a calmer one.

## Gradients

Without an animation, the theme gets a gradient background. Empty `gradient_colors` makes a deep, quiet one from the hue. Give two to eight `#rrggbb` colors for one of your own, in the order they should run at 135°. Keep them dark (lightness under about 0.25) so text stays readable; the glass panels sit on top. Light mode keeps a pale gradient from the hue.

## Starting points

These are starting points, not answers: move the numbers toward what the user described.

| Mood | hue | chroma | lightness | accents |
|---|---|---|---|---|
| Calm ocean, lagoon | 195 to 210 | 22 to 32 | 14 to 16 | `#5fd4e6`, `#7fb2ff`, `#8ef0c6` |
| Forest, moss | 140 to 155 | 18 to 26 | 13 to 15 | `#8fd48a`, `#d9c06a`, `#6fc2a8` |
| Cozy autumn | 40 to 55 | 24 to 34 | 13 to 15 | `#e8a15a`, `#d4674a`, `#f0c674` |
| Warm copper | 35 to 45 | 28 to 36 | 14 to 16 | `#e09a6b`, `#f2c58a`, `#c97a5a` |
| Sunset | 20 to 30 | 30 to 40 | 14 to 16 | `#ff8a65`, `#ffc46b`, `#e86ba3` |
| Cyberpunk, neon city | 290 to 310 | 26 to 36 | 9 to 12 | `#ff3ec8`, `#33e1ff`, `#f8e45c` |
| Synthwave | 300 to 320 | 30 to 40 | 10 to 13 | `#ff6ad5`, `#ffb86b`, `#7ae7ff` |
| Rose, blossom | 345 to 360 | 18 to 26 | 15 to 18 | `#ff9fbf`, `#ffd1dc`, `#c99bff` |
| Night sky, space | 255 to 270 | 16 to 24 | 8 to 11 | `#9db4ff`, `#c9a6ff`, `#7fe0ff` |
| Minimal, focused | any | 0 to 6 | 14 to 20 | leave empty |
| Matrix, terminal | 140 to 150 | 30 to 40 | 6 to 9 | `#39ff7a`, `#b6ff6a`, `#2bd4a0` |

## Readability

The palette sets the text color too, so a few rules keep a theme readable:

- Very high chroma (over about 45) with lightness over 20 makes text feel washed; lower one of them.
- Near-black lightness (under 8) suits OLED-style themes; pair it with brighter accents so links still stand out.
- Glass panels (`glass`, on by default) need something behind them to look like glass: an animation or a gradient. On a still theme without a gradient, set `glass` to false.
