import { zodResolver } from "@hookform/resolvers/zod"
import { Dices, Info, Plus, Printer, Trash2, X } from "lucide-react"
import { useId, useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { PageHeader } from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getModule } from "@/config/portal-modules"
import { formatCode, randomTestCode, readTypedLabel } from "@/features/qr/batch-label"
import { formatCalendarDate } from "@/features/qr/dates"
import { BatchLabel, PrintSheet, type LabelData } from "@/features/qr/LabelSheet"
import { labelFormSchema, MAX_COPIES, MAX_LABELS, MAX_NAME_LENGTH, type LabelFormValues } from "@/features/qr/schemas"
import { cn } from "@/lib/utils"

interface Entry extends LabelData {
  id: number
  copies: number
}

const EMPTY_FORM: LabelFormValues = { ingredientName: "", code: "", expiresOn: "", copies: "1" }

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

      <div role="note" className="flex gap-3 rounded-lg border border-info/40 bg-info/10 px-4 py-3 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <div className="space-y-1">
          <p className="font-medium">Not linked to batch records yet</p>
          <p>
            Batch records arrive with the inventory module. Until then, labels are made from what you type here: the code
            isn't checked against a batch and nothing is saved. Scanning one shows the code, but no batch details. Once
            batches exist, labels will be printed from the batch list with the code the server assigns.
          </p>
        </div>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)]">
        <LabelForm
          remaining={MAX_LABELS - total}
          onAdd={(values) => {
            const result = readTypedLabel(values.code)
            if (!result.ok) return
            const entry: Entry = {
              id: nextId.current++,
              code: result.code,
              ingredientName: values.ingredientName.trim(),
              expiresOn: values.expiresOn || null,
              copies: Number(values.copies),
            }
            setEntries((current) => [...current, entry])
          }}
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

function LabelForm({ remaining, onAdd }: { remaining: number; onAdd: (values: LabelFormValues) => void }) {
  const id = useId()
  const [limitError, setLimitError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    setFocus,
    formState: { errors },
  } = useForm<LabelFormValues>({ resolver: zodResolver(labelFormSchema), defaultValues: EMPTY_FORM })

  const submit = handleSubmit((values) => {
    if (Number(values.copies) > remaining) {
      setLimitError(
        remaining > 0
          ? `Up to ${MAX_LABELS} labels per print. There's room for ${remaining} more.`
          : `That's ${MAX_LABELS} labels, the most per print. Print these first, then clear them.`,
      )
      return
    }
    setLimitError(null)
    onAdd(values)
    reset(EMPTY_FORM)
    setFocus("ingredientName")
  })

  const field = (name: keyof LabelFormValues) => {
    const error = errors[name]
    return {
      id: `${id}-${name}`,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": [`${id}-${name}-hint`, error ? `${id}-${name}-error` : null].filter(Boolean).join(" "),
    }
  }
  const message = (name: keyof LabelFormValues) =>
    errors[name] && (
      <p id={`${id}-${name}-error`} className="text-sm text-destructive">
        {errors[name]?.message}
      </p>
    )

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-lg border bg-card">
      <h2 id={`${id}-title`} className="border-b px-4 py-3 text-sm font-semibold">
        Add a label
      </h2>
      <form onSubmit={submit} noValidate className="space-y-4 p-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-ingredientName`}>Ingredient</Label>
          <Input {...field("ingredientName")} {...register("ingredientName")} maxLength={MAX_NAME_LENGTH + 10} autoComplete="off" className="h-11 sm:h-9" />
          <p id={`${id}-ingredientName-hint`} className="text-xs text-muted-foreground">
            As staff call it, e.g. "Strong white flour". Up to {MAX_NAME_LENGTH} characters.
          </p>
          {message("ingredientName")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-code`}>Batch code</Label>
          <div className="flex gap-2">
            <Input
              {...field("code")}
              {...register("code")}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="K7M2Q-9X4TR"
              className="h-11 font-mono uppercase placeholder:normal-case sm:h-9"
            />
            <Button
              type="button"
              variant="outline"
              className="h-11 shrink-0 sm:h-9"
              onClick={() => setValue("code", formatCode(randomTestCode()), { shouldValidate: true })}
            >
              <Dices aria-hidden />
              Test code
            </Button>
          </div>
          <p id={`${id}-code-hint`} className="text-xs text-muted-foreground">
            10 letters and digits. "Test code" makes a random one for trying out printing and scanning; it isn't linked
            to any batch.
          </p>
          {message("code")}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={`${id}-expiresOn`}>Use by (optional)</Label>
            <Input {...field("expiresOn")} {...register("expiresOn")} type="date" className="h-11 sm:h-9" />
            <p id={`${id}-expiresOn-hint`} className="text-xs text-muted-foreground">
              Printed as e.g. 20 Nov 2026.
            </p>
            {message("expiresOn")}
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={`${id}-copies`}>Copies</Label>
            <Input {...field("copies")} {...register("copies")} type="number" inputMode="numeric" min={1} max={MAX_COPIES} className="h-11 sm:h-9" />
            <p id={`${id}-copies-hint`} className="text-xs text-muted-foreground">
              1 to {MAX_COPIES} (one A4 sheet).
            </p>
            {message("copies")}
          </div>
        </div>

        {limitError && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {limitError}
          </p>
        )}

        <Button type="submit" className={cn("h-11 w-full px-4 sm:h-9 sm:w-auto")}>
          <Plus aria-hidden />
          Add to sheet
        </Button>
      </form>
    </section>
  )
}
