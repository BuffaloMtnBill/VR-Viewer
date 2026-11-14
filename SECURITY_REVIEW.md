# VR-Viewer security review

Date: 2026-11-01. Model: GPT-6 / Codex (exact runtime variant not exposed). Source: 09693958bf7560b7b2acc9aef8a034c629e7e46f.

Review only: no application fixes were made. Existing work was preserved. This is an application-source review, not a full penetration test or exhaustive dependency/native-runtime audit.

Reviewed CLI LAN/local deployment, Flask admission, pairing, browser file selection, model upload/parsing, workspace identifiers, WebSocket hub and speech admission. CLI defaults to HTTPS LAN with pairing; --local is constrained to loopback. Trusted hosts, Origin comparison, write tokens, hashed pairing secrets and safe workspace IDs are positive controls.

## VRV-01 — Medium: Open-folder operation bypasses the file-browser root through symlinks

server.inside validates the selected directory, but read_parts then uses model_files, which follows member symlinks without checking each resolved target against browse_root. With a temporary outside.obj and root/link.obj symlink, an unpaired request returned 401; after pairing, directly opening link.obj returned 400, while opening its parent folder returned 200 with the outside model in the scene. A paired client can therefore read model geometry outside the configured root if such a link exists. This is not arbitrary text-file disclosure. Revalidate each resolved member against the browser root immediately before reading; keep unrestricted CLI imports a distinct explicitly authorized path.

## VRV-02 — Medium: 3MF expansion runs before aggregate instance limits

mesh._3mf_objects recursively materializes component instances before load_parts checks MAX_PARTS=64. A 361-byte synthetic archive returned 1,024 instances from ten binary levels. Depth16 and the existing 200 MiB XML-member cap do not constrain breadth; paired upload or selected local model can exhaust memory. Enforce total expanded instances/vertices/faces during traversal, cycle detection and worker memory/time limits. No exhaustion attempted.

## VRV-03 — Medium: WebSocket input and connection counts are unbounded

Sock(app) sets no max_message_size; installed simple_websocket.Server defaults it to None. Hub bounds outgoing queues to32 but does not cap listeners or inbound message buffering. A paired client or native loopback client can hold many connections or submit large frames outside the HTTP body limit. Configure a small frame/message cap, connection quotas and idle/receive limits. Verified configuration/source, not a flooding test.

## VRV-04 — Medium: Native local accounts bypass pairing and can obtain control tokens

is_local trusts loopback address alone. Another OS account able to connect to the listener can retrieve the index token and PIN and act with the server account file access; there is no connecting-UID check or separately protected local secret. Browser Host/Origin defenses do not authenticate native clients. Use a local owner-only bootstrap credential/socket or require pairing on loopback too. Multi-account threat prerequisite; no foreign-UID process launched.

## VRV-05 — Medium: Concurrent model parsing and speech inference lack admission limits

Threaded Flask requests parse meshes before workspace locking. Transcriber._lock covers model loading but not inference. The 30 MiB request and30-second audio caps limit individual requests, not simultaneous memory/CPU use from paired clients. Add bounded shared work queues/semaphores, per-device quotas and cancellation; reject excess work promptly. Source finding; no real model inference or resource exhaustion performed.

## VRV-06 — Low: One client can repeatedly lock out pairing for everyone

Pairing stores a global failure counter and locked_until. Five wrong PINs block even correct PINs for60seconds; a reachable unpaired peer can repeat this to deny new pairing. Existing paired clients remain usable. Add per-client throttling with bounded state, global backoff and an owner recovery path without weakening PIN guess limits.

## Verification and limitations

Existing suite:60 passed in3.32s. Temporary paired-client test confirmed direct path rejection but folder symlink escape. Bounded3MF parser probe confirmed1024instances; inspected installed WebSocket default. No live user data, headset, Whisper model download, load flood or external connection used. Browser rendering inspected for untrusted HTML sinks; not a complete vendored/native dependency audit.

## Source snapshot (SHA-256)

- `vr_viewer/server.py`: `9889909988c335781c181c0cb065e8f12190da10406dd28056b1be5f7f6d6029`
- `vr_viewer/pairing.py`: `16bc1b689151613dccb0ba82832d7164910c41432c8c8dcbb30385827c823613`
- `vr_viewer/mesh.py`: `afdc72e85c7077e738923ed4735e411f16a14dbd022b4047487c63174911aa10`
- `vr_viewer/live.py`: `1ff20d1c6a84afcbaaf0ca165a2098ce2ddf79fc28e6aa87a79ca3b2058d6282`
- `vr_viewer/speech.py`: `f3371edb5bb7b28647321d82dc1c1be15ff2647cf51b9dabdda396223e36628b`
- `vr_viewer/__main__.py`: `fe0593bc99aacb446871d83595e1c1035fd203d569206bdb0d34cfc4efe41a42`
- `vr_viewer/workspace.py`: `065f67ddf71cd25d5e8d64f44b3092d4d5fbdc169de54b00199fb8bdedd33923`
