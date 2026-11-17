# Contributing

The main way to help is adding a language the watch can't display yet. If you can't code, open a [language request](https://github.com/chrispetrou/cmf-watch3pro-languages/issues/new?template=language-request.yml) instead. Sample text and someone to check the preview are just as useful.

Never attach firmware images or patched `.bin` files to issues or pull requests. Nothing's firmware isn't ours to share.

## Can the language work?

The watch draws one glyph per character, left to right, with no shaping. That works for alphabets like Greek, Georgian or Armenian. It doesn't work for:

- right-to-left scripts (Arabic, Hebrew): the letters would show in the wrong order;
- scripts that need shaping (Arabic, Devanagari and other Indic scripts, Thai, Khmer): letters wouldn't join and marks would sit in the wrong place.

Space is tight but not a real limit. Dropping Korean frees about 1.5 MB, the `--emoji` option uses about 1.2 MB of it, and an alphabet takes 10 to 20 KB. With Greek, Georgian, Armenian and the emoji, about 250 KB is left.

## Picking the font

The watch's own typeface is Inter v4.0 Medium at 36 px.

1. **Use Inter if it covers the script.** Then the new letters match the stock text exactly. Check the coverage with:

   ```bash
   ./venv/bin/python -c "
   from fontTools.ttLib import TTFont
   cm = TTFont('cache/Inter-Medium.ttf').getBestCmap()
   print(sum(c in cm for c in range(0x0530, 0x0590)))"   # your script's range
   ```

2. **Otherwise pick a font with similar proportions** in a Medium weight. Compare the x-height and cap height (as a fraction of `unitsPerEm`) with Inter's 0.546 and 0.728:

   ```bash
   ./venv/bin/python -c "
   from fontTools.ttLib import TTFont
   t = TTFont('SomeFont-Medium.ttf'); o, u = t['OS/2'], t['head'].unitsPerEm
   print(o.sxHeight / u, o.sCapHeight / u)"
   ```

   The Noto Sans family is usually the best fit and covers most scripts.

3. **Check the license.** The font must allow this kind of use. SIL Open Font License fonts (Inter, Noto) are fine.

4. **Pin it.** Use a release download URL, not a branch, and record the sha256 of the `.ttf`. Fonts aren't committed to the repo, the tools download them.

## Adding it

1. In `tools/languages.py`:
   - add the font to `FONTS` if it's new (`name`, `url`, `member` if it's inside a zip, `file`, `sha256`);
   - add the language to `LANGUAGES`: `name`, `font`, the Unicode `ranges` and a few `sample` lines (the alphabet, a common phrase and a line mixed with Latin text). If the font isn't Inter, add a one-line comment saying why it was picked.
2. Build an image and render the preview:

   ```bash
   ./venv/bin/python tools/patch.py build --lang <lang>
   ./venv/bin/python tools/render_preview.py firmware/CMF_Watch3Pro_<version>_<lang>.bin \
       docs/previews/<lang>.png --lang <lang>
   ```

   `render_preview.py` needs Pillow (`./venv/bin/pip install pillow`). It prints "not in font" for any sample character that's missing.
3. Add it to the web app:
   - run `./venv/bin/python tools/export_glyphs.py`, which writes `web/public/glyphs/<lang>.json`;
   - add an entry to `web/src/lib/languages.ts` with the native name and a short sample message.
4. Update the docs:
   - a row in the Languages table in `README.md`;
   - mention the language where the README lists examples, if it helps;
   - a short section at the end of `docs/process.md`: why this font, how many glyphs, anything unusual;
   - a credit line in the README if the font is from a new family.

## Checks before opening the PR

- `--lang <lang>` builds, and the output says the font version matches the app's table.
- `--lang greek` still builds sha256 `763357046b88553d32cf492e9d6f8882161b96fe80720022108641caf47cf3d9` from the 1.0.1.77 image, so existing languages are unchanged.
- `--lang greek,georgian,armenian,<lang> --emoji` still fits in the font partition.
- Combining languages gives the same image in any order (`--lang greek,<lang>` and `--lang <lang>,greek`).
- `tools/unpack_aota.py` reports every part's CRC as OK.
- The preview has no missing characters, and ideally someone who reads the language has looked at it.

## The pull request

- One language per PR.
- Include the preview image in the description.
- Say honestly whether you flashed it on a watch. If you did, say which firmware version and what you checked (a notification, a message, a contact name). The README table records this.
- Commits should be small and say what they change.
