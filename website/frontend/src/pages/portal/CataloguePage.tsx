import { useQuery, type UseQueryResult } from "@tanstack/react-query"
import { CloudOff, ExternalLink, Plus, Store } from "lucide-react"
import { useId, useState, type FormEvent } from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { PageHeader } from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getModule } from "@/config/portal-modules"
import { useAuth } from "@/features/auth/auth-context"
import { ProductSheet } from "@/features/catalogue/ProductSheet"
import { formatPrice } from "@/features/catalogue/public"
import {
  staffCategoriesQuery,
  staffProductsQuery,
  useDeleteCategory,
  useSaveCategory,
  useSaveProduct,
  usualCurrency,
  type StaffCategory,
  type StaffProduct,
} from "@/features/catalogue/staff"
import { ApiError } from "@/lib/api/client"
import { cn } from "@/lib/utils"

function loadError(error: unknown): string {
  if (error instanceof ApiError && error.isUnreachable) return "Can't reach the EcoPantry server."
  if (error instanceof ApiError) return error.message
  return "The catalogue couldn't be loaded."
}

export default function CataloguePage() {
  const module = getModule("catalogue")
  const { isPreview } = useAuth()

  return (
    <div className="space-y-6">
      <PageHeader title={module.title} description={module.summary} />
      {isPreview ? (
        <EmptyState
          icon={Store}
          title="Needs a real sign-in"
          description="The development preview has no account, so the server won't share or change the catalogue."
        />
      ) : (
        <CatalogueManager />
      )}
    </div>
  )
}

function CatalogueManager() {
  const products = useQuery(staffProductsQuery)
  const categories = useQuery(staffCategoriesQuery)
  const [editing, setEditing] = useState<{ product: StaffProduct | null } | null>(null)
  const [message, setMessage] = useState("")

  const open = (product: StaffProduct | null) => {
    setMessage("")
    setEditing({ product })
  }

  return (
    <>
      <p role="status" className={cn("text-sm", message ? "rounded-md border border-success/40 bg-success/10 px-3 py-2" : "sr-only")}>
        {message}
      </p>

      <section aria-labelledby="catalogue-products" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="catalogue-products" className="text-base font-semibold">
            Products
          </h2>
          <Button onClick={() => open(null)} disabled={!products.isSuccess || !categories.isSuccess}>
            <Plus aria-hidden />
            Add product
          </Button>
        </div>

        {products.isPending ? (
          <p className="text-sm text-muted-foreground">Loading products…</p>
        ) : products.isError ? (
          <EmptyState icon={CloudOff} title="Products couldn't be loaded" description={loadError(products.error)}>
            <Button variant="outline" size="sm" onClick={() => products.refetch()}>
              Try again
            </Button>
          </EmptyState>
        ) : products.data.length === 0 ? (
          <EmptyState
            icon={Store}
            title="No products yet"
            description="Add the bakery's finished products here. Each one stays a draft, visible only to staff, until you publish it."
          />
        ) : (
          <ProductList products={products.data} onEdit={open} onMessage={setMessage} />
        )}
      </section>

      <CategorySection query={categories} onMessage={setMessage} />

      <ProductSheet
        open={editing !== null}
        onOpenChange={(isOpen) => !isOpen && setEditing(null)}
        product={editing?.product ?? null}
        categories={categories.data ?? []}
        defaultCurrency={usualCurrency(products.data ?? [])}
        onDone={setMessage}
      />
    </>
  )
}

function ProductList({
  products,
  onEdit,
  onMessage,
}: {
  products: StaffProduct[]
  onEdit: (product: StaffProduct) => void
  onMessage: (message: string) => void
}) {
  const save = useSaveProduct()

  const togglePublished = async (product: StaffProduct) => {
    if (save.isPending) return
    try {
      const saved = await save.mutateAsync({ id: product.id, input: { is_published: !product.is_published } })
      onMessage(saved.is_published ? `Published “${saved.name}”.` : `“${saved.name}” is a draft again and no longer on the website.`)
    } catch (error) {
      onMessage(`Couldn't change “${product.name}”: ${loadError(error)}`)
    }
  }

  return (
    <ul className="divide-y rounded-lg border bg-card">
      {products.map((product) => (
        <li key={product.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{product.name}</span>
              <StatusBadge published={product.is_published} />
            </div>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>{product.category_name ?? "No category"}</span>
              <span className="tabular-nums">
                {product.price && product.currency ? formatPrice(product.price, product.currency) : "No price"}
              </span>
              <span className="truncate font-mono text-xs leading-5">/products/{product.slug}</span>
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" onClick={() => onEdit(product)} aria-label={`Edit ${product.name}`}>
              Edit
            </Button>
            <Button
              variant="outline"
              onClick={() => togglePublished(product)}
              aria-disabled={save.isPending || undefined}
              aria-label={`${product.is_published ? "Unpublish" : "Publish"} ${product.name}`}
            >
              {product.is_published ? "Unpublish" : "Publish"}
            </Button>
            {product.is_published && (
              <Button variant="ghost" asChild>
                <a href={`/products/${product.slug}`} target="_blank" rel="noopener">
                  View
                  <ExternalLink aria-hidden />
                  <span className="sr-only">{product.name} on the website (opens in a new tab)</span>
                </a>
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

function StatusBadge({ published }: { published: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium",
        published ? "border-success/40 bg-success/10 text-success" : "border-border bg-muted text-muted-foreground",
      )}
    >
      {published ? "Published" : "Draft"}
    </span>
  )
}

function CategorySection({
  query,
  onMessage,
}: {
  query: UseQueryResult<StaffCategory[]>
  onMessage: (message: string) => void
}) {
  const id = useId()
  const save = useSaveCategory()
  const remove = useDeleteCategory()
  const [name, setName] = useState("")
  const [problem, setProblem] = useState<string | null>(null)

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (save.isPending) return
    const trimmed = name.trim()
    if (!trimmed) {
      setProblem("Enter a category name.")
      return
    }
    setProblem(null)
    try {
      const saved = await save.mutateAsync({ id: null, name: trimmed })
      setName("")
      onMessage(`Added the category “${saved.name}”.`)
    } catch (error) {
      setProblem(loadError(error))
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3">
      <div>
        <h2 id={`${id}-title`} className="text-base font-semibold">
          Categories
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Visitors can filter the product list by these.</p>
      </div>

      <form onSubmit={add} noValidate className="flex max-w-md flex-col gap-1.5">
        <Label htmlFor={`${id}-new`}>New category</Label>
        <div className="flex gap-2">
          <Input
            id={`${id}-new`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-problem` : undefined}
            autoComplete="off"
          />
          <Button type="submit" variant="outline" aria-disabled={save.isPending || undefined}>
            Add
          </Button>
        </div>
        {problem && (
          <p id={`${id}-problem`} role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        )}
      </form>

      {query.isPending ? (
        <p className="text-sm text-muted-foreground">Loading categories…</p>
      ) : query.isError ? (
        <p className="text-sm text-destructive">Categories couldn't be loaded. {loadError(query.error)}</p>
      ) : query.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No categories yet. Products can also go without one.</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {query.data.map((category) => (
            <CategoryRow
              key={category.id}
              category={category}
              onMessage={onMessage}
              onDelete={async () => {
                if (category.product_count > 0) {
                  onMessage(`“${category.name}” still has products. Move or delete them first.`)
                  return
                }
                try {
                  await remove.mutateAsync(category.id)
                  onMessage(`Deleted the category “${category.name}”.`)
                } catch (error) {
                  onMessage(`Couldn't delete “${category.name}”: ${loadError(error)}`)
                }
              }}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function CategoryRow({
  category,
  onMessage,
  onDelete,
}: {
  category: StaffCategory
  onMessage: (message: string) => void
  onDelete: () => void
}) {
  const id = useId()
  const save = useSaveCategory()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(category.name)
  const [problem, setProblem] = useState<string | null>(null)
  const inUse = category.product_count > 0

  const rename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (save.isPending) return
    setProblem(null)
    try {
      const saved = await save.mutateAsync({ id: category.id, name: name.trim() })
      setRenaming(false)
      onMessage(`Renamed the category to “${saved.name}”.`)
    } catch (error) {
      setProblem(loadError(error))
    }
  }

  if (renaming) {
    return (
      <li className="p-4">
        <form onSubmit={rename} noValidate className="flex max-w-md flex-col gap-1.5">
          <Label htmlFor={`${id}-name`}>New name for {category.name}</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              className="min-w-40 flex-1"
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${id}-problem` : undefined}
              autoFocus
            />
            <Button type="submit" aria-disabled={save.isPending || undefined}>
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setRenaming(false)
                setName(category.name)
                setProblem(null)
              }}
            >
              Cancel
            </Button>
          </div>
          {problem && (
            <p id={`${id}-problem`} role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}
        </form>
      </li>
    )
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <span className="font-medium">{category.name}</span>
        <span id={`${id}-count`} className="ml-3 text-sm text-muted-foreground">
          {category.product_count} {category.product_count === 1 ? "product" : "products"}
        </span>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setRenaming(true)} aria-label={`Rename ${category.name}`}>
          Rename
        </Button>
        <Button
          variant="ghost"
          className="text-destructive"
          // Stays clickable when in use: the click explains why it can't be deleted yet.
          onClick={onDelete}
          aria-label={`Delete ${category.name}`}
          aria-describedby={inUse ? `${id}-count` : undefined}
        >
          Delete
        </Button>
      </div>
    </li>
  )
}
