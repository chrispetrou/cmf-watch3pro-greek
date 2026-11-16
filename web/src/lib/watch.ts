// What the UI needs from the watch, behind one interface so the screens can be driven by the
// real Bluetooth code or by a demo (open the page with ?demo).
// Connecting and reading the version is real. Building the patched image and sending it are
// simulated until stages 2 and 3 land.
import { type Phase, WatchClient } from "../ble/client";

export type WatchInfo = { name: string; firmware: string };
export type Progress = { pct: number; sent: number; total: number };

export interface WatchLink {
  /** True while installing is only simulated. */
  readonly simulated: boolean;
  /** Must be called straight from a click: the browser opens its device picker. */
  connect(opts: { showAll: boolean; onPhase: (p: Phase) => void; log: (m: string) => void }): Promise<WatchInfo>;
  /** Build the image with these languages (none = official, unchanged) and send it. */
  install(opts: { firmware: File; langs: string[]; onProgress: (p: Progress) => void; signal: AbortSignal }): Promise<void>;
  /** Resolves once the watch has installed the update and restarted. */
  waitForRestart(signal: AbortSignal): Promise<void>;
  disconnect(): void;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Cancelled", "AbortError")); });
  });

async function simulateTransfer(firmware: File, onProgress: (p: Progress) => void, signal: AbortSignal, from = 0) {
  for (let pct = from; pct <= 100; pct++) {
    onProgress({ pct, sent: (firmware.size * pct) / 100, total: firmware.size });
    await sleep(90, signal);
  }
}

export class BluetoothWatch implements WatchLink {
  readonly simulated = true;
  private client: WatchClient | null = null;

  async connect({ showAll, onPhase, log }: Parameters<WatchLink["connect"]>[0]) {
    this.client?.disconnect();
    this.client = await WatchClient.request(showAll, log);
    this.client.onPhase = onPhase;
    try {
      await this.client.connect();
      await this.client.authenticate();
      return { name: this.client.name, firmware: await this.client.firmwareVersion() };
    } finally {
      this.client.disconnect(); // read-only for now, nothing stays connected
    }
  }

  install({ firmware, onProgress, signal }: Parameters<WatchLink["install"]>[0]) {
    return simulateTransfer(firmware, onProgress, signal);
  }

  waitForRestart(signal: AbortSignal) { return sleep(2600, signal); }

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
    return { name: "CMF Watch 3 Pro 4F2A", firmware: this.firmware };
  }

  install({ firmware, onProgress, signal }: Parameters<WatchLink["install"]>[0]) {
    return simulateTransfer(firmware, onProgress, signal);
  }

  waitForRestart(signal: AbortSignal) { return sleep(2600, signal); }

  disconnect() {}
}
