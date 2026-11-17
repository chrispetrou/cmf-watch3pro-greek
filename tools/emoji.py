"""
Extra emoji for the watch (--emoji).

The watch draws characters from U+1F300 up with the colour emoji font (emoji28.font,
see emojifont.py) and everything below with the text font (sans36.font). So:

  colour    the emoji in tools/emoji.txt, from Twemoji (CC-BY 4.0) like the stock 53,
            scaled to 30 x 30
  symbols   emoji below U+1F300 (hearts, check marks, sun, ...) as white glyphs in the
            text font, from the monochrome Noto Emoji (OFL); the watch can't colour them
  hidden    invisible variation selectors (U+FE0E, U+FE0F) in the text font and invisible
            skin tones (U+1F3FB to U+1F3FF) in the emoji font, so 👍🏽 shows as 👍 and ❤️
            doesn't leave a box
  flags     the regional indicator letters (U+1F1E6 to U+1F1FF) as capitals in the text
            font, so 🇬🇷 reads GR
"""
import hashlib
import io
import os
import tarfile

from fetch import download
from languages import fetch_font

HERE = os.path.dirname(os.path.abspath(__file__))
LIST = os.path.join(HERE, "emoji.txt")

TWEMOJI = {
    "name": "Twemoji v17.0.3",
    "url": "https://github.com/jdecked/twemoji/archive/refs/tags/v17.0.3.tar.gz",
    "file": "twemoji-17.0.3.tar.gz",
    "sha256": "a0855654b633045ae2337537e77f1bb4361162f7fcd910e613eaab1d6d9c5fca",
}

COLOUR_FROM = 0x1F300           # the watch only looks in the emoji font from here up
SIZE = 30                       # stock emoji are 30 x 30
SYMBOL_SIZE = 30                # render symbols at about the colour emoji's size
VARIATION_SELECTORS = (0xFE0E, 0xFE0F)
SKIN_TONES = range(0x1F3FB, 0x1F400)
FLAG_LETTERS = range(0x1F1E6, 0x1F200)


def colour_list():
    """Codepoints from tools/emoji.txt, in file order."""
    out = []
    for line in open(LIST, encoding="utf-8"):
        line = line.split("#")[0].strip()
        if line:
            out.append(int(line.split()[0], 16))
    return out


def fetch_twemoji(cache_dir):
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, TWEMOJI["file"])
    if not os.path.exists(path):
        print(f"downloading {TWEMOJI['name']}")
        download(TWEMOJI["url"], path)
    if hashlib.sha256(open(path, "rb").read()).hexdigest() != TWEMOJI["sha256"]:
        raise SystemExit(f"{path} is not the expected {TWEMOJI['name']}; delete it and re-run")
    return path


def colour_images(cache_dir):
    """{codepoint: 30 x 30 RGBA bytes} for tools/emoji.txt, plus invisible skin tones as
    (1, 1, (0, 7), transparent) entries (the first u16 is the advance, 0 = no space)."""
    from PIL import Image

    wanted = {f"{cp:x}.png": cp for cp in colour_list()}
    out = {}
    with tarfile.open(fetch_twemoji(cache_dir)) as tf:
        for m in tf.getmembers():
            name = m.name.rsplit("/", 1)[-1]
            if "/assets/72x72/" in m.name and name in wanted:
                im = Image.open(io.BytesIO(tf.extractfile(m).read())).convert("RGBA")
                out[wanted[name]] = im.resize((SIZE, SIZE), Image.BOX).tobytes()
    missing = set(wanted.values()) - set(out)
    if missing:
        raise SystemExit("Twemoji has no image for " + ", ".join(f"U+{c:04X}" for c in sorted(missing)))
    for cp in SKIN_TONES:
        out[cp] = (1, 1, (0, 7), bytes(4))
    return out


def symbol_glyphs(cache_dir, lv_font_conv):
    """Glyphs for the text font: Noto Emoji symbols below U+1F300, invisible variation
    selectors and the flag letters. Codepoints the stock font has are skipped by patch()."""
    from fontTools.ttLib import TTFont
    from build_firmware import render_glyphs

    noto = fetch_font("noto-emoji", cache_dir)
    cps = sorted(c for c in TTFont(noto).getBestCmap()
                 if 0x2000 <= c < 0x10000 and c not in VARIATION_SELECTORS)
    glyphs = render_glyphs(noto, cps, lv_font_conv, size=SYMBOL_SIZE)
    glyphs += [(cp, 0, 0, 0, 0, 0, []) for cp in VARIATION_SELECTORS]
    letters = render_glyphs(fetch_font("inter", cache_dir), range(0x41, 0x5B), lv_font_conv)
    glyphs += [(FLAG_LETTERS[cp - 0x41],) + tuple(g) for cp, *g in letters]
    return sorted(glyphs)
