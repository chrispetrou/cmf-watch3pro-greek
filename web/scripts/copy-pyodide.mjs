// Copy Pyodide's runtime next to the app (public/pyodide/), so it's served from our own site
// instead of a CDN. Runs before dev and build.
import { copyFileSync, mkdirSync } from "node:fs";

const FILES = ["pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];
mkdirSync("public/pyodide", { recursive: true });
for (const f of FILES) copyFileSync(`node_modules/pyodide/${f}`, `public/pyodide/${f}`);
