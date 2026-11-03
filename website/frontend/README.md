# EcoPantry frontend

React + TypeScript + Vite app containing the public bakery website (`/`) and the
staff management portal (`/portal`). See the repository `CLAUDE.md` for the
design-system rules and architecture.

## Setup

Requires Node.js 22.22+ (React Router 8 and Vitest 5 minimum; developed on Node 24).

```bash
npm install
cp .env.example .env.local   # then edit; .env.local is git-ignored
npm run dev                   # http://localhost:5173
```

The dev server proxies `/api/v1` to FastAPI at `http://127.0.0.1:8000`
(change it with `API_PROXY_TARGET` in `.env.local`), so the browser talks to
the API on the same origin. Start the backend as described in
`website/backend/README.md`. Without it, API calls get a 502 from the proxy
and the app shows "Can't reach the EcoPantry server". The Playwright tests
point the proxy at a closed port, so they don't depend on a running backend.

## Staff sign-in

The portal signs in against the real backend. Create the first account with
`python -m app.cli create-admin` (see `website/backend/README.md`), then sign
in at http://localhost:5173/portal/sign-in.

- The session is an HttpOnly cookie set by FastAPI. The frontend never reads
  it and stores nothing about the session in localStorage or sessionStorage.
- `POST /auth/login` and `GET /auth/me` return a CSRF token, which
  `src/lib/api/client.ts` keeps in memory and sends as `X-CSRF-Token` on every
  POST/PUT/PATCH/DELETE.
- Public pages never call the auth endpoints. The Products pages read the
  published catalogue from `GET /api/v1/public/*` with `credentials: "omit"`,
  so the staff cookie is never sent from the public site
  (`src/features/catalogue/public.ts`). The first visit to `/portal` asks
  `GET /auth/me` whether a session exists (so reloads stay signed in).
- Any API response of 401 means the server ended the session; the app goes
  back to sign-in, says so, and returns to the same page after signing in.
- Signing out calls `POST /auth/logout`. If the server can't be reached, the
  portal says you are still signed in instead of pretending.
- Role and permission checks in the UI only hide things. The backend refuses
  every request the role isn't allowed to make.

To review portal layouts without a backend, set `VITE_PORTAL_PREVIEW=true` in
`.env.local`. This creates a development-only preview session with a role
switcher and a warning banner. It is removed from production builds (check
with `grep -r "Development preview" dist/` after `npm run build`; it should
find nothing) and has no session cookie, so the API refuses all its requests.

## QR scanner and labels

The portal's QR scanner (`/portal/scan`, every role) reads batch labels with
the device camera, and the QR labels page (`/portal/qr`, administrators and
storekeepers) makes printable labels. Label format, permissions, browser
results and the M6 API contract: `docs/QR_LABELS.md`.

Browsers only allow the camera on HTTPS or `http://localhost`. To try the
scanner from a phone on your network during development:

```bash
# .env.local: DEV_HTTPS=true
npm run dev -- --host        # prints https://<LAN address>:5173
```

Open that address on the phone and accept the self-signed certificate
warning (it is generated per machine and only for development). Over plain
`http://<LAN address>` the scanner shows "The camera needs a secure
connection" and offers manual entry instead.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check (`tsc -b`) and production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run lint` | oxlint |
| `npm test` | Vitest unit tests (theme, routing and roles, token contrast) |
| `npx vitest run src/app/routes.test.tsx` | A single test file (add `-t "name"` for one test) |
| `npm run test:e2e` | Playwright smoke tests: every route at 375px and 1440px in light and dark (uses the preview and a fixture catalogue, no backend) |
| `npm run test:e2e:fullstack` | Playwright against the real backend: sign-in, sign-out, reloads, roles, CSRF, deactivation, password change, catalogue management, the public product pages and the QR batch lookup |
| `npm run test:e2e:browsers` | The QR and smoke suites in Firefox (with its fake camera), Chromium emulating an Android phone, and WebKit (needs `npx playwright install firefox webkit`; pick one with `--project`) |

Before the first `test:e2e` run, install the browser once with
`npx playwright install chromium`. Screenshots from the e2e run are written to
`e2e/.screenshots/` (git-ignored) for visual review. The QR tests in
`e2e/qr.spec.ts` give Chromium a fake camera that plays a video of a real
label (`e2e/fake-camera.ts`), so scanning is tested end to end.

`test:e2e:fullstack` needs the PostgreSQL container running and the backend
set up (`website/backend/.env` and `.venv`). It starts
`website/backend/scripts/e2e_server.py`, which creates a throwaway
`ecopantry_test_e2e` database with test accounts (random password per run),
and a Vite server proxying to it. The database is dropped when the run ends;
your development data is never used.

## Structure

```text
src/
  app/            router (routes.tsx) and providers
  config/         portal-modules.ts (portal nav, routes, roles), site.ts (public bakery details)
  features/auth/  session context, route guards, sign-in, password change, roles
  features/theme/ light/dark/system preference and controls
  features/catalogue/ public catalogue reads (public.ts, in the public bundle) and portal management (staff.ts, ProductSheet)
  features/qr/    batch label format, QR encoding, camera scanner hook, label sheet, batch lookup
  lib/api/        typed fetch client for the FastAPI backend
  components/ui/  shadcn/ui components (generated, then adjusted)
  components/     shared layout and common components
  pages/public/   customer website pages
  pages/portal/   management portal pages
  styles/         globals.css: design tokens for both themes
```

Add shadcn components with `npx shadcn@latest add <name>`. They use the
semantic tokens in `src/styles/globals.css`.
