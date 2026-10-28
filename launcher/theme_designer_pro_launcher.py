"""
title: Theme Designer Pro Launcher
author: @G30
author_url: https://openwebui.com/u/g30
funding_url: https://buymeacoffee.com/iamg30
version: 2.1.0
license: MIT
required_open_webui_version: 0.10.0
description: Builds a theme someone describes in a chat (palette, accents, gradient,
  frosted glass, custom CSS, and an animated Canvas FX background from the catalog or
  newly written by the chat model) and shows it as a card with a live preview, Apply and
  Undo. Also opens the designer inside a chat when asked. Users get their own personal
  theme when the event function's Allow Personal Themes valve is on; admins can also
  change the instance theme. Requires the Theme Designer Pro event function v1.17.0 or
  later, and v1.18.0 for animations the chat model writes.
"""

import asyncio
import base64
import colorsys
import hashlib
import hmac
import json
import re
import time
from urllib.parse import quote

from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

# Must match the event function's THEME_TOKEN_PREFIX: it checks what this signs.
THEME_TOKEN_PREFIX = "tdp-apply.v2."
# A card's Apply button works for this long after the chat built the theme.
THEME_TOKEN_SECONDS = 30 * 24 * 3600
MODES = ("all", "dark", "oled", "light", "her")

# A script the chat model wrote starts with this line, and Theme Designer Pro
# 1.18.0 and later run such a script isolated: no cookies, no requests, no page
ISOLATED_MARK = "/* tdp:isolated */"
ANIMATION_MAX_BYTES = 40 * 1024
CSS_MAX_BYTES = 16 * 1024

# The Canvas FX catalog, fetched once an hour at most
_catalog = {"at": 0.0, "url": "", "presets": []}
_catalog_lock = asyncio.Lock()
# Animations that aren't backgrounds
CATALOG_SKIP = {"diagnostic hud"}
STOPWORDS = {
    "the", "and", "with", "for", "that", "this", "your", "theme", "themes", "background",
    "animated", "animation", "like", "some", "make", "want", "into", "over", "from", "chat",
}

# Frosted glass in Open WebUI's own shapes, tinted by the palette and the
# theme's accent. !important only where Canvas FX transparency clears a background.
GLASS_RULES = """
#message-input-container {
	background-color: var(--tdp-glass) !important;
	border-color: var(--tdp-glass-line) !important;
	backdrop-filter: blur(18px) saturate(1.35);
	box-shadow: 0 14px 40px -18px var(--tdp-glass-shade);
	transition: border-color 0.3s ease, box-shadow 0.3s ease;
}
#message-input-container:focus-within {
	border-color: var(--tdp-glass-glow) !important;
	box-shadow: 0 0 0 3px var(--tdp-glass-ring), 0 14px 40px -18px var(--tdp-glass-shade);
}
.chat-user .rounded-3xl {
	background-color: var(--tdp-glass-bubble) !important;
	backdrop-filter: blur(12px);
	box-shadow: inset 0 0 0 1px var(--tdp-glass-line);
}
#sidebar {
	background-color: var(--tdp-glass-side) !important;
	backdrop-filter: blur(22px) saturate(1.25);
	border-inline-end: 1px solid var(--tdp-glass-line);
}
#sidebar-chat-item.selected { background-color: var(--tdp-glass-selected); }
.markdown-prose a { color: var(--tdp-accent); text-decoration-color: var(--tdp-glass-glow); }
.markdown-prose blockquote { border-inline-start-color: var(--tdp-glass-glow); }
::selection { background-color: var(--tdp-glass-ring); }
"""
GLASS_DARK = """:root {
	--tdp-glass: color-mix(in oklab, var(--color-gray-900) 55%, transparent);
	--tdp-glass-side: color-mix(in oklab, var(--color-gray-950) 68%, transparent);
	--tdp-glass-bubble: color-mix(in oklab, var(--tdp-accent) 14%, var(--color-gray-800) 46%);
	--tdp-glass-selected: color-mix(in oklab, var(--color-gray-500) 20%, transparent);
	--tdp-glass-line: color-mix(in oklab, var(--color-gray-400) 20%, transparent);
	--tdp-glass-glow: color-mix(in oklab, var(--tdp-accent) 45%, transparent);
	--tdp-glass-ring: color-mix(in oklab, var(--tdp-accent) 16%, transparent);
	--tdp-glass-shade: color-mix(in oklab, var(--color-gray-950) 70%, transparent);
}
"""
GLASS_LIGHT = """:root {
	--tdp-glass: color-mix(in oklab, var(--color-gray-50) 64%, transparent);
	--tdp-glass-side: color-mix(in oklab, var(--color-gray-50) 70%, transparent);
	--tdp-glass-bubble: color-mix(in oklab, var(--tdp-accent) 10%, var(--color-gray-100) 56%);
	--tdp-glass-selected: color-mix(in oklab, var(--color-gray-400) 18%, transparent);
	--tdp-glass-line: color-mix(in oklab, var(--color-gray-500) 26%, transparent);
	--tdp-glass-glow: color-mix(in oklab, var(--tdp-accent) 50%, transparent);
	--tdp-glass-ring: color-mix(in oklab, var(--tdp-accent) 18%, transparent);
	--tdp-glass-shade: color-mix(in oklab, var(--color-gray-600) 26%, transparent);
}
"""


def _hsl_hex(hue: float, sat: float, lit: float) -> str:
    r, g, b = colorsys.hls_to_rgb((hue % 360) / 360, lit / 100, sat / 100)
    return "#%02x%02x%02x" % tuple(round(v * 255) for v in (r, g, b))


def _hex(value: str) -> str:
    value = str(value or "").strip().lower()
    return value if re.fullmatch(r"#[0-9a-f]{6}", value) else ""


def _light_accent(accent: str) -> str:
    """The same accent, dark enough to read on Light and Her."""
    if not accent:
        return ""
    r, g, b = (int(accent[i : i + 2], 16) / 255 for i in (1, 3, 5))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    r, g, b = colorsys.hls_to_rgb(h, min(l, 0.42), s)
    return "#%02x%02x%02x" % tuple(round(v * 255) for v in (r, g, b))


def _words(text: str) -> set:
    """Words that say what an animation shows, plurals folded: "leaves" meets "leave"."""
    words = {w for w in re.findall(r"[a-z]+", str(text or "").lower()) if len(w) > 2 and w not in STOPWORDS}
    return {w[:-1] if len(w) > 4 and w.endswith("s") else w for w in words}


def _strip_js_comments(code: str) -> str:
    return re.sub(r"(^|\s)//.*$", r"\1", re.sub(r"/\*[\s\S]*?\*/", "", code), flags=re.M)


def _check_animation(code: str) -> str:
    """What keeps a script the chat model wrote from running well, or "".

    The house standard's hard rules (scripts/validate.js), plus the isolated
    runtime's: no requests of any kind."""
    if len(code.encode("utf-8")) > ANIMATION_MAX_BYTES:
        return f"it is over {ANIMATION_MAX_BYTES // 1024} KB; keep it between 4 and 20 KB"
    body = _strip_js_comments(code)
    if "onmessage" not in body:
        return "it has no self.onmessage handler"
    for case in ("init", "resize"):
        if not re.search(r"['\"]%s['\"]" % case, body):
            return f"it has no '{case}' case in its self.onmessage switch"
    for pattern, what in (
        (r"(^|[^.\w$])document\b", "`document`"),
        (r"(^|[^.\w$])window\s*[.\[]", "`window`"),
        (r"(^|[^.\w$])(localStorage|sessionStorage|indexedDB)\b", "browser storage"),
        (r"(^|[^.\w$])alert\s*\(", "`alert`"),
        (r"\b(fetch|importScripts|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon)\b|\bimport\s*\(", "network requests"),
    ):
        if re.search(pattern, body):
            return f"it uses {what}, which an animation can't: it runs in an isolated worker that can only draw"
    if re.search(r"getContext\(\s*['\"]webgl2?['\"]", body) and "webglcontextlost" not in body:
        return "it uses WebGL without handling webglcontextlost"
    if not re.search(r"Title:\s*\S", code):
        return "it has no header comment with a Title: line"
    return ""


def _check_css(css: str) -> str:
    """What a stylesheet the chat model wrote may not do, or ""."""
    if len(css.encode("utf-8")) > CSS_MAX_BYTES:
        return f"it is over {CSS_MAX_BYTES // 1024} KB"
    lowered = css.lower()
    if "@import" in lowered:
        return "it uses @import; everything has to be in the stylesheet itself"
    if re.search(r"url\(\s*(?!['\"]?data:)", lowered):
        return "it loads a url(); only data: URLs are allowed, so a theme never fetches anything"
    if re.search(r"expression\s*\(|javascript:|-moz-binding|behavior\s*:", lowered):
        return "it uses script in CSS"
    if "</style" in lowered or "<script" in lowered:
        return "it contains HTML tags"
    return ""


def _gradient_from(colors: str):
    """Stops spread evenly from a comma-separated list of #rrggbb colors, or None."""
    hexes = [c for c in (_hex(x) for x in str(colors or "").split(",")) if c][:8]
    if len(hexes) < 2:
        return None
    return {"stops": [{"color": c, "position": round(i * 100 / (len(hexes) - 1))} for i, c in enumerate(hexes)]}


def _title(script: str) -> str:
    found = re.search(r"Title:\s*(.+)", script)
    return re.sub(r"\s*\(.*?\)", "", found.group(1).strip())[:48] if found else "Custom animation"


def _mode_data(h, c, l, accent="", gradient=None, canvas="", css="", accent2="", accent3="") -> dict:
    """One mode with every field the theme format lists, defaults included."""
    g = gradient or {}
    return {
        "h": h, "c": c, "l": l, "paletteEnabled": True,
        "accent": accent, "accent2": accent2, "accent3": accent3,
        "overrides": {}, "locks": {}, "manualOverrides": "", "manualOverridesEnabled": False,
        "customCSS": css, "customCssEnabled": bool(css), "autoScope": True,
        "canvasScript": canvas, "canvasEnabled": bool(canvas),
        "gradientEnabled": bool(g), "gradientType": "linear", "gradientStops": g.get("stops", []),
        "gradientAngle": 135, "gradientRadialPosX": 50, "gradientRadialPosY": 50,
        "gradientRadialShape": "ellipse", "gradientRadialSize": "farthest-corner",
        "gradientMeshPoints": [], "gradientMeshBgColor": "#0a0a12",
        "gradientIntensity": 100 if g else 85, "gradientAnimation": False, "gradientAnimationSpeed": 8,
        "themeShowAuth": True, "customCssShowAuth": True, "canvasShowAuth": True, "gradientShowAuth": True,
        "themeAuthOnly": False, "customCssAuthOnly": False, "canvasAuthOnly": False, "gradientAuthOnly": False,
    }


class Tools:
    class Valves(BaseModel):
        designer_url: str = Field(
            default="/api/v1/theme-designer",
            description="Route where the Theme Designer Pro event function serves its page. Must match the event function's designer_url valve.",
        )
        background_animations: bool = Field(
            default=True,
            description="Let a theme from a chat have an animated Canvas FX background from the catalog below. Off, themes are palette, gradient and glass only.",
        )
        model_written_animations: bool = Field(
            default=True,
            description="Let the chat model write a new animation when nothing in the catalog fits. It runs isolated, with no access to the account, the page or the network, and needs Theme Designer Pro 1.18.0. Off, animations come from the catalog only.",
        )
        model_written_css: bool = Field(
            default=True,
            description="Let the chat model add its own CSS to a theme. It can't load anything: no @import, and url() only for data: URLs.",
        )
        canvas_catalog_url: str = Field(
            default="https://raw.githubusercontent.com/silentoplayz/theme-designer-pro-presets/main/bundles/canvas-fx-all.json",
            description="Canvas FX bundle the animated backgrounds come from, fetched by the server. Only scripts from here ever run; the chat model only names one.",
        )
        iframe_height: int = Field(
            default=800,
            description="Height of the designer in pixels when a chat opens it.",
        )
        iframe_scale: float = Field(
            default=1.0,
            description="Scale factor for the designer page inside the chat. Lower values fit more content but make it smaller. 1.0 = native size.",
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
    def _sign(user_id: str, personal: bool, sha: str, mode: str) -> str:
        """A token the event function accepts for this user only: the hash of
        the theme the chat built, signed with WEBUI_SECRET_KEY."""
        from open_webui.env import WEBUI_SECRET_KEY

        if not WEBUI_SECRET_KEY or not user_id:
            return ""
        payload = {
            "u": user_id,
            "x": int(time.time()) + THEME_TOKEN_SECONDS,
            "s": "me" if personal else "everyone",
            "h": sha,
            "m": mode,
        }
        body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")).decode("ascii").rstrip("=")
        sig = base64.urlsafe_b64encode(
            hmac.new(WEBUI_SECRET_KEY.encode("utf-8"), (THEME_TOKEN_PREFIX + body).encode("ascii"), hashlib.sha256).digest()
        ).decode("ascii").rstrip("=")
        return THEME_TOKEN_PREFIX + body + "." + sig

    async def _presets(self) -> list:
        """The catalog's animations as (name, description, script)."""
        url = self.valves.canvas_catalog_url.strip()
        async with _catalog_lock:
            if _catalog["url"] == url and _catalog["presets"] and time.time() - _catalog["at"] < 3600:
                return _catalog["presets"]
            try:
                import aiohttp

                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
                    async with session.get(url) as response:
                        response.raise_for_status()
                        data = json.loads(await response.text())
            except Exception:
                return _catalog["presets"] if _catalog["url"] == url else []
            presets = []
            for p in data.get("canvas_presets", []) if isinstance(data, dict) else []:
                name, script = str(p.get("name") or ""), str(p.get("script") or "")
                if not name or not script or name.lower() in CATALOG_SKIP:
                    continue
                found = re.search(r"Description:\s*(.+)", script)
                presets.append((name, found.group(1).strip() if found else "", script))
            _catalog.update(at=time.time(), url=url, presets=presets)
            return presets

    async def _animation(self, wanted: str):
        """The catalog animation that best fits the words asked for, or None."""
        words = _words(wanted)
        if not words:
            return None, []
        presets = await self._presets()
        best, best_score = None, 0
        for name, description, script in presets:
            label = re.sub(r"\s*\(.*?\)", "", name).lower()
            # How much of the request it covers first; a word in its name breaks ties
            covered = words & (_words(label) | _words(description))
            score = (10 if label in str(wanted).lower() else 0) + 4 * len(covered) + len(words & _words(label))
            if score > best_score:
                best, best_score = (name, description, script), score
        return best, [p[0] for p in presets]

    async def open_theme_designer(
        self, my_theme: bool = False, __user__: dict = {}
    ) -> tuple:
        """
        Open the Theme Designer Pro designer inside the chat, for working on a theme by hand.

        When to use: ONLY when the user asks for the designer itself.
        Trigger phrases: "open theme designer", "launch theme designer", "open the theme editor",
        "show me the designer", "theme settings".

        Do NOT use this when the user asks for a theme, describes colors, a mood, a place or an
        aesthetic; use create_theme for that.

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

    async def create_theme(
        self,
        name: str,
        hue: int,
        chroma: int,
        lightness: int = 16,
        description: str = "",
        accent: str = "",
        background: str = "",
        animation_code: str = "",
        glass: bool = True,
        custom_css: str = "",
        gradient: bool = True,
        gradient_colors: str = "",
        accent2: str = "",
        accent3: str = "",
        mode: str = "all",
        everyone: bool = False,
        __user__: dict = {},
    ) -> tuple:
        """
        Build a whole Open WebUI theme the user describes and show it in the chat as a card with a live
        preview and an Apply button. Nothing changes until the user presses Apply on the card. When the
        theme-designer-pro skill is available, read it first: it covers palettes, glass, custom CSS and
        writing a new animation.

        When to use: The user asks for a theme or describes one: colors, a mood, a place, an aesthetic.
        Trigger phrases: "give me a blue theme", "make my chat a koi pond", "a cozy autumn theme",
        "something cyberpunk with rain", "change my theme to red", "ocean vibe".

        Parameters:
        - name: A short, evocative theme name shown on the card (e.g. "Honu Lagoon", "Warm Copper").
        - hue: Palette hue angle (0-360). 0=red, 25=orange, 50=yellow, 90=chartreuse, 120=green, 165=teal,
          200=cyan, 220=blue, 260=indigo, 290=purple, 330=pink/magenta.
        - chroma: Palette colorfulness (0-60). 3-8=muted/neutral, 10-25=balanced, 30-60=vivid.
        - lightness: Dark mode base lightness (5-30). 5-10=very dark, 12-18=standard, 20-30=lighter. Light mode
          is made to match.
        - description: One sentence for the card about how the theme looks.
        - accent: Optional "#rrggbb" for links, focus rings and highlights; empty picks one from the hue.
        - background: An animated background from Theme Designer Pro's catalog, described in a few words, such
          as "koi pond", "deep ocean with jellyfish", "falling leaves", "rain and lightning", "aurora",
          "starry constellations", "matrix rain", "snow", "fireflies", "embers", "synthwave sun", "lava lamp".
          The closest one is used. Empty for a still background.
        - animation_code: A complete new Canvas FX script you wrote, for a background the catalog doesn't have.
          Used instead of `background`. Follow the theme-designer-pro skill's Canvas FX reference: a header
          with Title and Description, a self.onmessage switch with 'init', 'resize' and 'theme' cases, colors
          from the theme, transparent canvas, calm behind the chat column. No document, window, storage or
          network: it runs isolated and can only draw.
        - glass: Frosted, see-through panels so the background shows through (default True).
        - custom_css: Extra CSS for the theme, after the glass. Use Open WebUI's own element ids and the theme's
          variables (--color-gray-50 to --color-gray-950, --tdp-accent). No @import; url() only for data: URLs.
        - gradient: A gradient background when there is no animated background (default True).
        - gradient_colors: Optional comma-separated "#rrggbb" colors (2-8) for the gradient, dark to light or
          as they should run; empty makes one from the hue.
        - accent2, accent3: Optional "#rrggbb" second and third accents (animations use all three).
        - mode: Which mode(s) to build for. "all" (default), "dark", "oled", "light" or "her".
        - everyone: For admins only. True builds it for the instance theme every user sees, and only when the
          admin clearly asks for that (e.g. "for everyone"). Default False: the user's own theme.
        """
        personal = __user__.get("role") != "admin" or not everyone
        mode = mode if mode in MODES else "all"
        name = " ".join(str(name or "").split())[:60] or "Chat theme"
        description = " ".join(str(description or "").split())[:240]
        h = max(0, min(360, int(hue)))
        c = max(0, min(60, int(chroma)))
        l = max(5, min(30, int(lightness)))
        accent, accent2, accent3 = _hex(accent), _hex(accent2), _hex(accent3)

        # The chat model's own animation and CSS: checked here, so a problem goes
        # back to it to fix before anything reaches the user
        written = str(animation_code or "").strip()
        extra_css = str(custom_css or "").strip()
        if written and not self.valves.model_written_animations:
            return "Not built: an admin turned off animations the chat model writes. Use `background` to pick one from the catalog instead."
        if written:
            problem = _check_animation(written)
            if problem:
                return f"Not built: the animation_code can't run because {problem}. Fix it and call create_theme again."
        if extra_css and not self.valves.model_written_css:
            return "Not built: an admin turned off CSS the chat model writes. Leave custom_css empty."
        if extra_css:
            problem = _check_css(extra_css)
            if problem:
                return f"Not built: the custom_css can't be used because {problem}. Fix it and call create_theme again."

        animation, catalog = (None, [])
        if written:
            animation = (_title(written), "", ISOLATED_MARK + "\n" + written)
        elif background.strip() and self.valves.background_animations:
            animation, catalog = await self._animation(background)
        script = animation[2] if animation else ""
        dark_gradient = None
        light_gradient = None
        if gradient and not script and _gradient_from(gradient_colors):
            dark_gradient = _gradient_from(gradient_colors)
        if gradient and not script and not dark_gradient:
            dark_gradient = {"stops": [
                {"color": _hsl_hex(h, 15, 4), "position": 0},
                {"color": _hsl_hex(h, 25, 12), "position": 33},
                {"color": _hsl_hex(h, 20, 7), "position": 66},
                {"color": _hsl_hex(h, 15, 4), "position": 100},
            ]}
        if gradient and not script:
            light_gradient = {"stops": [
                {"color": _hsl_hex(h, 35, 97), "position": 0},
                {"color": _hsl_hex(h + 15, 45, 91), "position": 40},
                {"color": _hsl_hex(h, 40, 95), "position": 75},
                {"color": _hsl_hex(h, 35, 97), "position": 100},
            ]}
        dark_css = ((GLASS_DARK + GLASS_RULES) if glass else "") + (extra_css + "\n" if extra_css else "")
        light_css = ((GLASS_LIGHT + GLASS_RULES) if glass else "") + (extra_css + "\n" if extra_css else "")
        la, la2, la3 = _light_accent(accent), _light_accent(accent2), _light_accent(accent3)
        light_c = round(c * 0.6)
        theme = {
            "name": name,
            "description": description or "Made in a chat with the Theme Designer Pro Launcher.",
            "author": "",
            "version": "1.0.0",
            "targetVersion": "1.18.0" if written else "1.17.0",
            "repositoryUrl": "",
            "updateUrl": "",
            "dark": _mode_data(h, c, l, accent, dark_gradient, script, dark_css, accent2, accent3),
            "oled": _mode_data(h, c, 0, accent, dark_gradient, script, dark_css, accent2, accent3),
            "light": _mode_data(h, light_c, 20, la, light_gradient, script, light_css, la2, la3),
            "her": _mode_data(h, light_c, 20, la, light_gradient, script, light_css, la2, la3),
        }
        text = json.dumps(theme, separators=(",", ":"), ensure_ascii=False)
        sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
        token = self._sign(str(__user__.get("id") or ""), personal, sha, mode)

        parts = []
        if animation:
            parts.append(re.sub(r"\s*\(.*?\)", "", animation[0]) + (" (new)" if written else ""))
        elif gradient:
            parts.append("gradient")
        if glass:
            parts.append("glass")
        details = {
            "name": name,
            "description": theme["description"],
            "subtitle": " · ".join(["Your theme" if personal else "Instance theme"] + parts),
            "mode": mode,
            "written": bool(written),
            "sha": sha,
            "applyUrl": self._designer_url(personal, token) if token else "",
            "designerUrl": self._designer_url(personal),
            "theme": text,
        }

        built = f'Built "{name}"'
        if written:
            built += f', with your new animation "{animation[0]}"'
        elif animation:
            built += f', with the "{animation[0]}" animated background'
        elif background.strip() and not self.valves.background_animations:
            built += ", without an animated background (an admin turned them off)"
        elif background.strip():
            built += (
                ", without an animated background: none in the catalog matched"
                + (" (it has: " + ", ".join(catalog) + ")" if catalog else " (the catalog could not be reached)")
            )
        built += (" and frosted glass panels" if glass else "") + ", for "
        built += "the user's own theme" if personal else "the instance theme every user sees"
        built += "" if mode == "all" else f" in {mode} mode only"
        return await self._card(details), (
            built + ". A card in the chat shows it with a live preview, Apply and Preview. Nothing has changed yet: "
            "the theme is applied only when the user presses Apply. Tell them in a sentence or two how it looks and "
            "that Apply puts it on; don't list settings or code."
        )

    async def _card(self, details: dict) -> HTMLResponse:
        """The theme card shown in the chat."""
        data = json.dumps(details, ensure_ascii=False).replace("<", "\\u003c")
        return HTMLResponse(headers={"Content-Disposition": "inline"}, content=CARD_HTML.replace("__DATA__", data))

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


# The card: the theme's name, a live preview (its palette, gradient, glass and
# Canvas FX running in a worker, as the presets website previews them),
# Apply and Preview. Apply opens the designer out of sight with the signed
# link and hands it the theme; the designer saves it and answers.
CARD_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Theme</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
/* No color-scheme: one that differs from the chat's gives the frame an opaque background */
:root { --fg: #ececec; --muted: #9b9b9b; --line: rgb(255 255 255 / .09); --card: rgb(255 255 255 / .035); --chip: rgb(255 255 255 / .07); --chip-hover: rgb(255 255 255 / .12); --ok: #22a06b; }
html.light { --fg: #171717; --muted: #6b6b6b; --line: rgb(0 0 0 / .09); --card: rgb(0 0 0 / .02); --chip: rgb(0 0 0 / .05); --chip-hover: rgb(0 0 0 / .09); --ok: #1a7f52; }
body { background: transparent; font: 13px/1.4 Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; color: var(--fg); padding: 2px; }
.tdp-card { width: 100%; max-width: 400px; border: 1px solid var(--line); border-radius: 16px; background: var(--card); padding: 10px; transition: max-width .3s cubic-bezier(.33,1,.68,1); }
.tdp-card.open { max-width: 720px; }
.tdp-card.open .tdp-thumb { display: none; }
.tdp-row { display: flex; gap: 12px; align-items: center; }
.tdp-thumb { position: relative; flex: none; width: 104px; height: 68px; border-radius: 10px; overflow: hidden; cursor: pointer; box-shadow: inset 0 0 0 1px var(--line); }
.tdp-info { min-width: 0; flex: 1; }
.tdp-name { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tdp-sub { margin-top: 1px; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tdp-actions { display: flex; align-items: center; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
button { font: inherit; font-size: 12px; font-weight: 500; border: 0; cursor: pointer; height: 28px; padding: 0 12px; border-radius: 9px; color: var(--fg); background: var(--chip); transition: background-color .15s, opacity .15s; }
button:hover:not(:disabled) { background: var(--chip-hover); }
button:disabled { cursor: default; }
button:disabled:not(.done) { opacity: .5; }
button:focus-visible { outline: 2px solid var(--muted); outline-offset: 2px; }
#apply { color: #fff; background: var(--tdp-apply); }
#apply:hover:not(:disabled) { filter: brightness(1.08); background: var(--tdp-apply); }
#apply.done { background: var(--ok); }
#apply svg { width: 12px; height: 12px; margin-right: 4px; vertical-align: -1px; }
.tdp-link { background: none; padding: 0 6px; color: var(--muted); }
.tdp-link:hover:not(:disabled) { background: none; color: var(--fg); }
.tdp-note { margin-top: 8px; font-size: 12px; color: var(--muted); }
.tdp-note.error { color: #e5484d; }
.tdp-desc { margin: 10px 2px 0; font-size: 12px; color: var(--muted); }
.tdp-hint { margin: 8px 2px 0; font-size: 11.5px; color: var(--muted); }
.tdp-source { margin-top: 8px; max-height: 280px; overflow: auto; padding: 10px 12px; border-radius: 10px; background: var(--chip); font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; tab-size: 4; }
/* The preview: a small Open WebUI page in the theme */
.tdp-stage { position: absolute; inset: 0; overflow: hidden; background: var(--color-gray-900); }
.tdp-stage.light-mode { background: var(--color-gray-50); }
.tdp-stage canvas, .tdp-stage iframe { position: absolute; inset: 0; width: 100%; height: 100%; }
.tdp-mock { position: absolute; inset: 0; transform-origin: 0 0; width: 720px; height: 405px; display: flex; color: var(--color-gray-100); font-size: 12px; pointer-events: none; }
.tdp-stage.light-mode .tdp-mock { color: var(--color-gray-900); }
.tdp-mock #sidebar { width: 150px; padding: 14px 10px; background: var(--color-gray-950); display: flex; flex-direction: column; gap: 6px; }
.tdp-stage.light-mode .tdp-mock #sidebar { background: var(--color-gray-50); }
.tdp-mock .tdp-side-item { height: 18px; border-radius: 8px; padding: 0 8px; display: flex; align-items: center; font-size: 10px; opacity: .8; }
.tdp-mock #sidebar-chat-item.selected { opacity: 1; }
.tdp-mock main { flex: 1; position: relative; padding: 26px 46px; display: flex; flex-direction: column; gap: 12px; }
.tdp-mock .chat-user { align-self: flex-end; }
.tdp-mock .chat-user .rounded-3xl { border-radius: 18px; padding: 8px 14px; background: var(--color-gray-850); }
.tdp-stage.light-mode .tdp-mock .chat-user .rounded-3xl { background: var(--color-gray-100); }
.tdp-mock .markdown-prose { line-height: 1.55; max-width: 430px; }
.tdp-mock .markdown-prose a { text-decoration: underline; }
.tdp-mock #message-input-container { position: absolute; left: 46px; right: 46px; bottom: 22px; height: 52px; border-radius: 22px; border: 1px solid var(--color-gray-800); background: var(--color-gray-850); padding: 10px 16px; opacity: .98; }
.tdp-stage.light-mode .tdp-mock #message-input-container { border-color: var(--color-gray-100); background: #fff; }
.tdp-mock .tdp-ph { opacity: .5; }
.tdp-preview { position: relative; display: none; margin-top: 10px; width: 100%; aspect-ratio: 16 / 9; border-radius: 12px; overflow: hidden; box-shadow: inset 0 0 0 1px var(--line); }
.tdp-card.open .tdp-preview { display: block; }
.tdp-modes { position: absolute; bottom: 8px; left: 8px; z-index: 2; display: flex; gap: 2px; padding: 2px; border-radius: 9px; background: rgb(0 0 0 / .35); backdrop-filter: blur(8px); }
.tdp-modes button { height: 22px; padding: 0 8px; font-size: 11px; color: #fff; background: none; border-radius: 7px; }
.tdp-modes button[aria-pressed=true] { background: rgb(255 255 255 / .2); }
@media (prefers-reduced-motion: reduce) { .tdp-card { transition: none; } }
</style>
<style id="tdp-theme-css"></style>
</head>
<body>
<div class="tdp-card" id="card">
  <div class="tdp-row">
    <div class="tdp-thumb" id="thumb" role="button" tabindex="0" aria-label="Preview the theme"></div>
    <div class="tdp-info">
      <div class="tdp-name" id="name"></div>
      <div class="tdp-sub" id="sub"></div>
      <div class="tdp-actions">
        <button id="apply" type="button">Apply theme</button>
        <button id="preview" type="button" aria-expanded="false">Preview</button>
        <button id="undo" type="button" class="tdp-link" hidden>Undo</button>
        <button id="code" type="button" class="tdp-link" aria-expanded="false" hidden>View code</button>
      </div>
    </div>
  </div>
  <div class="tdp-preview" id="big">
    <div class="tdp-modes" role="group" aria-label="Preview mode">
      <button type="button" data-mode="dark">Dark</button>
      <button type="button" data-mode="light">Light</button>
    </div>
  </div>
  <p class="tdp-desc" id="desc" hidden></p>
  <p class="tdp-hint" id="hint" hidden>The model wrote this animation. It runs isolated: it can draw, but it can’t reach your account, this page or the network.</p>
  <pre class="tdp-source" id="source" hidden></pre>
  <p class="tdp-note" id="note" role="status" hidden></p>
</div>
<script id="tdp-data" type="application/json">__DATA__</script>
<script>
(function () {
  'use strict';
  var D = JSON.parse(document.getElementById('tdp-data').textContent);
  var T = JSON.parse(D.theme);
  var $ = function (id) { return document.getElementById(id); };
  var card = $('card'), applyBtn = $('apply'), previewBtn = $('preview'), undoBtn = $('undo'), note = $('note');
  var sameOrigin = window.origin !== 'null';
  var doneKey = 'owui_tdp_chat_applied_' + D.sha;
  var store = function (fn) { try { return fn(sessionStorage); } catch (e) { return null; } };

  $('name').textContent = D.name;
  $('sub').textContent = D.subtitle;
  if (D.description) { $('desc').textContent = D.description; }

  // Open WebUI's light or dark, for the card itself and the preview's first mode
  var parentDark = (function () {
    try { var el = parent.document.documentElement; return el.classList.contains('dark') || el.classList.contains('oled-dark'); }
    catch (e) { return !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches; }
  })();
  if (!parentDark) document.documentElement.classList.add('light');
  var target = D.mode && D.mode !== 'all' ? D.mode : (parentDark ? 'dark' : 'light');
  var shown = target === 'oled' ? 'dark' : target === 'her' ? 'light' : target;

  // ---- The palette, as the designer and the presets website generate it ----
  var STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 850, 900, 950];
  var LIGHTNESS = { 50: .98, 100: .94, 200: .92, 300: .85, 400: .77, 500: .69, 600: .51, 700: .42, 800: .32, 850: .27, 900: .2, 950: .16 };
  function accentOf(m, dark, shift) {
    var ac = m.c > 0 ? Math.min(.18, Math.max(.06, m.c / 250)) : 0;
    return 'oklch(' + (dark ? .74 : .56) + ' ' + ac.toFixed(3) + ' ' + ((m.h + shift + 360) % 360).toFixed(1) + ')';
  }
  function varsFor(key) {
    var m = T[key], dark = key === 'dark' || key === 'oled', v = {};
    var c = (m.c || 0) / 1000, dl = (m.l == null ? 20 : m.l) / 100 - .2;
    STEPS.forEach(function (s) {
      var l = Math.max(0, Math.min(.98, LIGHTNESS[s] + dl));
      v['--color-gray-' + s] = 'oklch(' + l.toFixed(3) + ' ' + c.toFixed(3) + ' ' + (c === 0 ? 0 : m.h) + ')';
    });
    v['--tdp-accent'] = m.accent || accentOf(m, dark, 0);
    v['--tdp-accent-2'] = m.accent2 || accentOf(m, dark, 40);
    v['--tdp-accent-3'] = m.accent3 || accentOf(m, dark, -40);
    return v;
  }
  function gradientCss(m) {
    if (!m.gradientEnabled || !m.gradientStops.length) return '';
    return 'linear-gradient(' + m.gradientAngle + 'deg, ' + m.gradientStops.map(function (s) { return s.color + ' ' + s.position + '%'; }).join(', ') + ')';
  }
  var px = null;
  function toRgb(value) {
    if (!px) { var c = document.createElement('canvas'); c.width = c.height = 1; px = c.getContext('2d', { willReadFrequently: true }); }
    px.clearRect(0, 0, 1, 1); px.fillStyle = '#808080'; px.fillStyle = value; px.fillRect(0, 0, 1, 1);
    var d = px.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]];
  }
  // The same payload the designer's bootloader sends a Canvas FX script
  function canvasTheme(key, vars) {
    var dark = key === 'dark' || key === 'oled', m = T[key];
    var hex = function (c) { return '#' + c.map(function (v) { return (v < 16 ? '0' : '') + v.toString(16); }).join(''); };
    var ramp = {}, rampRgb = {};
    STEPS.forEach(function (s) { rampRgb[s] = toRgb(vars['--color-gray-' + s]); ramp[s] = hex(rampRgb[s]); });
    var src = {
      background: rampRgb[dark ? 900 : 50], surface: rampRgb[dark ? 850 : 100], text: rampRgb[dark ? 100 : 900], muted: rampRgb[dark ? 400 : 500],
      accent: toRgb(vars['--tdp-accent']), accent2: toRgb(vars['--tdp-accent-2']), accent3: toRgb(vars['--tdp-accent-3'])
    };
    var colors = {}, rgb = {};
    Object.keys(src).forEach(function (k) { colors[k] = hex(src[k]); rgb[k] = src[k].map(function (v) { return Math.round(v / 2.55) / 100; }); });
    return { type: 'theme', mode: key, dark: dark, hue: m.h, chroma: (m.c || 0) / 1000, colors: colors, rgb: rgb, ramp: ramp };
  }
  // The Light accent: dark enough for white text in either mode
  document.documentElement.style.setProperty('--tdp-apply', varsFor('light')['--tdp-accent']);

  // ---- One stage: the thumbnail, and the same stage moved into the big preview ----
  var stage = document.createElement('div'); stage.className = 'tdp-stage';
  var canvas = document.createElement('canvas');
  var mock = document.createElement('div'); mock.className = 'tdp-mock'; mock.setAttribute('aria-hidden', 'true');
  mock.innerHTML = '<nav id="sidebar"><div class="tdp-side-item" style="font-weight:600;opacity:1">New chat</div><div class="tdp-side-item selected" id="sidebar-chat-item"></div><div class="tdp-side-item"></div><div class="tdp-side-item"></div></nav>' +
    '<main><div class="chat-user"><div class="rounded-3xl"></div></div><div class="markdown-prose"></div><div id="message-input-container"><span class="tdp-ph">Send a message</span></div></main>';
  mock.querySelector('#sidebar-chat-item').textContent = D.name;
  mock.querySelector('.chat-user .rounded-3xl').textContent = 'Make my chat ' + D.name;
  mock.querySelector('.markdown-prose').innerHTML = 'Here it is: the panels turn to <a>frosted glass</a> so the background shows through, and the palette follows your colors.';
  if (T.dark.canvasEnabled) stage.appendChild(canvas);
  stage.appendChild(mock);
  $('thumb').appendChild(stage);

  // Every animation previews isolated, the way Theme Designer Pro 1.18.0 runs one
  // a chat model wrote: in a sandboxed frame with no origin and a policy that
  // allows no requests, which makes its own canvas and worker, so it can draw and
  // nothing else. The frame takes the canvas's place in the stage.
  function isolatedWorker(source, canvas) {
    var relay = function () {
      var w = null, queue = [];
      function deliver(d) {
        var transfer = [];
        if (d && d.type === 'init' && !d.canvas) {
          var c = document.createElement('canvas');
          c.width = d.width || innerWidth; c.height = d.height || innerHeight;
          c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
          document.body.appendChild(c);
          d.canvas = c.transferControlToOffscreen(); transfer = [d.canvas];
        }
        w.postMessage(d, transfer);
      }
      addEventListener('message', function (e) {
        if (e.source !== parent || !e.data) return;
        var m = e.data;
        if (typeof m.boot === 'string') {
          try { w = new Worker(URL.createObjectURL(new Blob([m.boot], { type: 'application/javascript' }))); }
          catch (err) { parent.postMessage({ tdpIsolatedError: String(err && err.message || err) }, '*'); return; }
          w.onerror = function (ev) { ev.preventDefault(); parent.postMessage({ tdpIsolatedError: String(ev.message || 'The script failed') }, '*'); };
          queue.forEach(function (q) { deliver(q.data); }); queue = [];
        } else if ('data' in m) { if (w) deliver(m.data); else queue.push(m); }
      });
      parent.postMessage({ tdpIsolatedReady: true }, '*');
    };
    var q = "'", frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
    frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;color-scheme:normal;pointer-events:none';
    frame.srcdoc = '<meta http-equiv="Content-Security-Policy" content="default-src ' + q + 'none' + q + '; script-src ' + q + 'unsafe-inline' + q +
      ' blob:; worker-src blob:; style-src ' + q + 'unsafe-inline' + q + '"><style>html,body{margin:0;background:transparent;overflow:hidden}</style>' +
      '<scr' + 'ipt>(' + relay.toString() + ')();</scr' + 'ipt>';
    var ready = false, pending = [], lastInit = null, lastTheme = null, proxy = { onerror: null };
    function send(m) { try { frame.contentWindow.postMessage(m, '*'); } catch (e) {} }
    addEventListener('message', function (e) {
      if (e.source !== frame.contentWindow || !e.data) return;
      if (e.data.tdpIsolatedReady) {
        // Again when the frame reloads, as it does when the stage moves: start over where it was
        var replay = ready ? [lastInit, lastTheme].filter(Boolean) : pending;
        ready = true; send({ boot: source }); replay.forEach(send); pending = [];
      } else if (typeof e.data.tdpIsolatedError === 'string' && proxy.onerror) proxy.onerror(e.data.tdpIsolatedError);
    });
    proxy.postMessage = function (data) {
      var m = { data: data };
      if (data && data.type === 'init') lastInit = m; else if (data && data.type === 'theme') lastTheme = m;
      if (data && data.type === 'resize' && lastInit) { lastInit.data.width = data.width; lastInit.data.height = data.height; }
      if (ready) send(m); else pending.push(m);
    };
    canvas.replaceWith(frame);
    return proxy;
  }
  var worker = null, workerFailed = false;
  function paint(key) {
    var m = T[key], vars = varsFor(key), dark = key === 'dark' || key === 'oled';
    Object.keys(vars).forEach(function (k) { stage.style.setProperty(k, vars[k]); });
    stage.classList.toggle('light-mode', !dark);
    stage.style.backgroundImage = gradientCss(m);
    // The glass is the theme's own CSS, run against the mock's copies of Open WebUI's elements
    $('tdp-theme-css').textContent = m.customCssEnabled ? m.customCSS.replace(/:root\s*\{/g, '.tdp-stage {') : '';
    if (worker) worker.postMessage(canvasTheme(key, vars));
    document.querySelectorAll('.tdp-modes button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === (dark ? 'dark' : 'light'))); });
    return vars;
  }
  function fit() {
    var w = stage.clientWidth, h = stage.clientHeight;
    mock.style.transform = 'scale(' + Math.min(w / 720, h / 405) + ')';
    if (worker && w && h) worker.postMessage({ type: 'resize', width: w, height: h });
  }
  var vars = paint(shown);
  function startCanvas() {
    if (!T.dark.canvasEnabled || worker || workerFailed) return;
    if (!canvas.transferControlToOffscreen || !stage.clientWidth) return;
    try {
      worker = isolatedWorker(T.dark.canvasScript, canvas);
      worker.onerror = function (message) { workerFailed = true; say('The animation stopped with an error: ' + message, true); };
      worker.postMessage({ type: 'init', width: stage.clientWidth, height: stage.clientHeight, dpr: devicePixelRatio || 1,
        env: { authToken: '', baseUrl: '', locale: navigator.language, timezone: '' }, theme: canvasTheme(shown === 'light' ? 'light' : 'dark', vars) });
    } catch (e) { workerFailed = true; worker = null; }
  }
  new ResizeObserver(function () { fit(); startCanvas(); }).observe(stage);
  stage.addEventListener('mousemove', function (e) {
    if (!worker) return;
    var r = stage.getBoundingClientRect();
    worker.postMessage({ type: 'mousemove', x: e.clientX - r.left, y: e.clientY - r.top });
  });

  // ---- The chat frame grows with the card ----
  // The card's own height: the document's never shrinks below the frame's
  function height() { try { parent.postMessage({ type: 'iframe:height', height: Math.ceil(card.getBoundingClientRect().bottom) + 4 }, '*'); } catch (e) {} }
  new ResizeObserver(height).observe(card);
  // Open WebUI sizes the frame once more when it loads; answer after it
  addEventListener('load', function () { height(); setTimeout(height, 300); });

  function togglePreview() {
    var open = !card.classList.contains('open');
    card.classList.toggle('open', open);
    previewBtn.setAttribute('aria-expanded', String(open));
    previewBtn.textContent = open ? 'Close preview' : 'Preview';
    $('desc').hidden = !open || !D.description;
    (open ? $('big') : $('thumb')).appendChild(stage);
    requestAnimationFrame(fit);
  }
  previewBtn.addEventListener('click', togglePreview);
  if (D.written) {
    $('hint').hidden = false;
    var codeBtn = $('code'); codeBtn.hidden = false;
    $('source').textContent = T.dark.canvasScript.replace(/^\/\* tdp:isolated \*\/\n/, '');
    codeBtn.addEventListener('click', function () {
      var open = $('source').hidden;
      $('source').hidden = !open;
      codeBtn.setAttribute('aria-expanded', String(open));
      codeBtn.textContent = open ? 'Hide code' : 'View code';
    });
  }
  $('thumb').addEventListener('click', togglePreview);
  $('thumb').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePreview(); } });
  document.querySelectorAll('.tdp-modes button').forEach(function (b) {
    b.addEventListener('click', function () { vars = paint(b.dataset.mode); });
  });

  // ---- Apply and Undo: the designer, out of sight, does the work ----
  var icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  function say(text, error) { note.hidden = !text; note.textContent = text || ''; note.classList.toggle('error', !!error); }
  function state(applied) {
    applyBtn.classList.toggle('done', applied);
    applyBtn.disabled = applied;
    applyBtn.innerHTML = applied ? icon + 'Applied' : 'Apply theme';
    undoBtn.hidden = !applied;
  }
  function older(version, than) {
    var a = String(version || '0').split('.').map(Number), b = than.split('.').map(Number);
    for (var i = 0; i < 3; i++) { if ((a[i] || 0) !== b[i]) return (a[i] || 0) < b[i]; }
    return false;
  }
  function designer(action) {
    return new Promise(function (resolve, reject) {
      var frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.style.cssText = 'position:absolute;width:1px;height:1px;left:-9999px;top:0;border:0;opacity:0';
      var timer = setTimeout(function () { finish(new Error('The designer did not answer. Check that Theme Designer Pro is on, then try again.')); }, 45000);
      function finish(error, data) {
        clearTimeout(timer); window.removeEventListener('message', onMessage); frame.remove();
        error ? reject(error) : resolve(data);
      }
      function onMessage(e) {
        var m = e.data;
        if (e.source !== frame.contentWindow || !m || m.tdpChatTheme !== D.sha) return;
        if (m.status === 'ready') {
          // 1.17.0 would run an animation the model wrote without isolating it
          if (D.written && action === 'apply' && older(m.version, '1.18.0')) {
            finish(new Error('Update Theme Designer Pro to 1.18.0 or later to apply an animation the model wrote. This Open WebUI has ' + (m.version ? 'version ' + m.version : 'an older version') + '.'));
            return;
          }
          frame.contentWindow.postMessage({ tdpChatTheme: D.sha, action: action, theme: D.theme }, '*');
        }
        else if (m.status === 'error') finish(new Error(m.message || 'The designer could not apply it.'));
        else finish(null, m);
      }
      window.addEventListener('message', onMessage);
      // A designer page that can't sign in, or a turned-off function, answers with no handshake
      frame.addEventListener('load', function () {
        try {
          var doc = frame.contentDocument;
          if (doc && !doc.getElementById('theme-designer-container')) {
            var text = (doc.body && doc.body.innerText || '').trim();
            finish(new Error(text.length < 300 && text ? text.replace(/^\{"error":\s*"|"\}$/g, '') : 'The designer could not open.'));
          }
        } catch (err) {}
      });
      frame.src = D.applyUrl;
      document.body.appendChild(frame);
    });
  }
  if (!D.applyUrl) {
    applyBtn.disabled = true;
    say('This Open WebUI has no WEBUI_SECRET_KEY, so a theme from a chat can’t be applied. Ask an admin.', true);
  } else if (!sameOrigin) {
    applyBtn.disabled = true;
    say('To apply themes from the chat, turn on Settings › Interface › iframe Sandbox Allow Same Origin, then reload.', false);
  } else if (store(function (s) { return s.getItem(doneKey); }) === '1') {
    state(true);
  }
  applyBtn.addEventListener('click', function () {
    if (applyBtn.disabled) return;
    applyBtn.disabled = true; previewBtn.disabled = true;
    applyBtn.textContent = 'Applying…'; say('');
    designer('apply').then(function () {
      store(function (s) { s.setItem(doneKey, '1'); });
      state(true);
      say(D.mode && D.mode !== 'all' ? 'Applied to ' + D.mode + ' mode.' : '');
    }, function (err) {
      state(false); say(err.message, true);
    }).then(function () { previewBtn.disabled = false; });
  });
  undoBtn.addEventListener('click', function () {
    undoBtn.disabled = true; say('Putting your previous theme back…');
    designer('undo').then(function () {
      store(function (s) { s.removeItem(doneKey); });
      state(false); say('Your previous theme is back.');
    }, function (err) { say(err.message, true); }).then(function () { undoBtn.disabled = false; });
  });
  height();
})();
</script>
</body>
</html>"""
