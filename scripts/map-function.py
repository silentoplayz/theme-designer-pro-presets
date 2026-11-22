#!/usr/bin/env python3
"""Print a live map of event-function/theme_designer_pro_event.py.

Line numbers drift with every edit, so nothing (people or agents) should
navigate this file by remembered line numbers. Run this instead:

    python3 scripts/map-function.py            # region table
    python3 scripts/map-function.py --symbols  # plus every def / JS function
    python3 scripts/map-function.py --region designer-js --symbols

Regions are found by anchors in the source, not by fixed offsets.
"""

import argparse
import re
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "event-function" / "theme_designer_pro_event.py"

# (name, start-anchor regex, end-anchor regex or None = next region's start)
REGIONS = [
    ("header", r"^\"\"\"", r"^RELOAD_STATE_ATTR"),
    ("live-reload+shared-assets", r"^RELOAD_STATE_ATTR", r"^class Event:"),
    ("valves", r"^    class Valves\(BaseModel\):", r"^    BOOTLOADER_SCRIPT|^    def __init__"),
    ("bootloader-js", r'<script id="owui-theme-bootloader">', r"^    </script>"),
    ("python-core", r"^    def __init__\(self\):", r"^    def _register_route"),
    ("routes", r"^    def _register_route", r"^    async def _handle_css_save"),
    ("save+apply+ai-consult", r"^    async def _handle_css_save", r"^    def _build_html"),
    ("designer-css", r"^    def _build_html", r'data-tab="themes"'),
    ("designer-html", r'data-tab="themes"', r'<script type="text/plain" id="bootloader-src">'),
    ("designer-js", r'<script type="text/plain" id="bootloader-src">', r"^</script>"),
    ("html-postprocess", r"^</script>", r"^    def _strip_canvas_from_state"),
    ("css-postprocess", r"^    def _strip_canvas_from_state", r"^    def _redis_url"),
    ("redis+sse+lifecycle", r"^    def _redis_url", r"^    async def event\("),
    ("event-entry", r"^    async def event\(", None),
]

PY_DEF = re.compile(r"^(\s*)(?:async\s+)?def\s+(\w+)")
JS_FN = re.compile(r"^\s*(?:async\s+)?function\s+(\w+)\s*\(|^\s*(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>")


def find(lines, pattern, start=0):
    rx = re.compile(pattern)
    for i in range(start, len(lines)):
        if rx.search(lines[i]):
            return i
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", action="store_true", help="list defs / JS functions per region")
    ap.add_argument("--region", help="only this region")
    ap.add_argument("--file", default=str(SRC))
    args = ap.parse_args()

    lines = Path(args.file).read_text(encoding="utf-8").splitlines()
    print(f"{args.file}: {len(lines)} lines")
    m = re.search(r'^VERSION = "([^"]+)"', "\n".join(lines), re.M)
    print(f"VERSION {m.group(1) if m else '?'}\n")

    # Regions are in file order, so each start anchor is searched for after
    # the previous region's start: generic anchors like ^</script> occur
    # more than once.
    spans = []
    cursor = 0
    for name, s_rx, e_rx in REGIONS:
        s = find(lines, s_rx, cursor)
        if s is None:
            print(f"!! anchor for region {name!r} not found: {s_rx}", file=sys.stderr)
            continue
        e = find(lines, e_rx, s + 1) if e_rx else len(lines) - 1
        cursor = s + 1
        spans.append((name, s, e if e is not None else len(lines) - 1))

    print(f"{'region':28} {'start':>6} {'end':>6} {'lines':>6}")
    for name, s, e in spans:
        if args.region and name != args.region:
            continue
        print(f"{name:28} {s + 1:>6} {e + 1:>6} {e - s + 1:>6}")
        if not args.symbols:
            continue
        js = name in ("bootloader-js", "designer-js")
        for i in range(s, e + 1):
            if js:
                mm = JS_FN.match(lines[i])
                if mm:
                    print(f"    {i + 1:>6}  fn {mm.group(1) or mm.group(2)}")
            else:
                mm = PY_DEF.match(lines[i])
                if mm and len(mm.group(1)) <= 8:
                    print(f"    {i + 1:>6}  def {mm.group(2)}")


if __name__ == "__main__":
    main()
