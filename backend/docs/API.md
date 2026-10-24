# TempoNest API — v1 contracts

Base URL: `/api/v1`

All requests and responses are JSON (`Content-Type: application/json`), except `204 No Content` responses and the private screenshot upload/download bodies, which are binary image bytes.

---

## Conventions

### Success shape

Single resource:

```json
{ "data": { "id": "..." } }
```

Collection (paginated):

```json
{
  "data": [{ "id": "..." }],
  "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 }
}
```

### Error shape

```json
{
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "Your role does not permit this action",
    "details": [{ "path": "body.email", "message": "Enter a valid email address", "code": "invalid_string" }]
  },
  "requestId": "f62e2def-1e7e-45c6-869e-32e9e4fbb941"
}
```

`details` is present for validation failures. `requestId` matches the `X-Request-Id` response header and appears in server logs.

### Headers

| Header | Direction | Purpose |
| --- | --- | --- |
| `Authorization: Bearer <accessToken>` | Client → API | Desktop, mobile, and API authentication |
| `Cookie: tn_access=…; tn_refresh=…; tn_csrf=…` | Browser | Browser session authentication |
| `X-CSRF-Token: <csrfToken>` | Client → API | Required for unsafe (`POST`/`PATCH`/`PUT`/`DELETE`) cookie-authenticated requests |
| `X-Organization-Id: <uuid>` | Client → API | Selects the organization for `/organizations/current` |
| `X-Agent-Id: <uuid>` | Agent → API | Registered desktop-agent ID; required for time/activity writes and WS auth |
| `X-Agent-Key: <key>` | Agent → API | One-time-issued agent key; required for time/activity writes and WS auth |
| `X-Request-Id` | Client → API | Optional correlation ID (URL-safe, ≤128 chars) |
| `X-Request-Id` | API → Client | Always returned |

### Pagination & validation

- `page` ≥ 1 (default 1), `limit` 1–100 (default 20).
- All bodies, query strings, and route params are validated with Zod. Unknown body keys are rejected on strict schemas; unknown query keys are stripped.
- Invalid input returns `422 VALIDATION_ERROR`.

### Rate limiting

`429 RATE_LIMITED` with `RateLimit` / `RateLimit-Policy` headers. Login attempts are limited separately from the global API limit.

### Permissions

| Permission | OWNER | ADMIN | MANAGER | EMPLOYEE |
| --- | :---: | :---: | :---: | :---: |
| `organization:read` | ✅ | ✅ | ✅ | ✅ |
| `organization:update` | ✅ | ✅ | — | — |
| `member:read` | ✅ | ✅ | ✅ | — |
| `member:invite` | ✅ | ✅ | — | — |
| `member:update` | ✅ | ✅ | — | — |
| `member:remove` | ✅ | ✅ | — | — |
| `invitation:read` | ✅ | ✅ | — | — |
| `invitation:revoke` | ✅ | ✅ | — | — |
| `time:read` | ✅ | ✅ | ✅ | ✅ |
| `time:write` | ✅ | ✅ | ✅ | ✅ |
| `report:read` | ✅ | ✅ | ✅ | — |
| `correction:review` | ✅ | ✅ | ✅ | — |
| `agent:read` | ✅ | ✅ | ✅ | ✅ |
| `agent:revoke` | ✅ | ✅ | — | — |
| `screenshot:read` | ✅ | ✅ | ✅ | — |
| `screenshot:request` | ✅ | ✅ | — | — |
| `screenshot:manage` | ✅ | ✅ | — | — |
| `screenshot:policy` | ✅ | ✅ | — | — |

Additional constraints: no self role change/suspension/removal; `ADMIN` may manage only `MANAGER`/`EMPLOYEE`; only `OWNER` may administer `OWNER`/`ADMIN`; `OWNER` is not invitable; at least one active owner is required. Employees are always forced to their own employee ID for time/device lists, attendance summaries/corrections, current check-in, and evidence they created. Attendance correction review requires `correction:review`; self-review is always rejected. Attendance evidence access requires `time:read` and is limited to the owning employee or an organization reviewer. New mobile check-in/evidence-write routes additionally require a registered `MOBILE` device. Revoking a device is additionally allowed for its owner even without `agent:revoke`. Screenshot routes additionally enforce the organization’s policy role lists: route permissions are necessary but not sufficient, so an organization can narrow access but cannot grant it to a role that lacks the underlying permission.

Non-members receive `404 ORGANIZATION_NOT_FOUND` for organization-scoped routes.

---

## Auth

### `POST /auth/register`

Public. Creates an account with no memberships. The account can then create its own organization or accept an invitation.

```json
{ "name": "Ada Lovelace", "email": "ada@example.com", "password": "at-least-12-characters" }
```

`201`

```json
{
  "data": {
    "user": {
      "id": "b0f3…",
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "status": "ACTIVE",
      "lastLoginAt": null,
      "createdAt": "2026-10-22T00:00:00.000Z",
      "updatedAt": "2026-10-22T00:00:00.000Z"
    }
  }
}
```

Errors: `409 EMAIL_ALREADY_EXISTS`, `422 VALIDATION_ERROR`.

> Registration does not log the user in and cannot assign roles or organizations.

### `POST /auth/login`

```json
{ "email": "ada@example.com", "password": "…", "client": "browser" }
```

`client` is `"browser"` (default), `"desktop"`, or `"mobile"`. Browser sessions use cookies; desktop and mobile sessions use bearer tokens.

Browser success (`200`) sets `tn_access`, `tn_refresh`, and `tn_csrf` cookies:

```json
{
  "data": {
    "user": { "id": "…", "name": "Ada Lovelace", "email": "ada@example.com", "status": "ACTIVE", "lastLoginAt": "…", "createdAt": "…", "updatedAt": "…" },
    "memberships": [
      {
        "id": "…",
        "organizationId": "…",
        "userId": "…",
        "role": "OWNER",
        "status": "ACTIVE",
        "createdAt": "…",
        "updatedAt": "…",
        "organization": { "id": "…", "name": "Acme Corp", "slug": "acme-corp", "status": "ACTIVE", "createdAt": "…", "updatedAt": "…" }
      }
    ],
    "client": "browser",
    "csrfToken": "…",
    "accessTokenExpiresAt": "2026-10-22T00:15:00.000Z",
    "refreshTokenExpiresAt": "2026-11-21T00:00:00.000Z",
    "expiresIn": 900
  }
}
```

Desktop success (`200`) sets **no cookies** and additionally returns:

```json
{
  "data": {
    "user": { "…": "…" },
    "memberships": [],
    "client": "desktop",
    "csrfToken": "…",
    "accessTokenExpiresAt": "…",
    "refreshTokenExpiresAt": "…",
    "expiresIn": 900,
    "accessToken": "…",
    "refreshToken": "…",
    "tokenType": "Bearer"
  }
}
```

Mobile success (`200`) uses the same body-token contract as desktop: it sets **no cookies**, returns a `client` value of `"mobile"`, and includes `accessToken`, `refreshToken`, and `tokenType: "Bearer"`.

Errors: `401 INVALID_CREDENTIALS`, `403 ACCOUNT_DISABLED`, `429 RATE_LIMITED`.

Electron guidance: keep the refresh token encrypted via `safeStorage` in the main process, keep the access token in main-process memory, and never store either in renderer `localStorage`.

Mobile guidance: store the refresh token in the OS Keychain/Keystore, keep the access token in memory where possible, send it only in the `Authorization` header, and never write tokens to logs or URLs. Authentication identifies the employee only; time-tracking writes still require a separately registered device (see [Desktop agents](#desktop-agents)).

### `POST /auth/refresh`

Browser: send the `tn_refresh` cookie plus `X-CSRF-Token`; no body fields are required.

Desktop or mobile:

```json
{ "refreshToken": "<stored refresh token>", "client": "desktop" }
```

```json
{ "refreshToken": "<stored refresh token>", "client": "mobile" }
```

`200` returns the same payload shape as login, with newly rotated tokens and the requested `client` label. Browser responses reset all three cookies; desktop and mobile responses return new tokens in the body and set no cookies. Mobile clients must send the refresh token in the body and the `client: "mobile"` label. If `client` is omitted with a body token, the response retains the legacy `"desktop"` label.

Rotation rules:

- Each refresh token can be redeemed once. The previous refresh hash is retained.
- Reuse of a rotated token revokes the entire session.
- Expired/revoked sessions return `401`.

Errors: `401 REFRESH_TOKEN_REQUIRED`, `401 REFRESH_TOKEN_INVALID`, `401 REFRESH_TOKEN_EXPIRED`, `401 SESSION_REVOKED`, `403 ACCOUNT_DISABLED`.

### `POST /auth/logout`

Optional body for desktop/mobile clients when no valid bearer token is available:

```json
{ "refreshToken": "…" }
```

Revokes the current session (from bearer token or refresh cookie) and clears browser cookies. `204 No Content`. Idempotent. Revoking an authentication session does not stop an active work-tracking session; that lifecycle remains separate.

### `GET /auth/me`

Requires authentication.

```json
{
  "data": {
    "user": { "…": "…" },
    "memberships": [{ "…": "…", "organization": { "…": "…" } }],
    "session": {
      "id": "…",
      "transport": "cookie",
      "accessExpiresAt": "…",
      "refreshExpiresAt": "…"
    }
  }
}
```

`transport` is `"cookie"` or `"bearer"`.

### `GET /auth/sessions`

Lists the caller's active, unexpired sessions.

```json
{
  "data": [
    {
      "id": "…",
      "current": true,
      "userAgent": "Mozilla/5.0 …",
      "ipAddress": "203.0.113.10",
      "createdAt": "…",
      "lastUsedAt": "…",
      "expiresAt": "…"
    }
  ]
}
```

### `DELETE /auth/sessions/:sessionId`

Revokes one of the caller's sessions. `204`. Others' session IDs return `404 SESSION_NOT_FOUND`.

### `POST /auth/sessions/revoke-all`

Revokes every session except the current one.

```json
{ "data": { "revoked": 3 } }
```

---

## Organizations

### `POST /organizations`

Requires auth. The caller is inserted as `OWNER` in the same transaction.

```json
{ "name": "Acme Corp" }
```

`201`

```json
{
  "data": {
    "organization": { "id": "…", "name": "Acme Corp", "slug": "acme-corp", "status": "ACTIVE", "createdAt": "…", "updatedAt": "…" },
    "membership": { "id": "…", "role": "OWNER", "status": "ACTIVE" }
  }
}
```

Slugs are generated from the name and made unique with a suffix when needed. Renaming does not change the slug.

### `GET /organizations`

Lists the caller's active/suspended memberships with their organizations.

```json
{
  "data": [
    {
      "id": "…",
      "name": "Acme Corp",
      "slug": "acme-corp",
      "status": "ACTIVE",
      "createdAt": "…",
      "updatedAt": "…",
      "membership": { "id": "…", "role": "OWNER", "status": "ACTIVE" }
    }
  ]
}
```

### `GET /organizations/current`

Requires `X-Organization-Id: <uuid>` and `organization:read`.

```json
{
  "data": {
    "organization": { "…": "…" },
    "membership": { "id": "…", "role": "OWNER", "status": "ACTIVE" },
    "memberCount": 12
  }
}
```

Errors: `400 ORGANIZATION_CONTEXT_REQUIRED`, `400 ORGANIZATION_CONTEXT_INVALID`, `404 ORGANIZATION_NOT_FOUND`, `403 MEMBERSHIP_INACTIVE`.

### `PATCH /organizations/current`

Requires `X-Organization-Id` and `organization:update`.

```json
{ "name": "Acme International" }
```

Returns the same shape as `GET /organizations/current`.

### `GET /organizations/:organizationId`

Path-based equivalent of `/organizations/current`, with `organization:read`.

### `PATCH /organizations/:organizationId`

Path-based equivalent, with `organization:update`.

If the organization itself is `SUSPENDED`, non-GET requests return `403 ORGANIZATION_SUSPENDED` (reads remain available to members).

### `GET /organizations/:organizationId/members`

Requires `member:read`.

Query: `page`, `limit`, `role` (`OWNER|ADMIN|MANAGER|EMPLOYEE`), `status` (`ACTIVE|SUSPENDED|REMOVED`), `q` (name/e-mail search).

```json
{
  "data": [
    {
      "id": "…",
      "organizationId": "…",
      "userId": "…",
      "role": "EMPLOYEE",
      "status": "ACTIVE",
      "createdAt": "…",
      "updatedAt": "…",
      "user": { "id": "…", "name": "Ada Lovelace", "email": "ada@example.com", "status": "ACTIVE" }
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

### `PATCH /organizations/:organizationId/members/:membershipId`

Requires `member:update` and role-hierarchy rules.

```json
{ "role": "MANAGER" }
```

`200 { "data": { "membership": { … } } }`.

Errors: `403 CANNOT_MODIFY_SELF`, `403 ROLE_MANAGEMENT_FORBIDDEN`, `403 ROLE_ASSIGNMENT_FORBIDDEN`, `404 MEMBERSHIP_NOT_FOUND`, `409 LAST_OWNER`.

### `POST /organizations/:organizationId/members/:membershipId/suspend`

Requires `member:update`. Suspends an active membership. Idempotent.

### `POST /organizations/:organizationId/members/:membershipId/reactivate`

Requires `member:update`. Reactivates a suspended membership (not a removed one; re-invite for removed memberships).

Both return `200 { "data": { "membership": { … } } }`.

### `DELETE /organizations/:organizationId/members/:membershipId`

Requires `member:remove`. Soft-removes the membership (`status=REMOVED`, `removed_at` set).

`200`

```json
{ "data": { "membership": { "id": "…", "role": "EMPLOYEE", "status": "REMOVED", "…": "…" } } }
```

---

## Invitations

Invitation tokens are 256-bit random values, HMAC-hashed at rest, single-use, and expiring (default 7 days).

### `POST /organizations/:organizationId/invitations`

Requires `member:invite`. Roles: `ADMIN`, `MANAGER`, `EMPLOYEE`. `OWNER` is rejected with `422`.

```json
{ "email": "newhire@example.com", "role": "EMPLOYEE" }
```

`201`

```json
{
  "data": {
    "invitation": {
      "id": "…",
      "organizationId": "…",
      "email": "newhire@example.com",
      "role": "EMPLOYEE",
      "expiresAt": "2026-10-29T00:00:00.000Z",
      "acceptedAt": null,
      "revokedAt": null,
      "createdAt": "…",
      "invitedBy": { "id": "…", "name": "Ada Lovelace", "email": "ada@example.com" }
    },
    "token": "one-time raw invitation token",
    "expiresAt": "2026-10-29T00:00:00.000Z"
  }
}
```

`token` is returned only at creation, only to the authorized inviter, so it can be delivered out of band until e-mail delivery exists. It is never stored in plaintext or logged.

Notes:

- Re-inviting the same e-mail revokes the previous live invitation and rotates the token.
- Existing `ACTIVE`/`SUSPENDED` members cannot be invited (`409`).
- Previous `ADMIN` authority rules apply (only an `OWNER` may invite an `ADMIN`).

### `GET /organizations/:organizationId/invitations`

Requires `invitation:read`.

Query: `page`, `limit`, `status` = `pending` (default) | `accepted` | `revoked` | `expired` | `all`.

Returns a paginated list of invitation summaries (same shape as above minus `token`).

### `DELETE /organizations/:organizationId/invitations/:invitationId`

Requires `invitation:revoke`. Sets `revokedAt`. `200 { "data": { "invitation": { … } } }`.

Accepted invitations cannot be revoked (`409 INVITATION_ALREADY_ACCEPTED`); revoking an already-revoked invitation is idempotent.

### `POST /invitations/preview`

Public (rate-limited). Reveals only organization name/slug, invited e-mail, role, and expiry.

```json
{ "token": "…" }
```

`200`

```json
{
  "data": {
    "invitation": {
      "organization": { "id": "…", "name": "Acme Corp", "slug": "acme-corp", "status": "ACTIVE", "createdAt": "…", "updatedAt": "…" },
      "email": "newhire@example.com",
      "role": "EMPLOYEE",
      "expiresAt": "…"
    }
  }
}
```

Errors: `400 INVITATION_INVALID`, `410 INVITATION_EXPIRED`, `410 INVITATION_REVOKED`, `410 INVITATION_ALREADY_USED`.

### `POST /invitations/accept`

Requires authentication. The signed-in account's normalized e-mail must match the invitation e-mail. The invitation role is applied server-side; clients cannot supply a role.

```json
{ "token": "…" }
```

`200`

```json
{
  "data": {
    "membership": {
      "id": "…",
      "organizationId": "…",
      "userId": "…",
      "role": "EMPLOYEE",
      "status": "ACTIVE",
      "createdAt": "…",
      "updatedAt": "…"
    },
    "organization": { "id": "…", "name": "Acme Corp", "slug": "acme-corp", "status": "ACTIVE", "createdAt": "…", "updatedAt": "…" }
  }
}
```

Errors: `401 UNAUTHENTICATED`, `403 INVITATION_EMAIL_MISMATCH`, `403 ORGANIZATION_SUSPENDED`, `410 INVITATION_EXPIRED`, `410 INVITATION_REVOKED`, `410 INVITATION_ALREADY_USED`, `409 ALREADY_MEMBER`, `409 MEMBERSHIP_SUSPENDED`, `422 VALIDATION_ERROR` (e.g. extra `role` field).

For a previously `REMOVED` membership, acceptance reactivates the existing row with the invited role. A `SUSPENDED` membership must be reactivated by an administrator instead.

---

## Desktop agents

A desktop agent is a registered device installation. The raw key is returned only from registration (and key rotation); only its HMAC hash is stored. Agent credentials are always combined with the signed-in user's bearer token for HTTP time/activity writes.

`clientType` records device provenance. It is `ELECTRON` for the desktop app and `MOBILE` for mobile-app installations. The mobile and Electron apps share this device registry; it is separate from the employee authentication session. For a new `deviceId` the field is optional and defaults to `ELECTRON`. Provenance is immutable once the device exists: re-registering the same `deviceId` without `clientType` preserves the stored type, and supplying a different type returns `409 AGENT_CLIENT_TYPE_MISMATCH`. Screenshot requests are only created for eligible `ELECTRON` agents.

### `POST /organizations/:organizationId/desktop-agents`

Requires authentication and an active membership. Any member may register a device **for themselves**; the employee is derived from the bearer token. Sending the same `deviceId` again rotates the key and closes existing WebSockets for that device; the stored `clientType` is preserved.

```json
{
  "deviceId": "machine-id-or-installation-uuid",
  "name": "Ada's Windows laptop",
  "platform": "win32",
  "osVersion": "10.0.22631",
  "appVersion": "0.1.0",
  "clientType": "ELECTRON"
}
```

`201` for a new registration, `200` when an existing device key was rotated:

```json
{
  "data": {
    "agent": {
      "id": "…",
      "organizationId": "…",
      "userId": "…",
      "deviceId": "machine-id-or-installation-uuid",
      "name": "Ada's Windows laptop",
      "platform": "win32",
      "osVersion": "10.0.22631",
      "appVersion": "0.1.0",
      "clientType": "ELECTRON",
      "status": "ACTIVE",
      "online": false,
      "lastSeenAt": null,
      "lastConnectedAt": null,
      "lastDisconnectedAt": null,
      "revokedAt": null,
      "createdAt": "…",
      "updatedAt": "…"
    },
    "agentKey": "tna_…",
    "rotated": false,
    "notice": "Store agentKey securely. It is shown only in this response."
  }
}
```

Errors: `401`, `403 MEMBERSHIP_INACTIVE`, `404 ORGANIZATION_NOT_FOUND`, `409 AGENT_REVOKED` (a revoked `deviceId` cannot be re-registered), `409 AGENT_CLIENT_TYPE_MISMATCH` (a device cannot change between `MOBILE` and `ELECTRON`), `422 VALIDATION_ERROR`.

### `POST /desktop-agents/authenticate`

Public (rate-limited) credential check. It does not create a user session and does not replace bearer authentication for API reads/writes.

```json
{ "agentId": "…", "agentKey": "tna_…" }
```

`200`

```json
{
  "data": {
    "agent": { "…": "…" },
    "organization": { "id": "…", "name": "Acme Corp", "timezone": "Europe/Berlin", "status": "ACTIVE" },
    "user": { "id": "…", "name": "Ada Lovelace", "email": "ada@example.com" },
    "serverTime": "…"
  }
}
```

Errors: `401 AGENT_CREDENTIALS_INVALID`, `403 AGENT_REVOKED`, `429 RATE_LIMITED`.

### `GET /organizations/:organizationId/desktop-agents`

Requires `agent:read`. Query: `page`, `limit`, `userId`, `status` = `ACTIVE` (default) | `REVOKED` | `ALL`. Employees always see only their own devices; managers/admins/owners may filter by another member.

Returns the paginated agent summary shape above (never the key or key hash).

### `DELETE /organizations/:organizationId/desktop-agents/:agentId`

Revokes a device. The device's own user may always revoke it; otherwise `agent:revoke` is required. Revocation is logical, closes live WebSockets with code `4003`, stops the device's active time sessions (closing any open break), and publishes `agent.revoked`.

```json
{
  "data": {
    "agent": { "…": "…", "status": "REVOKED", "revokedAt": "…" },
    "stoppedSessionIds": ["…"],
    "alreadyRevoked": false
  }
}
```

Errors: `403 PERMISSION_DENIED`, `404 AGENT_NOT_FOUND`.

---

## Time tracking

Online time tracking requires **both** a bearer token and a registered agent:

```http
Authorization: Bearer <accessToken>
X-Agent-Id: <registered agent uuid>
X-Agent-Key: tna_…
```

The server derives organization and employee from the authenticated membership/agent binding. Clients cannot submit an employee ID or organization ID for these operations, and client-supplied timestamps are ignored on the online endpoints: start/stop/break times are generated by the server. The only exception is the explicit `/time-sessions/sync` offline protocol.

Session `status` is `ACTIVE`, `ON_BREAK`, or `STOPPED`; `source` is `ONLINE` or `OFFLINE`. At most one open session exists per employee and per agent, enforced by partial unique indexes and transactional row locks.

Session summary (`data.session` in the endpoints below):

```json
{
  "id": "…",
  "organizationId": "…",
  "employeeId": "…",
  "desktopAgentId": "…",
  "startedAt": "2026-10-22T09:00:00.000Z",
  "endedAt": null,
  "status": "ACTIVE",
  "source": "ONLINE",
  "lastHeartbeatAt": "2026-10-22T09:05:00.000Z",
  "durationSeconds": 300,
  "heartbeatFresh": true,
  "activeBreak": null,
  "breaks": [],
  "desktopAgent": { "id": "…", "name": "Ada's laptop", "platform": "win32", "status": "ACTIVE" },
  "employee": { "id": "…", "name": "Ada Lovelace", "email": "ada@example.com" },
  "createdAt": "…",
  "updatedAt": "…"
}
```

Break summary:

```json
{
  "id": "…",
  "organizationId": "…",
  "sessionId": "…",
  "startedAt": "…",
  "endedAt": null,
  "status": "ACTIVE",
  "durationSeconds": 42,
  "createdAt": "…",
  "updatedAt": "…"
}
```

### `POST /organizations/:organizationId/time-sessions/start`

Requires `time:write` + agent credentials. No body fields are required.

`201`

```json
{
  "data": {
    "session": { "…": "…" },
    "autoClosedSessionId": null,
    "serverTime": "…"
  }
}
```

If the employee has an open session whose last heartbeat is older than `SESSION_STALE_SECONDS`, it is first closed at that last heartbeat (never at the new start time); `autoClosedSessionId` identifies the recovered session. A fresh open session returns `409 ACTIVE_SESSION_EXISTS`. Another agent cannot be reused while it has an open session (`409 AGENT_SESSION_EXISTS`).

### `GET /organizations/:organizationId/time-sessions/current`

Requires `time:read`; always scoped to the caller. No agent credentials required, so the portal can display the current state.

`200 { "data": { "session": { … } | null, "serverTime": "…" } }`

### `GET /organizations/:organizationId/time-sessions`

Requires `time:read`. Query: `page`, `limit`, `status`, `employeeId`, plus optional ISO-8601 `from`/`to` bounds with an offset. When supplied, sessions overlapping the history window are returned (`endedAt` missing or `endedAt >= from`; `startedAt <= to`); `to` must be after `from`.

Employees are forced to their own `employeeId` even if another value is supplied. Managers/admins/owners may list the whole organization or filter one employee. Returns `{ data, meta, serverTime }`.

### `GET /organizations/:organizationId/time-sessions/:sessionId`

Requires `time:read`. Employees may read only their own session; managers/admins/owners may read any session in the organization. Returns `{ data: { session, serverTime } }`.

### `POST /organizations/:organizationId/time-sessions/:sessionId/stop`

Requires `time:write` + the same agent that owns the session. Server timestamps the stop and closes any open break at that instant.

`200 { "data": { "session": { … }, "serverTime": "…" } }`

Errors: `404 SESSION_NOT_FOUND`, `409 SESSION_NOT_ACTIVE`.

### `POST /organizations/:organizationId/time-sessions/:sessionId/breaks`

Requires `time:write` + owning agent. Starts a break and sets the session to `ON_BREAK`.

`201 { "data": { "session": { … }, "breakId": "…", "serverTime": "…" } }`

Errors: `409 BREAK_ALREADY_ACTIVE`, `409 SESSION_NOT_ACTIVE`.

### `POST /organizations/:organizationId/time-sessions/:sessionId/breaks/end`

Requires `time:write` + owning agent. Ends the open break and sets the session back to `ACTIVE`.

`200 { "data": { "session": { … }, "breakId": "…", "serverTime": "…" } }`

Errors: `409 NO_ACTIVE_BREAK`, `409 SESSION_NOT_ACTIVE`.

### `POST /organizations/:organizationId/time-sessions/:sessionId/heartbeat`

HTTP heartbeat fallback for environments where WebSockets are unavailable. Requires `time:write` + owning agent. Updates the session heartbeat and the agent's `lastSeenAt`.

`200 { "data": { "session": { … }, "agentLastSeenAt": "…", "serverTime": "…" } }`

### `POST /organizations/:organizationId/time-sessions/sync`

Explicit offline reconciliation. Requires `time:write` + agent credentials. The body must contain the agent's own `deviceId` and 1–200 events. Events are applied in `occurredAt` order regardless of array order. Client durations are not accepted; durations are derived from stored timestamps.

```json
{
  "deviceId": "machine-id-or-installation-uuid",
  "events": [
    { "eventId": "session-start-001", "type": "SESSION_START", "occurredAt": "2026-10-22T08:00:00.000Z", "sessionId": "9e743d59-3e42-4e3e-8e0d-8a4d6f8b1c11" },
    { "eventId": "break-start-001", "type": "BREAK_START", "occurredAt": "2026-10-22T10:00:00.000Z", "sessionId": "9e743d59-3e42-4e3e-8e0d-8a4d6f8b1c11" },
    { "eventId": "break-end-001", "type": "BREAK_END", "occurredAt": "2026-10-22T10:15:00.000Z", "sessionId": "9e743d59-3e42-4e3e-8e0d-8a4d6f8b1c11" },
    { "eventId": "session-stop-001", "type": "SESSION_STOP", "occurredAt": "2026-10-22T17:00:00.000Z", "sessionId": "9e743d59-3e42-4e3e-8e0d-8a4d6f8b1c11" }
  ]
}
```

`SESSION_START` uses the client-generated `sessionId`; the other event types reference it. Events may be older than the request by up to `OFFLINE_MAX_BACKFILL_SECONDS` (default 7 days) and at most `OFFLINE_FUTURE_SKEW_SECONDS` (default 5 minutes) in the future. A `deviceId` that differs from the authenticated agent returns `403 DEVICE_MISMATCH`.

`200`

```json
{
  "data": {
    "deviceId": "machine-id-or-installation-uuid",
    "serverTime": "…",
    "results": [
      {
        "eventId": "session-start-001",
        "type": "SESSION_START",
        "status": "applied",
        "result": { "sessionId": "…", "startedAt": "…", "status": "ACTIVE" }
      },
      {
        "eventId": "break-start-001",
        "type": "BREAK_START",
        "status": "conflict",
        "code": "BREAK_ALREADY_ACTIVE",
        "message": "A break is already active",
        "result": {}
      }
    ]
  }
}
```

Per-event `status` is `applied`, `duplicate`, or `conflict`. Repeating an event ID returns `duplicate` with `originalStatus`, even across process restarts and including previously conflicted events. Conflict event IDs are durable, so a corrected event must use a new `eventId`. A batch is not atomic: valid events still apply when other events conflict. Common conflict codes: `ACTIVE_SESSION_EXISTS`, `AGENT_SESSION_EXISTS`, `SESSION_ID_EXISTS`, `SESSION_NOT_FOUND`, `SESSION_ALREADY_STOPPED`, `INVALID_SESSION_INTERVAL`, `INVALID_BREAK_INTERVAL`, `BREAK_ALREADY_ACTIVE`, `NO_ACTIVE_BREAK`, `EVENT_IN_FUTURE`, `EVENT_TOO_OLD`.

---

## Application activity

### `POST /organizations/:organizationId/application-activities/batch`

Requires `time:write` + agent credentials. Stores foreground application metadata only. The schema has no window-title, keystroke, clipboard, URL, or screenshot fields; unknown fields are rejected. **Do not send screenshots in Step 2.**

```json
{
  "events": [
    {
      "idempotencyKey": "app-event-001",
      "sessionId": "…",
      "applicationIdentifier": "code",
      "applicationName": "Visual Studio Code",
      "startedAt": "2026-10-22T09:01:00.000Z",
      "endedAt": "2026-10-22T09:03:30.000Z",
      "durationSeconds": 150
    }
  ]
}
```

`durationSeconds` is accepted only for Electron contract compatibility and is **ignored**. The server stores `floor(endedAt - startedAt / 1000)`.

Rules:

- 1–200 events per batch; `idempotencyKey` is unique per agent.
- The session must belong to the authenticated user, organization, and agent.
- Intervals must end after they start, be at most 24 hours long, and must not overlap another activity event for that employee (`EVENT_OVERLAP`).
- Events may start slightly before a session or end slightly after it within `ACTIVITY_FUTURE_SKEW_SECONDS`; they are clipped to actual working intervals in reports.
- Activity outside the session, too old (`ACTIVITY_MAX_BACKFILL_SECONDS`, default 30 days), or too far in the future is rejected per event.
- Repeats return `duplicate`; one rejected/duplicate event does not discard the batch.

`200`

```json
{
  "data": {
    "received": 1,
    "accepted": 1,
    "duplicated": 0,
    "rejected": 0,
    "results": [
      { "idempotencyKey": "app-event-001", "status": "accepted", "activityId": "…" }
    ],
    "disclaimer": "Application usage is foreground metadata only. It is not a definitive measure or proof of productivity."
  }
}
```

Rejection codes include `EVENT_IN_FUTURE`, `EVENT_TOO_OLD`, `SESSION_NOT_FOUND`, `EVENT_OUTSIDE_SESSION`, and `EVENT_OVERLAP`.

---

## Reporting

All report dates are organization-local calendar dates (`YYYY-MM-DD`) using the organization's IANA `timezone`; timestamps remain stored in UTC. The organization timezone defaults to `UTC` and can be set when creating or updating the organization.

All endpoints require `report:read` (OWNER, ADMIN, MANAGER). `from`/`to` are inclusive. Ranges are bounded: sessions 366 days, daily 92 days, application usage 31 days, timeline 7 days.

### `GET /organizations/:organizationId/reports/tracking-status`

Query: `page`, `limit`, `employeeId`. One row per active membership. Durability comes from `desktop_agents.last_seen_at` and `time_sessions.last_heartbeat_at`, not from in-memory WebSocket state.

```json
{
  "data": [
    {
      "employee": { "id": "…", "name": "Ada Lovelace", "email": "ada@example.com", "status": "ACTIVE", "lastLoginAt": "…", "createdAt": "…", "updatedAt": "…" },
      "state": "WORKING",
      "online": true,
      "heartbeatStale": false,
      "activeSession": { "…": "…" },
      "lastHeartbeatAt": "…",
      "lastSeenAt": "…",
      "agent": { "…": "…" }
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 },
  "timezone": "Europe/Berlin",
  "heartbeatStaleAfterSeconds": 120,
  "serverTime": "…"
}
```

`state` is `WORKING` (fresh active session), `ON_BREAK` (fresh active break), `ONLINE` (fresh agent, no fresh working session), or `OFFLINE`. `online` reports agent contact freshness independently of the session state.

### `GET /organizations/:organizationId/reports/sessions`

Query: `from`, `to`, `employeeId`, `status`, `page`, `limit`. Returns sessions overlapping the range with `breakSeconds` and `workingSeconds` (session duration minus its breaks). `from`/`to` are required.

Response: `{ data, meta, from, to, timezone }`.

### `GET /organizations/:organizationId/reports/daily`

Query: `from`, `to`, `employeeId` (required). Returns one row per local calendar day. Working time is session time clipped to the day and range, minus all breaks; stopped/ended sessions contribute only their stored interval.

```json
{
  "data": {
    "employeeId": "…",
    "from": "2026-10-01",
    "to": "2026-10-02",
    "timezone": "Europe/Berlin",
    "days": [
      {
        "date": "2026-10-01",
        "employeeId": "…",
        "workedSeconds": 27000,
        "breakSeconds": 1800,
        "sessionCount": 1,
        "firstStartedAt": "…",
        "lastEndedAt": "…"
      }
    ]
  }
}
```

`lastEndedAt` for an open session is the current server time; use the tracking-status endpoint to see whether its heartbeat is fresh.

### `GET /organizations/:organizationId/reports/application-usage`

Query: `from`, `to`, `employeeId` (required), `page`, `limit`. Activity is clipped to working intervals, so breaks and stopped time are excluded.

```json
{
  "data": [
    {
      "applicationIdentifier": "code",
      "applicationName": "Visual Studio Code",
      "totalSeconds": 6300,
      "percentageOfTrackedTime": 35.0,
      "eventCount": 12,
      "sessionCount": 1
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 },
  "employeeId": "…",
  "from": "2026-10-01",
  "to": "2026-10-01",
  "timezone": "Europe/Berlin",
  "trackedWorkingSeconds": 18000,
  "totalApplicationSeconds": 6300,
  "disclaimer": "Application usage is foreground metadata only. It is not a definitive measure or proof of productivity."
}
```

`percentageOfTrackedTime` uses `trackedWorkingSeconds` as its denominator. Metadata is not proof of productivity.

### `GET /organizations/:organizationId/reports/application-timeline`

Query: `from`, `to`, `employeeId` (required), `page`, `limit` (max 500, default 100). Returns clipped activity segments in chronological order with the same disclaimer and range/timezone metadata.

---

## Employee attendance

Employees use the existing `GET /organizations/:organizationId/time-sessions` history
endpoint (with `from`/`to`, break details, and forced self-scoping) and
`GET /organizations/:organizationId/time-sessions/current` for the live state. The
endpoints below add daily/weekly/monthly summaries, the correction workflow, and the
mobile check-in/evidence flow. Check-in creates the same `TimeSession` rows as
`/time-sessions/start`, so existing timer, break, reporting, and correction behavior is
unchanged for website and Electron clients.

### `GET /organizations/:organizationId/attendance/summaries`

Requires `time:read`. Query: `from`, `to` (inclusive organization-local dates),
`period` = `daily` (default) | `weekly` | `monthly`, and optional `employeeId`.

Employees always receive their own summary; a supplied `employeeId` is ignored.
Managers/admins/owners must supply an in-organization `employeeId`. Weekly buckets start
on Monday. At the edges of a requested range, a period includes only the days that fall
inside the range (`daysIncluded` reports that count). Worked time is session time clipped
to the day/range minus merged breaks, using the organization's IANA timezone. Totals use
distinct session IDs so a session crossing days is not double-counted.

```json
{
  "data": {
    "employeeId": "uuid",
    "period": "weekly",
    "from": "2026-10-01",
    "to": "2026-10-31",
    "timezone": "Europe/Berlin",
    "totals": {
      "workedSeconds": 54000,
      "breakSeconds": 3600,
      "sessionCount": 4,
      "activeDays": 4,
      "firstStartedAt": "2026-10-01T07:00:00.000Z",
      "lastEndedAt": "2026-10-30T16:00:00.000Z"
    },
    "periods": [
      {
        "periodStart": "2026-09-28",
        "periodEnd": "2026-10-04",
        "workedSeconds": 12600,
        "breakSeconds": 1800,
        "sessionCount": 1,
        "activeDays": 1,
        "daysIncluded": 4,
        "firstStartedAt": "2026-10-01T07:00:00.000Z",
        "lastEndedAt": "2026-10-01T11:30:00.000Z"
      }
    ]
  },
  "serverTime": "2026-10-23T10:00:00.000Z"
}
```

Ranges are limited to 366 days. Managers/admins/owners without `employeeId` receive
`422 EMPLOYEE_ID_REQUIRED`.

### Correction requests

A correction is a pending request that targets either an existing stopped session
(`requestType: "UPDATE_SESSION"`, `sessionId` supplied) or a missing session
(`requestType: "CREATE_SESSION"`, no `sessionId`). Approval applies the requested
timestamps and the full requested break list to a `STOPPED` session. For a missing
session the server creates a stopped `OFFLINE`-source session with no desktop agent.
Existing `ONLINE`/`OFFLINE` source values are unchanged.

Corrections cannot contain future timestamps, cannot overlap another session for the
employee, and breaks must be ordered, non-overlapping, and inside the corrected session.
A request that starts before an existing session and overlaps it returns
`409 CORRECTION_BEFORE_EXISTING_SESSION`; other overlaps return
`409 CORRECTION_OVERLAPS_EXISTING_SESSION`.
Only one pending correction may target an existing session or overlap another pending
request. The affected work date is the organization-local date of the original session
(for updates) or the requested start (for missing sessions).

#### `POST /organizations/:organizationId/attendance/corrections`

Requires `time:write`. The employee is always the authenticated user. Browser cookie
sessions still require the CSRF token.

```json
{
  "sessionId": "optional-existing-session-uuid",
  "workDate": "2026-10-21",
  "startedAt": "2026-10-21T08:00:00.000Z",
  "endedAt": "2026-10-21T17:00:00.000Z",
  "breaks": [
    { "startedAt": "2026-10-21T12:00:00.000Z", "endedAt": "2026-10-21T13:00:00.000Z" }
  ],
  "reason": "The timer was started late after a system update."
}
```

`201` returns `{ data: { correction, serverTime } }`. The correction includes `status`,
`original` (the session/break snapshot at request time, `null` for missing sessions),
`requestedBreaks`, `requestedBreakSeconds`, reviewer fields, and `applied` after approval.

#### `GET /organizations/:organizationId/attendance/corrections`

Requires `time:read`. Employees see only their own requests. Reviewers see their
organization; optional filters are `status`, `employeeId`, `from`, `to` (work-date
range), `page`, and `limit`. Returns `{ data, meta, serverTime }`.

#### `GET /organizations/:organizationId/attendance/corrections/:correctionId`

Requires `time:read`. Employees may read only their own correction; reviewers may read
any correction in the organization.

#### `POST /organizations/:organizationId/attendance/corrections/:correctionId/approve`

Requires `correction:review` (OWNER, ADMIN, MANAGER). Body: optional
`{ "note": "Approved against the signed timesheet." }`. The approver cannot be the
employee who submitted the request (`403 SELF_REVIEW_FORBIDDEN`).

Approval locks the employee and correction rows, re-checks `PENDING`, re-validates the
stored timestamps/breaks, and re-checks session overlap. It then updates or creates the
session, replaces its break rows, records the resulting snapshot, and writes an
`ATTENDANCE_CORRECTION_APPROVED` audit event in the same transaction. A repeated
approval is idempotent (`200`) and does not create another session or audit row.
If the correction became invalid while pending, approval returns `409` and leaves the
request `PENDING` with attendance unchanged.

#### `POST /organizations/:organizationId/attendance/corrections/:correctionId/reject`

Requires `correction:review`. Body:
`{ "reason": "Required rejection reason", "note": "optional" }`. Rejection is recorded
with the reviewer and an `ATTENDANCE_CORRECTION_REJECTED` audit event. Repeated rejection
is idempotent; rejecting an approved correction returns
`409 CORRECTION_ALREADY_APPROVED`.

All submitted, approved, and rejected decisions retain the original session/break
snapshot in the request and audit metadata. No credentials or tokens are stored in audit
metadata.

---

## Mobile attendance check-in and evidence

These additive endpoints let the React Native apps start the existing time-session state
machine with a work mode and, when required, private photo evidence. The behavior is
online-only: offline recovery continues to use `/time-sessions/sync` and is not extended
with evidence.

Requirements:

- The caller must be authenticated and have `time:write` for writes or `time:read` for
  reads. The employee is always the authenticated user; the organization is resolved
  from the verified membership.
- New check-in and evidence-write routes require `X-Agent-Id`/`X-Agent-Key` for a
  non-revoked device registered with `clientType: "MOBILE"`. Electron devices receive
  `403 MOBILE_AGENT_REQUIRED`. Existing `/time-sessions/*` routes are unchanged and keep
  accepting any registered agent.
- Session start/stop timestamps and audit timestamps are server-generated. Clients only
  send `capturedAt` and `location.recordedAt` so the server can verify freshness; those
  values never drive the session clock.
- There is exactly one open session per employee across mobile, website, and Electron
  clients. A check-in while another session is active returns
  `409 ACTIVE_SESSION_EXISTS`. The work mode is fixed for the life of a session; check
  out before checking in with a different mode.

| Work mode | Selfie | Site photo | Location |
| --- | --- | --- | --- |
| `WFH` | Not accepted | Not accepted | Optional; validated and recorded when supplied |
| `WFO` | Required | Not accepted | Not accepted; a supplied `location` is rejected with `422 VALIDATION_ERROR` and no coordinates are persisted |
| `ON_SITE` | Required | Required (a different evidence upload) | Required |

WFO is location-free by policy: the mobile client does not need location permission, and
the check-in record stores `null` latitude, longitude, accuracy, and recorded time. WFH
does not collect location automatically. Location policy applies only to an optional WFH
fix and to the required ON_SITE fix.

Location policy defaults (all configurable):

- accuracy must be at most `ATTENDANCE_LOCATION_MAX_ACCURACY_METERS` (500 m);
- `recordedAt` must be at most `ATTENDANCE_LOCATION_MAX_AGE_SECONDS` (300 s) old;
- `recordedAt` may be at most `ATTENDANCE_LOCATION_FUTURE_SKEW_SECONDS` (60 s) in the
  future.

There is no geofencing and no continuous background location tracking.

### Evidence lifecycle

1. `POST .../attendance/evidence` creates a `PENDING` row plus a short-lived private
   upload target. Storage keys and upload tokens are never returned.
2. `PUT` the returned `upload.url` with the raw image body. The server validates the
   content type, byte size, and image signature, writes only to private object storage,
   and marks the row `UPLOADED`.
3. `POST .../attendance/check-ins` references the uploaded evidence IDs. In one
   transaction the server locks the employee, creates the time session, creates the
   check-in, marks the evidence `ATTACHED`, and writes an `ATTENDANCE_CHECKED_IN` audit
   event.
4. If anything fails before commit, no evidence is attached and no session is created.
   Uploaded, unattached evidence remains retryable until it expires
   (`ATTENDANCE_EVIDENCE_TTL_SECONDS`, default 900 s). Evidence attached to a successful
   check-in is never deleted by error recovery.

Evidence is employee- and device-scoped. The server re-verifies ownership, kind
(`SELFIE` vs `SITE_PHOTO`), status, expiry, and the stored object's size/signature at
check-in, so a storage/database mismatch cannot attach unexpected bytes.

### Idempotency and concurrency

`checkInRequestId` is a client-generated UUID. Repeating the request with the same
payload returns the original successful result (`200`, `replayed: true`). For modes that
carry a location, this holds even after the original fix would no longer be fresh:
freshness is evaluated only when a new check-in is created. WFO retries never need a GPS
fix. Reusing the ID with a different payload returns `409 IDEMPOTENCY_KEY_REUSED`.
Different request IDs cannot create a second active session: the later request returns
`409 ACTIVE_SESSION_EXISTS`. Concurrent retries are serialized per employee; database
unique constraints remain the cross-process guarantee.

### `POST /organizations/:organizationId/attendance/evidence`

Requires `time:write` plus a registered `MOBILE` agent.

```json
{ "kind": "SELFIE", "contentType": "image/png", "capturedAt": "2026-10-24T08:59:30.000Z" }
```

`201`:

```json
{
  "data": {
    "evidence": {
      "id": "uuid",
      "organizationId": "uuid",
      "employeeId": "uuid",
      "desktopAgentId": "uuid",
      "kind": "SELFIE",
      "status": "PENDING",
      "contentType": "image/png",
      "fileSizeBytes": null,
      "capturedAt": "2026-10-24T08:59:30.000Z",
      "uploadedAt": null,
      "expiresAt": "2026-10-24T09:14:30.000Z",
      "attachedSessionId": null,
      "createdAt": "2026-10-24T08:59:30.000Z",
      "updatedAt": "2026-10-24T08:59:30.000Z"
    },
    "upload": {
      "method": "PUT",
      "url": "https://api.example.com/api/v1/agent/attendance-evidence/<token>",
      "headers": { "Content-Type": "image/png" },
      "requiredHeaders": { "X-Organization-Id": "uuid" },
      "requiresAgentAuth": true,
      "expiresAt": "2026-10-24T09:01:30.000Z",
      "maxBytes": 10485760,
      "contentType": "image/png"
    }
  },
  "serverTime": "2026-10-24T08:59:30.000Z"
}
```

`kind` is `SELFIE` or `SITE_PHOTO`. `capturedAt` is optional but cannot be in the future.

### `POST /organizations/:organizationId/attendance/evidence/:evidenceId/upload-authorization`

Requires `time:write` plus a registered `MOBILE` agent. Reissues the upload target for a
`PENDING` row and invalidates the previous token. Uploaded/attached evidence returns
`409`; expired evidence returns `410`. No request body.

### `PUT /agent/attendance-evidence/:token`

Requires bearer auth, `X-Organization-Id`, and `X-Agent-Id`/`X-Agent-Key` for the same
`MOBILE` agent that created the evidence. The body is the raw image. Allowed types and
the size cap are shared with screenshots (`SCREENSHOT_ALLOWED_CONTENT_TYPES`,
`SCREENSHOT_MAX_BYTES`). Returns `201 { data: { evidence }, serverTime }`.

### `POST /organizations/:organizationId/attendance/check-ins`

Requires `time:write` plus a registered `MOBILE` agent.

```json
{
  "checkInRequestId": "2f6f0f6e-7a8f-4a2b-9a17-0e0f4f9f0a11",
  "workMode": "ON_SITE",
  "selfieEvidenceId": "uuid",
  "sitePhotoEvidenceId": "uuid",
  "location": {
    "latitude": 28.6139,
    "longitude": 77.209,
    "accuracyMeters": 20,
    "recordedAt": "2026-10-24T08:59:55.000Z"
  }
}
```

`201` (or `200` with `replayed: true`):

```json
{
  "data": {
    "checkIn": {
      "id": "uuid",
      "organizationId": "uuid",
      "employeeId": "uuid",
      "desktopAgentId": "uuid",
      "sessionId": "uuid",
      "workMode": "ON_SITE",
      "checkInRequestId": "uuid",
      "location": {
        "latitude": 28.6139,
        "longitude": 77.209,
        "accuracyMeters": 20,
        "recordedAt": "2026-10-24T08:59:55.000Z"
      },
      "selfie": { "id": "uuid", "kind": "SELFIE", "status": "ATTACHED" },
      "sitePhoto": { "id": "uuid", "kind": "SITE_PHOTO", "status": "ATTACHED" },
      "createdAt": "2026-10-24T09:00:01.000Z",
      "updatedAt": "2026-10-24T09:00:01.000Z"
    },
    "session": { "id": "uuid", "status": "ACTIVE", "source": "ONLINE" },
    "autoClosedSessionId": null,
    "replayed": false
  },
  "serverTime": "2026-10-24T09:00:01.000Z"
}
```

`session` is the normal time-session summary, including breaks and
`desktopAgent`/`employee` summaries. `autoClosedSessionId` is populated only when a stale
session was recovered at its last heartbeat, matching the existing start-session rules.

Per-mode request bodies:

```json
{ "checkInRequestId": "uuid", "workMode": "WFH" }
```

```json
{ "checkInRequestId": "uuid", "workMode": "WFO", "selfieEvidenceId": "uuid" }
```

ON_SITE uses the full example above (`selfieEvidenceId`, `sitePhotoEvidenceId`, and
`location`). WFH omits both evidence fields and `location`; WFO omits
`sitePhotoEvidenceId` and `location`. Do not send `location` for WFO: it is rejected
rather than ignored, and no coordinates are stored. Repeating a successful WFO request
requires only the same `checkInRequestId`, work mode, and selfie evidence ID; no GPS fix
is needed for the retry.

After check-in, breaks, resume, heartbeat, and checkout use the existing time-session
routes with the same `MOBILE` agent credentials:
`POST .../time-sessions/:sessionId/breaks`, `POST .../time-sessions/:sessionId/breaks/end`,
`POST .../time-sessions/:sessionId/heartbeat`, and `POST .../time-sessions/:sessionId/stop`.
This endpoint reports the resulting session status (`ACTIVE`, `ON_BREAK`, or after
checkout, a null session), so a restarted mobile app can recover both the open timer and
its check-in without creating a second session.

### `GET /organizations/:organizationId/attendance/check-ins/current`

Requires `time:read`; always self-scoped. No device credential is required. Returns the
open session and its check-in, or `{ "checkIn": null, "session": null }` when checked
out. A session started through another client has `checkIn: null`.

### `POST /organizations/:organizationId/attendance/evidence/:evidenceId/access`

Requires `time:read`. The owning employee may access their own evidence; owners, admins,
and managers with `time:read` may access evidence anywhere in the organization. Every
grant writes `ATTENDANCE_EVIDENCE_ACCESS_GRANTED` and returns a short-lived signed URL:

```json
{
  "data": {
    "evidence": { "id": "uuid", "kind": "SELFIE", "status": "ATTACHED" },
    "url": "https://api.example.com/api/v1/attendance-files/<token>",
    "expiresAt": "2026-10-24T09:05:01.000Z"
  },
  "serverTime": "2026-10-24T09:00:01.000Z"
}
```

### `GET /attendance-files/:token`

No bearer token is required; the HMAC-signed, expiring token is the authorization. It
verifies the evidence, organization, and expiry server-side, streams the private object
with `Cache-Control: private, no-store, max-age=0`, and writes
`ATTENDANCE_EVIDENCE_VIEWED`. Attendance evidence tokens are separate from screenshot
tokens and cannot be used on `/screenshot-files`.

### Retention and limitations

- Attendance evidence is retained privately with **no automatic deletion** until an
  approved retention policy exists. This is a known gap that must be resolved before
  committing to a retention period in production. Evidence can only be removed by
  future administrative retention work; there is no public or admin delete endpoint.
- The server validates the declared content type, file size, and image signature, but it
  cannot prove that a photo was captured live, that the device clock is honest, or that
  the reported coordinates are truthful. Attendance photos are work-location evidence,
  not biometric identity verification; there is no facial recognition, face enrollment,
  or biometric template storage. Clients must not present these records as stronger
  proof than the server can provide.
- Screenshot capture policy, authorization, storage, and audit remain independent of
  attendance evidence.

---

## Admin-initiated screenshots

Screenshots are **only** created by an explicit administrator request. There is no periodic capture, no automatic capture when a timer starts, and no capture triggered merely by application usage. Real desktop capture/upload is not implemented by this backend step; the routes below define the lifecycle, authorization, private storage, review, and retention contract that the Electron and Next.js clients must use.

All admin routes require authentication and `X-Organization-Id`. The organization ID is only a selector; membership and role are resolved from the database. Screenshot permissions are also constrained by the organization policy.

### Screenshot policy and disclosure

Screenshots are **disabled by default**. A policy row is created lazily with `enabled=false`, request roles `OWNER`/`ADMIN`, view roles `OWNER`/`ADMIN`, a 5-second request cooldown, 30-day screenshot retention, 365-day audit retention, and acknowledgement optional.

#### `GET /admin/screenshot-policy`

Requires `screenshot:policy`.

```json
{
  "data": {
    "policy": {
      "organizationId": "…",
      "enabled": false,
      "requestRoles": ["OWNER", "ADMIN"],
      "viewRoles": ["OWNER", "ADMIN"],
      "requestCooldownSeconds": 5,
      "retentionDays": 30,
      "auditRetentionDays": 365,
      "employeeAcknowledgementRequired": false,
      "disclosureVersion": "v1",
      "disclosureText": "Authorized administrators may request individual screenshots…",
      "createdAt": "…",
      "updatedAt": "…"
    }
  },
  "serverTime": "…"
}
```

#### `PATCH /admin/screenshot-policy`

Requires `screenshot:policy`. At least one field is required; unknown fields are rejected.

```json
{
  "enabled": true,
  "requestRoles": ["OWNER", "ADMIN"],
  "viewRoles": ["OWNER", "ADMIN", "MANAGER"],
  "requestCooldownSeconds": 60,
  "retentionDays": 14,
  "auditRetentionDays": 365,
  "employeeAcknowledgementRequired": true,
  "disclosureVersion": "v2",
  "disclosureText": "This organization may request individual desktop screenshots while work is active…"
}
```

Rules:

- `requestRoles` must be a subset of `viewRoles` (`422 VALIDATION_ERROR` otherwise).
- Roles are still bounded by the permission matrix above: a policy can narrow access, not grant `screenshot:request` to `MANAGER` or `EMPLOYEE`.
- When the disclosure text changes while acknowledgements already exist for the current version, a new `disclosureVersion` is required (`422 SCREENSHOT_DISCLOSURE_VERSION_REQUIRED`). A new version makes existing acknowledgements stale.
- Disabling the policy blocks new requests and claims. An already pending request remains subject to its expiry unless an administrator cancels it.
- Every accepted update writes `SCREENSHOT_POLICY_UPDATED` to the audit trail.

#### `GET /screenshot-policy`

Available to every active member. Returns the employee-facing disclosure; it does not expose role lists or audit-retention settings.

```json
{
  "data": {
    "policy": {
      "enabled": true,
      "retentionDays": 14,
      "disclosure": {
        "version": "v2",
        "text": "This organization may request individual desktop screenshots while work is active…",
        "acknowledgementRequired": true,
        "acknowledged": false,
        "acknowledgedAt": null
      },
      "updatedAt": "…"
    }
  },
  "serverTime": "…"
}
```

#### `POST /screenshot-policy/acknowledge`

Available to every active member. Records the caller’s acknowledgement of the **current** disclosure version and writes `SCREENSHOT_POLICY_ACKNOWLEDGED`. Idempotent for the current version.
```json
{ "data": { "policy": { "…": "…", "disclosure": { "acknowledged": true, "acknowledgedAt": "…" } } }, "serverTime": "…" }
```

### `POST /admin/employees/:employeeId/screenshot-requests`

Requires `screenshot:request` plus the policy’s `requestRoles`. This is the only endpoint that creates a screenshot request. It creates one individual request for one employee; there is no bulk or recurring form.

Optional header: `Idempotency-Key: <8–160 chars, A-Z a-z 0-9 . _ : ->`. The key is scoped to the organization and requesting administrator. A retry with the same key and same employee returns `200` with `"replayed": true`. Reusing the key for a different employee returns `409 IDEMPOTENCY_KEY_REUSED`.

The server performs all checks transactionally:

- target membership is active in the organization;
- policy is enabled and the actor role is allowed to request;
- employee acknowledgement is present when required;
- a non-revoked `ELECTRON` desktop agent exists for the employee (mobile agents are never screenshot targets);
- an active time session with a fresh heartbeat exists for that agent/employee;
- no other `PENDING`/`CLAIMED` request exists for the employee;
- the per-administrator request cooldown has elapsed;
- no overdue request is still blocking a new one (overdue rows are expired first).

The server selects the agent, time session, storage key, content type, upload token, and expiry. Clients cannot supply an employee/agent/session identity or storage key.

`201` (or `200` on idempotent replay):

```json
{
  "data": {
    "request": {
      "id": "…",
      "organizationId": "…",
      "employeeId": "…",
      "requestingAdminId": "…",
      "desktopAgentId": "…",
      "timeSessionId": "…",
      "status": "PENDING",
      "requestedAt": "…",
      "expiresAt": "…",
      "acknowledgedAt": null,
      "claimedAt": null,
      "completedAt": null,
      "cancelledAt": null,
      "failure": null,
      "canCancel": true,
      "employee": { "id": "…", "name": "Ada Lovelace", "email": "ada@example.com" },
      "requestingAdmin": { "id": "…", "name": "Admin", "email": "admin@example.com" },
      "desktopAgent": { "id": "…", "name": "Ada laptop", "platform": "win32", "status": "ACTIVE", "online": true },
      "createdAt": "…",
      "updatedAt": "…"
    },
    "delivery": {
      "agentOnline": true,
      "delivered": true,
      "note": "The request was sent to a live agent connection."
    },
    "replayed": false
  },
  "serverTime": "…"
}
```

If no live WebSocket connection is available, `delivered` is `false`, `agentOnline` reflects durable presence, and the request remains `PENDING` until the agent reconnects or `expiresAt` passes. The response never contains the private storage key or upload token.

Errors include `403 SCREENSHOT_POLICY_DISABLED`, `403 PERMISSION_DENIED`, `404 EMPLOYEE_NOT_FOUND`, `409 SCREENSHOT_POLICY_ACKNOWLEDGEMENT_REQUIRED`, `409 INVALID_SCREENSHOT_AGENT`, `409 NO_ELIGIBLE_SCREENSHOT_SESSION`, `409 SCREENSHOT_REQUEST_PENDING`, `429 SCREENSHOT_REQUEST_COOLDOWN`, and `409 IDEMPOTENCY_KEY_REUSED`.

### Admin request and review APIs

| Method and path | Permission | Purpose |
| --- | --- | --- |
| `GET /admin/employees/:employeeId/screenshot-requests` | `screenshot:read` + `viewRoles` | Paginated request history for one employee. Query: `status`, `page`, `limit`. |
| `GET /admin/screenshot-requests` | `screenshot:read` + `viewRoles` | Paginated organization request history. Query: `employeeId`, `status`, `page`, `limit`. |
| `GET /admin/screenshot-requests/:requestId` | `screenshot:read` + `viewRoles` | Current status/failure and completion metadata. |
| `POST /admin/screenshot-requests/:requestId/cancel` | `screenshot:manage` + `requestRoles` | Cancel a `PENDING`/`CLAIMED` request, consume its upload authorization, and delete any uploaded object. |
| `GET /admin/screenshots` | `screenshot:read` + `viewRoles` | Paginated completed-screenshot metadata. Query: `employeeId`, `sessionId`, `from`, `to`, `page`, `limit`. |
| `GET /admin/screenshots/:screenshotId` | `screenshot:read` + `viewRoles` | One screenshot’s metadata. |
| `POST /admin/screenshots/:screenshotId/access` | `screenshot:read` + `viewRoles` | Issue a short-lived private download URL and audit the access grant. Body fields are ignored. |
| `GET /admin/screenshot-audit-events` | `screenshot:read` + `viewRoles` | Paginated organization-scoped audit history. Query: `employeeId`, `requestId`, `action`, `from`, `to`, `page`, `limit`. |

Audit events are returned newest first with `action`, actor/target user summaries, entity and
request/screenshot references, `createdAt`, and sanitized `metadata`. Tokens, storage keys, object
URLs, image bytes, and agent credentials are never included. Cross-organization filters return no
rows rather than leaking another organization’s records; a role excluded by `viewRoles` receives
`403 SCREENSHOT_ROLE_NOT_ALLOWED`.

Request summaries follow the creation shape. Screenshot summaries contain `id`, `organizationId`, `employeeId`, `timeSessionId`, `screenshotRequestId`, `requestingAdminId`, `capturedAt`, `contentType`, `fileSizeBytes`, `retentionExpiresAt`, employee/admin summaries, and timestamps. **Storage keys and object URLs are never returned.**

`POST /admin/screenshots/:screenshotId/access` returns:

```json
{
  "data": {
    "screenshot": { "…": "…" },
    "url": "https://api.example.com/api/v1/screenshot-files/<signed-token>",
    "expiresAt": "…"
  },
  "serverTime": "…"
}
```

With local storage, the URL points at `GET /screenshot-files/:token`. That route needs no bearer token because the HMAC-signed, expiring token is the authorization; it still verifies the screenshot, organization, and retention window server-side. With S3 storage, `url` is a presigned GET URL for the private bucket. Neither URL is permanent. Both access issuance and the successful local download are audited (`SCREENSHOT_ACCESS_GRANTED`, `SCREENSHOT_VIEWED`).

### Request lifecycle

Status values: `PENDING`, `CLAIMED`, `COMPLETED`, `FAILED`, `EXPIRED`, `CANCELLED`.

| Transition | Trigger |
| --- | --- |
| → `PENDING` | Admin request created. Persisted before any WebSocket delivery. |
| `PENDING` → `CLAIMED` | The intended agent claims, after a policy/role/ownership/session check, and receives short-lived upload authorization. |
| `CLAIMED` → `COMPLETED` | Agent uploads a validated image to the server-selected object key and completes with valid metadata. |
| `PENDING`/`CLAIMED` → `CANCELLED` | Administrator cancels. Any private object is deleted. |
| `PENDING`/`CLAIMED` → `EXPIRED` | Request TTL elapses, or a claimed request’s upload window elapses before a successful upload. |
| `PENDING`/`CLAIMED` → `FAILED` | Agent reports a sanitized failure code; no image is accepted. |
| `COMPLETED`/`FAILED`/`EXPIRED`/`CANCELLED` | Terminal; duplicate claims/completions are rejected. |

An acknowledgement records that the employee’s agent received the request but is informational only; it does not change the status. There is at most one active (`PENDING`/`CLAIMED`) request per employee, enforced by a partial unique index. State changes are written before WebSocket messages are sent. Only the authenticated agent bound to the request can acknowledge, claim, upload, complete, or fail it.

### Agent lifecycle APIs

These routes require the normal API bearer token **and** `X-Agent-Id`/`X-Agent-Key`, plus `X-Organization-Id`. The agent and employee are derived from those credentials and the request row; a request ID alone is never proof of ownership.

| Method and path | Purpose |
| --- | --- |
| `GET /agent/screenshot-requests/pending` | Pending `PENDING`/`CLAIMED` requests for this agent. Also expires overdue requests. |
| `POST /agent/screenshot-requests/:requestId/ack` | Record receipt. Returns `requestId`, `status`, `acknowledgedAt`, `expiresAt`. |
| `POST /agent/screenshot-requests/:requestId/claim` | Claim with optional `{ "contentType": "image/png" }`. Returns upload authorization. |
| `POST /agent/screenshot-requests/:requestId/upload-authorization` | Reissue a short-lived upload authorization after reconnect if the previous one expired and no upload exists. |
| `PUT /agent/screenshot-uploads/:token` | Local-storage binary upload target. Not used for S3. |
| `POST /agent/screenshot-requests/:requestId/complete` | Validate and finalize an already-uploaded image. |
| `POST /agent/screenshot-requests/:requestId/fail` | Report `{ "code": "CAPTURE_FAILED", "message": "optional sanitized text" }`. |

`claim` (and upload reauthorization) returns:

```json
{
  "data": {
    "requestId": "…",
    "status": "CLAIMED",
    "claimedAt": "…",
    "expiresAt": "…",
    "upload": {
      "method": "PUT",
      "url": "https://api.example.com/api/v1/agent/screenshot-uploads/<one-time-token>",
      "headers": { "Content-Type": "image/png" },
      "requiredHeaders": { "X-Organization-Id": "…" },
      "requiresAgentAuth": true,
      "expiresAt": "…",
      "maxBytes": 10485760,
      "contentType": "image/png"
    }
  },
  "serverTime": "…"
}
```

For S3, `method`/`url`/`headers` are a presigned PUT target, `requiresAgentAuth` is `false`, and the bucket remains private. The object key is generated server-side. Upload tokens are one-time, stored only as HMAC hashes, cleared on success, and expire independently of the request. A retry after a successful upload returns `404 UPLOAD_AUTHORIZATION_INVALID`; it must not overwrite or re-use the object.

The local upload endpoint accepts only the configured image content types, enforces `SCREENSHOT_MAX_BYTES`, validates the image signature, and rejects empty/oversized bodies. It stores the bytes only in private object storage, never in PostgreSQL.

`complete` accepts an optional `captureTimestamp` (ISO-8601 with offset) and **strictly rejects unknown fields**, including any client-supplied `storageKey`. It confirms the object exists, checks the stored content type and size, enforces retention, creates the screenshot metadata row, marks the request `COMPLETED`, and audits completion. Duplicate completion returns `409 SCREENSHOT_ALREADY_COMPLETED`; completion before upload returns `409 SCREENSHOT_UPLOAD_NOT_FOUND`. Expired requests cannot complete.

```json
{ "captureTimestamp": "2026-10-22T09:04:30.000Z" }
```

### Storage, retention, and maintenance

Storage is private by default and selected with `SCREENSHOT_STORAGE_DRIVER`:

- `local`: private files under `SCREENSHOT_LOCAL_DIR`, served only through HMAC-signed expiring URLs.
- `s3`: private S3-compatible bucket with presigned PUT/GET URLs. Credentials are optional when the runtime provides an IAM role.

Disallowed content types, mismatched types, invalid image signatures, empty bodies, and files above the configured limit are rejected. Download URLs expire. Retention is measured from completion: expired screenshot metadata is deleted and its private object is removed. Maintenance also expires overdue requests, cleans abandoned uploads, removes objects for terminal requests, and deletes screenshot audit rows older than `auditRetentionDays`, while retaining audit evidence according to that policy. Maintenance runs at startup and then every `SCREENSHOT_CLEANUP_INTERVAL_SECONDS`.

Relevant environment variables are documented in [README.md](../README.md#configuration). After cleanup, a deleted screenshot returns `404 SCREENSHOT_NOT_FOUND`; an invalid or expired signed URL returns `404 SCREENSHOT_LINK_INVALID`.

### Audit events

Screenshot actions write to the organization-scoped `audit_events` table: `SCREENSHOT_POLICY_UPDATED`, `SCREENSHOT_POLICY_ACKNOWLEDGED`, `SCREENSHOT_REQUEST_CREATED`, `SCREENSHOT_REQUEST_ACKNOWLEDGED`, `SCREENSHOT_REQUEST_CLAIMED`, `SCREENSHOT_REQUEST_COMPLETED`, `SCREENSHOT_REQUEST_FAILED`, `SCREENSHOT_REQUEST_CANCELLED`, `SCREENSHOT_REQUEST_EXPIRED`, `SCREENSHOT_ACCESS_GRANTED`, `SCREENSHOT_VIEWED`, and `SCREENSHOT_DELETED`. Audit rows capture actor, target employee, entity/request/screenshot references, IP/user-agent when HTTP supplies them, and sanitized metadata. Tokens, storage keys, and image bytes are never audited.

### WebSocket screenshot messages

The existing agent WebSocket carries screenshot lifecycle messages to the authenticated agent that owns the request. Message delivery is process-local; durable pending recovery is available through the `connected` payload and the HTTP pending endpoint.

Client → server:

```json
{ "type": "screenshot.ack", "requestId": "…" }
{ "type": "screenshot.claim", "requestId": "…", "contentType": "image/png" }
{ "type": "screenshot.complete", "requestId": "…", "captureTimestamp": "…" }
{ "type": "screenshot.fail", "requestId": "…", "code": "CAPTURE_FAILED", "message": "optional" }
```

The server validates that the message’s `requestId` belongs to the connected agent and employee; employee, organization, status, agent, and storage-key fields from the client are never trusted. Invalid or replayed transitions return `screenshot.error` and do not change state.

Server → client:

```json
{
  "type": "screenshot.request",
  "requestId": "…",
  "sessionId": "…",
  "requestedAt": "…",
  "expiresAt": "…",
  "maxBytes": 10485760,
  "allowedContentTypes": ["image/png", "image/jpeg", "image/webp"],
  "requiresClaim": true
}
{ "type": "screenshot.acknowledged", "requestId": "…", "status": "PENDING", "acknowledgedAt": "…", "expiresAt": "…", "serverTime": "…" }
{ "type": "screenshot.claimed", "requestId": "…", "status": "CLAIMED", "claimedAt": "…", "expiresAt": "…", "upload": { "…": "…" }, "serverTime": "…" }
{ "type": "screenshot.completed", "requestId": "…", "screenshot": { "…": "…" }, "serverTime": "…" }
{ "type": "screenshot.failed", "requestId": "…", "status": "FAILED", "failure": { "code": "…", "message": "…" }, "serverTime": "…" }
{ "type": "screenshot.cancelled", "requestId": "…", "reason": "CANCELLED", "serverTime": "…" }
{ "type": "screenshot.error", "requestId": "…", "code": "…", "message": "…", "serverTime": "…" }
```

On reconnect, `connected.pendingScreenshotRequests` lists active requests for that exact agent (with status, expiry, expected content type, and upload timestamps). A `CLAIMED` request can be resumed with `upload-authorization`; a `PENDING` request can be claimed. Pending requests also expire after the configured TTL if the agent never returns.

---

## Agent WebSocket

`ws://<host>/api/v1/ws/agent` (or `wss://` behind TLS). Authenticate during the HTTP upgrade with all three credentials:

```http
Authorization: Bearer <accessToken>
X-Agent-Id: <agent uuid>
X-Agent-Key: tna_…
```

The server verifies the access token, agent key hash, user/agent ownership, active membership, and active organization. Browser origins must be in `CORS_ORIGINS`; non-browser clients without an `Origin` header are allowed. Failed upgrades return an HTTP `401`/`403` JSON error before the socket opens.

On connect the server sends:

```json
{
  "type": "connected",
  "serverTime": "…",
  "user": { "id": "…", "name": "Ada Lovelace", "email": "ada@example.com" },
  "organization": { "id": "…", "name": "Acme Corp", "timezone": "Europe/Berlin" },
  "agent": { "id": "…", "name": "Ada's laptop" },
  "state": "WORKING",
  "session": { "…": "…" },
  "heartbeatIntervalSeconds": 60,
  "heartbeatStaleAfterSeconds": 120,
  "pendingScreenshotRequests": []
}
```

`pendingScreenshotRequests` contains only active screenshot requests for the authenticated employee/agent. It is the durable recovery path after reconnect; the detailed lifecycle and message shapes are in [Admin-initiated screenshots](#admin-initiated-screenshots).

Client messages:

```json
{ "type": "heartbeat", "sessionId": "optional-session-uuid" }
{ "type": "session.status" }
{ "type": "ping" }
{ "type": "screenshot.ack", "requestId": "…" }
{ "type": "screenshot.claim", "requestId": "…", "contentType": "image/png" }
{ "type": "screenshot.complete", "requestId": "…", "captureTimestamp": "…" }
{ "type": "screenshot.fail", "requestId": "…", "code": "CAPTURE_FAILED", "message": "optional" }
```

- `heartbeat` updates `time_sessions.last_heartbeat_at` (if an active session belongs to this agent) and `desktop_agents.last_seen_at`, then returns `heartbeat.ack` with `state`, `session`, `nextHeartbeatInSeconds`, and `serverTime`.
- `session.status` returns the current `state` and full session without moving the heartbeat.
- `ping` returns `{ "type": "pong", "serverTime": "…" }`.
- Screenshot messages only act on requests owned by the connected agent and its employee; the server re-checks policy, ownership, expiry, and state on every transition.
- Unknown/binary/invalid messages return `{ "type":"error", "code":"…" }` and do not close the socket. Screenshot failures use `{ "type":"screenshot.error", "requestId":"…", "code":"…", "message":"…" }`.

Every heartbeat/status message re-checks the database: revoked/expired session → close `4001 AUTH_EXPIRED`; disabled user, revoked agent, inactive membership, or suspended organization → close `4003` with a descriptive reason. Server ping/pong sweeps terminate dead transports. Key rotation and device revocation close live sockets immediately. Reconnect with the same agent credentials and a fresh access token; heartbeat/session state survives reconnects because it is persisted.

---

## Health

### `GET /health`

Public liveness.

```json
{
  "data": {
    "status": "ok",
    "service": "temponest-api",
    "uptimeSeconds": 123,
    "timestamp": "2026-10-22T00:00:00.000Z"
  }
}
```

### `GET /health/ready`

Public readiness. Runs `SELECT 1`. Returns `200` when ready, otherwise `503` with the same `data` shape (`status: "unavailable"`, `checks.database: "failed"`).

---

## Error codes

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | Generic malformed request |
| 400 | `INVALID_JSON` | Body is not valid JSON |
| 400 | `ORGANIZATION_CONTEXT_REQUIRED` | Missing `X-Organization-Id` |
| 400 | `ORGANIZATION_CONTEXT_INVALID` | Header is not a UUID |
| 400 | `INVITATION_INVALID` | Unknown or malformed invitation token |
| 401 | `UNAUTHENTICATED` | No valid credentials supplied |
| 401 | `INVALID_CREDENTIALS` | Wrong e-mail or password |
| 401 | `AUTH_TOKEN_INVALID` | Access token invalid/revoked |
| 401 | `AUTH_TOKEN_EXPIRED` | Access token expired; refresh required |
| 401 | `REFRESH_TOKEN_REQUIRED` | No refresh token supplied |
| 401 | `REFRESH_TOKEN_INVALID` | Unknown/rotated refresh token |
| 401 | `REFRESH_TOKEN_EXPIRED` | Refresh token expired |
| 401 | `REFRESH_TOKEN_REUSED` | Refresh token reused concurrently |
| 401 | `SESSION_REVOKED` | Session was revoked |
| 403 | `FORBIDDEN` | Generic authorization failure |
| 403 | `PERMISSION_DENIED` | Role lacks the required permission |
| 403 | `ROLE_MANAGEMENT_FORBIDDEN` | Role hierarchy prevents managing target |
| 403 | `ROLE_ASSIGNMENT_FORBIDDEN` | Role cannot be granted by this actor |
| 403 | `CANNOT_MODIFY_SELF` | Self role/status change blocked |
| 403 | `MEMBERSHIP_INACTIVE` | Membership suspended or removed |
| 403 | `ORGANIZATION_SUSPENDED` | Organization is suspended |
| 403 | `CSRF_INVALID` | Missing/mismatched CSRF token |
| 403 | `ORIGIN_NOT_ALLOWED` | Origin not in the CORS allowlist |
| 403 | `ACCOUNT_DISABLED` | User account disabled |
| 403 | `SCREENSHOT_POLICY_DISABLED` | Organization has not enabled admin-initiated screenshots |
| 403 | `SCREENSHOT_ROLE_NOT_ALLOWED` | The policy role list excludes this role |
| 403 | `INVITATION_EMAIL_MISMATCH` | Signed-in e-mail differs from invitation |
| 403 | `SELF_REVIEW_FORBIDDEN` | Reviewer is the employee who submitted the correction |
| 403 | `MOBILE_AGENT_REQUIRED` | New mobile check-in/evidence-write route called by a non-`MOBILE` device |
| 404 | `ROUTE_NOT_FOUND` | Unknown route |
| 404 | `NOT_FOUND` | Generic missing resource |
| 404 | `ORGANIZATION_NOT_FOUND` | Organization missing or caller is not a member |
| 404 | `MEMBERSHIP_NOT_FOUND` | Membership missing (or removed) |
| 404 | `INVITATION_NOT_FOUND` | Invitation missing in this organization |
| 404 | `SESSION_NOT_FOUND` | Session does not belong to the caller |
| 404 | `CORRECTION_NOT_FOUND` | Attendance correction missing, outside the organization, or not owned by the employee |
| 404 | `SCREENSHOT_REQUEST_NOT_FOUND` | Request missing or not owned by the authenticated agent/employee |
| 404 | `SCREENSHOT_NOT_FOUND` | Screenshot missing, outside the organization, or past retention |
| 404 | `SCREENSHOT_LINK_INVALID` | Signed screenshot URL is invalid, tampered, or expired |
| 404 | `UPLOAD_AUTHORIZATION_INVALID` | Upload token is unknown, already consumed, or belongs to another agent |
| 404 | `ATTENDANCE_EVIDENCE_NOT_FOUND` | Evidence missing, outside the organization, or not owned by the employee/device |
| 404 | `ATTENDANCE_EVIDENCE_UPLOAD_INVALID` | Attendance upload token is unknown, consumed, or belongs to another device |
| 404 | `ATTENDANCE_EVIDENCE_LINK_INVALID` | Signed attendance evidence URL is invalid, tampered, or expired |
| 409 | `CONFLICT` | Generic uniqueness/constraint conflict |
| 409 | `EMAIL_ALREADY_EXISTS` | Registration e-mail already used |
| 409 | `ALREADY_MEMBER` | Accepting an invitation while already active |
| 409 | `MEMBER_ALREADY_EXISTS` | Inviting an active member |
| 409 | `MEMBERSHIP_SUSPENDED` | Inviting/accepting while suspended |
| 409 | `INVITATION_ALREADY_ACCEPTED` | Cannot revoke an accepted invitation |
| 409 | `LAST_OWNER` | Organization must retain an active owner |
| 409 | `SLUG_CONFLICT` | Could not allocate a unique slug |
| 409 | `ACTIVE_SESSION_EXISTS` | Employee already has a fresh open session |
| 409 | `AGENT_SESSION_EXISTS` | Agent already has an open session |
| 409 | `SESSION_NOT_ACTIVE` | Session is stopped or otherwise not usable |
| 409 | `SESSION_ALREADY_STOPPED` | Offline stop targets a stopped session |
| 409 | `BREAK_ALREADY_ACTIVE` | Session already has an open break |
| 409 | `NO_ACTIVE_BREAK` | Break end has no open break |
| 409 | `INVALID_SESSION_INTERVAL` | Stop time is not after start |
| 409 | `INVALID_BREAK_INTERVAL` | Break interval is invalid |
| 409 | `EVENT_OVERLAP` | Application activity overlaps an existing interval |
| 409 | `EVENT_OUTSIDE_SESSION` | Application activity falls outside its session window |
| 409 | `AGENT_REVOKED` | Device registration was revoked |
| 409 | `AGENT_CLIENT_TYPE_MISMATCH` | Re-registration attempted to change the device's immutable client type |
| 409 | `SESSION_ID_EXISTS` | Offline session UUID is already in use |
| 409 | `SESSION_NOT_CLOSED` | Correction targets a session that is not stopped |
| 409 | `CORRECTION_OVERLAPS_EXISTING_SESSION` | Corrected interval overlaps another recorded work session |
| 409 | `CORRECTION_BEFORE_EXISTING_SESSION` | Corrected interval starts before and overlaps an existing session |
| 409 | `CORRECTION_ALREADY_PENDING` | A pending correction already targets or overlaps this attendance |
| 409 | `CORRECTION_ALREADY_APPROVED` | Rejection was attempted after approval |
| 409 | `CORRECTION_ALREADY_REJECTED` | Approval was attempted after rejection |
| 409 | `CORRECTION_INVALID` | Stored correction data cannot be applied |
| 409 | `ATTENDANCE_EVIDENCE_ALREADY_ATTACHED` | Evidence is already attached to a check-in |
| 409 | `ATTENDANCE_EVIDENCE_NOT_UPLOADED` | Evidence upload has not completed yet |
| 409 | `ATTENDANCE_EVIDENCE_ALREADY_UPLOADED` | Upload authorization requested after the upload succeeded |
| 409 | `ATTENDANCE_EVIDENCE_STORAGE_MISSING` | Uploaded evidence bytes are missing from private storage |
| 409 | `ATTENDANCE_EVIDENCE_STORAGE_MISMATCH` | Stored bytes/signature/size do not match evidence metadata |
| 422 | `INVALID_CORRECTION_INTERVAL` | Correction start/end are missing, equal, or reversed |
| 422 | `INVALID_CORRECTION_BREAKS` | Corrected breaks are outside the session or overlap |
| 422 | `CORRECTION_IN_FUTURE` | Correction includes future timestamps |
| 422 | `WORK_DATE_MISMATCH` | `workDate` does not match the affected session date |
| 422 | `EMPLOYEE_ID_REQUIRED` | Reviewer omitted `employeeId` on a summary request |
| 409 | `SCREENSHOT_POLICY_ACKNOWLEDGEMENT_REQUIRED` | Employee must acknowledge the current disclosure |
| 409 | `INVALID_SCREENSHOT_AGENT` | Employee has no usable non-revoked desktop agent |
| 409 | `NO_ELIGIBLE_SCREENSHOT_SESSION` | No active `ELECTRON` session with a fresh heartbeat |
| 409 | `SCREENSHOT_REQUEST_PENDING` | Employee already has an active screenshot request |
| 409 | `SCREENSHOT_REQUEST_NOT_ACTIVE` | Request is not in a claimable/uploadable state |
| 409 | `SCREENSHOT_REQUEST_EXPIRED` | Request TTL elapsed |
| 409 | `SCREENSHOT_ALREADY_CLAIMED` | Another claim already won |
| 409 | `SCREENSHOT_ALREADY_UPLOADED` | Upload already completed for this claim |
| 409 | `SCREENSHOT_ALREADY_COMPLETED` | Completion already recorded |
| 409 | `SCREENSHOT_UPLOAD_NOT_FOUND` | Completion was attempted before an upload |
| 409 | `SCREENSHOT_SESSION_NOT_ACTIVE` | Linked time session stopped before claim |
| 409 | `SCREENSHOT_REQUEST_NOT_CANCELLABLE` | Request is already terminal |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Idempotency key / `checkInRequestId` was reused with a different payload |
| 410 | `INVITATION_EXPIRED` | Invitation expired |
| 410 | `UPLOAD_AUTHORIZATION_EXPIRED` | Short-lived upload authorization expired |
| 410 | `ATTENDANCE_EVIDENCE_EXPIRED` | Evidence expired before check-in |
| 410 | `ATTENDANCE_UPLOAD_AUTHORIZATION_EXPIRED` | Attendance upload authorization expired |
| 410 | `INVITATION_REVOKED` | Invitation revoked |
| 410 | `INVITATION_ALREADY_USED` | Invitation already accepted |
| 413 | `PAYLOAD_TOO_LARGE` | JSON or screenshot body exceeds limit |
| 413 | `ATTENDANCE_EVIDENCE_TOO_LARGE` | Attendance photo exceeds the configured size limit |
| 415 | `UNSUPPORTED_SCREENSHOT_TYPE` | Upload is not an allowed image content type |
| 415 | `UNSUPPORTED_ATTENDANCE_EVIDENCE_TYPE` | Attendance photo is not an allowed image content type |
| 422 | `VALIDATION_ERROR` | Zod validation failed (with `details`) |
| 422 | `INVALID_SCREENSHOT_FILE` | Empty or invalid image signature |
| 422 | `INVALID_ATTENDANCE_EVIDENCE_FILE` | Empty attendance photo or invalid image signature |
| 422 | `ATTENDANCE_EVIDENCE_CONTENT_TYPE_MISMATCH` | Upload type differs from the type authorized for this evidence |
| 422 | `ATTENDANCE_EVIDENCE_KIND_MISMATCH` | Referenced evidence kind does not match selfie/site-photo slot |
| 422 | `EVIDENCE_CAPTURED_AT_IN_FUTURE` | `capturedAt` is too far in the future |
| 422 | `LOCATION_ACCURACY_TOO_LOW` | Location accuracy exceeds the configured maximum |
| 422 | `LOCATION_FIX_TOO_OLD` | Location timestamp is older than the configured window |
| 422 | `LOCATION_FIX_IN_FUTURE` | Location timestamp is too far in the future |
| 422 | `SCREENSHOT_CONTENT_TYPE_MISMATCH` | Upload type differs from the claimed/expected type |
| 422 | `SCREENSHOT_DISCLOSURE_VERSION_REQUIRED` | Acknowledged disclosure text changed without a new version |
| 429 | `RATE_LIMITED` | Rate limit exceeded |
| 429 | `SCREENSHOT_REQUEST_COOLDOWN` | Per-administrator request cooldown is active |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
| 503 | `SERVICE_UNAVAILABLE` | Generic unavailable condition |

Additional time-tracking errors: `401 AGENT_AUTH_REQUIRED`, `401 AGENT_CREDENTIALS_INVALID`, `403 DEVICE_MISMATCH`, `403 AGENT_REVOKED`, `404 SESSION_NOT_FOUND`, `404 AGENT_NOT_FOUND`, `404 EMPLOYEE_NOT_FOUND`. Offline sync reports per-event conflicts (`EVENT_IN_FUTURE`, `EVENT_TOO_OLD`, etc.) in a `200` response rather than failing the whole batch.
