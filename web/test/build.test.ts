import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadPyodide } from "pyodide";
import { describe, expect, it } from "vitest";

// Runs src/build/glue.py in Pyodide on the official image and checks the result is
// byte-identical to the CLI build. Needs the image in firmware/ (git-ignored).
const IMAGE = "../firmware/ORIGINAL_JX402_08_ATS3089C_V1.0.1.77.bin";
const have = existsSync(IMAGE);

const SHA = {
  greek: "763357046b88553d32cf492e9d6f8882161b96fe80720022108641caf47cf3d9",
  "georgian,greek": "e2153c6b9b7c42f78a7fcd1a4e57401a1347884a3a5f736afefddb5487fc8533",
};

describe.skipIf(!have)("in-browser build (Pyodide)", async () => {
  const py = await loadPyodide();
  py.FS.mkdirTree("/app");
  for (const f of readdirSync("../tools").filter((n) => n.endsWith(".py"))) py.FS.writeFile(`/app/${f}`, readFileSync(`../tools/${f}`, "utf8"));
  py.FS.writeFile("/app/glue.py", readFileSync("src/build/glue.py", "utf8"));
  py.runPython("import sys; sys.path.insert(0, '/app')");
  const run = py.pyimport("glue").run;
  const orig = new Uint8Array(readFileSync(IMAGE));

  for (const [langs, sha] of Object.entries(SHA)) {
    it(`matches the CLI for ${langs}`, () => {
      const list = langs.split(",");
      const docs = Object.fromEntries(list.map((l) => [l, readFileSync(`public/glyphs/${l}.json`, "utf8")]));
      const lines = [["greek", "Φτάνω σε 10 λεπτά,"], ["georgian", "ხვალ 10 საათზე"]].filter(([l]) => list.includes(l));
      const res = run(orig, py.toPy(list), py.toPy(docs), py.toPy(lines), () => {});
      const [img, ok, preview] = res.toJs() as [Uint8Array, boolean, string];
      expect(ok).toBe(true);
      expect(createHash("sha256").update(img).digest("hex")).toBe(sha);
      const p = JSON.parse(preview);
      expect(p.lines.length).toBeGreaterThan(0);
      expect(p.lines.flatMap((l: { glyphs: unknown[] }) => l.glyphs).filter((g: unknown) => g === null)).toHaveLength(0);
    }, 120000);
  }
});
