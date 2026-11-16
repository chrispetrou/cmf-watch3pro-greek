"""Print protocol test vectors from tools/cmf_ble.py, so the TypeScript port is checked
against the Python code that has flashed real watches. Run with: npm run vectors"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools"))
import cmf_ble as P  # noqa: E402

KEY = bytes(range(16))
CASES = [
    ("version get", P.FIRMWARE_VERSION_GET, bytes([P.A5]), 180),
    ("phone name", P.AUTH_PHONE_NAME, bytes([P.A5]) + b"WebFlasher", 180),
    ("empty", P.AUTH_CONFIRM_REQ, b"", 180),
    ("pair request", P.AUTH_PAIR_REQUEST, bytes(range(48)), 180),
    ("encrypted, 3 chunks", P.FIRMWARE_VERSION_GET, bytes(i % 251 for i in range(300)), 180),
    ("plaintext, 3 chunks", P.FW_CHUNK_WRITE, bytes(i % 253 for i in range(400)), 180),
    ("small mtu", P.FIRMWARE_VERSION_RET, bytes([1, 0, 1, 77]) * 10, 60),
]

out = {"key": KEY.hex(), "crc32": {}, "packets": []}
for s in [b"", b"a", b"123456789", bytes(range(256))]:
    out["crc32"][s.hex()] = P.zlib.crc32(s) & 0xffffffff
for name, cmd, payload, mw in CASES:
    pkts = P.build_packets(cmd, payload, KEY, mw)
    out["packets"].append({
        "name": name, "cmd": list(cmd), "payload": payload.hex(), "maxWrite": mw,
        "packets": [p.hex() for p in pkts],
    })
print(json.dumps(out, indent=1))
