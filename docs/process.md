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
