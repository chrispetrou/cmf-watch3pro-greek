"""
Languages the patch can add, and the fonts their glyphs come from.

Each language lists the codepoint ranges to add, the font to render them from
and a few sample lines for render_preview.py. Prefer Inter (the watch's own
typeface) when it covers the script, so the new letters match the stock text.
"""
import hashlib
import os
import shutil
import zipfile

from fetch import download

FONTS = {
    "inter": {
        "name": "Inter v4.0 Medium",
        "url": "https://github.com/rsms/inter/releases/download/v4.0/Inter-4.0.zip",
        "member": "extras/ttf/Inter-Medium.ttf",
        "file": "Inter-Medium.ttf",
        "sha256": "1bda81124d6ae26ed16a7201e2bd93766af5a3b14faf79eea14d191ebbd41146",
    },
}

LANGUAGES = {
    "greek": {
        "name": "Greek",
        "font": "inter",
        "ranges": [(0x0370, 0x03FF)],
        "sample": [
            "ΑΒΓΔΕΖΗΘΙΚΛΜ",
            "ΝΞΟΠΡΣΤΥΦΧΨΩ",
            "αβγδεζηθικλμ",
            "νξοπρσςτυφχψω",
            "άέήίόύώ ϊϋΐΰ ΆΈΉΊΌΎΏ",
            "0123456789 ; · « »",
        ],
    },
}


def parse_langs(text):
    """'greek,georgian' -> ['georgian', 'greek'] (sorted, so the build doesn't depend on the order)."""
    langs = sorted({s.strip().lower() for s in (text or "").split(",") if s.strip()})
    unknown = [s for s in langs if s not in LANGUAGES]
    if not langs or unknown:
        raise SystemExit(f"unknown or missing language {', '.join(unknown)}; "
                         f"choose from: {', '.join(sorted(LANGUAGES))}")
    return langs


def codepoints(lang):
    return [c for a, b in LANGUAGES[lang]["ranges"] for c in range(a, b + 1)]


def font_path(font_id, cache_dir):
    return os.path.join(cache_dir, FONTS[font_id]["file"])


def fetch_font(font_id, cache_dir):
    """Download the font into cache_dir if needed and check its sha256. Returns the path."""
    f = FONTS[font_id]
    os.makedirs(cache_dir, exist_ok=True)
    path = font_path(font_id, cache_dir)
    if not os.path.exists(path):
        print(f"downloading {f['name']}")
        if "member" in f:
            z = path + ".zip"
            download(f["url"], z)
            with zipfile.ZipFile(z) as zf:
                name = next(n for n in zf.namelist() if n.endswith(f["member"]))
                with zf.open(name) as src, open(path, "wb") as dst:
                    shutil.copyfileobj(src, dst)
            os.remove(z)
        else:
            download(f["url"], path)
    if hashlib.sha256(open(path, "rb").read()).hexdigest() != f["sha256"]:
        raise SystemExit(f"{path} is not the expected {f['name']}; delete it and re-run")
    return path
