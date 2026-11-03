import { ArrowRight, Menu, X } from "lucide-react"
import { useRef, useState } from "react"
import { Link, NavLink, Outlet } from "react-router"
import { Logo } from "@/components/common/Logo"
import { focusMainContent, useFocusMainOnNavigate } from "@/components/common/route-focus"
import { MAIN_CONTENT_ID, SkipLink } from "@/components/common/SkipLink"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { PUBLIC_NAV, siteConfig } from "@/config/site"
import { ThemeMenu } from "@/features/theme/ThemeMenu"
import { ThemeSelector } from "@/features/theme/ThemeSelector"
import { useMediaQuery } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "rounded-md px-3 py-2 text-sm font-medium transition-colors lg:px-4 lg:text-base",
    isActive ? "text-foreground underline decoration-gold decoration-2 underline-offset-8" : "text-muted-foreground hover:text-foreground",
  )

/** Matches Tailwind's `md` breakpoint, where the inline navigation replaces the menu. */
const DESKTOP_NAV_QUERY = "(width >= 48rem)"

export function PublicLayout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const navigatedFromMenu = useRef(false)
  const menuNavRef = useRef<HTMLElement>(null)
  const desktopNav = useMediaQuery(DESKTOP_NAV_QUERY)
  useFocusMainOnNavigate()

  // The menu button disappears at the desktop breakpoint; don't leave an orphaned drawer open.
  const [prevWide, setPrevWide] = useState(desktopNav)
  if (desktopNav !== prevWide) {
    setPrevWide(desktopNav)
    if (desktopNav) setMenuOpen(false)
  }

  const closeMenuAfterNavigate = () => {
    navigatedFromMenu.current = true
    setMenuOpen(false)
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="sticky top-0 z-30 border-b bg-background">
        <div className="container-page grid h-16 grid-cols-[1fr_auto] items-center gap-4 md:grid-cols-[1fr_auto_1fr] lg:h-20">
          <Link to="/" className="justify-self-start rounded-md text-primary" aria-label={`${siteConfig.name} home`}>
            <Logo />
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {PUBLIC_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2 justify-self-end">
            <ThemeMenu className="hidden md:inline-flex" />
            <Button asChild variant="outline" className="hidden md:inline-flex lg:h-9 lg:px-4 lg:text-sm">
              <Link to="/portal">Staff sign-in</Link>
            </Button>

            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" className="size-11 md:hidden" aria-label="Open menu">
                  <Menu className="size-5" aria-hidden />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="right"
                showCloseButton={false}
                className="w-[min(22rem,88vw)] gap-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
                onOpenAutoFocus={(event) => {
                  // Start on the current page's link so arrowing/tabbing begins where the reader is.
                  const current = menuNavRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
                  if (!current) return
                  event.preventDefault()
                  current.focus()
                }}
                onCloseAutoFocus={(event) => {
                  // After choosing a page, focus the new page rather than the menu button.
                  if (!navigatedFromMenu.current) return
                  navigatedFromMenu.current = false
                  event.preventDefault()
                  focusMainContent()
                }}
              >
                <SheetHeader className="flex-row items-center justify-between gap-2 border-b px-4 py-0">
                  <SheetTitle className="flex h-16 items-center text-primary">
                    <Logo />
                  </SheetTitle>
                  <SheetDescription className="sr-only">Site navigation</SheetDescription>
                  <SheetClose asChild>
                    <Button variant="ghost" className="-mr-1.5 size-11" aria-label="Close menu">
                      <X className="size-5" aria-hidden />
                    </Button>
                  </SheetClose>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto px-3 py-4">
                  <nav ref={menuNavRef} aria-label="Mobile">
                    <ul className="flex flex-col gap-1">
                      {PUBLIC_NAV.map((item) => (
                        <li key={item.to}>
                          <NavLink
                            to={item.to}
                            end={item.end}
                            onClick={closeMenuAfterNavigate}
                            className={({ isActive }) =>
                              cn(
                                "flex min-h-12 items-center rounded-md px-3 text-lg font-medium transition-colors",
                                isActive
                                  ? "bg-accent text-accent-foreground shadow-[inset_3px_0_0_var(--gold)]"
                                  : "text-foreground hover:bg-muted",
                              )
                            }
                          >
                            {item.label}
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  </nav>

                  <div className="mt-4 border-t px-1 pt-4">
                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">For bakery staff</p>
                    <Button asChild variant="outline" className="mt-2 h-12 w-full text-base">
                      <Link to="/portal" onClick={closeMenuAfterNavigate}>
                        Staff sign-in
                      </Link>
                    </Button>
                  </div>
                </div>

                <SheetFooter className="border-t px-4 py-4">
                  <ThemeSelector variant="compact" />
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 outline-none">
        <Outlet />
      </main>

      {/* Same three-column grid as the header: brand left, links centred under the main navigation, staff link right. */}
      <footer className="border-t bg-secondary/50 pb-[env(safe-area-inset-bottom)]">
        <div className="container-page grid gap-x-8 gap-y-4 py-6 text-sm md:grid-cols-[1fr_auto_1fr] md:items-center lg:py-8">
          <div className="min-w-0">
            <Logo className="text-primary" />
            <p className="mt-1.5 text-muted-foreground">{siteConfig.tagline}</p>
          </div>
          <nav aria-label="Footer" className="-mx-2 flex flex-wrap gap-x-1">
            {PUBLIC_NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="inline-flex min-h-11 items-center rounded-md px-2 text-muted-foreground hover:text-foreground md:min-h-9"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="md:justify-self-end">
            <Link
              to="/portal"
              className="-mx-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 font-medium text-primary underline-offset-4 hover:underline md:min-h-9"
            >
              Staff portal
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
