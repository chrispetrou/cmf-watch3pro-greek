import { describe, expect, it } from "vitest";
import { WatchClient } from "../src/ble/client";
import { type Bytes, CMD, type Cmd, Reassembler, UUID, buildPackets, concat, decodePayload, sameCmd } from "../src/ble/protocol";

// A fake watch on the other end of WatchClient.flash(): it decodes what the page writes, asks for
// pieces of the image like the real watch, and checks every byte it gets back.
const KEY = new Uint8Array(16).fill(7) as Bytes;

function setup(requests: [number, number][], opts: { refuseInit2?: boolean } = {}) {
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

  const fakeChar = (uuid: string) => ({
    uuid, properties: { write: false, writeWithoutResponse: true },
    async writeValueWithoutResponse(pkt: Bytes) {
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
          pending!.parts.push(body.slice(0, -4)); // plaintext chunks carry their CRC
          if (p.index === p.count) {
            received.push({ offset: pending!.offset, data: concat(...pending!.parts) });
            await nextRequest();
          }
        } else if (sameCmd(cmd, CMD.FW_FINISH_ACK2)) finished = true;
      }
    },
  });
  for (const u of [UUID.cmdWrite, UUID.fwWrite, UUID.dataWrite]) c.chars.set(u, fakeChar(u));
  return { client, received, isFinished: () => finished, log };
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

  it("stops if the watch refuses", async () => {
    const { client } = setup([], { refuseInit2: true });
    await expect(client.flash(image, [1, 0, 1, 77], () => {})).rejects.toThrow(/refused/);
  });

  it("refuses requests past the end of the image", async () => {
    const { client } = setup([[19000, 4000]]);
    await expect(client.flash(image, [1, 0, 1, 77], () => {})).rejects.toThrow(/past the end/);
  });
});
