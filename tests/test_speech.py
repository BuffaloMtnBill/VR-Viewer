"""VR dictation and voice commands: speech is transcribed on this computer, from plain samples, and never kept."""
import base64
import re

import numpy as np
import pytest

from editor_vr.server import create_app
from editor_vr.speech import tidy


class FakeTranscriber:
    def __init__(self, text="Widen this opening by 2 mm.", works=True):
        self.text, self.works, self.heard, self.purpose, self.vocabulary = text, works, None, None, None

    def available(self):
        return self.works

    def transcribe(self, samples, purpose="note", vocabulary=()):
        self.heard, self.purpose, self.vocabulary = samples, purpose, list(vocabulary)
        return tidy(self.text, purpose)


def speech(seconds=1.0, rate=16000, **extra):
    tone = (np.sin(np.arange(int(16000 * seconds)) / 16000 * 2 * np.pi * 440) * 12000).astype("<i2")
    return {"rate": rate, "samples": base64.b64encode(tone.tobytes()).decode(), **extra}


def client_for(tmp_path, transcriber):
    client = create_app(tmp_path, transcriber=transcriber).test_client()
    token = re.search(rb'name="editor-token" content="([^"]+)"', client.get("/").data).group(1).decode()
    return client, {"X-Editor-Token": token}


def test_dictation_is_transcribed_on_this_computer(tmp_path):
    fake = FakeTranscriber()
    client, headers = client_for(tmp_path, fake)
    response = client.post("/api/transcribe", headers=headers, json=speech())
    assert response.status_code == 200 and response.get_json() == {"text": "Widen this opening by 2 mm."}
    assert fake.purpose == "note" and fake.heard.dtype == np.float32 and len(fake.heard) == 16000
    assert not any((tmp_path).rglob("*.wav")), "Nothing is saved"


def test_commands_are_transcribed_expecting_commands(tmp_path):
    fake = FakeTranscriber("Open menu.")
    client, headers = client_for(tmp_path, fake)
    assert client.post("/api/transcribe", headers=headers, json=speech(purpose="command")).get_json() == {"text": "Open menu"}
    client.post("/api/transcribe", headers=headers, json=speech(purpose="command", vocabulary=["Pin a note", "<b>", 7, "x" * 99]))
    assert fake.vocabulary == ["Pin a note", "b", "x" * 40], "The menu's names reach Whisper, cleaned"
    assert client.post("/api/transcribe", headers=headers, json=speech(purpose="search")).status_code == 400


@pytest.mark.parametrize("payload,error", [
    (speech(rate=44100), "16000 samples per second"),
    ({"rate": 16000, "samples": "not base64!"}, "base64"),
    ({"rate": 16000, "samples": "AA=="}, "damaged"),
    (speech(seconds=31), "30 seconds"),
])
def test_bad_recordings_are_refused(tmp_path, payload, error):
    client, headers = client_for(tmp_path, FakeTranscriber())
    response = client.post("/api/transcribe", headers=headers, json=payload)
    assert response.status_code == 400 and error in response.get_json()["error"]


def test_transcribing_needs_the_page_token_and_the_engine(tmp_path):
    client, headers = client_for(tmp_path, FakeTranscriber(works=False))
    assert client.post("/api/transcribe", json=speech()).status_code == 403
    response = client.post("/api/transcribe", headers=headers, json=speech())
    assert response.status_code == 503 and "faster-whisper" in response.get_json()["error"]


def test_the_page_may_use_the_microphone(tmp_path):
    client, _ = client_for(tmp_path, FakeTranscriber())
    assert "microphone=(self)" in client.get("/").headers["Permissions-Policy"]


def test_the_headset_gets_the_simple_page(tmp_path):
    client, _ = client_for(tmp_path, FakeTranscriber())
    page = client.get("/").data.decode()
    assert "headset-page" in page and 'href="?full"' in page
