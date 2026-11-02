/**
 * Camera access for the QR scanner, using only standard browser APIs
 * (`navigator.mediaDevices.getUserMedia` and `enumerateDevices`).
 *
 * Browsers only allow the camera in a secure context: HTTPS, or
 * http://localhost during development. A phone opening the dev server by its
 * LAN address (http://192.168.x.x) is not secure, and most browsers then hide
 * `navigator.mediaDevices` altogether. See the frontend README for HTTPS
 * during development.
 *
 * Camera permission says nothing about EcoPantry permissions: what a scanned
 * code may show is decided by the backend for the signed-in account.
 */

export type CameraProblemKind =
  | "insecure"
  | "unsupported"
  | "blocked"
  | "dismissed"
  | "denied"
  | "not-found"
  | "busy"
  | "disconnected"
  | "failed"

export interface CameraProblem {
  kind: CameraProblemKind
  title: string
  message: string
  /** False when trying again can't help until something outside the page changes. */
  canRetry: boolean
}

export const CAMERA_PROBLEMS: Record<CameraProblemKind, CameraProblem> = {
  insecure: {
    kind: "insecure",
    title: "The camera needs a secure connection",
    message:
      "Browsers only allow the camera on HTTPS pages (or on localhost during development). Open the portal over HTTPS, or enter the code below.",
    canRetry: false,
  },
  unsupported: {
    kind: "unsupported",
    title: "This browser can't use the camera here",
    message: "Camera access isn't available in this browser or in-app view. Try an up-to-date browser, or enter the code below.",
    canRetry: false,
  },
  blocked: {
    kind: "blocked",
    title: "Camera access is blocked for this site",
    message:
      "Allow the camera in your browser's site settings (usually the icon next to the address), then press Start camera again. You can also enter the code below.",
    canRetry: true,
  },
  dismissed: {
    kind: "dismissed",
    title: "Camera permission wasn't given",
    message: "The permission request closed without an answer. Press Start camera to be asked again, or enter the code below.",
    canRetry: true,
  },
  denied: {
    kind: "denied",
    title: "Camera permission wasn't given",
    message:
      "If you chose Block or Don't allow, change it in your browser's site settings (on iPhone and iPad: Settings > Safari > Camera), then try again. You can also enter the code below.",
    canRetry: true,
  },
  "not-found": {
    kind: "not-found",
    title: "No camera found",
    message: "This device doesn't seem to have a camera the browser can use. Connect one and try again, or enter the code below.",
    canRetry: true,
  },
  busy: {
    kind: "busy",
    title: "The camera is busy",
    message:
      "Another app or browser tab may be using it, or the system blocked it. Close the other app, then try again. You can also enter the code below.",
    canRetry: true,
  },
  disconnected: {
    kind: "disconnected",
    title: "The camera stopped",
    message: "The camera was disconnected or taken over by another app. Press Start camera to try again.",
    canRetry: true,
  },
  failed: {
    kind: "failed",
    title: "The camera couldn't start",
    message: "Something went wrong while starting the camera. Try again, pick another camera, or enter the code below.",
    canRetry: true,
  },
}

/** Whether this page may ask for the camera at all. Check before showing a Start button. */
export function cameraSupport(): "ok" | "insecure" | "unsupported" {
  if (typeof window === "undefined") return "unsupported"
  if (!window.isSecureContext) return "insecure"
  if (typeof navigator.mediaDevices?.getUserMedia !== "function") return "unsupported"
  return "ok"
}

/**
 * The camera permission state where the browser can tell us (Chrome, Edge,
 * Firefox and recent Safari). Null when it can't: callers must cope.
 */
export async function cameraPermissionState(): Promise<PermissionState | null> {
  try {
    if (!navigator.permissions?.query) return null
    const status = await navigator.permissions.query({ name: "camera" as PermissionName })
    return status.state
  } catch {
    return null
  }
}

function errorName(error: unknown): string {
  if (error && typeof error === "object" && "name" in error && typeof error.name === "string") return error.name
  return ""
}

/** Turns a getUserMedia failure into something a person can act on. */
export async function describeCameraError(error: unknown): Promise<CameraProblem> {
  switch (errorName(error)) {
    case "NotAllowedError":
    case "PermissionDeniedError": {
      // Browsers report "blocked", "denied this time" and "closed the prompt" with the same
      // error. The Permissions API, where it exists, tells them apart.
      const state = await cameraPermissionState()
      if (state === "denied") return CAMERA_PROBLEMS.blocked
      if (state === "prompt") return CAMERA_PROBLEMS.dismissed
      return CAMERA_PROBLEMS.denied
    }
    case "SecurityError":
      return window.isSecureContext ? CAMERA_PROBLEMS.blocked : CAMERA_PROBLEMS.insecure
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return CAMERA_PROBLEMS["not-found"]
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return CAMERA_PROBLEMS.busy
    default:
      // Some browsers refuse with a less specific error (headless Chromium, for one, says
      // NotSupportedError). If the permission is blocked, that is still the useful answer.
      return (await cameraPermissionState()) === "denied" ? CAMERA_PROBLEMS.blocked : CAMERA_PROBLEMS.failed
  }
}

/** True for errors that mean "that particular camera is gone", where the default camera may still work. */
export function isMissingDeviceError(error: unknown): boolean {
  return ["NotFoundError", "OverconstrainedError", "DevicesNotFoundError", "ConstraintNotSatisfiedError"].includes(
    errorName(error),
  )
}

/**
 * Video constraints: a chosen camera exactly, otherwise prefer the rear
 * ("environment") camera. `ideal` rather than `exact`, so laptops with only a
 * front camera still work. 720p is plenty for a label and keeps decoding fast.
 */
export function videoConstraints(deviceId: string | null): MediaTrackConstraints {
  const size = { width: { ideal: 1280 }, height: { ideal: 720 } }
  return deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: { ideal: "environment" }, ...size }
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => track.stop())
}

export interface CameraOption {
  deviceId: string
  label: string
}

/**
 * Cameras the browser will name. Before permission is granted, browsers hide
 * labels and sometimes the devices themselves, so call this after the stream
 * starts. Unnamed cameras get a numbered name.
 */
export async function listCameras(): Promise<CameraOption[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((device) => device.kind === "videoinput" && device.deviceId)
      .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Camera ${index + 1}` }))
  } catch {
    return []
  }
}
