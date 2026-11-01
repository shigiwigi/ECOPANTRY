import { PageHeader } from "@/components/layout/PageHeader"
import { getModule } from "@/config/portal-modules"
import { useAuth } from "@/features/auth/auth-context"
import { ChangePasswordForm } from "@/features/auth/ChangePasswordForm"
import { ThemeSelector } from "@/features/theme/ThemeSelector"

export default function SettingsPage() {
  const module = getModule("settings")
  const { isPreview } = useAuth()

  return (
    <div className="space-y-6">
      <PageHeader title={module.title} description={module.summary} />
      <section className="rounded-lg border bg-card p-5">
        <h2 className="sr-only">Appearance</h2>
        <ThemeSelector />
      </section>
      <section className="rounded-lg border bg-card p-5">
        {isPreview ? (
          <p className="text-sm text-muted-foreground">
            Password changes need a real sign-in. The development preview has no account.
          </p>
        ) : (
          <ChangePasswordForm />
        )}
      </section>
    </div>
  )
}
