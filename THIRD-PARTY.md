# Third-party components

VR-Viewer is a view-only fork of Editor-VR, by the same author. Its local headset
connection, hand rendering, VR interface and voice follow the author's
3D-VR-Terrain project (public as
[3D-VR-Terrain-Model](https://github.com/BuffaloMtnBill/3D-VR-Terrain-Model)).
That project's MIT-licensed `lan.py`, `pairing.py`, `speech.py`, `vr-hands.js` and
`vr-commands.js`, and the pie menu and fingertip tapping of its `vr-watch.js`, are
adapted here under the same names (in `vr_viewer/` and `vr_viewer/static/`), as
are its browser-test runner and CI workflow. The 360° backgrounds in
`vr_viewer/static/backgrounds/` come from the same project. Its license is
retained in `THIRD-PARTY-TERRAIN-LICENSE.txt`.

Three.js r180 and its OrbitControls, GLTFLoader, and BufferGeometryUtils modules
are vendored in `vr_viewer/static/vendor/`, with `THREE-LICENSE.txt`.
The generic WebXR Input Profiles hand models (version 1.0.19, MIT) are in
`vr_viewer/static/vendor/hands/`, with their license. The browser needs no CDN.

The IWER WebXR emulator and Playwright are development-only test tools. They are
not bundled or loaded by the app. faster-whisper (MIT), an optional dependency,
transcribes speech on the computer. Python dependencies are declared in
`pyproject.toml` and retain their own licenses.
