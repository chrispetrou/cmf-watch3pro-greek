# Runs inside Pyodide in the web app's worker. The tools/ modules are copied next to this file,
# so the patch is made by exactly the same code as tools/build_firmware.py.
import json

from build_firmware import patch
from lvfont import LvFont
from repack import parse_aota, unlzma
from sdfs import entries


def _glyphs(doc):
    out = []
    for cp, adv, x, y, w, h, px in json.loads(doc)["glyphs"]:
        out.append((cp, adv, x, y, w, h, [[int(c) for c in px[r * w:(r + 1) * w]] for r in range(h)]))
    return out


def run(orig, langs, glyph_docs, lines, log):
    """orig: bytes (or a JS Uint8Array); glyph_docs: {lang: json text}; lines: [(lang, text)] to preview.
    Returns (image, version_ok, preview)."""
    if hasattr(orig, "to_bytes"):
        orig = orig.to_bytes()
    try:
        img, ok = patch(orig, {lang: _glyphs(glyph_docs[lang]) for lang in langs}, log=log)
    except SystemExit as e:
        # patch() stops with SystemExit like the CLI; give the page an error it can explain.
        if "font image grew" in str(e):
            raise ValueError("TOO_BIG: " + str(e))
        raise ValueError(str(e))
    return img, ok, preview(img, lines)


def preview(img, lines):
    """Glyph bitmaps for the given lines, decoded from the patched image itself."""
    _, files = parse_aota(img)
    raw = unlzma(dict(files)["fonts.bin"])
    o, s = {n: (o, s) for n, o, s, _ in entries(raw)[1:]}["sans36.font"]
    f = LvFont(raw[o:o + s])
    out = []
    for lang, text in lines:
        row = []
        for ch in text:
            g = f.gid(ord(ch))
            G = f.glyph(g) if g else None
            row.append(None if G is None else
                       [G["adv"], G["x"], G["y"], G["w"], G["h"], "".join(str(v) for r in G["px"] for v in r)])
        out.append({"lang": lang, "text": text, "glyphs": row})
    return json.dumps({"ascent": f.ascent, "descent": f.descent, "lines": out})
