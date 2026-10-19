# Editor-VR

A Python web server and shared 3D workspace for developing print models from a desktop browser and Meta Quest. Open a scene of parts (a Visualizer model project, or STL/OBJ/3MF files), view it, select and add parts; then edit one part at a time: mark regions in VR or on the computer, add intent colors, categories and instructions, and submit an annotated part to the desktop edit queue.

**This version implements annotation and handoff. The geometry-editing pipeline is a placeholder.** Submitting saves the original geometry, a colored GLB and structured annotations; it does not execute the requested mesh changes.

## Start

Python 3.11+ is required. From this project folder:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python app.py
```

On Linux/macOS, `./run.sh` creates the environment and installs packages on its first run. On Windows, double-click `run.bat` with Python installed, or use:

```powershell
py -3 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python app.py
```

The default is **HTTPS on port 8020**, listening on the local network. The server prints the desktop URL, LAN addresses and a six-digit pairing PIN. The desktop browser opens automatically. `--no-browser` suppresses that launch; `--port 8025` selects another port; `--models DIR` picks the folder of model projects (default `~/Projects/Models`).

```bash
python app.py --no-browser
python app.py --local --port 8021 --no-browser
```

`--local` is desktop-only HTTP on loopback. A headset connecting over Wi-Fi needs the default HTTPS mode. The project launcher switches into `.venv` automatically when that environment exists.

## Connect a Quest

1. Put the computer and headset on the same network. Allow inbound TCP 8020 on the computer's private-network firewall if necessary. Guest Wi-Fi often isolates devices.
2. Open the printed `https://<computer LAN address>:8020` in Quest Browser. Accept the self-signed local certificate warning. On the desktop, **Connect headset** shows the address and PIN.
3. Enter the six-digit PIN on the headset's pairing page. Choose **Enter VR** after the model loads, and allow immersive VR/hand-tracking permissions if requested.
4. Keep the desktop page open. Tool settings, annotations, model transforms and queued requests update on both devices.

The HTTPS, certificate, pairing and hand-model approach follows the requested `3D-VR-Terrain` reference. Certificates cover the current LAN addresses and are reused across restarts; restart the server after changing networks. Cookies retain paired devices. `python app.py --forget-devices` removes their access. `EDITOR_VR_PAIRING_PIN=123456` can fix the PIN to six chosen digits; otherwise it changes on launch. The PIN is displayed only to the loopback desktop page and terminal.

## Scenes and parts

Editor-VR opens a **scene**: several parts placed together, the way the Visualizer shows a model. It starts on the scene, for viewing: select a part, add parts, or remove one. **Edit part** then shows the selected part on its own, with the marking tools; **◀ Back to scene** returns to the whole scene. Marks belong to the part they were made on and wait there while other parts are edited (the scene's part list counts them). Edit requests are made for one part at a time. The scene, the selected part and which part is being edited are shared by every device.

**Model projects.** **Open project…** lists the model projects on this computer, in the Visualizer's layout: one folder per model under `~/Projects/Models` (or the folder given with `--models DIR`, or `EDITOR_VR_MODELS`), each with `preview/*_assembled.3mf` scenes and `stl/` part files. Open an assembled scene, or all of a project's part files side by side. **＋ Add part** then offers the open project's part files, one at a time, added beside the scene. Only files inside the models folder can be opened, and nothing there is written.

**Files.** **＋ Import** takes STL (binary or ASCII), OBJ and 3MF files, 30 MB per upload, either added to the scene or opened as a new scene. As in the Visualizer, a part is a 3MF's object (placed by its build, with its `vis:category` and `vis:printfile` metadata), an OBJ's `o`/`g` group, an ASCII STL's named solid, or a separate closed piece of an STL that names none (a project's print file is kept whole: it is one part). Added parts stand on the scene's floor in a row to its right. Choose STL and OBJ units on import (millimeters by default); a 3MF states its own. Materials and textures are not loaded; export other CAD formats as a mesh first.

**Size for VR.** A part keeps at most **150,000 triangles** and a scene **600,000** in total, so a Quest draws it smoothly. Larger parts are simplified on loading (vertex clustering; the part list marks them, and requests note it). Marks still record their sample points and regions in native millimeters, which hold on the original print file; their face IDs refer to the simplified mesh included in the request packet. A scene holds up to 64 parts.

The demo scene is a fluted vessel on a stand. Model geometry and annotation points remain in native XYZ coordinates, in millimeters. The display treats model Z as print-up and centers what it shows without changing the source. The GLB export is Y-up in meters, with the mapping `[x,z,-y] / 1000`; its mesh extras carry native-mm annotations and that mapping. The STL and annotation JSON in the full packet stay in native millimeters.

The mesh boundary check reports whether every edge has two incident faces. It does not certify printability or repair self-intersections. Open meshes are allowed for annotation and labeled for checking before printing.

Opening another scene clears the draft marks, while submitted requests keep their own copy of the part and its annotations. Selections begun on a part that is no longer the one being edited are rejected.

## Desktop controls

- **Scene:** click a part (in the view or the part list) to select it; double-click it, or **Edit part**, to edit it. Left-drag orbits, right-drag pans, and the wheel zooms.
- **Editing a part:** click another part in the list to edit it instead; **◀ Back to scene** (or **Escape**) returns to the scene.
- **Inspect:** left-drag orbits, right-drag pans, and the wheel zooms the desktop camera.
- **Annotate:** left-click/drag uses the selected tool. Right-drag and the wheel still navigate; hold Shift to orbit. The camera view is local to each device, while the model's placement and annotation data are shared.
- **Fit, Turn, −, +:** reset, rotate or scale the shared displayed scene or part. This changes its presentation, not its print dimensions.
- **1–5:** choose spray, box, pin, measure or erase. **Escape:** cancel an unfinished selection.
- Set a color, a meaning for that color, an edit category, and a brush radius. Write the requested change, then **Submit to desktop**.

## VR controls

Both tracked hands and controllers work. Hands are drawn with locally hosted hand meshes, with a joint-dot fallback if those meshes cannot load. VR starts on the scene; editing a part has two modes, a shared setting the desktop follows:

| Action | Hands | Controllers |
| --- | --- | --- |
| Tap the watch, a menu, a key or the wrist button | Touch it with an index fingertip | Touch it with the small dot just in front of the controller |
| **Scene:** select a part | Point the laser at it and pinch | Point the laser at it and pull the trigger |
| **Scene:** move, turn and scale the scene | Pinch and drag (or make a fist); both hands to scale | Hold the grip button (or drag with the trigger); both to scale |
| **Inspect:** move and turn the model | Pinch (or make a fist) and move/turn the hand | Hold the trigger or grip button and move/turn |
| **Inspect:** scale it | Grip with both hands, move them apart/together, turn their line | The same with both controllers |
| **Annotate:** mark the model | Point the laser and pinch (spray: drag; 3D region: drag out the box) | Point the laser and hold the trigger |
| **Annotate:** move the model | Make a fist | Hold the grip button |

A second hand gripping while the first marks or grips turns both into a two-hand grip. The laser shows in the scene (for selecting) and in Annotate (in the mark's color), only while the hand is away from the menus. A pinch on a part selects it when you let go; moved more than a couple of centimeters first, it grips the scene instead. While a menu or the keyboard is open, the model is neither gripped nor marked. A window that has only just opened under a fingertip is not pressed by it until the finger lifts off and comes back.

**The watch on your left wrist** (on top of the left controller): tap its dial and a pie menu opens in front of you, within reach. A slice marked ▸ opens the next ring; every slice shows its current value; the middle shows where you are and goes back one ring (or closes the menu on the first ring). Tapping the watch again closes it from anywhere.

| Where | First ring | Inside |
| --- | --- | --- |
| Scene | Parts ▸ · Add part ▸ · Edit part · Reset view · Settings ▸ | **Parts:** every part (six to a ring, then More ▸), its category and marks; tapping one selects it. **Add part:** the open project's part files, added beside the scene (without a project, add parts on the computer) |
| Inspect (one part) | ◀ Scene · Reset view · Annotate · Settings ▸ | |
| Annotate (one part) | Tools ▸ · Mark style ▸ · Note · Undo mark · Submit · ◀ Scene · Settings ▸ | **Tools:** Move model (back to Inspect) and the five tools; choosing one closes the menu. **Mark style:** Color ▸ (the five colors and their meanings), Category ▸, Brush ▸ (−− / − / + / ++ in 5 mm and 0.5 mm steps), Meaning |
| Everywhere | | **Settings:** Background ▸ (Studio, the desktop's room; a 360° Mellow forest, Sandy desert or Moonlit lake; or the animated Desert day & night, with Pause sky / Run sky; remembered by the headset's browser), Voice on/off, Exit VR ▸ (asks first: Yes, exit or Stay) |

**The button on your right wrist** (on top of the right controller), tapped with the other hand: **Edit ▸** in the scene (once a part is selected); **Annotate ▸** in Inspect; **Submit · *n*** (the number of marks) in Annotate. Submit with no note opens the keyboard first, then sends when you tap Done.

**The keyboard** (Note, and Mark style ▸ Meaning) floats in front of you. **🎤 Speak** records from the headset's microphone (allow it when asked); **■ Stop** (or 20 seconds) ends it, and the words heard are added to the text, to check before tapping **Done**, which saves it to the shared workspace. **Cancel** keeps the old text.

**Voice commands.** While you are in VR the microphone stays open for commands:

| Say | Does |
| --- | --- |
| "Open menu" | Opens the watch's menu |
| "Open parts", "open tools", "show mark style", "open settings", "open background" | Opens the menu at that ring |
| "Edit part" | Edits the selected part |
| "Back to scene" / "show the scene" | Every part again |
| "Spray paint", "3D region", "pin a note", "erase mark", or "measure tool" (any tool + "tool") | Chooses that tool, in Annotate (while editing a part) |
| "Take a note" / "dictate" | Opens the keyboard, already listening |
| "Undo" | Undoes the last mark |
| "Submit" | Asks "Send to desktop?": **Yes, send** or **Not yet** |
| "Inspect mode" / "annotate mode" | Switches mode (in the scene, edits the selected part first) |
| "Reset view" | Puts the model back on its table |
| "Exit program" / "exit VR" | Leaves VR |

While a menu is open, any option in the current menus can be said, not only those on show (a part's name in the scene; "Smooth or blend", "Pin a note", "Brush" while marking): the menu moves to the ring where it lives, then does what tapping it would. On a tie the option on show wins. The brush steps, the confirmations, and Back and Close work only while on show. A caption in front of you shows what was heard. The headset finds where speech starts and stops by itself, so only those moments go to the computer, which transcribes them with Whisper (faster-whisper, on the CPU); nothing is sent while you are quiet, and nothing is saved. The first use downloads the speech model once (`small.en`, about 480 MB; `EDITOR_VR_WHISPER_MODEL=base.en` picks a smaller one). Listening pauses while you dictate, and **Settings ▸ Voice** switches it off.

**The headset's browser** gets a simple page: the scene, the connection and a large **Enter VR** (`?full` shows the whole desktop page there; `?headset` shows the simple page anywhere). Leaving VR returns to it; recenter the headset through the Quest system if its room reference changes.

## Toolkits

| Tool | What it records |
| --- | --- |
| Spray paint | Surface face IDs under a radius in model millimeters, plus stroke sample points. A normal-facing filter reduces marking through thin walls. Marks are triangle regions, not a baked texture or a geometry modification. |
| 3D region | Two model-space corners, an axis-aligned box and face centers inside that volume. Pinch/drag from a surface; the ray's starting depth is held while the hand moves, allowing movement in 3D. |
| Pin a note | A surface point and its triangle, with the current meaning/category/note. |
| Measure | Two surface points and a server-computed distance in millimeters. |
| Erase mark | Removes the latest annotation that includes the pointed face. Undo removes the latest draft annotation; Clear removes all draft marks. Submitted packets are kept. |

Colors and edit categories are intent metadata. They do not run any code or select an actual mesh-editing algorithm yet. Categories are size, texture, pattern and general. Each mark captures its current tool settings, and the overall submitted instruction is included separately in the packet.

### Animated backgrounds

**Desert day & night** is built in the scene rather than painted on a 360° image. The sun rises on your right (east), arcs high behind you and sets on your left. The moon follows the same way through a starry night. One light follows whichever is up, and it casts the model's shadow onto the stand:
- warm and low at sunrise and sunset;
- white at noon;
- a fainter blue by moonlight.

A glow from the sky keeps the model easy to work on at night. A whole day and night takes four minutes (`DAY_SECONDS` in `static/vr-environments.js`). **Pause sky** holds the time of day, and **Run sky** carries on.

To add another animated environment, add an entry with a `create(viewer)` function to `ENVIRONMENTS` in that file. It returns `update(phase)`, `dispose()` and `state()`. The day clock, the menu and the studio lights are handled for it. Like the other backgrounds, it is shown only in VR.

## Desktop handoff and export

Submitted requests appear in **The edit desk** with the part's name, a received status, marked-face count, author and instruction. They have an immutable snapshot of the part and its annotations. **Mark reviewed** changes their review status; it does not execute geometry changes.

Each edit packet is a ZIP containing:

- `model.stl`: the part's geometry in millimeters, as marked (simplified if the part was too large for VR).
- `annotated.glb`: selected faces colored by the annotation intent; full annotation metadata in mesh extras.
- `annotations.json`: schema `editor-vr.annotation-packet/1`, the part's name, scene, category and print file (from a Visualizer 3MF), whether it was simplified for VR, model/request IDs, instruction/category, points, face IDs, bounds and measurements.
- `README.txt`: coordinate and placeholder-processing notes.

The footer exports the current part's draft as an annotated GLB or full ZIP without submitting. Packets preserve what was selected even if later draft marks are removed or a different scene is opened.

## State, networking and extension points

Everything is local: Flask + flask-sock serve the UI and a WebSocket notification channel; Three.js r180 renders the desktop and immersive views. All browser libraries and hand models are vendored. Internet access is required to install Python dependencies, not during normal use.

The workspace is authoritative on the server. Serialized commands update a revisioned JSON snapshot. Clients reconnect automatically and fetch the latest state after reconnecting or waking; a five-second polling fallback operates while WebSockets are unavailable. The last committed tool setting/transform wins if devices change it simultaneously. Model-ID guards protect against applying a stale selection after a model upload. In-flight selections are local until released, then appear on other devices.

`data/` (ignored by Git) contains:

```text
data/
  workspace.json            # current settings, transform, marks and request index
  models/<id>.npz           # imported model geometry
  requests/<id>.zip         # immutable annotated handoff
  requests/<id>.glb         # immutable colored model
  tls/                      # local cert/key and hashed paired-device tokens
```

Use `--data-dir /path/to/workspace` or `EDITOR_VR_DATA` to choose another directory. One active shared workspace is supported per server. Keep backups of that directory if the requests matter. There is no automatic cleanup. Run one server process per workspace directory.

The main extension point for a future desktop editor is `Workspace.submit()` in `editor_vr/workspace.py`. It creates the immutable packet and queued record. A future worker can consume those packets and return a new mesh through `Workspace.install()`. No external AI service, shell-command runner or CAD integration is wired in this version.

Main endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/workspace` | Full current workspace |
| `POST /api/action` | Validated settings, transform, annotation, undo, remove, clear or review command |
| `POST /api/models` | Multipart STL/OBJ import, field `model` and optional `units` |
| `POST /api/submit` | Idempotent request snapshot with client-generated request ID |
| `GET /api/live` | WebSocket change notifications and presence |
| `GET /api/models/<id>/mesh` | Binary `EVR1` transport: counts, float32 mm vertices, uint32 face indices |
| `GET /api/export/glb` or `/zip` | Current draft export |
| `GET /api/requests/<id>/packet` | Submitted immutable packet |

Mutations require the page's per-process request token and same-origin checks. Remote devices require pairing in HTTPS mode. This is a trusted private-network workstation application, not a public hosting service.

## Verification

```bash
.venv/bin/python -m pip install pytest
.venv/bin/python -m pytest -q
```

Browser checks use Playwright/Chromium; VR checks use the IWER Meta Quest 3 emulator. Set them up once, then run them all (the runner starts its own local test server with a fresh data folder, and runs the tests one at a time, since they change the same workspace):

```bash
npm install
npm run setup          # Playwright's Chromium
npm test               # tests/browser.cjs, voice-browser.cjs, vr-browser.cjs
npm test -- vr voice   # some of them
```

`EDITOR_VR_TEST_PORT` picks another port (default 8021), `EDITOR_VR_CHROMIUM` another Chromium. A test can also run alone against a server you started, with `EDITOR_VR_URL`; `EDITOR_VR_INPUTS=hand` runs the VR test with tracked hands only. Screenshots are written to `test-results/`. For the HTTPS/LAN test, start a default HTTPS server on port 8022 and set `EDITOR_VR_LAN_URL=https://<LAN-IP>:8022`; `npm test` then includes `tests/https-browser.cjs`, which checks real pairing, secure cookies, WSS sync and PIN privacy using isolated browser sessions. GitHub Actions runs the Python tests on Linux, Windows and macOS, and the browser tests on Linux.

Automated XR testing exercises emulated controllers and tracked hands; it does not replace checking comfort, text legibility, hand occlusion and certificate acceptance on a physical Quest. See `THIRD-PARTY.md` for the terrain-derived connection code and vendored asset licenses.
