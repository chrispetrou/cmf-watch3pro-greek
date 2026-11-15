"""
CMF Watch Pro / Watch 3 Pro BLE protocol primitives.

Ported from Gadgetbridge's cmfwatchpro device support (AGPLv3):
  framing + AES-CBC crypto (CmfCharacteristic), pairing/auth and the
  firmware upload state machine (CmfWatchProSupport / CmfDataUploader).

Implements exactly the sequence Gadgetbridge uses, so it talks to the real
watch with no vendor app. Only the pieces needed to authenticate and flash
an AOTA firmware image are included.
"""
import struct
import zlib

from Crypto.Cipher import AES

# ---- BLE UUIDs -------------------------------------------------------------
UUID_CMD_READ   = "0000fff1-0000-1000-8000-00805f9b34fb"
UUID_CMD_WRITE  = "0000fff2-0000-1000-8000-00805f9b34fb"
UUID_DATA_WRITE = "02f00000-0000-0000-0000-00000000ffe1"
UUID_DATA_READ  = "02f00000-0000-0000-0000-00000000ffe2"
UUID_FW_WRITE   = "02f00000-0000-0000-0000-00000000ff01"
UUID_FW_READ    = "02f00000-0000-0000-0000-00000000ff02"
UUID_SHELL_WRITE = "77d4ff01-2fe2-2334-0d35-9ccd078f529c"
UUID_SHELL_READ  = "77d4ff02-2fe2-2334-0d35-9ccd078f529c"

READ_CHARS = [UUID_CMD_READ, UUID_DATA_READ, UUID_FW_READ, UUID_SHELL_READ]

AES_IV = bytes([0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57,
                0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x5a])
PAYLOAD_HEADER = 0xF5
A5 = 0xA5

# ---- Commands (cmd1, cmd2) -------------------------------------------------
AUTH_PAIR_REQUEST   = (0xffff, 0x8047)
AUTH_PAIR_REPLY     = (0xffff, 0x0048)
AUTH_PHONE_NAME     = (0xffff, 0x8049)
AUTH_WATCH_MAC      = (0xffff, 0x0049)
AUTH_NONCE_REQUEST  = (0xffff, 0x804b)
AUTH_NONCE_REPLY    = (0xffff, 0x004c)
AUTH_CONFIRM_REQ    = (0xffff, 0x804d)
AUTH_CONFIRM_REPLY  = (0xffff, 0x0004)
AUTH_FAILED         = (0xffff, 0xa061)
FIRMWARE_VERSION_GET = (0xffff, 0x8006)
FIRMWARE_VERSION_RET = (0xffff, 0x0006)
FW_INIT1_REQUEST = (0xffff, 0x9052)
FW_INIT1_REPLY   = (0xffff, 0xa052)
FW_INIT2_REQUEST = (0xffff, 0x9040)
FW_INIT2_REPLY   = (0xffff, 0xa040)
FW_CHUNK_REQUEST = (0xffff, 0xa042)
FW_CHUNK_WRITE   = (0xffff, 0x9042)
FW_FINISH_ACK1   = (0xffff, 0xa041)
FW_FINISH_ACK2   = (0xffff, 0x9041)

# commands sent/received in plaintext (everything else is AES-CBC)
PLAINTEXT = {AUTH_PAIR_REQUEST, AUTH_PAIR_REPLY, FW_CHUNK_WRITE,
             AUTH_FAILED,                          # error reply carries ASCII text
             (0xffff, 0x905f), (0xffff, 0x9064)}  # + agps/watchface writes


def crc32_le(data: bytes) -> bytes:
    return struct.pack("<I", zlib.crc32(data) & 0xffffffff)


def aes_encrypt(data: bytes, key: bytes) -> bytes:
    pad = 16 - (len(data) % 16)           # PKCS7
    data += bytes([pad]) * pad
    return AES.new(key, AES.MODE_CBC, AES_IV).encrypt(data)


def aes_decrypt(data: bytes, key: bytes) -> bytes:
    out = AES.new(key, AES.MODE_CBC, AES_IV).decrypt(data)
    return out[:-out[-1]]                  # strip PKCS7


class Reassembler:
    """Rebuilds framed packets arriving over one notify characteristic."""
    def __init__(self):
        self.buf = bytearray()

    def feed(self, value: bytes):
        """Yield (cmd1, cmd2, chunk_count, chunk_index, raw_payload) per packet.

        Mirrors Gadgetbridge's CmfCharacteristic.onCharacteristicChanged:
        - encrypted packets occupy exactly 11 + len bytes.
        - plaintext packets' length field over-counts by 4 (a CRC the watch
          does not actually send), so the packet occupies the rest of the
          buffer and is considered complete once len(buf) >= plen + 3.
        """
        self.buf += value
        out = []
        while True:
            if len(self.buf) < 11:
                break
            if self.buf[0] != PAYLOAD_HEADER:
                self.buf.pop(0)
                continue
            plen = struct.unpack(">H", self.buf[1:3])[0]
            cmd1, cnt, idx, cmd2 = struct.unpack(">HHHH", self.buf[3:11])
            if (cmd1, cmd2) in PLAINTEXT:
                if len(self.buf) < plen + 3:
                    break  # partial
                payload = bytes(self.buf[11:])     # take rest of this buffer
                self.buf.clear()
                out.append((cmd1, cmd2, cnt, idx, payload))
                break
            else:
                if len(self.buf) < 11 + plen:
                    break  # partial
                payload = bytes(self.buf[11:11 + plen])
                del self.buf[:11 + plen]
                out.append((cmd1, cmd2, cnt, idx, payload))
        return out


def build_packets(cmd, payload, key, max_write):
    """Frame a command into one or more BLE writes (Gadgetbridge semantics)."""
    cmd1, cmd2 = cmd
    encrypted = cmd not in PLAINTEXT
    if encrypted:
        if len(payload) == 0:
            chunks = [b""]
        else:
            max_enc = ((max_write - 11) // 16) * 16
            max_pl = max_enc - 4 - 1
            chunks = []
            for i in range(0, len(payload), max_pl):
                sub = payload[i:i + max_pl]
                chunks.append(aes_encrypt(sub + crc32_le(sub), key))
    else:
        csize = max_write - 11 - 4 - 2
        if len(payload) == 0:
            chunks = [b""]
        else:
            chunks = []
            for i in range(0, len(payload), csize):
                sub = payload[i:i + csize]
                chunks.append(sub + crc32_le(sub))
    packets = []
    n = len(chunks)
    for i, ch in enumerate(chunks):
        hdr = struct.pack(">BHHHHH", PAYLOAD_HEADER, len(ch), cmd1, n, i + 1, cmd2)
        packets.append(hdr + ch)
    return packets


def decode_payload(cmd1, cmd2, raw, key):
    """Return (ok, payload) for a received packet payload."""
    if len(raw) == 0:
        return True, b""
    if (cmd1, cmd2) in PLAINTEXT:
        return True, raw
    try:
        dec = aes_decrypt(raw, key)
    except Exception:
        return False, b""
    body, want = dec[:-4], dec[-4:]
    if crc32_le(body) != want:
        return False, b""
    return True, body
