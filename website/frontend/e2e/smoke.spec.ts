import { expect, test, type Page } from "@playwright/test"

const PUBLIC_ROUTES = ["/", "/products", "/products/example", "/about", "/contact", "/no-such-page"]
const PORTAL_ROUTES = [
  "/portal",
  "/portal/alerts",
  "/portal/inventory",
  "/portal/batches",
  "/portal/expiry",
  "/portal/qr",
  "/portal/suppliers",
  "/portal/environment",
  "/portal/ph",
  "/portal/waste",
  "/portal/camera",
  "/portal/employees",
  "/portal/reports",
  "/portal/audit",
  "/portal/devices",
  "/portal/settings",
  "/portal/no-such-module",
]

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "desktop", width: 1440, height: 900 },
]
const THEMES = ["light", "dark"] as const

async function useTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.addInitScript((value) => window.localStorage.setItem("ecopantry-theme", value), theme)
}

function collectErrors(page: Page) {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  return errors
}

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test.describe(`${viewport.name} / ${theme}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } })

      for (const route of [...PUBLIC_ROUTES, ...PORTAL_ROUTES]) {
        test(`renders ${route}`, async ({ page }) => {
          const errors = collectErrors(page)
          await useTheme(page, theme)
          await page.goto(route)
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
          await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark)/)

          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
          expect(overflow, "horizontal page overflow").toBeLessThanOrEqual(0)
          expect(errors).toEqual([])

          const slug = route === "/" ? "home" : route.slice(1).replaceAll("/", "_")
          await page.screenshot({
            path: `e2e/.screenshots/${viewport.name}-${theme}-${slug}.png`,
            fullPage: true,
          })
        })
      }
    })
  }
}

test.describe("interactions", () => {
  test("mobile portal drawer navigates and closes", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto("/portal")
    await page.getByRole("button", { name: "Open navigation" }).click()
    await page.getByRole("dialog").getByRole("link", { name: "Inventory" }).click()
    await expect(page).toHaveURL(/\/portal\/inventory$/)
    await expect(page.getByRole("dialog")).toBeHidden()
    await expect(page.getByRole("heading", { level: 1, name: "Ingredient inventory" })).toBeVisible()
  })

  test("mobile public menu navigates", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto("/")
    await page.getByRole("button", { name: "Open menu" }).click()
    await page.getByRole("dialog").getByRole("link", { name: "About" }).click()
    await expect(page).toHaveURL(/\/about$/)
  })

  test("theme menu switches and persists across reloads", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" })
    await page.goto("/")
    await page.getByRole("button", { name: "Change theme" }).click()
    await page.getByRole("menuitemradio", { name: "Dark" }).click()
    await expect(page.locator("html")).toHaveClass(/dark/)
    await page.reload()
    await expect(page.locator("html")).toHaveClass(/dark/)
  })

  test("system theme follows the OS preference", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" })
    await page.goto("/portal/settings")
    await page.getByRole("radio", { name: "System" }).check({ force: true })
    await expect(page.locator("html")).toHaveClass(/dark/)
    await page.emulateMedia({ colorScheme: "light" })
    await expect(page.locator("html")).not.toHaveClass(/dark/)
  })

  test("skip link is the first focus stop and moves to main content", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await page.keyboard.press("Tab")
    const skip = page.getByRole("link", { name: "Skip to main content" })
    await expect(skip).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(page.locator("#main-content")).toBeFocused()
  })

  test("sign-in validates input and reports an unreachable server honestly", async ({ page }) => {
    // Preview mode signs in automatically, so clear it by visiting sign-in after signing out.
    await page.goto("/portal")
    await page.getByRole("button", { name: "Account menu" }).click()
    await page.getByRole("menuitem", { name: "Sign out" }).click()
    await expect(page).toHaveURL(/\/portal\/sign-in$/)

    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page.getByText("Enter a valid email address.")).toBeVisible()
    await expect(page.getByText("Enter your password.")).toBeVisible()

    await page.route("**/api/v1/auth/login", (route) => route.abort("connectionrefused"))
    await page.getByLabel("Email").fill("staff@example.com")
    await page.getByLabel("Password").fill("not-a-real-password")
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page.getByRole("alert")).toContainText("Can't reach the EcoPantry server")
    await expect(page).toHaveURL(/\/portal\/sign-in$/)
  })

  test("sign-in against the bare dev server reports it unreachable and keeps focus", async ({ page }) => {
    // No mock: the Vite dev server answers the login POST with an empty 404, as it does with no backend running.
    await page.goto("/portal")
    await page.getByRole("button", { name: "Account menu" }).click()
    await page.getByRole("menuitem", { name: "Sign out" }).click()
    await expect(page).toHaveTitle("Staff sign-in | EcoPantry portal")

    await page.getByLabel("Email").fill("staff@example.com")
    await page.getByLabel("Password").fill("not-a-real-password")
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page.getByRole("alert")).toContainText("Can't reach the EcoPantry server")
    // The button is aria-disabled, not disabled, while submitting, so focus isn't dropped to the page.
    await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused()
  })

  test("pages have their own titles and navigation moves focus to the new page", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveTitle("EcoPantry")
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Products" }).click()
    await expect(page).toHaveTitle("Products | EcoPantry")
    await expect(page.locator("#main-content")).toBeFocused()

    await page.goto("/portal")
    await expect(page).toHaveTitle("Dashboard | EcoPantry portal")
    await page.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "Batches" }).click()
    await expect(page).toHaveTitle("Batches | EcoPantry portal")
    await expect(page.locator("#main-content")).toBeFocused()
  })

  test("mobile drawer hands focus to the new page after navigating", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto("/portal")
    await page.getByRole("button", { name: "Open navigation" }).click()
    await page.getByRole("dialog").getByRole("link", { name: "Suppliers" }).click()
    await expect(page.getByRole("dialog")).toBeHidden()
    await expect(page.locator("#main-content")).toBeFocused()
  })

  test("portal sidebar stays in view on a short laptop screen", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto("/portal/settings")
    await page.mouse.wheel(0, 2000)
    const sidebar = page.locator("aside")
    await expect(sidebar).toBeInViewport()
    const box = await sidebar.boundingBox()
    expect(box?.height).toBeLessThanOrEqual(768)
    await sidebar.getByRole("link", { name: "Settings" }).scrollIntoViewIfNeeded()
    await expect(sidebar.getByRole("link", { name: "Settings" })).toBeInViewport()
  })

  test("role-filtered navigation in preview", async ({ page }) => {
    await page.goto("/portal")
    await page.getByLabel("View as").selectOption("inspector")
    const nav = page.getByRole("navigation", { name: "Portal" })
    await expect(nav.getByRole("link", { name: "Audit log" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "QR labels" })).toHaveCount(0)
    await expect(nav.getByRole("link", { name: "Devices" })).toHaveCount(0)
  })
})
