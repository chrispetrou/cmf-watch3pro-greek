import { describe, expect, it } from "vitest";
import { WatchClient } from "../src/ble/client";
import { type Bytes, CMD, type Cmd, Reassembler, UUID, buildPackets, concat, decodePayload, sameCmd } from "../src/ble/protocol";

// A fake watch on the other end of WatchClient.flash(): it decodes what the page writes, asks for
// pieces of the image like the real watch, and checks every byte it gets back.
const KEY = new Uint8Array(16).fill(7) as Bytes;

function setup(requests: [number, number][], opts: { refuseInit2?: boolean; dropFast?: number } = {}) {
  const received: { offset: number; data: Bytes }[] = [];
  const log: string[] = [];
  let finished = false;
  const device = { name: "fake", gatt: { connected: true, disconnect() {} }, addEventListener() {} } as unknown as BluetoothDevice;
  const client = new WatchClient(device, (m) => log.push(m));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = client as any;
  c.key = KEY;
  for (const u of [UUID.cmdRead, UUID.dataRead, UUID.fwRead]) c.reasm.set(u, new Reassembler());

  const reply = async (cmd: Cmd, body: Bytes) => {
    for (const p of await buildPackets(cmd, body, KEY, 180)) await c.onNotify(UUID.fwRead, p);
  };
  const queue = [...requests];
  const nextRequest = async () => {
    const r = queue.shift();
    if (!r) return reply(CMD.FW_FINISH_ACK1, new Uint8Array([1]));
    const b = new Uint8Array(9);
    const v = new DataView(b.buffer);
    v.setUint32(0, r[0]); v.setUint32(4, r[1]); b[8] = Math.round(100 * (requests.length - queue.length) / requests.length);
    pending = { offset: r[0], length: r[1], parts: [] };
    return reply(CMD.FW_CHUNK_REQUEST, b);
  };
  let pending: { offset: number; length: number; parts: Bytes[] } | null = null;
  const watchSide = new Map<string, Reassembler>();

  let dropped = 0;
  const writes = { fast: 0, confirmed: 0 };
  const fakeChar = (uuid: string) => ({
    uuid, properties: { write: true, writeWithoutResponse: true },
    async writeValueWithResponse(pkt: Bytes) {
      writes.confirmed++;
      return this.receive(pkt);
    },
    async writeValueWithoutResponse(pkt: Bytes) {
      // Like a real radio under load: unconfirmed packets can get lost.
      if (uuid === UUID.fwWrite && pkt[10] === 0x42 && dropped < (opts.dropFast ?? 0)) { dropped++; return; }
      writes.fast++;
      return this.receive(pkt);
    },
    async receive(pkt: Bytes) {
      const r = watchSide.get(uuid) ?? new Reassembler();
      watchSide.set(uuid, r);
      for (const p of r.feed(pkt)) {
        const cmd: Cmd = [p.cmd1, p.cmd2];
        const body = (await decodePayload(p.cmd1, p.cmd2, p.raw, KEY))!;
        if (sameCmd(cmd, CMD.FW_INIT1_REQUEST)) await reply(CMD.FW_INIT1_REPLY, new Uint8Array([1]));
        else if (sameCmd(cmd, CMD.FW_INIT2_REQUEST)) {
          expect(Array.from(body)).toEqual([1, 0, 1, 77]);
          await reply(CMD.FW_INIT2_REPLY, new Uint8Array([opts.refuseInit2 ? 0 : 1]));
          if (!opts.refuseInit2) await nextRequest();
        } else if (sameCmd(cmd, CMD.FW_CHUNK_WRITE)) {
          if (p.index === 1) pending!.parts = [];
          pending!.parts.push(body.slice(0, -4)); // plaintext chunks carry their CRC
          if (p.index === p.count) {
            // An incomplete piece gets no answer, the page has to notice and send it again.
            if (pending!.parts.length !== p.count) return;
            received.push({ offset: pending!.offset, data: concat(...pending!.parts) });
            await nextRequest();
          }
        } else if (sameCmd(cmd, CMD.FW_FINISH_ACK2)) finished = true;
      }
    },
  });
  for (const u of [UUID.cmdWrite, UUID.fwWrite, UUID.dataWrite]) c.chars.set(u, fakeChar(u));
  c.fastStallMs = 100;
  return { client, received, isFinished: () => finished, log, writes };
}

const image = (() => {
  const d = new Uint8Array(20000) as Bytes;
  for (let i = 0; i < d.length; i++) d[i] = (i * 31 + 7) & 0xff;
  d.set([0x41, 0x4f, 0x54, 0x41]); // "AOTA"
  return d;
})();

describe("WatchClient.flash", () => {
  it("answers each request with the right bytes and finishes", async () => {
    const reqs: [number, number][] = [[0, 0x400], [0x400, 3900], [10000, 3900], [16000, 4000]];
    const { client, received, isFinished } = setup(reqs);
    const progress: number[] = [];
    await client.flash(image, [1, 0, 1, 77], (p) => progress.push(p));
    expect(received.map((r) => r.offset)).toEqual(reqs.map((r) => r[0]));
    for (const r of received) expect(r.data).toEqual(image.slice(r.offset, r.offset + r.data.length));
    expect(received.map((r) => r.data.length)).toEqual(reqs.map((r) => r[1]));
    expect(isFinished()).toBe(true);
    expect(progress.at(-1)).toBe(100);
  });

  it("sends pieces without per-packet confirmations", async () => {
    const { client, writes } = setup([[0, 3900], [8000, 3900]]);
    await client.flash(image, [1, 0, 1, 77], () => {});
    expect(writes.fast).toBeGreaterThan(40);
  });

  it("falls back to confirmed packets when fast packets get lost", async () => {
    const reqs: [number, number][] = [[0, 3900], [5000, 3900], [12000, 3900]];
    const { client, received, isFinished, log, writes } = setup(reqs, { dropFast: 3 });
    await client.flash(image, [1, 0, 1, 77], () => {});
    expect(log.some((l) => l.includes("went quiet"))).toBe(true);
    expect(isFinished()).toBe(true);
    // the dropped piece arrives in full the second time; every piece matches the image
    expect(received.map((r) => r.offset)).toEqual(reqs.map((r) => r[0]));
    for (const r of received) expect(r.data).toEqual(image.slice(r.offset, r.offset + 3900));
    expect(writes.confirmed).toBeGreaterThan(0);
  });

  it("stops if the watch refuses", async () => {
    const { client } = setup([], { refuseInit2: true });
    await expect(client.flash(image, [1, 0, 1, 77], () => {})).rejects.toThrow(/refused/);
  });

  it("refuses requests past the end of the image", async () => {
    const { client } = setup([[19000, 4000]]);
    await expect(client.flash(image, [1, 0, 1, 77], () => {})).rejects.toThrow(/past the end/);
  });
});
