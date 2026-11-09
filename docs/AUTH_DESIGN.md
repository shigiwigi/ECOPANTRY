# Authentication and access-control design

Status: implemented in migration `0002` (backend) and the portal sign-in flow
(frontend). This document is the schema proposal and the reasoning behind it;
`website/backend/README.md` has the API reference and commands.

## Scope

Staff only. Administrators, Storekeepers and Inspectors sign in to the
management portal. Customers never get portal accounts: the public website
needs no login, and if optional customer accounts are added later they will
live in separate tables with no role, permission or session rows shared with
staff.

## Entity overview

```text
 roles 1 ──< role_permissions >── 1 permissions
   1
   │
   ^
 employees 1 ──< auth_sessions
   1  (actor)
   │
   ^
 audit_events
```

- An employee has exactly one role (`employees.role_id`). Roles are fixed
  reference data seeded by the migration: `admin`, `storekeeper`, `inspector`.
- A role has many permissions through `role_permissions`. Permissions are
  seeded by the migration and named `<area>.<action>`.
- An employee has many sessions. Signing out, deactivation and password
  changes revoke them.
- Audit events point at the employee who acted (nullable for anonymous and
  command-line actions).

## Tables

### `roles`

| Column | Type | Notes |
|---|---|---|
| `id` | smallint identity | PK |
| `code` | varchar(32) | unique; `admin`, `storekeeper`, `inspector`. The API and frontend use these codes. |
| `name` | varchar(64) | Display name: Administrator, Storekeeper, Inspector |
| `description` | text | |

### `permissions`

| Column | Type | Notes |
|---|---|---|
| `id` | smallint identity | PK |
| `code` | varchar(64) | unique, checked against `^[a-z_]+\.[a-z_]+$` |
| `description` | text | |

### `role_permissions`

| Column | Type | Notes |
|---|---|---|
| `role_id` | smallint | PK part, FK `roles.id` ON DELETE CASCADE |
| `permission_id` | smallint | PK part, FK `permissions.id` ON DELETE CASCADE |

### `employees`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `email` | varchar(254) | unique; stored trimmed and lower-case (CHECK) |
| `full_name` | varchar(120) | not blank (CHECK) |
| `role_id` | smallint | FK `roles.id` ON DELETE RESTRICT |
| `status` | varchar(16) | `active` or `disabled` (CHECK) |
| `password_hash` | text | Argon2id PHC string; never returned by the API |
| `password_changed_at` | timestamptz | |
| `failed_login_attempts` | integer | ≥ 0; reset on success or lockout |
| `locked_until` | timestamptz null | temporary lockout after repeated failures |
| `last_login_at` | timestamptz null | |
| `deactivated_at` | timestamptz null | set exactly when `status = 'disabled'` (CHECK) |
| `created_by_id` | uuid null | FK `employees.id` ON DELETE RESTRICT; null for the bootstrap administrator |
| `created_at`, `updated_at` | timestamptz | |

Account lifecycle:

```text
 (bootstrap CLI or admin creates) ──> active ──deactivate──> disabled
                                        ^                       │
                                        └──────reactivate───────┘
```

- Employees are never deleted, so audit history keeps its actor. Deactivation
  is the way to remove access. It revokes every open session immediately.
- An administrator can't deactivate their own account, and the last active
  administrator can't be deactivated, so the portal can't lock itself out.
- RFID cards (README phase 9, roadmap M10) will be a separate `rfid_cards` table referencing
  `employees`. If some employees should have RFID but no portal login,
  `password_hash` can be made nullable then; that change is additive.

### `auth_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `employee_id` | uuid | FK `employees.id` ON DELETE CASCADE, indexed |
| `token_hash` | bytea(32) | unique; SHA-256 of the cookie token. The raw token is never stored. |
| `csrf_token` | varchar(64) | per-session CSRF token |
| `created_at` | timestamptz | |
| `last_seen_at` | timestamptz | refreshed at most once a minute |
| `expires_at` | timestamptz | absolute expiry, indexed |
| `revoked_at` | timestamptz null | |
| `revoked_reason` | varchar(32) null | `logout`, `password_changed`, `account_deactivated`, `replaced` (CHECK) |
| `ip_address` | inet null | client address as seen by the API |
| `user_agent` | varchar(255) null | truncated |

A session is valid only when: it exists, `revoked_at` is null, `now <
expires_at`, `now < last_seen_at + idle timeout`, and the employee is active.

### `audit_events`

| Column | Type | Notes |
|---|---|---|
| `id` | bigint identity | PK |
| `occurred_at` | timestamptz | indexed |
| `actor_type` | varchar(16) | `employee`, `anonymous` or `cli` (CHECK) |
| `actor_employee_id` | uuid null | FK `employees.id` ON DELETE RESTRICT, indexed |
| `action` | varchar(64) | e.g. `auth.login_succeeded`, `employee.deactivated`; indexed |
| `target_type`, `target_id` | varchar null | what was acted on |
| `ip_address` | inet null | |
| `user_agent` | varchar(255) null | |
| `details` | jsonb | small structured context; never passwords, tokens or hashes |

A trigger rejects `UPDATE` and `DELETE` on `audit_events`, so application code
can only append. (The database owner can still drop the trigger; full
tamper-resistance needs a separate, less-privileged database role for the
API, which is noted as remaining work.)

Failed sign-ins for an unknown email are recorded without the typed email,
because people sometimes type their password into the email field.

## Permissions

Inspectors only receive read permissions (`*.view`, plus `reports.export`,
which only reads). The table is seeded by the migration and mirrored in
`app/auth/permissions.py`; a test checks they match.

| Permission | Admin | Storekeeper | Inspector |
|---|:-:|:-:|:-:|
| `dashboard.view` | ✓ | ✓ | ✓ |
| `alerts.view` | ✓ | ✓ | ✓ |
| `alerts.acknowledge` | ✓ | ✓ | |
| `inventory.view` | ✓ | ✓ | ✓ |
| `inventory.manage` | ✓ | ✓ | |
| `batches.view` | ✓ | ✓ | ✓ |
| `batches.manage` | ✓ | ✓ | |
| `expiry.view` | ✓ | ✓ | ✓ |
| `qr_labels.manage` | ✓ | ✓ | |
| `environment.view` | ✓ | ✓ | ✓ |
| `thresholds.manage` | ✓ | | |
| `ph.view` | ✓ | ✓ | ✓ |
| `ph.record` | ✓ | ✓ | |
| `waste.view` | ✓ | ✓ | ✓ |
| `waste.record` | ✓ | ✓ | |
| `employees.view` | ✓ | | ✓ |
| `employees.manage` | ✓ | | |
| `reports.view` | ✓ | | ✓ |
| `reports.export` | ✓ | | ✓ |
| `audit.view` | ✓ | | ✓ |
| `devices.view` | ✓ | | |
| `devices.manage` | ✓ | | |
| `catalogue.manage` | ✓ | | |
| `enquiries.view` | ✓ | | |

`catalogue.manage` was added by migration `0003` with the public catalogue. Migration `0005` removed `suppliers.view`, `suppliers.manage` and `camera.view` (inventory is in-shop only: no suppliers; the camera is out of scope). Migration `0009` added `enquiries.view` (Administrator only: contact-form messages are personal data).

The `.view` rows match the role lists in the frontend's
`src/config/portal-modules.ts`. Most permissions protect endpoints that don't
exist yet; each future endpoint declares the one it needs.

## Sessions, cookies and CSRF

- Login creates a 256-bit random token (`secrets.token_urlsafe(32)`). The
  browser gets it in an HttpOnly cookie; the database keeps only its SHA-256.
  A database leak therefore doesn't reveal usable session tokens.
- Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` = absolute lifetime.
  With `SESSION_COOKIE_SECURE=true` (required in production) it is also
  `Secure` and named `__Host-ecopantry_session`, which browsers only accept
  from HTTPS with no `Domain`.
- Lifetime: 60 minutes idle and 12 hours absolute by default (one shift),
  both configurable.
- CSRF: `SameSite=Lax` already stops cross-site POSTs from carrying the
  cookie. On top of that, every authenticated request with an unsafe method
  (POST, PUT, PATCH, DELETE) must send `X-CSRF-Token` equal to the session's
  CSRF token. The token is returned in the JSON of `/auth/login` and
  `/auth/me` and kept in memory by the frontend, never in browser storage.
  The login endpoint only accepts `application/json`, which a cross-site HTML
  form can't send, and there is no CORS, so other sites can't read responses.
- Brute force: 5 wrong passwords lock the account for 15 minutes (both
  configurable). While locked the API answers 429 without checking the
  password. Trade-off: this reveals that an email belongs to an account after
  5 attempts; protecting passwords matters more here. Per-IP rate limiting
  belongs in the reverse proxy at deployment.
- Unknown emails still run an Argon2 verification against a dummy hash so
  response time doesn't reveal whether an account exists.
- A correct password on a deactivated account gets 403 "This account has
  been deactivated". Only someone who knows the password learns the status.

## Passwords

- Argon2id via `argon2-cffi` with its RFC 9106 low-memory defaults
  (t=3, m=64 MiB, p=4). Hashes are upgraded on the next successful sign-in if
  the parameters change.
- 12 to 128 characters, must not equal the email. No composition rules.
- There is no default account. The first administrator is created with
  `python -m app.cli create-admin`, which prompts for the password (or reads
  it from stdin) and refuses if an administrator already exists.
