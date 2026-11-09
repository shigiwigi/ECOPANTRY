import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { routes } from "@/app/routes"
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context"
import type { Role, StaffUser } from "@/features/auth/roles"
import { ThemeProvider } from "@/features/theme/ThemeProvider"
import { defaultFilters, rangeProblem, reportPath, type Report } from "./api"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

let urls: string[] = []

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  urls = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url)
      return handler(url)
    }),
  )
}

const staff = (role: Role, permissions: string[]): StaffUser => ({
  id: `${role}-1`,
  name: `Test ${role}`,
  email: `${role}@example.test`,
  role,
  permissions,
})

function renderReports(user: StaffUser) {
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
  const router = createMemoryRouter(routes, { initialEntries: ["/portal/reports"] })
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
  vi.restoreAllMocks()
})

const stockReport: Report = {
  kind: "stock",
  title: "Stock report",
  generated_at: "2026-11-10T09:00:00Z",
  filters: [{ label: "As of", value: "2026-11-10" }],
  sections: [
    {
      title: "Ingredients",
      columns: ["Ingredient", "Unit", "Reorder level", "Remaining (not expired)", "Stock"],
      rows: [["Wheat flour", "kg", "5.000", "3.000", "Low"]],
      total_rows: 1,
      truncated: false,
    },
  ],
  notes: ["Remaining quantity excludes expired batches."],
}

const exporter = staff("inspector", ["reports.view", "reports.export"])

describe("Reports page", () => {
  it("shows the preview table from the stock endpoint", async () => {
    stubFetch(() => json(stockReport))
    renderReports(exporter)

    expect(await screen.findByRole("cell", { name: "Wheat flour" })).toBeInTheDocument()
    expect(screen.getByRole("cell", { name: "Low" })).toBeInTheDocument()
    expect(screen.getByText("Remaining quantity excludes expired batches.")).toBeInTheDocument()
    expect(urls[0]).toMatch(/\/reports\/stock$/)
  })

  it("shows a loading state, then an empty state for a table with no rows", async () => {
    stubFetch(() => json({ ...stockReport, sections: [{ ...stockReport.sections[0], rows: [], total_rows: 0 }] }))
    renderReports(exporter)

    expect(await screen.findByText("Loading report…")).toBeInTheDocument()
    expect(await screen.findByText("No rows")).toBeInTheDocument()
  })

  it("shows the server's message when the report fails, and retries", async () => {
    let fail = true
    stubFetch(() => (fail ? json({ detail: "The server had a problem.", code: "x" }, 500) : json(stockReport)))
    renderReports(exporter)

    expect(await screen.findByText("Couldn't load the report")).toBeInTheDocument()
    expect(screen.getByText("The server had a problem.")).toBeInTheDocument()
    fail = false
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByRole("cell", { name: "Wheat flour" })).toBeInTheDocument()
  })

  it("requests the chosen kind and filters", async () => {
    stubFetch(() => json(stockReport))
    renderReports(exporter)
    await screen.findByRole("cell", { name: "Wheat flour" })

    await userEvent.click(screen.getByRole("tab", { name: "Expiry" }))
    await userEvent.selectOptions(await screen.findByLabelText("Near-expiry window"), "30")
    await waitFor(() => expect(urls.at(-1)).toMatch(/\/reports\/expiry\?days=30$/))

    await userEvent.click(screen.getByRole("tab", { name: "Waste" }))
    const from = await screen.findByLabelText("From")
    await userEvent.clear(from)
    await userEvent.type(from, "2026-11-01")
    await userEvent.clear(screen.getByLabelText("To"))
    await userEvent.type(screen.getByLabelText("To"), "2026-11-09")
    await waitFor(() => expect(urls.at(-1)).toMatch(/\/reports\/waste\?date_from=2026-11-01&date_to=2026-11-09$/))
  })

  it("does not request a range the API would refuse", async () => {
    stubFetch(() => json(stockReport))
    renderReports(exporter)
    await userEvent.click(await screen.findByRole("tab", { name: "Environment" }))
    const from = await screen.findByLabelText("From")
    await userEvent.clear(from)
    await userEvent.type(from, "2026-01-01")
    await userEvent.clear(screen.getByLabelText("To"))
    await userEvent.type(screen.getByLabelText("To"), "2026-11-09")

    expect(await screen.findByRole("alert")).toHaveTextContent("at most 31 days")
    expect(screen.getByRole("button", { name: "Download CSV" })).toBeDisabled()
  })

  it("shows download buttons only with the export permission", async () => {
    stubFetch(() => json(stockReport))
    renderReports(staff("inspector", ["reports.view"]))
    await screen.findByRole("cell", { name: "Wheat flour" })
    expect(screen.queryByRole("button", { name: /Download/ })).not.toBeInTheDocument()
  })

  it("downloads through fetch with credentials and saves the blob under the server's file name", async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        if (url.includes("format=csv"))
          return new Response("a,b", {
            headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="ecopantry-stock-2026-11-10.csv"' },
          })
        return json(stockReport)
      }),
    )
    const createObjectURL = vi.fn(() => "blob:mock")
    const revokeObjectURL = vi.fn()
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }))
    let saved: string | null = null
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      saved = this.download
    })

    renderReports(exporter)
    await userEvent.click(await screen.findByRole("button", { name: "Download CSV" }))

    await waitFor(() => expect(saved).toBe("ecopantry-stock-2026-11-10.csv"))
    const download = calls.find((c) => c.url.includes("format=csv"))
    expect(download?.url).toMatch(/\/reports\/stock\?format=csv$/)
    expect(download?.init?.credentials).toBe("include")
    expect(createObjectURL).toHaveBeenCalledOnce()
  })

  it("shows an inline message when a download is refused", async () => {
    stubFetch((url) =>
      url.includes("format=pdf") ? json({ detail: "You don't have permission to do that.", code: "forbidden" }, 403) : json(stockReport),
    )
    renderReports(exporter)
    await userEvent.click(await screen.findByRole("button", { name: "Download PDF" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("You don't have permission to do that.")
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeEnabled()
  })
})

describe("report helpers", () => {
  it("builds request paths", () => {
    const filters = { days: 14, dateFrom: "2026-11-01", dateTo: "2026-11-09" }
    expect(reportPath("stock", filters)).toBe("/reports/stock")
    expect(reportPath("expiry", filters, "pdf")).toBe("/reports/expiry?format=pdf&days=14")
    expect(reportPath("environment", filters, "csv")).toBe("/reports/environment?format=csv&date_from=2026-11-01&date_to=2026-11-09")
  })

  it("defaults to the last 7 days and validates ranges", () => {
    const filters = defaultFilters(new Date(2026, 10, 10))
    expect(filters).toMatchObject({ days: 7, dateFrom: "2026-11-04", dateTo: "2026-11-10" })
    expect(rangeProblem("waste", filters)).toBeNull()
    expect(rangeProblem("waste", { ...filters, dateFrom: "2026-11-11" })).toMatch(/must not be after/)
    expect(rangeProblem("stock", { ...filters, dateFrom: "" })).toBeNull()
  })
})
