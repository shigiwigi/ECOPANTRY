import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { routes } from "@/app/routes"
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context"
import type { StaffUser } from "@/features/auth/roles"
import { ThemeProvider } from "@/features/theme/ThemeProvider"
import { setCsrfToken } from "@/lib/api/client"
import { filterProducts, formatPrice, type PublicProduct } from "./public"
import { formValuesFrom, productFormSchema, toProductInput } from "./schemas"
import type { StaffCategory, StaffProduct } from "./staff"
import { usualCurrency } from "./staff"

// --- helpers ----------------------------------------------------------------

const BREADS = { slug: "breads", name: "Breads" }
const CAKES = { slug: "cakes", name: "Cakes" }

const PUBLIC_PRODUCTS: PublicProduct[] = [
  { slug: "sourdough", name: "Sourdough loaf", summary: "Slow-fermented, crisp crust", category: BREADS, price: "4.50", currency: "EUR" },
  { slug: "creme-brulee-tart", name: "Crème brûlée tart", summary: null, category: CAKES, price: null, currency: null },
  { slug: "rye", name: "Rye bread", summary: "Dense and dark", category: BREADS, price: "3.00", currency: "EUR" },
]

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

interface Call {
  method: string
  url: string
  headers: Headers
  body: unknown
  credentials?: RequestCredentials
}
let calls: Call[] = []

function stubFetch(handler: (call: Call) => Response | Promise<Response>) {
  calls = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = {
        method: (init.method ?? "GET").toUpperCase(),
        url,
        headers: new Headers(init.headers),
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
        credentials: init.credentials,
      }
      calls.push(call)
      return handler(call)
    }),
  )
}

function renderAt(path: string, user: StaffUser | null = null, { isPreview = false } = {}) {
  const auth: AuthContextValue = {
    user,
    status: "ready",
    endReason: null,
    isPreview,
    checkSession: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    setPreviewRole: null,
  }
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthContext.Provider value={auth}>
          <RouterProvider router={router} />
        </AuthContext.Provider>
      </ThemeProvider>
    </QueryClientProvider>,
  )
  return router
}

const ADMIN: StaffUser = { id: "a1", name: "Ada Admin", email: "ada@example.test", role: "admin", permissions: ["catalogue.manage"] }

beforeEach(() => setCsrfToken(null))
afterEach(() => vi.unstubAllGlobals())

// --- pure functions ---------------------------------------------------------

describe("public catalogue helpers", () => {
  it("formats prices in the given currency, falling back for unknown codes", () => {
    expect(formatPrice("4.5", "EUR", "en-IE")).toBe("€4.50")
    expect(formatPrice("1200", "LKR", "en-LK")).toMatch(/1,200\.00/)
    expect(formatPrice("2.00", "ZZ1", "en")).toBe("2.00 ZZ1")
  })

  it("filters by every search word, ignoring case and accents", () => {
    expect(filterProducts(PUBLIC_PRODUCTS, "creme", null).map((p) => p.slug)).toEqual(["creme-brulee-tart"])
    expect(filterProducts(PUBLIC_PRODUCTS, "BREAD dense", null).map((p) => p.slug)).toEqual(["rye"])
    expect(filterProducts(PUBLIC_PRODUCTS, "crust", null).map((p) => p.slug)).toEqual(["sourdough"])
    expect(filterProducts(PUBLIC_PRODUCTS, "", "breads").map((p) => p.slug)).toEqual(["sourdough", "rye"])
    expect(filterProducts(PUBLIC_PRODUCTS, "tart", "breads")).toEqual([])
  })
})

describe("product form", () => {
  const valid = formValuesFrom(null, null)

  it("needs a name and checks price, currency and web address", () => {
    const issues = (values: object) =>
      productFormSchema.safeParse({ ...valid, ...values }).error?.issues.map((issue) => issue.path.join(".")) ?? []

    expect(issues({ name: "Bun" })).toEqual([])
    expect(issues({ name: "  " })).toEqual(["name"])
    expect(issues({ name: "Bun", price: "4.5" })).toEqual(["currency"])
    expect(issues({ name: "Bun", currency: "EUR" })).toEqual(["price"])
    expect(issues({ name: "Bun", price: "4.505", currency: "EUR" })).toEqual(["price"])
    expect(issues({ name: "Bun", price: "-1", currency: "EUR" })).toEqual(["price"])
    expect(issues({ name: "Bun", slug: "Not ok" })).toEqual(["slug"])
  })

  it("sends nulls for empty fields and leaves out an unchanged or blank web address", () => {
    const parsed = productFormSchema.parse({ ...valid, name: " Bun ", price: "2", currency: "eur" })
    expect(toProductInput(parsed, null)).toEqual({
      name: "Bun",
      summary: null,
      description: null,
      category_id: null,
      price: "2",
      currency: "EUR",
      is_published: false,
    })

    const existing = { slug: "bun" } as StaffProduct
    expect(toProductInput({ ...parsed, slug: "bun" }, existing)).not.toHaveProperty("slug")
    expect(toProductInput({ ...parsed, slug: "soft-bun" }, existing)).toHaveProperty("slug", "soft-bun")
  })

  it("prefills new products with the currency most products use", () => {
    const products = [{ currency: "LKR" }, { currency: "EUR" }, { currency: "LKR" }, { currency: null }] as StaffProduct[]
    expect(usualCurrency(products)).toBe("LKR")
    expect(usualCurrency([])).toBeNull()
    expect(formValuesFrom(null, "LKR").currency).toBe("LKR")
  })
})

// --- public pages -----------------------------------------------------------

describe("public products page", () => {
  beforeEach(() =>
    stubFetch(() => json({ categories: [BREADS, CAKES], products: PUBLIC_PRODUCTS })),
  )

  it("lists published products with prices, without sending the staff cookie", async () => {
    renderAt("/products")

    expect(await screen.findByRole("link", { name: "Sourdough loaf" })).toHaveAttribute("href", "/products/sourdough")
    expect(screen.getAllByRole("listitem")).toHaveLength(3)
    expect(screen.getByText("€4.50")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("3 products")
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: "GET", url: "/api/v1/public/catalogue", credentials: "omit" })
  })

  it("filters by search text and category, and keeps both in the address", async () => {
    const user = userEvent.setup()
    const router = renderAt("/products")
    await screen.findByRole("link", { name: "Sourdough loaf" })

    await user.type(screen.getByLabelText("Search"), "dense")
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 3 products")
    expect(screen.getByRole("link", { name: "Rye bread" })).toBeInTheDocument()
    expect(router.state.location.search).toBe("?q=dense")

    await user.clear(screen.getByLabelText("Search"))
    const categories = screen.getByRole("group", { name: "Category" })
    await user.click(within(categories).getByRole("button", { name: "Cakes" }))
    expect(within(categories).getByRole("button", { name: "Cakes" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getAllByRole("listitem")).toHaveLength(1)
    expect(router.state.location.search).toBe("?category=cakes")
  })

  it("says when nothing matches and offers to show everything", async () => {
    const user = userEvent.setup()
    renderAt("/products?q=baguette")

    expect(await screen.findByText("No products match your search")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Show all products" }))
    expect(screen.getAllByRole("listitem")).toHaveLength(3)
  })

  it("explains when the server can't be reached and can try again", async () => {
    stubFetch(() => new Response("Bad gateway", { status: 502 }))
    const user = userEvent.setup()
    renderAt("/products")

    expect(await screen.findByText("The product list can't be loaded right now")).toBeInTheDocument()
    stubFetch(() => json({ categories: [], products: PUBLIC_PRODUCTS }))
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByRole("link", { name: "Rye bread" })).toBeInTheDocument()
  })
})

describe("public product page", () => {
  it("shows one product with its description paragraphs", async () => {
    stubFetch(() => json({ ...PUBLIC_PRODUCTS[0], description: "Made with our own starter.\n\nBaked every morning." }))
    renderAt("/products/sourdough")

    expect(await screen.findByRole("heading", { name: "Sourdough loaf", level: 1 })).toBeInTheDocument()
    expect(screen.getByText("Baked every morning.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Breads" })).toHaveAttribute("href", "/products?category=breads")
    expect(document.title).toBe("Sourdough loaf | EcoPantry")
    expect(calls[0]).toMatchObject({ url: "/api/v1/public/catalogue/products/sourdough", credentials: "omit" })
  })

  it("shows not found for unknown or unpublished products", async () => {
    stubFetch(() => json({ detail: "That product isn't available.", code: "not_found" }, 404))
    renderAt("/products/secret-draft")

    expect(await screen.findByRole("heading", { name: "Product not found", level: 1 })).toBeInTheDocument()
    expect(document.title).toBe("Product not found | EcoPantry")
  })
})

// --- portal -----------------------------------------------------------------

function fakeCatalogueApi() {
  const categories: StaffCategory[] = [
    { id: "c1", slug: "breads", name: "Breads", product_count: 1, created_at: "", updated_at: "" },
  ]
  const products: StaffProduct[] = [
    {
      id: "p1", slug: "sourdough", name: "Sourdough loaf", summary: null, description: null, category_id: "c1",
      category_name: "Breads", price: "4.50", currency: "EUR", is_published: true, published_at: "2026-11-02T08:00:00Z",
      created_at: "", updated_at: "",
    },
  ]
  stubFetch(({ method, url, body }) => {
    const input = body as Partial<StaffProduct>
    if (method === "GET" && url === "/api/v1/catalogue/products") return json(products)
    if (method === "GET" && url === "/api/v1/catalogue/categories") return json(categories)
    if (method === "POST" && url === "/api/v1/catalogue/products") {
      const product = { ...products[0], ...input, id: "p2", slug: "new", category_name: null, published_at: null } as StaffProduct
      products.push(product)
      return json(product, 201)
    }
    if (method === "PATCH" && url === "/api/v1/catalogue/products/p1") {
      Object.assign(products[0], input)
      return json(products[0])
    }
    if (method === "POST" && url === "/api/v1/catalogue/categories") {
      return json({ ...categories[0], id: "c2", name: (body as { name: string }).name, product_count: 0 }, 201)
    }
    return json({ detail: "Not found.", code: "not_found" }, 404)
  })
}

describe("portal catalogue page", () => {
  beforeEach(() => {
    setCsrfToken("csrf-from-session")
    fakeCatalogueApi()
  })

  it("lists products with their status for administrators", async () => {
    renderAt("/portal/catalogue", ADMIN)

    expect(await screen.findByText("Sourdough loaf")).toBeInTheDocument()
    expect(screen.getByText("Published")).toBeInTheDocument()
    expect(screen.getByText("/products/sourdough")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Unpublish Sourdough loaf" })).toBeInTheDocument()
  })

  it("adds a product as a draft, sending the CSRF token", async () => {
    const user = userEvent.setup()
    renderAt("/portal/catalogue", ADMIN)
    await screen.findByText("Sourdough loaf")

    await user.click(screen.getByRole("button", { name: "Add product" }))
    const sheet = await screen.findByRole("dialog", { name: "Add product" })
    expect(within(sheet).getByLabelText("Currency code")).toHaveValue("EUR")
    await user.type(within(sheet).getByLabelText("Name"), "Cinnamon roll")
    await user.type(within(sheet).getByLabelText("Amount"), "2.20")
    await user.click(within(sheet).getByRole("button", { name: "Add product" }))

    expect(await screen.findByText("Added “Cinnamon roll” as a draft.")).toBeInTheDocument()
    const post = calls.find((call) => call.method === "POST")!
    expect(post.headers.get("X-CSRF-Token")).toBe("csrf-from-session")
    expect(post.body).toEqual({
      name: "Cinnamon roll",
      summary: null,
      description: null,
      category_id: null,
      price: "2.20",
      currency: "EUR",
      is_published: false,
    })
  })

  it("checks the form before sending anything", async () => {
    const user = userEvent.setup()
    renderAt("/portal/catalogue", ADMIN)
    await screen.findByText("Sourdough loaf")

    await user.click(screen.getByRole("button", { name: "Add product" }))
    const sheet = await screen.findByRole("dialog", { name: "Add product" })
    await user.clear(within(sheet).getByLabelText("Currency code"))
    await user.type(within(sheet).getByLabelText("Amount"), "3")
    await user.click(within(sheet).getByRole("button", { name: "Add product" }))

    expect(await within(sheet).findByText("Enter a product name.")).toBeInTheDocument()
    expect(within(sheet).getByText("Add the currency for this price.")).toBeInTheDocument()
    expect(within(sheet).getByLabelText("Name")).toHaveAttribute("aria-invalid", "true")
    expect(calls.some((call) => call.method === "POST")).toBe(false)
  })

  it("unpublishes a product", async () => {
    const user = userEvent.setup()
    renderAt("/portal/catalogue", ADMIN)

    await user.click(await screen.findByRole("button", { name: "Unpublish Sourdough loaf" }))

    expect(await screen.findByText("“Sourdough loaf” is a draft again and no longer on the website.")).toBeInTheDocument()
    const patch = calls.find((call) => call.method === "PATCH")!
    expect(patch).toMatchObject({ url: "/api/v1/catalogue/products/p1", body: { is_published: false } })
    expect(await screen.findByRole("button", { name: "Publish Sourdough loaf" })).toBeInTheDocument()
  })

  it("won't delete a category that still has products", async () => {
    const user = userEvent.setup()
    renderAt("/portal/catalogue", ADMIN)

    await user.click(await screen.findByRole("button", { name: "Delete Breads" }))

    expect(screen.getByText("“Breads” still has products. Move or delete them first.")).toBeInTheDocument()
    expect(calls.some((call) => call.method === "DELETE")).toBe(false)
  })

  it("adds a category", async () => {
    const user = userEvent.setup()
    renderAt("/portal/catalogue", ADMIN)
    await screen.findByText("Sourdough loaf")

    await user.type(screen.getByLabelText("New category"), "Cakes")
    await user.click(screen.getByRole("button", { name: "Add" }))

    expect(await screen.findByText("Added the category “Cakes”.")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText("New category")).toHaveValue(""))
  })

  it("doesn't call the API from the development preview", async () => {
    renderAt("/portal/catalogue", ADMIN, { isPreview: true })

    expect(await screen.findByText("Needs a real sign-in")).toBeInTheDocument()
    expect(calls).toEqual([])
  })
})
