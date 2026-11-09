# Deployment

How EcoPantry is hosted for the project demonstration on free plans, and how
to update, check and remove it. Nothing here costs money. If any dashboard asks
for a card or offers a paid plan, stop and pick the free option (or ask).

Status: deployed. The website is live on Firebase Hosting and the API on
Render, but the checks in [Verify the deployment](#6-verify-the-deployment)
have not all been run on the real URLs yet.

| Part | Host | Address |
|---|---|---|
| Website | Firebase Hosting (project `ecopantry-a7342`) | `https://ecopantry-a7342.web.app` (also `.firebaseapp.com`) |
| API | Render free web service `ecopantry-api` | `https://ecopantry-api.onrender.com/api/v1` |
| Database | Neon free PostgreSQL | connection string only in Render's `DATABASE_URL` |
| Google sign-in | Firebase Authentication (same project) | |

## Architecture

```text
 phone / laptop browser
   │ HTTPS                                   │ HTTPS, cross-origin (CORS),
   ▼                                         ▼ session cookie + X-CSRF-Token
 Firebase Hosting (website)          Render (FastAPI, free web service)
   static React build                  │ TLS
   https://ecopantry-a7342.web.app     ▼
                                     Neon (PostgreSQL, free plan)
 ESP32 station ── HTTPS + device token ──► Render (no cookies, no CORS)
```

- **Firebase Hosting** serves the built React app (`website/frontend/firebase.json`):
  single-page-app routing, security headers (camera allowed for this site only,
  for the QR scanner), long caching for hashed `/assets/**`, and
  `Cross-Origin-Opener-Policy: same-origin-allow-popups` so the Google sign-in
  popup can report back. Firebase Hosting cannot forward `/api/v1` to Render, so
  the website calls the API on its own address.
- **The website and the API are on different sites**, so:
  - The production build sets `VITE_API_BASE_URL=https://ecopantry-api.onrender.com/api/v1`
    (`src/lib/api/client.ts`).
  - The API allows exactly the Firebase origins (and the local dev server)
    through CORS with credentials (`app/factory.py`). Any other origin gets no
    CORS headers.
  - The session cookie is `__Host-ecopantry_session`: Secure, HttpOnly,
    **SameSite=None** (`app/auth/cookies.py`), so the browser sends it on the
    cross-site API calls. Every unsafe request must also carry the
    `X-CSRF-Token` header, which a page on another origin can't read or set.
  - **Risk:** to the browser this is a third-party cookie. Safari (and so every
    browser on iPhone) blocks third-party cookies by default, so staff
    sign-in may not stick there. Check 7 below tests it. If it fails, the fix
    is a custom domain that puts both on one site (for example
    `app.<domain>` on Firebase and `api.<domain>` on Render), after which the
    cookie can go back to SameSite=Lax.
- **Render** runs the API from `render.yaml`. `ENVIRONMENT=production` turns on
  Secure cookies, refuses insecure cookie settings and turns off the interactive
  API docs (`/api/v1/docs` answers 404 in production on purpose).
- **Neon** holds all data. Render's disk is temporary, but nothing is stored on
  it, so restarts and redeploys lose nothing.
- Region: Render `singapore` and Neon AWS Asia Pacific (Singapore), the closest
  region to Sri Lanka that both offer. Keep them in the same region.

## Costs and free-plan limits

Checked 2026-11-02. Plans change; check the providers' pages before relying on
the exact numbers.

| Service | Plan | Cost | Limits that matter for the demo |
|---|---|---|---|
| Firebase | Spark (free) | $0, no card | Hosting: 10 GB stored, 360 MB transferred a day. Authentication: Google sign-in included. |
| Render | Free web service | $0 | Sleeps after 15 min without requests; the next request takes about a minute to wake it. 750 free hours a month. 512 MB RAM. No shell and no pre-deploy step on this plan. |
| Neon | Free | $0, no card | 1 GB storage and 100 compute-hours a month per project. Compute suspends after 5 min idle and wakes in under a second. Running out of hours suspends the database until next month; it does not delete data. |

Why not Render's own PostgreSQL: Render's free database expires 30 days after
it is created and is deleted, with all its data, 14 days later. It has no
backups. Neon's free plan is permanent, so the demo data survives until the
project is over.

**Before a demo:** open `https://ecopantry-api.onrender.com/api/v1/health/ready`
two minutes early. That wakes Render and Neon, so the first real page loads fast.

## What is in the repository

| File | Purpose |
|---|---|
| `render.yaml` | Render Blueprint: one free web service, Python 3.14.3, `website/backend` as root, deploys from `main`, migrations on start, health check `/api/v1/health`. `DATABASE_URL` is `sync: false`, so it is typed into the dashboard and never stored in Git. |
| `website/frontend/firebase.json` | Firebase Hosting: serves `dist/`, single-page-app routing, security and cache headers. |
| `website/frontend/.firebaserc` | Names the Firebase project, `ecopantry-a7342`. |

`website/frontend/.firebase/` is the Firebase CLI's local deploy cache. It is
git-ignored.

## Environment variables

**Render (`ecopantry-api`)**

| Variable | Value | Where it comes from |
|---|---|---|
| `DATABASE_URL` | Neon **direct** connection string (secret) | Typed in when creating the Blueprint |
| `ENVIRONMENT` | `production` | `render.yaml` |
| `PYTHON_VERSION` | `3.14.3` | `render.yaml` |
| `LOG_LEVEL` | `INFO` | `render.yaml` |
| `DATABASE_CONNECT_TIMEOUT` | `15` | `render.yaml` |

Leave everything else at the defaults in `app/core/config.py` (60 min idle /
12 h absolute sessions, 5 failed sign-ins → 15 min lockout, sensor-station
live sessions of 5/15 min capped at 240 min a day; see "Sensor station" below).
Never set `SESSION_COOKIE_SECURE=false`; production refuses to start with it.

**Website build (`website/frontend/.env.production.local`, git-ignored)**

Vite bakes these into the build, so they must be present on the computer that
runs `npm run build` before `firebase deploy`.

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://ecopantry-api.onrender.com/api/v1` |
| `VITE_FIREBASE_API_KEY` | Firebase console → Project settings → Your apps → Web app |
| `VITE_FIREBASE_AUTH_DOMAIN` | `ecopantry-a7342.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `ecopantry-a7342` |
| `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_STORAGE_BUCKET` | Same console page |

Firebase web config values identify the project; they are not secrets, but
keep them out of Git anyway so each environment sets its own. **Without
`VITE_FIREBASE_API_KEY` the Google sign-in button can't work**
(`src/lib/firebase.ts` skips Firebase), and email/password sign-in still does.
On 2026-11-09 the production env file had only `VITE_API_BASE_URL`, so check
Google sign-in on the live site.

Never set `VITE_PORTAL_PREVIEW` here (the preview is removed from production
builds anyway).

## First deployment

Order matters: Neon → Render → Firebase → first administrator. This has been
done once; keep these steps for rebuilding it.

### 1. Neon database

1. Sign up at <https://neon.com> (GitHub sign-in is fine). Choose the **Free** plan.
2. Create a project: name `ecopantry`, the newest PostgreSQL version offered,
   cloud **AWS**, region **Asia Pacific (Singapore)**.
3. Open **Connect** on the project dashboard. Turn **Connection pooling off**
   so the host name does **not** contain `-pooler`. Copy the connection string.
   It looks like
   `postgresql://neondb_owner:…@ep-….ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`.
   Use the direct connection: Alembic migrations and psycopg's prepared
   statements are simplest without the pooler, and the API opens at most 15
   connections.
4. Keep the string somewhere private (a password manager). Don't paste it into
   chat, Git, screenshots or the frontend.

No tables need creating by hand. The API runs the migrations itself.

### 2. Render API

1. Sign up at <https://render.com> and connect GitHub. Give Render access to
   `shigiwigi/ECOPANTRY`.
2. **New → Blueprint**. Pick `shigiwigi/ECOPANTRY`, branch `main`.
   Render reads `render.yaml` and shows one service, `ecopantry-api`, plan **Free**.
3. When it asks for `DATABASE_URL`, paste the Neon direct string from step 1.
4. **Apply**. The first build takes a few minutes. In the service's **Logs**
   you should see Alembic run every migration, then Uvicorn start.
5. Note the service address (`https://ecopantry-api.onrender.com`). Render adds
   a suffix if the name is taken; if it differs, update `VITE_API_BASE_URL`
   and the CORS origins.
6. Check it in a browser:
   - `https://<render-host>/api/v1/health` → `{"status":"ok",…}`
   - `https://<render-host>/api/v1/health/ready` → `{"status":"ready","database":"ok"}`

### 3. Firebase website

1. In the [Firebase console](https://console.firebase.google.com), use project
   `ecopantry-a7342` (Spark plan). Under **Authentication → Sign-in method**,
   enable **Google**. Under **Authentication → Settings → Authorized domains**,
   make sure `ecopantry-a7342.web.app` and `ecopantry-a7342.firebaseapp.com`
   are listed.
2. Add a **Web app** if there isn't one, and copy its config values into
   `website/frontend/.env.production.local` (table above).
3. Install the CLI once and sign in: `npm install -g firebase-tools`, then
   `firebase login`.
4. Build and deploy from `website/frontend`:

   ```bash
   npm run build
   grep -r "Development preview" dist/ && echo "STOP: preview code in build"
   firebase deploy --only hosting
   ```

   The site is at `https://ecopantry-a7342.web.app`.

### 4. First administrator

There is no default account. Create the first administrator from your own
computer with the existing CLI, against Neon. Render's free plan has no shell,
and the password never leaves your terminal.

```bash
cd ~/Wigi/Fahad/ECOPANTRY/website/backend
read -rs DATABASE_URL        # paste the Neon direct string, press Enter (nothing is shown or saved in history)
export DATABASE_URL
# Must print the Neon host (ep-….neon.tech), not 127.0.0.1:
.venv/bin/python -c "from app.core.config import get_settings as s; from sqlalchemy.engine import make_url as u; print(u(s().database_url.get_secret_value()).host)"
.venv/bin/python -m app.cli create-admin --email you@example.com --name "Your Name"   # prompts for the password twice
unset DATABASE_URL
```

The environment variable overrides `DATABASE_URL` in the local `.env`. If the
host check prints `127.0.0.1`, stop: the account would go into the local
database instead.

The password needs 12–128 characters. Share teammates' passwords in person,
not in group chats.

### Staff accounts for teammates

Administrators add Storekeeper and Inspector accounts on the portal's
**Users** page. Staff can then sign in with Google (if their Google account
uses the same email) or with a password set by an administrator.

### Sensor station

Details: [HARDWARE_INTEGRATION.md](HARDWARE_INTEGRATION.md).

1. As an administrator, open **Devices** in the portal and register the station. Copy the token it shows once.
2. Flash with `pio run -e esp32dev -t upload`. No secrets file is needed. On first power-on the station opens a hotspot `EcoPantry-XXXX` (password on its LCD and serial monitor).
3. Join it from a phone, open `http://192.168.4.1`, and enter the WiFi network and password, the API address `https://ecopantry-api.onrender.com/api/v1` (Render directly, not the website) and the device token. Moving between Render and a laptop (`esp32dev-lan` build, `http://<LAN-IP>:8000/api/v1`) needs only the setup page. If the token is rotated the station shows `TOKEN REFUSED` and reopens the hotspot. Not yet tested on a real board.
4. On the Employees page, assign your RFID card. Tap a card on the station first, so its UID shows up under "Recently tapped cards nobody holds".

The station uploads only during **live sessions**: 5 minutes after power-on, then 15 minutes per authorised card tap, at most 240 minutes a day. Between sessions it sends nothing, so Render and Neon go back to sleep and the free plans last the month. The lengths are optional Render variables:
- `LIVE_SESSION_MINUTES`
- `DEVICE_BOOT_SESSION_MINUTES`
- `DEVICE_DAILY_LIVE_MINUTES`
- `DEVICE_REPORT_INTERVAL_SECONDS`

The defaults are in `app/core/config.py`. **Raising the daily limit far above 240 minutes can use up Neon's 100 compute-hours.**

**Before a demo with the station:** tap a card about a minute early. The first request wakes Render, and the station shows `CHECKING CARD` until it answers.

The Neon connection string belongs only in Render's `DATABASE_URL`. It never goes in the firmware, the setup page or any committed file.

## 6. Verify the deployment

Run these on the real URLs. Only tick what was actually checked.

| # | Check | How |
|---|---|---|
| 1 | Site opens over HTTPS | `https://ecopantry-a7342.web.app` loads, padlock shown |
| 2 | Public catalogue | `/products` loads without signing in (empty until products are published) |
| 3 | Staff sign-in (password) | `/portal/sign-in` with the administrator account, on desktop Chrome and Firefox |
| 4 | Staff sign-in (Google) | "Continue with Google" with an existing employee's account; an unknown Google account is refused |
| 5 | **iPhone Safari** | Sign in on an iPhone and reload: still signed in? If not, the cross-site cookie is being blocked (see Architecture) |
| 6 | Administrator portal | Dashboard and **Public catalogue** module open; add and publish a product; it appears on `/products` |
| 7 | Roles | Inspector can't see Public catalogue or QR labels; Storekeeper can open QR labels but not Public catalogue |
| 8 | API calls go to Render | Dev tools → Network: requests go to `https://ecopantry-api.onrender.com/api/v1/...` with status 200 and an `Access-Control-Allow-Origin` equal to the site's origin |
| 9 | Session cookie | Dev tools → Application → Cookies (for `ecopantry-api.onrender.com`): `__Host-ecopantry_session`, Secure, HttpOnly, SameSite None; reload keeps you signed in; sign-out removes it |
| 10 | CSRF | A signed-in `POST /auth/logout` **without** `X-CSRF-Token` → 403 `csrf_failed`; signed-in changes in the portal still work |
| 11 | Other origins refused | `curl -sI -H 'Origin: https://example.com' https://ecopantry-api.onrender.com/api/v1/health` has no `Access-Control-Allow-Origin` |
| 12 | Data survives a restart | Render → **Manual Deploy → Restart service**; the product from check 6 and the accounts are still there |
| 13 | QR scanner on a phone | `/portal/scan`, start the camera, allow it, scan a printed label |
| 14 | QR label printing | `/portal/qr`, generate labels, print preview shows only the label sheet |
| 15 | No preview banner | No "Development preview" banner anywhere; no role switcher |
| 16 | No errors | Browser console clean; Render logs have no tracebacks; `/api/v1/docs` → 404 |

## Updating the site

- **API:** push to `main`. Render rebuilds, runs `alembic upgrade head` on
  start (new migrations are applied, existing data kept) and switches over once
  `/api/v1/health` answers. Migrations must stay additive or carefully written:
  they run against the real data. Test them locally (`alembic upgrade head`,
  `alembic check`) first.
- **Website:** not automatic. From `website/frontend`, with
  `.env.production.local` in place: `npm run build`, then
  `firebase deploy --only hosting`. Deploy the API first when a website change
  needs a new endpoint.

Session housekeeping, run occasionally from your computer (same
`read -rs DATABASE_URL` setup as step 4):

```bash
.venv/bin/python -m app.cli purge-sessions --days 30
```

## Stopping or deleting

- **Take the website offline:** `firebase hosting:disable` from
  `website/frontend` (redeploy to bring it back).
- **Stop the API:** Render → `ecopantry-api` → **Settings → Suspend Web
  Service**. The site keeps loading but sign-in and the catalogue report the
  server as unreachable. **Resume** to restart.
- **Delete everything:**
  1. Firebase console → Project settings → **Delete project** (removes hosting
     and Google sign-in).
  2. Render → `ecopantry-api` → **Settings → Delete Web Service**, then delete
     the Blueprint.
  3. Neon → project → **Settings → Delete project**. This permanently deletes
     all production data and accounts.
- Revoke the GitHub app access in GitHub → **Settings → Applications** if
  you no longer use Render.

Nothing here touches the local Podman database.

## Known limitations

- **Cold start:** the first request after 15 idle minutes takes about a minute
  (Render free plan). Wake it before a demo.
- **Cross-site cookie:** may be blocked by Safari/iPhone (check 5). The fix is
  a shared custom domain.
- **Audit-log IP addresses** show Render's proxy address, not the visitor's.
  The API deliberately trusts only the direct peer; trusted-proxy handling is
  an M13 follow-up.
- **API documentation** isn't available in production (by design). Use
  `http://127.0.0.1:8000/api/v1/docs` locally.
- **Database role:** the API connects as Neon's owner role, so the audit log's
  append-only trigger isn't tamper-proof against the API itself. A
  least-privilege role is an M13 follow-up.
- **No per-IP rate limiting.** Sign-in lockout is per account (5 attempts,
  15 minutes).
- **One Render service** serves every website build, including local ones
  pointed at it.
