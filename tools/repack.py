"""Rebuild Actions SDFS images, chunked-LZMA partitions and the AOTA container."""
import lzma
import re
import struct
import zlib

s32 = lambda b: sum(struct.unpack(f"<{len(b)//4}I", b[:len(b)//4*4])) & 0xffffffff
align = lambda n, a: (n + a - 1) // a * a


def build_sdfs(files):
    """files: list of (name, bytes). Layout: 32-byte entries, data 64-byte aligned, image 512-aligned."""
    hdr_end = align(32 * (len(files) + 1), 0x40)
    if hdr_end < 0x80: hdr_end = 0x80
    off, ents, data = hdr_end, b"", bytearray(hdr_end)
    for name, blob in files:
        ents += name.encode().ljust(12, b"\0") + struct.pack("<IIIII", off, len(blob), 0, 0, s32(blob))
        data[len(data):] = b"\0" * (off - len(data)) + blob
        off = align(off + len(blob), 0x40)
    total = align(len(data), 0x200)
    data += b"\0" * (total - len(data))
    table = ents + b"\0" * (hdr_end - 32 - len(ents))
    entry0 = b"sdfs.bin".ljust(12, b"\0") + struct.pack("<IIIII", len(files), total, 0, s32(table), s32(bytes(data[hdr_end:])))
    data[0:hdr_end] = entry0 + table
    return bytes(data)


def unlzma(d):
    """Decompress a chunked-LZMA part: repeated [b"LZMA", u32 hdr_len, u32 comp_len, u32 raw_len] + xz stream."""
    out, off = bytearray(), 0
    while off < len(d) and d[off:off + 4] == b"LZMA":
        hl, cl, rl = struct.unpack("<III", d[off + 4:off + 16])
        chunk = lzma.decompress(d[off + hl:off + hl + cl])
        assert len(chunk) == rl
        out += chunk
        nxt = d.find(b"LZMA", off + hl + cl, off + hl + cl + 64)
        if nxt < 0:
            break
        off = nxt
    return bytes(out)


def lzma_chunks(raw, chunk=0x8000):
    out = bytearray()
    for i in range(0, len(raw), chunk):
        c = lzma.compress(raw[i:i+chunk], format=lzma.FORMAT_XZ, check=lzma.CHECK_CRC64, preset=6)
        out += b"LZMA" + struct.pack("<III", 0x10, len(c), len(raw[i:i+chunk])) + c
    return bytes(out)


def parse_aota(d):
    files = []
    off = 0x200
    while d[off:off+16].strip(b"\0"):
        name = d[off:off+16].split(b"\0")[0].decode()
        o, s = struct.unpack("<II", d[off+16:off+24])
        files.append((name, d[o:o+s]))
        off += 32
    return d[:0x200], files


def build_aota(header, files):
    """header: original first 0x200 bytes (version strings etc.); files: [(name, bytes)] in order."""
    out = bytearray(0x400)
    table = b""
    for name, blob in files:
        o = len(out)
        table += name.encode().ljust(16, b"\0") + struct.pack("<IIII", o, len(blob), 0, zlib.crc32(blob) & 0xffffffff)
        out += blob
        out += b"\0" * (align(len(out), 0x200) - len(out))
    out[0x200:0x200+len(table)] = table
    out[0:0x200] = header
    struct.pack_into("<I", out, 0x0c, len(files))
    struct.pack_into("<I", out, 0x14, len(out))
    struct.pack_into("<I", out, 0x18, zlib.crc32(out[0x400:]) & 0xffffffff)
    struct.pack_into("<I", out, 0x04, zlib.crc32(out[0x08:0x400]) & 0xffffffff)
    return bytes(out)


def set_xml_partition(xml, name, **fields):
    """Update <file_size>/<orig_size>/<checksum>/<version> inside the <partition> whose <name> matches."""
    blocks = re.split(r"(<partition>.*?</partition>)", xml, flags=re.S)
    for i, b in enumerate(blocks):
        if f"<name>{name}</name>" in b:
            for k, v in fields.items():
                b, n = re.subn(rf"<{k}>[^<]*</{k}>", f"<{k}>{v}</{k}>", b)
                assert n == 1, k
            blocks[i] = b
    return "".join(blocks)
