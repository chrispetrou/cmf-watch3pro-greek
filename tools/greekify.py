"""
Fetch the latest CMF Watch 3 Pro firmware, add the Greek glyphs and flash it.

  ./venv/bin/python tools/greekify.py              # check -> download -> build -> (confirm) -> flash -> verify
  ./venv/bin/python tools/greekify.py check        # just show watch version vs latest release
  ./venv/bin/python tools/greekify.py build        # download + build only, no Bluetooth
  ./venv/bin/python tools/greekify.py flash        # build if needed, then flash

Options:
  --file PATH            use a local official .bin instead of downloading
  --url URL              download this official .bin instead of looking it up
  --address ADDR         watch BLE address (else remembered / scanned)
  --yes                  don't ask for confirmation before flashing
  --allow-version-change flash even if the watch is on a different version than the image
                         (installs the update + Greek in one go; not tested yet; see docs/updating.md)

Firmware lookup uses the Nothing Archive's machine-readable list
(github.com/spike0en/nothing_archive, model D399 = Watch 3 Pro); the
download itself comes from Nothing's own CDN.
Everything downloaded goes into cache/ and firmware/ (both git-ignored).
"""
import argparse
import asyncio
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from fetch import UA, download     # noqa: E402
from languages import fetch_font   # noqa: E402

CACHE = os.path.join(ROOT, "cache")
FWDIR = os.path.join(ROOT, "firmware")
ADDR_FILE = os.path.join(HERE, "watch_address.txt")

MODEL_ID = "D399"                     # CMF Watch 3 Pro in the Nothing Archive data
BOARD = "JX402_08"
ARCHIVE_JSON = ("https://raw.githubusercontent.com/spike0en/nothing_archive/main/"
                "website/src/data/accessories_updates.json")
LV_FONT_CONV = "lv_font_conv@1.5.3"
# The archive list is third-party data, so only follow links to Nothing's own OTA CDN.
OFFICIAL_HOSTS = {"dmen2t88o28qi.cloudfront.net"}


def say(msg):
    print(f"\033[1m==>\033[0m {msg}", flush=True)


def die(msg, code=1):
    print(f"\033[31merror:\033[0m {msg}", file=sys.stderr)
    sys.exit(code)


# ---------------------------------------------------------------- toolchain
def ensure_toolchain():
    os.makedirs(CACHE, exist_ok=True)
    import importlib.util
    if not all(importlib.util.find_spec(m) for m in ("fontTools", "bleak", "Crypto")):
        say("installing Python dependencies")
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r",
                        os.path.join(ROOT, "requirements.txt")], check=True)

    ttf = fetch_font("inter", CACHE)

    conv = os.path.join(CACHE, "lvconv", "node_modules", ".bin", "lv_font_conv")
    if not os.path.exists(conv):
        if not shutil.which("npm"):
            die("Node.js/npm is needed for lv_font_conv (brew install node)")
        say(f"installing {LV_FONT_CONV}")
        subprocess.run(["npm", "install", "--silent", "--prefix", os.path.join(CACHE, "lvconv"),
                        LV_FONT_CONV], check=True)
    return ttf, conv


# ---------------------------------------------------------------- firmware
def latest_release():
    say("looking up the latest Watch 3 Pro firmware (Nothing Archive)")
    req = urllib.request.Request(ARCHIVE_JSON, headers=UA)
    data = json.load(urllib.request.urlopen(req, timeout=30))
    e = data.get(MODEL_ID)
    if not e or BOARD not in e.get("downloadUrl", ""):
        die(f"no {MODEL_ID}/{BOARD} entry in the archive data; use --url or --file")
    url = urllib.parse.urlparse(e["downloadUrl"])
    if url.scheme != "https" or url.hostname not in OFFICIAL_HOSTS:
        die(f"archive points to an unexpected host ({e['downloadUrl']}); refusing. Use --url if you trust it.")
    if not re.fullmatch(r"\d+(\.\d+){3}", str(e["version"])):
        die(f"unexpected version string in archive data: {e['version']!r}")
    return e["version"], e["downloadUrl"], e.get("updatedAt", "?")


def version_from_name(name):
    m = re.search(r"_V(\d+\.\d+\.\d+\.\d+)", name)
    return m.group(1) if m else None


def check_aota(path):
    d = open(path, "rb").read()
    ok = (d[:4] == b"AOTA"
          and struct.unpack("<I", d[4:8])[0] == zlib.crc32(d[8:0x400]) & 0xffffffff
          and struct.unpack("<I", d[0x18:0x1c])[0] == zlib.crc32(d[0x400:]) & 0xffffffff
          and struct.unpack("<I", d[0x14:0x18])[0] == len(d))
    if not ok:
        die(f"{path} is not a valid/complete AOTA image")
    if BOARD.lower().encode() not in d[:0x1000].lower():
        die(f"{path} is not for board {BOARD} (CMF Watch 3 Pro)")


def get_firmware(args):
    """Return (version, path to official image)."""
    os.makedirs(FWDIR, exist_ok=True)
    if args.file:
        ver = version_from_name(os.path.basename(args.file)) or "unknown"
        check_aota(args.file)
        return ver, args.file
    if args.url:
        url, ver = args.url, version_from_name(args.url) or "unknown"
    else:
        ver, url, when = latest_release()
        say(f"latest release: {ver} (published {when[:10]})")
    path = os.path.join(FWDIR, f"ORIGINAL_{BOARD}_ATS3089C_V{ver}.bin")
    if os.path.exists(path):
        say(f"already downloaded: {os.path.relpath(path, ROOT)}")
    else:
        say(f"downloading official firmware {ver}")
        download(url, path)
    check_aota(path)
    sums = os.path.join(FWDIR, "SHA256SUMS")
    line = f"{hashlib.sha256(open(path, 'rb').read()).hexdigest()}  {os.path.basename(path)}\n"
    if not os.path.exists(sums) or line not in open(sums).read():
        open(sums, "a").write(line)
    return ver, path


def build_greek(ver, official):
    from build_greek_firmware import build_image
    ttf, conv = ensure_toolchain()
    out = os.path.join(FWDIR, f"CMF_Watch3Pro_{ver}_greek.bin")
    if os.path.exists(out) and os.path.getmtime(out) > os.path.getmtime(official):
        say(f"Greek image already built: {os.path.relpath(out, ROOT)}")
        return out
    say(f"building Greek image for {ver}")
    if not build_image(official, ttf, out, conv):
        os.rename(out, out + ".UNSAFE")
        die("font version check failed: the app would reject this image at boot. "
            "Not flashing. See docs/firmware-format.md (expected-version table).", 2)
    return out


# ---------------------------------------------------------------- watch
async def find_address(args):
    if args.address:
        return args.address
    if os.path.exists(ADDR_FILE):
        return open(ADDR_FILE).read().strip()
    import cmf_client as C
    say("scanning for the watch (12 s); make sure the iPhone isn't connected to it")
    rows = await C.scan(12)
    cands = [r for r in rows if any(k in (r[0] or "").lower() for k in ("cmf", "watch", "nothing"))]
    if not cands:
        die("watch not found; pass --address (run tools/cmf_scan.py to list devices)")
    name, addr, rssi = cands[0]
    say(f"found {name} at {addr} (RSSI {rssi})")
    return addr


async def watch_version(addr):
    import cmf_client as C
    cl = C.CmfClient(addr)
    try:
        await cl.connect()
        await cl.authenticate()
        return await cl.get_firmware_version()
    finally:
        await cl.disconnect()


async def flash(args, ver, image):
    import cmf_flash
    addr = await find_address(args)
    cur = await watch_version(addr)
    open(ADDR_FILE, "w").write(addr)
    say(f"watch is on {cur}; image is {ver} + Greek")
    if cur.startswith("0."):
        say("watch is in upgrade/recovery mode; flashing will repair it (slow: hours)")
    elif cur != ver and not args.allow_version_change:
        die(f"watch runs {cur} but the image is {ver}. Either install the official {ver} update "
            f"via Nothing X first, or re-run with --allow-version-change (untested).")
    if not args.yes:
        print("\n  Keep the watch on its charger, the Mac awake and nearby.\n"
              "  The upload takes ~30 min; the watch then installs and reboots by itself.")
        if input("  Flash now? [y/N] ").strip().lower() != "y":
            die("aborted by user", 0)
    t0 = time.time()
    await cmf_flash.main(addr, image, None)
    say(f"upload finished in {int(time.time() - t0) // 60} min; waiting for install + reboot")
    await asyncio.sleep(120)
    for attempt in range(5):
        try:
            v = await watch_version(addr)
            break
        except Exception as e:
            say(f"watch not ready yet ({e.__class__.__name__}); retrying in 60 s")
            await asyncio.sleep(60)
    else:
        die("couldn't reach the watch after the flash; check its screen")
    if v.startswith("0."):
        die(f"watch reports {v}: it rejected the image and is in upgrade mode. "
            f"Recover with: ./venv/bin/python tools/cmf_flash.py {addr} <official .bin>")
    say(f"done, the watch runs {v} with Greek. Now pair it with the phone again in Nothing X.")


async def check(args):
    ver, url, when = latest_release()
    say(f"latest release: {ver} ({when[:10]})")
    try:
        addr = await find_address(args)
        cur = await watch_version(addr)
        open(ADDR_FILE, "w").write(addr)
        say(f"watch runs: {cur}" + ("  -> update available" if cur != ver else "  (up to date)"))
    except SystemExit:
        raise
    except Exception as e:
        say(f"couldn't read the watch ({e}); is it disconnected from the iPhone?")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", nargs="?", default="all", choices=["all", "check", "build", "flash"])
    ap.add_argument("--file")
    ap.add_argument("--url")
    ap.add_argument("--address")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--allow-version-change", action="store_true")
    args = ap.parse_args()

    if args.cmd == "check":
        asyncio.run(check(args))
        return
    ver, official = get_firmware(args)
    image = build_greek(ver, official)
    if args.cmd == "build":
        say(f"ready: {os.path.relpath(image, ROOT)}")
        return
    asyncio.run(flash(args, ver, image))


if __name__ == "__main__":
    main()
