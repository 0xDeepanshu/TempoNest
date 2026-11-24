# Live screens for partner integrations

Lets a verified WorkZen **owner** watch an employee's live screen through a partner application (Flowtrium). WorkZen stays the authority for access, monitoring policy, employee eligibility and audit. Nothing in the in-product owner flow changes.

Status: implemented on branch `feature/flowtrium-live-screens`. Not deployed. Verified only by CI once the branch is pushed.

## Switches (all off by default)

| Switch | Effect |
| --- | --- |
| `INTEGRATION_ENABLED` | Existing switch for the whole integration API. |
| `INTEGRATION_LIVE_SCREENS_ENABLED` | Second, independent switch. While `false`, the viewer-link and live-screen routes answer `404 LIVE_SCREENS_DISABLED`, even for a token holding `screens:live`. Revocation routes are never gated. |
| client `allowed_scopes` contains `screens:live` | A client can only ever be granted the scope if this is set on its row, by an operator, deliberately. No client has it. |

## Migration `20261121000100-create-integration-viewer-links.js`

One transaction (PostgreSQL DDL is transactional), so it either applies completely or not at all.

**Adds**
- `integration_viewer_link_requests`: hashed one-time nonce (unique), S256 challenge, browser-binding hash, status PENDING / APPROVED / DENIED / EXPIRED / CONSUMED (CHECK).
- `integration_viewer_links`: verified `workzen_user_id` bound to an `external_user_id`, status ACTIVE / REVOKED (CHECK).
- `screen_live_sessions`: `origin` (NOT NULL, default `WORKZEN`, CHECK in WORKZEN / INTEGRATION), `integration_connection_id`, `integration_viewer_link_id`, `external_organization_id`, `external_user_id`, `indicator_confirmed_at` (all nullable).

**Partial unique indexes** (both `WHERE status = 'ACTIVE'`)
- `(connection_id, external_user_id)`: one active link per external account.
- `(connection_id, workzen_user_id)`: one WorkZen owner cannot be bound to two external accounts.

**Foreign keys and delete rules**

| From | To | On delete |
| --- | --- | --- |
| link, request `connection_id` | `integration_connections` | CASCADE |
| link, request `organization_id` | `organizations` | CASCADE |
| link `workzen_user_id` | `users` | CASCADE |
| request `decided_by_user_id`, link `revoked_by_user_id` | `users` | SET NULL |
| link `request_id` | requests | SET NULL |
| `screen_live_sessions.integration_connection_id`, `integration_viewer_link_id` | connections, links | SET NULL |

Deleting a connection, organization or user removes their links. Past sessions survive, keep `origin = INTEGRATION`, and lose only the pointer. The audit trail keeps the identities in event metadata.

**Compatibility with existing sessions**
- Existing rows read as `origin = 'WORKZEN'`. PostgreSQL 11+ adds a column with a constant default without rewriting the table. The CHECK constraint is validated with one scan of `screen_live_sessions`; the `ALTER TABLE` takes a brief exclusive lock.
- Sessions that are ACTIVE during the migration keep working. The previous backend build keeps working on the new schema (new columns are nullable or defaulted). The new build needs the new schema, so **migrate before deploying the code**.
- Native paths treat any `origin` other than `INTEGRATION` as native. Indicator gating, link checks and the revalidation loop apply only to `INTEGRATION` rows.

**Rollback (`down`)**
- Reverse order in one transaction: constraint, six columns, links table, requests table. The original eleven `screen_live_sessions` columns are untouched.
- Destructive only for integration data: link and request rows are dropped, and any integration session rows lose their origin and would look native. Before rolling back: switch `INTEGRATION_LIVE_SCREENS_ENABLED` off, wait for or terminate integration sessions, and roll the code back first (this branch's models expect the columns).
- CI applies every migration to an empty database, asserts the constraints, indexes, defaults and delete rules above, undoes this migration, checks that exactly six columns and two tables disappeared and the original columns are unchanged, then applies it again.

## Approval link and the one-time exchange

`POST /integration/v1/viewer-links/requests` returns

`/api/v1/integrations/viewer-links/approve?request=<id>#n=<nonce>`

The nonce is in the **fragment**, which browsers never send to a server, so it is absent from access logs, proxies and `Referer`. The page the link opens holds no secret and loads one static script from the same origin. The script reads the fragment, removes it from the address bar and history entry with `history.replaceState`, and `POST`s `request_id` and `nonce` to `/integrations/viewer-links/open` in a request body. That exchange spends the nonce (its stored hash is overwritten), sets the HTTP-only browser-binding cookie and shows the sign-in or approval page. A nonce in a query string is ignored. Opening the link again, or from another browser, fails.

Completion needs the PKCE verifier, so only the party that created the request can finish it.

## Indicator protocol (mandatory)

1. **Capability.** The desktop app sends `X-Agent-Capabilities: live-indicator.v1` on its control-socket upgrade. WorkZen reads it from the live connection (never from the registration, which goes stale when the app updates itself). An integration session cannot start unless the employee's agent is online and advertises it: `409 SCREEN_LIVE_AGENT_OFFLINE` or `SCREEN_LIVE_INDICATOR_UNSUPPORTED`.
2. **Command.** The start command carries `requireIndicator: true`.
3. **Show first.** The app shows an always-on-top banner ("Your screen is being viewed live") and only then opens the stream, with `X-Live-Indicator: v1`. An older app is refused at the stream upgrade (`403`) and the session ends (`INDICATOR_UNAVAILABLE`).
4. **Confirm.** After `live.ready` the app sends `{"type":"live.indicator","state":"visible"}`, then frames. The relay drops every frame of an integration session until that message; three frames before it cut the agent off (close `4003`).
5. **Every frame.** The app checks the banner is visible before each capture and stops if it is not. If the banner disappears it sends `hidden` and stops; the relay ends the session.
6. **Tickets.** No viewer ticket is issued, and no viewer may join, until the session's `indicator_confirmed_at` is set. It is cleared whenever the agent's stream closes, and each new stream starts unconfirmed.

Limit: the confirmation is the desktop app's own statement, authenticated by the device key. WorkZen enforces that it is required and sent, not that the pixels are on screen. A tampered client could lie; the device key, signed releases and the audit record are the controls around that.

## Continuity and the revalidation interval

Every active integration session is re-authorized on a fixed timer, **independent of any API call or socket event**: `SCREEN_LIVE_INTEGRATION_REVALIDATE_SECONDS`, default **10 s**, enforced range **2 to 15 s** (the configuration refuses a larger value). A revocation therefore reaches a running stream within the interval plus one evaluation.

Each pass checks, from durable state: session not expired; link ACTIVE and bound to this connection, organization and owner; connection ACTIVE, client enabled and a live credential holding `screens:live`; the owner is a user with an ACTIVE OWNER membership holding `screenshot:live` in an active organization; monitoring policy enabled for owners; employee monitoring enabled; indicator confirmed within `SCREEN_LIVE_INDICATOR_CONFIRM_TIMEOUT_SECONDS` (default 20). The same evaluation runs when a viewer joins, on every relay revalidation and when the agent attaches its stream.

| Event | Result |
| --- | --- |
| link revoked | session ends, `VIEWER_LINK_REVOKED` |
| owner demoted, suspended, removed, or no longer holds `screenshot:live` | link withdrawn (`IDENTITY_NO_LONGER_ELIGIBLE`), all its sessions end, `VIEWER_LINK_REVOKED` |
| connection disconnected or revoked, client disabled, scope gone | `INTEGRATION_DISCONNECTED` |
| monitoring policy off | `POLICY_DISABLED` |
| viewer stops, or session expires | `VIEWER_STOPPED`, `EXPIRED` |
| indicator hidden or never confirmed | `INDICATOR_UNAVAILABLE` |

A transient database error never ends a healthy session; the next tick retries.

### Link lease

A viewer link is a **lease**. It starts when the link is activated and must be renewed by the partner (`POST /viewer-links/users/:id/renew`) for as long as the partner still vouches for that owner. `SCREEN_LIVE_LINK_LEASE_SECONDS` sets its length (default **45 s**, allowed 15 to 300); a partner should renew at least three times per lease, for example on a 10 to 15 second timer.

- While the lease is valid everything works as described above.
- When it lapses, the next re-authorization pass (within the revalidation interval, at most 15 s) ends every live session started through the link with reason `LINK_LEASE_EXPIRED` and closes the viewer and agent sockets. New sessions, tickets and employee lists are refused with `403 VIEWER_LINK_LEASE_EXPIRED` until a renewal arrives. The link itself is **not** revoked, so a partner that was only unreachable recovers with one renewal; a revoked link cannot be renewed.
- This closes the gap that remained when a partner could not tell WorkZen to stop a stream: the longest a stream can outlive a partner that stopped renewing is **the lease plus one check interval** (default 45 + 10 = 55 s, at most 315 s), instead of the session lifetime (default 15 minutes). A null lease counts as lapsed.

### Feature switch and fail-closed behaviour

- **Switching the feature off ends running streams.** `INTEGRATION_ENABLED` and `INTEGRATION_LIVE_SCREENS_ENABLED` are part of the evaluation above. After a restart with either `false`, the next pass (within the interval) ends every ACTIVE integration session with `FEATURE_DISABLED`, a new agent stream is refused, and the live and link routes answer `404 LIVE_SCREENS_DISABLED`. Revocation and status routes stay available. The process restart itself already drops every open socket; the pass cleans up the database rows.
- **A failing database cannot keep a stream open.** The relay forwards a frame of an integration session only if that session was positively re-authorized within the last three revalidation intervals (30 s by default, 45 s at the 15 s maximum). A failed pass is never read as permission and never ends a healthy session by itself, but if no pass succeeds within the window (database unreachable, loop not running) frames are dropped, the relay closes viewer and agent sockets (`VERIFICATION_UNAVAILABLE`), and it retries ending the session until the database accepts it. The hard upper bound on streaming without verification is therefore the window, not the 15-minute session lifetime.
- The verification state is in memory, per process, like the relay itself.

## Endpoints (`/api/v1/integration/v1`, integration token with `screens:live`)

Every call below names the Flowtrium user in `externalUserId`; WorkZen resolves the verified owner behind it again each time.

| Method and path | Body or query | Result |
| --- | --- | --- |
| `POST /viewer-links/requests` | `externalUserId`, `externalUserLabel`, `externalOrganizationLabel`, `codeChallenge` | `201 {requestId, approvalUrl, expiresAt}` |
| `POST /viewer-links/requests/:id/complete` | `codeVerifier` | `200` link |
| `GET /viewer-links/users/:externalUserId` | | `{linked, link}` (never gated) |
| `DELETE /viewer-links/users/:externalUserId` | | `{revoked}` (never gated) |
| `POST /viewer-links/users/:externalUserId/renew` | `{}` | `200 {leaseExpiresAt, leaseSeconds}`. Extends the link lease. `403 VIEWER_LINK_REQUIRED` for an unknown or revoked link; an owner who is no longer eligible has the link withdrawn instead. Not rate limited. |
| `GET /screen-live/employees?externalUserId=` | | mapped employees with `availability`: `AVAILABLE`, `NOT_TRACKING`, `MONITORING_DISABLED`, `AGENT_OFFLINE`, `APP_UPDATE_REQUIRED` |
| `POST /screen-live/sessions` | `externalUserId`, `externalEmployeeId` | `201 {session, reused, delivery}`; `session.indicator.confirmed` is false until the agent confirms |
| `GET /screen-live/sessions/:id?externalUserId=` | | session state (poll `indicator.confirmed`) |
| `POST /screen-live/sessions/:id/viewer-tickets` | `externalUserId` | `201 {ticket, expiresAt, websocketPath, viewerId}`; `409 SCREEN_LIVE_INDICATOR_NOT_CONFIRMED` until confirmed |
| `POST /screen-live/sessions/:id/stop` | `externalUserId` | `200 {session, stopped}` |

Employees are named only by `externalEmployeeId` through an ACTIVE mapping in the token's own connection and organization. A session is visible only to the link that started it; everything else reads `404`.

The browser receives only the ticket (about 60 s, single use) and the WebSocket path `/api/v1/ws/screen-live`; it sends `{"type":"authenticate","ticket":"..."}` as its first message. The relay's Origin allowlist (`CORS_ORIGINS`) must include the partner's browser origin. That is a deployment setting and is not changed here.

## Audit

`INTEGRATION_VIEWER_LINK_REQUESTED / APPROVED / DENIED / ACTIVATED / REVOKED / REFUSED`, `SCREEN_LIVE_SESSION_STARTED` (origin, verified owner, link, connection, client, Flowtrium organization and user), `SCREEN_LIVE_TICKET_ISSUED`, `SCREEN_LIVE_INDICATOR_CONFIRMED / HIDDEN`, `SCREEN_LIVE_VIEWER_JOINED / LEFT`, `SCREEN_LIVE_SESSION_STOPPED` (reason), `SCREEN_LIVE_ACCESS_DENIED` (reason, external user). The actor of every viewing event is the verified WorkZen owner. IP and user agent are recorded where the request carries them.
