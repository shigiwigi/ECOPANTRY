import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { routes } from "@/app/routes"
import { ThemeProvider } from "@/features/theme/ThemeProvider"
import { setCsrfToken } from "@/lib/api/client"
import { AuthProvider } from "./AuthProvider"

// These tests cover real sign-in, so the development preview must be off whatever .env.local says.
vi.mock("./preview", () => ({
  PORTAL_PREVIEW_ENABLED: false,
  PREVIEW_USER: { id: "preview", name: "Preview user", email: "preview@localhost", role: "admin", permissions: [] },
}))

const SESSION = {
  user: {
    id: "7f6c0f39-8d2a-4a5c-9b8e-0d6b1f2a3c4d",
    name: "Sam Storekeeper",
    email: "sam@example.test",
    role: "storekeeper",
    role_name: "Storekeeper",
    permissions: ["dashboard.view", "inventory.manage", "inventory.view"],
  },
  csrf_token: "csrf-token-from-server",
  expires_at: "2026-11-02T12:00:00Z",
}

type Handler = (request: { url: string; method: string; headers: Headers; body: unknown }) => Response

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const noContent = () => new Response(null, { status: 204 })

let calls: { url: string; method: string; headers: Headers; body: unknown }[] = []

function mockApi(routesByKey: Record<string, Handler>) {
  calls = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = (init.method ?? "GET").toUpperCase()
      const request = {
        url,
        method,
        headers: new Headers(init.headers),
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      }
      calls.push(request)
      const handler = routesByKey[`${method} ${url}`]
      return handler ? handler(request) : json({ detail: "Sign in to continue.", code: "not_authenticated" }, 401)
    }),
  )
}

function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <ThemeProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ThemeProvider>,
  )
  return router
}

async function signInThroughForm(email = "sam@example.test", password = "correct horse battery staple") {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText("Email"), email)
  await user.type(screen.getByLabelText("Password"), password)
  await user.click(screen.getByRole("button", { name: "Sign in" }))
  return user
}

beforeEach(() => setCsrfToken(null))
afterEach(() => vi.unstubAllGlobals())

describe("staff sign-in against the API", () => {
  it("doesn't contact the server from the public website", async () => {
    mockApi({})
    renderApp("/")
    await screen.findByRole("heading", { level: 1 })
    expect(calls).toEqual([])
  })

  it("restores an existing session when the portal opens", async () => {
    mockApi({ "GET /api/v1/auth/me": () => json(SESSION) })
    renderApp("/portal/inventory")
    expect(await screen.findByRole("heading", { name: "Ingredient inventory", level: 1 })).toBeInTheDocument()
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET /api/v1/auth/me"])
  })

  it("sends visitors without a session to sign-in, then back to the page they wanted", async () => {
    mockApi({ "POST /api/v1/auth/login": () => json(SESSION) })
    const router = renderApp("/portal/inventory")
    expect(await screen.findByRole("heading", { name: "Staff sign-in" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/portal/sign-in")

    await signInThroughForm()

    expect(await screen.findByRole("heading", { name: "Ingredient inventory", level: 1 })).toBeInTheDocument()
    const login = calls.find((c) => c.url === "/api/v1/auth/login")
    expect(login?.body).toEqual({ email: "sam@example.test", password: "correct horse battery staple" })
    // Nothing about the session is written to browser storage.
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it.each([
    [401, { detail: "That email and password don't match an account.", code: "invalid_credentials" }, "That email and password don't match an account."],
    [403, { detail: "This account has been deactivated. Ask an administrator if you need access again.", code: "account_disabled" }, "This account has been deactivated"],
    [429, { detail: "Too many failed sign-in attempts. Wait a few minutes and try again.", code: "account_locked" }, "Too many failed sign-in attempts"],
  ])("explains a refused sign-in (%i)", async (status, body, message) => {
    mockApi({ "POST /api/v1/auth/login": () => json(body, status) })
    const router = renderApp("/portal/sign-in")
    await signInThroughForm()
    expect(await screen.findByRole("alert")).toHaveTextContent(message)
    expect(router.state.location.pathname).toBe("/portal/sign-in")
  })

  it("refuses a malformed login response instead of creating a session", async () => {
    mockApi({ "POST /api/v1/auth/login": () => json({ user: { id: 1, role: "owner" } }) })
    renderApp("/portal/sign-in")
    await signInThroughForm()
    expect(await screen.findByRole("alert")).toHaveTextContent("unexpected response")
  })

  it("sends the CSRF token when signing out and returns to sign-in", async () => {
    mockApi({ "GET /api/v1/auth/me": () => json(SESSION), "POST /api/v1/auth/logout": () => noContent() })
    // From a page other than the dashboard: the next sign-in must not land back here.
    const router = renderApp("/portal/settings")
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: "Account menu" }))
    await user.click(await screen.findByRole("menuitem", { name: "Sign out" }))

    expect(await screen.findByRole("heading", { name: "Staff sign-in" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/portal/sign-in")
    const logout = calls.find((c) => c.url === "/api/v1/auth/logout")
    expect(logout?.headers.get("X-CSRF-Token")).toBe("csrf-token-from-server")
    await waitFor(() => expect(router.state.location.state).toBeNull())
  })

  it("stays signed in and says so when the server can't be reached to sign out", async () => {
    mockApi({
      "GET /api/v1/auth/me": () => json(SESSION),
      "POST /api/v1/auth/logout": () => new Response("Bad gateway", { status: 502 }),
    })
    renderApp("/portal")
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: "Account menu" }))
    await user.click(await screen.findByRole("menuitem", { name: "Sign out" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("you're still signed in")
    expect(screen.getByRole("heading", { name: "Dashboard", level: 1 })).toBeInTheDocument()
  })

  it("returns to sign-in with a notice when the server ends the session", async () => {
    let sessionValid = true
    mockApi({
      "GET /api/v1/auth/me": () => json(SESSION),
      "POST /api/v1/auth/password": () =>
        sessionValid ? noContent() : json({ detail: "Your session has ended. Sign in again.", code: "session_expired" }, 401),
    })
    const router = renderApp("/portal/settings")
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText("Current password"), "correct horse battery staple")
    await user.type(screen.getByLabelText("New password"), "a brand new passphrase")
    await user.type(screen.getByLabelText("Repeat new password"), "a brand new passphrase")

    sessionValid = false
    await user.click(screen.getByRole("button", { name: "Change password" }))

    expect(await screen.findByText("Your session has ended. Sign in again to continue.")).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/portal/sign-in")
    expect(router.state.location.state).toEqual({ from: "/portal/settings" })
  })

  it("changes the password with the CSRF token and confirms it", async () => {
    mockApi({ "GET /api/v1/auth/me": () => json(SESSION), "POST /api/v1/auth/password": () => noContent() })
    renderApp("/portal/settings")
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText("Current password"), "correct horse battery staple")
    await user.type(screen.getByLabelText("New password"), "a brand new passphrase")
    await user.type(screen.getByLabelText("Repeat new password"), "a brand new passphrase")
    await user.click(screen.getByRole("button", { name: "Change password" }))

    expect(await screen.findByRole("status")).toHaveTextContent("Password changed")
    const change = calls.find((c) => c.url === "/api/v1/auth/password")
    expect(change?.headers.get("X-CSRF-Token")).toBe("csrf-token-from-server")
    expect(change?.body).toEqual({ current_password: "correct horse battery staple", new_password: "a brand new passphrase" })
  })

  it("checks new passwords before sending them", async () => {
    mockApi({ "GET /api/v1/auth/me": () => json(SESSION) })
    renderApp("/portal/settings")
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText("Current password"), "x")
    await user.type(screen.getByLabelText("New password"), "short")
    await user.type(screen.getByLabelText("Repeat new password"), "different")
    await user.click(screen.getByRole("button", { name: "Change password" }))

    expect(await screen.findByText("Use at least 12 characters.")).toBeInTheDocument()
    expect(screen.getByText("The new passwords don't match.")).toBeInTheDocument()
    await waitFor(() => expect(calls.some((c) => c.url === "/api/v1/auth/password")).toBe(false))
  })
})
