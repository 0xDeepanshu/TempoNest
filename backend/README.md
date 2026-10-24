# TempoNest Backend — Step 3: Admin-Initiated Screenshots

Production-oriented foundation for TempoNest: a modular monolith REST API used by the Next.js admin portal and Electron employee application.

Step 1 implements organizations, users, memberships, invitations, browser and desktop authentication, authorization, and supporting security/reliability infrastructure. Step 2 adds server-authoritative time tracking, registered desktop agents, authenticated agent WebSockets, offline reconciliation, foreground application metadata, and reporting. Step 3 adds **explicit, administrator-initiated individual screenshot requests**, a per-organization monitoring policy/disclosure, private local or S3-compatible object storage, short-lived upload/download authorization, lifecycle recovery over HTTP/WebSocket, an audit trail, and retention cleanup.

There is no periodic, automatic, timer-triggered, or usage-triggered screenshot capture. The backend lifecycle and storage contract is implemented, but **the Electron capture/upload client and Next.js admin UI are not part of this repository and are not claimed to work yet**; see [docs/ELECTRON_INTEGRATION.md](docs/ELECTRON_INTEGRATION.md).

---

## Technology

| Concern | Choice |
| --- | --- |
| Runtime | Node.js ≥ 20 (developed on Node 24) |
| HTTP | Express 4 |
| Language | TypeScript 5, `strict` mode |
| Database | PostgreSQL 13+ (verified on PostgreSQL 18) |
| ORM | Sequelize 6 + `sequelize-cli` migrations |
| Validation | Zod |
| Passwords | Argon2id via `@node-rs/argon2` |
| Logging | Pino + `pino-http` |
| Tests | Vitest + Supertest (SQLite in-memory by default, PostgreSQL optional) |

---

## Quick start

```bash
npm install

# Copy the example configuration and edit the placeholders
cp .env.example .env            # PowerShell: Copy-Item .env.example .env

# Generate a strong TOKEN_PEPPER (at least 32 characters)
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# Create the database (or create it manually), then migrate
npm run db:create
npm run db:migrate

npm run dev
```

The API listens on `http://localhost:4000` by default.

```bash
curl http://localhost:4000/api/v1/health
curl http://localhost:4000/api/v1/health/ready
```

Quick end-to-end account flow:

```bash
# 1. Create an account
curl -X POST http://localhost:4000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ada Lovelace","email":"ada@example.com","password":"CorrectHorseBattery9!"}'

# 2. Log in as a desktop client (tokens in the response body)
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"CorrectHorseBattery9!","client":"desktop"}'

# 3. Create an organization; the caller becomes OWNER
curl -X POST http://localhost:4000/api/v1/organizations \
  -H 'Authorization: Bearer <accessToken>' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Acme Corp"}'
```

See [docs/API.md](docs/API.md) for the full HTTP and WebSocket contract, and [docs/ELECTRON_INTEGRATION.md](docs/ELECTRON_INTEGRATION.md) for the Electron `AuthService`/`TimeTrackingService` integration guide.

A minimal Step 2 flow after creating the organization:

```bash
# 4. Register this desktop installation (bearer token from desktop login)
curl -X POST http://localhost:4000/api/v1/organizations/<organizationId>/desktop-agents \
  -H 'Authorization: Bearer <accessToken>' \
  -H 'Content-Type: application/json' \
  -d '{"deviceId":"install-001","name":"Ada laptop","platform":"win32"}'

# 5. Start a server-timestamped session (agent credentials from step 4)
curl -X POST http://localhost:4000/api/v1/organizations/<organizationId>/time-sessions/start \
  -H 'Authorization: Bearer <accessToken>' \
  -H 'X-Agent-Id: <agentId>' \
  -H 'X-Agent-Key: <agentKey>'
```

The agent key is shown only at registration/key rotation. Store it in the Electron main process with OS-protected storage, never the renderer.

A minimal Step 3 policy/request flow (owner/admin credentials):

```bash
# 6. Enable the organization policy and publish a disclosure
curl -X PATCH http://localhost:4000/api/v1/admin/screenshot-policy \
  -H 'Authorization: Bearer <accessToken>' \
  -H 'X-Organization-Id: <organizationId>' \
  -H 'Content-Type: application/json' \
  -d '{"enabled":true,"disclosureVersion":"v1","disclosureText":"Authorized administrators may request individual screenshots during active work sessions."}'

# 7. Request one screenshot for an employee with an active, fresh session
curl -X POST http://localhost:4000/api/v1/admin/employees/<employeeUserId>/screenshot-requests \
  -H 'Authorization: Bearer <accessToken>' \
  -H 'X-Organization-Id: <organizationId>' \
  -H 'Idempotency-Key: request-001'
```

The request is delivered only if the employee’s agent has a live WebSocket; otherwise it stays pending until reconnect or expiry. The Electron capture/upload client is not implemented here, so no image will be produced until that integration exists.

---

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the API with `tsx watch` |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server (`dist/server.js`) |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run the Vitest suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run db:create` / `db:drop` | Create/drop the configured database |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:migrate:status` | Show migration state |
| `npm run db:migrate:undo` | Roll back the last migration |
| `npm run db:reset` | Roll back all migrations and re-apply them |
| `npm run smoke` | Run an end-to-end smoke script against a migrated DB |

`sequelize-cli` reads `config/database.cjs`, which uses `DATABASE_URL` when present and falls back to the `DB_*` variables.

---

## Project structure

```text
config/
  database.cjs              # Sequelize CLI configuration
migrations/                 # Explicit PostgreSQL migrations (never sync/alter in production)
scripts/
  smoke.ts                  # End-to-end smoke check against a migrated database
src/
  app.ts                    # Express app factory (middleware, routes, error handling)
  server.ts                 # Bootstrap, DB connection, HTTP+WebSocket, graceful shutdown
  config/
    env.ts                  # Zod-validated environment configuration
    logger.ts               # Pino logger with secret redaction
  database/
    index.ts                # Sequelize instance, health check, connection helpers
    models.ts               # Model initialization and associations
  middleware/
    authenticate.ts         # Optional auth + requireAuth
    csrf.ts                 # Cookie-session CSRF protection + origin allowlist
    errorHandler.ts         # Consistent error envelope, 404 handler
    rateLimit.ts            # Global per-IP limiter + agent auth limiter
    requestId.ts            # Request correlation ID
    validate.ts             # Zod validation for body/query/params
  modules/
    auth/                   # Session model, login/refresh/logout, session revocation
    organizations/          # Organization model, routes, services, policies
    memberships/            # Membership model, roles/permissions, member management
    invitations/            # Invitation model, invite/accept/revoke flows
    users/                  # User model
    health/                 # Liveness and readiness endpoints
    desktopAgents/          # Registration, key rotation, agent auth, revocation
    timeTracking/           # Sessions, breaks, heartbeats, offline event ledger
    activity/               # Foreground application metadata ingestion
    reporting/              # Tracking status, session/daily/app reports
    attendance/             # Summaries, corrections, mobile check-in, private evidence
    screenshots/            # Policy, admin requests, agent lifecycle, private storage,
                            # audit events, retention/maintenance
  realtime/
    agentHub.ts             # Process-local live WebSocket registry
    agentWebSocket.ts       # Authenticated /ws/agent upgrade, messages, sweeps
  routes/index.ts           # /api/v1 router composition
  types/express.d.ts        # Request augmentation (auth, request ID, org, agent)
  utils/                    # Errors, tokens, passwords, cookies, pagination, time, serialization
tests/
  setup.ts                  # Test environment
  helpers.ts                # Database reset and auth/org/invite/agent helpers
  auth.test.ts
  organizations.test.ts
  invitations.test.ts
  desktopAgents.test.ts
  timeTracking.test.ts
  attendance.test.ts
  attendanceMobile.test.ts
  screenshots.test.ts
  websocket.test.ts
  rateLimit.test.ts
docs/
  API.md                    # HTTP + WebSocket contract
  ELECTRON_INTEGRATION.md   # Electron integration plan, incl. screenshot capture
```

---

## Configuration

All environment variables are validated at startup by `src/config/env.ts`; invalid production configuration fails fast without printing secret values.

Key variables (see `.env.example`):

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Preferred PostgreSQL connection string |
| `DB_*` | Used when `DATABASE_URL` is absent |
| `TOKEN_PEPPER` | ≥ 32 chars, **required in production**; HMAC key for opaque tokens |
| `ACCESS_TOKEN_TTL_SECONDS` | Default 900 (15 min) |
| `REFRESH_TOKEN_TTL_SECONDS` | Default 2,592,000 (30 days) |
| `INVITATION_TTL_SECONDS` | Default 604,800 (7 days) |
| `MAX_ACTIVE_SESSIONS_PER_USER` | Oldest sessions are revoked beyond this limit (default 10) |
| `ARGON2_MEMORY_KIB` / `ARGON2_TIME_COST` / `ARGON2_PARALLELISM` | Argon2id cost parameters |
| `COOKIE_SECURE` / `COOKIE_SAME_SITE` / `COOKIE_DOMAIN` | Cookie policy; production defaults to `Secure` |
| `CORS_ORIGINS` | Comma-separated exact allowlist, no wildcards |
| `TRUST_PROXY` | `false`, `true`, or a hop count |
| `RATE_LIMIT_ENABLED` / `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_MAX` | In-memory rate limits |
| `HEARTBEAT_STALE_SECONDS` | Freshness window for `WORKING`/`ON_BREAK`/`ONLINE` (default 120) |
| `SESSION_STALE_SECONDS` | Open-session recovery threshold at the next start (default 600) |
| `OFFLINE_MAX_BACKFILL_SECONDS` / `OFFLINE_FUTURE_SKEW_SECONDS` | Offline event acceptance window (default 7 days / 5 minutes) |
| `ACTIVITY_MAX_BACKFILL_SECONDS` / `ACTIVITY_FUTURE_SKEW_SECONDS` | Application metadata acceptance window (default 30 days / 60 seconds) |
| `WS_MAX_PAYLOAD_BYTES` / `WS_SWEEP_INTERVAL_SECONDS` | Agent WebSocket payload cap and liveness sweep |
| `SCREENSHOT_STORAGE_DRIVER` | `local` (default) or `s3` private object storage |
| `SCREENSHOT_LOCAL_DIR` | Private local directory when the driver is `local` |
| `PUBLIC_BASE_URL` | Public HTTPS origin used to build local upload/download URLs; required in production for local storage |
| `SCREENSHOT_REQUEST_TTL_SECONDS` | Time an unfulfilled request stays active (default 300) |
| `SCREENSHOT_UPLOAD_TTL_SECONDS` | One-time upload authorization lifetime (default 120) |
| `SCREENSHOT_DOWNLOAD_TTL_SECONDS` | Signed review-link lifetime (default 300) |
| `SCREENSHOT_CLEANUP_INTERVAL_SECONDS` | Request/object/audit maintenance interval (default 300) |
| `SCREENSHOT_MAX_BYTES` | Maximum accepted image size (default 10 MiB) |
| `SCREENSHOT_ALLOWED_CONTENT_TYPES` | Comma-separated allowed types; default PNG/JPEG/WebP |
| `SCREENSHOT_S3_BUCKET` / `SCREENSHOT_S3_REGION` | Private bucket and region for `s3` |
| `SCREENSHOT_S3_ENDPOINT` / `SCREENSHOT_S3_FORCE_PATH_STYLE` | S3-compatible endpoint (e.g. MinIO) and path-style toggle |
| `SCREENSHOT_S3_ACCESS_KEY_ID` / `SCREENSHOT_S3_SECRET_ACCESS_KEY` | Optional explicit credentials; omit both to use the runtime IAM role |
| `ATTENDANCE_UPLOAD_TTL_SECONDS` | One-time attendance evidence upload authorization lifetime (default 120) |
| `ATTENDANCE_EVIDENCE_TTL_SECONDS` | Lifetime of uploaded but unattached evidence (default 900) |
| `ATTENDANCE_EVIDENCE_DOWNLOAD_TTL_SECONDS` | Signed attendance evidence link lifetime (default 300) |
| `ATTENDANCE_LOCATION_MAX_ACCURACY_METERS` | Maximum accepted location accuracy (default 500 m) |
| `ATTENDANCE_LOCATION_MAX_AGE_SECONDS` | Maximum age of a location fix (default 300) |
| `ATTENDANCE_LOCATION_FUTURE_SKEW_SECONDS` | Tolerated future clock skew for location timestamps (default 60) |
| `LOG_LEVEL` | Pino level (`silent` in tests) |

`NODE_ENV=production` requires an explicit database configuration, a `TOKEN_PEPPER`, and `COOKIE_SECURE=true` if `COOKIE_SAME_SITE=none`.

---

## Authentication design

### Browser (Next.js portal)

Opaque, server-side sessions are used instead of JWTs so revocation is immediate.

| Cookie | Contents | Flags | Path |
| --- | --- | --- | --- |
| `tn_access` | Access token (15 min) | `HttpOnly`, `SameSite`, `Secure` in prod | `/` |
| `tn_refresh` | Refresh token (30 days) | `HttpOnly`, `SameSite`, `Secure` in prod | `/api/v1/auth` |
| `tn_csrf` | CSRF token (readable by JS) | `HttpOnly=false`, `SameSite`, `Secure` in prod | `/` |

- Unsafe cookie-authenticated requests require `X-CSRF-Token` equal to the `tn_csrf` cookie **and** matching the hash stored on the server-side session.
- Unsafe requests carrying an `Origin` header must match `CORS_ORIGINS`.
- Refresh tokens rotate on every use. Presenting a previously rotated token is treated as theft and revokes the session family.
- Access tokens are rotated along with refresh tokens; the previous access token stops working immediately.
- Logout revokes the current session and clears all three cookies.
- Sessions can be listed and individually revoked; `POST /auth/sessions/revoke-all` revokes every other session.

Because access and refresh tokens are opaque random values (256 bits), they are stored as HMAC-SHA256 hashes keyed by `TOKEN_PEPPER`. A database leak does not yield usable tokens.

### Electron desktop

Credentials never belong in renderer `localStorage`.

1. `POST /api/v1/auth/login` with `"client": "desktop"`.
2. The response body contains `accessToken`, `refreshToken`, and expiry metadata; no cookies are set.
3. Store the **refresh token** encrypted with Electron `safeStorage` (OS keychain/credential vault) from the **main process**.
4. Keep the access token in main-process memory and attach `Authorization: Bearer <accessToken>` to API requests. Expose only purpose-built IPC methods to the renderer.
5. Refresh with `POST /api/v1/auth/refresh` and `{ "refreshToken": ..., "client": "desktop" }`; replace both stored tokens.
6. On logout, call `POST /api/v1/auth/logout` with the bearer token and delete the stored refresh token.
7. If the refresh token is rejected, delete it and return the user to login. Never retry a rejected refresh token.

Bearer-token requests are not subject to CSRF checks because browsers do not attach them automatically.

### Mobile app

Mobile employees use the same accounts and session model as web/Electron; there is no separate mobile account or authentication system.

1. `POST /api/v1/auth/login` with `"client": "mobile"`. No cookies are set, the response retains `"client": "mobile"`, and it contains `accessToken`, `refreshToken`, and expiry metadata.
2. Store the refresh token in the OS Keychain/Keystore; keep the access token in memory where possible and attach `Authorization: Bearer <accessToken>`.
3. Restore with `POST /api/v1/auth/refresh` and `{ "refreshToken": ..., "client": "mobile" }`, replacing both stored tokens.
4. Log out with `POST /api/v1/auth/logout` using the bearer token, or with the refresh token when no valid access token remains.
5. Mobile authentication alone does not authorize time-tracking writes. Those still require a registered `MOBILE` device and the existing agent authorization checks.

### Passwords

- Argon2id hashing with configurable cost.
- Minimum 12 characters, maximum 128.
- Login verifies a dummy hash when the account does not exist to reduce enumeration timing leaks.
- Login errors are deliberately identical for unknown accounts and wrong passwords.
- Passwords and hashes are never included in responses or logs.

### Login rate limiting

`POST /auth/login` is limited per IP (`LOGIN_RATE_LIMIT_MAX`, default 10 failed attempts per 15 minutes). Successful logins do not consume the budget. A broader per-IP limit applies to the whole API. The default store is in-memory, which is correct for a single instance; use a shared store (e.g. Redis) before scaling horizontally.

---

## Time tracking, agents & activity

### Server-authoritative sessions

- Start/stop/break operations require a bearer token **and** the registered `X-Agent-Id`/`X-Agent-Key`. The employee and organization are derived from that binding; clients cannot submit them.
- Online start, stop, break, and heartbeat timestamps are generated by the server. Client-supplied durations are never trusted.
- Session status is `ACTIVE`, `ON_BREAK`, or `STOPPED`; source is `ONLINE` or `OFFLINE`.
- Partial unique indexes plus transactions and employee row locks prevent duplicate open sessions (per employee and per agent), overlapping breaks, and cross-organization access.
- If a session is reopened after a crash, the stale session is closed at its **last heartbeat**, not at the new start time. `autoClosedSessionId` tells the agent which session was recovered.
- `time_sessions.last_heartbeat_at` and `desktop_agents.last_seen_at` are durable. In-memory WebSocket state is only a live transport registry.

### Desktop agent credentials

- Registration returns a 256-bit `tna_…` agent key exactly once. Only its HMAC-SHA256 hash (keyed by `TOKEN_PEPPER`) is stored.
- Re-registering the same `deviceId` rotates the key and closes old sockets. Revoked device registrations cannot be reused without a new device identity.
- `client_type` is immutable once the device exists: rotation preserves it when omitted and rejects an explicit change with `AGENT_CLIENT_TYPE_MISMATCH`.
- Agent keys belong in Electron main-process OS-protected storage (`safeStorage`); they must never be exposed to the renderer or mobile logs.
- Revocation is logical, preserves history, closes live sockets with code `4003`, and stops that device's open sessions.

### WebSocket presence

- Endpoint: `/api/v1/ws/agent`; auth via `Authorization: Bearer`, `X-Agent-Id`, and `X-Agent-Key` during the HTTP upgrade.
- The server re-checks session expiry, user status, agent revocation, membership status, and organization status on every heartbeat/status message.
- Heartbeats persist session and agent timestamps. Server ping/pong sweeps terminate dead transports.
- “Working/on-break” requires a fresh session heartbeat; “online” requires a fresh agent `last_seen_at`; otherwise the durable state is offline.
- A heartbeat is not a screenshot or a productivity signal.

### Offline reconciliation

- The explicit `POST /time-sessions/sync` protocol accepts 1–200 client-generated UUID events with stable `eventId` values.
- Events are sorted and applied chronologically through the same state machine as online operations.
- `agent_sync_events` is a durable idempotency ledger: retries return `duplicate`; invalid transitions return a stored `conflict` without failing the rest of the batch.
- The device ID must match the authenticated agent. Client durations are not accepted; backfill and future-skew windows are configurable.
- Offline session starts create caller-generated session IDs; the client cannot select an employee, organization, or agent.

### Application metadata

- The activity endpoint stores only foreground application identifier/name and the observed interval. A client `durationSeconds` field is accepted for compatibility but ignored and recomputed by the server.
- The API has no fields for window titles, URLs, keystrokes, clipboard contents, or screenshots. Unknown body fields are rejected.
- Ingestion validates the agent/session/organization binding, deduplicates by per-agent idempotency key, and rejects overlapping intervals.
- Reports clip activity to actual working intervals, excluding breaks and stopped time, and include a non-productivity-proof disclaimer.
- No screenshots are captured or uploaded in Step 2.

### Reporting

- Explicit `from`/`to` local calendar dates are interpreted in the organization's IANA timezone; all timestamps are stored in UTC.
- Session history, per-day working/break totals, application usage summaries, and timelines are paginated where appropriate and bounded by maximum ranges.
- Only OWNER/ADMIN/MANAGER have `report:read`. Employees retain access to their own current session and session history.

### Employee attendance & corrections

- Employees use the existing session history/current endpoints for self-scoped session and break history. The attendance module adds organization-local daily, weekly (Monday-start), and monthly summaries without changing the report contracts.
- `GET /organizations/:organizationId/attendance/summaries` requires `time:read`. Employees are forced to their own `employeeId`; OWNER/ADMIN/MANAGER must select an in-organization employee. Summary totals use distinct session IDs and clip sessions/breaks to the requested local days.
- Employees submit corrections with `time:write`; they cannot choose another employee. A correction targets a stopped session (`UPDATE_SESSION`) or creates a missing stopped session (`CREATE_SESSION`).
- OWNER/ADMIN/MANAGER review with `correction:review`; nobody may review their own correction. The workflow is `PENDING -> APPROVED` or `PENDING -> REJECTED`, with repeat decisions idempotent and conflicting decisions returning `409`.
- Approval runs in one transaction: employee/correction locks, pending/status recheck, timestamp and break validation, overlap recheck, session update/create, break replacement, original/applied snapshots, and an audit event. A stale or conflicting request stays `PENDING` and time data is unchanged.
- Missing-session approvals create a stopped session with the existing `OFFLINE` source and no desktop agent. Existing `ONLINE`/`OFFLINE` sources and all Electron time-tracking contracts remain unchanged.

### Mobile check-in & attendance evidence

- New additive routes let the React Native employee app check in with `WFH`, `WFO`, or `ON_SITE` and attach private photo evidence. They create the same `time_sessions` rows as the existing start endpoint; `/time-sessions/*` behavior and Electron contracts are unchanged.
- New check-in/evidence-write routes require a non-revoked device registered with `clientType: "MOBILE"`. Electron devices receive `403 MOBILE_AGENT_REQUIRED`. Check-in reads remain available to authenticated employees.
- Policy: `WFH` needs neither photo nor location (location is optional and validated if supplied); `WFO` needs a selfie and never accepts or stores a location; `ON_SITE` needs a selfie, a separate site photo, and location. Accuracy (default ≤ 500 m), fix age (default ≤ 5 min), and future skew (default ≤ 60 s) are configurable and apply to ON_SITE and optional WFH locations.
- Evidence lifecycle: create `PENDING` + short-lived upload target → raw private upload (`UPLOADED`) → atomic check-in transaction (`ATTACHED` + session + check-in + audit). A failed check-in attaches nothing and leaves evidence retryable until expiry; evidence attached to a successful check-in is never removed by error recovery.
- `checkInRequestId` makes retries idempotent: the same payload returns the original result (`200`, `replayed: true`), a different payload returns `409 IDEMPOTENCY_KEY_REUSED`. Different request IDs cannot create a second active session (`409 ACTIVE_SESSION_EXISTS`). Employee row locks plus unique indexes serialize concurrent requests across processes.
- Evidence is validated at check-in for ownership, device, kind, status, expiry, stored size, and image signature. Storage keys and upload tokens are never returned.
- Signed access is available to the owning employee and organization reviewers with `time:read`; every grant writes `ATTENDANCE_EVIDENCE_ACCESS_GRANTED` and each local view writes `ATTENDANCE_EVIDENCE_VIEWED`. Attendance links use a separate token context and `/attendance-files` route, so screenshot and attendance access controls stay independent.
- **Retention gap:** attendance evidence has no automatic deletion yet. Private objects and metadata are retained until an approved retention policy is implemented; this must be resolved before production retention commitments. There is no public or admin deletion endpoint.
- The server verifies format, size, and signature but cannot prove live camera capture, honest device clocks, or truthful coordinates. There is no geofencing and no continuous background tracking.

See [docs/API.md](docs/API.md#mobile-attendance-check-in-and-evidence) for schemas and error codes.

### Admin-initiated screenshots

- Capture is opt-in per organization. The policy starts **disabled**; an OWNER/ADMIN must enable it, publish disclosure text, and optionally require employee acknowledgement. Requests cannot be created or claimed while disabled.
- Policy controls request roles, view roles, request cooldown, screenshot retention, audit retention, acknowledgement, and disclosure version. Request roles must be a subset of view roles; both are additionally bounded by the fixed permission matrix, so a policy cannot grant screenshot access to an employee.
- **Only** `POST /admin/employees/:employeeId/screenshot-requests` creates a request. There is no periodic, automatic, bulk, timer-start, or application-usage capture. Each request targets one employee and one active, fresh desktop session.
- Creation is transactional and idempotent with `Idempotency-Key`; a partial unique index allows at most one `PENDING`/`CLAIMED` request per employee. Duplicate, cooldown, acknowledgement, agent, session, and expiry checks are server-side.
- The request is persisted before delivery. The WebSocket message is sent only to the exact authenticated agent; if it is offline, the response says `delivered: false` and the request waits until reconnect or expiry. Pending requests are recovered through `connected.pendingScreenshotRequests` and the HTTP pending endpoint.
- Lifecycle: `PENDING → CLAIMED → COMPLETED`, with terminal `FAILED`, `EXPIRED`, and `CANCELLED`. Duplicate claims/completions, wrong-agent access, replayed upload tokens, and client-supplied storage keys are rejected.
- Claim verifies that the request still belongs to the agent/employee and that the linked time session is active. Upload authorization is one-time, short-lived, and stored only as an HMAC hash. Local binary uploads require the agent credentials and organization header; S3 uploads use a presigned PUT scoped to a server-generated key.
- Images are validated for allowed content type, expected type, signature, size, and emptiness. Binaries are never stored in PostgreSQL. Completed screenshots are served only through HMAC-signed expiring local URLs or presigned S3 GET URLs; there are no permanent public URLs.
- Screenshot review endpoints return metadata and short-lived access URLs, never storage keys. Every policy change, request transition, access grant, local view, and deletion is written to `audit_events`.
- Retention maintenance deletes expired screenshot metadata and private objects, removes objects for cancelled/failed/expired requests, expires overdue requests, cleans abandoned uploads, and removes screenshot audit rows older than the policy’s audit retention. It runs at startup and on `SCREENSHOT_CLEANUP_INTERVAL_SECONDS`.
- Real capture and upload from Electron, the visible employee capture indicator, and the Next.js review UI remain separate integration work. The backend does not claim that a real screenshot has been captured until those clients are implemented and verified.

See [docs/API.md](docs/API.md#admin-initiated-screenshots) for exact schemas, transitions, WebSocket messages, and error codes.

---

## Authorization model

Every organization-scoped request resolves the caller's membership from the database. A client-supplied organization ID is only a selector; it is never proof of access. Non-members receive `404` to avoid leaking organization existence.

| Permission | OWNER | ADMIN | MANAGER | EMPLOYEE |
| --- | :---: | :---: | :---: | :---: |
| `organization:read` | ✅ | ✅ | ✅ | ✅ |
| `organization:update` | ✅ | ✅ | — | — |
| `member:read` | ✅ | ✅ | ✅ | — |
| `member:invite` | ✅ | ✅ | — | — |
| `member:update` (role/suspend/reactivate) | ✅ | ✅ | — | — |
| `member:remove` | ✅ | ✅ | — | — |
| `invitation:read` / `invitation:revoke` | ✅ | ✅ | — | — |
| `time:read` / `time:write` | ✅ | ✅ | ✅ | ✅ |
| `report:read` | ✅ | ✅ | ✅ | — |
| `correction:review` | ✅ | ✅ | ✅ | — |
| `agent:read` | ✅ | ✅ | ✅ | ✅ |
| `agent:revoke` | ✅ | ✅ | — | — |
| `screenshot:read` | ✅ | ✅ | ✅ | — |
| `screenshot:request` | ✅ | ✅ | — | — |
| `screenshot:manage` | ✅ | ✅ | — | — |
| `screenshot:policy` | ✅ | ✅ | — | — |

Additional server-side rules:

- The organization creator is always inserted as `OWNER` in the same transaction.
- Nobody can change their own role, suspend themselves, or remove themselves.
- `ADMIN` can manage only `MANAGER` and `EMPLOYEE`; only `OWNER` can administer `OWNER`/`ADMIN` roles.
- `OWNER` cannot be granted through an invitation; invitation roles are limited to `ADMIN`, `MANAGER`, `EMPLOYEE`.
- Only an `OWNER` may invite an `ADMIN`.
- An organization must retain at least one active `OWNER` (defensive check on demotion/suspension/removal).
- Suspended memberships keep their account session but are denied all organization-scoped access (`MEMBERSHIP_INACTIVE`).
- Removed memberships are soft-deleted (`status=REMOVED`, `removed_at`) and can be reactivated through a new invitation.
- Users may belong to multiple organizations; `/auth/me` and `GET /organizations` expose their memberships.
- Employees are always forced to their own employee ID for session lists/history and device lists; they cannot read another employee's time data.
- Any member may register/revoke their own desktop agent; revoking another member's agent requires `agent:revoke`.
- `report:read` is limited to OWNER/ADMIN/MANAGER. Employees can still read their own current session and session history.
- Attendance summaries use `time:read`; employees are always self-scoped. Attendance correction review uses `correction:review` (OWNER/ADMIN/MANAGER), and self-review is always rejected.
- Screenshot routes require both the underlying permission and the organization policy’s role list. Employees have no screenshot history, request, review, or policy-management permission; they can only read/acknowledge the disclosure.
- Admin/agent screenshot services repeat authorization, ownership, and state checks independently of route middleware.

---

## Data model

All identifiers are UUIDs. Timestamps are `TIMESTAMPTZ` in PostgreSQL and managed by Sequelize.

| Table | Key constraints & behavior |
| --- | --- |
| `organizations` | unique `slug`; status `ACTIVE`/`SUSPENDED`; name max 120; IANA `timezone` (default `UTC`) |
| `users` | unique normalized `email`; status `ACTIVE`/`DISABLED`; Argon2id `password_hash` |
| `memberships` | unique `(organization_id, user_id)`; role + status; FKs `ON DELETE CASCADE`; soft `REMOVED` |
| `invitations` | unique `token_hash`; role restricted to invitable roles; `expires_at`, `accepted_at`, `accepted_by_user_id`, `revoked_at`; inviter FK `SET NULL`; partial unique index enforces one live invitation per `(organization_id, email)` |
| `sessions` | unique hashes for access/refresh tokens; previous refresh hash for reuse detection; CSRF hash; `revoked_at`, `rotated_at`; FKs `ON DELETE CASCADE` |
| `desktop_agents` | unique `(organization_id, user_id, device_identifier)`; `ELECTRON`/`MOBILE` `client_type` (default `ELECTRON`); HMAC `agent_key_hash`; last seen/connected/disconnected; logical `revoked_at` |
| `time_sessions` | one open session per employee and per agent via partial unique indexes; `ACTIVE`/`ON_BREAK`/`STOPPED`; `ONLINE`/`OFFLINE` source; durable `last_heartbeat_at` |
| `breaks` | one open break per session via partial unique index; `ACTIVE`/`ENDED`; interval stored as timestamps |
| `application_activities` | foreground metadata only; unique `(desktop_agent_id, idempotency_key)`; server-derived `duration_seconds`; no screenshot/window-content columns |
| `agent_sync_events` | durable offline idempotency ledger; unique `(desktop_agent_id, event_id)`; `APPLIED`/`CONFLICT` + conflict code; JSON result |
| `screenshot_policies` | one row per organization; disabled by default; role lists, cooldown, retention/audit retention, disclosure version/text, acknowledgement requirement |
| `screenshot_policy_acknowledgements` | unique `(organization_id, employee_id, policy_version)`; acknowledges a specific disclosure version |
| `screenshot_requests` | `PENDING`/`CLAIMED`/`COMPLETED`/`FAILED`/`EXPIRED`/`CANCELLED`; partial unique index allows one active request per employee; unique admin/org idempotency key; one-time upload-token hash and unique server-generated storage key |
| `screenshots` | one per completed request; private `storage_key`, content type/size, capture time, retention expiry; no binary data |
| `attendance_correction_requests` | employee self-service request targeting a stopped session or a missing session; `PENDING`/`APPROVED`/`REJECTED`; requested timestamps/breaks, original/applied snapshots, reviewer fields; partial unique index prevents duplicate pending requests per session |
| `attendance_evidence` | private mobile photo metadata (`SELFIE`/`SITE_PHOTO`); `PENDING`/`UPLOADED`/`ATTACHED`; unique server-generated `storage_key`; one-time HMAC upload token; expiry and attachment session; no binary data |
| `attendance_check_ins` | one per time session; `WFH`/`WFO`/`ON_SITE`; optional selfie/site-photo evidence FKs; nullable validated location; unique `(organization_id, employee_id, check_in_request_id)` for idempotency and unique evidence FKs |
| `audit_events` | organization-scoped append-only audit trail for screenshot, attendance-correction, and attendance-evidence actions; actor/target/entity references, sanitized JSON metadata, IP/user-agent; screenshot rows retained by policy |

Migrations live in `migrations/` and are the only production schema mechanism. `sequelize.sync({ alter: true })` is never used by application code; test suites use `sync()` only to create/reset their disposable schema.

Foreign keys use `ON DELETE CASCADE` for organization → memberships/invitations/time data/attendance corrections/check-ins/evidence/screenshot data and user → memberships/sessions/agents. Invitation inviter/acceptance, correction targets/reviewers, attendance evidence attachment, and audit actor/target references use `ON DELETE SET NULL` so records survive deletion. Deleting an agent (not exposed by the API) would null historical session/activity/screenshot-request agent references while preserving the records.

---

## Reliability & security

- Helmet security headers, `x-powered-by` disabled, JSON body limit (default 100 kB).
- Explicit CORS allowlist with credentials; unknown origins receive no CORS grant. WebSocket upgrades apply the same origin and credential checks.
- Zod validation for every body, query string, and route param; activity bodies are strict and metadata-only.
- Consistent error envelope incl. `requestId`; internal errors are not leaked in production responses.
- `X-Request-Id` accepted if URL-safe; otherwise generated.
- Pino redacts `Authorization`, cookies, `Set-Cookie`, passwords, token fields, hashes, and `X-Agent-Key`.
- Request URLs are logged without query strings.
- Startup retries database connections three times, then exits non-zero.
- Graceful shutdown closes agent WebSockets and the HTTP server, then the pool; a 10-second timeout forces exit.
- `/api/v1/health` is liveness; `/api/v1/health/ready` checks `SELECT 1`.
- Invitation/session tokens and desktop-agent keys are never written to logs; all are stored hashed.
- Offline event IDs and application idempotency keys are durable, so retries after a crash cannot duplicate time or activity.
- Partial unique indexes and employee row locks remain the cross-process guard; a per-employee in-process queue prevents overlapping SQLite transactions and reduces PostgreSQL contention. Attendance correction approval uses the same employee/session lock ordering and transaction boundary.
- Screenshot creation/claims/completions use transactions and row locks; the partial unique active-request index and idempotency index are the cross-process guards. State is persisted before WebSocket delivery.
- Upload/download tokens are short-lived, HMAC-protected, and never returned in list/detail metadata. Upload tokens are consumed on success. Signed screenshot paths, `Authorization`, cookies, and agent keys are redacted from logs.
- Binary screenshot data is stored only in the configured private object store. Access requires a valid screenshot ID/ownership check plus a current short-lived link; a client-supplied storage key is never accepted as ownership proof.
- Attendance evidence uses the same private storage adapter but a separate table, upload/download paths, HMAC token context, and audit actions. Check-in locks the employee row, validates evidence ownership/kind/expiry/stored bytes, creates the session and check-in, attaches evidence, and writes audit records in one transaction. Failed transactions leave evidence unattached and retryable; attached evidence is never deleted by error recovery.

Passwords/tokens are excluded from all API responses except the explicit desktop token payload, the one-time invitation token, the one-time desktop-agent key, and short-lived screenshot upload/download URLs returned only to the authorized caller. Storage keys and image bytes are never returned by metadata APIs.

**Temporary invitation delivery:** Step 1 has no mail transport. `POST /organizations/:id/invitations` therefore returns the raw token to the authorized inviter so it can be delivered out of band. This must be replaced with e-mail delivery and removed from the response in a later step.

---

## Testing

```bash
npm test                 # 100 tests, in-memory SQLite, no external services
npm run typecheck
npm run build
```

To run the same suite against PostgreSQL:

```bash
# TEST_DATABASE_URL must point at a disposable database
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/temponest_test \
  npx vitest run --no-file-parallelism
```

The PostgreSQL path resets data between tests with `TRUNCATE` and can run against a database created by `db:migrate`.

### Coverage in this step

- Registration validation, duplicate e-mail prevention, e-mail normalization.
- Browser login cookies (`HttpOnly`, `SameSite`), CSRF rejection/acceptance, origin rejection.
- Desktop bearer login, session listing/revocation, logout.
- Refresh rotation, old-access-token invalidation, refresh-token reuse detection and family revocation.
- Organization creation with creator as `OWNER`; current-organization header flow.
- Invitation creation, hashed storage, preview, one-time acceptance, expiry, revocation, e-mail mismatch, token rotation, and role immutability.
- Role permission matrix: owner/admin/manager/employee boundaries; admin cannot manage admins/owners; self-modification blocked; last-owner protection.
- Membership suspension, reactivation, soft removal, and resulting access denial.
- Cross-organization access denial using foreign organization/membership/invitation IDs.
- Pagination, filtering, search, invalid query rejection, login rate limiting, health, and request IDs.
- Desktop-agent registration, one-time key issuance, key rotation, agent authentication, scoped listing, self/admin revocation, and revoked-device rejection.
- Concurrent session starts (one success, one conflict), start/break/resume/stop lifecycle, server timestamps, and stale-session recovery.
- Employee-scoped history vs manager organization listing; cross-organization session/agent denial.
- Offline sync ordering, idempotent retries, duplicate event IDs, durable conflicts, future/old event rejection, and device mismatch.
- Application activity idempotency, overlap rejection, session/agent binding, and client duration ignoring.
- Daily working/break totals with timezone/DST handling, break exclusion, app usage clipping, timelines, and report pagination/ranges.
- Tracking status transitions (`WORKING`, `ON_BREAK`, `ONLINE`, `OFFLINE`) from durable heartbeats.
- Employee self-scoped daily/weekly/monthly attendance summaries, organization timezone boundaries, distinct session totals, and manager/organization scoping.
- Missing-session and existing-session correction requests, pending duplicate/overlap rejection, manager review permissions, self-review denial, transactional approval, break replacement, original/applied snapshots, audit events, stale-conflict rollback, and idempotent repeat decisions.
- WebSocket auth failures (missing/invalid/mismatched/expired), heartbeat persistence, live session pushes, reconnect, and revocation close.
- Screenshot policy disabled/enabled behavior, role and organization scoping, request/view role containment, and employee disclosure/acknowledgement.
- Idempotent creation, concurrent retries, duplicate pending prevention, cooldown, eligibility, offline delivery, and truthful expiration.
- Claim/upload/complete/review lifecycle, wrong-agent rejection, linked-session stop, upload reauthorization expiry, duplicate/terminal transitions, and cancellation cleanup.
- Content-type/magic-byte/size validation, arbitrary `storageKey` rejection, one-time upload-token replay, signed download tampering/expiry, and cross-organization access denial.
- Retention deletion of screenshot metadata and private objects, terminal-request object cleanup, audit-retention cleanup, and audit event coverage.
- Screenshot WebSocket delivery, ack/claim/complete messages, replay errors, reconnect pending recovery, and HTTP pending claim.
- Mobile check-in modes (`WFH`/`WFO`/`ON_SITE`), selfie-only WFO with location rejection and no persisted coordinates, ON_SITE evidence/location requirements and freshness rejection, and server-generated session timestamps.
- Mobile check-in recovery after app restart, break/resume/checkout through the existing time-session routes, and `current` check-in restoration.
- Evidence create/upload/validate/reauthorize/expire flows, private signed access with audit events, and image type/signature/size enforcement.
- Same-key and different-key concurrency, replay with the original result, payload-mismatch rejection, and prevention of duplicate active sessions.
- Evidence expiry, missing/mismatched stored bytes, reuse rejection, employee/device/organization isolation, and Electron `403 MOBILE_AGENT_REQUIRED` while existing time-session routes still work.

### Verification performed

Earlier Step 1/2/3 checks remain valid. Step 3 (mobile attendance) checks in this workspace:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` (SQLite) | 100/100 passed (11 files; 12 mobile attendance tests) |
| `npm run build` | Passed |
| PostgreSQL: `npx sequelize-cli db:migrate --env test` on a disposable database | Passed (19 migrations, including attendance evidence/check-ins) |
| PostgreSQL: `db:migrate:undo` + re-migrate of `20261025000100` | Passed |
| PostgreSQL: `npx vitest run --no-file-parallelism` on a disposable database | 100/100 passed |
| Local development database (`temponest_dev`) | Pending migration applied; all 19 migrations `up` |

The PostgreSQL checks used a disposable local database that was dropped afterward; no developer/production data was reset or modified. The local development database only received the additive attendance migration.

---

## Remaining work (Step 4+)

- **Attendance evidence retention**: define and implement an approved retention/deletion policy for private attendance evidence and its metadata. Until then evidence is retained indefinitely and must not be described as expiring.
- **Live-capture assurance**: the backend validates file type/size/signature only. Stronger liveness, device-integrity, and location-authenticity measures need a separate approved design.
- **Electron screenshot capture/upload**: implement and verify actual capture, local image encoding, claim/upload/complete/fail calls, one-time upload tokens, reconnect/resume, and a clear visible capture indicator without pausing the timer. The backend does not claim this works yet.
- **Next.js screenshot UI**: policy/disclosure management, employee acknowledgement, request/history/status/review screens, short-lived access link handling, and cancellation. Keep controls out of the employee Electron UI.
- **Admin portal and production Electron adapters**: replace renderer mocks, add `safeStorage`, IPC allowlists, the agent WebSocket client, and durable offline queues; see [docs/ELECTRON_INTEGRATION.md](docs/ELECTRON_INTEGRATION.md).
- **Cross-instance realtime**: `agentHub` is process-local. Add Redis/NATS pub/sub (or sticky sessions) so HTTP-side session updates and live screenshot commands reach agents connected to other API instances. Pending HTTP recovery already works across instances.
- **Scheduled stale-session sweeper**: sessions are recovered on the next start and heartbeats expire in reporting status, but a background job should close abandoned sessions at a defined policy time.
- **E-mail delivery** for invitations (and remove the raw token from the API response), plus verification and password-reset flows. Registration currently does not prove ownership of the e-mail address; add verification before production.
- **Scheduled cleanup** of expired sessions/invitations; partition or archive time/activity data as it grows.
- **Shared rate-limit/session infrastructure** (Redis) for horizontal scaling; currently in-memory per instance.
- **MFA/SSO**, session anomaly detection, and an audit log for administrative actions.
- **Organization lifecycle**: deletion, ownership transfer endpoint, slug changes, configurable per-role permissions.
- **Invitation resend endpoint** (currently re-inviting the same e-mail rotates the token).
- **OpenAPI specification**, CI pipeline, container image, and deployment manifests.
- **Report exports** (CSV/PDF) and larger-range aggregation jobs for organization-wide reporting.

---

## Notes / design decisions

- **Opaque sessions over JWT** make revocation, reuse detection, and “current user” semantics immediate and simple.
- **Organization slug is immutable on rename** to keep stable links; adding a slug-change flow should be explicit.
- **Removed memberships are retained** for audit and can be reactivated via invitation rather than creating duplicate rows.
- **Test suite defaults to SQLite** so `npm test` works without infrastructure, while migrations and a second full run are verified on PostgreSQL. Dialect-specific behavior (e.g. `ILIKE` search) branches on the active dialect.
- **No `sync({ alter: true })`** anywhere in the application; schema changes ship as reviewed migrations.
