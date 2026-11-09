import { chromium, expect, test, type Browser, type Page } from "@playwright/test"
import { fakeCameraArgs, qrVideo } from "./fake-camera"

/**
 * QR scanner and label tests in a real browser.
 *
 * Chromium can play a video file as its camera, so the "real camera" tests
 * there scan an actual QR code made by the app's encoder, end to end. Other
 * browsers get the same UI tests with getUserMedia replaced by a stub that
 * fails the way the browser would (no camera, busy, blocked). Those check our
 * handling in that engine, not the engine's own permission prompt.
 *
 * Runs against the dev server's portal preview (no account), so batch lookup
 * stops at "needs a real sign-in"; the full-stack suite covers the real API.
 */

const LABEL = "ECOPANTRY:BATCH:K7M2Q9X4TR"
const VALID_VIDEO = qrVideo("valid-label", LABEL)
const FOREIGN_VIDEO = qrVideo("foreign-qr", "HTTPS://EXAMPLE.COM/MENU")

/** Records every camera stream the page opens, so tests can check they were all stopped. */
async function trackCameraStreams(page: Page) {
  await page.addInitScript(() => {
    const streams: MediaStream[] = []
    Object.assign(window, { __cameraStreams: streams })
    const devices = navigator.mediaDevices
    if (!devices?.getUserMedia) return
    const original = devices.getUserMedia.bind(devices)
    devices.getUserMedia = async (constraints) => {
      const stream = await original(constraints)
      streams.push(stream)
      return stream
    }
  })
}

function liveTracks(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { __cameraStreams: MediaStream[] }).__cameraStreams
      .flatMap((stream) => stream.getTracks())
      .filter((track) => track.readyState === "live").length,
  )
}

/** Makes getUserMedia fail with a given DOMException name, and the Permissions API report `state`. */
async function failCamera(page: Page, name: string, state?: PermissionState) {
  await page.addInitScript(
    ([errorName, permission]) => {
      if (navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia = async () => {
          throw new DOMException("stubbed", errorName)
        }
      }
      if (permission && navigator.permissions) {
        const query = navigator.permissions.query.bind(navigator.permissions)
        navigator.permissions.query = async (descriptor) =>
          descriptor.name === ("camera" as PermissionName)
            ? ({ state: permission, name: "camera", onchange: null } as unknown as PermissionStatus)
            : query(descriptor)
      }
    },
    [name, state ?? ""] as const,
  )
}

async function withChromiumCamera(
  file: string,
  options: { acceptPrompt?: boolean; grant?: boolean; viewport?: { width: number; height: number } },
  run: (page: Page) => Promise<void>,
) {
  const browser: Browser = await chromium.launch({ args: fakeCameraArgs(file, options) })
  try {
    const context = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      viewport: options.viewport ?? { width: 1280, height: 900 },
      permissions: options.grant === false ? [] : ["camera"],
    })
    const page = await context.newPage()
    await trackCameraStreams(page)
    await run(page)
  } finally {
    await browser.close()
  }
}

test.describe("scanner with a real (fake-device) camera", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Only Chromium can play a file as its camera")

  test("scans a label, stops the camera, and scans again on request", async () => {
    await withChromiumCamera(VALID_VIDEO, {}, async (page) => {
      await page.goto("/portal/scan")
      await page.getByRole("button", { name: "Start camera" }).click()

      await expect(page.getByText("Scanned label")).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText("K7M2Q-9X4TR", { exact: true })).toBeVisible()
      // Preview mode has no account, so the page doesn't call the API.
      await expect(page.getByText("Lookup needs a real sign-in")).toBeVisible()
      // One read, then the camera is off: no duplicate processing, no camera light.
      await expect.poll(() => liveTracks(page)).toBe(0)
      await expect(page.getByRole("button", { name: "Scan another label" })).toBeVisible()

      await page.getByRole("button", { name: "Scan another label" }).click()
      await expect.poll(() => liveTracks(page)).toBe(0)
      await expect(page.getByText("Scanned label")).toBeVisible()
    })
  })

  test("keeps scanning past a QR code that isn't a batch label, and stops on request", async () => {
    await withChromiumCamera(FOREIGN_VIDEO, {}, async (page) => {
      await page.goto("/portal/scan")
      await page.getByRole("button", { name: "Start camera" }).click()
      await expect(page.getByText("That QR code isn't an EcoPantry batch label", { exact: false })).toBeVisible({
        timeout: 10_000,
      })
      expect(await liveTracks(page)).toBe(1)
      await expect(page.getByText("Scanned label")).toHaveCount(0)
      await page.screenshot({ path: "e2e/.screenshots/qr-scanning-desktop.png" })

      await page.getByRole("button", { name: "Stop camera" }).click()
      await expect.poll(() => liveTracks(page)).toBe(0)
      await expect(page.getByRole("button", { name: "Start camera" })).toBeVisible()
    })
  })

  test("turns the camera off when leaving the page", async () => {
    await withChromiumCamera(FOREIGN_VIDEO, {}, async (page) => {
      await page.goto("/portal/scan")
      await page.getByRole("button", { name: "Start camera" }).click()
      await expect(page.getByRole("button", { name: "Stop camera" })).toBeVisible()
      await expect.poll(() => liveTracks(page)).toBe(1)

      await page.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "Inventory" }).click()
      await expect(page.getByRole("heading", { name: "Ingredient inventory", level: 1 })).toBeVisible()
      await expect.poll(() => liveTracks(page)).toBe(0)
    })
  })

  test("works on a phone-sized screen", async () => {
    await withChromiumCamera(FOREIGN_VIDEO, { viewport: { width: 375, height: 812 } }, async (page) => {
      await page.goto("/portal/scan")
      await page.getByRole("button", { name: "Start camera" }).click()
      await expect(page.getByText("That QR code isn't an EcoPantry batch label", { exact: false })).toBeVisible({
        timeout: 10_000,
      })
      await expect(page.locator("video")).toBeVisible()
      const video = await page.locator("video").boundingBox()
      expect(video?.width).toBeGreaterThanOrEqual(300)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      await page.screenshot({ path: "e2e/.screenshots/qr-scanning-mobile.png" })
    })
  })

  test("reports a refused permission without leaving the camera on", async () => {
    // No fake UI and no granted permission: headless Chromium refuses the request itself.
    await withChromiumCamera(VALID_VIDEO, { acceptPrompt: false, grant: false }, async (page) => {
      await page.goto("/portal/scan")
      await page.getByRole("button", { name: "Start camera" }).click()
      await expect(page.getByRole("alert")).toContainText(/Camera (permission wasn't given|access is blocked)/)
      expect(await liveTracks(page)).toBe(0)
      await expect(page.getByLabel("Batch code")).toBeVisible() // manual entry still works
    })
  })
})

test.describe("scanner with this browser's own fake camera", () => {
  // Firefox's fake stream (enabled in playwright.browsers.config.ts) has no QR code in it,
  // but it is a real Firefox MediaStream: enough to check start, stop and clean-up there.
  test.skip(({ browserName }) => browserName !== "firefox", "Chromium is covered above; WebKit has no fake camera")

  test("starts, stops and releases the camera", async ({ page }) => {
    await trackCameraStreams(page)
    await page.goto("/portal/scan")
    await page.getByRole("button", { name: "Start camera" }).click()
    await expect(page.getByText("Scanning. Hold the label's QR code inside the frame.")).toBeVisible()
    expect(await liveTracks(page)).toBe(1)
    await page.getByRole("button", { name: "Stop camera" }).click()
    await expect.poll(() => liveTracks(page)).toBe(0)

    await page.getByRole("button", { name: "Start camera" }).click()
    await expect(page.getByRole("button", { name: "Stop camera" })).toBeVisible()
    await expect.poll(() => liveTracks(page)).toBe(1)
    await page.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "Dashboard" }).click()
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible()
    await expect.poll(() => liveTracks(page)).toBe(0)
  })
})

test.describe("scanner camera problems", () => {
  for (const [name, state, message] of [
    ["NotAllowedError", "denied", "Camera access is blocked for this site"],
    ["NotAllowedError", "prompt", "Camera permission wasn't given"],
    ["NotFoundError", undefined, "No camera found"],
    ["NotReadableError", undefined, "The camera is busy"],
  ] as const) {
    test(`explains ${name}${state ? ` (${state})` : ""}`, async ({ page }) => {
      await failCamera(page, name, state)
      await page.goto("/portal/scan")
      await page.getByRole("button", { name: "Start camera" }).click()
      await expect(page.getByRole("alert")).toContainText(message)
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible()
    })
  }

  test("explains that the camera needs HTTPS", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(window, "isSecureContext", { value: false }))
    await page.goto("/portal/scan")
    await page.getByRole("button", { name: "Start camera" }).click()
    await expect(page.getByRole("alert")).toContainText("The camera needs a secure connection")
  })

  test("manual entry validates and reads codes", async ({ page }) => {
    await page.goto("/portal/scan")
    await page.getByLabel("Batch code").fill("not a code")
    await page.getByRole("button", { name: "Look up" }).click()
    await expect(page.getByRole("alert")).toContainText("doesn't look like a batch code")

    await page.getByLabel("Batch code").fill("k7m2q 9x4tr")
    await page.getByRole("button", { name: "Look up" }).click()
    await expect(page.getByText("Entered label")).toBeVisible()
    await expect(page.getByText("K7M2Q-9X4TR", { exact: true })).toBeVisible()
  })
})

test.describe("QR labels", () => {
  test("prints only the labels, on white, whatever the theme", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("ecopantry-theme", "dark"))
    // The picker lists real batches that still have stock; this suite has no backend, so answer the list here.
    await page.route("**/api/v1/batches?*", (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: "b1000000-0000-4000-8000-000000000001",
              label_code: "K7M2Q9X4TR",
              ingredient: { id: "i1000000-0000-4000-8000-000000000001", name: "Strong white flour", unit: "kg" },
              storage_area: null,
              received_on: "2026-11-01",
              expiry_on: "2026-11-20",
              quantity: "25.000",
              remaining_quantity: "20.000",
              status: "available",
              notes: null,
              created_at: "2026-11-01T08:00:00Z",
            },
          ],
          total: 1,
          limit: 200,
          offset: 0,
        },
      }),
    )
    await page.goto("/portal/qr")
    await page.getByLabel("Batch", { exact: true }).selectOption({ label: "Strong white flour · K7M2Q-9X4TR · use by 20 Nov 2026" })
    await page.getByLabel("Copies").fill("4")
    await page.getByRole("button", { name: "Add to sheet" }).click()
    await expect(page.getByRole("button", { name: "Print 4 labels" })).toBeEnabled()

    await page.emulateMedia({ media: "print" })
    await expect(page.locator("#root")).toBeHidden()
    const sheet = page.locator("body > .print-sheet")
    await expect(sheet).toBeVisible()
    await expect(sheet.locator("svg")).toHaveCount(4)
    await expect(sheet).toContainText("20 Nov 2026")
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(background).toBe("rgb(255, 255, 255)")
    // Close to the physical size: 63.5 mm is 240 CSS px.
    const label = await sheet.locator("> div > div").first().boundingBox()
    expect(Math.round(label?.width ?? 0)).toBe(240)
    await page.screenshot({ path: "e2e/.screenshots/qr-labels-print.png", fullPage: true })

    await page.emulateMedia({ media: "screen" })
    await expect(sheet).toBeHidden()
    await expect(page.locator("#root")).toBeVisible()
  })

  test("pages without labels print normally", async ({ page }) => {
    await page.goto("/portal/qr")
    await page.emulateMedia({ media: "print" })
    await expect(page.getByRole("heading", { name: "QR labels", level: 1 })).toBeVisible()
  })
})

test.describe("QR navigation and roles", () => {
  test("the top bar's scan shortcut opens the scanner on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto("/portal")
    const shortcut = page.getByRole("link", { name: "Scan a QR label" })
    const box = await shortcut.boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(44)
    expect(box?.height).toBeGreaterThanOrEqual(44)
    await shortcut.click()
    await expect(page.getByRole("heading", { name: "QR scanner", level: 1 })).toBeVisible()
    await expect(shortcut).toHaveAttribute("aria-current", "page")
  })

  test("inspectors can scan but not make labels", async ({ page }) => {
    test.skip(!!test.info().project.use.isMobile, "Uses the desktop layout; the phone layout has its own tests")
    await page.goto("/portal")
    await page.getByLabel("View as").selectOption("inspector")
    const nav = page.getByRole("navigation", { name: "Portal" })
    await expect(nav.getByRole("link", { name: "QR scanner" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "QR labels" })).toHaveCount(0)
    await nav.getByRole("link", { name: "QR scanner" }).click()
    await expect(page.getByRole("heading", { name: "QR scanner", level: 1 })).toBeVisible()
  })

  test("the theme is in the account menu", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" })
    await page.goto("/portal")
    await page.getByRole("button", { name: "Account menu" }).click()
    await page.getByRole("menuitemradio", { name: "Dark" }).click()
    await expect(page.locator("html")).toHaveClass(/dark/)
  })
})
