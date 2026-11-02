import { expect, test, type Browser, type Page } from "@playwright/test"

// Accounts seeded by website/backend/scripts/e2e_server.py; see auth.fullstack.ts.
const ADMIN = "admin@e2e.test"
const STOREKEEPER = "storekeeper@e2e.test"
const INSPECTOR = "inspector@e2e.test"

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

/** A browser with no staff session, like a customer's. */
async function visitor(browser: Browser) {
  const context = await browser.newContext()
  return { page: await context.newPage(), close: () => context.close() }
}

// The tests share one database, so names are unique per run.
const run = Date.now().toString(36)
const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-")

async function addProduct(
  page: Page,
  fields: { name: string; category?: string; summary?: string; price?: string; currency?: string; publish?: boolean },
) {
  await page.getByRole("button", { name: "Add product" }).click()
  const sheet = page.getByRole("dialog", { name: "Add product" })
  await sheet.getByLabel("Name").fill(fields.name)
  if (fields.category) await sheet.getByLabel("Category").selectOption({ label: fields.category })
  if (fields.summary) await sheet.getByLabel("Summary").fill(fields.summary)
  if (fields.price) await sheet.getByLabel("Amount").fill(fields.price)
  if (fields.currency !== undefined) await sheet.getByLabel("Currency code").fill(fields.currency)
  if (fields.publish) await sheet.getByLabel("Show on the public website").check()
  await sheet.getByRole("button", { name: "Add product" }).click()
  await expect(sheet).toBeHidden()
}

test("administrator publishes a product and customers see only published ones", async ({ page, browser }) => {
  const category = `Breads ${run}`
  const published = `Sourdough ${run}`
  const draft = `Unreleased tart ${run}`

  await signIn(page, ADMIN)
  await page.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "Public catalogue" }).click()
  await expect(page.getByRole("heading", { name: "Public catalogue", level: 1 })).toBeVisible()

  await page.getByLabel("New category").fill(category)
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await expect(page.getByText(`Added the category “${category}”.`)).toBeVisible()

  await addProduct(page, { name: published, category, summary: "Slow-fermented.", price: "4.50", currency: "EUR", publish: true })
  await expect(page.getByText(`Added “${published}” and published it.`)).toBeVisible()
  await addProduct(page, { name: draft, currency: "" })
  await expect(page.getByText(`Added “${draft}” as a draft.`)).toBeVisible()

  const customer = await visitor(browser)
  try {
    await customer.page.goto("/products")
    await expect(customer.page.getByRole("link", { name: published })).toBeVisible()
    await expect(customer.page.getByText(draft)).toHaveCount(0)
    await customer.page.getByRole("group", { name: "Category" }).getByRole("button", { name: category }).click()
    await expect(customer.page.getByRole("link", { name: published })).toBeVisible()

    await customer.page.getByRole("link", { name: published }).click()
    await expect(customer.page.getByRole("heading", { name: published, level: 1 })).toBeVisible()
    await expect(customer.page.getByText("€4.50")).toBeVisible()

    await customer.page.goto(`/products/${slugOf(draft)}`)
    await expect(customer.page.getByRole("heading", { name: "Product not found", level: 1 })).toBeVisible()

    // Unpublishing takes it off the website.
    await page.getByRole("button", { name: `Unpublish ${published}` }).click()
    await expect(page.getByRole("button", { name: `Publish ${published}` })).toBeVisible()
    await customer.page.goto(`/products/${slugOf(published)}`)
    await expect(customer.page.getByRole("heading", { name: "Product not found", level: 1 })).toBeVisible()
  } finally {
    await customer.close()
  }

  // A category with products can't be deleted; delete the products first.
  await page.getByRole("button", { name: `Delete ${category}` }).click()
  await expect(page.getByText(`“${category}” still has products. Move or delete them first.`)).toBeVisible()
  await page.getByRole("button", { name: `Edit ${published}` }).click()
  const sheet = page.getByRole("dialog", { name: "Edit product" })
  await sheet.getByRole("button", { name: "Delete product…" }).click()
  await sheet.getByRole("button", { name: "Delete", exact: true }).click()
  await expect(page.getByText(`Deleted “${published}”.`)).toBeVisible()
  await page.getByRole("button", { name: `Delete ${category}` }).click()
  await expect(page.getByText(`Deleted the category “${category}”.`)).toBeVisible()
})

test("the server refuses invalid input and the form shows its reason", async ({ page }) => {
  const name = `Duplicate address ${run}`
  await signIn(page, ADMIN)
  await page.goto("/portal/catalogue")
  await addProduct(page, { name, currency: "" })

  await page.getByRole("button", { name: "Add product" }).click()
  const sheet = page.getByRole("dialog", { name: "Add product" })
  await sheet.getByLabel("Name").fill(`Another ${run}`)
  await sheet.getByLabel("Currency code").fill("")
  await sheet.getByLabel("Web address").fill(slugOf(name))
  await sheet.getByRole("button", { name: "Add product" }).click()
  await expect(sheet.getByRole("alert")).toHaveText("Another product already uses that web address.")
})

for (const email of [STOREKEEPER, INSPECTOR]) {
  test(`${email.split("@")[0]} can't open or use the catalogue`, async ({ page }) => {
    await signIn(page, email)
    await expect(page.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "Public catalogue" })).toHaveCount(0)
    await page.goto("/portal/catalogue")
    await expect(page.getByRole("heading", { name: "You don't have access to this page" })).toBeVisible()

    const response = await page.request.get("/api/v1/catalogue/products")
    expect(response.status()).toBe(403)
  })
}

for (const theme of ["light", "dark"] as const) {
  for (const viewport of [{ name: "mobile", width: 375, height: 812 }, { name: "desktop", width: 1440, height: 900 }]) {
    test(`catalogue screens fit and render (${viewport.name}, ${theme})`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.addInitScript((value) => window.localStorage.setItem("ecopantry-theme", value), theme)
      const fits = async () =>
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      const shot = (name: string) =>
        page.screenshot({ path: `e2e/.screenshots/fullstack-${viewport.name}-${theme}-${name}.png`, fullPage: true })

      await signIn(page, ADMIN)
      await page.goto("/portal/catalogue")
      const name = `Croissant ${theme} ${viewport.name} ${run}`
      await addProduct(page, { name, summary: "Laminated by hand.", price: "1.90", currency: "EUR", publish: true })
      await expect(page.getByRole("button", { name: `Unpublish ${name}` })).toBeVisible()
      await fits()
      await shot("catalogue")

      await page.getByRole("button", { name: `Edit ${name}` }).click()
      await expect(page.getByRole("dialog", { name: "Edit product" })).toBeVisible()
      // The sheet is fixed to the viewport, so capture the viewport with its slide-in finished.
      await page.screenshot({
        path: `e2e/.screenshots/fullstack-${viewport.name}-${theme}-catalogue-edit.png`,
        animations: "disabled",
      })

      await page.goto("/products")
      await expect(page.getByRole("link", { name })).toBeVisible()
      await fits()
      await shot("products")
    })
  }
}
