import jsQR from "jsqr"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  CAMERA_PROBLEMS,
  cameraSupport,
  describeCameraError,
  isMissingDeviceError,
  listCameras,
  stopStream,
  videoConstraints,
  type CameraOption,
  type CameraProblem,
} from "./camera"

export type ScannerStatus = "idle" | "starting" | "scanning" | "error"

/** How often a frame is decoded. Fast enough to feel instant, light enough for older phones. */
const SCAN_INTERVAL_MS = 150
/** Frames are scaled down to this longest side before decoding; a label fills plenty of it. */
const MAX_DECODE_SIZE = 800
/** The same text seen again within this window is the same label still in view, not a new scan. */
const REPEAT_WINDOW_MS = 3000

interface Options {
  /**
   * Called once per newly seen QR text. Return true when the text is what you were
   * looking for: the camera then stops at once, so the same label can't be processed twice.
   */
  onDetected: (text: string) => boolean
}

/**
 * Camera + QR decoding for the scanner page.
 *
 * The camera starts only from `start()`, which must be called from a user
 * action. Every camera track is stopped by `stop()`, when the component
 * unmounts (including navigating away), when the tab is hidden or the page is
 * left, and when the camera is unplugged, so the browser's camera indicator
 * never stays on in the background.
 *
 * Decoding uses jsQR on canvas frames, which behaves the same in every
 * browser, rather than the native BarcodeDetector, which most desktop
 * browsers and Firefox don't have.
 */
export function useQrScanner({ onDetected }: Options) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<ScannerStatus>("idle")
  const [problem, setProblem] = useState<CameraProblem | null>(null)
  const [cameras, setCameras] = useState<CameraOption[]>([])
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [mirrored, setMirrored] = useState(false)
  const [stoppedBecauseHidden, setStoppedBecauseHidden] = useState(false)

  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastSeenRef = useRef<{ text: string; at: number } | null>(null)
  // Each start/stop gets a new number. Async steps that finish after a newer start or
  // a stop see a different number and clean up after themselves instead of carrying on.
  const runRef = useRef(0)
  const onDetectedRef = useRef(onDetected)
  useEffect(() => {
    onDetectedRef.current = onDetected
  })

  /** Stops the camera and the decode loop. Doesn't touch React state, so it's safe during unmount. */
  const release = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    stopStream(streamRef.current)
    streamRef.current = null
    const video = videoRef.current
    if (video) {
      video.pause()
      video.srcObject = null
    }
  }, [])

  const stop = useCallback(() => {
    runRef.current++
    release()
    setStatus("idle")
  }, [release])

  /** Decodes a frame every SCAN_INTERVAL_MS until the run ends. */
  const startDecoding = useCallback(
    (run: number) => {
      const tick = () => {
        if (run !== runRef.current) return
        const text = decodeFrame(videoRef.current, (canvasRef.current ??= document.createElement("canvas")))
        if (text) {
          const now = Date.now()
          const last = lastSeenRef.current
          const isNew = !last || last.text !== text || now - last.at > REPEAT_WINDOW_MS
          lastSeenRef.current = { text, at: now }
          if (isNew && onDetectedRef.current(text)) {
            runRef.current++
            release()
            setStatus("idle")
            return
          }
        }
        if (run !== runRef.current) return
        timerRef.current = window.setTimeout(tick, SCAN_INTERVAL_MS)
      }
      tick()
    },
    [release],
  )

  const start = useCallback(
    async (requestedId: string | null = null) => {
      const run = ++runRef.current
      release()
      setProblem(null)
      setStoppedBecauseHidden(false)
      lastSeenRef.current = null

      const support = cameraSupport()
      if (support !== "ok") {
        setProblem(CAMERA_PROBLEMS[support])
        setStatus("error")
        return
      }

      setStatus("starting")
      let stream: MediaStream
      try {
        stream = await openCamera(requestedId)
      } catch (error) {
        if (run !== runRef.current) return
        const described = await describeCameraError(error)
        if (run !== runRef.current) return
        setProblem(described)
        setStatus("error")
        return
      }

      // Stopped, restarted or unmounted while the permission prompt was open.
      if (run !== runRef.current || !videoRef.current) {
        stopStream(stream)
        return
      }
      streamRef.current = stream
      const [track] = stream.getVideoTracks()
      track?.addEventListener("ended", () => {
        if (run !== runRef.current) return
        runRef.current++
        release()
        setProblem(CAMERA_PROBLEMS.disconnected)
        setStatus("error")
      })

      const video = videoRef.current
      video.srcObject = stream
      try {
        await video.play()
      } catch {
        // play() is interrupted when the stream is stopped meanwhile; that isn't a failure.
        if (run !== runRef.current) return
        release()
        setProblem(CAMERA_PROBLEMS.failed)
        setStatus("error")
        return
      }
      if (run !== runRef.current) return

      const settings = track?.getSettings() ?? {}
      setDeviceId(settings.deviceId ?? requestedId)
      // Mirror the front camera like a mirror; decoding uses the raw frames either way.
      setMirrored(settings.facingMode === "user")
      setStatus("scanning")
      startDecoding(run)

      // Names are only available once permission is granted.
      const found = await listCameras()
      if (run === runRef.current) setCameras(found)
    },
    [release, startDecoding],
  )

  // Leaving the page (navigation, unmount) always turns the camera off.
  useEffect(
    () => () => {
      runRef.current++
      release()
    },
    [release],
  )

  // A hidden tab or a left page has no use for the camera.
  useEffect(() => {
    const pause = () => {
      if (!streamRef.current) return
      runRef.current++
      release()
      setStatus("idle")
      setStoppedBecauseHidden(true)
    }
    const onVisibility = () => {
      if (document.visibilityState === "hidden") pause()
    }
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("pagehide", pause)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("pagehide", pause)
    }
  }, [release])

  // Keep the camera list current when cameras are plugged in or out.
  useEffect(() => {
    const devices = navigator.mediaDevices
    if (!devices?.addEventListener || cameras.length === 0) return
    const refresh = () => void listCameras().then(setCameras)
    devices.addEventListener("devicechange", refresh)
    return () => devices.removeEventListener("devicechange", refresh)
  }, [cameras.length])

  return {
    videoRef,
    status,
    problem,
    cameras,
    deviceId,
    mirrored,
    stoppedBecauseHidden,
    start,
    stop,
  }
}

/**
 * Opens the chosen camera, or the default (rear-preferred) one. If the chosen
 * camera has gone (unplugged, or an id from an earlier visit), falls back to
 * the default. getUserMedia is the first thing awaited, so it still counts as
 * part of the user's click in browsers that care.
 */
async function openCamera(deviceId: string | null): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ video: videoConstraints(deviceId), audio: false })
  } catch (error) {
    if (!deviceId || !isMissingDeviceError(error)) throw error
    return navigator.mediaDevices.getUserMedia({ video: videoConstraints(null), audio: false })
  }
}

/** Reads a QR code from the video's current frame, if it has one. */
function decodeFrame(video: HTMLVideoElement | null, canvas: HTMLCanvasElement): string | null {
  if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) return null
  const scale = Math.min(1, MAX_DECODE_SIZE / Math.max(video.videoWidth, video.videoHeight))
  const width = Math.round(video.videoWidth * scale)
  const height = Math.round(video.videoHeight * scale)
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) return null
  context.drawImage(video, 0, 0, width, height)
  const { data } = context.getImageData(0, 0, width, height)
  // Labels are dark on light, so skip the inverted pass and halve the work.
  return jsQR(data, width, height, { inversionAttempts: "dontInvert" })?.data || null
}
