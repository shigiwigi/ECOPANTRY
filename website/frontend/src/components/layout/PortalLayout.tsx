import { Bell, LogOut } from "lucide-react"
import { useRef, useState } from "react"
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router"
import { DevPreviewBanner } from "@/components/common/DevPreviewBanner"
import { Logo } from "@/components/common/Logo"
import { focusMainContent, useFocusMainOnNavigate } from "@/components/common/route-focus"
import { MAIN_CONTENT_ID, SkipLink } from "@/components/common/SkipLink"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  MOBILE_TAB_IDS,
  modulesForRole,
  PORTAL_MODULES,
  portalHref,
  type PortalModule,
} from "@/config/portal-modules"
import { useAuth } from "@/features/auth/auth-context"
import { PORTAL_PREVIEW_ENABLED } from "@/features/auth/preview"
import { ROLE_LABELS } from "@/features/auth/roles"
import { THEME_OPTIONS } from "@/features/theme/options"
import type { ThemePreference } from "@/features/theme/theme"
import { useTheme } from "@/features/theme/theme-context"
import { useMediaQuery } from "@/lib/use-media-query"
import { PortalBottomNav } from "./PortalBottomNav"
import { PortalNav } from "./PortalNav"

function currentModule(pathname: string): PortalModule | undefined {
  const path = pathname.replace(/\/$/, "") || "/"
  return PORTAL_MODULES.find(
    (module) =>
      path === portalHref(module) ||
      (module.path !== "" && path.startsWith(`${portalHref(module)}/`)),
  )
}

/** Matches Tailwind's `lg` breakpoint, where the sidebar replaces the bottom bar and drawer. */
const SIDEBAR_QUERY = "(width >= 64rem)"

export function PortalLayout() {
  const { user, signOut } = useAuth()
  const { preference, setPreference } = useTheme()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [signOutFailed, setSignOutFailed] = useState(false)
  const navigatedFromDrawer = useRef(false)
  const sidebarShown = useMediaQuery(SIDEBAR_QUERY)
  useFocusMainOnNavigate()

  const [prevWide, setPrevWide] = useState(sidebarShown)
  if (sidebarShown !== prevWide) {
    setPrevWide(sidebarShown)
    if (sidebarShown) setDrawerOpen(false)
  }

  if (!user) return null
  const modules = modulesForRole(user.role)
  const activeModule = currentModule(pathname)
  const alertsModule = modules.find((module) => module.id === "alerts")

  const handleSignOut = async () => {
    setSignOutFailed(false)
    try {
      navigate("/", { replace: true })
      await signOut()
    } catch {
      setSignOutFailed(true)
    }
  }

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden">
      <SkipLink />
      {PORTAL_PREVIEW_ENABLED && <DevPreviewBanner />}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Pinned Left Sidebar */}
        <aside className="hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
          <div className="flex h-14 items-center border-b border-sidebar-border px-4">
            <Link to="/portal" className="rounded-md text-sidebar-foreground" aria-label="EcoPantry portal home">
              <Logo />
            </Link>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-4">
            <PortalNav modules={modules} />
          </div>
        </aside>

        {/* Content Column with Pinned Header and Scrollable Body */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Pinned Top Bar */}
          <header className="z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 sm:px-5">
            <Link
              to="/portal"
              className="rounded-md text-primary lg:hidden"
              aria-label="EcoPantry portal home"
            >
              <Logo showWordmark={false} className="[&>svg]:size-7" />
            </Link>

            <p className="min-w-0 flex-1 truncate text-sm font-medium" aria-hidden>
              {activeModule?.label ?? "Portal"}
            </p>

            {alertsModule && (
              <Button
                asChild
                variant="outline"
                className="h-11 gap-2 px-3 max-sm:w-11 max-sm:px-0 aria-[current=page]:border-primary aria-[current=page]:text-primary lg:h-9"
              >
                <NavLink to={portalHref(alertsModule)} aria-label="Open alerts">
                  <Bell className="size-[18px]" aria-hidden />
                  <span className="max-sm:sr-only">Alerts</span>
                </NavLink>
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-11 max-w-48 min-w-11 gap-2 px-2 lg:h-9 lg:min-w-0" aria-label="Account menu">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="hidden truncate sm:inline">{user.name}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuLabel className="font-normal">
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Theme</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={preference} onValueChange={(value) => setPreference(value as ThemePreference)}>
                  {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                    <DropdownMenuRadioItem key={value} value={value} className="max-lg:min-h-10">
                      <Icon aria-hidden />
                      {label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void handleSignOut()} className="max-lg:min-h-10">
                  <LogOut aria-hidden />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>

          {signOutFailed && (
            <p role="alert" className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive sm:px-6 lg:px-8">
              Couldn't reach the EcoPantry server to sign you out, so you're still signed in. Check the connection and try
              again.
            </p>
          )}

          {/* Independently Scrollable Main Section */}
          <main
            id={MAIN_CONTENT_ID}
            tabIndex={-1}
            className="flex-1 overflow-y-auto px-4 pt-6 pb-[calc(4rem+env(safe-area-inset-bottom)+1.5rem)] outline-none sm:px-6 lg:px-8 lg:pb-6"
          >
            <div className="min-w-0">
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          className="w-[min(18rem,85vw)] border-sidebar-border bg-sidebar p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-sidebar-foreground [&>button]:top-[calc(0.75rem+env(safe-area-inset-top))] [&>button]:size-10 [&>button]:text-sidebar-foreground"
          onCloseAutoFocus={(event) => {
            if (!navigatedFromDrawer.current) return
            navigatedFromDrawer.current = false
            event.preventDefault()
            focusMainContent()
          }}
        >
          <SheetHeader className="border-b border-sidebar-border">
            <SheetTitle className="text-sidebar-foreground">
              <Logo />
            </SheetTitle>
            <SheetDescription className="sr-only">Portal navigation</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-2 pb-6">
            <PortalNav
              modules={modules}
              onNavigate={() => {
                navigatedFromDrawer.current = true
                setDrawerOpen(false)
              }}
            />
          </div>
        </SheetContent>
        <PortalBottomNav modules={modules} moreActive={!MOBILE_TAB_IDS.includes(activeModule?.id ?? "")} />
      </Sheet>
    </div>
  )
}