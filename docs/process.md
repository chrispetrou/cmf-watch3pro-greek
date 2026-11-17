# How it was done

Roughly in the order it happened, dead ends included, since they explain why the tools look the way they do.

## 0. The problem

On the CMF Watch 3 Pro (board `jx402_08`, Actions ATS3089C, Zephyr + LVGL, firmware 1.0.1.77) Greek text in notifications shows up as boxes. The watch has no Greek localisation and its font has no Greek glyphs, so the plan was to add them to the font in the firmware.

## 1. Getting the firmware

The Nothing X app checks for updates by calling an `otaCheck` endpoint. To see that traffic I routed the iPhone through mitmproxy:

- The app is built with Flutter and ignores the iOS Wi-Fi HTTP proxy, so mitmproxy ran in WireGuard mode instead. The phone joined a WireGuard tunnel to the Mac and trusted the mitmproxy CA.
- `otaCheck` answered `needUpdate=0` because the watch was already up to date, so it didn't reveal a download URL.

The image `JX402_08_ATS3089C_V1.0.1.77_GPS_V6_20260418.bin` (45,069,312 bytes) came from the community firmware archive (nothingarchive.tech), which mirrors Nothing's CloudFront OTA bucket.

## 2. Reverse engineering the formats

Everything is documented in [firmware-format.md](firmware-format.md). In short:

1. The AOTA container holds `ota.xml` and 7 parts: `TEMP.bin` (the app), `sdfs_k`, `fonts`, `res_d`, `res`, `res_b`, `res_e`.
2. Each part is chunked LZMA: 32 KiB blocks, each a standard xz stream. Python's `lzma` at preset 6 reproduces the vendor's bytes exactly.
3. `fonts.bin` decompresses to an SDFS mini-filesystem holding just two files: `sans36.font` (~6 MB, 36,183 glyphs) and `emoji28.font`.
4. `sans36.font` is a standard LVGL binary font (`lv_font_conv --format bin`): 2 bpp, the RLE/prefilter compression, cmap formats 0/2/3, and a kerning table.

Before adding anything, every builder in `tools/` was checked by rebuilding the stock files and comparing: the output had to be identical, byte for byte. That covers the glyph RLE encoder, the SDFS packer, the LZMA chunker and the AOTA container.

## 3. Matching the typeface

To make the added Greek look native, I rendered sample glyphs (`AgЖRa3eHnoS...`) with candidate fonts through `lv_font_conv` at 36 px / 2 bpp and compared the pixels with the stock glyphs. Candidates included Inter 3.19/4.0/4.1 (Regular/Medium/SemiBold), Noto Sans, Open Sans and Roboto.

Inter v4.0 Medium matched exactly. Advance widths follow `round(hmtx * 36 * 16 / unitsPerEm)` (LVGL stores 1/16 px units), which also matches the stock values.

## 4. Building the font

`fontbuild.build()` rebuilds the LVGL font:

- Drops the Hangul syllables (U+AC00-D7A3). The font partition on the watch has a fixed size, and the Korean glyphs free about 1.5 MB.
- Appends 105 Greek codepoints (U+0370-03FF, every one Inter has), rasterised by `lv_font_conv --no-compress --no-kerning` and then re-encoded with the stock compression.
- Keeps the kerning table for the remaining glyphs. Greek gets no kerning pairs, which is fine at this size.

Checks run on the result:
- All 36k kept codepoints decode to identical pixels and advances.
- Hangul is gone and all Greek is present.
- The Greek glyphs decode identically to the `lv_font_conv` output.

## 5. Delivering it: the app route (abandoned)

The first idea was to let Nothing X install the image by spoofing `otaCheck`: return `needUpdate=1` with a URL pointing to the patched file. The app accepted the fake offer but never downloaded the file. I tried HTTP/3 off and several host swaps, with the same result. I gave this route up and later deleted the spoofing script.

## 6. Delivering it: direct BLE flasher

[Gadgetbridge](https://codeberg.org/Freeyourgadget/Gadgetbridge) already supports the original CMF Watch Pro, including firmware upload. Its protocol was ported to Python with `bleak` (see [ble-protocol.md](ble-protocol.md)). These were the macOS-specific problems along the way:

| Symptom | Cause / fix |
|---|---|
| `BleakError: Bluetooth device is turned off` | The terminal app needs Bluetooth permission (Privacy & Security -> Bluetooth). |
| Notifications silently dropped | CoreBluetooth reports UUIDs in upper case, so they are lowercased before dispatch. |
| Pair reply never "completes" | For plaintext packets the length field over-counts by 4: it includes a CRC the watch doesn't send. The packet is complete once `len(buf) >= plen + 3`. |
| `AUTH_FAILED "restart"` after pairing | Expected: the watch wants a new connection after a fresh pair, so the client reconnects. |
| Session handshake silent after reconnect | The watch requires an encrypted link. Subscribing to `0000ffd2` forces macOS to bond and encrypt; after that the session works. |
| `FW_INIT2` gets no reply | Gadgetbridge sends the hard-coded version `0b 00 00 39` (11.0.0.57, the old Watch Pro). The Watch 3 Pro wants its own current version: `01 00 01 4d` = 1.0.1.77. |

The watch then pulls the file itself. It requests `(offset, length)` chunks, about 3.9 KB each, and the host answers with raw bytes. The full image takes about 28 minutes.

## 7. The rejected flash

The first patched image (with the font version bumped from 29 to 30) uploaded fine. After the install reboot, however, the watch showed a QR code and "Please connect to the app to upgrade again", and it reported its version as `0.0.1.77`.

Recovery: flashing the untouched original image over the same BLE path. In upgrade mode this took about 3.6 hours. The watch came back on 1.0.1.77, which proved that the flasher itself was fine.

Diagnosis:
- All container, part and xml CRCs were correct: the xml uses CRC32 of the uncompressed data for DATA parts and of the compressed data for TEMP. The SDFS sums were valid too.
- The app binary logs `system_app_launch: ota_fg = %d, res_chk = %d ver_chk = %d`.
- Searching `TEMP.bin` for `{file_id, version}` pairs found a table at offset `0x215f44` of decompressed TEMP:

```
{10, 84, "res_a"} {12, 29, "font"} {11, 74, "res_b"} {13, 80, "res_d"} {14, 2, "res_e"} {20, 7, ...}
```

The app hard-codes the resource versions it expects. Font version 30 != 29 -> `ver_chk` fails -> upgrade mode.

The fix was to keep `<version>29</version>`. The watch appears to decide what to pull by content, not by version: with the version unchanged, a logged upload showed it pulling `TEMP`, `sdfs_k` and the whole font partition, and skipping the unchanged resource parts. That run took 28 minutes. The watch booted normally, and Greek notifications now render correctly.

## 8. Cleanup

The interception setup was removed afterwards:
- the mitmproxy CA (`~/.mitmproxy`) and the spoofing script were deleted from the Mac;
- on the iPhone, the mitmproxy profile, the WireGuard tunnel and any Wi-Fi proxy setting were removed.

## 9. Georgian

After the Greek patch was published, a Georgian user asked for Georgian. Inter has no Georgian glyphs at all, so the letters had to come from another font. Noto Sans Georgian Medium (v2.005) was picked because its proportions are closest to Inter's: x-height 0.539 em vs 0.546, cap height 0.714 em vs 0.728. It is rendered at the same 36 px and 2 bpp, so it sits on the same baseline and at a similar size as the stock text.

The 134 glyphs (Mkhedruli, Asomtavruli and Mtavruli) add about 14 KB, well inside the room freed by dropping Hangul. The font partition version stays 29. The build tools were generalised so that each language names its font in `tools/languages.py`.

The Greek and Georgian image was flashed to a watch on 1.0.1.77 and Georgian notifications show correctly.

## 10. Armenian

Armenian was the next alphabet that is written left to right, needs no letter joining and is missing from the stock font. Inter has no Armenian either. Noto Sans Armenian Medium (v2.008) was picked for the same reason as the Georgian font: its x-height and cap height (0.536 and 0.714 em) are close to Inter's (0.546 and 0.728).

The 96 glyphs cover the Armenian block (capital and small letters, punctuation such as ։ ՝ ՞, the ligature և and the dram sign ֏) and the five Armenian ligatures at U+FB13 to U+FB17. They add about 8 KB. The font partition version stays 29, and with Greek, Georgian and Armenian together the build gives the same image whatever order the languages are listed in.

The Greek, Georgian and Armenian image was flashed to a watch on 1.0.1.77 and Armenian notifications show correctly, including the punctuation and the dram sign.

## 11. In the browser

Running Python tools from a terminal is too much for most people, so the same steps were moved into a web page, [watchlanguages.app](https://watchlanguages.app).

- **Building.** The page runs the unchanged `tools/*.py` in Pyodide (Python compiled to WebAssembly) inside a Web Worker. The glyphs are rasterised ahead of time by `tools/export_glyphs.py`, since lv_font_conv needs Node and the fonts. The browser builds byte for byte the same image as the command line (same sha256 for every language set), in a few seconds. The firmware file never leaves the computer.
- **Flashing.** Web Bluetooth gives the same GATT access as the Python client, so `web/src/ble` is a port of `tools/cmf_client.py`. The first version confirmed every packet and ran at about 2 KB/s. Sending without confirmations, with a fallback when the watch goes quiet, brought it to 16.5 KB/s (see [ble-protocol.md](ble-protocol.md#write-mode-and-speed)).
- **Restart.** Chrome on macOS cannot reconnect to the watch after it restarts without asking the user again, so the install counts as done once the watch acknowledges the upload, and checking the new version is a separate button.
- **Platforms.** Web Bluetooth exists only in Chromium browsers. It was tested in Chrome and Dia on macOS. On iPhone every browser is built on WebKit, which has no Web Bluetooth, so the page cannot work there.

Greek, Georgian and Armenian were all flashed from the page to a watch on 1.0.1.77.

## 12. Emoji

The stock emoji font has only 53 emoji, so most emoji in notifications showed as boxes. Its format wasn't documented. The index was easy to read (codepoint, size, offset), but the pixels took longer: 3 bytes each, and read as RGB565 plus an alpha byte the shapes were right but the colours were wrong. The stock emoji are Twemoji, so the Twemoji PNGs, scaled to the same 30 x 30, gave something to compare against. A least-squares fit of each colour channel against the 16 low bits showed blue in bits 0-5 and green in bits 6-11 with 6 bits each, which made it ARGB6666: 6 bits each of alpha, red, green and blue in 24 bits.

Three test images on the watch settled the rest:

1. Ten extra emoji added to the font: the seven at U+1F389 and above showed, but ✅ (U+2705), ❤ (U+2764) and the invisible U+FE0F after ❤ showed as boxes. The watch reads the emoji count from the file, but it only looks in the emoji font for high codepoints. The rest go to the text font.
2. The symbols below that added to the text font as white glyphs from Noto Emoji, and U+FE0F as an empty glyph: these worked, except two that fell inside an existing sparse cmap range. I had merged them into that range by converting it to LVGL's "sparse full" subtable type, which the stock font never uses, and the watch didn't find them. Flag letters added to the emoji font showed as boxes, so the split is above U+1F1FF.
3. The sparse ranges split around the new codepoints instead (only the subtable types the stock font uses): all symbols showed. The flag letters as capitals in the text font made 🇬🇷 read GR. Skin tones as 1 x 1 transparent emoji with an advance of 0 disappeared; with the stock advance of 33 they left a gap, which showed what that field is.

The final option adds 450 colour emoji, the most used single-character ones from Unicode's 2019 frequency ranking that the watch doesn't have, about 160 white symbols, and the invisible and flag entries. It takes about 1.2 MB of the font partition.

