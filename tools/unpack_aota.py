"""Unpack an AOTA firmware image: check each part's CRC and decompress the chunked-LZMA parts.

Usage: python unpack_aota.py <firmware.bin> <out_dir>
"""
import os
import struct
import sys
import zlib

from repack import parse_aota, unlzma

src, out = sys.argv[1], sys.argv[2]
data = open(src, "rb").read()
os.makedirs(out, exist_ok=True)
_, files = parse_aota(data)
for i, (name, blob) in enumerate(files):
    crc = struct.unpack("<I", data[0x200 + 32 * i + 28:0x200 + 32 * i + 32])[0]
    calc = zlib.crc32(blob) & 0xffffffff
    print(f"{name:12} size={len(blob):#010x} crc={crc:#010x} {'OK' if calc == crc else 'MISMATCH'}")
    open(os.path.join(out, name), "wb").write(blob)
    if blob[:4] == b"LZMA":
        raw = unlzma(blob)
        open(os.path.join(out, name + ".raw"), "wb").write(raw)
        print(f"{'':12} decompressed to {len(raw):#x} bytes -> {name}.raw")
