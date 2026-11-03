import { ArrowRight, CalendarClock, Leaf, ShieldCheck } from "lucide-react"
import { Link } from "react-router"
import { Logo } from "@/components/common/Logo"
import { Button } from "@/components/ui/button"
import { siteConfig } from "@/config/site"
import { useDocumentTitle } from "@/lib/document-title"

const VALUES = [
  {
    icon: Leaf,
    title: "Less waste",
    text: "We track what we buy and what we throw away, so we can bake with what we have.",
  },
  {
    icon: CalendarClock,
    title: "Earliest expiry first",
    text: "Ingredients are used in order of expiry date, so stock doesn't sit and spoil.",
  },
  {
    icon: ShieldCheck,
    title: "Careful records",
    text: "Storage conditions and stock movements are written down, not remembered.",
  },
]

export default function HomePage() {
  useDocumentTitle()

  return (
    <>
      <section className="border-b bg-secondary/60">
        <div className="container-page grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-12 lg:gap-10 lg:py-20 xl:gap-16 xl:py-24">
          <div className="lg:col-span-7">
            <p className="text-sm font-medium tracking-wide text-primary uppercase">{siteConfig.name} bakery</p>
            <h1 className="mt-3 max-w-2xl font-display text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              {siteConfig.tagline}
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground lg:text-xl">
              A bakery that keeps close track of its ingredients, so what reaches your table is fresh and not wasted.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="h-11 px-5 text-sm sm:text-base">
                <Link to="/products">
                  Browse products <ArrowRight aria-hidden />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="h-11 px-5 text-sm sm:text-base">
                <Link to="/contact">Contact us</Link>
              </Button>
            </div>
          </div>
          {/* Brand mark until the owners supply real photography of the bakery. */}
          <div
            aria-hidden
            className="hidden aspect-[5/4] items-center justify-center rounded-xl border bg-background/60 text-primary lg:col-span-5 lg:flex"
          >
            <Logo showWordmark={false} className="[&>svg]:size-36 xl:[&>svg]:size-44" />
          </div>
        </div>
      </section>

      <section className="container-page py-14 lg:py-20">
        <h2 className="text-2xl font-semibold lg:text-3xl tracking-tight">How we work</h2>
        <ul className="mt-8 grid gap-8 sm:grid-cols-3">
          {VALUES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="border-t-2 border-gold pt-4">
              <Icon className="size-5 text-primary" aria-hidden />
              <h3 className="mt-3 font-semibold lg:text-lg">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground lg:text-base">{text}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
