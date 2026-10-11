# Event function tests

End-to-end tests for the Theme Designer Pro event function. [`e2e.js`](e2e.js) installs [`event-function/theme_designer_pro_event.py`](../../event-function/theme_designer_pro_event.py) on a running Open WebUI through its API, the way an admin would, and drives real pages in headless Chrome.

They cover how a theme reaches each page:

- the instance theme on app pages
- what a sign-in page shows under **Show on Auth Pages**, **Only on Auth Pages** and the **Enable Auth Page Theming** valve
- signing in without a reload, and signing out
- a personal theme replacing the instance theme, its custom CSS included, and **Use instance theme** reaching an open page live
- a Canvas FX animation starting on app pages and staying off where it's hidden
- deleting a gallery theme, **Wipe CSS Snippets** and **Wipe Canvas Presets** leaving the live theme alone
- the dot in Settings on the **Themes** tab whose theme is in use, and the ring a user without the Admin tab sees for the instance theme
- the designer opening without errors, with nothing to undo

The themes they save are markers, not palettes: each CSS section sets one custom property on `<html>` (`--tdp-vars`, `--tdp-structural`, `--tdp-gradient`, `--tdp-custom`) to the theme's name, so a test reads exactly which parts of which theme reached a page.

## In CI

[`event-function-tests.yml`](../../.github/workflows/event-function-tests.yml) runs them on every push and pull request that changes the function or the tests, and weekly. It runs them against Open WebUI's latest release and the oldest one the function supports (v0.11).

## Locally

They need a fresh, throwaway Open WebUI. They sign up its first account as admin, install the function and overwrite its themes, so never point them at an instance you use.

```bash
docker run -d --rm --name tdp-tests -p 127.0.0.1:3000:8080 \
  -e WEBUI_SECRET_KEY=tests -e ENABLE_OLLAMA_API=false -e ENABLE_OPENAI_API=false -e OFFLINE_MODE=true \
  ghcr.io/open-webui/open-webui:main
npm install --no-save playwright-core@1.56.1
BASE_URL=http://127.0.0.1:3000 node tests/event-function/e2e.js
docker stop tdp-tests
```

They need Google Chrome installed. `ONLY=<pattern>` runs the tests whose names match, and `FUNCTION_FILE=<path>` tests another copy of the function.
