import { zodResolver } from "@hookform/resolvers/zod"
import { useQuery } from "@tanstack/react-query"
import { useId, useState } from "react"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { ingredientsQuery, storageAreasQuery, useReceiveBatch, type BatchDetail } from "./api"
import { receiveFormSchema, todayIso, type ReceiveFormValues } from "./schemas"
import { failureMessage } from "./format"
import { Field, Notice } from "./ui"

interface ReceiveSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Preselect an ingredient, e.g. from its row in the stock overview. */
  ingredientId?: string
  onReceived: (batch: BatchDetail) => void
}

/** Receive stock into the shop: creates a batch with its own QR label code. */
export function ReceiveSheet({ open, onOpenChange, ...rest }: ReceiveSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        {open && <ReceiveForm key={rest.ingredientId ?? "any"} onClose={() => onOpenChange(false)} {...rest} />}
      </SheetContent>
    </Sheet>
  )
}

function ReceiveForm({ ingredientId, onReceived, onClose }: Omit<ReceiveSheetProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const id = useId()
  const ingredients = useQuery(ingredientsQuery({ active: true, limit: 200 }))
  const areas = useQuery(storageAreasQuery)
  const receive = useReceiveBatch()
  const [problem, setProblem] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ReceiveFormValues>({
    resolver: zodResolver(receiveFormSchema),
    defaultValues: {
      ingredientId: ingredientId ?? "",
      storageAreaId: "",
      quantity: "",
      receivedOn: todayIso(),
      expiryOn: "",
      notes: "",
    },
  })
  const choices = ingredients.data?.items ?? []
  const unit = choices.find((item) => item.id === watch("ingredientId"))?.unit.code

  const submit = handleSubmit(async (values) => {
    if (receive.isPending) return
    setProblem(null)
    try {
      const batch = await receive.mutateAsync({
        ingredient_id: values.ingredientId,
        storage_area_id: values.storageAreaId || null,
        quantity: values.quantity,
        received_on: values.receivedOn,
        expiry_on: values.expiryOn,
        notes: values.notes || null,
      })
      onReceived(batch)
      onClose()
    } catch (error) {
      setProblem(failureMessage(error, "Nothing was saved."))
    }
  })

  const field = (name: keyof ReceiveFormValues) => ({
    id: `${id}-${name}`,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${id}-${name}-error` : undefined,
  })

  return (
    <form onSubmit={submit} noValidate className="flex min-h-full flex-col">
      <SheetHeader className="border-b pr-12">
        <SheetTitle className="text-lg font-semibold">Receive stock</SheetTitle>
        <SheetDescription>Each delivery becomes a batch with its own use-by date and QR label.</SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-5 p-4">
        {problem && <Notice>{problem}</Notice>}
        {ingredients.isError && <Notice>The ingredient list couldn't be loaded.</Notice>}
        {ingredients.isSuccess && choices.length === 0 && (
          <Notice>There are no ingredients yet. Add an ingredient on the Inventory page first.</Notice>
        )}

        <Field label="Ingredient" htmlFor={`${id}-ingredientId`} error={errors.ingredientId?.message} errorId={`${id}-ingredientId-error`}>
          <NativeSelect {...field("ingredientId")} {...register("ingredientId")}>
            <option value="">Choose an ingredient</option>
            {choices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.unit.code})
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field
          label={unit ? `Quantity received (${unit})` : "Quantity received"}
          htmlFor={`${id}-quantity`}
          hint="Up to three decimals."
          error={errors.quantity?.message}
          errorId={`${id}-quantity-error`}
        >
          <Input {...field("quantity")} inputMode="decimal" autoComplete="off" className="tabular-nums" {...register("quantity")} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Received on" htmlFor={`${id}-receivedOn`} error={errors.receivedOn?.message} errorId={`${id}-receivedOn-error`}>
            <Input {...field("receivedOn")} type="date" {...register("receivedOn")} />
          </Field>
          <Field label="Use by" htmlFor={`${id}-expiryOn`} error={errors.expiryOn?.message} errorId={`${id}-expiryOn-error`}>
            <Input {...field("expiryOn")} type="date" {...register("expiryOn")} />
          </Field>
        </div>

        <Field label="Stored in (optional)" htmlFor={`${id}-storageAreaId`}>
          <NativeSelect {...field("storageAreaId")} {...register("storageAreaId")}>
            <option value="">Not recorded</option>
            {(areas.data?.items ?? []).map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="Notes (optional)" htmlFor={`${id}-notes`} error={errors.notes?.message} errorId={`${id}-notes-error`}>
          <Textarea {...field("notes")} rows={3} {...register("notes")} />
        </Field>
      </div>

      <div className="sticky bottom-0 flex gap-2 border-t bg-popover p-4">
        <Button type="submit" className="aria-disabled:opacity-70" aria-disabled={receive.isPending || undefined}>
          {receive.isPending ? "Saving…" : "Receive stock"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
