"""Local mode has no pairing or TLS, so it must stay on this computer."""
import sys
from unittest.mock import Mock

import pytest

from editor_vr import __main__ as cli


@pytest.mark.parametrize("host", ["0.0.0.0", "::", "192.168.0.50", "studio-pc", "localhost.example"])
def test_local_refuses_network_hosts(host, monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(sys, "argv", ["editor-vr", "--local", "--host", host, "--no-browser", "--data-dir", str(tmp_path)])
    with pytest.raises(SystemExit) as error:
        cli.main()
    assert error.value.code == 2 and "loopback" in capsys.readouterr().err


@pytest.mark.parametrize("host,url", [("localhost", "http://127.0.0.1:8099"), ("127.0.0.2", "http://127.0.0.2:8099"), ("::1", "http://[::1]:8099")])
def test_local_accepts_loopback(host, url, monkeypatch, capsys, tmp_path):
    run = Mock()
    monkeypatch.setattr("flask.Flask.run", run)
    monkeypatch.setattr(sys, "argv", ["editor-vr", "--local", "--host", host, "--port", "8099", "--no-browser", "--data-dir", str(tmp_path)])
    cli.main()
    assert run.call_args.kwargs["host"] == url.split("//")[1].rsplit(":", 1)[0].strip("[]")
    assert url in capsys.readouterr().out
