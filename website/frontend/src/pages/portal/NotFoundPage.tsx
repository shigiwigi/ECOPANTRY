import { Link } from "react-router"
import { PageHeader } from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"

/** 404 inside the portal layout, so staff keep the sidebar instead of landing on the public site. */
export default function PortalNotFoundPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="This page doesn't exist"
        documentTitle="Page not found"
        description="Check the address, or choose a module from the navigation."
      />
      <Button asChild variant="outline">
        <Link to="/portal">Back to dashboard</Link>
      </Button>
    </div>
  )
}
