import { describe, expect, it } from "vitest";
import { type Bytes, Reassembler, buildPackets, concat, crc32, decodePayload, fromHex, hex, type Cmd } from "../src/ble/protocol";
import vectors from "./vectors.json";

const key = fromHex(vectors.key);

describe("crc32", () => {
  for (const [input, want] of Object.entries(vectors.crc32)) {
    it(`matches zlib for ${input.length / 2} bytes`, () => expect(crc32(fromHex(input))).toBe(want));
  }
});

describe("matches tools/cmf_ble.py", () => {
  for (const v of vectors.packets) {
    const cmd = v.cmd as unknown as Cmd;
    const payload = fromHex(v.payload);

    it(`frames ${v.name}`, async () => {
      const pkts = await buildPackets(cmd, payload, key, v.maxWrite);
      expect(pkts.map(hex)).toEqual(v.packets);
    });

    it(`reassembles and decodes ${v.name}, split across notifications`, async () => {
      const r = new Reassembler();
      const bodies: Bytes[] = [];
      for (const p of v.packets.map(fromHex)) {
        const cut = Math.floor(p.length / 3);
        for (const part of [p.slice(0, cut), p.slice(cut)]) {
          for (const pk of r.feed(part)) {
            expect([pk.cmd1, pk.cmd2]).toEqual(v.cmd);
            const body = await decodePayload(pk.cmd1, pk.cmd2, pk.raw, key);
            expect(body).not.toBeNull();
            bodies.push(body!);
          }
        }
      }
      expect(bodies).toHaveLength(v.packets.length);
      // Plaintext bodies keep their CRC (Gadgetbridge semantics), encrypted ones don't.
      const joined = concat(...bodies);
      expect(hex(joined)).toContain(v.payload.slice(0, 32));
    });
  }

  it("rejects a payload with a wrong key", async () => {
    const v = vectors.packets[0];
    const raw = fromHex(v.packets[0]).slice(11);
    expect(await decodePayload(v.cmd[0], v.cmd[1], raw, new Uint8Array(16))).toBeNull();
  });
});
