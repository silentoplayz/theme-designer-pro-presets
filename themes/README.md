# Themes

Complete theme configurations for Theme Designer Pro. Each `.json` file is a full theme covering one or more modes (dark, light, OLED, her) with color tokens, CSS overrides, Canvas FX settings, and more.

## Importing

- **File**: Theme Library → Import (upload icon) → select a `.json` file
- **URL**: Theme Library → Import → paste a raw URL → Load URL
- **Drag & drop**: Drag any `.json` theme file onto the Theme Designer Pro interface
- **Bulk**: Import `bundles/themes-all.json` or `bundles/everything.json` for all at once

## File Format

Each theme JSON contains:

| Field | Description |
|---|---|
| `name` | Display name |
| `dark`, `light`, `oled`, `her` | Per-mode configurations |
| `description`, `author`, `version` | Optional metadata |
| `updateUrl` | Optional URL for automatic theme updates |

Each mode object includes OKLCH color values (`h`, `c`, `l`), CSS custom property `overrides`, `customCSS`, `canvasScript`, and various toggle flags.

See [`schemas/theme.schema.json`](../schemas/theme.schema.json) for the full specification.
