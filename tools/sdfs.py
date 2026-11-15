"""List the files in an Actions SDFS image: 32-byte entries {name[12], u32 offset, u32 size, u32 0, u32 0, u32 sum32}."""
import struct
import sys


def entries(d):
    out = []; off = 0
    # first entry is the image header "sdfs.bin"
    while off + 32 <= len(d):
        name = d[off:off+12].split(b"\0")[0]
        if not name: break
        o, s = struct.unpack("<II", d[off+12:off+20])
        out.append((name.decode(errors="replace"), o, s, off)); off += 32
    return out


if __name__ == "__main__":
    d = open(sys.argv[1], "rb").read()
    for n, o, s, eo in entries(d): print(f"{n:16} off={o:#09x} size={s:#09x}")
