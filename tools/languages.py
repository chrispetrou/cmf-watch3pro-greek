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
    "noto-georgian": {
        "name": "Noto Sans Georgian v2.005 Medium",
        "url": "https://github.com/notofonts/georgian/releases/download/"
               "NotoSansGeorgian-v2.005/NotoSansGeorgian-v2.005.zip",
        "member": "unhinted/ttf/NotoSansGeorgian-Medium.ttf",
        "file": "NotoSansGeorgian-Medium.ttf",
        "sha256": "4ab94cd342f4db4b8a722d3e52f06ab59a378b15c6a604e4af22e26dba2246fd",
    },
    "noto-armenian": {
        "name": "Noto Sans Armenian v2.008 Medium",
        "url": "https://github.com/notofonts/armenian/releases/download/"
               "NotoSansArmenian-v2.008/NotoSansArmenian-v2.008.zip",
        "member": "unhinted/ttf/NotoSansArmenian-Medium.ttf",
        "file": "NotoSansArmenian-Medium.ttf",
        "sha256": "315114c2b6737f0f0aab3e6abb70febb7e1c77d065f3602e61ec74e9e07f20aa",
    },
    # Monochrome emoji for the symbols below U+1F300 (see emoji.py), pinned to a google/fonts commit.
    "noto-emoji": {
        "name": "Noto Emoji (monochrome)",
        "url": "https://raw.githubusercontent.com/google/fonts/8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5/"
               "ofl/notoemoji/NotoEmoji%5Bwght%5D.ttf",
        "file": "NotoEmoji.ttf",
        "sha256": "de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551",
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
    # Inter has no Georgian. Noto Sans Georgian Medium has almost the same
    # x-height and cap height (0.539/0.714 em vs Inter's 0.546/0.728).
    "georgian": {
        "name": "Georgian",
        "font": "noto-georgian",
        "ranges": [(0x10A0, 0x10FF), (0x1C90, 0x1CBF)],   # Mkhedruli, Asomtavruli, Mtavruli
        "sample": [
            "აბგდევზთიკლმნო",
            "პჟრსტუფქღყშჩც",
            "ძწჭხჯჰ",
            "გამარჯობა, საქართველო!",
            "Hello გამარჯობა 123",
            "ᲡᲐᲥᲐᲠᲗᲕᲔᲚᲝ",
        ],
    },
    # Inter has no Armenian. Noto Sans Armenian Medium is as close to it as the
    # Georgian one (x-height and cap height 0.536/0.714 em vs Inter's 0.546/0.728).
    "armenian": {
        "name": "Armenian",
        "font": "noto-armenian",
        "ranges": [(0x0530, 0x058F), (0xFB13, 0xFB17)],   # Armenian block, ligatures ﬓ-ﬗ
        "sample": [
            "ԱԲԳԴԵԶԷԸԹԺԻԼԽԾԿՀՁՂՃ",
            "ՄՅՆՇՈՉՊՋՌՍՎՏՐՑՒՓՔՕՖ",
            "աբգդեզէըթժիլխծկհձղճ",
            "մյնշոչպջռսվտրցւփքօֆ",
            "Բարև, Հայաստան։ Ինչպե՞ս ես։",
            "Hello Բարև 123 ֏",
        ],
    },
}


def parse_langs(text):
    """'greek,georgian' -> ['georgian', 'greek'] (sorted, so the build doesn't depend on the order)."""
    langs = sorted({s.strip().lower() for s in (text or "").split(",") if s.strip()})
    unknown = [s for s in langs if s not in LANGUAGES]
    known = ", ".join(sorted(LANGUAGES))
    if not langs:
        raise SystemExit(f"--lang is required; choose from: {known}")
    if unknown:
        raise SystemExit(f"unknown language {', '.join(unknown)}; choose from: {known}")
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
