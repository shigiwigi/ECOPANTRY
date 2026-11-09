import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { routes } from "@/app/routes"
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context"
import type { Role, StaffUser } from "@/features/auth/roles"
import { ThemeProvider } from "@/features/theme/ThemeProvider"
import { setCsrfToken } from "@/lib/api/client"
import type { Batch, BatchDetail, Ingredient } from "./api"
import { adjustFormSchema, consumeFormSchema, receiveFormSchema } from "./schemas"
import { formatQty, formatSigned } from "./format"

// --- helpers ----------------------------------------------------------------

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

interface Call {
  method: string
  url: string
  headers: Headers
  body: unknown
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
      }
      calls.push(call)
      return handler(call)
    }),
  )
}

const staff = (role: Role): StaffUser => ({ id: "u1", name: "Test User", email: "test@example.test", role })

function renderAt(path: string, user: StaffUser, { isPreview = false } = {}) {
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
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider>
        <AuthContext.Provider value={auth}>
          <RouterProvider router={router} />
        </AuthContext.Provider>
      </ThemeProvider>
    </QueryClientProvider>,
  )
  return router
}

const page = <T,>(items: T[]) => ({ items, total: items.length, limit: 25, offset: 0 })

const FLOUR: Ingredient = {
  id: "i1",
  name: "Strong white flour",
  unit: { code: "kg", name: "Kilogram", kind: "mass" },
  reorder_level: "10.000",
  total_remaining: "6.500",
  low_stock: true,
  notes: null,
  is_active: true,
}
const BUTTER: Ingredient = { ...FLOUR, id: "i2", name: "Butter", reorder_level: null, total_remaining: "20.000", low_stock: false }

const BATCH: Batch = {
  id: "b1",
  label_code: "K7M2Q9X4TR",
  ingredient: { id: "i1", name: "Strong white flour", unit: "kg" },
  storage_area: { id: "a1", name: "Dry store" },
  received_on: "2026-10-01",
  expiry_on: "2026-11-20",
  quantity: "12.000",
  remaining_quantity: "6.500",
  status: "near_expiry",
  notes: null,
  created_at: "2026-10-01T08:00:00Z",
}
const DETAIL: BatchDetail = {
  ...BATCH,
  movements: [
    { id: 2, kind: "out", quantity_delta: "-5.500", remaining_after: "6.500", reason: "Morning bake", employee_name: "Sam Baker", created_at: "2026-10-02T06:00:00Z" },
    { id: 1, kind: "in", quantity_delta: "12.000", remaining_after: "12.000", reason: null, employee_name: "Ada Admin", created_at: "2026-10-01T08:00:00Z" },
  ],
}

beforeEach(() => setCsrfToken("csrf-token"))
afterEach(() => vi.unstubAllGlobals())

// --- pure helpers and schemas -----------------------------------------------

describe("inventory helpers", () => {
  it("trims trailing zeros and signs changes", () => {
    expect(formatQty("12.500")).toBe("12.5")
    expect(formatQty("10.000")).toBe("10")
    expect(formatQty("100")).toBe("100")
    expect(formatSigned("-5.500")).toBe("−5.5")
    expect(formatSigned("2.000")).toBe("+2")
  })

  it("validates quantities, dates and reasons like the backend", () => {
    const ok = { ingredientId: "i1", storageAreaId: "", quantity: "2.5", receivedOn: "2026-11-01", expiryOn: "2026-11-09", notes: "" }
    const failing = (values: object) => receiveFormSchema.safeParse({ ...ok, ...values }).error?.issues.map((i) => i.path.join(".")) ?? []
    expect(failing({})).toEqual([])
    expect(failing({ quantity: "0" })).toEqual(["quantity"])
    expect(failing({ quantity: "1.2345" })).toEqual(["quantity"])
    expect(failing({ ingredientId: "" })).toEqual(["ingredientId"])
    expect(failing({ expiryOn: "2026-10-31" })).toEqual(["expiryOn"])
    expect(consumeFormSchema.safeParse({ quantity: "-1", reason: "" }).success).toBe(false)
    expect(adjustFormSchema.safeParse({ direction: "increase", quantity: "1", reason: " " }).success).toBe(false)
  })
})

// --- inventory page ---------------------------------------------------------

describe("Inventory page", () => {
  const overview = (call: Call) => {
    if (call.url.startsWith("/api/v1/ingredients")) return json(page([FLOUR, BUTTER]))
    return json({}, 404)
  }

  it("shows loading, then stock with a low-stock badge", async () => {
    stubFetch(overview)
    renderAt("/portal/inventory", staff("shopkeeper"))

    expect(await screen.findByText("Loading stock…")).toBeInTheDocument()
    const table = await screen.findByRole("table", { name: "Ingredient stock" })
    const rows = within(table).getAllByRole("row")
    expect(rows[1]).toHaveTextContent("Strong white flour")
    expect(rows[1]).toHaveTextContent("6.5 kg")
    expect(rows[1]).toHaveTextContent("Low stock")
    expect(rows[2]).toHaveTextContent("Butter")
    expect(rows[2]).toHaveTextContent("Not set")
    expect(rows[2]).toHaveTextContent("OK")
  })

  it("explains an empty inventory", async () => {
    stubFetch(() => json(page([])))
    renderAt("/portal/inventory", staff("admin"))
    expect(await screen.findByText("No ingredients yet")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Receive stock" })).toBeInTheDocument()
  })

  it("reports a failed load and retries", async () => {
    let fail = true
    stubFetch(() => (fail ? json({ detail: "The server had a problem. Try again shortly.", code: "internal_error" }, 500) : json(page([FLOUR]))))
    renderAt("/portal/inventory", staff("admin"))
    expect(await screen.findByText("Stock couldn't be loaded")).toBeInTheDocument()
    expect(screen.getByText("The server had a problem. Try again shortly.")).toBeInTheDocument()

    fail = false
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByText("Strong white flour")).toBeInTheDocument()
  })

  it("searches by name", async () => {
    stubFetch(overview)
    renderAt("/portal/inventory", staff("admin"))
    await screen.findByRole("table")
    await userEvent.setup().type(screen.getByLabelText("Search ingredients"), "flo")

    await waitFor(() => expect(calls.some((call) => call.url.includes("q=flo"))).toBe(true))
  })

  it("hides every stock-changing control from inspectors", async () => {
    stubFetch(overview)
    renderAt("/portal/inventory", staff("food_inspector"))
    await screen.findByRole("table")

    expect(screen.queryByRole("button", { name: "Receive stock" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Add ingredient" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Receive / })).not.toBeInTheDocument()
  })

  it("receives stock: validates, posts with the CSRF token and confirms", async () => {
    stubFetch((call) => {
      if (call.method === "POST") return json({ ...DETAIL, quantity: "5.000" }, 201)
      if (call.url.startsWith("/api/v1/storage-areas")) return json(page([{ id: "a1", name: "Dry store", kind: "shelf", is_active: true }]))
      return overview(call)
    })
    renderAt("/portal/inventory", staff("shopkeeper"))
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: "Receive stock" }))

    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Receive stock" }))
    expect(await screen.findByText("Choose an ingredient.")).toBeInTheDocument()
    expect(calls.some((call) => call.method === "POST")).toBe(false)

    const dialog = screen.getByRole("dialog")
    await user.selectOptions(within(dialog).getByLabelText("Ingredient"), "i1")
    await user.type(within(dialog).getByLabelText(/Quantity received/), "5")
    await user.type(within(dialog).getByLabelText("Use by"), "2026-12-01")
    await user.click(within(dialog).getByRole("button", { name: "Receive stock" }))

    expect(await screen.findByText(/Received 5 kg of Strong white flour/)).toBeInTheDocument()
    const post = calls.find((call) => call.method === "POST")
    expect(post?.url).toBe("/api/v1/batches")
    expect(post?.headers.get("X-CSRF-Token")).toBe("csrf-token")
    expect(post?.body).toMatchObject({ ingredient_id: "i1", quantity: "5", expiry_on: "2026-12-01", storage_area_id: null })
  })

  it("doesn't ask the server in the development preview", async () => {
    stubFetch(() => json({}, 500))
    renderAt("/portal/inventory", staff("admin"), { isPreview: true })
    expect(await screen.findByText("Needs a real sign-in")).toBeInTheDocument()
    expect(calls).toEqual([])
  })
})

// --- batches page -----------------------------------------------------------

describe("Batches page", () => {
  function server(extra: (call: Call) => Response | undefined = () => undefined) {
    stubFetch((call) => {
      const custom = extra(call)
      if (custom) return custom
      if (call.url.startsWith("/api/v1/storage-areas")) return json(page([{ id: "a1", name: "Dry store", kind: "shelf", is_active: true }]))
      if (call.url.startsWith("/api/v1/batches/b1")) return json(DETAIL)
      if (call.url.startsWith("/api/v1/batches")) return json(page([BATCH]))
      return json({}, 404)
    })
  }

  it("lists batches with status, quantity and use-by date", async () => {
    server()
    renderAt("/portal/batches", staff("admin"))
    expect(await screen.findByText("Loading batches…")).toBeInTheDocument()

    const table = await screen.findByRole("table")
    const row = within(table).getAllByRole("row")[1]
    expect(row).toHaveTextContent("Strong white flour")
    expect(row).toHaveTextContent("K7M2Q-9X4TR")
    expect(row).toHaveTextContent("6.5 kg")
    expect(row).toHaveTextContent("20 Nov 2026")
    expect(row).toHaveTextContent("Near expiry")
    expect(calls.find((call) => call.url.startsWith("/api/v1/batches"))?.url).toContain("has_stock=true")
  })

  it("sends filters to the server", async () => {
    server()
    renderAt("/portal/batches", staff("admin"))
    await screen.findByRole("table")
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText("Status"), "expired")
    await waitFor(() => expect(calls.some((call) => call.url.includes("status=expired"))).toBe(true))
    await user.selectOptions(screen.getByLabelText("Storage area"), "a1")
    await waitFor(() => expect(calls.some((call) => call.url.includes("storage_area_id=a1"))).toBe(true))
  })

  it("explains an empty list differently for managers and inspectors", async () => {
    server((call) => (call.url.startsWith("/api/v1/batches") ? json(page([])) : undefined))
    renderAt("/portal/batches", staff("shopkeeper"))
    expect(await screen.findByText(/Receive stock to create the first batch/)).toBeInTheDocument()
  })

  it("shows a failed load with a retry", async () => {
    server((call) => (call.url.startsWith("/api/v1/batches") ? json({ detail: "Nope.", code: "x" }, 500) : undefined))
    renderAt("/portal/batches", staff("admin"))
    expect(await screen.findByText("Batches couldn't be loaded")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument()
  })

  it("opens a batch from the address (the scanner's link) with its movement history", async () => {
    server()
    renderAt("/portal/batches?batch=b1", staff("admin"))

    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByText("Morning bake")).toBeInTheDocument()
    expect(dialog).toHaveTextContent("Strong white flour")
    expect(dialog).toHaveTextContent("6.5 kg left")
    expect(dialog).toHaveTextContent("−5.5")
    expect(dialog).toHaveTextContent("Sam Baker")
    expect(dialog).toHaveTextContent("Received")
    // Looking at a batch only reads.
    expect(calls.filter((call) => call.method !== "GET")).toEqual([])
  })

  it("takes stock out and refreshes", async () => {
    server((call) => (call.method === "POST" ? json({ ...DETAIL, remaining_quantity: "4.500" }) : undefined))
    renderAt("/portal/batches?batch=b1", staff("shopkeeper"))
    const user = userEvent.setup()
    const dialog = await screen.findByRole("dialog")
    await user.click(await within(dialog).findByRole("button", { name: "Use stock" }))

    await user.click(within(dialog).getByRole("button", { name: "Take out" }))
    expect(await within(dialog).findByText("Enter a number with at most three decimals, for example 2.5.")).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText(/Quantity used/), "2")
    await user.click(within(dialog).getByRole("button", { name: "Take out" }))

    expect(await within(dialog).findByText("Took 2 kg out of the batch.")).toBeInTheDocument()
    const post = calls.find((call) => call.method === "POST")
    expect(post?.url).toBe("/api/v1/batches/b1/consume")
    expect(post?.headers.get("X-CSRF-Token")).toBe("csrf-token")
    expect(post?.body).toEqual({ quantity: "2", reason: null })
  })

  it("shows the server's message when more is taken than remains", async () => {
    server((call) =>
      call.method === "POST" ? json({ detail: "Only 6.5 kg left in this batch.", code: "insufficient_stock" }, 409) : undefined,
    )
    renderAt("/portal/batches?batch=b1", staff("admin"))
    const user = userEvent.setup()
    const dialog = await screen.findByRole("dialog")
    await user.click(await within(dialog).findByRole("button", { name: "Use stock" }))
    await user.type(within(dialog).getByLabelText(/Quantity used/), "9")
    await user.click(within(dialog).getByRole("button", { name: "Take out" }))

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Only 6.5 kg left in this batch.")
  })

  it("requires a reason to adjust and sends a signed amount", async () => {
    server((call) => (call.method === "POST" ? json(DETAIL) : undefined))
    renderAt("/portal/batches?batch=b1", staff("admin"))
    const user = userEvent.setup()
    const dialog = await screen.findByRole("dialog")
    await user.click(await within(dialog).findByRole("button", { name: "Adjust" }))

    await user.type(within(dialog).getByLabelText(/Amount/), "1.5")
    await user.click(within(dialog).getByRole("button", { name: "Save adjustment" }))
    expect(await within(dialog).findByText("Say why the stock is being adjusted.")).toBeInTheDocument()
    expect(calls.some((call) => call.method === "POST")).toBe(false)

    await user.type(within(dialog).getByLabelText("Reason"), "Spilled")
    await user.click(within(dialog).getByRole("button", { name: "Save adjustment" }))
    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true))
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ delta: "-1.5", reason: "Spilled" })
  })

  it("prints the batch's own label from the record", async () => {
    server()
    const print = vi.spyOn(window, "print").mockImplementation(() => {})
    renderAt("/portal/batches?batch=b1", staff("shopkeeper"))
    const dialog = await screen.findByRole("dialog")
    await userEvent.setup().click(await within(dialog).findByRole("button", { name: "Print label" }))

    await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
    expect(document.body.querySelector(":scope > .print-sheet")).toBeNull() // only exists while printing
  })

  it("hides stock controls from inspectors but still shows the history", async () => {
    server()
    renderAt("/portal/batches?batch=b1", staff("food_inspector"))
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByText("Morning bake")).toBeInTheDocument()

    expect(within(dialog).queryByRole("button", { name: "Use stock" })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole("button", { name: "Adjust" })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole("button", { name: "Print label" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Receive stock" })).not.toBeInTheDocument()
  })

  it("says when a batch can't be loaded", async () => {
    server((call) => (call.url.startsWith("/api/v1/batches/b1") ? json({ detail: "That batch doesn't exist.", code: "not_found" }, 404) : undefined))
    renderAt("/portal/batches?batch=b1", staff("admin"))
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByText("This batch couldn't be loaded.")).toBeInTheDocument()
  })
})
