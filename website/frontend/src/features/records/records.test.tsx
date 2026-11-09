import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { routes } from "@/app/routes"
import { modulesForRole } from "@/config/portal-modules"
import { contactFormSchema } from "@/features/contact/public"
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context"
import type { Role, StaffUser } from "@/features/auth/roles"
import { ThemeProvider } from "@/features/theme/ThemeProvider"
import { setCsrfToken } from "@/lib/api/client"
import { daysAgoIso } from "./api"
import { phFormSchema, toPhInput, toWasteInput, wasteFormSchema } from "./schemas"

// --- helpers ----------------------------------------------------------------

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

interface Call {
  method: string
  url: string
  headers: Headers
  body: unknown
  credentials?: RequestCredentials
}
let calls: Call[] = []

function stubFetch(handler: (call: Call) => Response | Promise<Response>) {
  calls = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = {
        method: (init.method ?? "GET").toUpperCase(),
        url,
        headers: new Headers(init.headers),
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
        credentials: init.credentials,
      }
      calls.push(call)
      return handler(call)
    }),
  )
}

function staff(role: Role): StaffUser {
  return { id: "u1", name: "Test User", email: "user@example.test", role }
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
    setSession: vi.fn(),
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

const page = <T,>(items: T[], total = items.length, offset = 0) => ({ items, total, limit: 20, offset })
const PERSON = { id: "e1", full_name: "Sam Baker" }

const WASTE_ROW = {
  id: "w1",
  category: "spoiled",
  reason: "Mould on the loaf",
  weight_kg: "1.250",
  batch_id: null,
  employee: PERSON,
  recorded_at: "2026-11-05T09:00:00Z",
}
const SUMMARY = {
  records: 3,
  weight_kg: "2.500",
  by_category: [
    { category: "expired", records: 1, weight_kg: "0.000" },
    { category: "spoiled", records: 2, weight_kg: "2.500" },
    { category: "damaged", records: 0, weight_kg: "0.000" },
    { category: "production_offcut", records: 0, weight_kg: "0.000" },
    { category: "other", records: 0, weight_kg: "0.000" },
  ],
}

/** Station list empty so the live section settles quickly; everything else per test. */
function api(extra: (call: Call) => Response | null) {
  stubFetch((call) => {
    const answer = extra(call)
    if (answer) return answer
    if (call.url.endsWith("/sensors/stations")) return json({ stations: [] })
    return json({ detail: "unexpected", code: "not_found" }, 404)
  })
}

beforeEach(() => setCsrfToken("csrf-1"))
afterEach(() => {
  vi.unstubAllGlobals()
  setCsrfToken(null)
})

// --- pure --------------------------------------------------------------------

describe("record forms", () => {
  it("requires a reason for Other and checks the weight and batch ID", () => {
    const issues = (values: object) =>
      wasteFormSchema.safeParse({ category: "spoiled", reason: "", weight: "", batchId: "", ...values }).error?.issues.map(
        (issue) => issue.path.join("."),
      ) ?? []

    expect(issues({})).toEqual([])
    expect(issues({ category: "other" })).toEqual(["reason"])
    expect(issues({ weight: "1.2345" })).toEqual(["weight"])
    expect(issues({ weight: "-1" })).toEqual(["weight"])
    expect(issues({ batchId: "nope" })).toEqual(["batchId"])
    expect(toWasteInput(wasteFormSchema.parse({ category: "damaged", reason: " ", weight: "2", batchId: "" }))).toEqual({
      category: "damaged",
      reason: null,
      weight_kg: "2",
      batch_id: null,
    })
  })

  it("keeps pH between 0 and 14 and the reference range complete and ordered", () => {
    const base = { sample: "Starter", value: "4.5", referenceMin: "", referenceMax: "", calibration: "", batchId: "" }
    const issues = (values: object) => phFormSchema.safeParse({ ...base, ...values }).error?.issues.map((i) => i.path.join(".")) ?? []

    expect(issues({})).toEqual([])
    expect(issues({ value: "15" })).toEqual(["value"])
    expect(issues({ value: "" })).toEqual(["value"])
    expect(issues({ sample: " " })).toEqual(["sample"])
    expect(issues({ referenceMin: "3" })).toEqual(["referenceMax"])
    expect(issues({ referenceMin: "6", referenceMax: "5" })).toEqual(["referenceMin"])
    expect(toPhInput(phFormSchema.parse({ ...base, referenceMin: "3.5", referenceMax: "4.5" }))).toMatchObject({
      reference_min: "3.5",
      reference_max: "4.5",
    })
  })

  it("checks the contact form like the server does", () => {
    const ok = { name: "Sam", email: "sam@example.test", message: "Hello", website: "" }
    const bad = (values: object) => contactFormSchema.safeParse({ ...ok, ...values }).success === false

    expect(bad({})).toBe(false)
    expect(bad({ name: "  " })).toBe(true)
    expect(bad({ email: "nope" })).toBe(true)
    expect(bad({ message: "x".repeat(5001) })).toBe(true)
  })

  it("computes the summary start date in UTC", () => {
    expect(daysAgoIso(30, new Date("2026-11-09T12:00:00Z"))).toBe("2026-10-10")
  })

  it("lists the enquiries module for administrators only", () => {
    expect(modulesForRole("admin").some((module) => module.id === "enquiries")).toBe(true)
    expect(modulesForRole("storekeeper").some((module) => module.id === "enquiries")).toBe(false)
    expect(modulesForRole("inspector").some((module) => module.id === "enquiries")).toBe(false)
  })
})

// --- waste -------------------------------------------------------------------

describe("waste page records", () => {
  it("shows totals and recent records below the live section", async () => {
    api((call) =>
      call.url.includes("/waste/records") ? json(page([WASTE_ROW])) : call.url.includes("/waste/summary") ? json(SUMMARY) : null,
    )
    renderAt("/portal/waste", staff("storekeeper"))

    const table = await screen.findByRole("table", { name: /waste records/i })
    expect(within(table).getByText("Mould on the loaf")).toBeInTheDocument()
    expect(within(table).getByText("Sam Baker")).toBeInTheDocument()
    expect(within(table).getByText("1.25 kg")).toBeInTheDocument()
    expect(await screen.findByText(/Last 30 days: 3 records/)).toBeInTheDocument()
    expect(calls.find((c) => c.url.includes("/waste/summary"))?.url).toMatch(/date_from=\d{4}-\d{2}-\d{2}/)
  })

  it("records waste with the CSRF token, checks fields first and clears the form", async () => {
    const user = userEvent.setup()
    api((call) => {
      if (call.method === "POST") return json({ ...WASTE_ROW, id: "w2" }, 201)
      if (call.url.includes("/waste/records")) return json(page([]))
      if (call.url.includes("/waste/summary")) return json({ ...SUMMARY, records: 0, weight_kg: "0" })
      return null
    })
    renderAt("/portal/waste", staff("storekeeper"))
    const form = await screen.findByRole("form", { name: "Record waste" })

    await user.click(within(form).getByRole("button", { name: "Record waste" }))
    expect(await within(form).findByText("Choose a category.")).toBeInTheDocument()
    expect(calls.some((c) => c.method === "POST")).toBe(false)

    await user.selectOptions(within(form).getByLabelText("Category"), "other")
    await user.click(within(form).getByRole("button", { name: "Record waste" }))
    expect(await within(form).findByText("Say what happened when the category is Other.")).toBeInTheDocument()

    await user.type(within(form).getByLabelText("Reason"), "Dropped tray")
    await user.type(within(form).getByLabelText("Weight (kg)"), "0.8")
    await user.click(within(form).getByRole("button", { name: "Record waste" }))

    await waitFor(() => expect(screen.getByText("Waste recorded.")).toBeInTheDocument())
    const post = calls.find((c) => c.method === "POST")!
    expect(post.url).toBe("/api/v1/waste/records")
    expect(post.headers.get("X-CSRF-Token")).toBe("csrf-1")
    expect(post.body).toEqual({ category: "other", reason: "Dropped tray", weight_kg: "0.8", batch_id: null })
    expect(within(form).getByLabelText("Reason")).toHaveValue("")
  })

  it("shows the server's refusal and keeps what was typed", async () => {
    const user = userEvent.setup()
    api((call) => {
      if (call.method === "POST") return json({ detail: "That batch doesn't exist.", code: "unknown_batch" }, 400)
      if (call.url.includes("/waste/records")) return json(page([]))
      if (call.url.includes("/waste/summary")) return json(SUMMARY)
      return null
    })
    renderAt("/portal/waste", staff("admin"))
    const form = await screen.findByRole("form", { name: "Record waste" })

    await user.selectOptions(within(form).getByLabelText("Category"), "expired")
    await user.type(within(form).getByLabelText("Reason"), "Past date")
    await user.click(within(form).getByRole("button", { name: "Record waste" }))

    expect(await within(form).findByRole("alert")).toHaveTextContent("That batch doesn't exist.")
    expect(within(form).getByLabelText("Reason")).toHaveValue("Past date")
  })

  it("hides the form from inspectors, who can still read the records", async () => {
    api((call) =>
      call.url.includes("/waste/records") ? json(page([WASTE_ROW])) : call.url.includes("/waste/summary") ? json(SUMMARY) : null,
    )
    renderAt("/portal/waste", staff("inspector"))

    expect(await screen.findByRole("table", { name: /waste records/i })).toBeInTheDocument()
    expect(screen.queryByRole("form", { name: "Record waste" })).not.toBeInTheDocument()
  })

  it("pages through records", async () => {
    const user = userEvent.setup()
    api((call) => {
      if (call.url.includes("/waste/records")) {
        const offset = Number(new URL(call.url, "http://x").searchParams.get("offset"))
        return json(page([{ ...WASTE_ROW, id: `w${offset}` }], 25, offset))
      }
      return call.url.includes("/waste/summary") ? json(SUMMARY) : null
    })
    renderAt("/portal/waste", staff("admin"))

    expect(await screen.findByText("Showing 1–1 of 25")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /Next/ }))
    expect(await screen.findByText("Showing 21–21 of 25")).toBeInTheDocument()
  })
})

// --- pH ----------------------------------------------------------------------

describe("pH page records", () => {
  const PH_ROW = {
    id: "p1",
    sample_description: "Sourdough starter",
    batch_id: null,
    ph_value: "4.26",
    reference_min: "3.50",
    reference_max: "4.50",
    calibration_note: "Two-point",
    operator: PERSON,
    recorded_at: "2026-11-05T09:00:00Z",
    experimental: true,
  }

  it("lists measurements with the experimental warning and no verdict", async () => {
    api((call) => (call.url.includes("/ph/records") ? json(page([PH_ROW])) : null))
    renderAt("/portal/ph", staff("inspector"))

    const table = await screen.findByRole("table", { name: /pH measurements/i })
    expect(within(table).getByText("Sourdough starter")).toBeInTheDocument()
    expect(within(table).getByText("3.50–4.50")).toBeInTheDocument()
    expect(screen.getByText(/never says whether food is safe or spoiled/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Never use it on its own/i).length).toBeGreaterThan(0)
    expect(within(table).queryByText(/^(safe|spoiled|pass|fail)$/i)).toBeNull()
    expect(screen.queryByRole("form", { name: "Record a measurement" })).not.toBeInTheDocument()
  })

  it("records a measurement", async () => {
    const user = userEvent.setup()
    api((call) => {
      if (call.method === "POST") return json(PH_ROW, 201)
      return call.url.includes("/ph/records") ? json(page([])) : null
    })
    renderAt("/portal/ph", staff("storekeeper"))
    const form = await screen.findByRole("form", { name: "Record a measurement" })

    await user.click(within(form).getByRole("button", { name: "Record measurement" }))
    expect(await within(form).findByText("Describe the sample.")).toBeInTheDocument()

    await user.type(within(form).getByLabelText("Sample"), "Starter")
    await user.type(within(form).getByLabelText("Measured pH"), "4.3")
    await user.type(within(form).getByLabelText("Reference minimum"), "3.5")
    await user.click(within(form).getByRole("button", { name: "Record measurement" }))
    expect(await within(form).findByText("Give both ends of the reference range, or neither.")).toBeInTheDocument()

    await user.type(within(form).getByLabelText("Reference maximum"), "4.5")
    await user.click(within(form).getByRole("button", { name: "Record measurement" }))

    await waitFor(() => expect(screen.getByText("Measurement recorded.")).toBeInTheDocument())
    const post = calls.find((c) => c.method === "POST")!
    expect(post.headers.get("X-CSRF-Token")).toBe("csrf-1")
    expect(post.body).toEqual({
      sample_description: "Starter",
      ph_value: "4.3",
      reference_min: "3.5",
      reference_max: "4.5",
      calibration_note: null,
      batch_id: null,
    })
  })
})

// --- audit -------------------------------------------------------------------

describe("audit log page", () => {
  const EVENT = {
    id: 7,
    occurred_at: "2026-11-05T09:00:00Z",
    actor_type: "employee",
    actor: PERSON,
    action: "waste.recorded",
    target_type: "waste_record",
    target_id: "12345678-aaaa-bbbb-cccc-1234567890ab",
  }

  it("shows events and applies filters from the first page", async () => {
    const user = userEvent.setup()
    api((call) => {
      if (!call.url.startsWith("/api/v1/audit")) return null
      const filtered = call.url.includes("action=waste.recorded")
      return json(page(filtered ? [EVENT] : [EVENT, { ...EVENT, id: 8, actor: null, actor_type: "cli", action: "employee.created", target_type: null, target_id: null }]))
    })
    renderAt("/portal/audit", staff("inspector"))

    const table = await screen.findByRole("table", { name: /audit events/i })
    expect(within(table).getAllByRole("row")).toHaveLength(3)
    expect(within(table).getByText("Server operator")).toBeInTheDocument()
    expect(within(table).getByText("waste_record 12345678")).toBeInTheDocument()

    await user.type(screen.getByLabelText("Event"), "waste.recorded")
    await user.click(screen.getByRole("button", { name: "Apply" }))

    await waitFor(() => expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2))
    expect(calls.at(-1)!.url).toContain("action=waste.recorded")
    expect(calls.at(-1)!.url).toContain("offset=0")
  })

  it("explains an empty result and a failure", async () => {
    api((call) => (call.url.startsWith("/api/v1/audit") ? json(page([])) : null))
    renderAt("/portal/audit", staff("admin"))
    expect(await screen.findByText("No events match")).toBeInTheDocument()
  })

  it("refuses shopkeepers", async () => {
    api(() => null)
    renderAt("/portal/audit", staff("storekeeper"))
    await waitFor(() => expect(screen.queryByLabelText("Event")).not.toBeInTheDocument())
    expect(calls.some((c) => c.url.startsWith("/api/v1/audit"))).toBe(false)
  })
})

// --- enquiries inbox ---------------------------------------------------------

describe("enquiries inbox", () => {
  const ENQUIRY = {
    id: "q1",
    name: "Sam Customer",
    email: "sam@example.test",
    message: "Do you do gluten free?",
    created_at: "2026-11-05T09:00:00Z",
    read_at: null,
  }

  it("lists messages, filters unread and marks one as read", async () => {
    const user = userEvent.setup()
    api((call) => {
      if (call.method === "POST") return json({ ...ENQUIRY, read_at: "2026-11-05T10:00:00Z" })
      return call.url.startsWith("/api/v1/enquiries") ? json(page([ENQUIRY])) : null
    })
    renderAt("/portal/enquiries", staff("admin"))

    expect(await screen.findByText("Do you do gluten free?")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "sam@example.test" })).toHaveAttribute("href", "mailto:sam@example.test")

    await user.click(screen.getByLabelText("Unread only"))
    await waitFor(() => expect(calls.at(-1)!.url).toContain("unread=true"))

    await user.click(await screen.findByRole("button", { name: "Mark as read" }))
    const post = calls.find((c) => c.method === "POST")!
    expect(post.url).toBe("/api/v1/enquiries/q1/read")
    expect(post.headers.get("X-CSRF-Token")).toBe("csrf-1")
  })

  it("is closed to other roles", async () => {
    api(() => null)
    renderAt("/portal/enquiries", staff("inspector"))
    await waitFor(() => expect(screen.queryByText("Unread only")).not.toBeInTheDocument())
    expect(calls.some((c) => c.url.startsWith("/api/v1/enquiries"))).toBe(false)
  })
})

// --- public contact form -----------------------------------------------------

describe("public contact form", () => {
  async function fill(user: ReturnType<typeof userEvent.setup>) {
    await user.type(await screen.findByLabelText("Your name"), "Sam Customer")
    await user.type(screen.getByLabelText("Email address"), "sam@example.test")
    await user.type(screen.getByLabelText("Message"), "Do you do gluten free?")
  }

  it("shows each problem next to its field and sends nothing until it's valid", async () => {
    const user = userEvent.setup()
    stubFetch(() => json({ accepted: true }, 202))
    renderAt("/contact")

    await user.click(await screen.findByRole("button", { name: "Send message" }))

    expect(await screen.findByText("Enter your name.")).toBeInTheDocument()
    expect(screen.getByText("Enter your email address.")).toBeInTheDocument()
    expect(screen.getByLabelText("Your name")).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByLabelText("Your name")).toHaveAccessibleDescription("Enter your name.")
    expect(calls).toHaveLength(0)
  })

  it("posts without cookies, thanks the visitor and clears the form", async () => {
    const user = userEvent.setup()
    stubFetch(() => json({ accepted: true }, 202))
    renderAt("/contact")
    await fill(user)

    await user.click(screen.getByRole("button", { name: "Send message" }))

    expect(await screen.findByText(/Your message has been sent/)).toBeInTheDocument()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/v1/public/enquiries", credentials: "omit" })
    expect(calls[0].body).toEqual({ name: "Sam Customer", email: "sam@example.test", message: "Do you do gluten free?", website: "" })
    expect(screen.getByLabelText("Message")).toHaveValue("")
  })

  it("hides the honeypot from keyboard and assistive technology", async () => {
    renderAt("/contact")
    await screen.findByRole("button", { name: "Send message" })

    const trap = document.querySelector<HTMLInputElement>('input[name="website"]')!
    expect(trap).toHaveAttribute("tabindex", "-1")
    expect(trap.closest("[aria-hidden='true']")).not.toBeNull()
    expect(screen.queryByRole("textbox", { name: "Leave this field empty" })).not.toBeInTheDocument()
  })

  it("explains a rate limit and keeps the message", async () => {
    const user = userEvent.setup()
    stubFetch(() => json({ detail: "Too many.", code: "too_many_requests" }, 429))
    renderAt("/contact")
    await fill(user)

    await user.click(screen.getByRole("button", { name: "Send message" }))

    expect(await screen.findByText(/sent several messages recently/)).toBeInTheDocument()
    expect(screen.getByLabelText("Message")).toHaveValue("Do you do gluten free?")
  })

  it("explains an unreachable server and keeps the message", async () => {
    const user = userEvent.setup()
    stubFetch(() => new Response("Bad gateway", { status: 502 }))
    renderAt("/contact")
    await fill(user)

    await user.click(screen.getByRole("button", { name: "Send message" }))

    expect(await screen.findByText(/can't reach the server/i)).toBeInTheDocument()
    expect(screen.getByLabelText("Your name")).toHaveValue("Sam Customer")
  })

  it("keeps hiding contact details the owners haven't provided", async () => {
    renderAt("/contact")

    expect(await screen.findByText(/contact details haven't been added yet/)).toBeInTheDocument()
    expect(screen.queryByText("Phone")).not.toBeInTheDocument()
  })
})
