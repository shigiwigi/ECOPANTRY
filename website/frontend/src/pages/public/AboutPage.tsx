import { useDocumentTitle } from "@/lib/document-title"

export default function AboutPage() {
  useDocumentTitle("About")

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-16">
      <div className="max-w-3xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl xl:text-5xl">About EcoPantry</h1>
        <div className="mt-6 space-y-4 text-lg leading-relaxed text-muted-foreground">
          <p>
            EcoPantry is a bakery that keeps careful records of what it buys, stores and uses. Each batch of
            ingredients is tracked from delivery to the oven, along with the conditions it was stored in.
          </p>
          <p>
            The aim is simple: use ingredients while they are good, waste less, and be able to show how everything was
            handled.
          </p>
        </div>
        <p className="mt-8 border-l-2 border-gold pl-4 text-sm text-muted-foreground">
          The bakery's own story, team and location will be added here by the owners.
        </p>
      </div>
    </div>
  )
}
