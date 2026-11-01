import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

// Seeded by website/backend/scripts/e2e_server.py into a throwaway database.
const ACCOUNTS = {
  admin: { email: "admin@e2e.test", name: "E2E Administrator" },
  storekeeper: { email: "storekeeper@e2e.test", name: "E2E Storekeeper" },
  inspector: { email: "inspector@e2e.test", name: "E2E Inspector" },
  disabled: { email: "disabled@e2e.test", name: "E2E Deactivated" },
}

function password(): string {
  const value = process.env.E2E_PASSWORD
  if (!value) throw new Error("E2E_PASSWORD is missing; run through `npm run test:e2e:fullstack`.")
  return value
}

async function signIn(page: Page, email: string, secret = password()) {
  await page.goto("/portal/sign-in")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(secret)
  await page.getByRole("button", { name: "Sign in" }).click()
}

/** CSRF token of the session the request context's cookies belong to. */
async function csrf(request: APIRequestContext): Promise<string> {
  const response = await request.get("/api/v1/auth/me")
  expect(response.status()).toBe(200)
  return (await response.json()).csrf_token as string
}

let uniqueCounter = 0
/** A fresh account created by the administrator through the API, for tests that change it. */
async function createAccount(admin: APIRequestContext, role: "storekeeper" | "inspector") {
  const email = `fresh-${Date.now()}-${uniqueCounter++}@e2e.test`
  const response = await admin.post("/api/v1/employees", {
    data: { email, name: "Fresh Account", role, password: password() },
    headers: { "X-CSRF-Token": await csrf(admin) },
  })
  expect(response.status(), await response.text()).toBe(201)
  return { email, id: (await response.json()).id as string }
}

async function adminContext(playwright: typeof import("@playwright/test")["request"], baseURL: string) {
  const admin = await playwright.newContext({ baseURL })
  const login = await admin.post("/api/v1/auth/login", { data: { email: ACCOUNTS.admin.email, password: password() } })
  expect(login.status()).toBe(200)
  return admin
}

test("administrator signs in, keeps the session across reloads and signs out", async ({ page, context }) => {
  await signIn(page, ACCOUNTS.admin.email)
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "Devices" })).toBeVisible()
  // No development-preview banner on a real session.
  await expect(page.getByText("Development preview")).toHaveCount(0)

  // The session cookie is HttpOnly and SameSite=Lax; page scripts can't read it.
  const cookie = (await context.cookies()).find((c) => c.name === "ecopantry_session")
  expect(cookie?.httpOnly).toBe(true)
  expect(cookie?.sameSite).toBe("Lax")
  expect(await page.evaluate(() => document.cookie)).not.toContain("ecopantry_session")
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(cookie?.value ?? "-")

  await page.reload()
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible()

  await page.getByRole("button", { name: "Account menu" }).click()
  await expect(page.getByRole("menu")).toContainText(ACCOUNTS.admin.name)
  await expect(page.getByRole("menu")).toContainText("Administrator")
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/portal\/sign-in$/)

  // The server ended the session: neither the portal nor the API lets the browser back in.
  expect((await page.request.get("/api/v1/auth/me")).status()).toBe(401)
  await page.goto("/portal/inventory")
  await expect(page).toHaveURL(/\/portal\/sign-in$/)
})

test("wrong password and deactivated accounts are refused with clear messages", async ({ page }) => {
  await signIn(page, ACCOUNTS.admin.email, "definitely not the password")
  await expect(page.getByRole("alert")).toHaveText("That email and password don't match an account.")
  await expect(page).toHaveURL(/\/portal\/sign-in$/)

  await signIn(page, ACCOUNTS.disabled.email)
  await expect(page.getByRole("alert")).toContainText("This account has been deactivated")
  await expect(page).toHaveURL(/\/portal\/sign-in$/)
})

test("inspector sees read-only navigation and the API refuses changes", async ({ page }) => {
  await signIn(page, ACCOUNTS.inspector.email)
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible()
  const nav = page.getByRole("navigation", { name: "Portal" })
  await expect(nav.getByRole("link", { name: "Audit log" })).toBeVisible()
  await expect(nav.getByRole("link", { name: "QR labels" })).toHaveCount(0)
  await expect(nav.getByRole("link", { name: "Devices" })).toHaveCount(0)

  // Hiding links is only UX. The backend is what refuses, even with a valid session and CSRF token.
  expect((await page.request.get("/api/v1/employees")).status()).toBe(200)
  const create = await page.request.post("/api/v1/employees", {
    data: { email: "sneaky@e2e.test", name: "Sneaky", role: "admin", password: password() },
    headers: { "X-CSRF-Token": await csrf(page.request) },
  })
  expect(create.status()).toBe(403)
})

test("storekeeper is blocked from admin pages in the UI and the API", async ({ page }) => {
  await signIn(page, ACCOUNTS.storekeeper.email)
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible()
  await page.goto("/portal/devices")
  await expect(page.getByRole("heading", { name: "You don't have access to this page", level: 1 })).toBeVisible()
  expect((await page.request.get("/api/v1/employees")).status()).toBe(403)
})

test("unsafe requests without the CSRF token are refused", async ({ page }) => {
  await signIn(page, ACCOUNTS.storekeeper.email)
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible()
  const response = await page.request.post("/api/v1/auth/logout")
  expect(response.status()).toBe(403)
  expect((await page.request.get("/api/v1/auth/me")).status()).toBe(200)
})

test("deactivating an account ends its open session in the browser", async ({ page, playwright, baseURL }) => {
  const admin = await adminContext(playwright.request, baseURL!)
  const account = await createAccount(admin, "storekeeper")

  await signIn(page, account.email)
  await page.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "Settings" }).click()
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible()

  const off = await admin.post(`/api/v1/employees/${account.id}/deactivate`, { headers: { "X-CSRF-Token": await csrf(admin) } })
  expect(off.status()).toBe(200)

  // The next request the portal makes is refused; the app returns to sign-in and says why.
  await page.getByLabel("Current password").fill(password())
  await page.getByLabel("New password", { exact: true }).fill("a brand new passphrase")
  await page.getByLabel("Repeat new password").fill("a brand new passphrase")
  await page.getByRole("button", { name: "Change password" }).click()
  await expect(page).toHaveURL(/\/portal\/sign-in$/)
  await expect(page.getByText("Your session has ended. Sign in again to continue.")).toBeVisible()
  await admin.dispose()
})

test("changing the password works end to end", async ({ page, playwright, baseURL }) => {
  const admin = await adminContext(playwright.request, baseURL!)
  const account = await createAccount(admin, "inspector")
  await admin.dispose()
  const newPassword = "a brand new passphrase for e2e"

  await signIn(page, account.email)
  await page.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "Settings" }).click()
  await page.getByLabel("Current password").fill("not the current one")
  await page.getByLabel("New password", { exact: true }).fill(newPassword)
  await page.getByLabel("Repeat new password").fill(newPassword)
  await page.getByRole("button", { name: "Change password" }).click()
  await expect(page.getByRole("alert")).toHaveText("Your current password is incorrect.")

  await page.getByLabel("Current password").fill(password())
  await page.getByRole("button", { name: "Change password" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Password changed" })).toBeVisible()

  await page.getByRole("button", { name: "Account menu" }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await signIn(page, account.email, password())
  await expect(page.getByRole("alert")).toHaveText("That email and password don't match an account.")
  await signIn(page, account.email, newPassword)
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible()
})

for (const theme of ["light", "dark"] as const) {
  for (const viewport of [{ name: "mobile", width: 375, height: 812 }, { name: "desktop", width: 1440, height: 900 }]) {
    test(`sign-in and settings fit and render (${viewport.name}, ${theme})`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.addInitScript((value) => window.localStorage.setItem("ecopantry-theme", value), theme)
      const fits = async () =>
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      const shot = (name: string) =>
        page.screenshot({ path: `e2e/.screenshots/fullstack-${viewport.name}-${theme}-${name}.png`, fullPage: true })

      await signIn(page, ACCOUNTS.storekeeper.email, "definitely not the password")
      await expect(page.getByRole("alert")).toBeVisible()
      await fits()
      await shot("sign-in-error")

      await signIn(page, ACCOUNTS.storekeeper.email)
      await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible()
      await page.goto("/portal/settings")
      await page.getByRole("button", { name: "Change password" }).click()
      await expect(page.getByText("Enter your current password.")).toBeVisible()
      await fits()
      await shot("settings")
    })
  }
}
