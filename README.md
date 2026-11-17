# CMF Watch 3 Pro language patches

The CMF Watch 3 Pro can only display the scripts in its built-in font: Latin, Cyrillic, Chinese, Japanese and Korean. Notifications in any other script, like Greek, Georgian or Armenian, show up as empty boxes.

This repo adds the missing letters to the official firmware's font and flashes it to the watch over Bluetooth from a computer, without going through the Nothing X app. It started as a Greek fix, which I've been running on my own watch (firmware 1.0.1.77), and now takes a list of languages.

![Greek characters rendered with the patched watch font](docs/previews/greek.png)

The image above is rendered from the patched font itself (`tools/render_preview.py`), so it's exactly what the watch draws.

> [!WARNING]
> This is an unofficial project and isn't affiliated with or endorsed by Nothing Technology Ltd. or CMF. The product names are only used to say what it works with. Flashing modified firmware may void your warranty, and a mistake can leave the watch in its upgrade/recovery mode. The steps to recover from that are below, but there are no guarantees. Use it at your own risk.
>
> No firmware is distributed here. The scripts download the official image from Nothing's servers and patch it locally.

## Languages

| Language | `--lang` | Glyphs from | Matches the watch's typeface | Tested on a watch |
|---|---|---|---|---|
| Greek | `greek` | Inter v4.0 Medium | Yes, it's the same font | Yes (1.0.1.77) |
| Georgian | `georgian` | [Noto Sans Georgian](https://github.com/notofonts/georgian) v2.005 Medium | Close, not identical ([preview](docs/previews/georgian.png)) | Not yet |
| Armenian | `armenian` | [Noto Sans Armenian](https://github.com/notofonts/armenian) v2.008 Medium | Close, not identical ([preview](docs/previews/armenian.png)) | Not yet |

Several languages can go into one image, separated by commas in `--lang` (e.g. `--lang greek,georgian`). Korean is removed to make room, which leaves space for many more alphabets. See [Adding a language](#adding-a-language).

## Requirements

- A CMF Watch 3 Pro (board `JX402_08`) and its charger. Other CMF and Nothing watches run different firmware and aren't supported.
- A computer with Bluetooth LE, Python 3.9+ and Node.js 18+. The scripts download about 100 MB (firmware, fonts, `lv_font_conv`).
- Your phone, only to pair the watch with Nothing X again afterwards. While flashing, the watch must not be connected to the phone.

| Platform | Status |
|---|---|
| macOS, Apple Silicon | Tested (macOS 26.3, Python 3.9.6, Node 18). The terminal app needs Bluetooth permission in System Settings > Privacy & Security > Bluetooth. |
| macOS, Intel | Should work, not tested. |
| Linux (BlueZ) | Not tested. `bleak` supports it. The address is a MAC (`AA:BB:...`) rather than the UUID macOS uses, and you may have to pair/trust the watch with `bluetoothctl` first. |
| Windows 10/11 | Not tested. `bleak` supports it. Use `venv\Scripts\python` instead of `./venv/bin/python`. |
| Android, iOS | Can't flash from a phone. Gadgetbridge supports the older CMF Watch Pro but not this watch's firmware upload. |

Once flashed, the watch works with either an iPhone or an Android phone as before. Building the image (`patch.py build`) doesn't need Bluetooth and runs anywhere Python and Node do.

## Quick start

```bash
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
./venv/bin/python tools/patch.py check                # watch version vs. latest official release
./venv/bin/python tools/patch.py --lang greek         # download, build, confirm, flash, verify
```

Use `--lang georgian` for Georgian, `--lang armenian` for Armenian, or a list like `--lang greek,georgian`.

`patch.py` looks up the latest Watch 3 Pro release in the [Nothing Archive](https://github.com/spike0en/nothing_archive) update list (model `D399`) and downloads it from Nothing's CDN. It fetches the fonts and `lv_font_conv` into `cache/`, builds the patched image and stops if the font version check fails. If everything looks right it asks before flashing. After the upload it reconnects to make sure the watch didn't end up in upgrade mode.

The computer connects to the watch directly over Bluetooth. The phone isn't connected to the computer at all, it only has to let go of the watch, because the watch accepts one connection at a time:

1. On the phone, forget the watch in the Bluetooth settings (and unpair it in Nothing X if it's listed there), then close Nothing X. Turning off Bluetooth on the phone also works.
2. Put the watch on its charger next to the computer.
3. Run `patch.py`. On the first run it pairs the computer with the watch. Accept the prompt on the watch or the computer if one appears.
4. The upload takes about 30 minutes, then the watch installs the update and reboots by itself.
5. Pair the watch with Nothing X on the phone again.

Bluetooth headphones connected to the computer (AirPods, for example) may stutter or drop while it pairs with the watch and during the upload, because both share the computer's Bluetooth radio. If they drop, reconnect them. Using the speakers or pausing the music avoids it.

`patch.py build --lang ...` stops before the Bluetooth part. `--file` and `--url` let you supply the official image yourself.

## How it works

1. The official update is a single file (Actions "AOTA" format) with a few compressed parts: the main app, image resources and one font partition.
2. The font partition holds `sans36.font`, an LVGL bitmap font. It covers Latin, Cyrillic, CJK and Hangul, and nothing else.
3. The stock glyphs turned out to be Inter v4.0 Medium at 36 px. Re-rendering the Latin letters with it gives identical bytes. Each language's letters are rendered with the same settings, from Inter when it has them (Greek) or from a similar font when it doesn't (Georgian and Armenian come from Noto Sans Georgian and Noto Sans Armenian), and appended to `sans36.font`.
4. The font partition has a fixed size, so the Hangul syllables are dropped to make room. Everything else stays byte for byte the same.
5. The font is repacked and every checksum in the image is recomputed. See [docs/firmware-format.md](docs/firmware-format.md#checksums-how-they-were-worked-out) for how the checksum rules were worked out.
6. Nothing X refuses modified images, so `cmf_flash.py` talks to the watch over BLE directly, using the protocol from Gadgetbridge's CMF Watch Pro support. The watch pulls the file and installs it like a normal update.

The full story, including the approaches that didn't work, is in [docs/process.md](docs/process.md).

## Never change the partition version

Don't change any `<version>` value in `ota.xml`. The app has a hard-coded table of the resource versions it expects (on 1.0.1.77 the font must be 29). At boot, `ver_chk` compares them, and on a mismatch the watch goes into upgrade mode. That's what happened on my first attempt, when I bumped the font version to 30. The build script leaves the version alone and checks it against the table.

## Recovery

If the watch boots to a QR code with "Please connect to the app to upgrade again", it's in upgrade mode. Bluetooth still works: `cmf_test.py` connects and reports the version as `0.0.1.77`. Flash the official image (or a fixed one) with `cmf_flash.py`. In this mode the upload is much slower, about 3.5 hours for a full image.

## Manual steps

```bash
# tools
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
npm install --prefix lvconv lv_font_conv@1.5.3

# official 1.0.1.77 image (check it against firmware/SHA256SUMS)
curl -L -o firmware/ORIGINAL_JX402_08_ATS3089C_V1.0.1.77.bin \
  https://dmen2t88o28qi.cloudfront.net/ota/1779242269230JX402_08_ATS3089C_V1.0.1.77_GPS_V6_20260418.bin

# build; fonts are downloaded into cache/ and checked against their sha256
# (with --lang greek the result's sha256 is 763357046b88553d32cf492e9d6f8882161b96fe80720022108641caf47cf3d9)
./venv/bin/python tools/build_firmware.py \
  --firmware firmware/ORIGINAL_JX402_08_ATS3089C_V1.0.1.77.bin \
  --lang greek \
  --lv-font-conv lvconv/node_modules/.bin/lv_font_conv \
  --out firmware/CMF_Watch3Pro_1.0.1.77_greek.bin

# flash
./venv/bin/python tools/cmf_scan.py                # find the watch's address
./venv/bin/python tools/cmf_test.py  <ADDRESS>     # read-only: pairs and reads the version
./venv/bin/python tools/cmf_flash.py <ADDRESS> firmware/CMF_Watch3Pro_1.0.1.77_greek.bin
```

The first connection pairs with the watch and stores the key in `tools/authkey.hex`. Accept the pairing prompt if one appears. The key file is git-ignored and readable only by you. Anyone with it can talk to the watch, so don't share it.

## After an official update

An official update replaces the font partition, so the added letters are gone again (the watch itself keeps working). Install the update through Nothing X, then run `patch.py` as in the quick start. It downloads the new release, patches it and flashes it.

`patch.py --allow-version-change` would install the update and the patch in one go, since the official update file is exactly what gets patched. I haven't tried it yet. See [docs/updating.md](docs/updating.md) for details and the manual route.

## Adding a language

Alphabets written left to right can be added with a font entry and a few lines in `tools/languages.py`. Right-to-left scripts and scripts that need shaping (Arabic, Hebrew, Indic) won't display correctly. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to pick a font, the checks to run and what goes in the pull request. If you can't code, open a [language request](https://github.com/chrispetrou/cmf-watch3pro-languages/issues/new?template=language-request.yml).

## Layout

```
tools/
  patch.py                 fetch latest release, build, flash, verify
  build_firmware.py        official image -> patched image (reproducible)
  languages.py             the languages and the fonts their glyphs come from
  render_preview.py        render text with the watch font to a PNG (needs Pillow)
  export_glyphs.py         export each language's glyphs for the web app (web/public/glyphs/)
  cmf_scan.py              find the watch's BLE address
  cmf_test.py              pair and read the firmware version (read-only)
  cmf_flash.py             upload an image over BLE
  cmf_ble.py               BLE framing and crypto
  cmf_client.py            pairing, session, firmware upload
  unpack_aota.py           list/extract the parts of an image, check their CRCs
  sdfs.py                  list the files in an SDFS image
  lvfont.py, fontbuild.py  LVGL font reader/writer
  repack.py                SDFS, chunked LZMA and AOTA builders
  fetch.py                 download helper
docs/
  previews/                what each language looks like on the watch
  process.md               how the patch was done, dead ends included
  firmware-format.md       AOTA, chunked LZMA, SDFS and LVGL font formats
  ble-protocol.md          pairing, session crypto, firmware upload
  updating.md              re-applying the patch after an official update
```

`firmware/`, `cache/`, `venv/` and the pairing key are git-ignored.

## License and credits

AGPL-3.0, see [LICENSE](LICENSE).

- The BLE protocol code (`cmf_ble.py`, `cmf_client.py`) is ported from [Gadgetbridge](https://codeberg.org/Freeyourgadget/Gadgetbridge)'s `cmfwatchpro` support, which is AGPL-3.0. That's why the whole repo uses the same license.
- Glyphs are rendered from [Inter](https://rsms.me/inter/) by Rasmus Andersson (SIL Open Font License 1.1) and, for scripts Inter doesn't cover, the fonts listed in the Languages table (Noto fonts are also under the SIL Open Font License 1.1). No fonts are included, the scripts download them.
- Please don't open issues or PRs with firmware images or patched `.bin` files. Contributions are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md).
