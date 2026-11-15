"""
Turn an official CMF Watch 3 Pro AOTA image into the same image with Greek glyphs.

  python tools/build_greek_firmware.py \
      --firmware firmware/ORIGINAL_JX402_08_ATS3089C_V1.0.1.77.bin \
      --ttf      fonts/Inter-Medium.ttf            (Inter v4.0, Medium) \
      --out      firmware/CMF_Watch3Pro_greek.bin \
      [--lv-font-conv lvconv/node_modules/.bin/lv_font_conv] [--keep-hangul]

Steps
  1. unpack the AOTA container, decompress fonts.bin (chunked LZMA) -> SDFS image
  2. pull sans36.font (LVGL bin font, 36px, 2bpp) + emoji28.font out of the SDFS
  3. rasterise U+0370..U+03FF from Inter with lv_font_conv (uncompressed, no kerning)
  4. rebuild sans36.font: drop Hangul (frees ~1.5 MB, the font partition is fixed-size),
     append the Greek glyphs with advance widths taken from Inter's hmtx
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lvfont import LvFont                                        # noqa: E402
from fontbuild import build                                      # noqa: E402
from repack import build_sdfs, lzma_chunks, parse_aota, build_aota, set_xml_partition, unlzma  # noqa: E402
from sdfs import entries                                         # noqa: E402

FONT_SIZE = 36


def build_image(firmware, ttf, out, lv_font_conv="lv_font_conv", keep_hangul=False):
    """Build the Greek image. Returns True if the font version matches the app's ver_chk table."""
    from fontTools.ttLib import TTFont

    orig = open(firmware, "rb").read()
    if orig[:4] != b"AOTA":
        raise SystemExit(f"{firmware}: not an AOTA firmware image")
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
        print(f"font partition: file_id {fid}, version {fver} (matches the app's expected-version table)")
    else:
        print(f"WARNING: app has no {{file_id {fid}, version {fver}}} entry; check the ver_chk table "
              f"before flashing (see docs/firmware-format.md)")

    raw = unlzma(F["fonts.bin"])
    ents = {n: (o, s) for n, o, s, _ in entries(raw)[1:]}
    o, s = ents["sans36.font"]
    sans = LvFont(raw[o:o + s])
    print(f"stock sans36.font: {s:,} bytes, {sans.nglyphs} glyphs")
    o, s = ents["emoji28.font"]
    emoji = raw[o:o + s]

    t = TTFont(ttf)
    cm, hm, upm = t.getBestCmap(), t["hmtx"], t["head"].unitsPerEm
    cps = [c for c in range(0x370, 0x400) if c in cm]
    with tempfile.TemporaryDirectory() as td:
        gbin = os.path.join(td, "greek.bin")
        subprocess.run([lv_font_conv, "--font", ttf, "--size", str(FONT_SIZE), "--bpp", "2",
                        "--format", "bin", "--no-compress", "--no-kerning",
                        "-r", ",".join(hex(c) for c in cps), "-o", gbin], check=True)
        gk = LvFont(open(gbin, "rb").read())
    add = []
    for cp in cps:
        G = gk.glyph(gk.gid(cp))
        adv = round(hm[cm[cp]][0] * FONT_SIZE * 16 / upm)      # 1/16 px units, as the stock font
        add.append((cp, adv, G["x"], G["y"], G["w"], G["h"], G["px"]))

    drop = (lambda st: False) if keep_hangul else (lambda st: 0xAC00 <= st <= 0xD7A3)
    new_sans = build(sans, drop=drop, add=add)
    nf = LvFont(new_sans)
    assert all(nf.gid(c) for c in cps), "greek glyph missing after rebuild"
    print(f"new sans36.font:   {len(new_sans):,} bytes, {nf.nglyphs} glyphs (+{len(cps)} greek)")

    sd = build_sdfs([("sans36.font", new_sans), ("emoji28.font", emoji)])
    if len(sd) > len(raw):
        raise SystemExit(f"font image grew ({len(sd):#x} > {len(raw):#x}); the font partition may not fit it")
    lz = lzma_chunks(sd)
    xml2 = set_xml_partition(xml0, "font", file_size=hex(len(lz)), orig_size=hex(len(sd)),
                             checksum="0x%08x" % (zlib.crc32(sd) & 0xffffffff))   # version untouched!
    files2 = [(n, lz if n == "fonts.bin" else xml2.encode() if n == "ota.xml" else b) for n, b in files]
    img = build_aota(hdr, files2)
    open(out, "wb").write(img)
    print(f"wrote {out}: {len(img):,} bytes  sha256 {hashlib.sha256(img).hexdigest()}")
    return version_ok


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--firmware", required=True)
    ap.add_argument("--ttf", required=True, help="Inter-Medium.ttf (v4.0 matches the stock Latin glyphs byte-for-byte)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--lv-font-conv", default="lv_font_conv")
    ap.add_argument("--keep-hangul", action="store_true", help="don't drop Korean (image may not fit)")
    a = ap.parse_args()
    ok = build_image(a.firmware, a.ttf, a.out, a.lv_font_conv, a.keep_hangul)
    sys.exit(0 if ok else 2)


if __name__ == "__main__":
    main()
