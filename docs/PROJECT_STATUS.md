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
- [ ] Database schema implemented (only an empty baseline migration so far)
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
- [x] Route guards (sign-in redirect, per-page role check) and role-filtered navigation, all driven by one module config
- [x] Staff sign-in form with validation. It calls the API and reports when the server is unreachable.
- [x] Typed API client and TanStack Query setup
- [x] Responsive at 375px and 1440px with no horizontal overflow; skip link and visible focus states
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
- [ ] Business tables and endpoints (inventory, batches, suppliers, RFID, monitoring, waste, audit)
- [ ] Authentication and backend role checks. While the backend is running, staff sign-in shows "Not found." because `/auth/login` doesn't exist yet.
- [ ] CORS (not needed while the frontend reaches the API through the same-origin proxy)

Not yet implemented:
- [ ] Real authentication. Sign-in has no backend endpoint yet; a development-only preview session exists for layout review.
- [ ] Contact/enquiry form (needs a backend endpoint)
- [ ] Optional customer accounts

Update this checklist as work is implemented and tested.
