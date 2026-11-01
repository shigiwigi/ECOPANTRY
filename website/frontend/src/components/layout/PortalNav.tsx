import { NavLink } from "react-router"
import { PORTAL_GROUPS, portalHref, type PortalModule } from "@/config/portal-modules"
import { cn } from "@/lib/utils"

interface PortalNavProps {
  modules: PortalModule[]
  onNavigate?: () => void
}

/** Grouped portal navigation, shared by the desktop sidebar and the mobile drawer. */
export function PortalNav({ modules, onNavigate }: PortalNavProps) {
  return (
    <nav aria-label="Portal" className="flex flex-col gap-5">
      {PORTAL_GROUPS.map((group) => {
        const items = modules.filter((module) => module.group === group)
        if (items.length === 0) return null
        return (
          <div key={group}>
            <p className="px-3 pb-1.5 text-xs font-medium tracking-wide text-sidebar-muted-foreground uppercase">
              {group}
            </p>
            <ul className="flex flex-col gap-0.5">
              {items.map((module) => (
                <li key={module.id}>
                  <NavLink
                    to={portalHref(module)}
                    end={module.path === ""}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                        "outline-offset-0 focus-visible:outline-sidebar-ring",
                        isActive
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-[inset_2px_0_0_var(--sidebar-primary)]"
                          : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                      )
                    }
                  >
                    <module.icon className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{module.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}
