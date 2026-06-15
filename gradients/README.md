# Gradients

Gradient presets for backgrounds, panels, and UI elements. Each `.json` file defines a single gradient with its type, color stops, and animation settings.

## Directory Structure

```
gradients/
├── animated/           # Animated/transitioning gradients
│   ├── linear/
│   ├── mesh/
│   └── radial/
└── still/              # Non-animated gradients
    ├── linear/
    ├── mesh/
    └── radial/
```

## Importing

- **File**: Gradient tab → Import → select a `.json` file
- **URL**: Gradient tab → Import → paste a raw URL → Load URL
- **Drag & drop**: Drag any gradient `.json` onto the Theme Designer Pro interface
- **Bulk**: Import `bundles/gradients-all.json` for all gradients, or use the filtered bundles:
  - `bundles/gradients-still.json` — static gradients only
  - `bundles/gradients-animated.json` — animated gradients only

## Gradient Types

| Type | Description |
|---|---|
| `linear` | Directional gradient defined by angle and color stops |
| `radial` | Circular/elliptical gradient with configurable center, shape, and size |
| `mesh` | Multi-point gradient with individually positioned color nodes and spread |

See [`schemas/gradient-preset.schema.json`](../schemas/gradient-preset.schema.json) for the full specification.
