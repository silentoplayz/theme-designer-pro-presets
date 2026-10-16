"""Reads a harness output folder and reports how each stage looks.

Usage: python3 tests/canvas-fx/analyze.py <outdir>  (needs Pillow)

coverage: share of pixels that differ visibly from the theme background.
calm: the chat column's average difference divided by the rest of the
screen's (more than 40 px clear of the column), leaving out the strip the
harness's sidebar covers. Under 1 means the column is
calmer, as the house standard asks. The column is where the harness said it was
in that stage, so a script that ignores the layout message scores badly in
3-dark-shifted.
Flags: blank (nothing drawn), opaque (the backdrop is painted over).
"""

import json
import sys
from pathlib import Path

from PIL import Image, ImageChops

BACKGROUNDS = {"dark": (0x1A, 0x18, 0x26), "light": (0xF4, 0xF6, 0xF9)}


def stage_background(name):
    return BACKGROUNDS["dark" if "dark" in name else "light"]


def measure(png, column=None):
    img = Image.open(png).convert("RGB")
    w, h = img.size
    img = img.resize((w // 4, h // 4))
    sw, sh = img.size
    bg = Image.new("RGB", img.size, stage_background(png.stem))
    diff = ImageChops.difference(img, bg).convert("L")
    px = diff.load()
    col = column or {"x": w / 2, "width": 928}
    cx = col["x"] / w * sw
    half_band = col["width"] / 2 / w * sw
    clear = half_band + 40 / w * sw
    left = col.get("left", 0) / w * sw
    total = covered = 0
    center_sum = center_n = edge_sum = edge_n = 0
    for y in range(sh):
        for x in range(int(left), sw):
            v = px[x, y]
            total += 1
            covered += v > 6
            if abs(x - cx) < half_band:
                center_sum += v
                center_n += 1
            elif abs(x - cx) > clear:
                edge_sum += v
                edge_n += 1
    coverage = covered / total
    center = center_sum / max(1, center_n)
    edge = edge_sum / max(1, edge_n)
    flags = []
    if coverage < 0.005:
        flags.append("blank")
    if coverage > 0.97:
        flags.append("opaque")
    return {
        "coverage": round(coverage, 3),
        "center": round(center, 1),
        "edge": round(edge, 1),
        "calm": round(center / edge, 2) if edge > 0.5 else None,
        "flags": flags,
    }


def main():
    out = Path(sys.argv[1])
    summary = json.loads((out / "summary.json").read_text()) if (out / "summary.json").exists() else {}
    columns = summary.get("columns", {})
    report = {png.stem: measure(png, columns.get(png.stem)) for png in sorted(out.glob("*.png"))}
    summary["stages"] = report
    (out / "report.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
