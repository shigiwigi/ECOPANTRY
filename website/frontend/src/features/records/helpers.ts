import { ApiError } from "@/lib/api/client"

export function problemText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.isUnreachable) return "Can't reach the EcoPantry server."
  if (error instanceof ApiError) return error.message
  return fallback
}

export function fieldProps(id: string, error: string | undefined, hint?: string) {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  }
}

export const TH = "px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
export const TD = "px-3 py-2 align-top"
