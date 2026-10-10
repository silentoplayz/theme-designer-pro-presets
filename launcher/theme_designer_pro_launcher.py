"""
title: Theme Designer Pro Launcher
author: @G30
author_url: https://openwebui.com/u/g30
funding_url: https://buymeacoffee.com/iamg30
version: 1.1.0
license: MIT
required_open_webui_version: 0.10.0
description: Opens the Theme Designer Pro event function's designer inside a chat, and
  applies a theme someone describes in the chat. Users get their own personal theme
  when the event function's Allow Personal Themes valve is on; admins can also change
  the instance theme. Requires the Theme Designer Pro event function.
"""

import base64
import hashlib
import hmac
import json
import time
from urllib.parse import quote

from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

# Must match the event function's APPLY_TOKEN_PREFIX: it checks what this signs.
APPLY_TOKEN_PREFIX = "tdp-apply.v1."
# A theme link from a chat applies within this many seconds, then opens plainly.
APPLY_TOKEN_SECONDS = 300
MODES = ("all", "dark", "oled", "light", "her")


class Tools:
    class Valves(BaseModel):
        designer_url: str = Field(
            default="/api/v1/theme-designer",
            description="Route where the Theme Designer Pro event function serves its page. Must match the event function's designer_url valve.",
        )
        iframe_height: int = Field(
            default=800,
            description="Visible height of the embedded designer container in pixels.",
        )
        iframe_scale: float = Field(
            default=1.0,
            description="Scale factor for the designer page inside the iframe. Lower values fit more content but make it smaller. 1.0 = native size.",
        )

    def __init__(self):
        self.valves = self.Valves()

    def _designer_url(self, personal: bool, apply_token: str = "") -> str:
        url = self.valves.designer_url.rstrip("/")
        params = []
        if personal:
            params.append("scope=me")
        if apply_token:
            params.append("apply=" + quote(apply_token, safe=""))
        return url + ("?" + "&".join(params) if params else "")

    @staticmethod
    def _sign(user_id: str, personal: bool, theme: dict) -> str:
        """A token the event function accepts for this user only, for five
        minutes: the values a chat asked for, signed with WEBUI_SECRET_KEY."""
        from open_webui.env import WEBUI_SECRET_KEY

        if not WEBUI_SECRET_KEY:
            return ""
        payload = {
            "u": user_id,
            "x": int(time.time()) + APPLY_TOKEN_SECONDS,
            "s": "me" if personal else "everyone",
            **theme,
        }
        body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")).decode("ascii").rstrip("=")
        sig = base64.urlsafe_b64encode(
            hmac.new(WEBUI_SECRET_KEY.encode("utf-8"), (APPLY_TOKEN_PREFIX + body).encode("ascii"), hashlib.sha256).digest()
        ).decode("ascii").rstrip("=")
        return APPLY_TOKEN_PREFIX + body + "." + sig

    async def open_theme_designer(
        self, my_theme: bool = False, __user__: dict = {}
    ) -> tuple:
        """
        Open the Theme Designer Pro designer inside the chat.

        When to use: The user wants to open, browse, or manually work with the theme designer.
        Trigger phrases: "open theme designer", "launch theme designer", "customize my theme",
        "edit my theme", "open the theme editor", "theme settings".

        Do NOT use this when the user describes colors, a mood or an aesthetic they want; use apply_theme for that.

        Parameters:
        - my_theme: For admins only. True opens the admin's own personal theme; False (default) opens the
          instance theme every user sees. Users always get their own personal theme.
        """
        personal = __user__.get("role") != "admin" or bool(my_theme)
        url = self._designer_url(personal)
        return await self._embed(
            url,
            url,
            "The designer is open in the chat, on "
            + ("the user's own personal theme." if personal else "the instance theme every user sees."),
        )

    async def apply_theme(
        self,
        hue: int,
        chroma: int,
        lightness: int,
        gradient: bool = True,
        description: str = "",
        mode: str = "all",
        everyone: bool = False,
        __user__: dict = {},
    ) -> tuple:
        """
        Apply a color theme the user describes, by translating it into OKLCH values, then open the designer for fine-tuning.

        When to use: The user describes a theme they want in natural language (colors, mood, aesthetic).
        Use this INSTEAD of open_theme_designer when the user mentions specific colors, vibes, or aesthetics.
        Trigger phrases: "give me a blue theme", "warm copper look", "make it darker", "I want something purple", "ocean vibe".

        Parameters:
        - hue: Color hue angle (0-360). Guide: 0=red, 25=orange, 50=yellow, 90=chartreuse, 120=green, 165=teal, 210=blue, 260=indigo, 290=purple, 330=pink/magenta.
        - chroma: Color saturation (0-40). 3-8=muted/neutral, 10-20=balanced, 25-40=vivid/saturated.
        - lightness: Base lightness for dark modes (5-30). 5-10=very dark, 12-18=standard dark, 20-30=lighter.
        - gradient: Add a matching gradient background from the hue (default: True).
        - description: A short theme name shown when it applies (e.g. "Warm Copper", "Arctic Frost").
        - mode: Which mode(s) to apply to. Options: "all" (default), "dark", "oled", "light", "her".
        - everyone: For admins only. True changes the instance theme every user sees, and only when the admin
          clearly asks for that (e.g. "for everyone", "for the whole instance"). Default False: the user's own
          personal theme. Users always get their own personal theme.

        The designer opens with the theme applied, so the user can fine-tune it with the sliders.
        """
        personal = __user__.get("role") != "admin" or not everyone
        theme = {
            "h": max(0, min(360, int(hue))),
            "c": max(0, min(40, int(chroma))),
            "l": max(0, min(50, int(lightness))),
            "g": bool(gradient),
            "n": " ".join(str(description or "").split())[:60],
            "m": mode if mode in MODES else "all",
        }
        token = self._sign(str(__user__.get("id") or ""), personal, theme) if __user__.get("id") else ""
        return await self._embed(
            self._designer_url(personal, token),
            # The pop-out link opens the designer without re-applying the theme.
            self._designer_url(personal),
            "The designer is open in the chat and applies "
            + (f'"{theme["n"]}"' if theme["n"] else "the theme")
            + " as it loads, to "
            + ("the user's own personal theme" if personal else "the instance theme every user sees")
            + ". They can fine-tune it there.",
        )

    async def _embed(self, frame_url: str, popout_url: str, result: str) -> tuple:
        """The designer in a frame, shown in the chat."""
        h = self.valves.iframe_height
        scale = self.valves.iframe_scale
        inner_h = int(h / scale)
        inner_w_pct = 100 / scale

        headers = {"Content-Disposition": "inline"}

        content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Theme Designer Pro</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}

        body {{
            background: transparent;
            overflow: hidden;
        }}

        .toolbar {{
            display: flex;
            justify-content: flex-end;
            padding: 6px 8px;
        }}

        .popout {{
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            font-size: 11px;
            color: #71717a;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 8px;
            border-radius: 6px;
            transition: color 0.2s;
        }}
        .popout:hover {{
            color: #d4d4d8;
        }}

        .frame-container {{
            width: 100%;
            height: {h}px;
            overflow: hidden;
            border-radius: 12px;
        }}

        .notice {{
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            font-size: 13px;
            line-height: 1.5;
            color: #a1a1aa;
            padding: 12px 14px;
            border: 1px solid #27272a;
            border-radius: 12px;
        }}

        .designer-frame {{
            width: {inner_w_pct}%;
            height: {inner_h}px;
            border: none;
            display: block;
            background: #09090b;
            transform: scale({scale});
            transform-origin: 0 0;
        }}
    </style>
</head>
<body>
    <div class="toolbar">
        <a href="{popout_url}" target="_blank" rel="noopener" class="popout">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            Pop out
        </a>
    </div>
    <div class="notice" id="tdp-sandbox-notice" hidden>
        To open the designer here, turn on <b>Settings &gt; Interface &gt; iframe Sandbox Allow Same Origin</b>,
        then ask again. You can also use <b>Pop out</b> above.
    </div>
    <div class="frame-container" id="tdp-frame">
        <iframe
            src="{frame_url}"
            class="designer-frame"
            allow="clipboard-read; clipboard-write"
        ></iframe>
    </div>
    <script>
        // Without that setting, this frame has no origin, so the browser
        // sends the designer no sign-in and it could only show an error.
        if (window.origin === 'null') {{
            document.getElementById('tdp-frame').remove();
            document.getElementById('tdp-sandbox-notice').hidden = false;
        }}
    </script>
</body>
</html>"""

        # Open WebUI shows an inline HTMLResponse as an embed in both function
        # calling modes; the text beside it is what the model reads.
        return HTMLResponse(headers=headers, content=content), result
