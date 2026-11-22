# Event function tests

End-to-end tests for the Theme Designer Pro event function. [`e2e.js`](e2e.js) installs [`event-function/theme_designer_pro_event.py`](../../event-function/theme_designer_pro_event.py) on a running Open WebUI through its API, the way an admin would, and drives real pages in headless Chrome.

They cover how a theme reaches each page:

- the instance theme on app pages
- what a sign-in page shows under **Show on Auth Pages**, **Only on Auth Pages** and the **Enable Auth Page Theming** valve
- signing in without a reload, and signing out
- a personal save made before a page claims its live stream still reaching it, with nothing fetched twice
- a personal theme replacing the instance theme, its custom CSS included, and **Use instance theme** reaching an open page live
- a Canvas FX animation starting on app pages and staying off where it's hidden
- a running Canvas FX reading no layout and running no timers on an idle chat or Workspace page, the calm column following a sidebar toggle within 300 ms and Widescreen Mode, and a script's message count leaving out an open edit box and following the chat in view
- a mode switch from Open WebUI's Settings (OLED Dark included) and from `window.applyTheme` alone repainting, another tab's switch reaching the page, and a mode another script writes to `<html>` being put back
- deleting a gallery theme, **Wipe CSS Snippets** and **Wipe Canvas Presets** leaving the live theme alone
- the dot in Settings on the **Themes** tab whose theme is in use, and the ring a user without the Admin tab sees for the instance theme
- the Settings tabs and the Admin Panel's **Themes** link scheduling no work while a chat page's content changes, and that link opening the designer, closing for another page of the bar or Back, and coming back after a client-side trip out of the Admin Panel
- the designer opening without errors, with nothing to undo
- a chat theme signed the way the Launcher signs one refused when its custom CSS fetches (escaped `url()`, `image-set()`, `@import`, `src:`), and applied when it uses only quoted `data:` URLs
- Undo right after typing in an editor or turning a slider with the wheel undoing just that step, and Redo bringing it back
- an Animation Settings control changed right after typing in the Canvas FX editor keeping its value and focus
- a save in another designer reloading this one only once it stops typing and every save it queued has gone out, with what was typed saved and the last save's whole theme winning
- a designer whose live connection got a proxy's 502 reconnecting, and reloading for a save made while it was down but not again once it holds that save
- an app page doing no theme work while nothing changes, and a change in the designer reaching an open page in well under two seconds
- a model's background image hidden by the instance theme, live and after a page load, a folder's by a personal theme on that folder's page, the Chat Background Image hidden and then faded to 40%, and behind a Canvas FX animation by default, only while one runs and unless the theme turns it off, Open WebUI's dimming layer thinned by Dimming together with each image's opacity, and the sign-in page's picture: set by an admin only, served to signed-out visitors, drawn at its opacity, and gone with Enable Auth Page Theming off
- a theme file keeping every setting through the Studio and the designer: every gallery theme and the [theme format](../../schemas/theme-format.md)'s fixtures go through the Studio's Download button and the designer's import and export, and must come out as the other side wrote them

The themes they save are markers, not palettes: each CSS section sets one custom property on `<html>` (`--tdp-vars`, `--tdp-structural`, `--tdp-gradient`, `--tdp-custom`) to the theme's name, so a test reads exactly which parts of which theme reached a page.

## In CI

[`event-function-tests.yml`](../../.github/workflows/event-function-tests.yml) runs them on every push and pull request that changes the function, the tests, the theme schema or the Studio, and weekly. It runs them against Open WebUI's latest release and the oldest one the function supports (v0.13.4).

## Locally

They need a fresh, throwaway Open WebUI. They sign up its first account as admin, install the function and overwrite its themes, so never point them at an instance you use.

```bash
docker run -d --rm --name tdp-tests -p 127.0.0.1:3000:8080 \
  -e WEBUI_SECRET_KEY=tests -e ENABLE_OLLAMA_API=false -e ENABLE_OPENAI_API=false -e OFFLINE_MODE=true \
  ghcr.io/open-webui/open-webui:main
npm ci
npm install --no-save playwright-core@1.56.1
BASE_URL=http://127.0.0.1:3000 node tests/event-function/e2e.js
docker stop tdp-tests
```

They need Google Chrome installed. `ONLY=<pattern>` runs the tests whose names match, and `FUNCTION_FILE=<path>` tests another copy of the function. `WEBUI_SECRET_KEY` is the container's, `tests` when unset: one test signs a chat theme with it.

## Golden check

[`golden.py`](golden.py) proves a refactor kept the function's behavior. It runs the function's pure code over every theme in [`themes/`](../../themes) and the [theme format](../../schemas/theme-format.md)'s fixtures and compares the results with the files in [`golden/`](golden), one per theme plus one each for the theme-independent cases. It needs no Open WebUI, only node, Google Chrome, playwright-core and pydantic, and takes about 12 seconds.

```bash
npm install --no-save playwright-core@1.56.1
python3 tests/event-function/golden.py            # check
python3 tests/event-function/golden.py --update   # write the golden files again
FUNCTION_FILE=<path> python3 tests/event-function/golden.py
```

It reads three parts out of the function file and runs them as they are:

- the designer's JavaScript, in a blank page in headless Chrome: a theme file's import (`ensureAllModes`, `normalizeModeData`, `validateModeData`), all four sections `generateThemeSections` writes for every mode, the contrast report, the accents, the Canvas FX settings parser, and the sanitizers and parsers on values the code was written to refuse
- the bootloader's `enforceTheme`: the CSS a sign-in page and an app page get in each mode, from the sections in the state, from the flat CSS alone and for a personal theme, plus its smaller helpers
- the Python side, with stubs for the two `open_webui` modules it imports at load (`JSONCodec` is the `json` module, `DATA_DIR` a temporary folder): a theme saved the way the save route saves it, then `_postprocess_css`, `_postprocess_sections`, `/theme.css`, `/state.json` and the `/static/custom.css` fragment under every combination of Sidebar Transparency, Overlay Transparency, Enable Canvas FX and Enable Auth Page Theming, the state strippers, `_css_balanced` and the shared-asset registry's `asset_compose`

A difference fails it, printed once per distinct change with every theme it affects. A function it runs that has been renamed or removed fails it too, by name, rather than being skipped: point `golden.py` at the new name. When a change is meant to change the output, run `--update` and read the diff of `golden/` before committing it.

It doesn't cover what needs Open WebUI's page or a browser's timing: the designer's DOM and event handlers, Canvas FX running, live updates over SSE, Redis, the routes themselves and the admin tab scripts. Those are the end-to-end tests above. Four bootloader functions `enforceTheme` calls only for their effect on the live page (`announceThemeSource`, `syncHiddenBackgrounds`, `pushCanvasTheme`, `syncInstanceSharedCss`) are no-ops here. Two steps that live inline in the designer's event handlers are repeated in the harness around the real functions: building the theme from a file (`handleFilesImport`) and the state a save sends (`injectLive`). Contrast ratios and colors come from Chrome's own color conversion, so a Chrome update could move one by a rounding step.
