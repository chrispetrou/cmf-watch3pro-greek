// Builds the patched image off the main thread with Pyodide, running the same Python as the CLI.
import { loadPyodide, type PyodideInterface } from "pyodide";
import glue from "./glue.py?raw";
import buildFirmware from "../../../tools/build_firmware.py?raw";
import emojifont from "../../../tools/emojifont.py?raw";
import fetchPy from "../../../tools/fetch.py?raw";
import fontbuild from "../../../tools/fontbuild.py?raw";
import languages from "../../../tools/languages.py?raw";
import lvfont from "../../../tools/lvfont.py?raw";
import repack from "../../../tools/repack.py?raw";
import sdfs from "../../../tools/sdfs.py?raw";
import type { BuildRequest, BuildResponse } from "./types";

const MODULES: Record<string, string> = {
  "glue.py": glue, "build_firmware.py": buildFirmware, "emojifont.py": emojifont, "fetch.py": fetchPy, "fontbuild.py": fontbuild,
  "languages.py": languages, "lvfont.py": lvfont, "repack.py": repack, "sdfs.py": sdfs,
};

let ready: Promise<PyodideInterface> | null = null;
const post = (m: BuildResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

function init(indexURL: string) {
  ready ??= (async () => {
    const py = await loadPyodide({ indexURL });
    py.FS.mkdirTree("/app");
    for (const [name, src] of Object.entries(MODULES)) py.FS.writeFile(`/app/${name}`, src);
    py.runPython("import sys; sys.path.insert(0, '/app')");
    return py;
  })();
  return ready;
}

self.onmessage = async (e: MessageEvent<BuildRequest>) => {
  const { firmware, langs, glyphs, emoji, indexURL } = e.data;
  try {
    post({ type: "log", msg: "loading the build tools" });
    const py = await init(indexURL);
    const run = py.pyimport("glue").run;
    const res = run(new Uint8Array(firmware), py.toPy(langs), py.toPy(glyphs), (m: string) => post({ type: "log", msg: m }), emoji ?? null);
    const [img, ok] = res.toJs({ create_proxies: false }) as [Uint8Array, boolean];
    res.destroy?.();
    const image = img.slice().buffer;
    const sha = new Uint8Array(await crypto.subtle.digest("SHA-256", image));
    post({
      type: "done", image, versionOk: ok,
      sha256: Array.from(sha, (b) => b.toString(16).padStart(2, "0")).join(""),
    }, [image]);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
