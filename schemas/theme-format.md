# Theme format 1.0

This page is for anyone who writes a tool that reads or writes Theme Designer Pro themes, and for anyone who changes how the designer or the Studio handles them. It says what a theme file holds, how a reader fills in what a file leaves out, and how the format changes.

A theme file is one JSON object: the theme's name and details, and one object for each color mode. The designer in Open WebUI and the [Studio](https://silentoplayz.github.io/theme-designer-pro-presets/studio/) both read and write it, and [`theme.schema.json`](theme.schema.json) checks it.

```json
{
  "name": "Harbor",
  "author": "you",
  "version": "1.0.0",
  "dark": { "h": 220, "c": 18, "l": 14 },
  "light": { "h": 220, "c": 8, "l": 96 }
}
```

That is a complete theme. Every field left out takes its default, and the OLED and Her modes come from Dark and Light.

## The theme's details

| Field | Type | Meaning |
|---|---|---|
| `name` | string, required | The name the gallery shows |
| `dark` | mode, required | The Dark mode |
| `light` | mode, required | The Light mode |
| `oled` | mode | The OLED mode. Left out, it is Dark at lightness 0. |
| `her` | mode | The Her mode. Left out, it is a copy of Light. |
| `description` | string | A sentence or two for the gallery |
| `author` | string | Who made it |
| `version` | string | The theme's own version, such as `1.0.0`. The designer's update check compares it. |
| `targetVersion` | string | The Theme Designer Pro version it was made with |
| `repositoryUrl` | URL or `""` | Where its source lives |
| `updateUrl` | URL or `""` | The raw JSON address the designer checks for a newer version. Every theme in this repository's gallery has one. |

## A mode

Each mode is an object with the fields below. Only `h`, `c` and `l` are required.

### Palette

| Field | Type | Default | Meaning |
|---|---|---|---|
| `h` | number, 0 to 360 | 250 | Hue of the gray palette, in OKLCH degrees |
| `c` | number, 0 to 150 | 0 | Chroma, in thousandths: 18 is an OKLCH chroma of 0.018 |
| `l` | number, 0 to 100 | 20 | How light the palette is, in OKLCH percent. At 20 it matches Open WebUI's own grays, and every step moves with it. |
| `paletteEnabled` | boolean | true | Off, the mode keeps Open WebUI's own grays and ignores `h`, `c` and `l` |
| `overrides` | object | `{}` | Colors set for single palette steps, such as `"--color-gray-50": "#f8f9ff"`. Names are custom properties, values CSS colors of at most 64 characters. |
| `locks` | object | `{}` | Palette steps kept when the palette is regenerated, each `true` or `false` |
| `manualOverrides` | string | `""` | Palette steps written as CSS, one `--color-gray-N: value;` per line |
| `manualOverridesEnabled` | boolean | false | Whether `manualOverrides` applies |

### Custom CSS and Canvas FX

| Field | Type | Default | Meaning |
|---|---|---|---|
| `customCSS` | string | `""` | A stylesheet for this mode |
| `customCssEnabled` | boolean | false | Whether `customCSS` applies |
| `autoScope` | boolean | true | Whether `customCSS` is nested under this mode, so it applies only while the mode is on. Off, it is used as written. |
| `canvasScript` | string | `""` | A Canvas FX animation: Web Worker JavaScript that draws the background |
| `canvasEnabled` | boolean | false | Whether `canvasScript` runs |

### Gradient

| Field | Type | Default | Meaning |
|---|---|---|---|
| `gradientEnabled` | boolean | false | Whether the gradient background shows |
| `gradientType` | `linear`, `radial`, `conic` or `mesh` | `linear` | The kind of gradient |
| `gradientStops` | list of up to 32 `{ "color", "position" }` | `[]` | Colors along a linear, radial or conic gradient, `position` 0 to 100 |
| `gradientAngle` | number, 0 to 360 | 135 | Direction of a linear or conic gradient, in degrees |
| `gradientRadialPosX` | number, 0 to 100 | 50 | Horizontal center of a radial gradient, in percent |
| `gradientRadialPosY` | number, 0 to 100 | 50 | Vertical center of a radial gradient, in percent |
| `gradientRadialShape` | `circle` or `ellipse` | `ellipse` | Shape of a radial gradient |
| `gradientRadialSize` | `closest-side`, `closest-corner`, `farthest-side` or `farthest-corner` | `farthest-corner` | How far a radial gradient reaches |
| `gradientMeshPoints` | list of up to 32 `{ "color", "x", "y", "spread" }` | `[]` | Colors of a mesh gradient, each value 0 to 100 |
| `gradientMeshBgColor` | CSS color | `#0a0a12` | The color behind a mesh gradient's points |
| `gradientIntensity` | number, 0 to 100 | 85 | How strongly the gradient shows, in percent |
| `gradientAnimation` | boolean | false | Whether the gradient moves |
| `gradientAnimationSpeed` | number, 2 to 30 | 8 | Seconds for one cycle of the movement |

### Sign-in pages

The Show fields decide what a sign-in page shows. The Only fields take a part off the app's pages, so it shows on the sign-in pages alone. The designer lets an Only field be turned on only while its Show field is on, and a personal theme, which never reaches the sign-in pages, ignores the Only fields.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `themeShowAuth` | boolean | true | The palette shows on the sign-in pages |
| `customCssShowAuth` | boolean | true | The custom CSS shows on the sign-in pages |
| `canvasShowAuth` | boolean | true | The Canvas FX animation runs on the sign-in pages |
| `gradientShowAuth` | boolean | true | The gradient shows on the sign-in pages |
| `themeAuthOnly` | boolean | false | The palette stays off the app's pages |
| `customCssAuthOnly` | boolean | false | The custom CSS stays off the app's pages |
| `canvasAuthOnly` | boolean | false | The Canvas FX animation stays off the app's pages |
| `gradientAuthOnly` | boolean | false | The gradient stays off the app's pages |

## Reading a file

A reader takes a file the way the designer does:

1. A file without both `dark` and `light` isn't a theme. (The designer still reads the older shapes listed below.)
2. A missing `oled` is a copy of `dark` with `l` set to 0. A missing `her` is a copy of `light`.
3. A field left out of a mode takes its default. The one exception is `manualOverridesEnabled`: left out while `manualOverrides` has text, it is true, because files from before the switch existed meant their overrides to apply.
4. `null` in a switch reads as false. Older builds wrote `gradientAnimation: null`.
5. A number outside its range is moved to the nearest end of it. A value of the wrong type, a choice that isn't listed, or a color that isn't shaped like one takes the default. `overrides` names that aren't custom properties are dropped, and lists stop at 32 items.
6. `customCSS`, `canvasScript` and `manualOverrides` are read as written, since they are code. A Canvas FX script runs in the browser of everyone who sees the theme, so the designer asks before it applies a theme that has one.
7. Fields a reader doesn't know are ignored at the top level and kept as they are in a mode.

## Writing a file

- Write all four modes, and every field in each, defaults included. The designer and the Studio both do, so a file says the same thing to any reader of any version.
- Write switches as `true` or `false`, never `null`.
- Leave a link out, or write `""`, when there isn't one.

## Several themes in one file

A gallery backup holds a list of themes:

```json
{ "themes": [ { "name": "Harbor", "dark": { … }, "light": { … } } ], "isLibraryBackup": true, "version": "1.14.0" }
```

Each theme in `themes` is read as above, with one addition: in a backup, a Her mode at lightness 0 reads as lightness 20. `version` is the Theme Designer Pro version that wrote the backup. [`everything.schema.json`](everything.schema.json) describes a backup that also holds Canvas FX scripts, CSS snippets and gradients.

## Older files the designer still reads

Nothing should write these, but a file in one of these shapes still imports:

- A single palette, `{ "h": …, "c": …, "l": …, "overrides": { … } }`, with no modes. Dark and OLED get the palette and its overrides; Light and Her get the palette alone.
- A mode with `"oklch": { "hue": …, "chroma": …, "lightness": … }` in place of `h`, `c` and `l`.
- `locks` as a list of names rather than an object.

## The Studio

The Studio opens a gallery theme or a submitted one and downloads a new theme. Its modes are the opened theme's modes as the designer would read them, with whatever palette, gradient or Canvas FX was changed in the Studio. Its details are the Studio's own: the name typed in, with "(remix)" after a gallery theme's name until it is changed; the description "Made in the Theme Designer Pro Studio."; version `1.0.0`; the author typed in; and no links.

## Versions

This is version 1.0 of the format. Files don't name the version they follow, because 1.0 is the first one written down and every file so far fits it.

- **A new field** that leaves older files looking the same, with a default that does what files without it already did, makes a minor version: 1.1, 1.2 and so on. The designer, the Studio, the schema and this page change together in one commit.
- **Any change that makes an existing file look different**, such as a new meaning for a field or a new default, makes a major version: 2.0. It also needs a field in the file that tells readers which version it follows, added in that same version.

Two tests keep the copies of the format in step:

- [`tests/theme-format/check.js`](../tests/theme-format/check.js) reads the fields, defaults and limits out of this page, the schema, the designer and the Studio, and fails on any difference.
- The end-to-end test **a theme file keeps every setting through the Studio and the designer**, in [`tests/event-function/e2e.js`](../tests/event-function/e2e.js), sends every gallery theme and two fixtures through the Studio's Download button and the designer's import and export. It fails when either side changes a setting the other wrote, when the designer reads its own export differently, or when a file either side writes doesn't match the schema.

### Changes

- **1.0** (2026-10-11): First written version. The schema gained the gradient, palette switch and manual override fields that files already carried, `c` gained its upper limit of 150, and empty links became valid.
