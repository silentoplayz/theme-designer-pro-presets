"""
title: Theme Designer Pro Launcher
author: @G30
author_url: https://openwebui.com/u/g30
funding_url: https://buymeacoffee.com/iamg30
version: 1.0.1
license: MIT
required_open_webui_version: 0.10.0
description: Admin-only tool that opens the Theme Designer Pro event function's
  full designer page inside an iframe within chat. Requires the Theme Designer Pro
  event function to be installed and running.
"""

from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field


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

    async def open_theme_designer(
        self, __user__: dict = {}, __event_emitter__=None
    ) -> HTMLResponse:
        """
        Open the Theme Designer Pro interface inside an embedded iframe.

        When to use: The user wants to open the full server-connected Theme Designer Pro.
        Trigger phrases: "open theme designer", "launch theme designer", "customize my theme",
        "edit my theme", "open the theme editor", "theme settings".

        This tool opens the event function's designer page — the full-featured version with
        server persistence, SSE live push, Canvas FX engine, and gradient builder.

        Admin only — non-admin users receive an access denied message.
        """
        if __user__.get("role") != "admin":
            return "⛔ Theme Designer Pro is only available to administrators."

        url = self.valves.designer_url
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
        <a href="{url}" target="_blank" rel="noopener" class="popout">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            Pop out
        </a>
    </div>
    <div class="frame-container">
        <iframe
            src="{url}"
            class="designer-frame"
            allow="clipboard-read; clipboard-write"
        ></iframe>
    </div>
</body>
</html>"""

        # Emit the embed directly so the designer renders in BOTH native and legacy
        # function-calling modes. Returning an HTMLResponse alone only renders in
        # legacy mode — the native tool handler attaches embeds to
        # `function_call_output` items that the frontend never maps to
        # `message.embeds`. Emitting the event ourselves sets `message.embeds` on
        # the current message regardless of the function-calling mode.
        if __event_emitter__:
            await __event_emitter__(
                {
                    "type": "embeds",
                    "data": {
                        "embeds": [content],
                    },
                }
            )

        return HTMLResponse(headers=headers, content=content)
