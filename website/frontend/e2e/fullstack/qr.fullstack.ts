import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

// Seeded by website/backend/scripts/e2e_server.py into a throwaway database.
const STOREKEEPER = "storekeeper@e2e.test"
const INSPECTOR = "inspector@e2e.test"
const LOOKUP = "/api/v1/batches/by-label/K7M2Q9X4TR" // refused before any lookup happens, so the batch needn't exist

function password(): string {
  const value = process.env.E2E_PASSWORD
  if (!value) throw new Error("E2E_PASSWORD is missing; run through `npm run test:e2e:fullstack`.")
  return value
}

async function signIn(page: Page, email: string) {
  await page.goto("/portal/sign-in")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password())
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible()
}

async function lookUp(page: Page, code: string) {
  await page.getByLabel("Batch code").fill(code)
  await page.getByRole("button", { name: "Look up" }).click()
}

const run = Date.now().toString(36)

/** What a storekeeper does in the portal, through the API: an ingredient and a received batch. */
async function receiveBatch(request: APIRequestContext, csrfToken: string, ingredientName: string, quantity: string) {
  const headers = { "X-CSRF-Token": csrfToken }
  const ingredient = await request.post("/api/v1/ingredients", { data: { name: ingredientName, unit: "kg" }, headers })
  expect(ingredient.status(), await ingredient.text()).toBe(201)
  const expiry = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10)
  const batch = await request.post("/api/v1/batches", {
    data: { ingredient_id: (await ingredient.json()).id, quantity, expiry_on: expiry },
    headers,
  })
  expect(batch.status(), await batch.text()).toBe(201)
  const body = (await batch.json()) as { id: string; label_code: string }
  return { id: body.id, code: body.label_code }
}

test("a storekeeper looks up a label through the real API and makes labels", async ({ page }) => {
  const ingredientName = `QR flour ${run}`
  await signIn(page, STOREKEEPER)
  const me = await page.request.get("/api/v1/auth/me")
  expect(me.status()).toBe(200)
  const { id, code } = await receiveBatch(page.request, (await me.json()).csrf_token, ingredientName, "12.500")
  expect(code).toMatch(/^[A-Z0-9]{10}$/)
  const printed = `${code.slice(0, 5)}-${code.slice(5)}`

  await page.getByRole("link", { name: "Scan a QR label" }).click()
  await expect(page.getByRole("heading", { name: "QR scanner", level: 1 })).toBeVisible()

  // A known label shows the batch, typed lower-case and with the dash it is printed with.
  const found = page.waitForResponse((response) => response.url().endsWith(`/api/v1/batches/by-label/${code}`))
  await lookUp(page, printed.toLowerCase())
  expect((await found).status()).toBe(200)
  await expect(page.getByText(ingredientName, { exact: true })).toBeVisible()
  await expect(page.getByText("In stock", { exact: true })).toBeVisible()
  await expect(page.getByText("12.500 kg")).toBeVisible()

  // A well-formed code no batch has: the API says 404 and the page says so.
  const missing = page.waitForResponse((response) => response.url().endsWith("/api/v1/batches/by-label/ZZZZZZZZZZ"))
  await lookUp(page, "ZZZZZ-ZZZZZ")
  expect((await missing).status()).toBe(404)
  await expect(page.getByText("No batch has this label")).toBeVisible()

  // Labels are made from the batch, not typed.
  await page.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "QR labels" }).click()
  await expect(page.getByRole("heading", { name: "QR labels", level: 1 })).toBeVisible()
  await page.getByLabel("Batch", { exact: true }).selectOption({ value: id })
  await page.getByRole("button", { name: "Add to sheet" }).click()
  await expect(page.getByRole("list", { name: "Labels to print" })).toContainText(ingredientName)
  await expect(page.getByRole("button", { name: "Print 1 label" })).toBeEnabled()
})

test("an inspector can look labels up but not open label printing", async ({ page, playwright, baseURL }) => {
  // The batch comes from a separate storekeeper API session, so the browser can be the inspector's.
  const keeper = await playwright.request.newContext({ baseURL })
  const login = await keeper.post("/api/v1/auth/login", { data: { email: STOREKEEPER, password: password() } })
  expect(login.status()).toBe(200)
  const ingredientName = `QR yeast ${run}`
  const { code } = await receiveBatch(keeper, (await login.json()).csrf_token, ingredientName, "3.000")
  await keeper.dispose()

  await signIn(page, INSPECTOR)
  await page.goto("/portal/scan")
  await lookUp(page, code)
  await expect(page.getByText(ingredientName, { exact: true })).toBeVisible()

  await expect(page.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "QR labels" })).toHaveCount(0)
  await page.goto("/portal/qr")
  await expect(page.getByRole("heading", { name: "You don't have access to this page", level: 1 })).toBeVisible()
})

test("the lookup API refuses requests without a session", async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL })
  const response = await anonymous.get(LOOKUP)
  expect(response.status()).toBe(401)
  expect((await response.json()).code).toBe("not_authenticated")
  await anonymous.dispose()
})

test("an ended session sends the scanner back to sign-in", async ({ page, context }) => {
  await signIn(page, STOREKEEPER)
  await page.getByRole("link", { name: "Scan a QR label" }).click()
  await expect(page.getByRole("heading", { name: "QR scanner", level: 1 })).toBeVisible()
  await context.clearCookies() // as if the session expired or the account was deactivated
  await lookUp(page, "K7M2Q9X4TR")
  await expect(page.getByText("Your session has ended. Sign in again to continue.")).toBeVisible()
  await expect(page).toHaveURL(/\/portal\/sign-in$/)
})
