# TempoNest Desktop

A focused employee desktop time tracker built with Electron, React, TypeScript, Vite, and Tailwind CSS. The app is now wired to the real TempoNest backend for desktop authentication, desktop-agent registration, server-authoritative time tracking, authenticated WebSockets, heartbeat handling, and offline event synchronization.

Screenshots, OS activity detection, the admin portal, and backend changes remain out of scope.

## What the desktop app does

- Signs in with real backend credentials through `POST /api/v1/auth/login` using the documented `client: "desktop"` flow.
- Registers this installation as a desktop agent for the signed-in employee and stores the one-time `tna_…` key with Electron `safeStorage`.
- Connects to `ws(s)://<host>/api/v1/ws/agent` with bearer and agent credentials supplied only by the Electron main process.
- Keeps the existing timestamp-based timer and guarded `IDLE → WORKING → ON_BREAK → WORKING → IDLE` transitions.
- Uses the server as the source of truth for session IDs and online start/break/resume/stop timestamps.
- Reconciles the cached timer with the authoritative server snapshot before showing it, so a session stopped at quit cannot reappear as running after relaunch.
- Loads every session overlapping the current local day from the existing paginated `GET /organizations/:organizationId/time-sessions` endpoint and derives today's worked time, break time, and session count from those intervals.
- Scopes the local timer cache by organization and employee, so totals survive sign-out and restart without mixing accounts.
- Shows today's totals only after reconciliation; while they load it shows a placeholder, and a failed load shows a retryable error instead of an authoritative-looking zero.
- Stops the active server session when the app quits, including through Alt+F4 or the window close button.
- Recovers an active session after a renderer reload or app restart.
- Persists failed network mutations as durable, user-scoped offline events and replays them through `/time-sessions/sync`.
- Handles `applied`, `duplicate`, and `conflict` sync results. Conflict event IDs are acknowledged and never retried.
- Refreshes rotated access/refresh tokens once per failed request and reconnects the WebSocket on close code `4001`.
- Treats close code `4003` and `agent.revoked` as a blocked device, resets the local timer, and does not silently retry.
- Keeps refresh tokens, agent keys, and raw API errors out of the renderer.

## Requirements

- Node.js 22.12 or newer.
- The TempoNest backend running and migrated.
- A backend user with an active organization membership. The desktop app does not include self-registration or organization administration.

## Configuration

The Electron main process reads:

| Variable | Default | Purpose |
| --- | --- | --- |
| `TEMPO_API_BASE_URL` | `http://localhost:4000/api/v1` | Backend API base URL |
| `TEMPO_WS_URL` | Derived from the API URL | Optional explicit agent WebSocket URL |

Because configuration is read in the main process, it is not exposed to the renderer or baked into renderer JavaScript.

## Running both applications

### 1. Start the backend

```powershell
cd D:\Code\Personal\teamsbackend
npm install
# Configure .env (PostgreSQL, TOKEN_PEPPER, and other required secrets).
npm run db:migrate
npm run dev
```

Check readiness:

```powershell
Invoke-RestMethod http://localhost:4000/api/v1/health
Invoke-RestMethod http://localhost:4000/api/v1/health/ready
```

### 2. Create or use an employee account

The backend must contain an active user and organization membership. The backend's registration/organization APIs or existing admin tooling can create one. The desktop login screen no longer has demo credentials.

### 3. Start the desktop app

```powershell
cd D:\Code\Personal\teamselectron
npm install
npm run dev
```

If npm skipped Electron's post-install step:

```powershell
node node_modules/electron/install.js
```

If the backend is not on the default URL:

```powershell
$env:TEMPO_API_BASE_URL = 'https://api.example.com/api/v1'
npm run dev
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Launch Electron with renderer hot reload |
| `npm run typecheck` | Type-check the Electron/Node and React TypeScript projects |
| `npm run build` | Type-check, then build production assets into `out/` |
| `npm test` | Run unit tests; real-backend E2E is skipped unless enabled |
| `npm run test:backend` | Run the real backend integration test against `TEMPO_API_BASE_URL` |
| `npm run preview` | Run the production build in Electron |
| `npm run package` | Build and create a Windows NSIS installer |
| `npm run package:dir` | Build an unpacked Windows app |
| `npm run package:mac` | Build a macOS DMG on macOS |

### Real backend tests

`npm run test:backend` performs a live end-to-end flow against `http://localhost:4000/api/v1` by default:

1. Registers a unique test user.
2. Logs in with the desktop flow.
3. Creates an organization and registers a desktop agent.
4. Starts a session, takes/resumes a break, sends a heartbeat, and stops.
5. Applies a four-event offline batch, verifies duplicate handling, and verifies a durable conflict.
6. Rotates the refresh token and verifies reuse revokes the session family.
7. Opens an authenticated agent WebSocket, revokes the agent, and verifies close code `4003` and stopped tracking.

The test leaves the test user/organization/agent data in the backend because the backend has no account-deletion endpoint.

## Architecture and security boundaries

```text
React renderer / TimerProvider
    │  allowlisted IPC only
    ▼
preload (`window.temponest.auth`, `window.temponest.tracking`)
    ▼
Electron main process
    ├── AuthManager          login, refresh rotation, logout, last organization
    ├── AgentManager         stable device ID, registration, key rotation
    ├── ApiClient            bearer/agent headers, timeout, one refresh retry
    ├── OfflineQueue         durable per-user events in userData
    ├── AgentSocket          `ws` upgrade headers, heartbeat, backoff/close codes
    ├── TrackingController   server-authoritative mutations and reconciliation
    └── SecureStore          safeStorage-encrypted refresh token and agent key
```

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- Preload exposes no raw `ipcRenderer`, Node.js primitives, tokens, agent keys, or filesystem paths.
- Renderer mutations accept only validated session/break IDs and ISO timestamps.
- The main process maps backend errors to short user-safe messages before IPC.
- Permission requests and new windows are denied; external `https:` links go to the OS browser.
- Production builds use a strict Content-Security-Policy.

Credential storage uses Electron `safeStorage` in the user-data directory. If the operating system has no available secure storage backend, sign-in persistence fails with a user-safe error instead of writing plaintext credentials.

## Timer and server reconciliation

The renderer's timer reducer remains the UI cache and the source of the displayed durations:

- Durations are always derived from timestamps, not incremented counters.
- Only one active session and one open break are possible.
- The server's session/break IDs and online timestamps replace optimistic local values after successful requests.
- Offline mutations keep the optimistic renderer state; a queued result does not overwrite it with an older server snapshot.
- After reconnect, the durable queue is flushed before `/time-sessions/current` is fetched. The fetched snapshot then reconciles the display.
- If the server reports a conflict, the conflicting event is acknowledged and removed from the queue and the current server state is adopted.
- The local completed-session cache is preserved when the server reports no active session, so the tracker can still show today's local totals.

### Today totals

- The main process requests the day's sessions with `from`/`to`, `limit=100`, and `page=1..N`, then locally keeps only sessions for the authenticated employee and organization that overlap the day.
- The local day is the device's local calendar day: local midnight to the next local midnight. This is the app's existing timezone convention; the organization timezone is not used for display.
- Work time is the session interval minus overlapping break intervals; break time is the overlapping break intervals. Overlaps are clipped to the local day, so a session crossing midnight contributes only its current-day portion.
- Sessions are merged by server ID. Server timestamps win over cached timestamps, and an active session is counted once, not also as completed.
- A pending stop that has not synced keeps its locally recorded completed session; a later sync replaces it by ID without double-counting.
- The cache key is `<organizationId>:<employeeId>`. The old unscoped timer cache is not adopted because it cannot be attributed to an employee safely.

## Offline behavior

Only confirmed transport failures enter offline mode. HTTP `4xx` errors never create offline events.

Offline events are stored in `offline-queue.json` in Electron's user-data directory, scoped to the authenticated user. They contain timestamps, event types, session IDs, and event IDs only — no tokens or agent keys. Event IDs are de-duplicated, and the queue is cleared on explicit sign-out. An involuntary session invalidation keeps the queue so a pending quit-time stop can still be reconciled when the same employee signs in again; signing in as a different employee discards the previous user's events.

On reconnect the app sends up to 200 events per request to:

```text
POST /organizations/:organizationId/time-sessions/sync
```

It then fetches the authoritative current session. The WebSocket reconnect path and a periodic HTTP/WebSocket recovery sweep both trigger this flow, so a session started while offline can be recovered after registration/network restore.

## Authentication and revocation behavior

- Access and refresh tokens are held in the main process.
- The rotating refresh token is encrypted with `safeStorage`.
- Concurrent requests share one refresh promise.
- Concurrent launch restores (StrictMode, renderer reloads, repeated IPC calls) share one rotation. Two rotations with the same token would trip the backend's reuse detection and revoke the session family.
- Only one app instance is allowed per OS user; launching again focuses the running window instead of racing the refresh token.
- Refresh tokens are rotated on every successful refresh.
- Invalid, expired, reused, or revoked sessions clear local credentials and move the renderer back to sign-in.
- An `AGENT_CREDENTIALS_INVALID` response rotates the agent key once and retries the request.
- A revoked agent clears the local agent key, stops the timer display, and shows a blocked-state banner. The signed-in session remains available unless the backend separately rejects the account or membership.
- Quitting stops the active server session at close time. A durable `SESSION_STOP` is written before the request, so an offline quit or a lost response is applied through `/time-sessions/sync` at the next authenticated launch, before `/time-sessions/current` is fetched.
- Explicit sign-out clears local refresh/agent credentials and the offline queue, but it does not stop an active server session. Reopening the same account reconciles that session.

## Project structure

```text
electron/
  main.ts                  Secure window, CSP, app lifecycle
  preload.ts               Narrow, allowlisted contextBridge API
  appRuntime.ts            IPC handlers and service wiring
  apiClient.ts             JSON transport, bearer/agent headers, refresh retry
  authManager.ts           Desktop auth and token rotation
  agentManager.ts          Device identity and desktop-agent registration
  secureStore.ts           safeStorage-encrypted credential file
  offlineQueue.ts          Durable user-scoped offline event queue
  agentSocket.ts           Authenticated `ws` client, heartbeat and reconnect
  trackingController.ts    Server-authoritative tracking, sync, quit-time stop
  shutdownCoordinator.ts   One-shot, time-bounded quit cleanup
  backendTypes.ts          Exact backend response shapes
  errors.ts                Safe error mapping
src/
  auth/                    AuthProvider and session gate
  screens/                 Login and single employee tracker screen
  services/                Renderer IPC adapters and contracts
  tracking/                Reducer, persistence, server mapping, TimerProvider
  types/                   Auth, tracking, API, and Electron bridge types
tests/
  timerMachine.test.ts     Timer guards, hydration, day totals, interval and midnight math
  timerStorage.test.ts     Organization/employee cache isolation
  trackerScreen.test.ts    Renderer content: identity, controls, totals states
  offlineQueue.test.ts     Persistence, dedupe, user scoping
  authManager.test.ts      Single-flight launch restore and token retention
  trackingController.test.ts  Quit-time stop, durable pending stop, launch order, day list
  shutdownCoordinator.test.ts Idempotent, time-bounded quit cleanup
  backend.e2e.test.ts      Real auth/tracking/sync/WebSocket/revocation flow
shared/
  branding.ts              Product name, app ID, local storage keys
```

## Known gaps and limitations

- There is no organization chooser. The app uses the last active organization for the signed-in user, then the first active membership.
- Restoring a session requires network access because it rotates the refresh token. There is no offline authentication mode.
- Explicit sign-out does not stop an active server session; quitting the app does. A forced process kill cannot run quit cleanup, so the next launch still relies on `/current` reconciliation and server heartbeat staleness.
- If a relaunch is offline while a stop is pending, the tracker shows idle rather than a stale running timer and closes the cached session at the recorded stop time, so local totals keep those minutes. Because today's authoritative list cannot be loaded, the totals area shows a retryable error instead of presenting the cached numbers as verified. The server record is reconciled once the queued stop syncs.
- WebSocket transport requires network access; HTTP heartbeat fallback covers a missing socket while requests still succeed.
- The offline start-after-lost-response edge case can lose later queued break events if the server created a different session ID. The current state is still adopted after sync.
- There is no continuous screen monitoring, foreground application detection, idle detection, or keystroke capture. Screenshot handling remains the existing administrator-requested flow.
- The employee tracker renders no monitoring disclosure or workspace footer. Screenshot capture, policy enforcement, and required acknowledgements are unchanged and remain controlled by the existing backend and main-process services.
- Local-day totals use the device timezone, not the organization's configured timezone, so a user traveling across timezones can see a day boundary that differs from the web portal.
- Today's list is bounded to 20 pages of 100 sessions. A day with more than 2,000 overlapping sessions would be truncated.
- No admin portal, employee reports, charts, or settings UI are part of this app.
- Startup updates, code signing, notarization, and auto-update are not configured.
- Real backend tests create durable test accounts because no cleanup endpoint exists.
