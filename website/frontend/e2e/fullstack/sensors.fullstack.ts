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
  // The role dashboards greet by name rather than titling the page "Dashboard".
  await expect(page).toHaveURL(/\/portal$/)
  await expect(page.getByRole("navigation", { name: "Portal" })).toBeVisible()
}

const run = Date.now().toString(36)

/** What the ESP32 does: power-on session, then a backlog of readings 1 min apart. */
async function stationUploads(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}`, "X-Device-Firmware": "0.1.0" }
  const session = await request.post("/api/v1/device/session", { headers })
  expect(session.status()).toBe(200)
  expect((await session.json()).live).toBe(true)

  const sent = 30 * 60_000
  const readings = Array.from({ length: 25 }, (_, i) => ({
    uptime_ms: sent - (24 - i) * 60_000,
    temperature_c: 21 + Math.sin(i / 4) * 2,
    humidity_pct: 55 + (i % 5),
    weight_g: 100 + i * 12.5,
    ph_value: 6.6,
    ph_voltage: 1.12,
    dht_ok: true,
    load_cell_ok: true,
  }))
  const upload = await request.post("/api/v1/device/readings", { headers, data: { sent_uptime_ms: sent, readings } })
  expect(upload.status()).toBe(201)
  expect((await upload.json()).stored).toBe(25)
}

test("a live station's readings reach the portal, and stopping it pauses uploads", async ({ page, request }) => {
  const name = `Station ${run}`
  await signIn(page, ADMIN)

  // Register the station; the token is shown once.
  await page.goto("/portal/devices")
  await page.getByLabel("Register a station").fill(name)
  await page.getByRole("button", { name: "Register" }).click()
  const token = (await page.getByText(/^epd_[A-Za-z0-9_-]{40,}$/).textContent())!.trim()
  expect(token).toMatch(/^epd_[A-Za-z0-9_-]{40,}$/)
  await page.getByRole("button", { name: "I've saved it" }).click()
  await expect(page.getByText(token)).toHaveCount(0)

  // A station can't upload before it has a session, and a staff session can't upload at all.
  const early = await request.post("/api/v1/device/readings", {
    headers: { Authorization: `Bearer ${token}` },
    data: { sent_uptime_ms: 1, readings: [{ uptime_ms: 1, dht_ok: true, load_cell_ok: true }] },
  })
  expect(early.status()).toBe(409)
  expect((await page.request.post("/api/v1/device/session")).status()).toBe(401)

  await stationUploads(request, token)

  // Every role sees the live values; the storekeeper here.
  await signIn(page, STOREKEEPER)
  await expect(page.getByRole("region", { name: "Inventory station" })).toContainText(name)
  await page.goto("/portal/environment")
  await expect(page.getByRole("heading", { name: "Storage environment", level: 1 })).toBeVisible()
  await expect(page.getByText(/^Live until/).first()).toBeVisible()
  await expect(page.locator(".recharts-surface")).toHaveCount(2)
  await expect(page.getByText(/Lowest .* °C, highest .* °C/)).toBeVisible()
  await page.screenshot({ path: "e2e/.screenshots/fullstack-environment-light.png", fullPage: true })

  await page.evaluate(() => window.localStorage.setItem("ecopantry-theme", "dark"))
  await page.reload()
  await expect(page.locator(".recharts-surface")).toHaveCount(2)
  await page.screenshot({ path: "e2e/.screenshots/fullstack-environment-dark.png", fullPage: true })

  await page.goto("/portal/waste")
  await expect(page.getByText("400.0g")).toBeVisible()
  await page.goto("/portal/ph")
  await expect(page.getByRole("note")).toContainText("Experimental reading")
  await page.evaluate(() => window.localStorage.setItem("ecopantry-theme", "light"))

  // The administrator stops the session; the next upload is refused and the portal says "paused".
  await signIn(page, ADMIN)
  await page.goto("/portal/devices")
  await page.getByRole("button", { name: `Stop live session for ${name}` }).click()
  await expect(page.getByText(`${name} will pause on its next upload.`)).toBeVisible()
  const refused = await request.post("/api/v1/device/readings", {
    headers: { Authorization: `Bearer ${token}` },
    data: { sent_uptime_ms: 1, readings: [{ uptime_ms: 1, dht_ok: true, load_cell_ok: true }] },
  })
  expect(refused.status()).toBe(409)
  expect((await refused.json()).code).toBe("session_not_live")

  await page.goto("/portal/environment")
  await expect(page.getByText(/Uploads are paused to save the free hosting plan/)).toBeVisible()
})

test("an administrator assigns a tapped card, and that card opens a live session", async ({ page, request }) => {
  const name = `Card station ${run}`
  await signIn(page, ADMIN)
  await page.goto("/portal/devices")
  await page.getByLabel("Register a station").fill(name)
  await page.getByRole("button", { name: "Register" }).click()
  const token = (await page.getByText(/^epd_[A-Za-z0-9_-]{40,}$/).textContent())!.trim()
  const headers = { Authorization: `Bearer ${token}` }

  // An unknown card is denied and shows up as a candidate to assign.
  const unknown = await request.post("/api/v1/device/rfid-scans", { headers, data: { uid: "BA:E1:20:56" } })
  expect((await unknown.json()).result).toBe("unknown_card")

  await page.goto("/portal/employees")
  await page.getByRole("button", { name: "BA:E1:20:56" }).click()
  await page.getByLabel("Staff member").selectOption({ label: "E2E Storekeeper" })
  await page.getByRole("button", { name: "Assign" }).click()
  await expect(page.getByText("Card BA:E1:20:56 now belongs to E2E Storekeeper.")).toBeVisible()

  const granted = await request.post("/api/v1/device/rfid-scans", { headers, data: { uid: "ba e1 20 56" } })
  const body = await granted.json()
  expect(body.granted).toBe(true)
  expect(body.display_name).toBe("E2E Storekeeper")
  expect(body.live).toBe(true)
  expect(body.live_seconds_remaining).toBeGreaterThan(800)
})
