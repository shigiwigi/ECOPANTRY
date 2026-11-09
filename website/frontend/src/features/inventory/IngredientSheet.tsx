import { zodResolver } from "@hookform/resolvers/zod"
import { useQuery } from "@tanstack/react-query"
import { useId, useState } from "react"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { unitsQuery, useAddIngredient, type Ingredient } from "./api"
import { ingredientFormSchema, type IngredientFormValues } from "./schemas"
import { failureMessage } from "./format"
import { Field, Notice } from "./ui"

interface IngredientSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: (ingredient: Ingredient) => void
}

/** Add an ingredient (what the shop keeps in stock). Its unit can't change once it has batches. */
export function IngredientSheet({ open, onOpenChange, onAdded }: IngredientSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        {open && <IngredientForm onAdded={onAdded} onClose={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function IngredientForm({ onAdded, onClose }: { onAdded: (ingredient: Ingredient) => void; onClose: () => void }) {
  const id = useId()
  const units = useQuery(unitsQuery)
  const add = useAddIngredient()
  const [problem, setProblem] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<IngredientFormValues>({
    resolver: zodResolver(ingredientFormSchema),
    defaultValues: { name: "", unit: "", reorderLevel: "" },
  })

  const submit = handleSubmit(async (values) => {
    if (add.isPending) return
    setProblem(null)
    try {
      const saved = await add.mutateAsync({ name: values.name, unit: values.unit, reorder_level: values.reorderLevel || null })
      onAdded(saved)
      onClose()
    } catch (error) {
      setProblem(failureMessage(error, "Nothing was saved."))
    }
  })

  const field = (name: keyof IngredientFormValues) => ({
    id: `${id}-${name}`,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${id}-${name}-error` : undefined,
  })

  return (
    <form onSubmit={submit} noValidate className="flex min-h-full flex-col">
      <SheetHeader className="border-b pr-12">
        <SheetTitle className="text-lg font-semibold">Add ingredient</SheetTitle>
        <SheetDescription>Then receive stock of it. The unit can't be changed once it has batches.</SheetDescription>
      </SheetHeader>
      <div className="flex-1 space-y-5 p-4">
        {problem && <Notice>{problem}</Notice>}
        <Field label="Name" htmlFor={`${id}-name`} error={errors.name?.message} errorId={`${id}-name-error`}>
          <Input {...field("name")} autoComplete="off" {...register("name")} />
        </Field>
        <Field label="Unit" htmlFor={`${id}-unit`} error={errors.unit?.message} errorId={`${id}-unit-error`}>
          <NativeSelect {...field("unit")} {...register("unit")}>
            <option value="">Choose a unit</option>
            {(units.data ?? []).map((unit) => (
              <option key={unit.code} value={unit.code}>
                {unit.name} ({unit.code})
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          label="Reorder level (optional)"
          htmlFor={`${id}-reorderLevel`}
          hint="The ingredient is flagged as low when the usable stock is at or below this."
          error={errors.reorderLevel?.message}
          errorId={`${id}-reorderLevel-error`}
        >
          <Input {...field("reorderLevel")} inputMode="decimal" autoComplete="off" className="tabular-nums" {...register("reorderLevel")} />
        </Field>
      </div>
      <div className="sticky bottom-0 flex gap-2 border-t bg-popover p-4">
        <Button type="submit" className="aria-disabled:opacity-70" aria-disabled={add.isPending || undefined}>
          {add.isPending ? "Saving…" : "Add ingredient"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
