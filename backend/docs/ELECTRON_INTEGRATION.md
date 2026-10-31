# Electron integration guide (Step 3)

This document explains how the existing Electron renderer contracts (`AuthService`,
`TimeTrackingService`, `TimerProvider`, activity/sync services) should be backed by the
TempoNest API, including the admin-initiated screenshot contract. Backend Step 2/3 lives in this
repository; the desktop capture/upload flow described in section 7 is implemented in the sibling
`teamselectron` repository. Treat live end-to-end behavior as unverified until it is exercised
against a real backend and private storage driver.

> **Implementation status:** the backend request/claim/upload/complete/storage/retention contract
> exists and is tested. The Electron main process now performs explicit, claim-gated capture and
> upload, with renderer-facing status only. This has not yet been manually verified end to end on
> Windows, macOS, and Linux against both local and S3-compatible storage.

The authoritative HTTP/WebSocket details live in [API.md](API.md). This guide focuses on process
boundaries, mapping, timer reconciliation, offline behavior, and failure handling.

---

## 1. Process and secret boundaries

Keep all network traffic and credentials in the Electron **main process**.

```
renderer (React / TimerProvider)
    │  purpose-built IPC methods only
    ▼
preload (contextBridge, allowlisted channels)
    │
    ▼
main process
    ├── AuthService adapter       (tokens, refresh, logout)
    ├── TimeTrackingService       (HTTP session/break/heartbeat)
    ├── Agent WebSocket client    (presence + screenshot commands)
    ├── ScreenshotCaptureService  (explicit request only; no timer/usage trigger)
    ├── Activity/sync queues      (durable local files)
    └── OS-protected storage      (safeStorage)
```

Rules:

- Never expose the access token, refresh token, agent key, or raw API errors containing tokens to
  the renderer. The renderer receives only the mapped `AuthSession`, timer state, and user-safe
  error codes.
- Store the refresh token and the one-time `tna_…` agent key with Electron `safeStorage` in the
  main process. Use a stable installation identifier for `deviceId`; do not derive it from
  sensitive hardware identifiers.
- Keep the access token in main-process memory. On refresh, replace both tokens atomically.
- Agent credentials are only useful together with the user's bearer token for time/activity
  writes. A database leak cannot reveal raw tokens because the API stores only HMAC hashes.
- The renderer's persisted `TimerState` is a **display cache**, not a source of truth. Report and
  payroll data always come from the server.

---

## 2. Configuration

Suggested main-process configuration:

| Setting | Value |
| --- | --- |
| `TEMPO_API_BASE_URL` | e.g. `https://api.temponest.example/api/v1` |
| `TEMPO_WS_URL` | e.g. `wss://api.temponest.example/api/v1/ws/agent` |
| Agent storage key | `tempo.agent.v1` (agent ID, key, device ID, org ID) |
| Auth storage key | `tempo.auth.v1` (refresh token only; access stays in memory) |
| Sync queue key | `tempo.sync.v1` (durable offline records, never tokens) |
| Screenshot temp directory | OS temp/app-private directory; delete images after upload/complete/fail/expiry |
| Capture indicator | Main-process state exposed as an allowlisted IPC event; renderer must show it while capture/upload is active |

The API base URL must use HTTPS in production. WebSocket upgrades use the same host and path
`/api/v1/ws/agent`.

---

## 3. `AuthService` mapping

The existing interface is:

```ts
interface AuthService {
  restoreSession(): Promise<AuthSession | null>
  signIn(credentials: SignInCredentials): Promise<AuthSession>
  signOut(): Promise<void>
}
```

### Sign in

1. `POST /auth/login` with `{ email, password, client: 'desktop' }`.
2. Keep `data.accessToken` in memory; store `data.refreshToken` with `safeStorage`.
3. Select an active membership from `data.memberships`. If the account belongs to multiple
   organizations, show a chooser or use the last active organization; never let the renderer
   choose an organization for an API operation other than as an explicit selector.
4. Map the backend shapes to the renderer's `AuthSession`:

| Renderer field | Backend source | Notes |
| --- | --- | --- |
| `employee.id` | `data.user.id` | Never `employeeId` supplied by the renderer |
| `employee.name` | `data.user.name` | |
| `employee.email` | `data.user.email` | |
| `employee.organizationId` | selected membership `organization.id` | |
| `employee.initials` | derived from name | Display only |
| `employee.jobTitle` / `employee.team` | not in Step 1/2 user payload | Use empty/`—` until a profile field exists |
| `membership.employeeId` | `data.user.id` | Same identity |
| `membership.organization` | selected membership `organization` | `id`, `name`, `slug` |
| `membership.role` | `OWNER`/`ADMIN` → `organization_admin`; `MANAGER`/`EMPLOYEE` → `employee` | UI only; server enforces the real role |
| `authenticatedAt` | current client time | Display metadata only |

Do not treat the mapped role as authorization. The server derives permissions from the
membership on every request, and a suspended/removed membership loses access immediately.

### Restore session

1. Read the refresh token from `safeStorage`.
2. If absent, return `null`.
3. `POST /auth/refresh` with `{ refreshToken, client: 'desktop' }`.
4. Store the rotated refresh token; keep the new access token in memory; rebuild `AuthSession`.
5. On `401`/invalid/revoked refresh token, delete the stored token, close the agent WebSocket, and
   return `null`. Never retry the rejected refresh token.

The API rotates refresh and access tokens on every refresh. The old access token stops working
immediately, so the adapter must replace both values before making the next request.

### Sign out

1. `POST /auth/logout` with the current bearer token.
2. Close the agent WebSocket.
3. Clear the stored refresh token, agent key, in-memory access token, and any pending offline
   queue that belongs to that authenticated user.
4. Always clear local state even if the logout request fails.

### Agent bootstrap

After sign-in, load `{ agentId, agentKey, deviceId }` from secure storage.

- If no record exists, `POST /organizations/:organizationId/desktop-agents` with a stable
  `deviceId`, display name, platform, OS version, and app version. Store the returned
  `data.agent.id` and `data.agentKey`. The key is shown **once**.
- Optionally validate the key with `POST /desktop-agents/authenticate` before opening the
  WebSocket. This endpoint does not create a user session.
- If registration returns `200` with `rotated: true`, replace the stored key: another local
  installation reused the same `deviceId`.
- If registration returns `409 AGENT_REVOKED`, do not loop or invent a new device ID silently.
  Show an actionable message ("This device was revoked; contact an administrator") and disable
  time tracking until the administrator provisions a new registration.
- If a tracking call fails with `401 AGENT_CREDENTIALS_INVALID`, the key may have been rotated or
  lost. Re-run registration for the same `deviceId` (which rotates the key), reconnect the
  WebSocket, and retry once. Do not retry forever.

---

## 4. `TimeTrackingService` mapping

The existing interface is:

```ts
interface TimeTrackingService {
  listSessions(range: DateRange): Promise<ApiTimeSession[]>
  startSession(startedAt: string): Promise<ApiTimeSession>
  endSession(sessionId: string, endedAt: string): Promise<ApiTimeSession>
  startBreak(sessionId: string, startedAt: string): Promise<ApiBreak>
  endBreak(sessionId: string, breakId: string, endedAt: string): Promise<ApiBreak>
}
```

Every write requires the bearer token plus `X-Agent-Id` and `X-Agent-Key`. The adapter derives the
organization/employee from that binding; the renderer must not add them.

### Online writes

The server generates online timestamps. Keep the existing timestamp arguments for contract
compatibility, but **ignore them for authorization or duration calculation**:

| Method | Request | Response mapping |
| --- | --- | --- |
| `startSession(startedAt)` | `POST /organizations/:org/time-sessions/start` (empty body) | Return `data.session` mapped to `ApiTimeSession`; adopt the server `id` and `startedAt` |
| `endSession(sessionId, endedAt)` | `POST .../time-sessions/:sessionId/stop` | Return `data.session`; use the server `endedAt` for display |
| `startBreak(sessionId, startedAt)` | `POST .../time-sessions/:sessionId/breaks` | Server returns the updated session plus `breakId`; find that break in `session.breaks` and map it to `ApiBreak` |
| `endBreak(sessionId, breakId, endedAt)` | `POST .../time-sessions/:sessionId/breaks/end` | Verify the active break is `breakId`; return the ended break mapped from the updated session |
| `listSessions(range)` | `GET .../time-sessions?from=<ISO>&to=<ISO>&page=n&limit=100` | Page through `meta.totalPages`; map sessions and breaks |

The history endpoint accepts ISO-8601 `from`/`to` timestamps with an offset and returns sessions
that overlap the window. This is different from report endpoints, which take organization-local
`YYYY-MM-DD` dates.

Mapping notes:

- Backend timestamps are UTC ISO strings. The renderer's `ApiTimeSession` can keep ISO strings,
  but the timer UI converts them to local time.
- Backend break objects already contain `sessionId`. The start/end break endpoints expose a
  `breakId`; use it to locate the break in the returned session.
- `ApiTimeSession` from the renderer has no `status`/`source`/heartbeat fields. Keep those in a
  separate main-process tracking snapshot for diagnostics; do not force them into the renderer
  contract.
- Employee attendance summaries and correction requests are additive browser/admin HTTP
  contracts. Electron continues to use only the existing session/break/history writes; approved
  corrections appear as server-authoritative history on the next refresh. No agent, heartbeat,
  WebSocket, or offline-sync contract changed.

### Error and conflict handling

| HTTP/code | Adapter behavior |
| --- | --- |
| `409 ACTIVE_SESSION_EXISTS` | Fetch `GET .../time-sessions/current` and adopt the fresh server session; do not create a duplicate |
| `409 AGENT_SESSION_EXISTS` | Fetch the agent's current/session state, or treat as stale client state; surface a safe error |
| `409 SESSION_NOT_ACTIVE` / `SESSION_ALREADY_STOPPED` | Refresh current state; the UI is behind the server |
| `409 BREAK_ALREADY_ACTIVE` | Fetch current and adopt the open break |
| `409 NO_ACTIVE_BREAK` | Refresh current; clear the local open break |
| `401 AUTH_EXPIRED` | Refresh the access token once, then retry |
| `401 AGENT_CREDENTIALS_INVALID` | Re-register the same device once, replace key, reconnect WebSocket |
| `403 AGENT_REVOKED` | Stop the local timer, close the WebSocket, clear the agent key, show admin-action message |
| `403 MEMBERSHIP_INACTIVE` / suspended organization | Stop tracking and return to an access-blocked screen |
| Network failure | If offline tracking is enabled, follow the offline protocol below; otherwise keep the timer stopped and show reconnect guidance |

### Current state and launch recovery

On launch, after auth and agent validation:

1. `GET /organizations/:org/time-sessions/current`.
2. If `data.session` is active, rebuild `TimerState` from the server session and its breaks.
3. If it is `null`, reset to idle **after** queuing any unsynced local stops for reconciliation.
4. Never let stale `sessionStorage`/local timer data override a different server session ID.

The server may auto-close an old stale session at its last heartbeat when a new session starts
(`autoClosedSessionId`). If the renderer thought the old session was still active, replace local
state with the new server session and show a non-blocking notice.

---

## 5. Timer / `TimerProvider` reconciliation

The existing provider is intentionally optimistic and synchronous: it creates local session and
break IDs and derives elapsed time from timestamps. Keep that UX, but add a main-process
authoritative layer:

- **Start work**: dispatch the local start immediately, then call `startSession`. On success,
  replace the local session ID and `startedAt` with the server values. On failure/conflict, adopt
  the server's current session or roll back to idle with a visible error.
- **Start break**: dispatch local break immediately, then call `startBreak`. Replace the local
  break ID with the server `breakId`; on conflict, fetch current and adopt the open break.
- **Resume work**: call `endBreak`; replace the local break end with the server timestamp.
- **Stop work**: stop the local timer immediately, call `endSession`, then replace the local end
  time with the server `endedAt`. Even if the request fails, queue an offline stop rather than
  continuing to count time.
- **Ticker**: the one-second local ticker is fine for display. It must not be used to compute
  reported durations; the server stores intervals and recomputes totals.
- **Heartbeat**: while a session is active, the main process sends WebSocket heartbeats (or HTTP
  heartbeats if WebSockets are unavailable). The renderer does not send heartbeats itself.

`TimerProvider`'s current reducer calls are synchronous. The future API-backed adapter should
invoke an asynchronous main-process service and then dispatch a reconciliation action
(`replace_session`, `replace_break`, `rollback`) with server values. This is an Electron adapter
change, intentionally left out of the backend step.

---

## 6. Agent WebSocket client

Connect **after** sign-in and agent registration:

```
wss://<host>/api/v1/ws/agent
Authorization: Bearer <accessToken>
X-Agent-Id: <agentId>
X-Agent-Key: <agentKey>
```

Use the Node `ws` client in the main process, not a browser WebSocket in the renderer, so the
agent key never reaches renderer code.

Handle these messages:

- `connected`: read `session`, `state`, `heartbeatIntervalSeconds`, `heartbeatStaleAfterSeconds`,
  and `pendingScreenshotRequests`. Send the first heartbeat within the advertised interval and
  pass pending screenshot requests to `ScreenshotCaptureService`.
- `heartbeat.ack`: replace the main-process heartbeat snapshot; optionally forward `state` and
  server timestamps over an allowlisted IPC event.
- `session.status`: update the snapshot (e.g. after an HTTP break/stop from another path).
- `screenshot.request`: an explicit administrator request. Acknowledge/claim it through the
  screenshot flow in section 7; do not capture until the claim succeeds.
- `screenshot.acknowledged`, `screenshot.claimed`, `screenshot.completed`, `screenshot.failed`,
  and `screenshot.cancelled`: reconcile the local screenshot state machine.
- `screenshot.error`: surface a user-safe failure, discard any local image for that request, and
  follow the claim/upload retry rules in section 7.
- `agent.revoked`: stop the local timer, clear the agent key, close the socket, discard screenshot
  state/images, and require administrator action.
- `pong`: liveness only.

Reconnect policy:

- Normal close / network loss: exponential backoff with jitter (e.g. 1s, 2s, 4s … capped at 30s)
  while authenticated.
- Close `4001 AUTH_EXPIRED`: refresh the access token, then reconnect. If refresh fails, sign out.
- Close `4003` (`AGENT_REVOKED`, `ACCOUNT_DISABLED`, `MEMBERSHIP_INACTIVE`,
  `ORGANIZATION_SUSPENDED`): do not reconnect; stop tracking and show the appropriate blocked
  state.
- Server shutdown (`1001`): reconnect with backoff.
- A reconnect is safe: durable `last_seen_at`/`last_heartbeat_at` values live in the database; the
  process-local hub only tracks live transports.

HTTP heartbeat fallback:

```
POST /organizations/:org/time-sessions/:sessionId/heartbeat
```

Use it when the WebSocket is unavailable, at roughly half the stale window (60 seconds with the
defaults). A fresh heartbeat is what keeps an employee `WORKING`/`ON_BREAK`; without either path
the durable state becomes `OFFLINE`.

---

## 7. Admin-initiated screenshot capture (implemented in the Electron repo)

The backend supports individual, administrator-initiated screenshots. There is **no periodic
capture, no capture when a timer starts, and no capture caused only by application usage**. The
Electron client must not add any such trigger. The `teamselectron` repository implements the flow
below in `electron/screenshotService.ts` and `electron/screenCapture.ts`; it uses JPEG encoding of
the primary display inside the main process.

### Hard rules

- Capture only after the server has accepted a `claim` for a request that belongs to this
  authenticated agent/employee. A `screenshot.request` message alone is not permission to read
  the screen.
- Never capture when the app is merely running, when the timer starts, or on an activity timer.
  The only trigger is a request delivered/claimed through the backend.
- Do not stop, pause, or otherwise interrupt the work timer while capturing or uploading. Capture
  in the background in the main process and leave session/heartbeat state untouched.
- Show a clear employee-visible indicator while a capture/upload is in progress and when it fails.
  The indicator is not a substitute for the organization disclosure.
- Capture only the desktop pixels needed for the request. Do not include window titles, clipboard,
  keystrokes, URLs, or extra metadata in the image or API calls. The server accepts none of those
  fields.
- Never send an `employeeId`, `organizationId`, `desktopAgentId`, status, upload token hash, or
  storage key from the client. The authenticated agent and server-side request row determine all
  ownership.
- Delete local image files immediately after upload/complete/fail/expiry. Do not keep a screenshot
  library on disk. If a request expires, discard the image and do not upload it.

### Message/HTTP flow

All HTTP calls use the bearer token plus `X-Agent-Id`, `X-Agent-Key`, and `X-Organization-Id`.
WebSocket messages are available for the same transitions; HTTP is the implemented path and the
recovery path. The Electron client currently uses WS only for request/pending/cancellation delivery
and HTTP for ack/claim/upload/complete/fail.

1. Receive `screenshot.request` (or discover it in `connected.pendingScreenshotRequests`).
2. Optionally send `screenshot.ack` / `POST /agent/screenshot-requests/:requestId/ack`. This is
   informational and does not authorize capture.
3. Claim:
   - HTTP: `POST /agent/screenshot-requests/:requestId/claim` with
     `{ "contentType": "image/jpeg" }`.
   The server re-checks policy, ownership, active time session, expiry, and duplicate claims.
4. Capture the primary display in the Electron main process, encode JPEG, and verify it is
   non-empty and within `upload.maxBytes`. Abort if cancellation or expiry arrives first.
5. Upload to the returned target:
   - Local storage: `PUT upload.url` with the agent auth headers plus `upload.requiredHeaders`.
     Keep `Content-Type` exactly equal to `upload.contentType`.
   - S3: `PUT upload.url` with `upload.headers` (the presigned URL carries authorization). Do not
     add bearer/agent credentials if `requiresAgentAuth` is `false`; do not change the signed
     headers.
6. Complete:
   - HTTP: `POST /agent/screenshot-requests/:requestId/complete` with
     `{ "captureTimestamp": "<ISO-8601>" }`.
   The server verifies the stored object, content type/size, request state, and retention, then
   creates metadata.
7. On failure, send `POST .../fail` with a short code such as `CAPTURE_FAILED` and an optional
   sanitized message. Do not send raw exception text or local paths.

`captureTimestamp` should be the time the image was captured, not the upload time. It must be
ISO-8601 with an offset. The server rejects unknown completion fields, including `storageKey`.

### Reconnect, retry, and expiry

- `connected.pendingScreenshotRequests` is authoritative for recovery. Treat a `PENDING` request
  as claimable and a `CLAIMED` request as resumable.
- If the claim response was lost, use the HTTP pending list and, for a `CLAIMED` request, call
  `POST /agent/screenshot-requests/:requestId/upload-authorization` to get a fresh short-lived
  target. Re-claiming an already claimed request returns `SCREENSHOT_ALREADY_CLAIMED`.
- If the upload response was lost, do **not** upload again with the consumed token. Call `complete`;
  the server knows the object was uploaded. Reusing the old upload URL returns
  `UPLOAD_AUTHORIZATION_INVALID`.
- If `upload-authorization` returns `SCREENSHOT_ALREADY_UPLOADED`, call `complete` instead.
- If the upload authorization expired before any bytes were stored, request a new authorization.
  If the whole request expired, discard the image and stop.
- The server may send `screenshot.cancelled` while capture/upload is in progress. Abort the capture,
  discard the image, and acknowledge no further work for that request.
- One active request per employee is enforced by the backend. Serialize screenshot work in the
  main process and never run two captures concurrently.
- Do not retry a terminal `COMPLETED`, `FAILED`, `EXPIRED`, or `CANCELLED` request.

### Capture behavior

Use Electron main-process APIs (for example `desktopCapturer` plus a platform-appropriate encoder,
or an OS screenshot facility) rather than renderer APIs, so the agent credential and image bytes
never enter the renderer. Capture the current/primary display by default. Do not add audio, cursor
history, window titles, or a screen recording.

While capture/upload runs:

- show the visible indicator;
- keep the timer and heartbeat running;
- bound the local encode/upload time and abort on cancellation/expiry;
- validate the encoded size before upload; if it exceeds the server limit, fail the request rather
  than truncating or uploading a partial image;
- delete temp files in a `finally` block.

### IPC surface

Expose only safe state to the renderer, never image bytes, tokens, upload URLs, or storage keys:

```ts
// main -> renderer
monitoring:statusChanged  // MonitoringStatus: policyKnown, monitoringEnabled, disclosureText,
                          // acknowledgementRequired, acknowledged, phase, activeRequestId,
                          // lastEventAt, message

// renderer -> main
monitoring:status         // read the current display-safe status
```

The renderer displays the disclosure and the active/completed/cancelled/failed phase, including a
visible indicator while capture or upload is running. It cannot start a capture, acknowledge a
request, claim it, or cancel local work directly. There is deliberately no `screenshot:captureNow`,
`screenshot:acknowledge`, or equivalent IPC method; the signed-in agent socket and HTTP lifecycle
in the main process are the only triggers. Backend cancellation aborts in-flight capture and
discards the image.

### Backend endpoints and statuses

| Operation | Endpoint |
| --- | --- |
| Pending recovery | `GET /agent/screenshot-requests/pending` |
| Acknowledge | `POST /agent/screenshot-requests/:requestId/ack` |
| Claim | `POST /agent/screenshot-requests/:requestId/claim` |
| Reissue upload target | `POST /agent/screenshot-requests/:requestId/upload-authorization` |
| Local binary upload | `PUT /agent/screenshot-uploads/:token` |
| Complete | `POST /agent/screenshot-requests/:requestId/complete` |
| Fail | `POST /agent/screenshot-requests/:requestId/fail` |

`PENDING` is claimable; `CLAIMED` means this agent won the claim and may upload; `COMPLETED` is
terminal success; `FAILED`, `EXPIRED`, and `CANCELLED` are terminal failures. The full schemas,
upload targets, audit events, and error codes are in
[API.md](API.md#admin-initiated-screenshots).

### What remains to verify

- Manual end-to-end capture on Windows, macOS, and Linux, including the macOS Screen Recording
  permission prompt and denial path.
- End-to-end verification against both local and S3-compatible private storage, including lost
  upload responses and expired upload authorizations.
- Real-device verification that cancellation during capture discards the image and produces no
  upload, and that an expired request never captures or uploads.
- Manual verification that the portal never receives agent credentials, upload URLs, storage keys,
  or long-lived signed URLs.
- The screenshot review/settings/disclosure UI now exists in the sibling `teamsweb` repository;
  the Electron app still must not expose an admin request/history surface to employees.

Do not mark screenshot capture as fully working in production until these checks pass.

---

## 8. Activity collection and privacy

The existing `ActivityCollectionService` records foreground application events locally. Map only
the metadata the server accepts:

| Renderer field | Server field |
| --- | --- |
| `id` | `idempotencyKey` |
| `sessionId` | `sessionId` |
| `applicationName` (non-null) | `applicationName` |
| derived process/executable name | `applicationIdentifier` |
| `startedAt` / `endedAt` | `startedAt` / `endedAt` |
| `kind: 'application_focus'` | no server field; only send focus events |
| `employeeId` | **omit**; the server derives it from the agent binding |

Rules:

- Do not send `idle_period` events to the activity endpoint. Idle periods have their own
  endpoint (section 8.1).
- Do not send window titles, URLs, keystrokes, clipboard contents, file contents, or screenshots.
  The activity schema is strict; unknown fields fail validation.
- Client `durationSeconds` is accepted for contract compatibility but ignored. The server computes
  the duration from the interval and clips it to actual working time.
- Batch up to 200 events. Keep the same `idempotencyKey` across retries; duplicates return
  `duplicate` and do not create a second row.
- `sessionId` is optional; omit it and the server binds the event to the agent's current open
  session. If supplied, it must belong to the same employee and agent.
- Send `platform` (for example `win32`, `darwin`, `linux`) when you know it. The server falls back
  to the registered agent platform.
- Events must belong to the active/known session for that agent. Queue them while offline and
  flush after reconnect; overlapping intervals are rejected (`EVENT_OVERLAP`).
- `ActivityCollectionService.listEvents` stays local. Admin/manager reports are separate
  server-side endpoints and already include a non-productivity-proof disclaimer.
- Application activity must never trigger or influence screenshot capture. Screenshot requests
  come only from the explicit backend lifecycle in section 7.

### 8.1 Organization tracking policy and idle intervals

Fetch `GET /api/v1/organizations/:organizationId/activity/settings` after login, after the agent
registers, and periodically (for example every few minutes) while the agent is running. The
response includes `policyVersion`, `policyUpdatedAt`, and `serverTime`.

- When `appTrackingEnabled` is `false`, stop collecting and flushing foreground application
  activity. Do not discard locally queued events silently; keep them bounded and flush them only
  if tracking is re-enabled, or drop them according to your own disclosed local-retention policy.
  The server will reject batches with `403 APP_TRACKING_DISABLED` while disabled.
- When `idleDetectionEnabled` is `false`, stop measuring and uploading idle intervals. App
  tracking may remain enabled.
- Run idle detection from OS inactivity signals only (for example Electron
  `powerMonitor.getSystemIdleTime()`), never from keystrokes or pointer content. A period becomes
  an idle interval when it reaches `idleThresholdMinutes * 60` seconds. Send it to
  `POST /api/v1/organizations/:organizationId/activity/idle-intervals/batch`:

```json
{
  "intervals": [
    {
      "idempotencyKey": "idle-<device>-<start-epoch-ms>",
      "sessionId": "…",
      "platform": "win32",
      "startedAt": "2026-10-22T12:00:00.000Z",
      "endedAt": "2026-10-22T12:07:30.000Z"
    }
  ]
}
```

- The server computes duration and rejects intervals shorter than the current organization
  threshold with `IDLE_BELOW_THRESHOLD` (per interval). Equal-to-threshold intervals are accepted.
- After sleep/resume, a restart, or reconnect, upload the observed range once with the same
  idempotency key. Repeats return `duplicate`; overlapping idle ranges are merged at report time.
- Do not split an idle period into fragments below the threshold. Do not count break time as
  idle; breaks already have their own endpoints.
- `403 IDLE_DETECTION_DISABLED` means stop uploading idle data until the next policy fetch.
- Both ingestion endpoints return per-event results. A rejected interval does not fail the
  others; retry only transient failures, and never with a new idempotency key for the same
  observed interval.

---

## 9. Offline time-tracking protocol

Only enter offline mode after a network failure is confirmed (not after a `4xx` response). An
offline session must be an explicit, durable local record:

1. Generate a client UUID for the session and each subsequent event. Store the queue durably in
   the main process.
2. On offline start, enqueue `SESSION_START` with `sessionId`, `occurredAt`, and `eventId`.
3. Break writes enqueue `BREAK_START`/`BREAK_END`; stop enqueues `SESSION_STOP`.
4. Keep event timestamps from the local clock. Send them as ISO-8601 with an offset. The server
   enforces backfill/future-skew windows and applies events in chronological order.
5. On reconnect, `POST /organizations/:org/time-sessions/sync` with `{ deviceId, events }`.
6. Mark each event `applied`/`duplicate` as acknowledged and remove it from the queue. On
   `conflict`, do not retry the same `eventId`: fetch the authoritative current state, surface the
   conflict, and create a new event with a new ID if a correction is needed.
7. After sync, fetch `/time-sessions/current` and reconcile the local timer. If the server closes
   an offline session or auto-closes a stale one, adopt the server state.

The server never trusts client durations. The local timer may display an estimate, but session
history, daily totals, and application usage are derived from stored timestamps and clipped to
working intervals.

---

## 10. Adapter/IPC surface

These are the minimal purpose-built methods the renderer needs. None expose tokens or agent keys:

```ts
// main -> renderer
auth:sessionChanged        // AuthSession | null
tracking:stateChanged      // safe timer snapshot (status, session/break IDs, server timestamps)
tracking:statusChanged     // connection/queue/message state
monitoring:statusChanged   // policy disclosure + phase + activeRequestId + safe message only

// renderer -> main
auth:signIn(credentials)
auth:signOut()
auth:restore()
tracking:start()
tracking:stop()
tracking:startBreak()
tracking:endBreak()
tracking:refreshCurrent()
tracking:status()
monitoring:status()
activity:flush()
```

Keep the allowlist in `preload` explicit. Do not expose a generic `invoke(url, headers, body)` and
do not add any renderer method that starts, acknowledges, claims, or cancels a screenshot. Those
transitions belong to the authenticated main-process screenshot service.

---

## 11. Manual integration checklist

Run against a migrated PostgreSQL database and a real Electron build:

1. Desktop sign-in stores the refresh token in `safeStorage`; renderer cannot read it.
2. Register a device; verify the agent key is shown once and stored only in main.
3. Start work; server session exists with a server timestamp and the renderer adopts its ID.
4. Start/resume a break; server status is `ON_BREAK` then `ACTIVE`, breaks do not count as work.
5. Stop work; server records the stop and the renderer shows the server end time.
6. Kill the network while working; the UI shows offline, local timer continues, queue grows.
7. Reconnect; sync applies events in order, retries return `duplicate`, no duplicate time rows.
8. Force a conflicting second break/stop; the server returns a stored conflict and the app
   reconciles from `/current` without retrying the same event ID.
9. Emit foreground app events; verify metadata rows, server-derived durations, overlap rejection,
   and the usage report disclaimer.
10. Revoke the device as an administrator; the live socket closes, the session stops, the app
    stops tracking and displays the admin-action message.
11. Suspend a membership/disable an account while connected; the next heartbeat/status closes the
    socket with `4003`.
12. Refresh the access token; the app reconnects with the new bearer token and keeps durable
    session/heartbeat state.
13. As an administrator, enable the policy with disclosure and request one screenshot while the
    employee is working. Verify the agent shows its visible indicator, the timer keeps running,
    and the request moves `PENDING → CLAIMED → COMPLETED`.
14. Verify the uploaded image appears in admin review through a short-lived link, then expires.
    Confirm the API never returns a storage key or permanent public URL.
15. Cancel a request during capture/upload; verify the local image is discarded and no completion
    is accepted. Let another request expire; verify the agent discards it after restart/reconnect.
16. Disconnect the network after claim but before upload; reconnect and verify pending recovery,
    upload reauthorization, and completion (or a clean expiry/failure).
17. Confirm no screenshot is captured when the timer starts, while the app is merely running, or
    from application activity. Only an explicit backend request may trigger capture.
18. Confirm no window titles, keystrokes, clipboard data, or unrelated screen content are sent or
    stored.

---

## 12. Explicit non-goals in Step 2/3

- No Electron source changes were made in this repository step.
- No real screenshot capture/upload exists in this repository. The backend lifecycle/storage
  contract is implemented and tested; the Electron implementation and Next.js review UI remain
  future work.
- No window content, keystroke, clipboard, URL, or full window-title collection.
- No productivity scoring or proof-of-work claims. Application usage and category ratios are
  descriptive foreground metadata only, never an employee performance score.
- Employee attendance summaries and correction requests are additive HTTP contracts; they do not change Electron session/agent/offline-sync behavior.
