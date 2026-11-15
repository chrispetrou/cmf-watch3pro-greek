"""High-level CMF watch client: scan, connect, pair/authenticate, flash firmware."""
import asyncio
import hashlib
import os
import struct
import time

from bleak import BleakScanner, BleakClient

import cmf_ble as P

UUID_FFD2 = "0000ffd2-0000-1000-8000-00805f9b34fb"
AUTHKEY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "authkey.hex")


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


async def scan(timeout=12):
    """Return list of (name, address, rssi) for likely CMF/Nothing watches."""
    found = {}
    def cb(dev, adv):
        name = adv.local_name or dev.name or ""
        found[dev.address] = (name, dev.address, adv.rssi)
    scanner = BleakScanner(detection_callback=cb)
    await scanner.start()
    await asyncio.sleep(timeout)
    await scanner.stop()
    rows = list(found.values())
    rows.sort(key=lambda r: r[2], reverse=True)
    return rows


class CmfClient:
    def __init__(self, address):
        self.address = address
        self.client = BleakClient(address, timeout=30.0)
        self.key = None
        self.max_write = 180          # refined from MTU after connect
        self.reasm = {}               # char uuid -> Reassembler
        self.chunk_bufs = {}          # cmd -> list of decoded bodies (multi-chunk)
        self.inq = asyncio.Queue()
        self.shellq = asyncio.Queue()
        self._resp = {}               # uuid -> use write-with-response?

    # ---- connection ----
    async def connect(self):
        await self.client.connect()
        try:
            mtu = self.client.mtu_size
            if mtu and mtu > 23:
                self.max_write = min(512, mtu - 3)
        except Exception:
            pass
        log(f"connected, ATT max write = {self.max_write}")
        # Decide write type per characteristic from its GATT properties.
        for svc in self.client.services:
            for ch in svc.characteristics:
                props = ch.properties
                if "write" in props:
                    self._resp[ch.uuid.lower()] = True
                elif "write-without-response" in props:
                    self._resp[ch.uuid.lower()] = False
                if os.environ.get("CMF_DEBUG") and ch.uuid.lower() in (
                        P.UUID_CMD_WRITE, P.UUID_DATA_WRITE, P.UUID_FW_WRITE, P.UUID_SHELL_WRITE):
                    log(f"  char {ch.uuid[-6:]} props={props}")
        # Subscribing to ffd2 makes macOS negotiate link encryption/bonding
        # (the watch requires an encrypted link for the authenticated session).
        t = time.time()
        try:
            await self.client.start_notify(UUID_FFD2, lambda s, d: None)
            log(f"  link-encryption trigger (ffd2) ok in {time.time()-t:.1f}s")
        except Exception as e:
            log(f"  note: ffd2 subscribe failed: {e}")
        for u in P.READ_CHARS:
            self.reasm[u] = P.Reassembler()
            try:
                await self.client.start_notify(u, self._on_notify)
            except Exception as e:
                log(f"  note: could not subscribe {u[:8]}: {e}")
        await asyncio.sleep(0.3)

    async def disconnect(self):
        try:
            await self.client.disconnect()
        except Exception:
            pass

    def _on_notify(self, sender, data):
        uuid = (sender.uuid if hasattr(sender, "uuid") else str(sender)).lower()
        if os.environ.get("CMF_DEBUG"):
            log(f"  RX {uuid[:8]}: {bytes(data).hex()}")
        if uuid == P.UUID_SHELL_READ:
            self.shellq.put_nowait(bytes(data))
            return
        if uuid not in self.reasm:
            return
        for cmd1, cmd2, cnt, idx, raw in self.reasm[uuid].feed(bytes(data)):
            ok, body = P.decode_payload(cmd1, cmd2, raw, self.key)
            if not ok:
                log(f"  ! decode fail cmd=({cmd1:#06x},{cmd2:#06x})")
                continue
            if cnt == 1:
                self.inq.put_nowait((cmd1, cmd2, body))
            else:
                b = self.chunk_bufs.setdefault((cmd1, cmd2), [])
                b.append(body)
                if idx == cnt:
                    self.inq.put_nowait((cmd1, cmd2, b"".join(b)))
                    self.chunk_bufs.pop((cmd1, cmd2), None)

    # ---- raw writes ----
    async def _write(self, uuid, cmd, payload=b""):
        for pkt in P.build_packets(cmd, payload, self.key, self.max_write):
            if os.environ.get("CMF_DEBUG"):
                log(f"  TX {uuid[-6:]} cmd={cmd[1]:#06x}: {pkt.hex()}")
            await self.client.write_gatt_char(uuid, pkt, response=self._resp.get(uuid, True))

    async def send_cmd(self, cmd, payload=b""):
        await self._write(P.UUID_CMD_WRITE, cmd, payload)

    async def send_data(self, cmd, payload=b""):
        await self._write(P.UUID_DATA_WRITE, cmd, payload)

    async def send_fw(self, cmd, payload=b""):
        await self._write(P.UUID_FW_WRITE, cmd, payload)

    async def expect(self, *cmds, timeout=15.0):
        """Wait for one of the given (cmd1,cmd2); raise on AUTH_FAILED/timeout."""
        wanted = set(cmds)
        deadline = time.time() + timeout
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                raise TimeoutError(f"timed out waiting for {[hex(c[1]) for c in cmds]}")
            cmd1, cmd2, body = await asyncio.wait_for(self.inq.get(), timeout=remaining)
            if (cmd1, cmd2) == P.AUTH_FAILED:
                raise RuntimeError(f"watch returned AUTH_FAILED ({body.decode('latin1', 'replace')!r})")
            if (cmd1, cmd2) in wanted:
                return (cmd1, cmd2), body
            # ignore unsolicited (battery pushes etc.)

    # ---- pairing / authentication ----
    async def reconnect(self, delay=2.0):
        """Drop the BLE link and connect again with clean protocol state."""
        await self.disconnect()
        await asyncio.sleep(delay)
        self.client = BleakClient(self.address, timeout=30.0)
        self.key = None
        self.reasm, self.chunk_bufs = {}, {}
        self.inq, self.shellq = asyncio.Queue(), asyncio.Queue()
        await self.connect()

    async def authenticate(self):
        secret = self._load_authkey()
        if secret:
            log("trying stored auth key")
            if await self._session_handshake(secret):
                return
            log("stored key rejected; doing a fresh pair")
            await self.reconnect()
        secret = await self._fresh_pair()
        # The watch answers the first encrypted command after a fresh pair with
        # AUTH_FAILED "restart": it wants a new connection before the session.
        log("pairing stored on watch; reconnecting to open an authenticated session")
        await self.reconnect()
        if not await self._session_handshake(secret):
            raise RuntimeError("authentication failed even after fresh pair + reconnect")

    async def _fresh_pair(self):
        log("fresh pair: requesting watch secret over shell (AT GETSECRET)")
        # drain any stale shell data
        while not self.shellq.empty():
            self.shellq.get_nowait()
        await self.client.write_gatt_char(P.UUID_SHELL_WRITE, b"AT GETSECRET", response=True)
        reply = await asyncio.wait_for(self.shellq.get(), timeout=15.0)
        text = reply.decode("latin1").strip()
        if not text.startswith("GETSECRET:") or not text.endswith(",OK"):
            raise RuntimeError("unexpected reply to AT GETSECRET")
        app_secret = bytes.fromhex(text[10:10 + 32])
        random1 = os.urandom(16)
        signed1 = hashlib.sha256(random1 + app_secret).digest()
        self.key = None
        await self.send_cmd(P.AUTH_PAIR_REQUEST, random1 + signed1)
        _, body = await self.expect(P.AUTH_PAIR_REPLY)
        random2, signed2 = body[:16], body[16:48]
        if hashlib.sha256(random2 + app_secret).digest() != signed2:
            raise RuntimeError("random2 signature mismatch (watch rejected us)")
        secret = hashlib.sha256(random1 + random2 + app_secret).digest()[:16]
        self._save_authkey(secret)
        log("  paired, key saved to authkey.hex")
        return secret

    async def _session_handshake(self, secret):
        try:
            await self._session_from_secret(secret)
            return True
        except Exception as e:
            log(f"  session handshake failed: {e}")
            return False

    async def _session_from_secret(self, secret):
        self.key = secret
        await self.send_cmd(P.AUTH_PHONE_NAME, bytes([P.A5]) + b"MacFlasher")
        log("  >>> if a pairing prompt appears on the Mac or the watch, ACCEPT it now")
        await self.expect(P.AUTH_WATCH_MAC, timeout=75.0)
        await self.send_cmd(P.AUTH_NONCE_REQUEST, bytes([P.A5]))
        _, nonce = await self.expect(P.AUTH_NONCE_REPLY)
        session = hashlib.sha256(nonce + secret).digest()[:16]
        self.key = session
        await self.send_cmd(P.AUTH_CONFIRM_REQ, bytes([P.A5]))
        await self.expect(P.AUTH_CONFIRM_REPLY)
        log("authenticated (session established)")

    async def get_firmware_version(self):
        await self.send_cmd(P.FIRMWARE_VERSION_GET, bytes([P.A5]))
        _, body = await self.expect(P.FIRMWARE_VERSION_RET, timeout=10.0)
        return ".".join(str(b) for b in body)   # bytes joined with dots, as Gadgetbridge does

    # ---- firmware flashing ----
    async def flash_firmware(self, path, progress_cb=None, version=(1, 0, 1, 77)):
        fw = open(path, "rb").read()
        if fw[:4] != b"AOTA":
            raise RuntimeError("not an AOTA firmware image")
        log(f"firmware {os.path.basename(path)}: {len(fw):,} bytes")

        log("FW init 1 (command channel)")
        await self.send_cmd(P.FW_INIT1_REQUEST, bytes([P.A5]))
        _, r = await self.expect(P.FW_INIT1_REPLY, timeout=20.0)
        if not r or r[0] != 0x01:
            raise RuntimeError(f"FW init1 refused: {r.hex()}")

        # INIT2 carries the target firmware version as 4 bytes (Gadgetbridge's
        # hard-coded 0b 00 00 39 == 11.0.0.57, the original Watch Pro build).
        log(f"FW init 2 (firmware channel), version {'.'.join(map(str, version))}")
        await self.send_fw(P.FW_INIT2_REQUEST, bytes(version))
        _, r = await self.expect(P.FW_INIT2_REPLY, timeout=20.0)
        if not r or r[0] != 0x01:
            raise RuntimeError(f"FW init2 refused: {r.hex()}")

        os.environ.pop("CMF_DEBUG", None)   # don't hex-dump 44 MB of chunks
        log("uploading; the watch pulls the chunks, do not touch it")
        last = -1
        offlog_path = os.environ.get("CMF_OFFLOG")
        offlog = open(offlog_path, "w") if offlog_path else None
        while True:
            cmd, body = await self.expect(P.FW_CHUNK_REQUEST, P.FW_FINISH_ACK1, timeout=60.0)
            if cmd == P.FW_FINISH_ACK1:
                if not body or body[0] != 0x01:
                    raise RuntimeError(f"finish ack error: {body.hex()}")
                await self.send_data(P.FW_FINISH_ACK2, bytes([P.A5]))
                log("transfer complete, the watch will now verify, install and reboot")
                if progress_cb:
                    progress_cb(100)
                return
            offset, length = struct.unpack(">II", body[:8])
            progress = body[8] if len(body) > 8 else 0
            if offlog is not None:
                offlog.write(f"{offset:#x} {length}\n"); offlog.flush()
            await self.send_fw(P.FW_CHUNK_WRITE, fw[offset:offset + length])
            if progress != last:
                last = progress
                if progress_cb:
                    progress_cb(progress)

    # ---- authkey persistence ----
    def _load_authkey(self):
        try:
            return bytes.fromhex(open(AUTHKEY_FILE).read().strip())
        except Exception:
            return None

    def _save_authkey(self, key):
        # The key lets anyone within BLE range authenticate as this computer, keep it private.
        fd = os.open(AUTHKEY_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(key.hex())
