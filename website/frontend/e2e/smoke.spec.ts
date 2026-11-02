import { expect, test, type Page } from "@playwright/test"

const PUBLIC_ROUTES = ["/", "/products", "/products/sourdough-loaf", "/products/example", "/about", "/contact", "/no-such-page"]
const PORTAL_ROUTES = [
  "/portal",
  "/portal/alerts",
  "/portal/inventory",
  "/portal/batches",
  "/portal/expiry",
  "/portal/scan",
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
  "/portal/catalogue",
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
    if (message.type() !== "error") return
    // Chrome logs every 4xx/5xx API answer. The pages handle those (and the tests check the
    // resulting states), so only page-level errors and other console errors count here.
    if (message.text().startsWith("Failed to load resource") && message.location().url.includes("/api/v1/")) return
    errors.push(message.text())
  })
  return errors
}

// Test fixture for the public catalogue endpoints; never shipped. Includes a long name and
// summary so wrapping is exercised, and a product without a price or category.
const CATEGORIES = [
  { slug: "breads", name: "Breads" },
  { slug: "pastries", name: "Pastries" },
  { slug: "cakes", name: "Cakes" },
]
const PRODUCTS = [
  { slug: "sourdough-loaf", name: "Sourdough loaf", summary: "Slow-fermented over two days for a crisp crust.", category: CATEGORIES[0], price: "4.50", currency: "EUR" },
  { slug: "rye", name: "Rye bread", summary: "Dense and dark.", category: CATEGORIES[0], price: "3.80", currency: "EUR" },
  { slug: "croissant", name: "Croissant", summary: "Laminated by hand with cultured butter.", category: CATEGORIES[1], price: "1.90", currency: "EUR" },
  {
    slug: "seasonal-fruit-and-almond-frangipane-tart",
    name: "Seasonal fruit and almond frangipane tart with a shortcrust base",
    summary: "Whatever fruit is in season, baked into almond cream on a buttery shortcrust base, finished with a thin apricot glaze and toasted flaked almonds.",
    category: CATEGORIES[2],
    price: "24.00",
    currency: "EUR",
  },
  { slug: "day-old-bread", name: "Day-old bread", summary: null, category: null, price: null, currency: null },
]

async function mockPublicCatalogue(page: Page) {
  await page.route("**/api/v1/public/catalogue", (route) =>
    route.fulfill({ json: { categories: CATEGORIES, products: PRODUCTS } }),
  )
  await page.route("**/api/v1/public/catalogue/products/*", (route) => {
    const slug = new URL(route.request().url()).pathname.split("/").pop()
    const product = PRODUCTS.find((candidate) => candidate.slug === slug)
    return product
      ? route.fulfill({ json: { ...product, description: "Made with our own starter.\n\nBaked every morning before we open." } })
      : route.fulfill({ status: 404, json: { detail: "That product isn't available.", code: "not_found" } })
  })
}

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test.describe(`${viewport.name} / ${theme}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } })

      for (const route of [...PUBLIC_ROUTES, ...PORTAL_ROUTES]) {
        test(`renders ${route}`, async ({ page }) => {
          const errors = collectErrors(page)
          await useTheme(page, theme)
          await mockPublicCatalogue(page)
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
const LAYOUT_WIDTHS = [1920, 1440, 1280, 1024, 768, 412, 375]
const LAYOUT_ROUTES = [
  "/",
  "/about",
  "/products",
  "/portal",
  "/portal/inventory",
  "/portal/waste",
  "/portal/settings",
  "/portal/scan",
  "/portal/qr",
]

for (const width of LAYOUT_WIDTHS) {
  for (const theme of THEMES) {
    test.describe(`layout ${width}px / ${theme}`, () => {
      test.use({ viewport: { width, height: width < 800 ? 812 : 900 } })

      for (const route of LAYOUT_ROUTES) {
        test(`${route} fits the viewport`, async ({ page }) => {
          const errors = collectErrors(page)
          await useTheme(page, theme)
          await mockPublicCatalogue(page)
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

/** Top bar: page name on the left; the scan shortcut and account menu on the right edge, never overlapping. */
async function checkPortalHeader(page: Page) {
  const viewport = page.viewportSize()?.width ?? 0
  const title = await page.locator("main").evaluate(() => {
    const header = document.querySelector("header")
    return header ? header.getBoundingClientRect() : null
  })
  const scan = await page.getByRole("link", { name: "Scan a QR label" }).boundingBox()
  const account = await page.getByRole("button", { name: "Account menu" }).boundingBox()
  expect(scan && account && title).toBeTruthy()
  if (!scan || !account || !title) return
  // Account menu sits at the header's right edge (within its padding), scan button just before it.
  expect(title.right - (account.x + account.width)).toBeLessThanOrEqual(21)
  expect(title.right).toBeLessThanOrEqual(viewport)
  expect(scan.x + scan.width).toBeLessThanOrEqual(account.x)
  expect(scan.y + scan.height).toBeLessThanOrEqual(title.bottom)
}

async function checkFooter(page: Page, width: number) {
  const footer = page.locator("footer")
  const box = await footer.boundingBox()
  const links = footer.getByRole("navigation", { name: "Footer" })
  if (width >= 768) {
    // Compact: one band, not a tall block.
    expect(box?.height ?? 999).toBeLessThanOrEqual(150)
    // Links sit under the main navigation's centre, not pushed against the right edge.
    const nav = await links.boundingBox()
    const centre = (nav?.x ?? 0) + (nav?.width ?? 0) / 2
    expect(Math.abs(centre - width / 2)).toBeLessThanOrEqual(2)
  } else {
    for (const link of await links.getByRole("link").all()) {
      expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    }
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

  await checkFooter(page, width)

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
  await checkPortalHeader(page)
  if (width >= 1024) {
    await expect(sidebar).toBeVisible()
    await expect(quick).toBeHidden()
    // Content uses the width beside the sidebar instead of a narrow centred column.
    const main = await page.locator("main").boundingBox()
    const heading = await page.getByRole("heading", { level: 1 }).boundingBox()
    const sidebarBox = await sidebar.boundingBox()
    expect((heading?.x ?? 0) - ((sidebarBox?.x ?? 0) + (sidebarBox?.width ?? 0))).toBeLessThanOrEqual(33)
    expect((main?.x ?? 0) + (main?.width ?? 0)).toBeGreaterThanOrEqual(width - 1)
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

// Browser zoom shrinks the CSS viewport and raises the pixel ratio: 1440px at 200% is a 720px
// viewport at 2x. Emulating it that way checks the layout the zoomed browser would compute.
const ZOOMS = [1.25, 1.5, 2]
const ZOOM_ROUTES = ["/", "/products", "/portal", "/portal/scan", "/portal/qr", "/portal/settings"]

for (const zoom of ZOOMS) {
  for (const base of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    test.describe(`zoom ${zoom * 100}% of ${base.width}px`, () => {
      const width = Math.round(base.width / zoom)
      test.use({ viewport: { width, height: Math.round(base.height / zoom) }, deviceScaleFactor: zoom })

      for (const route of ZOOM_ROUTES) {
        test(`${route} stays usable`, async ({ page }) => {
          const errors = collectErrors(page)
          await mockPublicCatalogue(page)
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
    await quick.getByRole("link", { name: "Environment" }).click()
    await expect(page).toHaveURL(/\/portal\/environment$/)
    await expect(quick.getByRole("link", { name: "Environment" })).toHaveAttribute("aria-current", "page")
    // Alerts moved from the bar into the full navigation.
    await expect(quick.getByRole("link", { name: "Alerts" })).toHaveCount(0)

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
    test.skip(!!test.info().project.use.isMobile, "Uses the desktop layout; the phone layout has its own tests")
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
    test.skip(!!test.info().project.use.isMobile, "Uses the desktop layout; the phone layout has its own tests")
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
    test.skip(!!test.info().project.use.isMobile, "Uses the desktop layout; the phone layout has its own tests")
    await page.goto("/portal")
    await page.getByLabel("View as").selectOption("inspector")
    const nav = page.getByRole("navigation", { name: "Portal" })
    await expect(nav.getByRole("link", { name: "Audit log" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "QR labels" })).toHaveCount(0)
    await expect(nav.getByRole("link", { name: "Devices" })).toHaveCount(0)
  })
})

test.describe("public catalogue", () => {
  test("search and category filter work on a phone and keep the page width", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await mockPublicCatalogue(page)
    await page.goto("/products")
    await expect(page.getByRole("status")).toHaveText("5 products")
    await expect(page.getByText("€4.50")).toBeVisible()

    await page.getByLabel("Search").fill("almond")
    await expect(page.getByRole("status")).toHaveText("Showing 1 of 5 products")
    await expect(page).toHaveURL(/\?q=almond$/)

    await page.getByLabel("Search").fill("")
    await page.getByRole("group", { name: "Category" }).getByRole("button", { name: "Breads" }).click()
    await expect(page.getByRole("status")).toHaveText("Showing 2 of 5 products")
    await expect(page.getByRole("button", { name: "Breads" })).toHaveAttribute("aria-pressed", "true")

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)

    // The whole entry is clickable, and keyboard focus lands on the product link.
    await page.getByRole("link", { name: "Rye bread" }).click()
    await expect(page.getByRole("heading", { name: "Rye bread", level: 1 })).toBeVisible()
    await expect(page).toHaveTitle("Rye bread | EcoPantry")
  })

  test("the product list says so when the server can't be reached", async ({ page }) => {
    // No mock: the dev proxy has no backend and answers 502.
    await page.goto("/products")
    await expect(page.getByText("The product list can't be loaded right now")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible()
  })

  test("unknown and unpublished products show not found", async ({ page }) => {
    await mockPublicCatalogue(page)
    await page.goto("/products/not-published")
    await expect(page.getByRole("heading", { name: "Product not found", level: 1 })).toBeVisible()
    await expect(page.getByRole("link", { name: "See all products" })).toBeVisible()
  })

  test("the public site never sends a request to the auth endpoints", async ({ page }) => {
    const requests: string[] = []
    page.on("request", (request) => requests.push(new URL(request.url()).pathname))
    await mockPublicCatalogue(page)
    for (const route of ["/", "/products", "/products/croissant", "/about", "/contact"]) {
      await page.goto(route)
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    }
    const api = requests.filter((path) => path.startsWith("/api/"))
    expect(api).toContain("/api/v1/public/catalogue")
    expect(api.filter((path) => !path.startsWith("/api/v1/public/"))).toEqual([])
  })
})
