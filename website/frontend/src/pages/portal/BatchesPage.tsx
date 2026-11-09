import { useQuery } from "@tanstack/react-query"
import { Boxes, CloudOff, PackagePlus } from "lucide-react"
import { useState } from "react"
import { useSearchParams } from "react-router"
import { EmptyState } from "@/components/common/EmptyState"
import { PageHeader } from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { getModule } from "@/config/portal-modules"
import { useAuth } from "@/features/auth/auth-context"
import { hasRole } from "@/features/auth/roles"
import { batchesQuery, PAGE_SIZE, storageAreasQuery, type Batch, type BatchStatus } from "@/features/inventory/api"
import { BatchDetailSheet } from "@/features/inventory/BatchDetailSheet"
import { ReceiveSheet } from "@/features/inventory/ReceiveSheet"
import { STOCK_MANAGER_ROLES } from "@/features/inventory/roles"
import { failureMessage, formatQty, STATUS_LABELS, useDebounced } from "@/features/inventory/format"
import { BatchStatusBadge, Notice, Pager } from "@/features/inventory/ui"
import { formatCode } from "@/features/qr/batch-label"
import { formatCalendarDate } from "@/features/qr/dates"

export default function BatchesPage() {
  const module = getModule("batches")
  const { isPreview } = useAuth()

  return (
    <div className="space-y-6">
      <PageHeader title={module.title} description={module.summary} />
      {isPreview ? (
        <EmptyState
          icon={Boxes}
          title="Needs a real sign-in"
          description="The development preview has no account, so the server won't share batches."
        />
      ) : (
        <BatchList />
      )}
    </div>
  )
}

function BatchList() {
  const { user } = useAuth()
  const canManage = hasRole(user, STOCK_MANAGER_ROLES)
  // `?batch=<id>` opens a batch (the scanner links here); `?ingredient=<id>` filters to one ingredient.
  const [params, setParams] = useSearchParams()
  const openId = params.get("batch")
  const ingredientId = params.get("ingredient") ?? undefined
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<BatchStatus | "">("")
  const [areaId, setAreaId] = useState("")
  const [hideUsedUp, setHideUsedUp] = useState(true)
  const [offset, setOffset] = useState(0)
  const [receiving, setReceiving] = useState(false)
  const [message, setMessage] = useState("")
  const q = useDebounced(search.trim())
  const areas = useQuery(storageAreasQuery)
  // Choosing the "Used up" status overrides hiding used-up batches.
  const hasStock = status === "depleted" ? undefined : hideUsedUp ? true : undefined
  const query = useQuery(
    batchesQuery({ q: q || undefined, status, storageAreaId: areaId || undefined, ingredientId, hasStock, offset }),
  )

  const reset = () => setOffset(0)
  const setOpen = (id: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (id) next.set("batch", id)
        else next.delete("batch")
        return next
      },
      { replace: true },
    )

  return (
    <>
      {message && <Notice tone="success">{message}</Notice>}

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-64">
          <label htmlFor="batch-search" className="sr-only">
            Search batches
          </label>
          <Input
            id="batch-search"
            type="search"
            placeholder="Ingredient or batch code"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              reset()
            }}
            autoComplete="off"
          />
        </div>
        <div className="w-full min-[420px]:w-auto min-[420px]:min-w-40">
          <label htmlFor="batch-status" className="sr-only">
            Status
          </label>
          <NativeSelect
            id="batch-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as BatchStatus | "")
              reset()
            }}
          >
            <option value="">Any status</option>
            {(Object.keys(STATUS_LABELS) as BatchStatus[]).map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="w-full min-[420px]:w-auto min-[420px]:min-w-44">
          <label htmlFor="batch-area" className="sr-only">
            Storage area
          </label>
          <NativeSelect
            id="batch-area"
            value={areaId}
            onChange={(event) => {
              setAreaId(event.target.value)
              reset()
            }}
          >
            <option value="">Any storage area</option>
            {(areas.data?.items ?? []).map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hideUsedUp}
            onChange={(event) => {
              setHideUsedUp(event.target.checked)
              reset()
            }}
            className="size-4 accent-primary"
          />
          Hide used up
        </label>
        {canManage && (
          <Button className="sm:ml-auto" onClick={() => setReceiving(true)}>
            <PackagePlus aria-hidden />
            Receive stock
          </Button>
        )}
      </div>

      {ingredientId && (
        <p className="text-sm text-muted-foreground">
          Showing one ingredient.{" "}
          <Button
            variant="link"
            className="h-auto p-0"
            onClick={() =>
              setParams((current) => {
                const next = new URLSearchParams(current)
                next.delete("ingredient")
                return next
              })
            }
          >
            Show all
          </Button>
        </p>
      )}

      {query.isPending ? (
        <p className="text-sm text-muted-foreground">Loading batches…</p>
      ) : query.isError ? (
        <EmptyState icon={CloudOff} title="Batches couldn't be loaded" description={failureMessage(query.error, "Try again.")}>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </EmptyState>
      ) : query.data.items.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No batches to show"
          description={
            q || status || areaId || ingredientId
              ? "No batch matches these filters."
              : canManage
                ? "Receive stock to create the first batch. Each batch gets its own QR label."
                : "Batches appear here once stock has been received."
          }
        />
      ) : (
        <>
          <BatchTable items={query.data.items} onOpen={setOpen} />
          <Pager total={query.data.total} offset={offset} limit={PAGE_SIZE} onOffset={setOffset} />
        </>
      )}

      <BatchDetailSheet batchId={openId} onOpenChange={(open) => !open && setOpen(null)} canManage={canManage} />
      <ReceiveSheet
        open={receiving}
        onOpenChange={setReceiving}
        onReceived={(batch) => {
          setMessage(`Received ${formatQty(batch.quantity)} ${batch.ingredient.unit} of ${batch.ingredient.name}.`)
          setOpen(batch.id)
        }}
      />
    </>
  )
}

function BatchTable({ items, onOpen }: { items: Batch[]; onOpen: (id: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <caption className="sr-only">Batches, earliest use-by date first</caption>
        <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Ingredient
            </th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">
              Batch
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Left
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Use by
            </th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">
              Stored in
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((batch) => (
            <tr key={batch.id}>
              <th scope="row" className="px-4 py-3 text-left font-medium">
                <button
                  type="button"
                  onClick={() => onOpen(batch.id)}
                  className="min-h-9 text-left underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                  aria-label={`Open ${batch.ingredient.name}, batch ${formatCode(batch.label_code)}`}
                >
                  {batch.ingredient.name}
                </button>
              </th>
              <td className="hidden px-4 py-3 font-mono text-xs md:table-cell">{formatCode(batch.label_code)}</td>
              <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                {formatQty(batch.remaining_quantity)} {batch.ingredient.unit}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">{formatCalendarDate(batch.expiry_on)}</td>
              <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">{batch.storage_area?.name ?? "Not recorded"}</td>
              <td className="px-4 py-3">
                <BatchStatusBadge status={batch.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
