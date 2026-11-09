# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

Implemented: the frontend foundation (`website/frontend/`, Milestone 1), the backend foundation (`website/backend/`, Milestone 2: settings, PostgreSQL via Podman, SQLAlchemy, Alembic, health endpoints, error handling) and staff authentication (Milestone 3: roles, permissions, employees, PostgreSQL sessions, CSRF, audit log, real portal sign-in; design in `docs/AUTH_DESIGN.md`). Milestone 4 (public website) is in progress: the public catalogue (migration `0003`, public read endpoints, admin-only portal management, real Products pages) is done; images, the contact form and owner content are waiting on decisions. QR labels and scanning (M7) were built ahead of M6: label format, printable labels, camera scanner and a protected `GET /batches/by-label/{code}` that answers 501 until batch records exist (`docs/QR_LABELS.md`). Hardware integration has started (`docs/HARDWARE_INTEGRATION.md`):
- **One ESP32 inventory station** (DHT11, waste-bin HX711, experimental pH, MFRC522, LCD). Its firmware is in `software/firmware/inventory-esp32/` and its wiring in `hardware/inventory-station/`. Its WiFi, API address and token come from the git-ignored `include/secrets.h` (a setup hotspot to replace it is planned, not built).
- **Migration `0004`** adds devices, live-session budget, sensor readings, RFID cards and scans.
- **Device auth:** bearer tokens on `/device/*` via `app/auth/device.py`, never staff cookies. Device routes are protected by the token, not by a session.
- **Live sessions:** stations upload only while live (power-on or authorised card tap, daily cap). The backend refuses readings outside a session, so idle hardware never keeps Render/Neon awake.
- **Portal:** Environment, pH, Waste, Devices and Employees (RFID cards) pages read these.

There are no inventory or batch tables yet. Scope (2026-11-09): inventory is in-shop only (no suppliers), the waste bin's fullness comes from its weight alone (a "nearly full" alert at about 2 kg), and the HC-SR04 ultrasonic sensor and ESP32-CAM are dropped. `docs/ROADMAP.md` has the milestone order (M0–M13, mapped to the README phases), dependencies and acceptance criteria; `docs/PROJECT_STATUS.md` is the checklist of what is implemented. Update both as work lands. Do not describe planned features as working until they are implemented and tested (the README is explicit about this).

Deployment (`docs/DEPLOYMENT.md`): Firebase Hosting serves the frontend (`website/frontend/firebase.json`, project `ecopantry-a7342`, deployed by hand with `firebase deploy --only hosting` after `npm run build`; only when the user asks) and Firebase Auth provides Google sign-in. The API is on Render (`https://ecopantry-api.onrender.com`); the site calls it cross-origin (`VITE_API_BASE_URL` in the git-ignored `.env.production.local`), so the API has a CORS allow-list of exact origins and a `SameSite=None` session cookie, with `X-CSRF-Token` on unsafe requests. Never allow arbitrary origins. `render.yaml` runs `alembic upgrade head` on every start, so migrations reach production on push to `main`; the database is Neon. Never put the Neon URL or any other secret in these files.

When adding a component, give it its own dependency file and setup instructions (README expects this), plus a `.env.example` with placeholders only.

## Commands

Frontend, run from `website/frontend/` (Node 22.22+):

```bash
npm run dev                               # Vite dev server
npm run build                             # tsc -b + production build
npm run lint                              # oxlint
npm test                                  # Vitest unit tests
npx vitest run src/app/routes.test.tsx    # one file; add -t "test name" for one test
npm run test:e2e                          # Playwright: every route, 375px + 1440px, light + dark
npm run test:e2e:fullstack                # Playwright against real FastAPI + a throwaway PostgreSQL database
npm run test:e2e:browsers                 # QR + smoke suites in Firefox, Android emulation, WebKit (--project to pick)
```

`test:e2e` needs `npx playwright install chromium` once. It starts its own dev server with the portal preview on and the API proxy pointed at a closed port (the public catalogue endpoints are answered by a fixture in `e2e/smoke.spec.ts`), and writes screenshots to `e2e/.screenshots/` (git-ignored); look at them after UI changes. `test:e2e:fullstack` needs PostgreSQL running and the backend set up; it runs `website/backend/scripts/e2e_server.py`, which creates and later drops `ecopantry_test_e2e` with seeded test accounts.

Database, from the repository root. This machine uses **Podman and podman-compose, not Docker**; credentials are in the git-ignored root `.env`:

```bash
podman-compose up -d          # PostgreSQL 18 on 127.0.0.1:5432, volume ecopantry_pgdata
podman-compose ps             # should show (healthy)
podman-compose stop           # keeps data. Never run `down -v` or remove the volume.
```

Backend, run from `website/backend/` (venv in `.venv`, settings in git-ignored `.env`):

```bash
.venv/bin/pip install -e ".[dev]"
.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
.venv/bin/alembic upgrade head
.venv/bin/alembic revision --autogenerate -m "..."   # after model changes; review the file
.venv/bin/pytest                                     # needs PostgreSQL running
.venv/bin/pytest -m "not integration"                # no database needed
.venv/bin/pytest tests/test_health.py -k readiness   # one test
.venv/bin/python -m app.cli create-admin --email … --name "…"   # first administrator (prompts for password)
```

There is no default account. Never add one, and never accept passwords as CLI arguments (prompt or `--password-stdin`).

## Backend architecture

- `app/factory.py` `create_app(settings)` builds the app; `app/main.py` is the uvicorn entry point. Tests build apps with their own settings (see `tests/conftest.py`), so unit tests never read `.env`.
- Settings: `app/core/config.py` only. `DATABASE_URL` is a `SecretStr`, must be PostgreSQL, and is normalised to `postgresql+psycopg`. Alembic reads it from settings, never from `alembic.ini`. No SQLite anywhere, including tests.
- Database: `app/db/session.py` `Database` (engine + sessionmaker, stored on `app.state`) and `SessionDep` for routes. Sessions don't auto-commit. Models subclass `app.db.base.Base` and must be imported in `app/models/__init__.py` for autogenerate.
- Routes: one module per feature in `app/api/v1/routes/`, included in `app/api/v1/router.py` under `/api/v1`. Schemas in `app/schemas/`.
- Errors: raise `AppError` subclasses from `app/core/errors.py`. Every error response is `{detail, code, errors?}`; the frontend client shows `detail`. Never echo submitted values or internal errors in responses.
- Device endpoints (`/device/*`, `app/api/v1/routes/device.py`) depend on `CurrentDevice` (bearer token) instead of a session, ignore cookies and need no CSRF; `tests/test_devices.py` checks staff sessions and device tokens can't stand in for each other.
- Public endpoints (no session) live only in `app/api/v1/routes/public.py`, return only `Public*` schemas with explicitly listed fields, and must be added to `PUBLIC_ROUTES` in `tests/test_route_protection.py`. They never depend on the session cookie.
- Auth: `app/auth/`. Protect every route with `require_permission(Permission.X)` (or `CurrentPrincipal` for any signed-in employee) from `app/auth/dependencies.py`; it validates the session cookie and, for unsafe methods, the `X-CSRF-Token` header. `tests/test_route_protection.py` fails for any unprotected route not on its public list. Permissions live in the database (seeded by migration `0002`) and are mirrored in `app/auth/permissions.py`; adding one needs a migration plus an update there (`tests/test_permissions.py` checks they match). Inspectors only get read permissions.
- Audit: record changes with `app.services.audit.record_event` in the same transaction. Its `target` can be any model with an `audit_target_type` class attribute. `audit_events` is append-only (DB trigger). Never put passwords, tokens or hashes in audit details or logs.
- Employees are never deleted; deactivate them (`app/services/employees.py`, shared by the API and `app/cli.py`).
- Integration tests are marked `@pytest.mark.integration`. Tests that need a migrated database use throwaway `ecopantry_test_*` databases (fixtures in `tests/conftest.py`: `api`, `db`, `make_employee`, `sign_in`); don't write to the development database from tests.

## Frontend architecture

- One Vite app, two route groups in `src/app/routes.tsx`: the public site under `/` (`PublicLayout`) and the portal under `/portal` (`RequireAuth` → lazy `PortalLayout`). Every page is lazy-loaded, so public visitors never download portal code.
- `src/config/portal-modules.ts` is the single source of truth for the portal. Each module's path, nav label and group, page title and summary, allowed roles, planned capabilities, and what it's waiting on are defined there. The sidebar, the routes and the per-route `RequireRole` guard all read it. To add a module, add an entry. `MOBILE_TAB_IDS` there picks the few modules on the mobile/tablet bottom bar; everything else is under its More drawer. Modules without an API render the generic `pages/portal/ModulePage.tsx` (honest "not connected" state). Once its API exists, register a real page in `CUSTOM_PAGES` in `routes.tsx`.
- Role checks in the frontend are UX only. The backend must enforce the same role lists on every endpoint.
- Auth: `features/auth/AuthProvider.tsx` holds the signed-in user in memory. The session is an HttpOnly cookie from FastAPI; the CSRF token from `/auth/login` and `/auth/me` is kept in memory by `src/lib/api/client.ts` (`setCsrfToken`) and sent as `X-CSRF-Token` on unsafe methods. Never store tokens in localStorage/sessionStorage. `RequireAuth` calls `/auth/me` on first portal entry. Public pages never call auth endpoints; they only read `/public/*` through `src/features/catalogue/public.ts` with `credentials: "omit"`. Keep portal-only code out of that file (it is in the public bundle). Any 401 from `apiRequest` ends the session in the UI (`onUnauthorized`); pass `ignoreUnauthorized` only for the session endpoints themselves. `user.permissions` comes from the backend and is for hiding controls only.
- Development-only portal preview: `VITE_PORTAL_PREVIEW=true` in `.env.local` creates a fake session with a role switcher and a warning banner (no cookie, no permissions; the API refuses it). It is gated by `import.meta.env.DEV`, so it is removed from production builds (verify with `grep -r "Development preview" dist/` if you touch it).
- API calls go through `src/lib/api/client.ts` (`apiRequest`, `ApiError`). The base URL comes from `VITE_API_BASE_URL` and defaults to `/api/v1`, which `vite.config.ts` proxies to FastAPI (`API_PROXY_TARGET`, default `http://127.0.0.1:8000`). A non-JSON 404/405/502-504 means "no backend" (the proxy answers 502 when FastAPI is down). Use TanStack Query for server state.
- Public pages use the `container-page` utility (`globals.css`) for one shared content width and gutters; don't hand-roll `max-w-*`/`px-*` containers.
- Theme: `features/theme/`, plus an inline script in `index.html` that applies the saved theme before first paint. The storage key `ecopantry-theme` is duplicated in both places.
- Public bakery details (contact, hours) live in `src/config/site.ts` as `null` until the owners provide them. Null fields are hidden, never filled with invented values.
- shadcn/ui (radix base, "nova" style). Components import `cn` from `@/lib/utils`, which re-exports the `cn` package (shadcn's clsx + tailwind-merge replacement). Only components actually used are installed. Remove unused ones rather than keeping them around.
- QR: `src/features/qr/`. The label payload is `ECOPANTRY:BATCH:<code>` and nothing else (rules shared with `app/services/batch_labels.py`). The camera only starts from a user action and every track must be stopped on stop, read, unmount, hidden tab and unplug (`useQrScanner.ts`). Printed labels render through `PrintSheet` into `<body>`; `.print-sheet` in `globals.css` hides the rest of the page when printing. Labels use `--label-ink`/`--label-paper` (black on white in both themes). The camera needs HTTPS or localhost; `DEV_HTTPS=true` serves the dev server over HTTPS for phone testing.
- Recharts is installed (sensor history charts, `src/features/sensors/HistoryChart.tsx`). Series colours are `var(--chart-N)` (the :root/.dark tokens; `--color-*` names exist only inside Tailwind utilities with `@theme inline`), never hex.
- Sensor pages (Environment, pH, Waste) share `src/features/sensors/SensorPage.tsx` and poll `GET /sensors/stations` (2 s while a station is live, 60 s otherwise). A paused station is normal (live sessions, `docs/HARDWARE_INTEGRATION.md`); show it as paused, not as an error.

## Planned architecture

EcoPantry is a bakery inventory / food-quality / waste-management prototype with three kinds of clients around one backend:

- **Backend** (`website/backend/`): Python, FastAPI, Pydantic, SQLAlchemy + Alembic, PostgreSQL. It is the only thing that touches the database and it enforces role-based access (Administrator, Storekeeper, Inspector).
- **Frontend** (`website/frontend/`): React + TypeScript + Vite, Tailwind/shadcn/ui, React Router, TanStack Query, React Hook Form + Zod, Recharts. It contains two apps: a public customer site (no login) and the internal management portal.
- **Firmware** (`software/firmware/inventory-esp32/`): PlatformIO, Arduino framework, C++. Hardware docs go in `hardware/`; code shared across components in `software/shared/`; tests in `tests/`.

Constraints that cut across several of these directories:

db- ESP32s talk to the backend over HTTP + JSON with authenticated device endpoints. They must never connect to the database directly.
- The public finished-product catalogue is separate from internal raw-ingredient inventory. Public endpoints must expose only explicitly public catalogue/bakery data, never stock quantities, batches, suppliers, employees, sensor readings, waste or compliance records.
- Core domain concepts: in-shop batch-level inventory with QR labels, expiry tracking with FEFO recommendations, threshold-based alerts evaluated by the backend on incoming sensor readings, RFID-linked employee operations, audit logs.

## Design system (mandatory for all frontend work)

These rules are requirements, not suggestions. Apply them to both the public website and the management portal (same tokens and components, different layouts as appropriate).

The tokens are implemented in `website/frontend/src/styles/globals.css` (`:root` = light, `.dark` = dark), mapped to Tailwind via `@theme inline`. Use semantic classes such as `bg-background`, `text-muted-foreground`, `bg-success/10 text-success`, `border-gold` and `bg-sidebar`. `src/styles/tokens.test.ts` asserts WCAG AA contrast for the key pairs in both themes, so adding or changing a token pair means adding it to that test. Fonts are self-hosted: Inter (UI), Fraunces (`font-display`, public-site headings only) and JetBrains Mono (`font-mono`, IDs and readings).

### Brand palette

Only these five brand colours may be used as the source of the palette:

| Name | Hex |
|---|---|
| Deep Forest Green | `#0E3529` |
| Forest Green | `#215F47` |
| Sage Green | `#4B8A6C` |
| Warm Beige | `#E7DDC6` |
| Muted Gold | `#B89B4A` |

Neutral surfaces, text and status colours (success/warning/danger/info) may be derived from or harmonised with these, but must be defined as tokens, not scattered literals.

### Identity

Premium, modern, professional SaaS. It should convey freshness, food quality, trust, sustainability and operational efficiency. Aim for minimal and clean, with strong visual hierarchy, consistent spacing and professional typography. Dashboards, tables, forms and navigation should be designed deliberately.

Avoid: generic AI-looking layouts, excessive rounded cards, unnecessary gradients, glassmorphism, and decorative animation.

### Themes

Light, Dark and System are all required.

- **Light:** warm, light neutral backgrounds; clean white or warm-neutral surfaces; forest-green primary navigation and actions; dark readable text; Muted Gold used sparingly.
- **Dark:** deep forest-green and dark neutral backgrounds; distinct, slightly lighter surface layers; warm off-white text; Sage Green interactive elements; Muted Gold for selected accents.

Functional requirements:
- A working Light / Dark / System selector, with the user's choice persisted.
- Every component, chart, table, form, dialog, navigation element and status indicator must work in both themes. A component is not done until it has been checked in both.
- Maintain accessible contrast (WCAG AA) and visible focus states in both themes.
- Use semantic design tokens (for example background, surface, foreground, primary, accent, border, ring, and status roles) defined once, as CSS variables mapped into the Tailwind theme and shadcn/ui. Components and Recharts series must reference tokens, never hardcoded hex values or raw Tailwind palette colours.
- Responsive from mobile to desktop.

## Hardware cautions to preserve in code and docs

- MFRC522 runs at 3.3 V.
- pH board analog output must not exceed the ESP32 ADC limit.
- DHT sensor model is still unconfirmed; don't pick a library or state accuracy until it is.
- The load cell needs calibration against the actual bin.
- pH is experimental and must never be used alone to declare food safe or spoiled; the project is not a certified food-safety system.

## Workflow

Per CONTRIBUTING.md: one module or phase per branch (`feature/...`, `fix/...`, `docs/...`), never commit `.env` files or credentials, and update docs when APIs, wiring, or setup change. Technology choices change only through documented project decisions. Work is organized in phases 0-13 (see README); a phase is complete only after testing.

Development happens on the `development` branch; `main` is the main branch.

