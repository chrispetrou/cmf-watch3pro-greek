// CMF Watch 3 Pro BLE protocol primitives, ported from tools/cmf_ble.py
// (itself a port of Gadgetbridge's cmfwatchpro support, AGPLv3).
// Framing, AES-CBC with a fixed IV and CRC32, all on WebCrypto.

export const UUID = {
  serviceCmd: "0000fff0-0000-1000-8000-00805f9b34fb",
  cmdRead: "0000fff1-0000-1000-8000-00805f9b34fb",
  cmdWrite: "0000fff2-0000-1000-8000-00805f9b34fb",
  serviceData: "02f00000-0000-0000-0000-00000000ffe0",
  dataWrite: "02f00000-0000-0000-0000-00000000ffe1",
  dataRead: "02f00000-0000-0000-0000-00000000ffe2",
  serviceFw: "02f00000-0000-0000-0000-00000000fe00",
  fwWrite: "02f00000-0000-0000-0000-00000000ff01",
  fwRead: "02f00000-0000-0000-0000-00000000ff02",
  serviceShell: "77d4e67c-2fe2-2334-0d35-9ccd078f529c",
  shellWrite: "77d4ff01-2fe2-2334-0d35-9ccd078f529c",
  shellRead: "77d4ff02-2fe2-2334-0d35-9ccd078f529c",
  // Subscribing to ffd2 makes macOS set up link encryption (see cmf_client.py).
  serviceFfd0: "0000ffd0-0000-1000-8000-00805f9b34fb",
  ffd2: "0000ffd2-0000-1000-8000-00805f9b34fb",
} as const;

export const OPTIONAL_SERVICES = [
  UUID.serviceCmd, UUID.serviceData, UUID.serviceFw, UUID.serviceShell, UUID.serviceFfd0,
];

export const AES_IV = new Uint8Array([
  0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57,
  0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x5a,
]);
export const PAYLOAD_HEADER = 0xf5;
export const A5 = 0xa5;

export type Cmd = readonly [number, number];
// Plain ArrayBuffer-backed bytes, which is what WebCrypto and Web Bluetooth accept.
export type Bytes = Uint8Array<ArrayBuffer>;

export const CMD = {
  AUTH_PAIR_REQUEST: [0xffff, 0x8047],
  AUTH_PAIR_REPLY: [0xffff, 0x0048],
  AUTH_PHONE_NAME: [0xffff, 0x8049],
  AUTH_WATCH_MAC: [0xffff, 0x0049],
  AUTH_NONCE_REQUEST: [0xffff, 0x804b],
  AUTH_NONCE_REPLY: [0xffff, 0x004c],
  AUTH_CONFIRM_REQ: [0xffff, 0x804d],
  AUTH_CONFIRM_REPLY: [0xffff, 0x0004],
  AUTH_FAILED: [0xffff, 0xa061],
  FIRMWARE_VERSION_GET: [0xffff, 0x8006],
  FIRMWARE_VERSION_RET: [0xffff, 0x0006],
  FW_INIT1_REQUEST: [0xffff, 0x9052],
  FW_INIT1_REPLY: [0xffff, 0xa052],
  FW_INIT2_REQUEST: [0xffff, 0x9040],
  FW_INIT2_REPLY: [0xffff, 0xa040],
  FW_CHUNK_REQUEST: [0xffff, 0xa042],
  FW_CHUNK_WRITE: [0xffff, 0x9042],
  FW_FINISH_ACK1: [0xffff, 0xa041],
  FW_FINISH_ACK2: [0xffff, 0x9041],
} as const satisfies Record<string, Cmd>;

const key = (c1: number, c2: number) => (c1 << 16) | c2;
export const sameCmd = (a: Cmd, b: Cmd) => a[0] === b[0] && a[1] === b[1];

// Commands sent and received in plaintext, everything else is AES-CBC.
const PLAINTEXT = new Set([
  key(...CMD.AUTH_PAIR_REQUEST), key(...CMD.AUTH_PAIR_REPLY), key(...CMD.FW_CHUNK_WRITE),
  key(...CMD.AUTH_FAILED), key(0xffff, 0x905f), key(0xffff, 0x9064),
]);
export const isPlaintext = (c1: number, c2: number) => PLAINTEXT.has(key(c1, c2));

// ---------------------------------------------------------------- bytes
export const concat = (...parts: Bytes[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
export const hex = (b: Bytes) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));
export const ascii = (s: string) => new TextEncoder().encode(s);
const eq = (a: Bytes, b: Bytes) => a.length === b.length && a.every((x, i) => x === b[i]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** zlib.crc32(data, prev): continue a CRC over more data. */
export function crc32Update(prev: number, data: Uint8Array): number {
  let c = (prev ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const crc32 = (data: Uint8Array) => crc32Update(0, data);

export const crc32le = (data: Bytes) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, crc32(data), true);
  return out;
};

// ---------------------------------------------------------------- crypto
const importKey = (k: Bytes) =>
  crypto.subtle.importKey("raw", k, { name: "AES-CBC" }, false, ["encrypt", "decrypt"]);

// WebCrypto's AES-CBC always uses PKCS7 padding, same as cmf_ble.py.
export async function aesEncrypt(data: Bytes, k: Bytes) {
  return new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: AES_IV }, await importKey(k), data));
}

export async function aesDecrypt(data: Bytes, k: Bytes) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: AES_IV }, await importKey(k), data));
}

export const sha256 = async (...parts: Bytes[]) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", concat(...parts)));

// ---------------------------------------------------------------- framing
export type Packet = { cmd1: number; cmd2: number; count: number; index: number; raw: Bytes };

/** Rebuilds framed packets arriving over one notify characteristic (see cmf_ble.Reassembler). */
export class Reassembler {
  private buf = new Uint8Array(0);

  feed(value: Bytes): Packet[] {
    this.buf = concat(this.buf, value);
    const out: Packet[] = [];
    while (this.buf.length >= 11) {
      if (this.buf[0] !== PAYLOAD_HEADER) {
        this.buf = this.buf.slice(1);
        continue;
      }
      const v = new DataView(this.buf.buffer, this.buf.byteOffset);
      const plen = v.getUint16(1);
      const cmd1 = v.getUint16(3), count = v.getUint16(5), index = v.getUint16(7), cmd2 = v.getUint16(9);
      if (isPlaintext(cmd1, cmd2)) {
        // The length field over-counts by 4, so a plaintext packet takes the rest of the buffer.
        if (this.buf.length < plen + 3) break;
        out.push({ cmd1, cmd2, count, index, raw: this.buf.slice(11) });
        this.buf = new Uint8Array(0);
        break;
      }
      if (this.buf.length < 11 + plen) break;
      out.push({ cmd1, cmd2, count, index, raw: this.buf.slice(11, 11 + plen) });
      this.buf = this.buf.slice(11 + plen);
    }
    return out;
  }
}

/** Frame a command into one or more BLE writes (see cmf_ble.build_packets). */
export async function buildPackets(cmd: Cmd, payload: Bytes, k: Bytes | null, maxWrite: number) {
  const [cmd1, cmd2] = cmd;
  const chunks: Bytes[] = [];
  if (payload.length === 0) {
    chunks.push(new Uint8Array(0));
  } else if (!isPlaintext(cmd1, cmd2)) {
    if (!k) throw new Error("no session key for an encrypted command");
    const maxPl = Math.floor((maxWrite - 11) / 16) * 16 - 4 - 1;
    for (let i = 0; i < payload.length; i += maxPl) {
      const sub = payload.slice(i, i + maxPl);
      chunks.push(await aesEncrypt(concat(sub, crc32le(sub)), k));
    }
  } else {
    const size = maxWrite - 11 - 4 - 2;
    for (let i = 0; i < payload.length; i += size) {
      const sub = payload.slice(i, i + size);
      chunks.push(concat(sub, crc32le(sub)));
    }
  }
  return chunks.map((ch, i) => {
    const hdr = new Uint8Array(11);
    const v = new DataView(hdr.buffer);
    v.setUint8(0, PAYLOAD_HEADER);
    v.setUint16(1, ch.length);
    v.setUint16(3, cmd1);
    v.setUint16(5, chunks.length);
    v.setUint16(7, i + 1);
    v.setUint16(9, cmd2);
    return concat(hdr, ch);
  });
}

/** Decrypt and check a received payload; null if it doesn't verify. */
export async function decodePayload(cmd1: number, cmd2: number, raw: Bytes, k: Bytes | null) {
  if (raw.length === 0) return new Uint8Array(0);
  if (isPlaintext(cmd1, cmd2)) return raw;
  if (!k) return null;
  let dec: Bytes;
  try {
    dec = await aesDecrypt(raw, k);
  } catch {
    return null;
  }
  const body = dec.slice(0, -4);
  return eq(crc32le(body), dec.slice(-4)) ? body : null;
}

export { eq as bytesEqual };
