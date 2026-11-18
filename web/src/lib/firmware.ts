// Checks a firmware file the user picked: same structure checks as check_aota() in tools/patch.py,
// then the SHA-256 must match an official release listed below. The watch doesn't check signatures,
// so this is what keeps the app from building on, or installing, anything but Nothing's own files.
import { crc32Update } from "../ble/protocol";

export const BOARD = "JX402_08";

// Nothing's official releases this app supports. To add one: put its SHA-256 here and in
// firmware/SHA256SUMS, with the download link from Nothing's CDN (see docs/updating.md).
// Keep the newest last; the download button links to it.
export const OFFICIAL = [
  {
    version: "1.0.1.77",
    sha256: "cf381188eb5fe26a14047a03697e68b58785bdcd01c4baf8703d4624650c6352",
    url: "https://dmen2t88o28qi.cloudfront.net/ota/1779242269230JX402_08_ATS3089C_V1.0.1.77_GPS_V6_20260418.bin",
  },
] as const;

export const LATEST = OFFICIAL[OFFICIAL.length - 1];

export type FirmwareCheck =
  | { ok: true; file: File; version: string; board: string; sizeMb: number }
  | { ok: false; file: File; problem: string };

const u32 = (d: Uint8Array, o: number) => new DataView(d.buffer, d.byteOffset).getUint32(o, true);

export async function checkFirmware(file: File, onProgress: (pct: number) => void): Promise<FirmwareCheck> {
  const bad = (problem: string): FirmwareCheck => ({ ok: false, file, problem });
  if (file.size < 0x1000 || file.size > 64e6) return bad("Not a watch update");
  const d = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...d.subarray(0, 4)) !== "AOTA") return bad("Not a watch update");
  if (u32(d, 0x14) !== d.length) return bad("The file is incomplete");
  const head = new TextDecoder("latin1").decode(d.subarray(0, 0x1000));
  if (!head.toUpperCase().includes(BOARD)) return bad("Made for a different watch");

  // CRC32 over ~45 MB, in slices so the progress bar moves.
  if (crc32Update(0, d.subarray(8, 0x400)) !== u32(d, 4)) return bad("The file is damaged");
  let crc = 0;
  const step = 1 << 20;
  for (let o = 0x400; o < d.length; o += step) {
    crc = crc32Update(crc, d.subarray(o, Math.min(d.length, o + step)));
    onProgress(Math.round(((o - 0x400) / (d.length - 0x400)) * 100));
    await new Promise((r) => setTimeout(r));
  }
  if (crc !== u32(d, 0x18)) return bad("The file is damaged");
  onProgress(100);

  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", d));
  const sha256 = Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
  const release = OFFICIAL.find((r) => r.sha256 === sha256);
  if (!release) return bad("Not an official release this app knows");
  const version = release.version;
  return { ok: true, file, version, board: BOARD, sizeMb: d.length / 1e6 };
}
