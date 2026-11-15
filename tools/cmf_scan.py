"""Scan for the CMF watch over BLE and print candidates."""
import asyncio
import cmf_client as C


async def main():
    C.log("scanning 12s for BLE devices (watch must be disconnected from the phone)...")
    rows = await C.scan(12)
    print()
    print(f"{'NAME':28} {'ADDRESS':40} RSSI")
    print("-" * 80)
    for name, addr, rssi in rows:
        mark = "  <= likely watch" if any(k in (name or "").lower() for k in ("cmf", "watch", "nothing")) else ""
        print(f"{(name or '(no name)'):28} {addr:40} {rssi}{mark}")
    print("\nCopy the ADDRESS of your watch for the next step.")


if __name__ == "__main__":
    asyncio.run(main())
