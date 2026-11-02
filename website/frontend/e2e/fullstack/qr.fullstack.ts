import { expect, test, type Page } from "@playwright/test"

// Seeded by website/backend/scripts/e2e_server.py into a throwaway database.
const STOREKEEPER = "storekeeper@e2e.test"
const INSPECTOR = "inspector@e2e.test"
const LOOKUP = "/api/v1/batches/by-label/K7M2Q9X4TR"

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

test("a storekeeper looks up a label through the real API and makes labels", async ({ page }) => {
  await signIn(page, STOREKEEPER)
  await page.getByRole("link", { name: "Scan a QR label" }).click()
  await expect(page.getByRole("heading", { name: "QR scanner", level: 1 })).toBeVisible()

  const answer = page.waitForResponse((response) => response.url().endsWith(LOOKUP))
  await lookUp(page, "k7m2q-9x4tr")
  expect((await answer).status()).toBe(501)
  await expect(page.getByText("Batch details aren't connected yet")).toBeVisible()

  await page.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "QR labels" }).click()
  await expect(page.getByRole("heading", { name: "QR labels", level: 1 })).toBeVisible()
})

test("an inspector can look labels up but not open label printing", async ({ page }) => {
  await signIn(page, INSPECTOR)
  await page.goto("/portal/scan")
  await lookUp(page, "K7M2Q9X4TR")
  await expect(page.getByText("Batch details aren't connected yet")).toBeVisible()

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
