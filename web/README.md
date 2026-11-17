# Web app

A browser version of the tools, so people can add a language to their watch without a terminal.
It follows the wizard in the design handoff: choose languages, add the official firmware file,
connect the watch, install.

What's real so far:

- "Remove the languages": installs the official file unchanged (the same path as the recovery
  restore), to undo the patch or get Korean back (tested: Korean works again afterwards);
- checking the firmware file (same checks as `tools/patch.py`: AOTA header, CRCs, board, version);
- the download link, from the Nothing Archive list (Nothing's CDN doesn't allow the browser to
  fetch the file itself, so the user downloads it);
- connecting, pairing and reading the watch's firmware version over Web Bluetooth;
- building the patched image, in a Web Worker with [Pyodide](https://pyodide.org). It runs the
  same Python as the command-line tool (`tools/build_firmware.py`), so the result is byte for byte
  the same. The image can also be downloaded and flashed with the CLI.

- sending the image to the watch (`WatchClient.flash`, a port of `flash_firmware` in
  `tools/cmf_client.py`), then reconnecting to check the version once the watch has restarted.
  Tested against a simulated watch (`test/flash.test.ts`) and on a real watch on 1.0.1.77
  (Greek + Georgian, then Greek + Georgian + Armenian). Chrome on macOS can't reconnect to a
  watch that has just restarted until the user picks it again, so the page counts the install as
  done once the watch confirms the transfer and offers a "Check the watch" button.

  Speed: the watch only asks for the parts that differ from what it runs, about 5.7 MB when the
  fonts change. Sending each piece without a confirmation per packet gives about 16 KB/s on a Mac
  with Chrome, so an install takes about 6 minutes plus the restart (it was about 50 minutes with
  a confirmation per packet).

`?demo` simulates every step instead and says so in a banner (`?demo=noverify` shows the case
where the page can't reconnect after the install).

It's hosted at https://watchlanguages.app (GitHub Pages with a custom domain; watchlanguages.com and
the old github.io address redirect there), deployed from `main` by
`.github/workflows/pages.yml` (build, tests, GitHub Pages). Everything runs in the visitor's browser:
GitHub Pages only serves the files, including the fonts (bundled, no Google Fonts) and Pyodide.
The only other request is the Nothing Archive's release list on raw.githubusercontent.com, to
find the latest firmware version.

Needs Chrome, Edge or another browser built on Chrome, on a computer or an Android phone. Tested
on macOS with Chrome and Dia; Windows, Linux, ChromeOS and Android should work but are untested
(Android in particular may differ in how pairing prompts and packet sizes behave). Safari, Firefox
and every browser on iPhone/iPad (they all use Safari's engine) have no Web Bluetooth; the page
shows iPhone and iPad users their own explanation. Brave has Web Bluetooth off by default. To run it
locally you need Node 22.

```bash
cd web
nvm use        # Node 22, from .nvmrc
npm install
npm run dev    # http://localhost:5173
npm test       # protocol vectors, firmware checks, Pyodide build vs the CLI's sha256, flashing against a fake watch
```

Open `http://localhost:5173/?demo` to click through every screen without a watch.
`?demo=mismatch`, `?demo=recovery` and `?demo=unsupported` show those cases.

## Stack

Vite, React 19 and TypeScript. Styling is Tailwind CSS v4 with [shadcn/ui](https://ui.shadcn.com)
components (Radix underneath) in `src/components/ui/`, and lucide icons. The theme (colours,
radii, dark mode via the `.dark` class) is in `src/index.css`; the watch artwork stays plain CSS in
`src/watch.css`.

To add a shadcn component: `npx shadcn@4.22.0 add <name>`. That version writes `import { cn } from "cn"`
and installs an unrelated `cn` package; change the import to `@/lib/utils` and `npm uninstall cn`.

The page is in English and Greek (`src/i18n.ts`, the EN/ΕΛ switch in the header, English by
default). The technical log stays in English.

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
- `src/App.tsx`, `src/ui/`, `src/components/blocks.tsx`: the wizard and its building blocks.

## Plan

1. Connect, pair, read the version (done).
2. Build the patched image in the browser (done).
3. Flash it (done).
