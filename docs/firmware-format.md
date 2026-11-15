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
- **cmap**: subtables of type 0 (format0 full), 2 (sparse tiny), 3 (format0 tiny) or 1. Each subtable has a range start, a length, a glyph-id start and a data offset.
- **loca**: glyph offsets into glyf.
- **glyf**: bit-packed `adv_w`, `box x/y/w/h`, then the bitmap. The bitmap is prefiltered (XOR with the previous row) and RLE-compressed exactly as `lv_font_conv`'s compressor does (see `lvfont.encode_glyph`). One subtlety: `lv_font_conv` writes the final terminator bit even at the end of the stream, and `lvfont.encode_glyph` mirrors that so it reproduces stock bytes exactly.
- **kern**: pair table, kept for the glyphs that remain.

Advance widths are stored in 1/16 px: `round(hmtx_advance * 36 * 16 / unitsPerEm)`.

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
