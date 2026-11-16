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

export type Phase = "connecting" | "pairing";

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
    const check = (m: Msg) => {
      if (sameCmd(m.cmd, CMD.AUTH_FAILED)) {
        throw new Error(`watch returned AUTH_FAILED (${new TextDecoder("latin1").decode(m.body)})`);
      }
      return m.body;
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
      this.onPhase?.("pairing");
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

  async firmwareVersion() {
    await this.sendCmd(CMD.FIRMWARE_VERSION_GET);
    const body = await this.expect([CMD.FIRMWARE_VERSION_RET], 10000);
    return Array.from(body).join(".");
  }
}
