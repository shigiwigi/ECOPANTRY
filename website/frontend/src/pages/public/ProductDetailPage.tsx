import { ArrowLeft, SearchX } from "lucide-react"
import { Link, useParams } from "react-router"
import { EmptyState } from "@/components/common/EmptyState"
import { Button } from "@/components/ui/button"
import { useDocumentTitle } from "@/lib/document-title"

/**
 * Product detail route. There is no public catalogue API yet, so every id is
 * "not found". Replace the lookup with a TanStack Query call to the public
 * catalogue endpoint when it exists; it must expose public fields only.
 */
export default function ProductDetailPage() {
  const { id } = useParams()
  useDocumentTitle("Product not found")

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-16">
      <Link
        to="/products"
        className="-mx-1 inline-flex min-h-8 items-center gap-1.5 rounded-md px-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All products
      </Link>
      <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight">Product not found</h1>
      <EmptyState
        className="mt-6"
        icon={SearchX}
        title="We couldn't find that product"
        description={
          <>
            There is no product with the reference <span className="font-mono">{id}</span>. It may have been removed,
            or the product list hasn't been published yet.
          </>
        }
      >
        <Button asChild variant="outline" size="sm">
          <Link to="/products">See all products</Link>
        </Button>
      </EmptyState>
    </div>
  )
}
