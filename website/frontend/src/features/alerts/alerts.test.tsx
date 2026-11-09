import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { routes } from "@/app/routes"
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context"
import type { Role, StaffUser } from "@/features/auth/roles"
import { ThemeProvider } from "@/features/theme/ThemeProvider"
import { setCsrfToken } from "@/lib/api/client"
import { describeThreshold, formatMetricValue, type Alert, type Threshold } from "./api"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "alert-1",
    threshold_id: "threshold-1",
    device_id: "station-1",
    device_name: "Inventory station 1",
    metric: "weight_g",
    severity: "warning",
    message: "Waste bin nearly full: 2.05 kg (above 2.00 kg)",
    status: "open",
    trigger_value: 2050,
    last_value: 2100,
    opened_at: "2026-11-09T10:00:00Z",
    acknowledged_at: null,
    acknowledged_by_name: null,
    resolved_at: null,
    ...overrides,
  }
}

const THRESHOLD: Threshold = {
  id: "threshold-1",
  label: "Waste bin nearly full",
  metric: "weight_g",
  device_id: null,
  device_name: null,
  min_value: null,
  max_value: 2000,
  clear_value: 1500,
  severity: "warning",
  enabled: true,
}

const page = (items: Alert[]) => ({ items, total: items.length, limit: 100, offset: 0 })

interface Call {
  method: string
  url: string
  headers: Headers
}
let calls: Call[] = []

function stubFetch(handler: (call: Call) => Response) {
  calls = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = { method: (init.method ?? "GET").toUpperCase(), url, headers: new Headers(init.headers) }
      calls.push(call)
      return handler(call)
    }),
  )
}

const staff = (role: Role): StaffUser => ({ id: `${role}-1`, name: `Test ${role}`, email: `${role}@example.test`, role })

function renderAt(path: string, user: StaffUser) {
  const auth: AuthContextValue = {
    user,
    status: "ready",
    endReason: null,
    isPreview: false,
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
}

afterEach(() => {
  vi.unstubAllGlobals()
  setCsrfToken(null)
})

describe("alert helpers", () => {
  it("shows weights in kg and describes a limit with its clear value", () => {
    expect(formatMetricValue("weight_g", 2050)).toBe("2.05 kg")
    expect(formatMetricValue("temperature_c", 8)).toBe("8.0 °C")
    expect(formatMetricValue("weight_g", null)).toBe("–")
    expect(describeThreshold(THRESHOLD)).toBe("at or above 2.00 kg, clears below 1.50 kg")
  })
})

describe("Alerts page", () => {
  const handler = (alerts: Alert[]) => (call: Call) => {
    if (call.url.includes("/alerts/alert-1/acknowledge")) return json(alert({ status: "acknowledged" }))
    if (call.url.includes("/alerts?")) return json(page(alerts))
    if (call.url.includes("/thresholds")) return json([THRESHOLD])
    if (call.url.includes("/sensors/stations")) return json({ server_time: "2026-11-09T10:00:00Z", stations: [] })
    return json({ detail: "Not found", code: "not_found" }, 404)
  }

  it("lists open alerts with human labels and kg, and lets a shopkeeper acknowledge", async () => {
    stubFetch(handler([alert()]))
    setCsrfToken("csrf-token")
    renderAt("/portal/alerts", staff("shopkeeper"))

    expect(await screen.findByText("Waste bin nearly full: 2.05 kg (above 2.00 kg)", { selector: "p" })).toBeInTheDocument()
    expect(screen.getByText("Waste bin weight, Inventory station 1")).toBeInTheDocument()
    expect(screen.getByText(/at 2\.05 kg/)).toBeInTheDocument()
    expect(calls.some((c) => c.url.includes("status=open"))).toBe(true)
    expect(screen.queryByRole("heading", { name: "Alert limits" })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: /^Acknowledge(?!d)/ }))

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/alerts/alert-1/acknowledge"))).toBe(true))
    const post = calls.find((c) => c.method === "POST")!
    expect(post.headers.get("X-CSRF-Token")).toBe("csrf-token")
  })

  it("hides Acknowledge from inspectors", async () => {
    stubFetch(handler([alert()]))
    renderAt("/portal/alerts", staff("food_inspector"))

    expect(await screen.findByText(/Waste bin nearly full: 2\.05 kg/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Acknowledge(?!d)/ })).not.toBeInTheDocument()
  })

  it("filters by status and shows an empty state", async () => {
    stubFetch(handler([]))
    renderAt("/portal/alerts", staff("shopkeeper"))

    expect(await screen.findByText("No open alerts")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Resolved" }))

    expect(await screen.findByText("No resolved alerts")).toBeInTheDocument()
    expect(calls.some((c) => c.url.includes("status=resolved"))).toBe(true)
  })

  it("shows the alert limits to administrators only", async () => {
    stubFetch(handler([]))
    renderAt("/portal/alerts", staff("admin"))

    expect(await screen.findByRole("heading", { name: "Alert limits" })).toBeInTheDocument()
    expect(await screen.findByText(/at or above 2\.00 kg, clears below 1\.50 kg/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Turn off/ })).toBeInTheDocument()
  })

  it("says so when alerts can't be loaded", async () => {
    stubFetch((call) => (call.url.includes("/alerts?") ? json({ detail: "Server trouble", code: "boom" }, 500) : json({ server_time: "2026-11-09T10:00:00Z", stations: [] })))
    renderAt("/portal/alerts", staff("shopkeeper"))

    expect(await screen.findByText("Alerts couldn't be loaded")).toBeInTheDocument()
    expect(screen.getByText("Server trouble")).toBeInTheDocument()
  })
})

describe("Waste page banner", () => {
  const station = {
    id: "station-1",
    name: "Inventory station 1",
    status: "active",
    firmware_version: null,
    last_seen_at: null,
    live: false,
    live_until: null,
    stale: true,
    report_interval_seconds: 10,
    latest: null,
  }
  const handler = (alerts: Alert[]) => (call: Call) => {
    if (call.url.includes("/alerts?")) return json(page(alerts))
    if (call.url.includes("/thresholds")) return json([THRESHOLD])
    if (call.url.includes("/sensors/stations/") && call.url.includes("/history")) {
      return json({ device_id: "station-1", metric: "weight_g", range: "24h", bucket_seconds: 300, points: [] })
    }
    if (call.url.includes("/sensors/stations")) return json({ server_time: "2026-11-09T10:00:00Z", stations: [station] })
    return json({ detail: "Not found", code: "not_found" }, 404)
  }

  it("warns that the bin is nearly full while an alert is open", async () => {
    stubFetch(handler([alert()]))
    renderAt("/portal/waste", staff("shopkeeper"))

    expect(await screen.findByText("Bin nearly full")).toBeInTheDocument()
    expect(screen.getByText(/Inventory station 1 reads 2\.10 kg/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "See all alerts" })).toHaveAttribute("href", "/portal/alerts")
    expect(await screen.findByText(/Alert limits:/)).toHaveTextContent("at or above 2.00 kg, clears below 1.50 kg")
  })

  it("shows no banner without an alert", async () => {
    stubFetch(handler([]))
    renderAt("/portal/waste", staff("shopkeeper"))

    expect(await screen.findByText(/Alert limits:/)).toBeInTheDocument()
    expect(screen.queryByText("Bin nearly full")).not.toBeInTheDocument()
  })
})
