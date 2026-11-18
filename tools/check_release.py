"""
Look for a new official CMF Watch 3 Pro firmware and prepare it for the web app.

  python tools/check_release.py                      # look up the latest release in the Nothing Archive
  python tools/check_release.py --file FW.bin        # check a local file instead (no download)

Run daily by .github/workflows/firmware-release.yml. When the archive lists a version that isn't
in OFFICIAL (web/src/lib/firmware.ts) it downloads the file from Nothing's CDN, checks that it's a
complete image for this watch, builds it with every language and the emoji (the same code as the
web app), and adds its SHA-256 to OFFICIAL and firmware/SHA256SUMS. The workflow then opens a pull
request. Nothing is accepted by the app until that pull request is merged, after the release has
been tried on a real watch.

Standard library only, so it runs on a bare GitHub runner.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "web", "src", "build"))
from fetch import download                          # noqa: E402
from patch import check_aota, latest_release        # noqa: E402

FIRMWARE_TS = os.path.join(ROOT, "web", "src", "lib", "firmware.ts")
SUMS = os.path.join(ROOT, "firmware", "SHA256SUMS")
PUBLIC = os.path.join(ROOT, "web", "public")


def known_versions():
    src = open(FIRMWARE_TS).read()
    block = src[src.index("export const OFFICIAL"):src.index("] as const;")]
    return re.findall(r'version: "([\d.]+)"', block)


def build_check(data):
    """Build with every language and the emoji, the largest image the app can make."""
    import glue
    langs = sorted(f[:-5] for f in os.listdir(os.path.join(PUBLIC, "glyphs")) if f.endswith(".json"))
    docs = {lang: open(os.path.join(PUBLIC, "glyphs", f"{lang}.json")).read() for lang in langs}
    emoji = open(os.path.join(PUBLIC, "emoji.json")).read()
    log = []
    try:
        img, version_ok = glue.run(data, langs, docs, log.append, emoji)
    except ValueError as e:
        return {"ok": False, "langs": langs, "error": str(e), "log": log}
    return {"ok": version_ok, "langs": langs, "error": None if version_ok else "font version check failed",
            "log": log, "sha256": hashlib.sha256(img).hexdigest()}


def add_release(version, sha256, url):
    src = open(FIRMWARE_TS).read()
    entry = (f'  {{\n    version: "{version}",\n    sha256: "{sha256}",\n'
             f'    url: "{url}",\n  }},\n')
    i = src.index("] as const;")
    open(FIRMWARE_TS, "w").write(src[:i] + entry + src[i:])
    with open(SUMS, "a") as f:
        f.write(f"{sha256}  ORIGINAL_JX402_08_ATS3089C_V{version}.bin\n")


def report(version, url, sha256, size, check):
    lines = [
        f"Nothing released firmware **{version}** for the CMF Watch 3 Pro. "
        "This adds it to `OFFICIAL`, so the web app accepts it.",
        "",
        f"- File: {url}",
        f"- Size: {size:,} bytes",
        f"- SHA-256: `{sha256}`",
        f"- Build with {', '.join(check['langs'])} and the emoji: "
        + ("works, the font version matches the watch's check" if check["ok"] else f"**failed: {check['error']}**"),
        "",
    ]
    if check["ok"]:
        lines += [
            "Before merging:",
            "",
            "- [ ] Install the official update on a watch, then install a patched build of it and check the letters.",
            "- [ ] Compare the SHA-256 with a copy downloaded another way (Nothing X, or the archive site).",
        ]
    else:
        lines += [
            "**Don't merge this.** The patch doesn't fit this release as it is; see docs/updating.md.",
        ]
    lines += ["", "<details><summary>Build log</summary>", "", "```", *check["log"], "```", "", "</details>"]
    return "\n".join(lines)


def output(**kv):
    path = os.environ.get("GITHUB_OUTPUT")
    for k, v in kv.items():
        print(f"{k}={v}")
        if path:
            with open(path, "a") as f:
                f.write(f"{k}={v}\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", help="check this local image instead of downloading the latest")
    ap.add_argument("--body", default="release-pr.md", help="where to write the pull request text")
    a = ap.parse_args()

    if a.file:
        m = re.search(r"_V(\d+(?:\.\d+){3})", os.path.basename(a.file))
        version, url, path = (m.group(1) if m else "0.0.0.0"), "(local file)", a.file
    else:
        version, url, _ = latest_release()
        if version in known_versions():
            print(f"{version} is already in OFFICIAL, nothing to do")
            output(new="false")
            return
        path = os.path.join(tempfile.mkdtemp(), os.path.basename(url))
        print(f"new release {version}, downloading {url}")
        download(url, path)

    check_aota(path)
    data = open(path, "rb").read()
    sha256 = hashlib.sha256(data).hexdigest()
    print(f"sha256 {sha256}")
    check = build_check(data)
    print("build check:", "ok" if check["ok"] else check["error"])
    open(a.body, "w").write(report(version, url, sha256, len(data), check))
    if not a.file:
        add_release(version, sha256, url)
    output(new="true", version=version, ok=str(check["ok"]).lower())


if __name__ == "__main__":
    main()
