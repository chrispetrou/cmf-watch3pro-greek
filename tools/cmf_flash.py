"""
Flash an AOTA firmware image to the CMF watch over BLE.

Usage:
  python cmf_flash.py <ADDRESS> <firmware.bin> [version]

Keep the watch still and on the charger. Do not touch it during the upload.
"""
import asyncio
import os
import sys
import time
import cmf_client as C


def bar(pct):
    n = int(pct / 2)
    sys.stdout.write(f"\r  [{'#'*n}{'.'*(50-n)}] {pct:3d}%")
    sys.stdout.flush()
    if pct >= 100:
        sys.stdout.write("\n")


async def main(addr, path, version):
    if not os.path.exists(path):
        print("file not found:", path); sys.exit(1)
    cl = C.CmfClient(addr)
    t0 = time.time()
    try:
        await cl.connect()
        await cl.authenticate()
        ver = await cl.get_firmware_version()
        C.log(f"current watch firmware: {ver}")
        if version is None:
            # FW_INIT2 wants the watch's own version; in upgrade/recovery mode the
            # watch reports 0.x.y.z, so fall back to the build number with major 1.
            v = tuple(int(x) for x in ver.split("."))
            version = v if v[0] != 0 else (1,) + v[1:]
            C.log(f"using version {'.'.join(map(str, version))} for FW init 2")
        C.log("starting firmware upload...")
        await cl.flash_firmware(path, progress_cb=bar, version=version)
        C.log(f"done in {int(time.time()-t0)}s, the watch reboots once it has installed the image")
    finally:
        await cl.disconnect()


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        print("usage: python cmf_flash.py <ADDRESS> <firmware.bin> [version, default: read from watch]")
        sys.exit(1)
    ver = tuple(int(x) for x in sys.argv[3].split(".")) if len(sys.argv) == 4 else None
    asyncio.run(main(sys.argv[1], sys.argv[2], ver))
