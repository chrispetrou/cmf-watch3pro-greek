"""Minimal reader for LVGL binary fonts (lv_font_conv --format bin)."""
import struct

class Bits:
    def __init__(self, b, pos=0): self.b, self.p = b, pos
    def u(self, n):
        v = 0
        for _ in range(n):
            v = (v << 1) | ((self.b[self.p >> 3] >> (7 - (self.p & 7))) & 1); self.p += 1
        return v
    def s(self, n):
        v = self.u(n); return v - (1 << n) if v & (1 << (n - 1)) else v

class LvFont:
    def __init__(self, data):
        self.d = data; self.tables = {}; off = 0
        while off + 8 <= len(data):
            ln, tag = struct.unpack("<I4s", data[off:off+8])
            if ln < 8: break
            self.tables[tag.decode()] = (off, ln); off += ln
        h = data[self.tables["head"][0]+8:]
        (self.version, self.ntables, self.size, self.ascent, self.descent, self.typo_asc, self.typo_desc,
         self.line_gap, self.min_y, self.max_y, self.def_adv, self.kern_scale) = struct.unpack("<IHHHhhhhhhHH", h[:26])
        (self.loca_fmt, self.gid_fmt, self.adv_fmt, self.bpp, self.xy_bits, self.wh_bits, self.adv_bits,
         self.compression) = h[26:34]
        co = self.tables["cmap"][0]
        n = struct.unpack("<I", data[co+8:co+12])[0]
        self.cmap = []
        # actual layout: u32 data_offset, u32 range_start, u16 range_len, u16 glyph_id_start, u16 entries_count, u8 type, u8 pad
        e = co + 12
        for i in range(n):
            dofs, st, rl, gs, cnt, typ = struct.unpack("<IIHHHBx", data[e:e+16]); e += 16
            self.cmap.append(dict(data_offset=dofs, start=st, length=rl, gid_start=gs, count=cnt, type=typ))
        lo = self.tables["loca"][0]
        self.nglyphs = struct.unpack("<I", data[lo+8:lo+12])[0]
        fmt = "<I" if self.loca_fmt else "<H"; w = 4 if self.loca_fmt else 2
        self.loca = [struct.unpack(fmt, data[lo+12+i*w:lo+12+i*w+w])[0] for i in range(self.nglyphs)]
        self.glyf = self.tables["glyf"][0]

    def gid(self, cp):
        co = self.tables["cmap"][0]
        for c in self.cmap:
            if c["start"] <= cp < c["start"] + c["length"]:
                rel = cp - c["start"]; base = co + c["data_offset"]
                if c["type"] == 2: return c["gid_start"] + rel           # format0 tiny
                if c["type"] == 0: return c["gid_start"] + self.d[base + rel]  # format0 full
                cps = [struct.unpack("<H", self.d[base+2*i:base+2*i+2])[0] for i in range(c["count"])]
                if rel not in cps: return 0
                i = cps.index(rel)
                if c["type"] == 3: return c["gid_start"] + i              # sparse tiny
                return c["gid_start"] + struct.unpack("<H", self.d[base+2*c["count"]+2*i:base+2*c["count"]+2*i+2])[0]
        return 0

    def glyph(self, g):
        start = self.glyf + self.loca[g]
        end = self.glyf + (self.loca[g+1] if g + 1 < self.nglyphs else self.tables["glyf"][1])
        b = Bits(self.d[:end], start * 8)
        adv = b.u(self.adv_bits) * (16 if self.adv_fmt == 0 else 1)
        x, y = b.s(self.xy_bits), b.s(self.xy_bits)
        w, h = b.u(self.wh_bits), b.u(self.wh_bits)
        px = self._bitmap(b, w, h)
        return dict(adv=adv, x=x, y=y, w=w, h=h, px=px, nbytes=end - start)

    def _bitmap(self, b, w, h):
        bpp = self.bpp
        if self.compression == 0:
            return [[b.u(bpp) for _ in range(w)] for _ in range(h)]
        st = dict(state=0, prev=0, cnt=0, first=True)
        def nxt():
            if st["state"] == 0:
                r = b.u(bpp)
                if not st["first"] and st["prev"] == r: st["cnt"] = 0; st["state"] = 1
                st["first"] = False; st["prev"] = r; return r
            if st["state"] == 1:
                v = b.u(1); st["cnt"] += 1
                if v == 1:
                    r = st["prev"]
                    if st["cnt"] == 11:
                        st["cnt"] = b.u(6)
                        st["state"] = 2 if st["cnt"] != 0 else 0
                        if st["cnt"] == 0: r = b.u(bpp); st["prev"] = r
                    return r
                r = b.u(bpp); st["prev"] = r; st["state"] = 0; return r
            r = st["prev"]; st["cnt"] -= 1
            if st["cnt"] == 0: r = b.u(bpp); st["prev"] = r; st["state"] = 0
            return r
        rows, prev = [], [0] * w
        for _ in range(h):
            line = [nxt() for _ in range(w)]
            if self.compression == 1: line = [a ^ p for a, p in zip(line, prev)]
            rows.append(line); prev = line
        return rows


class BitWriter:
    def __init__(self): self.bits = []
    def u(self, v, n):
        for i in range(n - 1, -1, -1): self.bits.append((v >> i) & 1)
    def s(self, v, n): self.u(v & ((1 << n) - 1), n)
    def bytes(self):
        b = self.bits + [0] * (-len(self.bits) % 8)
        return bytes(int("".join(map(str, b[i:i+8])), 2) for i in range(0, len(b), 8))


def encode_glyph(font, adv, x, y, w, h, px):
    """Encode one glyph with the font's bit widths, RLE + XOR prefilter (LVGL semantics)."""
    bw = BitWriter()
    bw.u(adv if font.adv_fmt == 1 else adv // 16, font.adv_bits)
    bw.s(x, font.xy_bits); bw.s(y, font.xy_bits); bw.u(w, font.wh_bits); bw.u(h, font.wh_bits)
    bpp = font.bpp
    vals, prev = [], [0] * w
    for row in px:
        vals += [a ^ p for a, p in zip(row, prev)] if font.compression == 1 else list(row)
        prev = row
    if font.compression == 0:
        for v in vals: bw.u(v, bpp)
        return bw.bytes()
    # RLE mirroring the decoder state machine exactly
    i, n, first, prevv = 0, len(vals), True, None
    while i < n:
        v = vals[i]; bw.u(v, bpp); i += 1
        repeat = (not first) and v == prevv
        first = False; prevv = v
        if not repeat: continue
        # REPEAT state: count further equal pixels
        r = 0
        while i + r < n and vals[i + r] == prevv: r += 1
        if r < 10:
            for _ in range(r): bw.u(1, 1)
            i += r
            bw.u(0, 1)   # terminator bit (written even at end of stream, like lv_font_conv)
            if i < n:  # then literal (literal not checked for repeat)
                bw.u(vals[i], bpp); prevv = vals[i]; i += 1
            continue
        # counter path: 11 one-bits + 6-bit C encode (10 + C) repeats, then a literal
        R = min(r - 10, 63)
        for _ in range(11): bw.u(1, 1)
        bw.u(R, 6); i += 10 + R
        if i < n:
            bw.u(vals[i], bpp); prevv = vals[i]; i += 1
    return bw.bytes()
