"""Usuário, senha e sessão.

A senha nunca é gravada: fica só o hash PBKDF2-SHA256 em ``.auth.json``
(mesmo formato da versão 2, então o acesso antigo continua valendo). A sessão
é um token assinado com HMAC pela chave de ``.secret``; ``sv`` (versão da
sessão) permite encerrar todas as sessões de uma vez.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
from pathlib import Path

from .storage import atomic_write_json

PBKDF2_ITERATIONS = 600_000
PBKDF2_MIN_ACCEPTED = 100_000
USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{3,32}$")
PASSWORD_MIN = 8
PASSWORD_MAX = 128
SESSION_LONG = 30 * 24 * 3600
SESSION_SHORT = 24 * 3600
LOCK_AFTER = 8
LOCK_BASE_SECONDS = 60
LOCK_MAX_SECONDS = 15 * 60


def b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def b64url_decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def hash_password(password: str, salt: bytes, iterations: int) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)


def valid_username(value: object) -> str | None:
    return value if isinstance(value, str) and USERNAME_RE.fullmatch(value) else None


def valid_password(value: object) -> str | None:
    if isinstance(value, str) and PASSWORD_MIN <= len(value) <= PASSWORD_MAX:
        return value
    return None


def ensure_secret(path: Path) -> bytes:
    if path.is_file():
        secret = bytes.fromhex(path.read_text(encoding="utf-8").strip())
        if len(secret) != 32:
            raise RuntimeError(".secret inválido")
        return secret
    path.parent.mkdir(parents=True, exist_ok=True)
    secret = secrets.token_bytes(32)
    try:
        fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        return ensure_secret(path)
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(secret.hex() + "\n")
    return secret


class RateLimiter:
    """Bloqueio progressivo por IP depois de várias senhas erradas."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._fails: dict[str, dict] = {}

    def blocked_for(self, ip: str) -> int:
        now = time.time()
        with self._lock:
            rec = self._fails.get(ip)
            if not rec:
                return 0
            remaining = int(rec.get("until", 0) - now)
            return max(0, remaining)

    def failure(self, ip: str) -> int:
        """Registra a falha e devolve os segundos de bloqueio (0 se não bloqueou)."""
        now = time.time()
        with self._lock:
            rec = self._fails.setdefault(ip, {"count": 0, "until": 0.0, "locks": 0})
            if rec["until"] > now:
                return int(rec["until"] - now)
            rec["count"] += 1
            if rec["count"] >= LOCK_AFTER:
                seconds = min(LOCK_MAX_SECONDS, LOCK_BASE_SECONDS * (2 ** rec["locks"]))
                rec["locks"] += 1
                rec["count"] = 0
                rec["until"] = now + seconds
                return seconds
            if len(self._fails) > 5000:
                self._fails = {k: v for k, v in self._fails.items() if v["until"] > now}
            return 0

    def success(self, ip: str) -> None:
        with self._lock:
            self._fails.pop(ip, None)


class Auth:
    def __init__(self, data_dir: Path) -> None:
        self.dir = Path(data_dir)
        self.path = self.dir / ".auth.json"
        self.secret = ensure_secret(self.dir / ".secret")
        self.lock = threading.Lock()
        self.limiter = RateLimiter()
        self._cache: tuple[tuple[int, int], list[dict]] | None = None

    # ------------------------------------------------------------ usuários
    def _users(self) -> list[dict]:
        try:
            st = self.path.stat()
        except FileNotFoundError:
            return []
        key = (st.st_mtime_ns, st.st_size)
        if self._cache and self._cache[0] == key:
            return [dict(u) for u in self._cache[1]]
        data = json.loads(self.path.read_text(encoding="utf-8"))
        users = data.get("users") if isinstance(data, dict) else None
        if not isinstance(users, list):
            users = []
        users = [u for u in users if isinstance(u, dict) and isinstance(u.get("username"), str) and u.get("username")]
        self._cache = (key, users)
        return [dict(u) for u in users]

    def _save(self, users: list[dict]) -> None:
        atomic_write_json(self.path, {"users": users}, pretty=True)
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass

    def setup_required(self) -> bool:
        with self.lock:
            return not self._users()

    def _record(self, username: str, password: str) -> dict:
        salt = secrets.token_bytes(16)
        return {
            "username": username,
            "salt": salt.hex(),
            "hash": hash_password(password, salt, PBKDF2_ITERATIONS).hex(),
            "iterations": PBKDF2_ITERATIONS,
            "sv": secrets.randbelow(1_000_000),
        }

    def create_first(self, username: str, password: str) -> dict | None:
        """Cria o primeiro acesso. Devolve None se já existe um usuário."""
        record = self._record(username, password)
        with self.lock:
            if self._users():
                return None
            self._save([record])
        return record

    @staticmethod
    def _matches(record: dict, password: str) -> bool:
        try:
            salt = bytes.fromhex(str(record.get("salt") or ""))
            expected = bytes.fromhex(str(record.get("hash") or ""))
        except ValueError:
            return False
        iterations = record.get("iterations")
        if not isinstance(iterations, int) or iterations < PBKDF2_MIN_ACCEPTED or len(salt) != 16 or len(expected) != 32:
            hash_password(password, b"\x00" * 16, PBKDF2_ITERATIONS)
            return False
        return hmac.compare_digest(hash_password(password, salt, iterations), expected)

    def verify(self, username: object, password: object) -> dict | None:
        if not isinstance(username, str) or not isinstance(password, str) or len(password) > PASSWORD_MAX:
            return None
        with self.lock:
            users = self._users()
        # Usuário sem diferença de maiúsculas/minúsculas ("Renan" = "renan").
        record = next((u for u in users if str(u.get("username")).casefold() == username.strip().casefold()), None)
        if record is None:
            hash_password(password, b"\x00" * 16, PBKDF2_ITERATIONS)
            return None
        if not self._matches(record, password):
            return None
        if int(record.get("iterations") or 0) < PBKDF2_ITERATIONS:
            self._rehash(record["username"], password)
            record = self.user(record["username"]) or record
        return record

    def _rehash(self, username: str, password: str) -> None:
        with self.lock:
            users = self._users()
            for index, item in enumerate(users):
                if item.get("username") == username:
                    fresh = self._record(username, password)
                    fresh["sv"] = item.get("sv", 0)
                    users[index] = fresh
                    self._save(users)
                    return

    def user(self, username: str) -> dict | None:
        with self.lock:
            return next((u for u in self._users() if u.get("username") == username), None)

    def change_password(self, username: str, current: str, new: str) -> bool:
        if self.verify(username, current) is None:
            return False
        with self.lock:
            users = self._users()
            for index, item in enumerate(users):
                if item.get("username") == username:
                    fresh = self._record(username, new)
                    fresh["sv"] = int(item.get("sv") or 0) + 1
                    users[index] = fresh
                    self._save(users)
                    return True
        return False

    def usernames(self) -> list[str]:
        with self.lock:
            return [u["username"] for u in self._users()]

    def reset_password(self, username: str, new: str) -> bool:
        """Troca a senha sem pedir a atual (uso local, pelo terminal) e encerra as sessões."""
        if valid_password(new) is None:
            return False
        with self.lock:
            users = self._users()
            for index, item in enumerate(users):
                if item.get("username") == username:
                    fresh = self._record(username, new)
                    fresh["sv"] = int(item.get("sv") or 0) + 1
                    users[index] = fresh
                    self._save(users)
                    return True
        return False

    def bump_sessions(self, username: str) -> dict | None:
        with self.lock:
            users = self._users()
            for item in users:
                if item.get("username") == username:
                    item["sv"] = int(item.get("sv") or 0) + 1
                    self._save(users)
                    return item
        return None

    # -------------------------------------------------------------- tokens
    def _sign(self, payload: str) -> str:
        return hmac.new(self.secret, payload.encode("ascii"), hashlib.sha256).hexdigest()

    def make_token(self, record: dict, long: bool) -> tuple[str, int]:
        ttl = SESSION_LONG if long else SESSION_SHORT
        body = {"u": record["username"], "exp": int(time.time()) + ttl, "sv": int(record.get("sv") or 0)}
        payload = b64url_encode(json.dumps(body, separators=(",", ":")).encode("utf-8"))
        return f"{payload}.{self._sign(payload)}", ttl

    def read_token(self, token: str | None) -> str | None:
        if not token or len(token) > 512 or token.count(".") != 1:
            return None
        payload, sig = token.split(".", 1)
        if len(sig) != 64 or not hmac.compare_digest(self._sign(payload), sig):
            return None
        try:
            data = json.loads(b64url_decode(payload))
        except (ValueError, json.JSONDecodeError):
            return None
        if not isinstance(data, dict):
            return None
        username, exp = data.get("u"), data.get("exp")
        if not isinstance(username, str) or not isinstance(exp, int) or exp < time.time():
            return None
        record = self.user(username)
        if record is None or int(data.get("sv") or 0) != int(record.get("sv") or 0):
            return None
        return username
