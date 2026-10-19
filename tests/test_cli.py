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


def test_port_conflict_stops_the_server(monkeypatch, capsys, tmp_path):
    """With the port taken (here by a listening socket, as 3D-VR-Terrain would be on 8000), nothing starts."""
    import socket
    run = Mock()
    monkeypatch.setattr("flask.Flask.run", run)
    with socket.socket() as other:
        other.bind(("127.0.0.1", 0)); other.listen()
        port = other.getsockname()[1]
        assert cli.port_in_use("0.0.0.0", port) and cli.port_in_use("127.0.0.1", port)
        monkeypatch.setattr(sys, "argv", ["editor-vr", "--local", "--port", str(port), "--no-browser", "--data-dir", str(tmp_path / "data")])
        with pytest.raises(SystemExit) as error:
            cli.main()
    assert error.value.code == 1 and f"Port {port} is already in use" in capsys.readouterr().err
    assert not run.called and not (tmp_path / "data").exists()


def test_free_port_is_not_in_use():
    import socket
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0)); port = probe.getsockname()[1]
    assert not cli.port_in_use("127.0.0.1", port)


def test_default_port_is_8000(monkeypatch, tmp_path):
    run = Mock()
    monkeypatch.setattr("flask.Flask.run", run)
    monkeypatch.setattr(cli, "port_in_use", lambda host, port: False)
    monkeypatch.setattr(sys, "argv", ["editor-vr", "--local", "--no-browser", "--data-dir", str(tmp_path)])
    cli.main()
    assert run.call_args.kwargs["port"] == 8000
