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
import { needsAttention, tilesFor, type DashboardSummary } from "./api"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

function summary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    low_stock_ingredients: 2,
    near_expiry_batches: 3,
    expired_batches: 1,
    expiry_window_days: 7,
    open_alerts: 1,
    acknowledged_alerts: 0,
    top_alert: null,
    active_staff: 4,
    today: "2026-11-10",
    server_time: "2026-11-10T09:00:00Z",
    ...overrides,
  }
}

const ZERO = summary({
  low_stock_ingredients: 0,
  near_expiry_batches: 0,
  expired_batches: 0,
  open_alerts: 0,
  acknowledged_alerts: 0,
  active_staff: 1,
})

const staff = (role: Role): StaffUser => ({ id: `${role}-1`, name: `Test ${role}`, email: `${role}@example.test`, role })

let summaryCalls = 0

function stubFetch(summaryResponse: () => Response) {
  summaryCalls = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/dashboard/summary")) {
        summaryCalls += 1
        return summaryResponse()
      }
      if (url.includes("/sensors/stations")) return json({ server_time: "2026-11-10T09:00:00Z", stations: [] })
      return json({ detail: "Not found", code: "not_found" }, 404)
    }),
  )
}

function renderDashboard(user: StaffUser) {
  const auth: AuthContextValue = {
    user,
    status: "ready",
    endReason: null,
    isPreview: false,
    checkSession: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    setSession: vi.fn(),
    setPreviewRole: null,
  }
  const router = createMemoryRouter(routes, { initialEntries: ["/portal"] })
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

describe("dashboard helpers", () => {
  it("builds tiles only for figures the response carries", () => {
    const ids = tilesFor(summary({ active_staff: null, near_expiry_batches: null })).map((t) => t.id)
    expect(ids).toEqual(["low-stock", "expired", "open-alerts"])
  })

  it("does not count staff as something that needs attention", () => {
    expect(needsAttention(ZERO)).toBe(false)
    expect(needsAttention(summary({ acknowledged_alerts: 1, open_alerts: 0 }))).toBe(true)
  })
})

describe("Dashboard page", () => {
  it("shows a loading state, then the tiles with links to their modules", async () => {
    stubFetch(() => json(summary()))
    renderDashboard(staff("admin"))

    expect(await screen.findByRole("heading", { name: "Dashboard", level: 1 })).toBeInTheDocument()
    expect(screen.getByRole("status", { name: "Loading figures" })).toBeInTheDocument()

    const list = await screen.findByRole("list", { name: "Summary" })
    expect(within(list).getAllByRole("listitem")).toHaveLength(5)
    expect(screen.getByRole("link", { name: /^Low stock: 2/ })).toHaveAttribute("href", "/portal/inventory")
    expect(screen.getByRole("link", { name: /^Near expiry: 3/ })).toHaveAttribute("href", "/portal/expiry")
    expect(screen.getByRole("link", { name: /^Expired: 1/ })).toHaveAttribute("href", "/portal/expiry")
    expect(screen.getByRole("link", { name: /^Open alerts: 1/ })).toHaveAttribute("href", "/portal/alerts")
    expect(screen.getByRole("link", { name: /^Active staff: 4/ })).toHaveAttribute("href", "/portal/users")
    expect(screen.queryByText("Nothing needs attention")).not.toBeInTheDocument()
    expect(screen.queryByText("Active Staff")).not.toBeInTheDocument()
  })

  it("puts the most urgent alert in a strip at the top", async () => {
    stubFetch(() =>
      json(
        summary({
          open_alerts: 3,
          top_alert: {
            id: "a1",
            label: "Waste bin nearly full",
            metric: "weight_g",
            severity: "warning",
            value: 2100,
            opened_at: "2026-11-10T08:00:00Z",
          },
        }),
      ),
    )
    renderDashboard(staff("storekeeper"))

    const strip = await screen.findByRole("alert")
    expect(within(strip).getByText("Waste bin nearly full")).toBeInTheDocument()
    expect(within(strip).getByText("2.10 kg")).toBeInTheDocument()
    expect(within(strip).getByText(/2 more open alerts/)).toBeInTheDocument()
    expect(within(strip).getByRole("link", { name: "View alerts" })).toHaveAttribute("href", "/portal/alerts")
  })

  it("shows a friendly state when nothing needs attention", async () => {
    stubFetch(() => json(ZERO))
    renderDashboard(staff("admin"))

    expect(await screen.findByText("Nothing needs attention")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("shows only what the role gets: no staff tile, and no tile for a null figure", async () => {
    stubFetch(() => json(summary({ active_staff: null })))
    renderDashboard(staff("storekeeper"))

    await screen.findByRole("list", { name: "Summary" })
    expect(screen.queryByText("Active staff")).not.toBeInTheDocument()
    expect(screen.getByText("Low stock")).toBeInTheDocument()
  })

  it("shows a figure without a link when the role can't open its module", async () => {
    stubFetch(() => json(summary()))
    renderDashboard(staff("inspector"))

    expect(await screen.findByText("Active staff")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /^Active staff/ })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: /^Low stock/ })).toBeInTheDocument()
  })

  it("shows the error with a retry that asks again", async () => {
    let fail = true
    stubFetch(() => (fail ? json({ detail: "Something went wrong.", code: "server_error" }, 500) : json(summary())))
    renderDashboard(staff("admin"))

    expect(await screen.findByText("Couldn't load the figures")).toBeInTheDocument()
    expect(screen.getByText("Something went wrong.")).toBeInTheDocument()

    fail = false
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))

    await waitFor(() => expect(screen.getByRole("list", { name: "Summary" })).toBeInTheDocument())
    expect(summaryCalls).toBe(2)
  })
})
