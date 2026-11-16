// What the UI needs from the watch, behind one interface so the screens can be driven by the
// real Bluetooth code or by a demo (open the page with ?demo).
import { type Phase, WatchClient } from "../ble/client";

export type WatchInfo = { name: string; firmware: string };
export type Progress = { pct: number; sent: number };

export interface WatchLink {
  /** True when nothing is really sent to a watch (the demo). */
  readonly simulated: boolean;
  /** Must be called straight from a click: the browser opens its device picker. */
  connect(opts: { showAll: boolean; onPhase: (p: Phase) => void; log: (m: string) => void }): Promise<WatchInfo>;
  /** Send this image to the watch. `langs` is empty when restoring the official firmware. */
  install(opts: { image: Blob; langs: string[]; onProgress: (p: Progress) => void; signal: AbortSignal }): Promise<void>;
  /** Waits for the watch to install the update and restart, then returns its firmware version. */
  waitForRestart(signal: AbortSignal, onStatus: (m: string) => void): Promise<string>;
  disconnect(): void;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Cancelled", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Cancelled", "AbortError")); }, { once: true });
  });

/** Version bytes for FW init 2: the watch's own version; in upgrade mode it reports 0.x.y.z, use 1.x.y.z. */
const initVersion = (v: string) => {
  const n = v.split(".").map(Number);
  return n[0] === 0 ? [1, ...n.slice(1)] : n;
};

export class BluetoothWatch implements WatchLink {
  readonly simulated = false;
  private client: WatchClient | null = null;
  private log: (m: string) => void = () => {};

  async connect({ showAll, onPhase, log }: Parameters<WatchLink["connect"]>[0]) {
    this.client?.disconnect();
    this.log = log;
    this.client = await WatchClient.request(showAll, log);
    this.client.onPhase = onPhase;
    try {
      return await this.session();
    } finally {
      this.client.disconnect(); // nothing stays connected until the install starts
    }
  }

  private async session(): Promise<WatchInfo> {
    const c = this.client!;
    if (!c.connected) await c.connect();
    await c.authenticate();
    return { name: c.name, firmware: await c.firmwareVersion() };
  }

  async install({ image, onProgress, signal }: Parameters<WatchLink["install"]>[0]) {
    const c = this.client;
    if (!c) throw new Error("connect the watch first");
    const info = await this.session();
    this.log(`watch runs ${info.firmware}`);
    await c.flash(new Uint8Array(await image.arrayBuffer()), initVersion(info.firmware),
      (pct, sent) => onProgress({ pct, sent }), signal);
    c.disconnect();
  }

  async waitForRestart(signal: AbortSignal, onStatus: (m: string) => void) {
    // Same timing as tools/patch.py: give it two minutes, then try a few times a minute apart.
    onStatus("installing");
    await sleep(120_000, signal);
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        onStatus(`checking the watch (try ${attempt} of 5)`);
        const info = await this.session();
        this.log(`after the install the watch runs ${info.firmware}`);
        return info.firmware;
      } catch (e) {
        this.log(`watch not ready yet: ${e instanceof Error ? e.message : String(e)}`);
        this.client?.disconnect();
        await sleep(60_000, signal);
      } finally {
        this.client?.disconnect();
      }
    }
    throw new Error("couldn’t reach the watch after the install");
  }

  disconnect() { this.client?.disconnect(); }
}

export class DemoWatch implements WatchLink {
  readonly simulated = true;
  constructor(private firmware = "1.0.1.77") {}

  async connect({ onPhase, log }: Parameters<WatchLink["connect"]>[0]) {
    log("demo: no Bluetooth is used");
    onPhase("connecting");
    await sleep(1800);
    onPhase("pairing");
    await sleep(2200);
    return { name: "CMF Watch 3 Pro-4F2A", firmware: this.firmware };
  }

  async install({ image, onProgress, signal }: Parameters<WatchLink["install"]>[0]) {
    for (let pct = 0; pct <= 100; pct++) {
      onProgress({ pct, sent: ((image.size || 45e6) * pct) / 100 });
      await sleep(90, signal);
    }
  }

  async waitForRestart(signal: AbortSignal, onStatus: (m: string) => void) {
    onStatus("installing");
    await sleep(2600, signal);
    return this.firmware.startsWith("0.") ? "1.0.1.77" : this.firmware;
  }

  disconnect() {}
}
