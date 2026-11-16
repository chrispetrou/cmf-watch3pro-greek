"""Small download helper shared by the tools."""
import os
import sys
import urllib.request

UA = {"User-Agent": "cmf-watch3pro-languages/1.0"}


def download(url, dst):
    tmp = dst + ".part"
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done, shown = 0, -1
        while True:
            b = r.read(1 << 16)
            if not b:
                break
            f.write(b)
            done += len(b)
            if total and (done * 20 // total) != shown:
                shown = done * 20 // total
                sys.stdout.write(f"\r    {done/1e6:6.1f} / {total/1e6:.1f} MB")
                sys.stdout.flush()
    if total:
        print()
    os.replace(tmp, dst)
