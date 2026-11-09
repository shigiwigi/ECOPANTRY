import { ChevronLeft, ChevronRight } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { BatchStatus } from "./api"
import { STATUS_LABELS } from "./format"

const STATUS_CLASS: Record<BatchStatus, string> = {
  available: "border-success/40 bg-success/10 text-success",
  near_expiry: "border-warning/40 bg-warning/10 text-warning",
  expired: "border-destructive/40 bg-destructive/10 text-destructive",
  depleted: "border-border bg-muted text-muted-foreground",
}

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  return (
    <span className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", STATUS_CLASS[status])}>
      {STATUS_LABELS[status]}
    </span>
  )
}

export function Notice({ children, tone = "danger" }: { children: ReactNode; tone?: "danger" | "success" }) {
  return (
    <p
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        tone === "danger" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-success/40 bg-success/10",
      )}
    >
      {children}
    </p>
  )
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  errorId,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  error?: string
  errorId?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export function Pager({
  total,
  offset,
  limit,
  onOffset,
}: {
  total: number
  offset: number
  limit: number
  onOffset: (offset: number) => void
}) {
  if (total <= limit) return null
  const last = Math.min(offset + limit, total)
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground">
        {offset + 1}–{last} of {total}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - limit))}>
          <ChevronLeft aria-hidden />
          Previous
        </Button>
        <Button variant="outline" disabled={last >= total} onClick={() => onOffset(offset + limit)}>
          Next
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </nav>
  )
}

