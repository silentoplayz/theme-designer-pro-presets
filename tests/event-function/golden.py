#!/usr/bin/env python3
"""
Golden check for the Theme Designer Pro event function

Runs the function's pure code over every gallery theme and the theme format's
fixtures and compares what comes out with the golden files in golden/, so a
refactor that changes behavior fails here.

Three parts of the function are run as they are, read out of the function file:

- the designer's own JavaScript (theme import, the CSS generator, sanitizers,
  the contrast report, the Canvas FX settings parser), in headless Chrome
- the bootloader's sign-in page CSS assembly (enforceTheme) and its other
  pure helpers, in the same page
- the Python delivery path: saving a theme, the valve post-processing and
  what /theme.css, /state.json and /static/custom.css serve, for every
  combination of the valves it reads

Usage:
  python3 tests/event-function/golden.py            # check
  python3 tests/event-function/golden.py --update   # write the golden files
  FUNCTION_FILE=<path> python3 tests/event-function/golden.py

Needs node, Google Chrome and playwright-core (npm install --no-save
playwright-core@1.56.1), and pydantic for Python.
"""

import asyncio
import difflib
import hashlib
import importlib.util
import itertools
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FUNCTION_FILE = Path(os.environ.get("FUNCTION_FILE") or ROOT / "event-function" / "theme_designer_pro_event.py")
GOLDEN = HERE / "golden"
HARNESS = HERE / "golden-harness.js"
MODES = ("dark", "light", "oled", "her")

# Top-level declarations of the designer script the harness calls. Each must
# still exist, under this name, or the check fails.
DESIGNER_NAMES = [
    "_escAttr", "_objArr", "_parensBalanced", "_cssTok", "_toFiniteNumber", "_cssNum", "_num",
    "minifyCss", "createDefaultModeData", "DEFAULT_MODE_DATA", "SURFACE_LAYERS", "ACCENT_FIELDS",
    "_accentHex", "generatedAccent", "accentVars", "readHiddenBackgrounds", "authUrlOk",
    "hasHiddenBackgrounds", "_repairSnapshotEntry", "_isThemeEntry", "_isLegacyTheme", "parseHex", "getLuminance",
    "relativeLuminance", "contrastRatio", "contrastVerdict", "validateModeData",
    "sanitizeGradientPreset", "sanitizeGradientPresets", "sanitizeCodePreset", "sanitizeCodePresets", "sanitizeSnapshotList", "normalizeModeData",
    "ensureAllModes", "migrateLegacyTheme", "lightnessMap", "steps", "getVariablesMap",
    "getDefaultColorForStep", "detectWashedOut", "designerChromeColors", "CHROME_TEXT_MIN", "CHROME_INDICATOR_MIN", "_overrideDecls", "_shippedVars", "_contrastPairs",
    "_expandHex", "oklchToHex", "_resolveReportColor", "getEffectiveLightness", "extractKeyframes",
    "hexToRgba", "getDarkestStop", "adjustHexIntensity", "gradientSpeed", "buildGradientCss",
    "assembleThemeCss", "generateCoreCSS", "generateThemeSections", "normalizeSnapshot",
    "isThemeDuplicate", "isModeMatch", "buildUpdateDiffHtml", "parseSettings", "applySettings", "labelOf", "numberRange", "toRawGitHub",
    "semverCompare", "themeData", "createNullModeMap", "chatCssProblem", "buildCustomCss", "themeCssProblem", "linkedImportProblem", "themeFromFile", "themeFromEntry",
]
# Helpers declared inside generateThemeSections: renamed or gone, the
# generator's structure changed and the golden data should be looked at.
GENERATOR_INNER = ["buildSurfaceCss", "getBgRules", "wrapSystemMedia", "formatOverrideLine"]
# Functions and state of the bootloader's closure the harness runs. The four
# callees of enforceTheme that only touch the live page are replaced with
# no-ops in the harness (see golden-harness.js).
BOOT_FUNCTIONS = ["getParsedState", "rootMode", "themeToMode", "enforceTheme", "_colorToRgb", "buildCanvasTheme", "bgShare", "bgShares", "onOtherPage"]
BOOT_STUBBED = ["announceThemeSource", "syncHiddenBackgrounds", "pushCanvasTheme", "syncInstanceSharedCss"]
BOOT_VARS = ["_themeActive", "_personalEnabled", "_owuiThemeState", "_owuiThemeCss", "_parsedState", "_cachedCanvasOk",
             "_personal", "_strippedFrom", "_strippedCss", "_disabled", "_paletteCtx", "_rootModeSet"]

SIDEBAR = ("opaque", "translucent", "transparent")
OVERLAY = ("opaque", "translucent")


class Missing(Exception):
    pass


# ── Loading the function ──

def load_function(path, data_dir):
    """Imports the function file as Open WebUI would, with the open_webui
    modules it imports replaced by stubs: JSONCodec is the json module, and
    open_webui.env points DATA_DIR at a temporary folder."""
    def stub(name, **attrs):
        mod = types.ModuleType(name)
        mod.__dict__.update(attrs)
        sys.modules[name] = mod

    class JSONCodec:
        dumps = staticmethod(json.dumps)
        loads = staticmethod(json.loads)

    stub("open_webui")
    stub("open_webui.utils")
    stub("open_webui.utils.json_codec", JSONCodec=JSONCodec)
    stub("open_webui.env", DATA_DIR=str(data_dir), STATIC_DIR=str(data_dir), FRONTEND_BUILD_DIR=str(data_dir),
         REDIS_KEY_PREFIX="golden", WEBUI_SECRET_KEY="golden")
    spec = importlib.util.spec_from_file_location("function_theme_designer_pro", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def new_event(module, **valves):
    """An Event without __init__, which starts the live-reload listener."""
    event = module.Event.__new__(module.Event)
    event.valves = module.Event.Valves(**valves)
    return event


# ── Splitting a script into its declarations ──

DECL = re.compile(r"(?:async\s+function\s*\*?|function\s*\*?|class|const|let|var)\s+(?:([A-Za-z_$][\w$]*)|([\[{]))")
REGEX_AFTER = set("(,=:[!&|?{};+-*%<>~^")
REGEX_KEYWORDS = {"return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await"}


def line_starts(src):
    """(offset, depth) of every line start outside strings, templates,
    regexes and comments, with the bracket depth there."""
    out = []
    i, n = 0, len(src)
    depth = 0
    templates = []  # bracket depth at each open ${ in a template
    prev = ""  # last significant code character
    word = ""  # last identifier, for regex detection
    at_line_start = True
    while i < n:
        if at_line_start:
            out.append((i, depth))
            at_line_start = False
        ch = src[i]
        if ch == "\n":
            at_line_start = True
            i += 1
            continue
        if ch in " \t\r":
            i += 1
            continue
        if src.startswith("//", i):
            j = src.find("\n", i)
            i = n if j < 0 else j
            continue
        if src.startswith("/*", i):
            j = src.find("*/", i + 2)
            if j < 0:
                raise SyntaxError(f"unclosed comment at offset {i}")
            i = j + 2
            continue
        if ch in "'\"":
            j = i + 1
            while j < n and src[j] != ch:
                if src[j] == "\\":
                    j += 1
                elif src[j] == "\n":
                    raise SyntaxError(f"unclosed string at offset {i}")
                j += 1
            i = j + 1
            prev, word = "a", ""
            continue
        if ch == "`" or (ch == "}" and templates and templates[-1] == depth):
            if ch == "}":
                templates.pop()
            j = i + 1
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == "`":
                    break
                if src.startswith("${", j):
                    break
                j += 1
            if j >= n:
                raise SyntaxError(f"unclosed template at offset {i}")
            if src[j] == "`":
                i = j + 1
                prev, word = "a", ""
            else:
                templates.append(depth)
                i = j + 2
                prev, word = "(", ""
            continue
        if ch == "/" and (prev == "" or prev in REGEX_AFTER or prev == "}" or word in REGEX_KEYWORDS):
            j, in_class = i + 1, False
            while j < n:
                c = src[j]
                if c == "\\":
                    j += 2
                    continue
                if c == "\n":
                    raise SyntaxError(f"unclosed regex at offset {i}")
                if c == "[":
                    in_class = True
                elif c == "]":
                    in_class = False
                elif c == "/" and not in_class:
                    break
                j += 1
            j += 1
            while j < n and (src[j].isalnum()):
                j += 1
            i = j
            prev, word = "a", ""
            continue
        if ch.isalnum() or ch in "_$":
            j = i
            while j < n and (src[j].isalnum() or src[j] in "_$"):
                j += 1
            word = src[i:j]
            prev = "a"
            i = j
            continue
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        prev, word = ch, ""
        i += 1
    return out


def split_declarations(src, indent, depth):
    """The statements of a block whose statements start at `indent` spaces
    and bracket depth `depth`: [{name, kind, code, line}] for each
    declaration, every name it declares in `names`."""
    starts = [off for off, d in line_starts(src) if d == depth and re.match(r" {%d}\S" % indent, src[off:off + indent + 1])]
    # A line at the block's own indent that closes it ('})' etc.) ends it
    out = []
    for k, off in enumerate(starts):
        end = starts[k + 1] if k + 1 < len(starts) else len(src)
        code = src[off:end]
        first = code.lstrip()
        if first.startswith("}"):
            continue
        m = DECL.match(first)
        if not m:
            continue
        kind = first.split()[0]
        if kind == "async":
            kind = "function"
        if m.group(1):
            names = [m.group(1)]
        else:
            # const { a, b } = ... / const [a, b] = ...
            pattern = first[m.start(2):first.index("=")]
            names = re.findall(r"[A-Za-z_$][\w$]*", pattern)
        if kind in ("const", "let", "var") and m.group(1):
            names = [m.group(1)] + re.findall(r",\s*([A-Za-z_$][\w$]*)\s*=", code.split("\n")[0])
        out.append({"names": names, "kind": kind, "code": code.rstrip() + "\n", "line": src.count("\n", 0, off) + 1})
    return out


def designer_sources(event):
    """The designer page's valve config script and main script, as the
    route serves them with default valves."""
    html = event._build_html()
    scripts = re.findall(r"<script(?: [^>]*)?>(.*?)</script>", html, re.S)
    config = [s for s in scripts if "window.__THEME_PRO_CONFIG__=" in s]
    main = [s for s in scripts if re.search(r"^    function generateThemeSections\(", s, re.M)]
    if len(config) != 1 or len(main) != 1:
        raise Missing(f"designer page: expected one config script and one script declaring generateThemeSections, "
                      f"found {len(config)} and {len(main)}")
    return config[0], main[0]


def bootloader_source(event):
    """The bootloader as an app page gets it: the instance theme active,
    personal themes off, Canvas FX on, nothing embedded."""
    js = event._bootloader_body()
    for key, value in (("__THEME_ROUTE__", event._get_route_base()), ("__CANVAS_API_ACCESS__", "false"),
                       ("__THEME_ACTIVE__", "true"), ("__PERSONAL_THEMES__", "false"), ("__EMBEDDED_STATE__", "null"),
                       ("__CANVAS_FX__", "true"), ("__CALM_CHAT_COLUMN__", "false")):
        js = js.replace(key, value)
    return js


def pick(decls, wanted, where):
    found = {}
    for d in decls:
        for name in d["names"]:
            found.setdefault(name, d)
    missing = [w for w in wanted if w not in found]
    if missing:
        raise Missing(f"{where}: no longer declares {', '.join(missing)}")
    return found


def file_lines(decls, source):
    """Each declaration's line in the function file, for error messages."""
    for d in decls:
        at = source.find(d["code"].split("\n", 1)[0])
        d["line"] = source.count("\n", 0, at) + 1 if at >= 0 else None


def extract_js(event):
    source = FUNCTION_FILE.read_text(encoding="utf-8")
    config, main = designer_sources(event)
    decls = split_declarations(main, 4, 0)
    file_lines(decls, source)
    by_name = pick(decls, DESIGNER_NAMES, "designer script")
    gen = by_name["generateThemeSections"]["code"]
    inner = [n for n in GENERATOR_INNER if not re.search(r"\bconst %s = " % re.escape(n), gen)]
    if inner:
        raise Missing(f"generateThemeSections: no longer declares {', '.join(inner)}")

    boot = bootloader_source(event)
    anchor = re.search(r"^( +)function themeToMode\(", boot, re.M)
    if not anchor:
        raise Missing("bootloader: no longer declares themeToMode")
    indent = len(anchor.group(1))
    depth = dict(line_starts(boot))[anchor.start()]
    boot_decls = split_declarations(boot, indent, depth)
    file_lines(boot_decls, source)
    boot_by_name = pick(boot_decls, BOOT_FUNCTIONS + BOOT_STUBBED + BOOT_VARS, "bootloader")
    # In source order, as the closure declares them
    boot_used = [d for d in boot_decls if any(n in BOOT_FUNCTIONS + BOOT_VARS for n in d["names"])]
    return {
        "config": config,
        "designer": [{"names": d["names"], "kind": d["kind"], "code": d["code"], "line": d["line"]} for d in decls],
        "bootloader": [{"names": d["names"], "kind": d["kind"], "code": d["code"], "line": d["line"]} for d in boot_used],
        "bootStubbed": BOOT_STUBBED,
        "bootFunctions": BOOT_FUNCTIONS,
    }


# ── Inputs ──

def theme_inputs():
    files = sorted((ROOT / "themes").glob("*.json")) + sorted((ROOT / "tests" / "theme-format" / "fixtures").glob("*.json"))
    out = []
    for f in files:
        rel = f.relative_to(ROOT).as_posix()
        ident = ("fixture-" if "fixtures" in rel else "") + f.stem
        out.append({"id": ident, "file": rel, "data": json.loads(f.read_text(encoding="utf-8"))})
    return out


def run_harness(job):
    with tempfile.TemporaryDirectory() as tmp:
        job_path = Path(tmp) / "job.json"
        out_path = Path(tmp) / "out.json"
        job_path.write_text(json.dumps(job), encoding="utf-8")
        proc = subprocess.run(["node", str(HARNESS), str(job_path), str(out_path)], cwd=ROOT,
                              capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"golden-harness.js failed:\n{proc.stderr}{proc.stdout}")
        return json.loads(out_path.read_text(encoding="utf-8"))


# ── Writing outputs down ──

def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def elide(value):
    """Strings over 400 characters (Canvas FX scripts, custom CSS) as their
    length and hash; the CSS they produce is kept in full elsewhere."""
    if isinstance(value, str) and len(value) > 400:
        return f"<{len(value)} chars, sha256 {sha(value)}>"
    if isinstance(value, list):
        return [elide(v) for v in value]
    if isinstance(value, dict):
        return {k: elide(v) for k, v in value.items()}
    return value


def js(value):
    return json.dumps(value, ensure_ascii=False, separators=(", ", ": "))


def pretty(value):
    return json.dumps(elide(value), ensure_ascii=False, indent=2)


def peel(text, blocks):
    """Known blocks appended at the end of text, by name, and what's left."""
    names = []
    found = True
    while found:
        found = False
        for name, block in blocks:
            if block and text.endswith(block):
                text = text[: -len(block)]
                names.insert(0, name)
                found = True
                break
    return text, names


def delta(text, refs, blocks=()):
    """text described against the closest of refs ([(name, text)]): '= ref'
    when equal, otherwise the lines it removes (by range), adds and
    changes, after the named blocks it appends at the end."""
    best = None
    for ref_name, ref in refs:
        if text == ref:
            return f"= {ref_name}"
        body, appended = peel(text, blocks)
        out = []
        if body == ref:
            out.append(f"= {ref_name}")
        else:
            out.append(f"{ref_name}, changed:")
            a, b = ref.split("\n"), body.split("\n")
            for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
                if tag == "equal":
                    continue
                if tag in ("delete", "replace"):
                    out.append(f"- lines {i1 + 1}-{i2} ({i2 - i1}): {a[i1][:100]!r} .. {a[i2 - 1][:100]!r}")
                if tag in ("insert", "replace"):
                    out.extend("+ " + line for line in b[j1:j2])
        if appended:
            out.append("then appends: " + " + ".join(appended))
        desc = "\n".join(out)
        if best is None or len(desc) < len(best):
            best = desc
    return best


def patch(old, new, path=""):
    """Every path where two JSON values differ."""
    if isinstance(old, dict) and isinstance(new, dict):
        out = []
        for k in list(old) + [k for k in new if k not in old]:
            p = f"{path}.{k}" if path else k
            if k not in new:
                out.append(f"{p}: removed")
            elif k not in old:
                out.append(f"{p}: added {js(elide(new[k]))}")
            else:
                out.extend(patch(old[k], new[k], p))
        return out
    if old != new or type(old) is not type(new):
        return [f"{path}: {js(elide(old))} -> {js(elide(new))}"]
    return []


# ── The Python half ──

def valve_combos():
    for s, o in itertools.product(SIDEBAR, OVERLAY):
        yield f"sidebar={s} overlay={o}", {"sidebar_transparency": s, "overlay_transparency": o}


def state_combos():
    for (vk, v), c, a in itertools.product(valve_combos(), (True, False), (True, False)):
        yield f"canvas_fx={'on' if c else 'off'} auth_theming={'on' if a else 'off'} {vk}", vk, {
            **v, "enable_canvas_fx": c, "enable_auth_page_theming": a}


def save_theme(event, css, sections, state):
    """The instance theme's files, written as the save route writes them."""
    event._write_together([
        (event._get_css_path(), css),
        (event._get_sections_path(), json.dumps({k: sections[k] for k in event.SECTION_KEYS})),
        (event._get_state_path(), state),
    ])


def python_theme(module, data_dir, theme):
    """Save a theme the way the save route does, then everything the
    delivery routes serve for it under every valve combination."""
    E = module.Event
    out = {}
    css, sections, state = theme["css"], theme["sections"], theme["state"]
    blocks = [("_overlay_css()", E._overlay_css()), ("_sidebar_mobile_css()", E._sidebar_mobile_css()),
              ("_sidebar_fade_css()", E._sidebar_fade_css())]
    base = new_event(module)
    shutil.rmtree(Path(data_dir) / "theme", ignore_errors=True)
    save_theme(base, css, sections, state)
    out["python: _css_balanced"] = f"css {E._css_balanced(css)}, custom section {E._css_balanced(sections['custom'])}"
    post_css, post_sections, safe_css = {}, {}, {}
    for key, valves in valve_combos():
        ev = new_event(module, **valves)
        # Each combination against the designer's output and the
        # combinations before it, whichever reads shorter
        ps = ev._postprocess_sections(dict(sections))
        for k in list(E.SECTION_KEYS) + ["extra"]:
            refs = [(f"designer {k}", sections.get(k, ""))] + [(f"{k} of {pk}", pv[k]) for pk, pv in post_sections.items()]
            out[f"python: _postprocess_sections {key}: {k}"] = delta(ps[k], refs, blocks)
        post_sections[key] = ps
        processed = ev._postprocess_css(css)
        joined = "".join(ps[k] for k in list(E.SECTION_KEYS) + ["extra"])
        out[f"python: _postprocess_css {key}"] = delta(
            processed, [("its _postprocess_sections, joined", joined), ("designer css", css)], blocks)
        delivered = ev._get_css_delivery()
        out[f"python: /theme.css {key}"] = "none" if delivered is None else delta(
            delivered[0], [("_postprocess_css", processed)], blocks)
        safe = ev._safe_subset_css()
        out[f"python: _safe_subset_css {key}"] = delta(
            safe, [("vars + custom", sections["vars"] + sections["custom"])] + [(f"_safe_subset_css {k}", v) for k, v in safe_css.items()], blocks)
        safe_css[key] = safe
        out[f"python: _custom_css_fragment {key}"] = delta(ev._custom_css_fragment(), [("_safe_subset_css", safe)])
    # Enable Canvas FX off drops the clearing of canvas-only modes
    key = next(iter(valve_combos()))[0]
    ev = new_event(module, enable_canvas_fx=False)
    no_fx = ev._postprocess_sections(dict(sections))
    out[f"python: _postprocess_sections canvas_fx=off {key}: structural"] = delta(
        no_fx["structural"], [(f"structural of {key}", post_sections[key]["structural"])])
    out[f"python: /theme.css canvas_fx=off {key}"] = delta(
        ev._get_css_delivery()[0], [("its _postprocess_sections, joined", "".join(no_fx[k] for k in list(E.SECTION_KEYS) + ["extra"]))])
    patches = {}
    for key, vk, valves in state_combos():
        ev = new_event(module, **valves)
        delivered = ev._get_state_delivery()
        if delivered is None:
            out[f"python: /state.json {key}"] = "none"
            continue
        text = delivered[0]
        data = json.loads(text)
        # Byte for byte: compact JSON, its keys in this order, and the
        # contents described below
        compact = json.dumps(data, ensure_ascii=False, separators=(",", ":")) == text or json.dumps(data, separators=(",", ":")) == text
        lines = [("compact JSON" if compact else f"not compact JSON, sha256 {sha(text)}") + ", keys " + " ".join(data)]
        if "_cssSections" in data:
            got = data.pop("_cssSections")
            want = ev._postprocess_sections(dict(sections))
            label = vk if want == post_sections[vk] else "canvas_fx=off " + vk
            lines.append("_cssSections = _postprocess_sections " + label if got == want
                         else "_cssSections differs from _postprocess_sections " + label + ": " + js(patch(want, got)))
        # The rest of the state, against what was saved, once per canvas/auth pair
        pair = key.split(" sidebar=")[0]
        changes = "\n".join(patch(json.loads(state), data)) or "state otherwise unchanged"
        name = f"python: /state.json changes to the saved state, {pair}"
        if name not in patches:
            patches[name] = changes
            out[name] = changes
        lines.append(f"rest = changes to the saved state, {pair}" if patches[name] == changes else changes)
        out[f"python: /state.json {key}"] = "\n".join(lines)
    out["python: _strip_canvas_scripts"] = "\n".join(patch(json.loads(state), json.loads(E._strip_canvas_scripts(state))) or ["unchanged"])
    # Themes saved before the designer sent sections
    base._delete_sections()
    for key, valves in valve_combos():
        ev = new_event(module, **valves)
        out[f"python: no sections file: _safe_subset_css {key}"] = delta(
            ev._safe_subset_css(), [(f"_safe_subset_css {key}", safe_css[key]), ("vars + custom", sections["vars"] + sections["custom"])], blocks)
    legacy = base._get_state_delivery()
    out["python: no sections file: /state.json"] = "none" if legacy is None else delta(legacy[0], [("saved state", state)])
    return out


def python_units(module, data_dir):
    E = module.Event
    out = {}
    ev = new_event(module)
    out["_sidebar_fade_css"] = E._sidebar_fade_css()
    out["_sidebar_mobile_css"] = E._sidebar_mobile_css()
    out["_overlay_css"] = E._overlay_css()
    cases = ["", "{", "}", "a { b }", "a { /* } */ }", 'a { content: "}" }', "a { content: '\\'}' }", '"\nx"', "/* open",
             'a { content: "open }', "a {} }", "@media x { a { b: c } }"]
    out["_css_balanced"] = "\n".join(f"{js(c)} -> {E._css_balanced(c)}" for c in cases)
    # Only inside the structural block: a stray marker elsewhere can't widen the match
    flat = ('/*[OWUI_VARS_START]*/\nhtml.dark { --a"/*[OWUI_CLEAR_CANVAS_START]*/": red; }\n/*[OWUI_VARS_END]*/\n'
            '/*[OWUI_STRUCTURAL_START]*/\nbody { a: b }\n/*[OWUI_CLEAR_CANVAS_START]*/\n.app { c: d }\n/*[OWUI_CLEAR_CANVAS_END]*/\n'
            '/*[OWUI_CLEAR_CANVAS_GRADIENT_START]*/\n.app { e: f }\n/*[OWUI_CLEAR_CANVAS_GRADIENT_END]*/\n/*[OWUI_STRUCTURAL_END]*/\n'
            '/*[OWUI_CUSTOM_START]*/\n/*[OWUI_CLEAR_CANVAS_END]*/ .x { g: h }\n/*[OWUI_CUSTOM_END]*/\n')
    out["_drop_canvas_clearing"] = E._drop_canvas_clearing(flat)
    fx = [
        "#sidebar:not(.h-full) { /*[FX]*/ background-color: var(--color-gray-950) !important; }",
        "html.dark #sidebar { /*[FX]*/ background-color: var(--x) !important; }",
        "#sidebar:not(.h-full) { /*[FX]*/\n  background-color: rgba(10, 20, 30, 0.75) !important;\n  backdrop-filter: blur(12px) !important;\n}",
        ".a { b: c }\nhtml #sidebar { /*[FX]*/ background-color: revert-layer; }\n.d { e: f }",
        "/*[FX]*/ no rule", "x" * 3000 + " /*[FX]*/ " + "y" * 3000 + "}", "#sidebar { color: red }",
    ]
    # hexToRgba's shape for a gradient base colour that isn't hex
    fx += [f"#sidebar:not(.h-full) {{ /*[FX]*/\n  background-color: color-mix(in srgb, {c} 75%, transparent) !important;\n"
           "  backdrop-filter: blur(12px) !important;\n}"
           for c in ("rgb(10 20 30)", "oklch(0.1 0.02 260)", "navy", "color-mix(in srgb, red 5%, transparent)")]
    for mode in ("translucent", "transparent"):
        out[f"_rewrite_sidebar_fx {mode}"] = "\n".join(f"{js(c[:120])} ({len(c)}) -> {js(E._rewrite_sidebar_fx(c, mode)[-400:])}" for c in fx)
    # CSS this already rewrote comes back (a copy kept aside, saved back as a personal theme)
    def again(c, mode):
        once = E._rewrite_sidebar_fx(c, mode)
        twice = E._rewrite_sidebar_fx(once, mode)
        return "unchanged" if twice == once else f"changed to {js(twice[-400:])}"
    out["_rewrite_sidebar_fx on its own output"] = "\n".join(
        f"{mode} {js(c[:120])} ({len(c)}) -> {again(c, mode)}" for mode in ("translucent", "transparent") for c in fx)
    states = ['{"dark": {"canvasEnabled": true, "canvasScript": "x", "canvasShowAuth": true, "canvasAuthOnly": true}, "light": 5}',
              "not json", "[1]", '{"her": {"canvasScript": ""}}', "[" * 5000 + "]" * 5000,
              '{"dark": {"themeShowAuth": true}, "_hiddenBackgrounds": {"auth": {"url": "/x"}, "chat": 50}}',
              '{"_hiddenBackgrounds": 5}', '{"_cssSections": {"vars": "x"}, "oled": {"canvasScript": "y"}}']
    for name in ("_strip_canvas_from_state", "_strip_auth_from_state", "_strip_canvas_scripts"):
        out[name] = "\n".join(f"{js(s[:100])} -> {js(getattr(E, name)(s)[:300])}" for s in states)
    for flag in (True, False):
        ev = new_event(module, enable_canvas_fx=flag, enable_auth_page_theming=not flag)
        out[f"_postprocess_state canvas_fx={flag} auth_theming={not flag}"] = "\n".join(
            f"{js(s and s[:100])} -> {js(ev._postprocess_state(s) and ev._postprocess_state(s)[:300])}" for s in states + ["", None])
    # Uploaded pictures saved under another Designer Url, served at the current
    # one. (state, current base, personal); bases ending in /me must stay whole.
    def hb(**pictures):
        return json.dumps({"_hiddenBackgrounds": {k: {"source": "url", "url": u} for k, u in pictures.items()}})
    td, me = "/api/v1/theme-designer", "/api/v1/td/me"
    uploads = [
        (hb(auth="/api/v1/old/auth-background?v=1", pages="/api/v1/a/b/page-background?v=2"), td, False),
        (hb(pages=td + "/page-background?v=3"), td, False),
        (hb(pages="https://x/api/v1/a/page-background?v=4", auth="/api/v1/a/auth-background"), td, False),
        ('{"_hiddenBackgrounds": {"auth": "x-background?"}}', td, False), ('[1, "-background?"]', td, False),
        ("not json -background?", td, False),
        (hb(pages=me + "/page-background?v=5", auth=me + "/auth-background?v=5"), me, False),
        (hb(pages="/api/v1/old/me/page-background?v=6", auth="/api/v1/old/me/auth-background?v=6"), td, False),
        (hb(pages="/api/v1/a/me/page-background?v=7"), td, True),
        (hb(pages=me + "/me/page-background?v=8"), me, True),
        (hb(pages=me + "/page-background?v=9"), me, True),
        (hb(pages="/api/v1/old/me/me/page-background?v=10", auth="/api/v1/old/auth-background?v=10"), td, True),
        (hb(pages="/api/v1/old/page-background?v=11"), td, True),
        (hb(pages=td + "/page-background?v=12"), td, True),
        (hb(pages="/api/v1/a/b/page-background?v=13", auth="/api/v1/a/b/auth-background?v=13"), "/api/v1/x", True),
    ]
    out["_rebase_uploads"] = "\n".join(f"{js(s)} at {b}{' personal' if p else ''} -> {js(E._rebase_uploads(s, b, p))}"
                                        for s, b, p in uploads)
    routes = ["/api/v1/theme-designer", "/api/v1/x/", "themes", "/themes", "/api/v1/a b<c>", "/api/v2/x", "",
              "/api/v1/td/me", "/api/v1/me/", "me", "/api/v1/me/x", "/api/v1/home"]
    out["_get_route_base"] = "\n".join(f"{js(r)} -> {js(new_event(module, designer_url=r)._get_route_base())}" for r in routes)
    out["_user_dir_name"] = "\n".join(f"{js(u)} -> {E._user_dir_name(u)}" for u in
                                      ["8c1e1c2a-1b2c-4d5e-9f00-123456789abc", "a/b", "../x", "", "x" * 65, "ok_id-1"])
    html = ('<head><!-- OWUI Theme Pro Bootloader -->\n<script>a</script>\nX<!-- OWUI Theme Pro Bootloader --><script>b</script>'
            '<style id="owui-server-theme">s</style><!-- /owui-server-theme -->\n'
            '<script type="application/json" id="owui-theme-state">{}</script><!-- /owui-theme-state -->Y'
            '<!-- OWUI Theme Pro Bootloader --><script>unclosed</head>')
    out["_strip_bootloader"] = js(E._strip_legacy_index_blocks(html, E.LEGACY_INDEX_MARKERS[:1]))
    out["_strip_all_theme_blocks"] = js(E._strip_legacy_index_blocks(html, E.LEGACY_INDEX_MARKERS[1:]))
    out["asset_strip_block"] = "\n".join(js(module.asset_strip_block(c, "/*S*/", "/*E*/")) for c in
                                         ["a/*S*/x/*E*/\nb/*S*/y/*E*/c", "a/*S*/x", "plain", "/*S*//*E*//*S*/z/*E*/\n"])
    # The shared-asset registry: a file on disk with a stale block, fragments
    # out of order, one failing and one empty
    static = Path(data_dir)
    for name, text in (("loader.js", "disk();\n/*A-S*/old/*A-E*/\n"), ("custom.css", ".disk{}\n/*A-S*/old/*A-E*/\n")):
        (static / name).write_text(text, encoding="utf-8")
    app = types.SimpleNamespace(state=types.SimpleNamespace())

    def boom():
        raise ValueError("x")
    for path in (module.LOADER_PATH, module.CUSTOM_CSS_PATH):
        bucket = module.asset_fragments(app, path)
        bucket["function_b"] = {"start": "/*B-S*/", "end": "/*B-E*/", "js": lambda: "/*B-S*/b()/*B-E*/", "order": 100}
        bucket["function_a"] = {"start": "/*A-S*/", "end": "/*A-E*/", "js": lambda: "  /*A-S*/a()/*A-E*/  ", "order": "x"}
        bucket["function_c"] = {"start": "/*C-S*/", "end": "/*C-E*/", "js": boom, "order": 0}
        bucket["function_d"] = {"start": "/*D-S*/", "end": "/*D-E*/", "js": lambda: "", "order": -1}
        out[f"asset_compose {path}"] = js(module.asset_compose(app, path))
    out["_completion_text"] = "\n".join(f"{c!r} -> {js(E._completion_text(c))}" for c in [
        {"choices": [{"message": {"content": "hi"}}]}, {"choices": []}, {"message": {"content": 5}}, None, "x",
        types.SimpleNamespace(body=b'{"choices": [{"message": {"content": "b"}}]}'), types.SimpleNamespace(body=b"nope"),
        {"choices": ["x"]}, {"choices": [{"message": "x"}]}, {"choices": [None]}, {"message": "x"},
        {"choices": [{"message": {"content": [{"type": "text", "text": "p"}, "q", {"text": 1}, {"text": "r"}]}}]}])
    # A library file that isn't a JSON object is kept aside, a second one
    # beside the first, and the designer is told its name
    lib_rows = []
    for uid in (None, "u1"):
        ev = new_event(module)
        lib = ev._get_library_path(uid)
        lib.parent.mkdir(parents=True, exist_ok=True)
        for text in ('{"snapshots": [', "[1]", "", " \n", '{"snapshots": []}'):
            lib.write_text(text, encoding="utf-8")
            loaded, kept = ev._load_library_or_set_aside(uid)
            lib_rows.append(f"{uid} {js(text)} -> {js(loaded)}, kept as {re.sub(r'[0-9]{8}-[0-9]{6}(-[0-9]+)?', 'STAMP', str(kept))}"
                            f", file {'there' if lib.exists() else 'gone'}")
        lib_rows.append(f"{uid} kept: {sorted(re.sub(r'[0-9]{8}-[0-9]{6}(-[0-9]+)?', 'STAMP', f.name) for f in lib.parent.glob('*.corrupt-*'))}")
        for f in lib.parent.glob("*.corrupt-*"):
            f.unlink()
        lib.unlink()
        ev._library_notice_path(uid).unlink()
    lib.write_text("{oops", encoding="utf-8")
    html = new_event(module)._build_html("u1")
    lib_rows.append("designer config for a bad personal library: " + js(json.loads(re.search(r"__THEME_PRO_CONFIG__=(.*?);window", html).group(1)).get("libraryKeptAs", "").split(".corrupt-")[0]))
    # The Launcher's hidden apply frame sets it aside too, and leaves the
    # notice for the next designer someone sees, which takes it
    lib.write_text("{oops", encoding="utf-8")
    for label, apply in (("apply frame", {"kind": "theme", "sha": "x", "mode": "all"}), ("next designer", None), ("one after", None)):
        html = new_event(module)._build_html("u1", apply=apply)
        kept = json.loads(re.search(r"__THEME_PRO_CONFIG__=(.*?);window", html).group(1)).get("libraryKeptAs")
        lib_rows.append(f"{label}: library {'there' if lib.exists() else 'gone'}, told {re.sub(r'[0-9]{8}-[0-9]{6}(-[0-9]+)?', 'STAMP', str(kept))}")
    for f in lib.parent.glob("*.corrupt-*"):
        f.unlink()
    out["_load_library_or_set_aside"] = "\n".join(lib_rows)
    # Stream ids bind through the map, including streams a build without it
    # opened (in the set only) and one that ended there (in the map only)
    class Stream:
        def __init__(self, cid):
            self._tdp_cid = cid
    old, gone = Stream("old-cid"), Stream("gone-cid")
    sse_app = types.SimpleNamespace(state=types.SimpleNamespace(_theme_sse_clients={old}))
    E._share_sse_clients(sse_app)
    E._sse_cids["gone-cid"] = gone
    out["_bind_stream"] = "\n".join(f"{cid} -> {E._bind_stream(cid, 'u1')}, user {getattr(s, '_tdp_user', None)}, "
                                    f"mapped {sorted(sse_app.state._theme_sse_cids)}"
                                    for cid, s in (("old-cid", old), ("gone-cid", gone), ("none", None)))
    out["_is_json_object"] = "\n".join(f"{repr(v)[:40]} -> {E._is_json_object(v)}" for v in
                                        ['{"a": 1}', "{}", "[1]", "5", "", " ", "{oops", "[" * 100000, {"a": 1}, 5, None])
    out["_parse_consult"] = "\n".join(f"{js(t)} -> {js(E._parse_consult(t))}" for t in [
        '{"hue": 200, "chroma": 30, "lightness": 20, "gradient": true, "name": "Sea"}',
        '<think>{"hue": 1}</think> here: {"hue": "400", "chroma": -3, "lightness": 70.6, "gradient": "TRUE", "name": "  a \\n b  "}',
        '{"hue": null, "chroma": 1, "lightness": 1}', "no json", '[1, 2]', '{"hue": 1, "chroma": 1, "lightness": 1, "name": "' + "n" * 80 + '"}',
        '{"hue": 1e400, "chroma": 1, "lightness": 1}', None])
    # Which requests count as sent by a page on another origin, with Open
    # WebUI's WEBUI_URL unset and set
    class Config:
        url = ""

        @staticmethod
        async def get(key):
            return Config.url if key == "webui.url" else None
    sys.modules["open_webui.models"] = types.ModuleType("open_webui.models")
    sys.modules["open_webui.models.config"] = types.SimpleNamespace(Config=Config)
    origin_cases = [
        {"host": "192.168.1.5:3000", "origin": "http://192.168.1.5:3000"},
        {"host": "owui.lan", "origin": "http://owui.lan:8081"},
        {"host": "open-webui:8080", "origin": "http://owui.lan"},
        {"host": "chat.example.com", "origin": "https://chat.example.com"},
        {"host": "owui.lan:80", "origin": "http://owui.lan"},
        {"host": "OWUI.lan", "origin": "http://owui.lan"},
        {"origin": "http://owui.lan"},
        {"host": "[::1]:3000", "origin": "http://[::1]:3000"},
        {"host": "owui.lan", "origin": "http://evil.owui.lan"},
        {"host": "owui.lan", "origin": "http://lan"},
        {"host": "owui.lan", "origin": "null"},
        {"host": "owui.lan", "origin": "file://"},
        {"host": "owui.lan", "origin": "http://evil.lan", "x-forwarded-host": "evil.lan"},
        {"host": "evil.lan", "origin": "http://evil.lan", "sec-fetch-site": "same-site"},
        {"host": "owui.lan", "origin": "http://evil.lan", "sec-fetch-site": "cross-site"},
        {"host": "owui.lan", "sec-fetch-site": "none"},
        {"host": "owui.lan", "origin": "http://owui.lan", "sec-fetch-site": "same-origin"},
        {"host": "open-webui:8080", "origin": "https://owui.lan", "sec-fetch-site": "same-origin"},
        {"host": "owui.lan"},
        {},
    ]
    rows = []
    for url in ("", "https://OWUI.lan:8443/", "not a url"):
        Config.url = url
        for h in origin_cases:
            other = asyncio.run(E._from_other_origin(types.SimpleNamespace(headers=h)))
            rows.append(f"WEBUI_URL {js(url)} {js(h)} -> {'refused' if other else 'allowed'}")
    del sys.modules["open_webui.models.config"], sys.modules["open_webui.models"]
    out["_from_other_origin"] = "\n".join(rows)
    return out


# ── The bootloader half ──

def bootloader_job(module, data_dir, theme):
    """enforceTheme's cases for a theme: the CSS and state /theme.css and
    /state.json serve with default valves (and with every valve flipped),
    on a sign-in page and an app page, in each mode, from the sections in
    the state and from the flat CSS alone, and with a personal theme."""
    E = module.Event
    shutil.rmtree(Path(data_dir) / "theme", ignore_errors=True)
    base = new_event(module)
    save_theme(base, theme["css"], theme["sections"], theme["state"])
    blobs, cases = {}, []

    def blob(text):
        key = sha(text)
        blobs[key] = text
        return key
    for label, valves in (("default valves", {}), ("every valve flipped", {
            "sidebar_transparency": "transparent", "overlay_transparency": "translucent",
            "enable_canvas_fx": False, "enable_auth_page_theming": False})):
        ev = new_event(module, **valves)
        css = blob(ev._get_css_delivery()[0])
        state_text = ev._get_state_delivery()[0]
        state = blob(state_text)
        legacy = json.loads(state_text)
        legacy.pop("_cssSections", None)
        legacy = blob(json.dumps(legacy, separators=(",", ":")))
        for path, mode in itertools.product(("/auth", "/"), ("dark", "oled-dark", "light", "her")):
            forms = [("sections", state), ("flat css only", legacy)] if label == "default valves" else [("sections", state)]
            for form, st in forms:
                cases.append({"id": f"{label}, {path}, {mode}, {form}", "path": path, "theme": mode, "css": css, "state": st})
            if path == "/" and label == "default valves":
                cases.append({"id": f"{label}, {path}, {mode}, personal theme", "path": path, "theme": mode, "css": css,
                              "state": state, "personal": True})
    return {"blobs": blobs, "cases": cases}


def bootloader_outputs(results, groups):
    out = {}
    by_id = {c["id"]: (c, g["blobs"]) for g in groups for c in g["cases"]}
    seen = {}  # output -> the first case of its theme that put it on the page
    for r in results:
        c, blobs = by_id[r["id"]]
        if r.get("threw"):
            text = "threw " + r["threw"]
        elif r["css"] is None:
            text = "no style element"
        else:
            tid = r["id"].split(": ", 1)[0]
            first = seen.setdefault((tid, r["css"]), r["id"].split(": ", 1)[1])
            text = delta(r["css"], [("/theme.css", blobs[c["css"]])]) if first == r["id"].split(": ", 1)[1] else f"= the page of: {first}"
        out[f"bootloader: enforceTheme {r['id']}"] = f"data-theme {r['dataTheme']!r}, class {r['classes']!r}\n{text}"
    return out


# ── Golden files ──

SHARED_MIN = 300
MARK = "#=# "  # starts each section of a golden file


def designer_outputs(t, source):
    out = {}
    lines = [f"sha256 {sha(json.dumps(t['imported'], ensure_ascii=False))}"]
    # Fields the file leaves out come back as DEFAULT_MODE_DATA's, listed by name
    defaults = t["defaultModeData"]
    filled, rest = {}, []
    for line in patch(source, t["imported"]):
        m = re.match(r"(\w+)\.(\w+): added (.*)$", line)
        if m and m.group(1) in MODES and m.group(2) in defaults and json.loads(m.group(3)) == elide(defaults[m.group(2)]):
            filled.setdefault(m.group(1), []).append(m.group(2))
        else:
            rest.append(line)
    for mode, keys in filled.items():
        lines.append(f"{mode}: added from DEFAULT_MODE_DATA: {' '.join(keys)}")
    lines.extend(rest)
    if len(lines) == 1:
        lines.append("same as the file")
    out["designer: imported theme (ensureAllModes, normalizeModeData), against the file"] = "\n".join(lines)
    out["designer: normalizeSnapshot"] = t["normalizeSnapshot"] if isinstance(t["normalizeSnapshot"], str) else pretty(t["normalizeSnapshot"])
    out["designer: isThemeDuplicate of itself"] = js(t["isThemeDuplicate"])
    for k in ("vars", "structural", "gradient"):
        out[f"designer: generateThemeSections {k}"] = t["sections"][k]
    # The custom section against each mode's own customCSS, in the order the
    # generator writes them (Light and Dark twice, for System)
    modes = json.loads(t["state"])
    own = []
    for m in ("light", "dark", "oled", "her"):
        d = modes[m]
        if d.get("customCSS") and d.get("customCssEnabled") is not False:
            own += [d["customCSS"]] * (2 if m in ("light", "dark") else 1)
    out["designer: generateThemeSections custom"] = delta(t["sections"]["custom"], [("each mode's customCSS", "\n".join(own))]) if own else t["sections"]["custom"]
    out["designer: generateCoreCSS"] = "= vars + structural + gradient + custom" if t["coreCssIsAssembled"] else t["css"]
    for m in MODES:
        d = t["modes"][m]
        lines = [f"_shippedVars: {d['shipped']['overridden']} overridden, defaults {js(d['shipped']['usingDefaults'])}"]
        if d["variables"] != d["shipped"]["vars"]:
            lines.append("getVariablesMap before overrides: " + js(d["variables"]))
        lines.append("accentVars: " + js(d["accents"]))
        for c in d["contrast"]:
            v = c["verdict"]
            lines.append(f"contrast {c['label']}: {c['fg']} on {c['bg']} = {c['ratio']} "
                         f"(aaa {js(v['aaa'])}, aa {js(v['aa'])}, aaLarge {js(v['aaLarge'])})")
        lines.append("detectWashedOut: " + js(d["washedOut"]))
        lines.append("buildGradientCss(.scope): " + (f"{len(d['gradient'])} chars, sha256 {sha(d['gradient'])}" if d["gradient"] else "''"))
        same = [p for p in MODES[:MODES.index(m)] if t["modes"][p]["canvasSettings"] == d["canvasSettings"]]
        if same and d["canvasSettings"]:
            lines.append(f"parseSettings: same as {same[0]} mode")
        else:
            lines.extend(f"parseSettings: line {e['line']} at {e['at']} len {e['len']} {e['key']} {e['kind']} {js(e['value'])}"
                         + (f" {e['min']}..{e['max']} step {e['step']}" if e["kind"] == "number" else "")
                         + (f" quote {e['quote']}" if "quote" in e else "")
                         + f" label {js(e['label'])} section {js(e['section'])} hint {js(e['hint'])}"
                         + "".join(f" {k} {js(v)}" for k, v in e.items() if k not in (
                             "line", "at", "len", "key", "kind", "value", "min", "max", "step", "quote", "label", "section", "hint"))
                         for e in d["canvasSettings"])
        out[f"designer: {m} mode"] = "\n".join(lines)
    return out


def row_text(row):
    """One case: its input and output as JSON, a multi-line string output
    as its lines, so a diff points at the line that changed."""
    if not isinstance(row, list):
        return js(row)
    *args, result = row
    head = " -> ".join(js(x) for x in args)
    if isinstance(result, str) and "\n" in result:
        return head + " ->\n" + "\n".join("  | " + line for line in result.split("\n"))
    return f"{head} -> {js(result)}" if args else js(result)


def units_text(units):
    out = {}
    for name, value in units.items():
        if isinstance(value, list):
            out[name] = "\n".join(row_text(row) for row in value)
        elif isinstance(value, dict):
            out[name] = "\n".join(f"{k}:\n{v}" if isinstance(v, str) else f"{k}: {js(v)}" for k, v in value.items())
        else:
            out[name] = value if isinstance(value, str) else js(value)
    return out


def collect():
    """Every output, as {file name: {section: text}}."""
    with tempfile.TemporaryDirectory() as data_dir:
        module = load_function(FUNCTION_FILE, data_dir)
        event = new_event(module)
        js_job = extract_js(event)
        themes = theme_inputs()
        designer = run_harness({"phase": "designer", "js": js_job, "required": DESIGNER_NAMES, "themes": themes})
        if designer["pageErrors"]:
            raise RuntimeError("designer page errors: " + "; ".join(designer["pageErrors"]))
        files = {}
        groups = []
        for t in themes:
            res = designer["themes"][t["id"]]
            files[f"themes/{t['id']}.txt"] = {**designer_outputs(res, t["data"]), **python_theme(module, data_dir, res)}
            group = bootloader_job(module, data_dir, res)
            for c in group["cases"]:
                c["id"] = f"{t['id']}: {c['id']}"
            groups.append(group)
        variables = {}
        hostile = designer["units"].pop("generateThemeSections_hostile")
        fixture = designer["themes"]["fixture-every-field"]
        for m in MODES:
            variables[m] = {"config": json.loads(fixture["state"])[m], "vars": fixture["modes"][m]["shipped"]["vars"]}
        boot = run_harness({"phase": "bootloader", "js": js_job, "required": DESIGNER_NAMES, "groups": groups, "variables": variables})
        if boot["pageErrors"]:
            raise RuntimeError("bootloader page errors: " + "; ".join(boot["pageErrors"]))
        for key, text in bootloader_outputs(boot["cases"], groups).items():
            tid, rest = key[len("bootloader: enforceTheme "):].split(": ", 1)
            files[f"themes/{tid}.txt"][f"bootloader: enforceTheme {rest}"] = text
        units = units_text(designer["units"])
        for k in ("vars", "structural", "gradient", "custom"):
            units[f"generateThemeSections over hostile mode data: {k}"] = hostile[k]
        files["designer-units.txt"] = units
        files["bootloader-units.txt"] = units_text(boot["units"])
        files["python-units.txt"] = python_units(module, data_dir)
        return files


def render(files):
    """{path: text} for the golden folder, long texts that repeat moved to
    shared.txt and referenced by hash."""
    counts = {}
    for sections in files.values():
        for text in sections.values():
            if len(text) >= SHARED_MIN:
                counts[text] = counts.get(text, 0) + 1
    shared = {sha(t): t for t, n in counts.items() if n > 1}
    out = {}
    for path, sections in files.items():
        parts = [f"# {path} - written by golden.py --update, do not edit\n"]
        for key, text in sections.items():
            h = sha(text)
            body = f"@shared {h}" if h in shared and shared[h] == text else text
            if MARK in body or MARK in key:
                raise RuntimeError(f"{path}: {key} contains the section marker")
            parts.append(f"\n{MARK}{key}\n{body}\n")
        out[path] = "".join(parts)
    out["shared.txt"] = "# shared.txt - long outputs that repeat across themes, by sha256 - written by golden.py --update\n" + "".join(
        f"\n{MARK}{h}\n{t}\n" for h, t in sorted(shared.items()))
    return out


HEADER = re.compile(r"^#=# (.+)$", re.M)


def parse(text):
    """{section: text} from a golden file; a section's text runs from its
    header to the next one, less the blank line render() puts before it."""
    marks = list(HEADER.finditer(text))
    out = {}
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        body = text[m.end() + 1:end]
        out[m.group(1)] = body[:-2] if i + 1 < len(marks) else body[:-1]
    return out


def load_golden():
    if not GOLDEN.is_dir():
        return None
    shared = parse((GOLDEN / "shared.txt").read_text(encoding="utf-8")) if (GOLDEN / "shared.txt").exists() else {}
    files = {}
    for f in sorted(GOLDEN.rglob("*.txt")):
        rel = f.relative_to(GOLDEN).as_posix()
        if rel == "shared.txt":
            continue
        sections = parse(f.read_text(encoding="utf-8"))
        for k, v in sections.items():
            if v.startswith("@shared "):
                sections[k] = shared.get(v[8:], f"<missing shared block {v[8:]}>")
        files[rel] = sections
    return files


def compare(expected, actual):
    """Readable differences, one per distinct change: the same change in
    several themes is printed once with every theme it affects."""
    groups = {}
    for path in sorted(set(expected) | set(actual)):
        e, a = expected.get(path), actual.get(path)
        if e is None or a is None:
            groups.setdefault(("file " + ("added" if e is None else "removed"), ""), []).append(path)
            continue
        for key in list(e) + [k for k in a if k not in e]:
            if key not in a:
                groups.setdefault((f"section removed: {key}", ""), []).append(path)
            elif key not in e:
                groups.setdefault((f"section added: {key}", a[key][:2000]), []).append(path)
            elif e[key] != a[key]:
                diff = "\n".join(difflib.unified_diff(e[key].split("\n"), a[key].split("\n"), "golden", "now", n=2, lineterm=""))
                if len(diff) > 6000:
                    diff = diff[:6000] + f"\n... ({len(diff) - 6000} more characters of diff)"
                groups.setdefault((key, diff), []).append(path)
    return groups


def main():
    started = time.time()
    # The function logs its warnings (a corrected designer_url, a failing
    # fragment the registry case feeds it); they're expected here
    logging.disable(logging.CRITICAL)
    update = "--update" in sys.argv[1:]
    try:
        actual = collect()
    except Missing as e:
        print(f"FAIL: {e}\nA function the golden check runs was renamed or removed. Point golden.py at its new name, "
              "then check that the golden data still passes.", file=sys.stderr)
        return 2
    except RuntimeError as e:
        print(f"FAIL: {e}", file=sys.stderr)
        return 2
    if update:
        if GOLDEN.exists():
            shutil.rmtree(GOLDEN)
        for rel, text in render(actual).items():
            p = GOLDEN / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8")
        n = sum(len(s) for s in actual.values())
        print(f"Wrote {n} outputs in {len(actual)} files to {GOLDEN.relative_to(ROOT)} ({time.time() - started:.1f}s)")
        return 0
    expected = load_golden()
    if expected is None:
        print("No golden data: run with --update first", file=sys.stderr)
        return 2
    groups = compare(expected, actual)
    total = sum(len(s) for s in expected.values())
    if not groups:
        print(f"golden: {total} outputs in {len(expected)} files match ({time.time() - started:.1f}s)")
        return 0
    print(f"golden: {sum(len(v) for v in groups.values())} differences from {FUNCTION_FILE}\n")
    for (key, diff), paths in groups.items():
        where = ", ".join(p.removeprefix("themes/").removesuffix(".txt") for p in paths)
        print(f"== {key}\n   in {len(paths)}: {where}")
        if diff:
            print("   " + diff.replace("\n", "\n   "))
        print()
    print(f"({time.time() - started:.1f}s) If the change is intended, run with --update and commit the golden data.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
