# EcoPantry roadmap

Last audited: 2026-11-02, on `development` at `ae64ffd` (M4 progress added the
same day, uncommitted). Status here is
checked against code, migrations and test runs, not just against what the UI
shows. [PROJECT_STATUS.md](PROJECT_STATUS.md) is the detailed checklist of
what is implemented; this document covers order, dependencies and acceptance
criteria.

Status values:

- **Done**: implemented, and every acceptance criterion has a passing test or a recorded manual check.
- **In progress**: some acceptance criteria are met; the rest are listed.
- **Structure only**: pages or placeholders exist, but no backend, data or tests behind them.
- **Not started**: nothing beyond empty directories.

## Numbering

The original plan is the 14-phase table in the [README](../README.md#development-phases)
and the project overview deck (`EcoPantry_Project_Overview.pptx`, slide 10).
Work since then has been tracked as numbered milestones in `PROJECT_STATUS.md`.
The two numberings differ, because the backend foundation was built before the
public website. This document uses the milestone numbers (M0–M13) and maps
each one to its README phase.

| Milestone | Scope | README phase |
|---|---|---|
| M0 | Repository and project audit | 0 |
| M1 | Frontend foundation and design system | 1 |
| M2 | Backend foundation and PostgreSQL | part of 4 |
| M3 | Staff authentication and role management | 2 |
| M4 | Public website | 3 |
| M5 | Core backend and database (business schema) | rest of 4 |
| M6 | Inventory management | 5 |
| M7 | QR codes, expiry tracking and FEFO | 6 |
| M8 | Dashboard and analytics | 7 |
| M9 | Environmental monitoring (ESP32) | 8 |
| M10 | RFID employees and pH monitoring | 9 |
| M11 | Smart waste bin | 10 |
| M12 | Alerts and notifications (camera dropped) | 11 |
| M13 | Reports, compliance, full integration, testing and deployment | 12 and 13 |

The "Phase N" references in `website/frontend/src/config/portal-modules.ts`
(shown to staff as "Inventory API (Phase 5)") and in `AUTH_DESIGN.md` use the
README numbering. See [decision D1](#decisions-needed).

## Overview

| Milestone | Status | Depends on |
|---|---|---|
| M0 Repository audit | Done | none |
| M1 Frontend foundation | Done | M0 |
| M2 Backend foundation | Done | M0 |
| M3 Staff authentication | Done, with follow-ups | M1, M2 |
| M4 Public website | In progress | M1, M2, M3 |
| M5 Core backend and database | Not started (foundation is M2) | M2, M3 |
| M6 Inventory management | Structure only | M5 |
| M7 QR, expiry and FEFO | In progress (QR labels and scanning; batch lookup waits on M6) | M6 |
| M8 Dashboard and analytics | Structure only | M6, M7 (M9–M11 add panels) |
| M9 Environmental monitoring | Structure only (no firmware) | M5, hardware |
| M10 RFID and pH | Structure only (no firmware) | M9, M3 |
| M11 Smart waste bin | Structure only (no firmware) | M9 |
| M12 Alerts and notifications | Not started | M9, M11 |
| M13 Reports, integration, deployment | Not started | all; deployment decisions D3–D5 |

```text
M0 ─┬─ M1 ─┐
    └─ M2 ─┴─ M3 ─┬─ M4
                  └─ M5 ─┬─ M6 ── M7 ── M8
                         └─ M9 ─┬─ M10
                                ├─ M11 ── M12
                                └─────────┘
                    all ── M13
```

Hardware milestones (M9–M12) also depend on the physical units being built
and wired. They can start in parallel with M6–M8 once M5's device
authentication exists.

## Completed milestones

### M0 Repository and project audit: Done

Verified: directory layout matching the README (`website/`, `hardware/`,
`software/firmware/*`, `docs/`, `tests/`), README, CONTRIBUTING, LICENSE,
`.gitignore` and the overview deck are present.

Note: `hardware/*`, `software/firmware/*`, `docs/diagrams/` and the root
`tests/` directory are still empty.

### M1 Frontend foundation and design system: Done

Verified 2026-11-02, before M4 work: `npm run lint` (0 errors, 1 pre-existing
warning in a generated shadcn file), `npm test` 95 passed, `npm run build` OK
with no preview code in `dist/`, `npm run test:e2e` 180 passed.

Acceptance criteria met: Vite + React + TypeScript, Tailwind v4 + shadcn/ui,
brand tokens for light and dark with WCAG AA contrast tests, persisted
Light/Dark/System selector without flash, public and portal route groups with
lazy loading, portal navigation from one module config, responsive layouts
checked at 375–1440px in both themes, skip link and visible focus.

### M2 Backend foundation and PostgreSQL: Done

Verified 2026-11-02, before M4 work: `.venv/bin/pytest` 113 passed (includes
M3), `alembic check` reports no drift, `alembic current` = `0002`.

Acceptance criteria met: Podman PostgreSQL 18 bound to localhost, FastAPI app
factory, settings with PostgreSQL-only `DATABASE_URL`, SQLAlchemy sessions,
Alembic reading settings, liveness and readiness endpoints, one JSON error
shape, Vite proxy to the API.

### M3 Staff authentication and role management: Done, with follow-ups

Verified 2026-11-02: backend auth, employee, CLI, permission and
route-protection tests (within the 113), frontend auth tests (within the 95),
`npm run test:e2e:fullstack` 11 passed against real FastAPI and a throwaway
database. Design: [AUTH_DESIGN.md](AUTH_DESIGN.md).

Acceptance criteria met: Argon2id passwords, PostgreSQL sessions in an
HttpOnly cookie, CSRF on unsafe requests, lockout, deactivation, backend
permission checks with a test that fails for any unprotected route,
read-only Inspector, append-only audit log, admin bootstrap CLI with no
default account, real portal sign-in with session restore and password change.

Follow-ups, tracked here so they aren't lost:

| Item | Status | Planned in |
|---|---|---|
| Staff-management screen (list, create, deactivate, reactivate, reset password) | A Users page was added later (list, create, role change, hard delete), but it has no deactivate/reactivate or password reset, and its delete breaks the never-delete rule. | Being fixed next (see Next milestone) |
| Changing an employee's role | `PATCH /employees/{id}` and the Users page exist, but write no audit event, don't end sessions and can demote the last administrator | Being fixed next |
| Role/permission management screen | Not implemented. See decision D2. | Depends on D2 |
| Production API routing, cookie and CORS setup | Decided (D15): Firebase Hosting calls Render cross-origin; CORS allow-list and SameSite=None cookie | Done when the deployment checks pass, including iPhone Safari (docs/DEPLOYMENT.md) |
| Per-IP rate limiting and trusted-proxy client IPs | Not implemented; belongs in the reverse proxy | M13 |
| Separate least-privilege database role for the API (audit tamper-resistance) | Not implemented | M13 |
| Scheduled session cleanup (`app.cli purge-sessions`) | Command exists, not scheduled | M13 |

## Remaining milestones

### M4 Public website: In progress

Goal: a public site customers can browse without signing in, showing only
explicitly public bakery and catalogue data.

Already in place (from M1): Home, Products, Product detail, About and Contact
pages, responsive layout, theme selector, honest empty states, and contact
details read from `src/config/site.ts` (all `null` until the owners provide
them).

Acceptance criteria:

1. Public catalogue schema, separate from ingredient inventory: categories and
   finished products with name, URL slug, summary, description, optional price
   with currency, and draft/published state.
2. Public read endpoints that return only published products and only public
   fields. Listed in the route-protection test's public list, with tests
   proving drafts and internal fields never appear.
3. Staff endpoints to create, edit, publish, unpublish and delete products and
   categories, behind a new permission (Administrator only), recorded in the
   audit log, CSRF-protected.
4. Portal screen for administrators to manage the catalogue.
5. Products page lists published products with search and category filter;
   product detail by slug; loading, empty, no-match, not-found and
   server-unreachable states.
6. Public pages never call auth endpoints and never send the staff session
   cookie to catalogue endpoints.
7. Product images. Waiting on decision D6.
8. Contact/enquiry form. Waiting on decision D7.
9. Real bakery contact details, opening hours and About text, supplied by the
   owners. Not a code task.
10. Unit, backend integration, Playwright smoke (375/1440, light/dark) and
    full-stack tests for the above.

Status 2026-11-02: criteria 1–6 and 10 are met (migration `0003`, the
`public` and `catalogue` routes, the portal Public catalogue module, the real
Products and product pages). Verified with backend `pytest` 156 passed,
`npm test` 116 passed, `npm run test:e2e` 204 passed and
`npm run test:e2e:fullstack` 19 passed. Criteria 7–9 stay open until the
decisions are made or the content is supplied. M4 is not complete until then.

### M5 Core backend and database: Not started

Goal: the business schema and shared backend pieces that M6–M12 build on.

Acceptance criteria:

1. Documented entity-relationship design for all business data: ingredients,
   units, storage areas, batches, stock movements, devices, sensor readings,
   thresholds, alerts, waste records, pH records, RFID cards. In-shop only:
   no suppliers (D14).
2. Migrations for the core reference tables (ingredients, units, storage
   areas) with constraints, plus CRUD APIs, permissions, audit events and
   tests.
3. Shared API conventions: pagination, filtering, sorting and validation
   errors, documented and tested once.
4. Device registry and device authentication (per-device credential, stored
   hashed, rotation, last-seen time) for ESP32 endpoints, separate from staff
   sessions. Devices never reach the database directly.
5. `audit_events` can target any record type, not only employees.

Status 2026-11-06: criterion 4 is done ahead of the rest (migration `0004`, `app/auth/device.py`, see [HARDWARE_INTEGRATION.md](HARDWARE_INTEGRATION.md)), and criterion 5 was done in M4. The device, sensor-reading and RFID-card tables are designed and migrated. The other business tables are not.

### M6 Inventory management: Structure only

Depends on M5. Acceptance criteria:

1. Batches linked to an ingredient and an optional storage area (fridge,
   freezer, shelf), with received date, expiry date, quantity and remaining
   quantity.
2. Stock-in, stock-out and adjustment movements; remaining quantity can't go
   negative; every movement attributed to an employee and audited.
3. Low-stock status from reorder levels.
4. Portal screens for Inventory and Batches with role-aware
   controls (Inspector read-only, enforced by the backend).
5. Backend, unit, smoke and full-stack tests.

### M7 QR codes, expiry tracking and FEFO: In progress

Depends on M6. Acceptance criteria:

1. Printable QR label per batch, encoding an opaque batch reference only (no
   stock data in the code).
2. Browser camera scanning that opens the batch. Scanning never changes stock
   by itself.
3. Near-expiry and expired lists with configurable windows.
4. FEFO recommendation per ingredient, computed by the backend, tested on edge
   cases (equal dates, partially used batches, expired batches excluded).

Status 2026-11-02 (built ahead of M6, see [QR_LABELS.md](QR_LABELS.md)): the
label format (opaque 10-character code, nothing else in the QR), printable
label sheets, the camera scanner with manual entry, and the protected lookup
endpoint `GET /batches/by-label/{code}` (`batches.view`, answers 501 until
batches exist) are done and tested. Criterion 1 is met for the label itself,
but labels are made from typed values until M6 assigns codes to real batches.
Criterion 2 is met up to the batch lookup, which needs M6. Criteria 3 and 4
are not started. Not tested on physical devices or real Safari.

### M8 Dashboard and analytics: Structure only

Depends on M6 and M7; M9–M11 add their panels later. Acceptance criteria:

1. Dashboard shows real counts: low stock, near-expiry, open alerts.
2. Recharts installed with this milestone; charts use design tokens only and
   are checked in both themes.
3. No placeholder figures. Panels without data show empty states.

### M9 Environmental monitoring: In progress

Depends on M5 (device auth) and the inventory-station hardware (DHT11, decision D8). Acceptance criteria:

1. Firmware in `software/firmware/inventory-esp32/` (PlatformIO, Arduino)
   posting temperature and humidity to an authenticated endpoint.
2. Backend validates readings and timestamps, stores them, evaluates
   thresholds and raises alerts.
3. Portal environment page with history, thresholds, last-update time and
   offline/stale states from real communication.
4. Wiring diagram in `hardware/inventory-station/`; tested with real readings.

Status 2026-11-06:
- **Criterion 1 is met in code.** The firmware builds and its core logic is unit-tested on the host, but it hasn't been flashed and run against the API yet.
- **Criterion 2 is partly met.** Readings are validated, timestamped and stored, under live sessions. Thresholds and alerts are not built.
- **Criterion 3:** see PROJECT_STATUS.md for the portal pages.
- **Criterion 4:** the wiring is documented; tests with real readings are still to do.

### M10 RFID employees and pH monitoring: In progress (cards, taps and pH readings stored; no pH records workflow)

Depends on M9 (same ESP32) and M3. Acceptance criteria:

1. `rfid_cards` table linked to employees; card assignment and revocation by
   administrators; RFID is identification, not authentication.
2. Operations attributed by card scan where required.
3. pH records with sample, reference range, operator and calibration notes,
   clearly marked experimental; never used alone to call food safe or spoiled.
4. Staff-management screen (M3 follow-up) delivered here at the latest.
5. MFRC522 at 3.3 V and pH ADC limits documented in the wiring.

### M11 Smart waste bin: In progress (bin weight only, from the inventory station)

Depends on M9. Acceptance criteria:

1. Firmware sending the bin weight (HX711) to an authenticated endpoint
   (done, through the inventory station).
2. Calibration procedure against the actual bin, recorded.
3. "Nearly full" alert at about 2 kg: a portal alert (clears below 1.5 kg)
   and a local LCD and LED/buzzer warning on the station that works even
   outside a live session.
4. Waste records with category, reason, employee and time.
5. Portal waste page with history and bin status.

### M12 Alerts and notifications: Not started

The ESP32-CAM camera was dropped from the project on 2026-11-09 (D14).

Depends on M9 (alert engine) and M11. Acceptance criteria:

1. Alerts page: open, acknowledged and resolved alerts from all rules;
   acknowledgement recorded against the employee.
2. Notification channel, if any, decided first (decision D9).

### M13 Reports, compliance, integration, testing and deployment: Not started

Depends on all other milestones. Acceptance criteria:

1. Stock, expiry, environment and waste reports with CSV and PDF export.
2. Audit log viewer with filtering (Inspector and Administrator).
3. End-to-end demonstration of the full workflow with real hardware.
4. Deployment: hosting, API routing, cookies/CORS, TLS, rate
   limiting, trusted proxy IPs, least-privilege database role, backups,
   scheduled session cleanup, secrets management.
5. Documentation updated for setup, wiring and operation.

## Next milestone

**M5 Core backend and database** (in-shop schema), together with fixing the
staff-management and registration code added after M3 so it follows the
rules again (no hard delete, no unverified self-registration, audited role
changes). M4 is waiting only on owner content and decisions D6/D7.

## Blockers

- Owner-supplied content (bakery contact details, opening hours, About text,
  product list, photos). The site hides these until they exist.
- Product images (D6) and the contact form (D7) need decisions before they
  can be built.
- Hardware checks need the physical station (one ESP32, DHT11, bin load cell), which exists but hasn't run against the API yet.

## Decisions needed

| # | Decision | Recommendation |
|---|---|---|
| D1 | Which numbering is canonical: README phases or milestones | Use milestones (M0–M13) everywhere and update the README table and the "Phase N" texts in the portal |
| D2 | Should roles and permissions be editable in the portal? | No. Keep the three fixed roles in code and migrations; allow changing an employee's role only. Editable permissions would break the backend/test mirror and are risky for a prototype. |
| D3 | Production API routing | Superseded by D15. (Was: Vercel forwards `/api/v1/*` to Render, same origin.) |
| D4 | Hosting confirmation | Render free web service (API) and Neon free PostgreSQL (no 30-day expiry, unlike Render's free database) still stand; the website host changed to Firebase (D15). See [DEPLOYMENT.md](DEPLOYMENT.md). |
| D5 | When to deploy a preview | **Decided:** now, for the project demonstration, from the `development` branch |
| D6 | Product image storage | Store uploads behind the API (validated type and size, re-encoded) in object storage chosen with D4; until then, no images |
| D7 | Contact form: store enquiries, email them, or both; spam protection; retention period; who reads them | Store in PostgreSQL, readable by administrators in the portal, honeypot field plus proxy rate limiting, 12-month retention, privacy note on the form |
| D8 | Exact DHT sensor model | **Decided (2026-11-06):** DHT11, read with the Adafruit DHT library |
| D12 | Prototype hardware layout | **Decided (2026-11-06):** one ESP32 carries the inventory-station sensors and the waste-bin load cell (see [HARDWARE_INTEGRATION.md](HARDWARE_INTEGRATION.md)). A separate waste-bin controller only if the bin moves. |
| D13 | Keeping free-tier hosting asleep | **Decided (2026-11-06):** stations upload only in live sessions (power-on 5 min, card tap 15 min, 240 min per day), enforced by the backend |
| D9 | Alert notification channel (email, SMS, none) | Portal-only alerts for the prototype |
| D10 | Who manages the public catalogue | Administrators only (implemented that way; adding Storekeepers is one migration) |
| D11 | Allergen and ingredient information on public product pages | Leave out until the owners can supply verified information; wrong allergen data is a safety risk |
| D14 | Scope cut | **Decided (2026-11-09):** inventory is in-shop only (no suppliers); the HC-SR04 ultrasonic fill level and the ESP32-CAM are dropped; the waste bin raises a "nearly full" alert at about 2 kg of weight |
| D15 | Website hosting | **Decided (2026-11-09):** keep the live setup: Firebase Hosting (`ecopantry-a7342.web.app`) and Firebase Auth for Google sign-in, calling the Render API cross-origin with a CORS allow-list and a SameSite=None cookie. If iPhone Safari blocks that cookie, move both onto one custom domain. |
