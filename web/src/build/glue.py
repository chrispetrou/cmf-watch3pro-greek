# Runs inside Pyodide in the web app's worker. The tools/ modules are copied next to this file,
# so the patch is made by exactly the same code as tools/build_firmware.py.
import json

from build_firmware import patch


def _glyphs(doc):
    out = []
    for cp, adv, x, y, w, h, px in json.loads(doc)["glyphs"]:
        out.append((cp, adv, x, y, w, h, [[int(c) for c in px[r * w:(r + 1) * w]] for r in range(h)]))
    return out


def run(orig, langs, glyph_docs, log):
    """orig: bytes (or a JS Uint8Array); glyph_docs: {lang: json text}. Returns (image, version_ok)."""
    if hasattr(orig, "to_bytes"):
        orig = orig.to_bytes()
    try:
        return patch(orig, {lang: _glyphs(glyph_docs[lang]) for lang in langs}, log=log)
    except SystemExit as e:
        # patch() stops with SystemExit like the CLI; give the page an error it can explain.
        if "font image grew" in str(e):
            raise ValueError("TOO_BIG: " + str(e))
        raise ValueError(str(e))
