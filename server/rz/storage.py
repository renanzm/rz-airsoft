"""Armazenamento em arquivos JSON, pensado para pastas sincronizadas (OneDrive).

Cada coleção fica em ``db/<colecao>.json``. Cada documento tem ``rev``
(revisão própria, usada para detectar edição simultânea) e ``seq`` (sequência
global, usada pelo feed de alterações entre dispositivos). Fotos ficam em
``files/`` como arquivos comuns. Toda gravação é atômica e a versão anterior
de cada coleção vai para ``backups/db/`` em intervalos regulares.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import tempfile
import threading
import time
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, BinaryIO

from . import VERSION

COLLECTIONS = ("orders", "clients", "catalog", "settings", "files")
WRITABLE = frozenset({"orders", "clients", "catalog", "settings"})
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
LEGACY_KEY_RE = re.compile(r"^rz-[a-z0-9-]{1,64}$")
DB_FORMAT = "rz-db/1"
BACKUP_FORMAT = "rz-backup/1"
BACKUP_EVERY_SECONDS = 600
BACKUP_KEEP = 60
SAFETY_KEEP = 10
TOMBSTONE_DAYS = 120
MAX_DOC_BYTES = 2_000_000
MAX_RESTORE_UNCOMPRESSED = 6 * 1024 ** 3
SERVER_FIELDS = ("id", "rev", "seq", "updatedAt")
FILE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
FILE_NAME_RE = re.compile(r"^(f_[a-f0-9]{20})\.(jpg|png|webp)$")


class StoreError(Exception):
    """Erro com código estável para a API."""

    def __init__(self, code: str, status: int = 400, detail: str = "") -> None:
        super().__init__(detail or code)
        self.code = code
        self.status = status
        self.detail = detail


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")[:-4] + "Z"


def stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def is_iso_datetime(value: object) -> bool:
    if not isinstance(value, str) or not (10 <= len(value) <= 40):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def atomic_write_bytes(dest: Path, data: bytes) -> None:
    """Grava em arquivo temporário e troca de nome. Tenta de novo quando o
    OneDrive ou o antivírus seguram o arquivo por alguns milissegundos."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=".tmp-", suffix=".tmp", dir=dest.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        last_error: Exception | None = None
        for attempt in range(10):
            try:
                os.replace(tmp_name, dest)
                return
            except PermissionError as exc:
                last_error = exc
                time.sleep(0.05 * (attempt + 1))
        raise last_error or PermissionError(str(dest))
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def atomic_write_json(dest: Path, obj: Any, pretty: bool = False) -> None:
    if pretty:
        text = json.dumps(obj, ensure_ascii=False, indent=2) + "\n"
    else:
        text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    atomic_write_bytes(dest, text.encode("utf-8"))


def cleanup_tmp(folder: Path) -> None:
    if not folder.is_dir():
        return
    for entry in folder.glob(".tmp-*"):
        try:
            if entry.is_file():
                entry.unlink()
        except OSError:
            pass


def detect_onedrive(*paths: Path) -> bool:
    texts = [str(p) for p in paths]
    if any("onedrive" in text.lower() for text in texts):
        return True
    for name in ("OneDrive", "OneDriveCommercial", "OneDriveConsumer"):
        base = os.environ.get(name)
        if not base:
            continue
        base_n = os.path.normcase(os.path.abspath(base)).rstrip(os.sep)
        for text in texts:
            child = os.path.normcase(os.path.abspath(text))
            if child == base_n or child.startswith(base_n + os.sep):
                return True
    return False


def _sniff_image(head: bytes) -> str | None:
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


class Store:
    def __init__(self, data_dir: Path) -> None:
        self.dir = Path(data_dir).resolve()
        self.db_dir = self.dir / "db"
        self.files_dir = self.dir / "files"
        self.backup_dir = self.dir / "backups"
        self.lock = threading.RLock()
        self._cache: dict[str, tuple[tuple[int, int], dict]] = {}
        self._last_backup: dict[str, float] = {}
        self.warnings: list[str] = []
        self.dir.mkdir(parents=True, exist_ok=True)
        self.db_dir.mkdir(parents=True, exist_ok=True)
        self.files_dir.mkdir(parents=True, exist_ok=True)
        for folder in (self.dir, self.db_dir, self.files_dir):
            cleanup_tmp(folder)
        self._seq = 0
        with self.lock:
            for coll in COLLECTIONS:
                data = self._load(coll)
                self._seq = max(self._seq, self._max_seq(data))

    # ------------------------------------------------------------------ base
    def _path(self, coll: str) -> Path:
        return self.db_dir / f"{coll}.json"

    @staticmethod
    def _empty(coll: str) -> dict:
        return {"format": DB_FORMAT, "collection": coll, "horizon": 0, "docs": {}, "tombstones": {}}

    @staticmethod
    def _max_seq(data: dict) -> int:
        best = int(data.get("horizon") or 0)
        for doc in data["docs"].values():
            best = max(best, int(doc.get("seq") or 0))
        for tomb in data["tombstones"].values():
            best = max(best, int(tomb.get("seq") or 0))
        return best

    @staticmethod
    def _coerce(raw: Any, coll: str) -> dict:
        if not isinstance(raw, dict) or not isinstance(raw.get("docs"), dict):
            raise ValueError("formato")
        docs: dict[str, dict] = {}
        for key, doc in raw["docs"].items():
            if isinstance(key, str) and ID_RE.fullmatch(key) and isinstance(doc, dict):
                docs[key] = doc
        tombs: dict[str, dict] = {}
        raw_tombs = raw.get("tombstones") if isinstance(raw.get("tombstones"), dict) else {}
        for key, tomb in raw_tombs.items():
            if isinstance(key, str) and ID_RE.fullmatch(key) and isinstance(tomb, dict):
                tombs[key] = tomb
        horizon = raw.get("horizon")
        return {
            "format": DB_FORMAT,
            "collection": coll,
            "horizon": horizon if isinstance(horizon, int) and horizon >= 0 else 0,
            "docs": docs,
            "tombstones": tombs,
        }

    def _stat_key(self, path: Path) -> tuple[int, int] | None:
        try:
            st = path.stat()
        except FileNotFoundError:
            return None
        return (st.st_mtime_ns, st.st_size)

    def _load(self, coll: str) -> dict:
        path = self._path(coll)
        key = self._stat_key(path)
        if key is None:
            return self._empty(coll)
        cached = self._cache.get(coll)
        if cached and cached[0] == key:
            return cached[1]
        try:
            data = self._coerce(json.loads(path.read_text(encoding="utf-8")), coll)
        except (OSError, ValueError):
            data = self._recover(coll, path)
            key = self._stat_key(path) or key
        self._cache[coll] = (key, data)
        # O arquivo pode ter vindo de outro computador pelo OneDrive.
        self._seq = max(self._seq, self._max_seq(data))
        return data

    def _recover(self, coll: str, path: Path) -> dict:
        """Arquivo ilegível: guarda uma cópia e volta para o último backup bom."""
        folder = self.backup_dir / "db" / coll
        candidates = sorted(folder.glob("*.json"), key=lambda p: p.name, reverse=True) if folder.is_dir() else []
        for candidate in candidates:
            if candidate.name.startswith("corrupt-"):
                continue
            try:
                data = self._coerce(json.loads(candidate.read_text(encoding="utf-8")), coll)
            except (OSError, ValueError):
                continue
            folder.mkdir(parents=True, exist_ok=True)
            try:
                shutil.copy2(path, folder / f"corrupt-{stamp()}.json")
            except OSError:
                pass
            atomic_write_json(path, data)
            self.warnings.append(
                f"db/{coll}.json estava ilegível e foi restaurado do backup {candidate.name}."
            )
            return data
        try:
            if path.read_text(encoding="utf-8").strip() == "":
                return self._empty(coll)
        except OSError:
            pass
        raise StoreError("corrompido", 500, f"db/{coll}.json está ilegível e não há backup válido.")

    def _backup(self, coll: str, force: bool = False) -> None:
        path = self._path(coll)
        if not path.is_file():
            return
        now = time.time()
        folder = self.backup_dir / "db" / coll
        last = self._last_backup.get(coll)
        if last is None:
            existing = sorted(folder.glob("2*.json"), key=lambda p: p.name) if folder.is_dir() else []
            last = existing[-1].stat().st_mtime if existing else 0.0
        if not force and now - last < BACKUP_EVERY_SECONDS:
            return
        folder.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, folder / f"{stamp()}.json")
        self._last_backup[coll] = now
        backups = sorted(folder.glob("2*.json"), key=lambda p: p.name, reverse=True)
        for old in backups[BACKUP_KEEP:]:
            try:
                old.unlink()
            except OSError:
                pass

    def _save(self, coll: str, data: dict) -> None:
        self._backup(coll)
        path = self._path(coll)
        atomic_write_json(path, data)
        key = self._stat_key(path)
        if key is not None:
            self._cache[coll] = (key, data)

    def _next_seq(self) -> int:
        self._seq = max(self._seq + 1, time.time_ns() // 1_000_000)
        return self._seq

    def _prune(self, tombstones: dict[str, dict]) -> tuple[dict[str, dict], int]:
        limit = datetime.now(timezone.utc) - timedelta(days=TOMBSTONE_DAYS)
        keep: dict[str, dict] = {}
        dropped = 0
        for key, tomb in tombstones.items():
            at = tomb.get("at")
            try:
                when = datetime.fromisoformat(str(at).replace("Z", "+00:00"))
            except ValueError:
                when = None
            if when is not None and when < limit:
                dropped = max(dropped, int(tomb.get("seq") or 0))
                continue
            keep[key] = tomb
        return keep, dropped

    # ------------------------------------------------------------- leitura
    @property
    def seq(self) -> int:
        return self._seq

    def list(self, coll: str) -> list[dict]:
        self._check_coll(coll)
        with self.lock:
            return list(self._load(coll)["docs"].values())

    def get(self, coll: str, doc_id: str) -> dict | None:
        self._check_coll(coll)
        with self.lock:
            return self._load(coll)["docs"].get(doc_id)

    def snapshot(self) -> dict:
        with self.lock:
            collections = {coll: list(self._load(coll)["docs"].values()) for coll in COLLECTIONS}
            return {"seq": self._seq, "collections": collections}

    def changes(self, since: int) -> dict:
        with self.lock:
            found: list[tuple[int, dict]] = []
            for coll in COLLECTIONS:
                data = self._load(coll)
                if since < int(data.get("horizon") or 0):
                    return {"seq": self._seq, "reset": True, "changes": []}
                for doc in data["docs"].values():
                    seq = int(doc.get("seq") or 0)
                    if seq > since:
                        found.append((seq, {"collection": coll, "doc": doc}))
                for doc_id, tomb in data["tombstones"].items():
                    seq = int(tomb.get("seq") or 0)
                    if seq > since:
                        found.append((seq, {"collection": coll, "id": doc_id, "deleted": True}))
            found.sort(key=lambda pair: pair[0])
            return {"seq": self._seq, "reset": False, "changes": [item for _, item in found]}

    # ------------------------------------------------------------- escrita
    def _check_coll(self, coll: str, writable: bool = False) -> None:
        if coll not in COLLECTIONS:
            raise StoreError("colecao", 404)
        if writable and coll not in WRITABLE:
            raise StoreError("somente-leitura", 405)

    @staticmethod
    def _check_id(doc_id: str) -> None:
        if not isinstance(doc_id, str) or not ID_RE.fullmatch(doc_id):
            raise StoreError("id", 400)

    def put(self, coll: str, doc_id: str, doc: dict, base_rev: int | None) -> dict:
        self._check_coll(coll, writable=True)
        self._check_id(doc_id)
        return self._put(coll, doc_id, doc, base_rev)

    def _put(self, coll: str, doc_id: str, doc: dict, base_rev: int | None) -> dict:
        if not isinstance(doc, dict):
            raise StoreError("documento", 400)
        size = len(json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        if size > MAX_DOC_BYTES:
            raise StoreError("tamanho", 413)
        with self.lock:
            data = self._load(coll)
            current = data["docs"].get(doc_id)
            current_rev = int(current.get("rev") or 0) if current else 0
            if base_rev is not None and base_rev != current_rev:
                raise ConflictError(current)
            fresh = {key: value for key, value in doc.items() if key not in SERVER_FIELDS}
            created = current.get("createdAt") if current else fresh.get("createdAt")
            fresh["id"] = doc_id
            fresh["rev"] = current_rev + 1
            fresh["seq"] = self._next_seq()
            fresh["createdAt"] = created if is_iso_datetime(created) else utc_now()
            fresh["updatedAt"] = utc_now()
            docs = dict(data["docs"])
            docs[doc_id] = fresh
            tombs = dict(data["tombstones"])
            tombs.pop(doc_id, None)
            self._save(coll, {**data, "docs": docs, "tombstones": tombs})
            return fresh

    def delete(self, coll: str, doc_id: str, base_rev: int | None) -> None:
        self._check_coll(coll, writable=True)
        self._check_id(doc_id)
        self._delete(coll, doc_id, base_rev)

    def _delete(self, coll: str, doc_id: str, base_rev: int | None) -> None:
        with self.lock:
            data = self._load(coll)
            current = data["docs"].get(doc_id)
            if current is None:
                return
            if base_rev is not None and base_rev != int(current.get("rev") or 0):
                raise ConflictError(current)
            docs = dict(data["docs"])
            docs.pop(doc_id, None)
            tombs, dropped = self._prune(dict(data["tombstones"]))
            tombs[doc_id] = {"seq": self._next_seq(), "at": utc_now()}
            horizon = max(int(data.get("horizon") or 0), dropped)
            self._save(coll, {**data, "horizon": horizon, "docs": docs, "tombstones": tombs})

    # ---------------------------------------------------------------- fotos
    def add_file(self, content: bytes, declared_type: str, name: str) -> dict:
        kind = _sniff_image(content[:16])
        if kind is None or kind not in FILE_TYPES:
            raise StoreError("tipo", 415)
        if declared_type and declared_type.split(";")[0].strip().lower() not in (kind, "application/octet-stream"):
            raise StoreError("tipo", 415)
        file_id = "f_" + secrets.token_hex(10)
        ext = FILE_TYPES[kind]
        atomic_write_bytes(self.files_dir / f"{file_id}.{ext}", content)
        clean_name = re.sub(r"[\x00-\x1f\\/:*?\"<>|]+", "", name or "").strip()[:120] or f"foto.{ext}"
        doc = {
            "name": clean_name,
            "type": kind,
            "ext": ext,
            "size": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
        }
        return self._put("files", file_id, doc, None)

    def file_path(self, file_id: str) -> tuple[Path, str] | None:
        if not isinstance(file_id, str) or not re.fullmatch(r"f_[a-f0-9]{20}", file_id):
            return None
        doc = self.get("files", file_id)
        ext = (doc or {}).get("ext")
        candidates = [ext] if ext in FILE_TYPES.values() else list(FILE_TYPES.values())
        for candidate in candidates:
            path = self.files_dir / f"{file_id}.{candidate}"
            if path.is_file():
                kind = next(k for k, v in FILE_TYPES.items() if v == candidate)
                return path, kind
        return None

    def delete_file(self, file_id: str) -> None:
        found = self.file_path(file_id)
        with self.lock:
            if found:
                try:
                    found[0].unlink()
                except OSError:
                    pass
            if re.fullmatch(r"f_[a-f0-9]{20}", file_id or ""):
                self._delete("files", file_id, None)

    # ------------------------------------------------------------ legado
    def legacy(self) -> dict:
        """Chaves gravadas pela versão 2 (rz-*.json na raiz da pasta)."""
        keys: dict[str, str] = {}
        updated: dict[str, str] = {}
        for entry in sorted(self.dir.glob("rz-*.json")):
            key = entry.name[:-5]
            if not LEGACY_KEY_RE.fullmatch(key):
                continue
            try:
                item = json.loads(entry.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(item, dict) and isinstance(item.get("value"), str):
                keys[key] = item["value"]
                updated[key] = str(item.get("updatedAt") or "")
        return {"keys": keys, "updatedAt": updated}

    # ------------------------------------------------------------ backup
    def export_zip(self, dest: BinaryIO) -> None:
        with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            with self.lock:
                manifest = {
                    "format": BACKUP_FORMAT,
                    "app": "RZ Airsoft",
                    "version": VERSION,
                    "exportedAt": utc_now(),
                    "seq": self._seq,
                }
                zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
                for coll in COLLECTIONS:
                    data = self._load(coll)
                    zf.writestr(f"db/{coll}.json", json.dumps(data, ensure_ascii=False, indent=1))
                names = sorted(entry.name for entry in self.files_dir.iterdir() if FILE_NAME_RE.fullmatch(entry.name))
            for name in names:
                path = self.files_dir / name
                if path.is_file():
                    zf.write(path, f"files/{name}", compress_type=zipfile.ZIP_STORED)

    def safety_backup(self, label: str) -> Path:
        folder = self.backup_dir / "completo"
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / f"{label}-{stamp()}.zip"
        with open(target, "wb") as handle:
            self.export_zip(handle)
        olds = sorted(folder.glob(f"{label}-*.zip"), key=lambda p: p.name, reverse=True)
        for old in olds[SAFETY_KEEP:]:
            try:
                old.unlink()
            except OSError:
                pass
        return target

    def restore_zip(self, source: Path) -> dict:
        try:
            zf = zipfile.ZipFile(source)
        except (zipfile.BadZipFile, OSError) as exc:
            raise StoreError("zip", 400, "O arquivo não é um backup .zip válido.") from exc
        with zf:
            names = zf.namelist()
            if "manifest.json" not in names:
                raise StoreError("zip", 400, "O .zip não tem manifest.json do RZ Airsoft.")
            try:
                manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
            except ValueError as exc:
                raise StoreError("zip", 400, "manifest.json ilegível.") from exc
            if not isinstance(manifest, dict) or manifest.get("format") != BACKUP_FORMAT:
                raise StoreError("zip", 400, "Este backup não é do RZ Airsoft 3.")
            total = sum(info.file_size for info in zf.infolist())
            if total > MAX_RESTORE_UNCOMPRESSED:
                raise StoreError("zip", 413, "Backup grande demais.")
            collections: dict[str, dict] = {}
            files: list[zipfile.ZipInfo] = []
            for info in zf.infolist():
                name = info.filename
                if info.is_dir() or name == "manifest.json":
                    continue
                if "\\" in name or name.startswith("/") or ".." in name.split("/"):
                    raise StoreError("zip", 400, "Caminho inválido dentro do backup.")
                match_db = re.fullmatch(r"db/([a-z]+)\.json", name)
                if match_db and match_db.group(1) in COLLECTIONS:
                    coll = match_db.group(1)
                    try:
                        collections[coll] = self._coerce(json.loads(zf.read(info).decode("utf-8")), coll)
                    except ValueError as exc:
                        raise StoreError("zip", 400, f"{name} está ilegível.") from exc
                    continue
                if name.startswith("files/") and FILE_NAME_RE.fullmatch(name[6:]):
                    files.append(info)
            with self.lock:
                self.safety_backup("antes-de-restaurar")
                keep_names = {info.filename[6:] for info in files}
                for info in files:
                    atomic_write_bytes(self.files_dir / info.filename[6:], zf.read(info))
                for entry in self.files_dir.iterdir():
                    if FILE_NAME_RE.fullmatch(entry.name) and entry.name not in keep_names:
                        try:
                            entry.unlink()
                        except OSError:
                            pass
                restored_max = max((self._max_seq(data) for data in collections.values()), default=0)
                self._seq = max(self._seq, restored_max)
                horizon = self._next_seq()
                counts: dict[str, int] = {}
                for coll in COLLECTIONS:
                    data = collections.get(coll) or self._empty(coll)
                    data["horizon"] = horizon
                    self._backup(coll, force=True)
                    atomic_write_json(self._path(coll), data)
                    self._cache.pop(coll, None)
                    counts[coll] = len(data["docs"])
                return {"counts": counts, "files": len(files), "exportedAt": manifest.get("exportedAt")}

    # --------------------------------------------------------------- info
    def stats(self) -> dict:
        with self.lock:
            counts = {coll: len(self._load(coll)["docs"]) for coll in COLLECTIONS}
            last = ""
            for coll in COLLECTIONS:
                for doc in self._load(coll)["docs"].values():
                    value = str(doc.get("updatedAt") or "")
                    if value > last:
                        last = value
        db_bytes = sum(p.stat().st_size for p in self.db_dir.glob("*.json") if p.is_file())
        files_bytes = sum(p.stat().st_size for p in self.files_dir.iterdir() if p.is_file())
        return {
            "counts": counts,
            "dbBytes": db_bytes,
            "filesBytes": files_bytes,
            "lastWrite": last or None,
            "warnings": list(self.warnings),
        }


class ConflictError(StoreError):
    def __init__(self, current: dict | None) -> None:
        super().__init__("conflito", 409)
        self.current = current
