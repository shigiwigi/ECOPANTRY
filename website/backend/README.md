# EcoPantry backend

FastAPI + SQLAlchemy 2 + PostgreSQL REST API for EcoPantry. Implemented so
far: settings, database connection, migrations, error handling, health checks,
and staff authentication (Argon2id passwords, server-side sessions in
PostgreSQL, HttpOnly cookies, CSRF protection, roles and permissions enforced
on every protected endpoint, account deactivation, an append-only audit log).
There are no business endpoints (inventory, batches, ...) yet. The design is in
[docs/AUTH_DESIGN.md](../../docs/AUTH_DESIGN.md).

## Requirements

- Fedora (or another Linux) with **Podman** and **podman-compose**. Docker Engine is not needed.
- Python 3.12+ (developed on 3.14).

Install the system packages once (this is the only step that needs `sudo`):

```bash
sudo dnf install podman podman-compose python3
```

## First-time setup

All commands below start from the repository root unless a `cd` says otherwise.

```bash
# 1. Database credentials for the PostgreSQL container (git-ignored)
cp .env.example .env
python3 -c "import secrets; print(secrets.token_urlsafe(24))"   # paste this as POSTGRES_PASSWORD in .env

# 2. Backend settings (git-ignored). DATABASE_URL must use the same user/password/db/port as .env
cp website/backend/.env.example website/backend/.env
#    edit DATABASE_URL in website/backend/.env

# 3. Start PostgreSQL
podman-compose up -d

# 4. Python environment and dependencies
cd website/backend
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"

# 5. Create or upgrade the database schema
.venv/bin/alembic upgrade head

# 6. Create the first administrator (prompts for the password twice)
.venv/bin/python -m app.cli create-admin --email you@example.com --name "Your Name"
```

There is no default account and no default password. Step 6 only works while
no administrator exists; after that, add staff through the API (or portal) as
that administrator.

You can `source .venv/bin/activate` instead of prefixing commands with `.venv/bin/`.

## Daily commands

### PostgreSQL (from the repository root)

| Task | Command |
|---|---|
| Start in the background | `podman-compose up -d` |
| Container status (shows `healthy`) | `podman-compose ps` |
| Health status only | `podman inspect --format '{{.State.Health.Status}}' ecopantry_db_1` |
| Run the health check now | `podman healthcheck run ecopantry_db_1 && echo healthy` |
| Is PostgreSQL accepting connections? | `podman-compose exec db pg_isready -h 127.0.0.1 -U ecopantry -d ecopantry` |
| SQL shell | `podman-compose exec db psql -U ecopantry -d ecopantry` |
| Logs | `podman-compose logs --tail 50 db` |
| Stop, keep data | `podman-compose stop` |
| Remove the container, keep data | `podman-compose down` |

Replace `ecopantry` in the `-U`/`-d` flags if you changed `POSTGRES_USER` or
`POSTGRES_DB`. Data lives in the named volume `ecopantry_pgdata` and survives
`stop`, `down` and reboots. **`podman-compose down -v` and
`podman volume rm ecopantry_pgdata` delete the database.**

PostgreSQL is published on `127.0.0.1` only (port `POSTGRES_PORT`, default
5432), so other machines on the network can't reach it.

### API (from `website/backend/`)

| Task | Command |
|---|---|
| Run with auto-reload | `.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000` |
| Liveness | `curl http://127.0.0.1:8000/api/v1/health` |
| Database readiness | `curl http://127.0.0.1:8000/api/v1/health/ready` |
| Interactive API docs | http://127.0.0.1:8000/api/v1/docs (off when `ENVIRONMENT=production`) |
| Apply migrations | `.venv/bin/alembic upgrade head` |
| Current migration | `.venv/bin/alembic current` |
| New migration from model changes | `.venv/bin/alembic revision --autogenerate -m "add ingredients"` |
| Check models match migrations | `.venv/bin/alembic check` |
| Undo the last migration | `.venv/bin/alembic downgrade -1` |
| All tests | `.venv/bin/pytest` |
| Tests that need no database | `.venv/bin/pytest -m "not integration"` |
| One test | `.venv/bin/pytest tests/test_health.py -k readiness` |

With the frontend dev server running (`npm run dev` in `website/frontend/`),
the same endpoints are also reachable through its proxy, for example
http://localhost:5173/api/v1/health.

## Configuration

Settings live in `app/core/config.py` and are read from environment variables
or `website/backend/.env` (environment variables win). See `.env.example`.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | none | PostgreSQL only. `postgres://` and `postgresql://` are converted to `postgresql+psycopg://`. SQLite and other databases are rejected. |
| `ENVIRONMENT` | no | `development` | `development`, `test` or `production`. Production turns off the API docs. |
| `LOG_LEVEL` | no | `INFO` | Level for the `app` loggers. |
| `DATABASE_POOL_SIZE` | no | `5` | |
| `DATABASE_MAX_OVERFLOW` | no | `10` | |
| `DATABASE_POOL_TIMEOUT` | no | `10` | Seconds to wait for a free pooled connection. |
| `DATABASE_CONNECT_TIMEOUT` | no | `5` | Seconds to wait for PostgreSQL to accept a connection. |
| `SESSION_IDLE_TIMEOUT_MINUTES` | no | `60` | A session ends after this long without a request. |
| `SESSION_ABSOLUTE_TIMEOUT_HOURS` | no | `12` | A session ends this long after sign-in, whatever the activity. |
| `SESSION_COOKIE_SECURE` | no | unset | Unset: `Secure` cookie only in production. Production refuses `false`. When secure, the cookie is named `__Host-ecopantry_session`, otherwise `ecopantry_session`. |
| `LOGIN_MAX_FAILED_ATTEMPTS` | no | `5` | Wrong passwords in a row before a temporary lockout. |
| `LOGIN_LOCKOUT_MINUTES` | no | `15` | Length of that lockout. |

`DATABASE_URL` is held as a secret value, so it doesn't show up in logs or
`repr()` output. Alembic reads the same setting; there is no URL in `alembic.ini`.

## API

All routes are under `/api/v1`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/health` | Liveness. `200 {"status": "ok", "service": "ecopantry-api", "version": "0.1.0"}`. Does not touch the database. |
| GET | `/api/v1/health/ready` | Readiness. Runs `SELECT 1` on PostgreSQL. `200 {"status": "ready", "database": "ok"}`, or `503 {"status": "unavailable", "database": "unreachable"}`. |
| GET | `/api/v1/docs`, `/api/v1/openapi.json` | Swagger UI and OpenAPI schema (not in production). |
| POST | `/api/v1/auth/login` | Public. `{email, password}` (JSON only). Sets the session cookie and returns `{user, csrf_token, expires_at}`. `401 invalid_credentials`, `403 account_disabled` (right password, deactivated account), `429 account_locked`. |
| POST | `/api/v1/auth/logout` | Public. Ends the session on the server and clears the cookie. Needs `X-CSRF-Token` when a session exists. `204`. |
| GET | `/api/v1/auth/me` | Session required. Same body as login. The frontend calls it to restore a session after a reload. |
| POST | `/api/v1/auth/password` | Session + CSRF. `{current_password, new_password}`. Signs out the employee's other sessions. `204`; `400 invalid_current_password` / `password_rejected`. |
| GET | `/api/v1/employees` | `employees.view` (Administrator, Inspector). Staff accounts, never with password data. |
| POST | `/api/v1/employees` | `employees.manage` (Administrator). `{email, name, role, password}` creates an account. `201`; `409` for a taken email. |
| POST | `/api/v1/employees/{id}/deactivate` | `employees.manage`. Disables the account and ends all its sessions. You can't deactivate yourself or the last active administrator (`409`). |
| POST | `/api/v1/employees/{id}/reactivate` | `employees.manage`. Re-enables the account and clears any lockout. |
| POST | `/api/v1/employees/{id}/password` | `employees.manage`. Sets a new password and ends all that account's sessions. `204`. |
| GET | `/api/v1/public/catalogue` | Public, no session. `{categories, products}`: published products only, with public fields only (`slug, name, summary, category {slug, name}, price, currency`). Categories without a published product are left out. `price` is a decimal string such as `"4.50"`, or null. |
| GET | `/api/v1/public/catalogue/products/{slug}` | Public. One published product, plus `description`. Drafts and unknown slugs both answer `404 not_found`. |
| GET | `/api/v1/catalogue/products` | `catalogue.manage` (Administrator). Every product, drafts included, with ids, state and timestamps. |
| POST | `/api/v1/catalogue/products` | `catalogue.manage`. `{name, slug?, summary?, description?, category_id?, price?, currency?, is_published?}`. New products are drafts unless `is_published` is true. The slug is made from the name when left out (numbered if taken). Price and currency (ISO 4217) go together. `201`; `400 invalid_catalogue_entry`; `409` for a taken slug. |
| PATCH | `/api/v1/catalogue/products/{id}` | `catalogue.manage`. Changes only the fields sent; `null` clears an optional field. `is_published` publishes or unpublishes. Renaming never changes the slug unless one is sent. |
| DELETE | `/api/v1/catalogue/products/{id}` | `catalogue.manage`. `204`. |
| GET | `/api/v1/catalogue/categories` | `catalogue.manage`. Categories with `product_count`. |
| POST | `/api/v1/catalogue/categories` | `catalogue.manage`. `{name}`; names are unique ignoring case and the slug comes from the name. `201`; `409` for a duplicate. |
| PATCH | `/api/v1/catalogue/categories/{id}` | `catalogue.manage`. `{name}` renames (the slug follows). |
| DELETE | `/api/v1/catalogue/categories/{id}` | `catalogue.manage`. `204`; `409` while products still use it. |
| GET | `/api/v1/batches/by-label/{code}` | `batches.view` (every role). Batch lookup for the portal's QR scanner. `code` is the 10-character label code (`422` otherwise). Until batch records exist (M6) a valid request answers `501 batch_lookup_unavailable`. Contract: `docs/QR_LABELS.md`. |

Every catalogue change is written to the audit log (`catalogue.product_created`,
`..._updated` with the changed field names, `..._published`, `..._unpublished`,
`..._deleted`, and the `catalogue.category_*` equivalents). The public
catalogue has no link to ingredient inventory, so it can't expose stock data.

### Sessions and CSRF

- Sign-in sets an HttpOnly, `SameSite=Lax`, `Path=/` cookie holding a random
  token. The database stores only its SHA-256, so a copy of the database can't
  be used to sign in.
- Every `POST`/`PUT`/`PATCH`/`DELETE` made with a session must send the
  session's CSRF token (from the login or `/auth/me` response) in the
  `X-CSRF-Token` header, or it gets `403 csrf_failed`.
- An ended session (expired, idle, signed out, deactivated, password changed)
  gets `401 session_expired` and a `Set-Cookie` that removes the cookie. No
  session at all gets `401 not_authenticated`.
- All `/api/v1` responses carry `Cache-Control: no-store`.

### Protecting a new endpoint

Depend on a permission from `app/auth/permissions.py`; this also checks the
session and, for unsafe methods, the CSRF token:

```python
from typing import Annotated
from fastapi import Depends
from app.auth.dependencies import require_permission
from app.auth.permissions import Permission
from app.auth.service import Principal

@router.post("/batches")
def create_batch(principal: Annotated[Principal, Depends(require_permission(Permission.BATCHES_MANAGE))]): ...
```

Use `CurrentPrincipal` for "any signed-in employee". `tests/test_route_protection.py`
fails if a new route answers without a session and isn't on its short public
list, so a forgotten dependency is caught. Record changes with
`app.services.audit.record_event` in the same transaction.

## Staff account commands

For the server operator, from `website/backend/`. Passwords are prompted for
(typed twice, not shown) or piped in with `--password-stdin`; they are never
accepted as arguments, which would leave them in shell history.

| Task | Command |
|---|---|
| Create the first administrator | `.venv/bin/python -m app.cli create-admin --email … --name "…"` |
| Reset a forgotten password (signs them out everywhere) | `.venv/bin/python -m app.cli set-password --email …` |
| Deactivate / reactivate an account | `.venv/bin/python -m app.cli deactivate --email …` / `reactivate --email …` |
| Delete sessions that ended over 30 days ago | `.venv/bin/python -m app.cli purge-sessions --days 30` |

Every command is recorded in `audit_events` with actor type `cli`.

### Error format

Every error has the same JSON shape, built in `app/core/errors.py`:

```json
{ "detail": "Some fields are missing or invalid.", "code": "validation_error",
  "errors": [{ "loc": ["body", "email"], "msg": "Field required", "type": "missing" }] }
```

- `detail` is safe to show to users; the frontend API client displays it.
- `code` is stable for programs to check (`not_found`, `method_not_allowed`, `validation_error`, `conflict`, `internal_error`, ...).
- `errors` appears only on `422` responses. The submitted values are never echoed back, so passwords can't leak into responses.
- Unexpected exceptions are logged with their stack trace and return a generic `500` with no internal details.

In feature code, raise `NotFoundError`, `ConflictError`, `ServiceUnavailableError`
or a subclass of `AppError` rather than building error responses by hand.

## Structure

```text
website/backend/
  app/
    main.py              ASGI entry point (uvicorn app.main:app)
    factory.py           create_app(settings): wiring, docs, lifespan, routers
    core/config.py       Settings (environment / .env)
    core/errors.py       AppError classes and the exception handlers
    core/security.py     Argon2id password hashing, password rules, session tokens
    core/middleware.py   Cache-Control: no-store on API responses
    auth/permissions.py  roles and permissions (mirrors the migration seed)
    auth/service.py      sign-in, lockout, sessions, password change
    auth/dependencies.py CurrentPrincipal, require_permission (session + CSRF checks)
    auth/cookies.py      session cookie settings
    services/            employee lifecycle, catalogue and audit events, shared by API and CLI
    cli.py               python -m app.cli (create-admin, set-password, ...)
    db/base.py           DeclarativeBase with constraint naming conventions
    db/session.py        Database (engine + session factory), SessionDep
    models/__init__.py   import every model here so Alembic sees it
    models/auth.py       roles, permissions, employees, auth_sessions
    models/audit.py      audit_events (append-only)
    models/catalogue.py  public catalogue: catalogue_categories, catalogue_products
    schemas/             Pydantic request/response models
    api/v1/router.py     includes every v1 route module
    api/v1/routes/       one module per feature (health, auth, employees, catalogue, public)
  alembic/               migration environment and versions/
  scripts/e2e_server.py  API + throwaway database for the frontend's full-stack browser tests
  tests/                 pytest suite
```

### Adding a feature module later

1. Models in `app/models/<feature>.py` (subclass `app.db.base.Base`), imported in `app/models/__init__.py`.
2. `.venv/bin/alembic revision --autogenerate -m "..."`, review the generated file, then `alembic upgrade head`.
3. Schemas in `app/schemas/<feature>.py`.
4. Routes in `app/api/v1/routes/<feature>.py` using `SessionDep`, included in `app/api/v1/router.py`.
5. Tests in `tests/`.

Sessions from `SessionDep` don't commit automatically: call `session.commit()`
when a request should save changes. Anything not committed is rolled back when
the request ends.

Every endpoint must enforce its permission here (see "Protecting a new
endpoint"). The frontend's role checks are only for the interface.

## Tests

`pytest` runs two kinds of tests:

- **Unit tests** build the app with settings that point at a closed port, so they need no database and never read your `.env`.
- **Integration tests** (`@pytest.mark.integration`) use `DATABASE_URL` and need the PostgreSQL container running. They create throwaway `ecopantry_test_*` databases on that server, migrate them, and drop them afterwards, so your development data is never touched. Auth tests share one migrated test database and empty its account tables between tests.

What is covered: Argon2id hashing and verification, password rules, sign-in success and every failure (wrong password, unknown email, lockout, deactivated account, non-JSON body), cookie attributes, tokens stored only as hashes, `/auth/me`, sign-out, absolute and idle expiry, revoked/made-up/tampered cookies, CSRF on every unsafe auth route, password change, role checks on the staff endpoints (including Inspector read-only), deactivation ending sessions, the CLI, the audit log being append-only, migrations up and down, the catalogue (public endpoints showing published products and public fields only, drafts answering like missing products, administrator-only management, validation, slugs, publishing and audit events), the role/permission seed matching the code, models matching the migrations, every non-public route refusing anonymous requests, and passwords/tokens never appearing in logs or audit records.

If PostgreSQL isn't running, skip the integration tests with `pytest -m "not integration"`.

## Troubleshooting

- **`podman-compose up` says `Set POSTGRES_PASSWORD in .env`**: the root `.env` is missing; copy `.env.example`.
- **Port 5432 already in use**: set `POSTGRES_PORT=5433` in `.env` and use `:5433` in `DATABASE_URL`.
- **Readiness returns 503**: check `podman-compose ps` shows `healthy`, and that `DATABASE_URL` matches the root `.env`. The API logs the underlying error.
- **Changed `POSTGRES_PASSWORD` after the first start**: PostgreSQL only reads it when the volume is first created. Change it inside the database (`ALTER USER ecopantry PASSWORD '...'`) instead of deleting the volume.
