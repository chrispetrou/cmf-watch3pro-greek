// Main-thread side of the image build: fetch the glyphs, hand everything to the worker.
import type { BuildResponse } from "./types";

export type BuildResult = { image: Blob; sha256: string; versionOk: boolean };

export async function buildImage(firmware: File, langs: string[], emoji: boolean, onLog: (m: string) => void, signal?: AbortSignal): Promise<BuildResult> {
  const load = async (path: string, what: string) => {
    const r = await fetch(new URL(path, document.baseURI), { signal });
    if (!r.ok) throw new Error(`couldn't load ${what} (${r.status})`);
    return r.text();
  };
  const glyphs: Record<string, string> = {};
  for (const lang of langs) glyphs[lang] = await load(`glyphs/${lang}.json`, `the ${lang} letters`);
  const emojiDoc = emoji ? await load("emoji.json", "the emoji") : undefined;
  const data = await firmware.arrayBuffer();
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<BuildResult>((resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")));
      worker.onerror = (e) => reject(new Error(e.message || "the build worker failed"));
      worker.onmessage = (e: MessageEvent<BuildResponse>) => {
        const m = e.data;
        if (m.type === "log") onLog(m.msg);
        else if (m.type === "error") reject(new Error(m.message));
        else resolve({ image: new Blob([m.image], { type: "application/octet-stream" }), sha256: m.sha256, versionOk: m.versionOk });
      };
      worker.postMessage({ firmware: data, langs, glyphs, emoji: emojiDoc, indexURL: new URL("pyodide/", document.baseURI).href }, [data]);
    });
  } finally {
    worker.terminate();
  }
}
