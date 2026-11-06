import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { routes } from "@/app/routes"
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context"
import type { Role, StaffUser } from "@/features/auth/roles"
import { normalizeUid, unassignedUids, type RfidCard, type RfidScan } from "@/features/rfid/api"
import { ThemeProvider } from "@/features/theme/ThemeProvider"
import { setCsrfToken } from "@/lib/api/client"
import { formatAge, primaryStation, stationExplanation, stationState, type Station } from "./api"

// --- helpers ----------------------------------------------------------------

const NOW = Date.parse("2026-11-06T10:00:00Z")

function station(overrides: Partial<Station> = {}): Station {
  return {
    id: "station-1",
    name: "Inventory station 1",
    status: "active",
    firmware_version: "0.1.0",
    last_seen_at: "2026-11-06T09:59:58Z",
    live: true,
    live_until: "2026-11-06T10:12:00Z",
    stale: false,
    report_interval_seconds: 10,
    latest: {
      recorded_at: "2026-11-06T09:59:55Z",
      temperature_c: 24.46,
      humidity_pct: 61.2,
      weight_g: 412.34,
      ph_value: 6.612,
      ph_voltage: 1.1234,
      dht_ok: true,
      load_cell_ok: true,
    },
    ...overrides,
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

interface Call {
  method: string
  url: string
  headers: Headers
  body: unknown
}
let calls: Call[] = []

function stubFetch(handler: (call: Call) => Response) {
  calls = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = {
        method: (init.method ?? "GET").toUpperCase(),
        url,
        headers: new Headers(init.headers),
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      }
      calls.push(call)
      return handler(call)
    }),
  )
}

const staff = (role: Role): StaffUser => ({ id: `${role}-1`, name: `Test ${role}`, email: `${role}@example.test`, role })

function renderAt(path: string, user: StaffUser, { isPreview = false } = {}) {
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

function history(points: { t: string; avg: number; min: number; max: number; count: number }[] = []) {
  return { device_id: "station-1", metric: "temperature_c", range: "24h", bucket_seconds: 300, points }
}

afterEach(() => {
  vi.unstubAllGlobals()
  setCsrfToken(null)
})

// --- pure helpers -----------------------------------------------------------------

describe("station helpers", () => {
  it("tells live, stale, paused, never-heard-from and disabled stations apart", () => {
    expect(stationState(station())).toBe("live")
    expect(stationState(station({ stale: true }))).toBe("stale")
    expect(stationState(station({ live: false, live_until: null, stale: true }))).toBe("paused")
    expect(stationState(station({ live: false, latest: null }))).toBe("no-data")
    expect(stationState(station({ status: "disabled", live: false }))).toBe("disabled")
  })

  it("explains a paused station as deliberate, not as a fault", () => {
    const text = stationExplanation(station({ live: false, stale: true }), NOW)
    expect(text).toMatch(/paused/i)
    expect(text).toMatch(/tap an authorised card/i)
  })

  it("prefers a live station, then the most recently heard from", () => {
    const old = station({ id: "old", live: false, latest: { ...station().latest!, recorded_at: "2026-11-05T09:00:00Z" } })
    const recent = station({ id: "recent", live: false })
    const live = station({ id: "live" })
    expect(primaryStation([old, recent])?.id).toBe("recent")
    expect(primaryStation([old, live, recent])?.id).toBe("live")
    expect(primaryStation([])).toBeNull()
  })

  it("formats how long ago a reading was", () => {
    expect(formatAge("2026-11-06T09:59:58Z", NOW)).toBe("just now")
    expect(formatAge("2026-11-06T09:59:30Z", NOW)).toBe("30 s ago")
    expect(formatAge("2026-11-06T09:55:00Z", NOW)).toBe("5 min ago")
    expect(formatAge("2026-11-06T07:00:00Z", NOW)).toBe("3 h ago")
  })
})

describe("card helpers", () => {
  it("normalises UIDs like the backend", () => {
    expect(normalizeUid("d5 61 e9 e7")).toBe("D5:61:E9:E7")
    expect(normalizeUid("D5-61-E9-E7")).toBe("D5:61:E9:E7")
    expect(normalizeUid("04A1B2C3D4E5F6")).toBe("04:A1:B2:C3:D4:E5:F6")
    expect(normalizeUid("D5:61:E9")).toBeNull()
    expect(normalizeUid("ZZ:61:E9:E7")).toBeNull()
  })

  it("offers recently tapped cards that nobody holds", () => {
    const scans = [
      { uid: "BA:E1:20:56", result: "unknown_card" },
      { uid: "D5:61:E9:E7", result: "granted" },
      { uid: "BA:E1:20:56", result: "unknown_card" },
      { uid: "62:9C:D5:E7", result: "card_revoked" },
    ] as RfidScan[]
    const cards = [{ uid: "D5:61:E9:E7", active: true }] as RfidCard[]
    expect(unassignedUids(scans, cards)).toEqual(["BA:E1:20:56", "62:9C:D5:E7"])
  })
})

// --- pages --------------------------------------------------------------------------

describe("environment page", () => {
  it("shows the live readings and the session end", async () => {
    stubFetch((call) =>
      call.url.includes("/history") ? json(history()) : json({ server_time: "2026-11-06T10:00:00Z", stations: [station()] }),
    )
    renderAt("/portal/environment", staff("shopkeeper"))

    expect(await screen.findByRole("heading", { name: "Storage environment", level: 1 })).toBeInTheDocument()
    expect(await screen.findByText("24.5")).toBeInTheDocument()
    expect(screen.getByText("61")).toBeInTheDocument()
    expect(screen.getAllByText(/^Live$/).length).toBeGreaterThan(0)
    // Readings are fetched with the staff session, never a device token.
    const stationsCall = calls.find((call) => call.url.endsWith("/sensors/stations"))!
    expect(stationsCall.headers.get("Authorization")).toBeNull()
    // Empty history is explained, not drawn as a flat line.
    await waitFor(() => expect(screen.getAllByText("No readings in this period")).toHaveLength(2))
  })

  it("says a paused station is paused on purpose and dims old values", async () => {
    stubFetch((call) =>
      call.url.includes("/history")
        ? json(history())
        : json({ server_time: "2026-11-06T10:00:00Z", stations: [station({ live: false, live_until: null, stale: true })] }),
    )
    renderAt("/portal/environment", staff("food_inspector"))

    expect(await screen.findByText(/Uploads are paused to save the free hosting plan/)).toBeInTheDocument()
    expect(screen.getAllByText("Paused").length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Last reading at/).length).toBe(2)
  })

  it("says why a value is missing instead of inventing one", async () => {
    const failed = station({
      latest: { ...station().latest!, temperature_c: null, humidity_pct: null, dht_ok: false },
    })
    stubFetch((call) => (call.url.includes("/history") ? json(history()) : json({ server_time: "", stations: [failed] })))
    renderAt("/portal/environment", staff("admin"))

    expect((await screen.findAllByText("Sensor not responding")).length).toBe(2)
  })

  it("explains when no station is registered and points administrators to Devices", async () => {
    stubFetch(() => json({ server_time: "", stations: [] }))
    renderAt("/portal/environment", staff("admin"))

    expect(await screen.findByText("No station registered")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Register a station" })).toHaveAttribute("href", "/portal/devices")
  })

  it("never calls the API in the development preview", async () => {
    stubFetch(() => json({}))
    renderAt("/portal/environment", staff("admin"), { isPreview: true })

    expect(await screen.findByText("Needs a real sign-in")).toBeInTheDocument()
    expect(calls.filter((call) => call.url.includes("/sensors"))).toHaveLength(0)
  })
})

describe("pH page", () => {
  it("always carries the experimental warning", async () => {
    stubFetch((call) => (call.url.includes("/history") ? json(history()) : json({ server_time: "", stations: [station()] })))
    renderAt("/portal/ph", staff("shopkeeper"))

    const note = await screen.findByRole("note")
    expect(within(note).getByText(/Never use it on its own to decide whether food is safe/)).toBeInTheDocument()
    expect(await screen.findByText("6.61")).toBeInTheDocument()
  })
})

describe("devices page", () => {
  it("shows a new token once, then hides it", async () => {
    setCsrfToken("csrf-1")
    const created = {
      device: { ...station(), kind: "sensor_station", token_prefix: "epd_abcdef", last_reading_at: null, live_started_at: null, created_at: "" },
      token: "epd_abcdefSECRETSECRET",
    }
    stubFetch((call) => (call.method === "POST" ? json(created, 201) : json([])))
    renderAt("/portal/devices", staff("admin"))

    await userEvent.type(await screen.findByLabelText("Register a station"), "Inventory station 1")
    await userEvent.click(screen.getByRole("button", { name: "Register" }))

    expect(await screen.findByText("epd_abcdefSECRETSECRET")).toBeInTheDocument()
    const post = calls.find((call) => call.method === "POST")!
    expect(post.body).toEqual({ name: "Inventory station 1" })
    expect(post.headers.get("X-CSRF-Token")).toBe("csrf-1")

    await userEvent.click(screen.getByRole("button", { name: "I've saved it" }))
    expect(screen.queryByText("epd_abcdefSECRETSECRET")).not.toBeInTheDocument()
  })
})

describe("employees page", () => {
  const card: RfidCard = {
    id: "card-1",
    uid: "D5:61:E9:E7",
    active: true,
    employee: { id: "e1", full_name: "Sam Baker", email: "sam@example.test", status: "active" },
    assigned_at: "2026-11-06T09:00:00Z",
    revoked_at: null,
  }

  function api(call: Call): Response {
    if (call.url.endsWith("/rfid/cards") && call.method === "POST") {
      return json({ ...card, uid: (call.body as { uid: string }).uid }, 201)
    }
    if (call.url.endsWith("/rfid/cards")) return json([card])
    if (call.url.includes("/rfid/scans")) {
      return json([{ id: 1, uid: "BA:E1:20:56", device_id: "station-1", result: "unknown_card", granted: false, employee_name: null, scanned_at: "2026-11-06T09:59:00Z" }])
    }
    if (call.url.endsWith("/employees")) return json([{ id: "e1", email: "sam@example.test", name: "Sam Baker", status: "active" }])
    return json({})
  }

  it("lets an administrator assign a recently tapped card", async () => {
    setCsrfToken("csrf-1")
    stubFetch(api)
    renderAt("/portal/employees", staff("admin"))

    await userEvent.click(await screen.findByRole("button", { name: "BA:E1:20:56" }))
    expect(screen.getByLabelText("Card UID")).toHaveValue("BA:E1:20:56")
    await userEvent.selectOptions(screen.getByLabelText("Staff member"), "e1")
    await userEvent.click(screen.getByRole("button", { name: "Assign" }))

    expect(await screen.findByText("Card BA:E1:20:56 now belongs to Sam Baker.")).toBeInTheDocument()
    const post = calls.find((call) => call.method === "POST")!
    expect(post.body).toEqual({ uid: "BA:E1:20:56", employee_id: "e1" })
  })

  it("rejects a malformed UID before calling the server", async () => {
    stubFetch(api)
    renderAt("/portal/employees", staff("admin"))

    await userEvent.type(await screen.findByLabelText("Card UID"), "not a card")
    await userEvent.click(screen.getByRole("button", { name: "Assign" }))

    expect(await screen.findByText(/Enter the card UID shown on the station/)).toBeInTheDocument()
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0)
  })

  it("is read-only for an inspector", async () => {
    stubFetch(api)
    renderAt("/portal/employees", staff("food_inspector"))

    expect(await screen.findByText("Sam Baker")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Revoke/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Card UID")).not.toBeInTheDocument()
    expect(screen.getByText("Unknown card")).toBeInTheDocument()
  })
})
