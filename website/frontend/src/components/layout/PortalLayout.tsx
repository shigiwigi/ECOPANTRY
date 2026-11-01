import { LogOut, Menu } from "lucide-react"
import { useRef, useState } from "react"
import { Link, Outlet, useLocation, useNavigate } from "react-router"
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { modulesForRole, PORTAL_MODULES, portalHref } from "@/config/portal-modules"
import { useAuth } from "@/features/auth/auth-context"
import { PORTAL_PREVIEW_ENABLED } from "@/features/auth/preview"
import { ROLE_LABELS } from "@/features/auth/roles"
import { ThemeMenu } from "@/features/theme/ThemeMenu"
import { PortalNav } from "./PortalNav"

function currentModuleLabel(pathname: string): string {
  const path = pathname.replace(/\/$/, "") || "/"
  const match = PORTAL_MODULES.find(
    (module) =>
      path === portalHref(module) ||
      // The dashboard is /portal itself; only modules with their own path own sub-paths.
      (module.path !== "" && path.startsWith(`${portalHref(module)}/`)),
  )
  return match?.label ?? "Portal"
}

export function PortalLayout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const navigatedFromDrawer = useRef(false)
  useFocusMainOnNavigate()

  // RequireAuth guarantees a user; this keeps the type narrow without a non-null assertion.
  if (!user) return null
  const modules = modulesForRole(user.role)

  const handleSignOut = () => {
    signOut()
    navigate("/portal/sign-in", { replace: true })
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      {/* Compile-time constant: the banner is removed from production builds. */}
      {PORTAL_PREVIEW_ENABLED && <DevPreviewBanner />}
      <div className="flex min-h-0 flex-1">
        {/* Sticky with its own scroll, so the navigation stays in reach on short laptop screens. */}
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col self-start border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
          <div className="flex h-14 items-center border-b border-sidebar-border px-4">
            <Link to="/portal" className="rounded-md text-sidebar-foreground" aria-label="EcoPantry portal home">
              <Logo />
            </Link>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-4">
            <PortalNav modules={modules} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background px-3 sm:px-5">
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
                  <Menu aria-hidden />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-72 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground [&>button]:text-sidebar-foreground"
                onCloseAutoFocus={(event) => {
                  // After choosing a module, focus the new page rather than the menu button.
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
            </Sheet>

            <p className="min-w-0 flex-1 truncate text-sm font-medium" aria-hidden>
              {currentModuleLabel(pathname)}
            </p>

            <ThemeMenu />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="max-w-40 gap-2" aria-label="Account menu">
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
                <DropdownMenuItem onSelect={handleSignOut}>
                  <LogOut aria-hidden />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>

          <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl 2xl:max-w-[1600px]">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
