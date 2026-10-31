# WorkZen / TempoNest — Production Deployment Guide

This guide describes the exact commands to run **manually** on the Hostinger Ubuntu VPS.
Nothing in this repository has been deployed, and no production database has been
touched. The local development database is not copied or restored anywhere.

The repository contains four independent applications:

| App | Runs on | Notes |
| --- | --- | --- |
| `backend` | VPS | Express API + WebSocket servers, port 4100 |
| `web` | VPS | Next.js portal, port 3002 |
| `electron` | Build on your workstation | Desktop agent installer |
| `react-native` | Build with EAS/Expo | Mobile app |

Replace every placeholder before use:

- `app.workzen.cloud` → portal hostname (DNS already points to this VPS)
- `api.workzen.cloud` → API hostname (DNS already points to this VPS)
- `<YOUR_REPO_URL>` → your Git remote
- `<REVIEWED_COMMIT_SHA>` → the full 40-character commit you reviewed
- `CHANGE_ME...` → real secrets, generated on the server

Never commit a filled `.env` or `.env.production`.

---

## 0. Prerequisites and existing services

This VPS already runs:

- Ubuntu 26.04.1
- Node.js 22.23.2
- PostgreSQL 18, listening on `localhost:5432`
- Nginx and PM2
- MagicFrame on port 3000
- Flowtrium frontend on port 3001
- Flowtrium backend on port 4000

WorkZen is added alongside them and must not modify, restart, or stop those services:

- WorkZen API: `127.0.0.1:4100` (systemd)
- WorkZen web: `127.0.0.1:3002` (systemd)
- DNS for `app.workzen.cloud` and `api.workzen.cloud` already resolves to this VPS

Do not touch PM2 processes or existing Nginx site files. Do not run a blanket system
upgrade. PostgreSQL, API, and web ports stay private; only 80/443 are public.

If the VPS has less than 2 GB RAM, add swap (Next.js builds are memory-hungry):

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 1. Install only the required tooling

Node.js 22.23.2, Nginx, and PostgreSQL 18 are already installed. Do not upgrade,
restart, or reconfigure them. Install only what the deployment steps need:

```bash
sudo apt update
sudo apt install -y git rsync certbot python3-certbot-nginx
```

Verify the existing runtime instead of reinstalling it:

```bash
node -v          # expect v22.23.2
npm -v
psql --version   # expect 18.x
systemctl is-active nginx postgresql
```

## 2. Create the service user and private storage

```bash
sudo adduser --system --group --home /var/lib/workzen --shell /usr/sbin/nologin workzen
sudo mkdir -p /opt/workzen /var/lib/workzen/storage/screenshots
sudo chown -R workzen:workzen /opt/workzen /var/lib/workzen
sudo chmod 750 /var/lib/workzen /var/lib/workzen/storage
sudo chmod 700 /var/lib/workzen/storage/screenshots
```

Screenshots and attendance evidence are written only under
`/var/lib/workzen/storage/screenshots`. Never add an Nginx `alias`/`root` for that
directory: files are served exclusively through signed, short-lived API URLs.

## 3. Create the fresh production database

Use a fresh database; do not restore the local development dump. PostgreSQL is already
running, so only verify it and create the database and role:

```bash
systemctl is-active postgresql
sudo -u postgres createuser --login --pwprompt workzen_app
sudo -u postgres createdb --owner=workzen_app --encoding=UTF8 --template=template0 workzen
```

`createuser --pwprompt` asks for the password interactively, so it never enters shell
history. Use a long random password, for example from `openssl rand -base64 32`.

Create `pgcrypto` explicitly as the PostgreSQL administrator **before** running any
migration:

```bash
sudo -u postgres psql -d workzen -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'
```

The first migration also uses `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`, so
pre-creating it is safe. Verify the database, login, and extension:

```bash
psql -h 127.0.0.1 -U workzen_app -d workzen -W -c 'select current_database(), current_user;'
sudo -u postgres psql -d workzen -c 'select extname from pg_extension;'
```

PostgreSQL listens on `localhost:5432`. Do not add a UFW rule for 5432 and do not change
`pg_hba.conf`.

## 4. Put the code on the server

Create a read-only deploy key for the `workzen` user and add it to your Git host:

```bash
sudo -u workzen mkdir -p /var/lib/workzen/.ssh
sudo -u workzen ssh-keygen -t ed25519 -N '' -f /var/lib/workzen/.ssh/id_ed25519
sudo -u workzen cat /var/lib/workzen/.ssh/id_ed25519.pub
```

Then clone and explicitly check out the reviewed commit. Cloning alone deploys whatever
the remote default branch points at, which is not necessarily what you reviewed:

```bash
sudo -u workzen git clone <YOUR_REPO_URL> /opt/workzen/app
sudo -u workzen git -C /opt/workzen/app checkout <REVIEWED_COMMIT_SHA>
sudo -u workzen git -C /opt/workzen/app rev-parse HEAD
sudo -u workzen git -C /opt/workzen/app log -1 --oneline
```

`rev-parse HEAD` must print exactly the `<REVIEWED_COMMIT_SHA>` you intended to deploy.
Stop and investigate if it does not.

The rest of this guide uses:

- API: `/opt/workzen/app/backend`
- Web: `/opt/workzen/app/web`
- Storage: `/var/lib/workzen/storage/screenshots`

## 5. Backend configuration, build, and migrations

Copy the production example and edit it:

```bash
cd /opt/workzen/app/backend
sudo cp .env.production.example .env
sudo nano .env
sudo chown workzen:workzen .env
sudo chmod 600 .env
```

Fill at least:

- `PORT=4100`
- `DATABASE_URL=postgresql://workzen_app:<URL-ENCODED-PASSWORD>@127.0.0.1:5432/workzen`
  (or set `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` explicitly)
- `TOKEN_PEPPER=$(openssl rand -base64 48)`
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`
- `WEB_APP_URL=https://app.workzen.cloud`
- `CORS_ORIGINS=https://app.workzen.cloud`
- `PUBLIC_BASE_URL=https://api.workzen.cloud` (no `/api/v1`, no trailing slash)
- `SCREENSHOT_LOCAL_DIR=/var/lib/workzen/storage/screenshots`

Port 4100 avoids the Flowtrium backend already running on 4000.

Production boot hard-fails on:

- missing `DATABASE_URL`/`DB_NAME`/`DB_PASSWORD`
- `TOKEN_PEPPER` shorter than 32 characters
- `COOKIE_SECURE=false`
- missing `SMTP_HOST` while `MAIL_TRANSPORT=smtp`
- missing `PUBLIC_BASE_URL` while `SCREENSHOT_STORAGE_DRIVER=local`

Build and run the migrations:

```bash
cd /opt/workzen/app/backend
sudo -u workzen npm ci
sudo -u workzen npm run build
sudo -u workzen env NODE_ENV=production npm run db:migrate
sudo -u workzen env NODE_ENV=production npm run db:migrate:status
```

Expect 37 applied migrations. Migrations are **not** wrapped in transactions. If one
fails, stop, inspect the error and the `SequelizeMeta` table, take a backup, and do not
blindly rerun. Do not run `npm run smoke` — it creates development records.

Install the API service:

```bash
sudo tee /etc/systemd/system/workzen-api.service > /dev/null <<'EOF'
[Unit]
Description=WorkZen API
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=workzen
Group=workzen
WorkingDirectory=/opt/workzen/app/backend
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/workzen/app/backend/dist/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/workzen
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now workzen-api
sudo systemctl status workzen-api --no-pager
sudo journalctl -u workzen-api -n 100 --no-pager
curl -fsS http://127.0.0.1:4100/api/v1/health
```

The app loads `.env` itself; the unit intentionally does not use `EnvironmentFile` so
values containing spaces (`MAIL_FROM`) are parsed by dotenv, not systemd.

## 6. Web configuration and build

```bash
cd /opt/workzen/app/web
sudo cp .env.production.example .env.production
sudo nano .env.production
sudo chown workzen:workzen .env.production
sudo chmod 600 .env.production
```

Set:

```dotenv
BACKEND_API_URL=https://api.workzen.cloud
NEXT_PUBLIC_API_WS_URL=wss://api.workzen.cloud
```

`NEXT_PUBLIC_API_WS_URL` is baked into the browser bundle at build time. Rebuild the web
app after changing it. `BACKEND_API_URL` is read by the server-side BFF at runtime.

```bash
cd /opt/workzen/app/web
sudo -u workzen npm ci
sudo -u workzen npm run build
```

If the build runs out of memory, add swap (section 0) or run:
`sudo -u workzen env NODE_OPTIONS=--max-old-space-size=2048 npm run build`.

Install the web service:

```bash
sudo tee /etc/systemd/system/workzen-web.service > /dev/null <<'EOF'
[Unit]
Description=WorkZen Web
After=network-online.target workzen-api.service
Wants=network-online.target

[Service]
Type=simple
User=workzen
Group=workzen
WorkingDirectory=/opt/workzen/app/web
Environment=NODE_ENV=production
EnvironmentFile=/opt/workzen/app/web/.env.production
ExecStart=/opt/workzen/app/web/node_modules/.bin/next start -H 127.0.0.1 -p 3002
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/workzen/app/web/.next
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now workzen-web
sudo systemctl status workzen-web --no-pager
curl -fsSI http://127.0.0.1:3002/login
```

## 7. Nginx reverse proxy and TLS

Add a new WorkZen site file only. Do **not** delete
`/etc/nginx/sites-enabled/default`, edit existing site files, or stop Nginx: MagicFrame
and Flowtrium are served by the existing configuration and must remain untouched.

```bash
sudo tee /etc/nginx/conf.d/workzen.conf > /dev/null <<'EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

upstream workzen_api {
    server 127.0.0.1:4100;
    keepalive 32;
}

upstream workzen_web {
    server 127.0.0.1:3002;
    keepalive 32;
}

server {
    listen 80;
    server_name app.workzen.cloud;

    location / {
        proxy_pass http://workzen_web;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Connection "";
    }
}

server {
    listen 80;
    server_name api.workzen.cloud;
    client_max_body_size 12m;

    location / {
        proxy_pass http://workzen_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Connection "";
        proxy_read_timeout 120s;
    }

    location /api/v1/ws/ {
        proxy_pass http://workzen_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
EOF

sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d app.workzen.cloud -d api.workzen.cloud
```

`client_max_body_size 12m` is required: screenshots and attendance evidence can be up to
10 MiB. The `/api/v1/ws/` location covers `/api/v1/ws/agent`,
`/api/v1/ws/screen-live`, and `/api/v1/ws/screen-stream`. Certbot edits only the new
`app.workzen.cloud` and `api.workzen.cloud` server blocks and reloads Nginx; it does not
restart PM2 or the existing applications.

Firewall: expose only SSH, HTTP, and HTTPS. Do not open PostgreSQL (5432), WorkZen API
(4100), WorkZen web (3002), or the existing application ports. If UFW is already
enabled, keep its existing rules and only add what is missing; never remove rules that
protect the other hosted applications.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status numbered
```

The backend currently has no `HOST` setting and calls `app.listen(config.port)`, so it
binds `0.0.0.0:4100` rather than `127.0.0.1`. No application change was made for this;
the firewall plus Nginx is the isolation boundary. Confirm listeners after starting the
services:

```bash
sudo ss -ltnp | grep -E ':(3000|3001|3002|4000|4100)\b'
```

The web app binds `127.0.0.1:3002`; the API is reachable on `127.0.0.1:4100` and must
not be reachable through the public interface.

## 8. First organization and administrator

There are no seeders. The safe bootstrap is the normal application flow:

1. Open `https://app.workzen.cloud/register` and register the first account.
2. Sign in at `https://app.workzen.cloud/login`.
3. Open `https://app.workzen.cloud/admin/organization`.
   A user without a membership sees **Create your organization**. Submitting it creates
   the organization and an `OWNER` membership atomically for the signed-in account.
4. Invite employees from the organization/employee screens. Invitations are delivered
   by SMTP and the invitee registers/accepts through the link.

Optional platform superadmin (the account must already exist):

```bash
cd /opt/workzen/app/backend
sudo -u workzen env NODE_ENV=production npm run platform:grant -- admin@workzen.cloud
```

`platform:grant` runs through `tsx` from devDependencies. Keep the full `npm ci` install
(or run the script before pruning dev dependencies). It is never exposed over HTTP.

## 9. Post-deploy verification

```bash
curl -fsS http://127.0.0.1:4100/api/v1/health
curl -fsSI http://127.0.0.1:3002/login

curl -fsS https://api.workzen.cloud/api/v1/health
curl -fsS https://api.workzen.cloud/api/v1/health/ready
curl -fsSI https://app.workzen.cloud/login

sudo -u postgres psql -d workzen -c 'select count(*) as migrations from "SequelizeMeta";'
sudo -u postgres psql -d workzen -Atc "select count(*) from information_schema.tables where table_schema = 'public';"
sudo -u postgres psql -d workzen -c '\dx'
sudo -u postgres psql -d workzen -Atc 'select count(distinct enumtypid) from pg_enum;'

ls -ld /var/lib/workzen/storage/screenshots
sudo ss -ltnp | grep -E ':(3000|3001|3002|4000|4100)\b'
systemctl --no-pager --failed
journalctl -u workzen-api -u workzen-web --since '15 min ago' --no-pager
```

Expected: 37 migration rows, 37 tables (36 application tables + `SequelizeMeta`),
`pgcrypto` installed, storage directory `drwx------ workzen workzen`, no failed units.

WebSocket upgrade reaches the backend (an HTTP error response is fine here; it proves
Nginx forwarded the upgrade rather than serving a 404):

```bash
curl -i -N \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" \
  https://api.workzen.cloud/api/v1/ws/agent
```

Finally, sign in through the portal, create the organization, and exercise one admin
screenshot request and one live-screen session to confirm signed storage URLs and both
WebSocket paths.

## 10. Updating an existing deployment

Always back up first:

```bash
sudo install -d -o postgres -g postgres -m 700 /var/backups/workzen
sudo -u postgres pg_dump -Fc workzen \
  -f /var/backups/workzen/workzen-$(date +%F-%H%M).dump
```

Then:

```bash
sudo -u workzen git -C /opt/workzen/app fetch --all --prune
sudo -u workzen git -C /opt/workzen/app checkout <REVIEWED_COMMIT_SHA>
sudo -u workzen git -C /opt/workzen/app rev-parse HEAD

cd /opt/workzen/app/backend
sudo -u workzen npm ci
sudo -u workzen npm run build
sudo -u workzen env NODE_ENV=production npm run db:migrate
sudo systemctl restart workzen-api

cd /opt/workzen/app/web
sudo -u workzen npm ci
sudo -u workzen npm run build
sudo systemctl restart workzen-web
```

Deploying a reviewed commit always means checking out its full SHA and confirming
`rev-parse HEAD` matches. Do not use a moving branch name for production updates. Only
the two WorkZen units are restarted; existing PM2 processes are left running.

Changing `NEXT_PUBLIC_API_WS_URL` requires a web rebuild. Changing
`SCREENSHOT_LOCAL_DIR`, `PUBLIC_BASE_URL`, or SMTP settings requires an API restart.

## 11. Desktop and mobile clients

These are built on your workstation, not on the VPS.

### Electron (Windows)

```powershell
cd electron
copy .env.production.example .env.production
notepad .env.production
npm ci
npm run package
```

Set `MAIN_VITE_TEMPO_API_BASE_URL=https://api.workzen.cloud/api/v1` (and optionally
`MAIN_VITE_TEMPO_WS_URL=wss://api.workzen.cloud/api/v1/ws/agent`). electron-vite embeds
these values into the packaged main process at build time, so a Start-menu launch works
without environment variables. At runtime, `TEMPO_API_BASE_URL`/`TEMPO_WS_URL` still
override the baked values. The installer is written to `electron/release/`.

### React Native

```powershell
cd react-native
npm ci
npx expo-doctor
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build -p android --profile production
```

Set `EXPO_PUBLIC_API_BASE_URL=https://api.workzen.cloud/api/v1` in the EAS `production`
profile (`eas.json` → `build.production.env`) or as an EAS project environment variable.
A local `.env.production` is only used by local Expo builds; EAS builds from Git, so
set the value in EAS as well. The repository has no `eas.json` and no committed
`android/`/`ios/` projects, so the first EAS build initializes the project against your
Expo account. Use the same API host as `PUBLIC_BASE_URL` so attendance evidence upload
URLs are reachable from the phone.

## 12. Known constraints and safety notes

- This guide never restores the local development dump and never copies local rows.
- Do not run `npm run smoke`, `db:reset`, `db:drop`, or `db:migrate:undo` in production.
- WorkZen uses ports 4100 (API) and 3002 (web) so it never conflicts with MagicFrame
  (3000), Flowtrium frontend (3001), or Flowtrium backend (4000).
- Existing PM2 processes and existing Nginx site files must not be stopped, restarted,
  or edited. Only `workzen-api` and `workzen-web` are managed by systemd.
- `pgcrypto` is created explicitly by the PostgreSQL administrator before migrations.
  The first migration also uses `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`, so
  running it again is safe. PostgreSQL 18 is in use.
- SMTP is required at boot when `MAIL_TRANSPORT=smtp`, because invitations and password
  resets depend on it. For a temporary boot before SMTP is ready, use the file outbox:

  ```bash
  sudo install -d -o workzen -g workzen -m 700 /var/lib/workzen/storage/mail-outbox
  ```

  Then set `MAIL_TRANSPORT=file` and
  `MAIL_OUTBOX_DIR=/var/lib/workzen/storage/mail-outbox` in the backend `.env`, restart
  `workzen-api`, and deliver the links from that private directory manually. Switch back
  to `smtp` and restart the service when real SMTP is configured. Never use `log`, which
  would write invitation and reset links into the journal.
- `PUBLIC_BASE_URL` is the public **API** origin (`https://api.workzen.cloud`). Pointing
  it at the portal origin breaks screenshot and attendance upload/download URLs.
- Never serve `/var/lib/workzen/storage/screenshots` through Nginx or any static server.
  Keep private screenshot storage, authentication, RBAC, permissions, and organization
  isolation unchanged.
- The backend has no `HOST` setting and binds `0.0.0.0:4100`. Keep UFW enforcing that
  only 80/443 (and SSH) are reachable; port 4100 must not be exposed publicly.
- The application still displays the TempoNest product name in the UI. No branding
  change was made as part of this preparation.
