# Deployment

How to host EcoPantry for the project demonstration on free plans, and how to
update, check and remove it. Nothing here costs money. If any dashboard asks
for a card or offers a paid plan, stop and pick the free option (or ask).

Status: configuration prepared. Not deployed until the checks in
[Verify the deployment](#6-verify-the-deployment) pass on the real URLs.

## Architecture

```text
 phone / laptop browser
          │  HTTPS, one origin: https://<site>.vercel.app
          ▼
 Vercel (website)  ── /api/v1/*  ──►  Render (FastAPI, free web service)
   static React build                 │  TLS
                                      ▼
                                   Neon (PostgreSQL, free plan)
```

- **Vercel** serves the built React app and forwards every `/api/v1/*` request
  to Render (`website/frontend/vercel.json`). The browser only ever talks to the
  Vercel address, so the session cookie (`__Host-ecopantry_session`, Secure,
  HttpOnly, SameSite=Lax) and the CSRF header work exactly as in development.
  No CORS is needed and none is configured. This is decision D3 in
  `docs/ROADMAP.md`, with Vercel in place of Cloudflare.
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
| Vercel | Hobby | $0 | Non-commercial use. Requests forwarded to Render wait up to 120 s for a reply. |
| Render | Free web service | $0 | Sleeps after 15 min without requests; the next request takes about a minute to wake it. 750 free hours a month. 512 MB RAM. No shell and no pre-deploy step on this plan. |
| Neon | Free | $0, no card | 1 GB storage and 100 compute-hours a month per project. Compute suspends after 5 min idle and wakes in under a second. Running out of hours suspends the database until next month; it does not delete data. |

**Before a demo:** open `https://<site>.vercel.app/api/v1/health/ready` two
minutes early. That wakes Render and Neon, so the first real page loads fast.

## What is in the repository

| File | Purpose |
|---|---|
| `render.yaml` | Render Blueprint: one free web service, Python 3.14.3, `website/backend` as root, migrations on start, health check `/api/v1/health`. `DATABASE_URL` is `sync: false`, so it is typed into the dashboard and never stored in Git. |
| `website/frontend/vercel.json` | Vite build settings, the `/api/v1/*` forward to Render, single-page-app routing, security headers (camera allowed for this site only, for the QR scanner). |

The forward in `vercel.json` points at `your-render-service.invalid` until
step 3. That address can never resolve, so a site deployed before step 3 fails
safely (API calls report "Can't reach the EcoPantry server") instead of sending
sign-ins anywhere else.

## Environment variables

Only the API has settings. The website needs none.

**Render (`ecopantry-api`)**

| Variable | Value | Where it comes from |
|---|---|---|
| `DATABASE_URL` | Neon **direct** connection string (secret) | Typed in when creating the Blueprint (step 2) |
| `ENVIRONMENT` | `production` | `render.yaml` |
| `PYTHON_VERSION` | `3.14.3` | `render.yaml` |
| `LOG_LEVEL` | `INFO` | `render.yaml` |
| `DATABASE_CONNECT_TIMEOUT` | `15` | `render.yaml` |

Leave everything else at the defaults in `app/core/config.py` (60 min idle /
12 h absolute sessions, 5 failed sign-ins → 15 min lockout). Never set
`SESSION_COOKIE_SECURE=false`; production refuses to start with it.

**Vercel**

None. Do not add `VITE_API_BASE_URL` (the default `/api/v1` is correct) or
`VITE_PORTAL_PREVIEW` (the preview is removed from production builds anyway).

## First deployment

Order matters: Neon → Render → point Vercel at Render → Vercel → first
administrator.

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
2. **New → Blueprint**. Pick `shigiwigi/ECOPANTRY`, branch `development`.
   Render reads `render.yaml` and shows one service, `ecopantry-api`, plan **Free**.
3. When it asks for `DATABASE_URL`, paste the Neon direct string from step 1.
4. **Apply**. The first build takes a few minutes. In the service's **Logs**
   you should see Alembic run `0001`, `0002` and `0003`, then Uvicorn start.
5. Note the service address at the top of the page, for example
   `https://ecopantry-api.onrender.com`. Render adds a suffix if the name is
   taken, so copy it exactly.
6. Check it in a browser:
   - `https://<render-host>/api/v1/health` → `{"status":"ok",…}`
   - `https://<render-host>/api/v1/health/ready` → `{"status":"ready","database":"ok"}`

### 3. Point the website at the API

In `website/frontend/vercel.json`, replace `your-render-service.invalid` with
the Render host from step 2 (host only, no `https://` and no path), then commit
and push to `development`:

```bash
git add website/frontend/vercel.json
git commit -m "Point Vercel API forward at the Render service"
git push origin development
```

### 4. Vercel website

1. Sign up at <https://vercel.com> with GitHub, **Hobby** plan.
2. **Add New → Project**, import `shigiwigi/ECOPANTRY`.
3. **Root Directory:** `website/frontend`. Framework: Vite (picked up from
   `vercel.json`). No environment variables. **Deploy**.
4. The first build uses the repository's default branch, `main`, which doesn't
   contain the app yet, so it may fail. That is expected. Go to
   **Settings → Environments → Production → Branch Tracking** (older
   dashboards: **Settings → Git → Production Branch**) and set it to
   `development`.
5. **Settings → Build and Deployment → Node.js Version:** `24.x` (the version the
   build was tested with).
6. **Deployments → Create Deployment** (or push any commit to `development`) to
   build `development`. The site is at `https://<project>.vercel.app`.

### 5. First administrator

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

The portal has no staff-management screen yet and the API docs are off in
production, so create Storekeeper and Inspector accounts through the API with
`curl` (`role` is `admin`, `storekeeper` or `inspector`). Passwords are read
without echo and never appear in shell history:

```bash
SITE=https://<project>.vercel.app
JAR=$(mktemp)
read -rp "Admin email: " ADMIN_EMAIL
read -rsp "Admin password: " ADMIN_PW; echo
CSRF=$(jq -n --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PW" '{email:$e,password:$p}' \
  | curl -sS -c "$JAR" -H 'Content-Type: application/json' --data @- "$SITE/api/v1/auth/login" \
  | jq -r .csrf_token)
unset ADMIN_PW

read -rp "New staff email: " NEW_EMAIL
read -rp "Full name: " NEW_NAME
read -rp "Role (storekeeper/inspector/admin): " NEW_ROLE
read -rsp "Initial password: " NEW_PW; echo
jq -n --arg e "$NEW_EMAIL" --arg n "$NEW_NAME" --arg r "$NEW_ROLE" --arg p "$NEW_PW" \
    '{email:$e,name:$n,role:$r,password:$p}' \
  | curl -sS -b "$JAR" -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
      --data @- "$SITE/api/v1/employees" | jq '{email,role,status}'
unset NEW_PW

curl -sS -o /dev/null -b "$JAR" -H "X-CSRF-Token: $CSRF" -X POST "$SITE/api/v1/auth/logout"
rm -f "$JAR"; unset CSRF
```

Repeat the middle block for each account before signing out. Every account
change is recorded in the audit log.

## 6. Verify the deployment

Run these on the real URLs. Only tick what was actually checked.

| # | Check | How |
|---|---|---|
| 1 | Site opens over HTTPS | `https://<project>.vercel.app` loads, padlock shown; `http://` redirects |
| 2 | Public catalogue | `/products` loads without signing in (empty until products are published) |
| 3 | Staff sign-in | `/portal/sign-in` with the administrator account |
| 4 | Administrator portal | Dashboard and **Public catalogue** module open; add and publish a product; it appears on `/products` |
| 5 | Roles | Inspector can't see Public catalogue or QR labels; Storekeeper can open QR labels but not Public catalogue |
| 6 | API goes to Render | Browser dev tools → Network: requests go to `https://<project>.vercel.app/api/v1/...` with status 200; Render logs show them |
| 7 | Session cookie | Dev tools → Application → Cookies: `__Host-ecopantry_session`, Secure, HttpOnly, SameSite Lax; reload keeps you signed in; sign-out removes it |
| 8 | CSRF | Sign in with `curl` as in the staff-account recipe (keep `$JAR`), then `curl -sS -b "$JAR" -X POST $SITE/api/v1/auth/logout` **without** `X-CSRF-Token` → 403 `csrf_failed`; signed-in changes in the portal still work |
| 9 | Data survives a restart | Render → **Manual Deploy → Restart service** (or wait for it to sleep); the product from check 4 and the accounts are still there |
| 10 | QR scanner page on a phone | Open `/portal/scan` on a phone, signed in |
| 11 | Camera over HTTPS | Tap start; the browser asks for camera permission; scan a printed label. Until M6 the expected result is "Batch details aren't connected yet" (the label was read and the server accepted the lookup). |
| 12 | QR label printing | `/portal/qr`, generate labels, print preview shows only the label sheet |
| 13 | No preview banner | No "Development preview" banner anywhere; no role switcher |
| 14 | No errors | Browser console clean; Render logs have no tracebacks; `/api/v1/docs` → 404 |

## Updating the site

Both services redeploy automatically on every push to `development`:

```bash
git push origin development
```

- Render rebuilds the API, runs `alembic upgrade head` on start (new
  migrations are applied, existing data kept) and switches over once
  `/api/v1/health` answers.
- Vercel rebuilds the website. Pushes to other branches get preview URLs on
  Vercel only; the API forward in them still points at the one Render service.
- Migrations must stay additive or carefully written: they run against the
  real data. Test them locally (`alembic upgrade head`, `alembic check`) first.

Session housekeeping, run occasionally from your computer (same
`read -rs DATABASE_URL` setup as step 5):

```bash
.venv/bin/python -m app.cli purge-sessions --days 30
```

## Stopping or deleting

- **Take the site offline but keep the data:** suspend the API (next item).
  The Hobby plan has no reliable pause for the website itself; delete the
  Vercel project to remove it (it can be re-imported later in a few minutes).
- **Stop the API:** Render → `ecopantry-api` → **Settings → Suspend Web
  Service**. The site keeps loading but sign-in and the catalogue report the
  server as unreachable. **Resume** to restart.
- **Delete everything:**
  1. Vercel → project → **Settings → General → Delete Project**.
  2. Render → `ecopantry-api` → **Settings → Delete Web Service**, then delete
     the Blueprint.
  3. Neon → project → **Settings → Delete project**. This permanently deletes
     all production data and accounts.
- Revoke the GitHub app access in GitHub → **Settings → Applications** if
  you no longer use Render or Vercel.

Nothing here touches the local Podman database or the `development` branch.

## Known limitations

- **Cold start:** the first request after 15 idle minutes takes about a minute
  (Render free plan). Wake it before a demo.
- **Audit-log IP addresses** show the hosting proxy's address, not the
  visitor's. The API deliberately trusts only the direct peer; trusted-proxy
  handling is an M13 follow-up.
- **API documentation** isn't available in production (by design). Use
  `http://127.0.0.1:8000/api/v1/docs` locally.
- **Database role:** the API connects as Neon's owner role, so the audit log's
  append-only trigger isn't tamper-proof against the API itself. A
  least-privilege role is an M13 follow-up.
- **No per-IP rate limiting.** Sign-in lockout is per account (5 attempts,
  15 minutes).
- **One Render service** serves production and every Vercel preview deployment.
