# Live screen viewing — implementation and operations

Status: **implemented** as an administrator-only, time-boxed WebSocket relay. The transport decision is
a dedicated authenticated binary relay; WebRTC/TURN is intentionally not used. Continuous frames never
travel over the JSON agent socket.

The existing screenshot contract (explicit request, claim-gated capture, visible employee state,
private storage, retention, audit) remains the baseline. Live viewing reuses the same organization
policy, role matrix, disclosure acknowledgement, tenant scoping, and audit trail. Frame bytes are
never persisted.

---

## 1. Goals

- Allow an authorized OWNER/ADMIN to view one employee’s primary display only during an active,
  heartbeat-fresh work session.
- Require an explicit administrator start action and, on the desktop, the server’s start command.
- Keep frames in memory only: no recording, replay, object storage, database rows, or logs.
- Fail closed on policy disable, role loss, missing acknowledgement, stale/absent session, revoked
  agent, suspended organization, expiry, or lost authorization.
- Enforce duration, frame rate, size, and backpressure limits server-side.

## 2. Non-goals

- No covert or always-on viewing; no employee-facing controls were added.
- No audio, input, clipboard, window titles, URLs, or file contents.
- No automatic, bulk, timer-based, or multi-employee capture.
- No stream recording by default, and no feature to enable recording.
- No mobile/native viewer in this iteration.
- No reuse of screenshot upload tokens as live authorization.

## 3. Components

| Layer | Responsibility |
| --- | --- |
| Backend REST | Create/reuse one active session per employee, issue single-use viewer tickets, stop sessions, persist lifecycle and audit rows. |
| Backend relay | Accept unauthenticated viewer upgrades only long enough to receive a first-message ticket, revalidate durable authorization, fan JPEG binaries from one agent socket to authorized viewers, enforce limits and grace timers. |
| JSON agent socket | Delivers only `screen.live.start` control commands; receives sanitized `screen.live.failed` reports. Never carries frames. |
| Electron main process | Captures the primary display with `desktopCapturer`, encodes bounded JPEG frames, connects to the agent stream only after `live.ready`, stops on every terminal condition. No renderer UI or IPC surface was added. |
| Next.js admin portal | Deliberate Start action, ticket request, direct browser WebSocket, connecting/live/reconnecting/ended/unavailable/restricted states, last-frame time, explicit Stop. |

The web BFF proxies HTTP only. The browser connects directly to the backend relay using
`NEXT_PUBLIC_API_WS_URL`, because a server-side proxy would make the Next.js process part of the
frame data path.

## 4. Lifecycle

1. An administrator selects an employee in the existing screenshot review page and presses
   **View live screen**, then **Start live view**.
2. `POST /admin/employees/:employeeId/screen-live-sessions` validates policy, role, acknowledgement,
   membership, organization state, time-session freshness, and desktop agent. It creates or reuses
   the employee’s single active session (default maximum 900 seconds) and publishes
   `screen.live.start` to that exact agent.
3. The administrator requests a ticket:
   `POST /admin/screen-live-sessions/:sessionId/viewer-tickets`. Only an HMAC hash is stored; the
   plaintext ticket is returned once with a short TTL (default 60 seconds).
4. The browser opens `wss://<backend>/api/v1/ws/screen-live` **without any credential in the URL**, then
   sends `{"type":"authenticate","ticket":"…"}` as its first message. The relay consumes the ticket,
   rechecks durable session, user, membership, organization, policy, work-session, and agent state, and
   only then attaches the socket to the session. Unauthenticated sockets time out after 5 seconds and
   may not send binary data.
5. The agent opens `/api/v1/ws/screen-stream?liveSessionId=…` with its bearer token and agent
   credentials. It waits for the relay’s `live.ready`, then sends JPEG frames no faster than
   `maxFps`, no larger than `maxFrameBytes`, and optionally downscaled to `maxFrameWidth`.
6. The relay validates each frame, fans it out to authorized viewers of that session, and advances
   the viewer from `live.ready` to `live.started` on the first frame.
7. Any terminal condition writes an `ENDED` session with a reason, notifies viewers with
   `live.ended`, tells the agent `live.stop`, and closes the sockets.

Reconnect behavior:

- A viewer reconnect requires a **fresh ticket**; tickets are single-use.
- An agent reconnect reuses the same `liveSessionId` and is re-authorized at every upgrade.
- The session survives short disconnects only inside the configured grace windows; after that it is
  terminated, so a frozen frame can never outlive authorization.

## 5. Policy, roles, and tenant isolation

- Route permission: `screenshot:live` (OWNER/ADMIN by default).
- Start also requires the role in policy `requestRoles`; ticket issuance also requires it in
  `viewRoles`.
- The monitoring policy must be enabled. If `employeeAcknowledgementRequired` is set, the current
  disclosure version must be acknowledged.
- The target must be an active member with an active, heartbeat-fresh time session on a non-revoked
  `ELECTRON` agent. Mobile agents are never targets.
- Cross-organization IDs return `404` indistinguishably from missing IDs.
- Organization suspension, membership loss, role removal, policy disable, desktop-agent revocation, or
  session end terminates an active relay; connected viewers and the agent stream are revalidated about
  once a minute, and the durable termination causes are `POLICY_DISABLED`, `ORGANIZATION_SUSPENDED`,
  `AGENT_REVOKED`, and `SESSION_ENDED` in addition to the transport reasons.

Multiple authorized administrators may attach to the same active session (each with their own
ticket), but there is only one session per employee at a time. There is no bulk or gallery view.

## 6. Data handling and audit

- Frames exist only in relay memory and in the viewer’s browser as an in-memory object URL. They are
  not written to PostgreSQL, object storage, the filesystem, browser storage, or logs.
- Tickets are stored only as HMAC hashes and are cleared on consumption. Agent credentials and
  session cookies are never placed in the frame path.
- Audit actions: `SCREEN_LIVE_SESSION_STARTED`, `SCREEN_LIVE_VIEWER_JOINED`,
  `SCREEN_LIVE_VIEWER_LEFT`, `SCREEN_LIVE_SESSION_STOPPED`, `SCREEN_LIVE_ACCESS_DENIED`.
  Metadata contains IDs, role, reason, timestamps, limits, and expiry only.
- API and relay logs redact authorization, cookies, agent keys, and query strings; frame bytes and
  tickets are never logged.

## 7. Limits and defaults

| Setting | Default | Notes |
| --- | --- | --- |
| `SCREEN_LIVE_MAX_SESSION_SECONDS` | 900 | 60–3600 |
| `SCREEN_LIVE_VIEWER_TICKET_TTL_SECONDS` | 60 | 15–300, capped by session expiry |
| `SCREEN_LIVE_MAX_FPS` | 2 | 1–10; relay drops frames that arrive too fast |
| `SCREEN_LIVE_MAX_FRAME_BYTES` | 2 MiB | 64 KiB–8 MiB; also the agent relay `maxPayload` |
| `SCREEN_LIVE_MAX_FRAME_WIDTH` | 1600 | 640–3840; the agent downscales before sending |
| `SCREEN_LIVE_VIEWER_BUFFER_LIMIT_BYTES` | 1 MiB | Per viewer; frames are dropped, not queued |
| `SCREEN_LIVE_AGENT_GRACE_SECONDS` | 10 | Agent reconnect window |
| `SCREEN_LIVE_VIEWER_GRACE_SECONDS` | 8 | Viewer reconnect window |

The relay sweep (every 30 seconds) pings sockets and revalidates each viewer and each agent stream
about once a minute. A viewer upgrade carries no ticket; the ticket (if any) arrives only in the first
application message within 5 seconds, and binary data before authentication is rejected. Viewer auth
failures close with `4001`, ended sessions with `4000`, and revoked access with `4003`.

## 8. Deployment and networking

- Set `NEXT_PUBLIC_API_WS_URL` in `web/.env` to the browser-reachable backend origin
  (`ws://localhost:4000` locally, `wss://api.example.com` in production). It is embedded at build
  time, so rebuild the web app after changing it. The web origin must also be listed in the
  backend’s `CORS_ORIGINS`, because viewer upgrades enforce the same origin allowlist.
- Reverse proxies, CDNs, load balancers, and firewalls must allow HTTP/1.1 WebSocket upgrades on
  `/api/v1/ws/screen-live` and `/api/v1/ws/screen-stream`, forward `Upgrade`/`Connection`/`Origin`,
  allow at least the configured frame size, and use idle timeouts longer than the 30-second sweep.
- No TURN/STUN server, media codec negotiation, or extra signaling service is required.
- Approximate bandwidth is `frame size × fps` per viewer. A 300 KB JPEG at 2 fps is roughly
  0.6 MB/s (about 4.8 Mbit/s) per viewer. Size limits and viewer count accordingly.
- The relay is **process-local**. Multi-instance deployments require sticky routing for both
  WebSocket paths or a shared pub/sub frame bridge. Durable session rows do not carry frames.

## 9. Platform-specific limitations

- **Windows:** `desktopCapturer` captures the primary display; OS screen-capture permissions and
  secure desktops (for example, the lock screen) can prevent capture.
- **macOS:** the user must grant Screen Recording permission to the app. Without it, capture fails
  and the session ends with a sanitized failure; macOS may require a restart after the grant.
- **Linux:** X11 generally works; Wayland compositors may restrict or require a portal and may offer
  limited source support. Distro/desktop-environment behavior must be verified.
- Only the primary display is captured. Multi-monitor layouts show only that display.
- Frames are JPEG snapshots at a low frame rate, not smooth video. There is no audio.
- Screen lock, display sleep, machine sleep, permission revocation, or network loss stops capture;
  the viewer sees an ended/unavailable state rather than a frozen frame.

## 10. Verification status

Automated coverage includes backend lifecycle/authorization/relay tests, Electron capture-service
tests with a fake capture/socket, and web viewer tests with mocked HTTP/WebSocket/object URLs.

**Real desktop-to-browser streaming has not been verified by an automated test.** It requires a
manual end-to-end run with the backend, web portal, and Electron app on a supported desktop,
including permission grant/revocation, screen lock, sleep, network loss, session end, expiry, and
multi-monitor behavior. Do not claim live capture works in production based only on unit tests.
