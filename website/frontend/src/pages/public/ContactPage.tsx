import type { ReactNode } from "react"
import { hasContactDetails, siteConfig } from "@/config/site"
import { useDocumentTitle } from "@/lib/document-title"

export default function ContactPage() {
  const { email, phone, address } = siteConfig.contact
  const hours = siteConfig.openingHours
  useDocumentTitle("Contact")

  return (
    <div className="container-page py-10 sm:py-14 lg:py-16">
      <div className="max-w-3xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl xl:text-5xl">Contact</h1>

        {hasContactDetails() ? (
          <dl className="mt-8 grid gap-6 sm:grid-cols-2">
            {address && <Detail label="Address">{address}</Detail>}
            {phone && (
              <Detail label="Phone">
                <a className="underline underline-offset-4" href={`tel:${phone.replace(/\s/g, "")}`}>
                  {phone}
                </a>
              </Detail>
            )}
            {email && (
              <Detail label="Email">
                <a className="underline underline-offset-4" href={`mailto:${email}`}>
                  {email}
                </a>
              </Detail>
            )}
            {hours && (
              <Detail label="Opening hours">
                <ul>
                  {hours.map(({ days, hours: time }) => (
                    <li key={days}>
                      {days}: {time}
                    </li>
                  ))}
                </ul>
              </Detail>
            )}
          </dl>
        ) : (
          <p className="mt-4 text-muted-foreground">
            The bakery's contact details haven't been added yet. They will appear here once the owners publish them.
          </p>
        )}
      </div>
    </div>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t-2 border-gold pt-3">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  )
}
