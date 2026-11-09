import { useQuery } from "@tanstack/react-query"
import { useId, useState } from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { ApiError } from "@/lib/api/client"
import { cn } from "@/lib/utils"
import {
  daysLeftLabel,
  fefoQuery,
  formatQuantity,
  ingredientsQuery,
  isValidQuantity,
  type FefoBatch,
  type FefoResult,
} from "./api"

function errorText(error: unknown): string {
  if (error instanceof ApiError && error.isUnreachable) return "Can't reach the EcoPantry server."
  if (error instanceof ApiError) return error.message
  return "That couldn't be loaded."
}

/** Pick an ingredient (and optionally an amount) to see which batch to use first. */
export function FefoPanel() {
  const ingredientId = useId()
  const quantityId = useId()
  const [ingredient, setIngredient] = useState("")
  const [quantity, setQuantity] = useState("")
  const ingredients = useQuery(ingredientsQuery)
  const quantityOk = isValidQuantity(quantity.trim())
  const plan = useQuery({
    ...fefoQuery(ingredient, quantity.trim()),
    enabled: ingredient !== "" && quantityOk,
  })

  return (
    <section aria-labelledby="fefo-heading" className="space-y-3 rounded-lg border bg-card p-4 sm:p-5">
      <div>
        <h2 id="fefo-heading" className="text-base font-semibold">
          What to use first (FEFO)
        </h2>
        <p className="text-sm text-muted-foreground">
          First expired, first out: pick an ingredient to see its batches in the order they should be used. A batch is
          usable through the whole of its expiry date. Expired stock is never recommended.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <Label htmlFor={ingredientId}>Ingredient</Label>
          <NativeSelect
            id={ingredientId}
            value={ingredient}
            onChange={(event) => setIngredient(event.target.value)}
            disabled={ingredients.isPending || ingredients.isError}
          >
            <option value="">{ingredients.isPending ? "Loading ingredients…" : "Choose an ingredient"}</option>
            {ingredients.data?.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.unit.code})
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={quantityId}>Amount needed (optional)</Label>
          <Input
            id={quantityId}
            inputMode="decimal"
            placeholder="e.g. 2.5"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            aria-invalid={!quantityOk}
            aria-describedby={quantityOk ? undefined : `${quantityId}-error`}
          />
          {!quantityOk && (
            <p id={`${quantityId}-error`} className="text-sm text-destructive">
              Enter a positive number with up to 3 decimals.
            </p>
          )}
        </div>
      </div>

      {ingredients.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorText(ingredients.error)}
        </p>
      )}

      {ingredient === "" ? null : plan.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Working out the order…
        </p>
      ) : plan.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorText(plan.error)}
        </p>
      ) : (
        <FefoResultView result={plan.data} />
      )}
    </section>
  )
}

function BatchLine({ batch, unit, take }: { batch: FefoBatch; unit: string; take?: string }) {
  return (
    <>
      <span className="font-mono text-sm">{batch.label_code}</span>
      <span className="text-sm tabular-nums">
        {take ? (
          <>
            Take <strong>{formatQuantity(take)}</strong> {unit} of {formatQuantity(batch.remaining_quantity)}
          </>
        ) : (
          <>
            {formatQuantity(batch.remaining_quantity)} {unit}
          </>
        )}
      </span>
      <span className="text-sm text-muted-foreground">
        {batch.expiry_on} · {daysLeftLabel(batch.days_left)}
      </span>
    </>
  )
}

const row = "grid gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)] sm:items-center"

export function FefoResultView({ result }: { result: FefoResult }) {
  const unit = result.ingredient.unit
  const hasStock = result.usable.length > 0

  return (
    <div className="space-y-4" data-testid="fefo-result">
      {result.pick && (
        <div
          role="status"
          className={cn(
            "rounded-md border px-3 py-2 text-sm",
            result.sufficient ? "border-success/40 bg-success/10 text-success" : "border-warning/40 bg-warning/10 text-warning",
          )}
        >
          {result.sufficient
            ? `Enough usable stock: ${formatQuantity(result.requested ?? "0")} ${unit} can be picked from ${result.pick.length} ${result.pick.length === 1 ? "batch" : "batches"}.`
            : `Not enough usable stock: ${formatQuantity(result.allocated ?? "0")} ${unit} available, ${formatQuantity(result.shortfall ?? "0")} ${unit} short.`}
        </div>
      )}

      {result.pick && result.pick.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Pick list</h3>
          <ol className="divide-y">
            {result.pick.map((line, index) => (
              <li key={line.batch.id} className={row}>
                <BatchLine batch={line.batch} unit={unit} take={line.take} />
                <span className="sr-only">Step {index + 1}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold">Use in this order</h3>
        {hasStock ? (
          <ol className="divide-y">
            {result.usable.map((batch) => (
              <li key={batch.id} className={row}>
                <BatchLine batch={batch} unit={unit} />
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState title="No usable batches" description={`There is no in-date stock of ${result.ingredient.name}.`} />
        )}
      </div>

      {result.expired.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
          <h3 className="text-sm font-semibold text-destructive">Expired, don&apos;t use</h3>
          <ul className="divide-y divide-destructive/20">
            {result.expired.map((batch) => (
              <li key={batch.id} className={row}>
                <BatchLine batch={batch} unit={unit} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
