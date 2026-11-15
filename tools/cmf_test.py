"""
Read-only connectivity test: connect, pair/authenticate and read the firmware version.
Writes nothing to the watch. Run it before flashing to check the BLE setup.

Usage: python cmf_test.py <ADDRESS>
"""
import asyncio
import sys
import cmf_client as C


async def main(addr):
    cl = C.CmfClient(addr)
    try:
        await cl.connect()
        await cl.authenticate()
        ver = await cl.get_firmware_version()
        C.log(f"WATCH FIRMWARE VERSION: {ver}")
        C.log("pairing, encryption and commands all work, ready to flash")
    finally:
        await cl.disconnect()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: python cmf_test.py <ADDRESS>")
        sys.exit(1)
    asyncio.run(main(sys.argv[1]))
