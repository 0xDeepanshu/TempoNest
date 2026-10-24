# Live screen streaming — design assessment (not implemented)

Status: **proposal only**. No live-streaming endpoint, viewer, capture pipeline, or portal screen
exists. Screenshot requests remain the only supported monitoring capability. Do not start
implementation until the open decisions and approval gate at the end are resolved.

The existing screenshot contract (explicit request, claim-gated capture, visible employee state,
private storage, retention, audit) is the baseline. Live streaming must not weaken it. In
particular, a stream is not a periodic screenshot loop and must never run without an explicit,
visible, policy-authorized session.

---

## 1. Goals

- Allow an authorized OWNER/ADMIN to request a **bounded, live view** of one employee’s primary
  display only while the employee has an active, heartbeat-fresh work session.
- Make initiation and termination obvious to the employee in the desktop app.
- Keep frame data off the API server and out of application logs.
- Require the same organization scoping, disclosure, acknowledgement, role policy, audit, and
  revocation checks as screenshots.
- Fail closed: offline agent, stale session, disabled policy, missing consent, revoked device, or
  lost authorization terminates the stream.
- Enforce expiry and concurrency limits server-side, not only in the portal.

## 2. Explicit non-goals

- No covert or always-on viewing.
- No recording, replay, or storage of a stream by default.
- No audio, cursor history, keystrokes, clipboard, window titles, URLs, or file contents.
- No multi-employee gallery, bulk viewing, or background browser tab that keeps capturing.
- No mobile/native viewer in the first iteration.
- No reuse of screenshot upload tokens as stream authorization.

## 3. Proposed lifecycle

1. **Request.** An authorized admin selects an employee in the portal and confirms a start action.
   The backend checks `screenshot:policy`, role policy, employee acknowledgement, active session,
   fresh heartbeat, agent status, concurrent viewer limits, and cooldown. It creates a short-lived
   `screen_stream_sessions` row with `PENDING`, a random stream ID, requester, employee, agent,
   maximum duration, and expiry.
2. **Notify.** The agent socket receives `screenStream.request` with the stream ID, expiry, and a
   one-time join challenge. The desktop app shows a persistent indicator naming the organization
   and the fact that an administrator is viewing the screen.
3. **Accept.** The agent acknowledges over the authenticated socket. The backend marks the stream
   `ACTIVE` only if the employee is still eligible. The viewer receives a short-lived,
   single-use viewer token bound to the stream, user, organization, and role.
4. **Transport.** Frames travel over an encrypted, ephemeral channel (see section 5). The API
   server never sees frame bytes after signaling.
5. **Terminate.** Any of these ends the stream and revokes tokens immediately: viewer stop, agent
   stop, expiry, session end, stale heartbeat, policy disable, role removal, device revocation,
   organization suspension, logout, socket loss beyond grace, or concurrency violation.
6. **Audit.** Start, accept, connect, disconnect, stop reason, duration, and viewer identity are
   recorded. Frame content is never audited or stored.

## 4. Authorization and policy

Add a dedicated policy surface rather than overloading screenshots implicitly:

```text
streamingEnabled              boolean, default false
streamRoles                   OWNER/ADMIN only by default
maxDurationSeconds            60–300, default 120
maxConcurrentViewers          1 default, hard cap 2
idleTimeoutSeconds            15
frameRateCap                  2–5 fps default 2
resolutionCap                 e.g. 1280×720
employeeAcknowledgementRequired  reuse screenshot disclosure or separate stream disclosure
auditRetentionDays            reuse screenshot audit retention
```

Rules:

- Route permission alone is insufficient; the role must also appear in `streamRoles`.
- Streaming is disabled by default and stays disabled until an owner explicitly enables it.
- The employee disclosure must state that live viewing is possible, who can start it, the maximum
  duration, and whether frames are recorded (default: no).
- If acknowledgement is required, the current disclosure version must be acknowledged before a
  stream request is accepted.
- A stream cannot start during a break unless policy explicitly permits it. Default: no.
- A stream cannot start without an active session and fresh heartbeat at both request and accept.
- Device revocation, membership suspension, or organization suspension terminates every stream.

## 5. Transport options

### Option A — WebRTC (recommended for production)

- Agent creates a peer connection and offers a display track using Electron
  `desktopCapturer` + `getUserMedia`/`MediaStream`.
- Signaling uses authenticated WebSocket messages or HTTPS; media uses DTLS-SRTP.
- Use a TURN server with short-lived credentials; do not rely on public STUN alone.
- The viewer receives a single-use token and connects from the portal.
- Server enforces stream expiry by closing signaling and revoking TURN credentials.

Trade-offs: lowest latency and bandwidth; more operational complexity (TURN, NAT, codec
compatibility). Requires careful TURN credential isolation.

### Option B — WebSocket JPEG frames (fallback)

- Agent sends downscaled JPEG frames over a dedicated WSS connection; viewer receives them over a
  separate authenticated connection.
- Server relays frames in memory only, or uses a direct agent→viewer path with signed tokens.
- Lower implementation complexity, higher bandwidth and server CPU; latency and fan-out are worse.
- Must cap frame size, rate, and total bytes; drop frames rather than queue unboundedly.

Trade-offs: simpler to build and reason about, but the relay becomes a privacy-sensitive data path
and a denial-of-service target. If chosen, frames must never be written to disk, logs, or error
reports.

**Recommendation:** approve WebRTC for the first production implementation, with an explicit
feature flag and a kill switch. Do not ship the WebSocket relay as an implicit fallback without a
separate review.

## 6. Backend changes (not implemented)

- New `screen_stream_sessions` and `screen_stream_audit` rows (or reuse `audit_events` with new
  actions) with organization, employee, agent, requester, state, timestamps, stop reason, and
  expiry. No frame bytes and no storage keys.
- Endpoints, all with `X-Organization-Id` and role/policy checks:
  - `POST /admin/employees/:employeeId/screen-streams` — request a session.
  - `GET /admin/screen-streams/:streamId` — scoped status for the requester.
  - `POST /admin/screen-streams/:streamId/stop` — idempotent viewer stop.
  - `POST /agent/screen-streams/:streamId/accept` and `/stop` — agent transitions.
  - Signaling/offer/answer/ICE relay over the existing agent socket or a dedicated ephemeral
    channel; never expose TURN secrets to the browser beyond the scoped session.
- Server-side timers/workers expire sessions even if both clients disconnect.
- Cleanup on startup, like screenshot maintenance.
- Rate limits: per organization, per admin, per employee, and global concurrent streams.
- Structured audit actions: `SCREEN_STREAM_REQUESTED`, `SCREEN_STREAM_ACCEPTED`,
  `SCREEN_STREAM_VIEWER_CONNECTED`, `SCREEN_STREAM_STOPPED`, `SCREEN_STREAM_EXPIRED`,
  `SCREEN_STREAM_FAILED`, `SCREEN_STREAM_DENIED`.
- Never log SDP with embedded credentials, ICE candidates containing private network details in
  production logs, frame bytes, or viewer tokens.

## 7. Electron changes

- Add a `ScreenStreamService` in the main process, separate from screenshot capture.
- Capture only the primary display, with a resolution and frame-rate cap.
- Show a persistent, non-dismissible indicator while streaming, including who started it and the
  remaining time. Provide a local “Stop sharing” action that immediately ends the stream.
- Stop playback when the window is minimized? No — but stop when the OS permission is revoked,
  the display is locked, the machine sleeps, or the agent loses authorization.
- Never expose media tracks, frame bytes, TURN credentials, or stream tokens to the renderer.
- Do not start automatically on a request without displaying the indicator and validating policy,
  session, heartbeat, and consent.
- A stream request alone is not permission to capture until the server accepts the agent’s
  acknowledgement and the employee is eligible.

## 8. Portal changes

- Add a separate “Live view” action on the employee row, gated by a dedicated permission and
  policy. Do not reuse the screenshot button silently.
- Show a confirmation dialog with duration, disclosure, and a clear statement that the employee
  will see an indicator.
- While active: elapsed time, remaining time, viewer identity, stop button, connection state, and
  a warning that closing the page stops the stream.
- Show denied states distinctly: policy disabled, role not allowed, employee offline, no active
  session, stale heartbeat, revoked agent, acknowledgement required, concurrent limit reached.
- Never cache frames, expose tokens in URLs, or keep the stream alive in a background tab.
- Stop on page hide, logout, organization switch, or role loss.

## 9. Privacy and compliance

- Streaming increases legal and ethical risk versus one-shot screenshots. Require explicit
  organization policy, employee disclosure, and documented consent where required by law.
- Default to no recording. If recording is ever proposed, treat it as a separate data-retention
  feature requiring its own approval, storage design, retention limits, and audit.
- Provide an employee-accessible record of when streams occurred.
- Region-specific requirements (works councils, monitoring notice, consent) must be reviewed
  before enablement. The product must not imply that a single acknowledgement covers every
  jurisdiction.

## 10. Failure and abuse cases

| Case | Required behavior |
| --- | --- |
| Agent offline | Request fails with a clear offline state; no queued stream starts silently later. |
| Session ends or heartbeat stales | Terminate within one idle timeout; audit reason. |
| Policy disabled mid-stream | Terminate immediately and revoke tokens. |
| Role removed or membership suspended | Terminate immediately; deny reconnect. |
| Device revoked | Terminate; agent clears any stream state and local media. |
| Viewer closes tab or loses network | Agent stops sending within the grace window; session expires server-side. |
| Agent crashes | Session expires; viewer sees a terminal state, not a frozen frame. |
| TURN/relay overload | Reject new sessions; never degrade by recording or queuing frames. |
| Token replay | Single-use viewer token, bound to stream/user/organization, short TTL. |
| Cross-organization ID probing | 404/403 consistently; never reveal another organization’s session. |
| Concurrent viewer limit exceeded | Deny with an explicit limit error; do not silently share the stream. |

## 11. Testing requirements before enablement

- Authorization matrix for every role and policy combination, including `viewRoles` exclusions.
- Cross-organization denial for request, status, signaling, stop, and audit.
- Policy-disabled, acknowledgement-required, stale-heartbeat, no-session, break, and revoked-device
  denials at both request and accept.
- Expiry, viewer stop, local stop, logout, role loss, policy disable, and agent crash during an
  active stream.
- Concurrent viewer limits and rate limits under load.
- No frame bytes in logs, database, error reports, or browser storage.
- No long-lived or reusable tokens; reconnect requires a fresh authorization.
- Manual verification on Windows, macOS, and Linux, including screen-lock and sleep behavior.
- Load testing of signaling and TURN, not just the API.

## 12. Approval gate and open decisions

Implementation must not start until these are decided and recorded:

1. Is live streaming a product requirement, or is explicit screenshot capture sufficient?
2. Which transport is approved: WebRTC only, WebSocket relay only, or both?
3. Maximum duration, frame rate, resolution, and concurrent viewers.
4. Whether recording is ever allowed (recommended: no).
5. Whether streaming shares the screenshot disclosure or needs a separate versioned disclosure.
6. Which jurisdictions/tenants may enable it, and what consent evidence is required.
7. TURN provider, data region, retention of signaling metadata, and incident response ownership.
8. Kill-switch owner and process for disabling streaming for one organization or globally.
9. UI/UX review of the employee indicator and the admin confirmation flow.
10. Security review of token binding, TURN credentials, and cross-tenant isolation.

Until all ten are resolved and the separate design is approved, keep live streaming out of the
codebase and keep the portal copy stating that no screen is streamed.
