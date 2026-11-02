"""Testes do servidor: rodam com ``python server/app.py --self-test``.

Cada teste sobe o servidor numa porta livre, com pastas temporárias, e nunca
toca em dados/cloud.
"""

from __future__ import annotations

import http.client
import io
import json
import shutil
import sys
import tempfile
import threading
import unittest
import zipfile
from http.cookiejar import CookieJar
from pathlib import Path
from urllib import error, request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import rz.auth as auth_mod  # noqa: E402
from rz.http import AppServer, origin_allowed  # noqa: E402
from rz.storage import Store  # noqa: E402

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7\x9a\x83\x1d\x00\x00\x00\x00IEND\xaeB`\x82"
)


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: D401
        return None


class ServerCase(unittest.TestCase):
    password = "senha-de-teste-123"

    @classmethod
    def setUpClass(cls) -> None:
        cls._iters = (auth_mod.PBKDF2_ITERATIONS, auth_mod.PBKDF2_MIN_ACCEPTED)
        auth_mod.PBKDF2_ITERATIONS = 2000
        auth_mod.PBKDF2_MIN_ACCEPTED = 1000

    @classmethod
    def tearDownClass(cls) -> None:
        auth_mod.PBKDF2_ITERATIONS, auth_mod.PBKDF2_MIN_ACCEPTED = cls._iters

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="rz-test-"))
        self.web = self.tmp / "web"
        self.data = self.tmp / "data"
        (self.web / "css").mkdir(parents=True)
        (self.web / "index.html").write_text("<!doctype html><title>app</title>", encoding="utf-8")
        (self.web / "login.html").write_text("<!doctype html><title>login</title>", encoding="utf-8")
        (self.web / "css" / "app.css").write_text("body{color:red}" * 200, encoding="utf-8")
        (self.web / ".segredo.js").write_text("x", encoding="utf-8")
        self.httpd = AppServer(("127.0.0.1", 0), self.web, self.data, quiet=True)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.httpd.port}"
        self.jar = CookieJar()
        self.opener = request.build_opener(request.HTTPCookieProcessor(self.jar), NoRedirect)

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        shutil.rmtree(self.tmp, ignore_errors=True)

    # ------------------------------------------------------------ helpers
    def call(self, method: str, path: str, body=None, headers=None, raw: bytes | None = None, opener=None):
        data = raw
        hdrs = {"Origin": self.base}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            hdrs["Content-Type"] = "application/json"
        hdrs.update(headers or {})
        req = request.Request(self.base + path, data=data, method=method, headers=hdrs)
        try:
            with (opener or self.opener).open(req, timeout=30) as resp:
                return resp.status, dict(resp.headers), resp.read()
        except error.HTTPError as exc:
            return exc.code, dict(exc.headers), exc.read()

    def jcall(self, *args, **kwargs):
        status, headers, raw = self.call(*args, **kwargs)
        return status, headers, json.loads(raw.decode("utf-8")) if raw else None

    def setup_user(self) -> None:
        status, headers, body = self.jcall("POST", "/api/v1/auth/setup", {"username": "rzteste", "password": self.password})
        self.assertEqual(status, 201, body)


class AuthTests(ServerCase):
    def test_origin_rules(self) -> None:
        self.assertTrue(origin_allowed("https://abc.trycloudflare.com", "abc.trycloudflare.com", True, 8765))
        self.assertFalse(origin_allowed("https://evil.example", "abc.trycloudflare.com", True, 8765))
        self.assertFalse(origin_allowed("http://evil.example", "127.0.0.1:8765", False, 8765))
        self.assertTrue(origin_allowed("http://127.0.0.1:8765", "127.0.0.1:8765", False, 8765))
        self.assertTrue(origin_allowed("http://localhost:8765", "localhost:8765", False, 8765))
        self.assertFalse(origin_allowed("http://localhost:9999", "localhost:8765", False, 8765))

    def test_setup_login_logout(self) -> None:
        status, _, body = self.jcall("GET", "/api/v1/session")
        self.assertEqual(status, 200)
        self.assertTrue(body["setupRequired"])
        self.assertFalse(body["authenticated"])

        status, headers, body = self.jcall("POST", "/api/v1/auth/setup", {"username": "rzteste", "password": self.password})
        self.assertEqual(status, 201)
        cookie = headers.get("Set-Cookie", "")
        for part in (f"{self.httpd.cookie_name}=", "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age="):
            self.assertIn(part, cookie)
        self.assertNotIn("Secure", cookie)
        auth_text = (self.data / ".auth.json").read_text(encoding="utf-8")
        self.assertNotIn(self.password, auth_text)

        status, _, _ = self.jcall("POST", "/api/v1/auth/setup", {"username": "outro", "password": "outrasenha1"})
        self.assertEqual(status, 409)

        status, _, body = self.jcall("GET", "/api/v1/session")
        self.assertTrue(body["authenticated"])
        self.assertEqual(body["username"], "rzteste")

        status, headers, _ = self.jcall("POST", "/api/v1/auth/logout", {})
        self.assertEqual(status, 200)
        self.assertIn("Max-Age=0", headers.get("Set-Cookie", ""))
        status, _, _ = self.jcall("GET", "/api/v1/data")
        self.assertEqual(status, 401)

        status, _, body = self.jcall("POST", "/api/v1/auth/login", {"username": "rzteste", "password": "errada-123"})
        self.assertEqual(status, 401)
        self.assertEqual(body["error"], "credenciais")
        status, _, body = self.jcall("POST", "/api/v1/auth/login", {"username": "  RzTeste ", "password": self.password})
        self.assertEqual((status, body["username"]), (200, "rzteste"))
        status, headers, _ = self.jcall("POST", "/api/v1/auth/login", {"username": "rzteste", "password": self.password, "remember": False})
        self.assertEqual(status, 200)
        self.assertNotIn("Max-Age", headers.get("Set-Cookie", ""))
        status, _, _ = self.jcall("GET", "/api/v1/data")
        self.assertEqual(status, 200)

    def test_rate_limit(self) -> None:
        self.setup_user()
        codes = [self.jcall("POST", "/api/v1/auth/login", {"username": "rzteste", "password": "nao-e-essa"})[0] for _ in range(8)]
        self.assertEqual(codes[:7], [401] * 7)
        self.assertEqual(codes[7], 429)
        status, _, body = self.jcall("POST", "/api/v1/auth/login", {"username": "rzteste", "password": self.password})
        self.assertEqual(status, 429)
        self.assertGreater(body["retryAfter"], 0)

    def test_v2_auth_file_and_cookie_still_work(self) -> None:
        """O .auth.json e o cookie da versão 2 continuam valendo; a senha é re-hasheada."""
        import base64
        import hashlib
        import hmac
        import time

        # Mesmo formato da v2 (sem "sv"); iterações abaixo do alvo atual para exercitar o re-hash.
        old_iterations = auth_mod.PBKDF2_ITERATIONS - 500
        salt = bytes(range(16))
        digest = hashlib.pbkdf2_hmac("sha256", b"senha-antiga-123", salt, old_iterations)
        self.data.mkdir(parents=True, exist_ok=True)
        (self.data / ".auth.json").write_text(
            json.dumps({"users": [{"username": "renan", "salt": salt.hex(), "hash": digest.hex(), "iterations": old_iterations}]}),
            encoding="utf-8",
        )
        payload = base64.urlsafe_b64encode(json.dumps({"u": "renan", "exp": int(time.time()) + 600}, separators=(",", ":")).encode()).decode().rstrip("=")
        sig = hmac.new(self.httpd.auth.secret, payload.encode("ascii"), hashlib.sha256).hexdigest()
        status, _, _ = self.jcall("GET", "/api/v1/data", headers={"Cookie": f"{self.httpd.cookie_name}={payload}.{sig}"})
        self.assertEqual(status, 200)

        status, _, body = self.jcall("POST", "/api/v1/auth/login", {"username": "renan", "password": "senha-antiga-123"})
        self.assertEqual(status, 200, body)
        stored = json.loads((self.data / ".auth.json").read_text(encoding="utf-8"))["users"][0]
        self.assertEqual(stored["iterations"], auth_mod.PBKDF2_ITERATIONS)
        status, _, _ = self.jcall("POST", "/api/v1/auth/login", {"username": "renan", "password": "senha-antiga-123"})
        self.assertEqual(status, 200)

    def test_reset_password_from_terminal(self) -> None:
        """REDEFINIR_SENHA.bat: troca a senha com o servidor aberto e derruba as sessões."""
        import app as cli

        self.setup_user()
        self.assertEqual(self.jcall("GET", "/api/v1/data")[0], 200)
        answers = iter(["curta", "nova-senha-789", "nova-senha-789"])
        original = cli.ask_secret
        cli.ask_secret = lambda prompt: next(answers)
        try:
            self.assertEqual(cli.reset_password(self.data, ""), 0)
            self.assertEqual(cli.reset_password(self.data, "ninguem"), 1)
        finally:
            cli.ask_secret = original
        self.assertEqual(self.jcall("GET", "/api/v1/data")[0], 401)
        status, _, _ = self.jcall("POST", "/api/v1/auth/login", {"username": "rzteste", "password": self.password})
        self.assertEqual(status, 401)
        status, _, _ = self.jcall("POST", "/api/v1/auth/login", {"username": "rzteste", "password": "nova-senha-789"})
        self.assertEqual(status, 200)
        self.assertNotIn("nova-senha-789", (self.data / ".auth.json").read_text(encoding="utf-8"))

    def test_password_change_invalidates_old_sessions(self) -> None:
        self.setup_user()
        other_jar = CookieJar()
        other = request.build_opener(request.HTTPCookieProcessor(other_jar), NoRedirect)
        status, _, _ = self.jcall("POST", "/api/v1/auth/login", {"username": "rzteste", "password": self.password}, opener=other)
        self.assertEqual(status, 200)

        status, _, _ = self.jcall("POST", "/api/v1/auth/password", {"current": "errada-999", "next": "nova-senha-456"})
        self.assertEqual(status, 403)
        status, _, _ = self.jcall("POST", "/api/v1/auth/password", {"current": self.password, "next": "nova-senha-456"})
        self.assertEqual(status, 200)

        self.assertEqual(self.jcall("GET", "/api/v1/data")[0], 200)
        self.assertEqual(self.jcall("GET", "/api/v1/data", opener=other)[0], 401)
        status, _, _ = self.jcall("POST", "/api/v1/auth/login", {"username": "rzteste", "password": "nova-senha-456"}, opener=other)
        self.assertEqual(status, 200)
        status, _, _ = self.jcall("POST", "/api/v1/auth/logout-all", {})
        self.assertEqual(status, 200)
        self.assertEqual(self.jcall("GET", "/api/v1/data", opener=other)[0], 401)
        self.assertEqual(self.jcall("GET", "/api/v1/data")[0], 200)


class DataTests(ServerCase):
    def setUp(self) -> None:
        super().setUp()
        self.setup_user()

    def test_crud_conflict_and_changes(self) -> None:
        status, _, body = self.jcall("GET", "/api/v1/data")
        self.assertEqual(status, 200)
        start_seq = body["seq"]
        self.assertEqual(set(body["collections"]), {"orders", "clients", "catalog", "settings", "files"})

        doc = {"number": "0001", "client": {"name": "Lorison"}, "notes": "réplica \"M4\""}
        status, _, body = self.jcall("PUT", "/api/v1/c/orders/o_1", {"doc": doc, "baseRev": 0})
        self.assertEqual(status, 200, body)
        saved = body["doc"]
        self.assertEqual(saved["rev"], 1)
        self.assertEqual(saved["id"], "o_1")
        self.assertEqual(saved["notes"], doc["notes"])
        self.assertGreater(saved["seq"], start_seq)

        status, _, body = self.jcall("PUT", "/api/v1/c/orders/o_1", {"doc": {**doc, "notes": "outro"}, "baseRev": 0})
        self.assertEqual(status, 409)
        self.assertEqual(body["current"]["rev"], 1)

        status, _, body = self.jcall("PUT", "/api/v1/c/orders/o_1", {"doc": {**saved, "notes": "v2", "rev": 99, "seq": 1}, "baseRev": 1})
        self.assertEqual(status, 200)
        self.assertEqual(body["doc"]["rev"], 2)
        self.assertEqual(body["doc"]["createdAt"], saved["createdAt"])

        status, _, body = self.jcall("GET", f"/api/v1/changes?since={start_seq}")
        self.assertEqual(status, 200)
        self.assertFalse(body["reset"])
        self.assertEqual([c["doc"]["notes"] for c in body["changes"]], ["v2"])
        mid_seq = body["seq"]

        status, _, _ = self.jcall("DELETE", "/api/v1/c/orders/o_1?baseRev=1")
        self.assertEqual(status, 409)
        status, _, _ = self.jcall("DELETE", "/api/v1/c/orders/o_1?baseRev=2")
        self.assertEqual(status, 200)
        status, _, body = self.jcall("GET", f"/api/v1/changes?since={mid_seq}")
        self.assertEqual(body["changes"], [{"collection": "orders", "id": "o_1", "deleted": True}])
        self.assertEqual(self.jcall("GET", "/api/v1/data")[2]["collections"]["orders"], [])

        stored = json.loads((self.data / "db" / "orders.json").read_text(encoding="utf-8"))
        self.assertIn("o_1", stored["tombstones"])

    def test_validation(self) -> None:
        self.assertEqual(self.jcall("PUT", "/api/v1/c/nada/x1", {"doc": {}})[0], 404)
        self.assertEqual(self.jcall("PUT", "/api/v1/c/files/x1", {"doc": {}})[0], 405)
        self.assertEqual(self.jcall("PUT", "/api/v1/c/orders/a%2Fb", {"doc": {}})[0], 404)
        self.assertEqual(self.jcall("PUT", "/api/v1/c/orders/x1", {"doc": []})[0], 400)
        self.assertEqual(self.jcall("PUT", "/api/v1/c/orders/x1", {"doc": {}, "baseRev": "1"})[0], 400)
        status, _, _ = self.call("PUT", "/api/v1/c/orders/x1", raw=b'{"doc":{}}', headers={"Content-Type": "text/plain"})
        self.assertEqual(status, 415)
        status, _, body = self.jcall("PUT", "/api/v1/c/orders/x1", {"doc": {}}, headers={"Origin": "http://evil.example"})
        self.assertEqual((status, body["error"]), (403, "origin"))
        status, _, _ = self.jcall("PUT", "/api/v1/c/orders/x1", {"doc": {}}, headers={"Sec-Fetch-Site": "cross-site"})
        self.assertEqual(status, 403)
        big = {"doc": {"text": "x" * 2_100_000}}
        self.assertEqual(self.jcall("PUT", "/api/v1/c/orders/x1", big)[0], 413)

    def test_files(self) -> None:
        status, _, body = self.jcall("POST", "/api/v1/files", raw=PNG, headers={"Content-Type": "image/png", "X-File-Name": "foto%201.png"})
        self.assertEqual(status, 201, body)
        file_doc = body["file"]
        self.assertEqual(file_doc["type"], "image/png")
        self.assertEqual(file_doc["name"], "foto 1.png")
        status, headers, raw = self.call("GET", f"/api/v1/files/{file_doc['id']}")
        self.assertEqual(status, 200)
        self.assertEqual(raw, PNG)
        self.assertEqual(headers["Content-Type"], "image/png")
        self.assertIn("immutable", headers["Cache-Control"])

        status, _, _ = self.jcall("POST", "/api/v1/files", raw=b"<svg onload=alert(1)>", headers={"Content-Type": "image/svg+xml"})
        self.assertEqual(status, 415)
        status, _, _ = self.jcall("POST", "/api/v1/files", raw=PNG, headers={"Content-Type": "image/jpeg"})
        self.assertEqual(status, 415)

        self.assertEqual(self.jcall("DELETE", f"/api/v1/files/{file_doc['id']}", {})[0], 200)
        self.assertEqual(self.call("GET", f"/api/v1/files/{file_doc['id']}")[0], 404)

    def test_backup_and_restore(self) -> None:
        self.jcall("PUT", "/api/v1/c/clients/c_1", {"doc": {"name": "Bruno"}, "baseRev": 0})
        _, _, body = self.jcall("POST", "/api/v1/files", raw=PNG, headers={"Content-Type": "image/png"})
        file_id = body["file"]["id"]
        status, headers, raw = self.call("GET", "/api/v1/backup")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "application/zip")
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            names = set(zf.namelist())
            self.assertIn("manifest.json", names)
            self.assertIn("db/clients.json", names)
            self.assertIn(f"files/{file_id}.png", names)

        seq_before = self.jcall("GET", "/api/v1/data")[2]["seq"]
        self.jcall("PUT", "/api/v1/c/clients/c_2", {"doc": {"name": "Patrick"}, "baseRev": 0})
        status, _, body = self.jcall("POST", "/api/v1/restore", raw=raw, headers={"Content-Type": "application/zip"})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["counts"]["clients"], 1)
        names = [c["name"] for c in self.jcall("GET", "/api/v1/data")[2]["collections"]["clients"]]
        self.assertEqual(names, ["Bruno"])
        self.assertTrue(self.jcall("GET", f"/api/v1/changes?since={seq_before}")[2]["reset"])
        self.assertTrue(list((self.data / "backups" / "completo").glob("antes-de-restaurar-*.zip")))

        bad = io.BytesIO()
        with zipfile.ZipFile(bad, "w") as zf:
            zf.writestr("manifest.json", json.dumps({"format": "rz-backup/1"}))
            zf.writestr("../fora.json", "{}")
        status, _, _ = self.jcall("POST", "/api/v1/restore", raw=bad.getvalue(), headers={"Content-Type": "application/zip"})
        self.assertEqual(status, 400)
        status, _, _ = self.jcall("POST", "/api/v1/restore", raw=b"nao-e-zip", headers={"Content-Type": "application/zip"})
        self.assertEqual(status, 400)

    def test_legacy_and_system(self) -> None:
        (self.data / "rz-controle-manutencao.json").write_text(
            json.dumps({"value": "[{\"dono\":\"Bruno\"}]", "updatedAt": "2026-10-13T05:14:31Z"}), encoding="utf-8"
        )
        status, _, body = self.jcall("GET", "/api/v1/legacy")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body["keys"]["rz-controle-manutencao"])[0]["dono"], "Bruno")
        status, _, body = self.jcall("GET", "/api/v1/system")
        self.assertEqual(status, 200)
        self.assertIn("counts", body)
        self.assertEqual(body["port"], self.httpd.port)

    def test_keep_alive_after_rejected_body(self) -> None:
        conn = http.client.HTTPConnection("127.0.0.1", self.httpd.port, timeout=10)
        payload = json.dumps({"doc": {"a": 1}})
        conn.request("PUT", "/api/v1/c/orders/x1", body=payload, headers={"Content-Type": "application/json"})
        resp = conn.getresponse()
        self.assertEqual(resp.status, 401)
        resp.read()
        conn.request("GET", "/api/v1/health")
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        self.assertTrue(json.loads(resp.read())["ok"])
        conn.close()


class StaticTests(ServerCase):
    def test_routes(self) -> None:
        status, headers, _ = self.call("GET", "/ordens/abc")
        self.assertEqual(status, 302)
        self.assertEqual(headers["Location"], "/login?next=%2Fordens%2Fabc")
        self.assertEqual(self.call("GET", "/")[1]["Location"], "/login")
        status, headers, raw = self.call("GET", "/login")
        self.assertEqual(status, 200)
        self.assertIn("default-src 'self'", headers["Content-Security-Policy"])
        self.assertIn(b"login", raw)
        self.assertEqual(self.call("GET", "/controle.html?x=1")[1]["Location"], "/ordens?x=1")

        self.setup_user()
        status, _, raw = self.call("GET", "/ordens/abc")
        self.assertEqual(status, 200)
        self.assertIn(b"app", raw)

    def test_assets_cache_and_gzip(self) -> None:
        status, headers, raw = self.call("GET", "/css/app.css", headers={"Accept-Encoding": "gzip"})
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Content-Encoding"), "gzip")
        etag = headers["ETag"]
        status, _, _ = self.call("GET", "/css/app.css", headers={"If-None-Match": etag})
        self.assertEqual(status, 304)

    def test_blocked_paths(self) -> None:
        for path in ("/.segredo.js", "/../server/app.py", "/css/../../data/.secret", "/%2e%2e/x.js", "/nao-existe.js"):
            self.assertEqual(self.call("GET", path)[0], 404, path)


class StoreTests(unittest.TestCase):
    def test_recovers_corrupt_file_from_backup(self) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="rz-store-"))
        try:
            store = Store(tmp)
            store.put("orders", "o_1", {"number": "1"}, 0)
            store._backup("orders", force=True)
            (tmp / "db" / "orders.json").write_text("{quebrado", encoding="utf-8")
            again = Store(tmp)
            self.assertEqual([d["number"] for d in again.list("orders")], ["1"])
            self.assertTrue(again.warnings)
            self.assertTrue(list((tmp / "backups" / "db" / "orders").glob("corrupt-*.json")))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
