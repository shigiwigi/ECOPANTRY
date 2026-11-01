import { PageHeader } from "@/components/layout/PageHeader"
import { getModule } from "@/config/portal-modules"
import { ThemeSelector } from "@/features/theme/ThemeSelector"

export default function SettingsPage() {
  const module = getModule("settings")

  return (
    <div className="space-y-6">
      <PageHeader title={module.title} description={module.summary} />
      <section className="rounded-lg border bg-card p-5">
        <h2 className="sr-only">Appearance</h2>
        <ThemeSelector />
      </section>
    </div>
  )
}
