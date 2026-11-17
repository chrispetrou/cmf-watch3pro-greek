# Firmware formats (Actions ATS3089C "leopard" SDK, CMF Watch 3 Pro)

All integers are little-endian unless noted. Every structure below was verified by rebuilding the stock file to identical bytes.

## AOTA container

| Offset | Size | Meaning |
|---|---|---|
| 0x00 | 4 | magic `AOTA` |
| 0x04 | 4 | CRC32 of bytes `0x08..0x400` |
| 0x0c | 4 | number of files |
| 0x14 | 4 | total image size |
| 0x18 | 4 | CRC32 of bytes `0x400..end` |
| 0x40.. | | version strings, e.g. `1.00_2604181507` |
| 0x200 | 32 x n | file table: `name[16], u32 offset, u32 size, u32 0, u32 crc32(file bytes)` |
| 0x400 | | `ota.xml`, then each file; every file starts on a 512-byte boundary |

`ota.xml` lists partitions:

```xml
<partition>
  <type>DATA</type> <name>font</name> <file_id>12</file_id> <storage_id>2</storage_id>
  <file_name>fonts.bin</file_name>
  <file_size>0x...</file_size>   <!-- compressed size -->
  <orig_size>0x...</orig_size>   <!-- uncompressed size -->
  <version>29</version>        <!-- MUST match the app's expected-version table -->
  <checksum>0x...</checksum>     <!-- DATA: CRC32 of UNcompressed data; TEMP: CRC32 of the file as stored -->
</partition>
```

Stock 1.0.1.77 partitions: `fw0_temp` (TEMP, id 254), `sdfs_k` (20, v7), `font` (12, v29), `res_d` (13, v80), `res_a` (10, v84), `res_b` (11, v74), `res_e` (14, v2).

### Expected-version table in the app

Decompressed `TEMP.bin` contains entries of the form `{u32 file_id, u32 version, u32 name_ptr}`. On 1.0.1.77 the table is at offset `0x215f44`. At boot, `system_app_launch` runs `res_chk` and `ver_chk`; a mismatch sends the watch to the upgrade screen. To find the table in another release, search for `struct.pack("<II", 12, <font version>)`.

## Chunked "LZMA" parts

The data is a sequence of chunks, one per 0x8000 bytes of raw data:

```
"LZMA"  u32 header_len(=0x10)  u32 comp_len  u32 raw_len   <xz stream: CRC64 check, preset 6>
```

Chunks may be padded. Re-compressing with Python `lzma.compress(..., format=FORMAT_XZ, check=CHECK_CRC64, preset=6)` gives exactly the vendor's bytes.

`TEMP.bin` (the app) is itself a nested AOTA holding `fw0` and `fw0_sdfs`.

## SDFS

A flat filesystem image:

- 32-byte entries: `name[12], u32 offset, u32 size, u32 0, u32 0, u32 sum32(file)`.
- Entry 0 is the header `sdfs.bin`: `count` (files, excluding the header), `total_size`, `0`, `sum32(entry table)`, `sum32(all data after the header area)`.
- File data is 64-byte aligned and starts at 0x80 or later. The image is padded to 512 bytes.
- `sum32` is the sum of the data read as u32 words, mod 2^32.

`fonts.bin` -> `sans36.font` + `emoji28.font`. The font paths seen in the app (`/NAND:C/sans36.font`, ...) are mounted from these images.

## LVGL binary font (`sans36.font`)

The format is the standard output of `lv_font_conv --format bin`: a chain of `[u32 len][4cc tag][payload]` chunks:

- **head**: version, size 36, ascent/descent, default advance, `bpp=2`, `compression=1` (RLE with prefilter), loca/glyph-id formats.
- **cmap**: subtables of type 0 (format0 full), 1 (sparse full), 2 (format0 tiny, a contiguous run) or 3 (sparse tiny). Each subtable has a range start, a length, a glyph-id start and a data offset. The stock font only uses types 0, 2 and 3, and the watch didn't find glyphs put in a type 1 subtable. The lookup also stops at the first subtable whose range holds the codepoint, so a new codepoint inside an existing sparse range is handled by splitting that subtable around it (`fontbuild._split_around`).
- **loca**: glyph offsets into glyf.
- **glyf**: bit-packed `adv_w`, `box x/y/w/h`, then the bitmap. The bitmap is prefiltered (XOR with the previous row) and RLE-compressed exactly as `lv_font_conv`'s compressor does (see `lvfont.encode_glyph`). One subtlety: `lv_font_conv` writes the final terminator bit even at the end of the stream, and `lvfont.encode_glyph` mirrors that so it reproduces stock bytes exactly.
- **kern**: pair table, kept for the glyphs that remain.

Advance widths are stored in 1/16 px: `round(hmtx_advance * 36 * 16 / unitsPerEm)`.

New glyphs can come from any TrueType font. Each one is rasterised from its own font with the same `lv_font_conv` settings, its advance width is computed from that font's `hmtx`, and all added glyphs are appended in codepoint order. The bitmap font only stores pixels, so glyphs from different fonts sit side by side without problems. They only look different if the fonts' shapes and proportions differ.

## Emoji font (`emoji28.font`)

Colour emoji, 30 x 30 each (the stock file has 53, all Twemoji). All values little-endian:

```
header   u32 0, u32 count, 8 zero bytes
index    count x 16 bytes, sorted by codepoint:
         u32 codepoint, u16 width, u16 height, u32 offset (from the start of the file), u16 advance, u16 7
pixels   width x height x 3 bytes per emoji; each pixel is the 24-bit value
         alpha << 18 | red << 12 | green << 6 | blue (6 bits per channel)
```

The stock advance is 33 (30 px plus spacing); 0 makes an entry take no space, which is how the skin tone modifiers are hidden. The last u16 is 7 in every stock entry and its meaning is unknown. The count comes from the header, so entries can be added: a test image with 10 extra emoji showed them all.

The pixel format was worked out by fitting the stored bits against the Twemoji PNGs: a least-squares fit put 6 bits of blue in bits 0-5 and 6 bits of green in bits 6-11, which left red in 12-17 and alpha in 18-23. Read as RGB565 plus an alpha byte, the shapes are right but the colours are wrong.

Which font draws a character depends on the codepoint: high codepoints go to `emoji28.font`, lower ones to `sans36.font`. So ❤ (U+2764), ✅ (U+2705) and the flag letters (U+1F1E6 to U+1F1FF) can only be added to the text font, which is 2 bpp and has no colour. In the tests U+1F1E6 to U+1F1FF went to the text font and U+1F389 and up to the emoji font. The tools assume the split is at U+1F300, the start of the Miscellaneous Symbols and Pictographs block, and a test with 🌈 (U+1F308) and 🌹 (U+1F339) confirms it [to be checked]. The code in the app that makes this choice hasn't been found.

## Checksums: how they were worked out

There was no documentation, so every rule above was found by guessing and checking against the official file:

1. Find the checksum fields. Some 4-byte values look random next to sizes and names, for example `<checksum>0x37aaed49</checksum>` in `ota.xml` or bytes 4 and 0x18 of the AOTA header.
2. Guess the algorithm. Embedded firmware nearly always uses CRC32 or a plain sum of bytes or u32 words.
3. Guess what it covers: the whole file, everything after the header, one part, that part compressed or uncompressed, and so on.
4. Try every combination on the stock file. A combination that reproduces the stored value is the rule; a chance match on a 32-bit value is a 1 in 4 billion shot.

Results:

| Field | Rule |
|---|---|
| AOTA header @0x04 | CRC32 of bytes `0x08..0x400` |
| AOTA header @0x18 | CRC32 of bytes `0x400..end` |
| AOTA file table, per part | CRC32 of the part as stored (compressed) |
| `ota.xml` `<checksum>`, DATA parts | CRC32 of the part's uncompressed contents |
| `ota.xml` `<checksum>`, TEMP part | CRC32 of the part as stored (compressed) |
| SDFS file entry / header | `sum32`: the data read as u32 words, summed mod 2^32 |
| Chunked LZMA | each chunk is a standard xz stream with its own CRC64, written by `lzma.compress` |
| BLE packets | CRC32 (little-endian) after each payload; taken from Gadgetbridge's source, not discovered |

To verify, the stock image was taken apart and rebuilt with the tools in this repo without changing anything, and the result was identical to the original byte for byte. A wrong rule would have changed at least one byte. Greek was added only after that. The watch accepted the patched image's checksums on the first flash; that flash failed only on the version check described above.

`tools/unpack_aota.py` prints the per-part CRC check (`OK`/`MISMATCH`), which is a quick way to re-verify the rules on a new release.
