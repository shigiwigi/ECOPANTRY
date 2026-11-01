import { Link } from "react-router"
import { Button } from "@/components/ui/button"
import { useDocumentTitle } from "@/lib/document-title"

/** 404 inside the public layout, so the site navigation stays available. */
export function PublicNotFound() {
  useDocumentTitle("Page not found")

  return (
    <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">This page doesn't exist</h1>
      <p className="mt-3 max-w-prose text-muted-foreground">The link may be out of date, or the page may have moved.</p>
      <Button asChild className="mt-6">
        <Link to="/">Go to the home page</Link>
      </Button>
    </div>
  )
}
