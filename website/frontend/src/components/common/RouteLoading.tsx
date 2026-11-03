/** Shown while a lazily loaded route's code downloads on first visit. */
export function RouteLoading() {
  return (
    <div role="status" aria-live="polite" className="grid min-h-dvh place-items-center">
      <span className="sr-only">Loading…</span>
      <span aria-hidden className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  )
}
