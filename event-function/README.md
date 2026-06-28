# ⚡ Theme Designer Pro (Event Function)

> Instance-wide theme designer for Open WebUI — standalone admin page with server-side persistence and real-time live push to all users.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Open WebUI](https://img.shields.io/badge/Open_WebUI-≥0.9.0-orange)
![Type](https://img.shields.io/badge/type-Event_Function-teal)

---

## What Is This?

Theme Designer Pro is available as both a **Tool** and an **Event Function** for Open WebUI. This is the **Event Function** variant, which registers a standalone admin page at a configurable URL (default: `/api/v1/theme-designer`). Unlike the [Tool variant](../tool/) which runs inside an AI chat iframe, this variant:

- **Runs as a standalone page** — no iframe, no "Same Origin" sandbox flag needed
- **Persists themes server-side** — CSS and state are saved to `DATA_DIR/theme/` and injected into `index.html`
- **Pushes changes to all users in real-time** via Server-Sent Events (SSE)
- **Supports Draft mode** — preview changes locally before publishing to all users
- **Works without AI** — admins navigate directly to the designer URL

Both products share the same OKLCH engine, Canvas FX system, gradient builder, and preset format — presets from this repo are fully compatible with either.

---

## 🚀 Installation

1. Open your Open WebUI **Admin Panel**
2. Go to **Functions**
3. Click **Create New Function**
4. Copy the contents of [`open_theme_designer.py`](open_theme_designer.py) and paste it in
5. Save — the designer is now available at `/api/v1/theme-designer`

> **No sandbox flags required.** Unlike the Tool variant, this event function serves a native page via ASGI routes.

---

## ✨ Key Differences from Theme Designer Pro (Tool)

| Feature | Tool (`tool/`) | Event Function (`event-function/`) |
|---|---|---|
| **Open WebUI type** | `Tools` class | `EventEmitter` class |
| **Access method** | AI chat → iframe artifact | Direct URL → standalone page |
| **Sandbox requirement** | "Same Origin" iframe flag | None |
| **Theme persistence** | localStorage (per-browser) | Server-side files + localStorage backup |
| **Multi-user sync** | Per-browser only | SSE live push to all connected clients |
| **Draft mode** | No | Yes (sessionStorage isolation) |
| **AI-driven theming** | Yes (`apply_theme()` tool method) | No |
| **Theme disable/enable** | Manual | Valve toggle + SSE broadcast |
| **Author** | G30 (Silentoplayz) | G30 (Silentoplayz) |

---

## 🔧 Valve Configuration

Valves are configured in the Admin Panel under **Functions → Theme Designer Pro → ⚙️**.

| Valve | Type | Default | Description |
|---|---|---|---|
| **Theme Active** | `bool` | `true` | Master toggle. OFF strips all CSS and bootloader; ON re-enables. |
| **Enable Custom CSS** | `bool` | `true` | Show/hide the Style Overrides tab. |
| **Enable Canvas FX** | `bool` | `true` | Show/hide Canvas FX tab; suppresses animations when disabled. |
| **Enable Gradient Builder** | `bool` | `true` | Show/hide the Gradient tab. |
| **Enable Auth Page Theming** | `bool` | `true` | Allow theming login/signup pages. |
| **Enable URL Import** | `bool` | `true` | Allow importing from remote URLs. |
| **Allowed Import Domains** | `str` | `""` | Comma-separated domain allowlist (empty = allow all). |
| **Draft Mode Default** | `bool` | `false` | Open the designer in Draft mode by default. |
| **Designer URL** | `str` | `/api/v1/theme-designer` | URL path where the designer is served. |

---

## 📖 In-App Documentation

The designer includes **20 comprehensive documentation sections** accessible from the **Documentation** tab within the designer page itself. These cover:

1. Getting Started & Architecture
2. OKLCH Foundation & Modes
3. System Theme & OS Integration
4. Draft Mode & Publishing
5. Variable Overrides & Locks
6. Custom CSS & Auto-Scoping
7. Canvas FX Animations (incl. Worker Protocol & API contract)
8. Advanced Tools & Image Extraction
9. Libraries & Data Management
10. Theme Updates (OTA)
11. Reference: Available Variables
12. Gradient Backgrounds (incl. preset table)
13. Structural Transparency & Layer Stack
14. Keyboard Shortcuts & Editor Tips
15. Compliance & Legal Disclaimer
16. Community Presets (with import URLs)
17. Troubleshooting & FAQ
18. Uninstallation & Complete Removal
19. Portability & Backups
20. Danger Zone (Factory Reset)

---

## 🗑️ Uninstallation

Because the event function injects a bootloader into `index.html`, simply disabling it won't fully remove theming. See **Section 18** in the designer's in-app documentation for full uninstallation steps, or follow this summary:

1. **Factory Reset** — Use the Danger Zone button in the Documentation tab to wipe all data
2. **Remove server files** — Delete `DATA_DIR/theme/open_theme_designer.*`
3. **Remove bootloader** — Restart your container (`docker compose down && docker compose up -d`) to restore a clean `index.html`
4. **Disable the function** — Remove it from the Admin Panel

---

## ⚖️ Compliance & Legal

See **Section 15** in the designer's in-app documentation for the full compliance disclaimer regarding Open WebUI branding restrictions (v0.6.6+).

---

## License

[MIT](../LICENSE) — © G30 (Silentoplayz)
