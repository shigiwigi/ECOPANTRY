import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

// Accounts seeded by website/backend/scripts/e2e_server.py; see auth.fullstack.ts.
const ADMIN = "admin@e2e.test"
const STOREKEEPER = "storekeeper@e2e.test"

function password(): string {
  const value = process.env.E2E_PASSWORD
  if (!value) throw new Error("E2E_PASSWORD is missing; run through `npm run test:e2e:fullstack`.")
  return value
}

async function signIn(page: Page, email: string) {
  await page.context().clearCookies()
  await page.goto("/portal/sign-in")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password())
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/portal$/)
  await expect(page.getByRole("navigation", { name: "Portal" })).toBeVisible()
}

const run = Date.now().toString(36)
// The server refuses uploads closer together than DEVICE_MIN_REPORT_INTERVAL_SECONDS (2 s by default).
const UPLOAD_GAP_MS = 2_300

/** One reading with the given bin weight, as the ESP32 sends it while live. */
async function uploadWeight(request: APIRequestContext, token: string, weightG: number, uptimeMs: number) {
  const response = await request.post("/api/v1/device/readings", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      sent_uptime_ms: uptimeMs,
      readings: [
        {
          uptime_ms: uptimeMs,
          temperature_c: 21,
          humidity_pct: 55,
          weight_g: weightG,
          ph_value: 6.6,
          ph_voltage: 1.12,
          dht_ok: true,
          load_cell_ok: true,
        },
      ],
    },
  })
  expect(response.status(), await response.text()).toBe(201)
}

test("the waste bin alert opens at 2 kg, can be acknowledged, and clears below 1.5 kg", async ({ page, request }) => {
  const name = `Bin station ${run}`
  await signIn(page, ADMIN)
  await page.goto("/portal/devices")
  await page.getByLabel("Register a station").fill(name)
  await page.getByRole("button", { name: "Register" }).click()
  const token = (await page.getByText(/^epd_[A-Za-z0-9_-]{40,}$/).textContent())!.trim()
  await page.getByRole("button", { name: "I've saved it" }).click()

  // Power-on session, then a weight under the limit: no alert.
  const session = await request.post("/api/v1/device/session", { headers: { Authorization: `Bearer ${token}` } })
  expect(session.status()).toBe(200)
  await uploadWeight(request, token, 1900, 10_000)

  await signIn(page, STOREKEEPER)
  await page.goto("/portal/alerts")
  await expect(page.getByRole("heading", { name: "Alerts", level: 1 })).toBeVisible()
  await expect(page.getByText(name)).toHaveCount(0)
  // Only administrators see the limits.
  await expect(page.getByRole("heading", { name: "Alert limits" })).toHaveCount(0)

  // Crossing 2 kg opens one alert; a repeat upload does not add another.
  await page.waitForTimeout(UPLOAD_GAP_MS)
  await uploadWeight(request, token, 2100, 20_000)
  await page.waitForTimeout(UPLOAD_GAP_MS)
  await uploadWeight(request, token, 2150, 30_000)

  await page.goto("/portal/alerts")
  const row = page.getByRole("listitem").filter({ hasText: name })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText("Waste bin nearly full: 2.10 kg")
  await expect(row).toContainText("Warning")
  await page.screenshot({ path: "e2e/.screenshots/fullstack-alerts-open.png", fullPage: true })

  // The Waste page says so, with the limit drawn on the weight chart.
  await page.goto("/portal/waste")
  await expect(page.getByText("Bin nearly full", { exact: true })).toBeVisible()
  await expect(page.getByText(/Alert limits:.*at or above 2\.00 kg/)).toBeVisible()
  await page.screenshot({ path: "e2e/.screenshots/fullstack-waste-alert.png", fullPage: true })

  // Acknowledging attributes it to the signed-in person and moves it out of "Open".
  await page.goto("/portal/alerts")
  await page
    .getByRole("listitem")
    .filter({ hasText: name })
    .getByRole("button", { name: /^Acknowledge(?!d)/ })
    .click()
  await expect(page.getByRole("listitem").filter({ hasText: name })).toHaveCount(0)
  await page.getByRole("button", { name: "Acknowledged", exact: true }).click()
  const acknowledged = page.getByRole("listitem").filter({ hasText: name })
  await expect(acknowledged).toContainText("by E2E Storekeeper")
  await expect(acknowledged.getByRole("button", { name: /^Acknowledge(?!d)/ })).toHaveCount(0)

  // Between the clear value (1.5 kg) and the limit the alert stays; below it, it resolves by itself.
  await page.waitForTimeout(UPLOAD_GAP_MS)
  await uploadWeight(request, token, 1600, 40_000)
  await page.reload()
  await page.getByRole("button", { name: "Acknowledged", exact: true }).click()
  await expect(page.getByRole("listitem").filter({ hasText: name })).toHaveCount(1)

  await page.waitForTimeout(UPLOAD_GAP_MS)
  await uploadWeight(request, token, 1400, 50_000)
  await page.reload()
  await page.getByRole("button", { name: "Resolved", exact: true }).click()
  await expect(page.getByRole("listitem").filter({ hasText: name })).toContainText("Resolved")
  await page.goto("/portal/waste")
  await expect(page.getByText("Bin nearly full", { exact: true })).toHaveCount(0)

  // The administrator sees and can change the limits.
  await signIn(page, ADMIN)
  await page.goto("/portal/alerts")
  await expect(page.getByRole("heading", { name: "Alert limits" })).toBeVisible()
  await expect(page.getByText(/at or above 2\.00 kg, clears below 1\.50 kg/)).toBeVisible()
})
