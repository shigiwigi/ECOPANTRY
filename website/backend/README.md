# EcoPantry backend

FastAPI + SQLAlchemy 2 + PostgreSQL REST API for EcoPantry. Milestone 2 is the
foundation only: settings, database connection, migrations, error handling,
health checks and tests. There are no business endpoints, no authentication
and no role checks yet. Don't treat this API as protecting any data until
those land.

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
```

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

`DATABASE_URL` is held as a secret value, so it doesn't show up in logs or
`repr()` output. Alembic reads the same setting; there is no URL in `alembic.ini`.

## API

All routes are under `/api/v1`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/health` | Liveness. `200 {"status": "ok", "service": "ecopantry-api", "version": "0.1.0"}`. Does not touch the database. |
| GET | `/api/v1/health/ready` | Readiness. Runs `SELECT 1` on PostgreSQL. `200 {"status": "ready", "database": "ok"}`, or `503 {"status": "unavailable", "database": "unreachable"}`. |
| GET | `/api/v1/docs`, `/api/v1/openapi.json` | Swagger UI and OpenAPI schema (not in production). |

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
    db/base.py           DeclarativeBase with constraint naming conventions
    db/session.py        Database (engine + session factory), SessionDep
    models/__init__.py   import every model here so Alembic sees it (none yet)
    schemas/             Pydantic request/response models
    api/v1/router.py     includes every v1 route module
    api/v1/routes/       one module per feature (health.py so far)
  alembic/               migration environment and versions/
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

Role-based access (Administrator, Storekeeper, Inspector) must be enforced
here on every endpoint once authentication exists. The frontend's role checks
are only for the interface.

## Tests

`pytest` runs two kinds of tests:

- **Unit tests** build the app with settings that point at a closed port, so they need no database and never read your `.env`.
- **Integration tests** (`@pytest.mark.integration`) use `DATABASE_URL` and need the PostgreSQL container running. The migration test creates a throwaway `ecopantry_test_*` database, runs every migration up and down there, and drops it, so your development data is never touched.

If PostgreSQL isn't running, skip the integration tests with `pytest -m "not integration"`.

## Troubleshooting

- **`podman-compose up` says `Set POSTGRES_PASSWORD in .env`**: the root `.env` is missing; copy `.env.example`.
- **Port 5432 already in use**: set `POSTGRES_PORT=5433` in `.env` and use `:5433` in `DATABASE_URL`.
- **Readiness returns 503**: check `podman-compose ps` shows `healthy`, and that `DATABASE_URL` matches the root `.env`. The API logs the underlying error.
- **Changed `POSTGRES_PASSWORD` after the first start**: PostgreSQL only reads it when the volume is first created. Change it inside the database (`ALTER USER ecopantry PASSWORD '...'`) instead of deleting the volume.
