"""One device that connects and never finishes its TLS handshake must not stop anyone else's requests (LAN-01)."""
import socket
import ssl
import threading
import time
import urllib.request

from flask import Flask

from vr_viewer import lan


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def test_an_idle_connection_does_not_block_the_https_listener(tmp_path, monkeypatch):
    monkeypatch.setattr(lan, "HANDSHAKE_SECONDS", 2)
    app = Flask(__name__)
    app.get("/")(lambda: "ok")
    port, pair = free_port(), tuple(map(str, lan.certificate(tmp_path, ["localhost", "127.0.0.1"])))
    threading.Thread(target=lan.serve_https, args=(app, "127.0.0.1", port, pair), daemon=True).start()
    insecure = ssl.create_default_context()
    insecure.check_hostname, insecure.verify_mode = False, ssl.CERT_NONE
    def get():
        with urllib.request.urlopen(f"https://127.0.0.1:{port}/", context=insecure, timeout=3) as response:
            return response.read()
    for _ in range(50):
        try:
            assert get() == b"ok"
            break
        except OSError:
            time.sleep(.1)
    with socket.create_connection(("127.0.0.1", port)):   # connects, then says nothing
        started = time.monotonic()
        assert get() == b"ok"
        assert time.monotonic() - started < 2, "the second request waited on the idle one"
