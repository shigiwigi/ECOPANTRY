import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context"
import UsersPage from "@/pages/portal/UsersPage"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const account = (id: string, name: string, role = "storekeeper", status = "active") => ({
  id,
  email: `${name.toLowerCase()}@example.test`,
  name,
  role,
  role_name: role,
  status,
  last_login_at: null,
  created_at: "2026-11-01T00:00:00Z",
  deactivated_at: null,
})

const ME = { id: "me", name: "Ada", email: "ada@example.test", role: "admin" as const }

let calls: { url: string; method: string; body: unknown }[] = []

function stub(handler: (url: string, method: string) => Response) {
  calls = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = (init.method ?? "GET").toUpperCase()
      calls.push({ url, method, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined })
      return handler(url, method)
    }),
  )
}

function renderPage() {
  const auth: AuthContextValue = {
    user: ME,
    status: "ready",
    endReason: null,
    isPreview: false,
    checkSession: vi.fn(),
    signIn: vi.fn(),
    setSession: vi.fn(),
    signOut: vi.fn(),
    setPreviewRole: null,
  }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthContext.Provider value={auth}>
        <UsersPage />
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe("staff accounts page", () => {
  it("lists active accounts, switches to inactive, and has no delete control", async () => {
    stub((url) =>
      url.endsWith("active=true") ? json([account("me", "Ada", "admin"), account("a", "Sam")]) : json([account("b", "Bo", "inspector", "disabled")]),
    )
    renderPage()
    expect(await screen.findByText("Sam")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument()
    // Your own row can't change its role or be deactivated here.
    const self = screen.getByText("Ada").closest("li")!
    expect(within(self).getByRole("combobox")).toBeDisabled()
    expect(within(self).queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Inactive" }))
    expect(await screen.findByText("Bo")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reactivate" })).toBeInTheDocument()
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/employees?active=true", "/api/v1/employees?active=false"])
  })

  it("changes a role with the canonical role id", async () => {
    stub((_url, method) => (method === "PATCH" ? json(account("a", "Sam", "inspector")) : json([account("a", "Sam")])))
    renderPage()
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Role for sam@example.test" }), "inspector")
    expect(await screen.findByRole("status")).toHaveTextContent("Sam is now Food inspector")
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ url: "/api/v1/employees/a", body: { role: "inspector" } })
  })

  it("asks before deactivating and shows the server's reason when refused", async () => {
    stub((_url, method) =>
      method === "POST"
        ? json({ detail: "You can't deactivate the last administrator.", code: "conflict" }, 409)
        : json([account("a", "Sam", "admin")]),
    )
    renderPage()
    await userEvent.click(await screen.findByRole("button", { name: "Deactivate" }))
    expect(calls.some((c) => c.method === "POST")).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: "Yes, deactivate" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("last administrator")
  })

  it("checks the password length before creating an account", async () => {
    stub(() => json([]))
    renderPage()
    await userEvent.click(await screen.findByRole("button", { name: "Add account" }))
    await userEvent.type(screen.getByLabelText("Name"), "Nia")
    await userEvent.type(screen.getByLabelText("Email"), "nia@example.test")
    await userEvent.type(screen.getByLabelText("Initial password (optional)"), "short")
    await userEvent.click(screen.getAllByRole("button", { name: "Add account" }).at(-1)!)
    expect(await screen.findByRole("alert")).toHaveTextContent("12 to 128")
    expect(calls.some((c) => c.method === "POST")).toBe(false)
  })
})
