# Web app (work in progress)

A browser version of the tools, so people can add a language to their watch without a terminal.
It follows the wizard in the design handoff: choose languages, add the official firmware file,
connect the watch, install.

What's real so far:

- checking the firmware file (same checks as `tools/patch.py`: AOTA header, CRCs, board, version);
- the download link, from the Nothing Archive list (Nothing's CDN doesn't allow the browser to
  fetch the file itself, so the user downloads it);
- connecting, pairing and reading the watch's firmware version over Web Bluetooth;
- building the patched image, in a Web Worker with [Pyodide](https://pyodide.org). It runs the
  same Python as the command-line tool (`tools/build_firmware.py`), so the result is byte for byte
  the same, and shows a preview drawn from the new image's own font. The image can be downloaded
  and flashed with the CLI.

Sending the image to the watch is **simulated**: the page says so in a banner and nothing is
written to the watch.

Needs Chrome or Edge on a computer or Android phone (no Safari, Firefox or iPhone), and Node 22.

```bash
cd web
nvm use        # Node 22, from .nvmrc
npm install
npm run dev    # http://localhost:5173
npm test       # protocol vectors, firmware checks, Pyodide build vs the CLI's sha256
```

Open `http://localhost:5173/?demo` to click through every screen without a watch.
`?demo=mismatch`, `?demo=recovery` and `?demo=unsupported` show those cases.

## Layout

- `src/ble/protocol.ts`: port of `tools/cmf_ble.py` (framing, AES, CRC). `npm run vectors`
  regenerates the test vectors from the Python code.
- `src/ble/client.ts`: connect and pairing, from `tools/cmf_client.py`.
- `src/lib/watch.ts`: the `WatchLink` interface the screens use, with the Bluetooth and demo versions.
- `src/lib/firmware.ts`: firmware file checks and the latest-release lookup.
- `src/lib/languages.ts`: languages and preview messages, in step with `tools/languages.py`.
- `src/build/`: the build worker. `glue.py` calls `patch()` from `tools/build_firmware.py`.
  Pyodide's runtime is copied from `node_modules` into `public/pyodide/` before dev and build,
  so nothing is loaded from a CDN.
- `public/glyphs/<lang>.json`: each language's glyphs, rasterised ahead of time so the browser
  doesn't need the fonts or `lv_font_conv`. Regenerate with `npm run glyphs` after changing a
  language or its font.
- `src/App.tsx`, `src/ui/`: the wizard. `src/styles.css` is the design's stylesheet unchanged,
  with a few additions at the end.

## Plan

1. Connect, pair, read the version (done).
2. Build the patched image in the browser and show a preview (done).
3. Flash it.
