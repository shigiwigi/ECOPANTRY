import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { QUIET_ZONE_MODULES, qrMatrix } from "./qr-matrix"

interface QrCodeProps {
  value: string
  /** Accessible name; the QR text itself isn't meaningful to read out. */
  label: string
  className?: string
}

/**
 * QR code as crisp vector shapes, dark on light whatever the theme, with the
 * quiet zone built in. Size it with CSS (`className`): it scales cleanly to
 * screen and print. The colours come from the label tokens, which stay black on
 * white in both themes because inverted or low-contrast codes scan badly.
 */
export function QrCode({ value, label, className }: QrCodeProps) {
  const { size, path } = useMemo(() => qrMatrix(value), [value])
  const full = size + QUIET_ZONE_MODULES * 2

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${-QUIET_ZONE_MODULES} ${-QUIET_ZONE_MODULES} ${full} ${full}`}
      shapeRendering="crispEdges"
      className={cn("block bg-label-paper", className)}
    >
      <rect x={-QUIET_ZONE_MODULES} y={-QUIET_ZONE_MODULES} width={full} height={full} className="fill-label-paper" />
      <path d={path} className="fill-label-ink" />
    </svg>
  )
}
