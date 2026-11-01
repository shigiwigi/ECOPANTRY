import { Croissant } from "lucide-react"
import { Link } from "react-router"
import { EmptyState } from "@/components/common/EmptyState"
import { Button } from "@/components/ui/button"
import { hasContactDetails } from "@/config/site"
import { useDocumentTitle } from "@/lib/document-title"

export default function ProductsPage() {
  useDocumentTitle("Products")
  // Only point visitors to Contact once there is something there to find.
  const canContact = hasContactDetails()

  return (
    <div className="container-page py-10 sm:py-14 lg:py-16">
      <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl xl:text-5xl">Products</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Our finished breads, pastries and cakes will be listed here with descriptions and photos.
      </p>

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
    </div>
  )
}
