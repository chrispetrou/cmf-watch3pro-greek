"""
Read and write the watch's colour emoji font (emoji28.font).

Layout (all little-endian):
  header   u32 0, u32 count, 8 zero bytes
  index    count x 16 bytes: u32 codepoint, u16 width, u16 height, u32 offset, u16 33, u16 7
           sorted by codepoint; offset is from the start of the file
  pixels   width x height x 3 bytes per emoji, each pixel a 24-bit value
           alpha << 18 | red << 12 | green << 6 | blue, 6 bits per channel (ARGB6666)

The stock font has 53 Twemoji at 30 x 30. The two u16 fields after the offset are the
same for every stock emoji and are copied as is.
"""
import struct

SIZE = 30
_TAIL = (33, 7)


def parse(data):
    """Return [(codepoint, width, height, (u16, u16), pixel bytes)] in file order."""
    zero, count = struct.unpack_from("<II", data, 0)
    assert zero == 0, "not an emoji font"
    out = []
    for i in range(count):
        cp, w, h, off, a, b = struct.unpack_from("<IHHIHH", data, 16 + 16 * i)
        out.append((cp, w, h, (a, b), data[off:off + w * h * 3]))
    return out


def build(emoji):
    """Inverse of parse(). Entries are sorted by codepoint."""
    emoji = sorted(emoji, key=lambda e: e[0])
    assert len({e[0] for e in emoji}) == len(emoji), "duplicate codepoint"
    head = struct.pack("<II", 0, len(emoji)) + bytes(8)
    index, pixels = [], []
    off = 16 + 16 * len(emoji)
    for cp, w, h, (a, b), px in emoji:
        assert len(px) == w * h * 3
        index.append(struct.pack("<IHHIHH", cp, w, h, off, a, b))
        pixels.append(px)
        off += len(px)
    return head + b"".join(index) + b"".join(pixels)


def encode_rgba(rgba, w=SIZE, h=SIZE):
    """8-bit RGBA bytes (w x h) -> ARGB6666 pixel bytes, like the stock font (top 6 bits)."""
    assert len(rgba) == w * h * 4
    out = bytearray()
    for i in range(0, len(rgba), 4):
        r, g, b, a = rgba[i:i + 4]
        v = (a >> 2) << 18 | (r >> 2) << 12 | (g >> 2) << 6 | (b >> 2)
        out += bytes((v & 0xFF, (v >> 8) & 0xFF, v >> 16))
    return bytes(out)


def decode_rgba(px):
    """ARGB6666 pixel bytes -> 8-bit RGBA bytes."""
    x6 = lambda v: (v << 2) | (v >> 4)  # noqa: E731
    out = bytearray()
    for i in range(0, len(px), 3):
        v = px[i] | px[i + 1] << 8 | px[i + 2] << 16
        out += bytes((x6((v >> 12) & 63), x6((v >> 6) & 63), x6(v & 63), x6(v >> 18)))
    return bytes(out)


def add(data, new):
    """Return the font with extra emoji. new = {codepoint: 30 x 30 RGBA bytes, or
    (width, height, (u16, u16), RGBA bytes) for an entry of another size}. Existing ones are kept."""
    emoji = parse(data)
    have = {e[0] for e in emoji}
    for cp, v in new.items():
        if cp in have: continue
        w, h, tail, rgba = v if isinstance(v, tuple) else (SIZE, SIZE, _TAIL, v)
        emoji.append((cp, w, h, tuple(tail), encode_rgba(rgba, w, h)))
    return build(emoji)
