import { useQuery } from "@tanstack/react-query"
import { CloudOff, Plus, Printer, Trash2, X } from "lucide-react"
import { useId, useRef, useState } from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { PageHeader } from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { getModule } from "@/config/portal-modules"
import { batchesQuery, type Batch } from "@/features/inventory/api"
import { failureMessage } from "@/features/inventory/format"
import { formatCode } from "@/features/qr/batch-label"
import { formatCalendarDate } from "@/features/qr/dates"
import { BatchLabel, PrintSheet, type LabelData } from "@/features/qr/LabelSheet"
import { MAX_COPIES, MAX_LABELS } from "@/features/qr/schemas"

interface Entry extends LabelData {
  id: number
  copies: number
}

export default function LabelsPage() {
  const module = getModule("qr")
  const [entries, setEntries] = useState<Entry[]>([])
  const [guides, setGuides] = useState(true)
  const nextId = useRef(1)

  const labels: LabelData[] = entries.flatMap((entry) => Array.from({ length: entry.copies }, () => entry))
  const total = labels.length

  return (
    <div className="space-y-6">
      <PageHeader
        title={module.title}
        description={module.summary}
        actions={
          <Button onClick={() => window.print()} disabled={total === 0} className="h-11 px-4 sm:h-9">
            <Printer aria-hidden />
            Print {total > 0 ? `${total} label${total === 1 ? "" : "s"}` : "labels"}
          </Button>
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)]">
        <BatchPicker
          remaining={MAX_LABELS - total}
          onAdd={(batch, copies) =>
            setEntries((current) => [
              ...current,
              {
                id: nextId.current++,
                code: batch.label_code,
                ingredientName: batch.ingredient.name,
                expiresOn: batch.expiry_on,
                copies,
              },
            ])
          }
        />

        <section aria-labelledby="labels-preview" className="min-w-0 rounded-lg border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-2.5">
            <h2 id="labels-preview" className="text-sm font-semibold">
              Print preview
            </h2>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-9">
                <input
                  type="checkbox"
                  checked={guides}
                  onChange={(event) => setGuides(event.target.checked)}
                  className="size-4 accent-primary"
                />
                Cut guides
              </label>
              {entries.length > 0 && (
                <Button variant="ghost" onClick={() => setEntries([])} className="h-11 sm:h-9">
                  <Trash2 aria-hidden />
                  Clear all
                </Button>
              )}
            </div>
          </div>

          {entries.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Labels you add appear here, as they will print.</p>
          ) : (
            <>
              <ul className="divide-y border-b" aria-label="Labels to print">
                {entries.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{entry.ingredientName}</p>
                      <p className="text-muted-foreground">
                        <span className="font-mono">{formatCode(entry.code)}</span>
                        {entry.expiresOn && <> · use by {formatCalendarDate(entry.expiresOn)}</>}
                        {" · "}
                        {entry.copies} {entry.copies === 1 ? "copy" : "copies"}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 sm:size-9"
                      aria-label={`Remove ${entry.ingredientName} (${formatCode(entry.code)})`}
                      onClick={() => setEntries((current) => current.filter((candidate) => candidate.id !== entry.id))}
                    >
                      <X aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="overflow-x-auto bg-muted p-4">
                <div className="grid grid-cols-[repeat(auto-fill,63.5mm)] justify-center gap-[2.5mm] sm:justify-start">
                  {labels.map((label, index) => (
                    <BatchLabel key={index} label={label} guides={guides} />
                  ))}
                </div>
              </div>
            </>
          )}

          <p className="px-4 py-3 text-xs text-muted-foreground">
            Labels are 63.5 × 38.1 mm, the size of common 21-per-sheet A4 label paper. In the print dialog choose 100% (actual
            size) and default margins; on plain paper, cut along the guides. Check that a printed label scans before
            printing a batch of them.
          </p>
        </section>
      </div>

      <PrintSheet labels={labels} guides={guides} />
    </div>
  )
}

function BatchPicker({ remaining, onAdd }: { remaining: number; onAdd: (batch: Batch, copies: number) => void }) {
  const id = useId()
  // Batches that still have stock, earliest use-by first. Labels come from the batch record, never from typed values.
  const query = useQuery(batchesQuery({ hasStock: true, limit: 200 }))
  const [batchId, setBatchId] = useState("")
  const [copies, setCopies] = useState("1")
  const [problem, setProblem] = useState<string | null>(null)
  const batches = query.data?.items ?? []

  const add = () => {
    const batch = batches.find((candidate) => candidate.id === batchId)
    if (!batch) return setProblem("Choose a batch.")
    const count = Number(copies)
    if (!/^\d+$/.test(copies) || count < 1 || count > MAX_COPIES) return setProblem(`Copies: a whole number from 1 to ${MAX_COPIES}.`)
    if (count > remaining) {
      return setProblem(
        remaining > 0
          ? `Up to ${MAX_LABELS} labels per print. There's room for ${remaining} more.`
          : `That's ${MAX_LABELS} labels, the most per print. Print these first, then clear them.`,
      )
    }
    setProblem(null)
    onAdd(batch, count)
    setBatchId("")
    setCopies("1")
  }

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-lg border bg-card">
      <h2 id={`${id}-title`} className="border-b px-4 py-3 text-sm font-semibold">
        Add a label from a batch
      </h2>
      <div className="space-y-4 p-4">
        {query.isPending ? (
          <p className="text-sm text-muted-foreground">Loading batches…</p>
        ) : query.isError ? (
          <EmptyState icon={CloudOff} title="Batches couldn't be loaded" description={failureMessage(query.error, "Try again.")}>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </EmptyState>
        ) : batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No batch has stock to label. Receive stock on the Batches page first; each batch gets its own code.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-batch`}>Batch</Label>
              <NativeSelect id={`${id}-batch`} value={batchId} onChange={(event) => setBatchId(event.target.value)} className="h-11 sm:h-9">
                <option value="">Choose a batch</option>
                {batches.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.ingredient.name} · {formatCode(batch.label_code)} · use by {formatCalendarDate(batch.expiry_on)}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">The label carries only the batch code; details are looked up when it is scanned.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-copies`}>Copies</Label>
              <Input
                id={`${id}-copies`}
                value={copies}
                onChange={(event) => setCopies(event.target.value)}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_COPIES}
                className="h-11 sm:h-9"
              />
              <p className="text-xs text-muted-foreground">1 to {MAX_COPIES} (one A4 sheet).</p>
            </div>
            {problem && (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {problem}
              </p>
            )}
            <Button type="button" onClick={add} className="h-11 w-full px-4 sm:h-9 sm:w-auto">
              <Plus aria-hidden />
              Add to sheet
            </Button>
          </>
        )}
      </div>
    </section>
  )
}
