#!/usr/bin/env python
"""RZ Airsoft — servidor local (somente biblioteca padrão do Python).

    python server/app.py               abre o sistema neste computador
    python server/app.py --tunnel      abre também um endereço público (cloudflared)
    python server/app.py --self-test   roda os testes do servidor

Escuta em 127.0.0.1 (8765, depois 8766 e 8767). Os dados ficam em
dados/cloud/ ou na pasta indicada por --data-dir / RZ_DATA_DIR.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from rz import APP_ID, VERSION  # noqa: E402
from rz.auth import Auth, valid_password  # noqa: E402
from rz.http import AppServer, say  # noqa: E402
from rz.storage import StoreError  # noqa: E402
from rz.tunnel import Tunnel, find_cloudflared  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"
DATA_DIR = ROOT / "dados" / "cloud"
PORTS = (8765, 8766, 8767)


def running_at(port: int) -> str | None:
    """Versão do RZ Airsoft já aberto nesta porta, ou None."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/v1/health", timeout=0.8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None
    if isinstance(data, dict) and data.get("app") == APP_ID:
        return str(data.get("version") or "?")
    return None


def bind(host: str, ports: tuple[int, ...], data_dir: Path, quiet: bool) -> AppServer:
    errors = []
    for port in ports:
        try:
            return AppServer((host, port), WEB_DIR, data_dir, quiet=quiet)
        except OSError as exc:
            errors.append(f"{port}: {exc.strerror or exc}")
    raise SystemExit("Não foi possível abrir a porta " + ", ".join(str(p) for p in ports) + ". " + "; ".join(errors))


def open_browser(url: str) -> None:
    def _open() -> None:
        time.sleep(0.4)
        try:
            webbrowser.open(url)
        except Exception:
            say(f"Abra no navegador: {url}")

    threading.Thread(target=_open, daemon=True).start()


def start_tunnel(port: int, on_url) -> Tunnel | None:
    binary = find_cloudflared(ROOT)
    if binary is None:
        say("")
        say("  Acesso pela internet indisponível: falta tools\\cloudflared.exe.")
        say("  Baixe o cloudflared (Cloudflare) e coloque o .exe nessa pasta.")
        return None
    tunnel = Tunnel(binary, port, on_url)
    tunnel.start()
    say("  Abrindo o endereço público (pode levar alguns segundos)...")
    return tunnel


def announce_url(url: str) -> None:
    line = "  " + "=" * 64
    say("")
    say(line)
    say(f"  Endereço público:  {url}")
    say("  Abra em qualquer computador e entre com o seu usuário e senha.")
    say("  O link também aparece em Configurações > Acesso remoto.")
    say("  Não compartilhe o link. Ele muda cada vez que o túnel abre.")
    say(line)
    say("")


def ask_secret(prompt: str) -> str:
    import getpass

    try:
        return getpass.getpass(prompt, echo_char="*")  # Python 3.14+: mostra * ao digitar
    except TypeError:
        return getpass.getpass(prompt)


def reset_password(data_dir: Path, username: str) -> int:
    """Redefine a senha pelo terminal deste computador (para quem esqueceu)."""
    auth = Auth(data_dir)
    users = auth.usernames()
    if not users:
        say("Ainda não existe acesso criado. Abra o sistema e crie o usuário na tela de entrada.")
        return 1
    if not username:
        if len(users) == 1:
            username = users[0]
        else:
            say("Usuários: " + ", ".join(users))
            username = input("Qual usuário? ").strip()
    username = next((u for u in users if u.casefold() == username.strip().casefold()), username)
    if username not in users:
        say(f"Usuário “{username}” não encontrado. Usuários: {', '.join(users)}")
        return 1
    say(f"Redefinir a senha de “{username}”. A senha não aparece na tela nem fica salva em texto.")
    for _ in range(3):
        first = ask_secret("Nova senha (mínimo 8 caracteres): ")
        if valid_password(first) is None:
            say("A senha precisa ter de 8 a 128 caracteres.")
            continue
        if ask_secret("Repita a nova senha: ") != first:
            say("As duas senhas não conferem. Tente de novo.")
            continue
        auth.reset_password(username, first)
        say("")
        say(f"Pronto: senha de “{username}” redefinida.")
        say("Todas as sessões abertas foram encerradas. Entre de novo no sistema com a nova senha.")
        return 0
    say("Nada foi alterado.")
    return 1


def run_tests() -> int:
    import unittest

    suite = unittest.defaultTestLoader.discover(str(Path(__file__).resolve().parent / "tests"))
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    return 0 if result.wasSuccessful() else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Servidor do RZ Airsoft")
    parser.add_argument("--host", default="127.0.0.1", help="endereço de escuta (padrão 127.0.0.1)")
    parser.add_argument("--port", type=int, help="porta fixa (sem tentar outras)")
    parser.add_argument("--data-dir", help="pasta dos dados (padrão dados/cloud)")
    parser.add_argument("--tunnel", action="store_true", help="abre também um endereço público com o cloudflared")
    parser.add_argument("--no-browser", action="store_true", help="não abre o navegador")
    parser.add_argument("--quiet", action="store_true", help="não mostra as requisições")
    parser.add_argument("--self-test", action="store_true", help="roda os testes e sai")
    parser.add_argument("--reset-password", nargs="?", const="", metavar="USUARIO", help="redefine a senha pelo terminal e sai")
    args = parser.parse_args(argv)

    if args.self_test:
        return run_tests()

    data_dir = Path(args.data_dir or os.environ.get("RZ_DATA_DIR") or DATA_DIR)

    if args.reset_password is not None:
        try:
            return reset_password(data_dir, args.reset_password)
        except (KeyboardInterrupt, EOFError):
            say("\nCancelado. Nada foi alterado.")
            return 1
    ports = (args.port,) if args.port else PORTS

    for port in ports:
        version = running_at(port)
        if version is None:
            continue
        url = f"http://127.0.0.1:{port}/"
        say(f"O RZ Airsoft {version} já está aberto em {url}")
        if not args.tunnel:
            if not args.no_browser:
                open_browser(url)
                time.sleep(1)
            return 0
        tunnel = start_tunnel(port, announce_url)
        if tunnel is None:
            return 1
        try:
            while tunnel.process and tunnel.process.poll() is None:
                time.sleep(0.5)
        except KeyboardInterrupt:
            pass
        tunnel.stop()
        return 0

    try:
        httpd = bind(args.host, ports, data_dir, args.quiet)
    except StoreError as exc:
        say(f"Erro nos dados: {exc.detail or exc.code}")
        say("Restaure um backup em Configurações > Dados ou copie um arquivo de dados/cloud/backups/db/.")
        return 1

    url = f"http://127.0.0.1:{httpd.port}/"
    say("")
    say(f"  RZ Airsoft {VERSION}")
    say(f"  Neste computador: {url}")
    say(f"  Dados: {httpd.data_dir}")
    for warning in httpd.store.warnings:
        say(f"  Aviso: {warning}")
    say("  Deixe esta janela aberta. Ctrl+C encerra.")
    say("")

    tunnel = None
    if args.tunnel:
        def on_url(public: str) -> None:
            httpd.tunnel_url = public
            announce_url(public)

        tunnel = start_tunnel(httpd.port, on_url)

    if not args.no_browser:
        open_browser(url)

    try:
        httpd.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        say("Servidor encerrado.")
    finally:
        if tunnel:
            tunnel.stop()
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
