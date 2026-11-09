import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { routes } from "@/app/routes"
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context"
import type { Role, StaffUser } from "@/features/auth/roles"
import { ThemeProvider } from "@/features/theme/ThemeProvider"
import { setCsrfToken } from "@/lib/api/client"
import { daysLeftLabel, formatQuantity, isValidQuantity, type ExpiryBatch, type FefoResult } from "./api"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

let urls: string[] = []

function stubFetch(handler: (url: string) => Response) {
  urls = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url)
      return handler(url)
    }),
  )
}

const staff = (role: Role): StaffUser => ({ id: `${role}-1`, name: `Test ${role}`, email: `${role}@example.test`, role })

function renderExpiry(user: StaffUser, { isPreview = false } = {}) {
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
  const router = createMemoryRouter(routes, { initialEntries: ["/portal/expiry"] })
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
}

afterEach(() => {
  vi.unstubAllGlobals()
  setCsrfToken(null)
})

const flour = { id: "ing-1", name: "Wheat flour", unit: "kg" }

function batch(overrides: Partial<ExpiryBatch> = {}): ExpiryBatch {
  return {
    id: "b1",
    label_code: "ABCDEFGH23",
    ingredient: flour,
    storage_area: { id: "a1", name: "Dry store" },
    received_on: "2026-11-01",
    expiry_on: "2026-11-12",
    quantity: "10.000",
    remaining_quantity: "4.500",
    days_left: 2,
    ...overrides,
  }
}

const page = <T,>(items: T[]) => ({ items, total: items.length, limit: 50, offset: 0 })

const fefoResult: FefoResult = {
  today: "2026-11-10",
  ingredient: flour,
  usable: [
    { id: "b1", label_code: "ABCDEFGH23", received_on: "2026-11-01", expiry_on: "2026-11-12", remaining_quantity: "1.500", days_left: 2 },
    { id: "b2", label_code: "JKMNPQRS45", received_on: "2026-11-02", expiry_on: "2026-11-20", remaining_quantity: "4.000", days_left: 10 },
  ],
  expired: [
    { id: "b3", label_code: "TVWXYZ0123", received_on: "2026-10-01", expiry_on: "2026-11-08", remaining_quantity: "7.000", days_left: -2 },
  ],
  requested: "3",
  pick: [],
  allocated: "3.000",
  shortfall: "0.000",
  sufficient: true,
}

function api(overrides: { near?: () => Response; expired?: () => Response; fefo?: () => Response } = {}) {
  stubFetch((url) => {
    if (url.includes("/expiry/summary")) return json({ today: "2026-11-10", window_days: 7, near_expiry: 2, expired: 1 })
    if (url.includes("/expiry/near")) {
      return overrides.near?.() ?? json(page([batch(), batch({ id: "b4", label_code: "ZZZZZZZZ22", days_left: 0, expiry_on: "2026-11-10" })]))
    }
    if (url.includes("/expiry/expired")) {
      return overrides.expired?.() ?? json(page([batch({ id: "b3", label_code: "TVWXYZ0123", days_left: -2, expiry_on: "2026-11-08" })]))
    }
    if (url.includes("/expiry/fefo")) {
      return overrides.fefo?.() ?? json({ ...fefoResult, pick: fefoResult.usable.map((b, i) => ({ batch: b, take: i === 0 ? "1.500" : "1.500" })) })
    }
    if (url.includes("/ingredients")) return json(page([{ id: "ing-1", name: "Wheat flour", unit: { code: "kg" } }]))
    return json({ detail: "Not found", code: "not_found" }, 404)
  })
}

describe("expiry helpers", () => {
  it("words the days left", () => {
    expect(daysLeftLabel(0)).toBe("Today")
    expect(daysLeftLabel(1)).toBe("in 1 day")
    expect(daysLeftLabel(5)).toBe("in 5 days")
    expect(daysLeftLabel(-1)).toBe("1 day ago")
    expect(daysLeftLabel(-3)).toBe("3 days ago")
  })

  it("formats and validates quantities", () => {
    expect(formatQuantity("2.500")).toBe("2.5")
    expect(isValidQuantity("")).toBe(true)
    expect(isValidQuantity("2.5")).toBe(true)
    expect(isValidQuantity("0")).toBe(false)
    expect(isValidQuantity("1.2345")).toBe(false)
    expect(isValidQuantity("abc")).toBe(false)
  })
})

describe("Expiry page", () => {
  it("shows summary tiles and the near-expiry table with warning styling", async () => {
    api()
    renderExpiry(staff("food_inspector"))

    expect(await screen.findByRole("heading", { name: "Expiry and FEFO", level: 1 })).toBeInTheDocument()
    const table = await screen.findByRole("table")
    expect(within(table).getByText("ABCDEFGH23")).toBeInTheDocument()
    expect(within(table).getAllByText("4.5 kg")[0]).toBeInTheDocument()
    expect(within(table).getByText("in 2 days").className).toMatch(/text-warning/)
    expect(within(table).getByText("Today")).toBeInTheDocument()
    expect(await screen.findByText("2", { selector: "p" })).toBeInTheDocument()
    expect(urls.some((url) => url.includes("/expiry/near") && url.includes("days=7"))).toBe(true)
  })

  it("changes the window and refetches", async () => {
    api()
    const user = userEvent.setup()
    renderExpiry(staff("shopkeeper"))
    await screen.findByRole("table")

    await user.click(screen.getByRole("button", { name: "14 days" }))

    await waitFor(() => expect(urls.some((url) => url.includes("/expiry/near") && url.includes("days=14"))).toBe(true))
    expect(urls.some((url) => url.includes("/expiry/summary?days=14"))).toBe(true)
  })

  it("switches to expired batches, styled as danger", async () => {
    api()
    const user = userEvent.setup()
    renderExpiry(staff("admin"))
    await screen.findByRole("table")

    await user.click(screen.getByRole("tab", { name: "Expired" }))

    const badge = await screen.findByText("Expired 2 days ago")
    expect(badge.className).toMatch(/text-destructive/)
    expect(screen.queryByRole("button", { name: "14 days" })).toBeNull()
  })

  it("sends the search text to the server", async () => {
    api()
    const user = userEvent.setup()
    renderExpiry(staff("admin"))
    await screen.findByRole("table")

    await user.type(screen.getByRole("searchbox"), "flour")

    await waitFor(() => expect(urls.some((url) => url.includes("/expiry/near") && url.includes("q=flour"))).toBe(true))
  })

  it("explains an empty list", async () => {
    api({ near: () => json(page([])) })
    renderExpiry(staff("admin"))

    expect(await screen.findByText("Nothing expires in the next 7 days")).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("shows a loading state first", async () => {
    stubFetch(() => new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))
    renderExpiry(staff("admin"))

    expect(await screen.findByText("Loading batches…")).toBeInTheDocument()
  })

  it("shows the server's error and offers a retry", async () => {
    api({ near: () => json({ detail: "Something went wrong.", code: "server_error" }, 500) })
    renderExpiry(staff("admin"))

    expect(await screen.findByText("Couldn't load the list")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument()
  })

  it("does not call the server in the development preview", async () => {
    api()
    renderExpiry(staff("admin"), { isPreview: true })

    expect(await screen.findByText("Needs a real sign-in")).toBeInTheDocument()
    expect(urls.filter((url) => url.includes("/expiry"))).toEqual([])
  })
})

describe("FEFO panel", () => {
  async function choose(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole("table")
    const select = screen.getByLabelText("Ingredient")
    await waitFor(() => expect(within(select).getByRole("option", { name: "Wheat flour (kg)" })).toBeInTheDocument())
    await user.selectOptions(select, "ing-1")
  }

  it("lists the batches in order and flags expired stock as not to be used", async () => {
    api({ fefo: () => json({ ...fefoResult, requested: null, pick: null, allocated: null, shortfall: null, sufficient: null }) })
    const user = userEvent.setup()
    renderExpiry(staff("shopkeeper"))

    await choose(user)

    const result = await screen.findByTestId("fefo-result")
    const order = within(within(result).getByRole("heading", { name: "Use in this order" }).parentElement!).getAllByRole("listitem")
    expect(order.map((li) => li.textContent)).toEqual([
      expect.stringContaining("ABCDEFGH23"),
      expect.stringContaining("JKMNPQRS45"),
    ])
    expect(within(result).getByText(/Expired, don't use/)).toBeInTheDocument()
    expect(within(result).getByText(/TVWXYZ0123/)).toBeInTheDocument()
    expect(within(result).queryByRole("heading", { name: "Pick list" })).toBeNull()
  })

  it("asks for a pick list when an amount is entered", async () => {
    api()
    const user = userEvent.setup()
    renderExpiry(staff("shopkeeper"))

    await choose(user)
    await user.type(screen.getByLabelText(/Amount needed/), "3")

    expect(await screen.findByRole("heading", { name: "Pick list" })).toBeInTheDocument()
    expect(screen.getByText(/Enough usable stock/)).toBeInTheDocument()
    await waitFor(() => expect(urls.some((url) => url.includes("/expiry/fefo") && url.includes("quantity=3"))).toBe(true))
  })

  it("says plainly when stock is insufficient", async () => {
    api({
      fefo: () => json({ ...fefoResult, requested: "50", pick: [], allocated: "5.500", shortfall: "44.500", sufficient: false }),
    })
    const user = userEvent.setup()
    renderExpiry(staff("shopkeeper"))

    await choose(user)
    await user.type(screen.getByLabelText(/Amount needed/), "50")

    expect(await screen.findByText(/Not enough usable stock: 5.5 kg available, 44.5 kg short/)).toBeInTheDocument()
  })

  it("rejects an invalid amount without asking the server", async () => {
    api()
    const user = userEvent.setup()
    renderExpiry(staff("shopkeeper"))

    await choose(user)
    await user.type(screen.getByLabelText(/Amount needed/), "abc")

    expect(screen.getByText("Enter a positive number with up to 3 decimals.")).toBeInTheDocument()
    expect(urls.some((url) => url.includes("quantity=abc"))).toBe(false)
  })

  it("explains an ingredient with no usable batches", async () => {
    api({ fefo: () => json({ ...fefoResult, usable: [], expired: [], requested: null, pick: null, allocated: null, shortfall: null, sufficient: null }) })
    const user = userEvent.setup()
    renderExpiry(staff("shopkeeper"))

    await choose(user)

    expect(await screen.findByText("No usable batches")).toBeInTheDocument()
  })
})
