import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkFirmware } from "../src/lib/firmware";

// Uses the official image if it's in firmware/ (git-ignored, never committed).
const NAME = "ORIGINAL_JX402_08_ATS3089C_V1.0.1.77.bin";
const PATH = `../firmware/${NAME}`;
const have = existsSync(PATH);

describe("checkFirmware", () => {
  it.skipIf(!have)("accepts the official 1.0.1.77 image", async () => {
    const r = await checkFirmware(new File([readFileSync(PATH)], NAME), () => {});
    expect(r).toMatchObject({ ok: true, version: "1.0.1.77", board: "JX402_08" });
  }, 30000);

  it.skipIf(!have)("knows the version of a renamed copy", async () => {
    const r = await checkFirmware(new File([readFileSync(PATH)], "firmware.bin"), () => {});
    expect(r).toMatchObject({ ok: true, version: "1.0.1.77" });
  }, 30000);

  it.skipIf(!have)("spots a damaged image", async () => {
    const d = new Uint8Array(readFileSync(PATH));
    d[d.length - 100] ^= 1;
    const r = await checkFirmware(new File([d], NAME), () => {});
    expect(r).toMatchObject({ ok: false, problem: "The file is damaged" });
  }, 30000);

  it("rejects something else", async () => {
    const r = await checkFirmware(new File([new Uint8Array(5000)], "IMG_2041.zip"), () => {});
    expect(r).toMatchObject({ ok: false, problem: "Not a watch update" });
  });
});
