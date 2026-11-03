import { zodResolver } from "@hookform/resolvers/zod"
import { useId, useState, type ReactNode } from "react"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api/client"
import { formValuesFrom, productFormSchema, toProductInput, type ProductFormValues } from "./schemas"
import { useDeleteProduct, useSaveProduct, type StaffCategory, type StaffProduct } from "./staff"

interface ProductSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The product being edited, or null to add one. */
  product: StaffProduct | null
  categories: readonly StaffCategory[]
  defaultCurrency: string | null
  onDone: (message: string) => void
}

export function ProductSheet({ open, onOpenChange, ...rest }: ProductSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        {/* Keyed so the form starts fresh for each product. */}
        {open && <ProductForm key={rest.product?.id ?? "new"} onClose={() => onOpenChange(false)} {...rest} />}
      </SheetContent>
    </Sheet>
  )
}

function failureMessage(error: unknown, action: string): string {
  if (error instanceof ApiError && error.isUnreachable) return `Can't reach the EcoPantry server. ${action}`
  if (error instanceof ApiError) return error.message
  return `Something went wrong. ${action}`
}

function ProductForm({
  product,
  categories,
  defaultCurrency,
  onDone,
  onClose,
}: Omit<ProductSheetProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const id = useId()
  const save = useSaveProduct()
  const remove = useDeleteProduct()
  const [problem, setProblem] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: formValuesFrom(product, defaultCurrency),
  })
  const busy = save.isPending || remove.isPending

  const submit = handleSubmit(async (values) => {
    if (busy) return
    setProblem(null)
    try {
      const saved = await save.mutateAsync({ id: product?.id ?? null, input: toProductInput(values, product) })
      onDone(product ? `Saved “${saved.name}”.` : `Added “${saved.name}”${saved.is_published ? " and published it" : " as a draft"}.`)
      onClose()
    } catch (error) {
      setProblem(failureMessage(error, "Nothing was saved."))
    }
  })

  const deleteProduct = async () => {
    if (!product || busy) return
    setProblem(null)
    try {
      await remove.mutateAsync(product.id)
      onDone(`Deleted “${product.name}”.`)
      onClose()
    } catch (error) {
      setConfirmingDelete(false)
      setProblem(failureMessage(error, "The product wasn't deleted."))
    }
  }

  const field = (name: keyof ProductFormValues) => ({
    id: `${id}-${name}`,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${id}-${name}-error` : undefined,
  })

  return (
    <form onSubmit={submit} noValidate className="flex min-h-full flex-col">
      <SheetHeader className="border-b pr-12">
        <SheetTitle className="text-lg font-semibold">{product ? "Edit product" : "Add product"}</SheetTitle>
        <SheetDescription>
          {product ? "Changes to a published product show on the website straight away." : "New products stay drafts until you publish them."}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-5 p-4">
        {problem && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {problem}
          </p>
        )}

        <Field label="Name" htmlFor={`${id}-name`} error={errors.name?.message} errorId={`${id}-name-error`}>
          <Input {...field("name")} autoComplete="off" {...register("name")} />
        </Field>

        <Field label="Category" htmlFor={`${id}-categoryId`}>
          <NativeSelect {...field("categoryId")} {...register("categoryId")}>
            <option value="">No category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field
          label="Summary"
          htmlFor={`${id}-summary`}
          hint="One line for the product list. Optional."
          error={errors.summary?.message}
          errorId={`${id}-summary-error`}
        >
          <Input {...field("summary")} {...register("summary")} />
        </Field>

        <Field
          label="Description"
          htmlFor={`${id}-description`}
          hint="Shown on the product's own page. Leave a blank line between paragraphs. Optional."
          error={errors.description?.message}
          errorId={`${id}-description-error`}
        >
          <Textarea {...field("description")} rows={5} {...register("description")} />
        </Field>

        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Price</legend>
          <p className="text-xs text-muted-foreground">Optional. Leave both empty to show no price.</p>
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-price`} className="sr-only">
                Amount
              </Label>
              <Input {...field("price")} inputMode="decimal" placeholder="4.50" className="tabular-nums" {...register("price")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-currency`} className="sr-only">
                Currency code
              </Label>
              <Input {...field("currency")} placeholder="EUR" maxLength={3} className="uppercase" autoComplete="off" {...register("currency")} />
            </div>
          </div>
          {errors.price && (
            <p id={`${id}-price-error`} className="text-sm text-destructive">
              {errors.price.message}
            </p>
          )}
          {errors.currency && (
            <p id={`${id}-currency-error`} className="text-sm text-destructive">
              {errors.currency.message}
            </p>
          )}
        </fieldset>

        <Field
          label="Web address"
          htmlFor={`${id}-slug`}
          hint={product ? "Changing it breaks links people have saved." : "Made from the name if you leave it empty."}
          error={errors.slug?.message}
          errorId={`${id}-slug-error`}
        >
          <div className="flex items-center gap-1 text-sm">
            <span className="shrink-0 font-mono text-muted-foreground">/products/</span>
            <Input {...field("slug")} className="font-mono" autoComplete="off" spellCheck={false} {...register("slug")} />
          </div>
        </Field>

        <div className="flex items-start gap-3 rounded-lg border p-3">
          <input
            id={`${id}-published`}
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-primary"
            {...register("isPublished")}
          />
          <div>
            <Label htmlFor={`${id}-published`}>Show on the public website</Label>
            <p className="mt-1 text-xs text-muted-foreground">Unticked, only staff can see this product.</p>
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 flex flex-col gap-3 border-t bg-popover p-4">
        <div className="flex gap-2">
          <Button type="submit" className="aria-disabled:opacity-70" aria-disabled={busy || undefined}>
            {save.isPending ? "Saving…" : product ? "Save changes" : "Add product"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
        {product &&
          (confirmingDelete ? (
            <div role="group" aria-label="Confirm delete" className="flex flex-wrap items-center gap-2 text-sm">
              <span>Delete “{product.name}” for good?</span>
              <Button type="button" variant="destructive" onClick={deleteProduct} aria-disabled={busy || undefined}>
                {remove.isPending ? "Deleting…" : "Delete"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                Keep it
              </Button>
            </div>
          ) : (
            <Button type="button" variant="ghost" className="self-start text-destructive" onClick={() => setConfirmingDelete(true)}>
              Delete product…
            </Button>
          ))}
      </div>
    </form>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  errorId,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  error?: string
  errorId?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
