import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, within } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { hasContactDetails } from "@/config/site"
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context"
import type { Role, StaffUser } from "@/features/auth/roles"
import { ThemeProvider } from "@/features/theme/ThemeProvider"
import { routes } from "./routes"

function staff(role: Role): StaffUser {
  return { id: "u1", name: "Test User", email: "test@example.com", role }
}

function renderAt(path: string, user: StaffUser | null = null) {
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
  return router
}

// No backend in these tests: the dev proxy's answer when FastAPI isn't running.
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response("Bad gateway", { status: 502 }))))
afterEach(() => vi.unstubAllGlobals())

describe("routing", () => {
  it("serves the public site without signing in", async () => {
    renderAt("/")
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Staff sign-in" })).toBeInTheDocument()
  })

  it("redirects portal routes to sign-in when there is no session", async () => {
    const router = renderAt("/portal/inventory")
    expect(await screen.findByRole("heading", { name: "Staff sign-in" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/portal/sign-in")
  })

  it("shows a 404 page for unknown routes", async () => {
    renderAt("/no-such-page")
    expect(await screen.findByRole("heading", { name: "This page doesn't exist" })).toBeInTheDocument()
  })

  it("shows only the modules a storekeeper may use", async () => {
    renderAt("/portal", staff("shopkeeper"))
    const nav = await screen.findByRole("navigation", { name: "Portal" })
    expect(within(nav).getByRole("link", { name: "Inventory" })).toBeInTheDocument()
    expect(within(nav).getByRole("link", { name: "QR labels" })).toBeInTheDocument()
    expect(within(nav).queryByRole("link", { name: "Devices" })).not.toBeInTheDocument()
    expect(within(nav).queryByRole("link", { name: "Audit log" })).not.toBeInTheDocument()
  })

  it("blocks a role from a page it can't use, even by direct URL", async () => {
    renderAt("/portal/devices", staff("food_inspector"))
    expect(
      await screen.findByRole("heading", { name: "You don't have access to this page", level: 1 }),
    ).toBeInTheDocument()
    expect(document.title).toBe("No access | EcoPantry portal")
  })

  it("lets an administrator open admin-only pages", async () => {
    renderAt("/portal/devices", staff("admin"))
    expect(await screen.findByRole("heading", { name: "Devices", level: 1 })).toBeInTheDocument()
  })

  it("keeps the site navigation on the public 404 page", async () => {
    renderAt("/no-such-page")
    expect(await screen.findByRole("heading", { name: "This page doesn't exist", level: 1 })).toBeInTheDocument()
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument()
    expect(document.title).toBe("Page not found | EcoPantry")
  })

  it("keeps the portal sidebar on an unknown portal page", async () => {
    renderAt("/portal/no-such-module", staff("shopkeeper"))
    expect(await screen.findByRole("heading", { name: "This page doesn't exist", level: 1 })).toBeInTheDocument()
    expect(screen.getByRole("navigation", { name: "Portal" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/portal")
    // The top bar shouldn't claim this is the dashboard.
    expect(screen.getAllByRole("banner")[0].textContent).not.toContain("Dashboard")
  })

  it("gives each page its own browser tab title", async () => {
    renderAt("/products")
    await screen.findByRole("heading", { name: "Products", level: 1 })
    expect(document.title).toBe("Products | EcoPantry")
  })

  it("names the portal module in the tab title", async () => {
    renderAt("/portal/inventory", staff("shopkeeper"))
    await screen.findByRole("heading", { name: "Ingredient inventory", level: 1 })
    expect(document.title).toBe("Ingredient inventory | EcoPantry portal")
  })

  it("only points to the contact page from the product list when contact details exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ categories: [], products: [] })),
    )
    renderAt("/products")
    await screen.findByText("The product list isn't published yet")
    const link = screen.queryByRole("link", { name: "Contact the bakery" })
    expect(link !== null).toBe(hasContactDetails())
  })

  it("shows the catalogue module to administrators only", async () => {
    renderAt("/portal", staff("admin"))
    const nav = await screen.findByRole("navigation", { name: "Portal" })
    expect(within(nav).getByRole("link", { name: "Public catalogue" })).toBeInTheDocument()
  })

  it("keeps storekeepers and inspectors out of the catalogue module", async () => {
    for (const role of ["shopkeeper", "food_inspector"] as const) {
      renderAt("/portal/catalogue", staff(role))
      expect(await screen.findByRole("heading", { name: "You don't have access to this page" })).toBeInTheDocument()
      const nav = screen.getByRole("navigation", { name: "Portal" })
      expect(within(nav).queryByRole("link", { name: "Public catalogue" })).not.toBeInTheDocument()
      cleanup()
    }
  })
})
