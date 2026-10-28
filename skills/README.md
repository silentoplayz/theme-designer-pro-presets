# Skills

Open WebUI skills that teach a chat model to design Theme Designer Pro themes. They work with the [Theme Designer Pro Launcher](../launcher/): the Launcher gives the model a `create_theme` tool and shows the result as a card with a live preview and **Apply**; a skill gives it the know-how to design a good theme and to write a new animated background when the catalog has nothing that fits.

| Skill | What it teaches |
|---|---|
| [`theme-designer-pro`](theme-designer-pro/) | Turning a description into a whole theme: palette and accents, gradients, frosted glass, custom CSS, and writing a new Canvas FX animation, with references, a template and two catalog examples |

## Install

Skills with supporting files need **Open WebUI v0.12.0 or later**.

1. Go to **Workspace** > **Skills** > **Import**.
2. Import from the URL `https://github.com/silentoplayz/theme-designer-pro-presets/tree/main/skills/theme-designer-pro`, or download this folder as a ZIP and import that.
3. Give the model you theme with both the skill and the **Theme Designer Pro Launcher** tool: **Workspace** > **Models** > the model > **Skills** and **Tools**. Or mention the skill in a chat with `$theme-designer-pro`.
4. Turn on **Native** function calling for that model (**Advanced Params** > **Function Calling**), so it can read the skill's files with `read_skill_file`.

Then ask for a theme: _"make my chat a lantern festival at night"_. The model reads the skill, writes what the catalog doesn't have, and the card appears.

## What a model can and can't write

A theme's animation is code that runs in every browser that shows the theme, so the Launcher and Theme Designer Pro hold a script the model wrote to strict rules:

- The Launcher checks it before the card appears and sends anything that breaks the rules back to the model to fix.
- Theme Designer Pro **1.18.0** and later run it isolated, in a sandboxed frame with no origin and a policy that allows no requests: it can draw, but it can't reach the user's account, the page or the network. The card refuses to apply one on an older version.
- The user sees **View code** on the card, and nothing changes until they press **Apply**.

Custom CSS from a model can't load anything: no `@import`, and `url()` only for `data:` URLs.

## For contributors

`npm test` checks every skill here: Open WebUI's frontmatter rules (a lowercase-hyphenated `name` that matches the folder, a one-line `description` of at most 1024 characters ending with a period), that files in `examples/` are still exact copies of the `canvas-fx/` scripts they're named after, that templates in `templates/` meet the [Canvas FX house standard](../canvas-fx/README.md), and that there are no symbolic links, which Open WebUI refuses to import. After changing a catalog script that a skill copies, copy it into the skill again.
