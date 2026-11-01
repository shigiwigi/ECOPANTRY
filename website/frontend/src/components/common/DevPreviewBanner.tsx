import { TriangleAlert } from "lucide-react"
import { useAuth } from "@/features/auth/auth-context"
import { ROLE_LABELS, ROLES, type Role } from "@/features/auth/roles"

/** Persistent notice shown while the development-only portal preview is active. */
export function DevPreviewBanner() {
  const { user, isPreview, setPreviewRole } = useAuth()
  if (!isPreview || !user || !setPreviewRole) return null

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm"
    >
      <p className="flex items-center gap-2 font-medium text-warning">
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        Development preview: not signed in, no live data.
      </p>
      <label className="flex items-center gap-2 text-foreground">
        <span className="text-muted-foreground">View as</span>
        <select
          value={user.role}
          onChange={(event) => setPreviewRole(event.target.value as Role)}
          className="h-7 rounded-md border border-input bg-card px-2 text-sm"
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
