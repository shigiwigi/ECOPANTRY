import { isRouteErrorResponse, Link, useLocation, useRouteError } from "react-router"
import { Button } from "@/components/ui/button"
import { useDocumentTitle } from "@/lib/document-title"

/**
 * Router error boundary for unexpected render or loading errors. Unknown paths
 * are handled by the catch-all routes inside each layout (NotFound.tsx).
 */
export function RouteError() {
  const error = useRouteError()
  const { pathname } = useLocation()

  // Log caught error for debugging inside the component body where hooks are valid
  console.error("REACT ROUTER CAUGHT ERROR:", error)

  const notFound = isRouteErrorResponse(error) && error.status === 404
  const inPortal = pathname === "/portal" || pathname.startsWith("/portal/")
  useDocumentTitle(notFound ? "Page not found" : "Something went wrong", inPortal ? "portal" : "public")

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 px-4 py-16">
      <p className="font-mono text-sm text-muted-foreground">{notFound ? "404" : "Error"}</p>
      <h1 className="font-display text-3xl font-semibold tracking-tight">
        {notFound ? "This page doesn't exist" : "Something went wrong"}
      </h1>
      <p className="text-muted-foreground">
        {notFound
          ? "The link may be out of date, or the page may have moved."
          : "The page couldn't be displayed. Reload to try again; if it keeps happening, let an administrator know."}
      </p>
      <div>
        <Button asChild>
          {inPortal ? <Link to="/portal">Back to dashboard</Link> : <Link to="/">Go to the home page</Link>}
        </Button>
      </div>
    </main>
  )
}