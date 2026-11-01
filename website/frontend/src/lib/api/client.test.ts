import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError, apiRequest, onUnauthorized, setCsrfToken } from "./client"

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

describe("session support", () => {
  afterEach(() => {
    setCsrfToken(null)
    onUnauthorized(null)
  })

  function captureHeaders() {
    const seen: Headers[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn((_: string, init: RequestInit = {}) => {
        seen.push(new Headers(init.headers))
        return Promise.resolve(json({ ok: true }, 200))
      }),
    )
    return seen
  }

  it("sends cookies and the CSRF token only on unsafe methods", async () => {
    const seen = captureHeaders()
    setCsrfToken("token-123")
    await apiRequest("/auth/me")
    await apiRequest("/auth/logout", { method: "POST" })
    await apiRequest("/things/1", { method: "delete" })
    expect(seen[0].get("X-CSRF-Token")).toBeNull()
    expect(seen[1].get("X-CSRF-Token")).toBe("token-123")
    expect(seen[2].get("X-CSRF-Token")).toBe("token-123")
    expect(vi.mocked(fetch).mock.calls[0][1]?.credentials).toBe("include")
  })

  it("sends no CSRF header once the token is cleared", async () => {
    const seen = captureHeaders()
    setCsrfToken("token-123")
    setCsrfToken(null)
    await apiRequest("/auth/logout", { method: "POST" })
    expect(seen[0].get("X-CSRF-Token")).toBeNull()
  })

  it("reports a 401 to the session listener unless told not to", async () => {
    const listener = vi.fn()
    onUnauthorized(listener)
    mockFetch(json({ detail: "Your session has ended. Sign in again.", code: "session_expired" }, 401))
    const error = await requestError()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(error.code).toBe("session_expired")

    mockFetch(json({ detail: "x", code: "invalid_credentials" }, 401))
    await expect(apiRequest("/auth/login", { method: "POST", body: {}, ignoreUnauthorized: true })).rejects.toThrow()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("doesn't report other errors as a lost session", async () => {
    const listener = vi.fn()
    onUnauthorized(listener)
    mockFetch(json({ detail: "You don't have permission to do that.", code: "forbidden" }, 403))
    expect((await requestError()).code).toBe("forbidden")
    expect(listener).not.toHaveBeenCalled()
  })
})
