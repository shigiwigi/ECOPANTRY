import { defineConfig, devices } from "@playwright/test"

const PORT = 4174

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["Desktop Chrome"],
  },
  webServer: {
    // Dev server with the development-only portal preview so portal layouts can be checked.
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    // The API proxy points at a closed port, so tests behave the same whether or not
    // a local FastAPI is running: every /api/v1 call gets the proxy's "no backend" 502.
    env: { VITE_PORTAL_PREVIEW: "true", API_PROXY_TARGET: "http://127.0.0.1:1" },
  },
})
