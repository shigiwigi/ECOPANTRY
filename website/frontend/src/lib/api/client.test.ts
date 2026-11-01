import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError, apiRequest } from "./client"

function mockFetch(response: Response | Error) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response))),
  )
}

async function requestError(): Promise<ApiError> {
  try {
    await apiRequest("/auth/login", { method: "POST", body: {} })
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error("expected apiRequest to fail")
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

afterEach(() => vi.unstubAllGlobals())

describe("apiRequest", () => {
  it("returns parsed JSON on success", async () => {
    mockFetch(json({ ok: true }, 200))
    await expect(apiRequest("/health")).resolves.toEqual({ ok: true })
  })

  it("reports a refused connection as unreachable", async () => {
    mockFetch(new TypeError("Failed to fetch"))
    expect((await requestError()).isUnreachable).toBe(true)
  })

  it("treats a bare 404 from the dev server as unreachable, not 'Not found'", async () => {
    mockFetch(new Response(null, { status: 404 }))
    const error = await requestError()
    expect(error.isUnreachable).toBe(true)
    expect(error.message).toBe("Can't reach the EcoPantry server.")
  })

  it("treats a proxy gateway error page as unreachable", async () => {
    mockFetch(new Response("<html>Bad gateway</html>", { status: 502, headers: { "Content-Type": "text/html" } }))
    expect((await requestError()).isUnreachable).toBe(true)
  })

  it("keeps JSON errors from the backend as HTTP errors with their detail", async () => {
    mockFetch(json({ detail: "Invalid credentials" }, 401))
    const error = await requestError()
    expect(error.isUnreachable).toBe(false)
    expect(error.status).toBe(401)
    expect(error.message).toBe("Invalid credentials")
  })

  it("keeps a plain-text 500 as a server error", async () => {
    mockFetch(new Response("Internal Server Error", { status: 500, headers: { "Content-Type": "text/plain" } }))
    const error = await requestError()
    expect(error.isUnreachable).toBe(false)
    expect(error.message).toBe("The server had a problem. Try again shortly.")
  })
})
