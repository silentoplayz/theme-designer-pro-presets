# Custom CSS for a theme

`create_theme` already adds frosted glass when `glass` is true: see-through panels with a blur over the sidebar, the message box and your own message bubbles, links and quotes in the accent, a selection color. Most themes need nothing more. Use `custom_css` for touches the description asks for that glass doesn't cover, such as rounder corners, a glow on the message box, a tinted scrollbar or borders in an accent.

## Rules the Launcher enforces

- At most 16 KB.
- No `@import`. A theme can't load a web font: use fonts every system has (`system-ui`, `ui-serif`, `ui-monospace`, `Georgia`, `"Courier New"`).
- `url()` only for `data:` URLs. A theme never fetches anything.
- No `expression()`, `javascript:`, `behavior` or HTML tags.

A stylesheet that breaks one comes back as "Not built" with the reason; fix it and call `create_theme` again.

## What to style

These are Open WebUI's own elements. Plain selectors are enough: Theme Designer Pro scopes the stylesheet to the theme's modes itself.

| Selector | What it is |
|---|---|
| `#sidebar` | The sidebar |
| `#sidebar-chat-item.selected` | The open chat in the sidebar |
| `#messages-container` | The scrolling list of messages |
| `.chat-user .rounded-3xl` | Your own message bubbles |
| `.markdown-prose` | The text of a reply; `.markdown-prose a`, `blockquote`, `hr` and `code` inside it |
| `#message-input-container` | The message box around the input |
| `#chat-input` | The text you type |
| `html` | For `scrollbar-color` and page-wide variables |

## The theme's variables

Use these instead of fixed colors, so the CSS follows the palette in every mode:

- `--color-gray-50` (lightest) to `--color-gray-950` (darkest), with steps 100, 200, 300, 400, 500, 600, 700, 800, 850 and 900 between. In Dark mode the page is about `--color-gray-900` and text about `--color-gray-100`; in Light mode the page is about `--color-gray-50` and text about `--color-gray-900`.
- `--tdp-accent`, `--tdp-accent-2`, `--tdp-accent-3`: the theme's three accents, already darkened for Light mode.
- With glass on, also `--tdp-glass`, `--tdp-glass-line` (a faint border), `--tdp-glass-glow` and `--tdp-glass-ring` (the accent at lower strengths).

Mix colors with `color-mix(in oklab, var(--tdp-accent) 30%, transparent)` rather than hard-coding transparency.

## `!important`

An animated background or gradient makes Open WebUI's own backgrounds transparent so it can show through. To give an element a background of its own again, as glass does, the `background-color` needs `!important`. Other properties don't.

## Examples

A soft glow around the message box while typing:

```css
#message-input-container:focus-within {
	box-shadow: 0 0 0 3px var(--tdp-glass-ring), 0 0 28px -6px var(--tdp-glass-glow) !important;
}
```

Rounder, accent-edged bubbles and a tinted scrollbar:

```css
.chat-user .rounded-3xl {
	border-radius: 22px !important;
	box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--tdp-accent) 35%, transparent);
}
html { scrollbar-color: color-mix(in oklab, var(--tdp-accent) 40%, transparent) transparent; }
```

A typewriter feel for replies:

```css
.markdown-prose { font-family: ui-monospace, "Courier New", monospace; letter-spacing: 0.01em; }
```

Keep text readable: don't set text colors that fight the palette, and don't hide or move Open WebUI's controls.
