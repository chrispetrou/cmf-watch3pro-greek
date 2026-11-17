# Runs inside Pyodide in the web app's worker. The tools/ modules are copied next to this file,
# so the patch is made by exactly the same code as tools/build_firmware.py.
import base64
import json

from build_firmware import patch


def _glyphs(rows):
    out = []
    for cp, adv, x, y, w, h, px in rows:
        out.append((cp, adv, x, y, w, h, [[int(c) for c in px[r * w:(r + 1) * w]] for r in range(h)]))
    return out


def _colour(v):
    if isinstance(v, str):
        return base64.b64decode(v)
    return (v["w"], v["h"], tuple(v["tail"]), base64.b64decode(v["rgba"]))


def run(orig, langs, glyph_docs, log, emoji_doc=None):
    """orig: bytes (or a JS Uint8Array); glyph_docs: {lang: json text}; emoji_doc: the text of
    web/public/emoji.json to add the emoji (see tools/export_glyphs.py). Returns (image, version_ok)."""
    if hasattr(orig, "to_bytes"):
        orig = orig.to_bytes()
    glyph_sets = {lang: _glyphs(json.loads(glyph_docs[lang])["glyphs"]) for lang in langs}
    colour = None
    if emoji_doc:
        doc = json.loads(emoji_doc)
        glyph_sets["emoji symbols"] = _glyphs(doc["symbols"])
        colour = {int(k, 16): _colour(v) for k, v in doc["colour"].items()}
    try:
        return patch(orig, glyph_sets, log=log, emoji=colour)
    except SystemExit as e:
        # patch() stops with SystemExit like the CLI; give the page an error it can explain.
        if "font image grew" in str(e):
            raise ValueError("TOO_BIG: " + str(e))
        raise ValueError(str(e))
