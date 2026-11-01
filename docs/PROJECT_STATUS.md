# Project status

Current repository bootstrap:
- [x] Initial directory structure
- [x] README
- [x] .gitignore
- [x] Contribution guide
- [x] Project overview presentation

Implementation status:
- [x] Frontend initialized (Milestone 1, see below)
- [x] Backend initialized (Milestone 2, see below)
- [x] Local PostgreSQL with Podman (Milestone 2)
- [x] Authentication schema implemented (migration `0002`: roles, permissions, employees, sessions, audit events)
- [ ] Business schema implemented (inventory, batches, suppliers, monitoring, waste)
- [ ] Inventory firmware implemented
- [ ] Waste-bin firmware implemented
- [ ] ESP32-CAM firmware documented
- [ ] Hardware wiring diagrams added
- [ ] Integration tests completed

## Milestone 1: frontend foundation (done)

Implemented and tested with unit tests, Playwright smoke tests and screenshot review:
- [x] Vite + React + TypeScript project with Tailwind CSS v4 and shadcn/ui
- [x] Design tokens from the brand palette for light and dark themes, with automated WCAG AA contrast checks
- [x] Light / Dark / System theme selector, persisted in the browser, with no flash on load
- [x] Public website structure: Home, Products, Product detail, About, Contact
- [x] Management portal layout with role-grouped sidebar, mobile drawer and account menu
- [x] Portal bottom bar below 1024px (Dashboard, Alerts, Inventory, Environment, More); More opens the full module drawer. Tabs set by `MOBILE_TAB_IDS` in `portal-modules.ts`; safe-area insets respected
- [x] Route guards (sign-in redirect, per-page role check) and role-filtered navigation, all driven by one module config
- [x] Staff sign-in form with validation. It calls the API and reports when the server is unreachable.
- [x] Typed API client and TanStack Query setup
- [x] Responsive at 375px and 1440px with no horizontal overflow; skip link and visible focus states
- [x] Layout refinement (2026-11-02): shared `container-page` width (1280px content) across header, sections and footer; header nav centred; balanced two-column hero; public mobile drawer with 44px+ targets, current-page focus, Escape/focus return, scroll lock and a Light/Dark/System control. E2E checks overflow, alignment and bottom-bar clearance at 1440, 1280, 1024, 768, 412 and 375px in both themes
- [x] Browser UI/UX and accessibility review (2026-11-01): every route checked at 375, 1024 and 1440px in light and dark, for all three preview roles. Fixed: sign-in now reports an unreachable server instead of "Not found." when no backend is running; each page has its own browser tab title; focus moves to the new page after navigation; 404s stay inside the public or portal layout; the portal sidebar stays in view on short screens; tap targets are at least 24px; the no-access state has a page heading

Structure only. These show an honest "not connected" state and no data:
- [ ] All portal modules (inventory, batches, expiry, QR, suppliers, environment, pH, waste, camera, employees, alerts, reports, audit log, devices). Each lists what it is waiting on.
- [ ] Public product catalogue (no catalogue API yet)
- [ ] Public bakery contact details and opening hours (`website/frontend/src/config/site.ts`, to be filled in by the owners)

## Milestone 2: backend foundation and PostgreSQL (done)

Implemented and tested (2026-11-02) with backend pytest (unit and PostgreSQL integration tests), the frontend unit and Playwright suites, and manual checks through the Vite proxy:
- [x] `compose.yaml` for podman-compose: PostgreSQL 18, named volume `ecopantry_pgdata`, health check, bound to 127.0.0.1 only, credentials from the git-ignored root `.env`
- [x] FastAPI app in `website/backend/` with an app factory, versioned routes under `/api/v1`, and API docs at `/api/v1/docs` outside production
- [x] Centralized settings (`DATABASE_URL` required, PostgreSQL only, kept out of logs)
- [x] SQLAlchemy 2 engine and per-request sessions over psycopg 3, with connection pre-ping and timeouts; recovers after a database restart
- [x] Alembic set up, reading the URL from settings; initial baseline migration (`0001`, creates no tables) applied
- [x] `GET /api/v1/health` (liveness) and `GET /api/v1/health/ready` (runs a query on PostgreSQL; 503 when unreachable)
- [x] One JSON error shape (`detail`, `code`, optional `errors`) for 404/405/422/500 and app errors; no internals or submitted values in responses
- [x] Vite dev server (and `npm run preview`) proxy `/api/v1` to FastAPI on 127.0.0.1:8000

Not part of Milestone 2:
- [ ] Business tables and endpoints (inventory, batches, suppliers, RFID, monitoring, waste)
- [ ] CORS (not needed while the frontend reaches the API through the same-origin proxy; see the deployment note below)

## Milestone 3: staff authentication and access control (done)

Implemented and tested (2026-11-02) with backend pytest (unit and PostgreSQL integration), frontend unit tests, the Playwright smoke suite and a new full-stack Playwright suite (real browser, Vite proxy, FastAPI, throwaway PostgreSQL database). Design: [AUTH_DESIGN.md](AUTH_DESIGN.md).
- [x] Schema: `roles`, `permissions`, `role_permissions`, `employees`, `auth_sessions`, `audit_events` (migration `0002`, additive; roles and permissions seeded as reference data, no accounts)
- [x] Argon2id password hashing (argon2-cffi, RFC 9106 defaults) with automatic rehash; 12-128 character passwords
- [x] Server-side sessions in PostgreSQL; random token in an HttpOnly, SameSite=Lax cookie (Secure and `__Host-` prefixed in production); only the token's SHA-256 stored
- [x] Idle (60 min) and absolute (12 h) session expiry; revocation on sign-out, deactivation and password change
- [x] CSRF token per session, required in `X-CSRF-Token` on every authenticated unsafe request; login accepts JSON only
- [x] `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password`
- [x] Temporary lockout after 5 wrong passwords; constant-time handling of unknown emails; deactivated accounts refused
- [x] Backend permission checks (`require_permission`), Inspector read-only, a test that fails for any unprotected route
- [x] Staff account API for administrators: list, create, deactivate, reactivate, reset password (last administrator and self-deactivation protected)
- [x] Append-only audit log (DB trigger) for sign-ins, failures, sign-outs, password changes and account changes; no passwords, tokens or unknown emails recorded
- [x] `python -m app.cli` for create-admin (no default account), set-password, deactivate, reactivate, purge-sessions; passwords only by prompt or stdin
- [x] `Cache-Control: no-store` on all API responses
- [x] Frontend: real sign-in, session restore on reload, sign-out through the API, "session ended" handling for any 401, CSRF header on unsafe requests, password change in Settings, clear messages for wrong password, deactivated and locked accounts
- [x] Development preview kept for local layout review, still removed from production builds (checked by grepping `dist/`)

Not part of Milestone 3:
- [ ] Changing an employee's role, and a staff-management screen in the portal (the API exists; the Employees module is still the Phase 9 placeholder)
- [ ] Per-IP rate limiting (belongs in the reverse proxy at deployment)
- [ ] A separate, less-privileged database role for the API (needed to make the audit log tamper-resistant against the app itself)
- [ ] Deployment cookie/CORS setup. Planned hosting puts the frontend and API on different origins; see `docs/OVERNIGHT_REPORT.md` for the options

Not yet implemented:
- [ ] Contact/enquiry form (needs a backend endpoint)
- [ ] Optional customer accounts (would use separate tables; never portal access)

Update this checklist as work is implemented and tested.
