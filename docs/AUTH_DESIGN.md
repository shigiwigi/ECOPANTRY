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

- Accounts are only ever created by an administrator (portal Users page,
  `POST /employees`) or the bootstrap CLI. There is no self-registration: an
  email address alone never creates, claims or sets the password of an
  account.
- An account created without a password gets the Argon2 hash of a random
  secret that is thrown away, so it can only sign in with Google (same email)
  until an administrator sets a password.
- Employees are never deleted (there is no delete endpoint), so audit history
  keeps its actor. Deactivation is the way to remove access. It revokes every
  open session immediately. A deactivated account is listed (`GET /employees`
  returns everyone; `?active=false` only deactivated ones) so it can be
  reactivated; creating a new account with its email answers `409`.
- An administrator can't deactivate their own account or change their own
  role, and the last active administrator can't be deactivated or demoted, so
  the portal can't lock itself out.
- Changing a role (`PATCH /employees/{id}`, `employee.role_changed` in the
  audit log with the old and new role) revokes all of that employee's
  sessions. Permissions are read from the role on every request anyway; the
  sign-out makes the portal load the new role. The sessions are marked
  `replaced` because the `revoked_reason` CHECK constraint has no
  `role_changed` value yet (adding one needs a migration).
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
| `suppliers.view` | ✓ | ✓ | ✓ |
| `suppliers.manage` | ✓ | ✓ | |
| `environment.view` | ✓ | ✓ | ✓ |
| `thresholds.manage` | ✓ | | |
| `ph.view` | ✓ | ✓ | ✓ |
| `ph.record` | ✓ | ✓ | |
| `waste.view` | ✓ | ✓ | ✓ |
| `waste.record` | ✓ | ✓ | |
| `camera.view` | ✓ | | ✓ |
| `employees.view` | ✓ | | ✓ |
| `employees.manage` | ✓ | | |
| `reports.view` | ✓ | | ✓ |
| `reports.export` | ✓ | | ✓ |
| `audit.view` | ✓ | | ✓ |
| `devices.view` | ✓ | | |
| `devices.manage` | ✓ | | |
| `catalogue.manage` | ✓ | | |

`catalogue.manage` was added by migration `0003` with the public catalogue.

The `.view` rows match the role lists in the frontend's
`src/config/portal-modules.ts`. Most permissions protect endpoints that don't
exist yet; each future endpoint declares the one it needs.

## Google sign-in

`POST /auth/google` takes a Firebase Authentication ID token from the
website's "Continue with Google" button. Firebase Admin (initialised lazily
for `FIREBASE_PROJECT_ID`) checks its signature against Google's keys, the
audience/issuer (our project) and the expiry; the token must also say
`email_verified`. The token is never decoded without that check. Then:

- an **active** employee with that email (case-insensitive) gets a normal
  session, exactly as after a password sign-in (`auth.google_login_succeeded`);
- no employee with that email: `403 google_account_not_staff`, audited
  without the email;
- a deactivated employee: `403 account_disabled` (Google has proved the person
  owns the email, so this reveals nothing to a stranger).

Google sign-in never creates or links accounts, and the password lockout
doesn't apply to it. With `FIREBASE_PROJECT_ID` empty it answers `503
google_sign_in_unavailable`.

## Sessions, cookies and CSRF

- Login creates a 256-bit random token (`secrets.token_urlsafe(32)`). The
  browser gets it in an HttpOnly cookie; the database keeps only its SHA-256.
  A database leak therefore doesn't reveal usable session tokens.
- Cookie: `HttpOnly`, `Path=/`, `Max-Age` = absolute lifetime. With
  `SESSION_COOKIE_SECURE=true` (required in production) it is also `Secure`,
  named `__Host-ecopantry_session` (browsers only accept that from HTTPS with
  no `Domain`) and `SameSite=None`, because the website (Firebase Hosting) and
  the API (Render) are different sites and the browser must send the cookie
  on the website's API calls. In local development it is `SameSite=Lax` and
  not Secure.
- Lifetime: 60 minutes idle and 12 hours absolute by default (one shift),
  both configurable.
- CSRF: with `SameSite=None` the cookie travels on cross-site requests, so
  the `X-CSRF-Token` header is what protects changes: every authenticated
  request with an unsafe method (POST, PUT, PATCH, DELETE) must send it, equal
  to the session's CSRF token. The token is returned in the JSON of
  `/auth/login` and `/auth/me` and kept in memory by the frontend, never in
  browser storage. Another site can't read it, and can't send the custom
  header cross-origin without passing CORS.
- CORS: only the exact origins in `CORS_ORIGINS` (the Firebase Hosting
  origins in production, the Vite dev server by default) get CORS headers,
  with credentials, on every response including errors. Any other origin gets
  none, so its pages can neither read API responses nor send the CSRF header.
  Wildcards are refused at start-up. (Unhandled 500 errors are answered
  outside the CORS middleware and carry no CORS headers; the browser then
  reports a network error.)
- The login endpoint only accepts `application/json`, which a cross-site HTML
  form can't send.
- Brute force: 5 wrong passwords lock the account for 15 minutes (both
  configurable). While locked the API answers 429 without checking the
  password. Trade-off: this reveals that an email belongs to an account after
  5 attempts; protecting passwords matters more here. Per-IP rate limiting
  belongs in the reverse proxy at deployment.
- Unknown emails still run an Argon2 verification against a dummy hash so
  response time doesn't reveal whether an account exists.
- A wrong password and an unknown email get the same `401
  invalid_credentials`, so the answer doesn't reveal which emails have
  accounts.
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
