import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { routes } from "@/app/routes"
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context"
import { AuthProvider } from "@/features/auth/AuthProvider"
import type { Role, StaffUser } from "@/features/auth/roles"
import { ThemeProvider } from "@/features/theme/ThemeProvider"
import { setCsrfToken } from "@/lib/api/client"

// Real sign-in behaviour, whatever .env.local says about the development preview.
vi.mock("@/features/auth/preview", () => ({
  PORTAL_PREVIEW_ENABLED: false,
  PREVIEW_USER: { id: "preview", name: "Preview user", email: "preview@localhost", role: "admin", permissions: [] },
}))

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

let requests: { url: string; method: string; credentials?: RequestCredentials }[] = []

function stubApi(handler: (url: string) => Response) {
  requests = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      requests.push({ url, method: (init.method ?? "GET").toUpperCase(), credentials: init.credentials })
      return handler(url)
    }),
  )
}

const staff = (role: Role): StaffUser => ({ id: "u1", name: "Test User", email: "test@example.test", role, permissions: [] })

function renderAt(path: string, user: StaffUser | null, { isPreview = false } = {}) {
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

beforeEach(() => setCsrfToken(null))
afterEach(() => vi.unstubAllGlobals())

const LOOKUP_URL = "/api/v1/batches/by-label/K7M2Q9X4TR"

async function enterCode(code: string) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText("Batch code"), code)
  await user.click(screen.getByRole("button", { name: "Look up" }))
  return user
}

describe("QR scanner page", () => {
  it("looks up a typed code and says honestly that batch details aren't connected yet", async () => {
    stubApi(() => json({ detail: "…", code: "batch_lookup_unavailable" }, 501))
    renderAt("/portal/scan", staff("inspector"))
    await enterCode("k7m2q-9x4tr")

    expect(await screen.findByText("Batch details aren't connected yet")).toBeInTheDocument()
    expect(requests).toEqual([{ url: LOOKUP_URL, method: "GET", credentials: "include" }])
    expect(screen.getByText("K7M2Q-9X4TR")).toBeInTheDocument()
  })

  it("rejects a malformed code without asking the server", async () => {
    stubApi(() => json({}, 500))
    renderAt("/portal/scan", staff("storekeeper"))
    await enterCode("hello")

    expect(await screen.findByRole("alert")).toHaveTextContent("doesn't look like a batch code")
    expect(requests).toEqual([])
  })

  it("shows batch details once the backend returns them", async () => {
    stubApi(() =>
      json({
        code: "K7M2Q9X4TR",
        ingredient_name: "Strong white flour",
        received_on: "2026-10-01",
        expires_on: "2020-01-01",
        status: "in_stock",
        remaining_quantity: "12.500",
        unit: "kg",
        storage_location: "Dry store",
      }),
    )
    renderAt("/portal/scan", staff("storekeeper"))
    await enterCode("K7M2Q9X4TR")

    expect(await screen.findByText("Strong white flour")).toBeInTheDocument()
    expect(screen.getByText("1 Jan 2020 (expired)")).toBeInTheDocument()
    expect(screen.getByText("12.500 kg")).toBeInTheDocument()
  })

  it.each([
    [403, { detail: "You don't have permission to do that.", code: "forbidden" }, "Your account can't view batches"],
    [404, { detail: "Not found.", code: "not_found" }, "No batch has this label"],
  ])("explains a %i answer", async (status, body, message) => {
    stubApi(() => json(body, status))
    renderAt("/portal/scan", staff("storekeeper"))
    await enterCode("K7M2Q9X4TR")
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it("offers to retry when the server can't be reached", async () => {
    stubApi(() => new Response("Bad gateway", { status: 502 }))
    renderAt("/portal/scan", staff("storekeeper"))
    await enterCode("K7M2Q9X4TR")
    expect(await screen.findByText("Can't reach the EcoPantry server")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument()
  })

  it("doesn't ask the server in the development preview, which has no account", async () => {
    stubApi(() => json({}, 500))
    renderAt("/portal/scan", staff("admin"), { isPreview: true })
    await enterCode("K7M2Q9X4TR")
    expect(await screen.findByText("Lookup needs a real sign-in")).toBeInTheDocument()
    expect(requests).toEqual([])
  })

  it("is open to every role, like the backend's batches.view", async () => {
    for (const role of ["admin", "storekeeper", "inspector"] as const) {
      stubApi(() => json({}, 500))
      renderAt("/portal/scan", staff(role))
      expect(await screen.findByRole("heading", { name: "QR scanner", level: 1 })).toBeInTheDocument()
      cleanup()
    }
  })

  it("returns to sign-in when the session has ended", async () => {
    const session = {
      user: { id: "u1", name: "Sam", email: "sam@example.test", role: "storekeeper", role_name: "Storekeeper", permissions: ["batches.view"] },
      csrf_token: "token",
      expires_at: "2026-11-02T12:00:00Z",
    }
    stubApi((url) =>
      url.endsWith("/auth/me") ? json(session) : json({ detail: "Your session has ended. Sign in again.", code: "session_expired" }, 401),
    )
    const router = createMemoryRouter(routes, { initialEntries: ["/portal/scan"] })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    )
    await enterCode("K7M2Q9X4TR")

    expect(await screen.findByText("Your session has ended. Sign in again to continue.")).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/portal/sign-in")
  })
})

describe("QR labels page", () => {
  it("keeps inspectors out, even by direct URL", async () => {
    renderAt("/portal/qr", staff("inspector"))
    expect(await screen.findByRole("heading", { name: "You don't have access to this page", level: 1 })).toBeInTheDocument()
  })

  it("adds labels to a print-only sheet and prints through the browser", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {})
    renderAt("/portal/qr", staff("storekeeper"))
    const user = userEvent.setup()

    expect(await screen.findByRole("button", { name: "Print labels" })).toBeDisabled()
    expect(screen.getByText("Not linked to batch records yet")).toBeInTheDocument()

    await user.type(screen.getByLabelText("Ingredient"), "Strong white flour")
    await user.type(screen.getByLabelText("Batch code"), "k7m2q9x4tr")
    await user.type(screen.getByLabelText("Use by (optional)"), "2026-11-20")
    await user.clear(screen.getByLabelText("Copies"))
    await user.type(screen.getByLabelText("Copies"), "2")
    await user.click(screen.getByRole("button", { name: "Add to sheet" }))

    const list = await screen.findByRole("list", { name: "Labels to print" })
    expect(within(list).getByText("Strong white flour")).toBeInTheDocument()
    expect(list).toHaveTextContent("K7M2Q-9X4TR · use by 20 Nov 2026 · 2 copies")
    // On screen: the preview. In <body>: the sheet that prints, outside the portal layout.
    expect(screen.getAllByRole("img", { name: "QR code for batch K7M2Q-9X4TR" })).toHaveLength(2)
    const sheet = document.body.querySelector(":scope > .print-sheet")
    expect(sheet).not.toBeNull()
    expect(sheet?.querySelectorAll("svg")).toHaveLength(2)
    expect(sheet?.textContent).toContain("20 Nov 2026")

    await user.click(screen.getByRole("button", { name: "Print 2 labels" }))
    expect(print).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole("button", { name: "Remove Strong white flour (K7M2Q-9X4TR)" }))
    expect(document.body.querySelector(":scope > .print-sheet")).toBeNull()
  })

  it("validates the form and makes valid test codes", async () => {
    renderAt("/portal/qr", staff("admin"))
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: "Add to sheet" }))
    expect(screen.getByText("Enter the ingredient name.")).toBeInTheDocument()
    expect(screen.getByText("Enter a batch code.")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Test code" }))
    expect((screen.getByLabelText("Batch code") as HTMLInputElement).value).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/)
    expect(screen.queryByText("Enter a batch code.")).not.toBeInTheDocument()
  })
})

describe("portal navigation", () => {
  it("puts a scan shortcut in the top bar and the theme in the account menu", async () => {
    renderAt("/portal", staff("inspector"))
    const shortcut = await screen.findByRole("link", { name: "Scan a QR label" })
    expect(shortcut).toHaveAttribute("href", "/portal/scan")
    expect(screen.queryByRole("button", { name: "Change theme" })).not.toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Account menu" }))
    await user.click(await screen.findByRole("menuitemradio", { name: "Dark" }))
    expect(document.documentElement).toHaveClass("dark")
  })

  it("lists Environment and Alerts in the navigation, and only shows labels to roles that make them", async () => {
    renderAt("/portal", staff("inspector"))
    const nav = await screen.findByRole("navigation", { name: "Portal" })
    const links = within(nav).getAllByRole("link").map((link) => link.textContent)
    expect(links.slice(0, 3)).toEqual(["Dashboard", "Environment", "Alerts"])
    expect(links).toContain("QR scanner")
    expect(links).not.toContain("QR labels")

    const quick = screen.getByRole("navigation", { name: "Quick" })
    expect(within(quick).getAllByRole("link").map((link) => link.textContent)).toEqual(["Dashboard", "Inventory", "Environment"])
  })
})
