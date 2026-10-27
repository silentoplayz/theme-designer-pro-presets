# Launcher tests

End-to-end tests for the [Theme Designer Pro Launcher](../../launcher/). [`e2e.js`](e2e.js) installs the event function and the Launcher on a running Open WebUI through its API, gives a model the Launcher with native function calling, and chats with it in headless Chrome. The model is [`scripted_model.py`](scripted_model.py), an OpenAI-compatible stub that calls the Launcher's tools with fixed arguments, so the tests need no real model.

They cover:

- a described theme showing a card, not the designer, with the catalog animation it asked for and glass panels
- **Preview** opening a larger live preview, with the chat's frame growing to fit it
- **Apply** putting the theme on the user's own theme and adding it to their gallery, with the open page following live; **Undo** going back to the instance theme; applying it again without adding it twice
- a theme changed after signing, or another account opening the signed link, applying nothing
- a still theme getting the gradient, and a theme for one mode leaving the others alone
- an admin's theme "for everyone" changing the instance theme
- asking to open the designer still opening it in the chat
- the card without **iframe Sandbox Allow Same Origin**: it previews and names the setting, and **Apply** stays off
- the card on a phone-sized screen

## Locally

They need a fresh, throwaway Open WebUI whose only OpenAI connection is the stub. They sign up its first account as admin and change its themes, so never point them at an instance you use. The animated backgrounds come from this repository's catalog on GitHub, so the Open WebUI container needs internet access.

```bash
docker network create tdp-launcher
docker run -d --rm --name tdp-stub --network tdp-launcher -v "$PWD/tests/launcher:/stub:ro" python:3.12-slim \
  sh -c "pip install -q fastapi uvicorn && uvicorn scripted_model:app --host 0.0.0.0 --port 8000 --app-dir /stub"
docker run -d --rm --name tdp-launcher-tests --network tdp-launcher -p 127.0.0.1:3000:8080 \
  -e WEBUI_SECRET_KEY=tests -e ENABLE_OLLAMA_API=false -e ENABLE_OPENAI_API=true \
  -e OPENAI_API_BASE_URLS=http://tdp-stub:8000/v1 -e OPENAI_API_KEYS=test -e BYPASS_MODEL_ACCESS_CONTROL=true \
  ghcr.io/open-webui/open-webui:main
npm ci
npm install --no-save playwright-core@1.56.1
BASE_URL=http://127.0.0.1:3000 node tests/launcher/e2e.js
docker stop tdp-launcher-tests tdp-stub && docker network rm tdp-launcher
```

They need Google Chrome installed (`CHROME_PATH` points at another copy). `ONLY=<pattern>` runs the tests whose names match, and `OUT=<folder>` keeps their screenshots.

`BYPASS_MODEL_ACCESS_CONTROL=true` lets the test user reach the stub's model through the Launcher-equipped model the tests create.
