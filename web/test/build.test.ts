import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadPyodide } from "pyodide";
import { beforeAll, describe, expect, it } from "vitest";

// Runs src/build/glue.py in Pyodide on the official image and checks the result is
// byte-identical to the CLI build. Needs the image in firmware/ (git-ignored).
const IMAGE = "../firmware/ORIGINAL_JX402_08_ATS3089C_V1.0.1.77.bin";
const have = existsSync(IMAGE);

const SHA = {
  greek: "763357046b88553d32cf492e9d6f8882161b96fe80720022108641caf47cf3d9",
  "georgian,greek": "e2153c6b9b7c42f78a7fcd1a4e57401a1347884a3a5f736afefddb5487fc8533",
  armenian: "ecf7f25902fc60ddb78943ba9f180a5112fe896870e256f6071beb0c00ada6a8",
  "armenian,georgian,greek": "7a9104e4a62eeefba776fed7addbcc7a29845aa11dfb0e49084aca133f6c8479",
};

describe.skipIf(!have)("in-browser build (Pyodide)", () => {
  // Vitest still runs a skipped describe's body, so the setup lives in beforeAll.
  let run: (...args: unknown[]) => { toJs: () => unknown };
  let orig: Uint8Array;
  let py: Awaited<ReturnType<typeof loadPyodide>>;
  beforeAll(async () => {
    py = await loadPyodide();
    py.FS.mkdirTree("/app");
    for (const f of readdirSync("../tools").filter((n) => n.endsWith(".py"))) py.FS.writeFile(`/app/${f}`, readFileSync(`../tools/${f}`, "utf8"));
    py.FS.writeFile("/app/glue.py", readFileSync("src/build/glue.py", "utf8"));
    py.runPython("import sys; sys.path.insert(0, '/app')");
    run = py.pyimport("glue").run;
    orig = new Uint8Array(readFileSync(IMAGE));
  }, 60000);

  for (const [langs, sha] of Object.entries(SHA)) {
    it(`matches the CLI for ${langs}`, () => {
      const list = langs.split(",");
      const docs = Object.fromEntries(list.map((l) => [l, readFileSync(`public/glyphs/${l}.json`, "utf8")]));
      const res = run(orig, py.toPy(list), py.toPy(docs), () => {});
      const [img, ok] = res.toJs() as [Uint8Array, boolean];
      expect(ok).toBe(true);
      expect(createHash("sha256").update(img).digest("hex")).toBe(sha);
    }, 120000);
  }
});
