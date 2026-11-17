// Checks a firmware file the user picked, same rules as check_aota() in tools/patch.py,
// and looks up the latest official release in the Nothing Archive list.
import { crc32Update } from "../ble/protocol";

export const BOARD = "JX402_08";
const MODEL_ID = "D399"; // CMF Watch 3 Pro in the Nothing Archive data
const ARCHIVE_JSON =
  "https://raw.githubusercontent.com/spike0en/nothing_archive/main/website/src/data/accessories_updates.json";
// The archive is third-party data, so only link to Nothing's own OTA CDN.
const OFFICIAL_HOSTS = new Set(["dmen2t88o28qi.cloudfront.net"]);

// The image only carries a build stamp, the public version number is in the file name.
// Known stamps cover a renamed file.
const KNOWN_BUILDS: Record<string, string> = { "1.00_2604181507": "1.0.1.77" };

export type Release = { version: string; url: string; sizeMb?: number };

export type FirmwareCheck =
  | { ok: true; file: File; version: string; board: string; sizeMb: number }
  | { ok: false; file: File; problem: string };

export const versionFromName = (name: string) => name.match(/_V(\d+\.\d+\.\d+\.\d+)/)?.[1] ?? null;

export async function latestRelease(): Promise<Release | null> {
  try {
    const data = await (await fetch(ARCHIVE_JSON)).json();
    const e = data?.[MODEL_ID];
    if (!e || !String(e.downloadUrl).includes(BOARD)) return null;
    const url = new URL(e.downloadUrl);
    if (url.protocol !== "https:" || !OFFICIAL_HOSTS.has(url.hostname)) return null;
    if (!/^\d+(\.\d+){3}$/.test(String(e.version))) return null;
    return { version: String(e.version), url: url.href };
  } catch {
    return null;
  }
}

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

  const stamp = head.match(/<version_name>([^<]+)<\/version_name>/)?.[1] ?? "";
  const version = versionFromName(file.name) ?? KNOWN_BUILDS[stamp];
  if (!version) return bad("Can't tell the version, use the file as downloaded");
  return { ok: true, file, version, board: BOARD, sizeMb: d.length / 1e6 };
}
