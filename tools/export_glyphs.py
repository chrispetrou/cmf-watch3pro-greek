"""
Export each language's rasterised glyphs for the web app, so the browser needs neither the
fonts nor lv_font_conv.

  ./venv/bin/python tools/export_glyphs.py [--lv-font-conv cache/lvconv/node_modules/.bin/lv_font_conv]

Writes web/public/glyphs/<lang>.json: [codepoint, advance (1/16 px), x, y, w, h, pixels], where
pixels is one 2bpp value per pixel as a string of digits 0-3, row by row. Run it again after
changing a language or its font in tools/languages.py.

Also writes web/public/emoji.json for the emoji option (tools/emoji.py): "symbols" are glyphs
for the text font in the same format, "colour" maps a hex codepoint to its 30 x 30 RGBA
image (base64), or to {w, h, tail, rgba} for an entry of another size.
"""
import base64
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from build_firmware import DEFAULT_FONTS_DIR, render_glyphs   # noqa: E402
from languages import FONTS, LANGUAGES, codepoints, fetch_font  # noqa: E402

OUT = os.path.join(ROOT, "web", "public", "glyphs")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lv-font-conv", default=os.path.join(DEFAULT_FONTS_DIR, "lvconv", "node_modules", ".bin", "lv_font_conv"))
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    for lang, L in sorted(LANGUAGES.items()):
        font = FONTS[L["font"]]
        glyphs = render_glyphs(fetch_font(L["font"], DEFAULT_FONTS_DIR), codepoints(lang), a.lv_font_conv)
        doc = {
            "lang": lang,
            "font": font["name"],
            "fontSha256": font["sha256"],
            "glyphs": [[cp, adv, x, y, w, h, "".join(str(v) for row in px for v in row)]
                       for cp, adv, x, y, w, h, px in glyphs],
        }
        path = os.path.join(OUT, f"{lang}.json")
        with open(path, "w") as f:
            json.dump(doc, f, separators=(",", ":"))
            f.write("\n")
        print(f"{lang}: {len(glyphs)} glyphs -> {os.path.relpath(path, ROOT)} ({os.path.getsize(path):,} bytes)")
    export_emoji(a.lv_font_conv)


def export_emoji(lv_font_conv):
    import emoji as E
    symbols = E.symbol_glyphs(DEFAULT_FONTS_DIR, lv_font_conv)
    colour = {}
    for cp, v in sorted(E.colour_images(DEFAULT_FONTS_DIR).items()):
        if isinstance(v, tuple):
            w, h, tail, rgba = v
            colour[f"{cp:x}"] = {"w": w, "h": h, "tail": list(tail), "rgba": base64.b64encode(rgba).decode()}
        else:
            colour[f"{cp:x}"] = base64.b64encode(v).decode()
    doc = {
        "twemoji": E.TWEMOJI["name"], "twemojiSha256": E.TWEMOJI["sha256"],
        "symbolFont": FONTS["noto-emoji"]["name"], "symbolFontSha256": FONTS["noto-emoji"]["sha256"],
        "symbols": [[cp, adv, x, y, w, h, "".join(str(v) for row in px for v in row)]
                    for cp, adv, x, y, w, h, px in symbols],
        "colour": colour,
    }
    path = os.path.join(os.path.dirname(OUT), "emoji.json")
    with open(path, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
        f.write("\n")
    print(f"emoji: {len(colour)} colour, {len(symbols)} symbols -> {os.path.relpath(path, ROOT)} ({os.path.getsize(path):,} bytes)")


if __name__ == "__main__":
    main()
