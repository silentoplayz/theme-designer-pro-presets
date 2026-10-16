# CSS Presets

Short stylesheets that add to a theme what its palette can't: a glass input, a tinted bubble, accent headings, a monospace face. Each file is raw CSS that you paste into a mode's Custom CSS (Style Overrides), alone or on top of a theme.

Astral Glassmorphism, Gradient Background, Retro Terminal CRT, Tactical HUD and The Cyanotype take their colors from the palette through `var(--color-gray-*)`, so they follow whatever theme they're used with, in light and dark. The faithful ports (Rosé Pine, Windows Hot Dog Stand) and the presets whose idea is a fixed color (Matrix Colors, Pink Hues, Solar Flare, Ocean Waves) bring their own colors and define them for light and dark modes.

## The presets

| File | What it does | Pairs with |
|---|---|---|
| `astral_glassmorphism.css` | Frosted glass input, bubble and sidebar with a soft glow on headings and focus | any Canvas FX theme; made for Astral Projection |
| `font_menu.css` | A menu of system font stacks; change one line to switch the interface font, nothing downloads | any theme |
| `gradient_background.css` | A slow diagonal gradient from the palette behind a see-through chat, with a frosted sidebar | themes without Canvas FX or a gradient |
| `matrix_colors.css` | Phosphor-green accents, a faint grid behind the chat, monospace replies | Matrix Rain |
| `ocean_waves_companion.css` | Glass input and bubble, caustic hairlines and crest-colored links, in the colors of the Ocean Waves script | the Ocean Waves Canvas FX |
| `pink_hues.css` | Blush sidebar, pink bubble and hot-pink accents | Pink Hues |
| `retro_terminal_crt.css` | Still scanlines, a phosphor glow on monospace replies and a lit input, tinted by the palette | Retro Terminal, Matrix Rain, any green or amber theme |
| `rose_pine.css` | The Rosé Pine palette (main in dark modes, Dawn in light) on Open WebUI's gray scale, with its accents | Rosé Pine, or any plain theme |
| `solar_flare.css` | Gold headings with a faint corona, amber hairlines and a sunflare send button | Solar Flare |
| `tactical_hud.css` | Glass sidebar and input with a targeting glow, accent headings and table rules | the Tactical Liquid Grid Canvas FX |
| `the_cyanotype.css` | A faint drafting grid, flat hairline input and bubble, monospace headings | The Cyanotype |
| `windows_hotdog_stand.css` | The Windows 3.1 Hot Dog Stand scheme: red sidebar, yellow chat, black outlines and hard shadows, with a dark version | a plain theme without Canvas FX |

## Importing

- **File**: Style Overrides tab → Import → Import File → select a `.css` file
- **URL**: Style Overrides tab → Import → paste a raw URL → Load URL
- **Drag & drop**: Drag any `.css` file onto the Theme Designer Pro interface
- **Bulk**: Import `bundles/css-presets-all.json` or `bundles/everything.json` for all at once

Custom CSS is per mode, so paste a preset into each mode you want it in. With Auto-Scope on (the default), `:root` and `html` in a preset mean that mode's root, so one file serves every mode; the `html.dark` blocks hold the dark-mode values.

## Writing a preset

Follow the CSS rules in [CONTRIBUTING.md](../CONTRIBUTING.md#css-presets): style the rounded `#message-input-container`, never the square `#chat-input-container` inside it; recolor through the palette first; stable hooks only (`#sidebar`, `#sidebar-chat-item`, `.chat-user`, `.markdown-prose` and the like), no Tailwind utility classes and no bare `input`, `textarea`, `button` or `*` rules; keep Open WebUI's rounded shapes; `!important` only on backgrounds that Canvas FX transparency clears; and check light and dark. Start each file with a one-line comment saying what it does and what it pairs with, and keep it short. `node scripts/validate.js` checks the first rule and warns on the others.

## File Format

Individual presets are stored as raw `.css` files — the same format Theme Designer Pro uses when exporting a single CSS snippet. The preset name is derived from the filename on import.
