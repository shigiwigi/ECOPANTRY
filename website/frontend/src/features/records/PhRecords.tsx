import { zodResolver } from "@hookform/resolvers/zod"
import { useQuery } from "@tanstack/react-query"
import { FlaskConical } from "lucide-react"
import { useId, useState } from "react"
import { useForm } from "react-hook-form"
import { EmptyState } from "@/components/common/EmptyState"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/features/auth/auth-context"
import { cn } from "@/lib/utils"
import { formatDateTime, phRecordsQuery, useRecordPh } from "./api"
import { EMPTY_PH_FORM, phFormSchema, toPhInput, type PhFormValues } from "./schemas"
import { Field, Pager, TableShell } from "./shared"
import { fieldProps, problemText, TD, TH } from "./helpers"

/** Recorded pH measurements. Experimental: a record describes a sample, it never says safe or spoiled. */
export function PhRecords() {
  const { user, isPreview } = useAuth()
  // UX only: the backend allows recording with `ph.record` (administrators and shopkeepers).
  const canRecord = user?.role === "admin" || user?.role === "storekeeper"

  if (isPreview) {
    return (
      <EmptyState
        title="pH records need a real sign-in"
        description="The development preview has no account, so the server won't share or accept pH records."
      />
    )
  }

  return (
    <section aria-labelledby="ph-records-heading" className="space-y-5">
      <h2 id="ph-records-heading" className="text-lg font-semibold">
        pH records
      </h2>
      <p className="flex gap-2 text-sm text-muted-foreground">
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <span>
          Experimental. A record only notes what was measured, against which reference range and how the probe was
          calibrated. It never says whether food is safe or spoiled.
        </span>
      </p>
      {canRecord && <PhForm />}
      <RecentRecords />
    </section>
  )
}

function PhForm() {
  const id = useId()
  const record = useRecordPh()
  const [saved, setSaved] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PhFormValues>({ resolver: zodResolver(phFormSchema), defaultValues: EMPTY_PH_FORM })

  const submit = handleSubmit(async (values) => {
    setProblem(null)
    setSaved(false)
    try {
      await record.mutateAsync(toPhInput(values))
      reset(EMPTY_PH_FORM)
      setSaved(true)
    } catch (error) {
      setProblem(problemText(error, "Nothing was saved."))
    }
  })

  return (
    <form onSubmit={submit} noValidate aria-labelledby={`${id}-title`} className="space-y-4 rounded-lg border bg-card p-4">
      <h3 id={`${id}-title`} className="font-medium">
        Record a measurement
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field id={`${id}-sample`} label="Sample" hint="What was measured, e.g. sourdough starter, batch 3." error={errors.sample?.message}>
            <Input autoComplete="off" {...fieldProps(`${id}-sample`, errors.sample?.message, "hint")} {...register("sample")} />
          </Field>
        </div>
        <Field id={`${id}-value`} label="Measured pH" error={errors.value?.message}>
          <Input inputMode="decimal" autoComplete="off" {...fieldProps(`${id}-value`, errors.value?.message)} {...register("value")} />
        </Field>
        <Field id={`${id}-batch`} label="Batch ID (optional)" error={errors.batchId?.message}>
          <Input autoComplete="off" className="font-mono" {...fieldProps(`${id}-batch`, errors.batchId?.message)} {...register("batchId")} />
        </Field>
        <Field id={`${id}-min`} label="Reference minimum" hint="Optional, from your recipe." error={errors.referenceMin?.message}>
          <Input inputMode="decimal" autoComplete="off" {...fieldProps(`${id}-min`, errors.referenceMin?.message, "hint")} {...register("referenceMin")} />
        </Field>
        <Field id={`${id}-max`} label="Reference maximum" hint="Optional." error={errors.referenceMax?.message}>
          <Input inputMode="decimal" autoComplete="off" {...fieldProps(`${id}-max`, errors.referenceMax?.message, "hint")} {...register("referenceMax")} />
        </Field>
        <div className="sm:col-span-2">
          <Field
            id={`${id}-calibration`}
            label="Calibration note"
            hint="How the probe was calibrated, e.g. two-point with pH 4 and 7 buffers today."
            error={errors.calibration?.message}
          >
            <Textarea className="min-h-16" {...fieldProps(`${id}-calibration`, errors.calibration?.message, "hint")} {...register("calibration")} />
          </Field>
        </div>
      </div>

      {problem && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {problem}
        </p>
      )}
      <p role="status" className={cn("text-sm", saved ? "rounded-md border border-success/40 bg-success/10 px-3 py-2" : "sr-only")}>
        {saved ? "Measurement recorded." : ""}
      </p>
      <Button type="submit" disabled={record.isPending}>
        {record.isPending ? "Saving…" : "Record measurement"}
      </Button>
    </form>
  )
}

function RecentRecords() {
  const [offset, setOffset] = useState(0)
  const records = useQuery(phRecordsQuery(offset))

  if (records.isError) {
    return (
      <EmptyState title="pH records couldn't be loaded" description={problemText(records.error, "Try again.")}>
        <Button variant="outline" size="sm" onClick={() => records.refetch()}>
          Try again
        </Button>
      </EmptyState>
    )
  }
  if (!records.data) return <p className="text-sm text-muted-foreground">Loading records…</p>
  if (records.data.total === 0) {
    return <EmptyState title="No measurements recorded yet" description="Records appear here, newest first." />
  }

  return (
    <div className="space-y-3">
      <TableShell caption="pH measurements, newest first (experimental)">
        <thead className="border-b">
          <tr>
            <th scope="col" className={TH}>When</th>
            <th scope="col" className={TH}>Sample</th>
            <th scope="col" className={cn(TH, "text-right")}>pH</th>
            <th scope="col" className={TH}>Reference range</th>
            <th scope="col" className={TH}>Calibration</th>
            <th scope="col" className={TH}>Operator</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {records.data.items.map((item) => (
            <tr key={item.id}>
              <td className={cn(TD, "whitespace-nowrap")}>{formatDateTime(item.recorded_at)}</td>
              <td className={TD}>{item.sample_description}</td>
              <td className={cn(TD, "text-right font-mono")}>{item.ph_value}</td>
              <td className={cn(TD, "font-mono")}>
                {item.reference_min !== null && item.reference_max !== null ? `${item.reference_min}–${item.reference_max}` : "–"}
              </td>
              <td className={TD}>{item.calibration_note ?? "–"}</td>
              <td className={TD}>{item.operator.full_name}</td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <Pager page={records.data} onOffset={setOffset} />
    </div>
  )
}
