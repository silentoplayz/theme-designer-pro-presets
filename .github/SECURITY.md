# Security Policy

## Reporting a Vulnerability

If you discover a security issue in Theme Designer Pro (the event function, the tool, the launcher) or in the preset pipeline (validation scripts, CI workflows, submission bot), please report it privately:

- **Preferred:** [Open a private security advisory](https://github.com/silentoplayz/theme-designer-pro-presets/security/advisories/new) on GitHub.
- Please do **not** open a public issue for exploitable vulnerabilities.

Include what you found, where (file and version), and reproduction steps if you have them. You should receive a response within a few days.

## Supported Versions

Only the **latest code on `main`** (and the matching published function/tool versions) receives security fixes. If you are running an older pasted copy of the event function or tool, update to the current version before reporting.

## Scope & Security Model

Understanding what is and isn't a vulnerability here:

- **Canvas FX presets are arbitrary JavaScript.** Every script in `canvas-fx/` executes in users' browsers (Web Worker or main-thread fallback). Scripts are reviewed during curation, but you should always read a script before importing it — in the event function, Canvas FX applies to **all users** of the instance and only admins can set it. A preset that is merely resource-hungry is a quality issue, not a security issue; a preset that exfiltrates data or escapes its execution scope **is** a security issue.
- **The event function and tool write to `index.html`.** This is by design (theme persistence). Bugs that allow a **non-admin** to influence what gets injected, bypass the admin gate on the designer page or save endpoint, or break out of the CSS/state sandboxing are security issues.
- **The SSE endpoint (`/events`) is intentionally unauthenticated** (auth pages need live updates too) and is bounded by a per-worker connection cap. The broadcast carries only a version token — never theme content or user data.
- **URL-import valves are client-side convenience guards**, not server-enforced security boundaries. This is documented behavior, not a vulnerability.

## CI / Supply Chain

Bundles, the manifest, and the gallery catalog are rebuilt by GitHub Actions from the individual preset files on every push to `main`. If you find a way to smuggle content through the submission bot or build scripts that bypasses validation, report it privately as above.
