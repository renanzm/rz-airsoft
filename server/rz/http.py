"""HTTP: app (pasta web/), API v1 e cabeçalhos de segurança."""

from __future__ import annotations

import gzip
import json
import os
import platform
import re
import tempfile
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

from . import APP_ID, VERSION
from .auth import Auth, valid_password, valid_username
from .storage import ConflictError, Store, StoreError, detect_onedrive

MAX_JSON = 8 * 1024 * 1024
MAX_AUTH = 8192
MAX_FILE = 15 * 1024 * 1024
MAX_RESTORE = 4 * 1024 ** 3
COOKIE = "rz_session"

CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "frame-src 'self' blob:",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'",
    ]
)

STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
}
COMPRESSIBLE = {".html", ".js", ".mjs", ".css", ".json", ".webmanifest", ".svg", ".txt"}

LEGACY_PAGES = {
    "/painel.html": "/",
    "/index.html": "/ordens",
    "/controle.html": "/ordens",
    "/historico.html": "/ordens",
    "/clientes.html": "/clientes",
    "/servicos.html": "/servicos",
    "/banner.html": "/marketing",
    "/login.html": "/login",
}

PUBLIC_API = {
    ("GET", "/api/v1/health"),
    ("GET", "/api/v1/session"),
    ("POST", "/api/v1/auth/setup"),
    ("POST", "/api/v1/auth/login"),
    ("POST", "/api/v1/auth/logout"),
}

DOC_ROUTE = re.compile(r"^/api/v1/c/([a-z]+)/([A-Za-z0-9_-]{1,64})$")
FILE_ROUTE = re.compile(r"^/api/v1/files/(f_[a-f0-9]{20})$")

_print_lock = threading.Lock()


def say(message: str) -> None:
    with _print_lock:
        try:
            print(message, flush=True)
        except UnicodeEncodeError:
            print(message.encode("ascii", "replace").decode("ascii"), flush=True)


def origin_allowed(origin: str | None, host_header: str | None, https: bool, local_port: int) -> bool:
    """Aceita a mesma origem (local ou do túnel). Sem Origin: cliente fora do navegador."""
    if origin is None or str(origin).strip() == "":
        return True
    parsed = urlparse(str(origin).strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    origin_host = parsed.hostname.lower()
    if origin_host in ("127.0.0.1", "localhost") and parsed.scheme == "http":
        return parsed.port in (None, local_port)
    if parsed.scheme != ("https" if https else "http"):
        return False
    header = (host_header or "").strip().lower()
    if header.startswith("["):
        end = header.find("]")
        header_name = header[1:end] if end > 1 else header
        rest = header[end + 1:] if end > 1 else ""
        header_port = int(rest[1:]) if rest.startswith(":") and rest[1:].isdigit() else None
    elif header.count(":") == 1:
        header_name, _, port_s = header.partition(":")
        header_port = int(port_s) if port_s.isdigit() else None
    else:
        header_name = header
        header_port = None
    if origin_host != header_name:
        return False
    if parsed.port and header_port and parsed.port != header_port:
        return False
    if parsed.port and not header_port and parsed.port not in (80, 443, local_port):
        return False
    return True


def resolve_web(web_dir: Path, url_path: str) -> Path | None:
    if not url_path.startswith("/") or "\\" in url_path or "//" in url_path:
        return None
    parts = [part for part in url_path.split("/") if part]
    if not parts or any(part in (".", "..") or part.startswith(".") for part in parts):
        return None
    candidate = web_dir.joinpath(*parts).resolve()
    if not candidate.is_relative_to(web_dir):
        return None
    if candidate.suffix.lower() not in STATIC_TYPES or not candidate.is_file():
        return None
    return candidate


def is_app_route(path: str) -> bool:
    last = path.rstrip("/").rsplit("/", 1)[-1]
    return "." not in last


class AppServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False
    request_queue_size = 64

    def __init__(self, address, web_dir: Path, data_dir: Path, quiet: bool = False) -> None:
        self.web_dir = Path(web_dir).resolve()
        self.data_dir = Path(data_dir).resolve()
        self.store = Store(self.data_dir)
        self.auth = Auth(self.data_dir)
        self.quiet = quiet
        self.tunnel_url: str | None = None
        self.static_cache: dict[Path, tuple[tuple[int, int], dict]] = {}
        self.static_lock = threading.Lock()
        super().__init__(address, Handler)
        # Cookies não se separam por porta: cada instância usa o próprio nome.
        # Na porta padrão o nome é o da versão 2, para a sessão atual continuar valendo.
        self.cookie_name = COOKIE if self.port == 8765 else f"{COOKIE}_{self.port}"

    @property
    def port(self) -> int:
        return int(self.server_address[1])


class Handler(BaseHTTPRequestHandler):
    server: AppServer
    server_version = "RZAirsoft/3"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------ entrada
    def log_message(self, fmt: str, *args) -> None:  # noqa: D401 - log próprio
        return

    def do_GET(self) -> None:
        self._run("GET")

    def do_POST(self) -> None:
        self._run("POST")

    def do_PUT(self) -> None:
        self._run("PUT")

    def do_DELETE(self) -> None:
        self._run("DELETE")

    def _run(self, method: str) -> None:
        self._t0 = time.perf_counter()
        self._sent = False
        self._status = 0
        self._consumed = False
        self._extra_cookie: str | None = None
        path = ""
        try:
            parsed = urlparse(self.path)
            path = unquote(parsed.path)
            if "\x00" in path or len(self.path) > 4096:
                self._json(400, {"error": "invalido"})
                return
            self._query = parse_qs(parsed.query)
            if path == "/api" or path.startswith("/api/"):
                self._api(method, path)
            else:
                self._static(method, path, parsed.query)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True
        except ConflictError as exc:
            self._json(409, {"error": "conflito", "current": exc.current})
        except StoreError as exc:
            self._json(exc.status, {"error": exc.code, "message": exc.detail})
        except Exception as exc:  # pragma: no cover - rede de segurança
            say(f"[erro] {method} {path}: {type(exc).__name__}: {exc}")
            if not self._sent:
                self._json(500, {"error": "interno"})
            self.close_connection = True
        finally:
            self._log(method, path)

    def _log(self, method: str, path: str) -> None:
        if self.server.quiet:
            return
        is_api = path.startswith("/api/")
        if not is_api and self._status < 400 and not (self._status == 200 and is_app_route(path)):
            return
        if is_api and method == "GET" and path in ("/api/v1/changes", "/api/v1/health") and self._status < 400:
            return
        ms = (time.perf_counter() - self._t0) * 1000
        say(f"{datetime.now():%H:%M:%S}  {self._status}  {method:<6} {path}  {ms:.0f}ms")

    # ------------------------------------------------------------ helpers
    def _https(self) -> bool:
        return (self.headers.get("X-Forwarded-Proto") or "").split(",")[0].strip().lower() == "https"

    def _client_ip(self) -> str:
        peer = self.client_address[0] if self.client_address else ""
        if peer in ("127.0.0.1", "::1"):
            forwarded = self.headers.get("CF-Connecting-IP") or self.headers.get("X-Forwarded-For") or ""
            first = forwarded.split(",")[0].strip()
            if first and len(first) <= 64 and " " not in first:
                return first
        return peer or "?"

    def _same_origin(self) -> bool:
        site = (self.headers.get("Sec-Fetch-Site") or "").strip().lower()
        if site and site not in ("same-origin", "none"):
            return False
        return origin_allowed(self.headers.get("Origin"), self.headers.get("Host"), self._https(), self.server.port)

    def _user(self) -> str | None:
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        for part in raw.split(";"):
            name, _, value = part.strip().partition("=")
            if name == self.server.cookie_name:
                return self.server.auth.read_token(value.strip().strip('"'))
        return None

    def _cookie(self, token: str | None, max_age: int | None) -> str:
        parts = [f"{self.server.cookie_name}={token or ''}", "HttpOnly", "SameSite=Lax", "Path=/"]
        if token is None:
            parts.append("Max-Age=0")
        elif max_age:
            parts.append(f"Max-Age={max_age}")
        if self._https():
            parts.append("Secure")
        return "; ".join(parts)

    def _body(self, limit: int) -> bytes:
        if (self.headers.get("Transfer-Encoding") or "").lower() == "chunked":
            self.close_connection = True
            raise StoreError("length", 411)
        header = self.headers.get("Content-Length")
        if header is None:
            self._consumed = True
            return b""
        try:
            size = int(header)
        except ValueError as exc:
            self.close_connection = True
            raise StoreError("length", 400) from exc
        if size < 0:
            self.close_connection = True
            raise StoreError("length", 400)
        if size > limit:
            self.close_connection = True
            raise StoreError("tamanho", 413)
        self._consumed = True
        return self.rfile.read(size) if size else b""

    def _discard_unread(self) -> None:
        """Com keep-alive, um corpo não lido estragaria a próxima requisição."""
        if self._consumed:
            return
        self._consumed = True
        try:
            size = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            size = -1
        if size == 0:
            return
        if 0 < size <= 1024 * 1024:
            self.rfile.read(size)
        else:
            self.close_connection = True

    def _json_body(self, limit: int = MAX_JSON) -> dict:
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        raw = self._body(limit)
        if ctype != "application/json":
            raise StoreError("content-type", 415)
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise StoreError("json", 400) from exc
        if not isinstance(data, dict):
            raise StoreError("json", 400)
        return data

    def _int_query(self, name: str) -> int | None:
        values = self._query.get(name)
        if not values:
            return None
        try:
            return int(values[0])
        except ValueError as exc:
            raise StoreError(name, 400) from exc

    # ------------------------------------------------------------- envio
    def _common_headers(self, html: bool = False) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
        if html:
            self.send_header("Content-Security-Policy", CSP)
        if self.close_connection:
            self.send_header("Connection", "close")

    def _send(self, code: int, body: bytes, ctype: str, headers: dict[str, str] | None = None, html: bool = False) -> None:
        if self._sent:
            return
        self._discard_unread()
        self._sent = True
        self._status = code
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        if code != 304:
            self.send_header("Content-Length", str(len(body)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        if self._extra_cookie:
            self.send_header("Set-Cookie", self._extra_cookie)
        self._common_headers(html)
        self.end_headers()
        if body and code != 304 and self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code: int, obj: object, cookie: str | None = None) -> None:
        if cookie:
            self._extra_cookie = cookie
        body = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(body) > 2048 and "gzip" in (self.headers.get("Accept-Encoding") or ""):
            body = gzip.compress(body, compresslevel=5)
            headers = {"Cache-Control": "no-store", "Content-Encoding": "gzip", "Vary": "Accept-Encoding"}
        else:
            headers = {"Cache-Control": "no-store"}
        self._send(code, body, "application/json; charset=utf-8", headers)

    def _redirect(self, location: str) -> None:
        self._send(302, b"", "text/plain; charset=utf-8", {"Location": location, "Cache-Control": "no-store"})

    # --------------------------------------------------------------- API
    def _api(self, method: str, path: str) -> None:
        unsafe = method in ("POST", "PUT", "DELETE", "PATCH")
        if unsafe and not self._same_origin():
            self.close_connection = True
            self._json(403, {"error": "origin"})
            return
        user = self._user()
        if (method, path) not in PUBLIC_API and not user:
            self._json(401, {"error": "auth"})
            return

        routes = {
            ("GET", "/api/v1/health"): self._health,
            ("GET", "/api/v1/session"): lambda: self._session(user),
            ("POST", "/api/v1/auth/setup"): self._setup,
            ("POST", "/api/v1/auth/login"): self._login,
            ("POST", "/api/v1/auth/logout"): self._logout,
            ("POST", "/api/v1/auth/password"): lambda: self._password(user),
            ("POST", "/api/v1/auth/logout-all"): lambda: self._logout_all(user),
            ("GET", "/api/v1/data"): lambda: self._data(user),
            ("GET", "/api/v1/changes"): self._changes,
            ("POST", "/api/v1/files"): self._file_upload,
            ("GET", "/api/v1/system"): self._system,
            ("GET", "/api/v1/backup"): self._backup,
            ("POST", "/api/v1/restore"): self._restore,
            ("GET", "/api/v1/legacy"): self._legacy,
        }
        handler = routes.get((method, path))
        if handler:
            handler()
            return
        match = DOC_ROUTE.fullmatch(path)
        if match:
            coll, doc_id = match.groups()
            if method == "PUT":
                self._doc_put(coll, doc_id)
                return
            if method == "DELETE":
                self.server.store.delete(coll, doc_id, self._int_query("baseRev"))
                self._json(200, {"ok": True})
                return
            if method == "GET":
                doc = self.server.store.get(coll, doc_id)
                self._json(200 if doc else 404, {"doc": doc} if doc else {"error": "missing"})
                return
            self._json(405, {"error": "method"})
            return
        match = FILE_ROUTE.fullmatch(path)
        if match:
            if method == "GET":
                self._file_get(match.group(1))
                return
            if method == "DELETE":
                self.server.store.delete_file(match.group(1))
                self._json(200, {"ok": True})
                return
            self._json(405, {"error": "method"})
            return
        self._json(404, {"error": "missing"})

    def _health(self) -> None:
        self._json(200, {"ok": True, "app": APP_ID, "version": VERSION})

    def _session(self, user: str | None) -> None:
        self._json(
            200,
            {
                "authenticated": user is not None,
                "setupRequired": self.server.auth.setup_required(),
                "username": user,
                "version": VERSION,
            },
        )

    def _setup(self) -> None:
        data = self._json_body(MAX_AUTH)
        username = valid_username(data.get("username"))
        password = valid_password(data.get("password"))
        if not username or password is None:
            self._json(400, {"error": "invalido"})
            return
        record = self.server.auth.create_first(username, password)
        if record is None:
            self._json(409, {"error": "configurado"})
            return
        token, ttl = self.server.auth.make_token(record, long=True)
        self._json(201, {"ok": True, "username": username}, self._cookie(token, ttl))

    def _login(self) -> None:
        ip = self._client_ip()
        limiter = self.server.auth.limiter
        wait = limiter.blocked_for(ip)
        if wait:
            self._json(429, {"error": "bloqueado", "retryAfter": wait})
            return
        data = self._json_body(MAX_AUTH)
        record = self.server.auth.verify(data.get("username"), data.get("password"))
        if record is None:
            wait = limiter.failure(ip)
            if wait:
                self._json(429, {"error": "bloqueado", "retryAfter": wait})
            else:
                self._json(401, {"error": "credenciais"})
            return
        limiter.success(ip)
        remember = data.get("remember") is not False
        token, ttl = self.server.auth.make_token(record, long=remember)
        self._json(200, {"ok": True, "username": record["username"]}, self._cookie(token, ttl if remember else None))

    def _logout(self) -> None:
        self._json(200, {"ok": True}, self._cookie(None, None))

    def _password(self, user: str) -> None:
        data = self._json_body(MAX_AUTH)
        current = data.get("current")
        new = valid_password(data.get("next"))
        if not isinstance(current, str) or new is None:
            self._json(400, {"error": "invalido"})
            return
        if not self.server.auth.change_password(user, current, new):
            self._json(403, {"error": "senha-atual"})
            return
        record = self.server.auth.user(user)
        token, ttl = self.server.auth.make_token(record, long=True)
        self._json(200, {"ok": True}, self._cookie(token, ttl))

    def _logout_all(self, user: str) -> None:
        self._json_body(MAX_AUTH)
        record = self.server.auth.bump_sessions(user)
        if record is None:
            self._json(404, {"error": "missing"})
            return
        token, ttl = self.server.auth.make_token(record, long=True)
        self._json(200, {"ok": True}, self._cookie(token, ttl))

    def _data(self, user: str) -> None:
        snap = self.server.store.snapshot()
        snap["user"] = {"username": user}
        snap["version"] = VERSION
        self._json(200, snap)

    def _changes(self) -> None:
        since = self._int_query("since")
        if since is None:
            raise StoreError("since", 400)
        self._json(200, self.server.store.changes(since))

    def _doc_put(self, coll: str, doc_id: str) -> None:
        data = self._json_body()
        doc = data.get("doc")
        base = data.get("baseRev", None)
        if not isinstance(doc, dict) or (base is not None and (not isinstance(base, int) or base < 0)):
            self._json(400, {"error": "invalido"})
            return
        saved = self.server.store.put(coll, doc_id, doc, base)
        self._json(200, {"doc": saved, "seq": self.server.store.seq})

    def _file_upload(self) -> None:
        raw = self._body(MAX_FILE)
        if not raw:
            self._json(400, {"error": "vazio"})
            return
        name = unquote(self.headers.get("X-File-Name") or "")
        doc = self.server.store.add_file(raw, self.headers.get("Content-Type") or "", name)
        self._json(201, {"file": doc})

    def _file_get(self, file_id: str) -> None:
        found = self.server.store.file_path(file_id)
        if not found:
            self._json(404, {"error": "missing"})
            return
        path, ctype = found
        etag = f'"{file_id}"'
        headers = {
            "Cache-Control": "private, max-age=31536000, immutable",
            "ETag": etag,
            "Content-Security-Policy": "default-src 'none'; sandbox",
        }
        if etag in (self.headers.get("If-None-Match") or ""):
            self._send(304, b"", ctype, headers)
            return
        self._send(200, path.read_bytes(), ctype, headers)

    def _system(self) -> None:
        store = self.server.store
        info = store.stats()
        info.update(
            {
                "version": VERSION,
                "dataDir": str(self.server.data_dir),
                "onedrive": detect_onedrive(self.server.data_dir),
                "tunnelUrl": self.server.tunnel_url,
                "python": platform.python_version(),
                "platform": platform.platform(terse=True),
                "port": self.server.port,
            }
        )
        self._json(200, info)

    def _backup(self) -> None:
        with tempfile.TemporaryFile() as tmp:
            self.server.store.export_zip(tmp)
            size = tmp.tell()
            tmp.seek(0)
            name = f"rz-airsoft-backup-{datetime.now():%Y-%m-%d-%H%M}.zip"
            self._sent = True
            self._status = 200
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(size))
            self.send_header("Content-Disposition", f'attachment; filename="{name}"')
            self.send_header("Cache-Control", "no-store")
            self._common_headers()
            self.end_headers()
            while True:
                chunk = tmp.read(1024 * 256)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def _restore(self) -> None:
        header = self.headers.get("Content-Length")
        try:
            size = int(header or "0")
        except ValueError as exc:
            raise StoreError("length", 400) from exc
        if size <= 0:
            raise StoreError("vazio", 400)
        if size > MAX_RESTORE:
            self.close_connection = True
            raise StoreError("tamanho", 413)
        self._consumed = True
        fd, tmp_name = tempfile.mkstemp(prefix="rz-restore-", suffix=".zip")
        try:
            with os.fdopen(fd, "wb") as handle:
                remaining = size
                while remaining > 0:
                    chunk = self.rfile.read(min(remaining, 1024 * 256))
                    if not chunk:
                        raise StoreError("incompleto", 400)
                    handle.write(chunk)
                    remaining -= len(chunk)
            result = self.server.store.restore_zip(Path(tmp_name))
        finally:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
        self._json(200, {"ok": True, **result})

    def _legacy(self) -> None:
        self._json(200, self.server.store.legacy())

    # ------------------------------------------------------------ estático
    def _static(self, method: str, path: str, query: str) -> None:
        if method != "GET":
            self._json(405, {"error": "method"})
            return
        if path in LEGACY_PAGES:
            self._redirect(LEGACY_PAGES[path] + (f"?{query}" if query else ""))
            return
        if path == "/favicon.ico":
            path = "/assets/favicon.png"
        if path in ("/login", "/login/"):
            self._serve(self.server.web_dir / "login.html")
            return
        if is_app_route(path):
            if self._user() is None:
                target = path + (f"?{query}" if query else "")
                self._redirect("/login" + ("" if target in ("", "/") else "?next=" + quote(target, safe="")))
                return
            self._serve(self.server.web_dir / "index.html")
            return
        target = resolve_web(self.server.web_dir, path)
        if target is None:
            self._send(404, "Não encontrado".encode("utf-8"), "text/plain; charset=utf-8", {"Cache-Control": "no-store"})
            return
        self._serve(target)

    def _entry(self, path: Path) -> dict:
        st = path.stat()
        key = (st.st_mtime_ns, st.st_size)
        with self.server.static_lock:
            cached = self.server.static_cache.get(path)
            if cached and cached[0] == key:
                return cached[1]
        raw = path.read_bytes()
        ext = path.suffix.lower()
        entry = {
            "raw": raw,
            "gz": gzip.compress(raw, compresslevel=6) if ext in COMPRESSIBLE and len(raw) > 1024 else None,
            "etag": f'W/"{st.st_mtime_ns:x}-{st.st_size:x}"',
            "type": STATIC_TYPES.get(ext, "application/octet-stream"),
            "html": ext == ".html",
        }
        with self.server.static_lock:
            self.server.static_cache[path] = (key, entry)
        return entry

    def _serve(self, path: Path) -> None:
        if not path.is_file():
            self._send(404, "Não encontrado".encode("utf-8"), "text/plain; charset=utf-8")
            return
        entry = self._entry(path)
        headers = {"ETag": entry["etag"], "Cache-Control": "no-cache", "Vary": "Accept-Encoding"}
        inm = self.headers.get("If-None-Match") or ""
        if entry["etag"] in [tag.strip() for tag in inm.split(",")]:
            self._send(304, b"", entry["type"], headers, html=entry["html"])
            return
        body = entry["raw"]
        if entry["gz"] is not None and "gzip" in (self.headers.get("Accept-Encoding") or ""):
            body = entry["gz"]
            headers["Content-Encoding"] = "gzip"
        self._send(200, body, entry["type"], headers, html=entry["html"])
