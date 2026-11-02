import { Camera, CameraOff, LoaderCircle, ScanLine, Square } from "lucide-react"
import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { cn } from "@/lib/utils"
import { readScannedLabel } from "./batch-label"
import { useQrScanner } from "./useQrScanner"

const SCAN_NOTICES = {
  "not-ecopantry": "That QR code isn't an EcoPantry batch label. Point the camera at a batch label, or enter the code below.",
  empty: "That QR code isn't an EcoPantry batch label. Point the camera at a batch label, or enter the code below.",
  malformed:
    "That looks like an EcoPantry label, but its code is damaged or incomplete. Try again, or type the code printed on the label.",
} as const

interface QrScannerProps {
  /** Called with a valid batch code. The camera has already stopped by then. */
  onCode: (code: string) => void
  /** True once something has been read, so the start button offers to scan another. */
  hasResult: boolean
}

/** Camera panel of the scanner page: start/stop, camera choice, permission and error states. */
export function QrScanner({ onCode, hasResult }: QrScannerProps) {
  const id = useId()
  const [notice, setNotice] = useState<string | null>(null)
  const scanner = useQrScanner({
    onDetected: (text) => {
      const result = readScannedLabel(text)
      if (!result.ok) {
        setNotice(SCAN_NOTICES[result.reason])
        return false
      }
      setNotice(null)
      onCode(result.code)
      return true
    },
  })
  const { videoRef, status, problem, cameras, deviceId, mirrored, stoppedBecauseHidden } = scanner
  const live = status === "scanning" || status === "starting"

  const start = (cameraId: string | null = null) => {
    setNotice(null)
    void scanner.start(cameraId)
  }

  const statusText =
    status === "starting"
      ? "Starting the camera…"
      : status === "scanning"
        ? "Scanning. Hold the label's QR code inside the frame."
        : status === "error"
          ? "Camera off."
          : stoppedBecauseHidden
            ? "The camera turned off while this tab was in the background."
            : "Camera off."

  return (
    <section aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card">
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-2">
        <h2 id={`${id}-title`} className="text-sm font-semibold">
          Camera
        </h2>
        {cameras.length > 1 && (
          <div className="flex min-w-0 items-center gap-2">
            <label htmlFor={`${id}-camera`} className="shrink-0 text-sm text-muted-foreground">
              Use
            </label>
            <NativeSelect
              id={`${id}-camera`}
              value={deviceId ?? ""}
              onChange={(event) => start(event.target.value || null)}
              className="h-10 w-auto max-w-[min(16rem,60vw)] truncate sm:h-9"
            >
              {deviceId === null && <option value="">Default camera</option>}
              {cameras.map((camera) => (
                <option key={camera.deviceId} value={camera.deviceId}>
                  {camera.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </div>

      <div className="relative aspect-square max-h-[min(70dvh,34rem)] w-full overflow-hidden bg-muted sm:aspect-[4/3] lg:aspect-video xl:aspect-[4/3]">
        {/* Always rendered so the stream has somewhere to go; hidden until it plays. */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          aria-hidden
          className={cn(
            "absolute inset-0 size-full object-cover",
            status !== "scanning" && "invisible",
            mirrored && "-scale-x-100",
          )}
        />

        {status === "scanning" && <ScanFrame />}

        {status !== "scanning" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto p-5 text-center">
            {status === "starting" && (
              <>
                <LoaderCircle className="size-6 animate-spin text-muted-foreground" aria-hidden />
                <p className="font-medium">Waiting for the camera</p>
                <p className="max-w-sm text-sm text-muted-foreground">If your browser asks, allow camera access for this site.</p>
              </>
            )}

            {status === "error" && problem && (
              <div role="alert" className="flex flex-col items-center gap-2">
                <CameraOff className="size-6 text-destructive" aria-hidden />
                <p className="font-medium">{problem.title}</p>
                <p className="max-w-md text-sm text-muted-foreground">{problem.message}</p>
                {problem.canRetry && (
                  <Button onClick={() => start(null)} className="mt-1 h-11 px-4 sm:h-9">
                    <Camera aria-hidden />
                    Try again
                  </Button>
                )}
              </div>
            )}

            {status === "idle" && (
              <>
                <ScanLine className="size-6 text-muted-foreground" aria-hidden />
                <p className="font-medium">{hasResult ? "Ready for the next label" : "Scan a batch label"}</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  The camera turns on when you press Start and off when you stop, scan a label or leave this page.
                </p>
                <Button onClick={() => start(deviceId)} className="mt-1 h-11 px-4 sm:h-9">
                  <Camera aria-hidden />
                  {hasResult ? "Scan another label" : "Start camera"}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-4 py-2">
        <p
          role="status"
          className={cn(
            "min-w-[min(100%,16rem)] flex-1 text-sm",
            notice ? "rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-foreground" : "text-muted-foreground",
          )}
        >
          {notice ?? statusText}
        </p>
        {live && (
          <Button variant="outline" onClick={scanner.stop} className="h-11 px-4 sm:h-9">
            <Square aria-hidden />
            Stop camera
          </Button>
        )}
      </div>
    </section>
  )
}

/** Corner marks showing where to hold the label. Decorative: the whole frame is decoded. */
function ScanFrame() {
  const corner = "absolute size-8 border-label-paper drop-shadow-[0_0_1px_var(--label-ink)]"
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="relative aspect-square w-3/5 max-w-72">
        <span className={cn(corner, "top-0 left-0 rounded-tl-md border-t-[3px] border-l-[3px]")} />
        <span className={cn(corner, "top-0 right-0 rounded-tr-md border-t-[3px] border-r-[3px]")} />
        <span className={cn(corner, "bottom-0 left-0 rounded-bl-md border-b-[3px] border-l-[3px]")} />
        <span className={cn(corner, "right-0 bottom-0 rounded-br-md border-r-[3px] border-b-[3px]")} />
      </div>
    </div>
  )
}
