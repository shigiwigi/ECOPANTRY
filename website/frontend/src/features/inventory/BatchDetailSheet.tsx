import { zodResolver } from "@hookform/resolvers/zod"
import { useQuery } from "@tanstack/react-query"
import { CloudOff, Printer } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { formatCode } from "@/features/qr/batch-label"
import { formatCalendarDate } from "@/features/qr/dates"
import { PrintSheet } from "@/features/qr/LabelSheet"
import { batchQuery, useAdjust, useConsume, type BatchDetail, type Movement } from "./api"
import { adjustFormSchema, consumeFormSchema, type AdjustFormValues, type ConsumeFormValues } from "./schemas"
import { failureMessage, formatQty, formatSigned } from "./format"
import { BatchStatusBadge, Field, Notice } from "./ui"

interface BatchDetailSheetProps {
  batchId: string | null
  onOpenChange: (open: boolean) => void
  /** Show consume, adjust and print-label controls. The backend refuses them for everyone else. */
  canManage: boolean
}

/** One batch: details, stock actions and the full movement history. */
export function BatchDetailSheet({ batchId, onOpenChange, canManage }: BatchDetailSheetProps) {
  return (
    <Sheet open={batchId !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        {batchId && <BatchBody key={batchId} batchId={batchId} canManage={canManage} />}
      </SheetContent>
    </Sheet>
  )
}

const KIND_LABELS: Record<Movement["kind"], string> = { in: "Received", out: "Used", adjust: "Adjusted" }

function BatchBody({ batchId, canManage }: { batchId: string; canManage: boolean }) {
  const query = useQuery(batchQuery(batchId))

  if (query.isPending) {
    return (
      <>
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="text-lg font-semibold">Batch</SheetTitle>
          <SheetDescription>Loading…</SheetDescription>
        </SheetHeader>
      </>
    )
  }
  if (query.isError) {
    return (
      <>
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="text-lg font-semibold">Batch</SheetTitle>
          <SheetDescription>This batch couldn't be loaded.</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 p-4">
          <Notice>
            <CloudOff className="mr-2 inline size-4" aria-hidden />
            {failureMessage(query.error, "Try again.")}
          </Notice>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      </>
    )
  }
  return <BatchContent batch={query.data} canManage={canManage} />
}

function BatchContent({ batch, canManage }: { batch: BatchDetail; canManage: boolean }) {
  const [action, setAction] = useState<"consume" | "adjust" | null>(null)
  const [message, setMessage] = useState("")
  const [printing, setPrinting] = useState(false)
  const unit = batch.ingredient.unit

  // The sheet exists in <body> only while printing (see `.print-sheet` in globals.css).
  useEffect(() => {
    if (!printing) return
    window.print()
    setPrinting(false)
  }, [printing])

  const rows: [string, string][] = [
    ["Batch code", formatCode(batch.label_code)],
    ["Received", formatCalendarDate(batch.received_on)],
    ["Use by", formatCalendarDate(batch.expiry_on)],
    ["Quantity received", `${formatQty(batch.quantity)} ${unit}`],
    ["Stored in", batch.storage_area?.name ?? "Not recorded"],
  ]
  if (batch.notes) rows.push(["Notes", batch.notes])

  return (
    <>
      <SheetHeader className="border-b pr-12">
        <SheetTitle className="text-lg font-semibold">{batch.ingredient.name}</SheetTitle>
        <SheetDescription asChild>
          <div className="flex flex-wrap items-center gap-2">
            <BatchStatusBadge status={batch.status} />
            <span className="tabular-nums">
              {formatQty(batch.remaining_quantity)} {unit} left
            </span>
          </div>
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 p-4">
        {message && <Notice tone="success">{message}</Notice>}

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
          {rows.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-muted-foreground">{term}</dt>
              <dd className={term === "Batch code" ? "font-mono" : "min-w-0 break-words"}>{value}</dd>
            </div>
          ))}
        </dl>

        {canManage && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button variant={action === "consume" ? "default" : "outline"} onClick={() => setAction(action === "consume" ? null : "consume")} aria-pressed={action === "consume"}>
                Use stock
              </Button>
              <Button variant={action === "adjust" ? "default" : "outline"} onClick={() => setAction(action === "adjust" ? null : "adjust")} aria-pressed={action === "adjust"}>
                Adjust
              </Button>
              <Button variant="outline" onClick={() => setPrinting(true)}>
                <Printer aria-hidden />
                Print label
              </Button>
            </div>
            {action === "consume" && (
              <ConsumeForm
                batch={batch}
                onDone={(text) => {
                  setMessage(text)
                  setAction(null)
                }}
              />
            )}
            {action === "adjust" && (
              <AdjustForm
                batch={batch}
                onDone={(text) => {
                  setMessage(text)
                  setAction(null)
                }}
              />
            )}
          </div>
        )}

        <section aria-labelledby="movement-history" className="space-y-2">
          <h3 id="movement-history" className="text-sm font-semibold">
            History
          </h3>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[28rem] text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    When
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    What
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Change
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Left
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    By
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {batch.movements.map((movement) => (
                  <tr key={movement.id} className="align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {new Date(movement.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                    </td>
                    <td className="px-3 py-2">
                      {KIND_LABELS[movement.kind]}
                      {movement.reason && <span className="block text-xs text-muted-foreground">{movement.reason}</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatSigned(movement.quantity_delta)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatQty(movement.remaining_after)}</td>
                    <td className="px-3 py-2">{movement.employee_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {printing && (
        <PrintSheet
          guides={false}
          labels={[{ code: batch.label_code, ingredientName: batch.ingredient.name, expiresOn: batch.expiry_on }]}
        />
      )}
    </>
  )
}

function ConsumeForm({ batch, onDone }: { batch: BatchDetail; onDone: (message: string) => void }) {
  const id = useId()
  const consume = useConsume(batch.id)
  const [problem, setProblem] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ConsumeFormValues>({ resolver: zodResolver(consumeFormSchema), defaultValues: { quantity: "", reason: "" } })

  const submit = handleSubmit(async (values) => {
    if (consume.isPending) return
    setProblem(null)
    try {
      await consume.mutateAsync({ quantity: values.quantity, reason: values.reason || null })
      onDone(`Took ${formatQty(values.quantity)} ${batch.ingredient.unit} out of the batch.`)
    } catch (error) {
      setProblem(failureMessage(error, "Nothing was changed."))
    }
  })

  return (
    <form onSubmit={submit} noValidate aria-label="Use stock" className="space-y-4 rounded-lg border p-3">
      {problem && <Notice>{problem}</Notice>}
      <Field label={`Quantity used (${batch.ingredient.unit})`} htmlFor={`${id}-quantity`} error={errors.quantity?.message} errorId={`${id}-quantity-error`}>
        <Input id={`${id}-quantity`} inputMode="decimal" autoComplete="off" className="tabular-nums" aria-invalid={errors.quantity ? true : undefined} {...register("quantity")} />
      </Field>
      <Field label="Note (optional)" htmlFor={`${id}-reason`} error={errors.reason?.message} errorId={`${id}-reason-error`}>
        <Input id={`${id}-reason`} autoComplete="off" {...register("reason")} />
      </Field>
      <Button type="submit" className="aria-disabled:opacity-70" aria-disabled={consume.isPending || undefined}>
        {consume.isPending ? "Saving…" : "Take out"}
      </Button>
    </form>
  )
}

function AdjustForm({ batch, onDone }: { batch: BatchDetail; onDone: (message: string) => void }) {
  const id = useId()
  const adjust = useAdjust(batch.id)
  const [problem, setProblem] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AdjustFormValues>({
    resolver: zodResolver(adjustFormSchema),
    defaultValues: { direction: "decrease", quantity: "", reason: "" },
  })

  const submit = handleSubmit(async (values) => {
    if (adjust.isPending) return
    setProblem(null)
    const delta = `${values.direction === "decrease" ? "-" : ""}${values.quantity}`
    try {
      await adjust.mutateAsync({ delta, reason: values.reason })
      onDone("Adjustment saved.")
    } catch (error) {
      setProblem(failureMessage(error, "Nothing was changed."))
    }
  })

  return (
    <form onSubmit={submit} noValidate aria-label="Adjust stock" className="space-y-4 rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">
        For corrections, such as a recount or spillage. The original entries stay in the history.
      </p>
      {problem && <Notice>{problem}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Change" htmlFor={`${id}-direction`}>
          <NativeSelect id={`${id}-direction`} {...register("direction")}>
            <option value="decrease">Remove from batch</option>
            <option value="increase">Add to batch</option>
          </NativeSelect>
        </Field>
        <Field label={`Amount (${batch.ingredient.unit})`} htmlFor={`${id}-quantity`} error={errors.quantity?.message} errorId={`${id}-quantity-error`}>
          <Input id={`${id}-quantity`} inputMode="decimal" autoComplete="off" className="tabular-nums" aria-invalid={errors.quantity ? true : undefined} {...register("quantity")} />
        </Field>
      </div>
      <Field label="Reason" htmlFor={`${id}-reason`} error={errors.reason?.message} errorId={`${id}-reason-error`}>
        <Input id={`${id}-reason`} autoComplete="off" aria-invalid={errors.reason ? true : undefined} {...register("reason")} />
      </Field>
      <Button type="submit" className="aria-disabled:opacity-70" aria-disabled={adjust.isPending || undefined}>
        {adjust.isPending ? "Saving…" : "Save adjustment"}
      </Button>
    </form>
  )
}
