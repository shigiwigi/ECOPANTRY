import { useQuery } from "@tanstack/react-query"
import { CloudOff, Croissant, Search, SearchX } from "lucide-react"
import { useId } from "react"
import { Link, useSearchParams } from "react-router"
import { EmptyState } from "@/components/common/EmptyState"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { hasContactDetails } from "@/config/site"
import { filterProducts, formatPrice, publicCatalogueQuery, type PublicProduct } from "@/features/catalogue/public"
import { useDocumentTitle } from "@/lib/document-title"
import { cn } from "@/lib/utils"

export default function ProductsPage() {
  useDocumentTitle("Products")
  const { data, isPending, isError, refetch, isFetching } = useQuery(publicCatalogueQuery)

  return (
    <div className="container-page py-10 sm:py-14 lg:py-16">
      <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl xl:text-5xl">Products</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">Breads, pastries and cakes from our bakery.</p>

      {isPending ? (
        <p role="status" className="mt-8 text-muted-foreground">
          Loading products…
        </p>
      ) : isError ? (
        <EmptyState
          className="mt-8"
          icon={CloudOff}
          title="The product list can't be loaded right now"
          description="Please try again in a moment."
        >
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "Trying again…" : "Try again"}
          </Button>
        </EmptyState>
      ) : data.products.length === 0 ? (
        <NothingPublished />
      ) : (
        <Catalogue products={data.products} categories={data.categories} />
      )}
    </div>
  )
}

function NothingPublished() {
  // Only point visitors to Contact once there is something there to find.
  const canContact = hasContactDetails()
  return (
    <EmptyState
      className="mt-8"
      icon={Croissant}
      title="The product list isn't published yet"
      description={
        canContact
          ? "Nothing is shown here until the bakery adds products. Please get in touch to ask what's available today."
          : "Nothing is shown here until the bakery adds products."
      }
    >
      {canContact && (
        <Button asChild variant="outline" size="sm">
          <Link to="/contact">Contact the bakery</Link>
        </Button>
      )}
    </EmptyState>
  )
}

function Catalogue({ products, categories }: { products: PublicProduct[]; categories: { slug: string; name: string }[] }) {
  const id = useId()
  const [params, setParams] = useSearchParams()
  const query = params.get("q") ?? ""
  const requested = params.get("category")
  const category = categories.some((c) => c.slug === requested) ? requested : null
  const shown = filterProducts(products, query, category)

  const update = (key: "q" | "category", value: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true, preventScrollReset: true },
    )

  return (
    <>
      <div className="mt-8 flex flex-col gap-4 border-b pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="w-full max-w-sm space-y-1.5">
          <label htmlFor={`${id}-search`} className="text-sm font-medium">
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id={`${id}-search`}
              type="search"
              value={query}
              onChange={(event) => update("q", event.target.value)}
              placeholder="Name or description"
              className="h-10 pl-9"
              autoComplete="off"
            />
          </div>
        </div>

        {categories.length > 0 && (
          <div role="group" aria-label="Category" className="flex flex-wrap gap-2">
            <CategoryButton pressed={category === null} onClick={() => update("category", null)}>
              All
            </CategoryButton>
            {categories.map((c) => (
              <CategoryButton key={c.slug} pressed={category === c.slug} onClick={() => update("category", c.slug)}>
                {c.name}
              </CategoryButton>
            ))}
          </div>
        )}
      </div>

      <p role="status" className="mt-4 text-sm text-muted-foreground">
        {shown.length === products.length
          ? `${products.length} ${products.length === 1 ? "product" : "products"}`
          : `Showing ${shown.length} of ${products.length} products`}
      </p>

      {shown.length === 0 ? (
        <EmptyState className="mt-6" icon={SearchX} title="No products match your search">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setParams(new URLSearchParams(), { replace: true, preventScrollReset: true })
            }
          >
            Show all products
          </Button>
        </EmptyState>
      ) : (
        <ul className="mt-6 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((product) => (
            <li key={product.slug}>
              <ProductEntry product={product} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function CategoryButton({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "min-h-10 rounded-full border px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        pressed
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  )
}

function ProductEntry({ product }: { product: PublicProduct }) {
  return (
    <article className="group relative flex h-full flex-col border-t-2 border-gold pt-4">
      {product.category && (
        <p className="text-xs font-medium tracking-wide text-primary uppercase">{product.category.name}</p>
      )}
      <h2 className="mt-1 font-display text-xl font-semibold tracking-tight">
        <Link
          to={`/products/${product.slug}`}
          className="rounded-sm outline-none after:absolute after:inset-0 group-hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 underline-offset-4"
        >
          {product.name}
        </Link>
      </h2>
      {product.summary && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{product.summary}</p>}
      {product.price && product.currency && (
        <p className="mt-auto pt-3 font-medium tabular-nums">{formatPrice(product.price, product.currency)}</p>
      )}
    </article>
  )
}
