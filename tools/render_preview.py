"""
Render sample text with the watch's own font, pixel-exact, from a (patched) firmware image.

  ./venv/bin/python tools/render_preview.py firmware/CMF_Watch3Pro_1.0.1.77_greek.bin docs/greek-preview.png

The glyphs are decoded straight from sans36.font inside the image, so the PNG
shows exactly what the watch draws (2 bpp anti-aliasing, white on black).
"""
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lvfont import LvFont                        # noqa: E402
from repack import parse_aota, unlzma            # noqa: E402
from sdfs import entries                         # noqa: E402

LINES = [
    "ΑΒΓΔΕΖΗΘΙΚΛΜ",
    "ΝΞΟΠΡΣΤΥΦΧΨΩ",
    "αβγδεζηθικλμ",
    "νξοπρσςτυφχψω",
    "άέήίόύώ ϊϋΐΰ ΆΈΉΊΌΎΏ",
    "0123456789 ; · « »",
]
PAD, LINE_GAP = 24, -14


def load_font(image_path):
    _, files = parse_aota(open(image_path, "rb").read())
    raw = unlzma(dict(files)["fonts.bin"])
    o, s = {n: (o, s) for n, o, s, _ in entries(raw)[1:]}["sans36.font"]
    return LvFont(raw[o:o + s])


def render(font, lines):
    asc, desc = font.ascent, abs(font.descent)
    line_h = asc + desc + LINE_GAP
    glyphs = [[font.glyph(font.gid(ord(c))) for c in ln] for ln in lines]
    width = max(sum(g["adv"] for g in gl) // 16 for gl in glyphs) + 2 * PAD
    img = Image.new("L", (width, len(lines) * line_h + 2 * PAD - LINE_GAP), 0)
    px = img.load()
    for row, gl in enumerate(glyphs):
        pen = PAD * 16                                   # 1/16 px units
        baseline = PAD + row * line_h + asc
        for g in gl:
            ox, oy = pen // 16 + g["x"], baseline - g["y"] - g["h"]
            for yy, r in enumerate(g["px"]):
                for xx, v in enumerate(r):
                    if v:
                        px[ox + xx, oy + yy] = v * 85   # 2 bpp -> 0..255
            pen += g["adv"]
    return img


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    f = load_font(sys.argv[1])
    missing = sorted({c for ln in LINES for c in ln if c != " " and not f.gid(ord(c))})
    if missing:
        print("not in font:", "".join(missing))
    render(f, LINES).save(sys.argv[2])
    print("wrote", sys.argv[2])
