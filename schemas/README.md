# Schemas

JSON Schema definitions (draft-07) describing the data formats used by Theme Designer Pro presets.

## Available Schemas

| Schema | Describes |
|---|---|
| `theme.schema.json` | Individual theme preset — per-mode OKLCH colors, overrides, CSS, canvas settings |
| `canvas-preset.schema.json` | Canvas FX backup bundle (`isCanvasBackup` format) |
| `css-preset.schema.json` | CSS preset backup bundle (`isCssBackup` format) |
| `gradient-preset.schema.json` | Individual gradient preset — linear, radial, and mesh types |
| `everything.schema.json` | Combined bundle with all preset types in a single file |
| `manifest.schema.json` | Centralized theme update manifest for bulk version checking |

## Usage

These schemas document the expected structure of each file type. They can be used for:

- **Validation**: Verify preset files are correctly formatted before import
- **Editor support**: Reference in JSON files via `$schema` for autocomplete and inline validation
- **Documentation**: Understand the available fields and their types

### Example: Adding `$schema` to a theme file

```json
{
  "$schema": "https://raw.githubusercontent.com/silentoplayz/theme-designer-pro-presets/main/schemas/theme.schema.json",
  "name": "My Theme",
  "dark": { "h": 220, "c": 10, "l": 15 },
  "light": { "h": 220, "c": 8, "l": 90 }
}
```
