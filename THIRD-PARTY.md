# Third-party components

The local headset connection and hand-rendering approach was reviewed against
`../3D-VR-Terrain` as requested. Its MIT-licensed `lan.py`, `pairing.py`, and
`vr-hands.js` are adapted here as `editor_vr/lan.py`, `editor_vr/pairing.py`, and
`editor_vr/static/hand-skin.js`. The original license is retained in
`THIRD-PARTY-TERRAIN-LICENSE.txt`.

Three.js r180 and its OrbitControls, GLTFLoader, and BufferGeometryUtils modules
are vendored in `editor_vr/static/vendor/`, with `THREE-LICENSE.txt`.
The generic WebXR Input Profiles hand models (version 1.0.19, MIT) are in
`static/vendor/hands/`, with their license. They were obtained from the terrain
project's existing vendor directory. Browser operation needs no CDN.

The IWER WebXR emulator and Playwright are development-only test tools. They are
not bundled or loaded by the app. Python dependencies are declared in
`pyproject.toml` and `requirements.txt` and retain their own licenses.
