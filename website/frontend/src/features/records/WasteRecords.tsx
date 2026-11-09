import { zodResolver } from "@hookform/resolvers/zod"
import { useQuery } from "@tanstack/react-query"
import { useId, useState } from "react"
import { useForm } from "react-hook-form"
import { EmptyState } from "@/components/common/EmptyState"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/features/auth/auth-context"
import { cn } from "@/lib/utils"
import {
  daysAgoIso,
  formatDateTime,
  formatKg,
  useRecordWaste,
  WASTE_CATEGORIES,
  WASTE_CATEGORY_LABELS,
  wasteRecordsQuery,
  wasteSummaryQuery,
} from "./api"
import { EMPTY_WASTE_FORM, toWasteInput, wasteFormSchema, type WasteFormValues } from "./schemas"
import { Field, Pager, TableShell } from "./shared"
import { fieldProps, problemText, TD, TH } from "./helpers"

const SUMMARY_DAYS = 30

/** Waste records: totals, a form to log waste, and the recent list. Sits below the live bin weight. */
export function WasteRecords() {
  const { user, isPreview } = useAuth()
  // UX only: the backend allows recording with `waste.record` (administrators and shopkeepers).
  const canRecord = user?.role === "admin" || user?.role === "storekeeper"

  if (isPreview) {
    return (
      <EmptyState
        title="Waste records need a real sign-in"
        description="The development preview has no account, so the server won't share or accept waste records."
      />
    )
  }

  return (
    <section aria-labelledby="waste-records-heading" className="space-y-5">
      <h2 id="waste-records-heading" className="text-lg font-semibold">
        Waste records
      </h2>
      <Totals />
      {canRecord && <WasteForm />}
      <RecentRecords />
    </section>
  )
}

function Totals() {
  const [dateFrom] = useState(() => daysAgoIso(SUMMARY_DAYS))
  const summary = useQuery(wasteSummaryQuery(dateFrom))

  if (summary.isError) return <p className="text-sm text-muted-foreground">Totals couldn't be loaded. {problemText(summary.error, "")}</p>
  if (!summary.data) return <p className="text-sm text-muted-foreground">Loading totals…</p>

  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-muted-foreground">
        Last {SUMMARY_DAYS} days: {summary.data.records} {summary.data.records === 1 ? "record" : "records"},{" "}
        {formatKg(summary.data.weight_kg)} weighed
      </h3>
      <ul className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {summary.data.by_category.map((row) => (
          <li key={row.category} className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">{WASTE_CATEGORY_LABELS[row.category]}</p>
            <p className="mt-1 font-mono text-lg">{row.records}</p>
            <p className="font-mono text-xs text-muted-foreground">{formatKg(row.weight_kg)}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function WasteForm() {
  const id = useId()
  const record = useRecordWaste()
  const [saved, setSaved] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<WasteFormValues>({ resolver: zodResolver(wasteFormSchema), defaultValues: EMPTY_WASTE_FORM })

  const submit = handleSubmit(async (values) => {
    setProblem(null)
    setSaved(false)
    try {
      await record.mutateAsync(toWasteInput(values))
      reset(EMPTY_WASTE_FORM)
      setSaved(true)
    } catch (error) {
      setProblem(problemText(error, "Nothing was saved."))
    }
  })

  return (
    <form onSubmit={submit} noValidate aria-labelledby={`${id}-title`} className="space-y-4 rounded-lg border bg-card p-4">
      <h3 id={`${id}-title`} className="font-medium">
        Record waste
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${id}-category`} label="Category" error={errors.category?.message}>
          <NativeSelect {...fieldProps(`${id}-category`, errors.category?.message)} {...register("category")}>
            <option value="">Choose a category</option>
            {WASTE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {WASTE_CATEGORY_LABELS[category]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id={`${id}-weight`} label="Weight (kg)" hint="Optional. Leave empty if it wasn't weighed." error={errors.weight?.message}>
          <Input
            inputMode="decimal"
            autoComplete="off"
            {...fieldProps(`${id}-weight`, errors.weight?.message, "hint")}
            {...register("weight")}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field
            id={`${id}-reason`}
            label="Reason"
            hint="What happened. Required when the category is Other."
            error={errors.reason?.message}
          >
            <Textarea className="min-h-16" {...fieldProps(`${id}-reason`, errors.reason?.message, "hint")} {...register("reason")} />
          </Field>
        </div>
        <Field
          id={`${id}-batch`}
          label="Batch ID (optional)"
          hint="Paste a batch's ID to link this waste to it."
          error={errors.batchId?.message}
        >
          <Input autoComplete="off" className="font-mono" {...fieldProps(`${id}-batch`, errors.batchId?.message, "hint")} {...register("batchId")} />
        </Field>
      </div>

      {problem && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {problem}
        </p>
      )}
      <p role="status" className={cn("text-sm", saved ? "rounded-md border border-success/40 bg-success/10 px-3 py-2" : "sr-only")}>
        {saved ? "Waste recorded." : ""}
      </p>
      <Button type="submit" disabled={record.isPending}>
        {record.isPending ? "Saving…" : "Record waste"}
      </Button>
    </form>
  )
}

function RecentRecords() {
  const [offset, setOffset] = useState(0)
  const records = useQuery(wasteRecordsQuery(offset))

  if (records.isError) {
    return (
      <EmptyState title="Waste records couldn't be loaded" description={problemText(records.error, "Try again.")}>
        <Button variant="outline" size="sm" onClick={() => records.refetch()}>
          Try again
        </Button>
      </EmptyState>
    )
  }
  if (!records.data) return <p className="text-sm text-muted-foreground">Loading records…</p>
  if (records.data.total === 0) {
    return <EmptyState title="No waste recorded yet" description="Records appear here, newest first, once someone logs waste." />
  }

  return (
    <div className="space-y-3">
      <TableShell caption="Recent waste records, newest first">
        <thead className="border-b">
          <tr>
            <th scope="col" className={TH}>When</th>
            <th scope="col" className={TH}>Category</th>
            <th scope="col" className={cn(TH, "text-right")}>Weight</th>
            <th scope="col" className={TH}>Reason</th>
            <th scope="col" className={TH}>Recorded by</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {records.data.items.map((item) => (
            <tr key={item.id}>
              <td className={cn(TD, "whitespace-nowrap")}>{formatDateTime(item.recorded_at)}</td>
              <td className={TD}>{WASTE_CATEGORY_LABELS[item.category]}</td>
              <td className={cn(TD, "text-right font-mono")}>{item.weight_kg ? formatKg(item.weight_kg) : "–"}</td>
              <td className={TD}>{item.reason ?? "–"}</td>
              <td className={TD}>{item.employee.full_name}</td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <Pager page={records.data} onOffset={setOffset} />
    </div>
  )
}
