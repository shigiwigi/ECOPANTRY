import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import jsQR from "jsqr"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cameraSupport, describeCameraError, videoConstraints } from "./camera"
import { QrScanner } from "./QrScanner"

vi.mock("jsqr", () => ({ default: vi.fn(() => null) }))

// --- fake camera ------------------------------------------------------------------

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>
  readyState: "live" | "ended"
  end: () => void
}

function fakeStream(settings: MediaTrackSettings = { deviceId: "rear", facingMode: "environment" }) {
  const listeners: (() => void)[] = []
  const track: FakeTrack & Partial<MediaStreamTrack> = {
    kind: "video",
    readyState: "live",
    stop: vi.fn(() => {
      track.readyState = "ended"
    }),
    getSettings: () => settings,
    addEventListener: ((type: string, listener: () => void) => {
      if (type === "ended") listeners.push(listener)
    }) as MediaStreamTrack["addEventListener"],
    end: () => listeners.forEach((listener) => listener()),
  }
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
  return { stream, track }
}

const named = (name: string) => Object.assign(new Error(name), { name })

let getUserMedia: ReturnType<typeof vi.fn>
let enumerateDevices: ReturnType<typeof vi.fn>
let permissionState: PermissionState | "unsupported" = "unsupported"

function installCamera({ secure = true, mediaDevices = true } = {}) {
  vi.stubGlobal("isSecureContext", secure)
  getUserMedia = vi.fn(async () => fakeStream().stream)
  enumerateDevices = vi.fn(async () => [
    { kind: "videoinput", deviceId: "rear", label: "Back camera" },
    { kind: "audioinput", deviceId: "mic", label: "Microphone" },
  ])
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: mediaDevices
      ? { getUserMedia, enumerateDevices, addEventListener: vi.fn(), removeEventListener: vi.fn() }
      : undefined,
  })
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value:
      permissionState === "unsupported"
        ? undefined
        : { query: vi.fn(async () => ({ state: permissionState })) },
  })
}

beforeEach(() => {
  permissionState = "unsupported"
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})
  installCamera()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.mocked(jsQR).mockReset().mockReturnValue(null)
})

function renderScanner(onCode = vi.fn()) {
  const view = render(<QrScanner onCode={onCode} hasResult={false} />)
  return { ...view, onCode, user: userEvent.setup() }
}

// --- helpers -----------------------------------------------------------------------

describe("camera helpers", () => {
  it("needs a secure context and the mediaDevices API", () => {
    expect(cameraSupport()).toBe("ok")
    installCamera({ secure: false })
    expect(cameraSupport()).toBe("insecure")
    installCamera({ mediaDevices: false })
    expect(cameraSupport()).toBe("unsupported")
  })

  it("prefers the rear camera, and asks for a chosen camera exactly", () => {
    expect(videoConstraints(null)).toMatchObject({ facingMode: { ideal: "environment" } })
    expect(videoConstraints("abc")).toMatchObject({ deviceId: { exact: "abc" } })
    expect(videoConstraints("abc")).not.toHaveProperty("facingMode")
  })

  it.each([
    ["NotAllowedError", "denied", "blocked"],
    ["NotAllowedError", "prompt", "dismissed"],
    ["NotAllowedError", "unsupported", "denied"],
    ["NotFoundError", "unsupported", "not-found"],
    ["OverconstrainedError", "unsupported", "not-found"],
    ["NotReadableError", "unsupported", "busy"],
    ["AbortError", "unsupported", "busy"],
    ["SecurityError", "unsupported", "blocked"],
    ["TypeError", "unsupported", "failed"],
    ["NotSupportedError", "denied", "blocked"],
    ["NotSupportedError", "granted", "failed"],
  ] as const)("reports %s (permission %s) as %s", async (name, state, kind) => {
    permissionState = state
    installCamera()
    expect((await describeCameraError(named(name))).kind).toBe(kind)
  })
})

// --- scanner -----------------------------------------------------------------------

describe("QR scanner", () => {
  it("doesn't touch the camera until Start is pressed", async () => {
    const { user } = renderScanner()
    expect(getUserMedia).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    await screen.findByRole("button", { name: "Stop camera" })
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(getUserMedia).toHaveBeenCalledWith({ video: videoConstraints(null), audio: false })
  })

  it("stops every track when Stop is pressed, and can start again", async () => {
    const first = fakeStream()
    getUserMedia.mockResolvedValueOnce(first.stream)
    const { user } = renderScanner()
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    await user.click(await screen.findByRole("button", { name: "Stop camera" }))
    expect(first.track.stop).toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Start camera" }))
    await screen.findByRole("button", { name: "Stop camera" })
    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })

  it("stops the camera when the page goes away", async () => {
    const { stream, track } = fakeStream()
    getUserMedia.mockResolvedValueOnce(stream)
    const { user, unmount } = renderScanner()
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    await screen.findByRole("button", { name: "Stop camera" })
    unmount()
    expect(track.stop).toHaveBeenCalled()
  })

  it("stops the camera when the tab is hidden", async () => {
    const { stream, track } = fakeStream()
    getUserMedia.mockResolvedValueOnce(stream)
    const { user } = renderScanner()
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    await screen.findByRole("button", { name: "Stop camera" })

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
    act(() => void document.dispatchEvent(new Event("visibilitychange")))

    expect(track.stop).toHaveBeenCalled()
    expect(screen.getByText("The camera turned off while this tab was in the background.")).toBeInTheDocument()
  })

  it("releases a camera that arrives after the page has gone", async () => {
    const { stream, track } = fakeStream()
    let grant: (value: MediaStream) => void = () => {}
    getUserMedia.mockReturnValueOnce(new Promise((resolve) => (grant = resolve)))
    const { user, unmount } = renderScanner()
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    unmount() // left while the permission prompt was still open
    await act(async () => grant(stream))
    expect(track.stop).toHaveBeenCalled()
  })

  it("explains a blocked camera and offers to try again", async () => {
    permissionState = "denied"
    installCamera()
    getUserMedia.mockRejectedValueOnce(named("NotAllowedError"))
    const { user } = renderScanner()
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Camera access is blocked for this site")
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument()
  })

  it("explains a busy camera", async () => {
    getUserMedia.mockRejectedValueOnce(named("NotReadableError"))
    const { user } = renderScanner()
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("The camera is busy")
  })

  it("explains a missing camera", async () => {
    getUserMedia.mockRejectedValueOnce(named("NotFoundError"))
    const { user } = renderScanner()
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("No camera found")
  })

  it("explains that plain HTTP can't use the camera, without asking for it", async () => {
    installCamera({ secure: false })
    const { user } = renderScanner()
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("The camera needs a secure connection")
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument()
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it("explains a browser without camera support", async () => {
    installCamera({ mediaDevices: false })
    const { user } = renderScanner()
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("This browser can't use the camera here")
  })

  it("reports a camera that is unplugged while scanning", async () => {
    const { stream, track } = fakeStream()
    getUserMedia.mockResolvedValueOnce(stream)
    const { user } = renderScanner()
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    await screen.findByRole("button", { name: "Stop camera" })
    act(() => track.end())
    expect(await screen.findByRole("alert")).toHaveTextContent("The camera stopped")
  })

  it("lists cameras once permission is granted, and switches to the chosen one", async () => {
    enumerateDevices.mockResolvedValue([
      { kind: "videoinput", deviceId: "front", label: "Front camera" },
      { kind: "videoinput", deviceId: "rear", label: "Back camera" },
    ])
    const { user } = renderScanner()
    expect(screen.queryByLabelText("Use")).not.toBeInTheDocument()
    expect(enumerateDevices).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Start camera" }))
    const select = await screen.findByLabelText("Use")
    expect(select).toHaveValue("rear")
    await user.selectOptions(select, "front")
    await waitFor(() => expect(getUserMedia).toHaveBeenLastCalledWith({ video: videoConstraints("front"), audio: false }))
  })

  it("falls back to the default camera when the chosen one has gone", async () => {
    enumerateDevices.mockResolvedValue([
      { kind: "videoinput", deviceId: "front", label: "" },
      { kind: "videoinput", deviceId: "rear", label: "" },
    ])
    const { user } = renderScanner()
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    const select = await screen.findByLabelText("Use")
    expect(screen.getByRole("option", { name: "Camera 1" })).toBeInTheDocument() // unnamed cameras get numbers

    getUserMedia.mockRejectedValueOnce(named("OverconstrainedError"))
    await user.selectOptions(select, "front")
    await waitFor(() => expect(getUserMedia).toHaveBeenLastCalledWith({ video: videoConstraints(null), audio: false }))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})

describe("QR scanner decoding", () => {
  function enableFrames() {
    // jsdom has no video decoding or canvas; pretend a 640×480 frame is ready.
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4)
    vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(640)
    vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(480)
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    } as unknown as CanvasRenderingContext2D)
  }

  it("hands over a valid label once and turns the camera off", async () => {
    enableFrames()
    vi.mocked(jsQR).mockReturnValue({ data: "ECOPANTRY:BATCH:K7M2Q9X4TR" } as ReturnType<typeof jsQR>)
    const { stream, track } = fakeStream()
    getUserMedia.mockResolvedValueOnce(stream)
    const { user, onCode } = renderScanner()
    await user.click(screen.getByRole("button", { name: "Start camera" }))

    await waitFor(() => expect(onCode).toHaveBeenCalledWith("K7M2Q9X4TR"))
    expect(track.stop).toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 400)) // several scan intervals
    expect(onCode).toHaveBeenCalledTimes(1)
  })

  it("keeps scanning past a QR code that isn't a batch label", async () => {
    enableFrames()
    vi.mocked(jsQR).mockReturnValue({ data: "https://example.com" } as ReturnType<typeof jsQR>)
    const { stream, track } = fakeStream()
    getUserMedia.mockResolvedValueOnce(stream)
    const { user, onCode } = renderScanner()
    await user.click(screen.getByRole("button", { name: "Start camera" }))

    expect(await screen.findByText(/That QR code isn't an EcoPantry batch label/)).toBeInTheDocument()
    expect(onCode).not.toHaveBeenCalled()
    expect(track.stop).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Stop camera" })).toBeInTheDocument()
  })
})
