# TempoNest Web Portal

The TempoNest employee and admin portal: a Next.js App Router front end for the
TempoNest Express API. It covers authentication and sessions, personal
attendance and corrections, team reporting, correction review, and organization
and membership management.

The portal is **read-only for time tracking**. Sessions, breaks, and heartbeats
are started and stopped by the TempoNest desktop agent with agent credentials.
The browser never receives database access, agent credentials, or backend
secrets.

## Stack

- Next.js 16 (App Router, Proxy, Route Handlers) and React 19
- TypeScript and Tailwind CSS 4
- Vitest, React Testing Library, and jsdom

## Requirements

- Node.js 20.9 or newer (Node 24 recommended)
- The TempoNest backend running locally, by default at `http://localhost:4000`

## Setup

```bash
npm install
cp .env.example .env.local        # Windows: copy .env.example .env.local
npm run dev
```

Open <http://localhost:3000>.

The only environment variable the frontend needs is the server-side backend
base URL:

```dotenv
BACKEND_API_URL=http://localhost:4000
```

`.env.example` contains no secrets. `.env*` files are git-ignored; the example
file is explicitly re-included.

### Local run commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js dev server on port 3000 |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm run lint` | Run ESLint (Next.js core-web-vitals + TypeScript) |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run build` | Create a production build |
| `npm start` | Serve the production build |

Start the backend separately from its own repository. Both services must be
running for the portal to load data.

## Architecture

### Same-origin BFF

All browser API calls use same-origin paths (`/api/v1/...`). A Next.js Route
Handler at `src/app/api/v1/[...path]/route.ts` proxies them to
`BACKEND_API_URL/api/v1/...`.

- Cookies are forwarded in both directions. `Set-Cookie` is re-emitted so the
  HttpOnly session cookies are owned by the portal origin.
- `X-CSRF-Token`, `Authorization`, `X-Organization-Id`, idempotency keys, and
  relevant rate-limit/request headers are forwarded.
- Responses are always `cache-control: no-store`.
- A backend outage becomes a structured `502 BACKEND_UNAVAILABLE` response.

The browser's `apiRequest` helper (`src/lib/api-client.ts`) reads the CSRF
cookie for unsafe methods and maps backend error envelopes to `ApiError`
instances.

### Cookie and refresh handling

The backend scopes `tn_refresh` to `/api/v1/auth`. Because the portal is a
same-origin BFF, auth cookies (`tn_access`, `tn_refresh`, `tn_csrf`) are
rewritten to `Path=/` as they pass through the proxy. This keeps refresh working
for ordinary portal requests while the cookies remain HttpOnly.

The BFF also writes a short-lived, HttpOnly `tn_access_exp` hint containing the
access-token expiry. `src/proxy.ts` uses that hint to refresh before rendering an
authenticated page. If a session was created outside the portal and no hint
exists, the proxy probes `/auth/me` once and then sets a conservative hint.

Refresh tokens rotate, and replaying a rotated token revokes the whole session
family. Refreshes therefore go through `refreshOnce`
(`src/lib/refresh.ts`), an in-process single-flight keyed by refresh token, in
both the BFF and the page proxy. A failed refresh clears every auth cookie and
redirects to `/login`; a transient backend failure does not destroy a session.

### Server session and route guards

- `src/lib/server-session.ts` reads `GET /auth/me` on the server with
  request cookies and React `cache()`.
- `/login` and `/register` are public. The `(app)` route group requires a
  session server-side and redirects to `/login` otherwise.
- `src/proxy.ts` performs the optimistic cookie/expiry check and refresh
  before page rendering.
- Client-side permission gates are UX only. The backend remains authoritative
  for every read and write.

### Organizations and roles

`GET /auth/me` returns all memberships. The selected organization is stored in
`localStorage` (`temponest.organization`) and read through
`useSyncExternalStore` so hydration stays deterministic. Users with no active
membership can create an organization.

`src/lib/permissions.ts` mirrors the backend role matrix for navigation and
control visibility (`OWNER`, `ADMIN`, `MANAGER`, `EMPLOYEE`). It also mirrors
member-management rules: nobody can manage themselves, admins cannot manage
peers or owners, and only owners can assign the owner role.

Precise location history for another employee is guarded by the dedicated
`attendance:location:read` permission. It belongs to `OWNER` and `ADMIN` only
and is **not** implied by `report:read`, so `MANAGER` and `EMPLOYEE` do not
inherit it. The backend enforces the same rule independently of this UI.

## Screens

| Route | Access | Purpose |
| --- | --- | --- |
| `/login` | Public | Cookie session login with safe `next` redirects |
| `/register` | Public | Account creation and auto-login |
| `/invitations/accept` | Public | Invitation preview and acceptance |
| `/dashboard` | Any member | Current session, today/period totals, recent sessions, corrections |
| `/attendance` | Any member | Daily/weekly/monthly summaries, sessions and breaks; correction entry point |
| `/corrections` | Any member | Correction request form and personal request history |
| `/admin` | `report:read` | Live tracking state, today's sessions, review queue |
| `/admin/employees` | `member:read` | Member directory and employee detail |
| `/admin/employees/[employeeId]` | `member:read` | Employee status, daily totals, sessions, corrections; links to reports |
| `/admin/reports` | `report:read` | Session, daily-total, and application-usage reports; supports `?employeeId=` prefill |
| `/admin/attendance` | `report:read` | Attendance evidence detail; ON_SITE records also show location history for `attendance:location:read` roles |
| `/admin/corrections` | `correction:review` | Approve/reject queue with filters and self-review protection |
| `/admin/organization` | `organization:read` | Settings, members, roles, suspensions, removals, invitations |

Correction requests use organization-local wall times converted to ISO
timestamps with offsets. The form validates future timestamps, break ordering,
break containment, and overlap before submitting; server validation errors are
mapped back onto fields. Requests are never self-reviewed in the UI.

## Location history

The attendance evidence detail view (`/admin/attendance`, requires
`report:read`) adds a compact **Location history** section to ON_SITE records.
The section itself is gated by `attendance:location:read`: it is rendered only
for `OWNER`/`ADMIN` by default, and the backend enforces the same permission and
organization isolation on the history endpoint.

The section fetches
`GET /organizations/:organizationId/attendance/check-ins/:checkInId/location-history`
and shows:

- the server-derived state (active, paused on break, stopped, permission
  unavailable, stale), last report/sample times, and GPS accuracy;
- session and check-in context, including the sampling cadence;
- a Leaflet map using OpenStreetMap tiles containing only server-returned
  points. Contiguous runs are drawn as segments; gaps are never bridged or
  invented. With no samples the map is not fabricated — the check-in coordinate
  is shown when present, otherwise an explicit empty message is displayed;
- a chronological timeline (check-in, break start/end, checkout, gaps) and the
  latest ten points;
- the configured retention window and a data-sharing notice.

Admin views write `ATTENDANCE_LOCATION_HISTORY_VIEWED` server-side; audit
metadata contains counts only, never coordinates. Employee self-access remains
available through the API for every role and is not treated as an administrator
view.

The shared Leaflet/OSM configuration lives in `src/lib/map-tiles.ts` (tile URL,
attribution). No map API key is needed. Coordinates are sent to
`tile.openstreetmap.org` to render tiles; deployments that cannot share data with
the public OSM tile service must point `MAP_TILE_URL` at their own tile endpoint
and keep the attribution. Leaflet CSS is loaded with the component, and the map
is rendered on the client only.

## Backend contracts

Only routes and response shapes documented in the backend's `docs/API.md` are
used. Notable behaviors reflected in the UI:

- Attendance summaries require `from`, `to`, and `period=daily|weekly|monthly`.
- Report limits: sessions 366 days, daily totals 92 days, application usage 31
  days, application timeline 7 days.
- Approving a correction accepts an optional `{ note }`; rejecting requires
  `{ reason, note? }`; self-review returns `403 SELF_REVIEW_FORBIDDEN`.
- Organization updates accept `{ name?, timezone? }`; invitations return the
  token once at creation time.
- Registration does not create a session, so the portal signs in after a
  successful registration.

## Testing

The Vitest suite covers:

- Role permissions and member-management rules, including
  `attendance:location:read` being limited to `OWNER`/`ADMIN`
- Duration/date formatting and timezone/DST conversion
- API error parsing and field-error normalization
- Cookie parsing, path rewriting, hints, and refresh cookie merging
- Status badges
- Correction review rendering, self-review blocking, and the exact approve/reject
  request payloads (with API calls mocked)
- Location history helpers: invalid-sample filtering, chronological ordering,
  map segmentation at gaps, break overlays, timeline markers, and
  state/permission labels
- Location history UI: authorized rendering, honest empty/missing data, error
  retry, manager/employee hidden state with no request, non-ON_SITE records not
  requesting history, and Leaflet map plotting/cleanup/fallback

The current suite is 157 tests across 26 files. `npm run typecheck`, `npm run
lint`, and `npm run build` also pass. No browser-based end-to-end run against a
seeded backend was performed for this step; the map and section behavior is
covered by the jsdom/component tests.

Run:

```bash
npm test
```

## Integration gaps

These are deliberate non-features or missing backend affordances rather than
mock implementations:

- **No browser tracking controls.** Start, stop, break, heartbeat, and sync
  require desktop-agent credentials, so the portal does not expose them.
- **No screenshot UI.** The backend documents screenshot request/lifecycle and
  policy APIs, but there is no capture client in this portal, so no screenshot
  screens are shown.
- **No desktop-agent management UI**, despite `agent:read`/`agent:revoke`
  permissions.
- **No auth-session management UI** for listing or revoking other sessions.
- **Application timeline** is available from the backend but only aggregated
  application usage is displayed.
- **No single-membership endpoint.** The employee detail screen pages through
  the member list (up to 100 at a time) to find one user. This is acceptable for
  modest organizations but is not ideal at large scale.
- Directory and filter selects request the first 100 active members; larger
  organizations need backend search or server-driven pagination for selects.
