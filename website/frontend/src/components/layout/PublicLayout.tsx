import { Menu } from "lucide-react"
import { useRef, useState } from "react"
import { Link, NavLink, Outlet } from "react-router"
import { Logo } from "@/components/common/Logo"
import { focusMainContent, useFocusMainOnNavigate } from "@/components/common/route-focus"
import { MAIN_CONTENT_ID, SkipLink } from "@/components/common/SkipLink"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { PUBLIC_NAV, siteConfig } from "@/config/site"
import { ThemeMenu } from "@/features/theme/ThemeMenu"
import { cn } from "@/lib/utils"

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "rounded-md px-3 py-2 text-sm font-medium transition-colors lg:px-4 lg:text-base",
    isActive ? "text-foreground underline decoration-gold decoration-2 underline-offset-8" : "text-muted-foreground hover:text-foreground",
  )

export function PublicLayout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const navigatedFromMenu = useRef(false)
  useFocusMainOnNavigate()

  const closeMenuAfterNavigate = () => {
    navigatedFromMenu.current = true
    setMenuOpen(false)
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur-none">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:h-20 lg:px-8">
          <Link to="/" className="text-primary rounded-md" aria-label={`${siteConfig.name} home`}>
            <Logo />
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {PUBLIC_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-1">
            <ThemeMenu />
            <Button asChild variant="outline" className="ml-1 hidden md:inline-flex lg:h-9 lg:px-4 lg:text-sm">
              <Link to="/portal">Staff sign-in</Link>
            </Button>

            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon-lg" className="md:hidden" aria-label="Open menu">
                  <Menu className="size-5" aria-hidden />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="right"
                className="w-[min(20rem,85vw)]"
                onCloseAutoFocus={(event) => {
                  // After choosing a page, focus the new page rather than the menu button.
                  if (!navigatedFromMenu.current) return
                  navigatedFromMenu.current = false
                  event.preventDefault()
                  focusMainContent()
                }}
              >
                <SheetHeader>
                  <SheetTitle>
                    <Logo />
                  </SheetTitle>
                  <SheetDescription className="sr-only">Site navigation</SheetDescription>
                </SheetHeader>
                <nav aria-label="Mobile" className="flex flex-col gap-1 px-4 pb-6">
                  {PUBLIC_NAV.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={closeMenuAfterNavigate}
                      className={({ isActive }) =>
                        cn(
                          "rounded-md px-3 py-3 text-base font-medium",
                          isActive ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-muted",
                        )
                      }
                    >
                      {item.label}
                    </NavLink>
                  ))}
                  <Link
                    to="/portal"
                    onClick={closeMenuAfterNavigate}
                    className="mt-3 rounded-md border px-3 py-3 text-base font-medium hover:bg-muted"
                  >
                    Staff sign-in
                  </Link>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 outline-none">
        <Outlet />
      </main>

      <footer className="border-t bg-secondary/50">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8 lg:py-12 lg:text-base">
          <div>
            <Logo className="text-primary" />
            <p className="mt-2 text-muted-foreground">{siteConfig.tagline}</p>
          </div>
          <nav aria-label="Footer" className="-mx-1 flex flex-wrap gap-x-3 gap-y-1">
            {PUBLIC_NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="inline-flex min-h-8 items-center rounded-md px-1 text-muted-foreground hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  )
}
