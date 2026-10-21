"""Speech to text on this computer with Whisper (faster-whisper), for VR voice commands.

The headset records and sends plain 16 kHz samples (no audio file to decode); they stay in memory and nothing is
saved. The model (VR_VIEWER_WHISPER_MODEL, default small.en, about 480 MB) is downloaded once, on first use.
"""
import base64
import binascii
import os
import re
from threading import Lock

import numpy as np

RATE = 16000
MAX_SECONDS = 30
PROMPTS = {
    # Short clips heard while VR listens for its voice commands: told what to expect, Whisper hears them reliably.
    "command": "Open menu. Open files. View part. Show stats. Make it blue. Back to scene. Reset view. Exit program.",
}


class Transcriber:
    def __init__(self, model_name=None):
        self.model_name = model_name or os.environ.get("VR_VIEWER_WHISPER_MODEL", "small.en")
        self._model = None
        self._lock = Lock()

    @staticmethod
    def available():
        try:
            import faster_whisper  # noqa: F401
        except ImportError:
            return False
        return True

    def _load(self):
        with self._lock:
            if self._model is None:
                from faster_whisper import WhisperModel
                self._model = WhisperModel(self.model_name, device="cpu", compute_type="int8")
            return self._model

    def transcribe(self, samples, purpose="command", vocabulary=()):
        model = self._load()
        prompt = PROMPTS[purpose] + "".join(f" {word}." for word in vocabulary)
        segments, _ = model.transcribe(samples, language="en", beam_size=5, vad_filter=True, initial_prompt=prompt)
        return tidy(" ".join(segment.text.strip() for segment in segments), purpose)


def tidy(text, purpose="command"):
    """A command loses its closing full stop."""
    text = re.sub(r"\s+", " ", text).strip()
    return text.rstrip(".").strip() if purpose == "command" else text


def purpose_of(payload):
    purpose = payload.get("purpose", "command") if isinstance(payload, dict) else "command"
    if purpose not in PROMPTS:
        raise ValueError("purpose is command.")
    return purpose


def vocabulary_of(payload):
    """The names a command may be (the menu's options), to tell Whisper what to expect: plain short text only."""
    words = payload.get("vocabulary", []) if isinstance(payload, dict) else []
    if not isinstance(words, list):
        raise ValueError("vocabulary is a list of names.")
    cleaned = [re.sub(r"[^\w\s:+'-]", "", word).strip()[:40] for word in words[:40] if isinstance(word, str)]
    return [word for word in cleaned if word]


def decode_samples(payload):
    """16-bit little-endian mono samples at 16 kHz, base64-encoded, as float32 in [-1, 1]."""
    if not isinstance(payload, dict):
        raise ValueError("Send the recording as JSON.")
    if payload.get("rate") != RATE:
        raise ValueError(f"Send the recording at {RATE} samples per second.")
    try:
        raw = base64.b64decode(payload.get("samples", ""), validate=True)
    except (binascii.Error, TypeError, ValueError):
        raise ValueError("The recording is not valid base64.") from None
    if len(raw) % 2 or not raw:
        raise ValueError("The recording is empty or damaged.")
    if len(raw) > RATE * MAX_SECONDS * 2:
        raise ValueError(f"Keep a recording under {MAX_SECONDS} seconds.")
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
