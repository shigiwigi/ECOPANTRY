import { useEffect, useState } from "react"
import { ApiError } from "@/lib/api/client"
import type { BatchStatus } from "./api"

/** "12.500" -> "12.5", "10.000" -> "10". */
export function formatQty(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value
}

export function formatSigned(value: string): string {
  const text = formatQty(value)
  return text.startsWith("-") ? `−${text.slice(1)}` : `+${text}`
}

export function failureMessage(error: unknown, action: string): string {
  if (error instanceof ApiError && error.isUnreachable) return `Can't reach the EcoPantry server. ${action}`
  if (error instanceof ApiError) return error.message
  return `Something went wrong. ${action}`
}

export const STATUS_LABELS: Record<BatchStatus, string> = {
  available: "Available",
  near_expiry: "Near expiry",
  expired: "Expired",
  depleted: "Used up",
}

/** Value that follows `value` after the user stops typing, so searches don't fire per keystroke. */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(handle)
  }, [value, delay])
  return debounced
}
