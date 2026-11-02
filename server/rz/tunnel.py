"""Acesso pela internet com o cloudflared (túnel rápido trycloudflare)."""

from __future__ import annotations

import re
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Callable

URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


def find_cloudflared(root: Path) -> Path | None:
    local = root / "tools" / "cloudflared.exe"
    if local.is_file():
        return local
    found = shutil.which("cloudflared")
    return Path(found) if found else None


class Tunnel:
    def __init__(self, binary: Path, port: int, on_url: Callable[[str], None]) -> None:
        self.binary = binary
        self.port = port
        self.on_url = on_url
        self.url: str | None = None
        self.process: subprocess.Popen | None = None
        self.error: str | None = None

    def start(self) -> None:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        self.process = subprocess.Popen(
            [str(self.binary), "tunnel", "--url", f"http://127.0.0.1:{self.port}", "--no-autoupdate"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            creationflags=flags,
        )
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self) -> None:
        assert self.process and self.process.stderr
        for raw in self.process.stderr:
            line = raw.decode("utf-8", "replace")
            if self.url is None:
                match = URL_RE.search(line)
                if match:
                    self.url = match.group(0)
                    self.on_url(self.url)
            if "failed" in line.lower() and "error" in line.lower() and self.url is None:
                self.error = line.strip()[-240:]
        self.url = None

    def stop(self) -> None:
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
