# Web app (work in progress)

A browser version of the tools, so people can patch their watch without a terminal. This is
stage 1: a test page that connects to the watch over Web Bluetooth, pairs and reads the firmware
version. It doesn't write anything to the watch.

Needs Chrome or Edge on a computer or Android phone (no Safari, Firefox or iPhone), and Node 22.

```bash
cd web
nvm use        # Node 22, from .nvmrc
npm install
npm run dev    # http://localhost:5173
npm test       # protocol tests against vectors from tools/cmf_ble.py
```

Before connecting, turn off Bluetooth on the phone so the watch is free. If the page pairs from
scratch, pair the watch with Nothing X again afterwards.

`src/ble/protocol.ts` is a port of `tools/cmf_ble.py` and `src/ble/client.ts` of the connect and
pairing parts of `tools/cmf_client.py`. If the Python framing changes, regenerate the vectors with
`npm run vectors` and run the tests.

## Plan

1. Connect, pair, read the version (this page).
2. Build the patched image and show a preview in the browser.
3. Flash it.
