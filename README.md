# Editor-VR

A Python web server and shared 3D workspace for developing print models from a desktop browser and Meta Quest. View, move, rotate and scale a model; mark regions in VR or on the computer; add intent colors, categories and instructions; submit an annotated model to the desktop edit queue.

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

The default is **HTTPS on port 8020**, listening on the local network. The server prints the desktop URL, LAN addresses and a six-digit pairing PIN. The desktop browser opens automatically. `--no-browser` suppresses that launch; `--port 8025` selects another port.

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

## Models and coordinates

A closed fluted vessel is provided as a built-in test model. **Import model** accepts STL (binary or ASCII) and OBJ meshes, up to **100,000 triangles**, **300,000 input vertices**, and **30 MB**. Choose the file's units on import. Millimeters are the default; centimeters and meters are converted to millimeters. OBJ supports geometry, negative indices and fan triangulation of convex polygons; triangulate concave polygons in the source application first. Materials and OBJ texture references are not loaded. Export other CAD formats as a mesh first.

Model geometry and annotation points remain in native XYZ coordinates, in millimeters. The display treats model Z as print-up and recenters it without changing the source file. Face indices are stable for the imported triangulation. The GLB export is Y-up in meters, with the mapping `[x,z,-y] / 1000`; its mesh extras carry native-mm annotations and that mapping. The STL and annotation JSON in the full packet stay in native millimeters.

The mesh boundary check reports whether every edge has two incident faces. It does not certify printability or repair self-intersections. Open meshes are allowed for annotation and labeled for checking before printing.

Importing another model or loading the demo clears current draft marks, while submitted requests retain their original model and annotations. Selections begun on an older model are rejected after a model change.

## Desktop controls

- **Inspect:** left-drag orbits, right-drag pans, and the wheel zooms the desktop camera.
- **Annotate:** left-click/drag uses the selected tool. Right-drag and the wheel still navigate; hold Shift to orbit. The camera view is local to each device, while the model's placement and annotation data are shared.
- **Fit, Turn, −, +:** reset, rotate or scale the shared displayed model. This changes its presentation, not its print dimensions.
- **1–5:** choose spray, box, pin, measure or erase. **Escape:** cancel an unfinished selection or close the VR tool panel.
- Set a color, a meaning for that color, an edit category, and a brush radius. Write the requested change, then **Submit to desktop**.

## VR controls

Both tracked hands and controllers work. Hands use their WebXR target ray and thumb/index pinch; controllers use their pointing ray and trigger. Hands are drawn with locally hosted hand meshes, with a joint-dot fallback if those meshes cannot load.

| Action | Hands | Controllers |
| --- | --- | --- |
| Point at a UI button and activate it | Pinch | Trigger |
| Move and turn the model in Inspect | Pinch and move/turn one hand | Hold trigger and move/turn |
| Rotate and scale together | Hold both pinches, move hands apart/together or turn their relative line | Hold both triggers and move/turn |
| Manipulate while annotating | Switch to Inspect on the wrist; a second simultaneous pinch also switches an active grab/selection to a two-hand grab | Hold the grip/squeeze button |
| Apply a tool | Point at the model and pinch/drag in Annotate | Point and hold trigger |

Raise the **left wrist** to use its watch panel. With controllers, it follows the left controller. If that input is not tracked, a fallback panel is placed to the left in front of the user.

- **Menu ◔** opens a pie menu in front of you. Point at a slice and pinch (or pull the trigger); the slice under each ray lights up, and each slice shows its current value. The centre is **Close** on the first ring and **‹ Back** (one ring up) on the others.
  - **Tools ▸** Move model (Inspect), Spray paint, 3D region, Pin a note, Measure, Erase mark. Choosing one closes the menu so the next pinch on the model uses it.
  - **Mark style ▸** Color ▸ (five colors with their meanings), Category ▸, Brush ▸ (−− / − / + / ++ in 5 mm and 0.5 mm steps), and Meaning (opens the keyboard).
  - **Note** (opens the keyboard), **Undo mark**, **Reset view** and **Submit**.
- The larger panel opened from Note or Meaning keeps its **Tools** tab with every setting on one page.
- **Instruction** opens a ray-selectable QWERTY keyboard with numbers, punctuation, space and backspace. The color-meaning field can also be edited there.
- **Submit** on the watch, or **Submit edit** in the larger panel, sends the draft to the computer. If the instruction is empty, it opens the keyboard. If nothing is marked, it asks for a selection first.

Close the expanded tool panel to mark model areas behind it. UI targeting takes priority over the model so selecting a tool does not accidentally paint through the panel. Removing and replacing a hand/controller ends its grab; leaving VR returns to the desktop view. Recenter the headset through the Quest system if its room reference changes.

## Toolkits

| Tool | What it records |
| --- | --- |
| Spray paint | Surface face IDs under a radius in model millimeters, plus stroke sample points. A normal-facing filter reduces marking through thin walls. Marks are triangle regions, not a baked texture or a geometry modification. |
| 3D region | Two model-space corners, an axis-aligned box and face centers inside that volume. Pinch/drag from a surface; the ray's starting depth is held while the hand moves, allowing movement in 3D. |
| Pin a note | A surface point and its triangle, with the current meaning/category/note. |
| Measure | Two surface points and a server-computed distance in millimeters. |
| Erase mark | Removes the latest annotation that includes the pointed face. Undo removes the latest draft annotation; Clear removes all draft marks. Submitted packets are kept. |

Colors and edit categories are intent metadata. They do not run any code or select an actual mesh-editing algorithm yet. Categories are size, texture, pattern and general. Each mark captures its current tool settings, and the overall submitted instruction is included separately in the packet.

## Desktop handoff and export

Submitted requests appear in **The edit desk** with a received status, marked-face count, author and instruction. They have an immutable snapshot of the model and annotations. **Mark reviewed** changes their review status; it does not execute geometry changes.

Each edit packet is a ZIP containing:

- `model.stl`: unchanged source geometry in millimeters.
- `annotated.glb`: selected faces colored by the annotation intent; full annotation metadata in mesh extras.
- `annotations.json`: schema `editor-vr.annotation-packet/1`, model/request IDs, instruction/category, points, face IDs, bounds and measurements.
- `README.txt`: coordinate and placeholder-processing notes.

The footer exports the current draft as an annotated GLB or full ZIP without submitting. Packets preserve what was selected even if later draft marks are removed or a different model is imported.

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

Browser checks use Playwright/Chromium; VR checks use the IWER Meta Quest 3 emulator. With a separate local test server running:

```bash
python app.py --local --port 8021 --no-browser --data-dir /tmp/editor-vr-test
node tests/browser.cjs
node tests/vr-browser.cjs
```

Install Playwright and IWER in a development tool directory, or point the tests at existing installations with `EDITOR_VR_PLAYWRIGHT`, `EDITOR_VR_CHROMIUM`, and `EDITOR_VR_IWER` (path to `iwer/build/iwer.min.js`). `EDITOR_VR_URL` selects a different server. Run browser tests sequentially: they deliberately change the same workspace. Screenshots are written to `test-results/`. For an additional HTTPS/LAN test, start a default HTTPS server on port 8022 and run `tests/https-browser.cjs` with `EDITOR_VR_LAN_URL=https://<LAN-IP>:8022`; it checks real pairing, secure cookies, WSS sync and PIN privacy using isolated browser sessions.

Automated XR testing exercises emulated controllers and tracked hands; it does not replace checking comfort, text legibility, hand occlusion and certificate acceptance on a physical Quest. See `THIRD-PARTY.md` for the terrain-derived connection code and vendored asset licenses.
