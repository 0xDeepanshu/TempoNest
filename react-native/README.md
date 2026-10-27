# TempoNest Mobile

Employee time tracking for TempoNest, built with Expo, React Native, TypeScript,
and Expo Router. The app talks to the existing TempoNest Express/PostgreSQL API
and does not run its own backend or database.

## Current scope

Implemented (Stages A–E):

- Mobile email/password sign-in with `client: "mobile"`.
- Secure refresh-token storage, single-flight refresh rotation, session restore,
  session-expired handling, and local-first sign-out.
- Stable installation device ID and `MOBILE` device registration in the existing
  desktop-agent registry. Revoked devices stay revoked.
- Home screen with organization context, a server-authoritative session timer,
  break deduction, pull-to-refresh, focus refresh, foreground recovery, and a
  foreground heartbeat.
- Read-only handling when the active session belongs to another registered
  device.
- WFO check-in with a selfie only; the app never requests location in this mode.
- WFH check-in with no camera, photo, or location request.
- ON_SITE check-in with a selfie and one foreground location fix, captured on a
  single screen.
- Continuous ON_SITE location tracking after check-in, running in the background
  when the OS grants it and falling back to a foreground watcher otherwise.
  Tracking pauses on breaks, resumes after resuming work, and stops at checkout.
- Server-first reconciliation on every start, resume, foreground transition, and
  upload failure; persisted session context is revalidated against the backend
  before a background task may upload anything.
- A bounded, idempotent location queue (500 samples, 50 per batch) backed by
  `AsyncStorage`, so network loss and app restarts do not duplicate or lose
  accepted points.
- Private evidence create → raw upload → reauthorize flow against the existing
  attendance evidence API, including expired upload authorization.
- Idempotent check-in retries with a persisted request ID, plus persisted
  evidence IDs so a network failure does not require recapturing photos.
- Break start/resume and checkout with server state reconciliation instead of
  blind write retries.
- Session recovery after an app restart by refetching the backend's current
  attendance state.

Still outstanding:

- Final launcher/adaptive/splash artwork. The current image assets are still the
  Expo template placeholders; the in-app screens use the TempoNest indigo "T"
  lockup.
- Native Android/iOS device testing (camera, GPS, SecureStore) and a native
  development/production build.
- Interactive end-to-end UI automation. See [Verification performed](#verification-performed).

## Attendance check-in behavior

Work mode is selected on the home screen and confirmed on the check-in screen.

| Mode | Selfie | Site photo | Location | What the app requests |
| --- | --- | --- | --- | --- |
| WFH | No | No | No | Nothing beyond the check-in API. |
| WFO | Yes | No | **Never** | Camera permission only. No GPS permission is requested or sent. |
| ON_SITE | Yes | No (legacy pending records may still replay an existing upload) | Yes: one check-in fix, then continuous tracking for the session | Camera and location. After check-in the app requests background location; if the OS denies or cannot provide it, it tracks only while the app is open and says so. |

The location policy mirrors the backend defaults: accuracy of 500 m or better, a
fix no older than 300 s, and no more than 60 s of clock skew into the future. The
app rejects a bad fix before submitting and asks for a new one.

Check-in safety:

- A pending check-in (request ID, work mode, evidence IDs, location, evidence
  expiry) is stored in `expo-secure-store`, keyed by organization and user.
- Retrying the same payload reuses the same `checkInRequestId`, so a lost
  response cannot create a second session. The backend answers a replay with
  `replayed: true`.
- Changing the payload (for example retaking a photo or refreshing the location)
  generates a new request ID, because the server rejects one ID used for two
  different check-ins.
- If an upload authorization expires, the app calls the documented
  `upload-authorization` endpoint and retries automatically. A 410
  `ATTENDANCE_UPLOAD_AUTHORIZATION_EXPIRED` triggers reauthorization; an
  `ALREADY_UPLOADED` response is treated as success.
- Camera cache files are deleted when replaced, uploaded, or when the screen is
  left. Web captures use in-memory data URIs.
- A replay whose session is already `STOPPED` is not presented as a fresh
  check-in; the app sends the user back to the current server state.
- If the device already has an active session, the app shows the server state
  instead of retrying writes.

Break, resume, and checkout use the existing time-session endpoints. The server
owns all timestamps. On a transport failure or a lifecycle conflict
(`BREAK_ALREADY_ACTIVE`, `NO_ACTIVE_BREAK`, `SESSION_NOT_ACTIVE`,
`SESSION_NOT_FOUND`), the app refetches instead of retrying the write blindly.
The home screen also refetches whenever it regains focus, which restores an
active session after a restart or after returning from the check-in flow.

## On-site location tracking

Tracking is attached to exactly one open `ON_SITE` session. WFH and WFO sessions
never start it, breaks pause it, and checkout, session recovery, sign-out, or
lost device authorization stop it. The server is authoritative: the app calls
`GET .../attendance/location/status` after every start, break end, app foreground
transition, and failed upload, and stops whenever `shouldTrack` is false. A
persisted background context is revalidated against the server before the first
sample upload, so a background task that resumes after an app kill never
continues from stale local state.

Sampling and upload:

- about every 45 seconds or 50 meters of movement, whichever comes first, at
  balanced accuracy;
- samples with unusable accuracy (worse than 500 m), a timestamp more than
  10 minutes old, or a timestamp more than 60 seconds in the future are dropped
  locally;
- uploads are batched up to 50 samples, at most once per minute, with a
  client-generated UUID per sample so retries are idempotent;
- the queue keeps at most 500 samples and is cleared on checkout, sign-out, or a
  terminal server answer (session ended, permission revoked, no longer ON_SITE);
- rejected samples are removed instead of retried forever, because they are
  permanent payload/clock problems rather than transient network failures.

OS behavior:

- **Android** starts a foreground service when background location is granted,
  so the OS shows an ongoing notification. The notification states that location
  is being recorded for the active on-site session; the app never hides it.
- **iOS** requests "Always" location and enables
  `showsBackgroundLocationIndicator` so the OS can show its background indicator.
  iOS may still suspend updates; the server state then becomes `STALE`, and the
  app shows "No recent fix" rather than claiming tracking is active.
- **Web preview** has no background tracking; the status shows "App open only"
  while a foreground watcher is running.
- Doze, battery savers, permission revocation, and OS background limits are
  outside the app's control. The status chip reflects the last server state,
  including `PERMISSION_UNAVAILABLE` and `STALE`, and never upgrades itself
  locally.

The native permissions and background modes are configured in
[`app.json`](app.json) through the `expo-location` plugin
(`isIosBackgroundLocationEnabled`, `isAndroidBackgroundLocationEnabled`,
`isAndroidForegroundServiceEnabled`). Location is requested only for ON_SITE;
the check-in screen reuses the existing permission UI, and the background
permission is requested when tracking starts. Denials leave the app in a
truthful "Blocked"/"App open only" state instead of silently pretending to
track.

## Requirements

- Node.js 24 (the repository currently uses Node 24.18.0).
- npm.
- A development or production build for native targets. Expo Go can exercise the
  foreground flows, but the app's background-location entries in `app.json` are
  applied only to your own native build, so verify continuous background
  tracking with `npx expo run:android` or an EAS development build.
- The TempoNest backend running and reachable from the device.

## Setup

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run web -- --port 5173   # browser preview; 5173 is CORS-allowed by the backend
npm run android              # Expo Go / emulator
npm run ios                  # Expo Go / simulator
```

There is no self-signup. Use an employee account created by an organization.

### API configuration

`EXPO_PUBLIC_API_BASE_URL` must be an absolute URL that includes `/api/v1`
(for example `http://192.168.1.20:4000/api/v1`). Copy `.env.example` to
`.env.local` (gitignored) and uncomment the value you need. Expo inlines this
variable at bundle time, so restart the dev server (preferably with `--clear`)
after changing it. The dev server prints `env: load .env.local` when the file
is picked up.

When the variable is unset, development builds fall back to:

| Target | Default URL |
| --- | --- |
| Android emulator | `http://10.0.2.2:4000/api/v1` |
| iOS simulator | `http://localhost:4000/api/v1` |
| Web preview | `http://localhost:4000/api/v1` |

Production builds have **no default**: the app throws at startup if
`EXPO_PUBLIC_API_BASE_URL` is missing, rather than guessing a production host.

### Networking: emulator vs physical device

- **Android emulator**: `10.0.2.2` is the host machine. Ensure the backend
  listens on port 4000; no extra configuration is required with the default.
- **iOS simulator**: `localhost` resolves to the host machine.
- **Physical device over Wi-Fi**: run `ipconfig` on the computer and use the
  Wi-Fi adapter's IPv4 address, for example
  `EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:4000/api/v1`. Put it in
  `react-native/.env.local` and restart Expo with `--clear`. The phone and
  computer must be on the same network, the backend must listen on `0.0.0.0`
  (not only loopback), and the host firewall must allow the Node.js runtime
  inbound. Confirm from the phone's browser before opening the app:
  `http://<computer-lan-ip>:4000/api/v1/health`.
  If `.env.local` is missing or stale, Android falls back to the emulator-only
  `10.0.2.2` and requests fail with "TempoNest took too long to respond".
- **Physical Android over USB**: run
  `adb reverse tcp:4000 tcp:4000` and set
  `EXPO_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1`.
- **Web preview**: the backend's existing CORS policy must allow the Expo dev
  origin. React Native targets are not affected by browser CORS.

Attendance evidence uploads use a URL returned by the backend. That URL is
derived from the backend's `PUBLIC_BASE_URL` (default
`http://localhost:${PORT}`), so a physical phone must be able to reach it:

- Same Wi-Fi: set the backend environment to
  `PUBLIC_BASE_URL=http://<computer-lan-ip>:4000` and restart the backend. Use
  the same address as `EXPO_PUBLIC_API_BASE_URL`, without `/api/v1`.
- USB with `adb reverse tcp:4000 tcp:4000`: the default
  `PUBLIC_BASE_URL=http://localhost:4000` works, because the phone's own
  `localhost:4000` is forwarded to the computer.

This is a backend configuration item; the mobile app uses the returned URL
unchanged.

### Login troubleshooting

The supplied account signs in successfully against the dev backend
(`POST /api/v1/auth/login` with `client: "mobile"` returns 200). A login error in
the app is therefore almost always a connectivity/configuration problem:

- **Physical Android with no `.env.local`**: the development default is
  `10.0.2.2`, which only works on the Android emulator. Set
  `EXPO_PUBLIC_API_BASE_URL` to the computer's LAN address or use `adb reverse`.
- **Expo web preview**: the backend's existing CORS policy allows only
  `http://localhost:3000` and `http://localhost:5173`. A preview on 8081, 8090,
  or 19006 is blocked by the browser before the request reaches the API. In this
  workspace port 3000 is used by the web app, so use
  `npx expo start --web --port 5173`.
- **Backend reachability**: the API must listen on `0.0.0.0` (not only loopback)
  and the host firewall must allow port 4000.
- **After changing the environment**, restart Expo with `--clear` so the inlined
  `EXPO_PUBLIC_API_BASE_URL` is rebuilt.

## Security and storage

| Data | Storage | Notes |
| --- | --- | --- |
| Access token | In memory | Never written to disk or logs. |
| Refresh token | `expo-secure-store` | Rotated on every refresh; cleared on sign-out and session failure. |
| Mobile agent key | `expo-secure-store` | Keyed per organization and user; never logged or sent outside the agent headers. |
| Pending check-in (request ID, evidence IDs, location, expiry) | `expo-secure-store` | Keyed per organization and user; cleared on success, cancellation, or restart of the flow. |
| Captured photos | App cache | Deleted after upload, replacement, or leaving the check-in screen. Web uses in-memory data URIs. |
| Device ID, selected organization, non-secret agent metadata | `AsyncStorage` | Safe identifiers only. |
| Pending location samples and the active tracking context | `AsyncStorage` | Keyed per organization and user; holds coordinates only while an ON_SITE session is active and is cleared on checkout, sign-out, or terminal failure. |
| Web preview secrets | In-memory map | Intentionally lost on reload; browser storage is never used for secrets. |

Additional behavior:

- Refresh tokens are single-use. Concurrent refreshes share one request so a
  screen refresh cannot redeem the same token twice.
- A network or server error during restore keeps the saved token and shows a
  retry state. Only authentication/refresh failures clear it.
- Agent credentials are always sent with `X-Agent-Id` and `X-Agent-Key`;
  organization-scoped calls carry `X-Organization-Id`.
- Mobile devices register with `clientType: "MOBILE"` and never as `ELECTRON`.
  A revoked device shows an explicit error and is not silently re-created with a
  new identity.
- The timer uses server timestamps and a measured server clock offset. Breaks
  are deducted; an open break is counted up to the current server-adjusted time.
- Heartbeats run every 60 seconds only while the app is in the foreground.
  Returning to the foreground refreshes attendance and heartbeats immediately.
- A failed attendance refresh does not clear an on-screen session.
- Check-in photos are uploaded only to the private TempoNest evidence endpoint
  and are not posted to public image hosting.
- Selfies are attendance evidence, not proof of a live capture or identity
  verification. No facial recognition, face enrollment, or biometric templates
  are used.
- Continuous location tracking runs only for an active ON_SITE session on the
  device that owns it. WFH/WFO, breaks, and the time after checkout collect no
  location. The backend retains precise samples for 30 days by default and
  purges them automatically; history is limited to the employee and roles with
  `attendance:location:read` (`OWNER`/`ADMIN` by default).

## Project layout

```
src/
  api/            typed HTTP, auth, agent, attendance, and upload calls
  app/            Expo Router routes: index, login, home, check-in
  attendance/     server-time math, attendance hook, check-in rules,
                  pending check-in storage, break/checkout actions, the
                  on-site tracking lifecycle hook
  auth/           token manager and auth context
  capture/        camera output normalization and temp-file cleanup
  components/     branded UI primitives
  config/         API base URL resolution
  device/         MOBILE agent registration and hook
  location/       one-shot check-in fix, continuous tracking runtime,
                  background task, sampling rules, and the persisted queue
  storage/        AsyncStorage metadata
  theme/          colors, spacing, typography
```

Key files:

- [`src/api/client.ts`](src/api/client.ts): auth/agent headers, one refresh
  retry, read-only network retry.
- [`src/api/attendance.ts`](src/api/attendance.ts): evidence create/upload/
  reauthorize, check-in, break/resume, checkout, and heartbeat calls.
- [`src/attendance/check-in.ts`](src/attendance/check-in.ts): per-mode payload
  construction, location validation, expiry checks, and failure classification.
- [`src/attendance/pending-check-in.ts`](src/attendance/pending-check-in.ts):
  SecureStore-backed idempotency state.
- [`src/attendance/use-session-actions.ts`](src/attendance/use-session-actions.ts):
  break/resume/checkout with refetch-on-conflict.
- [`src/app/check-in.tsx`](src/app/check-in.tsx): single-screen selfie, location,
  permission, upload, and submission flow.
- [`src/app/home.tsx`](src/app/home.tsx): timer, work-mode selection, and session
  controls.
- [`src/location/foreground-location.ts`](src/location/foreground-location.ts):
  single foreground fix with permission and policy handling for check-in.
- [`src/location/tracking-core.ts`](src/location/tracking-core.ts): sampling
  cadence, queue bounds, sample validation, upload batching, and the truthful
  status presentations.
- [`src/location/on-site-tracking.ts`](src/location/on-site-tracking.ts):
  server reconciliation, permission resolution, background/foreground start,
  pause/resume/stop, and queue flushing.
- [`src/location/tracking-task.ts`](src/location/tracking-task.ts): the
  `TaskManager` entry point that revalidates persisted context after an app
  restart before uploading.
- [`src/location/tracking-store.ts`](src/location/tracking-store.ts):
  `AsyncStorage`-backed queue and tracking-context persistence.
- [`src/attendance/use-on-site-tracking.ts`](src/attendance/use-on-site-tracking.ts):
  keeps the tracker aligned with the session and app-foreground state.
- [`src/capture/temp-files.ts`](src/capture/temp-files.ts): cleanup of captured
  image files.

## Verification performed

Local checks:

- `npm run typecheck` — passed.
- `npm run lint` (`expo lint`) — passed.
- `npm test` — 54 tests across 4 files passed. Coverage includes per-mode payload
  shape (WFO has no location, WFH has no evidence), check-in location accuracy/
  freshness/future validation, pending expiry, check-in failure actions, and the
  tracking core: sample validation, queue bounds/deduplication, upload batching,
  server-result removal, and phase presentation (including stale and permission
  states).
- `npx expo-doctor` — 20/20 checks passed.
- `npx expo export --platform web` with
  `EXPO_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1` — bundle and SSR export
  completed, including the `check-in` and `home` route bundles. A production
  export without the variable fails as designed.
- Expo web dev server on port 5173 (an allowed CORS origin) bundled `/login`,
  `/check-in`, and `/home` without runtime errors, and all three routes returned
  200.

Live backend checks (running API, supplied employee account, new `MOBILE`
verification device; 46/46 checks passed):

- Login, invalid bearer rejection, missing/invalid agent credential rejection.
- WFH check-in: no selfie, no site photo, no location; timer starts `ACTIVE`.
- Replaying the same request ID returns `replayed: true` with the same session.
- Reusing a request ID with a different payload returns
  `IDEMPOTENCY_KEY_REUSED`.
- A second check-in during a fresh active session returns
  `ACTIVE_SESSION_EXISTS`.
- Heartbeat, break start, duplicate-break rejection, break end with a recorded
  closed break, resume-without-break rejection, checkout, second-checkout
  rejection, and empty current state after checkout.
- WFO rejects a location, starts with a selfie, stores no location, and its
  attached evidence cannot be reused.
- Evidence create + raw JPEG upload; an expired 120 s upload authorization
  returns 410, reauthorization succeeds, and the renewed upload succeeds.
- ON_SITE rejects inaccurate, stale, and future locations, then succeeds with a
  selfie and valid location (no site photo required); a site photo from older
  clients is still accepted.
- Session state survives refresh-token rotation and is returned by the current
  attendance endpoint.
- A pre-existing ON_BREAK session with a heartbeat stale by hours (owned by the
  Electron device) was auto-closed at its last heartbeat by the first check-in,
  which is the backend's documented recovery behavior. All test sessions were
  checked out; no active session was left behind.

Test records created in the dev database: three completed check-ins/sessions
(WFH, WFO, ON_SITE), their private evidence rows, and `MOBILE` verification agent
registrations. Nothing was reset or deleted.

Not verified in this environment:

- Live camera capture, camera permission dialogs, real GPS fixes, and location
  permission denial on a physical Android/iOS device.
- Continuous background tracking on a physical device: foreground-service
  notification, iOS background indicator, screen lock, app swipe-kill, Doze/
  battery savers, and permission revocation while a session is active. The
  tracking lifecycle is covered by unit tests and the backend contracts were
  exercised over HTTP, but no physical-device background run was performed here.
- `expo-secure-store` behavior and app-kill recovery on a real device.
- Network loss during an actual phone upload (the equivalent server contracts
  were exercised over HTTP).
- Interactive browser UI automation: the available browser tooling was blocked
  by the environment, so login/home/check-in clicks were not driven
  end-to-end in a browser.
- A native Android/iOS build. No Android SDK/EAS build was run; the export above
  is web-only.

No backend, Electron, or website source files were modified, and no database was
created or reset.

## Testing on a physical Android phone

1. Run `ipconfig` and note the Wi-Fi adapter's IPv4 address. Start the backend
   on port 4000 and make it reachable from the phone. For Wi-Fi, set the backend
   environment `PUBLIC_BASE_URL=http://<computer-lan-ip>:4000` and restart it,
   so evidence upload URLs point at the computer. With USB, run
   `adb reverse tcp:4000 tcp:4000` and keep the default
   `PUBLIC_BASE_URL=http://localhost:4000`.
2. In `react-native/.env.local`, set
   `EXPO_PUBLIC_API_BASE_URL=http://<computer-lan-ip>:4000/api/v1` (or
   `http://localhost:4000/api/v1` with `adb reverse`). Before opening the app,
   load `http://<computer-lan-ip>:4000/api/v1/health` in the phone's browser;
   it must return `{"data":{"status":"ok",...}}`. If it does not, fix the
   network/firewall first — the app will only report a timeout.
3. Run `npx expo start --clear` and open the app. For continuous background
   tracking and the app's own permission strings, use `npx expo run:android`, an
   EAS development build, or a production build. Expo Go can test the foreground
   flows, but it does not apply this app's background-location configuration.
4. Sign in. The home screen should show the work-mode selector.
5. **WFO:** choose “Work from office”, check in, allow the camera, take the
   selfie on the combined screen, then tap **Check in**. Verify that **no
   location permission dialog** appears and the backend check-in has no
   location.
6. **WFH:** choose “Work from home”, check in, and tap **Check in**. The session
   should start with no camera or location permission dialog.
7. **ON_SITE:** choose “On site”, take the selfie, tap “Allow location” (or “Get
   my location”), then tap **Check in**. Site photos are no longer requested.
   After check-in, allow background location when the OS asks. Verify the
   recorded check-in accuracy and location on the backend.
8. **Tracking lifecycle:** leave the app for several minutes and confirm points
   continue arriving (Android shows the ongoing notification; iOS may show its
   background indicator). Start a break and confirm tracking stops and the
   server state becomes `PAUSED`; resume and confirm new points arrive. Check out
   and confirm tracking stops and the server state becomes `STOPPED`. Deny or
   revoke location permission during a session and confirm the app shows
   “Blocked” rather than claiming tracking is active. Force-stop the app and
   confirm it does not resume tracking after a restart unless the server still
   reports an eligible ON_SITE session.
9. Failure drills: deny camera access, deny location access, turn off location
   services, enable airplane mode during upload, leave the app for more than two
   minutes before uploading (to exercise reauthorization), and kill the app after
   capture and reopen it.
10. Session lifecycle: start a break, resume, pull to refresh, kill and reopen the
    app, then check out. Confirm the timer continues from the server timestamp and
    that a second checkout is rejected.
11. Web preview only: use port 3000 or 5173. Other Expo web ports are blocked by
    the backend's current CORS allowlist. Web never runs background tracking.
