# WorkZen — Pre-Deployment Database Audit

- **Audit date:** 2026-10-31 (local time, IST)
- **Target:** https://workzen.cloud (Hostinger Ubuntu VPS)
- **Scope:** Local PostgreSQL development database only. No VPS access was used.
- **Method:** Read-only SQL introspection plus `pg_dump`/`pg_restore --list`. No `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `ALTER`, migration, or database recreation was executed.

## 1. Configuration overview (no secrets)

Configuration was loaded from `backend/.env`; values below are non-secret only.

| Setting | Value |
|---|---|
| Connection mode | Discrete `DB_*` variables (`DATABASE_URL` is not set) |
| Host | `localhost` |
| Port | `5432` |
| Database | `temponest_dev` |
| User | `postgres` |
| Password | Set in `.env` (not printed) |
| SSL | `false` |
| `NODE_ENV` | `development` |
| Sequelize dialect | PostgreSQL (`backend/src/database/index.ts`) |
| CLI config | `backend/config/database.cjs` |
| Screenshot storage driver | `local` |
| Local object root | `backend/storage/screenshots` (resolved absolute path under the project) |

## 2. Server and database facts

| Item | Value |
|---|---|
| PostgreSQL server | 18.6 (Windows build) |
| Database name | `temponest_dev` |
| Encoding | UTF8 |
| Collation / ctype | `English_United States.1252` / `English_United States.1252` (Windows locale) |
| Database owner | `postgres` |
| Database size | 12.58 MB |
| Schemas | `public` only |
| Extensions | `pgcrypto` 1.4, `plpgsql` 1.0 |
| Tables | 37 total: 36 application tables + `SequelizeMeta` |
| Columns | 500 total (499 model columns + `SequelizeMeta.name`) |
| Indexes | 166 |
| Constraints | 509 |
| Foreign keys | 107 |
| Enum types | 26 |
| Views / triggers / sequences / partitioned tables | 0 / 0 / 0 / 0 |
| Application rows | 867 (exact `COUNT(*)` at audit time) |

## 3. Tables and row counts

Counts are exact as of the audit; they will change as the app runs.

| Table | Rows | Size |
|---|---:|---:|
| `organizations` | 20 | 0.07 MB |
| `users` | 28 | 0.09 MB |
| `memberships` | 24 | 0.10 MB |
| `custom_roles` | 2 | 0.06 MB |
| `manager_role_overrides` | 0 | 0.05 MB |
| `invitations` | 6 | 0.10 MB |
| `sessions` | 94 | 0.24 MB |
| `password_reset_tokens` | 0 | 0.04 MB |
| `desktop_agents` | 23 | 0.13 MB |
| `time_sessions` | 69 | 0.16 MB |
| `breaks` | 44 | 0.07 MB |
| `application_activities` | 30 | 0.11 MB |
| `organization_tracking_settings` | 1 | 0.04 MB |
| `application_classifications` | 0 | 0.03 MB |
| `activity_idle_intervals` | 1 | 0.09 MB |
| `agent_sync_events` | 45 | 0.11 MB |
| `screenshot_policies` | 2 | 0.05 MB |
| `screenshot_policy_acknowledgements` | 0 | 0.02 MB |
| `screenshot_requests` | 9 | 0.14 MB |
| `screenshots` | 8 | 0.11 MB |
| `audit_events` | 382 | 0.31 MB |
| `screen_live_sessions` | 10 | 0.09 MB |
| `screen_live_viewers` | 10 | 0.07 MB |
| `platform_audit_events` | 0 | 0.04 MB |
| `attendance_check_ins` | 18 | 0.12 MB |
| `attendance_correction_requests` | 8 | 0.10 MB |
| `attendance_evidence` | 28 | 0.14 MB |
| `attendance_location_samples` | 0 | 0.03 MB |
| `attendance_location_tracking` | 0 | 0.02 MB |
| `leave_types` | 1 | 0.06 MB |
| `leave_policies` | 1 | 0.06 MB |
| `leave_holidays` | 0 | 0.05 MB |
| `organization_holiday_settings` | 1 | 0.05 MB |
| `leave_balances` | 2 | 0.07 MB |
| `leave_requests` | 0 | 0.05 MB |
| `leave_ledger_entries` | 0 | 0.05 MB |
| `SequelizeMeta` | 37 | 0.02 MB |

Largest tables: `audit_events`, `sessions`, `time_sessions`; total application data is small (12.58 MB including indexes).

## 4. Sequelize models and relationships

36 models are registered in `backend/src/database/models.ts` and map 1:1 to the 36 application tables. No model lacks a table and no extra application table exists.

- **Organizations:** `Organization`, `Membership`, `CustomRole`, `ManagerRoleOverride`, `Invitation`
- **Auth:** `User`, `Session`, `PasswordResetToken`
- **Agents and tracking:** `DesktopAgent`, `TimeSession`, `Break`, `ApplicationActivity`, `OrganizationTrackingSettings`, `ApplicationClassification`, `ActivityIdleInterval`, `AgentSyncEvent`
- **Screenshots / live screen:** `ScreenshotPolicy`, `ScreenshotPolicyAcknowledgement`, `ScreenshotRequest`, `Screenshot`, `AuditEvent`, `ScreenLiveSession`, `ScreenLiveViewer`
- **Platform:** `PlatformAuditEvent`
- **Attendance:** `AttendanceCorrectionRequest`, `AttendanceEvidence`, `AttendanceCheckIn`, `AttendanceLocationSample`, `AttendanceLocationTracking`
- **Leave:** `LeaveType`, `LeavePolicy`, `LeaveHoliday`, `OrganizationHolidaySettings`, `LeaveBalance`, `LeaveRequest`, `LeaveLedgerEntry`

Association definitions: **107 `belongsTo` + 81 `hasMany` + 8 `hasOne` = 196**. The 107 `belongsTo` references correspond exactly to the 107 database foreign keys. Every relation uses tenant-scoped `organization` ownership, and cascade rules are declared in both models and database constraints.

### Enums (26, all matching between models and PostgreSQL)

`agent_sync_events_event_type`, `agent_sync_events_status`, `application_classifications_category`, `attendance_check_ins_work_mode`, `attendance_correction_requests_request_type`, `attendance_correction_requests_status`, `attendance_evidence_kind`, `attendance_evidence_status`, `attendance_location_tracking_permission`, `attendance_location_tracking_status`, `breaks_status`, `custom_roles_data_scope`, `desktop_agents_client_type`, `invitations_role`, `leave_ledger_entries_kind`, `leave_policies_accrual_frequency`, `leave_requests_status`, `manager_role_overrides_data_scope`, `memberships_role`, `memberships_status`, `organizations_status`, `screenshot_requests_status`, `time_sessions_source`, `time_sessions_status`, `users_platform_role`, `users_status`.

## 5. Migration history

- Migration files on disk: **37**
- Rows in `SequelizeMeta`: **37**
- **Pending migrations: 0**
- Applied migrations with no local file: 0
- Newest applied: `20261031000200-create-password-reset-tokens.js`

All 37 applied migrations:

```
20260101000100-create-organizations.js
20260101000200-create-users.js
20260101000300-create-memberships.js
20260101000400-create-invitations.js
20260101000500-create-sessions.js
20260201000100-add-organization-timezone.js
20260201000200-create-desktop-agents.js
20260201000300-create-time-sessions.js
20260201000400-create-breaks.js
20260201000500-create-application-activities.js
20260201000600-create-agent-sync-events.js
20260301000100-create-screenshot-policies.js
20260301000200-create-screenshot-policy-acknowledgements.js
20260301000300-create-screenshot-requests.js
20260301000400-create-screenshots.js
20260301000500-create-audit-events.js
20261023000100-create-attendance-correction-requests.js
20261024000100-add-client-type-to-desktop-agents.js
20261025000100-create-attendance-evidence-and-check-ins.js
20261026000100-add-platform-role-and-organization-soft-delete.js
20261026000200-create-platform-audit-events.js
20261026000300-create-screen-live-sessions.js
20261026000400-create-attendance-location-tracking.js
20261027000100-create-leave-management.js
20261027000200-add-leave-accrual.js
20261030000100-create-organization-tracking-settings.js
20261030000200-create-application-classifications.js
20261030000300-create-activity-idle-intervals.js
20261030000400-add-activity-platform-and-identifier-index.js
20261030000500-create-custom-roles.js
20261030000600-create-manager-role-overrides.js
20261030000700-add-onboarding-eligible-to-custom-roles.js
20261030000800-add-custom-role-to-invitations.js
20261030000900-extend-holiday-calendar.js
20261030001000-add-government-holidays.js
20261031000100-onboarding-and-auth-security.js
20261031000200-create-password-reset-tokens.js
```

The two newest migrations (auth lockout/onboarding columns and password reset tokens) are **untracked in Git** at audit time. Ensure they are included in the deployment artifact if migrations are shipped.

## 6. Schema vs. models/migrations

| Check | Result |
|---|---|
| Model tables present in DB | 36/36 |
| Application tables missing from models | 0 |
| Model columns missing in DB | 0 |
| DB columns not represented in models | 0 (besides `SequelizeMeta.name`) |
| Model-declared indexes missing in DB | 0 |
| Foreign keys declared in models but missing in DB | 0 |
| Foreign keys in DB not declared in models | 0 |
| Enum label mismatches | 0 |
| Nullability mismatches | 0 |
| Type mismatches | 11 columns store `jsonb` while the model type is `DataTypes.JSON`; 6 other JSON attributes use `json` |

The JSON/JSONB difference is a representation inconsistency, not a functional break: Sequelize reads/writes both. The 11 `jsonb` columns are `agent_sync_events.result`, `attendance_correction_requests.requested_breaks`, `attendance_correction_requests.original_snapshot`, `attendance_correction_requests.applied_snapshot`, `audit_events.metadata`, `leave_ledger_entries.metadata`, `leave_policies.working_days`, `leave_requests.charged_dates`, `platform_audit_events.metadata`, `screenshot_policies.request_roles`, `screenshot_policies.view_roles`.

All 136 timestamp columns are `timestamp with time zone`; there are no timezone-naive timestamps. Date-only columns (9) use `date`.

## 7. Uploaded files: database vs. filesystem

Binaries are **not** stored in PostgreSQL. The database stores only metadata and object keys:

- `screenshots.storage_key`, `screenshots.content_type`, `screenshots.file_size_bytes`
- `attendance_evidence.storage_key`, `content_type`, `file_size_bytes`, `upload_token_hash`, upload/expiry timestamps
- Live screen frames are in-memory only (`screen_live_*` tables hold session/viewer metadata, no frame data)

Storage driver is `local` (`SCREENSHOT_STORAGE_DRIVER=local`), root `backend/storage/screenshots`.

| Metric | Value |
|---|---|
| Files on disk | 22 (2,840,207 bytes ≈ 2.71 MiB) |
| Screenshot files present | 4 |
| Attendance evidence files present | 18 |
| Zero-byte files | 0 |
| Unreferenced files (no DB row) | 0 |
| DB screenshot rows | 8 (all request status `COMPLETED`) |
| DB attendance evidence rows | 28 (18 `ATTACHED`, all present on disk; 10 `PENDING`, no file uploaded) |
| DB rows whose object is missing on disk | 14: 4 screenshots + 10 `PENDING` attendance |

**Integrity finding:** 4 `screenshots` rows are `COMPLETED` with retention not yet expired, but their files are absent from the local storage root. Preview/access for those 4 images will fail. The cause cannot be determined from the database alone (possible manual cleanup, a prior storage-root change, or restored metadata). The 10 missing attendance objects are expected because they are `PENDING` and were never uploaded.

A database backup does **not** include these files. The storage directory must be backed up separately (and the 4 missing screenshots accepted or investigated) before cutover.

## 8. Backup

| Item | Value |
|---|---|
| Backup path | `D:\Code\Personal\database-backups\workzen-predeploy-2026-10-31-18-47.dump` |
| Format | PostgreSQL custom (`pg_dump --format=custom`) |
| Size | 256,413 bytes (250.4 KiB / 0.24 MiB) |
| Created | 2026-10-31 18:47 local |
| SHA-256 | `b2ece03d96ee34ff2b820735fa814ae36ee4768b88bd7959aa1edde18c527ac0` |
| `pg_dump` exit | 0 |
| `pg_restore --list` | Readable; 375 TOC entries |
| Dump contents | 37 tables, 37 table-data entries, 2 extensions (`pgcrypto`, `plpgsql`) |
| Existing backup overwritten? | No — destination folder was newly created |

The dump was created with default ownership and **does not include roles/globals** (normal for `pg_dump` without `pg_dumpall -g`). On the VPS, either create the matching role or restore with `--no-owner --no-privileges`.

Verification was limited to archive listing by instruction. **No restore rehearsal was performed.**

## 9. Deployment risks and unresolved issues

1. **Four missing screenshot objects.** DB says `COMPLETED`, disk has no file. Fix or accept before relying on screenshot previews.
2. **Storage is not in the DB backup.** Copy `backend/storage/screenshots` (or migrate to S3) together with the database. Keep file layout and `storage_key` values unchanged.
3. **Collation mismatch.** The local database is UTF8 but uses Windows `English_United States.1252` collation. On Ubuntu, create the target database explicitly with UTF8 and a Linux collation (for example `en_US.UTF-8` or `C.UTF-8`). Collation cannot be changed in place; plan the dump/restore accordingly and re-verify sorted lists and unique indexes.
4. **Major version.** Server is PostgreSQL 18.6. Restore into PostgreSQL 18 (or newer). A custom-format archive from 18 is not guaranteed to restore into older majors.
5. **Required extension.** `pgcrypto` is used for `gen_random_uuid()`/hashing. The archive contains the extension entry, but the restore role needs privilege to create it (or it must be pre-created by an administrator).
6. **Roles and ownership.** The dump has no role definitions. Create the application role/password on the VPS separately; never reuse the local `postgres` superuser for the app.
7. **Untracked source migrations.** The two newest migrations are untracked in Git. If deployment uses a fresh `db:migrate` rather than the restored database, those files must be present in the deployed code.
8. **Development data in production.** The database contains 20 organizations, 28 users, 94 sessions and audit/demo rows. Decide explicitly whether to restore this data or start from an empty schema after backup.
9. **No restore test.** The archive is structurally valid (`pg_restore --list`), but an actual restore into a scratch PostgreSQL 18 instance has not been run. Schedule a rehearsal before the production cutover.
10. **Not verified:** VPS PostgreSQL version/config, backup encryption/off-host copying, disk capacity, and storage continuity. No server commands were executed.

## 10. Recommended next steps (not executed)

1. Decide whether production starts from this dataset or an empty schema.
2. On the VPS, provision PostgreSQL 18 with an explicit UTF8/Linux collation, a dedicated app role, and `pgcrypto`.
3. Restore the archive (`--no-owner --no-privileges` if roles differ) and run a scratch restore rehearsal first.
4. Copy the storage directory and verify every `storage_key` resolves; investigate the 4 missing screenshots.
5. Keep the dump and storage copy off-host and encrypted; record checksums.
6. Do not run `npm run db:migrate` against a restored database unless intentionally applying new migrations — all 37 are already recorded.

---

*No application source code, database records, credentials, or environment variables were modified. The only artifacts created are the backup in `D:\Code\Personal\database-backups\` and this document.*
