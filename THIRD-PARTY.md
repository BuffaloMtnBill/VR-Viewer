# Third-party components

The local headset connection, hand rendering, VR interface and voice follow
`../3D-VR-Terrain`. Its MIT-licensed `lan.py`, `pairing.py`, `speech.py`,
`vr-hands.js`, `vr-voice.js` and `vr-commands.js`, and the pie menu, fingertip
tapping and keyboard of its `vr-watch.js`, are adapted here under the same names
(in `editor_vr/` and `editor_vr/static/`), as are its browser-test runner and
CI workflow. The 360° backgrounds in `editor_vr/static/backgrounds/` come from the
same project. The original license is retained in `THIRD-PARTY-TERRAIN-LICENSE.txt`.

Three.js r180 and its OrbitControls, GLTFLoader, and BufferGeometryUtils modules
are vendored in `editor_vr/static/vendor/`, with `THREE-LICENSE.txt`.
The generic WebXR Input Profiles hand models (version 1.0.19, MIT) are in
`static/vendor/hands/`, with their license. They were obtained from the terrain
project's existing vendor directory. Browser operation needs no CDN.

The IWER WebXR emulator and Playwright are development-only test tools. They are
not bundled or loaded by the app. faster-whisper (MIT) transcribes speech on the computer. Python dependencies are declared in
`pyproject.toml` and `requirements.txt` and retain their own licenses.
