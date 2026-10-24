# TempoNest

TempoNest is an enterprise-grade employee time tracking, attendance management, and workplace visibility platform. It is engineered with a strict security-first mindset, server-authoritative timestamps, transparent employee monitoring disclosures, and resilient offline synchronization.

---

## Monorepo Architecture

This repository organizes the entire TempoNest ecosystem into three focused applications:

```text
TempoNest/
├── backend/          # Express.js, TypeScript, PostgreSQL REST API & WebSockets
├── electron/         # Electron + React desktop time tracking agent
├── web/              # Next.js 16 App Router employee and administrative portal
├── .gitignore        # Monorepo-wide ignore rules
└── README.md         # Monorepo documentation
```

### Component Breakdown

| Project | Path | Stack | Role |
| :--- | :--- | :--- | :--- |
| **Backend API** | [`backend/`](backend/) | Node.js, Express 4, TypeScript 5, PostgreSQL, Sequelize 6, Vitest | The authoritative core. Handles authentication, organizations, memberships, server-timestamped work sessions, device agent WebSockets, offline reconciliation ledger, attendance corrections, and secure screenshot lifecycle storage. |
| **Desktop Agent** | [`electron/`](electron/) | Electron 45, React 19, Vite, Tailwind CSS 4, TypeScript | Focused employee desktop tracker. Communicates with the backend using secure desktop tokens, registers agent device keys in OS `safeStorage`, manages live heartbeats over WebSockets, caches timers with crash recovery, captures administrator-initiated screenshots, and queues offline sync events. |
| **Web Portal** | [`web/`](web/) | Next.js 16 (App Router), React 19, Tailwind CSS 4, Vitest | Management and employee web portal. Implements a same-origin BFF (Backend-for-Frontend) proxy with HttpOnly cookie forwarding, personal attendance dashboards, time correction submission/reviews, team live tracking, admin reporting, and screenshot policy configuration. |

---

## Core Capabilities

1. **Server-Authoritative Time Tracking**
   - Work sessions, breaks, and heartbeats are stamped by the server. Client-provided durations are never trusted.
   - Prevents concurrent active sessions per employee and per device with database-level constraints and atomic transactions.
   - Recovers crashed or disconnected sessions cleanly at the last validated heartbeat.

2. **Secure Device Agents & Presence WebSockets**
   - Desktop installations register as distinct agents with 256-bit keys stored in OS-protected vaults (`safeStorage`).
   - Authenticated WebSocket connection (`/api/v1/ws/agent`) maintains real-time presence and pushes commands.
   - Revocation instantly disconnects agents and stops active sessions.

3. **Durable Offline Event Sync**
   - Network interruptions do not lose tracked work. Offline mutations are buffered into a durable queue.
   - Batched synchronization through `/time-sessions/sync` resolves with an immutable idempotency ledger (`applied`, `duplicate`, `conflict`).

4. **Transparent, Admin-Initiated Screenshots**
   - Individual, administrator-initiated captures only during active work sessions.
   - Strictly opt-in per organization with mandatory disclosure text and employee acknowledgement.
   - Storage uses short-lived, HMAC-signed upload/download URLs backed by private local storage or S3 buckets.

5. **Attendance Summaries & Correction Workflow**
   - Daily, weekly, and monthly attendance rollups bounded by organization timezones.
   - Employees submit correction requests for missed or modified sessions.
   - Managers/admins review with atomic overlap validation and full audit logging.

6. **Hierarchical RBAC & Security Infrastructure**
   - Strictly enforced role matrix: `OWNER`, `ADMIN`, `MANAGER`, and `EMPLOYEE`.
   - Argon2id password hashing, opaque server-side session tokens with HMAC peppers, CSRF protection, and rate limiting.

---

## Quick Start Guide

### Prerequisites

- **Node.js**: `v22.12.0` or newer (Node 24 recommended)
- **PostgreSQL**: `v13` or newer
- **Git**

---

### 1. Backend Service Setup

```bash
cd backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env

# Edit .env with your PostgreSQL credentials and generate a secure pepper:
# node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# Run database migrations
npm run db:create
npm run db:migrate

# Start in development mode (listens on http://localhost:4000)
npm run dev
```

Verify backend health:
```bash
curl http://localhost:4000/api/v1/health
curl http://localhost:4000/api/v1/health/ready
```

---

### 2. Next.js Web Portal Setup

```bash
cd web

# Install dependencies
npm install

# Configure environment
cp .env.example .env.local

# Start web portal in dev mode (opens on http://localhost:3000)
npm run dev
```

The web portal acts as a same-origin BFF forwarding requests from `http://localhost:3000/api/v1/...` to `BACKEND_API_URL` (`http://localhost:4000`).

---

### 3. Electron Desktop Tracker Setup

```bash
cd electron

# Install dependencies
npm install

# Start desktop app in dev mode with live reload
npm run dev
```

The desktop app connects to the running backend at `http://localhost:4000/api/v1` (configured via `TEMPO_API_BASE_URL` in the main process).

---

## Scripts & Commands Reference

### Backend (`backend/`)

| Command | Purpose |
| :--- | :--- |
| `npm run dev` | Start backend dev server with `tsx watch` |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Run `tsc --noEmit` validation |
| `npm test` | Run full test suite with Vitest (in-memory SQLite) |
| `npm run db:migrate` | Execute pending database migrations |
| `npm run db:migrate:undo` | Roll back the most recent migration |
| `npm run db:reset` | Reset and re-apply all migrations |
| `npm run smoke` | Run smoke check against migrated database |

### Electron Desktop (`electron/`)

| Command | Purpose |
| :--- | :--- |
| `npm run dev` | Start Electron with hot-reloading renderer |
| `npm run build` | Type-check and compile bundles into `out/` |
| `npm run typecheck` | Type-check main, preload, and renderer TypeScript |
| `npm test` | Run unit tests with Vitest |
| `npm run test:backend` | Run real backend integration suite |
| `npm run package` | Package Windows NSIS installer |
| `npm run package:dir` | Package unpacked application directory |

### Web Portal (`web/`)

| Command | Purpose |
| :--- | :--- |
| `npm run dev` | Start Next.js development server on port 3000 |
| `npm run build` | Build production Next.js output |
| `npm run start` | Serve production Next.js build |
| `npm run typecheck` | Type-check TypeScript files |
| `npm run lint` | Run ESLint checks |
| `npm test` | Run component and unit tests with Vitest |

---

## Security & Secrets Policy

- **No Secrets in Source Control**: Production secrets, database credentials, token peppers, and private keys must never be committed. All sensitive keys are excluded via `.gitignore`.
- **Environment Isolation**: Default placeholders and schema documentation are maintained in `.env.example` in `backend/` and `web/`.
- **Protected Storage**: Desktop tokens and agent keys are kept in OS keychain storage (`safeStorage`) in the Electron main process and are never exposed to the browser renderer.
- **Audit Trails**: All policy modifications, attendance adjustments, and screenshot operations are written to append-only audit event tables.

---

## License

Private and proprietary. All rights reserved.
