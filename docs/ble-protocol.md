# CMF Watch 3 Pro BLE protocol (as used by the flasher)

The protocol is ported from Gadgetbridge's `cmfwatchpro` device support. The Watch 3 Pro differences are marked (3 Pro).

## GATT

| Role | UUID |
|---|---|
| command write / notify | `0000fff2-...` / `0000fff1-...` |
| data write / notify | `02f00000-0000-0000-0000-00000000ffe1` / `...ffe2` |
| firmware write / notify | `02f00000-0000-0000-0000-00000000ff01` / `...ff02` |
| shell write / notify | `77d4ff01-2fe2-2334-0d35-9ccd078f529c` / `77d4ff02-...` |
| link-encryption trigger | `0000ffd2-...`: subscribing makes macOS bond and encrypt the link (needed on macOS) |

## Framing

Big-endian header, then the chunk:

```
0xF5 | u16 len | u16 cmd1 | u16 chunk_count | u16 chunk_index (1-based) | u16 cmd2 | chunk
```

- **Encrypted commands** (most of them): `chunk = AES-128-CBC/PKCS7(data + crc32_le(data))`, with the fixed IV `50 51 52 53 54 55 56 57 60 61 62 63 64 65 66 5a`.
- **Plaintext commands**: `AUTH_PAIR_REQUEST/REPLY`, `AUTH_FAILED`, and the AGPS/firmware/watchface data writes. `chunk = data + crc32_le(data)`.
- **Incoming plaintext quirk**: the `len` field counts 4 bytes more than the watch actually sends. Treat the packet as complete at `len(buf) >= len + 3` and take the rest of the buffer as payload.

## Pairing (first time)

1. Shell: write `AT GETSECRET`; the watch answers `GETSECRET:<32 hex>,OK`, which gives `appSecret`.
2. `random1 = 16 random bytes`; send `AUTH_PAIR_REQUEST (ffff,8047)` = `random1 + SHA256(random1 + appSecret)`.
3. The reply `(ffff,0048)` is `random2[16] + signed2[32]`. Verify that `signed2 == SHA256(random2 + appSecret)`.
4. `authKey = SHA256(random1 + random2 + appSecret)[:16]`. Store it.
5. The watch answers the next command with `AUTH_FAILED "restart"`, so reconnect.

## Session (every connection)

```
-> AUTH_PHONE_NAME   (ffff,8049)  [A5] + name          (encrypted with authKey)
<- AUTH_WATCH_MAC    (ffff,0049)
-> AUTH_NONCE_REQ    (ffff,804b)  [A5]
<- AUTH_NONCE_REPLY  (ffff,004c)  nonce
   sessionKey = SHA256(nonce + authKey)[:16]          (used from now on)
-> AUTH_CONFIRM_REQ  (ffff,804d)  [A5]
<- AUTH_CONFIRM      (ffff,0004)
```

`FIRMWARE_VERSION (ffff,8006)` -> `(ffff,0006)`: bytes joined with dots, e.g. `1.0.1.77`. A watch stuck in upgrade mode reports `0.0.1.77`.

## Firmware upload

```
-> FW_INIT1   (ffff,9052) [A5]                   command channel
<- (ffff,a052) 01
-> FW_INIT2   (ffff,9040) <4-byte version>       firmware channel
     (3 Pro) must be the watch's current version, e.g. 01 00 01 4d; Gadgetbridge's 0b 00 00 39 gets no reply
<- (ffff,a040) 01
loop:
  <- DATA_CHUNK_REQUEST (ffff,a042)  u32be offset, u32be length, u8 progress
  -> DATA_CHUNK_WRITE   (ffff,9042)  image[offset : offset+length]   (plaintext)
<- FINISH_ACK1 (ffff,a041) 01
-> FINISH_ACK2 (ffff,9041) [A5]                  data channel
```

The watch pulls the header, `ota.xml`, and then only the parts whose content differs from what is installed. On a normal flash it pulled about 3.9 KB per request, at roughly 25 KB/s. It then verifies the image, installs it and reboots.

Set `CMF_OFFLOG=offsets.log` to record every requested `(offset, length)`. `CMF_DEBUG=1` hex-dumps the handshake.

### Write mode and speed

How each `DATA_CHUNK_WRITE` is sent matters more than anything else for speed. Each piece is split into packets of at most 180 bytes.

- **With a confirmation per packet** (write with response), every packet waits for one Bluetooth round trip. In Chrome this gave about 2 KB/s, so a flash took close to an hour. Long writes of 512 bytes were slower still.
- **Without a confirmation** (write without response), the packets of a piece go out back to back and the watch's next `DATA_CHUNK_REQUEST` is the only acknowledgement needed. In Chrome on macOS this measured 16.5 KB/s, about 6 minutes for a normal flash.

The web app uses the fast mode. If the watch asks for nothing for 15 seconds, a packet was probably dropped: it switches to confirmed writes for the rest of the upload and sends the last requested piece again.

### After FINISH_ACK2

The watch verifies the image, installs it and restarts, which takes about a minute and a half. A browser cannot always reconnect by itself: Chrome on macOS reports "Bluetooth Device is no longer in range" for the old handle and needs the device picker again. The web app therefore treats `FINISH_ACK2` as the end of the install, waits 90 seconds, tries one silent reconnect, and otherwise offers a "Check the watch" button that opens the picker and reads `FIRMWARE_VERSION`.

### Restoring the official firmware

Sending the official image unchanged through the same upload puts the stock font back (and Korean with it). The web app offers this as "Remove the languages and emoji", and it is also the way out of upgrade mode (`0.x` version).

Tested on a watch on 1.0.1.77: after the restore, Greek showed as empty boxes again and Korean displayed correctly.
