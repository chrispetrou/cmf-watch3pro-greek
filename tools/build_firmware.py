"""
Turn an official CMF Watch 3 Pro AOTA image into the same image with extra language glyphs.

  python tools/build_firmware.py \
      --firmware firmware/ORIGINAL_JX402_08_ATS3089C_V1.0.1.77.bin \
      --lang     greek \
      --out      firmware/CMF_Watch3Pro_1.0.1.77_greek.bin \
      [--fonts-dir cache] [--lv-font-conv lvconv/node_modules/.bin/lv_font_conv] [--keep-hangul]

Steps
  1. unpack the AOTA container, decompress fonts.bin (chunked LZMA) -> SDFS image
  2. pull sans36.font (LVGL bin font, 36px, 2bpp) + emoji28.font out of the SDFS
  3. rasterise each language's codepoints from its font with lv_font_conv
     (uncompressed, no kerning); the fonts are listed in tools/languages.py
  4. rebuild sans36.font: drop Hangul (frees ~1.5 MB, the font partition is fixed-size),
     append the new glyphs with advance widths taken from each font's hmtx
  5. repack SDFS -> chunked LZMA -> update ota.xml (sizes + CRC32 of *uncompressed* data)
     -> rebuild the AOTA container (all header/table CRCs)

The partition <version> in ota.xml is deliberately left as is. The app has a
hard-coded table of expected resource versions (font = 29 on 1.0.1.77) and a
boot-time `ver_chk`; a different version drops the watch into the
"Please connect to the app to upgrade again" recovery screen.
"""
import argparse
import hashlib
import os
import re
import struct
import subprocess
import sys
import tempfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from lvfont import LvFont                                        # noqa: E402
from fontbuild import build                                      # noqa: E402
from languages import LANGUAGES, codepoints, fetch_font, parse_langs   # noqa: E402
from repack import build_sdfs, lzma_chunks, parse_aota, build_aota, set_xml_partition, unlzma  # noqa: E402
from sdfs import entries                                         # noqa: E402

FONT_SIZE = 36
DEFAULT_FONTS_DIR = os.path.join(os.path.dirname(HERE), "cache")


def render_glyphs(ttf, cps, lv_font_conv):
    """Rasterise cps from ttf like the stock font. Returns [(cp, adv, x, y, w, h, px)]."""
    from fontTools.ttLib import TTFont

    t = TTFont(ttf)
    cm, hm, upm = t.getBestCmap(), t["hmtx"], t["head"].unitsPerEm
    cps = [c for c in cps if c in cm]
    if not cps:
        return []
    with tempfile.TemporaryDirectory() as td:
        out = os.path.join(td, "glyphs.bin")
        subprocess.run([lv_font_conv, "--font", ttf, "--size", str(FONT_SIZE), "--bpp", "2",
                        "--format", "bin", "--no-compress", "--no-kerning",
                        "-r", ",".join(hex(c) for c in cps), "-o", out], check=True)
        lv = LvFont(open(out, "rb").read())
    glyphs = []
    for cp in cps:
        G = lv.glyph(lv.gid(cp))
        adv = round(hm[cm[cp]][0] * FONT_SIZE * 16 / upm)      # 1/16 px units, as the stock font
        glyphs.append((cp, adv, G["x"], G["y"], G["w"], G["h"], G["px"]))
    return glyphs


def patch(orig, glyph_sets, keep_hangul=False, log=print):
    """Add glyphs to an official image, all in memory. Also used by the web app (via Pyodide).

    orig       : bytes of the official AOTA image
    glyph_sets : {lang: [(cp, adv, x, y, w, h, px)]}, rasterised like the stock font
    Returns (patched image bytes, version_ok).
    """
    if orig[:4] != b"AOTA":
        raise SystemExit("not an AOTA firmware image")
    hdr, files = parse_aota(orig)
    F = dict(files)
    # Safety: the app must expect the font version that ota.xml declares (boot-time ver_chk).
    xml0 = F["ota.xml"].decode()
    blk = re.search(r"<partition>(?:(?!</partition>).)*<name>font</name>.*?</partition>", xml0, re.S).group(0)
    fid = int(re.search(r"<file_id>(\w+)</file_id>", blk).group(1), 0)
    fver = int(re.search(r"<version>(\w+)</version>", blk).group(1), 0)
    app = unlzma(F["TEMP.bin"])
    version_ok = struct.pack("<II", fid, fver) in app
    if version_ok:
        log(f"font partition: file_id {fid}, version {fver} (matches the app's expected-version table)")
    else:
        log(f"WARNING: app has no {{file_id {fid}, version {fver}}} entry; check the ver_chk table "
            f"before flashing (see docs/firmware-format.md)")

    raw = unlzma(F["fonts.bin"])
    ents = {n: (o, s) for n, o, s, _ in entries(raw)[1:]}
    o, s = ents["sans36.font"]
    sans = LvFont(raw[o:o + s])
    log(f"stock sans36.font: {s:,} bytes, {sans.nglyphs} glyphs")
    o, s = ents["emoji28.font"]
    emoji = raw[o:o + s]

    add, counts = [], []
    for lang, glyphs in glyph_sets.items():
        glyphs = [g for g in glyphs if not sans.gid(g[0])]
        add += glyphs
        counts.append(f"+{len(glyphs)} {lang}")
    add.sort(key=lambda g: g[0])

    drop = (lambda st: False) if keep_hangul else (lambda st: 0xAC00 <= st <= 0xD7A3)
    new_sans = build(sans, drop=drop, add=add)
    nf = LvFont(new_sans)
    assert all(nf.gid(g[0]) for g in add), "glyph missing after rebuild"
    log(f"new sans36.font:   {len(new_sans):,} bytes, {nf.nglyphs} glyphs ({', '.join(counts)})")

    sd = build_sdfs([("sans36.font", new_sans), ("emoji28.font", emoji)])
    if len(sd) > len(raw):
        raise SystemExit(f"font image grew ({len(sd):#x} > {len(raw):#x}); the font partition may not fit it")
    lz = lzma_chunks(sd)
    xml2 = set_xml_partition(xml0, "font", file_size=hex(len(lz)), orig_size=hex(len(sd)),
                             checksum="0x%08x" % (zlib.crc32(sd) & 0xffffffff))   # version untouched!
    files2 = [(n, lz if n == "fonts.bin" else xml2.encode() if n == "ota.xml" else b) for n, b in files]
    return build_aota(hdr, files2), version_ok


def build_image(firmware, langs, out, lv_font_conv="lv_font_conv", fonts_dir=DEFAULT_FONTS_DIR,
                keep_hangul=False):
    """Build the patched image. Returns True if the font version matches the app's ver_chk table."""
    orig = open(firmware, "rb").read()
    glyph_sets = {lang: render_glyphs(fetch_font(LANGUAGES[lang]["font"], fonts_dir), codepoints(lang), lv_font_conv)
                  for lang in langs}
    img, version_ok = patch(orig, glyph_sets, keep_hangul)
    open(out, "wb").write(img)
    print(f"wrote {out}: {len(img):,} bytes  sha256 {hashlib.sha256(img).hexdigest()}")
    return version_ok


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--firmware", required=True)
    ap.add_argument("--lang", required=True, help=f"comma-separated: {', '.join(sorted(LANGUAGES))}")
    ap.add_argument("--out", required=True)
    ap.add_argument("--fonts-dir", default=DEFAULT_FONTS_DIR, help="where fonts are cached (default: cache/)")
    ap.add_argument("--lv-font-conv", default="lv_font_conv")
    ap.add_argument("--keep-hangul", action="store_true", help="don't drop Korean (image may not fit)")
    a = ap.parse_args()
    ok = build_image(a.firmware, parse_langs(a.lang), a.out, a.lv_font_conv, a.fonts_dir, a.keep_hangul)
    sys.exit(0 if ok else 2)


if __name__ == "__main__":
    main()
