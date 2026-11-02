import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, CloudOff, SearchX } from "lucide-react"
import { Link, useParams } from "react-router"
import { EmptyState } from "@/components/common/EmptyState"
import { Button } from "@/components/ui/button"
import { formatPrice, publicProductQuery } from "@/features/catalogue/public"
import { ApiError } from "@/lib/api/client"
import { useDocumentTitle } from "@/lib/document-title"

/** One published product. Drafts and unknown addresses both show "not found". */
export default function ProductDetailPage() {
  const { slug = "" } = useParams()
  const { data: product, isPending, error, refetch, isFetching } = useQuery(publicProductQuery(slug))
  const notFound = error instanceof ApiError && error.status === 404
  useDocumentTitle(product?.name ?? (notFound ? "Product not found" : "Product"))

  return (
    <div className="container-page py-10 sm:py-14 lg:py-16">
      <Link
        to="/products"
        className="-mx-1 inline-flex min-h-8 items-center gap-1.5 rounded-md px-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All products
      </Link>

      {isPending ? (
        <p role="status" className="mt-6 text-muted-foreground">
          Loading product…
        </p>
      ) : product ? (
        <article className="mt-6 max-w-3xl">
          {product.category && (
            <p className="text-sm font-medium tracking-wide text-primary uppercase">
              <Link to={`/products?category=${product.category.slug}`} className="hover:underline underline-offset-4">
                {product.category.name}
              </Link>
            </p>
          )}
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl xl:text-5xl">{product.name}</h1>
          {product.price && product.currency && (
            <p className="mt-4 text-xl font-medium tabular-nums">{formatPrice(product.price, product.currency)}</p>
          )}
          {product.summary && <p className="mt-6 text-lg text-muted-foreground lg:text-xl">{product.summary}</p>}
          {product.description && (
            <div className="mt-6 space-y-4 border-t-2 border-gold pt-6 leading-relaxed">
              {product.description.split(/\n{2,}/).map((paragraph, index) => (
                <p key={index} className="whitespace-pre-line">
                  {paragraph}
                </p>
              ))}
            </div>
          )}
        </article>
      ) : notFound ? (
        <>
          <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight">Product not found</h1>
          <EmptyState
            className="mt-6"
            icon={SearchX}
            title="We couldn't find that product"
            description={
              <>
                There is no product at <span className="font-mono">{slug}</span>. It may have been removed or renamed.
              </>
            }
          >
            <Button asChild variant="outline" size="sm">
              <Link to="/products">See all products</Link>
            </Button>
          </EmptyState>
        </>
      ) : (
        <>
          <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight">Product</h1>
          <EmptyState
            className="mt-6"
            icon={CloudOff}
            title="This product can't be loaded right now"
            description="Please try again in a moment."
          >
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? "Trying again…" : "Try again"}
            </Button>
          </EmptyState>
        </>
      )}
    </div>
  )
}
