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

To review portal layouts before the backend exists, set
`VITE_PORTAL_PREVIEW=true` in `.env.local`. This creates a development-only
preview session with a role switcher. It is removed from production builds
and grants no data access.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check (`tsc -b`) and production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run lint` | oxlint |
| `npm test` | Vitest unit tests (theme, routing and roles, token contrast) |
| `npx vitest run src/app/routes.test.tsx` | A single test file (add `-t "name"` for one test) |
| `npm run test:e2e` | Playwright smoke tests: every route at 375px and 1440px in light and dark |

Before the first `test:e2e` run, install the browser once with
`npx playwright install chromium`. Screenshots from the e2e run are written to
`e2e/.screenshots/` (git-ignored) for visual review.

## Structure

```text
src/
  app/            router (routes.tsx) and providers
  config/         portal-modules.ts (portal nav, routes, roles), site.ts (public bakery details)
  features/auth/  session context, route guards, sign-in, roles
  features/theme/ light/dark/system preference and controls
  lib/api/        typed fetch client for the FastAPI backend
  components/ui/  shadcn/ui components (generated, then adjusted)
  components/     shared layout and common components
  pages/public/   customer website pages
  pages/portal/   management portal pages
  styles/         globals.css: design tokens for both themes
```

Add shadcn components with `npx shadcn@latest add <name>`. They use the
semantic tokens in `src/styles/globals.css`.
