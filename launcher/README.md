# 🚀 Theme Designer Pro Launcher

The Launcher is a companion Tool for the [Theme Designer Pro event function](../event-function/). It brings the designer into an Open WebUI chat, so you can change your theme without leaving the conversation. Describe the theme you want, such as _"a forest green theme, like moss after rain"_. The chat model picks the colors and opens the designer in the chat with them applied, ready to fine-tune.

Everyone gets their own personal theme this way, and admins can also change the instance theme that every user sees.

The Launcher is on the Open WebUI community platform as [Theme Designer Pro Launcher](https://openwebui.com/posts/467b9ac8-731b-4d60-bafe-9fb4e2dfda35).

---

## 💬 What you can ask

| Ask | What happens |
|---|---|
| _"Open Theme Designer Pro"_ | The designer opens inside the chat. A user gets their own personal theme. An admin gets the instance theme, or their own personal theme when they ask for _"my theme"_. |
| _"Give me a warm copper theme"_ | The chat model turns the description into a hue, a chroma, a lightness and a matching gradient. The designer opens in the chat with that theme applied to your personal theme, and you fine-tune it with the sliders. |
| _"Make a calm ocean theme for everyone"_ | For an admin, this changes the instance theme every user sees instead. A user who asks for _"everyone"_ still only changes their own theme. |
| _"A dark purple theme, just for OLED mode"_ | The theme applies to one mode (Dark, OLED, Light or Her) instead of all of them. |

A theme from a chat changes only the palette and the gradient. Your custom CSS, Canvas FX and locked colors stay as they are.

---

## ✅ Before you start

- **Open WebUI v0.11.0 or later**, with the **Theme Designer Pro event function v1.10.0 or later** installed and turned on.
- **For users:** the event function's **Allow Personal Themes** valve turned on. Without it, a user who asks the Launcher sees a short note to ask their admin. Admins can still change the instance theme.
- **For everyone who uses it:** **Settings > Interface > iframe Sandbox Allow Same Origin** turned on, in their own settings. Open WebUI shows a Tool's output in a sandboxed frame. Without this setting, that frame has no origin of its own, so the browser doesn't send the designer your sign-in, and the chat shows a note naming the setting instead of the designer. With it on, HTML that tools and models show in your chats runs with your Open WebUI page's access, so turn it on only on an instance whose tools you trust. The legacy Theme Designer Pro Tool needed the same setting.
- **A model that calls tools.** It works with both **Default** and **Native** function calling. I tested it with `qwen3.6:35b-a3b-q4_K_M` on Ollama.

---

## 📦 Install

1. Go to **Workspace** > **Tools** > **Create New Tool**.
2. Copy the contents of [`theme_designer_pro_launcher.py`](theme_designer_pro_launcher.py), or the code on the Launcher's [community page](https://openwebui.com/posts/467b9ac8-731b-4d60-bafe-9fb4e2dfda35), paste it in, and save.
3. **Share it with your users.** A Tool an admin creates is private until you give users or groups access to it in the Tool's access settings.
4. Turn it on for a chat from the tools button in the message box. To have it on by default, add it to a model under **Workspace** > **Models** > the model > **Tools**.

The Launcher's **Designer Url** valve must match the event function's **Designer Url** valve. Both default to `/api/v1/theme-designer`.

---

## 🔒 Why a link can't change your theme

The designer never applies colors that are simply written into its address. The Launcher signs the values it asks for with Open WebUI's `WEBUI_SECRET_KEY`, for the one person who asked. The event function applies them only when all of these hold:

- The signature checks out.
- The designer is opened by that same person.
- It's opened within five minutes of the request.
- The request matches where the theme lands, so a personal request can't change the instance theme.

Anything else opens the designer without applying anything. The chat's **Pop out** link carries no signed values, so it never applies the theme again, and neither does reopening the chat later.

---

## ⚙️ Valves

| Valve | Default | What it does |
|---|---|---|
| **Designer Url** | `/api/v1/theme-designer` | Where the event function serves the designer. Must match the event function's own **Designer Url** valve. |
| **Iframe Height** | `800` | Height of the designer in the chat, in pixels. |
| **Iframe Scale** | `1.0` | Size of the designer inside the chat. Lower values, such as `0.8`, show more of it at a smaller size. |

---

## 🛠️ Troubleshooting

- **The chat says to turn on iframe Sandbox Allow Same Origin.** Turn it on in **Settings > Interface**, then ask again. See [Before you start](#-before-you-start) for what the setting allows.
- **The designer says personal themes are turned off.** Your admin needs to turn on the event function's **Allow Personal Themes** valve.
- **The model answers in words but no designer opens.** The Launcher isn't on for this chat, or the model didn't call it. Turn the Tool on from the message box, or try **Native** function calling in the model's **Advanced Params**.
- **An older chat opens the designer without the theme.** That's expected: a theme from a chat applies only within five minutes of the request.

---

## 📝 What's New in 1.1.0

- **Describe a theme in a chat.** The new `apply_theme` turns a description into a theme and opens the designer with it applied, as the legacy Tool's AI Color Consultant did.
- **Users can use it, not only admins.** Users open and change their own personal theme. Admins open the instance theme, or their own with _"my theme"_.
- **The designer shows once per reply.** Earlier versions could show it twice.
- **A plain note instead of an error** when **iframe Sandbox Allow Same Origin** is off.

---

## License

[MIT](../LICENSE) © [@G30](https://openwebui.com/u/g30)
