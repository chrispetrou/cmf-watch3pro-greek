// Stage 1 spike: check that a browser can connect, pair and read the watch's firmware version.
// Nothing is written to the watch's storage. The real UI comes later, from the design mockup.
import { useRef, useState } from "react";
import { WatchClient, forgetKey, loadKey, webBluetoothAvailable } from "./ble/client";

type Status = "idle" | "busy" | "done" | "error";

export default function App() {
  const [showAll, setShowAll] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(() => loadKey() !== null);
  const [lines, setLines] = useState<string[]>([]);
  const client = useRef<WatchClient | null>(null);

  const log = (msg: string) => {
    const t = new Date().toLocaleTimeString([], { hour12: false });
    setLines((l) => [...l, `[${t}] ${msg}`]);
  };

  async function run() {
    setStatus("busy");
    setVersion(null);
    setLines([]);
    try {
      const c = client.current ?? (await WatchClient.request(showAll, log));
      client.current = c;
      await c.connect();
      await c.authenticate();
      setHasKey(loadKey() !== null);
      const v = await c.firmwareVersion();
      log(`firmware version: ${v}`);
      setVersion(v);
      setStatus("done");
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      log(`error: ${msg}`);
      setStatus("error");
    } finally {
      client.current?.disconnect();
    }
  }

  function chooseAnother() {
    client.current?.disconnect();
    client.current = null;
  }

  if (!webBluetoothAvailable()) {
    return (
      <main className="mx-auto max-w-xl px-4 py-12">
        <h1 className="text-2xl font-semibold">Web Bluetooth isn't available</h1>
        <p className="mt-3 text-neutral-400">
          Open this page in Chrome or Edge on a computer or Android phone. Safari, Firefox and
          iPhones don't support Web Bluetooth. The page must be served over https or from localhost.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <p className="font-mono text-xs uppercase tracking-widest text-red-500">Stage 1 · test page</p>
      <h1 className="mt-2 text-2xl font-semibold">Connect to the watch</h1>
      <p className="mt-3 text-neutral-400">
        Connects over Bluetooth, pairs and reads the firmware version. Nothing is written to the watch.
      </p>

      <ol className="mt-6 list-decimal space-y-1 pl-5 text-sm text-neutral-300">
        <li>Turn off Bluetooth on your phone so the watch isn't connected to it.</li>
        <li>Keep the watch next to this computer, screen on.</li>
        <li>Press Connect and pick the watch from the list.</li>
      </ol>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          onClick={run}
          disabled={status === "busy"}
          className="rounded-full bg-neutral-100 px-6 py-2.5 font-medium text-neutral-950 transition hover:bg-white disabled:opacity-40"
        >
          {status === "busy" ? "Working…" : "Connect"}
        </button>
        <label className="flex items-center gap-2 text-sm text-neutral-400">
          <input type="checkbox" checked={showAll} onChange={(e) => { setShowAll(e.target.checked); chooseAnother(); }} />
          Show all Bluetooth devices
        </label>
      </div>

      {version && (
        <div className="mt-6 rounded-2xl border border-neutral-800 p-5">
          <p className="text-sm text-neutral-400">The watch runs</p>
          <p className="mt-1 font-mono text-3xl">{version}</p>
        </div>
      )}

      <div className="mt-6 flex gap-4 text-sm text-neutral-500">
        {client.current && status !== "busy" && (
          <button className="underline" onClick={chooseAnother}>Choose another device</button>
        )}
        {hasKey && status !== "busy" && (
          <button className="underline" onClick={() => { forgetKey(); setHasKey(false); }}>
            Forget the pairing key
          </button>
        )}
      </div>

      {lines.length > 0 && (
        <pre className="mt-6 max-h-80 overflow-auto rounded-xl bg-neutral-900 p-4 font-mono text-xs leading-relaxed text-neutral-300">
          {lines.join("\n")}
        </pre>
      )}

      <p className="mt-10 text-xs text-neutral-600">
        If the watch was paired fresh, pair it with Nothing X on the phone again afterwards.
      </p>
    </main>
  );
}
