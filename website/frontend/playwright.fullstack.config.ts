import { randomBytes } from "node:crypto"
import { defineConfig, devices } from "@playwright/test"

/**
 * Full-stack browser tests: real sign-in through the Vite proxy to FastAPI and PostgreSQL.
 *
 * Needs the PostgreSQL container running and website/backend set up (its .env and .venv).
 * The backend script creates and later drops a throwaway `ecopantry_test_e2e` database,
 * so the development data is never touched.
 *
 *   npm run test:e2e:fullstack
 */

const WEB_PORT = 4175
const API_PORT = 8766

// One random password per run, shared by the server's test accounts and the tests.
// Workers inherit this from the main process, so they all see the same value.
process.env.E2E_PASSWORD ??= `e2e-${randomBytes(18).toString("base64url")}`

export default defineConfig({
  testDir: "./e2e/fullstack",
  testMatch: "**/*.fullstack.ts",
  outputDir: "./e2e/.results-fullstack",
  // The tests share one database and some change accounts, so run them one at a time.
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: "../backend/.venv/bin/python scripts/e2e_server.py",
      cwd: "../backend",
      url: `http://127.0.0.1:${API_PORT}/api/v1/health/ready`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { E2E_API_PORT: String(API_PORT) },
      // SIGTERM lets the script drop its throwaway database on the way out.
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      // Real sign-in only: the development preview must be off.
      env: { VITE_PORTAL_PREVIEW: "false", API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    },
  ],
})
