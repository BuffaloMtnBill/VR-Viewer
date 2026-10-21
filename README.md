# VR-Viewer

View the 3D models you make (STL, OBJ and 3MF) on your computer and in a Meta Quest, at the same time. VR-Viewer is a small Python web server: the desktop browser and the headset's browser show the same scene. Select a part on one and it is selected on the other. In VR you pick parts with a laser, pick the model up in your hand, turn and zoom it, and look at it in a studio, a forest, a desert or by a lake.

Give it a model on the command line, or browse for one from the menu: **Open…** on the computer, or **Open ▸** on the watch in VR. Model files are only read, never changed.

VR-Viewer is the view-only version of Editor-VR. It keeps the scene, the part handling and the VR interface, and leaves out the marking tools and edit requests.

## Install

Python 3.11 or newer is required. Install with pip, straight from GitHub:

```bash
pip install "vr-viewer @ git+https://github.com/BuffaloMtnBill/VR-Viewer"
```

Voice commands in VR are optional. They transcribe speech on your computer with Whisper (faster-whisper), which is a larger download:

```bash
pip install "vr-viewer[voice] @ git+https://github.com/BuffaloMtnBill/VR-Viewer"
```

`pipx install "vr-viewer @ git+https://github.com/BuffaloMtnBill/VR-Viewer"` works as well, and keeps it in its own environment. From a checkout, `pip install -e ".[voice]"` installs it in place. Or run `./run.sh` (Linux and macOS) or `run.bat` (Windows), which create `.venv` and install it there on first use.

## Run

```bash
vr-viewer                          # the last scene (the demo the first time); open models from the menu
vr-viewer castle.3mf               # open a model
vr-viewer tower.stl gate.stl       # several files together, each one part
vr-viewer ~/Projects/Models/Castle/stl   # every model file in a folder
vr-viewer part.obj --units cm      # STL and OBJ files that are not in millimeters
```

The server prints the desktop address, the headset addresses and a six-digit pairing PIN, and opens the desktop page in your browser. `python -m vr_viewer` does the same as `vr-viewer`.

| Option | |
| --- | --- |
| `MODEL ...` | STL, OBJ or 3MF files, or folders of them, to open as the scene |
| `--units mm\|cm\|m` | Units of the STL and OBJ files named here (3MF files state their own) |
| `--root DIR` | The folder the file browser may show, with everything inside it (default your home folder, or `VR_VIEWER_ROOT`) |
| `--port 8000` | The port (default 8000). If another program has it, VR-Viewer says so and does not start |
| `--local` | Desktop only: plain HTTP on this computer, with no headset |
| `--no-browser` | Do not open the desktop page |
| `--data-dir DIR` | Where to keep working copies, the certificate and paired devices (or `VR_VIEWER_DATA`) |
| `--forget-devices` | Forget every paired headset |

A model named on the command line is checked before anything starts: a mistyped path or a file that is not a model stops with a message.

## Connect a Quest

1. Put the computer and headset on the same network. Allow inbound TCP 8000 on the computer's private-network firewall if necessary. Guest Wi-Fi often isolates devices.
2. Open the printed `https://<computer address>:8000` in Quest Browser and accept the self-signed certificate warning. On the desktop, **Connect headset** shows the address and PIN.
3. Enter the PIN on the headset's pairing page, then choose **Enter VR**.

The certificate covers the computer's current network addresses and is reused across restarts; restart the server after changing networks. A paired headset stays paired (by cookie) until `--forget-devices`. `VR_VIEWER_PAIRING_PIN=123456` fixes the PIN; otherwise it changes on every start. Only the computer itself and the terminal show the PIN.

## Opening models

**The file browser** shows the folders and STL, OBJ and 3MF files under the root folder (your home folder unless `--root` says otherwise), starting in the folder of the model that is open. Hidden folders, other files and links that lead out of the root are not shown, and nothing outside the root can be opened.

- **Open as the scene** replaces the scene with the file. **Add beside the scene** stands it on the scene's floor, in a row to the right.
- **Open every model here** opens all the model files in the folder (up to 24) together.
- On the desktop, **＋ Upload** sends files from the device you are using instead (30 MB per upload). This is useful for a model that is not on the computer running VR-Viewer.

**Parts.** A model opens as a scene of parts, the way the Visualizer sees it:
- a 3MF's objects, placed by its build, with their `vis:category` and `vis:printfile` metadata;
- an OBJ's `o`/`g` groups;
- an ASCII STL's named solids;
- the separate closed pieces of an STL that names none.

A file added beside a scene, or opened among several, is kept whole as one part (a 3MF still gives its objects). Materials and textures are not loaded; export other CAD formats as a mesh first.

**Size for VR.** A part keeps at most 150,000 triangles and a scene 600,000, so a Quest draws it smoothly. Larger parts are simplified when they load (by vertex clustering). The part list marks them, and their stats give the original count. A scene holds up to 64 parts.

## The desktop page

- **Scene:** click a part (in the view or the part list) to select it. The selected part glows with a pulsing outline, and **Selected part** on the right gives its size, triangles, whether its mesh is closed, its category, print file and file. **Color** paints it on every device.
- **View part** (or a double-click) shows the part on its own. **◀ Back to scene** (or **Escape**) shows every part again.
- **Remove** takes a part out of the scene (its file is untouched).
- Left-drag orbits, right-drag pans, and the wheel zooms. **Fit, Turn, −, +** reset, turn or scale the shared placement; **Wire** shows the mesh as wireframe on this screen.

The model's placement is shared by every device. The camera is your own.

## In VR

Both tracked hands and controllers work.

| Action | Hands | Controllers |
| --- | --- | --- |
| Tap the watch, a menu or the wrist button | Touch it with an index fingertip | Touch it with the small dot just in front of the controller |
| Select a part | Point the laser at it and pinch | Point the laser at it and pull the trigger |
| Hold the model and carry it (it moves and turns with your hand) | Pinch on the model itself | Touch it and hold the trigger |
| Turn it about its center | Make a fist and turn your hand | Hold the grip button and turn the controller |
| Drag it | Pinch anywhere else and move your hand | Hold the trigger away from it and move |
| Zoom it and turn it about the vertical | Pinch with both hands: apart to zoom in, together to zoom out | The same with both triggers |

"The model" is the whole scene, or the part shown on its own. While a hand grips, its tracking is steadied against jitter, so letting go doesn't nudge the model.

**The selected part** glows, and a card floats above it with its name and **View ▸**. Point the laser at View ▸ and pinch, or tap it with a fingertip. While a part is shown alone, its card reads **◀ Scene**. **Stats** adds its size, triangles, whether its mesh is closed, its category and its file to the card.

**The watch on your left wrist** (on top of the left controller): tap its dial and a pie menu opens in front of you. A slice marked ▸ opens the next ring; the middle goes back one ring, or closes the menu on the first.

| Where | First ring | Inside |
| --- | --- | --- |
| Scene | Parts ▸ · Open ▸ · Add part ▸ · View part · Part ▸ (with a part selected) · Reset view · Settings ▸ | **Parts:** every part, six to a ring, then More ▸. **Open / Add part:** the file browser, a ring per folder: Up, its folders, Open them all, and its model files. Tap a file to open it, or to add it beside the scene. **Part:** View part, Stats, Color ▸ (Gray, Red, Orange, Yellow, Green, Blue), Unselect |
| One part | ◀ Scene · Reset view · Stats · Color ▸ · Settings ▸ | |
| Everywhere | | **Settings:** Background ▸ (Studio; a 360° Mellow forest, Sandy desert or Moonlit lake; or the animated Desert day & night, with Pause sky / Run sky), Voice on/off, Exit VR ▸ (asks first) |

**The button on your right wrist**, tapped with the other hand: **View ▸** in the scene (once a part is selected), **◀ Scene** while one part is shown.

**Voice commands** (with `vr-viewer[voice]` installed). While you are in VR the microphone stays open for commands:

| Say | Does |
| --- | --- |
| "Open menu" | Opens the watch's menu |
| "Open parts", "open files", "open settings", "open background" | Opens the menu at that ring |
| "View part" | Shows the selected part on its own |
| "Back to scene" | Every part again |
| "Show stats", "Hide stats" | The part's stats on its card |
| "Make it blue" (gray, red, orange, yellow, green) | Paints the selected part |
| "Change color" | Opens Color |
| "Unselect" | Selects nothing |
| "Reset view" | Puts the model back on its table |
| "Exit program" / "exit VR" | Leaves VR |

While a menu is open, any option on show can be said, such as a part's name, a folder or a file in the browser, More or Back. So can any option elsewhere in the current menus ("Blue", "Background"): the menu moves to where that option is, then acts as a tap would. The headset decides where speech starts and stops, so only those moments go to the computer. Nothing is sent while you are quiet, and nothing is saved. The first use downloads the speech model once (`small.en`, about 480 MB; `VR_VIEWER_WHISPER_MODEL=base.en` picks a smaller one). **Settings ▸ Voice** switches it off.

**Desert day & night** is built in the scene rather than painted on a 360° image. The sun rises on your right, arcs behind you and sets on your left; the moon follows through a starry night, and the light that is up casts the model's shadow onto the stand. A whole day takes four minutes.

**The headset's browser** gets a simple page: the scene, the connection and a large **Enter VR**. `?full` shows the whole desktop page there; `?headset` shows the simple page anywhere.

## How it works

Everything is local. Flask and flask-sock serve the page and a WebSocket notification channel; Three.js renders the desktop and immersive views. All browser libraries and hand models are bundled, so no internet connection is needed after installing.

The server holds the shared state: the scene, the selection, which part is shown, part colors and the model's placement. Commands are applied one at a time and every device fetches the new state. Clients reconnect on their own, with a five-second polling fallback.

The data folder (`~/.local/share/vr-viewer` on Linux, `~/Library/Application Support/vr-viewer` on macOS, `%LOCALAPPDATA%\vr-viewer` on Windows) contains:

```text
workspace.json       # the scene, selection, colors and placement
models/<id>.npz      # working copies of the open scene's parts (removed when they leave the scene)
tls/                 # the local certificate and key, and hashed paired-device tokens
```

Changes need the page's per-process token and pass same-origin checks. Other devices must pair in HTTPS mode. VR-Viewer is meant for a trusted private network, not public hosting. A paired headset can browse the files under the root folder, so choose `--root` to suit.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/workspace` | The current state |
| `POST /api/action` | Select, stage (scene or one part), transform, part color, remove a part |
| `GET /api/files?path=` | A folder's subfolders and model files, under the root |
| `POST /api/files/open` | Open a file or folder as the scene (`mode: open`), or add it (`mode: add`) |
| `POST /api/models` | Multipart upload, field `model`, optional `units` and `mode` |
| `GET /api/models/<id>/mesh` | Binary `EVR1` transport: counts, float32 mm vertices, uint32 face indices |
| `GET /api/live` | WebSocket change notifications and presence |
| `POST /api/transcribe` | Voice commands: 16 kHz samples to text, on this computer |

## Tests

```bash
pip install -e ".[test]"
python -m pytest -q
```

Browser tests use Playwright and Chromium; the VR tests use Meta's IWER Quest 3 emulator, with controllers and with tracked hands. Set them up once, then run them. The runner starts its own `--local` server on port 8021 with a fresh data folder and a small folder of models for the file browser.

```bash
npm install
npm run setup          # Playwright's Chromium
npm test               # tests/browser.cjs, voice-browser.cjs, vr-browser.cjs
npm test -- vr voice   # some of them
```

`VR_VIEWER_TEST_PORT` picks another port, `VR_VIEWER_CHROMIUM` another Chromium. `VR_VIEWER_INPUTS=hand` runs the VR test with tracked hands only. Screenshots go to `test-results/`. For the HTTPS test, start a default HTTPS server on port 8022 and set `VR_VIEWER_LAN_URL=https://<LAN-IP>:8022`; `npm test` then includes `tests/https-browser.cjs`, which checks real pairing, secure cookies and WSS sync. GitHub Actions runs the Python tests on Linux, Windows and macOS, builds and installs the package, and runs the browser tests on Linux.

Emulated XR checks the controls; it does not replace checking comfort, legibility and certificate acceptance on a real Quest.

## License

MIT; see `LICENSE`. `THIRD-PARTY.md` lists the bundled libraries, hand models and backgrounds, and their licenses.
