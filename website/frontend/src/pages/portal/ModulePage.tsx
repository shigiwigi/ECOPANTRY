import { Construction } from "lucide-react"
import { EmptyState } from "@/components/common/EmptyState"
import { PageHeader } from "@/components/layout/PageHeader"
import type { PortalModule } from "@/config/portal-modules"

/**
 * Page for a portal module that has no data source yet. Shows what the module
 * is for and what it is waiting on, never sample data. Each module gets its
 * own page component once its API exists.
 */
export default function ModulePage({ module }: { module: PortalModule }) {
  return (
    <div className="space-y-6">
      <PageHeader title={module.title} description={module.summary} />

      <EmptyState
        icon={Construction}
        title="Not connected yet"
        description={module.requires ? <>No data is shown until this is in place: {module.requires}</> : undefined}
      />

      {module.planned && (
        <section aria-labelledby={`${module.id}-planned`}>
          <h2 id={`${module.id}-planned`} className="text-sm font-semibold">
            Planned for this module
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground marker:text-gold">
            {module.planned.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
