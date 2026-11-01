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

// Every width from small phones to large desktops. 375 and 1440 also get the full route sweep above.
const LAYOUT_WIDTHS = [1440, 1280, 1024, 768, 412, 375]
const LAYOUT_ROUTES = ["/", "/about", "/portal", "/portal/inventory", "/portal/waste", "/portal/settings"]

for (const width of LAYOUT_WIDTHS) {
  for (const theme of THEMES) {
    test.describe(`layout ${width}px / ${theme}`, () => {
      test.use({ viewport: { width, height: width < 800 ? 812 : 900 } })

      for (const route of LAYOUT_ROUTES) {
        test(`${route} fits the viewport`, async ({ page }) => {
          const errors = collectErrors(page)
          await useTheme(page, theme)
          await page.goto(route)
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible()

          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
          expect(overflow, "horizontal page overflow").toBeLessThanOrEqual(0)
          expect(errors).toEqual([])

          if (route.startsWith("/portal")) await checkPortalLayout(page, width)
          else await checkPublicLayout(page, width)
        })
      }
    })
  }
}

async function checkPublicLayout(page: Page, width: number) {
  // Header, page content and footer share one container, so their left edges line up.
  const logo = await page.getByRole("link", { name: "EcoPantry home" }).boundingBox()
  const heading = await page.getByRole("heading", { level: 1 }).boundingBox()
  const footerLogo = await page.locator("footer svg").first().boundingBox()
  expect(Math.abs((logo?.x ?? 0) - (heading?.x ?? -99))).toBeLessThanOrEqual(1)
  expect(Math.abs((logo?.x ?? 0) - (footerLogo?.x ?? -99))).toBeLessThanOrEqual(1)

  const mainNav = page.getByRole("navigation", { name: "Main" })
  if (width >= 768) {
    await expect(mainNav).toBeVisible()
    await expect(page.getByRole("button", { name: "Open menu" })).toBeHidden()
    // The main navigation is centred in the header, not pushed around by the side groups.
    const box = await mainNav.boundingBox()
    const centre = (box?.x ?? 0) + (box?.width ?? 0) / 2
    expect(Math.abs(centre - width / 2)).toBeLessThanOrEqual(2)
  } else {
    await expect(mainNav).toBeHidden()
    const menu = await page.getByRole("button", { name: "Open menu" }).boundingBox()
    expect(menu?.width).toBeGreaterThanOrEqual(44)
  }

  // Content is capped at 1280px on wide screens.
  if (width >= 1440) {
    const content = await page.locator("main .container-page").first().evaluate((el) => {
      const style = getComputedStyle(el)
      return el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    })
    expect(content).toBeLessThanOrEqual(1280)
    expect(content).toBeGreaterThanOrEqual(1200)
  }
}

async function checkPortalLayout(page: Page, width: number) {
  const sidebar = page.locator("aside")
  const quick = page.getByRole("navigation", { name: "Quick" })
  if (width >= 1024) {
    await expect(sidebar).toBeVisible()
    await expect(quick).toBeHidden()
    return
  }
  await expect(sidebar).toBeHidden()
  await expect(quick).toBeVisible()

  // Tabs are comfortable touch targets.
  for (const box of await quick.locator("a, button").evaluateAll((els) => els.map((el) => el.getBoundingClientRect()))) {
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.width).toBeGreaterThanOrEqual(44)
  }

  // Scrolled to the bottom, the last piece of content sits above the fixed bar.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const barTop = (await quick.boundingBox())?.y ?? 0
  const lastBottom = await page
    .locator("main")
    .evaluate((main) => Math.max(...[...main.querySelectorAll("*")].map((el) => el.getBoundingClientRect().bottom)))
  expect(lastBottom).toBeLessThanOrEqual(barTop)
}

test.describe("interactions", () => {
  test("mobile portal drawer navigates and closes", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto("/portal")
    await page.getByRole("button", { name: "More modules" }).click()
    await page.getByRole("dialog").getByRole("link", { name: "Inventory" }).click()
    await expect(page).toHaveURL(/\/portal\/inventory$/)
    await expect(page.getByRole("dialog")).toBeHidden()
    await expect(page.getByRole("heading", { level: 1, name: "Ingredient inventory" })).toBeVisible()
  })

  test("portal bottom bar marks the active tab and More for other modules", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto("/portal/inventory")
    const quick = page.getByRole("navigation", { name: "Quick" })
    await expect(quick.getByRole("link", { name: "Inventory" })).toHaveAttribute("aria-current", "page")
    await quick.getByRole("link", { name: "Alerts" }).click()
    await expect(page).toHaveURL(/\/portal\/alerts$/)
    await expect(quick.getByRole("link", { name: "Alerts" })).toHaveAttribute("aria-current", "page")

    // A module that isn't a tab is reached through More, which opens the full navigation.
    await quick.getByRole("button", { name: "More modules" }).click()
    const drawer = page.getByRole("dialog")
    await drawer.getByRole("link", { name: "Audit log" }).click()
    await expect(page).toHaveURL(/\/portal\/audit$/)
    await expect(quick.locator("[aria-current=page]")).toHaveCount(0)
  })

  test("portal drawer closes with Escape and returns focus to More", async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 })
    await page.goto("/portal")
    const more = page.getByRole("button", { name: "More modules" })
    await more.click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toBeHidden()
    await expect(more).toBeFocused()
  })

  test("portal drawer closes when the window grows into the sidebar layout", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 })
    await page.goto("/portal")
    await page.getByRole("button", { name: "More modules" }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(page.getByRole("dialog")).toBeHidden()
  })

  test("public menu traps focus, locks scrolling and closes with Escape", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto("/about")
    const trigger = page.getByRole("button", { name: "Open menu" })
    await trigger.click()
    const drawer = page.getByRole("dialog")
    await expect(drawer).toBeVisible()
    // Focus starts on the current page's link.
    await expect(drawer.getByRole("link", { name: "About" })).toBeFocused()
    await expect(drawer.getByRole("link", { name: "About" })).toHaveAttribute("aria-current", "page")
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden")

    for (let i = 0; i < 12; i++) await page.keyboard.press("Tab")
    expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true)

    await page.keyboard.press("Escape")
    await expect(drawer).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test("public menu theme control switches theme", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.emulateMedia({ colorScheme: "light" })
    await page.goto("/")
    await page.getByRole("button", { name: "Open menu" }).click()
    const drawer = page.getByRole("dialog")
    await drawer.getByRole("radio", { name: "Dark" }).check({ force: true })
    await expect(page.locator("html")).toHaveClass(/dark/)
    await drawer.getByRole("button", { name: "Close menu" }).click()
    await expect(drawer).toBeHidden()
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
    // No mock: the dev server's /api/v1 proxy has no backend behind it and answers the login POST with a bare 502.
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
    await page.getByRole("button", { name: "More modules" }).click()
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
