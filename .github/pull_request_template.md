<!-- Adding a language? See CONTRIBUTING.md. One language per PR, and no firmware or .bin files. -->

## What this changes

## Language checklist (skip if this PR doesn't add one)

- [ ] Entry in `tools/languages.py` (font pinned by URL and sha256, license allows it)
- [ ] Preview in `docs/previews/<lang>.png`, no "not in font" warnings
- [ ] README Languages table row, short section in `docs/process.md`
- [ ] Font version matches the app's table in the build output
- [ ] `--lang greek` still builds `763357046b88553d32cf492e9d6f8882161b96fe80720022108641caf47cf3d9` from 1.0.1.77
- [ ] Same image with the languages in any order
- [ ] `tools/unpack_aota.py` reports all CRCs OK

Tested on a watch: <!-- no / yes, firmware version and what you checked -->
