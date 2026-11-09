import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { CalendarClock, CloudOff, Search } from "lucide-react"
import { useId, useState } from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { PageHeader } from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getModule } from "@/config/portal-modules"
import { useAuth } from "@/features/auth/auth-context"
import {
  PAGE_SIZE,
  WINDOWS,
  daysLeftLabel,
  formatQuantity,
  listQuery,
  summaryQuery,
  type ExpiryBatch,
  type ExpiryView,
  type ExpiryWindow,
} from "@/features/expiry/api"
import { FefoPanel } from "@/features/expiry/FefoPanel"
import { ApiError } from "@/lib/api/client"
import { cn } from "@/lib/utils"

function loadError(error: unknown): string {
  if (error instanceof ApiError && error.isUnreachable) return "Can't reach the EcoPantry server."
  if (error instanceof ApiError) return error.message
  return "The expiry list couldn't be loaded."
}

export default function ExpiryPage() {
  const module = getModule("expiry")
  const { isPreview } = useAuth()

  return (
    <div className="space-y-6">
      <PageHeader title={module.title} description={module.summary} />
      {isPreview ? (
        <EmptyState
          icon={CloudOff}
          title="Needs a real sign-in"
          description="The development preview has no account, so the server won't share stock or expiry data."
        />
      ) : (
        <ExpiryManager />
      )}
    </div>
  )
}

function ExpiryManager() {
  const [view, setView] = useState<ExpiryView>("near")
  const [days, setDays] = useState<ExpiryWindow>(7)
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const searchId = useId()
  const windowId = useId()
  const summary = useQuery(summaryQuery(days))
  const list = useQuery({ ...listQuery(view, days, search.trim(), offset), placeholderData: keepPreviousData })

  const choose = (next: ExpiryView) => {
    setView(next)
    setOffset(0)
  }

  return (
    <>
      <section aria-label="Summary" className="grid gap-3 sm:grid-cols-2">
        <Tile
          label={`Near expiry (within ${days} days)`}
          value={summary.data?.near_expiry}
          tone="warning"
          active={view === "near"}
          onSelect={() => choose("near")}
        />
        <Tile
          label="Expired, still in stock"
          value={summary.data?.expired}
          tone="danger"
          active={view === "expired"}
          onSelect={() => choose("expired")}
        />
      </section>
      {summary.isError && (
        <p role="alert" className="text-sm text-destructive">
          {loadError(summary.error)}
        </p>
      )}

      <section aria-label="Batches" className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div role="tablist" aria-label="Expiry list" className="inline-flex rounded-lg border bg-card p-0.5">
            {(["near", "expired"] as const).map((key) => (
              <button
                key={key}
                role="tab"
                type="button"
                aria-selected={view === key}
                onClick={() => choose(key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  view === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {key === "near" ? "Near expiry" : "Expired"}
              </button>
            ))}
          </div>

          {view === "near" && (
            <div role="group" aria-labelledby={windowId} className="flex items-center gap-2">
              <span id={windowId} className="text-sm text-muted-foreground">
                Window
              </span>
              <div className="inline-flex rounded-lg border bg-card p-0.5">
                {WINDOWS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={days === value}
                    onClick={() => {
                      setDays(value)
                      setOffset(0)
                    }}
                    className={cn(
                      "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      days === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {value} days
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="relative min-w-48 flex-1 sm:max-w-xs">
            <Label htmlFor={searchId} className="sr-only">
              Search ingredient or label code
            </Label>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={searchId}
              type="search"
              className="pl-8"
              placeholder="Search ingredient or label"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setOffset(0)
              }}
            />
          </div>
        </div>

        {list.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading batches…
          </p>
        ) : list.isError ? (
          <EmptyState icon={CloudOff} title="Couldn't load the list" description={loadError(list.error)}>
            <Button variant="outline" onClick={() => list.refetch()}>
              Try again
            </Button>
          </EmptyState>
        ) : list.data.items.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title={
              search
                ? "No matching batches"
                : view === "near"
                  ? `Nothing expires in the next ${days} days`
                  : "No expired stock"
            }
            description={
              search
                ? "Try a different ingredient name or label code."
                : view === "near"
                  ? "Batches with stock that expire today or within the window appear here."
                  : "Batches with stock left past their expiry date appear here."
            }
          />
        ) : (
          <>
            <BatchTable items={list.data.items} />
            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>
                {list.data.offset + 1}–{list.data.offset + list.data.items.length} of {list.data.total}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                  Previous
                </Button>
                <Button
                  variant="outline"
                  disabled={offset + PAGE_SIZE >= list.data.total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </section>

      <FefoPanel />
    </>
  )
}

function Tile({
  label,
  value,
  tone,
  active,
  onSelect,
}: {
  label: string
  value: number | undefined
  tone: "warning" | "danger"
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "rounded-lg border bg-card p-4 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        active && "border-primary",
      )}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-3xl font-semibold tabular-nums",
          value ? (tone === "warning" ? "text-warning" : "text-destructive") : "text-foreground",
        )}
      >
        {value ?? "–"}
      </p>
    </button>
  )
}

function DaysBadge({ days }: { days: number }) {
  const expired = days < 0
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        expired ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning",
      )}
    >
      {expired ? "Expired " : ""}
      {daysLeftLabel(days)}
    </span>
  )
}

function BatchTable({ items }: { items: ExpiryBatch[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[40rem] text-sm">
        <caption className="sr-only">Batches with stock, by expiry date</caption>
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Ingredient</th>
            <th scope="col" className="px-3 py-2 font-medium">Label</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Remaining</th>
            <th scope="col" className="px-3 py-2 font-medium">Expires</th>
            <th scope="col" className="px-3 py-2 font-medium">Days left</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((batch) => (
            <tr key={batch.id}>
              <th scope="row" className="px-3 py-2 text-left font-medium">
                {batch.ingredient.name}
                {batch.storage_area && <span className="block text-xs font-normal text-muted-foreground">{batch.storage_area.name}</span>}
              </th>
              <td className="px-3 py-2 font-mono">{batch.label_code}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatQuantity(batch.remaining_quantity)} {batch.ingredient.unit}
              </td>
              <td className="px-3 py-2 tabular-nums">{batch.expiry_on}</td>
              <td className="px-3 py-2">
                <DaysBadge days={batch.days_left} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
