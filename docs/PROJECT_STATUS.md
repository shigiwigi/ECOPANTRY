# Project status

Milestone order, dependencies and acceptance criteria: [ROADMAP.md](ROADMAP.md).
Milestone numbers here (M1, M2, ...) are the roadmap's; the README phase
numbers differ (the roadmap maps them).

Last verified 2026-11-09, on `development` after the M5–M13 work (see "Build-out of 2026-11-09" below): backend `pytest` 529 passed, `alembic check` clean through `0009`; frontend lint (0 errors), `npm test` 305 passed, build OK with no preview code; Playwright results are listed in that section. Earlier figures, for reference (2026-11-02): backend `pytest` 184
passed, `alembic check` clean (no new migration; development database at
`0003`); frontend lint (0 errors), `npm test` 200 passed, build OK with no
preview code in `dist/`; `npm run test:e2e` 302 passed (1 skipped:
Firefox-only); `npm run test:e2e:fullstack` 23 passed; `npm run
test:e2e:browsers` Firefox and Android emulation 596 passed (10 skipped:
Chromium-only fake-camera and desktop-only tests). Playwright WebKit doesn't
start on this host.

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
- [x] Public catalogue schema implemented (migration `0003`: catalogue categories and products, `catalogue.manage` permission)
- [x] Business schema implemented (migrations `0005`–`0009`: units, ingredients, storage areas, batches, stock movements, thresholds, alerts, waste and pH records, enquiries). No suppliers: inventory is in-shop only
- [x] Inventory firmware implemented (`software/firmware/inventory-esp32/`: one ESP32 with DHT11, HX711 bin weight, pH, MFRC522, LCD; builds and its core logic is unit-tested; not yet run against the API on the real board)
- [x] Waste-bin weight read by the inventory station (no separate bin controller). The HC-SR04 fill level and the ESP32-CAM were dropped on 2026-11-09
- [x] Inventory-station wiring added (`hardware/inventory-station/README.md`)
- [ ] Integration tests completed (backend, browser and full-stack suites exist and pass locally; the live-URL checks and the hardware demo are still open)

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
- [ ] Remaining portal modules (inventory, batches, expiry, alerts, reports, audit log). Each lists what it is waiting on. The suppliers and camera modules are to be removed (scope cut, 2026-11-09).
- [x] Public product catalogue (done in Milestone 4, below)
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
- [x] Deployment cookie/CORS setup: changed after M3 to Firebase Hosting calling Render cross-origin, with a CORS allow-list and a SameSite=None cookie (see Deployment below)

## Milestone 4: public website (in progress)

Acceptance criteria and open decisions: [ROADMAP.md](ROADMAP.md#m4-public-website-in-progress).

Implemented and tested (2026-11-02) with backend pytest (unit and PostgreSQL integration), frontend unit tests, the Playwright smoke suite (fixture catalogue, 375/1440px, light and dark) and the full-stack Playwright suite:
- [x] Schema: `catalogue_categories` and `catalogue_products` (migration `0003`, additive, no seeded products). Separate from ingredient inventory; no link to stock, batches or suppliers. Constraints: slug format, non-blank names, price ≥ 0 with a 3-letter currency (both or neither), published state matching `published_at`
- [x] Permission `catalogue.manage`, Administrator only (migration and `app/auth/permissions.py`)
- [x] Public endpoints `GET /api/v1/public/catalogue` and `GET /api/v1/public/catalogue/products/{slug}`: published products only, explicit public fields only, drafts answer exactly like missing products, no session cookie read
- [x] Staff endpoints under `/api/v1/catalogue` for products (list, create, partial update, publish/unpublish, delete) and categories (list with counts, create, rename, delete when empty); CSRF-protected; every change in the audit log (`audit_events` can now target any record type)
- [x] Portal "Public catalogue" module (Administrator only): product list with Published/Draft status, add/edit sheet with validation, publish/unpublish, delete with confirmation, category management
- [x] Products page: published products with search (ignores case and accents) and category filter, both kept in the URL; loading, empty, no-match and server-unreachable states with retry
- [x] Product page by slug with price, summary and description; not-found and unreachable states
- [x] Public pages never call auth endpoints and send catalogue requests without cookies (unit and e2e tests)

Not done yet:
- [ ] Product images (decision D6 in the roadmap)
- [ ] Contact/enquiry form (decision D7)
- [ ] Owner content: contact details, opening hours, About text, the real product list
- [ ] Allergen and ingredient information on product pages (decision D11)

Not yet implemented:
- [ ] Optional customer accounts (would use separate tables; never portal access)

## Milestone 7: QR labels and scanning (started ahead of M6)

Format, permissions, browser results and the M6 contract: [QR_LABELS.md](QR_LABELS.md).

Implemented and tested (2026-11-02):
- [x] Label format `ECOPANTRY:BATCH:<10-character code>`: opaque, random, nothing else in the QR; same rules in backend and frontend
- [x] `GET /api/v1/batches/by-label/{code}` behind `batches.view` (every role): session and code checked, then `501 batch_lookup_unavailable` until batch records exist
- [x] Portal QR scanner page (`/portal/scan`): camera on request only, rear camera preferred, camera picker after permission, every track stopped on stop, read, leaving, hidden tab or unplugging; explained errors (blocked, dismissed, no camera, busy, disconnected, HTTPS needed, unsupported); manual entry
- [x] Portal QR labels page (`/portal/qr`, administrators and storekeepers): labels from typed values (clearly marked as not linked to batches), copies, preview, print-only sheet through the browser's print dialog
- [x] Tests: backend pytest, unit tests (including encode → decode round trip), Playwright with a fake camera playing a real label (Chromium), Firefox fake camera, Android emulation, full-stack lookup with real roles and an ended session

Not done yet:
- [ ] Batch lookup returning real batches (needs M6 batch records and `label_code`)
- [ ] Labels printed from batch records instead of typed values
- [ ] Physical device and real Safari, Edge, Chrome-on-Android testing (checklist in QR_LABELS.md)
- [ ] Expiry lists and FEFO

## Hardware integration: inventory station (M5 device auth, M9–M11, started 2026-11-06)

How it fits together: [HARDWARE_INTEGRATION.md](HARDWARE_INTEGRATION.md).

Implemented and tested:
- [x] Migration `0004`: `devices`, `device_live_usage`, `sensor_readings`, `rfid_cards`, `rfid_scans`; audit events may have a `device` actor
- [x] Device authentication: per-device bearer token, SHA-256 stored, shown once, rotation, disable/enable, last seen, firmware version. Staff cookies and device tokens are refused on each other's routes.
- [x] Live sessions:
  - uploads only while live: power-on 5 min, card tap 15 min
  - per-device daily budget of 240 min
  - 409 `session_not_live` outside a session, 429 for uploads that are too fast
  - administrators can stop a session
- [x] Readings: batches of up to 50, server timestamps from the station's uptime offsets, range checks, failed sensors stored as NULL
- [x] Portal API: stations with their latest reading and stale flag, and bucketed history (1 h, 6 h, 24 h, 7 d), each metric behind its own view permission
- [x] RFID: card assignment and revocation by administrators, server-side card check on every tap, every tap recorded
- [x] CLI: `create-device`, `rotate-device-token`, `list-devices`
- [x] Backend tests: `tests/test_devices.py`, `tests/test_sensors_and_cards.py`, CLI tests
- [x] Firmware (`software/firmware/inventory-esp32/`):
  - built on espressif32 8.0.0 with pinned libraries
  - network on its own FreeRTOS task; HTTPS with pinned root CAs
  - session state machine; offline buffer; serial calibration saved in NVS
  - 19 host unit tests (`pio test -e native`)
- [x] Wiring and cautions: `hardware/inventory-station/README.md`
- [x] Portal pages:
  - **Environment, pH (experimental warning) and Waste:** live tiles, live/paused/stale/no-data states, and Recharts history with range buttons and a text summary. They poll every 5 s while live and every 60 s otherwise.
  - **Devices (admin):** register, show the token once, rotate, disable, stop live.
  - **Employees:** card assignment from recently tapped UIDs, revoke, and the tap log. Inspectors get a read-only view.
  - **Dashboard:** a real station panel replaces the "Sensors Live" card, which had no data behind it.
- [x] Frontend tests: `src/features/sensors/sensors.test.tsx` (16 tests), and `e2e/fullstack/sensors.fullstack.ts`, where a real backend receives station uploads and card taps. Charts checked in light and dark screenshots.


- [x] Firmware 0.2.0 (2026-11-09): WiFi/API/token setup hotspot in NVS (no `secrets.h`), 401 reopens setup, BOOT-hold and serial `setup` / `wifi reset` / `factory reset`; local "bin nearly full" warning (2.0 kg on, 1.5 kg off, LCD page + red LED + rate-limited beep). Logic host-tested (51 native tests); builds for `esp32dev` and `esp32dev-lan`. **Not yet tested on a real board**: hotspot, captive portal, BOOT button, buzzer/LED, load-cell thresholds.

Not done yet:
- [ ] Flash the firmware and run it against the API on the real station (local LAN first, then Render)
- [ ] Thresholds and alerts on readings, including the waste bin "nearly full" alert at about 2 kg (portal alert plus a local station warning)
- [ ] Waste records, pH records workflow
- [ ] Data retention for `sensor_readings` (one row per 10 s while live, about 2 MB per live day)

## Deployment (live on Firebase Hosting + Render + Neon, checks not yet run)

Guide, environment variables, costs and checks: [DEPLOYMENT.md](DEPLOYMENT.md).

Prepared and checked locally (2026-11-02):
- [x] `render.yaml` (Render free web service, Singapore, Python 3.14.3, migrations on start, health check)
- [x] Production rehearsal: the committed backend files built in a fresh venv with `pip install .`, started with the Render start command and `ENVIRONMENT=production` against an empty throwaway database (migrations `0001`–`0003` applied, API docs 404, `no-store` on responses), served the production build through a same-origin proxy: `__Host-` Secure HttpOnly SameSite=Lax cookie, CSRF refusals (403), Storekeeper/Inspector permission refusals (403), admin CLI with `DATABASE_URL` overriding the local `.env`, the documented staff-account `curl` recipe, data kept and no migration re-run after a restart
- [x] Rehearsal repeated after the QR work (2026-11-02): same results; production build has no preview code and no localhost URLs; QR lookup answers 501 through the proxy
- [x] Hosting changed after the rehearsal: the website is on Firebase Hosting (`website/frontend/firebase.json`, SPA routing, security headers, COOP for the Google popup) and calls the API cross-origin. `vercel.json` removed (2026-11-09)
- [x] Live (checked 2026-11-09): `https://ecopantry-a7342.web.app` and `https://ecopantry-api.onrender.com/api/v1/health` both answer 200

Not done yet:
- [ ] The checklist in DEPLOYMENT.md run on the real URLs, including iPhone Safari (cross-site cookie) and a physical phone for the QR camera
- [ ] Google sign-in on the live site (the production build env had no `VITE_FIREBASE_*` values on 2026-11-09)

## Build-out of 2026-11-09 (M3 fixes, M5–M10, M12, M13 reports, CI)

Built by parallel agents on separate branches, merged into `development` and verified together. Spec of each area: [ROADMAP.md](ROADMAP.md), [DATA_MODEL.md](DATA_MODEL.md).
- [x] **Staff and auth fixes:** no self-registration and no employee delete (staff are deactivated); role change is audited, ends that employee's sessions and protects the last administrator; Users page rebuilt (list, create, change role, deactivate/reactivate, reset password); role ids are `admin` / `storekeeper` / `inspector` everywhere; CORS origins and the Firebase project id are settings; Firebase loads only on Google sign-in (main bundle 560 KB to 466 KB)
- [x] **Inventory (M6):** ingredients, units, storage areas; batches with random label codes; stock in / out / adjust with a row lock, one movement and one audit event each, never below zero; low-stock flag; Inventory and Batches pages; labels print from batch records; scanner opens the batch; `GET /batches/by-label/{code}` returns 200 or 404 (no longer 501)
- [x] **Expiry and FEFO (M7):** near-expiry and expired lists, summary, FEFO recommendation with a pick list, Expiry page
- [x] **Alerts (M9/M12):** thresholds evaluated on each device upload in the same transaction, one alert per threshold and station, hysteresis, acknowledge, Alerts page, admin limits editor. Seeded: **bin weight at 2000 g or more opens "Waste bin nearly full", clears below 1500 g**. Waste page banner and chart reference line
- [x] **Records (M10/M11):** waste records and pH records (pH marked experimental, no verdict) with forms on the Waste and pH pages
- [x] **Contact form (M4):** `POST /public/enquiries` (hidden spam-trap field, in-process rate limit), admin enquiries inbox, 12-month purge command. Also `purge-readings`
- [x] **Audit log viewer (M13):** `GET /audit` and a filtered page for administrators and inspectors
- [x] **Dashboard (M8):** `GET /dashboard/summary` and real tiles; no placeholder figures
- [x] **Reports (M13):** stock, expiry, environment and waste reports with JSON preview and CSV / PDF export (administrators and inspectors; each export is audited). PDF by ReportLab (decision: pure-Python wheels, no system libraries on Render; fpdf2 and WeasyPrint were the alternatives). pH is left out of reports
- [x] **Firmware 0.2.0:** see the hardware section
- [x] **CI:** `.github/workflows/ci.yml` (backend, frontend, full-stack e2e, firmware). Has not yet run on GitHub
- [x] **Browser suites** brought in line with the real pages: dashboard heading and padding, shared sign-in messages, a theme-selector radio that sat off-screen, and specs that now create real batches

Known gaps and caveats:
- [ ] The new pages have not been looked at by a person at 375 px and in dark mode (the automated layout checks pass)
- [ ] Waste records that name a batch don't yet reduce its stock; forms take a pasted batch id (no picker)
- [ ] No portal screens for storage areas, ingredient edit/deactivate, or creating alert limits
- [ ] Expiry, low-stock and device-offline alerts are not built
- [ ] "Today" is the server's UTC date; a shop timezone setting may be needed
- [ ] The purge commands (`purge-sessions`, `purge-enquiries`, `purge-readings`) are not scheduled
- [ ] Per-IP rate limiting for the contact form is in-process only; Render's proxy address means it acts as a cap on all submissions

## Portal navigation and layout (2026-11-02)

- [x] Top bar: QR scanner shortcut instead of the theme button; theme moved into the account menu (and still in Settings)
- [x] Environment listed second, under Overview; Alerts moved from the mobile bottom bar into the navigation list; bottom bar is Dashboard, Inventory, Environment, More
- [x] Portal content uses the full width beside the sidebar; dashboard cards fill columns at a readable width
- [x] Public footer: one compact band aligned with the header grid
- [x] Playwright layout checks at 375–1920px and at 125/150/200% zoom

Update this checklist as work is implemented and tested.
