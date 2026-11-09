import { ChevronLeft, ChevronRight } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { PAGE_SIZE, type Page } from "./api"

/** A labelled form control with hint and error wired up for assistive technology. */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

/** "Showing 1-20 of 42" with Previous / Next. Offsets are multiples of PAGE_SIZE. */
export function Pager({ page, onOffset }: { page: Page<unknown>; onOffset: (offset: number) => void }) {
  if (page.total <= PAGE_SIZE) return null
  const first = page.offset + 1
  const last = Math.min(page.offset + page.items.length, page.total)
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground" role="status">
        Showing {first}–{last} of {page.total}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page.offset === 0} onClick={() => onOffset(Math.max(0, page.offset - PAGE_SIZE))}>
          <ChevronLeft aria-hidden />
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={last >= page.total} onClick={() => onOffset(page.offset + PAGE_SIZE)}>
          Next
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </nav>
  )
}

export function TableShell({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  )
}
