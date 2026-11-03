import { Ellipsis } from "lucide-react"
import { NavLink } from "react-router"
import { SheetTrigger } from "@/components/ui/sheet"
import { MOBILE_TAB_IDS, portalHref, type PortalModule } from "@/config/portal-modules"
import { cn } from "@/lib/utils"

interface PortalBottomNavProps {
  modules: PortalModule[]
  /** True when the current page isn't one of the tabs, so "More" shows as the active tab. */
  moreActive: boolean
}

const tabClass = (active: boolean) =>
  cn(
    "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[0.6875rem] leading-none font-medium transition-colors",
    "outline-offset-[-2px]",
    // Indicator bar along the top edge of the active tab.
    "before:absolute before:inset-x-3 before:top-0 before:h-0.5 before:rounded-b-full",
    active ? "text-primary before:bg-primary" : "text-muted-foreground hover:text-foreground before:bg-transparent",
  )

/**
 * Fixed bottom bar for the portal below the desktop breakpoint. It holds a few
 * high-frequency modules; the full navigation lives in the drawer behind "More".
 * Render it inside the drawer's <Sheet> so "More" can open it.
 */
export function PortalBottomNav({ modules, moreActive }: PortalBottomNavProps) {
  const tabs = MOBILE_TAB_IDS.map((id) => modules.find((module) => module.id === id)).filter(
    (module): module is PortalModule => module !== undefined,
  )

  return (
    <nav
      aria-label="Quick"
      className="fixed inset-x-0 bottom-0 z-20 border-t bg-background pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto flex h-16 max-w-xl pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        {tabs.map((module) => (
          <li key={module.id} className="flex min-w-0 flex-1">
            <NavLink to={portalHref(module)} end={module.path === ""} className={({ isActive }) => tabClass(isActive)}>
              <module.icon className="size-5 shrink-0" aria-hidden />
              <span className="max-w-full truncate">{module.tabLabel ?? module.label}</span>
            </NavLink>
          </li>
        ))}
        <li className="flex min-w-0 flex-1">
          <SheetTrigger asChild>
            <button type="button" className={tabClass(moreActive)} aria-label="More modules">
              <Ellipsis className="size-5 shrink-0" aria-hidden />
              <span aria-hidden>More</span>
            </button>
          </SheetTrigger>
        </li>
      </ul>
    </nav>
  )
}
