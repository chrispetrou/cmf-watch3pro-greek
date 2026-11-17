"""Rebuild an LVGL bin font: optionally drop codepoint ranges and append new glyphs."""
import struct
from lvfont import encode_glyph


def _chunk(tag, payload):
    payload += b"\0" * (-len(payload) % 4)
    return struct.pack("<I4s", 8 + len(payload), tag) + payload


def cmap_blob(f, c):
    """Raw subtable data for a cmap entry (codepoint/gid arrays)."""
    base = f.tables["cmap"][0] + c["data_offset"]
    t = c["type"]
    if t == 2: return b""
    if t == 0: return f.d[base:base + c["length"]]
    if t == 3: return f.d[base:base + 2 * c["count"]]
    if t == 1: return f.d[base:base + 4 * c["count"]]
    raise ValueError(t)


def _split_around(entries, e, cp):
    """Split sparse-tiny entry e so that cp lies outside it. The watch only reads the cmap
    entry types the stock font uses (contiguous and sparse-tiny), so a new codepoint inside a
    sparse range gets its own run between the two halves instead of being merged in."""
    if e["type"] != 3: raise ValueError(f"cannot split cmap entry type {e['type']}")
    n, end = e["count"], e["start"] + e["length"]
    cps = [e["start"] + struct.unpack_from("<H", e["blob"], 2 * i)[0] for i in range(n)]
    left = [c for c in cps if c < cp]
    right = [c for c in cps if c > cp]
    i = entries.index(e)
    parts = []
    for part, gid0, lo, hi in ((left, e["gid_start"], e["start"], cp), (right, e["gid_start"] + len(left), cp + 1, end)):
        if not part: continue
        lo = part[0] if part is right else lo
        parts.append(dict(start=lo, length=hi - lo, gid_start=gid0, count=len(part), type=3,
                          blob=b"".join(struct.pack("<H", c - lo) for c in part)))
    entries[i:i + 1] = parts


def build(f, drop=lambda cp_start: False, add=()):
    """
    f    : LvFont (original)
    drop : predicate on a cmap entry's range start -> drop the whole entry and its glyphs
    add  : list of (codepoint, adv, x, y, w, h, px) to append, codepoints must be new
    """
    # 1. decide which glyph ids survive
    dropped_entries = [c for c in f.cmap if drop(c["start"])]
    dead = set()
    for c in dropped_entries:
        if c["type"] != 2: raise ValueError("only contiguous (type 2) entries can be dropped")
        dead.update(range(c["gid_start"], c["gid_start"] + c["length"]))
    keep = [g for g in range(f.nglyphs) if g not in dead]
    remap = {old: new for new, old in enumerate(keep)}

    # 2. glyph data in new order, then appended glyphs
    gl = f.glyf
    raw = []
    for g in keep:
        s = gl + f.loca[g]
        e = gl + (f.loca[g + 1] if g + 1 < f.nglyphs else f.tables["glyf"][1])
        raw.append(f.d[s:e])
    # The last glyph's slice runs to the end of the chunk and includes its padding,
    # so re-encode it to get the exact bytes (_chunk pads again).
    if keep and keep[-1] == f.nglyphs - 1:
        G = f.glyph(f.nglyphs - 1)
        raw[-1] = encode_glyph(f, G["adv"], G["x"], G["y"], G["w"], G["h"], G["px"])
    new_cps = []
    for cp, adv, x, y, w, h, px in add:
        new_cps.append((cp, len(raw)))
        raw.append(encode_glyph(f, adv, x, y, w, h, px))

    loca, off = [], 8
    for r in raw:
        loca.append(off); off += len(r)
    glyf = _chunk(b"glyf", b"".join(raw))
    loca_c = _chunk(b"loca", struct.pack("<I", len(raw)) + b"".join(struct.pack("<I", o) for o in loca))

    # 3. cmap: surviving entries (gid_start remapped) + new contiguous runs
    entries = []
    for c in f.cmap:
        if c in dropped_entries: continue
        e = dict(c); e["gid_start"] = remap[c["gid_start"]]; e["blob"] = cmap_blob(f, c)
        entries.append(e)
    # The lookup stops at the first cmap entry whose range holds the codepoint, so a range
    # that would hide a new codepoint is split around it.
    for cp, _ in new_cps:
        host = next((e for e in entries if e["start"] <= cp < e["start"] + e["length"]), None)
        if host is not None:
            _split_around(entries, host, cp)
    runs = []
    for cp, gid in sorted(new_cps):
        if runs and cp == runs[-1]["start"] + runs[-1]["length"] and gid == runs[-1]["gid_start"] + runs[-1]["length"]:
            runs[-1]["length"] += 1; runs[-1]["count"] += 1
        else:
            runs.append(dict(start=cp, length=1, gid_start=gid, count=1, type=2, blob=b""))
    entries = sorted(entries + runs, key=lambda e: e["start"])
    hdr_len = 12 + 16 * len(entries)
    data, ents = b"", b""
    for e in entries:
        ofs = hdr_len + len(data)
        data += e["blob"]; data += b"\0" * (-len(data) % 4) if e["blob"] else b""
        ents += struct.pack("<IIHHHBx", ofs, e["start"], e["length"], e["gid_start"], e["count"], e["type"])
    cmap_c = _chunk(b"cmap", struct.pack("<I", len(entries)) + ents + data)

    # 4. kern (format 0: sorted pairs of u16 gids + i8 values)
    ko, kl = f.tables["kern"]
    k = f.d[ko + 8:ko + kl]
    fmt = k[0]
    if fmt != 0: raise ValueError("kern format %d unsupported" % fmt)
    n = struct.unpack("<I", k[4:8])[0]
    pairs = [struct.unpack("<HH", k[8 + 4 * i:12 + 4 * i]) for i in range(n)]
    vals = k[8 + 4 * n:8 + 5 * n]
    kp = [((remap[a], remap[b]), v) for (a, b), v in zip(pairs, vals) if a in remap and b in remap]
    kern_c = _chunk(b"kern", k[:4] + struct.pack("<I", len(kp)) +
                    b"".join(struct.pack("<HH", *p) for p, _ in kp) + bytes(v for _, v in kp))

    head_o, head_l = f.tables["head"]
    head_c = f.d[head_o:head_o + head_l]
    return head_c + cmap_c + loca_c + glyf + kern_c
