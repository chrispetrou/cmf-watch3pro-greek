# Re-applying Greek after an official update

An official update replaces the font partition, so Greek disappears again. The watch keeps working normally.

## With greekify.py

```bash
./venv/bin/python tools/greekify.py check    # watch version vs. latest release
./venv/bin/python tools/greekify.py          # download, patch, flash, verify
```

By default the script only flashes when the watch already runs the same version as the image. So install the official update through Nothing X first, then forget the watch on the phone and run the script.

`--allow-version-change` skips that check and installs update and patch in a single flash. This should work, because the official update file is exactly what gets patched, but I haven't tested it.

The script stops if the new release's app expects a different font version than its `ota.xml` declares. In that case don't flash, and look at the expected-version table first (see [firmware-format.md](firmware-format.md#expected-version-table-in-the-app)).

## By hand

### 1. Get the firmware file

You need the exact `.bin` of the release on the watch.

1. The [Nothing Archive](https://nothingarchive.tech) lists it (`JX402_08_ATS3089C_V<version>_...bin`). The machine-readable list is `website/src/data/accessories_updates.json` in [its repo](https://github.com/spike0en/nothing_archive), entry `D399`.
2. The files live on Nothing's CDN as `https://dmen2t88o28qi.cloudfront.net/ota/<timestamp>JX402_08_ATS3089C_V<version>_GPS_V6_<date>.bin`. The timestamp can't be guessed, so you need the exact link.
3. If the archive doesn't have it yet, capture the link from Nothing X while it's still offering the update. Route the phone through mitmproxy in WireGuard mode (see [process.md](process.md#1-getting-the-firmware)) and read the `otaCheck` response. Remove the certificate and tunnel from the phone afterwards.

Keep the file as `firmware/ORIGINAL_<version>.bin`. It's also your recovery image.

### 2. Build

```bash
./venv/bin/python tools/build_greek_firmware.py \
  --firmware firmware/ORIGINAL_<version>.bin \
  --ttf fonts/Inter-Medium.ttf \
  --lv-font-conv lvconv/node_modules/.bin/lv_font_conv \
  --out firmware/greek_<version>.bin
```

The first line of output should say the font version matches the app's expected-version table. If it prints a warning instead, don't flash.

If the build stops because the font image grew, the new stock font is bigger and dropping Hangul alone no longer frees enough room. More glyphs would have to go (extend the `drop` predicate in `build_greek_firmware.py`).

If Nothing ever switches typefaces, the Greek (still Inter Medium) will look slightly different from the rest of the text, but it will still work.

### 3. Flash

Forget the watch on the phone, close Nothing X and put the watch on its charger.

```bash
./venv/bin/python tools/cmf_test.py  <ADDRESS>
./venv/bin/python tools/cmf_flash.py <ADDRESS> firmware/greek_<version>.bin
```

The upload takes about 30 minutes, then the watch installs the image and reboots. Run `cmf_test.py` again afterwards. It should report the new version, not `0.x.x.x`. Then pair the watch with Nothing X again and send yourself a Greek message to check.

## If it goes wrong

A QR code with "Please connect to the app to upgrade again", or a reported version of `0.x.x.x`, means the watch is in upgrade mode. Flash `firmware/ORIGINAL_<version>.bin` with `cmf_flash.py`. In this mode the upload takes several hours, so keep the computer awake and the watch on its charger.
