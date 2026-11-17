// Web Bluetooth client for the watch: connect, pair/authenticate, read the firmware version.
// Same sequence as tools/cmf_client.py. Read-only: nothing here writes to the watch's storage.
import {
  A5, type Bytes, CMD, type Cmd, OPTIONAL_SERVICES, Reassembler, UUID, ascii, buildPackets, bytesEqual,
  concat, decodePayload, fromHex, hex, sameCmd, sha256,
} from "./protocol";

export type Log = (msg: string) => void;
type Msg = { cmd: Cmd; body: Bytes };
type Waiter = { want: Cmd[]; resolve: (m: Msg) => void; reject: (e: Error) => void };

const KEY_STORE = "cmf.authkey";
const READ_CHARS = [UUID.cmdRead, UUID.dataRead, UUID.fwRead];
const WRITE_CHARS = [UUID.cmdWrite, UUID.dataWrite, UUID.fwWrite, UUID.shellWrite];

export const webBluetoothAvailable = () => typeof navigator !== "undefined" && "bluetooth" in navigator;

export function loadKey(): Bytes | null {
  try {
    const s = localStorage.getItem(KEY_STORE);
    return s && /^[0-9a-f]{32}$/.test(s) ? fromHex(s) : null;
  } catch {
    return null;
  }
}

function saveKey(k: Bytes) {
  try { localStorage.setItem(KEY_STORE, hex(k)); } catch { /* private mode: pair again next time */ }
}

export function forgetKey() {
  try { localStorage.removeItem(KEY_STORE); } catch { /* nothing stored */ }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** connecting: GATT connect; key: logging in with the saved key; pairing: pairing from scratch; reading: asking for the version. */
export type Phase = "connecting" | "key" | "pairing" | "reading";

export class WatchClient {
  /** Called when the watch or the computer may show a prompt the user has to accept. */
  onPhase?: (p: Phase) => void;
  private chars = new Map<string, BluetoothRemoteGATTCharacteristic>();
  private reasm = new Map<string, Reassembler>();
  private multi = new Map<string, Bytes[]>();
  private inbox: Msg[] = [];
  private waiters: Waiter[] = [];
  private shell: Bytes[] = [];
  private shellWaiter: ((b: Bytes) => void) | null = null;
  private chain = Promise.resolve();
  // Chrome can hand back the same characteristic objects after a reconnect, wire each only once.
  private wired = new WeakSet<BluetoothRemoteGATTCharacteristic>();
  private key: Bytes | null = null;
  // Web Bluetooth doesn't expose the MTU. 180 is what cmf_client.py starts with, and every
  // command used here fits in one packet well below that.
  private maxWrite = 180;
  // Firmware pieces: "fast" sends a piece's packets without waiting for a confirmation of each
  // (the watch's request for the next piece is the confirmation, and every packet has a CRC).
  // Waiting for a confirmation per packet costs a round trip each, which made uploads crawl.
  // If the watch stops asking while fast, the last piece is sent again confirmed and the upload
  // stays confirmed ("safe") from then on.
  private fwMode: "fast" | "safe" = "fast";
  /** How long the watch may be quiet after a fast piece before falling back. Tests shorten it. */
  fastStallMs = 15000;

  constructor(readonly device: BluetoothDevice, private log: Log) {
    device.addEventListener("gattserverdisconnected", () => {
      this.log("disconnected");
      for (const w of this.waiters.splice(0)) w.reject(new Error("watch disconnected"));
    });
  }

  static async request(showAll: boolean, log: Log) {
    const device = await navigator.bluetooth.requestDevice(
      showAll
        ? { acceptAllDevices: true, optionalServices: OPTIONAL_SERVICES }
        : { filters: [{ namePrefix: "CMF" }, { namePrefix: "Nothing" }, { services: [UUID.serviceCmd] }],
            optionalServices: OPTIONAL_SERVICES },
    );
    log(`selected ${device.name ?? "(no name)"}`);
    return new WatchClient(device, log);
  }

  get name() { return this.device.name ?? "watch"; }

  async connect() {
    const gatt = this.device.gatt;
    if (!gatt) throw new Error("this device has no GATT server");
    this.log("connecting");
    this.onPhase?.("connecting");
    const server = await gatt.connect();
    this.chars.clear();
    for (const svc of await server.getPrimaryServices()) {
      for (const ch of await svc.getCharacteristics()) this.chars.set(ch.uuid, ch);
      this.log(`  service ${svc.uuid}`);
    }
    for (const u of WRITE_CHARS) if (!this.chars.has(u)) throw new Error(`characteristic ${u} not found`);
    const fw = this.chars.get(UUID.fwWrite)!;
    const props = (["write", "writeWithoutResponse", "notify"] as const).filter((p) => fw.properties[p]);
    this.log(`  firmware characteristic: ${props.join(", ")}`);

    const ffd2 = this.chars.get(UUID.ffd2);
    if (ffd2) {
      const t = performance.now();
      try {
        await ffd2.startNotifications();
        this.log(`  link encryption trigger (ffd2) ok in ${((performance.now() - t) / 1000).toFixed(1)} s`);
      } catch (e) {
        this.log(`  note: ffd2 subscribe failed: ${String(e)}`);
      }
    } else {
      this.log("  note: no ffd2 characteristic, the OS may ask to pair when it's needed");
    }

    for (const u of [...READ_CHARS, UUID.shellRead]) {
      const ch = this.chars.get(u);
      if (!ch) { this.log(`  note: no ${u}`); continue; }
      this.reasm.set(u, new Reassembler());
      if (!this.wired.has(ch)) {
        this.wired.add(ch);
        ch.addEventListener("characteristicvaluechanged", (ev) => {
          const dv = (ev.target as BluetoothRemoteGATTCharacteristic).value!;
          const data: Bytes = new Uint8Array(dv.byteLength);
          data.set(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
          // Decryption is async, chain it so packets are handled in arrival order.
          this.chain = this.chain.then(() => this.onNotify(u, data)).catch((e) => this.log(`  ! ${e}`));
        });
      }
      await ch.startNotifications();
    }
    await sleep(300);
    this.log("connected");
  }

  disconnect() {
    this.device.gatt?.disconnect();
  }

  private async reconnect() {
    this.disconnect();
    await sleep(2000);
    this.key = null;
    this.inbox = []; this.shell = []; this.multi.clear();
    for (const r of this.reasm.keys()) this.reasm.set(r, new Reassembler());
    await this.connect();
  }

  // ------------------------------------------------------------ receive
  private async onNotify(uuid: string, data: Bytes) {
    if (uuid === UUID.shellRead) {
      if (this.shellWaiter) { this.shellWaiter(data); this.shellWaiter = null; } else this.shell.push(data);
      return;
    }
    for (const p of this.reasm.get(uuid)!.feed(data)) {
      const body = await decodePayload(p.cmd1, p.cmd2, p.raw, this.key);
      if (!body) { this.log(`  ! decode failed for ${p.cmd2.toString(16)}`); continue; }
      const cmd: Cmd = [p.cmd1, p.cmd2];
      if (p.count === 1) { this.deliver({ cmd, body }); continue; }
      const k = `${p.cmd1}:${p.cmd2}`;
      const parts = this.multi.get(k) ?? [];
      parts.push(body);
      this.multi.set(k, parts);
      if (p.index === p.count) { this.multi.delete(k); this.deliver({ cmd, body: concat(...parts) }); }
    }
  }

  private deliver(m: Msg) {
    const i = this.waiters.findIndex((w) => w.want.some((c) => sameCmd(c, m.cmd)) || sameCmd(m.cmd, CMD.AUTH_FAILED));
    if (i >= 0) this.waiters.splice(i, 1)[0].resolve(m);
    else this.inbox.push(m);
  }

  private expect(want: Cmd[], timeoutMs = 15000): Promise<Bytes> {
    return this.expectMsg(want, timeoutMs).then((m) => m.body);
  }

  private expectMsg(want: Cmd[], timeoutMs = 15000): Promise<Msg> {
    const check = (m: Msg) => {
      if (sameCmd(m.cmd, CMD.AUTH_FAILED)) {
        throw new Error(`watch returned AUTH_FAILED (${new TextDecoder("latin1").decode(m.body)})`);
      }
      return m;
    };
    const queued = this.inbox.findIndex((m) => want.some((c) => sameCmd(c, m.cmd)) || sameCmd(m.cmd, CMD.AUTH_FAILED));
    if (queued >= 0) return Promise.resolve().then(() => check(this.inbox.splice(queued, 1)[0]));
    return new Promise<Msg>((resolve, reject) => {
      const w: Waiter = { want, resolve, reject };
      this.waiters.push(w);
      setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          reject(new Error(`timed out waiting for ${want.map((c) => c[1].toString(16)).join(", ")}`));
        }
      }, timeoutMs);
    }).then(check);
  }

  // ------------------------------------------------------------ send
  private async write(uuid: string, cmd: Cmd, payload = new Uint8Array(0)) {
    const ch = this.chars.get(uuid)!;
    for (const pkt of await buildPackets(cmd, payload, this.key, this.maxWrite)) {
      if (ch.properties.write) await ch.writeValueWithResponse(pkt);
      else await ch.writeValueWithoutResponse(pkt);
    }
  }

  private sendCmd(cmd: Cmd, payload = new Uint8Array([A5])) {
    return this.write(UUID.cmdWrite, cmd, payload);
  }

  // ------------------------------------------------------------ auth
  async authenticate() {
    const stored = loadKey();
    if (stored) {
      this.log("trying the stored pairing key");
      this.onPhase?.("key");
      if (await this.tryHandshake(stored)) return;
      this.log("stored key rejected, pairing again");
      await this.reconnect();
    }
    const secret = await this.freshPair();
    // After a fresh pair the watch wants a new connection before the session.
    this.log("paired, reconnecting to open a session");
    await this.reconnect();
    if (!(await this.tryHandshake(secret))) throw new Error("authentication failed even after pairing");
  }

  private async freshPair() {
    this.log("pairing: asking the watch for its secret");
    this.onPhase?.("pairing");
    this.shell = [];
    const reply = new Promise<Bytes>((resolve, reject) => {
      this.shellWaiter = resolve;
      setTimeout(() => reject(new Error("no reply to AT GETSECRET")), 15000);
    });
    await this.chars.get(UUID.shellWrite)!.writeValueWithResponse(ascii("AT GETSECRET"));
    const text = new TextDecoder("latin1").decode(await reply).trim();
    if (!text.startsWith("GETSECRET:") || !text.endsWith(",OK")) throw new Error("unexpected reply to AT GETSECRET");
    const appSecret = fromHex(text.slice(10, 42));

    const random1 = crypto.getRandomValues(new Uint8Array(16));
    this.key = null;
    await this.sendCmd(CMD.AUTH_PAIR_REQUEST, concat(random1, await sha256(random1, appSecret)));
    const body = await this.expect([CMD.AUTH_PAIR_REPLY]);
    const random2 = body.slice(0, 16), signed2 = body.slice(16, 48);
    if (!bytesEqual(await sha256(random2, appSecret), signed2)) throw new Error("the watch's signature didn't match");
    const secret = (await sha256(random1, random2, appSecret)).slice(0, 16);
    saveKey(secret);
    return secret;
  }

  private async tryHandshake(secret: Bytes) {
    try {
      this.key = secret;
      await this.sendCmd(CMD.AUTH_PHONE_NAME, concat(new Uint8Array([A5]), ascii("WebFlasher")));
      this.log("if a pairing prompt appears on the computer or the watch, accept it");
      await this.expect([CMD.AUTH_WATCH_MAC], 75000);
      await this.sendCmd(CMD.AUTH_NONCE_REQUEST);
      const nonce = await this.expect([CMD.AUTH_NONCE_REPLY]);
      this.key = (await sha256(nonce, secret)).slice(0, 16);
      await this.sendCmd(CMD.AUTH_CONFIRM_REQ);
      await this.expect([CMD.AUTH_CONFIRM_REPLY]);
      this.log("authenticated");
      return true;
    } catch (e) {
      this.log(`  handshake failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  get connected() { return !!this.device.gatt?.connected; }

  /**
   * Upload an AOTA image (tools/cmf_client.py flash_firmware). After two init commands the watch
   * pulls the image itself: it asks for (offset, length) pieces, only of the parts that differ
   * from what's installed, and reports its own progress. `version` is the watch's current version.
   */
  async flash(image: Bytes, version: number[], onProgress: (pct: number, sent: number) => void, signal?: AbortSignal) {
    if (String.fromCharCode(...image.subarray(0, 4)) !== "AOTA") throw new Error("not an AOTA firmware image");
    const onAbort = () => this.disconnect();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      this.log("FW init 1 (command channel)");
      await this.sendCmd(CMD.FW_INIT1_REQUEST);
      let r = await this.expect([CMD.FW_INIT1_REPLY], 20000);
      if (r[0] !== 0x01) throw new Error(`the watch refused the update (init 1: ${hex(r)})`);
      this.log(`FW init 2 (firmware channel), version ${version.join(".")}`);
      await this.write(UUID.fwWrite, CMD.FW_INIT2_REQUEST, new Uint8Array(version));
      r = await this.expect([CMD.FW_INIT2_REPLY], 20000);
      if (r[0] !== 0x01) throw new Error(`the watch refused the update (init 2: ${hex(r)})`);

      this.log("uploading, the watch asks for each piece");
      if (!this.chars.get(UUID.fwWrite)!.properties.writeWithoutResponse) this.fwMode = "safe";
      this.log(`  sending ${this.fwMode === "fast" ? "without" : "with"} a confirmation per packet`);
      let sent = 0, last = -1, lastLog = -10, sendMs = 0, waitMs = 0;
      let lastPiece: Bytes | null = null;
      const t0 = performance.now();
      for (;;) {
        if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
        const tw = performance.now();
        let m: Msg;
        try {
          m = await this.expectMsg([CMD.FW_CHUNK_REQUEST, CMD.FW_FINISH_ACK1], lastPiece && this.fwMode === "fast" ? this.fastStallMs : 60000);
        } catch (e) {
          if (!(lastPiece && this.fwMode === "fast" && this.connected && e instanceof Error && e.message.startsWith("timed out"))) throw e;
          // Some packets were probably dropped: send the piece again, confirming each packet.
          this.log(`  the watch went quiet after a fast piece; sending it again with confirmations`);
          this.fwMode = "safe";
          await this.sendPiece(lastPiece);
          m = await this.expectMsg([CMD.FW_CHUNK_REQUEST, CMD.FW_FINISH_ACK1], 60000);
        }
        waitMs += performance.now() - tw;
        if (sameCmd(m.cmd, CMD.FW_FINISH_ACK1)) {
          if (m.body[0] !== 0x01) throw new Error(`the watch reported an error at the end (${hex(m.body)})`);
          await this.write(UUID.dataWrite, CMD.FW_FINISH_ACK2, new Uint8Array([A5]));
          this.log(`transfer complete, ${(sent / 1e6).toFixed(1)} MB sent; the watch now verifies, installs and restarts`);
          onProgress(100, sent);
          return;
        }
        const v = new DataView(m.body.buffer, m.body.byteOffset, m.body.byteLength);
        const offset = v.getUint32(0), length = v.getUint32(4);
        const progress = m.body.length > 8 ? m.body[8] : 0;
        if (offset + length > image.length) throw new Error(`the watch asked for bytes past the end of the image (${offset}+${length})`);
        const ts = performance.now();
        lastPiece = image.slice(offset, offset + length);
        await this.sendPiece(lastPiece);
        sendMs += performance.now() - ts;
        sent += length;
        if (progress !== last) {
          last = progress;
          onProgress(progress, sent);
          if (progress - lastLog >= 10) {
            lastLog = progress;
            const s = (performance.now() - t0) / 1000;
            this.log(`  ${progress}%: ${(sent / 1e6).toFixed(1)} MB in ${Math.round(s)} s, ${(sent / 1024 / s).toFixed(1)} KB/s ` +
              `(sending ${Math.round(sendMs / 1000)} s, waiting for the watch ${Math.round(waitMs / 1000)} s, ${this.fwMode})`);
          }
        }
      }
    } catch (e) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      throw e;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /** One requested piece of the image, in packets of maxWrite bytes. */
  private async sendPiece(data: Bytes) {
    const ch = this.chars.get(UUID.fwWrite)!;
    const packets = await buildPackets(CMD.FW_CHUNK_WRITE, data, this.key, this.maxWrite);
    if (this.fwMode === "fast") {
      try {
        for (const pkt of packets) await ch.writeValueWithoutResponse(pkt);
        return;
      } catch (e) {
        if (!this.connected) throw e;
        this.log(`  writing without confirmation failed (${e instanceof Error ? e.message : String(e)}), confirming each packet from now on`);
        this.fwMode = "safe";
      }
    }
    for (const pkt of packets) {
      if (ch.properties.write) await ch.writeValueWithResponse(pkt);
      else await ch.writeValueWithoutResponse(pkt);
    }
  }

  async firmwareVersion() {
    this.onPhase?.("reading");
    await this.sendCmd(CMD.FIRMWARE_VERSION_GET);
    const body = await this.expect([CMD.FIRMWARE_VERSION_RET], 10000);
    return Array.from(body).join(".");
  }
}
